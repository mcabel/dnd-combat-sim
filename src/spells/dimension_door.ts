// ============================================================
// Dimension Door — PHB p.233
//
// 4th-level conjuration, ACTION, range Self (teleport up to 500 ft),
// NO concentration.   Components: V only.
//
// Effect: You teleport yourself from your current location to any other
//         spot within range. You arrive at exactly the spot desired. It
//         can be a place you can see, one you can visualize, or one you
//         can describe by stating distance and direction.
//         You can also bring one willing creature of your size or smaller
//         (within 5 ft of you when you cast). If you would arrive in a
//         place already occupied by an object or a creature, you and any
//         creature traveling with you each take 4d6 force damage, and
//         the spell fails to teleport you.
//
// v1 simplifications:
//   - "Willing creature" rider NOT modelled — v1 only teleports the caster.
//     (PC parties do not yet have a "willing ally within 5 ft" check; this
//     is a v1 simplification, marked by the flag below.)
//   - "Occupied destination" damage NOT modelled — v1 does not have per-cell
//     occupancy tracking. v1 simply clamps the destination to battlefield
//     bounds. The 4d6 force damage rider is skipped (v1 simplification).
//   - "Place you can see / visualize / describe" — v1 simplifies this to
//     "500 ft toward (or away from) the nearest enemy". The caster does
//     NOT need LOS to the destination (canon: it can be a place you
//     visualize, so LOS is not required).
//   - NOT a concentration spell (PHB p.233: no concentration noted).
//   - Action: Dimension Door is an ACTION — it consumes the caster's
//     main action for the turn (unlike Misty Step which is a bonus action).
//     The planner should cast it as the main action when the caster needs
//     to close a large distance gap (Misty Step only covers 30 ft).
//
// Spell module pattern (self-teleport, action-time, no concentration):
//   shouldCast(caster, bf) → { destination: Vec3 } | null
//   execute(caster, destination, state) → void
//   cleanup() — no-op (instantaneous spell)
//
// Migration note (Session 61 / SPELL-DELEGATION-SPEC): migrated from the
// generic forward-compat registry to a bespoke self-teleport module.
// Mirrors Misty Step (Session 16) but as an ACTION with a much longer
// range (500 ft vs 30 ft) and a higher spell level (L4 vs L2). Used by
// 56 monsters per the delegation spec.
// ============================================================

import { Combatant, Battlefield, Vec3 } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Dimension Door',
  level: 4,
  school: 'conjuration',
  rangeFt: 0,                  // self
  teleportRangeFt: 500,
  concentration: false,
  castingTime: 'action',
  dimensionDoorWillingCreatureRiderV1Implemented: false,   // willing-ally rider skipped
  dimensionDoorOccupiedDestinationDamageV1Implemented: false, // 4d6 force on occupied cell skipped
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

// ---- Planner ------------------------------------------------

/**
 * Returns the teleport destination for Dimension Door, or null when the spell
 * should not be cast.
 *
 * v1 destination logic:
 *   - If caster's HP% < 30%: teleport AWAY from the nearest enemy (escape).
 *     Destination = 500 ft in the opposite direction (clamped to the
 *     battlefield bounds — v1 uses a 30x30 grid, so the clamp dominates).
 *   - Else: teleport TOWARD the nearest enemy (close distance).
 *     Destination = 500 ft toward the nearest enemy (clamped — won't
 *     overshoot the enemy by more than the enemy's own position).
 *
 * Preconditions:
 *   - Caster has 'Dimension Door' in their actions
 *   - Caster has at least one 4th-level-or-higher slot available
 *   - At least 1 living enemy exists (no point teleporting with no enemies)
 *   - When NOT escaping: caster must be MORE than 60 ft (12 squares) from
 *     the nearest enemy. If closer than that, Misty Step (30 ft) or normal
 *     movement suffices — Dimension Door is overkill and wastes a L4 slot.
 *   - When escaping: caster must be in melee range of the nearest enemy
 *     (within 1 square = 5 ft). No point spending a L4 slot to escape if
 *     the enemy is already far away.
 *
 * Note: Dimension Door is NOT concentration — it can be cast while
 * concentrating on another spell. The planner should NOT gate on
 * concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): { destination: Vec3 } | null {
  if (!caster.actions.some(a => a.name === 'Dimension Door')) return null;
  if (!hasSpellSlot(caster, 4)) return null;

  const enemies = livingEnemiesOf(caster, bf);
  if (enemies.length === 0) return null;

  // Find the nearest enemy (Chebyshev distance in grid squares).
  let nearest = enemies[0];
  let nearestDist = Math.max(
    Math.abs(caster.pos.x - nearest.pos.x),
    Math.abs(caster.pos.y - nearest.pos.y),
  );
  for (const e of enemies) {
    const d = Math.max(
      Math.abs(caster.pos.x - e.pos.x),
      Math.abs(caster.pos.y - e.pos.y),
    );
    if (d < nearestDist) {
      nearest = e;
      nearestDist = d;
    }
  }

  const hpPct = caster.currentHP / caster.maxHP;
  const escaping = hpPct < 0.30;

  // Thresholds (in grid squares; 1 square = 5 ft):
  //   - Non-escape: skip if already within 60 ft (12 squares) of nearest enemy.
  //     (Movement + Misty Step can cover that; Dimension Door is overkill.)
  //   - Escape: skip if nearest enemy is > 1 square (5 ft) away — Disengage
  //     + move is cheaper. Only burn a L4 slot when pinned in melee.
  if (!escaping) {
    if (nearestDist <= 12) return null;
  } else {
    if (nearestDist > 1) return null;
  }

  // Compute destination: 500 ft (100 grid squares) toward (or away from)
  // the nearest enemy, clamped to battlefield bounds [0, 29] (v1: 30x30 grid).
  // Because 500 ft vastly exceeds the 30x30 grid (150 ft diagonal), the
  // clamp will always pin the destination to a battlefield edge.
  const dx = nearest.pos.x - caster.pos.x;
  const dy = nearest.pos.y - caster.pos.y;
  const sign = escaping ? -1 : 1;  // away vs toward

  // Normalize to unit-ish steps (Chebyshev — move diagonally).
  // If dx/dy are both 0 (caster is on top of enemy), pick an arbitrary
  // direction (away from origin) so we still teleport somewhere.
  const stepX = dx === 0 ? 0 : Math.sign(dx);
  const stepY = dy === 0 ? 0 : Math.sign(dy);

  const teleportSquares = Math.floor(metadata.teleportRangeFt / 5);  // 100 squares
  let destX = caster.pos.x + sign * stepX * teleportSquares;
  let destY = caster.pos.y + sign * stepY * teleportSquares;

  // Clamp to battlefield bounds (v1: 30x30 grid → coords 0..29).
  destX = Math.max(0, Math.min(29, destX));
  destY = Math.max(0, Math.min(29, destY));

  // If closing distance, don't overshoot the enemy (stop adjacent, not on top).
  if (!escaping) {
    const wouldOvershootX = stepX > 0 ? destX > nearest.pos.x : stepX < 0 ? destX < nearest.pos.x : false;
    const wouldOvershootY = stepY > 0 ? destY > nearest.pos.y : stepY < 0 ? destY < nearest.pos.y : false;
    if (wouldOvershootX) destX = nearest.pos.x - stepX;  // stop 1 square short
    if (wouldOvershootY) destY = nearest.pos.y - stepY;
  }

  // Don't teleport onto the same square (no movement — wasted slot).
  if (destX === caster.pos.x && destY === caster.pos.y) return null;

  return { destination: { x: destX, y: destY, z: caster.pos.z } };
}

// ---- Execution ----------------------------------------------

/**
 * Execute Dimension Door:
 *  1. Consume a 4th-level spell slot.
 *  2. Set caster.pos = destination (teleport).
 *  3. Log the teleport.
 *
 * v1 simplifications:
 *   - "Willing creature" rider skipped — only the caster teleports.
 *   - "Occupied destination" 4d6 force damage skipped — no per-cell
 *     occupancy tracking in v1.
 *   - Destination LOS not verified (canon allows "place you can visualize").
 *   - NOT concentration.
 */
export function execute(
  caster: Combatant,
  destination: Vec3,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 4);

  const fromPos = { ...caster.pos };
  caster.pos = { ...destination };

  const dx = destination.x - fromPos.x;
  const dy = destination.y - fromPos.y;
  const distFt = Math.max(Math.abs(dx), Math.abs(dy)) * 5;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Dimension Door! (teleports ${distFt} ft from (${fromPos.x},${fromPos.y}) to (${destination.x},${destination.y}))`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} vanishes and reappears ${distFt} ft away!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell; no scratch field.
}
