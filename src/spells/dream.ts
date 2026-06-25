// ============================================================
// Dream — PHB p.236
//
// 5th-level illusion, 1-MINUTE casting time, range special,
// duration 8 hours. Components: V, S, M (a handful of sand).
//
// Effect: This spell shapes a creature's dreams. You can choose a creature
//         known to you as the target of the spell. The target must be on
//         the same plane of existence as you.
//
// v1 status: OUT-OF-COMBAT — 1-minute cast time + dream-messenger with no
//   combat effect. shouldCast always returns null. Monsters with Dream
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
  name: 'Dream', level: 5, school: 'illusion', rangeFt: 0,
  concentration: false, castingTime: '1_minute',
  outOfCombat: true,             // 1-min cast + dream messenger — never used in combat
  dreamOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — dream messenger; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
