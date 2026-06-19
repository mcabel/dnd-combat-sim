// ============================================================
// Gust — XGE p.157 (reprinted from EEPC p.19)
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 30 ft
// Components: V + S  (CANON NOTE: the 5etools spell-cache JSON lists
//   {"v":true,"s":true} — NO material component. The Session 10
//   handover mentioned "a legume seed", but that does not appear
//   in the 5etools JSON for XGE p.157. This module follows the
//   canon JSON (V + S only), per the Session 9 protocol of always
//   cross-checking the handover's component list against the
//   5etools spell-cache JSON before implementing.)
// Duration: Instant
//
// Effect (XGE p.157, Mode 2 — combat mode):
//   "One Medium or smaller creature that you choose must succeed
//    on a Strength saving throw or be pushed up to 5 feet away
//    from you."
//
//   (Mode 1: push an unattended 5-ft object 5 ft away — utility,
//    no combat effect on creatures. Mode 3: harmless sensory
//    effect — flavor only. v1 implements ONLY Mode 2; Modes 1
//    and 3 are documented as TODO via the metadata flag
//    `gustUtilityModeV1Implemented: false`.)
//
// Scaling: NONE (Gust does NOT scale at 5/11/17 — the push
//   distance and effect are flat at all levels).
//
// ────────────────────────────────────────────────────────────
// Implementation (push-away forced movement — third of its kind;
// distinct from Thorn Whip / Lightning Lure which pull TOWARD
// the caster, and from Infestation which moves RANDOMLY):
// ────────────────────────────────────────────────────────────
// Gust is the FIRST cantrip with PUSH-AWAY forced movement
// (target moves AWAY from the caster). Thorn Whip / Lightning
// Lure pull the target TOWARD the caster (deterministic
// direction — toward). Infestation rolls 1d4 to pick a RANDOM
// cardinal direction (N/S/E/W). Gust computes the push direction
// as directly AWAY from the caster along the line connecting
// their positions (deterministic direction — away).
//
// Size constraint (canon — distinct from Infestation, which has
// NO size constraint): XGE p.157 says "One Medium or smaller
// creature". v1 implements this canon constraint — only Tiny,
// Small, or Medium creatures can be pushed by Gust. Large+ targets
// are unaffected (mirror Thorn Whip / Lightning Lure's "Large or
// smaller" pattern, but with Medium as the cutoff).
//
// Forced movement semantics (mirror Thorn Whip / Lightning Lure /
// Infestation):
//   - The move modifies `target.pos` DIRECTLY (does NOT call
//     executeMove). This means:
//     * Does NOT provoke opportunity attacks (XGE p.157 explicit)
//     * Does NOT trigger Booming Blade's movement rider
//       (which only fires inside executeMove for willing
//       movement — TCE p.106 "willingly moves")
//     * Does NOT trigger any other willing-movement hooks
//
// Push direction (NEW helper):
//   - `pushAway(caster, target, state)` pushes the target 5 ft
//     (1 grid square) directly AWAY from the caster along the
//     line connecting their positions.
//   - The direction vector is (target.pos - caster.pos),
//     normalized, scaled by 1 grid square (5 ft).
//   - If the caster and target are at the EXACT same position
//     (degenerate case — shouldn't happen in normal combat, but
//     defensive), the push is skipped (no direction defined).
//
// Blocked-destination check (reuse Infestation's helper):
//   - `isDestinationBlocked(from, to, state)` returns true if the
//     destination is off-battlefield OR a movement-blocking
//     obstacle occupies the destination cell.
//   - XGE p.157: if the destination is blocked, the target
//     doesn't move (the spell fizzles the move portion). Gust
//     has NO damage dice — the entire effect is the push.
//
// No scratch fields (movement is instant). No cleanup needed
// (exported as a no-op for symmetry with the other cantrip
// modules).
//
// Routing (per zHANDOVER-SESSION-10):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Gust's Action and a primary target.
//   - executePlannedAction's `case 'cast':` falls through to
//     resolveAttack (Gust is NOT in CANTRIP_SELF_EFFECTS or
//     CANTRIP_AOE_EFFECTS — it's a single-target save cantrip).
//   - resolveAttack's save branch rolls the save; Gust has NO
//     damage field (action.damage = null — the cantrip is pure
//     control), so no damage is applied. Then calls
//     applyCantripEffect (post-save-FAIL dispatcher) for the
//     push-away rider. The rider applies ONLY on save-FAIL.
//
// Registered in CANTRIP_EFFECTS (post-save-FAIL dispatcher).
// ============================================================

import { Combatant, Vec3, Obstacle, CreatureSize } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { isDestinationBlocked } from './infestation';

// ---- Constants ----------------------------------------------

/** Distance the target is pushed on save-FAIL (XGE p.157: "pushed up to 5 feet away"). */
export const GUST_PUSH_FT = 5;

/** Range in feet (XGE p.157: "within range" — 30 ft). */
export const GUST_RANGE_FT = 30;

/** Maximum size that can be pushed by Gust (XGE p.157: "Medium or smaller"). */
export const GUST_MAX_SIZE: CreatureSize = 'Medium';

/** Size categories that can be pushed by Gust (Medium and smaller). */
export const GUST_PUSHABLE_SIZES: readonly CreatureSize[] =
  ['Tiny', 'Small', 'Medium'] as const;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Gust',
  level: 0,
  school: 'transmutation',
  rangeFt: GUST_RANGE_FT,
  concentration: false,
  castingTime: 'action',
  /**
   * Gust has NO damage dice — it's a pure control effect that
   * pushes the target 5 ft away on save-FAIL. The Action's
   * damage field is null (mirror Lightning Lure's null-damage
   * pattern, but without the conditional damage rider — Gust
   * deals no damage at all, ever).
   */
  damageDice: null,
  damageType: null,
  saveAbility: 'str' as const,
  /** Gust does NOT scale at 5/11/17 — the push distance and effect are flat. */
  scales: false as const,
  /**
   * Components: V + S (CANON — 5etools JSON: {"v":true,"s":true}).
   * See module header for the canon-note discrepancy with the
   * Session 10 handover (which mentioned a legume seed M component).
   */
  components: { v: true, s: true, m: false } as const,
  /**
   * Forced-movement distance in feet (XGE p.157). Forced
   * movement — bypasses executeMove, no OAs, no Booming Blade.
   * Distinct from Thorn Whip / Lightning Lure (pull TOWARD
   * caster) and Infestation (RANDOM direction) — Gust pushes
   * AWAY from the caster (deterministic direction).
   */
  moveDistanceFt: GUST_PUSH_FT,
  /**
   * Maximum size that can be pushed by Gust (XGE p.157: "Medium
   * or smaller"). Mirror Thorn Whip / Lightning Lure's
   * size-restriction metadata, but with Medium as the cutoff
   * (vs. Large for Thorn Whip / Lightning Lure, and no constraint
   * for Infestation).
   */
  maxSize: GUST_MAX_SIZE,
  /**
   * v1 simplification flag: XGE p.157 has THREE modes:
   *   Mode 1: push an unattended 5-ft object 5 ft away (utility, no save)
   *   Mode 2: STR save vs push on a creature (COMBAT MODE)
   *   Mode 3: harmless sensory effect (flavor only)
   * v1 implements ONLY Mode 2 (the combat mode). Modes 1 and 3
   * are utility/flavor and have no combat effect on creatures;
   * they are documented as TODO via this flag.
   */
  gustUtilityModeV1Implemented: false as const,
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

// ---- Helper functions ----------------------------------------

/**
 * Check if a combatant's size can be pushed by Gust.
 * XGE p.157: "One Medium or smaller creature" — only Tiny, Small,
 * or Medium creatures can be pushed.
 *
 * @param combatant The combatant to check
 * @returns true if size is Medium or smaller
 */
export function canPushSize(combatant: Combatant): boolean {
  const size = combatant.size ?? 'Medium'; // Default to Medium if not specified
  return GUST_PUSHABLE_SIZES.includes(size);
}

/**
 * Push the target 5 ft (1 grid square) directly AWAY from the
 * caster along the line connecting their positions (forced
 * movement — no OAs, no Booming Blade).
 *
 * Distinct from Thorn Whip / Lightning Lure (pull TOWARD caster)
 * and Infestation (RANDOM cardinal direction). The push direction
 * is deterministic: AWAY from the caster.
 *
 * If the destination is blocked (off-battlefield or wall), the
 * target doesn't move (XGE p.157 — the spell fizzles). The
 * blocked check uses Infestation's `isDestinationBlocked` helper
 * (already exported from infestation.ts).
 *
 * If the target is too large (Large+), the push is skipped with
 * a log (mirror Thorn Whip / Lightning Lure's size-restriction
 * pattern, but with Medium as the cutoff).
 *
 * If the caster and target are at the EXACT same position
 * (degenerate case), the push is skipped (no direction defined).
 *
 * @returns true if the target was actually moved, false if blocked
 *          or skipped (size / same-position)
 */
export function pushAway(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // 1. Size check (canon — XGE p.157: "Medium or smaller").
  if (!canPushSize(target)) {
    emit(
      state, 'action', caster.id,
      `${target.name} is too large to be pushed by ${caster.name}'s Gust!`,
      target.id,
    );
    return false;
  }

  // 2. Compute the push direction: AWAY from the caster.
  //    Direction vector = (target.pos - caster.pos), normalized.
  const dx = target.pos.x - caster.pos.x;
  const dy = target.pos.y - caster.pos.y;
  const dz = target.pos.z - caster.pos.z;
  const gridDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // 3. Degenerate case: caster and target at the exact same position.
  //    No direction defined — skip the push.
  if (gridDist === 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Gust has no effect on ${target.name} — they're in the same space (no push direction)!`,
      target.id,
    );
    return false;
  }

  // 4. Compute the destination: 1 grid square (5 ft) away from
  //    the caster along the line. Round to the nearest grid cell
  //    (battlefield is grid-based).
  const pushGrid = GUST_PUSH_FT / 5; // 1 grid square
  const destX = target.pos.x + (dx / gridDist) * pushGrid;
  const destY = target.pos.y + (dy / gridDist) * pushGrid;
  const destZ = target.pos.z + (dz / gridDist) * pushGrid;

  // Round to nearest integer grid cell (Gust moves in 5-ft increments;
  // the battlefield is grid-based and target.pos uses integer coordinates).
  const to: Vec3 = {
    x: Math.round(destX),
    y: Math.round(destY),
    z: Math.round(destZ),
  };
  const from = { ...target.pos };

  // 5. If the rounded destination equals the current position
  //    (e.g. target already at the edge of where the push would
  //    put it), skip the move.
  if (to.x === from.x && to.y === from.y && to.z === from.z) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Gust hits ${target.name}, but there's no room to push farther!`,
      target.id,
    );
    return false;
  }

  // 6. Blocked-destination check (reuse Infestation's helper).
  if (isDestinationBlocked(from, to, state)) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Gust pushes ${target.name} away, but the destination is blocked — no movement!`,
      target.id,
    );
    return false;
  }

  // 7. Apply the push (forced movement — direct pos set, no executeMove).
  const oldPosStr = `(${from.x}, ${from.y}, ${from.z})`;
  const newPosStr = `(${to.x}, ${to.y}, ${to.z})`;
  target.pos = to;

  emit(
    state, 'move', caster.id,
    `${caster.name}'s Gust pushes ${target.name} 5 ft away! (${oldPosStr} → ${newPosStr})`,
    target.id,
  );

  return true;
}

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Gust's post-fail rider after the target fails its
 * Strength save. Called from resolveAttack's save branch (via
 * cantrip_effects dispatcher) AFTER any damage is dealt (Gust
 * deals no damage — action.damage is null), ONLY when the save
 * failed.
 *
 *   Rider (XGE p.157, Mode 2): target is pushed 5 ft AWAY from
 *      the caster (deterministic direction — distinct from
 *      Infestation's random d4). Forced movement — no OAs, no
 *      Booming Blade. If the destination is blocked, the target
 *      doesn't move. If the target is Large+ (size constraint),
 *      the push is skipped (canon: "Medium or smaller").
 *
 *   Implementation:
 *     1. Check the size constraint (Medium or smaller).
 *     2. Compute the destination (1 square directly away from
 *        the caster along the line connecting their positions).
 *     3. Check if the destination is blocked (off-battlefield
 *        or wall). If blocked, log "no movement" and return.
 *     4. Otherwise, set target.pos DIRECTLY (forced movement —
 *        bypasses executeMove, no OAs, no Booming Blade).
 *
 * @returns true if the rider was applied (regardless of whether
 *          the move actually happened — the size/blocked checks
 *          still "applied" the rider, just with no movement)
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  pushAway(caster, target, state);
  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Gust has NO scratch fields to
 * clean up — the push is instant (forced movement applied
 * immediately). Nothing persists across turns.
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Gust is in the
 * registry.
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields.
}
