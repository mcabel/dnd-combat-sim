// ============================================================
// Programmed Illusion — PHB p.269
//
// 6th-level illusion, 1-action casting time, range 120 ft,
// permanent (until dispelled). Components: V, S, M (jade worth 25 gp).
//
// Effect: You create an illusion of an object, a creature, or some other
//         visible phenomenon within range that activates when a specific
//         condition occurs. The illusion is imperceptible until then.
//
// v1 status: OUT-OF-COMBAT — trigger-activated illusion trap. A full
//   implementation would require a complex condition-trigger subsystem +
//   illusion rendering. v1 has no such subsystem. shouldCast always
//   returns null. Monsters with Programmed Illusion will never select it
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
  name: 'Programmed Illusion', level: 6, school: 'illusion', rangeFt: 120,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                          // trigger-activated illusion — v1 has no such subsystem
  programmedIllusionOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — trigger-activated illusion; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
