// ============================================================
// True Seeing — PHB p.284
//
// 6th-level divination, 1-action casting time, range touch,
// duration 1 hour (NO concentration). Components: V, S, M (ointment 25 gp, consumed).
//
// Effect: This spell gives the willing creature you touch the ability to see
//         things as they actually are. For the duration, the creature has
//         truesight, notices secret doors hidden by magic, and can see into
//         the Ethereal Plane, all out to a range of 120 feet.
//
// v1 status: OUT-OF-COMBAT — truesight buff. v1 does not model illusions,
//   invisibility, or the Ethereal Plane heavily enough for this to have a
//   meaningful combat effect. shouldCast always returns null. Monsters with
//   True Seeing will never select it during a combat encounter.
//
//   A full implementation would require:
//   - A "truesight" condition that bypasses invisible/disguised/illusion
//   - Integration with the vision subsystem (TG-010)
//   - Ethereal Plane interaction (RFC-VISION-AUDIO Phase 4)
//   Deferred.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'True Seeing', level: 6, school: 'divination', rangeFt: 5,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                       // truesight buff — v1 has no illusions/invisibility to bypass
  trueSeeingOutOfCombatV1Implemented: true, // stub: shouldCast always null
  trueSeeingTruesightV1Implemented: false,  // requires vision subsystem (TG-010)
} as const;

/** Always returns null — truesight buff; no meaningful v1 combat effect. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
