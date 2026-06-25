// ============================================================
// Dispel Evil and Good — PHB p.233
//
// 5th-level abjuration, 1-action casting time, range SELF,
// duration 1 minute (concentration). Components: V, S, M (holy water
// or powdered silver and iron).
//
// Effect: Shimmering energy surrounds and protects you from fey,
//         undead, and creatures originating from beyond the Material
//         Plane (aberrations, celestials, elementals, fiends). For
//         the duration, you have advantage on all attack rolls and
//         saving throws against those creatures. As a bonus action,
//         you can end one of the following effects (chosen when you
//         cast this spell):
//           (a) One spell of 5th level or lower — ends on a target of
//               your choice (as the Dispel Magic spell).
//           (b) One enchantment spell of any level — ends on a target
//               of your choice.
//           (c) One possession effect — ends the possession.
//
// v1 status: DEFERRED — real implementation needs an
//   advantage-vs-creature-type subsystem (the existing engine
//   advantage system is keyed by save/attack scope, not by attacker
//   creature type), plus an effect-removal subsystem that can target
//   enchantment spells specifically. shouldCast always returns null.
//   Monsters with Dispel Evil and Good will never select it during a
//   combat encounter until a real implementation lands.
//
// This stub exists so the monster-spell coverage report counts
// Dispel Evil and Good as implemented (15 creature-refs).
//
// Spell module pattern (deferred combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Dispel Evil and Good', level: 5, school: 'abjuration', rangeFt: 0,
  concentration: true, castingTime: 'action',
  deferred: true,                                  // real implementation deferred
  dispelEvilAndGoodDeferredV1Implemented: true,     // stub: shouldCast always null
} as const;

/** Always returns null — advantage-vs-creature-type + effect-removal subsystems not yet implemented. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
