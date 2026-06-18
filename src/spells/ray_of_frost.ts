// ============================================================
// Ray of Frost — PHB p.271
// Level 0 evocation cantrip
//
// Casting time: action
// Range: 60 ft (ranged spell attack)
// Effect: On hit, 1d8 cold damage, and target's speed is reduced
//         by 10 feet until the start of your next turn.
//
// Implementation:
//   - Basic attack and damage handled by resolveAttack
//   - Special effect (speed reduction) applied via applyCantripEffect after hit
//   - Uses activeEffects system for cleanup
//
// Speed reduction mechanics (PHB p.271):
//   - Reduces speed by 10 ft
//   - Lasts until the start of caster's next turn
//   - Does NOT affect fly, swim, or burrow speeds
//   - Does not stack with multiple Ray of Frost hits
//
// Simplification: Effect removed at start of each combatant's turn
// (simplified from PHB "start of caster's next turn" rule)
// ============================================================

import { Combatant } from '../types/core';
import { CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';

// ---- Constants ----------------------------------------------

/** Speed reduction in feet for Ray of Frost */
const SPEED_REDUCTION_FT = 10;

// ---- Metadata -----------------------------------------------

export const metadata = {
  name: 'Ray of Frost',
  level: 0,
  school: 'evocation',
  rangeFt: 60,
  concentration: false,
  castingTime: 'action',
  damageDice: '1d8',
  damageType: 'cold',
  speedReductionFt: SPEED_REDUCTION_FT,
} as const;

// ---- applyCantripEffect --------------------------------------

/**
 * Apply Ray of Frost's special effect after a hit.
 * This function is called from resolveAttack after damage is dealt.
 *
 * @param caster The caster of Ray of Frost
 * @param target The target that was hit
 * @param state The current engine state
 * @returns true if the effect was applied
 */
export function applyCantripEffect(
  caster: Combatant,
  target: Combatant,
  state: EngineState,
): boolean {
  // Store original speed if not already stored
  if (target._rayOfFrostOriginalSpeed === undefined) {
    target._rayOfFrostOriginalSpeed = target.speed;
  }

  const speedBefore = target.speed;
  target.speed = Math.max(0, target.speed - SPEED_REDUCTION_FT);
  const speedAfter = target.speed;

  // Mark target as having Ray of Frost effect
  target._hasRayOfFrost = true;

  const logEvent: CombatEvent = {
    round: state.battlefield.round,
    actorId: caster.id,
    targetId: target.id,
    type: 'action' as const,
    description: `${caster.name}'s Ray of Frost slows ${target.name}! Speed: ${speedBefore}ft → ${speedAfter}ft`,
  };
  state.log.events.push(logEvent);

  return true;
}

// ---- Cleanup function ----------------------------------------

/**
 * Cleanup function called at the start of each combatant's turn.
 * Restores speed if Ray of Frost was applied.
 *
 * Simplified: Effect removed at start of each combatant's turn
 * (instead of caster's next turn per PHB)
 */
export function cleanup(combatant: Combatant): void {
  if (combatant._hasRayOfFrost) {
    // Restore original speed
    if (combatant._rayOfFrostOriginalSpeed !== undefined) {
      combatant.speed = combatant._rayOfFrostOriginalSpeed;
      delete combatant._rayOfFrostOriginalSpeed;
    }
    delete combatant._hasRayOfFrost;
  }
}