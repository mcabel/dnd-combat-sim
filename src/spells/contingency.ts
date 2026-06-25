// ============================================================
// Contingency — PHB p.227
//
// 6th-level evocation, 10-MINUTE casting time, range self,
// duration 10 days. Components: V, S, M (statuette of self worth 1500 gp).
//
// Effect: Choose a spell of 5th level or lower that you can cast, that has
//         a casting time of 1 action, and that targets you. You cast that
//         spell — called the contingent spell — as part of casting contingency.
//         The contingent spell takes effect when a trigger occurs.
//
// v1 status: OUT-OF-COMBAT — 10-min cast time + conditional-spell trigger
//   subsystem. A full implementation would require a complex event-trigger
//   subsystem. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Contingency', level: 6, school: 'evocation', rangeFt: 0,
  concentration: false, castingTime: '10_minutes',
  outOfCombat: true,                 // 10-min cast + trigger subsystem — never used in combat
  contingencyOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
