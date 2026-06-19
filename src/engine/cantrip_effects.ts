// ============================================================
// Cantrip Effects Handler
//
// Some cantrips have special combat effects beyond damage.
// This module provides a central dispatch for cantrip effects
// that are applied after a successful hit.
//
// Supported cantrips (46 total across 5 registries after Session 13):
//   - Thorn Whip: Pulls Large/smaller targets 10 ft closer  (post-hit)
//   - Ray of Frost: Reduces target speed by 10 ft           (post-hit)
//   - Shocking Grasp: Prevents reactions on hit + adv vs metal (pre-roll + post-hit)
//   - Chill Touch: No healing + undead disadv vs caster      (post-hit)
//   - Blade Ward: Self resistance to B/P/S (NON-attack self-buff)
//   - Shillelagh: WIS-for-STR melee + +1d8 radiant (NON-attack self-buff)
//   - True Strike: Advantage on next attack roll (NON-attack self-buff)
//   - Resistance: +1d4 to next save (NON-attack self-buff)
//   - Guidance: +1d4 to next ability check (NON-attack self-buff, consumed by rollAbilityCheck)
//   - Friends: Advantage on next CHA check (NON-attack self-buff, consumed by rollAbilityCheck)
//   - Minor Illusion: Flavor log only (NON-attack self-buff, no mechanical effect in v1)
//   - Mage Hand: Flavor log only (NON-attack self-buff, no mechanical effect in v1)
//   - Prestidigitation: Flavor log only (NON-attack self-buff, no mechanical effect in v1)
//   - Thaumaturgy: Flavor log only (NON-attack self-buff, V-only, no mechanical effect in v1)
//   - Message: Flavor log only (NON-attack self-buff, no mechanical effect in v1)
//   - Control Flames: Flavor log only (NON-attack self-buff, S-only, no mechanical effect in v1)
//   - Dancing Lights: Flavor log only (NON-attack self-buff, FIRST concentration cantrip, no mechanical effect in v1)
//   - Druidcraft: Flavor log only (NON-attack self-buff, nature-themed, no mechanical effect in v1)
//   - Encode Thoughts: Flavor log only (NON-attack self-buff, FIRST GGR-source + 8-hour-duration, no mechanical effect in v1)
//   - Mold Earth: Flavor log only (NON-attack self-buff, S-only, no mechanical effect in v1)
//   - Shape Water: Flavor log only (NON-attack self-buff, S-only, no mechanical effect in v1)
//   - Vicious Mockery: Disadv on target's next attack (post-save-FAIL)
//   - Mind Sliver: −1d4 to target's next save (post-save-FAIL)
//   - Booming Blade: Thunder rider on target's next willing move (post-hit)
//   - Frostbite: Disadv on target's next WEAPON attack (post-save-FAIL)
//   - Sapping Sting: Target falls prone (post-save-FAIL — condition, not scratch field)
//   - Lightning Lure: Pull 10 ft + conditional lightning damage (post-save-FAIL)
//   - Green-Flame Blade: Fire splash to 2nd creature within 5 ft of primary (post-hit)
//   - Infestation: Random d4 forced movement (N/S/E/W) on save-FAIL (post-save-FAIL)
//   - Gust: Push Medium/smaller target 5 ft AWAY on save-FAIL (post-save-FAIL)
//   - Thunderclap: Caster-centered 5-ft AoE CON save (NON-attack AoE)
//   - Sword Burst: Caster-centered 5-ft AoE DEX save (NON-attack AoE)
//   - Word of Radiance: Caster-centered 5-ft AoE CON save, radiant (NON-attack AoE)
//   - Spare the Dying: Stabilize a downed PC ally (NON-attack touch-effect — NEW registry)
//   - Light: Set _lightSourceActive flag on target (NON-attack touch-effect — NEW registry)
//   - Mending: Set _mended flag on target (NON-attack touch-effect, canon 1-min casting time, v1: 1 action)
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
//   - Non-attack touch-effect cantrips (Spare the Dying, Light v1):
//     routed by resolveCantripTouchEffect() below, which
//     executePlannedAction consults AFTER resolveCantripAction (self-
//     buffs) and resolveCantripAoE (AoE), but BEFORE the target-null
//     guard. This routing is critical for Spare the Dying — its target
//     is an UNCONSCIOUS ally at 0 HP, which the standard
//     `if (!target || target.isDead || target.isUnconscious) break;`
//     guard would BLOCK. The touch-effect handler receives the target
//     as an argument (unlike self-buffs which only take the caster).
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
import { applyCantripEffect as applyGustEffect } from '../spells/gust';
import { applySelfEffect as applyBladeWardSelfEffect } from '../spells/blade_ward';
import { applySelfEffect as applyShillelaghSelfEffect } from '../spells/shillelagh';
import { applySelfEffect as applyTrueStrikeSelfEffect } from '../spells/true_strike';
import { applySelfEffect as applyResistanceSelfEffect } from '../spells/resistance';
import { applySelfEffect as applyGuidanceSelfEffect } from '../spells/guidance';
import { applySelfEffect as applyFriendsSelfEffect } from '../spells/friends';
import { applySelfEffect as applyMinorIllusionSelfEffect } from '../spells/minor_illusion';
import { applySelfEffect as applyMageHandSelfEffect } from '../spells/mage_hand';
import { applySelfEffect as applyPrestidigitationSelfEffect } from '../spells/prestidigitation';
import { applySelfEffect as applyThaumaturgySelfEffect } from '../spells/thaumaturgy';
import { applySelfEffect as applyMessageSelfEffect } from '../spells/message';
import { applySelfEffect as applyControlFlamesSelfEffect } from '../spells/control_flames';
import { applySelfEffect as applyDancingLightsSelfEffect } from '../spells/dancing_lights';
import { applySelfEffect as applyDruidcraftSelfEffect } from '../spells/druidcraft';
import { applySelfEffect as applyEncodeThoughtsSelfEffect } from '../spells/encode_thoughts';
import { applySelfEffect as applyMoldEarthSelfEffect } from '../spells/mold_earth';
import { applySelfEffect as applyShapeWaterSelfEffect } from '../spells/shape_water';
import { execute as executeThunderclap } from '../spells/thunderclap';
import { execute as executeSwordBurst } from '../spells/sword_burst';
import { execute as executeWordOfRadiance } from '../spells/word_of_radiance';
import { applyTouchEffect as applySpareTheDyingTouchEffect } from '../spells/spare_the_dying';
import { applyTouchEffect as applyLightTouchEffect } from '../spells/light';
import { applyTouchEffect as applyMendingTouchEffect } from '../spells/mending';

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
  'Gust': applyGustEffect,                          // post-save-FAIL: push Medium/smaller target 5 ft AWAY (XGE p.157)
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
  'True Strike': applyTrueStrikeSelfEffect, // PHB p.284: advantage on next attack roll (1-round v1)
  'Resistance': applyResistanceSelfEffect,  // PHB p.272: +1d4 to next save (1-round v1)
  'Guidance': applyGuidanceSelfEffect,      // PHB p.248: +1d4 to next ability check (1-round v1; ability-check integration TODO)
  'Friends': applyFriendsSelfEffect,        // PHB p.244: advantage on next CHA check (1-round v1; CHA-check integration TODO)
  'Minor Illusion': applyMinorIllusionSelfEffect, // PHB p.260: flavor log only (1-round v1; illusion mechanics TODO)
  'Mage Hand': applyMageHandSelfEffect,           // PHB p.256: flavor log only (1-round v1; persistent-hand control TODO)
  'Prestidigitation': applyPrestidigitationSelfEffect, // PHB p.267: flavor log only (1-round v1; multi-effect tracking TODO)
  'Thaumaturgy': applyThaumaturgySelfEffect,     // PHB p.282: flavor log only (V-only, 1-round v1; multi-effect tracking TODO)
  'Message': applyMessageSelfEffect,             // PHB p.259: flavor log only (1-round canon; communication subsystem TODO)
  'Control Flames': applyControlFlamesSelfEffect, // XGE p.152: flavor log only (S-only, 1-round v1; multi-effect tracking TODO)
  'Dancing Lights': applyDancingLightsSelfEffect, // PHB p.230: flavor log only (FIRST concentration cantrip, 1-round v1; persistent-lights TODO)
  'Druidcraft': applyDruidcraftSelfEffect,       // PHB p.236: flavor log only (nature-themed, 1-round v1; weather prediction TODO)
  'Encode Thoughts': applyEncodeThoughtsSelfEffect, // GGR p.47: flavor log only (FIRST GGR-source + 8-hr-duration, 1-round v1; thought-strand TODO)
  'Mold Earth': applyMoldEarthSelfEffect,         // XGE p.162: flavor log only (S-only, 1-round v1; difficult-terrain integration TODO)
  'Shape Water': applyShapeWaterSelfEffect,       // XGE p.164: flavor log only (S-only, 1-round v1; water-flow + freeze TODO)
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

// ---- Non-attack touch-effect cantrip registry ----------------

/**
 * Map of cantrip names to their TOUCH-EFFECT handler functions
 * for non-attack, non-AoE, non-self-buff cantrips that target a
 * single DOWNED ALLY or willing creature (Spare the Dying, Light
 * v1). Each handler takes (caster, target, state) and returns
 * true if the effect was applied (or fizzled — either way, the
 * action is consumed and resolveAttack is bypassed).
 *
 * These cantrips do NOT ride resolveAttack (no attack roll, no
 * save in v1). executePlannedAction() in combat.ts consults
 * resolveCantripTouchEffect() AFTER resolveCantripAction (self-
 * buffs) and resolveCantripAoE (AoE), but BEFORE the target-null
 * guard. This routing is CRITICAL for Spare the Dying — its
 * target is an UNCONSCIOUS ally at 0 HP, which the standard
 * `if (!target || target.isDead || target.isUnconscious) break;`
 * guard would BLOCK. By consulting the touch-effect handler
 * BEFORE that guard, Spare the Dying can target downed allies.
 *
 * The touch-effect handler receives the TARGET as an argument
 * (unlike self-buffs which only take the caster). If the handler
 * returns true, the switch breaks (the touch cantrip bypasses
 * resolveAttack). If the cantrip name is registered but the
 * target is null, the function returns true (the spell fizzles
 * — the action is consumed but no effect is applied).
 *
 * Mirror CANTRIP_SELF_EFFECTS for self-buffs and CANTRIP_AOE_EFFECTS
 * for AoE — this is the THIRD non-attack cantrip routing pattern
 * (single-target touch-effect, vs self-buff's no-target and AoE's
 * caster-centered multi-target).
 */
const CANTRIP_TOUCH_EFFECTS: Record<
  string,
  (caster: Combatant, target: Combatant, state: EngineState) => boolean
> = {
  'Spare the Dying': applySpareTheDyingTouchEffect, // PHB p.277: stabilize a downed PC ally (instant, no save)
  'Light': applyLightTouchEffect,                   // PHB p.255: set _lightSourceActive flag on target (1-hour canon, 1-round v1, no save v1)
  'Mending': applyMendingTouchEffect,               // PHB p.259: set _mended flag on target (canon 1-min casting time, v1: 1 action; instant canon, 1-round v1 cleanup)
  // Future non-attack touch-effect cantrips will be added here
};

/**
 * Resolve a non-attack touch-effect cantrip action.
 *
 * If `actionName` is registered in CANTRIP_TOUCH_EFFECTS, calls
 * its touch-effect handler with the (caster, target, state)
 * arguments and returns true. Otherwise returns false (caller
 * should fall through to the target-null guard and resolveAttack).
 *
 * Called from executePlannedAction() in combat.ts for 'attack'/'cast'
 * actions, AFTER resolveCantripAction (self-buffs) and resolveCantripAoE
 * (AoE), but BEFORE the target-null guard. Touch-effect cantrips
 * bypass the single-target attack-roll path entirely; the handler
 * applies the effect directly to the target (no attack roll, no
 * save in v1 — Spare the Dying and Light v1 are both no-save).
 *
 * If the target is null (no targetId in the PlannedAction), the
 * function returns true (the spell fizzles — the action is consumed
 * but no effect is applied). This mirrors CANTRIP_AOE_EFFECTS's
 * "spell is cast regardless" semantics.
 *
 * CRITICAL: this routing MUST come BEFORE the standard
 * `if (!target || target.isDead || target.isUnconscious) break;`
 * guard in executePlannedAction. Spare the Dying's target is an
 * UNCONSCIOUS ally at 0 HP, which the standard guard would block.
 * By consulting the touch-effect handler BEFORE that guard, Spare
 * the Dying can target downed allies. The handler itself decides
 * whether the spell fires (e.g. Spare the Dying fizzles on monsters
 * at 0 HP, on creatures above 0 HP, and on dead creatures).
 */
export function resolveCantripTouchEffect(
  caster: Combatant,
  target: Combatant | null,
  actionName: string,
  state: EngineState,
): boolean {
  const handler = CANTRIP_TOUCH_EFFECTS[actionName];
  if (!handler) return false;

  // No target: spell fizzles (action consumed, no effect).
  // This mirrors CANTRIP_AOE_EFFECTS's "spell is cast regardless"
  // semantics — the action is consumed even if the target is null.
  if (!target) return true;

  try {
    handler(caster, target, state);
    return true; // action consumed — touch cantrip bypasses resolveAttack
  } catch (e) {
    console.error(
      `[cantrip_effects] Error executing touch cantrip ${actionName}: ${e instanceof Error ? e.message : String(e)}`
    );
    return true; // still consume the action — the spell was "cast"
  }
}
