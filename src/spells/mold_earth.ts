// ============================================================
// Mold Earth — XGE p.162
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 30 feet
// Components: S only  (CANON — 5etools JSON: {"s":true},
//   NO V, NO M)
// Duration: instant or up to 1 hour
// Effect: You choose a portion of dirt or stone that you can see
//   within range and that fits within a 5-foot cube. You
//   manipulate it in one of the following ways:
//     - If you target an area of loose earth, you can
//       instantaneously excavate it, move it along the ground,
//       and deposit it up to 5 feet away. This movement doesn't
//       involve enough force to cause damage.
//     - You cause shapes, colors, or both to appear on the dirt
//       or stone, spelling out words, creating images, or
//       shaping patterns. The changes last for 1 hour.
//     - If the dirt or stone you target is on the ground, you
//       cause it to become difficult terrain. Alternatively, you
//       can cause the ground to become normal terrain if it is
//       already difficult terrain. This change lasts for 1 hour.
//   If you cast this spell multiple times, you can have no more
//   than two of its non-instantaneous effects active at a time,
//   and you can dismiss such an effect as an action.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "manipulates dirt or stone"
// log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Mold Earth is the SIXTEENTH self-buff cantrip in
// CANTRIP_SELF_EFFECTS (the first fifteen are Blade Ward,
// Shillelagh, True Strike, Resistance, Guidance, Friends, Minor
// Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message,
// Control Flames, Dancing Lights, Druidcraft, Encode Thoughts).
// Like Control Flames (the other XGE elemental-utility cantrip
// in this session), Mold Earth v1 has NO scratch fields and NO
// mechanical effect — it emits a single "manipulates dirt or
// stone" log event and that's it. The cantrip is treated as a
// flavor-only self-buff (the "self" in self-buff is loose here —
// Mold Earth canonically targets a 5-ft cube of dirt/stone within
// 30 ft, not the caster — but v1 routes it through
// CANTRIP_SELF_EFFECTS because the cantrip has no attack roll, no
// save, no target combatant, and no mechanical effect in v1).
//
// CANON COMPONENTS NOTE: Mold Earth is S-only (NO V, NO M) per
// the 5etools JSON {"s":true}. This is the THIRD S-only cantrip
// in the workstream (Control Flames was the first, Encode
// Thoughts was the second — all three in this session). The
// S-only components reflect the spell's elemental-utility flavor
// (a single somatic gesture shapes existing dirt/stone — no
// incantation, no material component). NOTE: of the 4 XGE
// elemental-utility cantrips (Control Flames, Gust, Mold Earth,
// Shape Water), only 3 are S-only (Control Flames, Mold Earth,
// Shape Water); Gust is V+S per canon 5etools JSON
// {"v":true,"s":true}. Gust was implemented in Session 10 with
// combat mechanics (push-AWAY forced movement), the other three
// are flavor-only.
//
// v1 simplification: XGE p.162 canonically allows the caster to
// have up to 2 non-instantaneous Mold Earth effects active
// simultaneously (and dismiss any as an action). v1 has no
// persistent-effect-tracking subsystem, so v1 cannot model the
// 2-effect cap or the dismissal. Documented via the metadata
// flags `moldEarthMultiEffectTrackingV1Implemented: false` and
// `moldEarthDismissalV1Implemented: false`.
//
// v1 simplification: XGE p.162 canonically allows the caster to
// CHOOSE one of 3 effects (excavate/move, shapes/colors/words,
// difficult-terrain toggle). v1 emits a single "manipulates dirt
// or stone" log event without choosing (the log mentions all 3
// options). Documented via the metadata flag
// `moldEarthEffectChoiceV1Simplified: true`.
//
// v1 simplification: XGE p.162 canonically can TOGGLE DIFFICULT
// TERRAIN (turn normal ground into difficult terrain, or vice
// versa, for 1 hour). v1 has no per-cell difficult-terrain
// subsystem (the engine's `terrain` field on `Cell` is static,
// not spell-modifiable), so v1 cannot model the difficult-terrain
// toggle. Documented via the metadata flag
// `moldEarthDifficultTerrainIntegrationV1Implemented: false`.
// This is the most mechanically significant v1 simplification in
// this batch — the difficult-terrain toggle is the only effect
// in this batch that would have a combat-impactful consequence
// (movement cost doubling in the affected cells).
//
// v1 simplification: XGE p.162 canonically lasts instant or up
// to 1 hour (the spell's duration is instant for excavation,
// 1 hour for shapes/colors and difficult-terrain — the caster
// can end them early). v1 treats Mold Earth as a 1-round effect
// (the effect "fades" at the start of the caster's NEXT turn via
// cleanup() — though v1 has no persistent state to clear, so
// cleanup is a no-op). Documented via the metadata flag
// `moldEarthDurationV1Simplified: true`.
//
// v1 simplification: XGE p.162 canonically allows the caster to
// "dismiss such an effect as an action". v1 has no dismissal
// action. Documented via the metadata flag
// `moldEarthDismissalV1Implemented: false`.
//
// v1 simplification: XGE p.162 canonically allows the caster to
// EXCAVATE loose earth (instantaneously move it along the ground
// and deposit it up to 5 ft away — no damage). v1 has no
// terrain-modification subsystem (the engine's `Cell.terrain`
// is static, not spell-modifiable), so v1 cannot model the
// excavation. Documented via the metadata flag
// `moldEarthExcavationV1Implemented: false`.
//
// v1 simplification: XGE p.162 canonically has 30 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target dirt/stone within 30 ft). Documented via the metadata
// flag `moldEarthRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-13):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Mold Earth's Action (no target — flavor-only self-buff v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Control Flames's routing exactly (Mold Earth
//     is the earth-element variant).
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mold Earth',
  level: 0,
  school: 'transmutation',
  /** Range: 30 ft (XGE p.162 — the dirt/stone must be within range). */
  rangeFt: 30,
  /** No concentration — Mold Earth lasts instant or up to 1 hour (XGE p.162), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Mold Earth is a pure utility (transmutation) earth effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the 3 earth effects are flat). */
  scales: false as const,
  /**
   * Components: S only (CANON — 5etools JSON: {"s":true}, NO V,
   * NO M). Cross-checked against the 5etools spell-cache JSON
   * per the Session 13 protocol — the handover also listed
   * S-only (no V, no M), canon confirmed. THIS IS THE THIRD
   * S-ONLY CANTRIP IN THE WORKSTREAM (Control Flames was the
   * first, Encode Thoughts was the second — all three in this
   * session). The S-only components reflect the spell's
   * elemental-utility flavor (a single somatic gesture shapes
   * existing dirt/stone — no incantation, no material
   * component). NOTE: of the 4 XGE elemental-utility cantrips
   * (Control Flames, Gust, Mold Earth, Shape Water), only 3 are
   * S-only (Control Flames, Mold Earth, Shape Water); Gust is V+S
   * per canon 5etools JSON {"v":true,"s":true}. Gust was
   * implemented in Session 10 with combat mechanics (push-AWAY
   * forced movement), the other three are flavor-only.
   */
  components: { v: false, s: true, m: false } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Mold Earth v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: XGE p.162 canonically allows the
   * caster to have up to 2 non-instantaneous Mold Earth effects
   * active simultaneously. v1 has no persistent-effect-tracking
   * subsystem, so v1 cannot model the 2-effect cap. Future work:
   * a persistent-effect-tracking subsystem that counts active
   * Mold Earth effects per caster and rejects casts that would
   * exceed the 2-effect cap.
   */
  moldEarthMultiEffectTrackingV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.162 canonically allows the
   * caster to CHOOSE one of 3 effects (excavate/move,
   * shapes/colors/words, difficult-terrain toggle). v1 emits a
   * single "manipulates dirt or stone" log event without
   * choosing (the log mentions all 3 options). Future work: a
   * "choice" parameter on the Action, with distinct log events
   * per choice.
   */
  moldEarthEffectChoiceV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.162 canonically can TOGGLE
   * DIFFICULT TERRAIN (turn normal ground into difficult terrain,
   * or vice versa, for 1 hour). v1 has no per-cell difficult-
   * terrain subsystem (the engine's `terrain` field on `Cell` is
   * static, not spell-modifiable), so v1 cannot model the
   * difficult-terrain toggle. Future work: a per-cell difficult-
   * terrain subsystem that allows spells to toggle the
   * `terrain` field on `Cell` (or add a new
   * `spellEffects: Set<'difficultTerrain'>` field on `Cell`).
   *
   * This is the most mechanically significant v1 simplification
   * in this batch — the difficult-terrain toggle is the only
   * effect in this batch that would have a combat-impactful
   * consequence (movement cost doubling in the affected cells).
   */
  moldEarthDifficultTerrainIntegrationV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.162 canonically lasts instant
   * or up to 1 hour (the spell's duration is instant for
   * excavation, 1 hour for shapes/colors and difficult-terrain).
   * v1 treats Mold Earth as a 1-round effect (the effect "fades"
   * at the start of the caster's NEXT turn via cleanup() —
   * though v1 has no persistent state to clear, so cleanup is a
   * no-op). Future work: a persistent-buff subsystem that tracks
   * up-to-1-hour durations.
   */
  moldEarthDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.162 canonically allows the
   * caster to "dismiss such an effect as an action". v1 has no
   * dismissal action. Future work: a dismissal action that
   * clears the persistent effect.
   */
  moldEarthDismissalV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.162 canonically allows the
   * caster to EXCAVATE loose earth (instantaneously move it
   * along the ground and deposit it up to 5 ft away — no
   * damage). v1 has no terrain-modification subsystem (the
   * engine's `Cell.terrain` is static, not spell-modifiable),
   * so v1 cannot model the excavation. Future work: a terrain-
   * modification subsystem that allows spells to relocate
   * earth cells (mirror the per-cell difficult-terrain
   * subsystem above).
   */
  moldEarthExcavationV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.162 canonically has 30 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  moldEarthRangeEnforcementV1Simplified: true as const,
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId: undefined,
    value: undefined,
    description: desc,
  });
}

// ---- applySelfEffect -----------------------------------------

/**
 * Apply Mold Earth's "self-buff" (v1 flavor-only): emit a single
 * "manipulates dirt or stone" log event. Called via
 * resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * v1 has NO mechanical effect — the log event is the entire
 * effect. The cantrip does NOT set any scratch fields, does NOT
 * modify any combatant state, and does NOT consume any resource
 * beyond the action. The effect "fades" at the start of the
 * caster's NEXT turn (though v1 has no persistent state to clear
 * — cleanup is a no-op).
 *
 * v1 simplification: XGE p.162 canonically allows the caster to
 * CHOOSE one of 3 effects (excavate/move, shapes/colors/words,
 * difficult-terrain toggle). v1 emits a single "manipulates dirt
 * or stone" log event without choosing (the log mentions all 3
 * options). Documented via the metadata flag
 * `moldEarthEffectChoiceV1Simplified: true`.
 *
 * v1 simplification: XGE p.162 canonically can TOGGLE DIFFICULT
 * TERRAIN. v1 has no per-cell difficult-terrain subsystem.
 * Documented via the metadata flag
 * `moldEarthDifficultTerrainIntegrationV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mold Earth — manipulates dirt or stone within range (excavate, shape, or difficult terrain)! (v1: flavor-only; effect choice, multi-effect tracking, difficult-terrain integration, dismissal, and excavation not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Mold Earth has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The effect "fades" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Mold Earth is in
 * the registry.
 *
 * Future work: a persistent-effect-tracking subsystem that
 * tracks active Mold Earth effects and clears them when they
 * expire (the cleanup would then remove the effect from the
 * caster's active-effects list, and reset the affected Cell's
 * terrain if the effect was a difficult-terrain toggle).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
