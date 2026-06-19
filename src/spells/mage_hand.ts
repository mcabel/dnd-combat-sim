// ============================================================
// Mage Hand — PHB p.256
// Level 0 conjuration cantrip
//
// Casting time: action
// Range: 30 feet
// Components: V + S  (CANON — 5etools JSON: {"v":true,"s":true},
//   NO M)
// Duration: 1 minute
// Effect: A spectral, floating hand appears at a point you choose
//   within range. The hand lasts for the duration or until you
//   dismiss it as an action. The hand vanishes if it is ever more
//   than 30 feet away from you or if you cast this spell again.
//   You can use your action to control the hand. You can use the
//   hand to manipulate an object, open an unlocked door or
//   container, stow or retrieve an item from an open container,
//   or pour the contents out of a vial. You can move the hand up
//   to 30 feet each time you use it.
//   The hand can't attack, activate magic items, or carry more
//   than 10 pounds.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "spectral floating hand appears"
// log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Mage Hand is the EIGHTH self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first seven are Blade Ward, Shillelagh, True Strike,
// Resistance, Guidance, Friends, Minor Illusion). Like Minor
// Illusion, Mage Hand v1 has NO scratch fields and NO mechanical
// effect — it emits a single "spectral floating hand appears" log
// event and that's it. The cantrip is treated as a flavor-only
// self-buff (the "self" in self-buff is loose here — Mage Hand
// canonically conjures a spectral hand at a point in space within
// 30 ft, not on the caster — but v1 routes it through
// CANTRIP_SELF_EFFECTS because the cantrip has no attack roll, no
// save, no target combatant, and no mechanical effect in v1).
//
// v1 simplification: PHB p.256 canonically conjures a PERSISTENT
// spectral hand that the caster can control with subsequent actions
// (the hand lasts 1 minute / 10 rounds). v1 skips the persistent-
// hand subsystem entirely — the engine does not yet model remote
// object manipulation, so v1 emits a single "spectral floating
// hand appears" flavor log and the hand is never tracked beyond
// that. Documented via the metadata flag
// `mageHandPersistentHandV1Simplified: true`.
//
// v1 simplification: PHB p.256 canonically allows the caster to
// use subsequent actions to CONTROL the hand (manipulate objects,
// open doors, stow/retrieve items, pour vials, move the hand 30
// ft). v1 has no remote-interaction subsystem, so v1 cannot model
// these subsequent actions. Documented via the metadata flag
// `mageHandRemoteInteractionV1Implemented: false`.
//
// v1 simplification: PHB p.256 canonically allows the caster to
// "dismiss it as an action". v1 has no dismissal action (the hand
// "fades" at the start of the caster's NEXT turn via cleanup() —
// though v1 has no persistent state to clear, so cleanup is a
// no-op). Documented via the metadata flag
// `mageHandDismissalV1Implemented: false`.
//
// v1 simplification: PHB p.256 canonically imposes a 10-pound
// carry limit on the hand ("The hand can't ... carry more than 10
// pounds."). v1 has no carry-weight subsystem, so v1 cannot enforce
// this limit. Documented via the metadata flag
// `mageHandCarryWeightLimitV1Implemented: false`.
//
// v1 simplification: PHB p.256 canonically lasts 1 minute. v1
// treats Mage Hand as a 1-round effect (the hand "fades" at the
// start of the caster's NEXT turn via cleanup() — though v1 has no
// persistent state to clear, so cleanup is a no-op). Documented
// via the metadata flag `mageHandDurationV1Simplified: true`.
//
// v1 simplification: PHB p.256 canonically has 30 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only target
// points within 30 ft). Documented via the metadata flag
// `mageHandRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-12):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Mage Hand's Action (no target — flavor-only self-buff v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Minor Illusion's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mage Hand',
  level: 0,
  school: 'conjuration',
  /** Range: 30 ft (PHB p.256 — the spectral hand appears at a point within range). */
  rangeFt: 30,
  /** No concentration — Mage Hand lasts 1 minute (PHB p.256), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Mage Hand is a pure utility (conjuration) effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the hand's capabilities are flat — 10 lb carry, 30 ft move). */
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
   * non-attack cantrip. Mage Hand v1 is flavor-only (no mechanical
   * effect), routed via CANTRIP_SELF_EFFECTS because it has no
   * attack roll, no save, no target combatant, and no mechanical
   * effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.256 canonically conjures a
   * PERSISTENT spectral hand that the caster can control with
   * subsequent actions (the hand lasts 1 minute / 10 rounds). v1
   * skips the persistent-hand subsystem entirely — the engine does
   * not yet model remote object manipulation, so v1 emits a single
   * "spectral floating hand appears" flavor log and the hand is
   * never tracked beyond that. Future work: a persistent-hand
   * subsystem that tracks the hand's position, control-action
   * cost, and dismiss action.
   */
  mageHandPersistentHandV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.256 canonically allows the caster
   * to use subsequent actions to CONTROL the hand (manipulate
   * objects, open doors, stow/retrieve items, pour vials, move the
   * hand 30 ft). v1 has no remote-interaction subsystem, so v1
   * cannot model these subsequent actions. Future work: a remote-
   * interaction subsystem that accepts "control Mage Hand" as an
   * action with a target object/point and a verb (manipulate/open/
   * stow/retrieve/pour/move).
   */
  mageHandRemoteInteractionV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.256 canonically allows the caster
   * to "dismiss it as an action". v1 has no dismissal action (the
   * hand "fades" at the start of the caster's NEXT turn via
   * cleanup() — though v1 has no persistent state to clear, so
   * cleanup is a no-op). Future work: a dismissal action that
   * clears the hand's persistent state.
   */
  mageHandDismissalV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.256 canonically imposes a
   * 10-pound carry limit on the hand ("The hand can't ... carry
   * more than 10 pounds."). v1 has no carry-weight subsystem, so
   * v1 cannot enforce this limit. Future work: a carry-weight
   * subsystem that rejects attempts to lift objects over 10 lb.
   */
  mageHandCarryWeightLimitV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.256 canonically lasts 1 minute.
   * v1 treats Mage Hand as a 1-round effect (the hand "fades" at
   * the start of the caster's NEXT turn via cleanup() — though v1
   * has no persistent state to clear, so cleanup is a no-op).
   * Future work: a persistent-buff subsystem that tracks 1-minute
   * durations.
   */
  mageHandDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.256 canonically has 30 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  mageHandRangeEnforcementV1Simplified: true as const,
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
 * Apply Mage Hand's "self-buff" (v1 flavor-only): emit a single
 * "spectral floating hand appears" log event. Called via
 * resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * v1 has NO mechanical effect — the log event is the entire
 * effect. The cantrip does NOT set any scratch fields, does NOT
 * modify any combatant state, and does NOT consume any resource
 * beyond the action. The spectral hand "fades" at the start of
 * the caster's NEXT turn (though v1 has no persistent state to
 * clear — cleanup is a no-op).
 *
 * v1 simplification: PHB p.256 canonically conjures a PERSISTENT
 * spectral hand that the caster can control with subsequent
 * actions. v1 skips the persistent-hand subsystem entirely
 * (no remote-interaction subsystem). Documented via the metadata
 * flags `mageHandPersistentHandV1Simplified: true` and
 * `mageHandRemoteInteractionV1Implemented: false`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mage Hand — a spectral floating hand appears at a point within range! (v1: flavor-only; persistent-hand control, dismissal, and 10-lb carry limit not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Mage Hand has NO scratch fields
 * to clean up — v1 is flavor-only with no persistent state. The
 * "hand fades" at the start of the caster's next turn per the v1
 * 1-round simplification, but there's no flag to clear (the log
 * event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Mage Hand is in the
 * registry.
 *
 * Future work: a persistent-hand subsystem that tracks active
 * Mage Hand instances and clears them when the spell expires
 * (the cleanup would then remove the hand from the battlefield
 * state).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
