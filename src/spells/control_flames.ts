// ============================================================
// Control Flames — XGE p.152
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 60 feet
// Components: S only  (CANON — 5etools JSON: {"s":true},
//   NO V, NO M)
// Duration: instant or up to 1 hour
// Effect: You choose nonmagical flame that you can see within
//   range and that fits within a 5-foot cube. You affect it in
//   one of the following ways:
//     - You instantaneously expand the flame 5 feet in one
//       direction, provided that wood or other fuel is present
//       in the new location.
//     - You instantaneously extinguish the flames within the
//       cube.
//     - You double or halve the area of bright light and dim
//       light cast by the flame, change its color, or both. The
//       change lasts for 1 hour.
//     - You cause simple shapes — such as the vague form of a
//       creature, an inanimate object, or a location — to appear
//       within the flames and animate as you like. The shapes
//       last for 1 hour.
//   If you cast this spell multiple times, you can have up to
//   three non-instantaneous effects created by it active at a
//   time, and you can dismiss such an effect as an action.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "manipulates a nonmagical flame"
// log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Control Flames is the TWELFTH self-buff cantrip in
// CANTRIP_SELF_EFFECTS (the first eleven are Blade Ward,
// Shillelagh, True Strike, Resistance, Guidance, Friends, Minor
// Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message).
// Like Minor Illusion / Mage Hand / Prestidigitation / Thaumaturgy
// / Message, Control Flames v1 has NO scratch fields and NO
// mechanical effect — it emits a single "manipulates a nonmagical
// flame" log event and that's it. The cantrip is treated as a
// flavor-only self-buff (the "self" in self-buff is loose here —
// Control Flames canonically targets a nonmagical flame within 60
// ft, not the caster — but v1 routes it through
// CANTRIP_SELF_EFFECTS because the cantrip has no attack roll, no
// save, no target combatant, and no mechanical effect in v1).
//
// CANON COMPONENTS NOTE: Control Flames is S-only (NO V, NO M)
// per the 5etools JSON {"s":true}. This is the FIRST S-only
// cantrip in the workstream (the prior 11 self-buff cantrips all
// had V or V+S or V+S+M). The S-only components reflect the
// spell's elemental-utility flavor (a single somatic gesture
// shapes an existing flame — no incantation, no material
// component). NOTE: of the 4 XGE elemental-utility cantrips
// (Control Flames, Gust, Mold Earth, Shape Water), only 3 are
// S-only (Control Flames, Mold Earth, Shape Water); Gust is V+S
// per canon 5etools JSON {"v":true,"s":true}.
//
// v1 simplification: XGE p.152 canonically requires the target
// flame to be NONMAGICAL ("You choose nonmagical flame that you
// can see within range"). v1 has no flame-type-tracking subsystem
// (the engine does not model which flames are magical vs
// nonmagical), so v1 cannot enforce the nonmagical-flame
// requirement. Documented via the metadata flag
// `controlFlamesNonMagicalFlameRequirementV1Simplified: true`.
//
// v1 simplification: XGE p.152 canonically allows the caster to
// CHOOSE one of 4 effects (expand, extinguish, double/halve light
// or change color, animate shapes). v1 emits a single
// "manipulates a nonmagical flame" log event without choosing
// (the log mentions all 4 options). Documented via the metadata
// flag `controlFlamesEffectChoiceV1Simplified: true`.
//
// v1 simplification: XGE p.152 canonically allows the caster to
// have up to 3 non-instantaneous Control Flames effects active
// simultaneously (and dismiss any as an action). v1 has no
// persistent-effect-tracking subsystem, so v1 cannot model the
// 3-effect cap or the dismissal. Documented via the metadata
// flags `controlFlamesMultiEffectTrackingV1Implemented: false`
// and `controlFlamesDismissalV1Implemented: false`.
//
// v1 simplification: XGE p.152 canonically lasts instant or up
// to 1 hour (the spell's duration is instant for some effects,
// 1 hour for others — the caster can end them early). v1 treats
// Control Flames as a 1-round effect (the effect "fades" at the
// start of the caster's NEXT turn via cleanup() — though v1 has
// no persistent state to clear, so cleanup is a no-op).
// Documented via the metadata flag
// `controlFlamesDurationV1Simplified: true`.
//
// v1 simplification: XGE p.152 canonically has 60 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target flames within 60 ft). Documented via the metadata flag
// `controlFlamesRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-13):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Control Flames's Action (no target — flavor-only self-buff
//     v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Mage Hand / Prestidigitation / Thaumaturgy /
//     Message's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Control Flames',
  level: 0,
  school: 'transmutation',
  /** Range: 60 ft (XGE p.152 — the nonmagical flame must be within range). */
  rangeFt: 60,
  /** No concentration — Control Flames lasts instant or up to 1 hour (XGE p.152), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Control Flames is a pure utility (transmutation) effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the 4 magical effects are flat). */
  scales: false as const,
  /**
   * Components: S only (CANON — 5etools JSON: {"s":true}, NO V,
   * NO M). Cross-checked against the 5etools spell-cache JSON per
   * the Session 13 protocol — the handover also listed S-only (no
   * V, no M), canon confirmed. THIS IS THE FIRST S-ONLY CANTRIP
   * IN THE WORKSTREAM (the prior 11 self-buff cantrips all had V
   * or V+S or V+S+M). The S-only components reflect the spell's
   * elemental-utility flavor (a single somatic gesture shapes an
   * existing flame — no incantation, no material component).
   */
  components: { v: false, s: true, m: false } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Control Flames v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: XGE p.152 canonically allows the
   * caster to have up to 3 non-instantaneous Control Flames
   * effects active simultaneously. v1 has no persistent-effect-
   * tracking subsystem, so v1 cannot model the 3-effect cap.
   * Future work: a persistent-effect-tracking subsystem that
   * counts active Control Flames effects per caster and rejects
   * casts that would exceed the 3-effect cap.
   */
  controlFlamesMultiEffectTrackingV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.152 canonically allows the
   * caster to CHOOSE one of 4 effects (expand, extinguish,
   * double/halve light or change color, animate shapes). v1
   * emits a single "manipulates a nonmagical flame" log event
   * without choosing (the log mentions all 4 options). Future
   * work: a "choice" parameter on the Action, with distinct log
   * events per choice.
   */
  controlFlamesEffectChoiceV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.152 canonically lasts instant
   * or up to 1 hour (the spell's duration is instant for some
   * effects, 1 hour for others — the caster can end them early).
   * v1 treats Control Flames as a 1-round effect (the effect
   * "fades" at the start of the caster's NEXT turn via cleanup()
   * — though v1 has no persistent state to clear, so cleanup is
   * a no-op). Future work: a persistent-buff subsystem that
   * tracks up-to-1-hour durations.
   */
  controlFlamesDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.152 canonically allows the
   * caster to "dismiss such an effect as an action". v1 has no
   * dismissal action (the effect "fades" at the start of the
   * caster's NEXT turn via cleanup() — though v1 has no
   * persistent state to clear, so cleanup is a no-op). Future
   * work: a dismissal action that clears the persistent effect.
   */
  controlFlamesDismissalV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.152 canonically requires the
   * target flame to be NONMAGICAL ("You choose nonmagical flame
   * that you can see within range"). v1 has no flame-type-
   * tracking subsystem (the engine does not model which flames
   * are magical vs nonmagical), so v1 cannot enforce the
   * nonmagical-flame requirement. Future work: a flame-type-
   * tracking subsystem (e.g. a Set of magical-flame source IDs
   * on Combatant/battlefield, populated by spells like Create
   * Bonfire / Produce Flame).
   */
  controlFlamesNonMagicalFlameRequirementV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.152 canonically has 60 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  controlFlamesRangeEnforcementV1Simplified: true as const,
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
 * Apply Control Flames's "self-buff" (v1 flavor-only): emit a
 * single "manipulates a nonmagical flame" log event. Called via
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
 * v1 simplification: XGE p.152 canonically allows the caster to
 * CHOOSE one of 4 effects (expand, extinguish, change light/
 * color, animate shapes). v1 emits a single "manipulates a
 * nonmagical flame" log event without choosing (the log mentions
 * all 4 options). Documented via the metadata flag
 * `controlFlamesEffectChoiceV1Simplified: true`.
 *
 * v1 simplification: XGE p.152 canonically allows up to 3 active
 * non-instantaneous effects. v1 has no persistent-effect-tracking
 * subsystem. Documented via the metadata flag
 * `controlFlamesMultiEffectTrackingV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Control Flames — manipulates a nonmagical flame within range (expand, extinguish, change light, or shape)! (v1: flavor-only; effect choice, multi-effect tracking, dismissal, and nonmagical-flame-type check not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Control Flames has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The effect "fades" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Control Flames is
 * in the registry.
 *
 * Future work: a persistent-effect-tracking subsystem that
 * tracks active Control Flames effects and clears them when they
 * expire (the cleanup would then remove the effect from the
 * caster's active-effects list).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
