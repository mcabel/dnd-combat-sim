// ============================================================
// Locate Animals or Plants — PHB p.256
//
// 2nd-level divination (ritual), 1-action casting time, range self,
// instantaneous. Components: V, S, M (fur from a bloodhound).
//
// Effect: Describe or name a specific kind of beast or plant. Concentrating
//         on the voice of nature in your surroundings, you learn the
//         direction and distance to the closest creature of that kind within
//         5 miles, if any are present.
//
// v1 status: OUT-OF-COMBAT — divination sense with no combat effect.
//   shouldCast always returns null. Monsters with Locate Animals or Plants
//   will never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Locate Animals or Plants', level: 2, school: 'divination', rangeFt: 0,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                              // divination sense — no combat effect
  locateAnimalsOrPlantsOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — divination sense; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
