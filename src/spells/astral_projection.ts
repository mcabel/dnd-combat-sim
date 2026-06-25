// ============================================================
// Astral Projection — PHB p.215
//
// 9th-level necromancy, 1-HOUR casting time, range 10 ft,
// special duration. Components: V, S, M (for each creature: a jacinth
// worth 1000 gp + a silver bar worth 100 gp).
//
// Effect: You and up to eight willing creatures can project your astral
//         bodies from your physical bodies onto the Astral Plane.
//
// v1 status: OUT-OF-COMBAT — 1-hour cast time makes it unusable during
//   combat. Projects astral bodies with no combat effect on the encounter.
//   shouldCast always returns null.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Astral Projection', level: 9, school: 'necromancy', rangeFt: 10,
  concentration: false, castingTime: '1_hour',
  outOfCombat: true,                          // 1-hr cast — never used in combat
  astralProjectionOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
