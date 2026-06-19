// ============================================================
// Lightning Lure — TCE p.107 (reprinted from SCAG p.143)
// Level 0 evocation cantrip
//
// Casting time: action
// Range: Self (15-ft radius — target must be within 15 ft)
// Components: V (verbal only — no S, no M)
// Effect: You create a lash of lightning energy that strikes
//   at one creature of your choice that you can see within
//   15 feet of you. The target must succeed on a Strength
//   saving throw or be pulled up to 10 feet in a straight
//   line toward you and then take 1d8 lightning damage if
//   it is within 5 feet of you.
//
// Scaling: +1d8 at 5th level (2d8), 11th (3d8), 17th (4d8).
//
// ────────────────────────────────────────────────────────────
// Implementation (save-based pull + conditional damage —
// mirrors Thorn Whip's pull but with a STR save and a
// POSITION-DEPENDENT damage check):
// ────────────────────────────────────────────────────────────
// Lightning Lure is the SECOND cantrip to pull a target toward
// the caster (Thorn Whip was the first, PHB p.282). Key
// differences from Thorn Whip:
//
//   Thorn Whip:      Attack roll → pull Large/smaller on HIT
//                    → 1d6 piercing (always, on hit)
//   Lightning Lure:  STR save → pull Large/smaller on save-FAIL
//                    → 1d8 lightning (CONDITIONALLY: only if
//                    the target ENDS within 5 ft of the caster
//                    after the pull)
//
// This is the FIRST cantrip with CONDITIONAL damage based on
// post-pull position. The damage is rolled AFTER the pull is
// applied, and only if `euclideanDistFt(caster.pos, target.pos)
// <= 5` after the pull.
//
// Forced movement semantics (mirror Thorn Whip):
//   - The pull modifies `target.pos` DIRECTLY (does NOT call
//     executeMove). This means:
//     * Does NOT provoke opportunity attacks (PHB p.190)
//     * Does NOT trigger Booming Blade's movement rider
//       (which only fires inside executeMove for willing
//       movement — TCE p.106 "willingly moves")
//     * Does NOT trigger any other willing-movement hooks
//
// Size constraint: Large or smaller (mirror Thorn Whip's
// canPullSize check). Huge+ targets are NOT pulled and take
// no damage (the pull is the precondition for damage).
//
// Routing (per zHANDOVER-SESSION-8):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Lightning Lure's Action and a primary target.
//   - executePlannedAction's `case 'cast':` falls through to
//     resolveAttack (Lightning Lure is NOT in CANTRIP_SELF_EFFECTS
//     or CANTRIP_AOE_EFFECTS — it's a single-target save cantrip).
//   - resolveAttack's save branch rolls the save, applies damage
//     (1d8 lightning if save FAILS — but the conditional damage
//     semantics mean we want the damage to fire ONLY if the
//     target is within 5 ft AFTER the pull; otherwise NO damage).
//     Problem: the save branch rolls damage BEFORE applyCantripEffect
//     (the pull rider) is called. So if the save-FAIL damage is
//     rolled in resolveAttack, it will ALWAYS apply on save-FAIL
//     regardless of post-pull position.
//   - SOLUTION: Lightning Lure's Action sets `damage = null`
//     (no damage in the Action itself). The pull + conditional
//     damage both happen inside applyCantripEffect (post-save-FAIL
//     dispatcher), which has access to both caster and target.
//     This keeps the engine unchanged and routes the cantrip's
//     entire effect through CANTRIP_EFFECTS — clean architecture.
//     (Mirrors Thorn Whip: Thorn Whip's pull is also in
//     applyCantripEffect, NOT in resolveAttack. Lightning Lure
//     adds the conditional-damage logic to the same handler.)
//
// Registered in CANTRIP_EFFECTS (post-save-FAIL dispatcher).
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie, applyDamageWithTempHP } from '../engine/utils';
import { euclideanDistFt } from '../engine/movement';

// ---- Constants ----------------------------------------------

/** Maximum pull distance in feet (TCE p.107: "up to 10 feet in a straight line toward you"). */
export const LIGHTNING_LURE_PULL_FT = 10;

/** Damage range within which the pulled target must end to take damage (TCE p.107: "if it is within 5 feet of you"). */
export const LIGHTNING_LURE_DAMAGE_RANGE_FT = 5;

/** Maximum size that can be pulled by Lightning Lure (mirror Thorn Whip). */
const MAX_PULL_SIZE = 'Large';

/** Size categories that can be pulled (Large and smaller). */
const PULLABLE_SIZES = ['Tiny', 'Small', 'Medium', 'Large'] as const;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Lightning Lure',
  level: 0,
  school: 'evocation',
  /** Range: Self (15-ft radius — target must be within 15 ft). */
  rangeFt: 15,
  concentration: false,
  castingTime: 'action',
  /**
   * Damage dice listed in metadata for the AI/parser to use when
   * building the Action — but Lightning Lure's Action sets
   * `damage = null` and rolls damage INSIDE applyCantripEffect
   * (post-pull conditional damage). The metadata is here for
   * completeness + the AI planner to estimate expected damage.
   */
  damageDice: '1d8',
  damageType: 'lightning',
  saveAbility: 'str' as const,
  /** Scales at levels 5/11/17 (TCE p.107). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d8', '3d8', '4d8'] as const,
  /** Components: V only (no S, no M). */
  components: { v: true, s: false, m: false } as const,
  /**
   * Pull distance in feet (TCE p.107).
   * Forced movement — bypasses executeMove, no OAs, no Booming Blade.
   */
  pullDistanceFt: LIGHTNING_LURE_PULL_FT,
  /**
   * Size constraint: Large or smaller (mirror Thorn Whip, PHB p.282).
   * Huge+ targets are NOT pulled and take no damage.
   */
  maxPullSize: MAX_PULL_SIZE,
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
 * Check if a combatant's size can be pulled by Lightning Lure
 * (mirror Thorn Whip's canPullSize). @returns true if size is
 * Large or smaller.
 */
export function canPullSize(combatant: Combatant): boolean {
  const size = combatant.size ?? 'Medium'; // Default to Medium if not specified
  return PULLABLE_SIZES.includes(size as any);
}

/**
 * Pull the target toward the caster by up to 10 feet along the
 * line between their positions (forced movement, mirrors Thorn
 * Whip's pullTarget). Stops at 5 ft (adjacent) — does not pull
 * the target PAST the caster.
 *
 * @returns the distance pulled in feet (0 if not pulled — too
 *          large, already adjacent, or no room).
 */
export function pullTarget(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): number {
  // Check size constraint
  if (!canPullSize(target)) {
    emit(
      state, 'action', caster.id,
      `${target.name} is too large to be pulled by ${caster.name}'s Lightning Lure!`,
      target.id,
    );
    return 0;
  }

  const startPos = { ...target.pos };
  const distFt = euclideanDistFt(caster.pos, target.pos);

  // Target is already within 5 ft — no pull needed, but the
  // damage-range check downstream will still fire.
  if (distFt <= LIGHTNING_LURE_DAMAGE_RANGE_FT) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Lightning Lure strikes ${target.name}, but they're already within ${LIGHTNING_LURE_DAMAGE_RANGE_FT} ft — no pull needed!`,
      target.id,
    );
    return 0;
  }

  // Pull up to 10 ft, but stop at 5 ft (adjacent to caster).
  const pullDist = Math.min(LIGHTNING_LURE_PULL_FT, distFt - LIGHTNING_LURE_DAMAGE_RANGE_FT);

  if (pullDist <= 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Lightning Lure strikes ${target.name}, but there's no room to pull closer!`,
      target.id,
    );
    return 0;
  }

  // Calculate new position: move target closer to caster along the line.
  const dx = caster.pos.x - target.pos.x;
  const dy = caster.pos.y - target.pos.y;
  const dz = caster.pos.z - target.pos.z;

  // Convert pull distance from feet to grid units
  const pullGrid = pullDist / 5;

  // Normalize and scale by pull distance
  const gridDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const newX = target.pos.x + (dx / gridDist) * pullGrid;
  const newY = target.pos.y + (dy / gridDist) * pullGrid;
  const newZ = target.pos.z + (dz / gridDist) * pullGrid;

  // Update target position (DIRECT pos set — forced movement,
  // bypasses executeMove, no OAs, no Booming Blade detonation).
  const oldPosStr = `(${startPos.x}, ${startPos.y}, ${startPos.z})`;
  const newPosStr = `(${newX.toFixed(1)}, ${newY.toFixed(1)}, ${newZ.toFixed(1)})`;
  target.pos = { x: newX, y: newY, z: newZ };

  emit(
    state, 'move', caster.id,
    `${caster.name}'s Lightning Lure pulls ${target.name} ${pullDist.toFixed(0)} ft closer! (${oldPosStr} → ${newPosStr})`,
    target.id,
  );

  return pullDist;
}

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Lightning Lure's post-fail rider after the target fails
 * its Strength save. Called from resolveAttack's save branch
 * (via cantrip_effects dispatcher) AFTER damage is dealt, ONLY
 * when the save failed.
 *
 *   Rider (TCE p.107):
 *     1. Pull target up to 10 ft in a straight line toward
 *        the caster (forced movement — no OAs, no Booming Blade
 *        detonation).
 *     2. After the pull, if the target is within 5 ft of the
 *        caster, roll 1d8 lightning damage (scales with caster
 *        level) and apply it.
 *
 *   Implementation notes:
 *     - Lightning Lure's Action sets `damage = null` so resolveAttack's
 *       save branch does NOT roll damage — all damage rolls here,
 *       AFTER the pull, conditioned on the post-pull position.
 *     - The damage dice count scales with caster level (1d8 → 2d8
 *       → 3d8 → 4d8 at 5/11/17). The AI/parser sets this via a
 *       custom Action field, OR v1 uses the default 1d8 (mirror
 *       Thunderclap which reads dmgCount from action.damage.count).
 *       Here we look up the cantrip Action on the caster's action
 *       list to read the scaled damage dice count.
 *
 * @returns true if the rider was applied (pull happened, damage
 *          may or may not have been dealt depending on position)
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // Step 1: Pull the target toward the caster (forced movement).
  // If the target is Huge+ or already within 5 ft, the pull is a
  // no-op (returns 0). The size constraint is checked inside
  // pullTarget.
  pullTarget(caster, target, state);

  // Step 2: Check post-pull position. If the target is now within
  // 5 ft of the caster, roll 1d8 (scales) lightning damage and
  // apply. If the target is Huge+ and was NOT pulled, OR was
  // pulled but not all the way to within 5 ft, no damage.
  const postPullDistFt = euclideanDistFt(caster.pos, target.pos);
  if (postPullDistFt <= LIGHTNING_LURE_DAMAGE_RANGE_FT) {
    // Read scaled damage dice count from the cantrip Action on
    // the caster's action list (mirror Thunderclap). v1 default
    // is 1d8 if the Action is missing or has no damage field.
    const action = caster.actions.find(a => a.name === 'Lightning Lure');
    const dmgCount = action?.damage?.count ?? 1;
    const dmgSides = action?.damage?.sides ?? 8;

    let dmgRoll = 0;
    for (let i = 0; i < dmgCount; i++) dmgRoll += rollDie(dmgSides);

    const dealt = applyDamageWithTempHP(target, dmgRoll, 'lightning');
    emit(
      state, 'damage', caster.id,
      `${caster.name}'s Lightning Lure shocks ${target.name} (now within ${LIGHTNING_LURE_DAMAGE_RANGE_FT} ft) — ${dealt} lightning damage! (rolled ${dmgRoll} on ${dmgCount}d${dmgSides})`,
      target.id,
      dealt,
    );
  } else {
    emit(
      state, 'action', caster.id,
      `${target.name} was pulled but ended up ${postPullDistFt.toFixed(0)} ft away — out of Lightning Lure's damage range (no damage).`,
      target.id,
    );
  }

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Lightning Lure has NO scratch
 * fields to clean up — the pull is instant (forced movement
 * applied immediately) and the damage is rolled immediately.
 * Nothing persists across turns.
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Lightning Lure
 * is in the registry.
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields.
}
