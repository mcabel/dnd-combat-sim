// ============================================================
// Mending — PHB p.259
// Level 0 transmutation cantrip
//
// CANON Casting time: 1 MINUTE (NOT 1 action!)
//   (PHB p.259 — 5etools JSON: "time":[{"number":1,"unit":"minute"}])
//   This is the FIRST cantrip with a non-action casting time
//   (1 min = 10 rounds = out-of-combat only per PHB p.192
//   casting-time rules). v1 treats Mending as a standard ACTION
//   for engine simplicity — documented via the metadata flag
//   `mendingCastingTimeV1Simplified: true`.
// Range: Touch
// Components: V + S + M  (CANON — 5etools JSON: {"v":true,
//   "s":true,"m":"two lodestones"})
// Duration: instant
// Effect: This spell repairs a single break or tear in an object
//   you touch, such as broken chain link, two halves of a broken
//   key, a torn cloak, or a leaking wineskin. As long as the
//   break or tear is no larger than 1 foot in any dimension, you
//   mend it, leaving no trace of the former damage.
//   This spell can physically repair a magic item or construct,
//   but the spell can't restore magic to such an object.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — metadata-only touch-effect
// that sets a `_mended` flag on the target; bypasses
// resolveAttack entirely; no save in v1):
// ────────────────────────────────────────────────────────────
// Mending is the THIRD cantrip in CANTRIP_TOUCH_EFFECTS (the first
// two are Spare the Dying and Light). Like Light, Mending routes
// via resolveCantripTouchEffect() in cantrip_effects.ts, which
// executePlannedAction consults AFTER resolveCantripAction
// (self-buffs) and resolveCantripAoE (AoE), but BEFORE the
// target-null guard. This routing is necessary because Mending is
// a non-attack, non-AoE, non-self-buff cantrip that targets a
// single object/creature (the caster touches the target to mend
// it).
//
// v1 simplification: PHB p.259 canonically has a 1-MINUTE casting
// time (the FIRST cantrip with a non-action casting time — 1 min =
// 10 rounds = out-of-combat only per PHB p.192 casting-time
// rules). v1 treats Mending as a standard ACTION for engine
// simplicity (the engine's executePlannedAction assumes a 1-action
// economy; modeling a 10-round casting time would require a new
// "casting-in-progress" state and a concentration-like
// disruption check). Documented via the metadata flag
// `mendingCastingTimeV1Simplified: true`.
//
// v1 simplification: PHB p.259 canonically can "physically repair
// a magic item or construct, but the spell can't restore magic to
// such an object". v1 has no construct-heal subsystem and no
// magic-item-state subsystem, so v1 cannot model either.
// Documented via the metadata flags
// `mendingConstructRepairV1Implemented: false` and
// `mendingMagicItemRestorationV1Implemented: false`.
//
// v1 simplification: PHB p.259 canonically limits the spell to
// "a single break or tear in an object ... no larger than 1 foot
// in any dimension". v1 does NOT model object sizes or break
// dimensions, so v1 cannot enforce this limit. Documented via
// the metadata flag `mendingBreakSizeLimitV1Simplified: true`.
//
// v1 simplification: PHB p.259 canonically has Touch range (the
// caster must be adjacent to the target object). v1 does NOT
// enforce adjacency (the AI/planner is trusted to only target
// objects within 5 ft). Documented via the metadata flag
// `mendingRangeEnforcementV1Simplified: true`.
//
// v1 simplification: the engine does NOT yet model an object-state
// subsystem (no system tracks broken/mended objects — no
// "brokenObject" flag, no "objectHP" field, no repair history).
// v1 sets the `_mended` flag on the target for FORWARD-
// COMPATIBILITY — the future object-state subsystem will read
// this flag and apply appropriate object-state changes (e.g.
// clear a `_broken` flag, restore object HP, etc.). Documented
// via the metadata flag `mendingObjectStateIntegrationV1Implemented:
// false`.
//
// Stabilize logic (v1):
//   - Set `target._mended = true` (forward-compat flag for the
//     future object-state subsystem).
//   - Emit a "repairs a break or tear" log event.
//   - No save, no damage, no attack roll.
//
// Routing (per zHANDOVER-SESSION-12):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Mending's Action and a target (the object/creature to mend).
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_TOUCH_EFFECTS registry via
//     resolveCantripTouchEffect(caster, target, actionName, state)
//     AFTER resolveCantripAction (self-buffs) and resolveCantripAoE
//     (AoE), but BEFORE the target-null guard. If the cantrip name
//     is registered, resolveCantripTouchEffect calls the module's
//     applyTouchEffect(caster, target, state) and returns true;
//     the switch breaks (Mending bypasses resolveAttack entirely
//     — no attack roll, no save in v1).
//   - This mirrors Light's routing exactly.
//
// No scratch field on the CASTER (the mend effect modifies TARGET
// state directly via `_mended`). Cleanup needed (clears the
// target's `_mended` flag at the start of the CASTER's next turn
// — v1 1-round simplification; canonically the spell is INSTANT
// but the cleanup is defensive, matching the other touch cantrip
// patterns).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Mending',
  level: 0,
  school: 'transmutation',
  /** Range: Touch (PHB p.259 — caster must be adjacent to the target object). */
  rangeFt: 0,
  /** No concentration — Mending is instant (PHB p.259), no concentration required. */
  concentration: false,
  /**
   * Casting time: v1 treats Mending as a standard ACTION for
   * engine simplicity. CANON casting time is 1 MINUTE (PHB p.259 —
   * 5etools JSON: "time":[{"number":1,"unit":"minute"}]). This is
   * the FIRST cantrip with a non-action casting time (1 min = 10
   * rounds = out-of-combat only per PHB p.192 casting-time rules).
   * v1 simplification documented via the metadata flag
   * `mendingCastingTimeV1Simplified: true`.
   */
  castingTime: 'action',
  /** No damage dice — Mending is a pure utility (transmutation) effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the mend effect is binary — either it's mended or it isn't). */
  scales: false as const,
  /**
   * Components: V + S + M (CANON — 5etools JSON: {"v":true,
   * "s":true,"m":"two lodestones"}). Cross-checked against the
   * 5etools spell-cache JSON per the Session 12 protocol — the
   * handover also listed V+S+M (two lodestones), canon confirmed.
   */
  components: { v: true, s: true, m: true } as const,
  /**
   * Touch-effect flag — read by the AI/planner to know this is a
   * non-attack, non-AoE, non-self-buff cantrip that targets a
   * single object/creature. Routes via CANTRIP_TOUCH_EFFECTS (NOT
   * CANTRIP_SELF_EFFECTS or CANTRIP_AOE_EFFECTS).
   */
  isTouchEffect: true as const,
  /**
   * v1 simplification flag: CANON casting time is 1 MINUTE (PHB
   * p.259 — the FIRST cantrip with a non-action casting time; 1
   * min = 10 rounds = out-of-combat only per PHB p.192 casting-
   * time rules). v1 treats Mending as a standard ACTION for
   * engine simplicity (the engine's executePlannedAction assumes
   * a 1-action economy; modeling a 10-round casting time would
   * require a new "casting-in-progress" state and a concentration-
   * like disruption check). Future work: a long-casting-time
   * subsystem that consumes 10 rounds and exposes the caster to
   * disruption.
   */
  mendingCastingTimeV1Simplified: true as const,
  /**
   * v1 simplification flag: PHB p.259 canonically can "physically
   * repair a magic item or construct". v1 has no construct-heal
   * subsystem (no construct HP field, no construct repair
   * mechanics). Future work: a construct-repair subsystem that
   * restores construct HP on Mending cast (mirror Healing Word's
   * heal logic, but for constructs only).
   */
  mendingConstructRepairV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.259 canonically can "physically
   * repair a magic item" but "can't restore magic to such an
   * object". v1 has no magic-item-state subsystem (no broken-
   * magic-item flag, no magic-item HP field). Future work: a
   * magic-item-state subsystem that tracks broken magic items
   * and repairs them on Mending cast (without restoring their
   * magical properties).
   */
  mendingMagicItemRestorationV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.259 canonically limits the spell
   * to "a single break or tear in an object ... no larger than 1
   * foot in any dimension". v1 does NOT model object sizes or
   * break dimensions, so v1 cannot enforce this limit. Future
   * work: an object-size subsystem that rejects Mending casts on
   * objects with breaks/tears larger than 1 foot.
   */
  mendingBreakSizeLimitV1Simplified: true as const,
  /**
   * v1 simplification flag: the engine does NOT yet model an
   * object-state subsystem (no system tracks broken/mended
   * objects). v1 sets the `_mended` flag on the target for
   * FORWARD-COMPAT — the future object-state subsystem will read
   * this flag and apply appropriate object-state changes (e.g.
   * clear a `_broken` flag, restore object HP, etc.). Future
   * work: an object-state subsystem that consumes the `_mended`
   * flag (mirror Light's `lightVisionIntegrationV1Implemented:
   * false` forward-compat pattern).
   */
  mendingObjectStateIntegrationV1Implemented: false as const,
  /**
   * v1 simplification flag: PHB p.259 canonically has Touch range
   * (the caster must be adjacent to the target object). v1 does
   * NOT enforce adjacency. Future work: a range-enforcement check
   * in the touch-effect dispatcher.
   */
  mendingRangeEnforcementV1Simplified: true as const,
} as const;

// ---- Local log helper ---------------------------------------

function emit(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  desc: string,
  targetId?: string,
  value?: number,
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description: desc,
  });
}

// ---- applyTouchEffect -----------------------------------------

/**
 * Apply Mending's touch-effect: set the target's `_mended` flag
 * (forward-compat for the future object-state subsystem). Called
 * via resolveCantripTouchEffect() from CANTRIP_TOUCH_EFFECTS in
 * cantrip_effects.ts, which executePlannedAction consults for
 * touch cantrips (routing them away from resolveAttack and AWAY
 * from the standard target-null/dead/unconscious guard).
 *
 * v1 simplification: treat ALL targets as "willing" (no save —
 * Mending has no save in canon either; the spell just repairs
 * the touched object).
 *
 * The `_mended` flag is read by the FUTURE object-state subsystem
 * to apply appropriate object-state changes (e.g. clear a `_broken`
 * flag, restore object HP, etc.). v1 sets the flag but the object-
 * state subsystem does not yet consume it (documented via the
 * metadata flag `mendingObjectStateIntegrationV1Implemented:
 * false`). The flag still clears at the start of the caster's
 * NEXT turn via cleanup() called from resetBudget (v1 1-round
 * simplification — canonically the spell is INSTANT, but v1
 * treats it as a 1-action spell for engine simplicity and clears
 * the flag defensively to match the other touch cantrip patterns).
 *
 * v1 simplification: PHB p.259 canonically has a 1-MINUTE casting
 * time (the FIRST cantrip with a non-action casting time). v1
 * treats Mending as a standard ACTION for engine simplicity.
 * Documented via the metadata flag
 * `mendingCastingTimeV1Simplified: true`.
 *
 * @returns true if the touch effect was applied (the action is
 *          consumed and resolveAttack is bypassed)
 */
export function applyTouchEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // 1. Fizzle: target is dead (can't mend a destroyed object —
  //    PHB p.259 implies the object must be intact enough to be
  //    repaired; a destroyed creature's equipment is lootable but
  //    the creature itself is beyond magical mending). This is a
  //    defensive check — the AI/planner shouldn't target dead
  //    creatures.
  if (target.isDead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Mending on ${target.name} — no effect (target is dead)!`,
      target.id,
    );
    return true;
  }

  // 2. Set the `_mended` flag on the target.
  //    FORWARD-COMPAT: the future object-state subsystem will
  //    read this flag to apply appropriate object-state changes
  //    (e.g. clear a `_broken` flag, restore object HP, etc.).
  //    v1 sets the flag but does not consume it (the integration
  //    is TODO).
  target._mended = true;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Mending on ${target.name} — repairs a single break or tear in ${target.name} (canon casting time: 1 minute; v1: standard action for engine simplicity; construct-repair, magic-item-restoration, and break-size-limit not yet implemented)`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Clears the `_mended` flag on the
 * combatant whose turn is starting (the CASTER, in the normal
 * case — the caster cast Mending last turn, and the buff expires
 * at the start of their next turn per the v1 1-round
 * simplification).
 *
 * NOTE: This cleanup operates on the CASTER (the combatant whose
 * turn is starting), NOT the target. The caster is the one who
 * cast Mending, so the buff's expiration is timed to the caster's
 * next turn. However, the `_mended` flag is set on the TARGET,
 * not the caster. This means the cleanup as written only clears
 * the flag if the CASTER is also the TARGET (self-cast Mending,
 * which is rare — casters usually mend an ally's equipment or an
 * object, not themselves).
 *
 * For v1, this is acceptable — the flag is forward-compat only
 * (no mechanical effect in v1 because the object-state subsystem
 * is not yet implemented). Future work: a persistent-buff
 * subsystem that tracks which combatant holds the `_mended` flag
 * and clears it when the spell expires (whether on the caster's
 * next turn per v1, or instantly per canon — Mending is instant,
 * so canonically there's nothing to clean up; the cleanup is
 * defensive).
 *
 * For maximum safety, the cleanup ALSO clears the flag from ANY
 * combatant that has it set (defensive cleanup — ensures no stale
 * flags persist across turns). This is a no-op if the combatant
 * doesn't have the flag set.
 *
 * v1 simplification: PHB p.259 canonically is INSTANT. v1 clears
 * the flag at the start of the caster's NEXT turn (1-round
 * simplification, defensive cleanup). Documented via the metadata
 * flag `mendingCastingTimeV1Simplified: true`.
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._mended !== undefined) {
    delete combatant._mended;
  }
}
