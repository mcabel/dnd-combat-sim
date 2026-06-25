// ============================================================
// Forbiddance — PHB p.243
//
// 6th-level abjuration (ritual), 10-MINUTE casting time, range touch,
// duration 1 day. Components: V, S, M (ruby dust worth 1000 gp, consumed).
//
// Effect: You create a ward against magical travel that protects up to
//         40,000 square feet of floor space. The ward is a 20-foot sphere.
//         Creatures can't teleport into the warded area.
//
// v1 status: OUT-OF-COMBAT — 10-min cast + area-ward with no combat effect
//   in v1 (no teleport-prevention subsystem). shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Forbiddance', level: 6, school: 'abjuration', rangeFt: 5,
  concentration: false, castingTime: '10_minutes',
  outOfCombat: true,                 // 10-min cast + area ward — never used in combat
  forbiddanceOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
