/**
 * src/engine/los.ts
 * Line-of-Sight and Cover — LV1 (2D, flat grid)
 *
 * Ruleset: PHB 2014 Ch.10 / DMG Ch.8 / SAC v2.7
 *
 * Precision Tier LV1:
 *   Source nodes = 4 corners of attacker's base footprint (continuous coords)
 *   Target nodes = 4 corners of target's base footprint
 *   Best source corner (most unobstructed effect-paths to target corners) → cover state
 *
 * Cover table (DMG Ch.8 p.196):
 *   4/4 clear → No Cover        (0 AC bonus)
 *   2–3/4 → Half Cover          (+2 AC, +2 DEX saves — PHB p.196)
 *   1/4 → Three-Quarters Cover  (+5 AC, +5 DEX saves — PHB p.196)
 *   0/4 → Total Cover           (cannot be targeted — PHB p.196)
 *
 * Notes:
 *   • Creature-as-cover is deferred (only static Obstacle objects are evaluated).
 *   • Z-axis / 3D is deferred (only X/Y plane is evaluated).
 *   • If bf.obstacles is absent or empty, open-field result is returned immediately.
 */

import { Combatant, Battlefield, Obstacle, CreatureSize } from '../types/core';

// ─── Geometry Primitives ─────────────────────────────────────────────────────

interface Vec2 { x: number; y: number; }
interface AABB2D { minX: number; minY: number; maxX: number; maxY: number; }

// ─── LOS Result ──────────────────────────────────────────────────────────────

export type CoverState = 'none' | 'half' | 'three-quarters' | 'total';

/**
 * Full result of a LOS/cover check between two combatants.
 *
 * hasLineOfEffect  false → Total Cover; target cannot be attacked at all.
 * hasLineOfSight   false → Vision blocked (fog cloud, magical darkness, etc.);
 *                          attacks have Disadvantage (independent of cover).
 * cover            Enum of the cover state derived from best ray count.
 * coverACBonus     Flat bonus to add to target's effective AC (and DEX saves).
 */
export interface LOSResult {
  hasLineOfEffect: boolean;
  hasLineOfSight:  boolean;
  cover:           CoverState;
  coverACBonus:    number;     // 0 | 2 | 5
}

// ─── Open-Field Constant ─────────────────────────────────────────────────────

const OPEN_FIELD: LOSResult = {
  hasLineOfEffect: true,
  hasLineOfSight:  true,
  cover:           'none',
  coverACBonus:    0,
};

// ─── Epsilon ─────────────────────────────────────────────────────────────────

/**
 * Obstacles are inset by EPSILON before the intersection test so that rays
 * which exactly graze a corner or edge count as CLEAR (PHB: the attacker
 * may choose any ray that is not obstructed).
 */
const EPSILON = 1e-6;

// ─── Size → Footprint ────────────────────────────────────────────────────────

/**
 * Returns the side length of a creature's AABB footprint in grid squares.
 * Defaults to 1 (Medium) for any unknown or undefined size.
 *
 * Tiny special case: modelled as a 0.5 × 0.5 box centred in the square
 * because Tiny creatures share a grid square (PHB p.191).
 */
export function getSizeFootprint(size: CreatureSize | undefined): number {
  switch (size) {
    case 'Tiny':       return 0.5;
    case 'Small':      return 1;
    case 'Medium':     return 1;
    case 'Large':      return 2;
    case 'Huge':       return 3;
    case 'Gargantuan': return 4;
    default:           return 1;
  }
}

// ─── AABB Helpers ────────────────────────────────────────────────────────────

/**
 * AABB for a combatant in continuous grid coordinates.
 * pos.x / pos.y are integer grid squares; the footprint extends to the right and down.
 *
 * Examples (fp = footprint):
 *   Medium at (3, 2): minX=3, minY=2, maxX=4, maxY=3
 *   Large  at (3, 2): minX=3, minY=2, maxX=5, maxY=5
 *   Tiny   at (3, 2): minX=3.25, minY=2.25, maxX=3.75, maxY=2.75
 */
export function getCombatantAABB(c: Combatant): AABB2D {
  const fp = getSizeFootprint(c.size);
  if (fp === 0.5) {
    return {
      minX: c.pos.x + 0.25,
      minY: c.pos.y + 0.25,
      maxX: c.pos.x + 0.75,
      maxY: c.pos.y + 0.75,
    };
  }
  return { minX: c.pos.x, minY: c.pos.y, maxX: c.pos.x + fp, maxY: c.pos.y + fp };
}

/**
 * AABB for an obstacle in continuous grid coordinates.
 * Obstacle fields x/y/width/depth are all in grid squares.
 */
function getObstacleAABB(o: Obstacle): AABB2D {
  return { minX: o.x, minY: o.y, maxX: o.x + o.width, maxY: o.y + o.depth };
}

/**
 * The 4 base corners of an AABB2D (LV1 source and target nodes).
 * Order: bottom-left, bottom-right, top-left, top-right.
 */
export function getAABBCorners(aabb: AABB2D): Vec2[] {
  return [
    { x: aabb.minX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.minY },
    { x: aabb.minX, y: aabb.maxY },
    { x: aabb.maxX, y: aabb.maxY },
  ];
}

// ─── Segment vs AABB ─────────────────────────────────────────────────────────

/**
 * Slab-method segment-vs-AABB intersection test (2D).
 *
 * Returns true iff the segment from P to Q passes through the interior of
 * the (epsilon-shrunk) AABB.  Rays that only graze a corner or edge return false.
 *
 * t ∈ [0, 1] where t=0 is P and t=1 is Q.
 */
export function segmentIntersectsAABB(p: Vec2, q: Vec2, aabb: AABB2D): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;

  const minX = aabb.minX + EPSILON;
  const maxX = aabb.maxX - EPSILON;
  const minY = aabb.minY + EPSILON;
  const maxY = aabb.maxY - EPSILON;

  // Degenerate box after shrink → not a real blocker
  if (minX >= maxX || minY >= maxY) return false;

  let tMin = 0.0;
  let tMax = 1.0;

  // X-axis slab
  if (Math.abs(dx) < EPSILON) {
    if (p.x < minX || p.x > maxX) return false; // parallel and outside slab
  } else {
    let t1 = (minX - p.x) / dx;
    let t2 = (maxX - p.x) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  // Y-axis slab
  if (Math.abs(dy) < EPSILON) {
    if (p.y < minY || p.y > maxY) return false;
  } else {
    let t1 = (minY - p.y) / dy;
    let t2 = (maxY - p.y) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return tMax >= 0.0 && tMin <= 1.0;
}

// ─── Path Checks ─────────────────────────────────────────────────────────────

/** true if segment P→Q is physically blocked by any movement-blocking obstacle */
function isEffectBlocked(p: Vec2, q: Vec2, obstacles: Obstacle[]): boolean {
  for (const obs of obstacles) {
    if (obs.isOpen) continue;
    if (!obs.blocksMovement) continue;
    if (segmentIntersectsAABB(p, q, getObstacleAABB(obs))) return true;
  }
  return false;
}

/** true if segment P→Q is visually blocked by any vision-blocking obstacle.
 *
 * Session 63 RFC-COMBINING-EFFECTS: if `observer` is provided and has
 * `senses.devilsSight`, magical-darkness obstacles (isMagicalDarkness === true)
 * do NOT block the observer's vision. Devil's Sight (MM: Imp, Barbed Devil,
 * etc. + Warlock invocation PHB p.110): "Magical darkness doesn't impede the
 * devil's darkvision." This lets the observer see through magical darkness
 * (but NOT through fog, walls, or other non-darkness obscurement).
 */
function isVisionBlocked(
  p: Vec2, q: Vec2, obstacles: Obstacle[], observer?: Combatant,
): boolean {
  const hasDevilsSight = observer?.senses?.devilsSight === true;
  for (const obs of obstacles) {
    if (obs.isOpen) continue;
    if (!obs.blocksVision) continue;
    // Devil's Sight: skip magical-darkness obstacles (see through them).
    if (hasDevilsSight && obs.isMagicalDarkness === true) continue;
    if (segmentIntersectsAABB(p, q, getObstacleAABB(obs))) return true;
  }
  return false;
}

/**
 * Counts how many of targetCorners have an unobstructed effect-path from src.
 */
function countClearPaths(
  src: Vec2, targetCorners: Vec2[], obstacles: Obstacle[]
): number {
  let count = 0;
  for (const tc of targetCorners) {
    if (!isEffectBlocked(src, tc, obstacles)) count++;
  }
  return count;
}

// ─── Cover State ─────────────────────────────────────────────────────────────

function toCoverState(clearRays: number, totalRays: number): CoverState {
  if (clearRays === totalRays)      return 'none';
  if (clearRays / totalRays >= 0.5) return 'half';
  if (clearRays > 0)                return 'three-quarters';
  return 'total';
}

function coverACBonus(cover: CoverState): number {
  switch (cover) {
    case 'none':           return 0;
    case 'half':           return 2;
    case 'three-quarters': return 5;
    case 'total':          return 0; // target is untargetable; bonus irrelevant
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Computes the LOS/cover result between attacker and target.
 *
 * Algorithm (LV1, 2D):
 *   1. Build 4-corner AABB for attacker and target from their size footprints.
 *   2. For each of the 4 attacker corners, count clear effect-paths to all 4 target corners.
 *   3. Select the attacker corner with the most clear paths (optimal source node).
 *   4. Map clear count → cover state (none / half / three-quarters / total).
 *   5. Check vision independently: is any target corner unblocked by vision obstacles?
 *
 * @param attacker  The attacking combatant.
 * @param target    The targeted combatant.
 * @param bf        The Battlefield (reads bf.obstacles; safe if bf is undefined or
 *                  bf.obstacles is absent/empty).
 */
export function computeLOS(
  attacker: Combatant,
  target:   Combatant,
  bf:       Battlefield | undefined
): LOSResult {
  const obstacles = bf?.obstacles;
  if (!obstacles || obstacles.length === 0) return OPEN_FIELD;

  const attackerCorners = getAABBCorners(getCombatantAABB(attacker));
  const targetCorners   = getAABBCorners(getCombatantAABB(target));

  // ── Effect-path: find optimal source corner ──────────────────────────────
  let bestClear = 0;
  let bestSrc: Vec2 = attackerCorners[0];

  for (const src of attackerCorners) {
    const clear = countClearPaths(src, targetCorners, obstacles);
    if (clear > bestClear) {
      bestClear = clear;
      bestSrc = src;
      if (bestClear === targetCorners.length) break; // 4/4 — can't improve
    }
  }

  const cover = toCoverState(bestClear, targetCorners.length);

  // ── Vision check: any target corner visible from best source? ─────────────
  // Session 63 RFC-COMBINING-EFFECTS: pass `attacker` as the observer so
  // isVisionBlocked can skip magical-darkness obstacles for Devil's Sight.
  const hasLineOfSight = targetCorners.some(tc => !isVisionBlocked(bestSrc, tc, obstacles, attacker));

  return {
    hasLineOfEffect: cover !== 'total',
    hasLineOfSight,
    cover,
    coverACBonus:    coverACBonus(cover),
  };
}

/**
 * Returns the flat AC bonus cover gives the target vs this attacker.
 * 0 for open field or no battlefield.
 */
export function getCoverBonus(
  attacker: Combatant,
  target:   Combatant,
  bf:       Battlefield | undefined
): number {
  return computeLOS(attacker, target, bf).coverACBonus;
}

/** true if attacker has total cover on target (cannot be targeted). */
export function hasTotalCover(
  attacker: Combatant,
  target:   Combatant,
  bf:       Battlefield | undefined
): boolean {
  return computeLOS(attacker, target, bf).cover === 'total';
}

/** true if attacker can see target (no vision-blocking obstacles between them). */
export function hasLineOfSight(
  attacker: Combatant,
  target:   Combatant,
  bf:       Battlefield | undefined
): boolean {
  return computeLOS(attacker, target, bf).hasLineOfSight;
}
