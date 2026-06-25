// ============================================================
// Arcane Eye — PHB p.214
//
// 4th-level divination, 1-action casting time, range 30 ft,
// concentration (1 hour). Components: V, S, M (bit of bat fur).
//
// Effect: You create an invisible, magical eye within range that hovers in
//         the air for the duration. You mentally receive visual information
//         from the eye, which has normal vision and darkvision out to 30 feet.
//
// v1 status: OUT-OF-COMBAT — remote-vision divination sensor with no combat
//   effect. A full implementation would require the vision subsystem
//   (TG-010: extend computeLOS for remote sight). shouldCast always returns
//   null. Monsters with Arcane Eye will never select it during a combat
//   encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Arcane Eye', level: 4, school: 'divination', rangeFt: 30,
  concentration: true, castingTime: 'action',
  outOfCombat: true,                      // remote-vision sensor — no combat effect
  arcaneEyeOutOfCombatV1Implemented: true, // stub: shouldCast always null
  arcaneEyeVisionSubsystemV1Implemented: false, // requires TG-010 vision subsystem
} as const;

/** Always returns null — remote-vision sensor; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
