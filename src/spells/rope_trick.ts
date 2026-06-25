// ============================================================
// Rope Trick — PHB p.272
//
// 2nd-level transmutation, 1-action casting time, range touch,
// duration 1 hour. Components: V, S, M (powdered corn extract + twisted rope).
//
// Effect: You touch a length of rope that is up to 60 feet long. One end of
//         the rope then rises into the air until the whole rope hangs
//         perpendicular to the ground. At the upper end of the rope, an
//         invisible entrance opens to an extradimensional space.
//
// v1 status: OUT-OF-COMBAT — v1 does not model extradimensional hiding
//   spaces. A full implementation would require a hideout subsystem.
//   shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Rope Trick', level: 2, school: 'transmutation', rangeFt: 5,
  concentration: false, castingTime: 'action',
  outOfCombat: true,             // no extradimensional hideout subsystem in v1
  ropeTrickOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
