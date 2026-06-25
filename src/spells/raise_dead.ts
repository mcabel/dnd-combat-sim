// ============================================================
// Raise Dead — PHB p.258
//
// 5th-level necromancy, 1-hour casting time, range touch, NO concentration.
// Components: V, S, M (a diamond worth ≥500 gp, consumed).
//
// Effect: You restore life to a deceased creature. The creature returns to
// life with 1 hit point. The spell doesn't remove diseases/poisons/curses.
// Can't raise creatures dead > 10 days, undead, or creatures missing vital
// body parts.
//
// v1 status: OUT-OF-COMBAT — 1-hour casting time makes it unusable during
//   combat. shouldCast always returns false. Monsters with Raise Dead will
//   never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
//
// TG-011 note: A full implementation would require:
//   - A "downed PC" tracking subsystem (target a deceased party member)
//   - An out-of-combat action system (1-hour cast time)
//   - A heal-to-1-HP-with-penalties mechanism (PHB p.258: -4 to all attack
//     rolls, saves, ability checks until next long rest)
//   Deferred until TG-011 resurrection RFC is resolved.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Raise Dead', level: 5, school: 'necromancy', rangeFt: 5,
  concentration: false, castingTime: '1_hour',
  outOfCombat: true,                          // 1-hour cast time — never used in combat
  raiseDeadOutOfCombatV1Implemented: true,   // stub: shouldCast always false
} as const;

/** Always returns null — 1-hour cast time; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
