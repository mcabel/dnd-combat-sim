// ============================================================
// Water Walk — PHB p.287
//
// 3rd-level transmutation (ritual), 1-action casting time, range 30 ft,
// duration 1 hour (NO concentration). Components: V, S, M (piece of cork).
//
// Effect: This spell grants the ability to move across any liquid surface —
//         such as water, acid, mud, snow, quicksand, or lava — as if it were
//         solid ground.
//
// v1 status: OUT-OF-COMBAT — environmental buff with no combat effect (v1
//   does not model liquid terrain). shouldCast always returns null. Monsters
//   with Water Walk will never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Water Walk', level: 3, school: 'transmutation', rangeFt: 30,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                   // environmental buff — no liquid terrain in v1
  waterWalkOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — environmental buff; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
