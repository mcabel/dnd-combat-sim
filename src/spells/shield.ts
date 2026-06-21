// ============================================================
// Shield — PHB p.275
//
// 1st-level abjuration, reaction
// Trigger: Being hit by an attack or targeted by Magic Missile
// Range: Self
// Duration: 1 round (until start of your next turn)
//
// Effect: +5 bonus to AC, including against the triggering attack.
//         No damage from Magic Missile.
//         No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the NEW trigger-aware
//     entry points consumed by the reaction registry. `executeReaction`
//     returns `{ kind: 'negated' }` when the +5 AC flips the hit to a
//     miss; the engine then re-evaluates `hits` and skips damage.
//   - `shouldCast` / `execute` are the LEGACY entry points retained for
//     backwards compatibility (the unreachable `case 'shield':` dispatch
//     in combat.ts and any external callers). They are NOT called by the
//     reactive trigger path.
//   - `cleanup` is unchanged — called by `resetBudget` at start of the
//     caster's next turn to remove the +5 AC effect.
//
// v1 simplifications:
//   - Magic Missile blocking is NOT implemented (Magic Missile auto-hits
//     via the `action.hitBonus === null` branch in resolveAttack, which
//     bypasses the hit decision where Shield fires). A future enhancement
//     would add a separate "targeted by Magic Missile" trigger.
//   - Shield's `shouldCastReaction` only fires when +5 AC WILL flip the
//     hit to a miss (tactically optimal — never wastes a slot). A human
//     player might cast Shield even when it won't flip the hit, just for
//     the round-long +5 AC; the AI is stricter.
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shield',
  level: 1,
  school: 'abjuration',
  rangeFt: 0,           // self
  concentration: false,
  castingTime: 'reaction',
} as const;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Shield in response to `trigger`.
 *
 * Tactical rule (v1): only cast when the +5 AC WILL flip the hit to a
 * miss. This avoids wasting a spell slot when Shield wouldn't help.
 *
 * PHB p.275: "Reaction: When you are hit by an attack or targeted by
 * Magic Missile." v1 handles only the "hit by an attack" trigger.
 */
export function shouldCastReaction(
  caster: Combatant,
  _bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind !== 'incoming_attack_hit') return false;
  // Only worth casting if the +5 AC flips the hit to a miss.
  // If attackTotal >= effectiveAC + 5, the attack still hits even with
  // Shield — wasting the slot. (A human might still cast for the round-
  // long +5, but the AI is stricter.)
  if (trigger.attackTotal >= trigger.effectiveAC + 5) return false;
  // Don't cast Shield against ourselves (shouldn't happen, but guard).
  if (trigger.attacker.id === caster.id) return false;
  // Already under Shield? No benefit to recasting.
  const alreadyActive = caster.activeEffects.some((e: any) => e.spellName === 'Shield');
  if (alreadyActive) return false;
  return true;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Shield reaction. Returns `{ kind: 'negated' }` — the engine
 * will re-evaluate `hits` with the new +5 AC and skip damage if the
 * attack now misses.
 *
 * PHB p.275: "+5 bonus to AC, including against the triggering attack."
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind !== 'incoming_attack_hit') return { kind: 'no_effect' };

  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Shield',
    effectType: 'ac_bonus',
    payload: { acBonus: 5 },
    sourceIsConcentration: false,
  });

  const triggerName = trigger.action.name;
  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    targetId: trigger.attacker.id,
    description: `${caster.name} casts Shield (+5 AC, negates ${triggerName} hit — ${trigger.attackTotal} vs AC ${trigger.effectiveAC}+5=${trigger.effectiveAC + 5})!`,
  });

  // The +5 AC may or may not flip the hit to a miss — but we already
  // gated in shouldCastReaction on the flip happening, so we can safely
  // report 'negated'. The engine will re-evaluate hits and skip damage
  // if the new AC exceeds attackTotal.
  return { kind: 'negated', detail: 'Shield +5 AC may flip hit to miss' };
}

// ---- Legacy shouldCast (backwards compat) -------------------
//
// Retained for the unreachable `case 'shield':` dispatch in combat.ts
// and any external callers. NOT called by the reactive trigger path.

/**
 * @deprecated Use `shouldCastReaction` for the reactive trigger path.
 * Returns true if `caster` COULD cast Shield (slot available, reaction
 * unused, spell known, not already active). Does NOT consider tactical
 * value — always returns true if preconditions are met.
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  if (!caster.actions.some(a => a.name === 'Shield')) return false;
  if (!hasSpellSlot(caster, 1)) return false;
  if (caster.budget.reactionUsed) return false;

  const alreadyActive = caster.activeEffects.some((e: any) => e.spellName === 'Shield');
  if (alreadyActive) return false;

  return true;
}

// ---- Legacy execute (backwards compat) ----------------------
//
// Retained for the `case 'shield':` dispatch in combat.ts (currently
// unreachable from the planner, but kept for manual/test invocation).

/**
 * @deprecated Use `executeReaction` for the reactive trigger path.
 */
export function execute(caster: Combatant, state: EngineState, triggeringAttackName?: string): void {
  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Shield',
    effectType: 'ac_bonus',
    payload: { acBonus: 5 },
    sourceIsConcentration: false,
  });

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    description: `${caster.name} casts Shield (+5 AC until start of next turn)${triggeringAttackName ? ` vs ${triggeringAttackName}` : ''}!`,
  });
}

// ---- cleanup ------------------------------------------------

/**
 * Remove Shield effect at the start of the caster's next turn.
 * Called by resetBudget in utils.ts.
 */
export function cleanup(caster: Combatant): void {
  caster.activeEffects = caster.activeEffects.filter((e: any) => e.spellName !== 'Shield');
}
