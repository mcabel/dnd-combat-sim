// ============================================================
// Telepathy — PHB p.281
//
// 8th-level evocation, 1-action casting time, range unlimited,
// duration 24 hours. Components: V, S, M (a pair of linked silver rings).
//
// Effect: You create a telepathic link with one willing creature you can
//         see within range. For the duration, you and the target can
//         communicate telepathically.
//
// v1 status: OUT-OF-COMBAT — telepathic communication with no combat effect
//   in v1. shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Telepathy', level: 8, school: 'evocation', rangeFt: 5280,
  concentration: false, castingTime: 'action',
  outOfCombat: true,             // telepathic communication — no combat effect
  telepathyOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
