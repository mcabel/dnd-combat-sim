// ============================================================
// Cantrip Effects Handler
//
// Some cantrips have special combat effects beyond damage.
// This module provides a central dispatch for cantrip effects
// that are applied after a successful hit.
//
// Supported cantrips:
//   - Thorn Whip: Pulls Large/smaller targets 10 ft closer
//   - Ray of Frost: Reduces target speed by 10 ft
//   - Shocking Grasp: Prevents reactions on hit
//   - (Future: Chill Touch, Blade Ward, etc.)
//
// Integration:
//   Called from resolveAttack in combat.ts after damage is dealt.
// ============================================================

import { Combatant } from '../types/core';
import { EngineState } from '../engine/combat';
import { applyCantripEffect as applyThornWhipEffect } from '../spells/thorn_whip';
import { applyCantripEffect as applyRayOfFrostEffect } from '../spells/ray_of_frost';
import { applyCantripEffect as applyShockingGraspEffect, cantripAttackAdvantage as shockingGraspAdvantage } from '../spells/shocking_grasp';

// ---- Cantrip effect handlers --------------------------------

/**
 * Map of cantrip names to their POST-HIT effect handler functions.
 * Each handler takes (attacker, target, state) and returns
 * true if the effect was applied. Called from resolveAttack AFTER damage.
 */
const CANTRIP_EFFECTS: Record<
  string,
  (attacker: Combatant, target: Combatant, state: EngineState) => boolean
> = {
  'Thorn Whip': applyThornWhipEffect,
  'Ray of Frost': applyRayOfFrostEffect,
  'Shocking Grasp': applyShockingGraspEffect,
  // Future cantrips will be added here
};

// ---- Pre-roll cantrip advantage registry --------------------

/**
 * Map of cantrip names to a function that decides whether the attack roll
 * itself should have advantage, evaluated BEFORE the d20 is rolled.
 *
 * Example: Shocking Grasp (PHB p.275) grants advantage vs metal-armored
 * targets. This can't be handled by the post-hit CANTRIP_EFFECTS map because
 * advantage must be known at roll time.
 *
 * resolveAttack() in combat.ts consults this via getCantripAttackAdvantage().
 */
const CANTRIP_ATTACK_ADVANTAGE: Record<
  string,
  (attacker: Combatant, target: Combatant) => boolean
> = {
  'Shocking Grasp': shockingGraspAdvantage,
};

/**
 * Returns true if the named cantrip grants advantage on the attack roll
 * against `target` (pre-roll). Returns false for unknown cantrips.
 */
export function getCantripAttackAdvantage(
  attacker: Combatant,
  target: Combatant,
  actionName: string,
): boolean {
  const fn = CANTRIP_ATTACK_ADVANTAGE[actionName];
  return fn ? fn(attacker, target) : false;
}

// ---- Main dispatcher ----------------------------------------

/**
 * Apply the special effect of a cantrip after a hit.
 * This is called from resolveAttack after damage is dealt.
 *
 * @param attacker The attacker (caster of the cantrip)
 * @param target The target that was hit
 * @param action The action used (to identify the cantrip)
 * @param state The current engine state
 */
export function applyCantripEffect(
  attacker: Combatant,
  target: Combatant,
  actionName: string,
  state: EngineState,
): void {
  const handler = CANTRIP_EFFECTS[actionName];
  if (!handler) return;

  try {
    handler(attacker, target, state);
  } catch (e) {
    console.error(
      `[cantrip_effects] Error applying effect for ${actionName}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}