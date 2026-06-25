// ============================================================
// Clone — PHB p.222
//
// 8th-level necromancy, 1-HOUR casting time, range touch,
// instantaneous. Components: V, S, M (diamond worth 1000 gp + vessel).
//
// Effect: This spell grows an inert duplicate of a living creature as a
//         safeguard against death. If the original creature dies, the
//         clone immediately awakens.
//
// v1 status: OUT-OF-COMBAT — 1-hour cast time + death-safeguard with no
//   combat effect. A full implementation would require a clone-tracking
//   subsystem. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Clone', level: 8, school: 'necromancy', rangeFt: 5,
  concentration: false, castingTime: '1_hour',
  outOfCombat: true,            // 1-hr cast + death safeguard — never used in combat
  cloneOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
