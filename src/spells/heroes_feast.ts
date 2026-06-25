// ============================================================
// Heroes' Feast — PHB p.250
//
// 6th-level conjuration, 10-MINUTE casting time, range 30 ft,
// instantaneous. Components: V, S, M (gem-encrusted bowl worth 1000 gp, consumed).
//
// Effect: You bring forth a great feast, including magnificent food and
//         drink. The feast takes 1 hour to consume and disappears at the
//         end of that time. The beneficial effects don't set in until after
//         the hour is over. Creatures that partake gain immunity to poison
//         and frightened, are cured of all diseases and poison, and gain 2d10
//         max-HP-increase + healing of the same amount.
//
// v1 status: OUT-OF-COMBAT — 10-minute cast + 1-hour feast makes it
//   unusable during combat. shouldCast always returns null. Monsters with
//   Heroes' Feast will never select it during a combat encounter.
//
// Spell module pattern (out-of-combat stub):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: "Heroes' Feast", level: 6, school: 'conjuration', rangeFt: 30,
  concentration: false, castingTime: '10_minutes',
  outOfCombat: true,                      // 10-min cast + 1-hr feast — never used in combat
  heroesFeastOutOfCombatV1Implemented: true, // stub: shouldCast always null
} as const;

/** Always returns null — 10-min cast + 1-hr feast; never usable in combat. */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
