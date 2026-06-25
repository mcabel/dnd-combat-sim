// ============================================================
// Tongues — PHB p.283
//
// 3rd-level divination, 1-action casting time, range touch,
// duration 1 hour (NO concentration). Components: V, M (clay ziggurat).
//
// Effect: This spell grants the creature you touch the ability to understand
//         any spoken language it hears for the duration.
//
// v1 status: OUT-OF-COMBAT — language understanding with no combat effect.
//   shouldCast always returns null. Monsters with Tongues will never select
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
  name: 'Tongues', level: 3, school: 'divination', rangeFt: 5,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                  // language understanding — no combat effect
  tonguesOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — language understanding; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
