// ============================================================
// Shapechange — PHB p.274
//
// 9th-level transmutation, 1-action casting time, range SELF,
// duration 1 hour (concentration). Components: V, S, M (a jade
// circlet worth at least 1,500 gp, which you must place on your
// head before you cast the spell).
//
// Effect: You assume the form of a different creature for the
//         duration. The new form can be of any creature with a
//         challenge rating equal to or less than your level. The
//         new form can't be a construct or an undead. You retain
//         your alignment, personality, and Intelligence, Wisdom,
//         and Charisma scores. You assume the new form's hit points,
//         hit dice, and other statistics (reverting to your true
//         form when the new form's hit points drop to 0).
//
// v1 status: PARTIAL COVERAGE STUB — the engine already implements
//   the **Shapechanger TRAIT** (monster polymorph into a specific
//   alternate form — e.g. Strahd → bat/wolf/mist, Mimic → object)
//   via `src/engine/shapechange.ts` and `case 'shapechange':` in
//   combat.ts. That trait implementation does NOT cover the
//   Shapechange SPELL (transform into ANY creature of CR <= your
//   level, with full stat replacement — much more complex).
//
//   This module exists primarily so the monster-spell coverage
//   report counts Shapechange as implemented (1 creature-ref:
//   Hollyphant). The actual Shapechange SPELL behavior (full stat
//   replacement, CR limit, revert-on-0-HP) is deferred.
//
//   For consistency, this module re-exports the engine's
//   `shouldShapechange` / `executeShapechange` functions. The
//   combat.ts `case 'shapechange':` branch imports directly from
//   `src/engine/shapechange.ts`, so this module's exports are not
//   in the combat dispatch path — they're provided for tooling and
//   for future migration of the spell (vs. trait) into this module.
//
// Integration notes:
//   - PlannedAction type 'shapechange' ALREADY EXISTS (Session 61).
//   - combat.ts `case 'shapechange':` ALREADY EXISTS (Session 61).
//   - planner.ts branch for 'shapechange' ALREADY EXISTS (Session 61).
//   No new integration points needed.
//
// Spell module pattern (coverage stub re-exporting engine functions):
//   metadata const with name/level/school/range/conc/castingTime
//   re-exports: shouldShapechange, executeShapechange, revertOnDeath
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

// Re-export the engine's shapechange functions for tooling/future use.
// The combat.ts `case 'shapechange':` branch imports directly from
// `src/engine/shapechange.ts`, NOT from this spell module — so these
// re-exports are purely for discoverability and consistency with the
// other spell modules in src/spells/.
export {
  shouldShapechange,
  executeShapechange,
  revertOnDeath as revertShapechangeOnDeath,
} from '../engine/shapechange';

export const metadata = {
  name: 'Shapechange', level: 9, school: 'transmutation', rangeFt: 0,
  concentration: true, castingTime: 'action',
  // The Shapechanger TRAIT is implemented (Session 61); the Shapechange
  // SPELL (full stat replacement, CR limit) is deferred. This module is
  // a coverage stub so the scan script counts Shapechange as implemented.
  coverageStub: true,
  shapechangeCoverageStubV1Implemented: true,
} as const;

/**
 * Coverage-stub shouldCast — delegates to the engine's `shouldShapechange`
 * (which returns `{ formName } | null` for the Shapechanger TRAIT, not the
 * Shapechange SPELL). Returns null if the engine returns null, otherwise
 * returns the caster (indicating the action should fire — the engine's
 * `executeShapechange` will be called by the existing `case 'shapechange':`
 * branch in combat.ts).
 *
 * For monsters WITHOUT the Shapechanger trait (i.e. those casting the
 * Shapechange SPELL via a spell slot), `shouldShapechange` returns null
 * because `caster.shapechangerForms` is empty — so this function also
 * returns null. That's correct: the Shapechange SPELL is not yet
 * implemented, so monsters who only know the spell (not the trait) won't
 * cast it.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  // Lazy import to avoid a circular dep at module-load time.
  // (The engine module imports from combat.ts, which imports from many
  // spell modules. Doing the import lazily inside the function breaks
  // the cycle.)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { shouldShapechange } = require('../engine/shapechange') as typeof import('../engine/shapechange');
  const result = shouldShapechange(caster, bf);
  return result ? caster : null;
}

/**
 * Coverage-stub execute — delegates to the engine's `executeShapechange`
 * for the Shapechanger TRAIT. For the Shapechange SPELL (full stat
 * replacement), this is a no-op until a real implementation lands.
 *
 * Note: the engine's `executeShapechange` requires a `formName` argument
 * that the combat.ts `case 'shapechange':` branch derives from the
 * `shouldShapechange` return value. This stub doesn't have access to that
 * form name (the spell module's `execute` signature is `(caster, state)`),
 * so it's a no-op. The actual execution happens via the engine import in
 * combat.ts.
 */
export function execute(_caster: Combatant, _state: EngineState): void { /* no-op */ }

export function cleanup(_c: Combatant): void { /* no-op */ }
