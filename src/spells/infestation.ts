// ============================================================
// Infestation — XGE p.158 (reprinted from EEPC p.19)
// Level 0 conjuration cantrip
//
// Casting time: action
// Range: 30 ft
// Components: V + S + M (a living flea)
// Effect: You cause a cloud of mites, fleas, and other parasites
//   to appear momentarily on one creature you can see within
//   range. The target must succeed on a Constitution saving
//   throw, or it takes 1d6 poison damage and moves 5 feet in a
//   RANDOM direction if it can move and its speed is at least
//   5 feet. Roll a d4 for the direction: 1, north; 2, south;
//   3, east; or 4, west. This movement doesn't provoke
//   opportunity attacks, and if the direction rolled is
//   blocked, the target doesn't move.
//
// Scaling: +1d6 at 5th level (2d6), 11th (3d6), 17th (4d6).
//
// ────────────────────────────────────────────────────────────
// Implementation (random-direction forced movement — first of
// its kind; mirrors Thorn Whip / Lightning Lure's forced-
// movement pattern but with a RANDOM direction):
// ────────────────────────────────────────────────────────────
// Infestation is the FIRST cantrip with RANDOM-DIRECTION forced
// movement. Thorn Whip and Lightning Lure pull the target
// TOWARD the caster (deterministic direction). Infestation
// rolls 1d4 to pick one of four cardinal directions (N/S/E/W)
// and moves the target 5 ft (1 square) in that direction.
//
// Forced movement semantics (mirror Thorn Whip / Lightning Lure):
//   - The move modifies `target.pos` DIRECTLY (does NOT call
//     executeMove). This means:
//     * Does NOT provoke opportunity attacks (XGE p.158 explicit)
//     * Does NOT trigger Booming Blade's movement rider
//       (which only fires inside executeMove for willing
//       movement — TCE p.106 "willingly moves")
//     * Does NOT trigger any other willing-movement hooks
//
// Random direction (NEW helper):
//   - `rollRandomDirection()` rolls 1d4 and returns one of
//     'N', 'S', 'E', 'W' with equal probability.
//   - Direction → delta mapping (grid squares, +y = north per
//     PHB convention):
//       N → ( 0, +1, 0)   (1 square north = +5 ft in y)
//       S → ( 0, -1, 0)
//       E → (+1,  0, 0)
//       W → (-1,  0, 0)
//   - The move is 5 ft (1 square). v1 does NOT support
//     multi-square random movement (the spell says 5 ft flat).
//
// Blocked-destination check (NEW helper):
//   - `isDestinationBlocked(pos, state)` returns true if the
//     destination is off-battlefield OR a movement-blocking
//     obstacle occupies the destination cell.
//   - XGE p.158: "if the direction rolled is blocked, the
//     target doesn't move" — the spell fizzles the move
//     portion but the damage still applies (the damage is
//     unconditional on save-FAIL; the move is conditional on
//     the destination being unblocked).
//
// Size constraint: NONE (Infestation works on any size — even
// Gargantuan targets are moved by the parasites; XGE p.158 has
// no size restriction, unlike Thorn Whip / Lightning Lure).
//
// Speed constraint: XGE p.158 says "if it can move and its
// speed is at least 5 feet". v1 simplification: skip the
// speed-0 check (a target with effectiveSpeed=0 due to a
// condition like paralysis would still be moved by the spell —
// the parasite cloud is magical forced movement, not the
// target's own locomotion). Document this as a v1 simplification
// via the metadata flag `infestationSpeedCheckV1Simplified: true`.
// A future batch can add an `effectiveSpeed(target) >= 5` gate
// before applying the move.
//
// Routing (per zHANDOVER-SESSION-9):
//   - The AI planner emits a normal `cast` PlannedAction with
//     Infestation's Action and a primary target.
//   - executePlannedAction's `case 'cast':` falls through to
//     resolveAttack (Infestation is NOT in CANTRIP_SELF_EFFECTS
//     or CANTRIP_AOE_EFFECTS — it's a single-target save cantrip).
//   - resolveAttack's save branch rolls the save, applies 1d6
//     poison damage on save-FAIL (Infestation's Action has a
//     normal damage field — NOT null like Lightning Lure), then
//     calls applyCantripEffect (post-save-FAIL dispatcher) for
//     the random-direction move rider.
//
// Registered in CANTRIP_EFFECTS (post-save-FAIL dispatcher).
// No scratch fields needed — the move is instant (forced
// movement applied immediately), no cleanup.
// ============================================================

import { Combatant, Vec3, Obstacle } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { rollDie } from '../engine/utils';
import { segmentIntersectsAABB } from '../engine/los';

// ---- Constants ----------------------------------------------

/** Distance the target moves on save-FAIL (XGE p.158: "moves 5 feet"). */
export const INFESTATION_MOVE_FT = 5;

/** Range in feet (XGE p.158: "within range" — 30 ft). */
export const INFESTATION_RANGE_FT = 30;

/** Random-direction die size (XGE p.158: "Roll a d4 for the direction"). */
export const INFESTATION_DIRECTION_DIE = 4;

/** Cardinal directions the target can move (N/S/E/W per XGE p.158). */
export type CardinalDirection = 'N' | 'S' | 'E' | 'W';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Infestation',
  level: 0,
  school: 'conjuration',
  rangeFt: INFESTATION_RANGE_FT,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'poison',
  saveAbility: 'con' as const,
  /** Scales at levels 5/11/17 (XGE p.158). */
  scales: true as const,
  scalingLevels: [5, 11, 17] as const,
  scalingDice: ['2d6', '3d6', '4d6'] as const,
  /** Components: V + S + M (a living flea). */
  components: { v: true, s: true, m: true } as const,
  /**
   * Forced-movement distance in feet (XGE p.158). Forced
   * movement — bypasses executeMove, no OAs, no Booming Blade.
   * Distinct from Thorn Whip / Lightning Lure in that the
   * direction is RANDOM (1d4), not toward the caster.
   */
  moveDistanceFt: INFESTATION_MOVE_FT,
  /**
   * v1 simplification flag: XGE p.158 says the move applies only
   * "if it can move and its speed is at least 5 feet". v1 skips
   * the speed check (treats the move as magical forced movement
   * that works regardless of the target's current speed — a
   * paralyzed target would still be moved by the parasite cloud).
   * Future work: add an `effectiveSpeed(target) >= 5` gate.
   */
  infestationSpeedCheckV1Simplified: true as const,
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
 * Roll 1d4 and return one of 'N', 'S', 'E', 'W' with equal
 * probability (XGE p.158: "Roll a d4 for the direction:
 * 1, north; 2, south; 3, east; or 4, west").
 *
 * Exported for testability — the test suite runs a statistical
 * test over 1000 rolls to verify each direction appears roughly
 * 25% of the time (allowing for natural variance).
 */
export function rollRandomDirection(): CardinalDirection {
  const roll = rollDie(INFESTATION_DIRECTION_DIE); // 1..4
  switch (roll) {
    case 1: return 'N';
    case 2: return 'S';
    case 3: return 'E';
    case 4: return 'W';
    default: return 'N'; // unreachable — rollDie(4) returns 1..4
  }
}

/**
 * Convert a cardinal direction to a grid-square delta vector.
 * North = +y (PHB convention: north is "up" on the battle map,
 * which corresponds to increasing y in our coordinate system).
 *
 * Each direction is 1 square = 5 ft of movement.
 */
export function directionToDelta(dir: CardinalDirection): Vec3 {
  switch (dir) {
    case 'N': return { x:  0, y:  1, z: 0 };
    case 'S': return { x:  0, y: -1, z: 0 };
    case 'E': return { x:  1, y:  0, z: 0 };
    case 'W': return { x: -1, y:  0, z: 0 };
  }
}

/**
 * Check if a destination position is blocked — either off the
 * battlefield edge OR inside a movement-blocking obstacle
 * (XGE p.158: "if the direction rolled is blocked, the target
 * doesn't move").
 *
 * The check uses segment-intersection against obstacle AABBs
 * (mirrors isEffectBlocked in los.ts) to detect walls between
 * the target's current position and the destination. If the
 * segment crosses a movement-blocking obstacle, the destination
 * is blocked.
 *
 * Additionally, the destination cell itself is checked against
 * obstacle AABBs (a target can't move INTO a wall).
 *
 * @param from       The target's current position
 * @param to         The proposed destination position
 * @param state      Current engine state (for battlefield bounds
 *                   and obstacles)
 * @returns true if the destination is blocked (no move should
 *          be applied)
 */
export function isDestinationBlocked(
  from: Vec3,
  to: Vec3,
  state: EngineState,
): boolean {
  const bf = state.battlefield;

  // 1. Off-battlefield check: destination must be within the
  //    grid bounds. (z is checked too — a target on the ground
  //    can't move to z=-1.)
  if (to.x < 0 || to.x >= bf.width) return true;
  if (to.y < 0 || to.y >= bf.height) return true;
  if (to.z < 0 || to.z >= bf.depth) return true;

  // 2. Obstacle check: any movement-blocking obstacle that
  //    either contains the destination OR is crossed by the
  //    move segment blocks the move.
  const obstacles: Obstacle[] = bf.obstacles ?? [];
  if (obstacles.length > 0) {
    // Convert to 2D for segment-vs-AABB intersection (z is
    // typically 0 for ground combat; obstacles are also flat).
    const from2d = { x: from.x, y: from.y };
    const to2d = { x: to.x, y: to.y };
    // Destination cell center for "inside obstacle" check.
    const destCenter = { x: to.x + 0.5, y: to.y + 0.5 };

    for (const obs of obstacles) {
      if (obs.isOpen) continue;
      if (!obs.blocksMovement) continue;
      // AABB: x..x+width, y..y+depth (z omitted for 2D)
      const aabb = {
        minX: obs.x,
        minY: obs.y,
        maxX: obs.x + obs.width,
        maxY: obs.y + obs.depth,
      };
      // (a) destination cell center is inside the obstacle
      if (destCenter.x >= aabb.minX && destCenter.x <= aabb.maxX &&
          destCenter.y >= aabb.minY && destCenter.y <= aabb.maxY) {
        return true;
      }
      // (b) the move segment crosses the obstacle
      if (segmentIntersectsAABB(from2d, to2d, aabb)) return true;
    }
  }

  return false;
}

/**
 * Move the target 5 ft (1 grid square) in a random cardinal
 * direction (forced movement — no OAs, no Booming Blade).
 *
 * If the destination is blocked (off-battlefield or wall), the
 * target doesn't move (XGE p.158: "if the direction rolled is
 * blocked, the target doesn't move"). The spell's damage still
 * applies — the move is conditional, the damage is not.
 *
 * @returns the direction rolled (whether or not the move
 *          actually happened), or null if the move was blocked
 */
export function applyRandomMove(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): { direction: CardinalDirection; moved: boolean; destination: Vec3 } | null {
  const dir = rollRandomDirection();
  const delta = directionToDelta(dir);
  const from = { ...target.pos };
  const to: Vec3 = {
    x: target.pos.x + delta.x,
    y: target.pos.y + delta.y,
    z: target.pos.z + delta.z,
  };

  if (isDestinationBlocked(from, to, state)) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Infestation pushes ${target.name} ${dir} but the direction is blocked — no movement! (rolled ${dir})`,
      target.id,
    );
    return { direction: dir, moved: false, destination: from };
  }

  const oldPosStr = `(${from.x}, ${from.y}, ${from.z})`;
  const newPosStr = `(${to.x}, ${to.y}, ${to.z})`;
  target.pos = to;

  emit(
    state, 'move', caster.id,
    `${caster.name}'s Infestation startles ${target.name} — moves 5 ft ${dir}! (${oldPosStr} → ${newPosStr}) (rolled ${dir})`,
    target.id,
  );

  return { direction: dir, moved: true, destination: to };
}

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Infestation's post-fail rider after the target fails
 * its Constitution save. Called from resolveAttack's save branch
 * (via cantrip_effects dispatcher) AFTER damage is dealt, ONLY
 * when the save failed.
 *
 *   Rider (XGE p.158): target moves 5 ft in a RANDOM direction
 *      (roll 1d4: 1=N, 2=S, 3=E, 4=W). Forced movement — no
 *      OAs, no Booming Blade. If the direction rolled is
 *      blocked, the target doesn't move (the damage still
 *      applies; the move is conditional).
 *
 *   Implementation:
 *     1. Roll 1d4 for the direction.
 *     2. Compute the destination (1 square in that direction).
 *     3. Check if the destination is blocked (off-battlefield
 *        or wall). If blocked, log "no movement" and return.
 *     4. Otherwise, set target.pos DIRECTLY (forced movement —
 *        bypasses executeMove, no OAs, no Booming Blade).
 *
 * @returns true if the rider was applied (direction rolled,
 *          regardless of whether the move actually happened)
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  applyRandomMove(caster, target, state);
  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn
 * from resetBudget() in utils.ts. Infestation has NO scratch
 * fields to clean up — the random-direction move is instant
 * (forced movement applied immediately). Nothing persists
 * across turns.
 *
 * Exported for symmetry with the other cantrip cleanup()
 * functions — future cantrip infrastructure may iterate over
 * all cantrip modules' cleanups; this ensures Infestation is
 * in the registry.
 */
export function cleanup(_combatant: Combatant): void {
  // Intentionally empty — no scratch fields.
}
