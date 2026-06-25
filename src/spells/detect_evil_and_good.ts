// ============================================================
// Detect Evil and Good — PHB p.231
//
// 1st-level divination, 1-action casting time, range self,
// concentration (10 min). Components: V, S.
//
// Effect: For the duration, you know if there is an aberration, celestial,
//         elemental, fey, fiend, or undead within 30 feet of you, as well
//         as where the creature is located. Likewise, you know if there is a
//         place or object within 30 feet of you that has been magically
//         consecrated or desecrated.
//
// v1 status: OUT-OF-COMBAT — divination sense with no combat effect.
//   shouldCast always returns null. Monsters with Detect Evil and Good will
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
  name: 'Detect Evil and Good', level: 1, school: 'divination', rangeFt: 0,
  concentration: true, castingTime: 'action',
  outOfCombat: true,                              // divination sense — no combat effect
  detectEvilAndGoodOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — divination sense; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
