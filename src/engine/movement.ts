// ============================================================
// Movement Subsystem
// Ruleset: PHB 2014 Ch.9, SAC v2.7
// Grid: Chebyshev 3D — diagonals cost same as orthogonal (1 sq = 5ft)
// DMG optional 5/10 diagonal rule is explicitly NOT used.
// ============================================================

import { Vec3, Combatant, Action, Battlefield, TerrainType } from '../types/core';

// ---- Core distance ------------------------------------------

/**
 * Chebyshev 3D distance in grid squares (PHB p.192 default).
 * All directions — orthogonal, diagonal, vertical — cost 1 square.
 */
export function chebyshev3D(a: Vec3, b: Vec3): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

/** Distance in feet (1 square = 5 ft). Uses Chebyshev — the PHB default. */
export function distanceFt(a: Vec3, b: Vec3): number {
  return chebyshev3D(a, b) * 5;
}

/**
 * True Euclidean distance in feet for circle/sphere AoE spells (PHB p.251).
 *
 * Use this for any spell whose area is described as "X-foot radius" (e.g.
 * Arms of Hadar 10-ft, Sleep 20-ft sphere).  Chebyshev produces a square
 * approximation; a true circle rejects the diagonal corners that Chebyshev
 * would include — e.g. a cell 2 squares diagonally away is ~14 ft (out of a
 * 10-ft radius), not 10 ft.
 */
export function euclideanDistFt(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * 5;
}

// ---- Reachability -------------------------------------------

/**
 * Can `attacker` reach `target` with `action` from their current positions?
 * Does NOT check movement — only whether the attack could land right now.
 */
export function canReach(attacker: Combatant, target: Combatant, action: Action): boolean {
  const dist = distanceFt(attacker.pos, target.pos);

  switch (action.attackType) {
    case 'melee':
      return dist <= action.reach;

    case 'ranged':
    case 'spell':
      if (action.range) return dist <= action.range.long;
      return false;

    case 'save':
      // Save-based actions typically have a listed range; treat as ranged
      if (action.range) return dist <= action.range.long;
      // AoE saves often just need to be within the area; treat as melee reach if no range
      return dist <= action.reach;

    case 'special':
    case null:
      // No attack roll — assume always reachable (special handling per action)
      return true;

    default:
      return false;
  }
}

/**
 * Minimum feet of movement needed for attacker to reach target with action.
 * Returns 0 if already in reach.
 */
export function movementNeededToReach(attacker: Combatant, target: Combatant, action: Action): number {
  if (canReach(attacker, target, action)) return 0;
  const dist = distanceFt(attacker.pos, target.pos);
  const effectiveRange = getEffectiveRange(action);
  return Math.max(0, dist - effectiveRange);
}

function getEffectiveRange(action: Action): number {
  switch (action.attackType) {
    case 'melee':     return action.reach;
    case 'ranged':
    case 'spell':
    case 'save':      return action.range?.long ?? action.reach;
    default:          return 999; // special/null — no movement needed
  }
}

// ---- Terrain cost -------------------------------------------

/**
 * Movement cost in feet to enter a single grid square.
 * PHB p.182: difficult terrain costs double (10ft per square instead of 5).
 */
export function squareCostFt(
  terrain: TerrainType,
  isVertical: boolean,
  hasClimbSpeed: boolean
): number {
  let base = 5;
  // Climbing without a climb speed costs double (PHB p.182)
  if (isVertical && !hasClimbSpeed) base *= 2;
  // Difficult terrain doubles the cost (stacks with climb penalty)
  if (terrain === 'difficult' || terrain === 'water') base *= 2;
  return base;
}

// ---- Simple straight-line path cost -------------------------

/**
 * Estimate movement cost in feet from `from` to `to` through terrain.
 * Uses Chebyshev path — walks diagonals first, then straight.
 * This is an estimate for AI planning; the engine resolves exact paths.
 *
 * @param hasClimbSpeed  - does the mover have an explicit climb speed?
 * @param hasSwimSpeed   - does the mover have an explicit swim speed?
 * @param terrainFn      - function returning terrain type for a cell (optional)
 */
export function estimateMoveCostFt(
  from: Vec3,
  to: Vec3,
  hasClimbSpeed: boolean,
  _hasSwimSpeed: boolean,
  terrainFn?: (pos: Vec3) => TerrainType
): number {
  let cost = 0;
  // Snap to integer grid cells. Combat positions are grid cells, but some
  // forced-movement effects (e.g. Thorn Whip's continuous-math pull) can leave a
  // combatant on a fractional position. The step-by-step loop below assumes
  // integer coordinates (it advances by ±1 via Math.sign); with fractional
  // coordinates it overshoots and oscillates forever. Rounding to the nearest
  // cell terminates the loop while preserving the integer-path cost estimate.
  let cur = { x: Math.round(from.x), y: Math.round(from.y), z: Math.round(from.z) };
  const dest = { x: Math.round(to.x), y: Math.round(to.y), z: Math.round(to.z) };

  while (cur.x !== dest.x || cur.y !== dest.y || cur.z !== dest.z) {
    const dx = Math.sign(dest.x - cur.x);
    const dy = Math.sign(dest.y - cur.y);
    const dz = Math.sign(dest.z - cur.z);

    const next: Vec3 = {
      x: cur.x + dx,
      y: cur.y + dy,
      z: cur.z + dz,
    };

    const terrain = terrainFn ? terrainFn(next) : 'normal';
    const isVertical = dz !== 0;
    cost += squareCostFt(terrain, isVertical, hasClimbSpeed);
    cur = next;
  }

  return cost;
}

// ---- Position queries ---------------------------------------

/**
 * Return the position directly adjacent to `target` that minimises
 * movement cost for `mover`. Searches all 26 neighbours (Chebyshev 3D).
 * Skips the target's own square and occupied squares (other combatants).
 */
export function bestAdjacentPos(
  mover: Combatant,
  target: Combatant,
  battlefield: Battlefield
): Vec3 {
  const occupiedKeys = new Set<string>();
  for (const [id, c] of battlefield.combatants) {
    if (id !== mover.id && id !== target.id && !c.isDead) {
      occupiedKeys.add(posKey(c.pos));
    }
  }

  let best: Vec3 | null = null;
  let bestCost = Infinity;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const candidate: Vec3 = {
          x: target.pos.x + dx,
          y: target.pos.y + dy,
          z: target.pos.z + dz,
        };
        if (!inBounds(candidate, battlefield)) continue;
        if (occupiedKeys.has(posKey(candidate))) continue;

        const cost = estimateMoveCostFt(
          mover.pos,
          candidate,
          mover.burrowSpeed !== null,
          mover.swimSpeed !== null
        );
        if (cost < bestCost) {
          bestCost = cost;
          best = candidate;
        }
      }
    }
  }

  // Fallback: stay put if no adjacent cell available
  return best ?? mover.pos;
}

/**
 * Find a position that is within `idealRangeFt` of `target` but outside
 * melee reach of any living enemy. Used by ranged/caster AIs.
 *
 * Returns `mover.pos` if no safe position is found within movement budget.
 */
export function bestRangedPosition(
  mover: Combatant,
  target: Combatant,
  idealRangeFt: number,
  safeDistFromEnemiesFt: number,
  battlefield: Battlefield
): Vec3 {
  const enemies = livingEnemiesOf(mover, battlefield);
  const budget = mover.budget.movementFt;

  let best: Vec3 | null = null;
  let bestScore = -Infinity;

  // Search a grid area around the mover
  const radius = Math.ceil(budget / 5) + 2;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const candidate: Vec3 = { x: mover.pos.x + dx, y: mover.pos.y + dy, z: mover.pos.z };
      if (!inBounds(candidate, battlefield)) continue;
      if (isOccupied(candidate, mover.id, battlefield)) continue;

      const moveCost = estimateMoveCostFt(
        mover.pos, candidate, mover.burrowSpeed !== null, mover.swimSpeed !== null
      );
      if (moveCost > budget) continue;

      const distToTarget = distanceFt(candidate, target.pos);
      if (distToTarget > idealRangeFt) continue;

      // Penalty: any enemy within safeDistFromEnemiesFt
      const minEnemyDist = enemies.reduce(
        (min, e) => Math.min(min, distanceFt(candidate, e.pos)),
        Infinity
      );

      // Score: prefer close to ideal range, far from enemies
      const rangePenalty = Math.abs(distToTarget - idealRangeFt / 2);
      const safetyBonus = Math.min(minEnemyDist, safeDistFromEnemiesFt);
      const score = safetyBonus - rangePenalty;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best ?? mover.pos;
}

// ---- Opportunity Attack -------------------------------------

/**
 * Determine whether `watcher` should trigger an OA against `mover`.
 *
 * PHB p.195 + SAC v2.7:
 * - Triggered when a hostile creature the watcher can SEE leaves melee reach
 * - Moving via teleport, being pushed, or having used Disengage does NOT trigger
 * - OA uses the watcher's REACTION (not Multiattack)
 * - watcher must have an un-used reaction
 */
export function opportunityAttackTriggered(
  watcher: Combatant,
  mover: Combatant,
  fromPos: Vec3,   // mover's position BEFORE the move step
  toPos: Vec3,     // mover's position AFTER the move step
  bf?: Battlefield, // RFC-VISION-AUDIO Phase 3: detection-map visibility check
): boolean {
  if (watcher.budget.reactionUsed) return false;
  if (watcher.isDead || watcher.isUnconscious) return false;
  if (mover.conditions.has('incapacitated')) return false;
  if (mover.conditions.has('unconscious')) return false;

  // Same faction = no OA
  if (watcher.faction === mover.faction) return false;

  // Disengage action prevents OA for the entire turn
  // (tracked externally — caller must have set mover.usedDisengage)
  // We check via a property set on the combatant's turn state:
  if ((mover as MoverWithDisengage).usedDisengage === true) return false;

  // Mover must be leaving the watcher's melee reach
  const wasInReach = distanceFt(watcher.pos, fromPos) <= 5; // 5ft standard melee reach
  const isStillInReach = distanceFt(watcher.pos, toPos) <= 5;

  if (!wasInReach) return false;           // Was never in reach — no trigger
  if (isStillInReach) return false;        // Still in reach — not leaving

  // ── RFC-VISION-AUDIO Phase 3: visibility check via detection map ──
  // A watcher can only make an opportunity attack against a creature they
  // can SEE. Per the 4-state detection model:
  //   'visible'        → OA fires (can see the mover leaving reach)
  //   'position-known' → NO OA (heard but can't see — can't react with a strike)
  //   'hidden'         → NO OA (can't perceive the mover at all)
  //   'unknown'        → NO OA (lost track of the mover)
  //
  // The detection map is refreshed at the start of each combatant's turn by
  // updateDetectionStates(), so it reflects the watcher's perception at the
  // start of the mover's turn. If the mover was visible then, the watcher
  // can react to them leaving reach.
  //
  // Override senses (truesight/blindsight) that detect invisible creatures
  // are already factored into the detection state by getDetectionState().
  // See Invisibility (_seeInvisibilityActive) is also factored in.
  //
  // Legacy fallback: if the detection map is absent (old test factory), fall
  // back to the pre-Phase-3 condition-based check (blinded watcher / invisible
  // mover).
  const detection = watcher.perception?.detection;
  if (detection) {
    const state = detection.get(mover.id) ?? 'unknown';
    return state === 'visible';
  }

  // Legacy fallback (no detection map).
  if (watcher.conditions.has('blinded')) return false;
  if (mover.conditions.has('invisible')) return false;

  return true;
}

/** Temporary marker type — mover.usedDisengage is set by the engine during a turn */
interface MoverWithDisengage extends Combatant {
  usedDisengage?: boolean;
}

/**
 * Select the best OA weapon for `attacker` (not Multiattack, per SAC v2.7).
 * Returns the single highest-damage melee action, or null if none available.
 */
export function selectOAAction(attacker: Combatant): Action | null {
  const melee = attacker.actions.filter(
    a => !a.isMultiattack && a.attackType === 'melee' && a.costType === 'action'
  );
  if (melee.length === 0) return null;

  // Pick highest average damage
  return melee.reduce((best, a) => {
    const bestAvg = best.damage?.average ?? 0;
    const aAvg = a.damage?.average ?? 0;
    return aAvg > bestAvg ? a : best;
  });
}

// ---- Cone AoE geometry --------------------------------------

/**
 * Returns true if `test` position is inside a cone originating at `apex`
 * pointing toward `aimAt`, with the given half-angle and range.
 *
 * D&D 5e SAC cone rule (PHB p.204): at distance d, cone width = d.
 * This yields halfAngle = arctan(0.5) ≈ 26.57°.
 * For Burning Hands (15-ft cone): halfAngleDeg = 26.57, rangeFt = 15.
 *
 * Uses 2D (X/Y plane) for typical flat-grid combat; Z is ignored.
 * The apex cell itself is excluded (caster not caught in own cone).
 */
export function inConeFt(
  apex: Vec3,
  aimAt: Vec3,
  test: Vec3,
  halfAngleDeg: number,
  rangeFt: number,
): boolean {
  const dx = test.x - apex.x;
  const dy = test.y - apex.y;
  const distSq = dx * dx + dy * dy;
  if (distSq < 0.0001) return false;                // apex cell excluded

  const distFt = Math.sqrt(distSq) * 5;
  if (distFt > rangeFt) return false;

  const aimDx = aimAt.x - apex.x;
  const aimDy = aimAt.y - apex.y;
  const aimLen = Math.sqrt(aimDx * aimDx + aimDy * aimDy);
  if (aimLen < 0.0001) return false;                // aiming at self — undefined

  // Dot product of unit vectors
  const dot = (dx * aimDx + dy * aimDy) / (Math.sqrt(distSq) * aimLen);
  const cosHalf = Math.cos((halfAngleDeg * Math.PI) / 180);
  return dot >= cosHalf;
}

/**
 * Is `test` inside a line AoE originating at `origin`, aimed at `aimAt`,
 * with the given length and width?
 *
 * D&D 5e line geometry (PHB p.204 / SAC v2.7):
 *   "A line is an area of effect that extends from one edge of the
 *    caster's space in a direction the caster chooses. A line has a
 *    specified length and a width of 5 feet."
 *
 * v1 implementation: approximate the line as a thin rectangle along
 * the origin→aimAt direction. The rectangle's length is `lengthFt` and
 * its width is `widthFt` (default 5). The line origin is the centre of
 * the caster's space (`origin`); the rectangle is the set of points
 * whose projection onto the line direction is in [0, lengthFt] and
 * whose perpendicular distance is <= widthFt/2.
 *
 * Used by Lightning Bolt (100-ft × 5-ft line, PHB p.255).
 *
 * @param origin    The line's starting position (caster centre).
 * @param aimAt     The line's far-end aim point (determines direction).
 * @param test      The candidate position to test for inclusion.
 * @param lengthFt  Line length in feet (e.g. 100 for Lightning Bolt).
 * @param widthFt   Line width in feet (default 5 per PHB p.204).
 * @returns true if `test` is inside the line rectangle.
 */
export function inLineFt(
  origin: Vec3,
  aimAt: Vec3,
  test: Vec3,
  lengthFt: number,
  widthFt = 5,
): boolean {
  const dx = test.x - origin.x;
  const dy = test.y - origin.y;
  const distSq = dx * dx + dy * dy;
  if (distSq < 0.0001) return false;                // origin cell excluded

  const aimDx = aimAt.x - origin.x;
  const aimDy = aimAt.y - origin.y;
  const aimLen = Math.sqrt(aimDx * aimDx + aimDy * aimDy);
  if (aimLen < 0.0001) return false;                // aiming at self — undefined

  // Direction unit vector (in grid units; 1 grid unit = 5 ft).
  const ux = aimDx / aimLen;
  const uy = aimDy / aimLen;

  // Projection of (test - origin) onto the line direction, in grid units.
  // Convert to feet by multiplying by 5.
  const alongGrid = dx * ux + dy * uy;
  const alongFt = alongGrid * 5;
  if (alongFt < 0 || alongFt > lengthFt) return false;

  // Perpendicular distance from the line, in grid units → feet.
  // |perpGrid| = |dx * uy - dy * ux| (cross product magnitude).
  const perpGrid = Math.abs(dx * uy - dy * ux);
  const perpFt = perpGrid * 5;
  if (perpFt > widthFt / 2) return false;

  return true;
}

// ---- Adjacency helpers --------------------------------------

/** Is `pos` within melee reach (5ft) of `other`? */
export function isAdjacent(pos: Vec3, other: Vec3): boolean {
  return chebyshev3D(pos, other) <= 1;
}

/** Count enemies within melee reach of `combatant`. */
export function adjacentEnemyCount(combatant: Combatant, battlefield: Battlefield): number {
  return livingEnemiesOf(combatant, battlefield).filter(
    e => isAdjacent(combatant.pos, e.pos)
  ).length;
}

/** Count allies (excluding self) within melee reach of `pos`. */
export function alliesAdjacentToPos(
  pos: Vec3,
  forCombatant: Combatant,
  battlefield: Battlefield
): number {
  return livingAlliesOf(forCombatant, battlefield).filter(
    a => a.id !== forCombatant.id && isAdjacent(pos, a.pos)
  ).length;
}

// ---- Faction helpers ----------------------------------------

export function livingEnemiesOf(c: Combatant, bf: Battlefield): Combatant[] {
  return [...bf.combatants.values()].filter(
    x => x.faction !== c.faction && !x.isDead && !x.isUnconscious
  );
}

export function livingAlliesOf(c: Combatant, bf: Battlefield): Combatant[] {
  return [...bf.combatants.values()].filter(
    x => x.faction === c.faction && !x.isDead && !x.isUnconscious
  );
}

// ---- Radius query helpers -----------------------------------

/**
 * Return all living combatants within `radiusFt` feet of `pos` (Chebyshev 3D).
 * Used for spatial queries like "all creatures within a 10-ft radius of X".
 */
export function combatantsWithinRadiusFt(
  pos: Vec3,
  radiusFt: number,
  bf: Battlefield,
): Combatant[] {
  return [...bf.combatants.values()].filter(
    c => !c.isDead && !c.isUnconscious && distanceFt(pos, c.pos) <= radiusFt
  );
}

// ---- Utility ------------------------------------------------

export function posKey(p: Vec3): string {
  return `${p.x},${p.y},${p.z}`;
}

function inBounds(p: Vec3, bf: Battlefield): boolean {
  return p.x >= 0 && p.x < bf.width
      && p.y >= 0 && p.y < bf.height
      && p.z >= 0 && p.z < bf.depth;
}

function isOccupied(p: Vec3, excludeId: string, bf: Battlefield): boolean {
  const key = posKey(p);
  for (const [id, c] of bf.combatants) {
    if (id !== excludeId && !c.isDead && posKey(c.pos) === key) return true;
  }
  return false;
}

// ---- Forced Movement (PHB p.195-196) ------------------------
//
// Forced movement pushes/pulls/throws creatures without using
// their movement speed. It does NOT provoke opportunity attacks.
// The creature is moved involuntarily.
//
// Many spells use forced movement:
//   Thunderwave: push 10 ft
//   Eldritch Blast (Repelling Blast): push 10 ft per beam
//   Gust of Wind: push 15 ft
//   Thorn Whip: pull 10 ft
//   Telekinesis: move 30 ft
//   Whirlwind: ejected upward

/**
 * Apply forced movement to a target creature.
 * Moves the target to the specified position without consuming movement speed.
 * Does NOT provoke opportunity attacks (PHB p.195).
 *
 * For v1, terrain zone damage at the destination is NOT modelled
 * (documented via forcedMoveTerrainCheckV1NotModelled). Terrain zone
 * checks happen at start of turn only.
 *
 * @param target   The creature being moved
 * @param dest     The destination position
 * @returns        The new position (copy of dest)
 */
export function forcedMoveTo(target: Combatant, dest: Vec3): Vec3 {
  if (target.isDead || target.isUnconscious) return { ...target.pos };

  target.pos = { ...dest };
  return target.pos;
}

/**
 * Push a target away from a source position by the given number of feet.
 * Uses Chebyshev distance; direction is computed from source to target.
 *
 * @param target     The creature being pushed
 * @param sourcePos  The position the push originates from
 * @param pushFt     How far to push (in feet)
 * @returns          The new position, or the original position if no push applied
 */
export function pushAway(target: Combatant, sourcePos: Vec3, pushFt: number): Vec3 {
  if (target.isDead || target.isUnconscious) return { ...target.pos };

  const squares = Math.floor(pushFt / 5);
  if (squares <= 0) return { ...target.pos };

  // Direction from source to target
  const dx = target.pos.x - sourcePos.x;
  const dy = target.pos.y - sourcePos.y;

  // Normalize to unit direction (Chebyshev)
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist === 0) return { ...target.pos };  // Same position — no push direction

  const dirX = dx === 0 ? 0 : dx / Math.abs(dx);
  const dirY = dy === 0 ? 0 : dy / Math.abs(dy);

  const dest: Vec3 = {
    x: target.pos.x + dirX * squares,
    y: target.pos.y + dirY * squares,
    z: target.pos.z,
  };

  return forcedMoveTo(target, dest);
}

/**
 * Pull a target toward a source position by the given number of feet.
 * Will not pull past the source position.
 *
 * @param target     The creature being pulled
 * @param sourcePos  The position to pull toward
 * @param pullFt     How far to pull (in feet)
 * @returns          The new position, or the original position if no pull applied
 */
export function pullToward(target: Combatant, sourcePos: Vec3, pullFt: number): Vec3 {
  if (target.isDead || target.isUnconscious) return { ...target.pos };

  const squares = Math.floor(pullFt / 5);
  if (squares <= 0) return { ...target.pos };

  // Direction from target to source (opposite of push)
  const dx = sourcePos.x - target.pos.x;
  const dy = sourcePos.y - target.pos.y;

  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist === 0) return { ...target.pos };

  const dirX = dx === 0 ? 0 : dx / Math.abs(dx);
  const dirY = dy === 0 ? 0 : dy / Math.abs(dy);

  // Don't pull past the source
  const actualSquares = Math.min(squares, dist);

  const dest: Vec3 = {
    x: target.pos.x + dirX * actualSquares,
    y: target.pos.y + dirY * actualSquares,
    z: target.pos.z,
  };

  return forcedMoveTo(target, dest);
}
