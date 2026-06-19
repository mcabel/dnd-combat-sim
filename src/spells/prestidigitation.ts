// ============================================================
// Prestidigitation — PHB p.267
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 10 feet
// Components: V + S  (CANON — 5etools JSON: {"v":true,"s":true},
//   NO M)
// Duration: up to 1 hour
// Effect: This spell is a minor magical trick that novice
//   spellcasters use for practice. You create one of the
//   following magical effects within range:
//     - An instantaneous, harmless sensory effect (shower of
//       sparks, puff of wind, faint musical notes, odd odor).
//     - Instantaneously light or snuff a candle, torch, or
//       small campfire.
//     - Instantaneously clean or soil an object no larger than
//       1 cubic foot.
//     - Chill, warm, or flavor up to 1 cubic foot of nonliving
//       material for 1 hour.
//     - Make a color, small mark, or symbol appear on an object
//       or surface for 1 hour.
//     - Create a nonmagical trinket or an illusory image that
//       can fit in your hand and lasts until the end of your
//       next turn.
//   If you cast this spell multiple times, you can have up to
//   three of its non-instantaneous effects active at a time,
//   and you can dismiss such an effect as an action.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "creates a minor magical effect"
// log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Prestidigitation is the NINTH self-buff cantrip in
// CANTRIP_SELF_EFFECTS (the first eight are Blade Ward,
// Shillelagh, True Strike, Resistance, Guidance, Friends, Minor
// Illusion, Mage Hand). Like Minor Illusion / Mage Hand,
// Prestidigitation v1 has NO scratch fields and NO mechanical
// effect — it emits a single "creates a minor magical effect"
// log event and that's it. The cantrip is treated as a flavor-
// only self-buff (the "self" in self-buff is loose here —
// Prestidigitation canonically targets a point/object within 10
// ft, not the caster — but v1 routes it through
// CANTRIP_SELF_EFFECTS because the cantrip has no attack roll, no
// save, no target combatant, and no mechanical effect in v1).
//
// v1 simplification: PHB p.267 canonically allows the caster to
// CHOOSE one of 6 magical effects (sensory, light/snuff,
// clean/soil, chill/warm/flavor, color/mark, trinket/illusory
// image). v1 emits a single "creates a minor magical effect" log
// event without choosing (the log mentions all 6 options).
// Documented via the metadata flag
// `prestidigitationEffectChoiceV1Simplified: true`.
//
// v1 simplification: PHB p.267 canonically allows the caster to
// have up to 3 non-instantaneous Prestidigitation effects active
// simultaneously (and dismiss any as an action). v1 has no
// persistent-effect-tracking subsystem, so v1 cannot model the
// 3-effect cap or the dismissal. Documented via the metadata
// flags `prestidigitationMultiEffectTrackingV1Implemented: false`
// and `prestidigitationDismissalV1Implemented: false`.
//
// v1 simplification: PHB p.267 canonically lasts up to 1 hour
// (the spell's duration is "up to" 1 hour for non-instantaneous
// effects — the caster can end them early). v1 treats
// Prestidigitation as a 1-round effect (the effect "fades" at
// the start of the caster's NEXT turn via cleanup() — though v1
// has no persistent state to clear, so cleanup is a no-op).
// Documented via the metadata flag
// `prestidigitationDurationV1Simplified: true`.
//
// v1 simplification: PHB p.267 canonically has 10 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target points within 10 ft). Documented via the metadata flag
// `prestidigitationRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-12):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Prestidigitation's Action (no target — flavor-only self-buff
//     v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Minor Illusion / Mage Hand's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Prestidigitation',
  level: 0,
  school: 'transmutation',
  /** Range: 10 ft (PHB p.267 — the magical effect appears at a point within range). */
  rangeFt: 10,
  /** No concentration — Prestidigitation lasts up to 1 hour (PHB p.267), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Prestidigitation is a pure utility (transmutation) effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the 6 magical effects are flat). */
  scales: false as const,
  /**
   * Components: V + S (CANON — 5etools JSON: {"v":true,"s":true},
   * NO M). Cross-checked against the 5etools spell-cache JSON per
   * the Session 12 protocol — the handover also listed V+S (no M),
   * canon confirmed.
   */
  components: { v: true, s: true, m: false } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Prestidigitation v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.267 canonically allows the
   * caster to CHOOSE one of 6 magical effects (sensory, light/
   * snuff, clean/soil, chill/warm/flavor, color/mark, trinket/
   * illusory image). v1 emits a single "creates a minor magical
   * effect" log event without choosing (the log mentions all 6
   * options). Future work: a "choice" parameter on the Action,
   * with distinct log events per choice.
   */
  prestidigitationEffectChoiceV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.267 canonically allows the
   * caster to have up to 3 non-instantaneous Prestidigitation
   * effects active simultaneously. v1 has no persistent-effect-
   * tracking subsystem, so v1 cannot model the 3-effect cap.
   * Future work: a persistent-effect-tracking subsystem that
   * counts active Prestidigitation effects per caster and
   * rejects casts that would exceed the 3-effect cap.
   */
  prestidigitationMultiEffectTrackingV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.267 canonically allows the
   * caster to "dismiss such an effect as an action". v1 has no
   * dismissal action (the effect "fades" at the start of the
   * caster's NEXT turn via cleanup() — though v1 has no
   * persistent state to clear, so cleanup is a no-op). Future
   * work: a dismissal action that clears the persistent effect.
   */
  prestidigitationDismissalV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.267 canonically lasts up to 1
   * hour (the spell's duration is "up to" 1 hour for non-
   * instantaneous effects — the caster can end them early). v1
   * treats Prestidigitation as a 1-round effect (the effect
   * "fades" at the start of the caster's NEXT turn via cleanup()
   * — though v1 has no persistent state to clear, so cleanup is
   * a no-op). Future work: a persistent-buff subsystem that
   * tracks up-to-1-hour durations.
   */
  prestidigitationDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.267 canonically has 10 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  prestidigitationRangeEnforcementV1Simplified: true as const,
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
 * Apply Prestidigitation's "self-buff" (v1 flavor-only): emit a
 * single "creates a minor magical effect" log event. Called via
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
 * v1 simplification: PHB p.267 canonically allows the caster to
 * CHOOSE one of 6 magical effects. v1 emits a single "creates a
 * minor magical effect" log event without choosing (the log
 * mentions all 6 options). Documented via the metadata flag
 * `prestidigitationEffectChoiceV1Simplified: true`.
 *
 * v1 simplification: PHB p.267 canonically allows up to 3 active
 * non-instantaneous effects. v1 has no persistent-effect-tracking
 * subsystem. Documented via the metadata flag
 * `prestidigitationMultiEffectTrackingV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Prestidigitation — creates a minor magical effect (sensory, light, clean, flavor, color, or trinket) within range! (v1: flavor-only; effect choice, multi-effect tracking, and dismissal not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Prestidigitation has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The effect "fades" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Prestidigitation
 * is in the registry.
 *
 * Future work: a persistent-effect-tracking subsystem that
 * tracks active Prestidigitation effects and clears them when
 * they expire (the cleanup would then remove the effect from the
 * caster's active-effects list).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
