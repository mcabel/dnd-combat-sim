// ============================================================
// Misty Step — PHB p.260
//
// 2nd-level conjuration, BONUS ACTION, range Self, NO concentration.
// Duration: Instantaneous.   Components: V only.
//
// Effect: Briefly surrounded by silvery mist, you teleport up to 30 feet
//         to an unoccupied space that you can see.
//
// Upcast: — (no At Higher Levels entry).
//
// v1 simplifications:
//   - Teleport destination: v1 does NOT model "unoccupied space that you
//     can see" — instead, the caster is teleported 30 ft toward the nearest
//     enemy (or away from the nearest enemy if the caster is below 25% HP).
//     This is a v1 simplification — the planner picks the destination
//     based on tactical relevance (close in for melee, escape for ranged).
//   - LOS: v1 does NOT verify the destination is visible (no LOS check).
//   - NOT a concentration spell (PHB p.260: no concentration noted).
//   - Bonus action: Misty Step is a BONUS ACTION — it pairs with the
//     caster's main-action attack or spell. The planner should cast it
//     BEFORE the main action if the caster needs to close distance, or
//     AFTER if escaping. v1 casts it as the bonus action (before the main
//     action) when the caster is out of range of its primary target.
//
// Spell module pattern:
//   shouldCast(caster, bf) → { destination: Vec3 } | null
//   execute(caster, destination, state) → void
//   cleanup() — no-op (instantaneous spell)
// ============================================================

import { Combatant, Battlefield, Vec3 } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { livingEnemiesOf } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Misty Step',
  level: 2,
  school: 'conjuration',
  rangeFt: 0,       // self
  teleportRangeFt: 30,
  concentration: false,
  castingTime: 'bonusAction',
  mistyStepDestinationLOSV1Implemented: false,                // destination LOS not verified
  mistyStepUnoccupiedSpaceV1Implemented: false,               // unoccupied-space check skipped
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
 * Returns the teleport destination for Misty Step, or null when the spell
 * should not be cast.
 *
 * v1 destination logic:
 *   - If caster's HP% < 25%: teleport AWAY from the nearest enemy (escape).
 *     Destination = 30 ft in the opposite direction (clamped to the
 *     battlefield bounds — v1 uses a 30x30 grid).
 *   - Else: teleport TOWARD the nearest enemy (close distance).
 *     Destination = 30 ft toward the nearest enemy (clamped — won't
 *     overshoot the enemy).
 *
 * Preconditions:
 *   - Caster has 'Misty Step' in their actions
 *   - Caster has at least one 2nd-level-or-higher slot available
 *   - At least 1 living enemy exists (no point teleporting with no enemies)
 *   - Caster is NOT already adjacent to its primary target (when not escaping)
 *     — v1 simplification: only cast Misty Step to close distance if the
 *     nearest enemy is more than 1 square (5 ft) away.
 *
 * Note: Misty Step is NOT concentration — it can be cast while concentrating
 * on another spell. The planner should NOT gate on concentration.
 */
export function shouldCast(caster: Combatant, bf: Battlefield): { destination: Vec3 } | null {
  if (!caster.actions.some(a => a.name === 'Misty Step')) return null;
  if (!hasSpellSlot(caster, 2)) return null;

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
  const escaping = hpPct < 0.25;

  if (!escaping) {
    // Closing distance: skip if already adjacent (within 1 square = 5 ft).
    if (nearestDist <= 1) return null;
  }

  // Compute destination: 30 ft (6 grid squares) toward (or away from) the
  // nearest enemy, clamped to battlefield bounds [0, 29].
  const dx = nearest.pos.x - caster.pos.x;
  const dy = nearest.pos.y - caster.pos.y;
  const sign = escaping ? -1 : 1;  // away vs toward

  // Normalize to unit-ish steps (Chebyshev — move diagonally).
  const stepX = dx === 0 ? 0 : Math.sign(dx);
  const stepY = dy === 0 ? 0 : Math.sign(dy);

  const teleportSquares = Math.floor(metadata.teleportRangeFt / 5);  // 6 squares
  let destX = caster.pos.x + sign * stepX * teleportSquares;
  let destY = caster.pos.y + sign * stepY * teleportSquares;

  // Clamp to battlefield bounds (v1: 30x30 grid).
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
 * Execute Misty Step:
 *  1. Consume a 2nd-level spell slot.
 *  2. Set caster.pos = destination (teleport).
 *  3. Log the teleport.
 *
 * v1 simplifications: destination LOS not verified; unoccupied-space check
 * skipped; NOT concentration.
 */
export function execute(
  caster: Combatant,
  destination: Vec3,
  state: EngineState,
): void {
  consumeSpellSlot(caster, 2);

  const fromPos = { ...caster.pos };
  caster.pos = { ...destination };

  const dx = destination.x - fromPos.x;
  const dy = destination.y - fromPos.y;
  const distFt = Math.max(Math.abs(dx), Math.abs(dy)) * 5;

  emit(
    state, 'action', caster.id,
    `${caster.name} casts Misty Step! (teleports ${distFt} ft from (${fromPos.x},${fromPos.y}) to (${destination.x},${destination.y}))`,
    caster.id,
  );
  emit(
    state, 'condition_add', caster.id,
    `${caster.name} briefly surrounded by silvery mist — reappears ${distFt} ft away!`,
    caster.id,
  );
}

// ---- Cleanup ------------------------------------------------

export function cleanup(_c: Combatant): void {
  // No-op — instantaneous spell; no scratch field.
}
