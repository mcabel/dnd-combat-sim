// ============================================================
// Wish — PHB p.288
//
// 9th-level conjuration, action, range self, NO concentration (the stress
// effect lasts for a variable duration). Components: V.
//
// Effect: The mightiest spell. Basic uses (no stress):
//   - Duplicate any spell of L8 or lower (no components required)
//   - Create an object up to 25,000 gp
//   - Allow up to 20 creatures to gain advantage on a save (used in the
//     next 8 hours)
//   - Grant immunity to one spell for 8 hours
//   - etc.
// The "1-in-3 chance of losing Wish forever" is a roleplay concern, not
// combat — the spell isn't permanently lost in combat; it's lost on a
// long-rest basis if the caster used it for a non-duplicate use.
//
// v1 status: OUT-OF-COMBAT STUB. Wish is reality-bending and would need
//   every spell module to "duplicate any spell". The combat engine can't
//   meaningfully model this — the bestiary already lists specific spells
//   per monster (a Lich casts Power Word Kill or Time Stop directly, not
//   via Wish). The "duplicate any L8 spell" use case is better served by
//   having the monster cast the target spell directly.
//
//   shouldCast always returns null. Monsters with Wish will never select it
//   during a combat encounter.
//
// Spell module pattern (out-of-combat stub, mirrors raise_dead.ts/scrying.ts):
//   shouldCast(_caster, _bf) → Combatant | null  (always returns null)
//   execute(_caster, _state) → void              (no-op)
//   cleanup(_c) → void                           (no-op)
//
// TG-012 note: A full implementation would require:
//   - A "duplicate any spell" subsystem (an action that re-dispatches to any
//     other spell module's execute() at no slot cost)
//   - A stress-tracking subsystem (1-in-3 chance of losing Wish forever)
//   - An out-of-combat action system for the non-duplicate uses (create
//     object, grant immunity, etc.)
//   Deferred until TG-012 wish RFC is resolved.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

export const metadata = {
  name: 'Wish', level: 9, school: 'conjuration', rangeFt: 0,
  concentration: false, castingTime: 'action',
  outOfCombat: true,                          // stub: shouldCast always returns null
  wishDuplicateAnySpellV1Deferred: true,       // TG-012: duplicate-any-spell subsystem not built
  wishStressEffectV1NotModelled: true,         // 1-in-3 chance of losing Wish — roleplay concern
  wishOutOfCombatV1Implemented: true,          // stub: shouldCast always null
} as const;

/** Always returns null — Wish is deferred (duplicate-any-spell not built). */
export function shouldCast(_caster: Combatant, _bf: Battlefield): Combatant | null {
  return null;
}

/** Should never be called in combat; no-op if reached. */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
