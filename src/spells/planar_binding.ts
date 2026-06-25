// ============================================================
// Planar Binding — PHB p.265
//
// 5th-level abjuration, 1-HOUR casting time, range 60 ft,
// duration 24 hours. Components: V, S, M (jewel worth 200 gp, consumed).
//
// Effect: With this spell, you attempt to bind a celestial, elemental, fey,
//         or fiend to your service. The creature must be within range for
//         the entire casting time of the spell.
//
// v1 status: OUT-OF-COMBAT — 1-hour cast time makes it unusable during
//   combat. A full implementation would require a creature-binding subsystem.
//   shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Planar Binding', level: 5, school: 'abjuration', rangeFt: 60,
  concentration: false, castingTime: '1_hour',
  outOfCombat: true,                 // 1-hr cast — never used in combat
  planarBindingOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
