// ============================================================
// Locate Creature — PHB p.256
//
// 4th-level divination, 1-action casting time, range self,
// concentration (1 hour). Components: V, S, M (fur from a bloodhound).
//
// Effect: Describe or name a creature that is familiar to you. You sense the
//         direction to the creature's location, as long as it is within 1,000
//         feet of you. The spell can locate a specific creature known to you,
//         or the nearest creature of a specific kind.
//
// v1 status: OUT-OF-COMBAT — divination sense with no combat effect.
//   shouldCast always returns null. Monsters with Locate Creature will never
//   select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Locate Creature', level: 4, school: 'divination', rangeFt: 0,
  concentration: true, castingTime: 'action',
  outOfCombat: true,                          // divination sense — no combat effect
  locateCreatureOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — divination sense; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
