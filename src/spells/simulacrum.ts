// ============================================================
// Simulacrum — PHB p.276
//
// 7th-level illusion, 12-HOUR casting time, range touch,
// permanent (until dispelled). Components: V, S, M (snow/ice + ruby worth 1500 gp).
//
// Effect: You shape an illusory duplicate of one beast or humanoid that is
//         within range for the entire casting time of the spell. The duplicate
//         is a creature, partially real and formed from ice or snow, and it
//         takes its statistics from the original at the time of casting.
//
// v1 status: OUT-OF-COMBAT — 12-hour cast time makes it unusable during
//   combat. A full implementation would require a creature-duplication
//   subsystem. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Simulacrum', level: 7, school: 'illusion', rangeFt: 5,
  concentration: false, castingTime: '12_hours',
  outOfCombat: true,                 // 12-hr cast — never used in combat
  simulacrumOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
