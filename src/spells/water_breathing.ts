// ============================================================
// Water Breathing — PHB p.287
//
// 3rd-level transmutation (ritual), 1-action casting time, range 30 ft,
// duration 24 hours (NO concentration). Components: V, S, M (reed/straw).
//
// Effect: This spell grants up to ten willing creatures of your choice the
//         ability to breathe underwater until the spell ends.
//
// v1 status: OUT-OF-COMBAT — environmental buff with no combat effect (the
//   v1 engine does not model drowning). shouldCast always returns null.
//   Monsters with Water Breathing will never select it during a combat
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
  name: 'Water Breathing', level: 3, school: 'transmutation', rangeFt: 30,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                          // environmental buff — no combat effect (no drowning in v1)
  waterBreathingOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — environmental buff; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
