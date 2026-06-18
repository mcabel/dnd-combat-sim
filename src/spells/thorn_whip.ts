// ============================================================
// Thorn Whip — PHB p.282
// Level 0 transmutation cantrip
//
// Casting time: action
// Range: 30 ft (melee spell attack)
// Effect: On hit, 1d6 piercing damage, and if target is Large or
//         smaller, pull the creature up to 10 feet closer to caster.
//
// Implementation:
//   - Basic attack and damage handled by resolveAttack
//   - Special effect (pull) applied via applyCantripEffect after hit
//
// Pull mechanics (PHB p.282):
//   - Target is moved up to 10 ft closer along the line between
//     caster and target's original position
//   - Does NOT provoke opportunity attack (forced movement)
//   - Works even if target is grappled (but grappled creature has
//     speed 0, so pull still moves them)
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { chebyshev3D } from '../engine/movement';

// ---- Constants ----------------------------------------------

/** Pull distance in feet for Thorn Whip */
const PULL_DISTANCE_FT = 10;

/** Maximum size that can be pulled by Thorn Whip */
const MAX_PULL_SIZE = 'Large';

/** Size categories that can be pulled (Large and smaller) */
const PULLABLE_SIZES = ['Tiny', 'Small', 'Medium', 'Large'] as const;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Thorn Whip',
  level: 0,
  school: 'transmutation',
  rangeFt: 30,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d6',
  damageType: 'piercing',
  pullDistanceFt: PULL_DISTANCE_FT,
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
 * Check if a combatant's size can be pulled by Thorn Whip.
 * @param combatant The combatant to check
 * @returns true if size is Large or smaller
 */
export function canPullSize(combatant: Combatant): boolean {
  const size = combatant.size ?? 'Medium'; // Default to Medium if not specified
  return PULLABLE_SIZES.includes(size as any);
}

/**
 * Pull the target toward the caster by up to 10 feet along the
 * line between their positions.
 *
 * @param caster The caster of Thorn Whip
 * @param target The target to pull
 * @param state The current engine state
 */
export function pullTarget(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): void {
  // Check size constraint
  if (!canPullSize(target)) {
    emit(
      state, 'action', caster.id,
      `${target.name} is too large to be pulled by ${caster.name}'s Thorn Whip!`,
      target.id,
    );
    return;
  }

  const startPos = { ...target.pos };
  const dist = chebyshev3D(caster.pos, target.pos) * 5; // Convert grid units to ft

  // Target is already within 10 ft, no pull needed
  if (dist <= PULL_DISTANCE_FT) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Thorn Whip hits ${target.name}, but they're already within ${PULL_DISTANCE_FT} ft!`,
      target.id,
    );
    return;
  }

  // Calculate pull distance - pull up to 10 ft, but not past caster
  const pullDist = Math.min(PULL_DISTANCE_FT, dist - 5); // -5 to stop at 5ft (adjacent)

  if (pullDist <= 0) {
    emit(
      state, 'action', caster.id,
      `${caster.name}'s Thorn Whip hits ${target.name}, but there's no room to pull closer!`,
      target.id,
    );
    return;
  }

  // Calculate new position: move target closer to caster along the line
  // Direction vector from target to caster
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

  // Update target position
  const oldPosStr = `(${startPos.x}, ${startPos.y}, ${startPos.z})`;
  const newPosStr = `(${newX.toFixed(1)}, ${newY.toFixed(1)}, ${newZ.toFixed(1)})`;
  target.pos = { x: newX, y: newY, z: newZ };

  emit(
    state, 'move', caster.id,
    `${caster.name}'s Thorn Whip pulls ${target.name} ${pullDist} ft closer! (${oldPosStr} → ${newPosStr})`,
    target.id,
  );
}

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Thorn Whip's special effect after a hit.
 * This function is called from resolveAttack after damage is dealt.
 *
 * @param caster The caster of Thorn Whip
 * @param target The target that was hit
 * @param state The current engine state
 * @returns true if the pull effect was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  pullTarget(caster, target, state);
  return true;
}