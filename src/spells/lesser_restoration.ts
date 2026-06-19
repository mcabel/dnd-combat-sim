// ============================================================
// Lesser Restoration — PHB p.255
//
// 2nd-level abjuration, action, range Touch, NO concentration.
// Duration: Instantaneous.   Components: V, S.
//
// Effect: You touch a creature and end either one disease or one condition
//         afflicting it. The condition can be blinded, deafened, paralyzed,
//         or poisoned.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - Instantaneous: no duration to track. The condition is removed
//     immediately on cast.
//   - Single condition: PHB p.255 says "one disease or one condition".
//     v1 removes ALL of blinded/deafened/paralyzed/poisoned from the target
//     (a v1 simplification — more powerful than canon, but avoids the need
//     for the caster to pick which condition to remove). Forward-compat
//     TODO via the metadata flag
//     `lesserRestorationSingleConditionV1Simplified: true`.
//   - Disease: v1 does NOT model diseases (no disease-tracking subsystem).
//     Forward-compat TODO via the metadata flag
//     `lesserRestorationDiseaseV1Implemented: false`.
//   - NOT a concentration spell (PHB p.255: instantaneous).
//
// Spell module pattern (mirrors Calm Emotions's direct-removal approach):
//   shouldCast(caster, bf) → Combatant | null
//   execute(caster, target, state) → void
//   cleanup() — no-op (instantaneous)
// ============================================================

import { Combatant, Battlefield, Condition } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Lesser Restoration',
  level: 2,
  school: 'abjuration',
  rangeFt: 5,       // touch
  concentration: false,
  castingTime: 'action',
  // Conditions Lesser Restoration can end (PHB p.255).
  removableConditions: ['blinded', 'deafened', 'paralyzed', 'poisoned'] as Condition[],
  lesserRestorationSingleConditionV1Simplified: true,   // removes ALL listed conditions (canon: one)
  lesserRestorationDiseaseV1Implemented: false,         // diseases NOT modelled
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- Planner ------------------------------------------------

/**
 * Returns the single best target for Lesser Restoration (a living ally
 * within touch range afflicted by at least one removable condition), or
 * null when the spell should not be cast.
 *
 * Target priority:
 *   1. Self (caster) — if afflicted.
 *   2. Lowest-HP% ally within 5 ft afflicted by a removable condition
 *      (most vulnerable benefits most from condition removal).
 *
 * Preconditions:
 *   - Caster has 'Lesser Restoration' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 valid ally target exists within 5 ft with a removable condition
 *     (blinded, deafened, paralyzed, or poisoned)
 *
 * Note: Lesser Restoration is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  if (!caster.actions.some(a => a.name === 'Lesser Restoration')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

  const candidates: Array<{ c: Combatant; hpPct: number; dist: number }> = [];

  for (const c of bf.combatants.values()) {
    if (c.isDead || c.isUnconscious) continue;
    if (c.faction !== caster.faction) continue;

    const distFt = chebyshev3D(caster.pos, c.pos) * 5;
    if (distFt > 5) continue;

    // Must have at least one removable condition.
    const hasRemovable = metadata.removableConditions.some(cond => c.conditions.has(cond));
    if (!hasRemovable) continue;

    candidates.push({ c, hpPct: c.currentHP / c.maxHP, dist: distFt });
  }

  if (candidates.length === 0) return null;

  // Sort: self first, then lowest HP%, then closest.
  candidates.sort((a, b) => {
    const aSelf = a.c.id === caster.id ? 0 : 1;
    const bSelf = b.c.id === caster.id ? 0 : 1;
    if (aSelf !== bSelf) return aSelf - bSelf;
    if (Math.abs(a.hpPct - b.hpPct) > 0.01) return a.hpPct - b.hpPct;
    return a.dist - b.dist;
  });

  return candidates[0].c;
}

// ---- Execution ----------------------------------------------

/**
 * Execute Lesser Restoration:
 *  1. Consume a 2nd-level spell slot.
 *  2. Remove ALL of blinded/deafened/paralyzed/poisoned from the target
 *     (v1 simplification — canon removes only ONE condition; v1 removes
 *     all for simplicity).
 *  3. Log each removed condition.
 *
 * v1 simplifications: removes all listed conditions (canon: one); diseases
 * NOT modelled; NOT concentration.
 */
export function execute(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Lesser Restoration on ${target.name}!`,
    target.id,
  );

  if (target.isDead || target.isUnconscious) return;

  let removedAny = false;
  for (const cond of metadata.removableConditions) {
    if (target.conditions.has(cond)) {
      target.conditions.delete(cond);
      removedAny = true;
      emit(
        state, 'condition_remove', caster.id,
        `${target.name}'s ${cond} condition is ended by Lesser Restoration!`,
        target.id,
      );
    }
  }

  if (!removedAny) {
    // Defensive: shouldCast filtered for removable conditions, but the
    // condition may have been removed between plan and execute.
    emit(
      state, 'action', caster.id,
      `${target.name} has no removable conditions (stale plan).`,
      target.id,
    );
  }
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell.
}
