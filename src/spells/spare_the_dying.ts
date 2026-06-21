// ============================================================
// Spare the Dying — PHB p.277
// Level 0 necromancy cantrip
//
// Casting time: action
// Range: Touch (a living creature that has 0 hit points)
// Components: V + S  (CANON — 5etools JSON: {"v":true,"s":true}, NO M)
// Duration: Instant
// Effect: You touch a living creature that has 0 hit points.
//   The creature becomes stable. This spell has no effect on
//   undead or constructs.
//
// ────────────────────────────────────────────────────────────
// Implementation (v1 simplification — instant touch-effect that
// stabilizes a downed PC ally; bypasses resolveAttack entirely):
// ────────────────────────────────────────────────────────────
// Spare the Dying is the FIRST cantrip in CANTRIP_TOUCH_EFFECTS
// (a NEW registry added in Session 11 — non-attack, non-AoE,
// non-self-buff cantrips that target a DOWNED ALLY or willing
// creature). Like the other touch cantrip (Light v1), it routes
// via resolveCantripTouchEffect() in cantrip_effects.ts, which
// executePlannedAction consults AFTER resolveCantripAction
// (self-buffs) and resolveCantripAoE (AoE), but BEFORE the
// target-null guard. This routing is critical: Spare the Dying's
// target is an UNCONCIOUS ally at 0 HP, which the standard
// `if (!target || target.isDead || target.isUnconscious) break;`
// guard would BLOCK. By consulting the touch-effect handler
// BEFORE that guard, Spare the Dying can target downed allies.
//
// v1 simplification: PHB p.277 canonically excludes undead and
// constructs ("This spell has no effect on undead or constructs.").
// v1 does NOT model the type exclusion — the handler stabilizes
// any PC at 0 HP. Documented via the metadata flag
// `spareTheDyingTypeExclusionV1Implemented: false`. The handler
// still fizzles on monsters (PHB p.197: monsters die at 0 HP —
// Spare the Dying has no effect).
//
// v1 simplification: PHB p.277 canonically has Touch range (the
// caster must be adjacent to the downed ally). v1 does NOT
// enforce adjacency (the AI/planner is trusted to only target
// downed allies within 5 ft — the engine's chebyshev3D distance
// check is the AI's responsibility, not the spell module's).
// Documented via the metadata flag
// `spareTheDyingRangeEnforcementV1Simplified: true`.
//
// Stabilize logic (mirror rollDeathSave's "stable" outcome in
// utils.ts):
//   - Set `target._isStabilized = true` (flag for the future
//     death-saves subsystem to read — rollDeathSave currently
//     checks `pc.isUnconscious && !pc.isDead` to decide whether
//     to roll; future work should also check `_isStabilized` to
//     skip the roll).
//   - Reset `target.deathSaves = { successes: 0, failures: 0 }`
//     (mirror rollDeathSave's "stable" outcome — the existing
//     engine reset convention for stable creatures. Clears any
//     pending death-save failures/successes accumulated before
//     stabilization).
//   - Target STAYS at 0 HP and STAYS unconscious (PHB p.197: a
//     stable creature is no longer dying but remains unconscious
//     until healed or until 1d4 hours pass to regain 1 HP — the
//     engine does not model the 1d4-hour natural-recovery rule).
//   - Emit a "stabilized" log event.
//
// Fizzle conditions (the handler returns true but does nothing,
// consuming the action):
//   - Target is a monster at 0 HP (PHB p.197: monsters die at
//     0 HP — Spare the Dying has no effect).
//   - Target is above 0 HP (PHB p.277: "a living creature that
//     has 0 hit points" — only downed creatures can be stabilized).
//   - Target is already dead (HP 0 + isDead — already beyond
//     stabilization).
//
// Routing (per zHANDOVER-SESSION-11):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Spare the Dying's Action and a downed-ally target.
//   - executePlannedAction's `case 'cast':` consults the
//     CANTRIP_TOUCH_EFFECTS registry via
//     resolveCantripTouchEffect(caster, target, actionName, state)
//     AFTER resolveCantripAction (self-buffs) and resolveCantripAoE
//     (AoE), but BEFORE the target-null guard. If the cantrip name
//     is registered, resolveCantripTouchEffect calls the module's
//     applyTouchEffect(caster, target, state) and returns true;
//     the switch breaks (Spare the Dying bypasses resolveAttack
//     entirely — no attack roll, no save).
//   - This is a NEW pattern — distinct from CANTRIP_SELF_EFFECTS
//     (self-buffs, no target) and CANTRIP_AOE_EFFECTS (caster-
//     centered AoE, no single target). CANTRIP_TOUCH_EFFECTS
//     requires a single TARGET (passed to the handler).
//
// No scratch field on the CASTER (the stabilize effect is instant
// and modifies TARGET state directly via `_isStabilized` and
// `deathSaves`). No cleanup needed (the target's stabilized state
// persists until the target is healed or dies — there is no
// 1-round expiration; canonically the stabilize is permanent
// until healed).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Spare the Dying',
  level: 0,
  school: 'necromancy',
  /** Range: Touch (PHB p.277 — caster must be adjacent to the downed ally). */
  rangeFt: 0,
  /** No concentration — Spare the Dying is instant (PHB p.277). */
  concentration: false,
  castingTime: 'action',
  /** No damage dice — Spare the Dying is a pure stabilize effect. */
  damageDice: null,
  damageType: null,
  /** Does NOT scale at 5/11/17 (the stabilize effect is binary — either it stabilizes or it doesn't). */
  scales: false as const,
  /**
   * Components: V + S (CANON — 5etools JSON: {"v":true,"s":true}, NO M).
   * Cross-checked against the 5etools spell-cache JSON per the
   * Session 9 protocol — the handover also listed V+S (no M), canon
   * confirmed.
   */
  components: { v: true, s: true, m: false } as const,
  /**
   * Touch-effect flag — read by the AI/planner to know this is a
   * non-attack, non-AoE, non-self-buff cantrip that targets a
   * downed ally. Routes via CANTRIP_TOUCH_EFFECTS (NOT
   * CANTRIP_SELF_EFFECTS or CANTRIP_AOE_EFFECTS).
   */
  isTouchEffect: true as const,
  /**
   * v1 simplification flag: PHB p.277 canonically excludes undead
   * and constructs ("This spell has no effect on undead or
   * constructs."). Now implemented — the handler checks
   * `target.isUndead` and `target.isConstruct` and fizzles if
   * either is true. The handler still fizzles on monsters
   * (PHB p.197: monsters die at 0 HP — Spare the Dying has no
   * effect).
   */
  spareTheDyingTypeExclusionV1Implemented: true as const,
  /**
   * v1 simplification flag: PHB p.277 canonically has Touch range
   * (the caster must be adjacent to the downed ally). v1 does NOT
   * enforce adjacency — the AI/planner is trusted to only target
   * downed allies within 5 ft. Future work: a range-enforcement
   * check in the touch-effect dispatcher.
   */
  spareTheDyingRangeEnforcementV1Simplified: true as const,
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
 * Apply Spare the Dying's touch-effect: stabilize a downed PC ally.
 * Called via resolveCantripTouchEffect() from CANTRIP_TOUCH_EFFECTS
 * in cantrip_effects.ts, which executePlannedAction consults for
 * touch cantrips (routing them away from resolveAttack and AWAY from
 * the standard target-null/dead/unconscious guard, which would
 * block downed-ally targeting).
 *
 * Stabilize logic (mirror rollDeathSave's "stable" outcome in
 * utils.ts):
 *   - Set `target._isStabilized = true` (flag for the future
 *     death-saves subsystem to read).
 *   - Reset `target.deathSaves = { successes: 0, failures: 0 }`
 *     (mirror rollDeathSave's "stable" outcome — clears any
 *     pending death-save failures/successes).
 *   - Target STAYS at 0 HP and STAYS unconscious (PHB p.197: a
 *     stable creature is no longer dying but remains unconscious).
 *   - Emit a "stabilized" log event.
 *
 * Fizzle conditions (the handler returns true but does nothing,
 * consuming the action — PHB p.277: "This spell has no effect on
 * undead or constructs"; PHB p.197: monsters die at 0 HP):
 *   - Target is a monster at 0 HP (monsters die at 0 HP — Spare
 *     the Dying has no effect).
 *   - Target is above 0 HP (only downed creatures can be
 *     stabilized).
 *   - Target is already dead (already beyond stabilization).
 *
 * @returns true if the touch effect was applied (or fizzled —
 *          either way, the action is consumed and resolveAttack
 *          is bypassed)
 */
export function applyTouchEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // 1. Fizzle: target is already dead (PHB p.277 — "a living
  //    creature" — dead creatures cannot be stabilized).
  if (target.isDead) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Spare the Dying on ${target.name} — no effect (already dead)!`,
      target.id,
    );
    return true;
  }

  // 2. Fizzle: target is a monster at 0 HP (PHB p.197: monsters
  //    die outright at 0 HP — they don't fall unconscious and make
  //    death saves like PCs do, so Spare the Dying has no effect).
  //    Note: in the engine, monsters at 0 HP have `isDead === true`
  //    (set by applyDamage in utils.ts:209-220), so this branch is
  //    a safety net — but it documents the canon exclusion and is
  //    future-proof if the engine ever changes monster death logic.
  if (!target.isPlayer && target.currentHP === 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Spare the Dying on ${target.name} — no effect (monsters die at 0 HP, PHB p.197)!`,
      target.id,
    );
    return true;
  }

  // 3. Fizzle: target is above 0 HP (PHB p.277: "a living creature
  //    that has 0 hit points" — only downed creatures can be
  //    stabilized). The spell is wasted but the action is consumed.
  if (target.currentHP > 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Spare the Dying on ${target.name} — no effect (target is not at 0 HP)!`,
      target.id,
    );
    return true;
  }

  // 4. Fizzle: target is undead or construct (PHB p.277: "This spell has
  //    no effect on undead or constructs.").
  if (target.isUndead || target.isConstruct) {
    emit(
      state, 'action', caster.id,
      `${caster.name} casts Spare the Dying on ${target.name} — no effect (${target.isUndead ? 'undead' : 'construct'}, PHB p.277)!`,
      target.id,
    );
    return true;
  }

  // 5. Stabilize the downed PC ally (PHB p.277: "The creature
  //    becomes stable"). Mirror rollDeathSave's "stable" outcome:
  //    set the flag + reset deathSaves. Target STAYS at 0 HP and
  //    STAYS unconscious.
  target._isStabilized = true;
  if (target.deathSaves) {
    target.deathSaves = { successes: 0, failures: 0 };
  }

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Spare the Dying on ${target.name} — ${target.name} is stabilized! (no longer dying, still at 0 HP)`,
    target.id,
  );

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Spare the Dying has NO scratch
 * fields on the CASTER to clean up — the stabilize effect is
 * instant and modifies TARGET state directly via `_isStabilized`
 * and `deathSaves`. The target's stabilized state persists until
 * the target is healed or dies (there is no 1-round expiration;
 * canonically the stabilize is permanent until healed).
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Spare the Dying is
 * in the registry.
 *
 * Note: this cleanup operates on the CASTER (the combatant whose
 * turn is starting), NOT the target. The caster has no spare-the-
 * dying scratch state to clear.
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields on the caster.
  // The target's `_isStabilized` flag persists until the target
  // is healed (clearing the flag is the heal subsystem's job, not
  // the cantrip cleanup's).
}
