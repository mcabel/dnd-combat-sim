// ============================================================
// Detect Magic — PHB p.231
//
// 1st-level divination (ritual), 1-action casting time, range self,
// concentration (10 min). Components: V, S.
//
// Effect: For the duration, you sense the presence of magic within 30 feet
//         of you. If you sense magic in this way, you can use your action to
//         see a faint aura around any visible creature or object that bears
//         magic.
//
// v1 status: OUT-OF-COMBAT — divination sense with no combat effect.
//   shouldCast always returns null. Monsters with Detect Magic will never
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
  name: 'Detect Magic', level: 1, school: 'divination', rangeFt: 0,
  concentration: true, castingTime: 'action',
  outOfCombat: true,                          // divination sense — no combat effect
  detectMagicOutOfCombatV1Implemented: true,  // stub: shouldCast always null
} as const;

/** Always returns null — divination sense; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
