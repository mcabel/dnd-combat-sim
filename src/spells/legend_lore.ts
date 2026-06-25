// ============================================================
// Legend Lore — PHB p.254
//
// 5th-level divination, 10-MINUTE casting time, range self,
// instantaneous. Components: V, S, M (incense worth 250 gp).
//
// Effect: Name or describe a person, place, or object that is familiar
//         to you. You bring to mind a brief summary of the significant
//         lore about the subject.
//
// v1 status: OUT-OF-COMBAT — 10-minute cast time makes it unusable during
//   combat. Receives lore with no combat effect. shouldCast always returns
//   null. Monsters with Legend Lore will never select it during a combat
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
  name: 'Legend Lore', level: 5, school: 'divination', rangeFt: 0,
  concentration: false, castingTime: '10_minutes',
  outOfCombat: true,                   // 10-min cast + divination — never used in combat
  legendLoreOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 10-min cast + divination; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
