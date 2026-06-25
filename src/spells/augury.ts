// ============================================================
// Augury — PHB p.215
//
// 2nd-level divination (ritual), 1-MINUTE casting time, range self,
// instantaneous. Components: V, S, M (marked sticks/bones worth 25 gp).
//
// Effect: By casting gem-inlaid sticks, rolling dragon bones, or unfolding
//         specially marked leaves, you receive an omen from an otherworldly
//         entity about the results of a specific course of action that you
//         plan to take within the next 30 minutes.
//
// v1 status: OUT-OF-COMBAT — 1-minute cast time makes it unusable during
//   combat (would take 10 rounds). Receives an omen with no combat effect.
//   shouldCast always returns null. Monsters with Augury will never select
//   it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Augury', level: 2, school: 'divination', rangeFt: 0,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,                  // 1-min cast + omen — never used in combat
  auguryOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 1-min cast + omen; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
