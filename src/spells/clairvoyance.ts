// ============================================================
// Clairvoyance — PHB p.222
//
// 3rd-level divination, 10-MINUTE casting time, range 1 mile,
// concentration (10 min). Components: V, S, M (focus worth 100 gp).
//
// Effect: You create an invisible sensor within range in a location familiar
//         to you or in an obvious location that is not familiar to you. The
//         sensor remains in place for the duration and can't be attacked or
//         interacted with. You can use your action to see or hear through
//         the sensor.
//
// v1 status: OUT-OF-COMBAT — 10-minute cast time makes it unusable during
//   combat (would take 100 rounds). shouldCast always returns null. Monsters
//   with Clairvoyance will never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Clairvoyance', level: 3, school: 'divination', rangeFt: 5280,
  concentration: true, castingTime: '10_minutes',
  outOfCombat: true,                          // 10-min cast time — never used in combat
  clairvoyanceOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 10-min cast time; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
