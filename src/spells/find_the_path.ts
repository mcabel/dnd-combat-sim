// ============================================================
// Find the Path — PHB p.240
//
// 6th-level divination, 1-MINUTE casting time, range self,
// concentration (1 day). Components: V, S, M (set of divination tools).
//
// Effect: This spell allows you to find the shortest, most direct physical
//         route to a specific fixed location that you are familiar with.
//
// v1 status: OUT-OF-COMBAT — 1-min cast time + divination with no combat
//   effect. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Find the Path', level: 6, school: 'divination', rangeFt: 0,
  concentration: true, castingTime: '1_minute',
  outOfCombat: true,                    // 1-min cast + divination — never used in combat
  findThePathOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
