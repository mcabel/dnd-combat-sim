// ============================================================
// Longstrider — PHB p.256
//
// 1st-level transmutation, 1-action casting time, range touch,
// duration 1 hour (NO concentration). Components: V, S, M (dirt pit).
//
// Effect: You touch a creature. The target's speed increases by 10 feet
//         until the spell ends.
//
// v1 status: OUT-OF-COMBAT — movement speed buff. v1 does not model
//   out-of-combat movement speed buffs in a way that affects combat outcomes.
//   shouldCast always returns null. Monsters with Longstrider will never
//   select it during a combat encounter.
//
//   A full implementation would require:
//   - A persistent speed-buff effect (modify `speed` on the target)
//   - Duration tracking (1 hour)
//   Deferred.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Longstrider', level: 1, school: 'transmutation', rangeFt: 5,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                      // movement buff — v1 has no speed-buff effect
  longstriderOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — movement buff; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
