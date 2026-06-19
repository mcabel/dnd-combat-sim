// ============================================================
// Cantrip Effects Handler
//
// Some cantrips have special combat effects beyond damage.
// This module provides a central dispatch for cantrip effects
// that are applied after a successful hit.
//
// Supported cantrips:
//   - Thorn Whip: Pulls Large/smaller targets 10 ft closer  (post-hit)
//   - Ray of Frost: Reduces target speed by 10 ft           (post-hit)
//   - Shocking Grasp: Prevents reactions on hit + adv vs metal (pre-roll + post-hit)
//   - Chill Touch: No healing + undead disadv vs caster      (post-hit)
//   - Blade Ward: Self resistance to B/P/S (NON-attack self-buff)
//
// Integration:
//   - Post-hit attack cantrips: called from resolveAttack in combat.ts
//     after damage is dealt, via applyCantripEffect() below.
//   - Non-attack self-buff cantrips (Blade Ward): routed by
//     resolveCantripAction() below, which executePlannedAction in
//     combat.ts consults BEFORE resolveAttack so self-buffs never go
//     through the attack-roll path.
// ============================================================

import { Combatant } from '../types/core';
import { EngineState } from '../engine/combat';
import { applyCantripEffect as applyThornWhipEffect } from '../spells/thorn_whip';
import { applyCantripEffect as applyRayOfFrostEffect } from '../spells/ray_of_frost';
import { applyCantripEffect as applyShockingGraspEffect, cantripAttackAdvantage as shockingGraspAdvantage } from '../spells/shocking_grasp';
import { applyCantripEffect as applyChillTouchEffect } from '../spells/chill_touch';
import { applySelfEffect as applyBladeWardSelfEffect } from '../spells/blade_ward';

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
  'Chill Touch': applyChillTouchEffect,
  // Future post-hit cantrips will be added here
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

// ---- Non-attack self-buff cantrip registry -------------------

/**
 * Map of cantrip names to their SELF-EFFECT handler functions for
 * non-attack cantrips (self-buffs like Blade Ward). Each handler takes
 * (caster, state) and returns true if the effect was applied.
 *
 * These cantrips do NOT ride resolveAttack (no attack roll, no target).
 * executePlannedAction() in combat.ts consults resolveCantripAction()
 * BEFORE resolveAttack; if it returns true the action is fully resolved
 * as a self-buff and resolveAttack is skipped. This keeps cantrip logic
 * out of the executePlannedAction switch (no `case 'spellName'`).
 */
const CANTRIP_SELF_EFFECTS: Record<
  string,
  (caster: Combatant, state: EngineState) => boolean
> = {
  'Blade Ward': applyBladeWardSelfEffect,
  // Future non-attack self-buff cantrips will be added here
};

/**
 * Resolve a non-attack (self-buff) cantrip action.
 *
 * If `actionName` is registered in CANTRIP_SELF_EFFECTS, applies the
 * self-effect and returns true. Otherwise returns false (caller should
 * fall through to resolveAttack or another handler).
 *
 * Called from executePlannedAction() in combat.ts for 'attack'/'cast'
 * actions, BEFORE resolveAttack, so self-buff cantrips bypass the
 * attack-roll path entirely.
 */
export function resolveCantripAction(
  caster: Combatant,
  actionName: string,
  state: EngineState,
): boolean {
  const handler = CANTRIP_SELF_EFFECTS[actionName];
  if (!handler) return false;

  try {
    return handler(caster, state);
  } catch (e) {
    console.error(
      `[cantrip_effects] Error applying self-effect for ${actionName}: ${e instanceof Error ? e.message : String(e)}`
    );
    return false;
  }
}