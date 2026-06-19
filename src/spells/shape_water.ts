// ============================================================
// Shape Water — XGE p.164
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 30 feet
// Components: S only  (CANON — 5etools JSON: {"s":true},
//   NO V, NO M)
// Duration: instant or up to 1 hour
// Effect: You choose an area of water that you can see within
//   range and that fits within a 5-foot cube. You manipulate it
//   in one of the following ways:
//     - You instantaneously move or otherwise change the flow of
//       the water as you direct, up to 5 feet in any direction.
//       This movement doesn't have enough force to cause damage.
//     - You cause the water to form into simple shapes and
//       animate at your direction. This change lasts for 1 hour.
//     - You change the water's color or opacity. The water must
//       be changed in the same way throughout. This change lasts
//       for 1 hour.
//     - You freeze the water, provided that there are no
//       creatures in it. The water unfreezes in 1 hour.
//   If you cast this spell multiple times, you can have no more
//   than two of its non-instantaneous effects active at a time,
//   and you can dismiss such an effect as an action.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "manipulates water" log event;
// no mechanical effect in v1; routes via CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Shape Water is the SEVENTEENTH (and FINAL) self-buff cantrip
// in CANTRIP_SELF_EFFECTS (the first sixteen are Blade Ward,
// Shillelagh, True Strike, Resistance, Guidance, Friends, Minor
// Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message,
// Control Flames, Dancing Lights, Druidcraft, Encode Thoughts,
// Mold Earth). Like Control Flames / Mold Earth (the other XGE
// elemental-utility cantrips in this session), Shape Water v1
// has NO scratch fields and NO mechanical effect — it emits a
// single "manipulates water" log event and that's it. The
// cantrip is treated as a flavor-only self-buff (the "self" in
// self-buff is loose here — Shape Water canonically targets a
// 5-ft cube of water within 30 ft, not the caster — but v1
// routes it through CANTRIP_SELF_EFFECTS because the cantrip has
// no attack roll, no save, no target combatant, and no
// mechanical effect in v1).
//
// THIS IS THE FINAL CANTRIP IN THE CANTRIP WORKSTREAM. After
// Shape Water, ALL 49 in-scope cantrips (excluding the 3 out-of-
// scope XPHB-only: Elementalism, Sorcerous Burst, Starry Wisp)
// are implemented.
//
// CANON COMPONENTS NOTE: Shape Water is S-only (NO V, NO M) per
// the 5etools JSON {"s":true}. This is the FOURTH and FINAL
// S-only cantrip in the workstream (Control Flames was the first,
// Encode Thoughts was the second, Mold Earth was the third — all
// in this session). The S-only components reflect the spell's
// elemental-utility flavor (a single somatic gesture shapes
// existing water — no incantation, no material component). All
// four XGE elemental-utility cantrips (Control Flames, Gust,
// Mold Earth, Shape Water) are S-only; Gust was implemented in
// Session 10 with combat mechanics (push-AWAY forced movement),
// the other three are flavor-only.
//
// v1 simplification: XGE p.164 canonically allows the caster to
// have up to 2 non-instantaneous Shape Water effects active
// simultaneously (and dismiss any as an action). v1 has no
// persistent-effect-tracking subsystem, so v1 cannot model the
// 2-effect cap or the dismissal. Documented via the metadata
// flags `shapeWaterMultiEffectTrackingV1Implemented: false` and
// `shapeWaterDismissalV1Implemented: false`.
//
// v1 simplification: XGE p.164 canonically allows the caster to
// CHOOSE one of 4 effects (move/change flow, form shapes,
// change color/opacity, freeze). v1 emits a single "manipulates
// water" log event without choosing (the log mentions all 4
// options). Documented via the metadata flag
// `shapeWaterEffectChoiceV1Simplified: true`.
//
// v1 simplification: XGE p.164 canonically allows the caster to
// MOVE OR CHANGE THE FLOW OF WATER (instantaneously, up to 5 ft
// in any direction — no damage). v1 has no water-flow subsystem
// (the engine does not model water cells or water flow), so v1
// cannot model the water-flow change. Documented via the
// metadata flag `shapeWaterWaterFlowV1Implemented: false`.
//
// v1 simplification: XGE p.164 canonically allows the caster to
// FREEZE water (provided no creatures are in it; unfreezes in
// 1 hour). v1 has no freeze subsystem (the engine does not model
// water-state changes), so v1 cannot model the freeze. Documented
// via the metadata flag `shapeWaterFreezeV1Implemented: false`.
//
// v1 simplification: XGE p.164 canonically lasts instant or up
// to 1 hour (the spell's duration is instant for move/flow,
// 1 hour for shapes/color/freeze — the caster can end them
// early). v1 treats Shape Water as a 1-round effect (the effect
// "fades" at the start of the caster's NEXT turn via cleanup() —
// though v1 has no persistent state to clear, so cleanup is a
// no-op). Documented via the metadata flag
// `shapeWaterDurationV1Simplified: true`.
//
// v1 simplification: XGE p.164 canonically allows the caster to
// "dismiss such an effect as an action". v1 has no dismissal
// action. Documented via the metadata flag
// `shapeWaterDismissalV1Implemented: false`.
//
// v1 simplification: XGE p.164 canonically has 30 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target water within 30 ft). Documented via the metadata flag
// `shapeWaterRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-13):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Shape Water's Action (no target — flavor-only self-buff v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Control Flames / Mold Earth's routing exactly
//     (Shape Water is the water-element variant).
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Shape Water',
  level: 0,
  school: 'transmutation',
  /** Range: 30 ft (XGE p.164 — the water must be within range). */
  rangeFt: 30,
  /** No concentration — Shape Water lasts instant or up to 1 hour (XGE p.164), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Shape Water is a pure utility (transmutation) water effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the 4 water effects are flat). */
  scales: false as const,
  /**
   * Components: S only (CANON — 5etools JSON: {"s":true}, NO V,
   * NO M). Cross-checked against the 5etools spell-cache JSON
   * per the Session 13 protocol — the handover also listed
   * S-only (no V, no M), canon confirmed. THIS IS THE FOURTH
   * AND FINAL S-ONLY CANTRIP IN THE WORKSTREAM (Control Flames
   * was the first, Encode Thoughts was the second, Mold Earth
   * was the third — all in this session). The S-only components
   * reflect the spell's elemental-utility flavor (a single
   * somatic gesture shapes existing water — no incantation, no
   * material component). NOTE: of the 4 XGE elemental-utility
   * cantrips (Control Flames, Gust, Mold Earth, Shape Water), only
   * 3 are S-only (Control Flames, Mold Earth, Shape Water); Gust
   * is V+S per canon 5etools JSON {"v":true,"s":true}. Gust was
   * implemented in Session 10 with combat mechanics (push-AWAY
   * forced movement), the other three are flavor-only.
   */
  components: { v: false, s: true, m: false } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Shape Water v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: XGE p.164 canonically allows the
   * caster to have up to 2 non-instantaneous Shape Water
   * effects active simultaneously. v1 has no persistent-effect-
   * tracking subsystem, so v1 cannot model the 2-effect cap.
   * Future work: a persistent-effect-tracking subsystem that
   * counts active Shape Water effects per caster and rejects
   * casts that would exceed the 2-effect cap.
   */
  shapeWaterMultiEffectTrackingV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.164 canonically allows the
   * caster to CHOOSE one of 4 effects (move/change flow, form
   * shapes, change color/opacity, freeze). v1 emits a single
   * "manipulates water" log event without choosing (the log
   * mentions all 4 options). Future work: a "choice" parameter
   * on the Action, with distinct log events per choice.
   */
  shapeWaterEffectChoiceV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.164 canonically allows the
   * caster to MOVE OR CHANGE THE FLOW OF WATER (instantaneously,
   * up to 5 ft in any direction — no damage). v1 has no water-
   * flow subsystem (the engine does not model water cells or
   * water flow), so v1 cannot model the water-flow change.
   * Future work: a water-flow subsystem that models water cells
   * on the battlefield and allows spells to relocate water.
   */
  shapeWaterWaterFlowV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.164 canonically allows the
   * caster to FREEZE water (provided no creatures are in it;
   * unfreezes in 1 hour). v1 has no freeze subsystem (the
   * engine does not model water-state changes), so v1 cannot
   * model the freeze. Future work: a freeze subsystem that
   * models water-state changes (liquid → ice) and the
   * no-creatures-in-it precondition check.
   */
  shapeWaterFreezeV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.164 canonically lasts instant
   * or up to 1 hour (the spell's duration is instant for
   * move/flow, 1 hour for shapes/color/freeze). v1 treats Shape
   * Water as a 1-round effect (the effect "fades" at the start
   * of the caster's NEXT turn via cleanup() — though v1 has no
   * persistent state to clear, so cleanup is a no-op). Future
   * work: a persistent-buff subsystem that tracks up-to-1-hour
   * durations.
   */
  shapeWaterDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: XGE p.164 canonically allows the
   * caster to "dismiss such an effect as an action". v1 has no
   * dismissal action. Future work: a dismissal action that
   * clears the persistent effect.
   */
  shapeWaterDismissalV1Implemented: false as const,
  /**
   * v1 simplification flag: XGE p.164 canonically has 30 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  shapeWaterRangeEnforcementV1Simplified: true as const,
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
 * Apply Shape Water's "self-buff" (v1 flavor-only): emit a single
 * "manipulates water" log event. Called via resolveCantripAction()
 * from CANTRIP_SELF_EFFECTS in cantrip_effects.ts, which
 * executePlannedAction consults for non-attack cantrips (routing
 * them away from resolveAttack).
 *
 * v1 has NO mechanical effect — the log event is the entire
 * effect. The cantrip does NOT set any scratch fields, does NOT
 * modify any combatant state, and does NOT consume any resource
 * beyond the action. The effect "fades" at the start of the
 * caster's NEXT turn (though v1 has no persistent state to clear
 * — cleanup is a no-op).
 *
 * v1 simplification: XGE p.164 canonically allows the caster to
 * CHOOSE one of 4 effects (move/change flow, form shapes, change
 * color/opacity, freeze). v1 emits a single "manipulates water"
 * log event without choosing (the log mentions all 4 options).
 * Documented via the metadata flag
 * `shapeWaterEffectChoiceV1Simplified: true`.
 *
 * v1 simplification: XGE p.164 canonically can MOVE/CHANGE FLOW
 * and FREEZE water. v1 has no water-flow or freeze subsystem.
 * Documented via the metadata flags
 * `shapeWaterWaterFlowV1Implemented: false` and
 * `shapeWaterFreezeV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Shape Water — manipulates water within range (move, shape, color, or freeze)! (v1: flavor-only; effect choice, multi-effect tracking, water-flow, freeze, and dismissal not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Shape Water has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The effect "fades" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Shape Water is in
 * the registry.
 *
 * Future work: a persistent-effect-tracking subsystem that
 * tracks active Shape Water effects and clears them when they
 * expire (the cleanup would then remove the effect from the
 * caster's active-effects list, and reset the affected water
 * cell's state if the effect was a freeze).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
