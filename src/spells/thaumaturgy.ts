// ============================================================
// Thaumaturgy — PHB p.282
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 30 feet
// Components: V only  (CANON — 5etools JSON: {"v":true},
//   NO S, NO M)
// Duration: up to 1 minute
// Effect: You manifest a minor wonder, a sign of supernatural
//   power, within range. You create one of the following magical
//   effects within range:
//     - Your voice booms up to three times as loud as normal for
//       1 minute.
//     - You cause flames to flicker, brighten, dim, or change
//       color for 1 minute.
//     - You cause harmless tremors in the ground for 1 minute.
//     - You create an instantaneous sound that originates from a
//       point of your choice within range, such as a rumble of
//       thunder, the cry of a raven, or ominous whispers.
//     - You instantaneously cause an unlocked door or window to
//       fly open or slam shut.
//     - You alter the appearance of your eyes for 1 minute.
//   If you cast this spell multiple times, you can have up to
//   three of its 1-minute effects active at a time, and you can
//   dismiss such an effect as an action.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "manifests a minor supernatural
// sign" log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Thaumaturgy is the TENTH self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first nine are Blade Ward, Shillelagh, True Strike,
// Resistance, Guidance, Friends, Minor Illusion, Mage Hand,
// Prestidigitation). Like Prestidigitation, Thaumaturgy v1 has NO
// scratch fields and NO mechanical effect — it emits a single
// "manifests a minor supernatural sign" log event and that's it.
// The cantrip is treated as a flavor-only self-buff (the "self"
// in self-buff is loose here — Thaumaturgy canonically targets a
// point/creature within 30 ft, not the caster — but v1 routes it
// through CANTRIP_SELF_EFFECTS because the cantrip has no attack
// roll, no save, no target combatant, and no mechanical effect in
// v1).
//
// CANON COMPONENTS NOTE: Thaumaturgy is V-only (NO S, NO M) per
// the 5etools JSON {"v":true}. This is unusual — most cantrips
// have at least S. The V-only components reflect the spell's
// divine-themed flavor (the caster speaks a word of power).
//
// v1 simplification: PHB p.282 canonically allows the caster to
// CHOOSE one of 6 magical effects (booming voice, flame flicker,
// tremors, sound, door/window open/shut, eye appearance). v1
// emits a single "manifests a minor supernatural sign" log event
// without choosing (the log mentions all 6 options). Documented
// via the metadata flag `thaumaturgyEffectChoiceV1Simplified:
// true`.
//
// v1 simplification: PHB p.282 canonically allows the caster to
// have up to 3 of its 1-minute effects active simultaneously (and
// dismiss any as an action). v1 has no persistent-effect-tracking
// subsystem, so v1 cannot model the 3-effect cap or the
// dismissal. Documented via the metadata flags
// `thaumaturgyMultiEffectTrackingV1Implemented: false` and
// `thaumaturgyDismissalV1Implemented: false`.
//
// v1 simplification: PHB p.282 canonically lasts up to 1 minute
// (the spell's duration is "up to" 1 minute — the caster can end
// the effects early). v1 treats Thaumaturgy as a 1-round effect
// (the effect "fades" at the start of the caster's NEXT turn via
// cleanup() — though v1 has no persistent state to clear, so
// cleanup is a no-op). Documented via the metadata flag
// `thaumaturgyDurationV1Simplified: true`.
//
// v1 simplification: PHB p.282 canonically has 30 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target points within 30 ft). Documented via the metadata flag
// `thaumaturgyRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-12):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Thaumaturgy's Action (no target — flavor-only self-buff v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Prestidigitation's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Thaumaturgy',
  level: 0,
  school: 'transmutation',
  /** Range: 30 ft (PHB p.282 — the supernatural sign appears at a point within range). */
  rangeFt: 30,
  /** No concentration — Thaumaturgy lasts up to 1 minute (PHB p.282), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Thaumaturgy is a pure utility (transmutation) effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the 6 magical effects are flat). */
  scales: false as const,
  /**
   * Components: V only (CANON — 5etools JSON: {"v":true}, NO S,
   * NO M). Cross-checked against the 5etools spell-cache JSON per
   * the Session 12 protocol — the handover also listed V-only (no
   * S, no M), canon confirmed. Unusual for a cantrip (most have
   * at least S); reflects the spell's divine-themed flavor (the
   * caster speaks a word of power).
   */
  components: { v: true, s: false, m: false } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Thaumaturgy v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.282 canonically allows the
   * caster to CHOOSE one of 6 magical effects (booming voice,
   * flame flicker, tremors, sound, door/window open/shut, eye
   * appearance). v1 emits a single "manifests a minor
   * supernatural sign" log event without choosing (the log
   * mentions all 6 options). Future work: a "choice" parameter
   * on the Action, with distinct log events per choice.
   */
  thaumaturgyEffectChoiceV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.282 canonically allows the
   * caster to have up to 3 of its 1-minute effects active
   * simultaneously. v1 has no persistent-effect-tracking
   * subsystem, so v1 cannot model the 3-effect cap. Future work:
   * a persistent-effect-tracking subsystem that counts active
   * Thaumaturgy effects per caster and rejects casts that would
   * exceed the 3-effect cap.
   */
  thaumaturgyMultiEffectTrackingV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.282 canonically allows the
   * caster to "dismiss such an effect as an action". v1 has no
   * dismissal action (the effect "fades" at the start of the
   * caster's NEXT turn via cleanup() — though v1 has no
   * persistent state to clear, so cleanup is a no-op). Future
   * work: a dismissal action that clears the persistent effect.
   */
  thaumaturgyDismissalV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.282 canonically lasts up to 1
   * minute. v1 treats Thaumaturgy as a 1-round effect (the
   * effect "fades" at the start of the caster's NEXT turn via
   * cleanup() — though v1 has no persistent state to clear, so
   * cleanup is a no-op). Future work: a persistent-buff
   * subsystem that tracks up-to-1-minute durations.
   */
  thaumaturgyDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.282 canonically has 30 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  thaumaturgyRangeEnforcementV1Simplified: true as const,
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
 * Apply Thaumaturgy's "self-buff" (v1 flavor-only): emit a single
 * "manifests a minor supernatural sign" log event. Called via
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
 * v1 simplification: PHB p.282 canonically allows the caster to
 * CHOOSE one of 6 magical effects. v1 emits a single "manifests
 * a minor supernatural sign" log event without choosing (the log
 * mentions all 6 options). Documented via the metadata flag
 * `thaumaturgyEffectChoiceV1Simplified: true`.
 *
 * v1 simplification: PHB p.282 canonically allows up to 3 active
 * 1-minute effects. v1 has no persistent-effect-tracking
 * subsystem. Documented via the metadata flag
 * `thaumaturgyMultiEffectTrackingV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Thaumaturgy — manifests a minor supernatural sign (booming voice, flame, tremors, sound, door, or eyes) within range! (v1: flavor-only; effect choice, multi-effect tracking, and dismissal not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Thaumaturgy has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The effect "fades" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Thaumaturgy is in
 * the registry.
 *
 * Future work: a persistent-effect-tracking subsystem that
 * tracks active Thaumaturgy effects and clears them when they
 * expire (the cleanup would then remove the effect from the
 * caster's active-effects list).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
