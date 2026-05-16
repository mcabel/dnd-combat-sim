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

/** Distance in feet (1 square = 5 ft). */
export function distanceFt(a: Vec3, b: Vec3): number {
  return chebyshev3D(a, b) * 5;
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
  let cur = { ...from };

  while (cur.x !== to.x || cur.y !== to.y || cur.z !== to.z) {
    const dx = Math.sign(to.x - cur.x);
    const dy = Math.sign(to.y - cur.y);
    const dz = Math.sign(to.z - cur.z);

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
  toPos: Vec3      // mover's position AFTER the move step
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

  // Watcher must be able to see the mover (simplified: both not blinded)
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
