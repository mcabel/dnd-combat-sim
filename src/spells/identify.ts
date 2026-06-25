// ============================================================
// Identify — PHB p.252
//
// 1st-level divination (ritual), 1-MINUTE casting time, range touch,
// instantaneous. Components: V, S, M (pearl worth 100 gp + owl feather).
//
// Effect: You choose one object that you must touch throughout the casting.
//         If it is a magic item or some other magic-imbued object, you learn
//         its properties and how to use them.
//
// v1 status: OUT-OF-COMBAT — 1-minute cast time makes it unusable during
//   combat (would take 10 rounds). shouldCast always returns null. Monsters
//   with Identify will never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Identify', level: 1, school: 'divination', rangeFt: 5,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,                       // 1-min cast time — never used in combat
  identifyOutOfCombatV1Implemented: true,  // stub: shouldCast always null
} as const;

/** Always returns null — 1-min cast time; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
