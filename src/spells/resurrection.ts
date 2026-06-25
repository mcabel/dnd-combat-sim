// ============================================================
// Resurrection — PHB p.272
//
// 7th-level necromancy, 1-HOUR casting time, range touch,
// instantaneous. Components: V, S, M (diamond worth 1000 gp, consumed).
//
// Effect: You touch a dead creature that has been dead for no more than a
//         century, that didn't die of old age, and that isn't undead. The
//         creature returns to life with all its hit points.
//
// v1 status: OUT-OF-COMBAT — 1-hour cast time makes it unusable during
//   combat. A full implementation would require a downed-ally tracker +
//   material-component consumption (TG-011 resurrection RFC). shouldCast
//   always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Resurrection', level: 7, school: 'necromancy', rangeFt: 5,
  concentration: false, castingTime: '1_hour',
  outOfCombat: true,                     // 1-hr cast — never used in combat
  resurrectionOutOfCombatV1Implemented: true,
  resurrectionResurrectionV1Implemented: false, // requires TG-011 resurrection RFC
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
