// ============================================================
// Comprehend Languages — PHB p.224
//
// 1st-level divination (ritual), 1-action casting time, range self,
// duration 1 hour (NO concentration). Components: V, S, M (pinch of soot/salt).
//
// Effect: For the duration, you understand the literal meaning of any spoken
//         language you hear. You also understand any written language you see.
//
// v1 status: OUT-OF-COMBAT — language understanding with no combat effect.
//   shouldCast always returns null. Monsters with Comprehend Languages will
//   never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Comprehend Languages', level: 1, school: 'divination', rangeFt: 0,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                                       // language understanding — no combat effect
  comprehendLanguagesOutOfCombatV1Implemented: true,       // stub: shouldCast always null
} as const;

/** Always returns null — language understanding; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
