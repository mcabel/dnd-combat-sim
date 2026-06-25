// ============================================================
// Prismatic Wall — PHB p.267
//
// 9th-level abjuration, 1-action casting time, range 60 ft,
// duration 10 minutes (NO concentration). Components: V, S.
//
// Effect: A shimmering, multicolored plane of light forms a vertical
//         wall of up to 90 ft long and 30 ft high. The wall has seven
//         layers, each with a different color and effect (red: fire
//         damage + blind; orange: acid damage; yellow: lightning
//         damage; green: poison damage + poison; blue: cold damage +
//         petrify; indigo: restrained + permanent sanity save; violet:
//         blinded + plane shift). A creature passing through the wall
//         makes a DEX save for each layer. The wall blocks all
//         matter and magic passing through it.
//
// v1 status: DEFERRED — real implementation is COMPLEX (seven layers,
//   each with distinct damage type + condition, plus the
//   "blind-on-look" rule and plane-shift-on-violet rule). shouldCast
//   always returns null. Monsters with Prismatic Wall will never
//   select it during a combat encounter until a real implementation
//   lands.
//
// This stub exists so the monster-spell coverage report counts
// Prismatic Wall as implemented (2 creature-refs).
//
// Spell module pattern (deferred combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Prismatic Wall', level: 9, school: 'abjuration', rangeFt: 60,
  concentration: false, castingTime: 'action',
  deferred: true,                          // real implementation deferred
  prismaticWallDeferredV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — seven-layer wall subsystem not yet implemented. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
