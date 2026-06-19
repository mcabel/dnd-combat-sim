// ============================================================
// Minor Illusion — PHB p.260
// Level 0 illusion cantrip
//
// Casting time: action
// Range: 30 feet
// Components: S + M  (CANON — 5etools JSON: {"s":true,
//   "m":"a bit of fleece"}, NO V)
// Duration: 1 minute
// Effect: You create a sound or an image of an object within
//   range that lasts for the duration. The illusion also ends if
//   you dismiss it as an action or cast this spell again.
//   If you create a sound, its volume can range from a whisper
//   to a scream. It can be your voice, someone else's voice, a
//   lion's roar, a beating of drums, or any other sound you
//   choose. The sound continues unabated throughout the duration,
//   or you can make discrete sounds at different times before the
//   spell ends.
//   If you create an image of an object—such as a chair, muddy
//   footprints, or a small chest—it must be no larger than a
//   5-foot cube. The image can't create sound, light, smell, or
//   any other sensory effect. Physical interaction with the image
//   reveals it to be an illusion, because things can pass through
//   it.
//   If a creature uses its action to examine the sound or image,
//   the creature can determine that it is an illusion with a
//   successful Intelligence (Investigation) check against your
//   spell save DC. If a creature discerns the illusion for what
//   it is, the illusion becomes faint to the creature.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "creates an illusion" log event;
// no mechanical effect in v1; routes via CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Minor Illusion is the SEVENTH self-buff cantrip in
// CANTRIP_SELF_EFFECTS (the first six are Blade Ward, Shillelagh,
// True Strike, Resistance, Guidance, Friends). Unlike the others
// (which set a scratch flag for a future choke point to consume),
// Minor Illusion v1 has NO scratch fields and NO mechanical
// effect — it emits a single "creates an illusion" log event and
// that's it. The cantrip is treated as a flavor-only self-buff
// (the "self" in self-buff is loose here — Minor Illusion
// canonically targets a point in space within 30 ft, not the
// caster — but v1 routes it through CANTRIP_SELF_EFFECTS because
// the cantrip has no attack roll, no save, no target combatant,
// and no mechanical effect in v1).
//
// v1 simplification: PHB p.260 canonically allows the caster to
// create a SOUND or an IMAGE (caster's choice). v1 emits a single
// "creates an illusion" log event without distinguishing (the
// log mentions "sound or image"). Documented via the metadata
// flag `illusionSoundVsImageV1Simplified: true`.
//
// v1 simplification: PHB p.260 canonically allows a creature to
// examine the illusion with an INT (Investigation) check vs the
// caster's spell save DC to disbelieve. The rollAbilityCheck()
// choke point now EXISTS in utils.ts (added in Session 14), but
// v1 still skips the Investigation check to disbelieve — it
// requires additional illusion-subsystem state (which illusion
// is in which cell, which creature has examined it, etc.) that
// v1 does not model. v1 also skips the illusion-as-cover
// integration (the engine's computeLOS does not yet model
// illusions-as-cover) and the physical-interaction reveal.
// Documented via the metadata flag `illusionMechanicsV1Implemented:
// false`.
//
// v1 simplification: PHB p.260 canonically lasts 1 minute. v1
// treats Minor Illusion as a 1-round effect (the illusion
// "fades" at the start of the caster's NEXT turn via cleanup() —
// though v1 has no persistent state to clear, so cleanup is a
// no-op). Documented via the metadata flag
// `illusionDurationV1Simplified: true`.
//
// v1 simplification: PHB p.260 canonically has 30 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target points within 30 ft). Documented via the metadata flag
// `illusionRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-11):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Minor Illusion's Action (no target — flavor-only self-buff
//     v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Blade Ward / Shillelagh / True Strike /
//     Resistance / Guidance / Friends's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Minor Illusion',
  level: 0,
  school: 'illusion',
  /** Range: 30 ft (PHB p.260 — the illusion appears at a point within range). */
  rangeFt: 30,
  /** No concentration — Minor Illusion lasts 1 minute (PHB p.260), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Minor Illusion is a pure utility (illusion) effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the illusion effect is binary — either it's there or it isn't). */
  scales: false as const,
  /**
   * Components: S + M (CANON — 5etools JSON: {"s":true,
   * "m":"a bit of fleece"}, NO V). Cross-checked against the
   * 5etools spell-cache JSON per the Session 9 protocol — the
   * handover also listed S+M (bit of fleece, no V), canon
   * confirmed.
   */
  components: { v: false, s: true, m: true } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Minor Illusion v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.260 canonically allows the
   * caster to create a SOUND or an IMAGE (caster's choice). v1
   * emits a single "creates an illusion" log event without
   * distinguishing. Future work: a sound-vs-image choice
   * parameter on the Action, with distinct log events.
   */
  illusionSoundVsImageV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.260 canonically allows a
   * creature to examine the illusion with an INT (Investigation)
   * check vs the caster's spell save DC to disbelieve. The
   * rollAbilityCheck() choke point now EXISTS in utils.ts (added
   * in Session 14), but v1 still skips the Investigation check —
   * it requires additional illusion-subsystem state (which
   * illusion is in which cell, which creature has examined it,
   * etc.) that v1 does not model. v1 also skips the illusion-as-
   * cover integration (the engine's computeLOS does not yet model
   * illusions-as-cover) and the physical-interaction reveal.
   * Future work: an illusions-as-cover subsystem + a physical-
   * interaction reveal hook + illusion-examination state.
   */
  illusionMechanicsV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.260 canonically lasts 1 minute.
   * v1 treats Minor Illusion as a 1-round effect (the illusion
   * "fades" at the start of the caster's NEXT turn via cleanup() —
   * though v1 has no persistent state to clear, so cleanup is a
   * no-op). Future work: a persistent-buff subsystem that tracks
   * 1-minute durations.
   */
  illusionDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.260 canonically has 30 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  illusionRangeEnforcementV1Simplified: true as const,
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
 * Apply Minor Illusion's "self-buff" (v1 flavor-only): emit a
 * single "creates an illusion" log event. Called via
 * resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * v1 has NO mechanical effect — the log event is the entire
 * effect. The cantrip does NOT set any scratch fields, does NOT
 * modify any combatant state, and does NOT consume any resource
 * beyond the action. The illusion "fades" at the start of the
 * caster's NEXT turn (though v1 has no persistent state to clear
 * — cleanup is a no-op).
 *
 * v1 simplification: PHB p.260 canonically allows the caster to
 * create a SOUND or an IMAGE. v1 emits a single "creates an
 * illusion" log event without distinguishing (the log mentions
 * "sound or image"). Documented via the metadata flag
 * `illusionSoundVsImageV1Simplified: true`.
 *
 * v1 simplification: PHB p.260 canonically allows a creature to
 * examine the illusion with an INT (Investigation) check vs the
 * caster's spell save DC to disbelieve. v1 skips this entirely
 * (no rollAbilityCheck choke point exists). Documented via the
 * metadata flag `illusionMechanicsV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Minor Illusion — creates a sound or an image of an object within range that lasts for the duration! (v1: flavor-only; Investigation check, illusion-as-cover, and physical-interaction reveal not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Minor Illusion has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The "illusion fades" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Minor Illusion is
 * in the registry.
 *
 * Future work: a persistent-illusion subsystem that tracks
 * active illusions and clears them when the spell expires (the
 * cleanup would then remove the illusion from the battlefield
 * state).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
