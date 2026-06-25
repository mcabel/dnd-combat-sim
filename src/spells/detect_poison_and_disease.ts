// ============================================================
// Detect Poison and Disease — PHB p.231
//
// 1st-level divination (ritual), 1-action casting time, range self,
// concentration (10 min). Components: V, S, M (yew leaf).
//
// Effect: For the duration, you can sense the presence and location of
//         poisons, poisonous creatures, and diseases within 30 feet of you.
//
// v1 status: OUT-OF-COMBAT — divination sense with no combat effect.
//   shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Detect Poison and Disease', level: 1, school: 'divination', rangeFt: 0,
  concentration: true, castingTime: 'action',
  outOfCombat: true,                            // divination sense — no combat effect
  detectPoisonAndDiseaseOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
