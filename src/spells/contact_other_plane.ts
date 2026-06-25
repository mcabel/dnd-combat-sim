// ============================================================
// Contact Other Plane — PHB p.226
//
// 5th-level divination (ritual), 1-MINUTE casting time, range self,
// duration 1 minute. Components: V.
//
// Effect: You mentally contact a demigod, the spirit of a long-dead sage,
//         or some other mysterious entity from another plane. You can ask
//         up to five questions.
//
// v1 status: OUT-OF-COMBAT — 1-minute cast time + divination with no
//   combat effect. shouldCast always returns null. Monsters with Contact
//   Other Plane will never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Contact Other Plane', level: 5, school: 'divination', rangeFt: 0,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,                            // 1-min cast + divination — never used in combat
  contactOtherPlaneOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 1-min cast + divination; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
