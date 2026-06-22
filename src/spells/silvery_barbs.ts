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
//   - Session 41 Task #8: added `incoming_save_success` trigger handling.
//     The save-success path rerolls the d20, uses the lower result, and
//     re-evaluates success. If the reroll flips the save to a failure,
//     returns `{ kind: 'negated' }` — the engine's `rollSaveReactable`
//     wrapper then returns success=false so the calling spell module's
//     "save failed" branch runs.
//   - The ability-check-success trigger is NOT implemented (would
//     require additional trigger points in the engine).
//   - `executeReaction` returns `{ kind: 'negated' }` when the reroll
//     flips the hit to a miss OR the save success to a failure;
//     otherwise `{ kind: 'failed' }`.
//   - The "advantage on next attack" rider is NOT implemented in v1
//     (would require tracking a per-target advantage flag).
//   - No cleanup needed — the effect is instantaneous.
//
// v1 simplifications:
//   - Triggers on attack hits AND save successes (Session 41 added the
//     latter). Ability-check-success is not yet implemented.
//   - The reroll uses the lower of the two d20 rolls, but the to-hit
//     bonus / save mods are the same (no reroll of the bonus).
//   - The advantage rider is not modelled.
//   - shouldCastReaction always returns true if the trigger is valid
//     (no tactical gating on whether the reroll will help). This may
//     waste slots when the original roll was low enough that the reroll
//     won't flip it. Future enhancement: only cast if the lower of
//     (original roll, expected reroll) would miss/fail.
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
  silveryBarbsSaveSuccessV1Implemented: true,
} as const;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Silvery Barbs in response to
 * `trigger`.
 *
 * Handles two trigger kinds:
 *   - 'incoming_attack_hit': caster forces attacker to reroll the d20.
 *     Cast whenever an enemy within 60 ft hits with an attack.
 *   - 'incoming_save_success' (Session 41 Task #8): caster forces saver
 *     to reroll the d20. Cast whenever an enemy within 60 ft succeeds
 *     on a save against the caster's spell.
 *
 * v1 does NOT gate on whether the reroll will flip the result.
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind !== 'incoming_attack_hit' && trigger.kind !== 'incoming_save_success') return false;

  // The triggering creature is the attacker (for attack_hit) or the saver
  // (for save_success). Silvery Barbs forces THAT creature to reroll.
  const triggerCreature = trigger.kind === 'incoming_attack_hit' ? trigger.attacker : trigger.saver;

  // Only cast against enemies (PHB: "a creature you can see" — but
  // tactically you'd only cast against enemies).
  if (triggerCreature.id === caster.id) return false;
  // Range check: PHB p.38 "within 60 feet".
  const dx = Math.abs(caster.pos.x - triggerCreature.pos.x);
  const dy = Math.abs(caster.pos.y - triggerCreature.pos.y);
  const dz = Math.abs(caster.pos.z - triggerCreature.pos.z);
  const distFt = Math.max(dx, dy, dz) * 5;
  if (distFt > 60) return false;
  // Don't cast if the triggering creature is already dead (shouldn't happen mid-trigger).
  if (triggerCreature.isDead || triggerCreature.isUnconscious) return false;
  // Don't cast against a natural 20 crit — the reroll will use the lower
  // of the two rolls, but crits are determined by the nat-20. Actually,
  // per Sage Advice, Silvery Barbs forces a reroll of the d20, and the
  // lower result is used. A nat 20 rerolled to a 5 would mean the 5 is
  // used (no crit). So Silvery Barbs CAN negate a crit. v1 allows it.
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Silvery Barbs reaction. Handles two trigger kinds:
 *
 * 'incoming_attack_hit': rolls a new d20, uses the lower of the
 * original and new rolls, and re-evaluates the hit. If the lower
 * roll misses, returns `{ kind: 'negated' }`.
 *
 * 'incoming_save_success' (Session 41 Task #8): rolls a new d20, uses
 * the lower of the original and new rolls, and re-evaluates the save.
 * If the lower roll fails the save, returns `{ kind: 'negated' }` —
 * the engine's `rollSaveReactable` wrapper then returns success=false
 * so the calling spell module's "save failed" branch runs.
 *
 * PHB/SCC: "The triggering creature must reroll the d20 and use the
 * lower roll."
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind === 'incoming_attack_hit') {
    return executeAttackHitReroll(caster, state, trigger);
  }
  if (trigger.kind === 'incoming_save_success') {
    return executeSaveSuccessReroll(caster, state, trigger);
  }
  return { kind: 'no_effect' };
}

/**
 * Handle the 'incoming_attack_hit' trigger: reroll the attack d20,
 * use the lower result, and re-evaluate the hit.
 */
function executeAttackHitReroll(
  caster: Combatant,
  state: EngineState,
  trigger: Extract<ReactionTrigger, { kind: 'incoming_attack_hit' }>,
): ReactionOutcome {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  // Roll a new d20 for the reroll.
  const newRoll = rollDie(20);
  // Use the lower of the original and new rolls.
  const lowerRoll = Math.min(trigger.attackRoll, newRoll);
  // Reconstruct the attack total with the lower roll.
  const hitBonus = trigger.attackTotal - trigger.attackRoll;
  const newTotal = lowerRoll + hitBonus;

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
  return { kind: 'failed', detail: `Silvery Barbs reroll (${newRoll}) did not flip the hit` };
}

/**
 * Handle the 'incoming_save_success' trigger (Session 41 Task #8):
 * reroll the save d20, use the lower result, and re-evaluate success.
 *
 * The save's modifier is reconstructed from `trigger.total - trigger.roll`
 * (the original total included the d20 + all mods; the new total uses
 * the lower d20 + the same mods).
 */
function executeSaveSuccessReroll(
  caster: Combatant,
  state: EngineState,
  trigger: Extract<ReactionTrigger, { kind: 'incoming_save_success' }>,
): ReactionOutcome {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  // Roll a new d20 for the reroll.
  const newRoll = rollDie(20);
  // Use the lower of the original and new rolls.
  const lowerRoll = Math.min(trigger.roll, newRoll);
  // Reconstruct the save total with the lower roll.
  // The original total = roll + mods. The new total = lowerRoll + mods.
  const saveMods = trigger.total - trigger.roll;
  const newTotal = lowerRoll + saveMods;
  // The save succeeds if total >= DC.
  const newSuccess = newTotal >= trigger.dc;

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: trigger.saver.id,
    description: `${caster.name} casts Silvery Barbs — ${trigger.saver.name} rerolls the save d20 (original ${trigger.roll} → new ${newRoll}, using ${lowerRoll}). Save ${newSuccess ? 'still succeeds' : 'now FAILS'} (${newTotal} vs DC ${trigger.dc})!`,
  });

  if (!newSuccess) {
    return { kind: 'negated', detail: `Silvery Barbs reroll (${newRoll}) flipped save success to failure` };
  }
  return { kind: 'failed', detail: `Silvery Barbs reroll (${newRoll}) did not flip the save` };
}

// ---- cleanup ------------------------------------------------
//
// No cleanup needed — Silvery Barbs is instantaneous.

export function cleanup(_caster: Combatant): void {
  // No-op — instantaneous spell.
}
