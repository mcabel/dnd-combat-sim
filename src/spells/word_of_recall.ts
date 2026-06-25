// ============================================================
// Word of Recall — PHB p.289
//
// 6th-level conjuration, 1-action casting time, range 5 ft,
// instantaneous. Components: V.
//
// Effect: You and up to five willing creatures within 5 feet of you
//         instantly teleport to a previously designated sanctuary.
//
// v1 status: OUT-OF-COMBAT — v1 does not model sanctuary designations.
//   A full implementation would require a sanctuary-tracking subsystem.
//   shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Word of Recall', level: 6, school: 'conjuration', rangeFt: 5,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                       // no sanctuary tracker in v1
  wordOfRecallOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
