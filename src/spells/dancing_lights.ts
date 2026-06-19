// ============================================================
// Dancing Lights — PHB p.230
// Level 0 evocation cantrip
//
// Casting time: action
// Range: 120 feet
// Components: V + S + M  (CANON — 5etools JSON: {"v":true,
//   "s":true,"m":"a bit of phosphorus or wychwood, or a
//   glowworm"})
// Duration: 1 minute (CONCENTRATION)
// Effect: You create up to four torch-sized lights within range,
//   making them appear as torches, lanterns, or glowing orbs that
//   hover in the air for the duration. You can also combine the
//   four lights into one glowing vaguely humanoid form of Medium
//   size. Whichever form you choose, each light sheds dim light
//   in a 10-foot radius.
//   As a bonus action on your turn, you can move the lights up to
//   60 feet to a new spot within range. A light must be within 20
//   feet of another light created by this spell, and a light
//   winks out if it exceeds the spell's range.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "creates dancing lights" log
// event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Dancing Lights is the THIRTEENTH self-buff cantrip in
// CANTRIP_SELF_EFFECTS (the first twelve are Blade Ward,
// Shillelagh, True Strike, Resistance, Guidance, Friends, Minor
// Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message,
// Control Flames). Like the other flavor-only self-buffs,
// Dancing Lights v1 has NO scratch fields and NO mechanical
// effect — it emits a single "creates dancing lights" log event
// and that's it. The cantrip is treated as a flavor-only
// self-buff (the "self" in self-buff is loose here — Dancing
// Lights canonically creates lights at points within 120 ft, not
// on the caster — but v1 routes it through
// CANTRIP_SELF_EFFECTS because the cantrip has no attack roll, no
// save, no target combatant, and no mechanical effect in v1).
//
// CANON CONCENTRATION NOTE: Dancing Lights is the FIRST
// concentration cantrip in the workstream (PHB p.230 duration:
// "1 minute, concentration"). The metadata flag `concentration:
// true` is set to mark this — however, v1 does NOT enforce
// concentration disruption (the engine does not yet model
// concentration checks on damage taken or condition application).
// Documented via the metadata flag
// `dancingLightsConcentrationV1Simplified: true`. This is the
// FIRST cantrip to set `concentration: true` in its metadata;
// future concentration cantrips should mirror this pattern.
//
// v1 simplification: PHB p.230 canonically creates up to 4
// PERSISTENT lights (torches/lanterns/orbs) that hover for 1
// minute. v1 has no persistent-lights subsystem (the engine
// does not model remote light sources that move over time), so
// v1 emits a single "creates dancing lights" flavor log and does
// not track the 4 lights. Documented via the metadata flag
// `dancingLightsPersistentLightsV1Implemented: false`.
//
// v1 simplification: PHB p.230 canonically allows the caster to
// move the lights up to 60 ft as a BONUS ACTION on subsequent
// turns. v1 has no bonus-action-move subsystem, so v1 cannot
// model the subsequent bonus-action moves. Documented via the
// metadata flag `dancingLightsBonusActionMoveV1Implemented: false`.
//
// v1 simplification: PHB p.230 canonically requires the caster
// to maintain CONCENTRATION for the 1-minute duration (the spell
// ends if the caster's concentration is broken by damage or
// conditions). v1 does NOT enforce concentration disruption —
// the engine does not yet model concentration checks. v1 treats
// Dancing Lights as a 1-round non-concentration effect (the
// lights "fade" at the start of the caster's NEXT turn via
// cleanup() — though v1 has no persistent state to clear, so
// cleanup is a no-op). Documented via the metadata flag
// `dancingLightsConcentrationV1Simplified: true`.
//
// v1 simplification: PHB p.230 canonically has each light shed
// DIM LIGHT in a 10-ft radius (a vision/lighting effect). v1 has
// no vision/lighting integration (the engine's computeLOS does
// not model light sources affecting vision), so v1 cannot
// enforce the dim-light radius. Documented via the metadata flag
// `dancingLightsLightRadiusIntegrationV1Implemented: false`
// (mirror Light's `lightVisionIntegrationV1Implemented: false`
// from Session 11).
//
// v1 simplification: PHB p.230 canonically allows the caster to
// either create 4 separate lights OR combine them into 1 glowing
// Medium humanoid form. v1 emits a single "creates dancing lights"
// log event without choosing (the log mentions both forms).
// Documented via the metadata flag
// `dancingLightsCombineFormV1Simplified: true`.
//
// v1 simplification: PHB p.230 canonically has 120 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target points within 120 ft). Documented via the metadata flag
// `dancingLightsRangeEnforcementV1Simplified: true`.
//
// v1 simplification: PHB p.230 canonically requires the lights
// to stay within 20 ft of each other (a light winks out if it
// exceeds the 20-ft proximity requirement). v1 has no proximity-
// check subsystem, so v1 cannot enforce the 20-ft proximity
// requirement. Documented via the metadata flag
// `dancingLightsProximityRequirementV1Simplified: true`.
//
// v1 simplification: PHB p.230 canonically ends when a light
// exceeds the spell's 120-ft range ("a light winks out if it
// exceeds the spell's range"). v1 has no range-enforcement
// subsystem for moving light sources. Documented via the
// metadata flag `dancingLightsRangeEnforcementV1Simplified: true`
// (overlaps with the range-enforcement flag above — both are
// v1 simplifications of the same canon rule).
//
// v1 simplification: PHB p.230 canonically allows the caster to
// dismiss the spell (concentration ends → spell ends). v1 has no
// dismissal action. Documented via the metadata flag
// `dancingLightsDismissalV1Implemented: false`.
//
// Routing (per zHANDOVER-SESSION-13):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Dancing Lights's Action (no target — flavor-only self-buff
//     v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Minor Illusion / Mage Hand / Prestidigitation /
//     Thaumaturgy / Message / Control Flames's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Dancing Lights',
  level: 0,
  school: 'evocation',
  /** Range: 120 ft (PHB p.230 — the lights appear at points within range). */
  rangeFt: 120,
  /**
   * CONCENTRATION — Dancing Lights is the FIRST concentration
   * cantrip in the workstream (PHB p.230 duration: "1 minute,
   * concentration"). The metadata flag `concentration: true` is
   * set to mark this — however, v1 does NOT enforce concentration
   * disruption (the engine does not yet model concentration
   * checks). See `dancingLightsConcentrationV1Simplified: true`
   * for the v1 simplification.
   */
  concentration: true,
  castingTime: 'action',
  /** No damage dice — Dancing Lights is a pure utility (evocation) light effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the lights are flat — 4 torch-sized lights, 10-ft dim radius). */
  scales: false as const,
  /**
   * Components: V + S + M (CANON — 5etools JSON: {"v":true,
   * "s":true,"m":"a bit of phosphorus or wychwood, or a
   * glowworm"}). Cross-checked against the 5etools spell-cache
   * JSON per the Session 13 protocol — the handover also listed
   * V+S+M (phosphorus/wychwood/glowworm), canon confirmed.
   */
  components: { v: true, s: true, m: true } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Dancing Lights v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.230 canonically creates up to 4
   * PERSISTENT lights that hover for 1 minute. v1 has no
   * persistent-lights subsystem (the engine does not model remote
   * light sources that move over time), so v1 emits a single
   * "creates dancing lights" flavor log and does not track the 4
   * lights. Future work: a persistent-lights subsystem that
   * tracks active Dancing Lights instances per caster, their
   * positions, and their lifetime.
   */
  dancingLightsPersistentLightsV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.230 canonically allows the
   * caster to move the lights up to 60 ft as a BONUS ACTION on
   * subsequent turns. v1 has no bonus-action-move subsystem, so
   * v1 cannot model the subsequent bonus-action moves. Future
   * work: a bonus-action-move action that updates the positions
   * of the persistent Dancing Lights instances.
   */
  dancingLightsBonusActionMoveV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.230 canonically requires the
   * caster to maintain CONCENTRATION for the 1-minute duration.
   * v1 does NOT enforce concentration disruption — the engine
   * does not yet model concentration checks on damage taken or
   * condition application. v1 treats Dancing Lights as a 1-round
   * non-concentration effect (the lights "fade" at the start of
   * the caster's NEXT turn via cleanup() — though v1 has no
   * persistent state to clear, so cleanup is a no-op).
   *
   * NOTE: The `concentration: true` metadata flag is still set
   * to mark this as the FIRST concentration cantrip, but v1 does
   * NOT enforce concentration. Future work: a concentration
   * subsystem that triggers a CON save on damage taken and ends
   * the spell on a failed save.
   */
  dancingLightsConcentrationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.230 canonically has each light
   * shed DIM LIGHT in a 10-ft radius (a vision/lighting effect).
   * v1 has no vision/lighting integration (the engine's
   * computeLOS does not model light sources affecting vision),
   * so v1 cannot enforce the dim-light radius. Mirror Light's
   * `lightVisionIntegrationV1Implemented: false` from Session 11.
   * Future work: a vision/lighting subsystem that reads active
   * Dancing Lights instances and adjusts LOS/vision checks.
   */
  dancingLightsLightRadiusIntegrationV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.230 canonically allows the
   * caster to either create 4 separate lights OR combine them
   * into 1 glowing Medium humanoid form. v1 emits a single
   * "creates dancing lights" log event without choosing (the log
   * mentions both forms). Future work: a "form" parameter on the
   * Action (4-lights vs 1-humanoid), with distinct log events.
   */
  dancingLightsCombineFormV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.230 canonically has 120 ft range.
   * v1 does NOT enforce range (the AI/planner is trusted to only
   * target points within 120 ft). Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  dancingLightsRangeEnforcementV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.230 canonically requires the
   * lights to stay within 20 ft of each other (a light winks out
   * if it exceeds the 20-ft proximity requirement). v1 has no
   * proximity-check subsystem, so v1 cannot enforce the 20-ft
   * proximity requirement. Future work: a proximity-check
   * subsystem that tracks light-to-light distances and removes
   * lights that exceed the 20-ft proximity cap.
   */
  dancingLightsProximityRequirementV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.230 canonically allows the
   * caster to dismiss the spell (concentration ends → spell
   * ends). v1 has no dismissal action. Future work: a dismissal
   * action that ends the caster's concentration on Dancing
   * Lights.
   */
  dancingLightsDismissalV1Implemented: false as const,
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
 * Apply Dancing Lights's "self-buff" (v1 flavor-only): emit a
 * single "creates dancing lights" log event. Called via
 * resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * v1 has NO mechanical effect — the log event is the entire
 * effect. The cantrip does NOT set any scratch fields, does NOT
 * modify any combatant state, and does NOT consume any resource
 * beyond the action. The lights "fade" at the start of the
 * caster's NEXT turn (though v1 has no persistent state to clear
 * — cleanup is a no-op).
 *
 * v1 simplification: PHB p.230 canonically creates up to 4
 * PERSISTENT lights that hover for 1 minute and can be moved as
 * a bonus action. v1 emits a single "creates dancing lights"
 * flavor log and does not track the lights. Documented via the
 * metadata flags `dancingLightsPersistentLightsV1Implemented:
 * false` and `dancingLightsBonusActionMoveV1Implemented: false`.
 *
 * v1 simplification: PHB p.230 canonically requires
 * CONCENTRATION. v1 does NOT enforce concentration. Documented
 * via the metadata flag `dancingLightsConcentrationV1Simplified:
 * true`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Dancing Lights — creates up to four torch-sized lights that hover and shed dim light! (v1: flavor-only; persistent lights, bonus-action move, concentration enforcement, light-radius integration, and form choice not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Dancing Lights has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The lights "fade" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Dancing Lights is
 * in the registry.
 *
 * Future work: a persistent-lights subsystem that tracks active
 * Dancing Lights instances and removes them when the spell
 * expires (the cleanup would then remove the lights from the
 * battlefield state).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
