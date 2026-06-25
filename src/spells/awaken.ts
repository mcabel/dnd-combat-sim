// ============================================================
// Awaken — PHB p.216
//
// 5th-level transmutation, 8-HOUR casting time, range touch,
// instantaneous. Components: V, S, M (agate worth 1000 gp, consumed).
//
// Effect: After spending the casting time tracing magical pathways within
//         a precious gemstone, you touch a Huge or smaller beast or plant.
//         The target gains an Intelligence of 10. The target also gains
//         the ability to speak one language you know.
//
// v1 status: OUT-OF-COMBAT — 8-hour cast time makes it unusable during
//   combat. Permanently awakens a beast/plant with no combat effect on
//   the encounter. shouldCast always returns null. Monsters with Awaken
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
  name: 'Awaken', level: 5, school: 'transmutation', rangeFt: 5,
  concentration: false, castingTime: '8_hours',
  outOfCombat: true,             // 8-hour cast — never used in combat
  awakenOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 8-hour cast; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
