// ============================================================
// Planar Ally — PHB p.265
//
// 6th-level conjuration, 10-MINUTE casting time, range 60 ft,
// instantaneous. Components: V, S.
//
// Effect: You utter a summoning incantation for otherworldly assistance.
//         A celestial, elemental, or fiend of appropriate challenge rating
//         appears.
//
// v1 status: OUT-OF-COMBAT — 10-min cast time makes it unusable during
//   combat. A full implementation would require a summon-negotiation
//   subsystem. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Planar Ally', level: 6, school: 'conjuration', rangeFt: 60,
  concentration: false, castingTime: '10_minutes',
  outOfCombat: true,                 // 10-min cast — never used in combat
  planarAllyOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
