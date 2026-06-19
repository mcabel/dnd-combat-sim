// ============================================================
// Druidcraft — PHB p.236
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 30 feet
// Components: V + S  (CANON — 5etools JSON: {"v":true,"s":true},
//   NO M)
// Duration: instant
// Effect: Whispering to the spirits of nature, you create one of
//   the following effects within range:
//     - You create a tiny, harmless sensory effect that predicts
//       what the weather will be at your location for the next 24
//       hours. The effect might manifest as a golden orb for
//       clear skies, a cloud for rain, falling snowflakes for
//       snow, and so on. This effect persists for 1 round.
//     - You instantly make a flower blossom, a seed pod open, or
//       a leaf bud bloom.
//     - You create an instantaneous, harmless sensory effect,
//       such as falling leaves, a puff of wind, the sound of a
//       small animal, or the faint odor of skunk. The effect
//       must fit in a 5-foot cube.
//     - You instantly light or snuff out a candle, a torch, or a
//       small campfire.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "whispers to the spirits of
// nature" log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Druidcraft is the FOURTEENTH self-buff cantrip in
// CANTRIP_SELF_EFFECTS (the first thirteen are Blade Ward,
// Shillelagh, True Strike, Resistance, Guidance, Friends, Minor
// Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message,
// Control Flames, Dancing Lights). Like Prestidigitation /
// Thaumaturgy, Druidcraft v1 has NO scratch fields and NO
// mechanical effect — it emits a single "whispers to the spirits
// of nature" log event and that's it. The cantrip is treated as a
// flavor-only self-buff (the "self" in self-buff is loose here —
// Druidcraft canonically targets a point/flower/candle within 30
// ft, not the caster — but v1 routes it through
// CANTRIP_SELF_EFFECTS because the cantrip has no attack roll, no
// save, no target combatant, and no mechanical effect in v1).
//
// Druidcraft is a near-twin of Prestidigitation (arcane) /
// Thaumaturgy (divine) — all three are "minor magical effect,
// choose 1 of N" cantrips. Druidcraft is the nature-themed
// variant (whispers to spirits of nature, weather prediction,
// plant bloom, sensory, light/snuff).
//
// v1 simplification: PHB p.236 canonically allows the caster to
// CHOOSE one of 4 effects (weather prediction, bloom, sensory,
// light/snuff). v1 emits a single "whispers to the spirits of
// nature" log event without choosing (the log mentions all 4
// options). Documented via the metadata flag
// `druidcraftEffectChoiceV1Simplified: true`.
//
// v1 simplification: PHB p.236 canonically allows the caster to
// predict the WEATHER for the next 24 hours (a tiny sensory
// effect persists for 1 round indicating the forecast). v1 has
// no weather subsystem (the engine does not model weather
// forecasts), so v1 cannot model the weather prediction.
// Documented via the metadata flag
// `druidcraftWeatherPredictionV1Implemented: false`.
//
// v1 simplification: PHB p.236 canonically allows the caster to
// instantly bloom a flower / open a seed pod / bloom a leaf bud
// (a plant-growth effect). v1 has no plant-state subsystem (the
// engine does not model plant growth states), so v1 cannot model
// the bloom. Documented via the metadata flag
// `druidcraftPlantGrowthV1Implemented: false`.
//
// v1 simplification: PHB p.236 canonically lasts instant (or 1
// round for the weather-prediction sensory effect). v1 treats
// Druidcraft as a 1-round effect (the effect "fades" at the
// start of the caster's NEXT turn via cleanup() — though v1 has
// no persistent state to clear, so cleanup is a no-op).
// Documented via the metadata flag
// `druidcraftDurationV1Simplified: true`.
//
// v1 simplification: PHB p.236 canonically has 30 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target points within 30 ft). Documented via the metadata flag
// `druidcraftRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-13):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Druidcraft's Action (no target — flavor-only self-buff v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Prestidigitation / Thaumaturgy's routing
//     exactly (Druidcraft is the nature-themed variant).
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Druidcraft',
  level: 0,
  school: 'transmutation',
  /** Range: 30 ft (PHB p.236 — the nature effect appears at a point within range). */
  rangeFt: 30,
  /** No concentration — Druidcraft lasts instant (PHB p.236), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Druidcraft is a pure utility (transmutation) nature effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the 4 nature effects are flat). */
  scales: false as const,
  /**
   * Components: V + S (CANON — 5etools JSON: {"v":true,"s":true},
   * NO M). Cross-checked against the 5etools spell-cache JSON per
   * the Session 13 protocol — the handover also listed V+S (no M),
   * canon confirmed. Druidcraft is a near-twin of Prestidigitation
   * (V+S, no M) and Thaumaturgy (V-only, no S, no M); all three
   * are "minor magical effect, choose 1 of N" cantrips with
   * different themes (arcane / divine / nature).
   */
  components: { v: true, s: true, m: false } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Druidcraft v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.236 canonically allows the
   * caster to CHOOSE one of 4 effects (weather prediction, bloom,
   * sensory, light/snuff). v1 emits a single "whispers to the
   * spirits of nature" log event without choosing (the log
   * mentions all 4 options). Future work: a "choice" parameter
   * on the Action, with distinct log events per choice.
   */
  druidcraftEffectChoiceV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.236 canonically allows the
   * caster to predict the WEATHER for the next 24 hours (a tiny
   * sensory effect persists for 1 round indicating the forecast).
   * v1 has no weather subsystem (the engine does not model
   * weather forecasts), so v1 cannot model the weather
   * prediction. Future work: a weather subsystem that exposes
   * the current/forecast weather to the engine.
   */
  druidcraftWeatherPredictionV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.236 canonically allows the
   * caster to instantly bloom a flower / open a seed pod / bloom
   * a leaf bud (a plant-growth effect). v1 has no plant-state
   * subsystem (the engine does not model plant growth states),
   * so v1 cannot model the bloom. Future work: a plant-state
   * subsystem that tracks per-plant growth states.
   */
  druidcraftPlantGrowthV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.236 canonically lasts instant
   * (or 1 round for the weather-prediction sensory effect). v1
   * treats Druidcraft as a 1-round effect (the effect "fades" at
   * the start of the caster's NEXT turn via cleanup() — though v1
   * has no persistent state to clear, so cleanup is a no-op).
   * Future work: a persistent-buff subsystem that tracks
   * 1-round durations.
   */
  druidcraftDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.236 canonically has 30 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  druidcraftRangeEnforcementV1Simplified: true as const,
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
 * Apply Druidcraft's "self-buff" (v1 flavor-only): emit a single
 * "whispers to the spirits of nature" log event. Called via
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
 * v1 simplification: PHB p.236 canonically allows the caster to
 * CHOOSE one of 4 effects (weather prediction, bloom, sensory,
 * light/snuff). v1 emits a single "whispers to the spirits of
 * nature" log event without choosing (the log mentions all 4
 * options). Documented via the metadata flag
 * `druidcraftEffectChoiceV1Simplified: true`.
 *
 * v1 simplification: PHB p.236 canonically allows weather
 * prediction. v1 has no weather subsystem. Documented via the
 * metadata flag `druidcraftWeatherPredictionV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Druidcraft — whispers to the spirits of nature and creates a minor nature effect (weather prediction, bloom, sensory, or light)! (v1: flavor-only; effect choice, weather prediction, and plant growth not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Druidcraft has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The effect "fades" at the start of the caster's next
 * turn per the v1 1-round simplification, but there's no flag to
 * clear (the log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Druidcraft is in
 * the registry.
 *
 * Future work: a persistent-effect-tracking subsystem that
 * tracks active Druidcraft effects and clears them when they
 * expire (the cleanup would then remove the effect from the
 * caster's active-effects list).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
