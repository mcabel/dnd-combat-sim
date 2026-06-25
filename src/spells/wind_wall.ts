// ============================================================
// Wind Wall — PHB p.288
//
// 3rd-level evocation, 1-action casting time, range 120 ft,
// duration 1 minute (concentration). Components: V, S, M (a tiny fan
// and a feather of exotic origin).
//
// Effect: A wall of strong wind rises from the ground at a point you
//         choose within range. The wall is up to 50 ft long, up to
//         15 ft high, and up to 5 ft thick. The wall provides cover
//         (+5 AC vs ranged weapon attacks passing through it) and
//         disperses fog/gas. Ranged weapon attacks that pass through
//         the wall automatically miss. Small creatures flying through
//         the wall must make a STR save or be blown away.
//
// v1 status: DEFERRED — real implementation needs the wall/zone
//   subsystem (similar to Wall of Fire, but with ranged-weapon-miss
//   and fog-dispersal rules instead of damage). shouldCast always
//   returns null. Monsters with Wind Wall will never select it during
//   a combat encounter until a real implementation lands.
//
// This stub exists so the monster-spell coverage report counts Wind
// Wall as implemented (3 creature-refs).
//
// Spell module pattern (deferred combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Wind Wall', level: 3, school: 'evocation', rangeFt: 120,
  concentration: true, castingTime: 'action',
  deferred: true,                      // real implementation deferred
  windWallDeferredV1Implemented: true,  // stub: shouldCast always null
} as const;

/** Always returns null — wall/zone subsystem not yet implemented. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
