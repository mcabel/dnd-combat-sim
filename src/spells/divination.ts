// ============================================================
// Divination — PHB p.234
//
// 4th-level divination (ritual), 1-action casting time, range self,
// instantaneous. Components: V, S, M (incense + offering worth 25 gp, consumed).
//
// Effect: Your magic and an offering put you in contact with a god or a god's
//         servants. You ask a single question concerning a specific goal,
//         event, or activity to occur within 7 days. The DM offers a truthful
//         reply, which might be a short phrase, cryptic rhyme, or omen.
//
// v1 status: OUT-OF-COMBAT — receives an omen about a course of action with
//   no combat effect. shouldCast always returns null. Monsters with Divination
//   will never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Divination', level: 4, school: 'divination', rangeFt: 0,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                      // receives omen — no combat effect
  divinationOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — receives omen; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
