// ============================================================
// Message — PHB p.259
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 120 feet
// Components: V + S + M  (CANON — 5etools JSON: {"v":true,
//   "s":true,"m":"a short piece of copper wire"})
// Duration: 1 round
// Effect: You point your finger toward a creature within range
//   and whisper a message. The target (and only the target)
//   hears the message and can reply in a whisper that only you
//   can hear.
//   You can cast this spell through solid objects if you are
//   familiar with the target and know it is beyond the barrier.
//   Magical silence, 1 foot of stone, 1 inch of common metal, a
//   thin sheet of lead, or 3 feet of wood blocks the spell. The
//   spell doesn't have to follow a straight line and can travel
//   freely around corners or through openings.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "whispers a message to a creature
// within range" log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Message is the ELEVENTH self-buff cantrip in CANTRIP_SELF_EFFECTS
// (the first ten are Blade Ward, Shillelagh, True Strike,
// Resistance, Guidance, Friends, Minor Illusion, Mage Hand,
// Prestidigitation, Thaumaturgy). Like Minor Illusion / Mage Hand
// / Prestidigitation / Thaumaturgy, Message v1 has NO scratch
// fields and NO mechanical effect — it emits a single "whispers a
// message to a creature within range" log event and that's it.
// The cantrip is treated as a flavor-only self-buff (the "self"
// in self-buff is loose here — Message canonically targets a
// creature within 120 ft, not the caster — but v1 routes it
// through CANTRIP_SELF_EFFECTS because the cantrip has no attack
// roll, no save, no target combatant (no HP change, no condition,
// no flag), and no mechanical effect in v1).
//
// v1 simplification: PHB p.259 canonically establishes a POINT-
// TO-POINT communication channel between the caster and a target
// creature (the target hears the message and can reply in a
// whisper only the caster hears). v1 has no communication
// subsystem (the engine does not model point-to-point messaging
// between combatants), so v1 emits a single "whispers a message"
// flavor log and does not track the message content or the
// target's reply. Documented via the metadata flag
// `messageCommunicationV1Implemented: false`.
//
// v1 simplification: PHB p.259 canonically allows the caster to
// cast Message through solid objects IF familiar with the target,
// but BLOCKS the spell if the barrier is magical silence, 1 ft
// stone, 1 inch metal, a thin lead sheet, or 3 ft wood. v1 has
// no barrier-blocking subsystem (the engine's computeLOS does
// model obstacles for vision/cover but not for Message-style
// point-to-point communication), so v1 cannot enforce the
// barrier rules. Documented via the metadata flag
// `messageBarrierBlockingV1Simplified: true`.
//
// v1 simplification: PHB p.259 canonically requires the caster to
// be FAMILIAR with the target to cast through solid objects. v1
// has no familiarity tracking (no "familiarCreatures" list on
// Combatant), so v1 cannot enforce the familiarity requirement.
// Documented via the metadata flag
// `messageFamiliarityRequirementV1Simplified: true`.
//
// v1 simplification: PHB p.259 canonically allows the target to
// REPLY in a whisper only the caster hears. v1 has no reply
// mechanic (no "reply" action, no target-to-caster message
// channel), so v1 cannot model the reply. Documented via the
// metadata flag `messageReplyMechanicV1Implemented: false`.
//
// v1 simplification: PHB p.259 canonically has 120 ft range. v1
// does NOT enforce range (the AI/planner is trusted to only
// target creatures within 120 ft). Documented via the metadata
// flag `messageRangeEnforcementV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-12):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Message's Action (no target — flavor-only self-buff v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Minor Illusion / Mage Hand / Prestidigitation /
//     Thaumaturgy's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Message',
  level: 0,
  school: 'transmutation',
  /** Range: 120 ft (PHB p.259 — the target creature must be within range). */
  rangeFt: 120,
  /** No concentration — Message lasts 1 round (PHB p.259), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Message is a pure utility (transmutation) communication effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the message effect is binary — either it's whispered or it isn't). */
  scales: false as const,
  /**
   * Components: V + S + M (CANON — 5etools JSON: {"v":true,
   * "s":true,"m":"a short piece of copper wire"}). Cross-checked
   * against the 5etools spell-cache JSON per the Session 12
   * protocol — the handover also listed V+S+M (copper wire), canon
   * confirmed.
   */
  components: { v: true, s: true, m: true } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Message v1 is flavor-only (no mechanical
   * effect), routed via CANTRIP_SELF_EFFECTS because it has no
   * attack roll, no save, no target combatant (no HP change, no
   * condition, no flag), and no mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: PHB p.259 canonically establishes a
   * POINT-TO-POINT communication channel between the caster and a
   * target creature (the target hears the message and can reply in
   * a whisper only the caster hears). v1 has no communication
   * subsystem (the engine does not model point-to-point messaging
   * between combatants), so v1 emits a single "whispers a message"
   * flavor log and does not track the message content or the
   * target's reply. Future work: a communication subsystem that
   * tracks active message channels between combatant pairs and
   * exposes a "reply" action to the target.
   */
  messageCommunicationV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.259 canonically BLOCKS the spell
   * if the barrier is magical silence, 1 ft stone, 1 inch metal, a
   * thin lead sheet, or 3 ft wood. v1 has no barrier-blocking
   * subsystem (the engine's computeLOS does model obstacles for
   * vision/cover but not for Message-style point-to-point
   * communication), so v1 cannot enforce the barrier rules. Future
   * work: a barrier-blocking subsystem that checks the caster-to-
   * target line for blocking barriers (mirror computeLOS's
   * obstacle-check pattern).
   */
  messageBarrierBlockingV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.259 canonically requires the
   * caster to be FAMILIAR with the target to cast through solid
   * objects. v1 has no familiarity tracking (no "familiarCreatures"
   * list on Combatant), so v1 cannot enforce the familiarity
   * requirement. Future work: a familiarity-tracking subsystem
   * (e.g. a Set of familiar creature IDs on Combatant, populated
   * by prior interactions).
   */
  messageFamiliarityRequirementV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.259 canonically allows the
   * target to REPLY in a whisper only the caster hears. v1 has no
   * reply mechanic (no "reply" action, no target-to-caster message
   * channel), so v1 cannot model the reply. Future work: a reply
   * action exposed to the target on their next turn (consumes the
   * message channel created on the caster's turn).
   */
  messageReplyMechanicV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.259 canonically has 120 ft range.
   * v1 does NOT enforce range. Future work: a range-enforcement
   * check in the cantrip dispatcher.
   */
  messageRangeEnforcementV1Simplified: true as const,
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
 * Apply Message's "self-buff" (v1 flavor-only): emit a single
 * "whispers a message to a creature within range" log event.
 * Called via resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * v1 has NO mechanical effect — the log event is the entire
 * effect. The cantrip does NOT set any scratch fields, does NOT
 * modify any combatant state, and does NOT consume any resource
 * beyond the action. The message channel "closes" at the start of
 * the caster's NEXT turn (though v1 has no persistent state to
 * clear — cleanup is a no-op; canonically the spell lasts 1 round,
 * which matches v1's 1-round simplification).
 *
 * v1 simplification: PHB p.259 canonically establishes a POINT-
 * TO-POINT communication channel. v1 has no communication
 * subsystem, so v1 emits a single "whispers a message" flavor log
 * and does not track the message content or the target's reply.
 * Documented via the metadata flag
 * `messageCommunicationV1Implemented: false`.
 *
 * v1 simplification: PHB p.259 canonically BLOCKS the spell if
 * the barrier is magical silence, 1 ft stone, 1 inch metal, a
 * thin lead sheet, or 3 ft wood. v1 has no barrier-blocking
 * subsystem. Documented via the metadata flag
 * `messageBarrierBlockingV1Simplified: true`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Message — whispers a message to a creature within range (target hears it and can reply in a whisper only the caster hears)! (v1: flavor-only; point-to-point communication, barrier-blocking, familiarity requirement, and reply mechanic not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Message has NO scratch fields
 * to clean up — v1 is flavor-only with no persistent state. The
 * message channel "closes" at the start of the caster's next turn
 * per the v1 1-round simplification (which matches canon — Message
 * lasts 1 round per PHB p.259), but there's no flag to clear (the
 * log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Message is in the
 * registry.
 *
 * Future work: a communication subsystem that tracks active
 * message channels and closes them when the spell expires (the
 * cleanup would then remove the channel from the battlefield
 * state).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
