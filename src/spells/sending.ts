// ============================================================
// Sending — PHB p.274
//
// 3rd-level evocation, 1-action casting time, range UNLIMITED,
// duration 1 round (NO concentration). Components: V, S, M (copper wire).
//
// Effect: You send a short message of twenty-five words or less to a creature
//         you are familiar with. The creature hears the message in its mind
//         and can reply immediately.
//
// v1 status: OUT-OF-COMBAT — telepathic messaging with no combat effect.
//   shouldCast always returns null. Monsters with Sending will never select
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
  name: 'Sending', level: 3, school: 'evocation', rangeFt: 5280,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                    // telepathic message — no combat effect
  sendingOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — telepathic message; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
