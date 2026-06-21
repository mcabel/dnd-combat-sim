// ============================================================
// Silvery Barbs — SCC p.38 (Strixhaven: A Curriculum of Chaos)
//
// 1st-level enchantment, reaction
// Trigger: A creature you can see within 60 feet of you hits on an
//          attack roll, OR succeeds on a saving throw, OR succeeds on
//          an ability check
// Range: 60 feet
// Duration: Instantaneous
//
// Effect:
//   - The triggering creature must reroll the d20 and use the lower
//     result. (This can flip a hit to a miss, a save success to a
//     failure, or an ability-check success to a failure.)
//   - You can then choose a different creature you can see within
//     range; that creature has advantage on its next attack roll
//     against the triggering creature, made before the start of the
//     triggering creature's next turn.
//   - Upcast: +1 creature per slot level above 1st (for the advantage
//     rider, not the reroll).
//   - No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the trigger-aware
//     entry points consumed by the reaction registry.
//   - v1 only handles the `incoming_attack_hit` trigger (the reroll
//     flips the hit to a miss if the lower roll misses). The save-
//     success and ability-check-success triggers are NOT implemented
//     (they would require additional trigger points in the engine).
//   - `executeReaction` returns `{ kind: 'negated' }` when the reroll
//     flips the hit to a miss; otherwise `{ kind: 'failed' }`.
//   - The "advantage on next attack" rider is NOT implemented in v1
//     (would require tracking a per-target advantage flag).
//   - No cleanup needed — the effect is instantaneous.
//
// v1 simplifications:
//   - Only triggers on attack hits (not save successes or ability
//     check successes).
//   - The reroll uses the lower of the two d20 rolls, but the to-hit
//     bonus is the same (no reroll of the bonus).
//   - The advantage rider is not modelled.
//   - shouldCastReaction always returns true if the trigger is valid
//     (no tactical gating on whether the reroll will help). This may
//     waste slots when the original roll was low enough that the reroll
//     won't flip it. Future enhancement: only cast if the lower of
//     (original roll, expected reroll) would miss.
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { consumeSpellSlot } from '../ai/resources';
import { rollDie, attackHits } from '../engine/utils';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Silvery Barbs',
  level: 1,
  school: 'enchantment',
  rangeFt: 60,
  concentration: false,
  castingTime: 'reaction',
} as const;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Silvery Barbs in response to
 * `trigger`.
 *
 * Tactical rule (v1): cast whenever an enemy within 60 ft hits with an
 * attack. The reroll has a chance to flip the hit to a miss.
 *
 * v1 does NOT gate on whether the reroll will flip the hit (we'd need
 * to roll the new d20 in shouldCast, which is wasteful and breaks the
 * "shouldCast is pure" convention). Instead, executeReaction rolls the
 * new d20 and reports the outcome.
 *
 * Future enhancement: estimate the reroll's value based on the original
 * roll (e.g., don't cast if original roll was 5 below AC — the reroll
 * is unlikely to help).
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind !== 'incoming_attack_hit') return false;
  // Only cast against enemies (PHB: "a creature you can see" — but
  // tactically you'd only cast against enemies).
  if (trigger.attacker.id === caster.id) return false;
  // Range check: PHB p.38 "within 60 feet".
  const dx = Math.abs(caster.pos.x - trigger.attacker.pos.x);
  const dy = Math.abs(caster.pos.y - trigger.attacker.pos.y);
  const dz = Math.abs(caster.pos.z - trigger.attacker.pos.z);
  const distFt = Math.max(dx, dy, dz) * 5;
  if (distFt > 60) return false;
  // Don't cast if the attacker is already dead (shouldn't happen mid-attack).
  if (trigger.attacker.isDead || trigger.attacker.isUnconscious) return false;
  // Don't cast against a natural 20 crit — the reroll will use the lower
  // of the two rolls, but crits are determined by the nat-20. Actually,
  // per Sage Advice, Silvery Barbs forces a reroll of the d20, and the
  // lower result is used. A nat 20 rerolled to a 5 would mean the 5 is
  // used (no crit). So Silvery Barbs CAN negate a crit. v1 allows it.
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Silvery Barbs reaction. Rolls a new d20, uses the lower of
 * the original and new rolls, and re-evaluates the hit. If the lower
 * roll misses, returns `{ kind: 'negated' }` (the engine flips the hit
 * to a miss and skips damage).
 *
 * PHB/SCC: "The triggering creature must reroll the d20 and use the
 * lower roll."
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind !== 'incoming_attack_hit') return { kind: 'no_effect' };

  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  // Roll a new d20 for the reroll.
  const newRoll = rollDie(20);
  // Use the lower of the original and new rolls.
  const lowerRoll = Math.min(trigger.attackRoll, newRoll);
  // Reconstruct the attack total with the lower roll.
  // The original total = attackRoll + hitBonus + modifiers.
  // The new total = lowerRoll + (attackTotal - attackRoll).
  const hitBonus = trigger.attackTotal - trigger.attackRoll;
  const newTotal = lowerRoll + hitBonus;

  // Re-evaluate the hit with the lower roll.
  // Note: crits are determined by nat 20. If the lower roll is a nat 20,
  // it's still a crit. But since lowerRoll <= originalRoll and originalRoll
  // was the one that hit, if original was a nat 20, lowerRoll is likely
  // lower (no crit). If original was a nat 1, it would have missed (we
  // wouldn't be here). So the crit logic is preserved.
  const wasCrit = trigger.isCrit;
  const newIsCrit = lowerRoll === 20;
  const newHits = attackHits(lowerRoll, newTotal, trigger.effectiveAC);

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: trigger.attacker.id,
    description: `${caster.name} casts Silvery Barbs — ${trigger.attacker.name} rerolls the d20 (original ${trigger.attackRoll} → new ${newRoll}, using ${lowerRoll}). Attack ${newHits ? 'still hits' : 'now MISSES'} (${newTotal} vs AC ${trigger.effectiveAC})!`,
  });

  if (!newHits) {
    return { kind: 'negated', detail: `Silvery Barbs reroll (${newRoll}) flipped hit to miss` };
  }
  // The reroll didn't flip the hit — but the lower roll might have flipped
  // a crit to a normal hit. v1 doesn't model this (the engine uses the
  // original isCrit for the damage branch). Future enhancement: pass the
  // new isCrit back to the engine.
  return { kind: 'failed', detail: `Silvery Barbs reroll (${newRoll}) did not flip the hit` };
}

// ---- cleanup ------------------------------------------------
//
// No cleanup needed — Silvery Barbs is instantaneous.

export function cleanup(_caster: Combatant): void {
  // No-op — instantaneous spell.
}
