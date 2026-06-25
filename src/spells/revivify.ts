// ============================================================
// Revivify — PHB p.272
//
// 3rd-level necromancy, 1-action casting time, range touch,
// instantaneous. Components: V, S, M (diamonds worth 300 gp, consumed).
//
// Effect: You touch a creature that has died within the last minute. That
//         creature returns to life with 1 hit point. This spell can't return
//         to life a creature that has died of old age, nor can it restore any
//         missing body parts.
//
// v1 status: OUT-OF-COMBAT — requires a "downed ally" tracking subsystem
//   that v1 does not have. The engine does not track which creatures died
//   within the last minute, nor does it model the 300-gp material cost.
//   shouldCast always returns null. Monsters with Revivify will never select
//   it during a combat encounter.
//
//   A full implementation would require (TG-011 resurrection RFC):
//   - A "downed ally within 1 round" tracker
//   - Material-component consumption (300 gp diamonds)
//   - A heal-to-1-HP mechanism (no penalties, unlike Raise Dead)
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
  name: 'Revivify', level: 3, school: 'necromancy', rangeFt: 5,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                     // requires downed-ally tracker — not in v1
  revivifyOutOfCombatV1Implemented: true, // stub: shouldCast always null
  revivifyResurrectionV1Implemented: false, // requires TG-011 resurrection RFC
} as const;

/** Always returns null — no downed-ally tracker in v1; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
