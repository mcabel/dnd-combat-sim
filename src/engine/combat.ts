// ============================================================
// Combat Engine
// Executes TurnPlans produced by the AI planner.
// Handles: attack resolution, movement, OA triggers,
//          legendary action windows, perception updates.
// ============================================================

import {
  Combatant, Battlefield, TurnPlan, PlannedAction, Action, Vec3
} from '../types/core';
import {
  rollAttack, rollDamage, rollSave, applyDamage, applyHeal,
  resetBudget, spendMovement, attackHits, attackAdvantageState, resolveAttackAdvantage,
  isBloodied, addCondition, removeCondition,
  rollConcentrationSave, rollDeathSave,
  applyDamageWithTempHP, hasPackTacticsAdvantage,
  canSneakAttack, sneakAttackDice,
  addResistance, removeResistance,
  parseDieSides, consumeBardicInspiration,
  teamHasNoAttackCapability, canDealDamage, makeImprovisedUnarmed, makeImprovisedWeapon,
  effectiveSpeed, rollDie, abilityMod, proficiencyBonus
} from './utils';
import {
  chebyshev3D, distanceFt, euclideanDistFt, canReach, estimateMoveCostFt,
  opportunityAttackTriggered, selectOAAction,
  livingEnemiesOf, livingAlliesOf, posKey
} from './movement';
import { planTurn, planLegendaryAction, shouldTakeOpportunityAttack } from '../ai/planner';
import { shouldSmite, applyDivineSmite, tickRage, consumeSpellSlot } from '../ai/resources';
import { isControlledMount, mountDeathRiderCheck, isIndependentMount } from '../summons/mount';
import { checkMountedCombatant, checkProtectionStyle, checkInterceptionReduction } from './mount_redirect';
import { tickAdvantages, grantSelf, grantVulnerability } from './adv_system';
import { getSummonEntry }                           from '../summons/registry';
import { rollGrappleContest, rollShoveContest, canGrappleOrShoveTarget } from './utils';
import { computeLOS } from './los';
import { removeEffectsFromCaster, removeEffectById, getActiveAcBonus, getActiveAcFloor, getActiveBlessDie, getActiveHexDie, getActiveDamageZones, getActiveWeaponEnchant, getActiveEnlargeReduce } from './spell_effects';
import { applyCantripEffect, getCantripAttackAdvantage, resolveCantripAction, resolveCantripAoE, resolveCantripTouchEffect } from './cantrip_effects';
import { execute as executeHex } from '../spells/hex';
import { execute as executeMagicMissile } from '../spells/magic_missile';
import { execute as executeBurningHands, shouldCast as shouldCastBurningHands } from '../spells/burning_hands';
import { execute as executeDissonantWhispers, shouldCast as shouldCastDissonantWhispers } from '../spells/dissonant_whispers';
import { shouldCast as shouldCastFaerieFire, execute as executeFaerieFire } from '../spells/faerie_fire';
import { shouldCast as shouldCastBless, execute as executeBless } from '../spells/bless';
import { shouldCast as shouldCastEntangle, execute as executeEntangle } from '../spells/entangle';
import { shouldCast as shouldCastThunderwave, execute as executeThunderwave } from '../spells/thunderwave';
import { execute as executeArmsOfHadar } from '../spells/arms_of_hadar';
import { shouldCast as shouldCastSleep, execute as executeSleep } from '../spells/sleep';
import { execute as executeWardingBond } from '../spells/warding_bond';
import { execute as executeShieldOfFaith } from '../spells/shield_of_faith';
import { shouldCast as shouldCastMageArmor, execute as executeMageArmor } from '../spells/mage_armor';
import { shouldCast as shouldCastShield, execute as executeShield } from '../spells/shield';
import {
  shouldCast as shouldCastGuidingBolt, execute as executeGuidingBolt,
  cleanupMarks as cleanupGuidingBoltMarks, consumeMark as consumeGuidingBoltMark,
} from '../spells/guiding_bolt';
import { execute as executeHealingWord } from '../spells/healing_word';
import { rollDiceString as rollBoomingBladeDice } from '../spells/booming_blade';
import { shouldCast as shouldCastAid, execute as executeAid } from '../spells/aid';
import { shouldCast as shouldCastBarkskin, execute as executeBarkskin } from '../spells/barkskin';
import { shouldCast as shouldCastBlur, execute as executeBlur } from '../spells/blur';
import { shouldCast as shouldCastBlindnessDeafness, execute as executeBlindnessDeafness } from '../spells/blindness_deafness';
import { shouldCast as shouldCastBrandingSmite, execute as executeBrandingSmite } from '../spells/branding_smite';
import { shouldCast as shouldCastCalmEmotions, execute as executeCalmEmotions } from '../spells/calm_emotions';
import { shouldCast as shouldCastCloudOfDaggers, execute as executeCloudOfDaggers } from '../spells/cloud_of_daggers';
import { shouldCast as shouldCastCrownOfMadness, execute as executeCrownOfMadness } from '../spells/crown_of_madness';
import { shouldCast as shouldCastHoldPerson, execute as executeHoldPerson } from '../spells/hold_person';
import { shouldCast as shouldCastMirrorImage, execute as executeMirrorImage } from '../spells/mirror_image';
// ── Session 17 — level-2 batch 3 (15 new PHB level-2 spells) ──────────────
import {
  shouldCast as shouldCastEnlargeReduce,
  execute as executeEnlargeReduce,
} from '../spells/enlarge_reduce';
import {
  shouldCast as shouldCastEnhanceAbility,
  execute as executeEnhanceAbility,
} from '../spells/enhance_ability';
import {
  shouldCast as shouldCastFlameBlade,
  execute as executeFlameBlade,
} from '../spells/flame_blade';
import {
  shouldCast as shouldCastFlamingSphere,
  execute as executeFlamingSphere,
} from '../spells/flaming_sphere';
import {
  shouldCast as shouldCastHeatMetal,
  execute as executeHeatMetal,
} from '../spells/heat_metal';
import {
  shouldCast as shouldCastMelfsAcidArrow,
  execute as executeMelfsAcidArrow,
} from '../spells/melf_s_acid_arrow';
import {
  shouldCast as shouldCastMistyStep,
  execute as executeMistyStep,
} from '../spells/misty_step';
import {
  shouldCast as shouldCastInvisibility,
  execute as executeInvisibility,
} from '../spells/invisibility';
import {
  shouldCast as shouldCastGustOfWind,
  execute as executeGustOfWind,
} from '../spells/gust_of_wind';
import {
  shouldCast as shouldCastLevitate,
  execute as executeLevitate,
} from '../spells/levitate';
import {
  shouldCast as shouldCastLesserRestoration,
  execute as executeLesserRestoration,
} from '../spells/lesser_restoration';
import {
  shouldCast as shouldCastMagicWeapon,
  execute as executeMagicWeapon,
} from '../spells/magic_weapon';
import {
  shouldCast as shouldCastCordonOfArrows,
  execute as executeCordonOfArrows,
} from '../spells/cordon_of_arrows';
import {
  shouldCast as shouldCastAlterSelf,
  execute as executeAlterSelf,
} from '../spells/alter_self';
import {
  shouldCast as shouldCastDarkvision,
  execute as executeDarkvision,
} from '../spells/darkvision';

// ── Session 18 — level-2 batch 4 (20 new PHB level-2 spells) ──────────────
import {
  shouldCast as shouldCastMoonbeam,
  execute as executeMoonbeam,
} from '../spells/moonbeam';
import {
  shouldCast as shouldCastScorchingRay,
  execute as executeScorchingRay,
} from '../spells/scorching_ray';
import {
  shouldCast as shouldCastShatter,
  execute as executeShatter,
} from '../spells/shatter';
import {
  shouldCast as shouldCastSpikeGrowth,
  execute as executeSpikeGrowth,
} from '../spells/spike_growth';
import {
  shouldCast as shouldCastSpiritualWeapon,
  execute as executeSpiritualWeapon,
} from '../spells/spiritual_weapon';
import {
  shouldCast as shouldCastPhantasmalForce,
  execute as executePhantasmalForce,
} from '../spells/phantasmal_force';
import {
  shouldCast as shouldCastRayOfEnfeeblement,
  execute as executeRayOfEnfeeblement,
} from '../spells/ray_of_enfeeblement';
import {
  shouldCast as shouldCastWeb,
  execute as executeWeb,
} from '../spells/web';
import {
  shouldCast as shouldCastSilence,
  execute as executeSilence,
} from '../spells/silence';
import {
  shouldCast as shouldCastSuggestion,
  execute as executeSuggestion,
} from '../spells/suggestion';
import {
  shouldCast as shouldCastZoneOfTruth,
  execute as executeZoneOfTruth,
} from '../spells/zone_of_truth';
import {
  shouldCast as shouldCastEnthrall,
  execute as executeEnthrall,
} from '../spells/enthrall';
import {
  shouldCast as shouldCastDetectThoughts,
  execute as executeDetectThoughts,
} from '../spells/detect_thoughts';
import {
  shouldCast as shouldCastSeeInvisibility,
  execute as executeSeeInvisibility,
} from '../spells/see_invisibility';
import {
  shouldCast as shouldCastSpiderClimb,
  execute as executeSpiderClimb,
} from '../spells/spider_climb';
import {
  shouldCast as shouldCastPassWithoutTrace,
  execute as executePassWithoutTrace,
} from '../spells/pass_without_trace';
import {
  shouldCast as shouldCastProtectionFromPoison,
  execute as executeProtectionFromPoison,
} from '../spells/protection_from_poison';
import {
  shouldCast as shouldCastPrayerOfHealing,
  execute as executePrayerOfHealing,
} from '../spells/prayer_of_healing';
import {
  shouldCast as shouldCastKnock,
  execute as executeKnock,
} from '../spells/knock';
import {
  shouldCast as shouldCastArcaneLock,
  execute as executeArcaneLock,
} from '../spells/arcane_lock';

// ── Session 21 — Real-mechanics migration (7 combat damage spells) ─────────
// Migrated from the Session 19/20 generic dispatch registry to bespoke
// implementations with real mechanical effects (DEX/CON saves, spell
// attack rolls, AoE damage). Mirrors the Session 18 bespoke pattern
// (Moonbeam / Shatter / Scorching Ray). Each migrated spell:
//   - Removed from _generic_registry.ts (no longer dispatched via 'genericSpell')
//   - Has its own case branch in executePlannedAction (below)
//   - Has its own planner branch in planner.ts (sets plan.action.type)
//   - Has its own test file in src/test/<spell>.test.ts
import {
  shouldCast as shouldCastFireball,
  execute as executeFireball,
} from '../spells/fireball';
import {
  shouldCast as shouldCastLightningBolt,
  execute as executeLightningBolt,
} from '../spells/lightning_bolt';
import {
  shouldCast as shouldCastConeOfCold,
  execute as executeConeOfCold,
} from '../spells/cone_of_cold';
import {
  shouldCast as shouldCastInflictWounds,
  execute as executeInflictWounds,
} from '../spells/inflict_wounds';
import {
  shouldCast as shouldCastChromaticOrb,
  execute as executeChromaticOrb,
} from '../spells/chromatic_orb';
import {
  shouldCast as shouldCastCatapult,
  execute as executeCatapult,
} from '../spells/catapult';
import {
  shouldCast as shouldCastIceKnife,
  execute as executeIceKnife,
} from '../spells/ice_knife';

// ── Session 23 — Real-mechanics migration batch 2 (7 high-damage spells L4-9) ─
// Migrated from the Session 19/20 generic dispatch registry to bespoke
// implementations with real mechanical effects (CON/DEX saves, HP-check
// instakill, AoE damage + blindness). Mirrors the Session 22 bespoke
// patterns (Catapult for single-target saves, Shatter/Fireball for AoE
// saves, plus a NEW HP-check instakill pattern for Power Word Kill).
// Each migrated spell:
//   - Removed from _generic_registry.ts (no longer dispatched via 'genericSpell')
//   - Has its own case branch in executePlannedAction (below)
//   - Has its own planner branch in planner.ts (sets plan.action.type)
//   - Has its own test file in src/test/<spell>.test.ts
import {
  shouldCast as shouldCastBlight,
  execute as executeBlight,
} from '../spells/blight';
import {
  shouldCast as shouldCastCloudkill,
  execute as executeCloudkill,
} from '../spells/cloudkill';
import {
  shouldCast as shouldCastDisintegrate,
  execute as executeDisintegrate,
} from '../spells/disintegrate';
import {
  shouldCast as shouldCastHarm,
  execute as executeHarm,
} from '../spells/harm';
import {
  shouldCast as shouldCastFingerOfDeath,
  execute as executeFingerOfDeath,
} from '../spells/finger_of_death';
import {
  shouldCast as shouldCastSunburst,
  execute as executeSunburst,
} from '../spells/sunburst';
import {
  shouldCast as shouldCastPowerWordKill,
  execute as executePowerWordKill,
} from '../spells/power_word_kill';

// ── Session 24 — Megabatch batch 1 (L1 combat damage spells) ────────────
// Migrated from the Session 19/20 generic dispatch registry to bespoke
// implementations with real mechanical effects. Mirrors the Session 21/22/23
// bespoke patterns. Includes a NEW per-turn concentration-DoT pattern for
// Witch Bolt (auto-hit 1d12 while concentration holds; ends if the caster
// uses their action for anything else — see the guard at the top of
// executePlannedAction). Each migrated spell:
//   - Removed from _generic_registry.ts (no longer dispatched via 'genericSpell')
//   - Has its own case branch in executePlannedAction (below)
//   - Has its own planner branch in planner.ts
//   - Has its own test file in src/test/<spell>.test.ts
import {
  shouldCast as shouldCastChaosBolt,
  execute as executeChaosBolt,
} from '../spells/chaos_bolt';
import {
  shouldCast as shouldCastEarthTremor,
  execute as executeEarthTremor,
} from '../spells/earth_tremor';
import {
  shouldCast as shouldCastFrostFingers,
  execute as executeFrostFingers,
} from '../spells/frost_fingers';
import {
  shouldCast as shouldCastMagnifyGravity,
  execute as executeMagnifyGravity,
} from '../spells/magnify_gravity';
import {
  shouldCast as shouldCastRayOfSickness,
  execute as executeRayOfSickness,
} from '../spells/ray_of_sickness';
import {
  shouldCast as shouldCastSpellfireFlare,
  execute as executeSpellfireFlare,
} from '../spells/spellfire_flare';
import {
  shouldCast as shouldCastWardaway,
  execute as executeWardaway,
} from '../spells/wardaway';
import {
  shouldCast as shouldCastWitchBolt,
  execute as executeWitchBolt,
} from '../spells/witch_bolt';
import {
  shouldCast as shouldCastMindSpike,
  execute as executeMindSpike,
} from '../spells/mind_spike';
import {
  shouldCast as shouldCastSprayOfCards,
  execute as executeSprayOfCards,
} from '../spells/spray_of_cards';
import {
  shouldCast as shouldCastEruptingEarth,
  execute as executeEruptingEarth,
} from '../spells/erupting_earth';
import {
  shouldCast as shouldCastLifeTransference,
  execute as executeLifeTransference,
} from '../spells/life_transference';
import {
  shouldCast as shouldCastPulseWave,
  execute as executePulseWave,
} from '../spells/pulse_wave';
import {
  shouldCast as shouldCastTidalWave,
  execute as executeTidalWave,
} from '../spells/tidal_wave';
import {
  shouldCast as shouldCastVampiricTouch,
  execute as executeVampiricTouch,
} from '../spells/vampiric_touch';

// ── Session 19 — bulk-implementation generic dispatch (262 new spells) ────
import {
  lookupGenericSpell,
} from '../spells/_generic_registry';

// ---- Combat log ---------------------------------------------

export interface CombatEvent {
  round: number;
  actorId: string;
  type:
    | 'attack_hit' | 'attack_miss' | 'attack_crit'
    | 'damage' | 'heal'
    | 'death' | 'unconscious'
    | 'move'
    | 'action' | 'dash' | 'disengage' | 'dodge'
    | 'opportunity_attack'
    | 'legendary_action'
    | 'condition_add' | 'condition_remove'
    | 'save_success' | 'save_fail'
    | 'combat_start' | 'combat_end';
  targetId?: string;
  value?: number;        // damage amount, heal amount, roll result
  description: string;
}

export interface CombatLog {
  events: CombatEvent[];
  winner: 'party' | 'enemy' | 'draw' | null;
  rounds: number;
}

function log(
  state: EngineState,
  type: CombatEvent['type'],
  actorId: string,
  description: string,
  targetId?: string,
  value?: number
): void {
  state.log.events.push({
    round: state.battlefield.round,
    actorId,
    type,
    targetId,
    value,
    description,
  });
}

// ---- Engine state -------------------------------------------

export interface EngineState {
  battlefield: Battlefield;
  log: CombatLog;
  // Per-turn flags (reset each turn)
  disengagedThisTurn: Set<string>;   // combatant IDs that used Disengage
  // Per-round damage tracking (for 10-round no-damage auto-defeat rule)
  damageThisRound: Map<string, number>;   // faction → total damage dealt this round
  noDamageRounds: Map<string, number>;    // faction → consecutive rounds with 0 damage
  // Rage tracking: IDs of combatants that took damage since their last rage tick.
  // Populated whenever dealt > 0; cleared per-actor at start of their turn.
  rageDamagedSinceLastTurn: Set<string>;
}

function makeState(battlefield: Battlefield): EngineState {
  return {
    battlefield,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// ---- Attack resolution --------------------------------------

/**
 * Resolve a single attack action against a target.
 * Handles: attack roll, hit check, damage roll, crit, death.
 *
 * Exported for direct testing of cantrip engine integration (e.g. Vicious
 * Mockery's one-shot consume-on-attack semantics, Sacred Flame's
 * bypassesCover, Chill Touch's undead-disadv). Normal callers should use
 * runCombat / executePlannedAction rather than invoking this directly.
 */
export function resolveAttack(
  attacker: Combatant,
  target: Combatant,
  action: Action,
  state: EngineState,
  isCritOverride?: boolean   // force crit (used for tests)
): void {
  const bf = state.battlefield;

  // ── LOS / Cover check (PHB Ch.10, DMG Ch.8) ─────────────────────────────
  // Skip for save-based AoE (area is targeted, not an individual creature).
  // For melee/ranged/spell attacks: block on total cover; AC bonus otherwise.
  // For save-based single-target spells: block on total cover too — UNLESS the
  // action bypasses cover (PHB p.272 Sacred Flame: "The target gains no benefit
  // from cover for this saving throw."). action.bypassesCover === true skips
  // the LOS check entirely, letting Sacred Flame target a creature even behind
  // total cover.
  const computeLosForAction =
    action.attackType === 'save'
      ? action.bypassesCover !== true   // save: skip LOS only when bypassesCover
      : true;                            // non-save: always compute LOS
  const los = computeLosForAction
    ? computeLOS(attacker, target, bf)
    : null;

  if (los && !los.hasLineOfEffect) {
    log(state, 'action', attacker.id,
      `${attacker.name}'s attack on ${target.name} is blocked — Total Cover!`, target.id);
    return;
  }

  // Pack Tactics: advantage if ally adjacent to target (MM)
  const packTacticsAdvantage = hasPackTacticsAdvantage(attacker, target, bf);

  // Save-based attacks (no attack roll)
  if (action.attackType === 'save' && action.saveDC !== null && action.saveAbility !== null) {
    const save = rollSave(target, action.saveAbility, action.saveDC);
    log(state, save.success ? 'save_success' : 'save_fail', attacker.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} DC ${action.saveDC} ${action.saveAbility} save (rolled ${save.total})`,
      target.id, save.roll);

    if (action.damage) {
      const dmg = rollDamage(action.damage, false);
      const actual = save.success ? Math.floor(dmg / 2) : dmg; // half on save success
      const dealt = applyDamageWithTempHP(target, actual, action.damageType);
      // Concentration check if target was concentrating
      if (target.concentration?.active && dealt > 0) {
        const maintained = rollConcentrationSave(target, dealt);
        if (!maintained) {
          removeEffectsFromCaster(target.id, state.battlefield);
          log(state, 'condition_remove', target.id,
            `${target.name} loses concentration on ${target.concentration?.spellName ?? 'spell'}!`, undefined);
        }
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} deals ${dealt} ${action.damageType ?? ''} damage to ${target.name} (save ${save.success ? 'halved' : 'full'})`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      applyWardingBondRedirect(target, dealt, state);
      checkDeath(target, state);
    }
    // Apply post-save-FAIL cantrip riders (e.g. Vicious Mockery disadv on next
    // attack, PHB p.285). The dispatcher is a no-op for unknown cantrip names
    // and for cantrips with no rider. Rider applies ONLY when the save failed.
    if (!save.success) {
      applyCantripEffect(attacker, target, action.name, state);
    }
    return;
  }

  // Auto-hit (no hitBonus — e.g. Reaping Scythe, Magic Missile)
  if (action.hitBonus === null) {
    if (action.damage) {
      const dmg = rollDamage(action.damage, false);
      const dealt = applyDamageWithTempHP(target, dmg, action.damageType);
      if (target.concentration?.active && dealt > 0) {
        const maintained = rollConcentrationSave(target, dealt);
        if (!maintained) {
          removeEffectsFromCaster(target.id, state.battlefield);
          log(state, 'condition_remove', target.id,
            `${target.name} loses concentration!`, undefined);
        }
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} auto-hits ${target.name} for ${dealt} ${action.damageType ?? ''} damage`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      applyWardingBondRedirect(target, dealt, state);
      checkDeath(target, state, attacker);
    }
    return;
  }

  // Standard attack roll — include Pack Tactics advantage, Prone modifier, and Help action
  const advState = resolveAttackAdvantage(attacker, target, action.attackType);
  const { advantage: baseAdv, disadvantage: baseDisadv } = advState;
  // Cantrip intrinsic advantage (pre-roll): e.g. Shocking Grasp vs metal armor (PHB p.275)
  const cantripAdv = getCantripAttackAdvantage(attacker, target, action.name);
  // `advantage` is computed below (after the True Strike flag is read) so it
  // can fold in the True Strike self-buff advantage (PHB p.284). baseAdv /
  // cantripAdv / packTacticsAdvantage / helpedThisTurn are pre-computed here.

  // Guiding Bolt mark: consume on the first attack roll against the illuminated target (PHB p.248).
  // Advantage from the mark is already captured in advState above; consuming it now ensures
  // only one attack benefits regardless of multiattack or multiple attackers.
  const gbConsumed = consumeGuidingBoltMark(target);
  if (gbConsumed) {
    log(state, 'condition_remove', attacker.id,
      `Guiding Bolt's illumination fades from ${target.name} (consumed by this attack).`, target.id);
  }

  // Cunning Action: Hide — hidden attacker is revealed on attack, hit or miss (PHB p.177/194).
  // Advantage was already captured above by resolveAttackAdvantage reading the 'hidden' condition.
  if (attacker.conditions.has('hidden')) {
    removeCondition(attacker, 'hidden');
    log(state, 'condition_remove', attacker.id,
      `${attacker.name} is revealed after attacking!`, target.id);
  }

  // ST-5B: Fighting Style: Protection — rider imposes disadvantage on attack vs mount (reaction)
  const protectionRider = checkProtectionStyle(target, bf);
  if (protectionRider) {
    log(state, 'action', protectionRider.id,
      `${protectionRider.name} uses Protection — disadvantage on attack against ${target.name}!`,
      target.id);
  }
  // Vision blocked by obstacle (fog cloud, magical darkness) → Disadvantage (PHB Ch.10)
  const losDisadvantage = los !== null && !los.hasLineOfSight;
  if (losDisadvantage) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Disadvantage (vision blocked).`, target.id);
  }
  // Chill Touch (PHB p.221): an undead hit by Chill Touch has disadvantage on
  // attack rolls against the caster who struck it, until end of caster's next
  // turn. The undead's _chillTouchDisadvVs holds the caster's ID.
  const chillTouchDisadv =
    !!attacker._chillTouchDisadvVs && attacker._chillTouchDisadvVs === target.id;
  if (chillTouchDisadv) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Disadvantage (Chill Touch).`, target.id);
  }
  // Vicious Mockery (PHB p.285): a creature that failed its WIS save against
  // Vicious Mockery has disadvantage on the NEXT attack roll it makes before
  // the end of its next turn. This is a ONE-SHOT debuff — consumed (set back
  // to false) immediately after this attack roll resolves, hit or miss.
  // Distinct from Chill Touch's ongoing undead-disadv (which lasts the whole
  // turn). The flag is set by Vicious Mockery's applyCantripEffect on save-fail.
  const viciousMockeryDisadv = attacker._viciousMockeryDisadvNextAttack === true;
  if (viciousMockeryDisadv) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Disadvantage (Vicious Mockery).`, target.id);
  }
  // Frostbite (XGE p.156): a creature that failed its CON save against
  // Frostbite has disadvantage on the NEXT WEAPON ATTACK roll it makes
  // before the end of its next turn. ONE-SHOT (consumed after this attack).
  // Distinct from Vicious Mockery in two ways:
  //   1. Weapon attacks ONLY — spell attacks (attackType='spell') do NOT
  //      consume the flag and do NOT suffer the disadvantage.
  //   2. Damage type + save ability differ (cold / CON vs psychic / WIS).
  // The flag is set by Frostbite's applyCantripEffect on save-FAIL.
  const isWeaponAttack =
    action.attackType === 'melee' || action.attackType === 'ranged';
  const frostbiteDisadv =
    isWeaponAttack && attacker._frostbiteDisadvNextWeaponAttack === true;
  if (frostbiteDisadv) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Disadvantage (Frostbite).`, target.id);
  }
  // True Strike (PHB p.284): the caster's self-buff grants advantage on
  // the FIRST attack roll on the caster's NEXT turn (v1 simplification:
  // target-agnostic — applies to any attack roll, not just against the
  // creature True Strike was cast on). ONE-SHOT (consumed after this
  // attack). Distinct from Shocking Grasp (which grants advantage on
  // the SAME turn vs metal armor — pre-roll, via CANTRIP_ATTACK_ADVANTAGE).
  // Distinct from Frostbite (which is weapon-only DISADVANTAGE on the
  // target — True Strike is any-attack-type ADVANTAGE on the caster).
  // The flag is set by True Strike's applySelfEffect on cast (CANTRIP_SELF_EFFECTS).
  const trueStrikeAdv = attacker._trueStrikeAdvNextAttack === true;
  if (trueStrikeAdv) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Advantage (True Strike).`, target.id);
  }
  const disadvantage = baseDisadv || !!protectionRider || losDisadvantage || chillTouchDisadv || viciousMockeryDisadv || frostbiteDisadv;
  const advantage = baseAdv || packTacticsAdvantage || attacker.helpedThisTurn || cantripAdv || trueStrikeAdv;

  // Shillelagh (PHB p.275): while the self-buff is active, MELEE attacks use
  // WIS mod instead of STR mod for the attack roll. The substitution delta is
  // (WIS_mod - STR_mod) — applied to the hitBonus only when
  // `_shillelaghActive === true && action.attackType === 'melee'`. Ranged and
  // spell attacks do NOT benefit (PHB p.275: "melee attacks using that weapon").
  // v1 simplification: the +1d8 radiant damage on hit is added separately in
  // the damage section below. See src/spells/shillelagh.ts for details.
  const shillelaghActive =
    attacker._shillelaghActive === true && action.attackType === 'melee';
  let shillelaghHitBonusDelta = 0;
  if (shillelaghActive) {
    const wisMod = abilityMod(attacker.wis);
    const strMod = abilityMod(attacker.str);
    shillelaghHitBonusDelta = wisMod - strMod;
    if (shillelaghHitBonusDelta !== 0) {
      log(state, 'action', attacker.id,
        `${attacker.name} channels Shillelagh — melee attack uses WIS (${wisMod >= 0 ? '+' : ''}${wisMod}) instead of STR (${strMod >= 0 ? '+' : ''}${strMod}) for the attack roll (delta ${shillelaghHitBonusDelta >= 0 ? '+' : ''}${shillelaghHitBonusDelta}).`, target.id);
    }
  }
  const shillelaghHitBonus = (action.hitBonus ?? 0) + shillelaghHitBonusDelta;

  // ── Mirror Image retargeting (PHB p.260) ─────────────────────────────
  // Before the attack roll, if the target has Mirror Image active, roll a
  // d20 to determine whether the attack instead targets one of the
  // illusory duplicates. Retargeting thresholds (PHB p.260):
  //   3 duplicates: d20 ≥ 6 retargets
  //   2 duplicates: d20 ≥ 8 retargets
  //   1 duplicate:  d20 ≥ 11 retargets
  // If retargeted, the SAME attack roll is compared against the duplicate's
  // AC (10 + target's DEX mod) instead of the caster's effective AC. On a
  // hit, one duplicate is destroyed (decrement `_mirrorImageDuplicates`).
  // On a miss, the attack simply misses (no effect on the caster or any
  // duplicate). Either way, the attack doesn't affect the real caster.
  // The spell ends when all three duplicates are destroyed (PHB p.260).
  // v1 simplifications: duration not tracked (lasts until all duplicates
  // destroyed); sight-dependency immunity (blindsight/truesight) NOT
  // modelled (TG-004). See `_mirrorImageDuplicates` doc comment in core.ts.
  const mirrorDuplicates = target._mirrorImageDuplicates ?? 0;
  let mirrorRetargeted = false;
  if (mirrorDuplicates > 0) {
    // Thresholds indexed by remaining duplicate count. Index 0 unused.
    // (Mirrors metadata.retargetThresholds in src/spells/mirror_image.ts.)
    const mirrorThresholds = [0, 11, 8, 6];
    const mirrorThreshold = mirrorThresholds[mirrorDuplicates] ?? 11;
    const mirrorRoll = rollDie(20);
    mirrorRetargeted = mirrorRoll >= mirrorThreshold;
    log(state, 'action', attacker.id,
      `${target.name}'s Mirror Image: retarget roll ${mirrorRoll} vs DC ${mirrorThreshold} (${mirrorDuplicates} duplicate${mirrorDuplicates !== 1 ? 's' : ''}) → ${mirrorRetargeted ? 'attack redirected to a duplicate!' : 'attack proceeds against the real ' + target.name}.`,
      target.id, mirrorRoll);
  }

  const result = rollAttack(shillelaghHitBonus, advantage, disadvantage);

  // Vicious Mockery one-shot consume: the debuff applies to exactly one attack
  // roll (PHB p.285). Consume it now — whether the attack hit or missed — so
  // subsequent attacks in the same turn (e.g. Multiattack) are unaffected.
  if (viciousMockeryDisadv) {
    attacker._viciousMockeryDisadvNextAttack = false;
    log(state, 'condition_remove', attacker.id,
      `${attacker.name}'s Vicious Mockery debuff fades (consumed by attack).`, target.id);
  }
  // Frostbite one-shot consume: same one-shot semantics as Vicious Mockery,
  // but ONLY consumed when the attack is a weapon attack (the flag stays set
  // if the marked creature casts a spell attack instead — XGE p.156 explicitly
  // says "weapon attack roll", so spell attacks neither suffer the disadv nor
  // consume the flag).
  if (frostbiteDisadv) {
    attacker._frostbiteDisadvNextWeaponAttack = false;
    log(state, 'condition_remove', attacker.id,
      `${attacker.name}'s Frostbite debuff fades (consumed by weapon attack).`, target.id);
  }
  // True Strike one-shot consume: the buff applies to exactly one attack roll
  // (PHB p.284: "your first attack roll"). Consume it now — whether the attack
  // hit or missed — so subsequent attacks in the same turn (e.g. Multiattack)
  // are unaffected. Unlike Frostbite, True Strike is NOT attack-type-restricted
  // (any attack roll consumes the buff).
  if (trueStrikeAdv) {
    attacker._trueStrikeAdvNextAttack = false;
    log(state, 'condition_remove', attacker.id,
      `${attacker.name}'s True Strike insight fades (consumed by attack).`, target.id);
  }

  // Bardic Inspiration die — consumed on this attack roll (PHB p.54)
  const biBonus = consumeBardicInspiration(attacker);
  if (biBonus > 0) {
    result.total += biBonus;
    log(state, 'action', attacker.id,
      `${attacker.name} uses Bardic Inspiration die (+${biBonus})!`, target.id, biBonus);
  }

  // Bless die — +1d4 to attack rolls when blessed (PHB p.219)
  const blessSides = getActiveBlessDie(attacker);
  if (blessSides > 0) {
    const blessBonus = rollDie(blessSides);
    result.total += blessBonus;
    log(state, 'action', attacker.id,
      `${attacker.name} rolls Bless die (+${blessBonus})!`, target.id, blessBonus);
  }

  // Magic Weapon (PHB p.257) — Session 17: +N to attack rolls with weapon
  // attacks (melee/ranged, NOT spell). The damage bonus is applied in the
  // damage branch below. Crit doesn't affect flat bonuses (PHB p.196).
  const mwEnchant = getActiveWeaponEnchant(attacker);
  if (mwEnchant.attackBonus > 0 && (action.attackType === 'melee' || action.attackType === 'ranged')) {
    result.total += mwEnchant.attackBonus;
    log(state, 'action', attacker.id,
      `${attacker.name} adds Magic Weapon bonus (+${mwEnchant.attackBonus} to attack)!`, target.id, mwEnchant.attackBonus);
  }

  // Warding Bond: +1 AC while bonded (PHB p.287)
  // Cover: +2 (half) or +5 (three-quarters) to AC from obstacles (DMG Ch.8 p.196)
  // Barkskin: AC can't be less than 16 (PHB p.217) — ac_floor effect applied
  //   by spell_effects.ts; the floor is applied to natural AC BEFORE bonuses.
  // Mirror Image: if the attack was retargeted to a duplicate (PHB p.260),
  //   the effective AC is the duplicate's AC (10 + target's DEX mod) — NOT
  //   the caster's normal AC. The duplicate ignores all bonuses (Warding
  //   Bond, cover, ac_bonus, ac_floor) — it's a separate target.
  let effectiveAC: number;
  if (mirrorRetargeted) {
    effectiveAC = 10 + abilityMod(target.dex);  // PHB p.260: duplicate's AC
  } else {
    const acFloor = getActiveAcFloor(target);
    const naturalAC = acFloor > 0 ? Math.max(target.ac, acFloor) : target.ac;
    effectiveAC = naturalAC + (target.wardingBond ? 1 : 0) + (los?.coverACBonus ?? 0) + getActiveAcBonus(target);
  }
  const hits = isCritOverride ?? attackHits(result.roll, result.total, effectiveAC);

  // ── Mirror Image duplicate resolution (PHB p.260) ────────────────────
  // If the attack was retargeted to a duplicate, resolve it now: on hit,
  // destroy one duplicate (decrement the counter); on miss, the attack
  // simply misses. Either way, the attack doesn't affect the real caster
  // — return early (skip the damage section entirely). The duplicate
  // "ignores all other damage and effects" (PHB p.260).
  if (mirrorRetargeted) {
    if (hits) {
      const newDuplicateCount = mirrorDuplicates - 1;
      target._mirrorImageDuplicates = newDuplicateCount;
      log(state, 'action', attacker.id,
        `${attacker.name}'s attack hits a mirror image duplicate and destroys it! (${newDuplicateCount} duplicate${newDuplicateCount !== 1 ? 's' : ''} remaining)`,
        target.id);
      if (newDuplicateCount === 0) {
        log(state, 'condition_remove', target.id,
          `${target.name}'s Mirror Image ends — all duplicates destroyed!`,
          target.id);
      }
    } else {
      log(state, 'attack_miss', attacker.id,
        `${attacker.name}'s attack misses the mirror image duplicate (rolled ${result.roll}+${action.hitBonus}=${result.total} vs duplicate AC ${effectiveAC})`,
        target.id, result.roll);
    }
    return;  // Attack doesn't affect the real caster (PHB p.260)
  }

  if (!hits) {
    log(state, 'attack_miss', attacker.id,
      `${attacker.name} misses ${target.name} with ${action.name} (rolled ${result.roll}+${action.hitBonus}=${result.total} vs AC ${effectiveAC})`,
      target.id, result.roll);
    return;
  }

  // PHB p.197: hitting an unconscious PC at 0 HP = automatic death save failure.
  // Melee attack within 5 ft = critical hit = 2 failures (PHB p.197).
  if (target.isUnconscious && target.isPlayer && target.currentHP === 0 && target.deathSaves) {
    const dist = Math.max(Math.abs(attacker.pos.x - target.pos.x), Math.abs(attacker.pos.y - target.pos.y));
    const meleeRange = dist <= 1;
    const extraFails = meleeRange ? 2 : 1;
    target.deathSaves.failures = Math.min(3, target.deathSaves.failures + extraFails);
    log(state, 'action', attacker.id,
      `${attacker.name} hits the downed ${target.name}! ${extraFails} death save failure${extraFails > 1 ? 's' : ''} (${target.deathSaves.failures}/3)`,
      target.id, 0);
    if (target.deathSaves.failures >= 3) {
      target.isDead = true;
      target.isUnconscious = false;
      log(state, 'death', target.id,
        `${target.name} has taken too many hits while downed — they die!`, undefined, 0);
    }
    return; // no damage dealt to a dying PC — hits just add failures
  }

  const isCrit = isCritOverride === true || result.isCrit;
  log(state, isCrit ? 'attack_crit' : 'attack_hit', attacker.id,
    `${attacker.name} ${isCrit ? 'CRITS' : 'hits'} ${target.name} with ${action.name} (${result.total} vs AC ${effectiveAC})`,
    target.id, result.roll);

  if (action.damage) {
    let dmg = rollDamage(action.damage, isCrit);

    // Divine Smite: Paladin expends a spell slot on a hit (PHB p.85)
    if (attacker.resources?.divineSmite && shouldSmite(attacker, target, isCrit)) {
      const smiteDmg = applyDivineSmite(attacker, isCrit);
      if (smiteDmg > 0) {
        dmg += smiteDmg;
        log(state, 'action', attacker.id,
          `${attacker.name} uses Divine Smite for +${smiteDmg} radiant damage!`, target.id, smiteDmg);
      }
    }

    // Sneak Attack: check and apply if eligible (Rogue with finesse/ranged weapon)
    const allyAdjToTarget = [...bf.combatants.values()].some(c =>
      c.faction === attacker.faction && c.id !== attacker.id && !c.isDead &&
      Math.max(Math.abs(c.pos.x - target.pos.x), Math.abs(c.pos.y - target.pos.y)) <= 1
    );
    if (canSneakAttack(attacker, action, advantage, disadvantage, allyAdjToTarget)) {
      const saDice = sneakAttackDice(1); // level 1 = 1d6; TODO: track rogue level
      const saRoll = rollDamage(saDice, isCrit);
      dmg += saRoll;
      attacker.usedSneakAttackThisTurn = true;
      log(state, 'action', attacker.id,
        `${attacker.name} applies Sneak Attack (+${saRoll} damage)!`, target.id, saRoll);
    }

    // Rage damage bonus: +2 to melee damage while raging (PHB p.48).
    // Applies to melee weapon attacks only (not ranged, not saves, not auto-hit).
    if (
      attacker.resources?.rage?.active &&
      action.attackType === 'melee'
    ) {
      const rageBonus = 2; // Level 1–8: +2 (level 9+ and 16+ are future work)
      dmg += rageBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds Rage bonus (+${rageBonus} damage)!`, target.id, rageBonus);
    }

    // Shillelagh (PHB p.275): while the self-buff is active, MELEE attacks
    // gain +1d8 radiant damage on hit (v1 simplification — canonically the
    // weapon's damage die BECOMES 1d8, but v1 adds +1d8 radiant on top of
    // the weapon's existing damage to sidestep the engine complexity of
    // identifying which Action is the buffed weapon). The WIS-for-STR
    // substitution on the attack ROLL was already applied above (before
    // rollAttack). This block handles the DAMAGE substitution only.
    // Mirrors Divine Smite / Hex bonus-damage patterns (roll die, add to dmg,
    // log). Crit doubles the dice via rollDamage — but Shillelagh's +1d8 is
    // rolled separately via rollDie (not part of action.damage), so we
    // manually double it on crit for consistency with PHB p.196.
    if (shillelaghActive) {
      let shillelaghDice = isCrit ? 2 : 1; // crit doubles damage dice (PHB p.196)
      let shillelaghBonus = 0;
      for (let i = 0; i < shillelaghDice; i++) shillelaghBonus += rollDie(8);
      dmg += shillelaghBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds Shillelagh bonus (+${shillelaghBonus} radiant${isCrit ? ' CRIT' : ''})!`, target.id, shillelaghBonus);
    }

    // Branding Smite (PHB p.219): while the self-buff is active, the next
    // weapon attack (melee OR ranged, NOT spell) deals an extra 2d6 radiant
    // damage. The buff is CONSUMED after this hit (one-shot, mirror
    // Shillelagh's +1d8 pattern but one-shot instead of persistent — see
    // `_brandingSmiteActive` doc comment in core.ts). Crit doubles the dice
    // (PHB p.196). v1 simplification: skips the invisibility-suppression
    // (forward-compat TODO via `brandingSmiteInvisibilitySuppressionV1Implemented`
    // metadata flag).
    if (
      attacker._brandingSmiteActive === true &&
      (action.attackType === 'melee' || action.attackType === 'ranged')
    ) {
      let brandingDice = isCrit ? 4 : 2; // 2d6 radiant, crit → 4d6 (PHB p.196)
      let brandingBonus = 0;
      for (let i = 0; i < brandingDice; i++) brandingBonus += rollDie(6);
      dmg += brandingBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds Branding Smite bonus (+${brandingBonus} radiant${isCrit ? ' CRIT' : ''})!`, target.id, brandingBonus);
      // Consume the buff (one-shot — PHB p.219: "the next time you hit a
      // creature with a weapon attack before this spell ends" — singular).
      attacker._brandingSmiteActive = false;
    }

    // Hex damage: +1d6 necrotic when the warlock who hexed the target hits it (PHB p.251)
    const hexDie = getActiveHexDie(target, attacker.id);
    if (hexDie > 0) {
      const hexRoll = rollDie(hexDie);
      dmg += hexRoll;
      log(state, 'action', attacker.id,
        `${attacker.name} deals Hex bonus (+${hexRoll} necrotic) to ${target.name}`, target.id, hexRoll);
    }

    // ── Session 17 — level-2 batch 3 damage-branch hooks ────────────────
    // These hooks fire on the ATTACKER's weapon attacks (melee/ranged, NOT
    // spell — same gating as Branding Smite). They read the attacker's
    // ActiveEffects / scratch fields via the query functions in
    // spell_effects.ts and the scratch fields on Combatant.

    // Enlarge/Reduce (PHB p.237): the attacker's `enlarge_reduce` effect
    // modifies outgoing weapon damage.
    //   'enlarge' → +1d8 weapon damage (PHB p.237).
    //   'reduce'  → weapon damage HALVED (PHB p.237: "the target's weapon
    //               attacks deal half damage"). v1 applies this as a flat
    //               halving BEFORE other bonuses are added — mirror PHB p.197
    //               resistance semantics (round down) but NOT actual resistance
    //               (so it composes with other resistances by halving first).
    // Crit doubles the enlarge die (PHB p.196). Reduce halves the post-crit
    // total (mirror resistance's "halved after dice" semantics).
    const enlargeReduceMode = getActiveEnlargeReduce(attacker);
    if (enlargeReduceMode && (action.attackType === 'melee' || action.attackType === 'ranged')) {
      if (enlargeReduceMode === 'enlarge') {
        let erDice = isCrit ? 2 : 1;  // +1d8, crit → +2d8 (PHB p.196)
        let erBonus = 0;
        for (let i = 0; i < erDice; i++) erBonus += rollDie(8);
        dmg += erBonus;
        log(state, 'action', attacker.id,
          `${attacker.name} adds Enlarge bonus (+${erBonus} damage${isCrit ? ' CRIT' : ''})!`, target.id, erBonus);
      } else {  // 'reduce'
        dmg = Math.floor(dmg / 2);
        log(state, 'action', attacker.id,
          `${attacker.name}'s weapon damage is HALVED by Reduce! (dmg now ${dmg})`, target.id);
      }
    }

    // Magic Weapon (PHB p.257): the attacker's `weapon_enchant` effect adds
    // a flat +N to attack rolls AND damage rolls with weapon attacks. The
    // attack-roll bonus was already applied above (added to result.total
    // via the getActiveWeaponEnchant query — see the attack-roll section).
    // This block applies the DAMAGE bonus. Crit does NOT double flat bonuses
    // (PHB p.196: crit doubles "damage dice", not flat modifiers).
    const weaponEnchant = getActiveWeaponEnchant(attacker);
    if (weaponEnchant.damageBonus > 0 && (action.attackType === 'melee' || action.attackType === 'ranged')) {
      dmg += weaponEnchant.damageBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds Magic Weapon bonus (+${weaponEnchant.damageBonus} damage)!`, target.id, weaponEnchant.damageBonus);
    }

    // Flame Blade (PHB p.242): while the self-buff is active, MELEE weapon
    // attacks deal +3d6 fire damage (v1 simplification — canon: the spell
    // creates a new melee weapon; v1 models it as a +3d6 fire rider on
    // existing melee weapon attacks, mirroring Shillelagh's +1d8 radiant
    // pattern but with a larger die and fire type). Crit doubles the dice
    // (PHB p.196).
    if (
      attacker._flameBladeActive === true &&
      action.attackType === 'melee'
    ) {
      let flameBladeDice = isCrit ? 6 : 3;  // 3d6 fire, crit → 6d6 (PHB p.196)
      let flameBladeBonus = 0;
      for (let i = 0; i < flameBladeDice; i++) flameBladeBonus += rollDie(6);
      dmg += flameBladeBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds Flame Blade bonus (+${flameBladeBonus} fire${isCrit ? ' CRIT' : ''})!`, target.id, flameBladeBonus);
    }

    // Alter Self — Natural Weapons (PHB p.211): while the self-buff is
    // active, the caster's unarmed strikes deal 1d6 + STR mod slashing
    // instead of 1 + STR mod. v1 detects unarmed strikes by checking if
    // the action's damage is a 1-die (count=1, sides=1, bonus=0) — the
    // standard unarmed-strike damage expression. If so, the damage is
    // REGENERATED from 1d6 (slash) + STR mod. Crit doubles the 1d6 (PHB p.196).
    // This is a v1 simplification — canon: the caster "grows claws" and the
    // unarmed strike's damage die becomes 1d6 (chosen type). v1 regenerates
    // the damage roll to avoid mutating action.damage in place.
    if (
      attacker._alterSelfActive === 'naturalWeapons' &&
      action.damage &&
      action.damage.count === 1 &&
      action.damage.sides === 1 &&
      action.damage.bonus === 0
    ) {
      // Regenerate: roll 1d6 (or 2d6 on crit) slashing + STR mod.
      const strMod = abilityMod(attacker.str);
      let alterSelfDice = isCrit ? 2 : 1;
      let alterSelfRoll = 0;
      for (let i = 0; i < alterSelfDice; i++) alterSelfRoll += rollDie(6);
      const newDmg = alterSelfRoll + strMod;
      log(state, 'action', attacker.id,
        `${attacker.name}'s unarmed strike is enhanced by Alter Self — Natural Weapons! (regenerated from ${dmg} to ${newDmg} = ${alterSelfDice}d6${isCrit ? ' CRIT' : ''}=${alterSelfRoll} + STR mod ${strMod >= 0 ? '+' : ''}${strMod})`,
        target.id, newDmg);
      dmg = newDmg;
    }

    // Ray of Enfeeblement (PHB p.271 — Session 18): while the target is
    // enfeebled (`_rayOfEnfeeblementActive === true` on the ATTACKER — the
    // spell was cast ON this attacker by an enemy), the attacker's weapon
    // attacks deal HALF damage. v1 simplification: applies to ALL weapon
    // attacks (melee/ranged, NOT spell — canon: "weapon attacks that use
    // Strength", but v1 doesn't track STR-vs-DEX weapon distinction).
    // Halving applied as a flat half-after-other-modifiers (mirror Enlarge/
    // Reduce's 'reduce' branch semantics — halving rounds down, composes
    // with other modifiers by halving the total). Crit does NOT exempt the
    // halving (PHB p.271 says "the target deals only half damage with weapon
    // attacks" — no crit exception).
    if (
      attacker._rayOfEnfeeblementActive === true &&
      (action.attackType === 'melee' || action.attackType === 'ranged')
    ) {
      const preHalve = dmg;
      dmg = Math.floor(dmg / 2);
      log(state, 'action', attacker.id,
        `${attacker.name} is ENFEEBLED — weapon damage HALVED (${preHalve} → ${dmg})!`, target.id);
    }

    // ST-5C: Fighting Style: Interception — rider reduces damage to mount (reaction)
    const { reduction: interceptReduction, rider: interceptRider } =
      checkInterceptionReduction(target, dmg, bf);
    if (interceptReduction > 0 && interceptRider) {
      dmg = Math.max(0, dmg - interceptReduction);
      log(state, 'action', interceptRider.id,
        `${interceptRider.name} uses Interception — reduces damage to ${target.name} by ${interceptReduction}!`,
        target.id, interceptReduction);
    }

    const dealt = applyDamageWithTempHP(target, dmg, action.damageType);
    if (target.concentration?.active && dealt > 0) {
      const maintained = rollConcentrationSave(target, dealt);
      if (!maintained) {
        removeEffectsFromCaster(target.id, state.battlefield);
        log(state, 'condition_remove', target.id,
          `${target.name} loses concentration on ${target.concentration?.spellName ?? 'spell'}!`, undefined);
      }
    }
    log(state, 'damage', attacker.id,
      `${attacker.name} deals ${dealt} ${action.damageType ?? ''} damage to ${target.name}${isCrit ? ' (CRIT)' : ''}`,
      target.id, dealt);
    // Track faction damage for 10-round no-damage auto-defeat rule
    if (dealt > 0) {
      const prev = state.damageThisRound.get(attacker.faction) ?? 0;
      state.damageThisRound.set(attacker.faction, prev + dealt);
      // Track for rage-end check: target took damage since their last turn
      state.rageDamagedSinceLastTurn.add(target.id);
    }
    // Apply cantrip special effects (e.g., Thorn Whip pull, Ray of Frost slow)
    applyCantripEffect(attacker, target, action.name, state);
    applyWardingBondRedirect(target, dealt, state);
    checkDeath(target, state);
  }
}

/**
 * Warding Bond (PHB p.287): after the bonded creature takes damage, the caster
 * takes the same amount.  Breaks the bond if the caster drops to 0 HP.
 * Called after every applyDamageWithTempHP on a bonded target.
 */
function applyWardingBondRedirect(
  bonded:  Combatant,
  dealt:   number,
  state:   EngineState,
): void {
  if (!bonded.wardingBond || dealt <= 0) return;
  const caster = state.battlefield.combatants.get(bonded.wardingBond.casterId);
  if (!caster || caster.isDead || caster.isUnconscious) {
    // Caster already incapacitated — bond ends silently
    bonded.wardingBond = null;
    return;
  }
  // Caster takes the same damage (null type — already post-resistance from bonded's side)
  const casterDealt = applyDamageWithTempHP(caster, dealt, null);
  log(state, 'damage', caster.id,
    `${caster.name} takes ${casterDealt} damage from Warding Bond (protecting ${bonded.name})`,
    bonded.id, casterDealt);
  checkDeath(caster, state);
  // Break bond if caster dropped to 0 HP
  if (caster.isDead || caster.isUnconscious) {
    bonded.wardingBond = null;
    log(state, 'condition_remove', caster.id,
      `Warding Bond ends — ${caster.name} dropped to 0 HP`, bonded.id);
  }
}

/**
 * Log death/unconscious events when a combatant reaches 0 HP.
 */
function checkDeath(target: Combatant, state: EngineState, attacker?: Combatant): void {
  if (target.currentHP > 0) return;

  // Dark One's Blessing (Warlock Fiend): gain temp HP when reducing to 0
  if (attacker?.resources?.darkOnesBlessing && target.faction !== attacker.faction) {
    const amount = attacker.resources.darkOnesBlessing.amount;
    attacker.tempHP = Math.max(attacker.tempHP, amount);
    log(state, 'action', attacker.id,
      `${attacker.name} gains ${amount} temp HP from Dark One's Blessing`, undefined, amount);
  }

  // If mount dies while carrying a rider, rider must save (PHB p.198)
  if (target.carriedBy) {
    const rider = state.battlefield.combatants.get(target.carriedBy);
    if (rider && !rider.isDead) {
      const result = mountDeathRiderCheck(rider);
      target.carriedBy = null;
      rider.mountedOn  = null;
      log(state, 'action', target.id,
        `${target.name} (mount) goes down! ${rider.name} ${result === 'prone' ? 'falls prone!' : 'lands safely.'}`,
        rider.id);
    }
  }

  // Break concentration on going down (PHB p.203)
  if (target.concentration?.active) {
    const spellName = target.concentration.spellName ?? 'spell';
    removeEffectsFromCaster(target.id, state.battlefield);
    target.concentration = null;
    log(state, 'condition_remove', target.id,
      `${target.name}'s concentration on ${spellName} breaks!`, undefined);
  }

  if (target.isPlayer) {
    // PCs go unconscious and start making death saves (PHB p.197)
    if (!target.deathSaves) target.deathSaves = { successes: 0, failures: 0 };
    log(state, 'unconscious', target.id,
      `${target.name} falls unconscious and begins making death saving throws!`, undefined, 0);
  } else {
    log(state, 'death', target.id, `${target.name} is slain!`, undefined, 0);
  }

  // PHB p.195: grapple ends when either party falls unconscious or dies.
  // Release any creature this target was grappling.
  for (const c of state.battlefield.combatants.values()) {
    if (c.grappledBy === target.id) {
      removeCondition(c, 'grappled');
      c.grappledBy = undefined;
      log(state, 'condition_remove', target.id,
        `${c.name} is released from ${target.name}'s grapple!`, c.id);
    }
    // Warding Bond (PHB p.287): spell ends when caster drops to 0 HP.
    // Clear bond on any creature bonded to this (now-downed) caster.
    if (c.wardingBond?.casterId === target.id) {
      c.wardingBond = null;
    }
  }
  // Also release any grapple this target was in (in case it gets swept up later)
  if (target.conditions.has('grappled')) {
    removeCondition(target, 'grappled');
    target.grappledBy = undefined;
  }
}

// ---- Movement resolution ------------------------------------

/**
 * Move a combatant toward `dest`, spending movement from budget.
 * Checks for OA triggers at each step (simplified: checks once at dest).
 * Full step-by-step OA checking is a future enhancement.
 */
/**
 * Move a combatant from their current position to `dest`, spending movement
 * budget and triggering opportunity attacks (unless `isDisengage` is true).
 *
 * Exported for direct testing of cantrip engine integration (e.g. Booming
 * Blade's movement-triggered rider, TCE p.106, which fires when a marked
 * creature wills itself to move 5+ ft via this function). Normal callers
 * should use `runCombat` / `executeTurnPlan` rather than invoking this
 * directly.
 */
export function executeMove(
  mover: Combatant,
  dest: Vec3,  // mutable — will be clamped
  state: EngineState,
  isDisengage: boolean
): void {
  const bf = state.battlefield;
  // Clamp destination to battlefield bounds — prevents infinite flight off the map
  dest = {
    x: Math.max(0, Math.min(bf.width  - 1, dest.x)),
    y: Math.max(0, Math.min(bf.height - 1, dest.y)),
    z: Math.max(0, Math.min(bf.depth  - 1, dest.z)),
  };

  if (posKey(mover.pos) === posKey(dest)) return; // already there

  const cost = estimateMoveCostFt(
    mover.pos, dest,
    mover.burrowSpeed !== null,
    mover.swimSpeed !== null
  );

  if (!spendMovement(mover, cost)) {
    // Insufficient movement — move as far as budget allows
    // (simplified: skip move if can't reach; future: partial move)
    return;
  }

  const fromPos = { ...mover.pos };
  log(state, 'move', mover.id,
    `${mover.name} moves from (${fromPos.x},${fromPos.y}) to (${dest.x},${dest.y})`,
    undefined);
  mover.pos = { ...dest };

  // ── Booming Blade (TCE p.106) movement-triggered rider ──────────────────
  // If the mover is sheathed in booming energy from a Booming Blade hit and
  // just moved WILLINGLY 5+ ft (executeMove is only called for willing
  // movement — forced movement like Thorn Whip pull / Thunderwave push /
  // grapple drag modifies `pos` directly without calling executeMove), roll
  // the stored thunder dice, apply the damage, and clear the rider.
  //
  // PHB p.196 / TCE p.106: "If the target willingly moves 5 feet or more
  // before then [the start of the caster's next turn], the target takes
  // 1d8 thunder damage, and the spell ends." Movement via Dash, normal
  // movement, or Cunning Action all count as willing. Being pushed/pulled/
  // dragged does NOT. The cost ≥5 ft check excludes the no-op case where
  // dest === fromPos (already-there early return above handles that too).
  if (mover._boomingBladePendingDamageDice && cost >= 5) {
    const dice = mover._boomingBladePendingDamageDice;
    const casterId = mover._boomingBladeCasterId;
    const casterLabel = casterId
      ? (bf.combatants.get(casterId)?.name ?? casterId)
      : 'Booming Blade';
    const dmg = rollBoomingBladeDice(dice);
    // Apply with thunder damage type so resistances/immunities compose
    // correctly via applyDamageWithTempHP (Blade Ward doesn't apply — it
    // only resists B/P/S — but other sources like a hypothetical thunder
    // resistance would).
    const dealt = applyDamageWithTempHP(mover, dmg, 'thunder');
    log(state, 'damage', mover.id,
      `${casterLabel}'s Booming Blade detonates as ${mover.name} moves willingly — ${dealt} thunder damage! (rolled ${dmg} on ${dice})`,
      mover.id, dealt);
    // Clear the rider (spell ends, TCE p.106).
    delete mover._boomingBladePendingDamageDice;
    delete mover._boomingBladeCasterId;
    // If the mover died from the rider damage, skip the OA loop.
    if (mover.isDead || mover.isUnconscious) return;
  }

  // OA check: did any watcher's melee reach get left?
  if (!isDisengage) {
    for (const [, watcher] of bf.combatants) {
      if (watcher.id === mover.id || watcher.isDead || watcher.isUnconscious) continue;
      if (watcher.faction === mover.faction) continue;
      if (!opportunityAttackTriggered(watcher, mover, fromPos, dest)) continue;
      if (!shouldTakeOpportunityAttack(watcher, mover, bf)) continue;

      // Execute OA
      const oaAction = selectOAAction(watcher);
      if (oaAction && canReach(watcher, mover, oaAction)) {
        // ST-5A: Mounted Combatant — redirect OA to rider if feat active (no reaction cost)
        const oaTarget = checkMountedCombatant(mover, oaAction, bf) ?? mover;
        if (oaTarget !== mover) {
          log(state, 'action', oaTarget.id,
            `${oaTarget.name} uses Mounted Combatant — intercepts OA on ${mover.name}!`, oaTarget.id);
        }
        log(state, 'opportunity_attack', watcher.id,
          `${watcher.name} takes opportunity attack on ${oaTarget.name}!`, oaTarget.id);
        watcher.budget.reactionUsed = true;
        resolveAttack(watcher, oaTarget, oaAction, state);
        if (oaTarget.isDead || oaTarget.isUnconscious) return; // target died on OA
      }
    }
  }
}

// ---- Execute a PlannedAction --------------------------------

function executePlannedAction(
  actor: Combatant,
  plan: PlannedAction,
  state: EngineState
): void {
  const bf = state.battlefield;

  // ── Session 24 — Witch Bolt "ends on other action" guard (PHB p.289) ──
  // "The spell ends if you use your action for anything else." If the
  // caster is concentrating on Witch Bolt and the planned action is NOT
  // 'witchBolt' (the DoT re-fire), Witch Bolt's concentration breaks
  // BEFORE the new action executes. Bonus actions and reactions live in
  // plan.bonusAction / plan.reaction (not plan.type), so they do NOT
  // trigger this guard (using a bonus action or reaction does not end
  // Witch Bolt per PHB p.289).
  if (actor.concentration?.active &&
      actor.concentration.spellName === 'Witch Bolt' &&
      plan.type !== 'witchBolt') {
    log(state, 'condition_remove', actor.id,
      `${actor.name}'s Witch Bolt ends — they used their action for something else!`,
      undefined);
    actor.concentration = null;
  }

  switch (plan.type) {
    case 'attack':
    case 'cast': {
      // Non-attack self-buff cantrips (e.g. Blade Ward, PHB p.218): route via the
      // CANTRIP_SELF_EFFECTS registry instead of resolveAttack. These have no
      // target, so they must be handled BEFORE the target-null guard below. This
      // also keeps cantrip logic out of this switch (no `case 'spellName'`).
      if (plan.action && resolveCantripAction(actor, plan.action.name, state)) break;
      // Caster-centered AoE cantrips (e.g. Thunderclap, XGE p.168: all creatures
      // within 5 ft of the caster). These have no single target — the execute
      // handler finds all targets in range itself. Routed BEFORE the target-null
      // guard so the spell fires even when plan.targetId is null (the AI planner
      // may or may not set a "primary target" for animation purposes). Mirrors
      // resolveCantripAction for self-buffs; both bypass resolveAttack.
      if (plan.action && resolveCantripAoE(actor, plan.action.name, state)) break;
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      // Non-attack touch-effect cantrips (e.g. Spare the Dying, PHB p.277:
      // stabilize a downed PC ally; Light, PHB p.255: set _lightSourceActive
      // flag on target). These target a single DOWNED ALLY or willing creature
      // — the handler receives the target as an argument. CRITICAL: this routing
      // comes BEFORE the standard target-null/dead/unconscious guard below,
      // because Spare the Dying's target is an UNCONSCIOUS ally at 0 HP (the
      // standard guard would BLOCK unconscious targets). The handler itself
      // decides whether the spell fires (e.g. Spare the Dying fizzles on
      // monsters at 0 HP, on creatures above 0 HP, and on dead creatures).
      if (plan.action && resolveCantripTouchEffect(actor, target ?? null, plan.action.name, state)) break;
      if (!target || target.isDead || target.isUnconscious) break;
      if (!plan.action) break;
      // Consume spell slot for leveled spells (slotLevel >= 1)
      if (plan.action.slotLevel && plan.action.slotLevel >= 1) {
        consumeSpellSlot(actor, plan.action.slotLevel);
      }
      // ST-5A: Mounted Combatant — redirect attack to rider if feat active (no reaction cost)
      const effectiveTarget = checkMountedCombatant(target, plan.action, bf) ?? target;
      if (effectiveTarget !== target) {
        log(state, 'action', effectiveTarget.id,
          `${effectiveTarget.name} uses Mounted Combatant — intercepts attack on ${target.name}!`,
          effectiveTarget.id);
      }
      log(state, 'action', actor.id, plan.description, effectiveTarget.id ?? undefined);
      resolveAttack(actor, effectiveTarget, plan.action, state);
      break;
    }

    case 'dash':
      log(state, 'dash', actor.id, plan.description);
      // PHB p.192: Dash gives a stipend equal to speed *after* condition modifiers.
      // A grappled/paralysed/restrained creature has effectiveSpeed = 0, so gains nothing.
      actor.budget.movementFt += effectiveSpeed(actor);
      break;

    case 'disengage':
      log(state, 'disengage', actor.id, plan.description);
      state.disengagedThisTurn.add(actor.id);
      // Mark on the actor so OA checks can skip it
      (actor as any).usedDisengage = true;
      break;

    case 'dodge':
      log(state, 'dodge', actor.id, plan.description);
      // PHB p.192: Until your next turn, attacks against you have disadvantage (if you can
      // see the attacker) and you make DEX saving throws with advantage.
      // Both expire at the START of this creature's next turn (tickAdvantages handles this).
      grantVulnerability(actor, 'disadvantage', 'attack', 'Dodge', 'until_next_turn');
      grantSelf(actor, 'advantage', 'save:dex', 'Dodge', 'until_next_turn');
      break;

    case 'legendary': {
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!target || target.isDead || target.isUnconscious) break;
      if (!plan.action) break;
      // ST-5A: Mounted Combatant — redirect legendary attack to rider if feat active
      const legEffectiveTarget = checkMountedCombatant(target, plan.action, bf) ?? target;
      if (legEffectiveTarget !== target) {
        log(state, 'action', legEffectiveTarget.id,
          `${legEffectiveTarget.name} uses Mounted Combatant — intercepts legendary attack on ${target.name}!`,
          legEffectiveTarget.id);
      }
      log(state, 'legendary_action', actor.id, plan.description, legEffectiveTarget.id ?? undefined);
      actor.legendaryActionPool -= plan.action.legendaryCost;
      resolveAttack(actor, legEffectiveTarget, plan.action, state);
      break;
    }

    case 'grapple': {
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!target || target.isDead || target.isUnconscious) break;
      // PHB p.195: can't grapple a target more than 1 size larger
      if (!canGrappleOrShoveTarget(actor, target)) {
        log(state, 'action', actor.id,
          `${actor.name} can't grapple ${target.name} — target is too large!`, target.id);
        break;
      }
      log(state, 'action', actor.id, plan.description, plan.targetId ?? undefined);
      const success = rollGrappleContest(actor, target);
      if (success) {
        addCondition(target, 'grappled');
        target.grappledBy = actor.id;
        log(state, 'condition_add', actor.id,
          `${actor.name} grapples ${target.name}! (speed 0)`, target.id);
      } else {
        log(state, 'action', actor.id,
          `${actor.name}'s grapple attempt on ${target.name} fails.`, target.id);
      }
      break;
    }

    case 'shove': {
      const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!target || target.isDead || target.isUnconscious) break;
      // PHB p.195: can't shove a target more than 1 size larger
      if (!canGrappleOrShoveTarget(actor, target)) {
        log(state, 'action', actor.id,
          `${actor.name} can't shove ${target.name} — target is too large!`, target.id);
        break;
      }
      log(state, 'action', actor.id, plan.description, plan.targetId ?? undefined);
      const success = rollShoveContest(actor, target);
      if (success) {
        // Knock prone (AI always chooses prone for the melee advantage)
        addCondition(target, 'prone');
        log(state, 'condition_add', actor.id,
          `${actor.name} shoves ${target.name} prone!`, target.id);
      } else {
        log(state, 'action', actor.id,
          `${actor.name}'s shove attempt on ${target.name} fails.`, target.id);
      }
      break;
    }

    case 'escapeGrapple': {
      // PHB p.195: grappled creature uses its action to make a contested STR(Athletics)
      // or DEX(Acrobatics) check vs the grappler's STR(Athletics).
      // We store the grappler ID in plan.targetId.
      if (!actor.conditions.has('grappled')) break; // condition already removed
      const grappler = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      log(state, 'action', actor.id, plan.description);
      // If grappler is gone/dead, escape automatically
      if (!grappler || grappler.isDead || grappler.isUnconscious) {
        removeCondition(actor, 'grappled');
        actor.grappledBy = undefined;
        log(state, 'condition_remove', actor.id,
          `${actor.name} escapes the grapple — grappler is down!`);
        break;
      }
      // Contested roll: escaper (attacker role) vs grappler (defender role)
      const escaped = rollGrappleContest(actor, grappler);
      if (escaped) {
        removeCondition(actor, 'grappled');
        actor.grappledBy = undefined;
        log(state, 'condition_remove', actor.id,
          `${actor.name} breaks free from ${grappler.name}'s grapple!`);
      } else {
        log(state, 'action', actor.id,
          `${actor.name} fails to escape ${grappler.name}'s grapple.`);
      }
      break;
    }

    case 'help': {
      // PHB p.192: Help action grants advantage to one allied attack roll before your next turn
      if (plan.targetId) {
        const target = bf.combatants.get(plan.targetId);
        if (target) {
          target.helpedThisTurn = true;
        }
      }
      log(state, 'action', actor.id, plan.description);
      break;
    }
    case 'rage': {
      // PHB p.48: Rage — bonus action.
      // +2 to melee damage rolls while raging (applied in resolveAttack, not here).
      // Resistance to bludgeoning, piercing, and slashing damage.
      // activateRagePlan() already set r.active = true and decremented r.remaining.
      const rageDmgTypes: Array<'bludgeoning' | 'piercing' | 'slashing'> =
        ['bludgeoning', 'piercing', 'slashing'];
      for (const dt of rageDmgTypes) addResistance(actor, dt);
      log(state, 'action', actor.id, plan.description);
      break;
    }
    case 'secondWind': {
      // HP was already applied in secondWindPlan. Emit action + heal log events.
      // PHB p.72: Fighter bonus action; heals 1d10 + fighter level HP.
      log(state, 'action', actor.id, plan.description);
      if (plan.healAmount && plan.healAmount > 0) {
        log(state, 'heal', actor.id,
          `${actor.name} recovers ${plan.healAmount} HP from Second Wind`,
          actor.id, plan.healAmount);
      }
      break;
    }
    case 'faerieFire': {
      // Faerie Fire — PHB p.239: DEX save or outlined (advantage on all attacks vs target).
      // AoE 20-ft cube, concentration, range 60 ft.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const ffTargets = shouldCastFaerieFire(actor, bf);
      if (!ffTargets || ffTargets.length === 0) break;
      executeFaerieFire(actor, ffTargets, state);
      break;
    }
    case 'bless': {
      // Bless — PHB p.219: +1d4 to attack rolls and saving throws for up to 3 allies.
      // Concentration, range 30 ft.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const blessTargets = shouldCastBless(actor, bf);
      if (!blessTargets || blessTargets.length === 0) break;
      executeBless(actor, blessTargets, state);
      break;
    }

    case 'entangle': {
      // Entangle — PHB p.238: STR save or restrained for duration.
      // AoE 20-ft square, concentration, range 90 ft.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const entangleTargets = shouldCastEntangle(actor, bf);
      if (!entangleTargets || entangleTargets.length === 0) break;
      executeEntangle(actor, entangleTargets, state);
      break;
    }

    case 'thunderwave': {
      // Thunderwave — PHB p.282: CON save, 2d8 thunder + push 10ft on fail.
      // 15-ft cube from caster, NOT concentration.
      // Re-run shouldCast to get the live target list (planning may have been stale).
      const twTargets = shouldCastThunderwave(actor, bf);
      if (!twTargets || twTargets.length === 0) break;
      executeThunderwave(actor, twTargets, state);
      break;
    }

    case 'armsOfHadar': {
      // Arms of Hadar — PHB p.215: STR save, 2d6 necrotic + lose reaction on fail.
      // 10-ft radius circle centred on caster (Euclidean AoE), NOT concentration.
      //
      // We do NOT re-run shouldCast here because shouldCast re-checks the spell slot,
      // which may already have been consumed by hexPlan() during bonus-action planning
      // (both Hex and Arms of Hadar share the single Warlock pact slot).
      // The slot check was validated in the planner; we only need fresh live targets.
      const aohTargets = [...bf.combatants.values()].filter(c =>
        c.faction !== actor.faction &&
        !c.isDead && !c.isUnconscious &&
        euclideanDistFt(actor.pos, c.pos) <= 10
      );
      if (aohTargets.length === 0) break;
      executeArmsOfHadar(actor, aohTargets, state);
      break;
    }

    case 'sleep': {
      // Sleep — PHB p.276: 5d8 HP budget, no save, renders lowest-HP enemies unconscious.
      // NOT concentration. Range 90 ft, 20-ft sphere.
      // Re-run shouldCast to get the live target list (enemies may have died since planning).
      // Sleep does NOT share a slot with any bonus-action spell for Sorcerer/Wizard,
      // so the re-run pattern is safe here (unlike armsOfHadar + Hex pact-slot conflict).
      const sleepTargets = shouldCastSleep(actor, bf);
      if (!sleepTargets || sleepTargets.length === 0) break;
      executeSleep(actor, sleepTargets, state);
      break;
    }

    case 'hex': {
      // Hex — PHB p.251: +1d6 necrotic on each hit vs hexed target (bonus action, concentration).
      // Slot was consumed in hexPlan (resources.ts). Here we apply the effect on the target.
      const hexTargetId = plan.targetId;
      if (!hexTargetId) break;
      const hexTarget = bf.combatants.get(hexTargetId);
      if (!hexTarget || hexTarget.isDead || hexTarget.isUnconscious) break;
      executeHex(actor, hexTarget, state);
      break;
    }

    case 'magicMissile': {
      // Magic Missile — PHB p.257: 3 auto-hit darts, each 1d4+1 force. 120 ft, no concentration.
      // Slot consumed inside executeMagicMissile.
      const mmTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!mmTarget || mmTarget.isDead || mmTarget.isUnconscious) break;
      executeMagicMissile(actor, mmTarget, state);
      break;
    }

    case 'burningHands': {
      // Burning Hands — PHB p.220: 15-ft cone, DEX save, 3d6 fire, half on success. No conc.
      // shouldCastBurningHands re-evaluated here to get the full target list;
      // plan.targetId holds only the aimed-at target for animation/log purposes.
      const bhTargets = shouldCastBurningHands(actor, bf) ?? [];
      if (bhTargets.length === 0) break;
      const aimTarget = plan.targetId ? bf.combatants.get(plan.targetId) : bhTargets[0];
      executeBurningHands(actor, bhTargets, state, aimTarget ?? bhTargets[0]);
      break;
    }

    case 'dissonantWhispers': {
      // Dissonant Whispers — PHB p.234: WIS save, 3d6 psychic. Fail: forced flee at full speed.
      // Single target; deafened creatures auto-succeed (handled inside execute).
      const dwTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!dwTarget || dwTarget.isDead || dwTarget.isUnconscious) break;
      executeDissonantWhispers(actor, dwTarget, state);
      break;
    }

    case 'mageArmor': {
      // Mage Armor — PHB p.256: base AC = 13 + DEX mod while unarmored (no concentration).
      if (shouldCastMageArmor(actor, bf)) executeMageArmor(actor, state);
      break;
    }

    case 'wardingBond': {
      // Warding Bond — PHB p.287: protect an adjacent ally (touch range, no concentration).
      const wbTargetId = plan.targetId;
      if (!wbTargetId) break;
      const wbTarget = bf.combatants.get(wbTargetId);
      if (!wbTarget || wbTarget.isDead || wbTarget.isUnconscious) break;
      executeWardingBond(actor, wbTarget, state);
      break;
    }

    case 'shieldOfFaith': {
      // Shield of Faith — PHB p.275: +2 AC to one ally (bonus action, concentration, 60 ft).
      // Re-fetch target live in case battlefield changed since planning.
      const sofTargetId = plan.targetId;
      if (!sofTargetId) break;
      const sofTarget = bf.combatants.get(sofTargetId);
      if (!sofTarget || sofTarget.isDead || sofTarget.isUnconscious) break;
      executeShieldOfFaith(actor, sofTarget, state);
      break;
    }
    case 'layOnHands': {
      // PHB p.84: Paladin action; restore HP from the Lay on Hands pool.
      // applyHeal handles the unconscious → conscious transition for downed allies.
      const lohTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (lohTarget && !lohTarget.isDead && plan.healAmount && plan.healAmount > 0) {
        const wasUnconscious = lohTarget.isUnconscious;
        const healed = applyHeal(lohTarget, plan.healAmount);
        if (wasUnconscious && healed > 0) {
          // applyHeal already cleared isUnconscious — log the event
          log(state, 'condition_remove', lohTarget.id,
            `${lohTarget.name} regains consciousness!`, lohTarget.id);
        }
        log(state, 'action', actor.id, plan.description);
        log(state, 'heal', actor.id,
          `${actor.name} restores ${healed} HP to ${lohTarget.name}`,
          lohTarget.id, healed);
      } else {
        log(state, 'action', actor.id, plan.description);
      }
      break;
    }
    case 'spellHeal': {
      // Cure Wounds (action) or Healing Word (bonus action).
      // PHB p.230 / p.250: 1d8+WIS or 1d4+WIS; restores HP to a touched/nearby creature.
      // healAmount was rolled eagerly in spellHealPlan (slot already consumed).
      const shTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (shTarget && !shTarget.isDead && plan.healAmount && plan.healAmount > 0) {
        const wasUnconscious = shTarget.isUnconscious;
        const healed = applyHeal(shTarget, plan.healAmount);
        if (wasUnconscious && healed > 0) {
          // applyHeal already cleared isUnconscious — log the event
          log(state, 'condition_remove', shTarget.id,
            `${shTarget.name} regains consciousness!`, shTarget.id);
        }
        log(state, 'action', actor.id, plan.description);
        log(state, 'heal', actor.id,
          `${actor.name} restores ${healed} HP to ${shTarget.name}`,
          shTarget.id, healed);
      } else {
        log(state, 'action', actor.id, plan.description);
      }
      break;
    }
    case 'hide': {
      // Cunning Action: Hide (PHB p.96)
      // Rogue makes a DEX (Stealth) check. Proficiency always applies (Rogues have Stealth prof).
      // Compare to each enemy's Passive Perception (10 + WIS mod).
      // If the roll exceeds the highest passive perception among living enemies, Rogue is Hidden.
      // 'hidden' condition grants advantage on the Rogue's next attack and disadvantage on attacks
      // against them. Condition is removed immediately when the Rogue attacks (PHB p.177/194).
      const stealthRoll = rollDie(20) + abilityMod(actor.dex) + proficiencyBonus(actor.cr);
      const enemies = [...bf.combatants.values()].filter(
        c => c.faction !== actor.faction && !c.isDead && !c.isUnconscious
      );
      const maxPassivePerception = enemies.length > 0
        ? Math.max(...enemies.map(e => 10 + abilityMod(e.wis)))
        : 0;
      if (enemies.length === 0 || stealthRoll > maxPassivePerception) {
        addCondition(actor, 'hidden');
        log(state, 'condition_add', actor.id,
          `${actor.name} Hides! (Stealth ${stealthRoll} > Passive Perception ${maxPassivePerception})`,
          actor.id);
      } else {
        log(state, 'action', actor.id,
          `${actor.name} tries to Hide but is Detected! (Stealth ${stealthRoll} ≤ Passive Perception ${maxPassivePerception})`,
          actor.id);
      }
      break;
    }
    case 'ready':
    case 'bardicInspiration': {
      // PHB p.54: Bard grants an Inspiration die (bonus action) to one ally.
      // The recipient adds the die to their next attack roll or saving throw.
      const biTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (biTarget && !biTarget.isDead) {
        const die = actor.resources?.bardicInspiration?.die ?? 'd6';
        biTarget.bardicInspirationDie = parseDieSides(die);
        log(state, 'action', actor.id, plan.description);
      } else {
        log(state, 'action', actor.id, plan.description);
      }
      break;
    }
    case 'shield': {
      // Shield — PHB p.275: reaction, +5 AC until start of next turn, blocks Magic Missile
      // Plan.targetId stores the triggering attack name for logging purposes
      const triggeringAttack = plan.targetId ?? undefined;
      executeShield(actor, state, triggeringAttack);
      break;
    }

    case 'guidingBolt': {
      // Guiding Bolt — PHB p.248: ranged spell attack, 4d6 radiant, marks target.
      // Next attack roll against marked target before end of caster's next turn has advantage.
      const gbTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!gbTarget || gbTarget.isDead || gbTarget.isUnconscious) break;
      if (shouldCastGuidingBolt(actor, gbTarget, bf)) executeGuidingBolt(actor, gbTarget, state);
      break;
    }

    case 'healingWord': {
      // Healing Word — PHB p.250: bonus action, 1d4+WIS healing at 60 ft.
      // No effect on undead or constructs (PHB p.250).
      // Slot consumed and heal applied inside execute().
      const hwTarget = plan.targetId ? bf.combatants.get(plan.targetId) ?? null : null;
      if (!hwTarget) break;
      executeHealingWord(actor, hwTarget, state);
      break;
    }

    case 'aid': {
      // Aid — PHB p.211: action, range 30 ft, up to 3 allies, +5 max & current
      // HP. 8 hr duration (no concentration). v1: no cleanup (8 hr >> combat).
      // Re-run shouldCast to get the live target list (planning may be stale).
      const aidTargets = shouldCastAid(actor, bf);
      if (!aidTargets || aidTargets.length === 0) break;
      executeAid(actor, aidTargets, state);
      break;
    }

    case 'barkskin': {
      // Barkskin — PHB p.217: action, touch, concentration 1 hr. AC ≥ 16.
      // Single-target AC floor via the new `ac_floor` ActiveEffect type.
      const bkTargetId = plan.targetId;
      const bkTarget = bkTargetId ? bf.combatants.get(bkTargetId) ?? null : null;
      // shouldCast returns the live target; fall back to plan.targetId if so.
      const liveTarget = bkTarget && !bkTarget.isDead && !bkTarget.isUnconscious
        ? bkTarget
        : shouldCastBarkskin(actor, bf);
      if (!liveTarget) break;
      executeBarkskin(actor, liveTarget, state);
      break;
    }

    case 'blur': {
      // Blur — PHB p.219: action, self, concentration 1 min. Disadv on attacks
      // vs caster (advantage_vs 'disadvantage' 'attack' effect on self).
      if (shouldCastBlur(actor, bf)) executeBlur(actor, state);
      break;
    }

    case 'blindnessDeafness': {
      // Blindness/Deafness — PHB p.219: action, 30 ft, CON save, NO
      // concentration (1 min duration). On fail: caster picks blinded (v1
      // always picks blinded — more combat-relevant than deafened).
      const bdTargetId = plan.targetId;
      if (!bdTargetId) break;
      const bdTarget = bf.combatants.get(bdTargetId);
      if (!bdTarget || bdTarget.isDead || bdTarget.isUnconscious) break;
      executeBlindnessDeafness(actor, bdTarget, state);
      break;
    }

    case 'brandingSmite': {
      // Branding Smite — PHB p.219: bonus action, self, concentration 1 min.
      // Next weapon hit deals +2d6 radiant. v1: 1-round scratch flag
      // (`_brandingSmiteActive`), consumed by resolveAttack on the next weapon
      // hit OR cleared by cleanup() at start of next turn.
      if (shouldCastBrandingSmite(actor, bf)) executeBrandingSmite(actor, state);
      break;
    }

    case 'calmEmotions': {
      // Calm Emotions — PHB p.221: action, 60 ft, concentration 1 min.
      // Removes charmed/frightened from allies (v1: allies voluntarily fail
      // the CHA save; suppress mode only). Re-run shouldCast to get the live
      // target list (planning may be stale).
      const ceTargets = shouldCastCalmEmotions(actor, bf);
      if (!ceTargets || ceTargets.length === 0) break;
      executeCalmEmotions(actor, ceTargets, state);
      break;
    }

    case 'cloudOfDaggers': {
      // Cloud of Daggers — PHB p.222: action, 60 ft, concentration 1 min.
      // 4d4 slashing on cast (no save) + persistent damage_zone effect that
      // ticks 4d4 at the start of each of the target's turns (PHB p.222:
      // "starts its turn there"). v1: single-target; no movement tracking.
      const codTargetId = plan.targetId;
      const codTarget = codTargetId ? bf.combatants.get(codTargetId) ?? null : null;
      // shouldCast returns the live target; fall back to plan.targetId if so.
      const liveTarget = codTarget && !codTarget.isDead && !codTarget.isUnconscious
        ? codTarget
        : shouldCastCloudOfDaggers(actor, bf);
      if (!liveTarget) break;
      executeCloudOfDaggers(actor, liveTarget, state);
      break;
    }

    case 'crownOfMadness': {
      // Crown of Madness — PHB p.229: action, 120 ft, WIS save or charmed,
      // concentration 1 min. v1: forced-attack rider NOT modelled.
      const comTargetId = plan.targetId;
      if (!comTargetId) break;
      const comTarget = bf.combatants.get(comTargetId);
      if (!comTarget || comTarget.isDead || comTarget.isUnconscious) break;
      executeCrownOfMadness(actor, comTarget, state);
      break;
    }

    case 'holdPerson': {
      // Hold Person — PHB p.251: action, 60 ft, WIS save or paralyzed,
      // concentration 1 min. v1: end-of-turn save NOT modelled.
      const hpTargetId = plan.targetId;
      if (!hpTargetId) break;
      const hpTarget = bf.combatants.get(hpTargetId);
      if (!hpTarget || hpTarget.isDead || hpTarget.isUnconscious) break;
      executeHoldPerson(actor, hpTarget, state);
      break;
    }

    case 'mirrorImage': {
      // Mirror Image — PHB p.260: action, self, NO concentration, 1 min.
      // 3 illusory duplicates; attackers must roll d20 to retarget. v1:
      // duration not tracked (lasts until all duplicates destroyed).
      if (shouldCastMirrorImage(actor, bf)) executeMirrorImage(actor, state);
      break;
    }

    // ── Session 17 — level-2 batch 3 (15 new PHB level-2 spells) ──────────

    case 'enlargeReduce': {
      // Enlarge/Reduce — PHB p.237: action, 30 ft, CON save, concentration 1 min.
      // v1: mode = 'reduce' (enemy debuff) or 'enlarge' (ally buff); size
      // change NOT modelled. shouldCast returns { target, mode }.
      const er = shouldCastEnlargeReduce(actor, bf);
      if (er) executeEnlargeReduce(actor, er.target, er.mode, state);
      break;
    }

    case 'enhanceAbility': {
      // Enhance Ability — PHB p.237: action, touch, concentration 1 hr.
      // Grants advantage on one ability's checks. shouldCast returns
      // { target, ability }.
      const ea = shouldCastEnhanceAbility(actor, bf);
      if (ea) executeEnhanceAbility(actor, ea.target, ea.ability, state);
      break;
    }

    case 'flameBlade': {
      // Flame Blade — PHB p.242: action, self, concentration 10 min.
      // v1: +3d6 fire rider on melee weapon attacks (canon: new melee weapon).
      if (shouldCastFlameBlade(actor, bf)) executeFlameBlade(actor, state);
      break;
    }

    case 'flamingSphere': {
      // Flaming Sphere — PHB p.242: action, 60 ft, DEX save 2d6 fire,
      // concentration 1 min. Persistent damage_zone with save for half.
      const fsTargetId = plan.targetId;
      const fsTarget = fsTargetId ? bf.combatants.get(fsTargetId) ?? null : null;
      const liveTarget = fsTarget && !fsTarget.isDead && !fsTarget.isUnconscious
        ? fsTarget
        : shouldCastFlamingSphere(actor, bf);
      if (liveTarget) executeFlamingSphere(actor, liveTarget, state);
      break;
    }

    case 'heatMetal': {
      // Heat Metal — PHB p.250: action, 60 ft, 2d8 fire + persistent
      // damage_zone (no save on damage), concentration 1 min.
      const hmTargetId = plan.targetId;
      const hmTarget = hmTargetId ? bf.combatants.get(hmTargetId) ?? null : null;
      const liveTarget = hmTarget && !hmTarget.isDead && !hmTarget.isUnconscious
        ? hmTarget
        : shouldCastHeatMetal(actor, bf);
      if (liveTarget) executeHeatMetal(actor, liveTarget, state);
      break;
    }

    case 'melfsAcidArrow': {
      // Melf's Acid Arrow — PHB p.259: action, 90 ft, ranged spell attack,
      // 4d4 acid + 2d4 delayed (damage_zone with ticksRemaining: 1).
      // NO concentration.
      const maaTargetId = plan.targetId;
      if (!maaTargetId) break;
      const maaTarget = bf.combatants.get(maaTargetId);
      if (!maaTarget || maaTarget.isDead || maaTarget.isUnconscious) break;
      executeMelfsAcidArrow(actor, maaTarget, state);
      break;
    }

    case 'mistyStep': {
      // Misty Step — PHB p.260: BONUS ACTION, self, NO concentration.
      // Teleport up to 30 ft. shouldCast returns { destination }.
      const ms = shouldCastMistyStep(actor, bf);
      if (ms) executeMistyStep(actor, ms.destination, state);
      break;
    }

    case 'invisibility': {
      // Invisibility — PHB p.254: action, touch, concentration 1 hr.
      // Grants invisible condition. v1: ends-on-attack NOT modelled.
      const invTargetId = plan.targetId;
      const invTarget = invTargetId ? bf.combatants.get(invTargetId) ?? null : null;
      const liveTarget = invTarget && !invTarget.isDead && !invTarget.isUnconscious
        ? invTarget
        : shouldCastInvisibility(actor, bf);
      if (liveTarget) executeInvisibility(actor, liveTarget, state);
      break;
    }

    case 'gustOfWind': {
      // Gust of Wind — PHB p.248: action, line 60 ft, STR save or pushed
      // 15 ft, concentration 1 min. v1: single-target, one-shot push.
      const gowTargetId = plan.targetId;
      const gowTarget = gowTargetId ? bf.combatants.get(gowTargetId) ?? null : null;
      const liveTarget = gowTarget && !gowTarget.isDead && !gowTarget.isUnconscious
        ? gowTarget
        : shouldCastGustOfWind(actor, bf);
      if (liveTarget) executeGustOfWind(actor, liveTarget, state);
      break;
    }

    case 'levitate': {
      // Levitate — PHB p.255: action, 60 ft, CON save or restrained (v1),
      // concentration 10 min.
      const levTargetId = plan.targetId;
      if (!levTargetId) break;
      const levTarget = bf.combatants.get(levTargetId);
      if (!levTarget || levTarget.isDead || levTarget.isUnconscious) break;
      executeLevitate(actor, levTarget, state);
      break;
    }

    case 'lesserRestoration': {
      // Lesser Restoration — PHB p.255: action, touch, NO concentration.
      // Ends blinded/deafened/paralyzed/poisoned. v1: removes ALL listed.
      const lrTargetId = plan.targetId;
      const lrTarget = lrTargetId ? bf.combatants.get(lrTargetId) ?? null : null;
      const liveTarget = lrTarget && !lrTarget.isDead && !lrTarget.isUnconscious
        ? lrTarget
        : shouldCastLesserRestoration(actor, bf);
      if (liveTarget) executeLesserRestoration(actor, liveTarget, state);
      break;
    }

    case 'magicWeapon': {
      // Magic Weapon — PHB p.257: action, touch, concentration 1 hr.
      // Weapon +1 to attack and damage rolls.
      const mwTargetId = plan.targetId;
      const mwTarget = mwTargetId ? bf.combatants.get(mwTargetId) ?? null : null;
      const liveTarget = mwTarget && !mwTarget.isDead && !mwTarget.isUnconscious
        ? mwTarget
        : shouldCastMagicWeapon(actor, bf);
      if (liveTarget) executeMagicWeapon(actor, liveTarget, state);
      break;
    }

    case 'cordonOfArrows': {
      // Cordon of Arrows — PHB p.228: action, 5 ft, DEX save 1d6 piercing,
      // 4-piece damage_zone (ticksRemaining: 4). NO concentration.
      const coaTargetId = plan.targetId;
      const coaTarget = coaTargetId ? bf.combatants.get(coaTargetId) ?? null : null;
      const liveTarget = coaTarget && !coaTarget.isDead && !coaTarget.isUnconscious
        ? coaTarget
        : shouldCastCordonOfArrows(actor, bf);
      if (liveTarget) executeCordonOfArrows(actor, liveTarget, state);
      break;
    }

    case 'alterSelf': {
      // Alter Self — PHB p.211: action, self, concentration 10 min.
      // v1: Natural Weapons only (unarmed strikes → 1d6 slashing).
      if (shouldCastAlterSelf(actor, bf)) executeAlterSelf(actor, state);
      break;
    }

    case 'darkvision': {
      // Darkvision — PHB p.230: action, touch, NO concentration, 8 hr.
      // v1: forward-compat flag only (vision subsystem not implemented).
      const dvTargetId = plan.targetId;
      const dvTarget = dvTargetId ? bf.combatants.get(dvTargetId) ?? null : null;
      const liveTarget = dvTarget && !dvTarget.isDead && !dvTarget.isUnconscious
        ? dvTarget
        : shouldCastDarkvision(actor, bf);
      if (liveTarget) executeDarkvision(actor, liveTarget, state);
      break;
    }

    // ── Session 18 — level-2 batch 4 (20 new PHB level-2 spells) ──────────

    case 'moonbeam': {
      // Moonbeam — PHB p.261: action, 120 ft, CON save 2d10 radiant,
      // concentration 1 min. Persistent damage_zone with save for half.
      const mbTargetId = plan.targetId;
      const mbTarget = mbTargetId ? bf.combatants.get(mbTargetId) ?? null : null;
      const liveTarget = mbTarget && !mbTarget.isDead && !mbTarget.isUnconscious
        ? mbTarget
        : shouldCastMoonbeam(actor, bf);
      if (liveTarget) executeMoonbeam(actor, liveTarget, state);
      break;
    }

    case 'scorchingRay': {
      // Scorching Ray — PHB p.273: action, 120 ft, 3 ranged spell attacks
      // 2d6 fire each (multi-attack pattern). NO concentration.
      // shouldCast returns Combatant[] (3 targets, may repeat nearest).
      const srTargets = shouldCastScorchingRay(actor, bf);
      if (srTargets) executeScorchingRay(actor, srTargets, state);
      break;
    }

    case 'shatter': {
      // Shatter — PHB p.275: action, 60 ft, CON save 3d8 thunder,
      // 10-ft radius AoE. NO concentration.
      // shouldCast returns Combatant[] (all enemies in 10 ft of primary).
      const shTargets = shouldCastShatter(actor, bf);
      if (shTargets) executeShatter(actor, shTargets, state);
      break;
    }

    case 'spikeGrowth': {
      // Spike Growth — PHB p.277: action, 150 ft, 2d4 piercing damage_zone
      // terrain, concentration 10 min. NO on-cast damage.
      const sgTargetId = plan.targetId;
      const sgTarget = sgTargetId ? bf.combatants.get(sgTargetId) ?? null : null;
      const liveTarget = sgTarget && !sgTarget.isDead && !sgTarget.isUnconscious
        ? sgTarget
        : shouldCastSpikeGrowth(actor, bf);
      if (liveTarget) executeSpikeGrowth(actor, liveTarget, state);
      break;
    }

    case 'spiritualWeapon': {
      // Spiritual Weapon — PHB p.278: BONUS ACTION, 60 ft, melee spell attack
      // 1d8 force + persistent damage_zone 1d8 force/turn (ticksRemaining: 10).
      // NO concentration, 1 min duration.
      const swTargetId = plan.targetId;
      const swTarget = swTargetId ? bf.combatants.get(swTargetId) ?? null : null;
      const liveTarget = swTarget && !swTarget.isDead && !swTarget.isUnconscious
        ? swTarget
        : shouldCastSpiritualWeapon(actor, bf);
      if (liveTarget) executeSpiritualWeapon(actor, liveTarget, state);
      break;
    }

    case 'phantasmalForce': {
      // Phantasmal Force — PHB p.264: action, 60 ft, INT save 1d6 psychic +
      // persistent damage_zone, concentration 1 min. On save success: no effect.
      const pfTargetId = plan.targetId;
      const pfTarget = pfTargetId ? bf.combatants.get(pfTargetId) ?? null : null;
      const liveTarget = pfTarget && !pfTarget.isDead && !pfTarget.isUnconscious
        ? pfTarget
        : shouldCastPhantasmalForce(actor, bf);
      if (liveTarget) executePhantasmalForce(actor, liveTarget, state);
      break;
    }

    case 'rayOfEnfeeblement': {
      // Ray of Enfeeblement — PHB p.271: action, 60 ft, ranged spell attack,
      // target deals half weapon damage, concentration 1 min. NO damage on hit.
      const roeTargetId = plan.targetId;
      const roeTarget = roeTargetId ? bf.combatants.get(roeTargetId) ?? null : null;
      const liveTarget = roeTarget && !roeTarget.isDead && !roeTarget.isUnconscious
        ? roeTarget
        : shouldCastRayOfEnfeeblement(actor, bf);
      if (liveTarget) executeRayOfEnfeeblement(actor, liveTarget, state);
      break;
    }

    case 'web': {
      // Web — PHB p.287: action, 60 ft, DEX save or restrained,
      // concentration 1 min.
      const webTargetId = plan.targetId;
      const webTarget = webTargetId ? bf.combatants.get(webTargetId) ?? null : null;
      const liveTarget = webTarget && !webTarget.isDead && !webTarget.isUnconscious
        ? webTarget
        : shouldCastWeb(actor, bf);
      if (liveTarget) executeWeb(actor, liveTarget, state);
      break;
    }

    case 'silence': {
      // Silence — PHB p.275: action, 120 ft, AoE blocks verbal spells
      // (forward-compat flag), concentration 10 min. NO save.
      const silTargetId = plan.targetId;
      const silTarget = silTargetId ? bf.combatants.get(silTargetId) ?? null : null;
      const liveTarget = silTarget && !silTarget.isDead && !silTarget.isUnconscious
        ? silTarget
        : shouldCastSilence(actor, bf);
      if (liveTarget) executeSilence(actor, liveTarget, state);
      break;
    }

    case 'suggestion': {
      // Suggestion — PHB p.279: action, 30 ft, WIS save or charmed,
      // concentration (canon: 8 hr; v1: 1 min simplification).
      const sugTargetId = plan.targetId;
      const sugTarget = sugTargetId ? bf.combatants.get(sugTargetId) ?? null : null;
      const liveTarget = sugTarget && !sugTarget.isDead && !sugTarget.isUnconscious
        ? sugTarget
        : shouldCastSuggestion(actor, bf);
      if (liveTarget) executeSuggestion(actor, liveTarget, state);
      break;
    }

    case 'zoneOfTruth': {
      // Zone of Truth — PHB p.289: action, 60 ft, CHA save, can't lie in
      // 15-ft radius (forward-compat flag), concentration 10 min.
      const zotTargetId = plan.targetId;
      const zotTarget = zotTargetId ? bf.combatants.get(zotTargetId) ?? null : null;
      const liveTarget = zotTarget && !zotTarget.isDead && !zotTarget.isUnconscious
        ? zotTarget
        : shouldCastZoneOfTruth(actor, bf);
      if (liveTarget) executeZoneOfTruth(actor, liveTarget, state);
      break;
    }

    case 'enthrall': {
      // Enthrall — PHB p.238: action, 60 ft, WIS save (multi-target up to 3),
      // disadv on Perception (forward-compat flag on caster), concentration 1 min.
      const entTargets = shouldCastEnthrall(actor, bf);
      if (entTargets) executeEnthrall(actor, entTargets, state);
      break;
    }

    case 'detectThoughts': {
      // Detect Thoughts — PHB p.231: action, self (5-ft aura), WIS save probe
      // (forward-compat flag on caster), concentration 1 min.
      if (shouldCastDetectThoughts(actor, bf)) executeDetectThoughts(actor, state);
      break;
    }

    case 'seeInvisibility': {
      // See Invisibility — PHB p.274: action, self, see invisible 60 ft
      // (forward-compat flag), NO concentration, 1 hr.
      if (shouldCastSeeInvisibility(actor, bf)) executeSeeInvisibility(actor, state);
      break;
    }

    case 'spiderClimb': {
      // Spider Climb — PHB p.277: action, touch, climb speed (forward-compat
      // flag on target), concentration 1 hr.
      const scTargetId = plan.targetId;
      const scTarget = scTargetId ? bf.combatants.get(scTargetId) ?? null : null;
      const liveTarget = scTarget && !scTarget.isDead && !scTarget.isUnconscious
        ? scTarget
        : shouldCastSpiderClimb(actor, bf);
      if (liveTarget) executeSpiderClimb(actor, liveTarget, state);
      break;
    }

    case 'passWithoutTrace': {
      // Pass without Trace — PHB p.264: action, self, +10 stealth aura
      // (forward-compat flag on caster), concentration 1 hr.
      if (shouldCastPassWithoutTrace(actor, bf)) executePassWithoutTrace(actor, state);
      break;
    }

    case 'protectionFromPoison': {
      // Protection from Poison — PHB p.270: action, touch, removes poisoned +
      // advantage on saves vs poison (forward-compat flag), NO concentration, 1 hr.
      const pfpTargetId = plan.targetId;
      const pfpTarget = pfpTargetId ? bf.combatants.get(pfpTargetId) ?? null : null;
      const liveTarget = pfpTarget && !pfpTarget.isDead && !pfpTarget.isUnconscious
        ? pfpTarget
        : shouldCastProtectionFromPoison(actor, bf);
      if (liveTarget) executeProtectionFromPoison(actor, liveTarget, state);
      break;
    }

    case 'prayerOfHealing': {
      // Prayer of Healing — PHB p.267: action (canon: 10 min), 30 ft,
      // 2d8+spellcasting heal up to 3 creatures, NO concentration.
      // shouldCast returns Combatant[] (up to 3 wounded allies).
      const pohTargets = shouldCastPrayerOfHealing(actor, bf);
      if (pohTargets) executePrayerOfHealing(actor, pohTargets, state);
      break;
    }

    case 'knock': {
      // Knock — PHB p.254: action, 60 ft, opens objects (forward-compat flag
      // on caster), NO concentration.
      if (shouldCastKnock(actor, bf)) executeKnock(actor, state);
      break;
    }

    case 'arcaneLock': {
      // Arcane Lock — PHB p.215: action, touch, locks object (forward-compat
      // flag on caster), permanent, NO concentration.
      if (shouldCastArcaneLock(actor, bf)) executeArcaneLock(actor, state);
      break;
    }

    // ── Session 21 — Real-mechanics migration (7 combat damage spells) ────
    // These spells were bulk-implemented in Session 19/20 as forward-compat
    // flags (no mechanical effect). Session 21 migrated them to bespoke
    // implementations with REAL mechanical effects. Each case branch
    // mirrors the Session 18 bespoke pattern (Moonbeam / Shatter).

    case 'fireball': {
      // Fireball — PHB p.241: action, 150 ft, DEX save 8d6 fire (half on
      // save), 20-ft radius AoE. NO concentration.
      // shouldCast returns Combatant[] (all enemies in 20 ft of primary).
      const fbTargets = shouldCastFireball(actor, bf);
      if (fbTargets) executeFireball(actor, fbTargets, state);
      break;
    }

    case 'lightningBolt': {
      // Lightning Bolt — PHB p.255: action, 100-ft × 5-ft line from caster,
      // DEX save 8d6 lightning (half on save). NO concentration.
      // shouldCast returns Combatant[] (all enemies in the line rectangle).
      const lbTargets = shouldCastLightningBolt(actor, bf);
      if (lbTargets) executeLightningBolt(actor, lbTargets, state);
      break;
    }

    case 'coneOfCold': {
      // Cone of Cold — PHB p.229: action, self (60-ft cone), CON save 8d8
      // cold (half on save). NO concentration.
      // shouldCast returns Combatant[] (all enemies in the cone).
      const cocTargets = shouldCastConeOfCold(actor, bf);
      if (cocTargets) executeConeOfCold(actor, cocTargets, state);
      break;
    }

    case 'inflictWounds': {
      // Inflict Wounds — PHB p.253: action, touch (5 ft), melee spell attack
      // 3d10 necrotic (crit doubles). NO concentration.
      // shouldCast returns a single Combatant (highest-threat adjacent enemy).
      const iwTargetId = plan.targetId;
      const iwTarget = iwTargetId ? bf.combatants.get(iwTargetId) ?? null : null;
      const liveTarget = iwTarget && !iwTarget.isDead && !iwTarget.isUnconscious
        ? iwTarget
        : shouldCastInflictWounds(actor, bf);
      if (liveTarget) executeInflictWounds(actor, liveTarget, state);
      break;
    }

    case 'chromaticOrb': {
      // Chromatic Orb — PHB p.221: action, 90 ft, ranged spell attack 3d8
      // chosen-elemental (acid/cold/fire/lightning/poison/thunder — picker
      // avoids target's resistances). Crit doubles. NO concentration.
      // shouldCast returns a single Combatant (highest-threat enemy in range).
      const coTargetId = plan.targetId;
      const coTarget = coTargetId ? bf.combatants.get(coTargetId) ?? null : null;
      const liveTarget = coTarget && !coTarget.isDead && !coTarget.isUnconscious
        ? coTarget
        : shouldCastChromaticOrb(actor, bf);
      if (liveTarget) executeChromaticOrb(actor, liveTarget, state);
      break;
    }

    case 'catapult': {
      // Catapult — XGE p.15: action, 60 ft, DEX save 3d8 bludgeoning (half
      // on save), single-target. NO concentration.
      // shouldCast returns a single Combatant (highest-threat enemy in range).
      const catTargetId = plan.targetId;
      const catTarget = catTargetId ? bf.combatants.get(catTargetId) ?? null : null;
      const liveTarget = catTarget && !catTarget.isDead && !catTarget.isUnconscious
        ? catTarget
        : shouldCastCatapult(actor, bf);
      if (liveTarget) executeCatapult(actor, liveTarget, state);
      break;
    }

    case 'iceKnife': {
      // Ice Knife — XGE p.157: action, 60 ft, ranged spell attack 1d10
      // piercing + 2d6 cold DEX save in 5-ft radius AoE (explodes on hit
      // OR miss). NO concentration.
      // shouldCast returns an IceKnifePlan { primary, explosion } (a hybrid
      // attack-roll + AoE-save spell — first of its kind in v1).
      const ikPlan = shouldCastIceKnife(actor, bf);
      if (ikPlan) executeIceKnife(actor, ikPlan, state);
      break;
    }

    // ── Session 23 — Real-mechanics migration batch 2 (7 high-damage spells L4-9) ─
    // These spells were bulk-implemented in Session 19 as forward-compat
    // flags (no mechanical effect). Session 23 migrated them to bespoke
    // implementations with REAL mechanical effects. Each case branch
    // mirrors the Session 22 bespoke pattern (Catapult / Shatter / Fireball).

    case 'blight': {
      // Blight — PHB p.219: action, 30 ft, CON save 8d8 necrotic (half on
      // save), single-target. NO concentration.
      // shouldCast returns a single Combatant (highest-threat enemy in range).
      const blightTargetId = plan.targetId;
      const blightTarget = blightTargetId ? bf.combatants.get(blightTargetId) ?? null : null;
      const liveTarget = blightTarget && !blightTarget.isDead && !blightTarget.isUnconscious
        ? blightTarget
        : shouldCastBlight(actor, bf);
      if (liveTarget) executeBlight(actor, liveTarget, state);
      break;
    }

    case 'cloudkill': {
      // Cloudkill — PHB p.222: action, 120 ft, CON save 5d8 poison (half on
      // save), 20-ft radius AoE. v1: one-shot (moving-AoE + concentration
      // rider simplified away). NO concentration (v1).
      // shouldCast returns Combatant[] (all enemies in 20 ft of primary).
      const ckTargets = shouldCastCloudkill(actor, bf);
      if (ckTargets) executeCloudkill(actor, ckTargets, state);
      break;
    }

    case 'disintegrate': {
      // Disintegrate — PHB p.233: action, 60 ft, DEX save 10d6+40 force (half
      // on save), single-target + disintegrate-on-0-HP (simplified). NO
      // concentration.
      // shouldCast returns a single Combatant (lowest-current-HP enemy in range).
      const disTargetId = plan.targetId;
      const disTarget = disTargetId ? bf.combatants.get(disTargetId) ?? null : null;
      const liveTarget = disTarget && !disTarget.isDead && !disTarget.isUnconscious
        ? disTarget
        : shouldCastDisintegrate(actor, bf);
      if (liveTarget) executeDisintegrate(actor, liveTarget, state);
      break;
    }

    case 'harm': {
      // Harm — PHB p.249: action, 60 ft, CON save 14d6 necrotic (half on
      // save), single-target + max-HP-reduction (simplified). NO concentration.
      // shouldCast returns a single Combatant (highest-threat enemy in range).
      const harmTargetId = plan.targetId;
      const harmTarget = harmTargetId ? bf.combatants.get(harmTargetId) ?? null : null;
      const liveTarget = harmTarget && !harmTarget.isDead && !harmTarget.isUnconscious
        ? harmTarget
        : shouldCastHarm(actor, bf);
      if (liveTarget) executeHarm(actor, liveTarget, state);
      break;
    }

    case 'fingerOfDeath': {
      // Finger of Death — PHB p.241: action, 60 ft, CON save 7d8+30 necrotic
      // (half on save), single-target + zombie-raise-on-kill (simplified,
      // TG-006 pending). NO concentration.
      // shouldCast returns a single Combatant (highest-threat enemy in range).
      const fodTargetId = plan.targetId;
      const fodTarget = fodTargetId ? bf.combatants.get(fodTargetId) ?? null : null;
      const liveTarget = fodTarget && !fodTarget.isDead && !fodTarget.isUnconscious
        ? fodTarget
        : shouldCastFingerOfDeath(actor, bf);
      if (liveTarget) executeFingerOfDeath(actor, liveTarget, state);
      break;
    }

    case 'sunburst': {
      // Sunburst — PHB p.284: action, 150 ft, CON save 12d6 radiant (half on
      // save), 60-ft radius AoE + blinded on failed save. NO concentration.
      // shouldCast returns Combatant[] (all enemies in 60 ft of primary).
      const sbTargets = shouldCastSunburst(actor, bf);
      if (sbTargets) executeSunburst(actor, sbTargets, state);
      break;
    }

    case 'powerWordKill': {
      // Power Word Kill — PHB p.266: action, 60 ft, NO save, NO attack —
      // instakill if currentHP ≤ 100. NO concentration.
      // shouldCast returns a single Combatant (highest-current-HP enemy ≤ 100
      // in range). This is the FIRST spell in v1 with no save AND no attack
      // roll — the effect is purely an HP check.
      const pwkTargetId = plan.targetId;
      const pwkTarget = pwkTargetId ? bf.combatants.get(pwkTargetId) ?? null : null;
      const liveTarget = pwkTarget && !pwkTarget.isDead && !pwkTarget.isUnconscious
        ? pwkTarget
        : shouldCastPowerWordKill(actor, bf);
      if (liveTarget) executePowerWordKill(actor, liveTarget, state);
      break;
    }

    // ── Session 24 — Megabatch batch 1 (L1 combat damage spells) ──────
    // Each migrated L1 spell routes to its bespoke shouldCast + execute.
    // Single-target spells (chaosBolt, rayOfSickness, spellfireFlare,
    // wardaway, witchBolt) resolve the target from plan.targetId with a
    // shouldCast fallback (mirrors powerWordKill). AoE spells
    // (earthTremor, frostFingers, magnifyGravity) re-run shouldCast to
    // collect the target list (mirrors shatter/fireball).

    case 'chaosBolt': {
      // Chaos Bolt — XGE p.151: 120 ft, ranged spell attack 2d8 random-
      // type, crit doubles. shouldCast → single Combatant.
      const cbTargetId = plan.targetId;
      const cbTarget = cbTargetId ? bf.combatants.get(cbTargetId) ?? null : null;
      const liveTarget = cbTarget && !cbTarget.isDead && !cbTarget.isUnconscious
        ? cbTarget
        : shouldCastChaosBolt(actor, bf);
      if (liveTarget) executeChaosBolt(actor, liveTarget, state);
      break;
    }

    case 'earthTremor': {
      // Earth Tremor — XGE p.155: Self (10-ft radius), CON save 1d6
      // bludgeoning + prone, caster excluded. shouldCast → Combatant[].
      const etTargets = shouldCastEarthTremor(actor, bf);
      if (etTargets) executeEarthTremor(actor, etTargets, state);
      break;
    }

    case 'frostFingers': {
      // Frost Fingers — XGE p.161: Self (15-ft cone), CON save 2d8 cold.
      // shouldCast → Combatant[].
      const ffTargets = shouldCastFrostFingers(actor, bf);
      if (ffTargets) executeFrostFingers(actor, ffTargets, state);
      break;
    }

    case 'magnifyGravity': {
      // Magnify Gravity — EGtW p.161: 60 ft, CON save 2d8 force, 10-ft
      // radius AoE. shouldCast → Combatant[].
      const mgTargets = shouldCastMagnifyGravity(actor, bf);
      if (mgTargets) executeMagnifyGravity(actor, mgTargets, state);
      break;
    }

    case 'rayOfSickness': {
      // Ray of Sickness — PHB p.271: 60 ft, ranged spell attack 2d8
      // poison + poisoned on hit, crit doubles. shouldCast → single Combatant.
      const rosTargetId = plan.targetId;
      const rosTarget = rosTargetId ? bf.combatants.get(rosTargetId) ?? null : null;
      const liveTarget = rosTarget && !rosTarget.isDead && !rosTarget.isUnconscious
        ? rosTarget
        : shouldCastRayOfSickness(actor, bf);
      if (liveTarget) executeRayOfSickness(actor, liveTarget, state);
      break;
    }

    case 'spellfireFlare': {
      // Spellfire Flare — SCAG p.149: 60 ft, AUTO-HIT 2d10+mod fire (no
      // save, no attack). shouldCast → single Combatant.
      const sfTargetId = plan.targetId;
      const sfTarget = sfTargetId ? bf.combatants.get(sfTargetId) ?? null : null;
      const liveTarget = sfTarget && !sfTarget.isDead && !sfTarget.isUnconscious
        ? sfTarget
        : shouldCastSpellfireFlare(actor, bf);
      if (liveTarget) executeSpellfireFlare(actor, liveTarget, state);
      break;
    }

    case 'wardaway': {
      // Wardaway: 60 ft, CON save 2d4 force, single-target.
      // shouldCast → single Combatant.
      const waTargetId = plan.targetId;
      const waTarget = waTargetId ? bf.combatants.get(waTargetId) ?? null : null;
      const liveTarget = waTarget && !waTarget.isDead && !waTarget.isUnconscious
        ? waTarget
        : shouldCastWardaway(actor, bf);
      if (liveTarget) executeWardaway(actor, liveTarget, state);
      break;
    }

    case 'witchBolt': {
      // Witch Bolt — PHB p.289: 30 ft, ranged spell attack 1d12 lightning
      // + concentration per-turn action DoT. shouldCast auto-detects DoT
      // mode (concentrating on Witch Bolt) vs fresh cast. The "ends on
      // other action" guard at the top of executePlannedAction breaks
      // concentration when plan.type !== 'witchBolt'.
      const wbTargetId = plan.targetId;
      const wbTarget = wbTargetId ? bf.combatants.get(wbTargetId) ?? null : null;
      // In DoT mode the target is the linked concentration target; in
      // fresh-cast mode it's the highest-threat enemy within 30 ft.
      const liveTarget = wbTarget && !wbTarget.isDead && !wbTarget.isUnconscious
        ? wbTarget
        : shouldCastWitchBolt(actor, bf);
      if (liveTarget) executeWitchBolt(actor, liveTarget, state);
      break;
    }

    case 'mindSpike': {
      // Mind Spike — XGE p.162: 60 ft, WIS save 3d8 psychic, single-target.
      // v1 one-shot (canon concentration simplified). shouldCast → single Combatant.
      const msTargetId = plan.targetId;
      const msTarget = msTargetId ? bf.combatants.get(msTargetId) ?? null : null;
      const liveTarget = msTarget && !msTarget.isDead && !msTarget.isUnconscious
        ? msTarget
        : shouldCastMindSpike(actor, bf);
      if (liveTarget) executeMindSpike(actor, liveTarget, state);
      break;
    }

    case 'sprayOfCards': {
      // Spray of Cards — BMT p.50: Self (15-ft cone), DEX save 2d10
      // slashing + blinded on fail. shouldCast → Combatant[].
      const socTargets = shouldCastSprayOfCards(actor, bf);
      if (socTargets) executeSprayOfCards(actor, socTargets, state);
      break;
    }

    case 'eruptingEarth': {
      // Erupting Earth — XGE p.155: 60 ft, DEX save 3d12 bludgeoning,
      // 20-ft radius AoE. shouldCast → Combatant[].
      const eeTargets = shouldCastEruptingEarth(actor, bf);
      if (eeTargets) executeEruptingEarth(actor, eeTargets, state);
      break;
    }

    case 'lifeTransference': {
      // Life Transference — XGE p.160: 60 ft, self-damage 4d8 necrotic +
      // heal ALLY 2× (canon). shouldCast → single ALLY Combatant (NOT enemy).
      const ltAllyId = plan.targetId;
      const ltAlly = ltAllyId ? bf.combatants.get(ltAllyId) ?? null : null;
      const liveAlly = ltAlly && !ltAlly.isDead && !ltAlly.isUnconscious
        ? ltAlly
        : shouldCastLifeTransference(actor, bf);
      if (liveAlly) executeLifeTransference(actor, liveAlly, state);
      break;
    }

    case 'pulseWave': {
      // Pulse Wave — EGtW p.163: Self (30-ft cone), CON save 6d6 force.
      // shouldCast → Combatant[].
      const pwTargets = shouldCastPulseWave(actor, bf);
      if (pwTargets) executePulseWave(actor, pwTargets, state);
      break;
    }

    case 'tidalWave': {
      // Tidal Wave — XGE p.168: 30-ft line, STR save 4d8 bludgeoning +
      // prone on fail. shouldCast → Combatant[].
      const twTargets = shouldCastTidalWave(actor, bf);
      if (twTargets) executeTidalWave(actor, twTargets, state);
      break;
    }

    case 'vampiricTouch': {
      // Vampiric Touch — PHB p.287: touch (5 ft), melee spell attack 3d6
      // necrotic + heal self half. shouldCast → single Combatant.
      const vtTargetId = plan.targetId;
      const vtTarget = vtTargetId ? bf.combatants.get(vtTargetId) ?? null : null;
      const liveTarget = vtTarget && !vtTarget.isDead && !vtTarget.isUnconscious
        ? vtTarget
        : shouldCastVampiricTouch(actor, bf);
      if (liveTarget) executeVampiricTouch(actor, liveTarget, state);
      break;
    }

    // ── Session 19 — generic spell dispatch ────────────────────────────
    // Routes any spell in the GENERIC_SPELLS registry (262 bulk-implemented
    // spells from levels 2-9) to its spell module's shouldCast + execute.
    // The spell name is carried by `plan.spellName` (set by planner.ts).
    case 'genericSpell': {
      const spellName = plan.spellName;
      if (!spellName) break;
      const desc = lookupGenericSpell(spellName);
      if (!desc) break;
      // Re-run shouldCast with the live battlefield (target may have died
      // or moved out of range between planTurn and executePlannedAction).
      if (desc.shouldCast(actor, bf)) {
        desc.execute(actor, state);
      }
      break;
    }
  }
}

// ---- Execute a full TurnPlan --------------------------------

/**
 * Execute all components of a TurnPlan for one combatant.
 * Order: moveBefore → action → bonus action → moveAfter
 * (Movement can split around the action per PHB p.190.)
 */
function executeTurnPlan(actor: Combatant, plan: TurnPlan, state: EngineState): void {
  const isDisengage = plan.action?.type === 'disengage'
                   || plan.bonusAction?.type === 'disengage';

  const isDash = plan.action?.type === 'dash';
  // Cunning Action: Dash (and any future bonus-action Dash) must fire BEFORE movement
  // so its speed stipend is available to spend. All other bonus actions fire after.
  const isBonusDash = plan.bonusAction?.type === 'dash';

  // For action-Dash: execute the Dash action first to add speed stipend,
  // THEN move — otherwise the extra movement isn't available yet.
  if (isDash) {
    if (plan.action && !actor.isDead && !actor.isUnconscious) {
      actor.budget.actionUsed = true;
      executePlannedAction(actor, plan.action, state);  // adds effectiveSpeed to movementFt
    }
    if (plan.moveBefore && !actor.isDead && !actor.isUnconscious) {
      executeMove(actor, plan.moveBefore, state, isDisengage);
    }
  } else {
    // Bonus-action Dash (e.g. Cunning Action): fire first so stipend is available for moveBefore
    if (isBonusDash && plan.bonusAction && !actor.isDead && !actor.isUnconscious) {
      actor.budget.bonusActionUsed = true;
      executePlannedAction(actor, plan.bonusAction, state);  // adds effectiveSpeed to movementFt
    }
    // Normal order: move → action
    if (plan.moveBefore && !actor.isDead && !actor.isUnconscious) {
      executeMove(actor, plan.moveBefore, state, isDisengage);
    }
    if (plan.action && !actor.isDead && !actor.isUnconscious) {
      actor.budget.actionUsed = true;
      executePlannedAction(actor, plan.action, state);
    }
  }

  // Bonus action (non-Dash: Disengage, Bardic Inspiration, rage, etc. fire after the action)
  if (!isBonusDash && plan.bonusAction && !actor.isDead && !actor.isUnconscious) {
    actor.budget.bonusActionUsed = true;
    executePlannedAction(actor, plan.bonusAction, state);
  }

  // Move after action
  if (plan.moveAfter && !actor.isDead && !actor.isUnconscious) {
    executeMove(actor, plan.moveAfter, state, isDisengage);
  }

  // Clean up turn flags
  (actor as any).usedDisengage = false;
}

// ---- Perception update --------------------------------------

/**
 * After each action, update all surviving combatants' perception memories.
 * Records: heals, AoE casts, bloodied status, position.
 * Respects non-psychic constraint (no exact HP, no concentration, no slots).
 */
function updatePerception(
  actor: Combatant,
  target: Combatant | null,
  plan: TurnPlan,
  bf: Battlefield
): void {
  const wasAoE = plan.action?.action?.isAoE ?? false;
  const wasHeal = plan.action?.type === 'layOnHands'
    || plan.bonusAction?.description?.toLowerCase().includes('heal')
    || plan.action?.description?.toLowerCase().includes('cure');

  for (const [, observer] of bf.combatants) {
    if (observer.isDead || observer.isUnconscious) continue;

    // Update observed position for all living combatants
    for (const [, observed] of bf.combatants) {
      if (!observed.isDead) {
        let knowledge = observer.perception.targets.get(observed.id);
        if (!knowledge) {
          knowledge = {
            lastSeenPos: { ...observed.pos },
            visibleArmorType: 'none',
            hasShield: false,
            isBloodied: false,
            castAoEThisCombat: false,
            receivedHealingThisCombat: false,
            isFlying: false,
            isRanged: false,
            hasMeleeWeapon: false,
          };
          observer.perception.targets.set(observed.id, knowledge);
        }
        knowledge.lastSeenPos = { ...observed.pos };
        knowledge.isBloodied = isBloodied(observed);
        knowledge.isFlying = (observed.flySpeed !== null) && observed.pos.z > 0;
      }
    }

    // Record AoE cast
    if (wasAoE && target) {
      const k = observer.perception.targets.get(actor.id);
      if (k) k.castAoEThisCombat = true;
    }

    // Record healing received
    if (wasHeal && target) {
      const k = observer.perception.targets.get(target.id);
      if (k) k.receivedHealingThisCombat = true;
    }
  }
}

// ---- Victory check ------------------------------------------

function checkVictory(state: EngineState): 'party' | 'enemy' | null {
  const bf = state.battlefield;
  const partyAlive = [...bf.combatants.values()].some(
    c => c.faction === 'party' && !c.isDead && !c.isUnconscious
  );
  const enemyAlive = [...bf.combatants.values()].some(
    c => c.faction === 'enemy' && !c.isDead && !c.isUnconscious
  );

  if (!partyAlive) return 'enemy';
  if (!enemyAlive) return 'party';
  return null;
}

// ---- Main combat loop ---------------------------------------

export interface CombatOptions {
  maxRounds?: number;      // safety cap (default: 50)
  verbose?: boolean;       // print events as they happen
}

/**
 * Run a full combat encounter.
 *
 * @param battlefield  - set up with all combatants and their positions
 * @param initiative   - ordered array of combatant IDs (roll externally or use rollInitiative())
 * @param options
 */
export function runCombat(
  battlefield: Battlefield,
  initiative: string[],
  options: CombatOptions = {}
): CombatLog {
  const { maxRounds = 50, verbose = false } = options;
  const state = makeState(battlefield);
  battlefield.initiativeOrder = initiative;
  battlefield.round = 1;

  log(state, 'combat_start', 'engine', 'Combat begins!');
  if (verbose) console.log('\n⚔️  Combat begins!\n');

  for (let round = 1; round <= maxRounds; round++) {
    battlefield.round = round;
    if (verbose) console.log(`\n── Round ${round} ──`);

    // Reset disengage flags at start of round
    state.disengagedThisTurn.clear();

    for (const actorId of initiative) {
      const actor = battlefield.combatants.get(actorId);
      if (!actor || actor.isDead) continue;

      // Death saving throw: unconscious PCs roll at the start of their turn
      if (actor.isUnconscious && actor.isPlayer && actor.deathSaves) {
        const result = rollDeathSave(actor);
        if (result === 'dead') {
          log(state, 'death', actor.id,
            `${actor.name} has failed 3 death saving throws and dies!`, undefined, 0);
        } else if (result === 'stable') {
          const woke = actor.currentHP > 0;
          log(state, woke ? 'action' : 'action', actor.id,
            woke
              ? `${actor.name} rolls a natural 20 on their death save and regains 1 HP!`
              : `${actor.name} is now stable (3 death save successes).`
          );
        }
        // Regardless — skip rest of turn if still unconscious
        if (actor.isUnconscious) continue;
      } else if (actor.isUnconscious) {
        continue; // monster or already-handled
      }

      // ── Mount turn handling (PHB p.198) ─────────────────────
      if (isControlledMount(actor)) {
        // Refresh movement pool — rider draws from this
        actor.budget.movementFt = actor.flySpeed ?? actor.speed;

        if (isIndependentMount(actor)) {
          // ── INDEPENDENT MOUNT: full turn (attacks, any action) ──
          // Rider has explicitly granted independence (grantIndependence(mount)).
          // Mount uses its own initiative slot, can attack, etc.
          // Falls through to normal turn planning below.
        } else {
          // ── CONTROLLED MOUNT (DEFAULT): Dash, Disengage, or Dodge only ──
          // PHB p.198: "A controlled mount can take only the Dash, Disengage,
          // or Dodge action." Mount CANNOT attack in this mode.
          //
          // AI choice: if rider is in melee range of enemies → Disengage (safe escape)
          //            otherwise → Dash (close gap / extra movement for rider)
          resetBudget(actor);
          tickAdvantages(actor);  // expire until_next_turn / decrement rounds entries
          actor.usedSneakAttackThisTurn = false;
          actor.helpedThisTurn = false;
          actor.budget.movementFt = actor.flySpeed ?? actor.speed;

          const rider = battlefield.combatants.get(actor.carriedBy!);
          const adjEnemies = rider
            ? [...battlefield.combatants.values()].filter(c =>
                c.faction !== rider.faction && !c.isDead && !c.isUnconscious &&
                Math.max(Math.abs(c.pos.x - actor.pos.x), Math.abs(c.pos.y - actor.pos.y)) <= 1
              ).length
            : 0;

          if (adjEnemies > 0) {
            // Disengage: rider can move away safely
            log(state, 'disengage', actor.id,
              `${actor.name} (controlled mount) Disengages — rider can move freely`, undefined);
            state.disengagedThisTurn.add(actor.id);
            (actor as any).usedDisengage = true;
          } else {
            // Dash: rider gets another speed stipend equal to mount's base speed
            log(state, 'dash', actor.id,
              `${actor.name} (controlled mount) Dashes — +${actor.speed}ft movement pool`, undefined);
            actor.budget.movementFt += actor.flySpeed ?? actor.speed;
          }
          continue; // controlled mount turn ends here
        }
      }

      // Reset per-turn flags
      actor.usedSneakAttackThisTurn = false;
      actor.helpedThisTurn = false;

      // Capture rage damage flag (set by attacks on OTHER creatures' turns) then clear it
      // so damage DURING this turn isn't double-counted in the next tick.
      const damageTakenSinceLastTurn = state.rageDamagedSinceLastTurn.has(actor.id);
      state.rageDamagedSinceLastTurn.delete(actor.id);

      // Tick advantage/disadvantage durations (expire until_next_turn; decrement rounds)
      tickAdvantages(actor);

      // ── Reckless Attack (Barbarian, PHB p.48) ─────────────────────────────────
      // "When you make your first attack on your turn, you can decide to attack
      //  recklessly. Doing so gives you advantage on melee weapon attack rolls using
      //  Strength during this turn, but attack rolls against you have advantage until
      //  your next turn."
      // AI: always use when enemies are present (benefit outweighs exposure at level 1).
      if (actor.traits.includes('Reckless Attack') &&
          livingEnemiesOf(actor, battlefield).length > 0) {
        grantSelf(actor, 'advantage', 'attack:melee', 'Reckless Attack', 'until_next_turn');
        grantVulnerability(actor, 'advantage', 'attack', 'Reckless Attack', 'until_next_turn');
        log(state, 'action', actor.id,
          `${actor.name} attacks Recklessly! (adv on melee attacks; enemies have adv vs ${actor.name} until next turn)`,
          undefined);
      }

      // 4.12 Commanded creatures: allow external profile override each turn.
      // A controller (commander) can call bf.pendingCommands.get(actorId) to
      // switch a minion's aiProfile before its turn is planned.
      // This models verbal commands that cost no action (e.g. Ebony Fly magic item).
      if (battlefield.pendingCommands?.has(actor.id)) {
        const cmd = battlefield.pendingCommands.get(actor.id)!;
        actor.aiProfile = cmd;
        battlefield.pendingCommands.delete(actor.id);
      }

      // Reset budget (movement, action, bonus, reaction)
      resetBudget(actor);

      // ── Cloud of Daggers / damage_zone start-of-turn tick (PHB p.222) ────
      // PHB p.222: "A creature takes 4d4 slashing damage when it enters the
      // spell's area for the first time on a turn or STARTS ITS TURN THERE."
      // This hook applies the "starts its turn there" damage — it runs right
      // after resetBudget, at the very start of the actor's turn, BEFORE the
      // actor gets to plan or act. The damage is applied via
      // applyDamageWithTempHP so resistances / temp HP / Warding Bond
      // redirect all work as expected. v1 simplification: doesn't track
      // whether the creature moved out of the zone (damage applies
      // regardless of position — see `cloudOfDaggersMovementTrackingV1Implemented`
      // metadata flag).
      //
      // Multiple damage_zone effects from different casters all tick
      // independently (rare but possible — e.g. two Cloud of Daggers
      // casters overlapping zones). Each effect rolls its own dice.
      const damageZones = getActiveDamageZones(actor);
      if (damageZones.length > 0 && !actor.isDead && !actor.isUnconscious) {
        // Track which zones to remove after the loop (ticksRemaining decrement).
        const zonesToRemove: string[] = [];
        for (const zone of damageZones) {
          // Re-check liveness (a prior zone in this loop may have killed
          // the actor — e.g. two overlapping Cloud of Daggers zones).
          if (actor.isDead || actor.isUnconscious) break;

          const dieCount = zone.payload.dieCount ?? 0;
          const dieSides = zone.payload.dieSides ?? 0;
          const damageType = zone.payload.damageType ?? null;
          // Skip sentinels (dieCount=0) — they're lifecycle anchors for
          // scratch-field buffs (Flame Blade, Alter Self, Enhance Ability),
          // not actual damage zones. See _undoEffect in spell_effects.ts.
          if (dieCount <= 0 || dieSides <= 0) continue;

          // Roll the damage (mirror Cloud of Daggers's rollDamage helper).
          let dmgRoll = 0;
          for (let i = 0; i < dieCount; i++) dmgRoll += rollDie(dieSides);

          // Session 17: save for half (Flaming Sphere, Cordon of Arrows).
          // If the zone has a saveDC + saveAbility, the actor rolls a save;
          // on success, the damage is halved (PHB p.242 Flaming Sphere:
          // "half as much on a successful one"). Cloud of Daggers has no
          // save (backward-compatible — saveDC is undefined).
          let actualDmg = dmgRoll;
          let saveDesc = '';
          const zoneSaveDC = zone.payload.saveDC;
          const zoneSaveAbility = zone.payload.saveAbility;
          if (zoneSaveDC !== undefined && zoneSaveAbility) {
            const save = rollSave(actor, zoneSaveAbility, zoneSaveDC);
            if (save.success) {
              actualDmg = Math.floor(dmgRoll / 2);
            }
            saveDesc = ` (DC ${zoneSaveDC} ${zoneSaveAbility.toUpperCase()} save: ${save.success ? 'SUCCESS — half damage' : 'FAIL — full damage'} (rolled ${save.total}))`;
            log(state,
              save.success ? 'save_success' : 'save_fail',
              zone.casterId,
              `${actor.name} ${save.success ? 'succeeds on' : 'fails'} DC ${zoneSaveDC} ${zoneSaveAbility.toUpperCase()} save vs ${zone.spellName} (start-of-turn damage)${saveDesc}`,
              actor.id, save.roll);
          }

          const dealt = applyDamageWithTempHP(actor, actualDmg, damageType);
          log(state, 'damage', zone.casterId,
            `${actor.name} takes ${dealt} ${damageType ?? ''} damage from ${zone.spellName} (start of turn: ${dieCount}d${dieSides}=${dmgRoll}${actualDmg !== dmgRoll ? `, halved to ${actualDmg}` : ''})`,
            actor.id, dealt);

          // Concentration check if the actor was concentrating (the damage
          // from a damage_zone can break concentration — PHB p.203).
          if (actor.concentration?.active && dealt > 0) {
            const maintained = rollConcentrationSave(actor, dealt);
            if (!maintained) {
              removeEffectsFromCaster(actor.id, battlefield);
              log(state, 'condition_remove', actor.id,
                `${actor.name} loses concentration on ${actor.concentration?.spellName ?? 'spell'} (damaged by ${zone.spellName})!`, undefined);
            }
          }

          // Death check (the damage may have killed the actor).
          checkDeath(actor, state);

          // Session 17: ticksRemaining decrement (Melf's Acid Arrow = 1,
          // Cordon of Arrows = 4). If ticksRemaining reaches 0, mark the
          // zone for removal after the loop. We can't mutate activeEffects
          // during iteration (the for-of loop holds a reference to the array),
          // so we collect the IDs and remove them after.
          if (zone.payload.ticksRemaining !== undefined) {
            // Decrement the zone's ticksRemaining in place (mutating the
            // payload object — safe because we hold the reference directly).
            zone.payload.ticksRemaining -= 1;
            if (zone.payload.ticksRemaining <= 0) {
              zonesToRemove.push(zone.id);
              log(state, 'condition_remove', zone.casterId,
                `${zone.spellName} effect on ${actor.name} expires (ticksRemaining reached 0).`,
                actor.id);
            }
          }
        }

        // Remove expired zones (ticksRemaining reached 0).
        for (const zoneId of zonesToRemove) {
          removeEffectById(actor.id, zoneId, battlefield);
        }
      }

      // Guiding Bolt fallback expiry: remove any marks this caster placed last turn (PHB p.248).
      // Primary expiry happens in resolveAttack (consumeGuidingBoltMark); this is the safety net.
      cleanupGuidingBoltMarks(actor, battlefield);

      // Plan the turn
      const plan = planTurn(actor, battlefield);

      if (verbose && plan.action) {
        console.log(`  ${actor.name}: ${plan.action.description}`);
      }

      // Execute the plan
      executeTurnPlan(actor, plan, state);

      // Tick Rage at end of actor's turn (PHB p.48: rage ends if the barbarian didn't
      // attack or take damage since their last turn). Also removes B/P/S resistance
      // when rage ends.
      if (actor.resources?.rage?.active) {
        const attackedThisTurn =
          plan.action?.type === 'attack' ||
          plan.bonusAction?.type === 'attack';
        const rageActiveBeforeTick = actor.resources.rage.active;
        tickRage(actor, attackedThisTurn, damageTakenSinceLastTurn);
        if (rageActiveBeforeTick && !actor.resources.rage.active) {
          // Rage ended — strip B/P/S resistances granted by Rage
          removeResistance(actor, 'bludgeoning');
          removeResistance(actor, 'piercing');
          removeResistance(actor, 'slashing');
          log(state, 'action', actor.id,
            `${actor.name}'s Rage ends.`, undefined);
        }
      }

      // Update perception for all observers
      const target = plan.targetId ? battlefield.combatants.get(plan.targetId) ?? null : null;
      updatePerception(actor, target, plan, battlefield);

      // Legendary action window: after each creature's turn,
      // legendary creatures get to act (design doc §6, §5.3.5)
      for (const [, legendary] of battlefield.combatants) {
        if (legendary.legendaryActionPoolMax === 0) continue;
        if (legendary.isDead || legendary.isUnconscious) continue;
        if (legendary.id === actorId) continue; // not on own turn

        const la = planLegendaryAction(legendary, battlefield);
        if (la) {
          const laTarget = la.targetId ? battlefield.combatants.get(la.targetId) ?? null : null;
          if (laTarget && !laTarget.isDead) {
            if (verbose) console.log(`  ★ ${legendary.name} legendary: ${la.description}`);
            executePlannedAction(legendary, la, state);
            legendary.legendaryActionPool -= la.action?.legendaryCost ?? 1;
          }
        }
      }

      // Check victory after each creature's turn
      const victor = checkVictory(state);
      if (victor) {
        state.log.winner = victor;
        state.log.rounds = round;
        log(state, 'combat_end', 'engine',
          `Combat ends in round ${round}! ${victor === 'party' ? 'Heroes' : 'Enemies'} win!`);
        if (verbose) console.log(`\n🏆 ${victor === 'party' ? 'Heroes' : 'Enemies'} win in round ${round}!\n`);
        return state.log;
      }
    }

    // ── End-of-round checks ─────────────────────────────────────

    // 1. Auto-defeat: any living team with no attack capability loses immediately.
    //    Checked after all combatants have taken their turn.
    const factions = [...new Set(
      [...battlefield.combatants.values()]
        .filter(c => !c.isDead && !c.isUnconscious)
        .map(c => c.faction)
    )];
    for (const faction of factions) {
      if (teamHasNoAttackCapability(faction, battlefield.combatants)) {
        const winner = faction === 'party' ? 'enemy' : 'party';
        state.log.winner = winner;
        state.log.rounds = round;
        log(state, 'combat_end', 'engine',
          `${faction} team has no means to attack — auto-defeated in round ${round}!`);
        if (verbose) console.log(`\n⚔️  ${faction} has no attack capability — defeated!\n`);
        return state.log;
      }
    }

    // 2. No-damage tracking: update consecutive-round counters.
    //    If any team hits 10 consecutive rounds of 0 damage dealt, they are defeated.
    for (const faction of factions) {
      const dmgThisRound = state.damageThisRound.get(faction) ?? 0;
      if (dmgThisRound === 0) {
        const prev = state.noDamageRounds.get(faction) ?? 0;
        state.noDamageRounds.set(faction, prev + 1);
        if (prev + 1 >= 10) {
          const winner = faction === 'party' ? 'enemy' : 'party';
          state.log.winner = winner;
          state.log.rounds = round;
          log(state, 'combat_end', 'engine',
            `${faction} team dealt 0 damage for 10 consecutive rounds — auto-defeated!`);
          if (verbose) console.log(`\n⚔️  ${faction} has dealt no damage for 10 rounds — defeated!\n`);
          return state.log;
        }
      } else {
        state.noDamageRounds.set(faction, 0);
      }
    }
    // Reset per-round damage counters
    state.damageThisRound.clear();
  }

  // Hit round cap
  state.log.winner = 'draw';
  state.log.rounds = maxRounds;
  log(state, 'combat_end', 'engine', `Combat ended after ${maxRounds} rounds (draw)`);
  return state.log;
}

// ---- Helpers for setting up encounters ----------------------

/**
 * Create a minimal flat battlefield with no terrain modifiers.
 */
export function makeFlatBattlefield(
  widthSq: number,
  heightSq: number,
  combatants: Combatant[]
): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: widthSq,
    height: heightSq,
    depth: 1,
    cells: [],       // flat = no terrain modifiers
    combatants: map,
    round: 0,
    initiativeOrder: [],
  };
}
