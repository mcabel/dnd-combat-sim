// ============================================================
// Imprisonment — PHB p.252
//
// 9th-level abjuration, 1-MINUTE casting time, range 30 ft,
// permanent (until dispelled). Components: V, S, M (varies by variant).
//
// Effect: You create a magical restraint to hold a creature that you can
//         see within range. The target must succeed on a WIS saving throw
//         or be bound by the spell. Choose one of the following forms of
//         imprisonment: Burial, Chaining, Hedged Prison, Minimus Containment,
//         or Slumber.
//
// v1 status: OUT-OF-COMBAT — 1-minute cast time (10 rounds) makes it
//   unusable during combat. A full implementation would also require a
//   WIS save + permanent removal subsystem. shouldCast always returns
//   null. Monsters with Imprisonment will never select it during a combat
//   encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Imprisonment', level: 9, school: 'abjuration', rangeFt: 30,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,                   // 1-min cast — never used in combat
  imprisonmentOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 1-min cast; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
