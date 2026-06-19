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
//   - Shillelagh: WIS-for-STR melee + +1d8 radiant (NON-attack self-buff)
//   - Vicious Mockery: Disadv on target's next attack (post-save-FAIL)
//   - Mind Sliver: −1d4 to target's next save (post-save-FAIL)
//   - Booming Blade: Thunder rider on target's next willing move (post-hit)
//   - Frostbite: Disadv on target's next WEAPON attack (post-save-FAIL)
//   - Sapping Sting: Target falls prone (post-save-FAIL — condition, not scratch field)
//   - Lightning Lure: Pull 10 ft + conditional lightning damage (post-save-FAIL)
//   - Green-Flame Blade: Fire splash to 2nd creature within 5 ft of primary (post-hit)
//   - Infestation: Random d4 forced movement (N/S/E/W) on save-FAIL (post-save-FAIL)
//   - Thunderclap: Caster-centered 5-ft AoE CON save (NON-attack AoE)
//   - Sword Burst: Caster-centered 5-ft AoE DEX save (NON-attack AoE)
//   - Word of Radiance: Caster-centered 5-ft AoE CON save, radiant (NON-attack AoE)
//
// Integration:
//   - Post-hit attack cantrips: called from resolveAttack in combat.ts
//     after damage is dealt, via applyCantripEffect() below.
//   - Post-save-FAIL cantrips (Vicious Mockery, Mind Sliver): called from
//     resolveAttack's save branch after damage, ONLY when the save failed.
//   - Non-attack self-buff cantrips (Blade Ward): routed by
//     resolveCantripAction() below, which executePlannedAction in
//     combat.ts consults BEFORE resolveAttack so self-buffs never go
//     through the attack-roll path.
//   - Caster-centered AoE cantrips (Thunderclap): routed by
//     resolveCantripAoE() below, which executePlannedAction consults
//     BEFORE the target-null guard and BEFORE resolveAttack. The
//     execute handler finds all creatures within range itself.
// ============================================================

import { Combatant } from '../types/core';
import { EngineState } from '../engine/combat';
import { applyCantripEffect as applyThornWhipEffect } from '../spells/thorn_whip';
import { applyCantripEffect as applyRayOfFrostEffect } from '../spells/ray_of_frost';
import { applyCantripEffect as applyShockingGraspEffect, cantripAttackAdvantage as shockingGraspAdvantage } from '../spells/shocking_grasp';
import { applyCantripEffect as applyChillTouchEffect } from '../spells/chill_touch';
import { applyCantripEffect as applyViciousMockeryEffect } from '../spells/vicious_mockery';
import { applyCantripEffect as applyMindSliverEffect } from '../spells/mind_sliver';
import { applyCantripEffect as applyBoomingBladeEffect } from '../spells/booming_blade';
import { applyCantripEffect as applyFrostbiteEffect } from '../spells/frostbite';
import { applyCantripEffect as applySappingStingEffect } from '../spells/sapping_sting';
import { applyCantripEffect as applyLightningLureEffect } from '../spells/lightning_lure';
import { applyCantripEffect as applyGreenFlameBladeEffect } from '../spells/green_flame_blade';
import { applyCantripEffect as applyInfestationEffect } from '../spells/infestation';
import { applySelfEffect as applyBladeWardSelfEffect } from '../spells/blade_ward';
import { applySelfEffect as applyShillelaghSelfEffect } from '../spells/shillelagh';
import { execute as executeThunderclap } from '../spells/thunderclap';
import { execute as executeSwordBurst } from '../spells/sword_burst';
import { execute as executeWordOfRadiance } from '../spells/word_of_radiance';

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
  'Vicious Mockery': applyViciousMockeryEffect,
  'Mind Sliver': applyMindSliverEffect,        // post-save-FAIL: −1d4 to next save (TCE p.108)
  'Booming Blade': applyBoomingBladeEffect,    // post-hit: thunder rider on willing move (TCE p.106)
  'Frostbite': applyFrostbiteEffect,           // post-save-FAIL: disadv on next WEAPON attack (XGE p.156)
  'Sapping Sting': applySappingStingEffect,    // post-save-FAIL: target falls prone (EGW p.189)
  'Lightning Lure': applyLightningLureEffect,  // post-save-FAIL: pull 10 ft + conditional lightning (TCE p.107)
  'Green-Flame Blade': applyGreenFlameBladeEffect,  // post-hit: fire splash to 2nd creature within 5 ft (TCE p.107)
  'Infestation': applyInfestationEffect,            // post-save-FAIL: random d4 forced movement (XGE p.158)
  // Future post-hit / post-save-FAIL cantrips will be added here
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
  'Shillelagh': applyShillelaghSelfEffect,  // PHB p.275: WIS-for-STR melee + +1d8 radiant (1-round v1)
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

// ---- Caster-centered AoE cantrip registry --------------------

/**
 * Map of cantrip names to their EXECUTE handler functions for
 * caster-centered AoE cantrips (e.g. Thunderclap, XGE p.168: each
 * creature within 5 ft of the caster). Each handler takes
 * (caster, state) and resolves the entire spell — finding targets,
 * rolling saves, applying damage, and logging.
 *
 * These cantrips do NOT ride resolveAttack (no single target, no
 * attack roll). executePlannedAction() in combat.ts consults
 * resolveCantripAoE() AFTER resolveCantripAction and BEFORE the
 * target-null guard; if it returns true the action is fully resolved
 * as an AoE and resolveAttack is skipped. This keeps cantrip logic
 * out of the executePlannedAction switch (no `case 'spellName'`),
 * mirroring CANTRIP_SELF_EFFECTS for self-buffs.
 *
 * The handler returns true whenever the cantrip name is registered,
 * even if 0 creatures are in range (the spell is still cast — the
 * action is consumed). This is correct PHB behavior: "You create a
 * burst of thunderous sound" (XGE p.168) — the burst happens
 * regardless of who is in range. The AI planner is responsible for
 * not casting the cantrip when it would be wasted.
 */
const CANTRIP_AOE_EFFECTS: Record<
  string,
  (caster: Combatant, state: EngineState) => void
> = {
  'Thunderclap': executeThunderclap,        // XGE p.168: 5-ft radius CON save, 1d6 thunder
  'Sword Burst': executeSwordBurst,         // TCE p.115: 5-ft radius DEX save, 1d6 force
  'Word of Radiance': executeWordOfRadiance,// XGE p.171: 5-ft radius CON save, 1d6 radiant
  // Future caster-centered AoE cantrips will be added here
};

/**
 * Resolve a caster-centered AoE cantrip action.
 *
 * If `actionName` is registered in CANTRIP_AOE_EFFECTS, calls its
 * execute handler and returns true. Otherwise returns false (caller
 * should fall through to the target-null guard and resolveAttack).
 *
 * Called from executePlannedAction() in combat.ts for 'attack'/'cast'
 * actions, AFTER resolveCantripAction (self-buffs) and BEFORE the
 * target-null guard. AoE cantrips bypass the single-target attack-roll
 * path entirely; the execute handler finds all targets in range itself.
 */
export function resolveCantripAoE(
  caster: Combatant,
  actionName: string,
  state: EngineState,
): boolean {
  const handler = CANTRIP_AOE_EFFECTS[actionName];
  if (!handler) return false;

  try {
    handler(caster, state);
    return true;
  } catch (e) {
    console.error(
      `[cantrip_effects] Error executing AoE cantrip ${actionName}: ${e instanceof Error ? e.message : String(e)}`
    );
    return true; // still consume the action — the spell was "cast"
  }
}
