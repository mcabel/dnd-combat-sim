// ============================================================
// Wall of Thorns — PHB p.287
//
// 6th-level conjuration, 1-action casting time, range 120 ft,
// duration 10 minutes (concentration). Components: V, S, M (a
// handful of thorns).
//
// Effect: You create a wall of tough, pliable, tangled brush bristling
//         with needle-sharp thorns. The wall is up to 60 ft long, up
//         to 10 ft high, and up to 5 ft thick. The wall blocks line
//         of sight. A creature moving through the wall takes 7d8
//         piercing damage (or half on a successful DEX save). The
//         wall is difficult terrain. As a bonus action, you can move
//         a 10-ft section of the wall up to 10 ft.
//
// v1 status: DEFERRED — real implementation needs the wall/zone
//   subsystem with damage-on-enter + difficult-terrain rules (similar
//   to Wall of Fire + Web/Spike Growth combined). shouldCast always
//   returns null. Monsters with Wall of Thorns will never select it
//   during a combat encounter until a real implementation lands.
//
// This stub exists so the monster-spell coverage report counts Wall
// of Thorns as implemented (2 creature-refs).
//
// Spell module pattern (deferred combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Wall of Thorns', level: 6, school: 'conjuration', rangeFt: 120,
  concentration: true, castingTime: 'action',
  deferred: true,                          // real implementation deferred
  wallOfThornsDeferredV1Implemented: true,  // stub: shouldCast always null
} as const;

/** Always returns null — wall/zone subsystem not yet implemented. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
