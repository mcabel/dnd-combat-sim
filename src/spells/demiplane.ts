// ============================================================
// Demiplane — PHB p.231
//
// 8th-level conjuration, 1-action casting time, range 60 ft,
// duration 1 hour. Components: S.
//
// Effect: You create a shadowy door on a flat solid surface that you can
//         see within range. The door is large enough for Medium creatures
//         to pass through unhindered. When opened, the door leads to a
//         demiplane.
//
// v1 status: OUT-OF-COMBAT — v1 does not model extradimensional spaces.
//   A full implementation would require a demiplane-tracking subsystem.
//   shouldCast always returns null.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Demiplane', level: 8, school: 'conjuration', rangeFt: 60,
  concentration: false, castingTime: 'action',
  outOfCombat: true,             // no extradimensional-space subsystem in v1
  demiplaneOutOfCombatV1Implemented: true,
} as const;

export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
