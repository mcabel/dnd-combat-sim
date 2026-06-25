// ============================================================
// Commune — PHB p.223
//
// 5th-level divination (ritual), 1-MINUTE casting time, range self,
// duration 1 minute. Components: V, S, M (incense, vellum, holy water).
//
// Effect: You contact your deity or a divine proxy and ask up to three
//         questions that can be answered with a yes or no. You must ask
//         the questions before the spell ends.
//
// v1 status: OUT-OF-COMBAT — 1-minute cast time makes it unusable during
//   combat. Receives yes/no answers with no combat effect. shouldCast
//   always returns null. Monsters with Commune will never select it
//   during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Commune', level: 5, school: 'divination', rangeFt: 0,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,                // 1-min cast + divination — never used in combat
  communeOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 1-min cast + divination; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
