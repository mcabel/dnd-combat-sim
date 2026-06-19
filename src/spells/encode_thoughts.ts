// ============================================================
// Encode Thoughts — GGR p.47
// Level 0 enchantment cantrip
//
// Casting time: action
// Range: self
// Components: S only  (CANON — 5etools JSON: {"s":true},
//   NO V, NO M)
// Duration: 8 hours
// Effect: Putting a finger to your head, you pull a memory, an
//   idea, or a message from your mind and transform it into a
//   tangible string of glowing energy called a thought strand,
//   which persists for the duration or until you cast this spell
//   again. The thought strand appears in an unoccupied space
//   within 5 feet of you as a Tiny, weightless, semisolid object
//   that can be held and carried like a ribbon. It is otherwise
//   stationary.
//   If you cast this spell while concentrating on a spell or an
//   ability that allows you to read or manipulate the thoughts
//   of others (such as detect thoughts or modify memory), you
//   can transform the thoughts or memories you read, rather than
//   your own, into a thought strand.
//   Casting this spell while holding a thought strand allows you
//   to instantly receive whatever memory, idea, or message the
//   thought strand contains. (Casting detect thoughts on the
//   strand has the same effect.)
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only FLAVOR
// self-buff that emits a single "pulls a memory/idea/message
// from the mind and transforms it into a tangible thought
// strand" log event; no mechanical effect in v1; routes via
// CANTRIP_SELF_EFFECTS):
// ────────────────────────────────────────────────────────────
// Encode Thoughts is the FIFTEENTH self-buff cantrip in
// CANTRIP_SELF_EFFECTS (the first fourteen are Blade Ward,
// Shillelagh, True Strike, Resistance, Guidance, Friends, Minor
// Illusion, Mage Hand, Prestidigitation, Thaumaturgy, Message,
// Control Flames, Dancing Lights, Druidcraft). Like the other
// flavor-only self-buffs, Encode Thoughts v1 has NO scratch
// fields and NO mechanical effect — it emits a single "pulls a
// memory/idea/message from the mind and transforms it into a
// tangible thought strand" log event and that's it. The cantrip
// IS a self-buff in the strict sense (range: self, the strand
// appears within 5 ft of the caster).
//
// CANON SOURCE NOTE: Encode Thoughts is the FIRST GGR-source
// cantrip in the workstream (GGR = Guildmasters' Guide to
// Ravnica, 2018-11-20). All prior cantrips were from PHB (2014),
// XGE (2017), TCE (2020), or EGW (2020). The metadata `source`
// field is implicit — the spell-cache:build script auto-detects
// the canonical source from the 5etools JSON; Encode Thoughts
// is sourced from spells-ggr.json. The GGR source is in-scope
// (pre-2024 canon).
//
// CANON COMPONENTS NOTE: Encode Thoughts is S-only (NO V, NO M)
// per the 5etools JSON {"s":true}. This is the SECOND S-only
// cantrip in the workstream (Control Flames was the first, also
// in this session). The S-only components reflect the spell's
// mental-focus flavor (a single somatic gesture — putting a
// finger to the head — pulls the thought from the mind; no
// incantation, no material component).
//
// CANON DURATION NOTE: Encode Thoughts is the FIRST 8-hour-
// duration cantrip in the workstream (PHB cantrips typically
// last 1 round, 1 minute, or 1 hour; Encode Thoughts lasts
// 8 hours). The metadata `duration` field is implicit — v1 does
// NOT track the 8-hour duration (the strand "fades" at the
// start of the caster's NEXT turn via cleanup() — though v1 has
// no persistent state to clear, so cleanup is a no-op).
//
// v1 simplification: GGR p.47 canonically creates a TANGIBLE
// THOUGHT STRAND object (Tiny, weightless, semisolid, like a
// ribbon) that appears in an unoccupied space within 5 ft of
// the caster. v1 has no thought-strand subsystem (the engine
// does not model tangible spell-created objects that can be
// held/carried), so v1 emits a single "transforms it into a
// tangible thought strand" flavor log and does not track the
// strand. Documented via the metadata flag
// `encodeThoughtsThoughtStrandV1Implemented: false`.
//
// v1 simplification: GGR p.47 canonically allows the caster to
// cast Encode Thoughts while concentrating on a thought-reading
// spell (detect thoughts, modify memory) to transform the
// TARGET'S thoughts into a strand (rather than the caster's
// own). v1 has no thought-reading integration (the engine does
// not model detect thoughts / modify memory), so v1 cannot
// model the thought-reading integration. Documented via the
// metadata flag
// `encodeThoughtsThoughtReadingIntegrationV1Implemented: false`.
//
// v1 simplification: GGR p.47 canonically allows the caster to
// RECEIVE the contents of a thought strand by casting Encode
// Thoughts while holding a strand. v1 has no strand-reception
// subsystem (the engine does not model holding/touching
// thought-strand objects), so v1 cannot model the strand-
// reception. Documented via the metadata flag
// `encodeThoughtsStrandReceptionV1Implemented: false`.
//
// v1 simplification: GGR p.47 canonically lasts 8 hours (or
// until the caster casts this spell again, which ends the
// previous strand). v1 treats Encode Thoughts as a 1-round
// effect (the strand "fades" at the start of the caster's NEXT
// turn via cleanup() — though v1 has no persistent state to
// clear, so cleanup is a no-op). Documented via the metadata
// flag `encodeThoughtsDurationV1Simplified: true`.
//
// v1 simplification: GGR p.47 canonically ends the previous
// strand when the caster casts this spell again ("persists for
// the duration or until you cast this spell again"). v1 has no
// recast-tracking subsystem, so v1 cannot model the recast-
// ends-previous rule. Documented via the metadata flag
// `encodeThoughtsRecastEndsPreviousV1Implemented: false`.
//
// v1 simplification: GGR p.47 canonically has self range (the
// strand appears within 5 ft of the caster). v1 does NOT
// enforce range (the AI/planner is trusted to only cast at the
// caster's position). Documented via the metadata flag
// `encodeThoughtsRangeV1Simplified: true`.
//
// Routing (per zHANDOVER-SESSION-13):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Encode Thoughts's Action (no target — flavor-only self-buff
//     v1).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_SELF_EFFECTS registry via resolveCantripAction()
//     BEFORE the target-null guard and BEFORE resolveAttack.
//     If the cantrip name is registered, resolveCantripAction
//     calls the module's applySelfEffect(caster, state) and
//     returns true; the switch breaks.
//   - This mirrors Minor Illusion / Mage Hand / Prestidigitation
//     / Thaumaturgy / Message / Control Flames / Dancing Lights
//     / Druidcraft's routing exactly.
//
// No scratch fields (v1 has no persistent state). No cleanup
// needed (exported as a no-op for symmetry with the other cantrip
// modules).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Encode Thoughts',
  level: 0,
  school: 'enchantment',
  /**
   * Range: self (GGR p.47 — the thought strand appears within 5 ft
   * of the caster). v1 uses rangeFt = 0 to indicate self range
   * (the strand appears at the caster's position; the 5-ft
   * appearance radius is a v1 simplification — see
   * `encodeThoughtsRangeV1Simplified: true`).
   */
  rangeFt: 0,
  /** No concentration — Encode Thoughts lasts 8 hours (GGR p.47), no concentration required. */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Encode Thoughts is a pure utility (enchantment) thought-strand effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the thought strand is flat — Tiny, weightless, 8 hr). */
  scales: false as const,
  /**
   * Components: S only (CANON — 5etools JSON: {"s":true}, NO V,
   * NO M). Cross-checked against the 5etools spell-cache JSON
   * per the Session 13 protocol — the handover also listed
   * S-only (no V, no M), canon confirmed. THIS IS THE SECOND
   * S-ONLY CANTRIP IN THE WORKSTREAM (Control Flames was the
   * first, also in this session). The S-only components reflect
   * the spell's mental-focus flavor (a single somatic gesture —
   * putting a finger to the head — pulls the thought from the
   * mind; no incantation, no material component).
   */
  components: { v: false, s: true, m: false } as const,
  /**
   * Self-buff flag — read by the AI/planner to know this is a
   * non-attack cantrip. Encode Thoughts v1 is flavor-only (no
   * mechanical effect), routed via CANTRIP_SELF_EFFECTS because
   * it has no attack roll, no save, no target combatant, and no
   * mechanical effect in v1.
   */
  isSelfBuff: true as const,
  /**
   * v1 simplification flag: GGR p.47 canonically creates a
   * TANGIBLE THOUGHT STRAND object (Tiny, weightless, semisolid,
   * like a ribbon) that appears in an unoccupied space within 5
   * ft of the caster. v1 has no thought-strand subsystem (the
   * engine does not model tangible spell-created objects that
   * can be held/carried), so v1 emits a single "transforms it
   * into a tangible thought strand" flavor log and does not
   * track the strand. Future work: a thought-strand subsystem
   * that creates a tangible object on the battlefield, tracks
   * its position/holder, and removes it when the spell expires.
   */
  encodeThoughtsThoughtStrandV1Implemented: false as const,
  /**
   * v1 simplification flag: GGR p.47 canonically allows the
   * caster to cast Encode Thoughts while concentrating on a
   * thought-reading spell (detect thoughts, modify memory) to
   * transform the TARGET'S thoughts into a strand (rather than
   * the caster's own). v1 has no thought-reading integration
   * (the engine does not model detect thoughts / modify memory),
   * so v1 cannot model the thought-reading integration. Future
   * work: a thought-reading integration that detects active
   * thought-reading concentration on the caster and routes the
   * strand's source to the thought-reading target.
   */
  encodeThoughtsThoughtReadingIntegrationV1Implemented: false as const,
  /**
   * v1 simplification flag: GGR p.47 canonically allows the
   * caster to RECEIVE the contents of a thought strand by
   * casting Encode Thoughts while holding a strand. v1 has no
   * strand-reception subsystem (the engine does not model
   * holding/touching thought-strand objects), so v1 cannot
   * model the strand-reception. Future work: a strand-reception
   * subsystem that detects when the caster is holding a strand
   * and emits a "received the strand's contents" log event
   * instead of the standard "pulled a memory from the mind" log.
   */
  encodeThoughtsStrandReceptionV1Implemented: false as const,
  /**
   * v1 simplification flag: GGR p.47 canonically lasts 8 hours
   * (or until the caster casts this spell again). v1 treats
   * Encode Thoughts as a 1-round effect (the strand "fades" at
   * the start of the caster's NEXT turn via cleanup() — though
   * v1 has no persistent state to clear, so cleanup is a no-op).
   * Future work: a persistent-buff subsystem that tracks 8-hour
   * durations (THIS IS THE FIRST 8-HOUR-DURATION CANTRIP IN THE
   * WORKSTREAM).
   */
  encodeThoughtsDurationV1Simplified: true as const,
  /**
   * v1 simplification flag: GGR p.47 canonically ends the
   * previous strand when the caster casts this spell again
   * ("persists for the duration or until you cast this spell
   * again"). v1 has no recast-tracking subsystem, so v1 cannot
   * model the recast-ends-previous rule. Future work: a
   * recast-tracking subsystem that detects repeated Encode
   * Thoughts casts and removes the previous strand.
   */
  encodeThoughtsRecastEndsPreviousV1Implemented: false as const,
  /**
   * v1 simplification flag: GGR p.47 canonically has self range
   * (the strand appears within 5 ft of the caster). v1 does NOT
   * enforce range (the AI/planner is trusted to only cast at the
   * caster's position). Future work: a range-enforcement check
   * in the cantrip dispatcher for the 5-ft appearance radius.
   */
  encodeThoughtsRangeV1Simplified: true as const,
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
 * Apply Encode Thoughts's "self-buff" (v1 flavor-only): emit a
 * single "pulls a memory/idea/message from the mind and
 * transforms it into a tangible thought strand" log event.
 * Called via resolveCantripAction() from CANTRIP_SELF_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * non-attack cantrips (routing them away from resolveAttack).
 *
 * v1 has NO mechanical effect — the log event is the entire
 * effect. The cantrip does NOT set any scratch fields, does NOT
 * modify any combatant state, and does NOT consume any resource
 * beyond the action. The strand "fades" at the start of the
 * caster's NEXT turn (though v1 has no persistent state to clear
 * — cleanup is a no-op).
 *
 * v1 simplification: GGR p.47 canonically creates a TANGIBLE
 * THOUGHT STRAND object. v1 has no thought-strand subsystem.
 * Documented via the metadata flag
 * `encodeThoughtsThoughtStrandV1Implemented: false`.
 *
 * v1 simplification: GGR p.47 canonically lasts 8 hours. v1
 * treats it as a 1-round effect. Documented via the metadata
 * flag `encodeThoughtsDurationV1Simplified: true`.
 *
 * @returns true if the "buff" (log event) was applied
 */
export function applySelfEffect(
  caster: Combatant,
  state: EngineState,
): boolean {
  emit(
    state, 'action', caster.id,
    `${caster.name} casts Encode Thoughts — pulls a memory, idea, or message from the mind and transforms it into a tangible thought strand! (v1: flavor-only; thought-strand object, thought-reading integration, strand reception, 8-hour duration, and recast-ends-previous not yet implemented)`,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Encode Thoughts has NO scratch
 * fields to clean up — v1 is flavor-only with no persistent
 * state. The strand "fades" at the start of the caster's next
 * turn per the v1 1-round simplification (canon lasts 8 hours,
 * v1 simplifies to 1 round), but there's no flag to clear (the
 * log event already happened and can't be undone).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Encode Thoughts is
 * in the registry.
 *
 * Future work: a thought-strand subsystem that tracks active
 * thought strands and removes them when the spell expires (the
 * cleanup would then remove the strand from the battlefield
 * state).
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields, no persistent state.
}
