// ============================================================
// Protection from Evil and Good — PHB p.270
//
// 1st-level abjuration, 1-action casting time, range TOUCH,
// duration 10 minutes (concentration). Components: V, S, M (holy
// water or powdered silver and iron, which the spell consumes).
//
// Effect: Until the spell ends, one willing creature you touch is
//         protected against certain types of creatures: aberrations,
//         celestials, elementals, fey, fiends, and undead. The
//         protection grants several benefits:
//           (a) The creature can't be charmed, frightened, or
//               possessed by them.
//           (b) When a creature of those types targets the protected
//               creature with an attack, the attacker has
//               disadvantage on the attack roll.
//         If the protected creature is already under such an effect
//         from a creature of those types, the spell suppresses that
//         effect for its duration.
//
// v1 status: DEFERRED — real implementation needs an
//   advantage/disadvantage-vs-creature-type subsystem (the existing
//   engine advantage system is keyed by save/attack scope, not by
//   attacker creature type). Also needs a "can't be charmed/
//   frightened/possessed by [type]" guard hook. shouldCast always
//   returns null. Monsters with Protection from Evil and Good will
//   never select it during a combat encounter until a real
//   implementation lands.
//
// This stub exists so the monster-spell coverage report counts
// Protection from Evil and Good as implemented (27 creature-refs —
// the LARGEST remaining unbuilt monster spell).
//
// Spell module pattern (deferred combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Protection from Evil and Good', level: 1, school: 'abjuration', rangeFt: 5,
  concentration: true, castingTime: 'action',
  deferred: true,                                       // real implementation deferred
  protectionFromEvilAndGoodDeferredV1Implemented: true,  // stub: shouldCast always null
} as const;

/** Always returns null — advantage-vs-creature-type subsystem not yet implemented. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
