// ============================================================
// Gentle Repose — PHB p.245
//
// 2nd-level necromancy (ritual), 1-action casting time, range touch,
// duration 10 days (NO concentration). Components: V, S, M (copper piece).
//
// Effect: You touch a corpse or other remains. For the duration, the target
//         is protected from decay and can't become undead.
//
// v1 status: OUT-OF-COMBAT — corpse preservation with no combat effect.
//   v1 does not model corpse decay or undead creation from corpses.
//   shouldCast always returns null. Monsters with Gentle Repose will never
//   select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Gentle Repose', level: 2, school: 'necromancy', rangeFt: 5,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                    // corpse preservation — no combat effect
  gentleReposeOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — corpse preservation; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
