// ============================================================
// Feather Fall — PHB p.239
//
// 1st-level transmutation, reaction
// Trigger: You or a creature within 60 feet of you falls
// Range: 60 feet
// Duration: 1 minute (but only relevant for the fall — the effect
//           ends when the creature lands)
//
// Effect:
//   - Choose up to 5 falling creatures within range.
//   - Their rate of descent slows to 60 feet per round.
//   - They take NO damage from the fall.
//   - They land on their feet (no prone).
//   - No concentration.
//
// TG-008 implementation:
//   - `shouldCastReaction` / `executeReaction` are the trigger-aware
//     entry points consumed by the reaction registry.
//   - `executeReaction` returns `{ kind: 'negated' }` — the fall damage
//     is negated for all affected fallers. The engine's `processFallDamage`
//     checks the `_featherFallActive` flag on each faller and skips them.
//   - `cleanup` is a no-op — the effect ends when the creature lands
//     (which is the same combat event that triggered it).
//
// v1 simplifications:
//   - v1 only models fall damage from Reverse Gravity concentration
//     breaks (the only fall-damage source in the engine). Feather Fall
//     fires for ALL fallers in the `falling` trigger (up to 5).
//   - The "60 ft per round" descent rate is not modelled — v1 just
//     negates the fall damage entirely (the fallers land safely).
//   - The "land on your feet" (no prone) is not modelled — v1 doesn't
//     apply the prone condition on fall damage anyway.
//   - Range: v1 checks the FIRST faller's distance from the caster.
//     If the first faller is within 60 ft, all fallers are affected
//     (v1 simplification — PHB requires each target to be within range).
// ============================================================

import { Combatant, Battlefield, ReactionTrigger, ReactionOutcome } from '../types/core';
import { EngineState } from '../engine/combat';
import { consumeSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Feather Fall',
  level: 1,
  school: 'transmutation',
  rangeFt: 60,
  concentration: false,
  castingTime: 'reaction',
} as const;

/** Maximum number of falling creatures Feather Fall can affect (PHB p.239). */
const MAX_TARGETS = 5;

// ---- Trigger-aware shouldCast (TG-008) ----------------------

/**
 * Returns true if `caster` should cast Feather Fall in response to
 * `trigger`.
 *
 * Tactical rule (v1): cast whenever at least one faller is within 60 ft
 * and the fall height is > 0 (i.e., fall damage would be dealt).
 *
 * Future enhancement: gate on the fall damage severity (don't waste a
 * slot on a 10-ft fall for 1d6 damage; always cast on a 100-ft fall).
 */
export function shouldCastReaction(
  caster: Combatant,
  bf: Battlefield,
  trigger: ReactionTrigger,
): boolean {
  if (trigger.kind !== 'falling') return false;
  if (trigger.fallHeightFt <= 0) return false;
  if (trigger.fallerIds.length === 0) return false;

  // Check if at least one faller is within 60 ft of the caster.
  for (const id of trigger.fallerIds) {
    const faller = bf.combatants.get(id);
    if (!faller) continue;
    const dx = Math.abs(caster.pos.x - faller.pos.x);
    const dy = Math.abs(caster.pos.y - faller.pos.y);
    const dz = Math.abs(caster.pos.z - faller.pos.z);
    const distFt = Math.max(dx, dy, dz) * 5;
    if (distFt <= 60) return true;
  }
  return false;
}

// ---- Trigger-aware execute (TG-008) -------------------------

/**
 * Execute Feather Fall reaction. Marks up to 5 falling creatures within
 * 60 ft with `_featherFallActive = true`. The engine's `processFallDamage`
 * checks this flag and skips fall damage for marked creatures.
 *
 * Returns `{ kind: 'negated' }` — the fall damage is negated for all
 * affected fallers.
 */
export function executeReaction(
  caster: Combatant,
  state: EngineState,
  trigger: ReactionTrigger,
): ReactionOutcome {
  if (trigger.kind !== 'falling') return { kind: 'no_effect' };

  consumeSpellSlot(caster, 1);
  caster.budget.reactionUsed = true;

  const bf = state.battlefield;
  const affectedNames: string[] = [];
  let affected = 0;

  for (const id of trigger.fallerIds) {
    if (affected >= MAX_TARGETS) break;
    const faller = bf.combatants.get(id);
    if (!faller) continue;
    // Range check per-faller.
    const dx = Math.abs(caster.pos.x - faller.pos.x);
    const dy = Math.abs(caster.pos.y - faller.pos.y);
    const dz = Math.abs(caster.pos.z - faller.pos.z);
    const distFt = Math.max(dx, dy, dz) * 5;
    if (distFt > 60) continue;

    // Mark the faller — processFallDamage will skip them.
    (faller as any)._featherFallActive = true;
    affectedNames.push(faller.name);
    affected++;
  }

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    description: `${caster.name} casts Feather Fall — ${affected} creature${affected !== 1 ? 's' : ''} (${affectedNames.join(', ')}) take${affected === 1 ? 's' : ''} NO fall damage!`,
  });

  if (affected === 0) {
    // No fallers were in range — the slot is wasted (v1 simplification:
    // shouldCastReaction should have caught this, but guard anyway).
    return { kind: 'no_effect' };
  }

  return { kind: 'negated', detail: `Feather Fall negated fall damage for ${affected} creature(s)` };
}

// ---- cleanup ------------------------------------------------
//
// No cleanup needed — the `_featherFallActive` flag is consumed by
// `processFallDamage` immediately after the trigger fires. If the
// flag persists (e.g., the faller was already dead), it's harmless.

export function cleanup(_caster: Combatant): void {
  // No-op — instantaneous effect.
}
