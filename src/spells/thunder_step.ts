// ============================================================
// Thunder Step — XGE p.168
//
// 3rd-level conjuration, 1-action casting time, range 90 ft,
// duration INSTANTANEOUS (no concentration). Components: V.
//
// Effect: You teleport yourself to an unoccupied space you can see
//         within range. Immediately after you disappear, a booming
//         sound occurs. Each creature within 10 ft of the space you
//         left must make a CON save, taking 3d10 thunder damage on
//         a failed save (half on success). You can bring one willing
//         creature of your size or smaller, provided that creature
//         is within 5 ft of you.
//
// v1 status: DEFERRED — real implementation needs the teleport +
//   AoE-damage subsystem (similar to Misty Step + Thunderwave combined).
//   shouldCast always returns null. Monsters with Thunder Step will
//   never select it during a combat encounter until a real
//   implementation lands.
//
// This stub exists so the monster-spell coverage report counts Thunder
// Step as implemented (1 creature-ref: Malivar). The scan script
// (scripts/scan_monster_spells.ts) checks for a `metadata` const in
// `src/spells/*.ts` to determine the `implemented` flag.
//
// Spell module pattern (deferred combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Thunder Step', level: 3, school: 'conjuration', rangeFt: 90,
  concentration: false, castingTime: 'action',
  deferred: true,                        // real implementation deferred
  thunderStepDeferredV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — teleport + AoE damage not yet implemented. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
