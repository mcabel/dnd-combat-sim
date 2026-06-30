// ============================================================
// Combat Engine
// Executes TurnPlans produced by the AI planner.
// Handles: attack resolution, movement, OA triggers,
//          legendary action windows, perception updates.
// ============================================================

import {
  Combatant, Battlefield, TurnPlan, PlannedAction, Action, Vec3,
  ReactionTrigger, ReactionOutcome, Condition,
  LairAction, DamageType, Obstacle, ActiveEffect, AIProfile,
  AbilityScore,
} from '../types/core';
import {
  rollAttack, rollDamage, rollSave, applyDamage, applyHeal,
  resetBudget, spendMovement, attackHits, attackAdvantageState, resolveAttackAdvantage,
  isBloodied, addCondition, removeCondition,
  rollConcentrationSave, rollDeathSave,
  startConcentration,
  applyDamageWithTempHP, hasPackTacticsAdvantage,
  canSneakAttack, sneakAttackDice,
  addResistance, removeResistance,
  parseDieSides, consumeBardicInspiration,
  teamHasNoAttackCapability, canDealDamage, makeImprovisedUnarmed, makeImprovisedWeapon,
  effectiveSpeed, rollDie, abilityMod, proficiencyBonus, cantripTier,
  rollDice,
  rollDiceString as rollBoomingBladeDice,
  rollAbilityCheck,  // Session 43 Task #26: for rollAbilityCheckReactable
  elementalAffinityBonus,  // Session 47 Task #29-follow-up-5: Draconic Sorcerer
  combatantProfBonus,  // TG-030: Quivering Palm attack bonus + ki save DC
} from './utils';
import {
  chebyshev3D, distanceFt, euclideanDistFt, canReach, estimateMoveCostFt,
  opportunityAttackTriggered, selectOAAction,
  livingEnemiesOf, livingAlliesOf, posKey, pushAway, pullToward
} from './movement';
import { planTurn, planLegendaryAction, shouldTakeOpportunityAttack } from '../ai/planner';
import { shouldSmite, applyDivineSmite, tickRage, consumeSpellSlot, hasSpellSlot, hasInnateSpellUse } from '../ai/resources';
// ── Session 45 Task #29-follow-up: Champion Improved Critical / Superior Critical ──
import { hasFeature } from '../characters/builder';
// TG-008: Reaction spell subsystem
import { REACTION_SPELLS, ReactionSpellDescriptor } from '../spells/_reaction_registry';
import {
  fireEldritchBlastHitInvocations,
  fireEldritchBlastDamageInvocations,
} from '../spells/_invocations';
import { consumeRider as consumeAbsorbElementsRider } from '../spells/absorb_elements';
import { isControlledMount, mountDeathRiderCheck, isIndependentMount } from '../summons/mount';
import { checkMountedCombatant, checkProtectionStyle, checkInterceptionReduction } from './mount_redirect';
import { tickAdvantages, grantSelf, grantVulnerability } from './adv_system';
import { getSummonEntry }                           from '../summons/registry';
import { rollGrappleContest, rollGrappleContestDetailed, rollShoveContest, canGrappleOrShoveTarget, rollDiceString } from './utils';
import { computeLOS } from './los';
import { removeEffectsFromCaster, removeEffectById, undoEffect, getActiveAcBonus, getActiveAcFloor, getActiveBlessDie, getActiveBaneDie, getActiveHexDie, getActiveDamageZones, getActiveWeaponEnchant, getActiveEnlargeReduce, getActiveTaunt, getActiveCurseAttackDisadv, getActiveCurseRider, applySpellEffect, getActiveTerrainZones, makeTerrainFn, isProtectedByGoI } from './spell_effects';
import { TerrainZone } from './spell_effects';
import { applyCantripEffect, getCantripAttackAdvantage, resolveCantripAction, resolveCantripAoE, resolveCantripTouchEffect } from './cantrip_effects';
import { execute as executeHex } from '../spells/hex';
import { shouldCast as shouldCastCreateBonfire, execute as executeCreateBonfire } from '../spells/create_bonfire';
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
import { execute as executeCureWounds } from '../spells/cure_wounds';
// rollDiceString (formerly rollBoomingBladeDice) now imported from ./utils above (TG-013)
import { shouldCast as shouldCastAid, execute as executeAid } from '../spells/aid';
import { shouldCast as shouldCastBarkskin, execute as executeBarkskin } from '../spells/barkskin';
import { shouldCast as shouldCastBlur, execute as executeBlur } from '../spells/blur';
import { shouldCast as shouldCastShadowOfMoil, execute as executeShadowOfMoil } from '../spells/shadow_of_moil';
import { shouldCast as shouldCastBlindnessDeafness, execute as executeBlindnessDeafness } from '../spells/blindness_deafness';
import {
  shouldCast as shouldCastInvisibility,
  execute as executeInvisibility,
} from '../spells/invisibility';
import {
  shouldCast as shouldCastGreaterInvisibility,
  execute as executeGreaterInvisibility,
} from '../spells/greater_invisibility';
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
// Invisibility imports moved up next to Greater Invisibility (Session 32)
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
import {
  shouldCast as shouldCastElementalBane,
  execute as executeElementalBane,
} from '../spells/elemental_bane';
import {
  shouldCast as shouldCastGravitySinkhole,
  execute as executeGravitySinkhole,
} from '../spells/gravity_sinkhole';
import {
  shouldCast as shouldCastIceStorm,
  execute as executeIceStorm,
} from '../spells/ice_storm';
import {
  shouldCast as shouldCastSickeningRadiance,
  execute as executeSickeningRadiance,
} from '../spells/sickening_radiance';
import {
  shouldCast as shouldCastSpellfireStorm,
  execute as executeSpellfireStorm,
} from '../spells/spellfire_storm';
import {
  shouldCast as shouldCastStormSphere,
  execute as executeStormSphere,
} from '../spells/storm_sphere';
import {
  shouldCast as shouldCastVitriolicSphere,
  execute as executeVitriolicSphere,
} from '../spells/vitriolic_sphere';
import {
  shouldCast as shouldCastDestructiveWave,
  execute as executeDestructiveWave,
} from '../spells/destructive_wave';
import {
  shouldCast as shouldCastEnervation,
  execute as executeEnervation,
} from '../spells/enervation';
import {
  shouldCast as shouldCastFlameStrike,
  execute as executeFlameStrike,
} from '../spells/flame_strike';
import {
  shouldCast as shouldCastImmolation,
  execute as executeImmolation,
} from '../spells/immolation';
import {
  shouldCast as shouldCastMaelstrom,
  execute as executeMaelstrom,
} from '../spells/maelstrom';
import {
  shouldCast as shouldCastNegativeEnergyFlood,
  execute as executeNegativeEnergyFlood,
} from '../spells/negative_energy_flood';
import {
  shouldCast as shouldCastSteelWindStrike,
  execute as executeSteelWindStrike,
} from '../spells/steel_wind_strike';
import {
  shouldCast as shouldCastSynapticStatic,
  execute as executeSynapticStatic,
} from '../spells/synaptic_static';
import {
  shouldCast as shouldCastChainLightning,
  execute as executeChainLightning,
} from '../spells/chain_lightning';
import {
  shouldCast as shouldCastCircleOfDeath,
  execute as executeCircleOfDeath,
} from '../spells/circle_of_death';
import {
  shouldCast as shouldCastGravityFissure,
  execute as executeGravityFissure,
} from '../spells/gravity_fissure';
import {
  shouldCast as shouldCastMentalPrison,
  execute as executeMentalPrison,
} from '../spells/mental_prison';
import {
  shouldCast as shouldCastSunbeam,
  execute as executeSunbeam,
} from '../spells/sunbeam';
import {
  shouldCast as shouldCastCrownOfStars,
  execute as executeCrownOfStars,
} from '../spells/crown_of_stars';
import {
  shouldCast as shouldCastFireStorm,
  execute as executeFireStorm,
} from '../spells/fire_storm';
import {
  shouldCast as shouldCastDarkStar,
  execute as executeDarkStar,
} from '../spells/dark_star';
import {
  shouldCast as shouldCastEarthquake,
  execute as executeEarthquake,
} from '../spells/earthquake';
import {
  shouldCast as shouldCastFeeblemind,
  execute as executeFeeblemind,
} from '../spells/feeblemind';
import {
  shouldCast as shouldCastIncendiaryCloud,
  execute as executeIncendiaryCloud,
} from '../spells/incendiary_cloud';
import {
  shouldCast as shouldCastMaddeningDarkness,
  execute as executeMaddeningDarkness,
} from '../spells/maddening_darkness';
import {
  shouldCast as shouldCastPsychicScream,
  execute as executePsychicScream,
} from '../spells/psychic_scream';
import {
  shouldCast as shouldCastRavenousVoid,
  execute as executeRavenousVoid,
} from '../spells/ravenous_void';

// ── Session 25 — Megabatch batch 2 (save-or-condition spells) ────────────
import {
  shouldCast as shouldCastWeird,
  execute as executeWeird,
} from '../spells/weird';
import {
  shouldCast as shouldCastPowerWordStun,
  execute as executePowerWordStun,
} from '../spells/power_word_stun';
import {
  shouldCast as shouldCastDominateMonster,
  execute as executeDominateMonster,
} from '../spells/dominate_monster';
import {
  shouldCast as shouldCastPowerWordPain,
  execute as executePowerWordPain,
} from '../spells/power_word_pain';
import {
  shouldCast as shouldCastWhirlwind,
  execute as executeWhirlwind,
} from '../spells/whirlwind';
import {
  shouldCast as shouldCastReverseGravity,
  execute as executeReverseGravity,
} from '../spells/reverse_gravity';
import {
  shouldCast as shouldCastEyebite,
  execute as executeEyebite,
  pickEyebiteOption,
  optionToCondition,
} from '../spells/eyebite';
import {
  shouldCast as shouldCastFleshToStone,
  execute as executeFleshToStone,
} from '../spells/flesh_to_stone';
import {
  shouldCast as shouldCastMassSuggestion,
  execute as executeMassSuggestion,
} from '../spells/mass_suggestion';
import {
  shouldCast as shouldCastHoldMonster,
  execute as executeHoldMonster,
} from '../spells/hold_monster';
import {
  shouldCast as shouldCastContagion,
  execute as executeContagion,
} from '../spells/contagion';
import {
  shouldCast as shouldCastDominatePerson,
  execute as executeDominatePerson,
} from '../spells/dominate_person';
import {
  shouldCast as shouldCastGeas,
  execute as executeGeas,
} from '../spells/geas';
import {
  shouldCast as shouldCastPhantasmalKiller,
  execute as executePhantasmalKiller,
} from '../spells/phantasmal_killer';
import {
  shouldCast as shouldCastWaterySphere,
  execute as executeWaterySphere,
} from '../spells/watery_sphere';
import {
  shouldCast as shouldCastDominateBeast,
  execute as executeDominateBeast,
} from '../spells/dominate_beast';
import {
  shouldCast as shouldCastCharmMonster,
  execute as executeCharmMonster,
} from '../spells/charm_monster';
import {
  shouldCast as shouldCastAntagonize,
  execute as executeAntagonize,
} from '../spells/antagonize';
import {
  shouldCast as shouldCastBestowCurse,
  execute as executeBestowCurse,
} from '../spells/bestow_curse';
import {
  shouldCast as shouldCastCatnap,
  execute as executeCatnap,
} from '../spells/catnap';
import {
  shouldCast as shouldCastEnemiesAbound,
  execute as executeEnemiesAbound,
} from '../spells/enemies_abound';
import {
  shouldCast as shouldCastFastFriends,
  execute as executeFastFriends,
} from '../spells/fast_friends';
import {
  shouldCast as shouldCastFear,
  execute as executeFear,
} from '../spells/fear';
import {
  shouldCast as shouldCastHypnoticPattern,
  execute as executeHypnoticPattern,
} from '../spells/hypnotic_pattern';
import {
  shouldCast as shouldCastInciteGreed,
  execute as executeInciteGreed,
} from '../spells/incite_greed';
import {
  shouldCast as shouldCastSleetStorm,
  execute as executeSleetStorm,
} from '../spells/sleet_storm';
import {
  shouldCast as shouldCastStinkingCloud,
  execute as executeStinkingCloud,
} from '../spells/stinking_cloud';
import {
  shouldCast as shouldCastEvardsBlackTentacles,
  execute as executeEvardsBlackTentacles,
} from '../spells/evards_black_tentacles';
import {
  shouldCast as shouldCastPyrotechnics,
  execute as executePyrotechnics,
} from '../spells/pyrotechnics';
import {
  shouldCast as shouldCastColorSpray,
  execute as executeColorSpray,
} from '../spells/color_spray';
import {
  shouldCast as shouldCastCommand,
  execute as executeCommand,
} from '../spells/command';
import {
  shouldCast as shouldCastAnimalFriendship,
  execute as executeAnimalFriendship,
} from '../spells/animal_friendship';
import {
  shouldCast as shouldCastCauseFear,
  execute as executeCauseFear,
} from '../spells/cause_fear';
import {
  shouldCast as shouldCastBanishment,
  execute as executeBanishment,
} from '../spells/banishment';
import {
  shouldCast as shouldCastTashasHideousLaughter,
  execute as executeTashasHideousLaughter,
} from '../spells/tashas_hideous_laughter';
import {
  shouldCast as shouldCastDimensionDoor,
  execute as executeDimensionDoor,
} from '../spells/dimension_door';
import {
  shouldCast as shouldCastFogCloud,
  execute as executeFogCloud,
} from '../spells/fog_cloud';
import {
  shouldCast as shouldCastDarkness,
  execute as executeDarkness,
} from '../spells/darkness';
import {
  shouldCast as shouldCastWallOfFire,
  execute as executeWallOfFire,
} from '../spells/wall_of_fire';
import {
  shouldCast as shouldCastWallOfForce,
  execute as executeWallOfForce,
} from '../spells/wall_of_force';
import {
  shouldCast as shouldCastWallOfIce,
  execute as executeWallOfIce,
} from '../spells/wall_of_ice';
import {
  shouldCast as shouldCastWallOfStone,
  execute as executeWallOfStone,
} from '../spells/wall_of_stone';
import {
  shouldCast as shouldCastMaze,
  execute as executeMaze,
} from '../spells/maze';
import {
  shouldCast as shouldCastMagicCircle,
  execute as executeMagicCircle,
} from '../spells/magic_circle';
import {
  shouldCast as shouldCastAntimagicField,
  execute as executeAntimagicField,
} from '../spells/antimagic_field';
import {
  shouldCast as shouldCastMindBlank,
  execute as executeMindBlank,
} from '../spells/mind_blank';
import {
  shouldCast as shouldCastSymbol,
  execute as executeSymbol,
} from '../spells/symbol';
import {
  shouldCast as shouldCastCreateUndead,
  execute as executeCreateUndead,
} from '../spells/create_undead';
// Raise Dead: out-of-combat stub — shouldCast always returns false
import { shouldCast as shouldCastRaiseDead } from '../spells/raise_dead';
import {
  shouldCast as shouldCastEtherealness,
  execute as executeEtherealness,
} from '../spells/etherealness';
import {
  shouldCast as shouldCastWindWalk,
  execute as executeWindWalk,
} from '../spells/wind_walk';
import {
  shouldCast as shouldCastGate,
  execute as executeGate,
} from '../spells/gate';
import {
  shouldCast as shouldCastHallow,
  execute as executeHallow,
} from '../spells/hallow';
// Wish: out-of-combat stub — shouldCast always returns false
import { shouldCast as shouldCastWish } from '../spells/wish';
// Scrying: out-of-combat stub — shouldCast always returns false
import { shouldCast as shouldCastScrying } from '../spells/scrying';
// ── Session 69 Batch 5: 10 out-of-combat utility divinations (stubs) ──
// All shouldCast → null (never fire in combat). Safety-guard imports.
import { shouldCast as shouldCastDetectMagic } from '../spells/detect_magic';
import { shouldCast as shouldCastComprehendLanguages } from '../spells/comprehend_languages';
import { shouldCast as shouldCastIdentify } from '../spells/identify';
import { shouldCast as shouldCastLocateObject } from '../spells/locate_object';
import { shouldCast as shouldCastClairvoyance } from '../spells/clairvoyance';
import { shouldCast as shouldCastSending } from '../spells/sending';
import { shouldCast as shouldCastTongues } from '../spells/tongues';
import { shouldCast as shouldCastWaterBreathing } from '../spells/water_breathing';
import { shouldCast as shouldCastDivination } from '../spells/divination';
import { shouldCast as shouldCastLocateCreature } from '../spells/locate_creature';
// ── Session 69 Batch 6: 5 more out-of-combat utility divinations (stubs) ──
// All shouldCast → null (never fire in combat). Safety-guard imports.
import { shouldCast as shouldCastDetectEvilAndGood } from '../spells/detect_evil_and_good';
import { shouldCast as shouldCastAugury } from '../spells/augury';
import { shouldCast as shouldCastRevivify } from '../spells/revivify';
import { shouldCast as shouldCastArcaneEye } from '../spells/arcane_eye';
import { shouldCast as shouldCastTrueSeeing } from '../spells/true_seeing';
// ── Session 69 Batch 7: 12 more out-of-combat utility spells (stubs) ──
// All shouldCast → null (never fire in combat). Safety-guard imports.
import { shouldCast as shouldCastLongstrider } from '../spells/longstrider';
import { shouldCast as shouldCastWaterWalk } from '../spells/water_walk';
import { shouldCast as shouldCastGentleRepose } from '../spells/gentle_repose';
import { shouldCast as shouldCastLocateAnimalsOrPlants } from '../spells/locate_animals_or_plants';
import { shouldCast as shouldCastCommune } from '../spells/commune';
import { shouldCast as shouldCastContactOtherPlane } from '../spells/contact_other_plane';
import { shouldCast as shouldCastDream } from '../spells/dream';
import { shouldCast as shouldCastLegendLore } from '../spells/legend_lore';
import { shouldCast as shouldCastAwaken } from '../spells/awaken';
import { shouldCast as shouldCastHeroesFeast } from '../spells/heroes_feast';
import { shouldCast as shouldCastProgrammedIllusion } from '../spells/programmed_illusion';
import { shouldCast as shouldCastImprisonment } from '../spells/imprisonment';
// ── Session 69 Batch 8: 16 more out-of-combat utility spells (stubs) ──
// All shouldCast → null (never fire in combat). Safety-guard imports.
import { shouldCast as shouldCastDetectPoisonAndDisease } from '../spells/detect_poison_and_disease';
import { shouldCast as shouldCastIllusoryScript } from '../spells/illusory_script';
import { shouldCast as shouldCastRopeTrick } from '../spells/rope_trick';
import { shouldCast as shouldCastPlanarBinding } from '../spells/planar_binding';
import { shouldCast as shouldCastFindThePath } from '../spells/find_the_path';
import { shouldCast as shouldCastWordOfRecall } from '../spells/word_of_recall';
import { shouldCast as shouldCastContingency } from '../spells/contingency';
import { shouldCast as shouldCastDemiplane } from '../spells/demiplane';
import { shouldCast as shouldCastTelepathy } from '../spells/telepathy';
import { shouldCast as shouldCastAstralProjection } from '../spells/astral_projection';
import { shouldCast as shouldCastClone } from '../spells/clone';
import { shouldCast as shouldCastDrawmajsInstantSummons } from '../spells/drawmajs_instant_summons';
import { shouldCast as shouldCastForbiddance } from '../spells/forbiddance';
import { shouldCast as shouldCastPlanarAlly } from '../spells/planar_ally';
import { shouldCast as shouldCastResurrection } from '../spells/resurrection';
import { shouldCast as shouldCastSimulacrum } from '../spells/simulacrum';
// ── Session 71 — Batch B/C: 6 deferred combat spell stubs ──────────────
import { shouldCast as shouldCastThunderStep } from '../spells/thunder_step';
import { shouldCast as shouldCastWindWall } from '../spells/wind_wall';
import { shouldCast as shouldCastWallOfThorns } from '../spells/wall_of_thorns';
import { shouldCast as shouldCastPrismaticWall } from '../spells/prismatic_wall';
import { shouldCast as shouldCastProtectionFromEvilAndGood } from '../spells/protection_from_evil_and_good';
import { shouldCast as shouldCastDispelEvilAndGood } from '../spells/dispel_evil_and_good';
import {
  shouldCast as shouldCastPlaneShift,
  execute as executePlaneShift,
} from '../spells/plane_shift';
import {
  shouldCast as shouldCastTeleport,
  execute as executeTeleport,
} from '../spells/teleport';
import {
  shouldCast as shouldCastAnimateDead,
  execute as executeAnimateDead,
} from '../spells/animate_dead';
import {
  shouldShapechange,
  executeShapechange,
  revertOnDeath as revertShapechangeOnDeath,
} from './shapechange';
// ── Session 62 RFC-VISION-AUDIO Phase 1: perception + detection subsystem ──
import {
  tryHide,
  tryActivePerception,
  updateDetectionStates,
  revealOnCast,
} from './perception';
// ── Session 64 RFC-COMBINING-EFFECTS Phase 1: priority activation ──
import { reevaluateEffects } from './effect_pipeline';
import {
  shouldCast as shouldCastCharmPerson,
  execute as executeCharmPerson,
} from '../spells/charm_person';
import {
  shouldCast as shouldCastCompelledDuel,
  execute as executeCompelledDuel,
} from '../spells/compelled_duel';
import {
  shouldCast as shouldCastGrease,
  execute as executeGrease,
} from '../spells/grease';

// ── Session 27 — Batch 3 concentration buffs (23 spells) ────────────────
import { shouldCast as shouldCastBane,            execute as executeBane }            from '../spells/bane';
import { shouldCast as shouldCastMotivationalSpeech, execute as executeMotivationalSpeech } from '../spells/motivational_speech';
import { shouldCast as shouldCastEnsnaringStrike, execute as executeEnsnaringStrike } from '../spells/ensnaring_strike';
import { shouldCast as shouldCastHailOfThorns,    execute as executeHailOfThorns }    from '../spells/hail_of_thorns';
import { shouldCast as shouldCastSearingSmite,    execute as executeSearingSmite }    from '../spells/searing_smite';
import { shouldCast as shouldCastThunderousSmite, execute as executeThunderousSmite } from '../spells/thunderous_smite';
import { shouldCast as shouldCastWrathfulSmite,   execute as executeWrathfulSmite }   from '../spells/wrathful_smite';
import { shouldCast as shouldCastZephyrStrike,    execute as executeZephyrStrike }    from '../spells/zephyr_strike';
import { shouldCast as shouldCastBlindingSmite,   execute as executeBlindingSmite }   from '../spells/blinding_smite';
import { shouldCast as shouldCastLightningArrow,  execute as executeLightningArrow }  from '../spells/lightning_arrow';
import { shouldCast as shouldCastSpiritShroud,    execute as executeSpiritShroud }    from '../spells/spirit_shroud';
import { shouldCast as shouldCastStaggeringSmite, execute as executeStaggeringSmite } from '../spells/staggering_smite';
import { shouldCast as shouldCastBanishingSmite,  execute as executeBanishingSmite }  from '../spells/banishing_smite';
import { shouldCast as shouldCastDivineFavor,     execute as executeDivineFavor }     from '../spells/divine_favor';
import { shouldCast as shouldCastShadowBlade,     execute as executeShadowBlade }     from '../spells/shadow_blade';
import { shouldCast as shouldCastElementalWeapon, execute as executeElementalWeapon } from '../spells/elemental_weapon';
import { shouldCast as shouldCastFlameArrows,     execute as executeFlameArrows }     from '../spells/flame_arrows';
import { shouldCast as shouldCastHolyWeapon,      execute as executeHolyWeapon }      from '../spells/holy_weapon';
import { shouldCast as shouldCastSwiftQuiver,     execute as executeSwiftQuiver }     from '../spells/swift_quiver';
import { shouldCast as shouldCastBeaconOfHope,    execute as executeBeaconOfHope }    from '../spells/beacon_of_hope';
import { shouldCast as shouldCastIntellectFortress, execute as executeIntellectFortress } from '../spells/intellect_fortress';
import { shouldCast as shouldCastHolyAura,        execute as executeHolyAura }        from '../spells/holy_aura';
import { shouldCast as shouldCastForesight,       execute as executeForesight }       from '../spells/foresight';
// ── Session 27 — Batch 4 persistent zones + healing + temp HP (22 spells) ──
import { shouldCast as shouldCastDeathArmor,      execute as executeDeathArmor }      from '../spells/death_armor';
import { shouldCast as shouldCastDustDevil,       execute as executeDustDevil }       from '../spells/dust_devil';
import { shouldCast as shouldCastHealingSpirit,   execute as executeHealingSpirit }   from '../spells/healing_spirit';
import { shouldCast as shouldCastCacophonicShield, execute as executeCacophonicShield } from '../spells/cacophonic_shield';
import { shouldCast as shouldCastCallLightning,   execute as executeCallLightning }   from '../spells/call_lightning';
import { shouldCast as shouldCastHungerOfHadar,   execute as executeHungerOfHadar }   from '../spells/hunger_of_hadar';
import { shouldCast as shouldCastSpiritGuardians, execute as executeSpiritGuardians } from '../spells/spirit_guardians';
import { shouldCast as shouldCastGuardianOfFaith, execute as executeGuardianOfFaith } from '../spells/guardian_of_faith';
import { shouldCast as shouldCastDawn,            execute as executeDawn }            from '../spells/dawn';
import { shouldCast as shouldCastInsectPlague,    execute as executeInsectPlague }    from '../spells/insect_plague';
import { shouldCast as shouldCastStormOfVengeance, execute as executeStormOfVengeance } from '../spells/storm_of_vengeance';
import { shouldCast as shouldCastGoodberry,       execute as executeGoodberry }       from '../spells/goodberry';
import { shouldCast as shouldCastWitherAndBloom,  execute as executeWitherAndBloom }  from '../spells/wither_and_bloom';
import { shouldCast as shouldCastAuraOfVitality,  execute as executeAuraOfVitality,  shouldCastPulse as shouldCastPulseAuraOfVitality,  executePulse as executePulseAuraOfVitality }  from '../spells/aura_of_vitality';
import { shouldCast as shouldCastMassHealingWord, execute as executeMassHealingWord } from '../spells/mass_healing_word';
import { shouldCast as shouldCastMassCureWounds,  execute as executeMassCureWounds }  from '../spells/mass_cure_wounds';
import { shouldCast as shouldCastHeal,            execute as executeHeal }            from '../spells/heal';
import { shouldCast as shouldCastRegenerate,      execute as executeRegenerate }      from '../spells/regenerate';
import { shouldCast as shouldCastMassHeal,        execute as executeMassHeal }        from '../spells/mass_heal';
import { shouldCast as shouldCastPowerWordHeal,   execute as executePowerWordHeal }   from '../spells/power_word_heal';
import { shouldCast as shouldCastArmorOfAgathys,  execute as executeArmorOfAgathys }  from '../spells/armor_of_agathys';
import { shouldCast as shouldCastFalseLife,       execute as executeFalseLife }       from '../spells/false_life';
import { shouldCast as shouldCastDispelMagic,    execute as executeDispelMagic }     from '../spells/dispel_magic';
// ── TG-006 — Summon Beast bespoke summon spell (Phase 1b) ────────────────
import { shouldCast as shouldCastSummonBeast, execute as executeSummonBeast } from '../spells/summon_beast';
// ── TG-006 — L3 TCE summon spells (Phase 1c) ──────────────────────────────
import { shouldCast as shouldCastSummonFey,         execute as executeSummonFey }         from '../spells/summon_fey';
import { shouldCast as shouldCastSummonUndead,      execute as executeSummonUndead }      from '../spells/summon_undead';
import { shouldCast as shouldCastSummonShadowspawn, execute as executeSummonShadowspawn } from '../spells/summon_shadowspawn';
// ── TG-006 — L3-L4 TCE/XGE summon spells (Phase 1d) ────────────────────────
import { shouldCast as shouldCastSummonLesserDemons,  execute as executeSummonLesserDemons }  from '../spells/summon_lesser_demons';
import { shouldCast as shouldCastSummonAberration,     execute as executeSummonAberration }     from '../spells/summon_aberration';
import { shouldCast as shouldCastSummonConstruct,      execute as executeSummonConstruct }      from '../spells/summon_construct';
import { shouldCast as shouldCastSummonElemental,      execute as executeSummonElemental }      from '../spells/summon_elemental';
import { shouldCast as shouldCastSummonGreaterDemon,   execute as executeSummonGreaterDemon }   from '../spells/summon_greater_demon';
// ── TG-006 — L5+ TCE/FTD summon spells (Phase 1e) ────────────────────────
import { shouldCast as shouldCastSummonCelestial,        execute as executeSummonCelestial }        from '../spells/summon_celestial';
import { shouldCast as shouldCastSummonDraconicSpirit,   execute as executeSummonDraconicSpirit }   from '../spells/summon_draconic_spirit';
import { shouldCast as shouldCastSummonFiend,            execute as executeSummonFiend }            from '../spells/summon_fiend';
// ── TG-006 — PHB Conjure spells (Phase 2) ────────────────────────────────
import { shouldCast as shouldCastConjureAnimals, execute as executeConjureAnimals } from '../spells/conjure_animals';
// ── TG-006 — PHB Conjure spells (Phase 4 — Session 30) ───────────────────
import { shouldCast as shouldCastConjureWoodlandBeings,    execute as executeConjureWoodlandBeings }    from '../spells/conjure_woodland_beings';
import { shouldCast as shouldCastConjureMinorElementals,   execute as executeConjureMinorElementals }   from '../spells/conjure_minor_elementals';
import { shouldCast as shouldCastConjureElemental,         execute as executeConjureElemental }         from '../spells/conjure_elemental';
// ── TG-006 — PHB Conjure spells (Phase 4 — Session 31) ───────────────────
import { shouldCast as shouldCastConjureFey,        execute as executeConjureFey }        from '../spells/conjure_fey';
import { shouldCast as shouldCastConjureCelestial,  execute as executeConjureCelestial }  from '../spells/conjure_celestial';
// ── TG-006 — PHB/XGE Find spells (Phase 3) ──────────────────────────────
import { shouldCast as shouldCastFindFamiliar,        execute as executeFindFamiliar }        from '../spells/find_familiar';
import { shouldCast as shouldCastFindSteed,           execute as executeFindSteed }            from '../spells/find_steed';
import { shouldCast as shouldCastFindGreaterSteed,    execute as executeFindGreaterSteed }     from '../spells/find_greater_steed';

// ── Session 19 — bulk-implementation generic dispatch (262 new spells) ────
import {
  lookupGenericSpell,
} from '../spells/_generic_registry';
// ── Session 94 RFC-LAIRACTIONS Phase 3b: lair-action `summon` handler ──────
// `monsterToCombatant` is used to spawn the named creature from the bestiary
// reference stored on `Battlefield.bestiaryMap`. We import the type alias too
// so the cast at the use-site is type-safe (the Battlefield field is typed as
// `Map<string, unknown>` to avoid a circular type dependency).
import { monsterToCombatant, Raw5etoolsMonster } from '../parser/fivetools';

// ── Session 76 — RFC-MONSTER-SPELLCASTING Phase 4: bespoke spell dispatch ──
// Monster-bespoke spells (Fireball, Command, Hold Person, etc.) are
// dispatched via their existing case branches below. The planner sets
// plan.type to the bespoke plan type (e.g. 'fireball'). Before the
// switch, we attach synthetic state (action + resources) so the bespoke
// shouldCast functions (which check caster.actions + hasSpellSlot) pass.
import {
  lookupMonsterBespokeByPlanType,
  attachMonsterBespokeSyntheticState,
} from '../ai/monster_bespoke_registry';

// ── Session 93 — RFC-LAIRACTIONS Phase 3a: spell_slot_regen handler ──
// `initMonsterSpellSlots` lazily populates `monster.monsterSpellSlots` from
// `monsterSpellcasting.slots` (idempotent — no-op if already populated). The
// Lich's lair action "rolls a d8 and regains a spell slot of that level or
// lower" needs the tracker initialized before it can restore a spent slot.
import { initMonsterSpellSlots } from '../ai/monster_spellcasting';

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


// ============================================================
// TG-008: Reaction spell subsystem — trigger dispatch
//
// `triggerReactions` is the central entry point for all reaction spells.
// It checks whether `reactor` can cast any reaction spell in response to
// `trigger`, and fires the FIRST matching one (a creature can only cast
// one reaction per round — PHB p.190).
//
// Pre-conditions checked here:
//   - reactor's reaction budget is unused
//   - reactor is alive, conscious, not incapacitated
//   - reactor has the spell in their actions
//   - reactor has a spell slot of the required level
//   - trigger is not self-caused (reactor != attacker/caster)
//
// The spell module's `shouldCast` is then called for tactical gating
// (e.g. Shield only fires if +5 AC will flip the hit to a miss).
//
// Returns the outcome of the fired reaction, or null if no reaction fired.
// ============================================================

/**
 * Attempt to fire a reaction spell on `reactor` in response to `trigger`.
 * Returns the outcome of the fired reaction (negated / no_effect / failed),
 * or null if no reaction was fired.
 *
 * The caller is responsible for:
 *   - Passing the correct reactor (the target for incoming_attack_hit /
 *     incoming_damage; an enemy for incoming_spell; a nearby caster for falling)
 *   - Handling the outcome (e.g. flip hit to miss on 'negated', abort spell
 *     cast on 'negated', skip fall damage on 'negated')
 */
function triggerReactions(
  state: EngineState,
  reactor: Combatant,
  trigger: ReactionTrigger,
): ReactionOutcome | null {
  // Pre-condition checks
  if (reactor.budget.reactionUsed) return null;
  if (reactor.isDead || reactor.isUnconscious) return null;
  if (reactor.conditions.has('incapacitated')) return null;

  // Self-trigger guard: don't react to our own actions.
  if (trigger.kind === 'incoming_attack_hit' && trigger.attacker.id === reactor.id) return null;
  if (trigger.kind === 'incoming_damage' && trigger.attacker.id === reactor.id) return null;
  if (trigger.kind === 'incoming_spell' && trigger.caster.id === reactor.id) return null;
  // Session 37: Shield vs Magic Missile — don't Shield against your own MM.
  if (trigger.kind === 'targeted_by_magic_missile' && trigger.caster.id === reactor.id) return null;
  // Session 41: Silvery Barbs save-success — the reactor IS the spellcaster
  // who forced the save (trigger.caster). Silvery Barbs is cast BY the
  // spellcaster to force the saver to reroll, so the self-trigger guard
  // does NOT apply here. The shouldCastReaction function already rejects
  // self-saves (caster === saver) explicitly.
  // Session 42: Silvery Barbs ability-check-success — the reactor is the
  // OPPONENT of the checker (trigger.opponent). Don't cast Silvery Barbs
  // against your own ability check success (would be wasteful). The
  // shouldCastReaction function already rejects self-checks explicitly.

  // Iterate the registry in order; fire the first matching spell.
  for (const spell of REACTION_SPELLS) {
    if (!spell.triggerKinds.includes(trigger.kind)) continue;
    // The reactor must have this spell in their actions list.
    if (!reactor.actions.some(a => a.name === spell.name)) continue;
    // The reactor must have a spell slot of the required level OR an
    // innate spell use available (Session 44 Task #20: Couatl's Shield
    // is innate 3/day, not slot-based). The innate-use fallback mirrors
    // the pattern in cure_wounds.ts execute() — consumeInnateSpellUse
    // is called by the spell's executeReaction when no slot is available.
    if (!hasSpellSlot(reactor, spell.level) && !hasInnateSpellUse(reactor, spell.name)) continue;
    // Tactical gating — the spell module decides if it's worth casting.
    if (!spell.shouldCast(reactor, state.battlefield, trigger)) continue;
    // Fire the reaction.
    return spell.execute(reactor, state, trigger);
  }
  return null;
}

// ============================================================
// Session 41 Task #8: rollSaveReactable — Silvery Barbs trigger
//
// Wraps `rollSave` from utils.ts and fires an `incoming_save_success`
// reaction trigger after a successful save. The reactor is the spell
// caster who forced the save (NOT the saver — Silvery Barbs is cast
// by the spellcaster to force a reroll of the enemy's successful save).
//
// If Silvery Barbs (or any future 'incoming_save_success' reaction)
// negates the save success, this wrapper returns success=false so
// the calling spell module's "save failed" branch runs.
//
// Migration plan: spell modules call `rollSaveReactable(state, caster, saver, ability, dc, isProficient?)`
// instead of `rollSave(saver, ability, dc, isProficient?)`. The wrapper
// is a drop-in replacement: same return shape ({roll, total, success}),
// plus the reaction-trigger side effect.
//
// v1.5 scope (Session 41): infrastructure added. The 110 spell modules
// that call `rollSave` directly will be migrated incrementally — this
// session migrates fireball, burning_hands, and sacred_flame as proof
// of concept. Future sessions migrate the rest.
// ============================================================

/**
 * Roll a saving throw with reaction-trigger support.
 *
 * Calls `rollSave(saver, ability, dc, isProficient)` to compute the
 * raw save result. If the save succeeds AND a reaction spell (Silvery
 * Barbs) is available to the caster, fires the `incoming_save_success`
 * trigger. If the reaction negates (reroll flips to fail), returns
 * success=false so the caller's "save failed" branch runs.
 *
 * @param state        Engine state (for triggerReactions + logging)
 * @param caster       The creature that forced the save (potential reactor)
 * @param saver        The creature making the save
 * @param ability      Save ability (str/dex/con/int/wis/cha)
 * @param dc           Save DC
 * @param isProficient True if the saver is proficient in the save
 * @returns { roll, total, success } — same shape as rollSave
 */
export function rollSaveReactable(
  state: EngineState,
  caster: Combatant,
  saver: Combatant,
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
  dc: number,
  isProficient = false,
): { roll: number; total: number; success: boolean } {
  const result = rollSave(saver, ability, dc, isProficient);

  // Only fire the trigger if the save succeeded — Silvery Barbs forces
  // a reroll, which can only flip success → failure (not the reverse).
  if (!result.success) return result;

  // Don't fire the trigger if the caster is the saver (self-save can't
  // be Silvery Barbs'd — the caster would be reacting to their own save).
  if (caster.id === saver.id) return result;

  // Don't fire if the caster is dead/unconscious (can't react).
  if (caster.isDead || caster.isUnconscious) return result;

  // Don't fire if the caster has already used their reaction this round.
  if (caster.budget.reactionUsed) return result;

  // Fire the trigger.
  const outcome = triggerReactions(state, caster, {
    kind: 'incoming_save_success',
    caster,
    saver,
    ability,
    dc,
    roll: result.roll,
    total: result.total,
  });

  // If the reaction negated the save, return success=false so the
  // caller's "save failed" branch runs.
  if (outcome?.kind === 'negated') {
    return { ...result, success: false };
  }

  return result;
}

// ============================================================
// Session 42 Task #19: rollGrappleContestReactable — Silvery Barbs
// ability-check-success trigger for grapple/shove/escape contests.
//
// Wraps `rollGrappleContestDetailed` from utils.ts and fires an
// `incoming_ability_check_success` reaction trigger when the attacker
// wins the contest. The reactor is the DEFENDER (the one who wants
// the attacker to fail). If Silvery Barbs negates (reroll flips the
// contest to defender winning), this wrapper returns false (attacker
// did NOT win the contest).
//
// Session 43 Task #25: now uses rollGrappleContestDetailed so the
// trigger carries the REAL d20 rolls + totals (not placeholders).
// This lets Silvery Barbs implement the strict RAW "reroll the d20
// and use the lower roll" rule.
//
// Used for:
//   - case 'grapple': attacker grapples defender
//   - case 'shove': attacker shoves defender prone
//   - case 'escapeGrapple': escaper (attacker) escapes grappler (defender)
// ============================================================

/**
 * Roll a grapple/shove contest with reaction-trigger support.
 *
 * Calls `rollGrappleContestDetailed(attacker, defender)` to compute the
 * full contest result (raw d20s + totals). If the attacker WINS, fires
 * the `incoming_ability_check_success` trigger with the REAL roll values
 * (Session 43 Task #25 — was previously placeholder roll=20, total=999).
 * The reactor is the defender (the one who would cast Silvery Barbs to
 * flip the contest). If the reaction negates, returns false (attacker
 * did NOT win).
 *
 * @param state       Engine state (for triggerReactions + logging)
 * @param attacker    The creature initiating the contest (the "checker")
 * @param defender    The creature being contested (the "opponent" / reactor)
 * @param contestType Description of the contest (e.g. "grapple", "shove")
 * @returns true if attacker wins the contest (and Silvery Barbs didn't negate)
 */
export function rollGrappleContestReactable(
  state: EngineState,
  attacker: Combatant,
  defender: Combatant,
  contestType: string = 'grapple',
): boolean {
  // Roll the contest using the detailed version so we get raw d20s + totals.
  const result = rollGrappleContestDetailed(attacker, defender);

  // Only fire the trigger if the attacker won — Silvery Barbs forces
  // a reroll, which can only flip success → failure (not the reverse).
  if (!result.attackerWon) return false;

  // Don't fire if the defender is the attacker (self-contest — shouldn't happen).
  if (defender.id === attacker.id) return true;

  // Don't fire if the defender is dead/unconscious (can't react).
  if (defender.isDead || defender.isUnconscious) return true;

  // Don't fire if the defender has already used their reaction this round.
  if (defender.budget.reactionUsed) return true;

  // Fire the trigger with REAL roll values (Session 43 Task #25 — was
  // placeholder roll=20, total=999 in Session 42). The reroll logic in
  // silvery_barbs.ts uses trigger.roll to compute lower-of-two-d20s,
  // and trigger.opponentTotal to determine whether the lower roll
  // flips the contest.
  const outcome = triggerReactions(state, defender, {
    kind: 'incoming_ability_check_success',
    checker: attacker,
    opponent: defender,
    ability: 'str',  // grapple contests use STR (Athletics) for the attacker
    roll: result.attackerRoll,
    total: result.attackerTotal,
    opponentTotal: result.defenderTotal,
    contestType,
  });

  // If the reaction negated the contest, the attacker did NOT win.
  if (outcome?.kind === 'negated') {
    return false;
  }

  return true;
}

// ============================================================
// Session 43 Task #26: rollAbilityCheckReactable — Silvery Barbs
// ability-check-success trigger for Counterspell and Dispel Magic.
//
// Wraps `rollAbilityCheck` from utils.ts and fires an
// `incoming_ability_check_success` reaction trigger when the checker
// succeeds on the ability check. The reactor is the OPPONENT (the one
// who would cast Silvery Barbs to force a reroll). If Silvery Barbs
// negates (reroll flips the check to failure), this wrapper returns
// success=false so the caller's "check failed" branch runs.
//
// Used for:
//   - Counterspell L4+ ability check (DC 10 + spell level, INT/WIS/CHA)
//     The opponent is the original spellcaster (trigger.caster in the
//     incoming_spell trigger) who wants the Counterspell to fail.
//   - Dispel Magic non-concentration effect check (DC 13 flat)
//     The opponent is the target creature whose effect is being
//     dispelled — they might want to protect their buff.
// ============================================================

/**
 * Roll an ability check with reaction-trigger support.
 *
 * Calls `rollAbilityCheck(checker, ability, dc, isProficient)` to compute
 * the raw check result. If the check succeeds AND the opponent has a
 * reaction spell (Silvery Barbs) available, fires the
 * `incoming_ability_check_success` trigger. If the reaction negates
 * (lower-of-two-d20s reroll flips success to failure), returns
 * success=false so the caller's "check failed" branch runs.
 *
 * @param state        Engine state (for triggerReactions + logging)
 * @param checker      The creature making the ability check
 * @param opponent     The creature who would cast Silvery Barbs to negate
 *                     (e.g. original spellcaster for Counterspell, target
 *                     creature for Dispel Magic)
 * @param ability      The ability used (str/dex/con/int/wis/cha)
 * @param dc           The DC of the check
 * @param isProficient Whether the checker adds proficiency (default false)
 * @param contestType  Description of the check (e.g. "counterspell", "dispel magic")
 * @returns { roll, total, success, negated }
 *   - roll: raw d20 (1-20)
 *   - total: d20 + ability mod + (proficiency if applicable)
 *   - success: whether the check succeeds AFTER any reaction
 *   - negated: true if a reaction flipped success → failure
 */
export function rollAbilityCheckReactable(
  state: EngineState,
  checker: Combatant,
  opponent: Combatant,
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
  dc: number,
  isProficient: boolean = false,
  contestType: string = 'ability check',
): { roll: number; total: number; success: boolean; negated: boolean } {
  // Roll the check using the canonical rollAbilityCheck (utils.ts).
  const result = rollAbilityCheck(checker, ability, dc, isProficient);

  // Only fire the trigger if the checker succeeded — Silvery Barbs forces
  // a reroll, which can only flip success → failure (not the reverse).
  if (!result.success) {
    return { roll: result.roll, total: result.total, success: false, negated: false };
  }

  // Don't fire if the opponent is the checker (self-check — shouldn't happen).
  if (opponent.id === checker.id) {
    return { roll: result.roll, total: result.total, success: true, negated: false };
  }

  // Don't fire if the opponent is dead/unconscious (can't react).
  if (opponent.isDead || opponent.isUnconscious) {
    return { roll: result.roll, total: result.total, success: true, negated: false };
  }

  // Don't fire if the opponent has already used their reaction this round.
  if (opponent.budget.reactionUsed) {
    return { roll: result.roll, total: result.total, success: true, negated: false };
  }

  // Fire the trigger with REAL roll values. The reroll logic in
  // silvery_barbs.ts uses trigger.roll to compute lower-of-two-d20s.
  // There's no "opponent total" for an ability check vs DC (unlike a
  // contest), so we set opponentTotal to dc — the reroll flips when
  // newCheckerTotal <= dc (which is exactly "the check now fails").
  const outcome = triggerReactions(state, opponent, {
    kind: 'incoming_ability_check_success',
    checker,
    opponent,
    ability,
    roll: result.roll,
    total: result.total,
    opponentTotal: dc,  // the threshold for the check to flip to failure
    contestType,
  });

  // If the reaction negated the check, the checker did NOT succeed.
  if (outcome?.kind === 'negated') {
    return { roll: result.roll, total: result.total, success: false, negated: true };
  }

  return { roll: result.roll, total: result.total, success: true, negated: false };
}

// ============================================================
// TG-008: Helper — extract spell name + level from a PlannedAction
//
// Returns null for non-spell plans (attack with a weapon, dash, rage, etc.).
// For spell plans:
//   - 'genericSpell' → uses plan.spellName + lookupGenericSpell for level
//   - 'cast' / 'attack' → uses plan.action.name + plan.action.slotLevel
//     (only if slotLevel >= 1 — cantrips have slotLevel 0/undefined)
//   - Bespoke spell cases ('fireball', 'cureWounds', etc.) → uses plan.type
//     as the name; level is unknown, default to 1 (auto-success for
//     Counterspell with a L3 slot)
//
// v1 simplification: bespoke spell case branches don't carry the slot level
// on the plan, so we default to L1. This means Counterspell auto-succeeds
// against them (L1-3 spells are auto-countered by a L3 slot). Future work:
// add a `slotLevel?` field to PlannedAction for bespoke cases.
// ============================================================

/** Plan types that are NOT spells (class features, movement, etc.). */
const NON_SPELL_PLAN_TYPES = new Set<string>([
  'attack',          // weapon attack (spell attacks use 'cast')
  'dash', 'disengage', 'dodge', 'help', 'hide', 'ready',
  'shove', 'grapple', 'escapeGrapple',
  'secondWind',      // Fighter class feature
  'rage',            // Barbarian class feature
  'layOnHands',      // Paladin class feature
  'bardicInspiration', // Bard class feature
  'legendary',       // legendary action (not a spell cast)
  'perceive',        // Session 62: active Perception action (Search)
]);

/**
 * If `plan` represents a leveled spell cast, return its name + level.
 * Returns null otherwise (non-spell plans, cantrips, or unknown types).
 *
 * Used by the Counterspell trigger to decide whether to fire.
 */
function getSpellInfoFromPlan(
  plan: PlannedAction,
  _bf: Battlefield,
): { name: string; level: number } | null {
  // 'genericSpell' — always a spell; level from the registry.
  if (plan.type === 'genericSpell') {
    if (!plan.spellName) return null;
    const desc = lookupGenericSpell(plan.spellName);
    if (!desc) return null;
    return { name: plan.spellName, level: desc.level };
  }
  // 'cast' — handles cantrips AND leveled attack-roll spells.
  // Only count as a leveled spell if slotLevel >= 1.
  if (plan.type === 'cast') {
    if (plan.action && plan.action.slotLevel && plan.action.slotLevel >= 1) {
      return { name: plan.action.name, level: plan.action.slotLevel };
    }
    return null;  // cantrip or unknown
  }
  // Non-spell plan types.
  if (NON_SPELL_PLAN_TYPES.has(plan.type)) return null;
  // 'attack' is in NON_SPELL_PLAN_TYPES, so we don't reach here for weapon attacks.
  // Bespoke spell case ('fireball', 'cureWounds', 'magicMissile', etc.):
  // these are always spells. TG-033-P1 / RFC-UPCASTING Phase 1: read
  // castSlotLevel set by the planner (via getLowestAvailableSlot at
  // plan-construction time). Falls back to action.slotLevel (base level)
  // then 1 for legacy plans without the field.
  const name = plan.action?.name ?? plan.type;
  const level = plan.castSlotLevel ?? plan.action?.slotLevel ?? 1;
  return { name, level };
}

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

  // ── Session 49 Task #29-follow-up-3c: Nature's Sanctuary (Land Druid 14) ──
  // PHB p.68: "When a beast or plant creature attacks you, that creature must
  // make a Wisdom saving throw against your druid spell save DC. On a failed
  // save, the creature must choose a different target or lose the attack."
  //
  // This fires PER ATTACK — each time a beast/plant targets the Land Druid 14+
  // with an attack, the attacker must WIS save. On fail, the attack is lost
  // (no damage, no resource consumption). The save DC = the druid's spell save
  // DC, computed here from WIS + prof + 8 (druid casting, PHB p.66).
  if (target.classFeatures?.includes("Nature's Sanctuary")
      && (attacker.creatureType === 'beast' || attacker.creatureType === 'plant')
      && !attacker.isDead && !attacker.isUnconscious) {
    // Compute the druid's spell save DC. Prefer the target's spell action
    // saveDC; fall back to 8 + prof + WIS mod (druid casting).
    const targetSpellAction = target.actions.find(a => a.saveDC !== null && a.saveDC !== undefined);
    const targetProf = target.level ? Math.ceil(target.level / 4) + 1
                                    : proficiencyBonus(target.cr);
    const sanctuaryDC = targetSpellAction?.saveDC
      ?? (8 + targetProf + abilityMod(target.wis));

    const sanctuarySave = rollSaveReactable(state, target, attacker, 'wis', sanctuaryDC);
    if (sanctuarySave.success) {
      log(state, 'save_success', target.id,
        `${attacker.name} resists Nature's Sanctuary (WIS ${sanctuarySave.total} vs DC ${sanctuaryDC}) — attack proceeds!`,
        attacker.id, sanctuarySave.roll);
    } else {
      log(state, 'save_fail', target.id,
        `${attacker.name} succumbs to Nature's Sanctuary (WIS ${sanctuarySave.total} vs DC ${sanctuaryDC}) — loses attack against ${target.name}!`,
        attacker.id, sanctuarySave.roll);
      log(state, 'action', target.id,
        `Nature's Sanctuary: ${attacker.name} cannot bring itself to attack ${target.name}.`,
        attacker.id);
      return;  // attack canceled — no damage, no resource consumed
    }
  }

  // Pack Tactics: advantage if ally adjacent to target (MM)
  const packTacticsAdvantage = hasPackTacticsAdvantage(attacker, target, bf);

  // Save-based attacks (no attack roll)
  if (action.attackType === 'save' && action.saveDC !== null && action.saveAbility !== null) {
    // Session 41 Task #8: use rollSaveReactable so Silvery Barbs can fire
    // on save success. The "caster" is the attacker (spellcaster who forced
    // the save). If Silvery Barbs negates, save.success becomes false and
    // the save-fail branch runs (full damage instead of half).
    const save = rollSaveReactable(state, attacker, target, action.saveAbility, action.saveDC);
    log(state, save.success ? 'save_success' : 'save_fail', attacker.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} DC ${action.saveDC} ${action.saveAbility} save (rolled ${save.total})`,
      target.id, save.roll);

    if (action.damage) {
      // ── RFC-UPCASTING Phase 6: Cantrip damage scaling (PHB p.201) ──
      // Cantrips (slotLevel === 0) scale damage dice at caster levels 5/11/17.
      // Exception: some cantrips have flat damage (noCantripScaling=true).
      // Handle both new (count/sides) and legacy (dieCount/dieSides) formats.
      const _ctTier = cantripTier(attacker);
      const cantripDmgExpr = action.slotLevel === 0 && !action.noCantripScaling
        ? { ...action.damage, count: 1 + _ctTier, dieCount: 1 + _ctTier }
        : action.damage;
      // Session 47 Task #29-follow-up-5: Elemental Affinity (Draconic Sorcerer 6)
      // adds CHA mod to damage of spells matching the sorcerer's ancestry type.
      const dmg = rollDamage(cantripDmgExpr, false) + elementalAffinityBonus(attacker, action.damageType);
      // Session 53 Batch 4e: Avoidance trait. "If subjected to an effect that
      // allows a save for half damage, takes NO damage on success and HALF on
      // fail." Flip the save-for-half outcome.
      let actual: number;
      if (target.avoidance) {
        actual = save.success ? 0 : Math.floor(dmg / 2);
      } else {
        actual = save.success ? Math.floor(dmg / 2) : dmg; // half on save success
      }
      const dealt = applyDamageWithTempHP(target, actual, action.damageType);
      // TG-008: Absorb Elements / Hellish Rebuke reaction trigger (XGE p.150 / PHB p.249)
      // These fire AFTER damage is applied. The triggering damage still applies
      // (resistance from Absorb Elements protects against FUTURE damage of
      // that type, not the triggering hit — PHB timing).
      if (dealt > 0 && !target.isDead && !target.isUnconscious) {
        triggerReactions(state, target, {
          kind: 'incoming_damage',
          attacker,
          target,
          amount: dealt,
          damageType: action.damageType,
          action,
        });
      }
      // Concentration check if target was concentrating
      if (target.concentration?.active && dealt > 0) {
        const maintained = rollConcentrationSave(target, dealt);
        if (!maintained) {
          removeEffectsFromCaster(target.id, state.battlefield);
          processFallDamage(state);
          log(state, 'condition_remove', target.id,
            `${target.name} loses concentration on ${target.concentration?.spellName ?? 'spell'}!`, undefined);
        }
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} deals ${dealt} ${action.damageType ?? ''} damage to ${target.name} (save ${save.success ? 'halved' : 'full'})`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      applyWardingBondRedirect(target, dealt, state);
      // Phase 7 batch 2 (Session 99): Lich/Illithilich Warding Bond tether.
      applyLairWardingBondTetherRedirect(target, dealt, state);
      // Phase 8 batch 3 (Session 102): Demogorgon::1 illusory duplicate redirect.
      applyLairIllusoryDuplicateRedirect(target, dealt, state);
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
      // ── RFC-UPCASTING Phase 6: Cantrip damage scaling (PHB p.201) ──
      const _ctTier2 = cantripTier(attacker);
      const cantripDmgExpr = action.slotLevel === 0 && !action.noCantripScaling
        ? { ...action.damage, count: 1 + _ctTier2, dieCount: 1 + _ctTier2 }
        : action.damage;
      // Session 47: Elemental Affinity bonus for auto-hit spells.
      const dmg = rollDamage(cantripDmgExpr, false) + elementalAffinityBonus(attacker, action.damageType);
      const dealt = applyDamageWithTempHP(target, dmg, action.damageType);
      // TG-008: Absorb Elements / Hellish Rebuke reaction trigger.
      // (Shield's "blocks Magic Missile" is NOT modelled in v1 — the auto-hit
      //  branch bypasses the hit decision where Shield fires. Future work.)
      if (dealt > 0 && !target.isDead && !target.isUnconscious) {
        triggerReactions(state, target, {
          kind: 'incoming_damage',
          attacker,
          target,
          amount: dealt,
          damageType: action.damageType,
          action,
        });
      }
      if (target.concentration?.active && dealt > 0) {
        const maintained = rollConcentrationSave(target, dealt);
        if (!maintained) {
          removeEffectsFromCaster(target.id, state.battlefield);
          processFallDamage(state);
          log(state, 'condition_remove', target.id,
            `${target.name} loses concentration!`, undefined);
        }
      }
      log(state, 'damage', attacker.id,
        `${attacker.name} auto-hits ${target.name} for ${dealt} ${action.damageType ?? ''} damage`,
        target.id, dealt);
      if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id);
      applyWardingBondRedirect(target, dealt, state);
      // Phase 7 batch 2 (Session 99): Lich/Illithilich Warding Bond tether.
      applyLairWardingBondTetherRedirect(target, dealt, state);
      // Phase 8 batch 3 (Session 102): Demogorgon::1 illusory duplicate redirect.
      applyLairIllusoryDuplicateRedirect(target, dealt, state);
      checkDeath(target, state, attacker);
    }
    return;
  }

  // Standard attack roll — include Pack Tactics advantage, Prone modifier, and Help action
  // ── RFC-VISION-AUDIO Phase 3 Q4: pass Battlefield for detection-map ──
  const advState = resolveAttackAdvantage(attacker, target, action.attackType, state.battlefield);
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
  // Taunt (Antagonize EGtW p.150): a taunted creature has disadvantage on
  // attack rolls against creatures OTHER THAN the taunt caster. The taunt
  // effect is on the ATTACKER (not the target). If the attacker has an active
  // taunt and the target is not the taunt caster, apply disadvantage.
  const tauntCasterId = getActiveTaunt(attacker);
  const tauntDisadvantage = !!tauntCasterId && target.id !== tauntCasterId;
  if (tauntDisadvantage) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Disadvantage (Taunted — must attack the taunt caster).`, target.id);
  }
  // Bestow Curse — opt.1 (PHB p.214): the cursed creature has disadvantage
  // on attack rolls against the curse caster. Mirror of taunt (taunt = disadv
  // vs non-caster; curse_attack_disadv = disadv vs specific caster). The
  // effect is on the ATTACKER; if the target's ID is in the list of curse-
  // caster IDs, the attack has disadvantage.
  const curseAttackDisadvIds = getActiveCurseAttackDisadv(attacker);
  const curseAttackDisadv = curseAttackDisadvIds.includes(target.id);
  if (curseAttackDisadv) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks ${target.name} with Disadvantage (Bestow Curse — disadvantaged vs curse caster).`, target.id);
  }
  // Session 53 Batch 4e: Sunlight Sensitivity — disadvantage on attack rolls
  // while in sunlight. Only fires when `battlefield.lightLevel === 'daylight'`
  // (engine default is 'indoors' so the penalty never fires unless the
  // scenario explicitly sets daylight).
  const sunlightDisadv = attacker.sunlightSensitivity === true
    && state.battlefield.lightLevel === 'daylight';
  if (sunlightDisadv) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks with Disadvantage (Sunlight Sensitivity).`, target.id);
  }
  const disadvantage = baseDisadv || !!protectionRider || losDisadvantage || chillTouchDisadv || viciousMockeryDisadv || frostbiteDisadv || tauntDisadvantage || curseAttackDisadv || sunlightDisadv
    || attacker.exhaustionLevel >= 3;  // Exhaustion level 3: disadvantage on attack rolls (PHB p.291)
  // ── Session 60: Ambusher trait (MM p.11) ──
  // "In the first round of combat, the [creature] has advantage on attack rolls
  // against any creature that hasn't taken a turn yet." The _hasTakenTurn flag
  // is set at the end of each creature's turn in runCombat. In round 1, any
  // creature that hasn't gone yet has _hasTakenTurn = false (undefined).
  const ambusherAdv = attacker.ambusher === true
    && state.battlefield.round === 1
    && !target._hasTakenTurn;
  if (ambusherAdv) {
    log(state, 'action', attacker.id,
      `${attacker.name} attacks with Advantage (Ambusher — ${target.name} hasn't taken a turn yet).`, target.id);
  }
  const advantage = baseAdv || packTacticsAdvantage || attacker.helpedThisTurn || cantripAdv || trueStrikeAdv || ambusherAdv;

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

  // ── Session 45 Task #29-follow-up: Champion crit range expansion ──
  // PHB p.72: Fighter Champion "Improved Critical" → crit on 19-20 (level 3+).
  // PHB p.72: Fighter Champion "Superior Critical" → crit on 18-20 (level 15+).
  // These apply ONLY to weapon attacks (melee/ranged), NOT spell attacks
  // (Improved Critical specifies "weapon attacks"). The caller of rollAttack
  // for spell attacks leaves critRange at its default (20).
  let critRange = 20;
  if (action.attackType === 'melee' || action.attackType === 'ranged') {
    if (hasFeature(attacker, 'Superior Critical')) {
      critRange = 18;
    } else if (hasFeature(attacker, 'Improved Critical')) {
      critRange = 19;
    }
  }

  const result = rollAttack(shillelaghHitBonus, advantage, disadvantage, critRange);

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

  // Bane die — -1d4 to attack rolls when baned (PHB p.219) — Session 27 Batch 3
  const baneSides = getActiveBaneDie(attacker);
  if (baneSides > 0) {
    const banePenalty = rollDie(baneSides);
    result.total -= banePenalty;
    log(state, 'action', attacker.id,
      `${attacker.name} rolls Bane die (-${banePenalty})!`, target.id, -banePenalty);
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
  // ── Session 45 Task #29-follow-up: a critical hit is ALWAYS a hit ──
  // PHB p.194: "If the d20 roll for an attack is a 20, the attack hits
  // regardless of any modifiers or the target's AC." Expanded crit ranges
  // (Champion Improved Critical = 19-20, Superior Critical = 18-20) extend
  // this auto-hit property to the expanded crit range — a critical hit is
  // by definition a hit. The attackHits() helper only knows about nat 20,
  // so we short-circuit here when result.isCrit is true (set by rollAttack
  // using the attacker's critRange).
  let hits = isCritOverride ?? (result.isCrit || attackHits(result.roll, result.total, effectiveAC));

  // ── TG-008: Shield / Silvery Barbs reaction trigger (PHB p.275 / SCC p.38) ──
  // When the attack HITS, the target may react with Shield (+5 AC, can flip
  // the hit to a miss "including against the triggering attack" — PHB p.275)
  // or Silvery Barbs (force a reroll, use the lower — SCC p.38). Both return
  // `{ kind: 'negated' }` if they flip the hit to a miss; the engine then
  // re-evaluates `hits` with the new AC / lower roll.
  //
  // The trigger fires BEFORE the Mirror Image duplicate resolution and the
  // miss-return, so a Shield that flips the hit to a miss skips both. Mirror
  // Image retargeting is excluded (Shield only protects the real caster, not
  // duplicates — PHB p.260: duplicates "ignore all other damage and effects").
  if (hits && !mirrorRetargeted && !target.isDead && !target.isUnconscious) {
    const isCrit = isCritOverride === true || result.isCrit;
    const outcome = triggerReactions(state, target, {
      kind: 'incoming_attack_hit',
      attacker,
      action,
      attackRoll: result.roll,
      attackTotal: result.total,
      effectiveAC,
      isCrit,
    });
    if (outcome && outcome.kind === 'negated') {
      // Shield may have applied +5 AC; Silvery Barbs may have computed a
      // lower roll. The spell module already logged the details — we just
      // need to flip the hit to a miss.
      //
      // For Shield: the +5 AC effect is now active (applied by executeReaction
      // via applySpellEffect), so getActiveAcBonus(target) would return +5
      // more if we re-read it. We don't need to recompute — the spell module
      // already gated on "the +5 WILL flip the hit to a miss" in shouldCastReaction.
      //
      // For Silvery Barbs: the spell module rolled a new d20 and checked if
      // the lower of (original, new) would miss. If it reported 'negated',
      // the lower roll missed.
      //
      // v1: trust the spell module's outcome. If it says 'negated', flip the
      // hit to a miss.
      hits = false;
      log(state, 'action', target.id,
        `${target.name}'s reaction NEGATES ${attacker.name}'s ${action.name}! (original ${result.total} vs AC ${effectiveAC})`,
        attacker.id);
    }
  }

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
    // ── RFC-UPCASTING Phase 6: Cantrip damage scaling (PHB p.201) ──
    // Cantrips (slotLevel === 0) scale damage dice at caster levels 5/11/17.
    // Exception: some cantrips have flat damage (noCantripScaling=true).
    // Handle both new (count/sides) and legacy (dieCount/dieSides) formats.
    const _ctTier3 = cantripTier(attacker);
    const cantripDmgExpr = action.slotLevel === 0 && !action.noCantripScaling
      ? { ...action.damage, count: 1 + _ctTier3, dieCount: 1 + _ctTier3 }
      : action.damage;
    let dmg = rollDamage(cantripDmgExpr, isCrit);

    // ── Session 47 Task #29-follow-up-5: Elemental Affinity (Draconic Sorcerer 6) ──
    // PHB p.102: add CHA mod to damage of spells matching draconic ancestry.
    // Applies to spell attacks (this path). Also wired in the save-spell and
    // auto-hit paths above. The bonus is flat (NOT dice, so NOT doubled on crit).
    const eaBonus = elementalAffinityBonus(attacker, action.damageType);
    if (eaBonus > 0) {
      dmg += eaBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds Elemental Affinity bonus (+${eaBonus} ${action.damageType}) to ${target.name}!`,
        target.id, eaBonus);
    }

    // ── Session 39: Eldritch Invocation — Agonizing Blast ──
    // PHB p.110: "When you cast Eldritch Blast, add your Charisma modifier
    // to the damage it deals on a hit." Pre-damage hook fired AFTER the
    // base roll, BEFORE other riders. The bonus is flat (NOT dice, so NOT
    // doubled on crit per PHB p.196). The hook checks the attacker's
    // eldritchInvocations list; no-op if Agonizing Blast isn't known.
    if (action.name === 'Eldritch Blast') {
      const invDmg = fireEldritchBlastDamageInvocations(attacker, target);
      if (invDmg > 0) {
        dmg += invDmg;
        log(state, 'action', attacker.id,
          `${attacker.name} adds Agonizing Blast bonus (+${invDmg} force) to ${target.name}!`,
          target.id, invDmg);
      }
    }

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
    // PHB p.96: ally must be within 5 ft of the target (adjacent = Chebyshev 3D ≤ 1)
    const allyAdjToTarget = [...bf.combatants.values()].some(c =>
      c.faction === attacker.faction && c.id !== attacker.id && !c.isDead &&
      Math.max(Math.abs(c.pos.x - target.pos.x), Math.abs(c.pos.y - target.pos.y), Math.abs(c.pos.z - target.pos.z)) <= 1
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

    // ── Session 27 — Batch 3 smite spells (generic next-hit rider) ──────
    // One-shot bonus damage (+ optional condition) on the caster's next
    // weapon hit. Set by each smite's execute(); consumed here. Crit doubles
    // the dice (PHB p.196). If `condition` is set, it's applied to the target
    // hit (sourceIsConcentration: true — ends if the smite's conc breaks).
    // Guard: if concentration broke (caster cast another conc spell), the
    // rider is stale — clear without applying.
    if (attacker._nextHitRider && (action.attackType === 'melee' || action.attackType === 'ranged')) {
      const rider = attacker._nextHitRider;
      if (!attacker.concentration?.active || attacker.concentration.spellName !== rider.spellName) {
        attacker._nextHitRider = null;   // stale — concentration broke
      } else {
        let dice = isCrit ? rider.count * 2 : rider.count;
        let riderBonus = 0;
        for (let i = 0; i < dice; i++) riderBonus += rollDie(rider.dieSides);
        dmg += riderBonus;
        log(state, 'action', attacker.id,
          `${attacker.name} adds ${rider.spellName} bonus (+${riderBonus} ${rider.damageType}${isCrit ? ' CRIT' : ''})!`, target.id, riderBonus);
        // ── TG-027: Elemental Affinity (Draconic Sorcerer 6) on smite-spell
        // riders. PHB p.102: "When you cast a spell that deals damage of the
        // type associated with your draconic ancestry, you can add your
        // Charisma modifier to that damage." Searing Smite / Lightning Arrow /
        // Blinding Smite etc. are spells whose rider damage IS spell damage
        // of a type (fire/lightning/radiant). The +CHA mod is flat (NOT dice,
        // so NOT doubled on crit per PHB p.196). Wired at all 3 weapon-rider
        // sites (this _nextHitRider site, the weapon_enchant dice site, and
        // the Flame Blade site below) for consistency with the main spell-
        // attack EA wiring at line ~1796.
        const riderEA = elementalAffinityBonus(attacker, rider.damageType);
        if (riderEA > 0) {
          dmg += riderEA;
          log(state, 'action', attacker.id,
            `${attacker.name} adds Elemental Affinity bonus (+${riderEA} ${rider.damageType}) to ${rider.spellName} rider!`, target.id, riderEA);
        }
        if (rider.condition && !target.conditions.has(rider.condition)) {
          applySpellEffect(target, {
            casterId: attacker.id, spellName: rider.spellName,
            effectType: 'condition_apply', payload: { condition: rider.condition },
            sourceIsConcentration: true,
          });
          log(state, 'condition_add', attacker.id,
            `${target.name} is ${rider.condition.toUpperCase()} by ${rider.spellName}!`, target.id);
        }
        // PHB p.282: Thunderous Smite pushes the target 10 ft away if Large or
        // smaller. v1 ignores the size restriction and pushes any target on hit.
        // The pushFt field is optional — only Thunderous Smite sets it currently.
        if (rider.pushFt && rider.pushFt > 0) {
          const oldPos: Vec3 = { ...target.pos };
          pushAway(target, attacker.pos, rider.pushFt);
          log(state, 'move', attacker.id,
            `${target.name} is pushed ${rider.pushFt} ft away by ${rider.spellName} (${oldPos.x},${oldPos.y}) → (${target.pos.x},${target.pos.y})`,
            target.id);
        }
        attacker._nextHitRider = null;   // one-shot consumed
      }
    }

    // Hex damage: +1d6 necrotic when the warlock who hexed the target hits it (PHB p.251)
    const hexDie = getActiveHexDie(target, attacker.id);
    if (hexDie > 0) {
      const hexRoll = rollDie(hexDie);
      dmg += hexRoll;
      log(state, 'action', attacker.id,
        `${attacker.name} deals Hex bonus (+${hexRoll} necrotic) to ${target.name}`, target.id, hexRoll);
    }

    // Bestow Curse — opt.4 (PHB p.214): each time the cursed target makes an
    // attack roll or spell attack against the curse caster, the CURSED TARGET
    // takes 1d8 necrotic damage. This is self-damage to the attacker.
    const curseRider = getActiveCurseRider(attacker, target.id);
    if (curseRider) {
      let riderDmg = 0;
      const dice = isCrit ? curseRider.count * 2 : curseRider.count;
      for (let i = 0; i < dice; i++) riderDmg += rollDie(curseRider.die);
      // Apply necrotic damage to the ATTACKER (the cursed creature)
      applyDamageWithTempHP(attacker, riderDmg, curseRider.damageType);
      log(state, 'action', attacker.id,
        `${attacker.name} takes ${riderDmg} ${curseRider.damageType} from Bestow Curse rider (attacking the curse caster)!`, attacker.id, riderDmg);
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

    // ── Session 27 — weapon_enchant damage DICE (Batch 3) ───────────────
    // Extra damage die on weapon attacks (Divine Favor +1d4 radiant, Holy
    // Weapon +5d8 radiant, Elemental Weapon +1d4 fire, Flame Arrows +1d6 fire,
    // Shadow Blade +2d8 psychic). Crit doubles the dice (PHB p.196).
    if (weaponEnchant.damageDie > 0 && weaponEnchant.damageDieCount > 0 && (action.attackType === 'melee' || action.attackType === 'ranged')) {
      let dice = isCrit ? weaponEnchant.damageDieCount * 2 : weaponEnchant.damageDieCount;
      let dieBonus = 0;
      for (let i = 0; i < dice; i++) dieBonus += rollDie(weaponEnchant.damageDie);
      dmg += dieBonus;
      log(state, 'action', attacker.id,
        `${attacker.name} adds weapon enchant die (+${dieBonus} ${weaponEnchant.damageDieType ?? ''}${isCrit ? ' CRIT' : ''})!`, target.id, dieBonus);
      // ── TG-027: Elemental Affinity (Draconic Sorcerer 6) on weapon_enchant
      // damage dice. Elemental Weapon / Flame Arrows / Holy Weapon / Divine
      // Favor / Shadow Blade are all spells whose bonus-damage die IS spell
      // damage of a type. +CHA mod is flat (NOT doubled on crit per PHB p.196).
      const enchEA = elementalAffinityBonus(attacker, weaponEnchant.damageDieType);
      if (enchEA > 0) {
        dmg += enchEA;
        log(state, 'action', attacker.id,
          `${attacker.name} adds Elemental Affinity bonus (+${enchEA} ${weaponEnchant.damageDieType}) to weapon enchant die!`, target.id, enchEA);
      }
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
      // ── TG-027: Elemental Affinity (Draconic Sorcerer 6) on Flame Blade
      // rider. Flame Blade IS a spell (PHB p.242 evocation) whose +3d6 fire
      // IS spell damage of the fire type. A red/gold/brass Draconic Sorcerer
      // 6 adds +CHA mod. Flat bonus (NOT doubled on crit per PHB p.196).
      const flameEA = elementalAffinityBonus(attacker, 'fire');
      if (flameEA > 0) {
        dmg += flameEA;
        log(state, 'action', attacker.id,
          `${attacker.name} adds Elemental Affinity bonus (+${flameEA} fire) to Flame Blade rider!`, target.id, flameEA);
      }
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

    // TG-008: Absorb Elements rider consumption (XGE p.150).
    // "The first time you hit with a melee attack on your next turn, the
    // target takes an additional 1d6 damage of the triggering type."
    // v1: applies on ANY melee weapon hit (not just the caster's next turn).
    // The rider is one-shot — consumed on the first melee hit.
    if (attacker._absorbElementsRider && action.attackType === 'melee') {
      const rider = consumeAbsorbElementsRider(attacker);
      if (rider && rider.damage > 0) {
        dmg += rider.damage;
        log(state, 'action', attacker.id,
          `${attacker.name}'s Absorb Elements rider deals +${rider.damage} ${rider.damageType} damage!`,
          target.id, rider.damage);
      }
    }

    const dealt = applyDamageWithTempHP(target, dmg, action.damageType);

    // ── Session 53 Batch 4g: Charge / Pounce movement-triggered rider ──
    // Fires when the attacker moved ≥ minMoveFt toward the target this turn
    // (measured as: Chebyshev distance at turn start - Chebyshev distance now
    // ≥ minMoveFt, in feet). v1 simplification: "straight toward" = net
    // movement toward target (not literal straight-line path).
    if ((attacker.charge || attacker.pounce) && attacker._turnStartPos) {
      const distBefore = chebyshev3D(attacker._turnStartPos, target.pos) * 5;
      const distAfter = chebyshev3D(attacker.pos, target.pos) * 5;
      const movedToward = distBefore - distAfter;

      // Charge rider: extra damage + STR save vs push/prone
      if (attacker.charge && movedToward >= attacker.charge.minMoveFt) {
        const chargeDmg = rollDice(attacker.charge.damage);
        const chargeDealt = applyDamageWithTempHP(target, chargeDmg, attacker.charge.damageType);
        log(state, 'damage', attacker.id,
          `${attacker.name}'s Charge deals +${chargeDealt} ${attacker.charge.damageType} damage to ${target.name}!`,
          target.id, chargeDealt);
        // STR save vs push/prone (only if the Charge variant has a save DC;
        // some variants like Centaur only deal extra damage, no save)
        if (attacker.charge.saveDC > 0) {
          const save = rollSave(target, 'str', attacker.charge.saveDC);
          if (!save.success) {
            if (attacker.charge.pushFt && attacker.charge.pushFt > 0) {
              const dx = Math.sign(target.pos.x - attacker.pos.x);
              const dy = Math.sign(target.pos.y - attacker.pos.y);
              const pushSquares = Math.floor(attacker.charge.pushFt / 5);
              target.pos.x = Math.max(0, Math.min(bf.width - 1, target.pos.x + dx * pushSquares));
              target.pos.y = Math.max(0, Math.min(bf.height - 1, target.pos.y + dy * pushSquares));
              log(state, 'action', attacker.id,
                `${target.name} is pushed ${attacker.charge.pushFt} ft away by ${attacker.name}'s Charge!`,
                target.id);
            }
            if (attacker.charge.knockProne) {
              addCondition(target, 'prone');
              log(state, 'condition_add', attacker.id,
                `${target.name} is knocked prone by ${attacker.name}'s Charge!`,
                target.id);
            }
          } else {
            log(state, 'save_success', target.id,
              `${target.name} resists ${attacker.name}'s Charge push/prone (STR save ${save.total} vs DC ${attacker.charge.saveDC}).`,
              target.id, save.roll);
          }
        }
      }

      // Pounce rider: STR save vs prone (no damage)
      if (attacker.pounce && movedToward >= attacker.pounce.minMoveFt) {
        const save = rollSave(target, 'str', attacker.pounce.saveDC);
        if (!save.success) {
          addCondition(target, 'prone');
          log(state, 'condition_add', attacker.id,
            `${target.name} is knocked prone by ${attacker.name}'s Pounce!`,
            target.id);
          // v1 simplification: the bonus-action attack against a prone target
          // is NOT modelled (would need planner integration to queue a bonus
          // action). The prone condition is the main mechanical effect.
        } else {
          log(state, 'save_success', target.id,
            `${target.name} resists ${attacker.name}'s Pounce (STR save ${save.total} vs DC ${attacker.pounce.saveDC}).`,
            target.id, save.roll);
        }
      }
    }

    // TG-008: Absorb Elements / Hellish Rebuke reaction trigger (XGE p.150 / PHB p.249)
    // These fire AFTER damage is applied. The triggering damage still applies
    // (resistance from Absorb Elements protects against FUTURE damage of
    // that type, not the triggering hit — PHB timing).
    if (dealt > 0 && !target.isDead && !target.isUnconscious) {
      triggerReactions(state, target, {
        kind: 'incoming_damage',
        attacker,
        target,
        amount: dealt,
        damageType: action.damageType,
        action,
      });
    }
    if (target.concentration?.active && dealt > 0) {
      const maintained = rollConcentrationSave(target, dealt);
      if (!maintained) {
        removeEffectsFromCaster(target.id, state.battlefield);
        processFallDamage(state);
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
    // ── Session 38: Eldritch Invocation — Repelling Blast ──
    // PHB p.111: "When you hit a creature with Eldritch Blast, you can push
    // the creature up to 10 feet away from you in a straight line." Fires
    // AFTER damage is dealt, BEFORE checkDeath (so even a target about to
    // drop to 0 HP gets pushed — the push triggers on hit, not on kill).
    // The hook internally checks the attacker's eldritchInvocations list;
    // it's a no-op if the attacker doesn't have Repelling Blast.
    if (action.name === 'Eldritch Blast') {
      fireEldritchBlastHitInvocations(attacker, target, state);
    }
    applyWardingBondRedirect(target, dealt, state);
    // Phase 7 batch 2 (Session 99): Lich/Illithilich Warding Bond tether.
    applyLairWardingBondTetherRedirect(target, dealt, state);
    // Phase 8 batch 3 (Session 102): Demogorgon::1 illusory duplicate redirect.
    applyLairIllusoryDuplicateRedirect(target, dealt, state);
    checkDeath(target, state);
  }

  // ── PHB p.254: "The spell ends for a target that attacks or casts a spell."
  // Session 32: Invisibility ends on attack. Check the ATTACKER's activeEffects
  // for any effect with breaksOnAttackOrCast=true and remove it AFTER the attack
  // resolves (so the attack still gets invisible-advantage, but the invisibility
  // ends immediately after). Greater Invisibility does NOT set this flag.
  //
  // We only break on attacks that involve an attack roll (melee/ranged/spell).
  // Save-based spells (e.g., Sacred Flame) don't trigger the ends-on-attack
  // clause per PHB p.254 ("attacks or casts a spell" — the "casts a spell" half
  // is handled separately in the spell-casting path).
  if (action.attackType === 'melee' || action.attackType === 'ranged' || action.attackType === 'spell') {
    breakInvisibilityOnAction(attacker, state);
  }
}

/**
 * Remove any active effects on the combatant that have `breaksOnAttackOrCast: true`.
 * Called from resolveAttack (for attacks) and executePlannedAction (for spell casts).
 *
 * PHB p.254 Invisibility: "The spell ends for a target that attacks or casts a spell."
 * This implements the "attacks" half; the "casts a spell" half is handled by calling
 * this function from the spell-casting path.
 *
 * Logs a condition_remove event for each effect removed.
 */
function breakInvisibilityOnAction(actor: Combatant, state: EngineState): void {
  const breakingEffects = actor.activeEffects.filter(e => e.breaksOnAttackOrCast === true);
  if (breakingEffects.length === 0) return;

  for (const effect of breakingEffects) {
    // Remove the effect's mechanical impact (condition, adv/disadv entries, etc.)
    // via removeEffectById, which calls _undoEffect internally.
    removeEffectById(actor.id, effect.id, state.battlefield);
    log(state, 'condition_remove', actor.id,
      `${actor.name}'s ${effect.spellName} ends (${actor.name} attacked or cast a spell)!`,
      actor.id);
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
  // Also handle concentration auto-broken by addCondition('incapacitated')
  // (which nulls concentration and sets _concentrationAutoBroken flag).
  const autoBroken = (target as Record<string, unknown>)._concentrationAutoBroken;
  if (target.concentration?.active) {
    const spellName = target.concentration.spellName ?? 'spell';
    removeEffectsFromCaster(target.id, state.battlefield);
    processFallDamage(state);
    target.concentration = null;
    log(state, 'condition_remove', target.id,
      `${target.name}'s concentration on ${spellName} breaks!`, undefined);
  }
  // ── RFC-COMBINING-EFFECTS Phase 4: auto-broken concentration cleanup ──
  // If addCondition('incapacitated') auto-broke concentration (because the
  // target dropped to 0 HP), addCondition nulled concentration but couldn't
  // call removeEffectsFromCaster (no Battlefield access). The _concentrationAutoBroken
  // flag stores the spell name. We clean up the effects here.
  if (autoBroken) {
    const spellName = typeof autoBroken === 'string' ? autoBroken : 'spell';
    removeEffectsFromCaster(target.id, state.battlefield);
    processFallDamage(state);
    log(state, 'condition_remove', target.id,
      `${target.name}'s concentration on ${spellName} breaks!`, undefined);
    delete (target as Record<string, unknown>)._concentrationAutoBroken;
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

  // ── Session 53 Creature Megabatch Batch 4d: Death Burst ──
  // MM p.215 (Mephits/Magmin), MM p.138 (Gas Spore), BGG hulks, EGW Frost
  // Worm, GGR Galvanice Weird, ~27 creatures total across pre-2024 sources.
  // The trait fires when the creature drops to 0 HP — applies AoE damage +
  // conditions to all combatants in radius (including allies).
  if (target.deathBurst) {
    triggerDeathBurst(target, state);
  }

  // ── Session 61 RFC-SHAPECHANGER Phase 1: revert to true form on death ──
  // Per the trait text: "It reverts to its true form if it dies." The
  // mechanical effect is negligible (creature is dead), but we log it for
  // clarity + reset _currentForm for any post-combat inspection.
  if (target.shapechangerForms) {
    revertShapechangeOnDeath(target, state);
  }
}

/**
 * Session 53 Batch 4d: Fire a creature's Death Burst AoE.
 *
 * Applies damage (with save-for-half if halfOnSuccess) + conditions (on
 * failed save) to all non-dead combatants within `radius` feet of the
 * bursting creature. v1 simplification: hits ALL factions (allies too);
 * the bursting creature itself is already at 0 HP so it's skipped.
 *
 * Exported for direct testing — see src/test/creature_death_burst.test.ts.
 *
 * @param burster  The dying creature with `deathBurst` populated.
 * @param state    Current engine state (for damage application + logging).
 */
export function triggerDeathBurst(burster: Combatant, state: EngineState): void {
  const burst = burster.deathBurst!;
  const bf = state.battlefield;
  log(state, 'action', burster.id,
    `${burster.name} explodes in a Death Burst! (${burst.radius} ft radius, DC ${burst.saveDC} ${burst.saveAbility.toUpperCase()})`,
    undefined, 0);

  for (const c of bf.combatants.values()) {
    if (c.id === burster.id) continue;       // self — already dying
    if (c.isDead) continue;                   // already dead — skip
    const distFt = chebyshev3D(burster.pos, c.pos) * 5;
    if (distFt > burst.radius) continue;      // out of range

    // Save
    const save = rollSave(c, burst.saveAbility, burst.saveDC);
    const failed = !save.success;

    // Damage (if any)
    if (burst.damage) {
      let dmg = rollDice(burst.damage);
      if (burst.halfOnSuccess && !failed) {
        dmg = Math.floor(dmg / 2);
      }
      if (dmg > 0) {
        const dealt = applyDamageWithTempHP(c, dmg, burst.damageType);
        log(state, 'damage', burster.id,
          `${c.name} ${failed ? 'fails' : 'succeeds'} the ${burst.saveAbility.toUpperCase()} save and takes ${dealt} ${burst.damageType} damage from ${burster.name}'s Death Burst.`,
          c.id, dealt);
        // Recursively check death (the burst may kill a creature, which could
        // trigger ITS death burst — chain reaction). Guard against infinite
        // recursion via the isDead flag (checkDeath is a no-op at >0 HP).
        if (c.currentHP <= 0 && !c.isDead) {
          checkDeath(c, state, burster);
        }
      }
    }

    // Conditions (on failed save)
    if (failed && burst.conditions) {
      for (const cond of burst.conditions) {
        addCondition(c, cond as any);
        log(state, 'condition_add', burster.id,
          `${c.name} is ${cond} by ${burster.name}'s Death Burst.`,
          c.id, 0);
      }
    }
  }
}

// ---- Reverse Gravity fall-damage processing -------------------

/**
 * After removeEffectsFromCaster is called, check all combatants for
 * _fallHeight > 0. If a combatant has _fallHeight set but no longer
 * has an active 'Reverse Gravity' effect, they fall back down and take
 * fall damage (PHB p.183: 1d6 per 10 ft, max 20d6).
 *
 * This must be called after EVERY removeEffectsFromCaster invocation
 * so that Reverse Gravity fall damage is applied whenever concentration
 * breaks — regardless of the cause (con save fail, caster death, new
 * concentration replacing old, dispel, etc.).
 *
 * @param state  Current EngineState (for damage application, logging, death checks)
 */
function processFallDamage(state: EngineState): void {
  const bf = state.battlefield;

  // ── TG-008: Feather Fall reaction trigger (PHB p.239) ──────────────
  // Before applying fall damage, gather all fallers and check if any
  // creature wants to cast Feather Fall. The trigger fires once for ALL
  // fallers (Feather Fall can affect up to 5). If the reaction fires and
  // negates, affected fallers are marked with `_featherFallActive = true`
  // and skipped in the damage loop below.
  const fallerIds: string[] = [];
  let maxFallHeight = 0;
  for (const c of bf.combatants.values()) {
    if (!c._fallHeight || c._fallHeight <= 0) continue;
    if (c.isDead) { delete c._fallHeight; continue; }
    // Check if the Reverse Gravity effect is still active on this target.
    const hasRGEffect = c.activeEffects.some(e => e.spellName === 'Reverse Gravity');
    if (hasRGEffect) continue;
    fallerIds.push(c.id);
    if (c._fallHeight > maxFallHeight) maxFallHeight = c._fallHeight;
  }
  if (fallerIds.length > 0 && maxFallHeight > 0) {
    // Find a candidate Feather Fall caster: any creature (typically an
    // ally of the fallers) with Feather Fall known, slot available,
    // reaction unused. The triggerReactions helper iterates the registry
    // and fires the first matching spell.
    //
    // v1: iterate all combatants (allies of the fallers first, since
    // they'd want to save them). The first one whose shouldCast returns
    // true fires. PHB p.239: "you or a creature within 60 feet of you
    // falls" — the caster can be a faller themselves (self-cast).
    const fallerSet = new Set(fallerIds);
    // Sort candidates: fallers first (they'd want to save themselves),
    // then non-fallers (allies who'd save the fallers).
    const candidates = [...bf.combatants.values()].sort((a, b) => {
      const aFaller = fallerSet.has(a.id) ? 0 : 1;
      const bFaller = fallerSet.has(b.id) ? 0 : 1;
      return aFaller - bFaller;
    });
    for (const candidate of candidates) {
      const outcome = triggerReactions(state, candidate, {
        kind: 'falling',
        fallerIds,
        fallHeightFt: maxFallHeight,
      });
      if (outcome && outcome.kind === 'negated') {
        // Feather Fall fired — affected fallers are now marked with
        // `_featherFallActive = true`. The damage loop below will skip them.
        break;  // Only one Feather Fall needed.
      }
      // If outcome is null, this candidate didn't cast Feather Fall —
      // continue to the next candidate.
    }
  }

  for (const c of bf.combatants.values()) {
    if (!c._fallHeight || c._fallHeight <= 0) continue;
    if (c.isDead) { delete c._fallHeight; continue; }

    // Check if the Reverse Gravity effect is still active on this target.
    // If it is, concentration hasn't broken for this target yet — skip.
    const hasRGEffect = c.activeEffects.some(e => e.spellName === 'Reverse Gravity');
    if (hasRGEffect) continue;

    // TG-008: Feather Fall check — if this faller was affected by Feather
    // Fall (marked by executeFeatherFall), skip the fall damage entirely.
    if ((c as any)._featherFallActive) {
      log(state, 'action', c.id,
        `${c.name} falls ${c._fallHeight} ft but Feather Fall negates all damage — lands safely!`,
        c.id, 0);
      delete (c as any)._featherFallActive;
      delete c._fallHeight;
      continue;
    }

    // Fall damage! PHB p.183: 1d6 per 10 feet fallen, max 20d6.
    const fallHeight = c._fallHeight;
    const diceCount = Math.min(Math.floor(fallHeight / 10), 20); // cap at 20d6 (200 ft)
    let fallDmg = 0;
    for (let i = 0; i < diceCount; i++) fallDmg += rollDie(6);

    // Apply via applyDamageWithTempHP so temp HP, resistance, and
    // Warding Bond redirect are all handled correctly.
    const dealt = applyDamageWithTempHP(c, fallDmg, 'bludgeoning');

    log(state, 'damage', c.id,
      `${c.name} falls ${fallHeight} ft and takes ${dealt} bludgeoning damage! (Reverse Gravity ended)`,
      c.id, dealt);

    // Warding Bond redirect (if the falling creature has a bonded protector)
    applyWardingBondRedirect(c, dealt, state);
    // Phase 7 batch 2 (Session 99): Lich/Illithilich Warding Bond tether.
    applyLairWardingBondTetherRedirect(c, dealt, state);

    // Death check (the fall may have killed the creature)
    checkDeath(c, state);

    // Clear the scratch field
    delete c._fallHeight;
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

  // ── Session 48 Task #29-follow-up-3b: Land's Stride (Land Druid 6) ──
  // PHB p.68: "moving through nonmagical difficult terrain costs you no
  // extra movement." When the mover has Land's Stride, wrap the terrainFn
  // to treat 'difficult' as 'normal' (no extra cost). 'water' terrain is
  // NOT affected (Land's Stride is about difficult terrain and plants,
  // not swimming). v1 simplification: all difficult terrain is treated
  // as nonmagical (no magical-difficult-terrain tracking).
  const baseTerrainFn = makeTerrainFn(bf);
  const hasLandsStride = hasFeature(mover, "Land's Stride");
  const effectiveTerrainFn = hasLandsStride
    ? (pos: Vec3) => {
        const t = baseTerrainFn(pos);
        return t === 'difficult' ? 'normal' : t;  // ignore difficult terrain
      }
    : baseTerrainFn;

  const cost = estimateMoveCostFt(
    mover.pos, dest,
    mover.burrowSpeed !== null,
    mover.swimSpeed !== null,
    effectiveTerrainFn
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

  // ── Movement riders (Session 48 RFC-001) ────────────────────────────────
  // If the mover has any 'movement_rider' ActiveEffect and just moved
  // WILLINGLY 5+ ft (executeMove is only called for willing movement —
  // forced movement like Thorn Whip pull / Thunderwave push / grapple drag
  // modifies `pos` directly without calling executeMove), fire each rider,
  // apply the damage, and clear it.
  //
  // Current rider: Booming Blade (TCE p.106) — thunder damage when the
  // sheathed target willingly moves. Architecture is generic so any future
  // movement-triggered spell can push a 'movement_rider' effect and fire here.
  //
  // PHB p.196 / TCE p.106: "If the target willingly moves 5 feet or more
  // before then [the start of the caster's next turn], the target takes
  // 1d8 thunder damage, and the spell ends." The cost ≥5 ft check excludes
  // the no-op case where dest === fromPos (already-there early return above).
  if (cost >= 5) {
    const movementRiders = mover.activeEffects.filter(e => e.effectType === 'movement_rider');
    for (const rider of movementRiders) {
      const dice = rider.payload.moveDamageDice ?? '1d8';
      const dmgType = rider.payload.moveDamageType ?? 'thunder';
      const casterLabel = bf.combatants.get(rider.casterId)?.name ?? rider.spellName;
      const dmg = rollDiceString(dice);
      const dealt = applyDamageWithTempHP(mover, dmg, dmgType);
      log(state, 'damage', mover.id,
        `${casterLabel}'s ${rider.spellName} detonates as ${mover.name} moves willingly — ${dealt} ${dmgType} damage! (rolled ${dmg} on ${dice})`,
        mover.id, dealt);
      // Clear this rider (spell ends, TCE p.106).
      mover.activeEffects = mover.activeEffects.filter(e => e.id !== rider.id);
      // If the mover died from the rider damage, skip the OA loop.
      if (mover.isDead || mover.isUnconscious) return;
    }
  }

  // OA check: did any watcher's melee reach get left?
  if (!isDisengage) {
    for (const [, watcher] of bf.combatants) {
      if (watcher.id === mover.id || watcher.isDead || watcher.isUnconscious) continue;
      if (watcher.faction === mover.faction) continue;
      if (!opportunityAttackTriggered(watcher, mover, fromPos, dest, bf)) continue;
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

// ---- Eldritch Blast multi-target retarget helper ------------

/**
 * Session 85: Eldritch Blast multi-target per beam (PHB p.237).
 *
 * PHB p.237: "You can direct the beams at the same target or at different
 * ones. Make a separate attack roll for each beam."
 *
 * When an EB beam kills the primary target, remaining beams should re-target
 * to the next-best living enemy in range instead of being wasted. This helper
 * picks the re-target: the closest living enemy (excluding the just-fallen
 * target) within the action's range, tie-broken by highest maxHP (threat).
 *
 * Uses Chebyshev distance (PHB default grid). Does NOT go through the
 * perception layer — re-targeting is a reflexive "next visible enemy" choice
 * that doesn't require perception state. Mirrors the simplicity of the
 * existing `livingEnemiesOf` filter.
 *
 * @param actor         The EB caster.
 * @param fallenTargetId  The ID of the target that just fell (to exclude).
 * @param action        The Eldritch Blast action (for range lookup).
 * @param bf            The battlefield.
 * @returns The next target, or null if no living enemy is in range.
 */
export function pickNextEldritchBlastTarget(
  actor: Combatant,
  fallenTargetId: string,
  action: Action,
  bf: Battlefield,
): Combatant | null {
  const rangeFt = action.range?.normal ?? 120;  // EB default 120; Eldritch Spear patches to 300
  const enemies = livingEnemiesOf(actor, bf).filter(e => e.id !== fallenTargetId);
  let best: Combatant | null = null;
  let bestDist = Infinity;
  let bestThreat = -1;
  for (const e of enemies) {
    const distFt = chebyshev3D(actor.pos, e.pos) * 5;
    if (distFt > rangeFt) continue;
    // Closest first; tie-break by highest threat (maxHP).
    if (distFt < bestDist || (distFt === bestDist && e.maxHP > bestThreat)) {
      best = e;
      bestDist = distFt;
      bestThreat = e.maxHP;
    }
  }
  return best;
}

// ---- Execute a PlannedAction --------------------------------

/**
 * Execute a single PlannedAction for `actor` against the current battlefield
 * state. This is the per-turn action executor called by `runCombat`'s main
 * loop; it dispatches to the appropriate spell/attack/movement branch via
 * the `switch (plan.type)` statement.
 *
 * Exported (Session 37) so tests can drive a SPECIFIC dispatch path
 * (e.g. `case 'magicMissile':` with a Shield reaction) without needing
 * to set up a full multi-round `runCombat` scenario. The function is
 * otherwise unchanged — it was already the single-turn executor.
 */
export function executePlannedAction(
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

  // ── TG-008: Counterspell reaction trigger (PHB p.228) ──────────────
  // Before executing a spell-cast plan, check if any enemy within 60 ft
  // wants to cast Counterspell. If they do and it succeeds (auto-success
  // for L1-3 spells with a L3 slot, or ability check vs DC 10+level for
  // higher-level spells), the spell is negated — consume the actor's
  // spell slot and return without executing the spell.
  //
  // v1 scope:
  //   - Only LEVELED spells trigger Counterspell (cantrips are excluded —
  //     wasting a L3 slot on a cantrip is a bad trade).
  //   - Only the FIRST eligible enemy (in battlefield iteration order)
  //     attempts Counterspell. Multiple enemies could each try per PHB,
  //     but v1 simplifies to one attempt.
  //   - The actor's spell slot is consumed even if Counterspelled (PHB
  //     p.228: "the spell fails and has no effect, but resources used
  //     to cast it are consumed").
  const spellInfo = getSpellInfoFromPlan(plan, bf);
  if (spellInfo && !actor.isDead && !actor.isUnconscious) {
    let countered = false;
    for (const enemy of livingEnemiesOf(actor, bf)) {
      const outcome = triggerReactions(state, enemy, {
        kind: 'incoming_spell',
        caster: actor,
        spellName: spellInfo.name,
        level: spellInfo.level,
      });
      if (outcome && outcome.kind === 'negated') {
        // Counterspell succeeded — consume the actor's spell slot and abort.
        // PHB p.228: the countered spell's slot IS consumed.
        if (spellInfo.level >= 1) {
          consumeSpellSlot(actor, spellInfo.level);
        }
        actor.budget.actionUsed = true;
        log(state, 'action', actor.id,
          `${actor.name}'s ${spellInfo.name} was COUNTERSPELLED — spell slot consumed, action wasted!`,
          enemy.id);
        countered = true;
        break;  // Only one Counterspell needed to negate.
      }
      // If outcome is 'failed', the Counterspell attempt failed — the spell
      // still goes off. Could another enemy try? v1: no, only one attempt.
      if (outcome && outcome.kind === 'failed') {
        // The enemy's Counterspell failed — log it but continue with the spell.
        // (The spell module already logged the failure.)
        break;  // v1: only one attempt.
      }
      // If outcome is null or 'no_effect', no Counterspell fired — continue
      // to the next enemy.
    }
    if (countered) {
      return;  // Spell was negated — don't execute.
    }
  }

  // ── Session 62 RFC-VISION-AUDIO Phase 1: stealth-break on cast ──
  // Per user answer #3: a hidden creature that casts a spell WITH a verbal
  // component is revealed. This fires AFTER the Counterspell check (a
  // Counterspelled spell doesn't reveal the caster — they never actually
  // cast). The revealOnCast() helper is a no-op if the actor isn't hidden
  // or the spell is silent (e.g. Counterspell itself, Message cantrip).
  if (spellInfo && !actor.isDead && !actor.isUnconscious) {
    revealOnCast(actor, spellInfo.name, state);
  }

  // ── Globe of Invulnerability check (PHB p.245) ────────────────────
  // Spells cast at blockThreshold level or lower have no effect on targets
  // protected by GoI. The slot is still consumed. Cantrips (level 0) are
  // NOT blocked by GoI.
  //
  // v1 scope:
  //   - Only blocks single-target spells entirely (target has GoI).
  //   - AoE exclusion of GoI-protected targets is future work
  //     (globeOfInvulnerabilityAoEV1Simplified: true).
  //   - Only the GoI caster is protected (not 10-ft radius allies — deferred).
  //   - Only blocks spells cast from outside the barrier (actor !== target).
  //     A creature inside their own GoI can cast spells normally.
  //   - Known AoE plan types are excluded from blocking (they hit an area,
  //     not a single target). Full AoE exclusion is future work.
  const AOE_PLAN_TYPES = new Set<string>([
    'fireball', 'lightningBolt', 'burningHands', 'shatter', 'thunderwave',
    'armsOfHadar', 'sleep', 'entangle', 'faerieFire', 'hungerOfHadar',
    'callLightning', 'cloudOfDaggers', 'flamingSphere', 'iceKnife',
    'spiritGuardians', 'guardianOfFaith', 'dawn', 'sunburst', 'tidalWave',
    'darkness', 'fogCloud', 'grease', 'sleetStorm', 'waterySphere',
    'stinkingCloud', 'slow', 'confusion', 'fear', 'hypnoticPattern',
  ]);
  if (spellInfo && spellInfo.level > 0 && plan.targetId && !AOE_PLAN_TYPES.has(plan.type)) {
    const goiTarget = bf.combatants.get(plan.targetId);
    // PHB p.245: only blocks spells cast from outside the barrier.
    // The GoI caster is at the center, so their own spells are NOT blocked.
    // Session 81: pass `actor.id` as casterId so a barrier the caster is
    // INSIDE (their own GoI, or an ally's GoI they stand within) provides no
    // protection — matching "cast from outside the barrier" semantics.
    if (goiTarget && goiTarget.id !== actor.id && isProtectedByGoI(goiTarget, spellInfo.level, bf, actor.id)) {
      // PHB p.245: the blocked spell's slot is consumed but has no effect.
      consumeSpellSlot(actor, spellInfo.level);
      actor.budget.actionUsed = true;
      log(state, 'action', actor.id,
        `${actor.name}'s ${spellInfo.name} (L${spellInfo.level}) is blocked by Globe of Invulnerability on ${goiTarget.name}!`,
        goiTarget.id);
      return;  // spell has no effect — skip the entire switch
    }
  }

  // ── Session 76: Monster-bespoke spell synthetic state ──────────────
  // The planner (selectMonsterSlottedSpell / selectMonsterDailySpell)
  // validated the spell selection with synthetic state (action + resources),
  // but that state was cleaned up after planning. The bespoke shouldCast
  // functions in the switch below check `caster.actions.some(a => a.name)`
  // and `hasSpellSlot(caster, level)` — both fail for monsters without
  // synthetic state.
  //
  // We detect monster-bespoke casts by checking if plan.type is a registered
  // monster-bespoke plan type. If so, we attach synthetic state before the
  // switch and clean up after. The existing bespoke case branch then calls
  // shouldCast + execute normally.
  //
  // The resource consumption (slot or daily use) happened upfront in the
  // planner (PHB p.201). execute()'s call to consumeSpellSlot() is a safe
  // no-op for monsters (returns null when resources is null or slot is
  // exhausted — doesn't crash).
  let monsterBespokeCleanup: (() => void) | null = null;
  if (actor.monsterSpellcasting) {
    const bespokeEntry = lookupMonsterBespokeByPlanType(plan.type);
    if (bespokeEntry) {
      monsterBespokeCleanup = attachMonsterBespokeSyntheticState(
        actor, bespokeEntry.canonicalName, bespokeEntry.level,
      );
    }
  }

  switch (plan.type) {
    case 'attack':
    case 'cast': {
      // Session 52 Batch 3a: mark a Recharge action as spent the moment it's
      // dispatched. The action won't be available again until a 1d6 roll at
      // the start of the creature's next turn meets the threshold (handled by
      // rollRecharge() in resetBudget). Mutates in place — no log needed.
      if (plan.action?.recharge) {
        plan.action.recharge.recharged = false;
      }
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
      // ── Session 42 Task #18: Thirsting Blade / Extra Attack ──
      // PHB p.111: "You can attack with your pact weapon twice, instead of
      // once, whenever you take the Attack action on your turn."
      // The planner sets plan.attackCount = 2 when the actor has Thirsting
      // Blade + Pact of the Blade + melee attack. Default is 1 (single attack).
      // Loop resolveAttack this many times — each attack is independent
      // (separate attack roll, damage roll, death check).
      //
      // Session 85: Eldritch Blast multi-target per beam (PHB p.237: "direct
      // the beams at the same target or at different ones"). When an EB beam
      // kills the current target, remaining beams re-target to the next-best
      // living enemy in range instead of being wasted. Extra Attack /
      // Thirsting Blade preserve v1 break-on-death behavior (PHB p.192 allows
      // splitting, but v1 simplifies to focus-fire on one target).
      //
      // Session 88: EB spread damage heuristic. When the planner populates
      // `plan.secondaryTargetIds` (weak enemies worth spreading to), beams 2+
      // target the secondary enemies from the start instead of focus-firing
      // the primary. If a secondary target is dead (killed by a previous beam
      // or was dead before), the beam falls back to the primary, and the
      // retarget-on-kill logic handles the case where the primary is also dead.
      const attackCount = plan.attackCount ?? 1;
      const isEB = plan.action.name === 'Eldritch Blast';
      const secondaryIds = isEB ? (plan.secondaryTargetIds ?? []) : [];
      let currentTarget = effectiveTarget;
      for (let i = 0; i < attackCount; i++) {
        // Session 88: EB spread — for beam i > 0, try to assign a secondary target.
        // The secondary list is 0-indexed: secondaryIds[0] = beam 2's target,
        // secondaryIds[1] = beam 3's target, etc.
        let spreadLogEmitted = false;
        if (isEB && i > 0 && secondaryIds.length >= i) {
          const secId = secondaryIds[i - 1];
          const secondary = bf.combatants.get(secId);
          if (secondary && !secondary.isDead && !secondary.isUnconscious) {
            currentTarget = secondary;
            log(state, 'action', actor.id,
              `${actor.name} directs Eldritch Beam ${i + 1}/${attackCount} at ${secondary.name} (spread damage)`,
              secondary.id);
            spreadLogEmitted = true;
          }
          // If secondary is dead/unconscious, currentTarget retains its
          // previous value. The dead-check below will trigger retarget-on-kill
          // if currentTarget is also dead.
        }
        if (currentTarget.isDead || currentTarget.isUnconscious) {
          if (!isEB) break;  // non-EB: v1 break-on-death
          // EB: re-target remaining beams to the next living enemy in range.
          const nextEnemy = pickNextEldritchBlastTarget(actor, currentTarget.id, plan.action, bf);
          if (!nextEnemy) {
            if (attackCount > 1) {
              log(state, 'action', actor.id,
                `${actor.name} has no other target in range — ${attackCount - i} Eldritch Beam(s) not fired.`);
            }
            break;
          }
          currentTarget = nextEnemy;
          log(state, 'action', actor.id,
            `${actor.name} retargets Eldritch Beam ${i + 1}/${attackCount} to ${nextEnemy.name} — previous target fell!`,
            nextEnemy.id);
          spreadLogEmitted = true;  // suppress "makes Beam" log (retarget log covers it)
        }
        resolveAttack(actor, currentTarget, plan.action, state);
        // Log the next beam/attack announcement (skip for EB if the target
        // fell or a spread/retarget log was emitted — those logs cover it).
        const targetDown = currentTarget.isDead || currentTarget.isUnconscious;
        if (attackCount > 1 && i < attackCount - 1 && !(isEB && (targetDown || spreadLogEmitted))) {
          const label = isEB
            ? `Eldritch Beam ${i + 2}/${attackCount}`
            : `attack ${i + 2}/${attackCount} (Extra Attack / Thirsting Blade)`;
          log(state, 'action', actor.id,
            `${actor.name} makes ${label}`,
            currentTarget.id ?? undefined);
        }
      }
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
      // Session 52 Batch 3a: legendary actions can also have recharge tags
      // (rare but possible). Mark spent on dispatch, same as regular actions.
      if (plan.action.recharge) {
        plan.action.recharge.recharged = false;
      }
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
      // Session 42 Task #19: use rollGrappleContestReactable for Silvery Barbs support
      const success = rollGrappleContestReactable(state, actor, target, 'grapple');
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
      // Session 42 Task #19: use rollGrappleContestReactable for Silvery Barbs support
      // (rollShoveContest is just a wrapper around rollGrappleContest — same mechanic)
      const success = rollGrappleContestReactable(state, actor, target, 'shove');
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
      // Session 42 Task #19: use rollGrappleContestReactable for Silvery Barbs support
      const escaped = rollGrappleContestReactable(state, actor, grappler, 'escape grapple');
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
      // Magic Missile — PHB p.257: 3 auto-hit darts (+1 dart/slot above 1st), each 1d4+1 force. 120 ft, no concentration.
      // Slot consumed inside executeMagicMissile (or below if Shield negates).
      const mmTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!mmTarget || mmTarget.isDead || mmTarget.isUnconscious) break;

      // Upcast: +1 dart per slot level above 1st (PHB p.257)
      const mmSlotLevel = plan.castSlotLevel ?? 1;
      const mmDartCount = 3 + Math.max(0, mmSlotLevel - 1);

      // ── Session 37: Shield "targeted by Magic Missile" reaction (PHB p.275) ──
      // Magic Missile auto-hits (no attack roll), so it bypasses the
      // `incoming_attack_hit` trigger in resolveAttack. Fire a dedicated
      // `targeted_by_magic_missile` trigger here so Shield can negate ALL
      // darts aimed at mmTarget. If Shield negates, the MM slot is still
      // consumed (the spell was cast — PHB p.228 resource rule), but no
      // damage is dealt to the Shield-caster.
      //
      // v1: MM targets a single creature (all darts at one target), so
      // Shield blocks the entire volley. Multi-target MM + per-dart Shield
      // blocking is a future enhancement.
      const mmOutcome = triggerReactions(state, mmTarget, {
        kind: 'targeted_by_magic_missile',
        caster: actor,
        target: mmTarget,
        dartCount: mmDartCount,
      });
      if (mmOutcome && mmOutcome.kind === 'negated') {
        // Shield blocked all MM darts. MM slot is still consumed (spell was cast).
        consumeSpellSlot(actor, mmSlotLevel);
        actor.budget.actionUsed = true;
        log(state, 'action', actor.id,
          `${actor.name}'s Magic Missile was BLOCKED by ${mmTarget.name}'s Shield! (slot consumed, no damage)`,
          mmTarget.id);
        break;
      }

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
    case 'wholenessOfBody': {
      // ── Session 47 Task #29-follow-up-4: Open Hand Monk 6 (PHB p.79) ──
      // Self-heal action: restore 3 × monk level HP. Once per long rest
      // (v1: once per combat — tracked via resources.wholenessOfBody).
      //
      // The target is always self (plan.targetId = actor.id from the planner).
      // The heal amount = 3 × monk level (from combatant.classLevels['Monk']).
      // The resource is consumed here (remaining 1 → 0).
      if (actor.resources?.wholenessOfBody && actor.resources.wholenessOfBody.remaining > 0) {
        const monkLevel = actor.classLevels?.['Monk'] ?? actor.level ?? 1;
        const healAmount = 3 * monkLevel;
        const wasUnconscious = actor.isUnconscious;
        const healed = applyHeal(actor, healAmount);
        if (wasUnconscious && healed > 0) {
          log(state, 'condition_remove', actor.id,
            `${actor.name} regains consciousness!`, actor.id);
        }
        // Consume the resource
        actor.resources.wholenessOfBody.remaining -= 1;
        log(state, 'action', actor.id, plan.description);
        log(state, 'heal', actor.id,
          `${actor.name} restores ${healed} HP from Wholeness of Body (3 × monk lv ${monkLevel})`,
          actor.id, healed);
      } else {
        // No uses remaining — shouldn't happen (planner guards this), but
        // log a no-op to avoid silent failure.
        log(state, 'action', actor.id, `${plan.description} (no uses remaining — no-op)`);
      }
      break;
    }
    case 'draconicPresence': {
      // ── Session 49 Task #29-follow-up-5d: Draconic Sorcerer 18 (PHB p.102) ──
      // Action + 5 sorcery points: each enemy within 60 ft must succeed on a
      // WIS save or become frightened of the caster until the end of the
      // caster's next turn.
      //
      // v1 simplification: 1/combat (sorcery points not yet on Combatant).
      // The frightened condition is applied via applySpellEffect so the
      // standard frightened mechanics (disadvantage on ability checks + attack
      // rolls while the source is in sight, can't move closer) are inherited.
      // v1 does NOT model "until the end of your next turn" — frightened
      // persists for the v1 combat (matches Cause Fear / Fear spell pattern).
      if (actor.resources?.draconicPresence && actor.resources.draconicPresence.remaining > 0) {
        // Consume the resource first.
        actor.resources.draconicPresence.remaining -= 1;

        // Compute WIS save DC from the actor's spellcasting save DC.
        // Fall back to 8 + prof + CHA mod (Sorcerer casting) if not set.
        const spellAction = actor.actions.find(a => a.saveDC !== null && a.saveDC !== undefined);
        const saveDC = spellAction?.saveDC
          ?? (8 + (actor.level ? Math.ceil(actor.level / 4) + 1 : 2) + abilityMod(actor.cha));

        log(state, 'action', actor.id, plan.description);

        // Collect all living enemies within 60 ft of the caster.
        const enemies: Combatant[] = [];
        for (const c of state.battlefield.combatants.values()) {
          if (c.id === actor.id) continue;
          if (c.faction === actor.faction) continue;
          if (c.isDead || c.isUnconscious) continue;
          const distFt = chebyshev3D(actor.pos, c.pos) * 5;
          if (distFt <= 60) enemies.push(c);
        }

        if (enemies.length === 0) {
          log(state, 'action', actor.id,
            `${actor.name} channels Draconic Presence, but no enemies are within 60 ft.`);
          break;
        }

        log(state, 'action', actor.id,
          `${actor.name} channels Draconic Presence! ${enemies.length} enem${enemies.length === 1 ? 'y' : 'ies'} within 60 ft must make a DC ${saveDC} WIS save or be frightened.`);

        for (const enemy of enemies) {
          if (enemy.isDead || enemy.isUnconscious) continue;
          // Skip enemies already frightened (by this caster or another source).
          if (enemy.conditions.has('frightened')) {
            log(state, 'action', actor.id,
              `${enemy.name} is already frightened — unaffected by Draconic Presence.`,
              enemy.id);
            continue;
          }
          const save = rollSaveReactable(state, actor, enemy, 'wis', saveDC);
          if (save.success) {
            log(state, 'save_success', actor.id,
              `${enemy.name} resists Draconic Presence (WIS ${save.total} vs DC ${saveDC}) — not frightened!`,
              enemy.id, save.roll);
          } else {
            applySpellEffect(enemy, {
              casterId: actor.id,
              spellName: 'Draconic Presence',
              effectType: 'condition_apply',
              payload: { condition: 'frightened' },
              sourceIsConcentration: false,
            });
            log(state, 'save_fail', actor.id,
              `${enemy.name} succumbs to Draconic Presence (WIS ${save.total} vs DC ${saveDC}) — FRIGHTENED!`,
              enemy.id, save.roll);
            log(state, 'condition_add', actor.id,
              `${enemy.name} is frightened of ${actor.name}!`,
              enemy.id);
          }
        }
      } else {
        // No uses remaining — shouldn't happen (planner guards this), but
        // log a no-op to avoid silent failure.
        log(state, 'action', actor.id, `${plan.description} (no uses remaining — no-op)`);
      }
      break;
    }
    case 'quiveringPalm': {
      // ── TG-030: Quivering Palm (Open Hand Monk 17, PHB p.80) ──
      // "When you hit a creature with an unarmed strike, you can spend 3 ki
      //  points to start these imperceptible vibrations... When you use this
      //  action, the creature must make a Constitution saving throw. If it
      //  fails, it is reduced to 0 hit points. If it succeeds, it takes 10d10
      //  necrotic damage."
      //
      // v1 simplification: collapses the two-step (touch now / trigger later
      // action) into a single action — the monk uses an action to make an
      // unarmed strike touch attack; on hit, spends 3 ki and the target
      // immediately makes the CON save (instakill on fail / 10d10 necrotic on
      // success). The multi-day vibration duration + "action to end" mechanic
      // are not modeled (v1 is single-combat scope). Ki is spent ONLY on hit
      // (PHB-accurate: "When you hit... you can spend 3 ki"). On miss, no ki
      // is spent and the action is wasted.
      //
      // Guard: requires Quivering Palm class feature + 3 ki + a living enemy
      // target in melee range (5 ft touch).
      if (!hasFeature(actor, 'Quivering Palm')) {
        log(state, 'action', actor.id, `${plan.description} (no Quivering Palm feature — no-op)`);
        break;
      }
      const ki = actor.resources?.ki;
      if (!ki || ki.remaining < 3) {
        log(state, 'action', actor.id, `${plan.description} (insufficient ki: ${ki?.remaining ?? 0}/3 — no-op)`);
        break;
      }
      const qpTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (!qpTarget || qpTarget.isDead || qpTarget.isUnconscious) {
        log(state, 'action', actor.id, `${plan.description} (no valid target — no-op)`);
        break;
      }
      // Touch range = 5 ft (melee)
      const distFt = chebyshev3D(actor.pos, qpTarget.pos) * 5;
      if (distFt > 5) {
        log(state, 'action', actor.id,
          `${plan.description} (target ${qpTarget.name} out of range: ${distFt} ft — no-op)`);
        break;
      }

      log(state, 'action', actor.id, plan.description);

      // Roll the unarmed strike touch attack.
      // Monk unarmed strike: proficiency + max(DEX, WIS) mod (PHB p.76 Martial Arts).
      const prof = combatantProfBonus(actor);
      const dexMod = abilityMod(actor.dex);
      const wisMod = abilityMod(actor.wis);
      const hitBonus = prof + Math.max(dexMod, wisMod);
      const atkResult = rollAttack(hitBonus, false, false);

      // Compute effective AC (natural AC + ac_floor + ac_bonus; skip cover +
      // warding bond + mirror image — the touch attack is in melee range with
      // no mirror retarget, so those modifiers don't apply for v1 simplicity).
      const acFloor = getActiveAcFloor(qpTarget);
      const naturalAC = acFloor > 0 ? Math.max(qpTarget.ac, acFloor) : qpTarget.ac;
      const targetAC = naturalAC + getActiveAcBonus(qpTarget);

      // PHB p.194: nat 20 always hits; nat 1 always misses. rollAttack sets
      // isCrit (nat 20) and isFumble (nat 1).
      const qpHits = atkResult.isCrit || (!atkResult.isFumble && atkResult.total >= targetAC);
      if (!qpHits) {
        // Miss — no ki spent (PHB: "When you hit... you can spend 3 ki")
        log(state, 'action', actor.id,
          `${actor.name} misses the Quivering Palm touch attack on ${qpTarget.name} (rolled ${atkResult.total} vs AC ${targetAC}) — no ki spent.`,
          qpTarget.id, atkResult.roll);
        break;
      }

      // Hit — spend 3 ki
      ki.remaining -= 3;
      log(state, 'action', actor.id,
        `${actor.name} lands the Quivering Palm touch on ${qpTarget.name}! (3 ki spent, ${ki.remaining} ki remaining)`,
        qpTarget.id);

      // CON save DC = 8 + prof + WIS mod (monk ki save DC, PHB p.76)
      const saveDC = 8 + prof + wisMod;
      const save = rollSaveReactable(state, actor, qpTarget, 'con', saveDC);

      if (save.success) {
        // PHB p.80: "If it succeeds, it takes 10d10 necrotic damage."
        let necroticDmg = 0;
        for (let i = 0; i < 10; i++) necroticDmg += rollDie(10);
        applyDamageWithTempHP(qpTarget, necroticDmg, 'necrotic');
        log(state, 'save_success', actor.id,
          `${qpTarget.name} resists Quivering Palm (CON ${save.total} vs DC ${saveDC}) — takes ${necroticDmg} necrotic damage!`,
          qpTarget.id, save.roll);
        log(state, 'damage', actor.id,
          `${qpTarget.name} takes ${necroticDmg} necrotic from Quivering Palm.`,
          qpTarget.id, necroticDmg);
        // checkDeath handles isDead if HP reached 0
        checkDeath(qpTarget, state);
      } else {
        // PHB p.80: "If it fails, it is reduced to 0 hit points."
        qpTarget.currentHP = 0;
        qpTarget.isDead = true;
        if (qpTarget.isPlayer) qpTarget.isUnconscious = true;
        log(state, 'save_fail', actor.id,
          `${qpTarget.name} succumbs to Quivering Palm (CON ${save.total} vs DC ${saveDC}) — reduced to 0 HP! INSTAKILL!`,
          qpTarget.id, save.roll);
        log(state, 'death', qpTarget.id,
          `${qpTarget.name} is slain by Quivering Palm!`, undefined, 0);
      }
      break;
    }
    case 'flurryOfBlows': {
      // ── TG-031: Flurry of Blows (Monk 2, PHB p.78) + Open Hand Technique (Open Hand Monk 3, PHB p.79) ──
      // PHB p.78: "Immediately after you take the Attack action on your turn,
      // you can spend 1 ki point to make two unarmed strikes as a bonus action."
      // PHB p.79 (Open Hand Technique): "Whenever you hit a creature with one
      // of the attacks granted by your Flurry of Blows, you can impose one of
      // the following effects on that target:
      //   • It must succeed on a Dexterity saving throw or be knocked prone.
      //   • It must make a Strength saving throw. If it fails, you can push it
      //     up to 15 feet away from you.
      //   • It can't take reactions until the end of your next turn."
      //
      // v1 simplification: the rider fires ONCE per Flurry (after the second
      // hit), not per hit (PHB p.79: "immediately after you hit" — per hit is
      // more canon-accurate but fiddly for v1). The choice is set on
      // plan.openHandTechniqueChoice (default 'prone' if Open Hand Technique
      // is present and no choice was set).
      //
      // Guard: has Ki feature + ≥1 ki + a living enemy target in melee range.
      const ki = actor.resources?.ki;
      if (!ki || ki.remaining < 1) {
        log(state, 'action', actor.id, `${plan.description} (insufficient ki: ${ki?.remaining ?? 0}/1 — no-op)`);
        break;
      }
      const foTarget = plan.targetId
        ? state.battlefield.combatants.get(plan.targetId) ?? null
        : null;
      if (!foTarget || foTarget.isDead || foTarget.isUnconscious) {
        log(state, 'action', actor.id, `${plan.description} (no valid target — no-op)`);
        break;
      }
      const foDistFt = chebyshev3D(actor.pos, foTarget.pos) * 5;
      if (foDistFt > 5) {
        log(state, 'action', actor.id,
          `${plan.description} (target ${foTarget.name} out of range: ${foDistFt} ft — no-op)`);
        break;
      }

      // Spend 1 ki
      ki.remaining -= 1;
      log(state, 'action', actor.id, plan.description, foTarget.id);

      // Construct the unarmed strike Action.
      // Monk Martial Arts (PHB p.76): use DEX for attack + damage (instead of
      // STR). Hit bonus = prof + max(DEX, WIS). Damage die scales with level:
      // 1d4 (1-4), 1d6 (5-10), 1d8 (11-16), 1d10 (17-20). Damage bonus = max(DEX, WIS).
      const monkLevel = actor.classLevels?.['Monk'] ?? actor.level ?? 1;
      const foProf = combatantProfBonus(actor);
      const foDexMod = abilityMod(actor.dex);
      const foWisMod = abilityMod(actor.wis);
      const foAbilityMod = Math.max(foDexMod, foWisMod);
      const martialDie = monkLevel >= 17 ? 10 : monkLevel >= 11 ? 8 : monkLevel >= 5 ? 6 : 4;
      const unarmedAction: Action = {
        name: 'Flurry of Blows (unarmed strike)',
        isMultiattack: false,
        attackType: 'melee',
        reach: 5,
        range: { normal: 5, long: 5 },
        hitBonus: foProf + foAbilityMod,
        damage: { count: 1, sides: martialDie, bonus: foAbilityMod, average: Math.floor((martialDie + 1) / 2) + foAbilityMod },
        damageType: 'bludgeoning',
        saveDC: null, saveAbility: null,
        isAoE: false, isControl: false,
        requiresConcentration: false,
        slotLevel: 0,
        costType: 'bonusAction',
        legendaryCost: 0,
        description: 'Flurry of Blows unarmed strike',
      };

      // Make 2 unarmed strike attacks (PHB p.78: "two unarmed strikes")
      let hitsLanded = 0;
      for (let i = 0; i < 2; i++) {
        if (foTarget.isDead || foTarget.isUnconscious) break;  // target died mid-flurry
        resolveAttack(actor, foTarget, unarmedAction, state);
        // resolveAttack doesn't return hit/miss, but if the target took damage
        // (HP decreased), we count it as a hit. Check the log for a hit event.
        // Simpler: check if an attack_hit or attack_crit event was logged for
        // this attack on this target in the last few events.
        const recentHit = state.log.events.length > 0 &&
          state.log.events.slice(-6).some(e =>
            (e.type === 'attack_hit' || e.type === 'attack_crit') &&
            e.actorId === actor.id && e.targetId === foTarget.id
          );
        if (recentHit) hitsLanded++;
      }

      log(state, 'action', actor.id,
        `${actor.name} completes Flurry of Blows (${hitsLanded}/2 hits landed, ${ki.remaining} ki remaining)`,
        foTarget.id);

      // ── Open Hand Technique rider (PHB p.79) ──
      // Fires if the monk has the feature + at least one hit landed + a choice
      // is set (default 'prone'). v1: fires once per Flurry (after the second
      // hit), not per hit.
      if (hitsLanded > 0 && hasFeature(actor, 'Open Hand Technique')) {
        const choice = plan.openHandTechniqueChoice ?? 'prone';  // default prone
        const riderDC = 8 + foProf + foWisMod;  // monk ki save DC
        log(state, 'action', actor.id,
          `${actor.name} applies Open Hand Technique (${choice}) to ${foTarget.name}!`,
          foTarget.id);

        if (choice === 'prone') {
          // PHB p.79: "It must succeed on a Dexterity saving throw or be knocked prone."
          const dexSave = rollSaveReactable(state, actor, foTarget, 'dex', riderDC);
          if (dexSave.success) {
            log(state, 'save_success', actor.id,
              `${foTarget.name} resists Open Hand Technique (DEX ${dexSave.total} vs DC ${riderDC}) — not prone!`,
              foTarget.id, dexSave.roll);
          } else {
            addCondition(foTarget, 'prone' as Condition);
            log(state, 'save_fail', actor.id,
              `${foTarget.name} succumbs to Open Hand Technique (DEX ${dexSave.total} vs DC ${riderDC}) — KNOCKED PRONE!`,
              foTarget.id, dexSave.roll);
            log(state, 'condition_add', actor.id,
              `${foTarget.name} is prone!`, foTarget.id);
          }
        } else if (choice === 'push') {
          // PHB p.79: "It must make a Strength saving throw. If it fails, you
          // can push it up to 15 feet away from you."
          const strSave = rollSaveReactable(state, actor, foTarget, 'str', riderDC);
          if (strSave.success) {
            log(state, 'save_success', actor.id,
              `${foTarget.name} resists Open Hand Technique (STR ${strSave.total} vs DC ${riderDC}) — not pushed!`,
              foTarget.id, strSave.roll);
          } else {
            const oldPos: Vec3 = { ...foTarget.pos };
            pushAway(foTarget, actor.pos, 15);
            log(state, 'save_fail', actor.id,
              `${foTarget.name} succumbs to Open Hand Technique (STR ${strSave.total} vs DC ${riderDC}) — PUSHED 15 ft!`,
              foTarget.id, strSave.roll);
            log(state, 'move', actor.id,
              `${foTarget.name} is pushed 15 ft by Open Hand Technique (${oldPos.x},${oldPos.y}) → (${foTarget.pos.x},${foTarget.pos.y})`,
              foTarget.id);
          }
        } else if (choice === 'disabler') {
          // PHB p.79: "It can't take reactions until the end of your next turn."
          // v1 simplification: set budget.reactionUsed = true on the target.
          // This prevents the target from reacting until resetBudget clears
          // it at the start of the target's next turn. Canon says "end of YOUR
          // [the monk's] next turn" — the target may recover slightly early if
          // they act before the monk's next turn, but for v1 single-combat
          // scope this is an acceptable simplification.
          foTarget.budget.reactionUsed = true;
          log(state, 'condition_add', actor.id,
            `${foTarget.name} can't take reactions until the end of ${actor.name}'s next turn! (Open Hand Technique)`,
            foTarget.id);
        }
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
      // Session 62 RFC-VISION-AUDIO Phase 1: generalized Hide action.
      // Originally Cunning Action: Hide (PHB p.96) — Rogue-only bonus action.
      // Now any creature can take the Hide ACTION (Rogues still get it as a
      // bonus action via Cunning Action). The tryHide() helper enforces the
      // obscurement/cover/invisible requirement (user answer #2), rolls
      // Stealth vs highest enemy passive Perception, and grants 'hidden'.
      //
      // Backward-compat: the log message text ("Hides!"/"Detected!") matches
      // the Cunning Action Hide tests (cunning_action.test.ts §7g/7h).
      tryHide(actor, state);
      break;
    }

    case 'perceive': {
      // Session 62 RFC-VISION-AUDIO Phase 1: active Perception (Search action).
      // Per user answer #6: a creature can spend its ACTION to make a
      // Perception check contesting a hidden enemy's Stealth roll. On
      // success, that enemy loses 'hidden' (revealed globally — simpler
      // than per-observer tracking). On failure, the action is wasted.
      // PHB p.177: "When you take the Search action, you devote your
      // attention to finding something."
      tryActivePerception(actor, state);
      break;
    }
    case 'ready': {
      // Ready action (PHB p.193): "you take the Ready action so you can act
      // later in the round using your reaction." The creature chooses a
      // perceptible trigger and an action to take when it occurs.
      //
      // Session 81: this is a DEFENSIVE NO-OP STUB. The AI planner never
      // emits a 'ready' plan today (no heuristic for when/what to ready),
      // so this branch is unreachable in normal play. Previously `case 'ready':`
      // FELL THROUGH to `case 'bardicInspiration':`, which would have
      // incorrectly granted a Bardic Inspiration die if a 'ready' plan ever
      // surfaced — a latent bug. This stub breaks the fall-through, logs the
      // action, and consumes the action budget so the turn still progresses.
      //
      // Full implementation requires: (1) a planner heuristic for when to
      // ready and what trigger+action to set; (2) a `readiedAction` field on
      // Combatant storing the trigger + action; (3) trigger-evaluation hooks
      // after movement/attacks/spell-casts; (4) firing the readied action as
      // a reaction (consuming `budget.reactionUsed`); (5) clearing the
      // readied action at the start of the creature's next turn if unused.
      // This is tracked as a follow-up (MEDIUM-HIGH risk — needs an RFC for
      // the trigger taxonomy + AI heuristic + reaction plumbing).
      actor.budget.actionUsed = true;
      log(state, 'action', actor.id,
        plan.description || `${actor.name} takes the Ready action (not yet implemented — action spent, no trigger set).`);
      break;
    }
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

    case 'cureWounds': {
      // Cure Wounds — PHB p.230: action, touch range (5 ft), 1d8+WIS heal.
      // No effect on undead or constructs (PHB p.230).
      // Slot consumed and heal applied inside execute().
      const cwTarget = plan.targetId ? bf.combatants.get(plan.targetId) ?? null : null;
      if (!cwTarget) break;
      executeCureWounds(actor, cwTarget, state);
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

    case 'shadowOfMoil': {
      // Shadow of Moil — XGE p.164: action, self, concentration 1 min.
      // Heavily obscured (disadv on attacks vs caster) + 2d8 necrotic rider
      // on enemies that hit the caster (curse_rider effect).
      if (shouldCastShadowOfMoil(actor, bf)) executeShadowOfMoil(actor, state);
      break;
    }

    case 'blindnessDeafness': {
      // Blindness/Deafness — PHB p.219: action, 30 ft, CON save, NO
      // concentration (1 min duration). On fail: caster picks blinded (v1
      // always picks blinded — more combat-relevant than deafened).
      // Upcast: +1 target/slot above 2nd.
      const bdTargets = shouldCastBlindnessDeafness(actor, bf);
      if (!bdTargets || bdTargets.length === 0) break;
      executeBlindnessDeafness(actor, bdTargets, state);
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

    case 'superiorInvisibility': {
      // Session 53 Batch 4f: Superior Invisibility creature trait.
      // MM p.321 (Faerie Dragons) / various: "As a bonus action, the
      // [creature] can magically turn invisible until its concentration ends
      // (as if concentrating on a spell)."
      // Self-cast invisibility — no spell slot, no action (bonus action only).
      // Mirrors Greater Invisibility (L4 spell) but as a racial trait.
      // 1. Break existing concentration (safety net).
      // 2. Start concentration on 'Superior Invisibility'.
      // 3. Apply invisible effect (advantage on attacks, disadv on attacks
      //    vs the creature). The effect does NOT end on attack/cast (same as
      //    Greater Invisibility — the trait says "until concentration ends").
      if (actor.concentration?.active) {
        removeEffectsFromCaster(actor.id, bf);
      }
      startConcentration(actor, 'Superior Invisibility');
      log(state, 'action', actor.id,
        `${actor.name} uses Superior Invisibility! The creature turns invisible (concentration).`,
        actor.id);
      applySpellEffect(actor, {
        casterId: actor.id,
        spellName: 'Superior Invisibility',
        effectType: 'invisible',
        payload: {},
        sourceIsConcentration: true,
        // No breaksOnAttackOrCast — the trait persists until concentration ends.
      });
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

    case 'createBonfire': {
      // Create Bonfire — XGE p.152: action, 60 ft, DEX save 1d8 fire,
      // concentration 1 min. Persistent damage_zone with save for half.
      // Cantrip (level 0) — no spell slot consumed.
      const cbTargetId = plan.targetId;
      const cbTarget = cbTargetId ? bf.combatants.get(cbTargetId) ?? null : null;
      const cbLiveTarget = cbTarget && !cbTarget.isDead && !cbTarget.isUnconscious
        ? cbTarget
        : shouldCastCreateBonfire(actor, bf);
      if (cbLiveTarget) executeCreateBonfire(actor, cbLiveTarget, state);
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
      // Grants invisible condition. Session 32: ends-on-attack NOW modelled.
      // Session 35: upcast NOW modelled — shouldCast returns Combatant[]
      // (1-N targets based on highest available slot level). The plan.targetId
      // is the primary target; execute re-queries for all targets.
      const invTargets = shouldCastInvisibility(actor, bf);
      if (invTargets && invTargets.length > 0) {
        executeInvisibility(actor, invTargets, state);
      }
      break;
    }

    case 'greaterInvisibility': {
      // Greater Invisibility — PHB p.254: action, self, concentration 1 min.
      // Grants invisible condition. Does NOT end on attack/cast (unlike L2 Invisibility).
      if (shouldCastGreaterInvisibility(actor, bf)) {
        executeGreaterInvisibility(actor, actor, state);
      }
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

    // ── Session 24 — L4 combat damage spells (7) ────────────────────

    case 'elementalBane': {
      // Elemental Bane — XGE p.154: 90 ft, WIS save 2d6 acid, single-target.
      const ebTargetId = plan.targetId;
      const ebTarget = ebTargetId ? bf.combatants.get(ebTargetId) ?? null : null;
      const liveTarget = ebTarget && !ebTarget.isDead && !ebTarget.isUnconscious
        ? ebTarget
        : shouldCastElementalBane(actor, bf);
      if (liveTarget) executeElementalBane(actor, liveTarget, state);
      break;
    }

    case 'gravitySinkhole': {
      // Gravity Sinkhole — EGtW p.162: 60 ft, CON save 5d10 force, 20-ft radius AoE.
      const gsTargets = shouldCastGravitySinkhole(actor, bf);
      if (gsTargets) executeGravitySinkhole(actor, gsTargets, state);
      break;
    }

    case 'iceStorm': {
      // Ice Storm — PHB p.254: 300 ft, DEX save 2d8 cold + 2d6 bludgeoning, 20-ft radius.
      const isTargets = shouldCastIceStorm(actor, bf);
      if (isTargets) executeIceStorm(actor, isTargets, state);
      break;
    }

    case 'sickeningRadiance': {
      // Sickening Radiance — XGE p.164: 120 ft, CON save 4d10 radiant + poisoned on fail, 30-ft radius.
      const srTargets = shouldCastSickeningRadiance(actor, bf);
      if (srTargets) executeSickeningRadiance(actor, srTargets, state);
      break;
    }

    case 'spellfireStorm': {
      // Spellfire Storm — SCAG p.150: 60 ft, AUTO-HIT 4d10 fire, single-target.
      const sfTargetId = plan.targetId;
      const sfTarget = sfTargetId ? bf.combatants.get(sfTargetId) ?? null : null;
      const liveTarget = sfTarget && !sfTarget.isDead && !sfTarget.isUnconscious
        ? sfTarget
        : shouldCastSpellfireStorm(actor, bf);
      if (liveTarget) executeSpellfireStorm(actor, liveTarget, state);
      break;
    }

    case 'stormSphere': {
      // Storm Sphere — XGE p.166: 150 ft, CON save 6d6 thunder, 20-ft radius.
      const ssTargets = shouldCastStormSphere(actor, bf);
      if (ssTargets) executeStormSphere(actor, ssTargets, state);
      break;
    }

    case 'vitriolicSphere': {
      // Vitriolic Sphere — XGE p.168: 150 ft, DEX save 10d4 acid, 20-ft radius.
      const vsTargets = shouldCastVitriolicSphere(actor, bf);
      if (vsTargets) executeVitriolicSphere(actor, vsTargets, state);
      break;
    }

    // ── Session 24 — L5 combat damage spells (8) ────────────────────

    case 'destructiveWave': {
      // Destructive Wave — PHB p.250: Self (30-ft radius), CON save 5d6 thunder + prone.
      const dwTargets = shouldCastDestructiveWave(actor, bf);
      if (dwTargets) executeDestructiveWave(actor, dwTargets, state);
      break;
    }

    case 'enervation': {
      // Enervation — XGE p.155: 60 ft, DEX save 4d8 necrotic + heal self half.
      const enTargetId = plan.targetId;
      const enTarget = enTargetId ? bf.combatants.get(enTargetId) ?? null : null;
      const liveTarget = enTarget && !enTarget.isDead && !enTarget.isUnconscious
        ? enTarget
        : shouldCastEnervation(actor, bf);
      if (liveTarget) executeEnervation(actor, liveTarget, state);
      break;
    }

    case 'flameStrike': {
      // Flame Strike — PHB p.243: 60 ft, DEX save 4d6 fire + 4d6 radiant, 10-ft radius.
      const fsTargets = shouldCastFlameStrike(actor, bf);
      if (fsTargets) executeFlameStrike(actor, fsTargets, state);
      break;
    }

    case 'immolation': {
      // Immolation — XGE p.157: 90 ft, DEX save 8d6 fire, single-target.
      const imTargetId = plan.targetId;
      const imTarget = imTargetId ? bf.combatants.get(imTargetId) ?? null : null;
      const liveTarget = imTarget && !imTarget.isDead && !imTarget.isUnconscious
        ? imTarget
        : shouldCastImmolation(actor, bf);
      if (liveTarget) executeImmolation(actor, liveTarget, state);
      break;
    }

    case 'maelstrom': {
      // Maelstrom — XGE p.160: 120 ft, DEX save 6d6 bludgeoning + restrained, 20-ft radius.
      const maTargets = shouldCastMaelstrom(actor, bf);
      if (maTargets) executeMaelstrom(actor, maTargets, state);
      break;
    }

    case 'negativeEnergyFlood': {
      // Negative Energy Flood — XGE p.162: 60 ft, CON save 5d12 necrotic, single-target.
      const nefTargetId = plan.targetId;
      const nefTarget = nefTargetId ? bf.combatants.get(nefTargetId) ?? null : null;
      const liveTarget = nefTarget && !nefTarget.isDead && !nefTarget.isUnconscious
        ? nefTarget
        : shouldCastNegativeEnergyFlood(actor, bf);
      if (liveTarget) executeNegativeEnergyFlood(actor, liveTarget, state);
      break;
    }

    case 'steelWindStrike': {
      // Steel Wind Strike — XGE p.166: 30 ft, 5 melee spell attacks 6d10 force, multi-target.
      const swsTargets = shouldCastSteelWindStrike(actor, bf);
      if (swsTargets) executeSteelWindStrike(actor, swsTargets, state);
      break;
    }

    case 'synapticStatic': {
      // Synaptic Static — XGE p.167: 120 ft, INT save 8d6 psychic + incapacitated, 20-ft radius.
      const ssTargets = shouldCastSynapticStatic(actor, bf);
      if (ssTargets) executeSynapticStatic(actor, ssTargets, state);
      break;
    }

    // ── Session 24 — L6 combat damage spells (5) ────────────────────

    case 'chainLightning': {
      // Chain Lightning — PHB p.221: 150 ft, AUTO-HIT 10d8 lightning to 1 primary + 3 arcs.
      const clTargets = shouldCastChainLightning(actor, bf);
      if (clTargets) executeChainLightning(actor, clTargets, state);
      break;
    }

    case 'circleOfDeath': {
      // Circle of Death — PHB p.221: 60 ft, CON save 8d6 necrotic, 60-ft radius.
      const codTargets = shouldCastCircleOfDeath(actor, bf);
      if (codTargets) executeCircleOfDeath(actor, codTargets, state);
      break;
    }

    case 'gravityFissure': {
      // Gravity Fissure — EGtW p.162: 100-ft line, CON save 8d8 force.
      const gfTargets = shouldCastGravityFissure(actor, bf);
      if (gfTargets) executeGravityFissure(actor, gfTargets, state);
      break;
    }

    case 'mentalPrison': {
      // Mental Prison — XGE p.161: 60 ft, INT save 5d10 psychic, single-target.
      const mpTargetId = plan.targetId;
      const mpTarget = mpTargetId ? bf.combatants.get(mpTargetId) ?? null : null;
      const liveTarget = mpTarget && !mpTarget.isDead && !mpTarget.isUnconscious
        ? mpTarget
        : shouldCastMentalPrison(actor, bf);
      if (liveTarget) executeMentalPrison(actor, liveTarget, state);
      break;
    }

    case 'sunbeam': {
      // Sunbeam — PHB p.279: 60-ft line, CON save 6d8 radiant + blinded.
      const sbTargets = shouldCastSunbeam(actor, bf);
      if (sbTargets) executeSunbeam(actor, sbTargets, state);
      break;
    }

    // ── Session 24 — L7 combat damage spells (2) ────────────────────

    case 'crownOfStars': {
      // Crown of Stars — XGE p.152: 120 ft, ranged spell attack 4d12 radiant, single-target.
      const cosTargetId = plan.targetId;
      const cosTarget = cosTargetId ? bf.combatants.get(cosTargetId) ?? null : null;
      const liveTarget = cosTarget && !cosTarget.isDead && !cosTarget.isUnconscious
        ? cosTarget
        : shouldCastCrownOfStars(actor, bf);
      if (liveTarget) executeCrownOfStars(actor, liveTarget, state);
      break;
    }

    case 'fireStorm': {
      // Fire Storm — PHB p.242: 150 ft, DEX save 7d10 fire, 40-ft radius.
      const fsTargets = shouldCastFireStorm(actor, bf);
      if (fsTargets) executeFireStorm(actor, fsTargets, state);
      break;
    }

    // ── Session 24 — L8 combat damage spells (5) ────────────────────

    case 'darkStar': {
      // Dark Star — XGE p.153: 150 ft, CON save 8d8 necrotic + blinded, 40-ft radius.
      const dsTargets = shouldCastDarkStar(actor, bf);
      if (dsTargets) executeDarkStar(actor, dsTargets, state);
      break;
    }

    case 'earthquake': {
      // Earthquake — PHB p.234: Self (50-ft radius), AUTO-HIT 5d6 bludgeoning.
      const eqTargets = shouldCastEarthquake(actor, bf);
      if (eqTargets) executeEarthquake(actor, eqTargets, state);
      break;
    }

    case 'feeblemind': {
      // Feeblemind — PHB p.239: 60 ft, INT save 4d6 psychic + incapacitated on fail, single-target.
      const fmTargetId = plan.targetId;
      const fmTarget = fmTargetId ? bf.combatants.get(fmTargetId) ?? null : null;
      const liveTarget = fmTarget && !fmTarget.isDead && !fmTarget.isUnconscious
        ? fmTarget
        : shouldCastFeeblemind(actor, bf);
      if (liveTarget) executeFeeblemind(actor, liveTarget, state);
      break;
    }

    case 'incendiaryCloud': {
      // Incendiary Cloud — PHB p.253: 150 ft, DEX save 10d8 fire, 20-ft radius.
      const icTargets = shouldCastIncendiaryCloud(actor, bf);
      if (icTargets) executeIncendiaryCloud(actor, icTargets, state);
      break;
    }

    case 'maddeningDarkness': {
      // Maddening Darkness — XGE p.158: 120 ft, WIS save 8d8 psychic, 60-ft radius.
      const mdTargets = shouldCastMaddeningDarkness(actor, bf);
      if (mdTargets) executeMaddeningDarkness(actor, mdTargets, state);
      break;
    }

    // ── Session 24 — L9 combat damage spells (2) ────────────────────

    case 'psychicScream': {
      // Psychic Scream — XGE p.163: 90 ft, INT save 14d6 psychic + stunned, up to 10 targets.
      const psTargets = shouldCastPsychicScream(actor, bf);
      if (psTargets) executePsychicScream(actor, psTargets, state);
      break;
    }

    case 'ravenousVoid': {
      // Ravenous Void — XGE p.159: 1000 ft, AUTO-HIT 5d10 force, 60-ft radius.
      const rvTargets = shouldCastRavenousVoid(actor, bf);
      if (rvTargets) executeRavenousVoid(actor, rvTargets, state);
      break;
    }

    // ── Session 25 — Megabatch batch 2 (save-or-condition spells) ──────
    // Each migrated Batch 2 spell routes to its bespoke shouldCast + execute.
    // Single-target spells resolve the target from plan.targetId with a
    // shouldCast fallback (mirrors holdPerson/powerWordKill). AoE spells
    // re-run shouldCast to collect the target list (mirrors sunburst).

    case 'weird': {
      // Weird — PHB p.288: 120 ft, WIS save 4d10 psychic (half) + frightened
      // on fail, 30-ft radius AoE, concentration. shouldCast → Combatant[].
      const wTargets = shouldCastWeird(actor, bf);
      if (wTargets) executeWeird(actor, wTargets, state);
      break;
    }

    case 'powerWordStun': {
      // Power Word Stun — PHB p.267: 60 ft, NO save, NO attack — stunned if
      // currentHP ≤ 150. shouldCast → single Combatant.
      const pwsTargetId = plan.targetId;
      const pwsTarget = pwsTargetId ? bf.combatants.get(pwsTargetId) ?? null : null;
      const liveTarget = pwsTarget && !pwsTarget.isDead && !pwsTarget.isUnconscious
        ? pwsTarget
        : shouldCastPowerWordStun(actor, bf);
      if (liveTarget) executePowerWordStun(actor, liveTarget, state);
      break;
    }

    case 'dominateMonster': {
      // Dominate Monster — PHB p.235: 60 ft, WIS save or charmed (control
      // simplified), concentration, any creature. shouldCast → single Combatant.
      const dmTargetId = plan.targetId;
      const dmTarget = dmTargetId ? bf.combatants.get(dmTargetId) ?? null : null;
      const liveTarget = dmTarget && !dmTarget.isDead && !dmTarget.isUnconscious
        ? dmTarget
        : shouldCastDominateMonster(actor, bf);
      if (liveTarget) executeDominateMonster(actor, liveTarget, state);
      break;
    }

    case 'powerWordPain': {
      // Power Word Pain — XGE p.163: 60 ft, NO save/attack — 4d8 psychic +
      // restrained if HP ≤ 60. shouldCast → single Combatant.
      const pwpTargetId = plan.targetId;
      const pwpTarget = pwpTargetId ? bf.combatants.get(pwpTargetId) ?? null : null;
      const pwpLive = pwpTarget && !pwpTarget.isDead && !pwpTarget.isUnconscious
        ? pwpTarget
        : shouldCastPowerWordPain(actor, bf);
      if (pwpLive) executePowerWordPain(actor, pwpLive, state);
      break;
    }

    case 'whirlwind': {
      // Whirlwind — PHB p.298: 50-ft cone, CON save or 7d8 bludgeoning + restrained, conc.
      // Session 27 canon fix: damage now rolled (was dropped per plan).
      // shouldCast → Combatant[].
      const whTargets = shouldCastWhirlwind(actor, bf);
      if (whTargets) executeWhirlwind(actor, whTargets, state);
      break;
    }

    case 'reverseGravity': {
      // Reverse Gravity — PHB p.277: 100 ft, 50-ft radius AoE, DEX save or
      // restrained, concentration. shouldCast → Combatant[].
      const rgTargets = shouldCastReverseGravity(actor, bf);
      if (rgTargets) executeReverseGravity(actor, rgTargets, state);
      break;
    }

    case 'eyebite': {
      // Eyebite — PHB p.238: 60 ft, WIS save or sleeping, concentration.
      // shouldCast → single Combatant.
      const ebTargetId = plan.targetId;
      const ebTarget = ebTargetId ? bf.combatants.get(ebTargetId) ?? null : null;
      const ebLive = ebTarget && !ebTarget.isDead && !ebTarget.isUnconscious
        ? ebTarget
        : shouldCastEyebite(actor, bf);
      if (ebLive) executeEyebite(actor, ebLive, state);
      break;
    }

    case 'fleshToStone': {
      // Flesh to Stone — PHB p.241: 60 ft, CON save or restrained, conc.
      // shouldCast → single Combatant.
      const ftsTargetId = plan.targetId;
      const ftsTarget = ftsTargetId ? bf.combatants.get(ftsTargetId) ?? null : null;
      const ftsLive = ftsTarget && !ftsTarget.isDead && !ftsTarget.isUnconscious
        ? ftsTarget
        : shouldCastFleshToStone(actor, bf);
      if (ftsLive) executeFleshToStone(actor, ftsLive, state);
      break;
    }

    case 'massSuggestion': {
      // Mass Suggestion — PHB p.258: 60 ft, WIS save or charmed, up to 12
      // targets, NO concentration. shouldCast → Combatant[].
      const msTargets = shouldCastMassSuggestion(actor, bf);
      if (msTargets) executeMassSuggestion(actor, msTargets, state);
      break;
    }

    case 'holdMonster': {
      // Hold Monster — PHB p.251: 60 ft, WIS save or paralyzed, conc, any creature.
      const hmTargetId = plan.targetId;
      const hmTarget = hmTargetId ? bf.combatants.get(hmTargetId) ?? null : null;
      const hmLive = hmTarget && !hmTarget.isDead && !hmTarget.isUnconscious ? hmTarget : shouldCastHoldMonster(actor, bf);
      if (hmLive) executeHoldMonster(actor, hmLive, state);
      break;
    }

    case 'contagion': {
      // Contagion — PHB p.227: touch (5 ft), melee spell attack + poisoned, NO conc.
      const ctgTargetId = plan.targetId;
      const ctgTarget = ctgTargetId ? bf.combatants.get(ctgTargetId) ?? null : null;
      const ctgLive = ctgTarget && !ctgTarget.isDead && !ctgTarget.isUnconscious ? ctgTarget : shouldCastContagion(actor, bf);
      if (ctgLive) executeContagion(actor, ctgLive, state);
      break;
    }

    case 'dominatePerson': {
      // Dominate Person — PHB p.235: 60 ft, WIS save or charmed, conc, humanoid.
      const dpTargetId = plan.targetId;
      const dpTarget = dpTargetId ? bf.combatants.get(dpTargetId) ?? null : null;
      const dpLive = dpTarget && !dpTarget.isDead && !dpTarget.isUnconscious ? dpTarget : shouldCastDominatePerson(actor, bf);
      if (dpLive) executeDominatePerson(actor, dpLive, state);
      break;
    }

    case 'geas': {
      // Geas — PHB p.245: 60 ft, WIS save or 5d10 psychic + charmed, NO conc.
      const geasTargetId = plan.targetId;
      const geasTarget = geasTargetId ? bf.combatants.get(geasTargetId) ?? null : null;
      const geasLive = geasTarget && !geasTarget.isDead && !geasTarget.isUnconscious ? geasTarget : shouldCastGeas(actor, bf);
      if (geasLive) executeGeas(actor, geasLive, state);
      break;
    }

    case 'phantasmalKiller': {
      // Phantasmal Killer — PHB p.265: 120 ft, WIS save or frightened + 4d10, conc.
      const pkTargetId = plan.targetId;
      const pkTarget = pkTargetId ? bf.combatants.get(pkTargetId) ?? null : null;
      const pkLive = pkTarget && !pkTarget.isDead && !pkTarget.isUnconscious ? pkTarget : shouldCastPhantasmalKiller(actor, bf);
      if (pkLive) executePhantasmalKiller(actor, pkLive, state);
      break;
    }

    case 'waterySphere': {
      // Watery Sphere — XGE p.170: 90 ft, 5-ft radius AoE, STR save or restrained, conc.
      const wsTargets = shouldCastWaterySphere(actor, bf);
      if (wsTargets) executeWaterySphere(actor, wsTargets, state);
      break;
    }

    case 'dominateBeast': {
      // Dominate Beast — PHB p.235: 60 ft, WIS save or charmed, conc, beast.
      const dbTargetId = plan.targetId;
      const dbTarget = dbTargetId ? bf.combatants.get(dbTargetId) ?? null : null;
      const dbLive = dbTarget && !dbTarget.isDead && !dbTarget.isUnconscious ? dbTarget : shouldCastDominateBeast(actor, bf);
      if (dbLive) executeDominateBeast(actor, dbLive, state);
      break;
    }

    case 'charmMonster': {
      // Charm Monster — PHB p.221: 30 ft, WIS save or charmed, NO conc, any creature.
      const cmTargetId = plan.targetId;
      const cmTarget = cmTargetId ? bf.combatants.get(cmTargetId) ?? null : null;
      const cmLive = cmTarget && !cmTarget.isDead && !cmTarget.isUnconscious ? cmTarget : shouldCastCharmMonster(actor, bf);
      if (cmLive) executeCharmMonster(actor, cmLive, state);
      break;
    }

    case 'antagonize': {
      // Antagonize — EGtW p.150: 60 ft, WIS save 4d4 psychic (half) + frightened on fail, NO conc.
      const antTargetId = plan.targetId;
      const antTarget = antTargetId ? bf.combatants.get(antTargetId) ?? null : null;
      const antLive = antTarget && !antTarget.isDead && !antTarget.isUnconscious ? antTarget : shouldCastAntagonize(actor, bf);
      if (antLive) executeAntagonize(actor, antLive, state);
      break;
    }

    case 'bestowCurse': {
      // Bestow Curse — PHB p.214: Touch (5 ft) (Session 27 canon fix; was 60 ft per plan), WIS save or incapacitated, conc.
      const bcTargetId = plan.targetId;
      const bcTarget = bcTargetId ? bf.combatants.get(bcTargetId) ?? null : null;
      const bcLive = bcTarget && !bcTarget.isDead && !bcTarget.isUnconscious ? bcTarget : shouldCastBestowCurse(actor, bf);
      if (bcLive) executeBestowCurse(actor, bcLive, state);
      break;
    }

    case 'catnap': {
      // Catnap — XGE p.151: 30 ft, up to 3 WILLING ALLIES asleep (no save), NO conc.
      // shouldCast → Combatant[] (allies, not enemies).
      const cnTargets = shouldCastCatnap(actor, bf);
      if (cnTargets) executeCatnap(actor, cnTargets, state);
      break;
    }

    case 'enemiesAbound': {
      // Enemies Abound — XGE p.155: 120 ft, INT save or frightened, conc.
      const eaTargetId = plan.targetId;
      const eaTarget = eaTargetId ? bf.combatants.get(eaTargetId) ?? null : null;
      const eaLive = eaTarget && !eaTarget.isDead && !eaTarget.isUnconscious ? eaTarget : shouldCastEnemiesAbound(actor, bf);
      if (eaLive) executeEnemiesAbound(actor, eaLive, state);
      break;
    }

    case 'fastFriends': {
      // Fast Friends — EGtW p.151: 30 ft, WIS save or charmed, conc.
      const ffTargetId = plan.targetId;
      const ffTarget = ffTargetId ? bf.combatants.get(ffTargetId) ?? null : null;
      const ffLive = ffTarget && !ffTarget.isDead && !ffTarget.isUnconscious ? ffTarget : shouldCastFastFriends(actor, bf);
      if (ffLive) executeFastFriends(actor, ffLive, state);
      break;
    }

    case 'fear': {
      // Fear — PHB p.239: 30-ft cone, WIS save or frightened, conc (Session 27 canon fix; was non-conc per plan).
      const fearTargets = shouldCastFear(actor, bf);
      if (fearTargets) executeFear(actor, fearTargets, state);
      break;
    }

    case 'hypnoticPattern': {
      // Hypnotic Pattern — PHB p.252: 120 ft, 10-ft radius AoE, WIS save or
      // charmed+incapacitated (DUAL), conc. shouldCast → Combatant[].
      const hpTargets = shouldCastHypnoticPattern(actor, bf);
      if (hpTargets) executeHypnoticPattern(actor, hpTargets, state);
      break;
    }

    case 'inciteGreed': {
      // Incite Greed — EGtW p.151: 30-ft cone, WIS save or charmed, conc.
      const igTargets = shouldCastInciteGreed(actor, bf);
      if (igTargets) executeInciteGreed(actor, igTargets, state);
      break;
    }

    case 'sleetStorm': {
      // Sleet Storm — PHB p.276: 120 ft, 20-ft radius AoE, DEX save or prone, conc.
      const ssTargets = shouldCastSleetStorm(actor, bf);
      if (ssTargets) executeSleetStorm(actor, ssTargets, state);
      break;
    }

    case 'stinkingCloud': {
      // Stinking Cloud — PHB p.278: 90 ft, 20-ft radius AoE, CON save or
      // poisoned+incapacitated (DUAL), conc. shouldCast → Combatant[].
      const scTargets = shouldCastStinkingCloud(actor, bf);
      if (scTargets) executeStinkingCloud(actor, scTargets, state);
      break;
    }

    case 'evardsBlackTentacles': {
      // Evard's Black Tentacles — PHB p.238: 90 ft, 20-ft square AoE (radius approx),
      // DEX save 3d6 bludgeoning + restrained, conc. shouldCast → Combatant[].
      const ebtTargets = shouldCastEvardsBlackTentacles(actor, bf);
      if (ebtTargets) executeEvardsBlackTentacles(actor, ebtTargets, state);
      break;
    }

    case 'pyrotechnics': {
      // Pyrotechnics — XGE p.162: 60 ft, 10-ft radius AoE. FIREWORKS: CON save or blinded (default). SMOKE: no save, all blinded.
      // Session 27: 2-mode picker (executeSmoke available; planner uses fireworks). NO conc.
      const pyroTargets = shouldCastPyrotechnics(actor, bf);
      if (pyroTargets) executePyrotechnics(actor, pyroTargets, state);
      break;
    }

    case 'colorSpray': {
      // Color Spray — PHB p.222: 15-ft cone, 6d10 HP-pool → BLINDED (canon, no save), NO conc.
      // Session 26 canon fix: applies BLINDED (was unconscious in Batch 2 per the plan).
      // Allies in the cone ARE valid targets per canon (HP-pool may catch low-HP allies).
      const csTargets = shouldCastColorSpray(actor, bf);
      if (csTargets) executeColorSpray(actor, csTargets, state);
      break;
    }

    case 'command': {
      // Command — PHB p.223: 60 ft, WIS save or incapacitated, NO conc.
      const cmdTargetId = plan.targetId;
      const cmdTarget = cmdTargetId ? bf.combatants.get(cmdTargetId) ?? null : null;
      const cmdLive = cmdTarget && !cmdTarget.isDead && !cmdTarget.isUnconscious ? cmdTarget : shouldCastCommand(actor, bf);
      if (cmdLive) executeCommand(actor, cmdLive, state);
      break;
    }

    case 'animalFriendship': {
      // Animal Friendship — PHB p.212: 30 ft, WIS save or charmed, NO conc (Session 27 TG-004: beast-only + INT<4 NOW enforced).
      const afTargetId = plan.targetId;
      const afTarget = afTargetId ? bf.combatants.get(afTargetId) ?? null : null;
      const afLive = afTarget && !afTarget.isDead && !afTarget.isUnconscious ? afTarget : shouldCastAnimalFriendship(actor, bf);
      if (afLive) executeAnimalFriendship(actor, afLive, state);
      break;
    }

    case 'causeFear': {
      // Cause Fear — XGE p.151: 60 ft, WIS save or frightened, NO conc.
      const cfTargetId = plan.targetId;
      const cfTarget = cfTargetId ? bf.combatants.get(cfTargetId) ?? null : null;
      const cfLive = cfTarget && !cfTarget.isDead && !cfTarget.isUnconscious ? cfTarget : shouldCastCauseFear(actor, bf);
      if (cfLive) executeCauseFear(actor, cfLive, state);
      break;
    }

    case 'banishment': {
      // Banishment — PHB p.217: 60 ft, CHA save, conc; fey/elemental/etc removed.
      const banTargetId = plan.targetId;
      const banTarget = banTargetId ? bf.combatants.get(banTargetId) ?? null : null;
      const banLive = banTarget && !banTarget.isDead && !banTarget.isUnconscious ? banTarget : shouldCastBanishment(actor, bf);
      if (banLive) executeBanishment(actor, banLive, state);
      break;
    }

    case 'tashasHideousLaughter': {
      // Tasha's Hideous Laughter — PHB p.282: 30 ft, WIS save or prone+incapacitated, conc.
      const thlTargetId = plan.targetId;
      const thlTarget = thlTargetId ? bf.combatants.get(thlTargetId) ?? null : null;
      const thlLive = thlTarget && !thlTarget.isDead && !thlTarget.isUnconscious ? thlTarget : shouldCastTashasHideousLaughter(actor, bf);
      if (thlLive) executeTashasHideousLaughter(actor, thlLive, state);
      break;
    }

    case 'dimensionDoor': {
      // Dimension Door — PHB p.233: self, ACTION teleport up to 500 ft, NO conc.
      // shouldCast returns { destination } | null. v1: caster-only (no willing
      // creature rider), no occupied-destination damage.
      const dd = shouldCastDimensionDoor(actor, bf);
      if (dd) executeDimensionDoor(actor, dd.destination, state);
      break;
    }

    case 'wallOfFire': {
      // Wall of Fire — PHB p.285: 120 ft, DEX save 5d8 fire + conc damage_zone (L4, v1: single-target).
      const wofTargetId = plan.targetId;
      const wofTarget = wofTargetId ? bf.combatants.get(wofTargetId) ?? null : null;
      const wofLive = wofTarget && !wofTarget.isDead && !wofTarget.isUnconscious ? wofTarget : shouldCastWallOfFire(actor, bf);
      if (wofLive) executeWallOfFire(actor, wofLive, state);
      break;
    }

    case 'wallOfForce': {
      // Wall of Force — PHB p.285: 120 ft, NO save, conc — restrained (L5, v1: single-target capture).
      const wofrcTargetId = plan.targetId;
      const wofrcTarget = wofrcTargetId ? bf.combatants.get(wofrcTargetId) ?? null : null;
      const wofrcLive = wofrcTarget && !wofrcTarget.isDead && !wofrcTarget.isUnconscious ? wofrcTarget : shouldCastWallOfForce(actor, bf);
      if (wofrcLive) executeWallOfForce(actor, wofrcLive, state);
      break;
    }

    case 'wallOfIce': {
      // Wall of Ice — PHB p.285: 120 ft, DEX save 10d6 cold + conc damage_zone (L6, v1: single-target).
      const woiTargetId = plan.targetId;
      const woiTarget = woiTargetId ? bf.combatants.get(woiTargetId) ?? null : null;
      const woiLive = woiTarget && !woiTarget.isDead && !woiTarget.isUnconscious ? woiTarget : shouldCastWallOfIce(actor, bf);
      if (woiLive) executeWallOfIce(actor, woiLive, state);
      break;
    }

    case 'wallOfStone': {
      // Wall of Stone — PHB p.287: 120 ft, DEX save 10d6 bludgeoning, conc (L5, v1: single-target damage).
      const wosTargetId = plan.targetId;
      const wosTarget = wosTargetId ? bf.combatants.get(wosTargetId) ?? null : null;
      const wosLive = wosTarget && !wosTarget.isDead && !wosTarget.isUnconscious ? wosTarget : shouldCastWallOfStone(actor, bf);
      if (wosLive) executeWallOfStone(actor, wosLive, state);
      break;
    }

    case 'maze': {
      // Maze — PHB p.261: 60 ft, NO save, NO conc — removed for encounter (L8, v1: no escape action).
      const mazeTargetId = plan.targetId;
      const mazeTarget = mazeTargetId ? bf.combatants.get(mazeTargetId) ?? null : null;
      const mazeLive = mazeTarget && !mazeTarget.isDead && !mazeTarget.isUnconscious ? mazeTarget : shouldCastMaze(actor, bf);
      if (mazeLive) executeMaze(actor, mazeLive, state);
      break;
    }

    case 'magicCircle': {
      // Magic Circle — PHB p.256: 10 ft, NO save, conc — advantage_vs (L3, v1: single-target vs affected type).
      const mcTargetId = plan.targetId;
      const mcTarget = mcTargetId ? bf.combatants.get(mcTargetId) ?? null : null;
      const mcLive = mcTarget && !mcTarget.isDead && !mcTarget.isUnconscious ? mcTarget : shouldCastMagicCircle(actor, bf);
      if (mcLive) executeMagicCircle(actor, mcLive, state);
      break;
    }

    case 'antimagicField': {
      // Antimagic Field — PHB p.213: self (10-ft sphere), NO save, conc —
      // incapacitate enemy casters within 10 ft (L8, v1: multi-target).
      // shouldCast returns the CASTER (self) or null.
      const afTarget = shouldCastAntimagicField(actor, bf);
      if (afTarget) executeAntimagicField(actor, afTarget, state);
      break;
    }

    case 'mindBlank': {
      // Mind Blank — PHB p.260: touch, NO save, NO conc — psychic + charm
      // immunity (L8, v1: encounter-duration). Target is lowest-HP ally in 5 ft
      // (or self). Planner-style: prefer the planned targetId if provided.
      const mbTargetId = plan.targetId;
      const mbTarget = mbTargetId ? bf.combatants.get(mbTargetId) ?? null : null;
      const mbLive = mbTarget && !mbTarget.isDead && !mbTarget.isUnconscious ? mbTarget : shouldCastMindBlank(actor, bf);
      if (mbLive) executeMindBlank(actor, mbLive, state);
      break;
    }

    case 'symbol': {
      // Symbol — PHB p.280: 30 ft (v1 trigger radius), CON save, conc —
      // Pain: damage_zone (1d4 psychic) + advantage_vs disadv (L7, v1: Pain only).
      const symTargetId = plan.targetId;
      const symTarget = symTargetId ? bf.combatants.get(symTargetId) ?? null : null;
      const symLive = symTarget && !symTarget.isDead && !symTarget.isUnconscious ? symTarget : shouldCastSymbol(actor, bf);
      if (symLive) executeSymbol(actor, symLive, state);
      break;
    }

    case 'createUndead': {
      // Create Undead — PHB p.229: 10 ft, NO save, NO conc — spawn zombie
      // (L6, v1: 1 zombie, no corpse req). shouldCast returns the caster (self).
      const cuTarget = shouldCastCreateUndead(actor, bf);
      if (cuTarget) executeCreateUndead(actor, cuTarget, state);
      break;
    }

    case 'raiseDead': {
      // Raise Dead — PHB p.258: touch, 1-hour cast, out-of-combat only.
      // shouldCastRaiseDead always returns null; this branch is a safety guard.
      if (shouldCastRaiseDead(actor, bf)) { /* never fires in combat */ }
      break;
    }

    case 'etherealness': {
      // Etherealness — self-targeted defensive (shouldCast returns caster or null).
      const ethTarget = shouldCastEtherealness(actor, bf);
      if (ethTarget) executeEtherealness(actor, ethTarget, state);
      break;
    }

    case 'windWalk': {
      // Wind Walk — self-targeted movement/escape (shouldCast returns caster or null).
      const wwTarget = shouldCastWindWalk(actor, bf);
      if (wwTarget) executeWindWalk(actor, wwTarget, state);
      break;
    }

    case 'gate': {
      // Gate — spawns an entity; shouldCast returns the caster (self) or null.
      const gTarget = shouldCastGate(actor, bf);
      if (gTarget) executeGate(actor, gTarget, state);
      break;
    }

    case 'hallow': {
      // Hallow — single-target advantage_vs (Daylight vs undead/fiend).
      const halTargetId = plan.targetId;
      const halTarget = halTargetId ? bf.combatants.get(halTargetId) ?? null : null;
      const halLive = halTarget && !halTarget.isDead && !halTarget.isUnconscious ? halTarget : shouldCastHallow(actor, bf);
      if (halLive) executeHallow(actor, halLive, state);
      break;
    }

    case 'wish': {
      // Wish — out-of-combat stub. shouldCast always returns false.
      if (shouldCastWish(actor, bf)) { /* never fires in combat */ }
      break;
    }

    case 'planeShift': {
      // Plane Shift — PHB p.266: 5ft, CHA save, NO conc — banish (removed for encounter).
      // v1: banish-only (skip travel mode + melee spell attack roll).
      const psTargetId = plan.targetId;
      const psTarget = psTargetId ? bf.combatants.get(psTargetId) ?? null : null;
      const psLive = psTarget && !psTarget.isDead && !psTarget.isUnconscious ? psTarget : shouldCastPlaneShift(actor, bf);
      if (psLive) executePlaneShift(actor, psLive, state);
      break;
    }

    case 'teleport': {
      // Teleport — PHB p.281: self, NO save, NO conc — self-escape (L7).
      // v1: self-only (mirrors Dimension Door). shouldCast returns boolean.
      if (shouldCastTeleport(actor, bf)) executeTeleport(actor, state);
      break;
    }

    case 'animateDead': {
      // Animate Dead — PHB p.213: 10ft, NO save, NO conc — spawn skeleton (L3).
      // v1: 1 skeleton (mirrors Create Undead pattern; skeleton instead of zombie).
      // shouldCast returns the caster (self).
      const adTarget = shouldCastAnimateDead(actor, bf);
      if (adTarget) executeAnimateDead(actor, adTarget, state);
      break;
    }

    case 'scrying': {
      // Scrying — PHB p.273: 10-min cast time, out-of-combat only.
      // shouldCastScrying always returns false; this branch is a safety guard.
      if (shouldCastScrying(actor, bf)) { /* never fires in combat */ }
      break;
    }

    // ── Session 69 Batch 5: 10 out-of-combat utility divinations (stubs) ──
    // All shouldCast → null; these branches are safety guards against
    // unknown-action fallthrough. They never fire in combat.
    case 'detectMagic': {
      if (shouldCastDetectMagic(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'comprehendLanguages': {
      if (shouldCastComprehendLanguages(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'identify': {
      if (shouldCastIdentify(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'locateObject': {
      if (shouldCastLocateObject(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'clairvoyance': {
      if (shouldCastClairvoyance(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'sending': {
      if (shouldCastSending(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'tongues': {
      if (shouldCastTongues(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'waterBreathing': {
      if (shouldCastWaterBreathing(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'divination': {
      if (shouldCastDivination(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'locateCreature': {
      if (shouldCastLocateCreature(actor, bf)) { /* never fires in combat */ }
      break;
    }

    // ── Session 69 Batch 6: 5 more out-of-combat utility divinations (stubs) ──
    case 'detectEvilAndGood': {
      if (shouldCastDetectEvilAndGood(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'augury': {
      if (shouldCastAugury(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'revivify': {
      if (shouldCastRevivify(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'arcaneEye': {
      if (shouldCastArcaneEye(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'trueSeeing': {
      if (shouldCastTrueSeeing(actor, bf)) { /* never fires in combat */ }
      break;
    }

    // ── Session 69 Batch 7: 12 more out-of-combat utility spells (stubs) ──
    case 'longstrider': {
      if (shouldCastLongstrider(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'waterWalk': {
      if (shouldCastWaterWalk(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'gentleRepose': {
      if (shouldCastGentleRepose(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'locateAnimalsOrPlants': {
      if (shouldCastLocateAnimalsOrPlants(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'commune': {
      if (shouldCastCommune(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'contactOtherPlane': {
      if (shouldCastContactOtherPlane(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'dream': {
      if (shouldCastDream(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'legendLore': {
      if (shouldCastLegendLore(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'awaken': {
      if (shouldCastAwaken(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'heroesFeast': {
      if (shouldCastHeroesFeast(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'programmedIllusion': {
      if (shouldCastProgrammedIllusion(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'imprisonment': {
      if (shouldCastImprisonment(actor, bf)) { /* never fires in combat */ }
      break;
    }

    // ── Session 69 Batch 8: 16 more out-of-combat utility spells (stubs) ──
    case 'detectPoisonAndDisease': {
      if (shouldCastDetectPoisonAndDisease(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'illusoryScript': {
      if (shouldCastIllusoryScript(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'ropeTrick': {
      if (shouldCastRopeTrick(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'planarBinding': {
      if (shouldCastPlanarBinding(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'findThePath': {
      if (shouldCastFindThePath(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'wordOfRecall': {
      if (shouldCastWordOfRecall(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'contingency': {
      if (shouldCastContingency(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'demiplane': {
      if (shouldCastDemiplane(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'telepathy': {
      if (shouldCastTelepathy(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'astralProjection': {
      if (shouldCastAstralProjection(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'clone': {
      if (shouldCastClone(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'drawmajsInstantSummons': {
      if (shouldCastDrawmajsInstantSummons(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'forbiddance': {
      if (shouldCastForbiddance(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'planarAlly': {
      if (shouldCastPlanarAlly(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'resurrection': {
      if (shouldCastResurrection(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'simulacrum': {
      if (shouldCastSimulacrum(actor, bf)) { /* never fires in combat */ }
      break;
    }

    // ── Session 71 — Batch B/C: 6 deferred combat spell stubs ──────────────
    // All shouldCast functions always return null (deferred implementation).
    // These case branches are safety guards against unknown-action fallthrough.
    case 'thunderStep': {
      if (shouldCastThunderStep(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'windWall': {
      if (shouldCastWindWall(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'wallOfThorns': {
      if (shouldCastWallOfThorns(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'prismaticWall': {
      if (shouldCastPrismaticWall(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'protectionFromEvilAndGood': {
      if (shouldCastProtectionFromEvilAndGood(actor, bf)) { /* never fires in combat */ }
      break;
    }
    case 'dispelEvilAndGood': {
      if (shouldCastDispelEvilAndGood(actor, bf)) { /* never fires in combat */ }
      break;
    }

    case 'shapechange': {
      // Session 61 RFC-SHAPECHANGER Phase 1: monster Shapechanger trait.
      // Action to polymorph into an alternate form (size/speed/AC + flags).
      // shouldShapechange returns { formName } | null.
      const sc = shouldShapechange(actor, bf);
      if (sc) executeShapechange(actor, sc.formName, state);
      break;
    }

    case 'fogCloud': {
      // Session 62: Fog Cloud — PHB p.243: 120 ft, 20-ft sphere heavy
      // obscurement, concentration 1 min. Self-centered (v1). Blocks vision
      // (adds a vision-blocking Obstacle to bf.obstacles) + enables Hide.
      // shouldCast returns the caster (self) or null.
      const fcTarget = shouldCastFogCloud(actor, bf);
      if (fcTarget) executeFogCloud(actor, fcTarget, state);
      break;
    }

    case 'darkness': {
      // Session 63: Darkness — PHB p.230: 60 ft, 15-ft radius magical
      // darkness, concentration 10 min. Self-centered (v1). Blocks vision
      // (adds a vision-blocking Obstacle to bf.obstacles) + enables Hide.
      // "Blocks darkvision" is a Phase 2 vision feature (flagged in payload).
      // shouldCast returns the caster (self) or null.
      const darkTarget = shouldCastDarkness(actor, bf);
      if (darkTarget) executeDarkness(actor, darkTarget, state);
      break;
    }

    case 'charmPerson': {
      // Charm Person — PHB p.221: 30 ft, WIS save or charmed, NO conc (Session 27 TG-004: humanoid-only NOW enforced).
      const cpTargetId = plan.targetId;
      const cpTarget = cpTargetId ? bf.combatants.get(cpTargetId) ?? null : null;
      const cpLive = cpTarget && !cpTarget.isDead && !cpTarget.isUnconscious ? cpTarget : shouldCastCharmPerson(actor, bf);
      if (cpLive) executeCharmPerson(actor, cpLive, state);
      break;
    }

    case 'compelledDuel': {
      // Compelled Duel — PHB p.224: 30 ft, WIS save or frightened (taunt), conc.
      const cdTargetId = plan.targetId;
      const cdTarget = cdTargetId ? bf.combatants.get(cdTargetId) ?? null : null;
      const cdLive = cdTarget && !cdTarget.isDead && !cdTarget.isUnconscious ? cdTarget : shouldCastCompelledDuel(actor, bf);
      if (cdLive) executeCompelledDuel(actor, cdLive, state);
      break;
    }

    case 'grease': {
      // Grease — PHB p.245: 60 ft, 10-ft radius AoE, DEX save or prone, NO conc.
      const grTargets = shouldCastGrease(actor, bf);
      if (grTargets) executeGrease(actor, grTargets, state);
      break;
    }

    // ── Session 27 — Batch 3 concentration buffs (23 spells) ──────────────
    // 6 multi-target buffs (Combatant[] signature): bane, motivationalSpeech,
    //   beaconOfHope, intellectFortress, holyAura, foresight.
    // 17 self-buffs (boolean signature): 11 smites + 6 weapon enchants.
    case 'bane': {
      // Bane — PHB p.216: 30 ft, CHA save or -1d4 (bane_die), conc (up to 3 enemies).
      const baneTargets = shouldCastBane(actor, bf);
      if (baneTargets) executeBane(actor, baneTargets, state);
      break;
    }
    case 'motivationalSpeech': {
      // Motivational Speech — AI p.77: 60 ft, +1d4 (bless_die) + 5 temp HP, conc (up to 3 allies).
      const msTargets = shouldCastMotivationalSpeech(actor, bf);
      if (msTargets) executeMotivationalSpeech(actor, msTargets, state);
      break;
    }
    case 'beaconOfHope': {
      // Beacon of Hope — PHB p.217: 30 ft, adv on WIS saves, conc (up to 3 allies).
      const bohTargets = shouldCastBeaconOfHope(actor, bf);
      if (bohTargets) executeBeaconOfHope(actor, bohTargets, state);
      break;
    }
    case 'intellectFortress': {
      // Intellect Fortress — XGE: adv on INT/WIS/CHA saves (v1: all saves), conc (allies).
      const ifTargets = shouldCastIntellectFortress(actor, bf);
      if (ifTargets) executeIntellectFortress(actor, ifTargets, state);
      break;
    }
    case 'holyAura': {
      // Holy Aura — PHB p.251: 30-ft aura, adv on saves, conc (all allies in aura).
      const haTargets = shouldCastHolyAura(actor, bf);
      if (haTargets) executeHolyAura(actor, haTargets, state);
      break;
    }
    case 'foresight': {
      // Foresight — PHB p.244: Touch (5 ft), adv on all d20 rolls, conc (1 ally).
      const fsTargetId = plan.targetId;
      const fsTarget = fsTargetId ? bf.combatants.get(fsTargetId) ?? null : null;
      const fsLive = fsTarget && !fsTarget.isDead && !fsTarget.isUnconscious ? [fsTarget] : shouldCastForesight(actor, bf);
      if (fsLive) executeForesight(actor, fsLive, state);
      break;
    }
    // 11 smites (self-buff, boolean signature — set _nextHitRider):
    case 'ensnaringStrike':   if (shouldCastEnsnaringStrike(actor, bf))   executeEnsnaringStrike(actor, state);   break;
    case 'hailOfThorns':      if (shouldCastHailOfThorns(actor, bf))      executeHailOfThorns(actor, state);      break;
    case 'searingSmite':      if (shouldCastSearingSmite(actor, bf))      executeSearingSmite(actor, state);      break;
    case 'thunderousSmite':   if (shouldCastThunderousSmite(actor, bf))   executeThunderousSmite(actor, state);   break;
    case 'wrathfulSmite':     if (shouldCastWrathfulSmite(actor, bf))     executeWrathfulSmite(actor, state);     break;
    case 'zephyrStrike':      if (shouldCastZephyrStrike(actor, bf))      executeZephyrStrike(actor, state);      break;
    case 'blindingSmite':     if (shouldCastBlindingSmite(actor, bf))     executeBlindingSmite(actor, state);     break;
    case 'lightningArrow':    if (shouldCastLightningArrow(actor, bf))    executeLightningArrow(actor, state);    break;
    case 'spiritShroud':      if (shouldCastSpiritShroud(actor, bf))      executeSpiritShroud(actor, state);      break;
    case 'staggeringSmite':   if (shouldCastStaggeringSmite(actor, bf))   executeStaggeringSmite(actor, state);   break;
    case 'banishingSmite':    if (shouldCastBanishingSmite(actor, bf))    executeBanishingSmite(actor, state);    break;
    // 6 weapon enchants (self-buff, boolean signature — apply weapon_enchant):
    case 'divineFavor':       if (shouldCastDivineFavor(actor, bf))       executeDivineFavor(actor, state);       break;
    case 'shadowBlade':       if (shouldCastShadowBlade(actor, bf))       executeShadowBlade(actor, state);       break;
    case 'elementalWeapon':   if (shouldCastElementalWeapon(actor, bf))   executeElementalWeapon(actor, state);   break;
    case 'flameArrows':       if (shouldCastFlameArrows(actor, bf))       executeFlameArrows(actor, state);       break;
    case 'holyWeapon':        if (shouldCastHolyWeapon(actor, bf))        executeHolyWeapon(actor, state);        break;
    case 'swiftQuiver':       if (shouldCastSwiftQuiver(actor, bf))       executeSwiftQuiver(actor, state);       break;

    // ── Session 27 — Batch 4 persistent zones + healing + temp HP (22 spells) ──
    // 11 damage_zone spells (Combatant[] signature):
    case 'deathArmor':        { const t = shouldCastDeathArmor(actor, bf);      if (t) executeDeathArmor(actor, t, state);      break; }
    case 'dustDevil':         { const t = shouldCastDustDevil(actor, bf);       if (t) executeDustDevil(actor, t, state);       break; }
    case 'healingSpirit':     { const t = shouldCastHealingSpirit(actor, bf);   if (t) executeHealingSpirit(actor, t, state);   break; }
    case 'cacophonicShield':  { const t = shouldCastCacophonicShield(actor, bf); if (t) executeCacophonicShield(actor, t, state); break; }
    case 'callLightning':     { const t = shouldCastCallLightning(actor, bf);   if (t) executeCallLightning(actor, t, state);   break; }
    case 'hungerOfHadar':     { const t = shouldCastHungerOfHadar(actor, bf);   if (t) executeHungerOfHadar(actor, t, state);   break; }
    case 'spiritGuardians':   { const t = shouldCastSpiritGuardians(actor, bf); if (t) executeSpiritGuardians(actor, t, state); break; }
    case 'guardianOfFaith':   { const t = shouldCastGuardianOfFaith(actor, bf); if (t) executeGuardianOfFaith(actor, t, state); break; }
    case 'dawn':              { const t = shouldCastDawn(actor, bf);            if (t) executeDawn(actor, t, state);            break; }
    case 'insectPlague':      { const t = shouldCastInsectPlague(actor, bf);    if (t) executeInsectPlague(actor, t, state);    break; }
    case 'stormOfVengeance':  { const t = shouldCastStormOfVengeance(actor, bf); if (t) executeStormOfVengeance(actor, t, state); break; }
    // 4 single-target heals (Combatant | null signature):
    case 'goodberry':         { const t = shouldCastGoodberry(actor, bf);       if (t) executeGoodberry(actor, t, state);       break; }
    case 'heal':              { const t = shouldCastHeal(actor, bf);            if (t) executeHeal(actor, t, state);            break; }
    case 'regenerate':        { const t = shouldCastRegenerate(actor, bf);      if (t) executeRegenerate(actor, t, state);      break; }
    case 'powerWordHeal':     { const t = shouldCastPowerWordHeal(actor, bf);   if (t) executePowerWordHeal(actor, t, state);   break; }
    // 4 multi-target heals + wither_and_bloom (Combatant[] signature):
    case 'witherAndBloom':    { const t = shouldCastWitherAndBloom(actor, bf);  if (t) executeWitherAndBloom(actor, t, state);  break; }
    case 'auraOfVitality':    { const t = shouldCastAuraOfVitality(actor, bf);  if (t) executeAuraOfVitality(actor, t, state);  break; }
    case 'massHealingWord':   { const t = shouldCastMassHealingWord(actor, bf); if (t) executeMassHealingWord(actor, t, state); break; }
    case 'massCureWounds':    { const t = shouldCastMassCureWounds(actor, bf);  if (t) executeMassCureWounds(actor, t, state);  break; }
    case 'massHeal':          { const t = shouldCastMassHeal(actor, bf);        if (t) executeMassHeal(actor, t, state);        break; }
    // 2 temp-HP self-buffs (boolean signature):
    case 'armorOfAgathys':    if (shouldCastArmorOfAgathys(actor, bf))  executeArmorOfAgathys(actor, state);  break;
    case 'falseLife':         if (shouldCastFalseLife(actor, bf))       executeFalseLife(actor, state);       break;

    case 'dispelMagic': {
      // Dispel Magic — PHB p.233: action, 120 ft, auto-dispel concentration
      // effects + ability check vs DC 13 for non-concentration, upcast auto-dispels more.
      const dmTargetId = plan.targetId;
      const dmTarget = dmTargetId ? bf.combatants.get(dmTargetId) ?? null : null;
      const dmLiveTarget = dmTarget && !dmTarget.isDead && !dmTarget.isUnconscious
        ? dmTarget
        : shouldCastDispelMagic(actor, bf);
      if (dmLiveTarget) executeDispelMagic(actor, dmLiveTarget, state);
      break;
    }

    // ── Session 19 — generic spell dispatch ────────────────────────────
    // Routes any spell in the GENERIC_SPELLS registry (262 bulk-implemented
    // spells from levels 2-9) to its spell module's shouldCast + execute.
    // The spell name is carried by `plan.spellName` (set by planner.ts).
    case 'summonSpell': {
      // Summon/Conjure spell — spawns a combatant mid-combat (TG-006)
      // The actual spell execution is handled by the spell module's execute(),
      // which is dispatched via this case branch. The planner sets plan.action
      // to the spell's Action; its name identifies which summon spell to cast.
      const spellAction = plan.action;
      if (!spellAction) break;
      const spellName = spellAction.name;
      // Dispatch to the appropriate summon spell module
      if (spellName === 'Summon Beast') {
        executeSummonBeast(actor, actor, state);
      } else if (spellName === 'Summon Fey') {
        executeSummonFey(actor, actor, state);
      } else if (spellName === 'Summon Undead') {
        executeSummonUndead(actor, actor, state);
      } else if (spellName === 'Summon Shadowspawn') {
        executeSummonShadowspawn(actor, actor, state);
      } else if (spellName === 'Summon Lesser Demons') {
        executeSummonLesserDemons(actor, actor, state);
      } else if (spellName === 'Summon Aberration') {
        executeSummonAberration(actor, actor, state);
      } else if (spellName === 'Summon Construct') {
        executeSummonConstruct(actor, actor, state);
      } else if (spellName === 'Summon Elemental') {
        executeSummonElemental(actor, actor, state);
      } else if (spellName === 'Summon Greater Demon') {
        executeSummonGreaterDemon(actor, actor, state);
      } else if (spellName === 'Summon Celestial') {
        executeSummonCelestial(actor, actor, state);
      } else if (spellName === 'Summon Draconic Spirit') {
        executeSummonDraconicSpirit(actor, actor, state);
      } else if (spellName === 'Summon Fiend') {
        executeSummonFiend(actor, actor, state);
      } else if (spellName === 'Conjure Animals') {
        executeConjureAnimals(actor, actor, state);
      } else if (spellName === 'Conjure Woodland Beings') {
        executeConjureWoodlandBeings(actor, actor, state);
      } else if (spellName === 'Conjure Minor Elementals') {
        executeConjureMinorElementals(actor, actor, state);
      } else if (spellName === 'Conjure Elemental') {
        executeConjureElemental(actor, actor, state);
      } else if (spellName === 'Conjure Fey') {
        executeConjureFey(actor, actor, state);
      } else if (spellName === 'Conjure Celestial') {
        executeConjureCelestial(actor, actor, state);
      } else if (spellName === 'Find Familiar') {
        executeFindFamiliar(actor, actor, state);
      } else if (spellName === 'Find Steed') {
        executeFindSteed(actor, actor, state);
      } else if (spellName === 'Find Greater Steed') {
        executeFindGreaterSteed(actor, actor, state);
      }
      // More summon spells can be added here (Phase 2+)
      break;
    }

    case 'genericSpell': {
      const spellName = plan.spellName;
      if (!spellName) break;
      const desc = lookupGenericSpell(spellName);
      if (!desc) break;
      // ── Session 74/75: Monster spell casts bypass the shouldCast re-check ──
      // The planner's selectMonsterDailySpell() (Phase 3) and
      // selectMonsterSlottedSpell() (Phase 2) already validated shouldCast
      // (using a temporary synthetic action + resources, since monsters don't
      // have the spell in `actions` or `resources.spellSlots`). The re-check
      // here would fail for monsters because the synthetic state was cleaned
      // up after planning. The resource consumption (daily use or spell slot)
      // happened upfront in the planner (PHB p.201: "Once a spell is cast,
      // its slot is used").
      //
      // We detect monster spell casts by checking if the spell is in the
      // actor's `monsterSpellcasting.daily` map OR in any of their
      // `monsterSpellcasting.slots[N].spells` lists. If so, skip shouldCast
      // and execute directly.
      //
      // Session 76: the check is now case-insensitive. plan.spellName uses
      // the canonical Title Case (e.g. 'Fireball'), while monsterSpellcasting
      // stores the raw bestiary name (lowercase, e.g. 'fireball'). Without
      // case-insensitive matching, the monster detection would fail and the
      // shouldCast re-check would block execution.
      //
      // Note: desc.execute() will call consumeSpellSlot(), which is a safe
      // no-op for monsters (returns null when `resources` is null). The
      // resource tracking is separate (monsterDailyUses / monsterSpellSlots,
      // consumed in planner).
      const spellNameLower = spellName.toLowerCase();
      const isMonsterDailyCast = !!actor.monsterSpellcasting?.daily &&
        Object.keys(actor.monsterSpellcasting.daily).some(k => k.toLowerCase() === spellNameLower);
      const isMonsterSlottedCast = !isMonsterDailyCast && !!actor.monsterSpellcasting?.slots &&
        Object.values(actor.monsterSpellcasting.slots).some(s =>
          s.spells.some(sp => sp.toLowerCase() === spellNameLower));
      const isMonsterSpellCast = isMonsterDailyCast || isMonsterSlottedCast;
      if (isMonsterSpellCast || desc.shouldCast(actor, bf)) {
        desc.execute(actor, state);
      }
      break;
    }
  }

  // ── PHB p.254: "The spell ends for a target that attacks or casts a spell."
  // Session 32: Invisibility ends on spell cast. The "casts a spell" half.
  // Triggered AFTER the spell executes (so any attack-roll spells like Firebolt
  // or spell-attacks like Inflict Wounds would have already triggered the
  // "attacks" half via resolveAttack — but calling here is idempotent: if the
  // effect was already removed, the filter returns empty and we no-op).
  //
  // We use a deny-list of NON-spell action types. Anything not in this list
  // is treated as a spell cast (or spell-like action) and triggers the break.
  // The 'attack' case is handled separately by resolveAttack above (the
  // "attacks" half of the clause) — including it here is harmless because
  // breakInvisibilityOnAction is idempotent.
  const NON_SPELL_ACTIONS = new Set([
    'attack', 'dash', 'disengage', 'dodge', 'help', 'hide', 'ready',
    'shove', 'grapple', 'escapeGrapple',
    'secondWind', 'rage', 'layOnHands', 'bardicInspiration',
    'move',  // movement-only actions don't break invisibility
  ]);
  if (!NON_SPELL_ACTIONS.has(plan.type)) {
    breakInvisibilityOnAction(actor, state);
  }

  // ── Session 76: Monster-bespoke spell synthetic state cleanup ──────
  // Remove the synthetic action + resources that were attached before the
  // switch. The cleanup function is idempotent (safe to call even if the
  // switch threw — though we don't have try/finally here, the existing
  // code doesn't handle exceptions either, so this matches the pattern).
  if (monsterBespokeCleanup) {
    monsterBespokeCleanup();
  }
}

// ---- Execute a full TurnPlan --------------------------------

/**
 * Execute all components of a TurnPlan for one combatant.
 * Order: moveBefore → action → bonus action → moveAfter
 * (Movement can split around the action per PHB p.190.)
 */
export function executeTurnPlan(actor: Combatant, plan: TurnPlan, state: EngineState): void {
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

  // ── Session 43 Task #23: Action Surge (Fighter 2+, PHB p.72) ──
  // "On your turn, you can take one additional action on top of your regular
  // action and a possible bonus action." The planner sets plan.extraAction
  // when actionSurge.remaining > 0 and the main action was an Attack. Here
  // we execute that extra action and consume one actionSurge use.
  //
  // v1 simplification: the extra action is always an Attack on the same
  // target. If the target died from the main action, the engine's
  // resolveAttack handles the dead-target guard (returns early). The
  // attackCount loop in executePlannedAction's 'attack' branch also breaks
  // immediately if the target is dead at loop start.
  //
  // PHB p.72: Action Surge grants one additional ACTION (any type). It does
  // NOT grant an extra bonus action or reaction. It does NOT refresh the
  // fighter's action budget — it's a separate, additional action that
  // bypasses the normal one-action-per-turn limit.
  if (plan.extraAction && !actor.isDead && !actor.isUnconscious) {
    // Consume one actionSurge use BEFORE executing (so even if the action
    // misses or the target is already dead, the use is spent — PHB p.72:
    // "you can take one additional action", the resource is consumed when
    // the player declares the Action Surge, not when it lands).
    if (actor.resources?.actionSurge && actor.resources.actionSurge.remaining > 0) {
      actor.resources.actionSurge.remaining -= 1;
      log(state, 'action', actor.id,
        `${actor.name} uses Action Surge — gains one additional action!`,
        undefined);
      executePlannedAction(actor, plan.extraAction, state);
    }
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

// ============================================================
// Session 92 — RFC-LAIRACTIONS Phase 2: engine dispatch infrastructure
//
// Replaces the Session 60 round-start stub (which logged `rawText` with no
// mechanical effect) with a structured dispatcher that:
//   1. Fires at the initiative-count-20 boundary within the per-actor turn
//      loop (PHB: "On initiative count 20, losing initiative ties"). Creatures
//      with `initiativeScore ≥ 20` act BEFORE lair actions; creatures with
//      `< 20` act AFTER. (RFC [DD-2]; see `runCombat` round-loop restructure.)
//   2. Honors the per-creature `isInLair` flag ([DD-1]) — `false` skips the
//      creature entirely (a dragon fought in a field takes no lair action).
//   3. Sorts multiple lair creatures by descending CR (tie-break: name asc)
//      so the highest-CR creature's lair action fires first ([DD-3]).
//   4. Enforces the per-creature "can't use the same effect two rounds in a
//      row" rule via `_lairActionHistory` (last 2 IDs) — [DD-5]. If all
//      available actions are in history (≤2 options), the creature SKIPS its
//      lair action that round.
//   5. Logs out-of-scope (`lair_oos_*`) and deferred (`lair_def_*`) actions
//      with their stable IDs/tags — does NOT execute them mechanically
//      (RFC §4 / [DD-7]).
//   6. For in-scope actions, delegates to `executeLairAction` — Phase 2 stub
//      that logs the chosen action + category + (spell tag if isSpell). NO
//      mechanical effect yet (Phase 3 wires real handlers per category).
//
// Phase 4 (Session 95) replaced the deterministic "lowest action.id"
// selection with `scoreLairAction` (expected-value estimator, RFC §7).
// The selector picks max-score, tie-broken by lowest `action.id` for
// determinism. Scoring is a pure function — no dice, no state mutation.
// ============================================================

/**
 * Resolve lair actions for the current round at the initiative-count-20
 * boundary. Called by `runCombat` once per round.
 *
 * Collects all in-lair creatures with lair actions (sorted by descending CR,
 * tie-broken by name), then for each:
 *   - filters candidates by 2-entry history,
 *   - prefers in-scope actions (excludes out-of-scope/deferred unless those
 *     are the only options left),
 *   - selects via `selectLairAction` (Phase 4: max expected-value score, RFC §7),
 *   - logs or dispatches the chosen action,
 *   - appends the chosen ID to `_lairActionHistory` (truncated to length 2).
 */
function resolveLairActions(state: EngineState): void {
  const bf = state.battlefield;

  // ── Phase 7 batch 2 (Session 99): expire Warding Bond tethers at the start ──
  // of each lair-action checkpoint. The tether (Lich::1, Illithilich::1) lasts
  // "until initiative count 20 on the next round" — i.e., it expires at the
  // next init-20 checkpoint. Clearing here ensures a tether set in round N is
  // active during round N's turns and expires at round N+1's checkpoint (before
  // the Lich can establish a new tether). The lazy expiry in
  // `applyLairWardingBondTetherRedirect` is a backstop for edge cases.
  for (const c of bf.combatants.values()) {
    if (c.lairWardingBondTether && state.battlefield.round >= c.lairWardingBondTether.expiresAtRound) {
      c.lairWardingBondTether = null;
    }
    // ── Phase 8 batch 3 (Session 102): expire Demogorgon::1 illusory duplicate. ──
    // Same 1-round expiry as the Warding Bond tether. The duplicate lasts
    // "until initiative count 20 of the next round" — clear at the next
    // checkpoint. The lazy expiry in `applyLairIllusoryDuplicateRedirect` is a
    // backstop for edge cases (e.g., combat ends before the next checkpoint).
    if (c.lairIllusoryDuplicate && state.battlefield.round >= c.lairIllusoryDuplicate.expiresAtRound) {
      c.lairIllusoryDuplicate = null;
    }
  }

  // Collect in-lair creatures with at least one lair action, alive & conscious.
  // Sort: descending CR (highest first), tie-break alphabetical name ([DD-3]).
  const actors = [...bf.combatants.values()]
    .filter(c => c.isInLair === true)               // [DD-1] explicit true
    .filter(c => c.lairActions && c.lairActions.actions.length > 0)
    .filter(c => !c.isDead && !c.isUnconscious)
    .sort((a, b) =>
      (b.cr ?? -1) - (a.cr ?? -1) || a.name.localeCompare(b.name)
    );

  for (const actor of actors) {
    const allActions = actor.lairActions!.actions;
    const history = actor._lairActionHistory ?? [];

    // Candidates = actions whose id is NOT in the 2-entry history.
    let candidates = allActions.filter(a => !history.includes(a.id));

    if (candidates.length === 0) {
      // All available actions are in history → "can't repeat" → skip.
      // (Only reachable when the creature has ≤2 distinct options.)
      log(state, 'action', actor.id,
        `${actor.name} has no available lair actions this round ` +
        `(all in 2-round history — skipping per PHB "can't use the same effect two rounds in a row").`,
        undefined);
      continue;
    }

    // Prefer in-scope (non-out-of-scope, non-deferred) actions. Only fall
    // back to out-of-scope/deferred if those are the SOLE remaining options.
    const inScope = candidates.filter(a => !a.outOfScope && !a.deferred);
    if (inScope.length > 0) candidates = inScope;

    // Select via `scoreLairAction` (Phase 4 RFC §7): max expected-value
    // estimate, tie-break lowest `action.id` for determinism.
    const chosen = selectLairAction(candidates, actor, bf);

    // Execute / log.
    if (chosen.outOfScope) {
      log(state, 'action', actor.id,
        `${actor.name} takes a lair action [${chosen.outOfScopeId ?? 'lair_oos_?'}] ` +
        `(out of scope — logged, not executed): ${chosen.rawText.substring(0, 100)}` +
        `${chosen.rawText.length > 100 ? '...' : ''}`,
        undefined);
    } else if (chosen.deferred) {
      log(state, 'action', actor.id,
        `${actor.name} takes a lair action [${chosen.deferredId ?? 'lair_def_?'}] ` +
        `(deferred: ${chosen.deferred} — logged, not executed): ${chosen.rawText.substring(0, 100)}` +
        `${chosen.rawText.length > 100 ? '...' : ''}`,
        undefined);
    } else {
      executeLairAction(actor, chosen, state);
    }

    // Update history (keep last 2 IDs).
    actor._lairActionHistory = [...history, chosen.id].slice(-2);
  }
}

// ============================================================
// Session 95 — RFC-LAIRACTIONS Phase 4: AI scoring + selection
//
// Phase 4 replaces the Phase 2 deterministic lowest-ID selector with an
// expected-value estimator (`scoreLairAction`) per RFC §7. The selector
// picks the candidate with the MAX score, tie-broken by lowest `action.id`
// for determinism (so tests can assert on exact picked IDs).
//
// Scoring is a PURE function of (action, lairCreature, bf) — no dice rolls,
// no state mutation. It models the EXPECTED value of choosing the action:
//   - For damage actions: Σ over targets of P(save fail) × avgDamage × mult.
//   - For condition actions: Σ over targets of P(fail) × Σ conditionWeight.
//   - For summons: expected DPR × 3 rounds × count (bestiary-dependent).
//   - For buffs/debuffs: per-target weight × target count.
//   - For control/visibility/regen: flat weights.
//
// Out-of-scope and deferred actions score -1000 (handled by
// `resolveLairActions` before reaching here, but defensive). The flattening
// artifact (summons name matches source creature name) also scores -1000.
//
// Weights live in `LAIR_ACTION_SCORE_WEIGHTS` for easy tuning. Initial
// values are the RFC §7 defaults; Phase 5 may tune against bestiary
// integration tests.
// ============================================================

/**
 * Phase 4 weights for the lair-action scoring rubric (RFC §7).
 * Initial values are reasonable defaults; tuning is a Phase 5 task.
 */
const LAIR_ACTION_SCORE_WEIGHTS = {
  damagePerEnemy: 1.0,       // expected HP loss per enemy
  conditionStunned: 40,      // flat value per enemy afflicted
  conditionRestrained: 25,
  conditionPetrified: 60,
  conditionPoisoned: 15,
  conditionProne: 10,
  conditionOther: 12,
  summonExpectedDpr: 1.0,    // summon's expected damage/round × 3 rounds
  buffAdvantage: 4,           // per ally buffed (≈ +4 to hit)
  buffVulnerability: 20,      // per enemy made vulnerable (≈ +50% dmg)
  debuffDisadvantage: 6,      // per enemy debuffed
  controlPush: 5,             // per enemy repositioned (situational)
  visibilitySelf: 8,          // obscuring the lair creature (defensive)
  spellSlotRegen: 15,         // per slot level regained
  outOfScope: -1000,
  deferred: -1000,
} as const;

/**
 * Phase 4 lair-action selector. Scores each candidate via
 * {@link scoreLairAction} and returns the highest-scoring action, tie-broken
 * by lowest `action.id` for determinism (RFC §7).
 *
 * Replaces the Phase 2 deterministic lowest-ID selector. The scoring is a
 * pure expected-value estimator — it does NOT roll dice or mutate state.
 */
function selectLairAction(
  candidates: LairAction[],
  lairCreature: Combatant,
  bf: Battlefield,
): LairAction {
  // Defensive: short-circuit on a single candidate (no scoring needed).
  if (candidates.length === 1) return candidates[0];

  let best: { action: LairAction; score: number } | null = null;
  for (const action of candidates) {
    const score = scoreLairAction(action, lairCreature, bf);
    if (best === null ||
        score > best.score ||
        (score === best.score && action.id.localeCompare(best.action.id) < 0)) {
      best = { action, score };
    }
  }
  return best!.action;
}

/**
 * Phase 4 lair-action scorer (RFC §7). Returns a numeric expected-value
 * estimate for the given action under the current battlefield state.
 *
 * Algorithm:
 * 1. Out-of-scope / deferred actions → -1000 (never picked unless sole
 *    option — `resolveLairActions` already filters these, but defensive).
 * 2. Compute target set (enemies or allies of the lair creature, filtered
 *    by `targetFilter` and `rangeFt`). Excludes the lair creature itself
 *    (a dragon doesn't magma itself).
 * 3. Score by category, summing expected value per the weights in
 *    {@link LAIR_ACTION_SCORE_WEIGHTS}.
 * 4. Self-harm penalty: if `!targetsEnemies` and the action deals damage,
 *    subtract the expected damage to allies (incl. self).
 *
 * v1 simplifications:
 *   - P(save fail) is a simple linear model: `(DC - 1 - mod) / 20`, clamped
 *     to [0.05, 0.95]. Does NOT model advantage/disadvantage or save
 *     bonuses (Bardic Inspiration, Bless, etc.) — those are runtime-only
 *     and the scorer is a pure estimator.
 *   - Damage-type multiplier: immunity → 0, vulnerability → 2, resistance
 *     → 0.5, else → 1.0.
 *   - Summon DPR is estimated from CR (linear `2.5×CR + 2`). Phase 5 may
 *     inspect the summon's actual attack damage dice.
 *   - `cast_spell` value is `level × 10` (coarse — Phase 5 will inspect
 *     the spell module for actual damage / condition / effect).
 *   - `spell_slot_regen` value uses avg(d8) = 4.5 (assumes at least one
 *     spent slot — likely true by round 2+).
 *   - `bespoke` default score is 1 (handler logs "not yet implemented" for
 *     most patterns — low value to avoid preferring no-op actions).
 */
function scoreLairAction(
  action: LairAction,
  lairCreature: Combatant,
  bf: Battlefield,
): number {
  const W = LAIR_ACTION_SCORE_WEIGHTS;

  // 1. Out-of-scope / deferred → -1000.
  if (action.outOfScope) return W.outOfScope;
  if (action.deferred) return W.deferred;

  // 2. Compute target set (excluding the lair creature itself).
  const targets = selectLairActionTargets(lairCreature, action, bf)
    .filter(t => t.id !== lairCreature.id)
    .filter(t => !t.isDead && !t.isUnconscious);

  // Phase 5 (Session 96): cap targets at `maxTargets` for damage_no_save.
  // The handler picks the lowest-HP targets when capping, but the scorer is
  // a pure estimator — it scores ALL valid targets in range, on the
  // assumption that the handler's pick is approximately average (the
  // difference between "the N lowest-HP enemies" and "any N enemies" is small
  // relative to the per-target EV; and the capping is rare — only the ~5
  // `damage_no_save` actions have `maxTargets`). However, we still cap the
  // COUNT so that an action with `maxTargets: 3` in a 10-enemy field isn't
  // scored as if it hits all 10. Use the first N targets (the order is
  // already deterministic — the order returned by `selectLairActionTargets`).
  const scoredTargets = (action.maxTargets !== undefined && action.maxTargets > 0
                        && targets.length > action.maxTargets)
    ? targets.slice(0, action.maxTargets)
    : targets;

  // Phase 5 (Session 96): `halfOnSave` controls the success-branch EV for
  // save_damage. Default true (half dmg on success — PHB p.205). When false,
  // a successful save negates all damage (success → 0 dmg).
  const halfOnSave = action.halfOnSave !== false;

  let score = 0;

  // 3. Score by category.
  switch (action.category) {
    case 'save_damage': {
      if (!action.damage ||
          action.saveDC === undefined || action.saveAbility === undefined) {
        return 0;   // handler will log "missing" — no value
      }
      const avgDmg = action.damage.count * (action.damage.sides + 1) / 2;
      for (const t of scoredTargets) {
        const pFail = estimateSaveFailProb(t, action.saveAbility, action.saveDC);
        // v1 handler: full damage on fail, half on success (default).
        // Phase 5: when halfOnSave === false, success → 0 dmg.
        const successDmg = halfOnSave ? avgDmg / 2 : 0;
        const expectedDmg = pFail * avgDmg + (1 - pFail) * successDmg;
        const mult = damageTypeMultiplier(t, action.damage.type);
        score += expectedDmg * mult * W.damagePerEnemy;
      }
      break;
    }

    case 'save_condition': {
      if (!action.conditions || action.conditions.length === 0 ||
          action.saveDC === undefined || action.saveAbility === undefined) {
        return 0;
      }
      let conditionValue = 0;
      for (const cond of action.conditions) {
        conditionValue += conditionWeight(cond);
      }
      for (const t of targets) {
        const pFail = estimateSaveFailProb(t, action.saveAbility, action.saveDC);
        score += pFail * conditionValue;
      }
      break;
    }

    case 'damage_no_save': {
      if (!action.damage) return 0;
      const avgDmg = action.damage.count * (action.damage.sides + 1) / 2;
      // Phase 5 (Session 96): honor `maxTargets` — score only the targets the
      // handler will actually hit. The handler picks lowest-HP-first when
      // capping, but the scorer uses the first N targets (the order from
      // `selectLairActionTargets` is deterministic — the EV difference is
      // negligible relative to per-target avg damage).
      for (const t of scoredTargets) {
        const mult = damageTypeMultiplier(t, action.damage.type);
        score += avgDmg * mult * W.damagePerEnemy;
      }
      break;
    }

    case 'save_only': {
      // Phase 6 (Session 97) + Phase 7 (Session 98) + Phase 7 batch 2 (Session 99):
      // score based on the bespoke effect's real value.
      //   - Push/pull: controlPush per target (repositioning control).
      //   - Banished: buffVulnerability per target (removes target from combat —
      //     very high value, similar to a vulnerability debuff).
      //   - Apply-conditions: Σ conditionWeight per target (stunned=40, etc.).
      //   - Teleport-to-source: buffVulnerability per target (positional
      //     control similar to banish — the target is removed from its
      //     preferred position and dropped next to the lair creature).
      //   - Speed-zero (restrained): conditionRestrained per target (25).
      //   - Disadvantage-on-attacks: debuffDisadvantage per target (6).
      //   - Warding-bond tether (Phase 7b2): buffVulnerability per target —
      //     the tether redirects ~half the lair creature's incoming damage to
      //     the target (significant buff for the lair creature + debuff for
      //     the target). The save is NOT rolled at lair-action time (deferred
      //     to damage time), so no pFail multiplier.
      //   - Object-move / environment-manipulation (Phase 7b2): log-only —
      //     score 1 (flat, no mechanical effect).
      //   - Age-alteration (Phase 7b2): flavor-only — score 1 * pFail per
      //     target (the save is rolled but the age delta has no mechanical effect).
      //   - No recognized effect (the remaining unmatched): low controlPush
      //     value (forces a save roll but has no mechanical outcome).

      // Phase 7 batch 2 (Session 99): Warding Bond tether — flat per-target
      // value (no pFail — the tether is established unconditionally; the save
      // is deferred to damage time).
      if (action.lairWardingBondTether) {
        if (action.saveDC === undefined) return 0;
        const scoredTargets = (action.maxTargets !== undefined && action.maxTargets > 0
                              && targets.length > action.maxTargets)
          ? targets.slice(0, action.maxTargets)
          : targets;
        score += scoredTargets.length * W.buffVulnerability;
        break;
      }
      // Phase 7 batch 2: object-move & environment-manipulation are log-only.
      if (action.objectMove || action.environmentManipulation) {
        score += 1;
        break;
      }
      // Phase 7 batch 2: age-alteration is flavor-only.
      if (action.ageAlteration) {
        if (action.saveDC === undefined || action.saveAbility === undefined) return 0;
        const scoredTargets = (action.maxTargets !== undefined && action.maxTargets > 0
                              && targets.length > action.maxTargets)
          ? targets.slice(0, action.maxTargets)
          : targets;
        for (const t of scoredTargets) {
          const pFail = estimateSaveFailProb(t, action.saveAbility, action.saveDC);
          score += pFail * 1;  // flavor-only — value 1
        }
        break;
      }

      if (action.saveDC === undefined || action.saveAbility === undefined) return 0;
      const hasPush = action.pushFt !== undefined && action.pushFt > 0;
      const hasBanish = action.banished === true;
      const hasConds = action.applyConditions !== undefined && action.applyConditions.length > 0;
      const hasTeleport = action.teleportToSource === true;
      const hasSpeedZero = action.speedZero === true;
      const hasDisadv = action.disadvOnAttacks === true;
      let perTargetValue: number = W.controlPush;  // default: low control value
      if (hasBanish) {
        perTargetValue = W.buffVulnerability;  // banish ≈ removing target from combat
      } else if (hasTeleport) {
        // Teleport-to-source ≈ positional control similar to banish (the
        // target is dropped next to the lair creature, removing it from its
        // preferred position). Use buffVulnerability (20) — slightly less
        // than a damage-dealing banish but still very high value.
        perTargetValue = W.buffVulnerability;
      } else if (hasConds) {
        // Sum the condition weights (stunned=40, restrained=25, etc.).
        perTargetValue = 0;
        for (const cond of action.applyConditions!) {
          perTargetValue += conditionWeight(cond);
        }
      } else if (hasSpeedZero) {
        perTargetValue = W.conditionRestrained;  // 25 — restrained condition
      } else if (hasDisadv) {
        perTargetValue = W.debuffDisadvantage;  // 6 — attack-roll debuff
      } else if (hasPush) {
        perTargetValue = W.controlPush;  // push/pull repositioning
      }
      // Phase 7 (Session 98): honor maxTargets (single-target teleport/
      // speed-zero actions only score for the first target).
      const scoredTargets = (action.maxTargets !== undefined && action.maxTargets > 0
                            && targets.length > action.maxTargets)
        ? targets.slice(0, action.maxTargets)
        : targets;
      for (const t of scoredTargets) {
        const pFail = estimateSaveFailProb(t, action.saveAbility, action.saveDC);
        score += pFail * perTargetValue;
        // Half-effect on success (push successPushFt): add the partial value.
        if (hasPush && action.successPushFt !== undefined && action.successPushFt > 0) {
          score += (1 - pFail) * W.controlPush * 0.5;
        }
      }
      break;
    }

    case 'summon': {
      if (!action.summons || !action.summons.creature) return 0;
      // Flattening artifact (summons name matches source creature name).
      // The handler explicitly skips these — score -1000 so the selector
      // never picks them unless they're the sole candidate.
      const sourceLower = action.sourceCreature.toLowerCase();
      const summonLower = action.summons.creature.toLowerCase();
      if (summonLower.includes(sourceLower) || sourceLower.includes(summonLower)) {
        return W.outOfScope;
      }
      // Without bestiaryMap, the handler logs "bestiary not available" —
      // score 0 (no mechanical effect).
      if (!bf.bestiaryMap) return 0;
      const raw = bf.bestiaryMap.get(summonLower) as Raw5etoolsMonster | undefined;
      if (!raw) return 0;
      const count = typeof action.summons.count === 'number' ? action.summons.count : 1;
      const dpr = estimateMonsterDpr(raw);
      score += dpr * 3 * count * W.summonExpectedDpr;
      break;
    }

    case 'cast_spell': {
      // v1: estimate value based on spell level (higher level = more impact).
      // Phase 5 will inspect the spell module for actual damage / conditions.
      const level = action.castLevel ?? 1;
      score += level * 10;
      break;
    }

    case 'buff_ally': {
      // v1: buffAdvantage per ally in range. (The handler grants advantage
      // on attacks/saves/ability — the buff scope doesn't materially change
      // the scoring; the per-ally weight dominates.)
      score += targets.length * W.buffAdvantage;
      break;
    }

    case 'debuff_enemy': {
      // Parse rawText for vulnerability vs disadvantage.
      const text = action.rawText.toLowerCase();
      if (/vulnerability\s+to\s+\w+\s+damage/i.test(text)) {
        score += targets.length * W.buffVulnerability;
      } else if (/disadvantage\s+on/i.test(text)) {
        score += targets.length * W.debuffDisadvantage;
      } else {
        return 0;   // unparseable — handler logs "no keyword"
      }
      break;
    }

    case 'visibility': {
      // Single defensive value (obscuring the lair creature).
      score += W.visibilitySelf;
      break;
    }

    case 'movement': {
      // Push/pull enemies. controlPush per target.
      score += targets.length * W.controlPush;
      break;
    }

    case 'spell_slot_regen': {
      // v1: the handler rolls a d8 and regains the first spent slot ≤ that
      // level. Expected slot level regained ≈ 4.5 (avg of d8). Assumes at
      // least one spent slot (likely true by round 2+; if no slots are
      // spent, the handler logs "nothing happens" — but the scorer can't
      // know that without tracking spent slots, so we err optimistic).
      score += 4.5 * W.spellSlotRegen;
      break;
    }

    case 'bespoke': {
      // Pattern-match common bespoke patterns; default to low value (1)
      // since most aren't mechanically applied (handler logs "not yet
      // implemented"). Phase 8 batch 1 (Session 100) routes 8 new patterns
      // via structured fields — score them appropriately. The inline-regex
      // patterns (healing-suppression, free-attack, recharge, self-teleport)
      // remain as fallbacks for actions whose patterns aren't yet structured.
      const text = action.rawText.toLowerCase();
      if (/no (?:creature|target).{0,40}can\s+regain\s+hit\s+points/i.test(text)) {
        // Healing-suppression field (Fazrian::0, Mummy Lord::2, Demilich::2) —
        // similar value to a vulnerability debuff (prevents all healing in
        // range). Phase 8 batch 2 broadened to catch Demilich::2 ("No target
        // can regain hit points").
        score += targets.length * W.buffVulnerability;
      } else if (action.lairSelfInvisible) {
        // Self-invisibility (Emerald Dragon::2) — defensive buff: advantage
        // on attacks + disadvantage on attacks vs the lair creature for 1
        // round. ~visibilitySelf (8) per round × duration, but invisibility
        // is strictly stronger (also grants advantage on attacks). Use
        // buffVulnerability (20) as a reasonable estimate (similar to the
        // save_only disadvOnAttacks pattern — both deny the enemy effective
        // attacks for 1 round).
        score += W.buffVulnerability;
      } else if (action.lairIllusoryDuplicate) {
        // Phase 8 batch 3 (Session 102): Illusory-duplicate (Demogorgon::1) —
        // defensive buff: 50% chance to negate the FIRST attack's damage
        // against the lair creature for 1 round. One-shot (consumed after the
        // first attack). Weaker than self-invisibility (which gives disadv on
        // ALL attacks for a round) but stronger than log-only. Score as
        // visibilitySelf (8) — a moderate defensive estimate (expected
        // savings ≈ 0.5 × one attack's damage ≈ 7-8 HP).
        score += W.visibilitySelf;
      } else if (action.lairDispelMagic) {
        // Dispel-magic (Topaz Dragon::1, Zargon::1, Darkweaver::0) — value
        // depends on how many enemy effects are active (unknown at score
        // time). Estimate ~1 dispel per enemy on average × debuffDisadvantage
        // (6) per dispel — dispelling is less valuable than preventing the
        // effect in the first place (the effect already did some work).
        score += targets.length * W.debuffDisadvantage;
      } else if (action.lairIllusoryAttack) {
        // Illusory-attack (Alyxian::2 x4 variants) — MECHANICAL: rolls a melee
        // attack (bonus 7) vs target AC; on hit, applies 1d8+4 bludgeoning
        // (avg 8.5). Score as expected damage per target × damagePerEnemy.
        // (The Absolved variant's "10d8+4" is a 5eTools typo — the handler
        // uses the parsed value, which could be 10d8+4 for Absolved. We score
        // based on the parsed damage expression.)
        const dmg = action.lairIllusoryAttack.damage;
        const avgDmg = dmg.count * (dmg.sides + 1) / 2 + dmg.bonus;
        // Estimate P(hit) ≈ 0.65 (typical for +7 vs AC ~15-18). The lair
        // creature picks the target with lowest AC, so slightly higher.
        const pHit = 0.65;
        score += targets.length * avgDmg * pHit * W.damagePerEnemy;
      } else if (action.lairDifficultTerrain
                 || action.lairWallCreation
                 || action.lairEtherealPass
                 || action.lairRandomEyeRay
                 || action.lairUndeadPinpointLiving
                 || action.lairVesselHeal
                 // Phase 8 batch 2 (Session 101) log-only flags:
                 || action.lairPlaneShift
                 || action.lairTeleportAllies
                 || action.lairAntiInvisibility
                 || action.lairRechargeAbility
                 || action.lairBespokeActionInvocation) {
        // Log-only patterns — low default (1). The handler logs but doesn't
        // apply mechanical effects in v1. Phase 9+ may add subsystems that
        // make these meaningful (terrain cost, obstacle model, eye-ray
        // table, perception meta-flag, vessel combatant, plane-shift model,
        // recharge tracking, named-action handlers).
        score += 1;
      } else {
        // Unknown bespoke — low default (handler logs "not yet implemented").
        score += 1;
      }
      break;
    }

    case 'flavor':
    case 'deferred':
    default:
      // `flavor` and `deferred` are intercepted by `resolveLairActions`
      // before reaching the scorer (they're filtered into the inScope
      // fallback only when they're the sole candidates). The defensive
      // -1000 here ensures they're never preferred over real actions.
      return W.outOfScope;
  }

  // 4. Self-harm penalty: if `!targetsEnemies` (action affects allies incl.
  //    self) and the action deals damage, subtract the expected damage to
  //    allies. (Most lair actions are `targetsEnemies: true`, so this is
  //    rare — but a self-damaging lair action should be deprioritized.)
  //    Phase 5 (Session 96): honor `halfOnSave` — when false, a successful
  //    save negates all ally damage (success → 0 dmg).
  if (!action.targetsEnemies && action.damage &&
      action.saveDC !== undefined && action.saveAbility !== undefined) {
    const avgDmg = action.damage.count * (action.damage.sides + 1) / 2;
    const successDmg = halfOnSave ? avgDmg / 2 : 0;
    for (const t of targets) {
      const pFail = estimateSaveFailProb(t, action.saveAbility, action.saveDC);
      const expectedDmg = pFail * avgDmg + (1 - pFail) * successDmg;
      const mult = damageTypeMultiplier(t, action.damage.type);
      score -= expectedDmg * mult * W.damagePerEnemy;
    }
  }

  return score;
}

/**
 * Estimate P(save fail) for a d20 save vs DC. Simple linear model:
 *   P(fail) = clamp((DC - 1 - mod) / 20, 0.05, 0.95)
 * (Natural 1 always fails, natural 20 always succeeds — clamp to [0.05, 0.95].)
 *
 * Does NOT model advantage/disadvantage or save bonuses (Bardic Inspiration,
 * Bless, Magic Resistance, etc.) — those are runtime-only and the scorer is
 * a pure estimator. Real `rollSave` (utils.ts:147) handles all those flags.
 */
function estimateSaveFailProb(
  combatant: Combatant,
  ability: AbilityScore,
  dc: number,
): number {
  const score = combatant[ability];
  const mod = abilityMod(score);
  const pFail = (dc - 1 - mod) / 20;
  return Math.max(0.05, Math.min(0.95, pFail));
}

/**
 * Condition weight per RFC §7. Higher = more debilitating.
 *
 * Ordering: petrified (60) > stunned (40) > restrained (25) > poisoned (15)
 * > prone (10) > other (12). (Petrified is technically the most severe — it
 * permanently removes the target from combat. Stunned is similar but shorter-
 * lived. RFC §7 sets these weights; we follow that ordering.)
 */
function conditionWeight(cond: Condition): number {
  const W = LAIR_ACTION_SCORE_WEIGHTS;
  switch (cond) {
    case 'stunned':      return W.conditionStunned;
    case 'petrified':    return W.conditionPetrified;
    case 'restrained':   return W.conditionRestrained;
    case 'poisoned':     return W.conditionPoisoned;
    case 'prone':        return W.conditionProne;
    default:             return W.conditionOther;
  }
}

/**
 * Damage-type multiplier for a target:
 *   - Immune → 0 (no damage)
 *   - Vulnerable → 2.0 (double damage)
 *   - Resistant → 0.5 (half damage)
 *   - Else → 1.0
 *
 * Immunity takes precedence over vulnerability and resistance (PHB p.197).
 * Vulnerability takes precedence over resistance (PHB p.197).
 */
function damageTypeMultiplier(target: Combatant, type: string): number {
  const t = type.toLowerCase() as DamageType;
  if (target.immunities?.includes(t)) return 0;
  if (target.damageVulnerabilities?.includes(t)) return 2;
  if (target.resistances?.includes(t)) return 0.5;
  return 1;
}

/**
 * Estimate a monster's expected damage per round (DPR) from its raw 5eTools
 * stat block. Uses a linear CR-based approximation:
 *   DPR ≈ 2.5 × CR + 2
 *
 * This is calibrated against DMG p.274 "Monster Statistics by Challenge
 * Rating" (CR 1 ≈ 5 DPR, CR 5 ≈ 15 DPR, CR 10 ≈ 27 DPR, CR 17 ≈ 45 DPR,
 * CR 20 ≈ 52 DPR). It's a coarse heuristic — actual DPR depends on
 * multiattack, hit chance, save DCs, etc. Phase 5 may inspect the summon's
 * actual attack damage dice for a more precise estimate.
 *
 * CR is parsed from `raw.cr` (string like '17', '1/2', or `{ cr: '17' }`).
 */
function estimateMonsterDpr(raw: Raw5etoolsMonster): number {
  const cr = parseCrForScoring(raw.cr);
  if (cr === null) return 5;   // unknown CR → conservative default
  return 2.5 * cr + 2;
}

/**
 * Parse a 5eTools CR field into a number. Handles all three forms:
 *   - `cr: '17'`            (string)
 *   - `cr: '1/2'`           (fraction string)
 *   - `cr: { cr: '17' }`    (object — used by some 5eTools entries)
 *
 * Mirrors `parseCR` in `parser/fivetools.ts:1484` but inlined here to avoid
 * exporting the parser helper (which would require a wider refactor).
 */
function parseCrForScoring(cr: Raw5etoolsMonster['cr']): number | null {
  if (cr === undefined) return null;
  const raw = typeof cr === 'string' ? cr : cr.cr;
  if (raw === '1/8') return 0.125;
  if (raw === '1/4') return 0.25;
  if (raw === '1/2') return 0.5;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

/**
 * Phase 3 category dispatcher. Routes the chosen lair action to its
 * per-category handler. Phase 3a (Session 93) implements the damage/save
 * family:
 *   - `save_damage`      → {@link handleLairSaveDamage}
 *   - `save_condition`   → {@link handleLairSaveCondition}
 *   - `damage_no_save`   → {@link handleLairDamageNoSave}
 *   - `spell_slot_regen` → {@link handleLairSpellSlotRegen}
 *
 * The remaining categories still fall through to a "not yet implemented"
 * log line (no mechanical effect) — to be wired in Phase 3b+:
 *   - `save_only`        → bespoke per-action (push/fall/banish) — Phase 3b
 *   - `summon`           → `summonSpell` dispatch pattern — Phase 3b
 *   - `cast_spell`       → registry + `execute()` + GoI/Counterspell — Phase 3b
 *   - `buff_ally` / `debuff_enemy` → `applySpellEffect` — Phase 3b
 *   - `visibility`       → `terrain_zone` — Phase 3b
 *   - `movement`         → `pushAway` — Phase 3b
 *   - `bespoke`          → hand-written per `action.id` — Phase 3b
 *
 * Each handler emits a header log line of the form:
 *   `<name> takes a lair action (initiative count <N>) [<category>]: <text…>`
 * followed by the per-target mechanical events (save_success/save_fail,
 * damage, condition_add, etc.) so the lair action is visible in the combat
 * log with its mechanical effects.
 */
function executeLairAction(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const text = action.rawText;
  const initCount = creature.lairActions?.initiativeCount ?? 20;
  const spellTag = action.isSpell
    ? `, spell: ${action.spellName ?? 'unknown'} (lvl ${action.castLevel ?? '?'})`
    : '';

  // Header log — announces the lair action + category. Handlers then emit
  // their own per-target mechanical events.
  log(state, 'action', creature.id,
    `${creature.name} takes a lair action (initiative count ${initCount}) ` +
    `[${action.category}${spellTag}]: ${text.substring(0, 100)}` +
    `${text.length > 100 ? '...' : ''}`,
    undefined);

  // Dispatch by category.
  switch (action.category) {
    case 'save_damage':
      handleLairSaveDamage(creature, action, state);
      return;
    case 'save_condition':
      handleLairSaveCondition(creature, action, state);
      return;
    case 'damage_no_save':
      handleLairDamageNoSave(creature, action, state);
      return;
    case 'spell_slot_regen':
      handleLairSpellSlotRegen(creature, action, state);
      return;
    // ── Session 94 Phase 3b handlers ──
    case 'cast_spell':
      handleLairCastSpell(creature, action, state);
      return;
    case 'summon':
      handleLairSummon(creature, action, state);
      return;
    case 'buff_ally':
      handleLairBuffAlly(creature, action, state);
      return;
    case 'debuff_enemy':
      handleLairDebuffEnemy(creature, action, state);
      return;
    case 'visibility':
      handleLairVisibility(creature, action, state);
      return;
    case 'movement':
      handleLairMovement(creature, action, state);
      return;
    case 'save_only':
      handleLairSaveOnly(creature, action, state);
      return;
    case 'bespoke':
      handleLairBespoke(creature, action, state);
      return;
    default:
      // Unknown category (shouldn't happen — `flavor` and `deferred` are
      // intercepted by `resolveLairActions` before reaching here; all valid
      // `LairActionCategory` values have a case above). Log defensively.
      log(state, 'action', creature.id,
        `  → [${action.category}] handler not yet implemented — no mechanical effect`,
        undefined);
      return;
  }
}

// ============================================================
// Session 93 — RFC-LAIRACTIONS Phase 3a: damage/save family handlers
//
// These four handlers cover 110 + 23 + 5 + 2 = 140 of the 324 lair actions
// (43% of the total corpus). They reuse existing engine infrastructure:
//   - `rollSave` (utils.ts:147) — handles advantage/disadvantage, Bardic
//     Inspiration, Bless/Bane, Warding Bond, Diamond Soul, Legendary
//     Resistance, Magic Resistance, condition penalties (poisoned, exhaustion
//     level 3+), and listed-save-bonus override.
//   - `applyDamageWithTempHP` (utils.ts:1316) — handles immunity, vulnerability,
//     resistance, temp HP absorption, regeneration suppression.
//   - `addCondition` (utils.ts:551) — handles condition immunity, Nature's
//     Ward, cascade (paralyzed/stunned/petrified → incapacitated), auto-break
//     concentration.
//   - `livingEnemiesOf` / `livingAlliesOf` (movement.ts:492/498) — faction
//     filtering.
//   - `combatantsWithinRadiusFt` (movement.ts:510) — radius targeting.
//   - `initMonsterSpellSlots` (monster_spellcasting.ts:837) — lazily
//     populates the runtime slot tracker for the Lich's spell_slot_regen.
//
// Targeting model (RFC §6.2 + §7):
//   - `targetsEnemies === true`  → lair creature's enemies are targets.
//   - `targetsEnemies === false` → lair creature's allies (incl. self) are targets.
//   - `rangeFt`     → max distance from the lair creature (Chebyshev ft).
//   - `radiusFt`    → AoE radius centered on the lair creature (when the
//                     action text says "within N feet of it"). For actions
//                     that center on a chosen point ("centered on a point
//                     the dragon chooses within 120 feet of it"), we use the
//                     lair creature's position as a simplification — the
//                     magma/cloud/etc. still hits all valid targets within
//                     rangeFt of the lair creature. This is a v1
//                     simplification (true point-selection AI is Phase 4).
//   - `targetFilter` → creature-type filter (pipe-separated, e.g. 'gnoll|hyena').
//                     Matched against `creatureType` (lowercased substring).
//
// Save model (RFC §6.3):
//   - `saveDC` + `saveAbility` extracted from `@dc N` + "Dexterity saving throw".
//   - On FAILED save: full damage + condition applied.
//   - On SUCCESSFUL save: half damage (PHB default for "half on a successful
//     save" — most lair actions follow this convention; the raw text usually
//     says "or half as much damage") and NO condition.
//   - The half-damage-on-success rule is a v1 simplification. A small number
//     of lair actions say "no damage on a successful save" — Phase 5 will
//     add a per-action `halfOnSave: boolean` field to disambiguate. For now,
//     the half-damage default is the safer choice (PHB p.205: "A spell's
//     description specifies whether it targets creatures and what happens to
//     a target that succeeds. ... Half damage is the default for damaging
//     spells, but check the spell.")
// ============================================================

/**
 * Resolve a `save_damage` lair action. Each enemy (or ally, if
 * `!targetsEnemies`) within `rangeFt` rolls `saveAbility` vs `saveDC`; on
 * failure takes full `damage` (via `applyDamageWithTempHP` — immunity/
 * resistance/vulnerability apply), on success takes half.
 *
 * Example: Adult Red Dragon "Magma erupts (DC 15 DEX, 6d6 fire)".
 */
function handleLairSaveDamage(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  if (action.saveDC === undefined || action.saveAbility === undefined) {
    log(state, 'action', creature.id,
      `  → save_damage: missing saveDC/saveAbility — no effect`, undefined);
    return;
  }
  if (!action.damage) {
    log(state, 'action', creature.id,
      `  → save_damage: missing damage roll — no effect`, undefined);
    return;
  }

  const targets = selectLairActionTargets(creature, action, bf);
  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → save_damage: no valid targets in range — no effect`, undefined);
    return;
  }

  for (const target of targets) {
    // Skip the lair creature itself (a dragon doesn't magma itself).
    if (target.id === creature.id) continue;
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, action.saveAbility, action.saveDC);
    const dmgRoll = rollLairDamage(action.damage);
    // Phase 5 (Session 96): `halfOnSave` controls what happens on a successful
    // save. Default true (PHB p.205 — "half damage on a successful save").
    // When false, a successful save negates ALL damage (action text says
    // "no damage on a successful save"). Treat undefined as true (backward
    // compat with synthetic test actions).
    const halfOnSave = action.halfOnSave !== false;
    const dmgFinal = save.success ? (halfOnSave ? Math.floor(dmgRoll / 2) : 0) : dmgRoll;
    const dmgType = (action.damage.type as DamageType) ?? undefined;

    log(state, save.success ? 'save_success' : 'save_fail', creature.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} ${action.saveAbility.toUpperCase()} save ` +
      `(rolled ${save.roll} vs DC ${action.saveDC}) — takes ${dmgFinal} ${action.damage.type} damage ` +
      `(${save.success ? (halfOnSave ? 'half of ' : 'no damage (negated by save) — ') : ''}${dmgRoll})`,
      target.id, dmgFinal);

    if (dmgFinal > 0) {
      const applied = applyDamageWithTempHP(target, dmgFinal, dmgType);
      log(state, 'damage', creature.id,
        `${action.id}: ${target.name} takes ${applied} ${action.damage.type} damage`,
        target.id, applied);
    }

    // Death check (mirror spell-effect pattern).
    if (target.currentHP === 0 && !target.isDead) {
      // applyDamage already set isDead/isUnconscious + conditions.
      log(state, target.isPlayer ? 'unconscious' : 'death', creature.id,
        `${target.name} drops to 0 HP from ${creature.name}'s lair action!`,
        target.id, 0);
    }
  }
}

/**
 * Resolve a `save_condition` lair action. Each enemy (or ally) within
 * `rangeFt` rolls `saveAbility` vs `saveDC`; on FAILURE has all of
 * `action.conditions` applied (via `addCondition` — immunity/cascade apply).
 * On success: no effect.
 *
 * Example: Adult Brass Dragon "DC 15 STR or knocked prone".
 */
function handleLairSaveCondition(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  if (action.saveDC === undefined || action.saveAbility === undefined) {
    log(state, 'action', creature.id,
      `  → save_condition: missing saveDC/saveAbility — no effect`, undefined);
    return;
  }
  if (!action.conditions || action.conditions.length === 0) {
    log(state, 'action', creature.id,
      `  → save_condition: missing conditions — no effect`, undefined);
    return;
  }

  const targets = selectLairActionTargets(creature, action, bf);
  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → save_condition: no valid targets in range — no effect`, undefined);
    return;
  }

  for (const target of targets) {
    if (target.id === creature.id) continue;
    if (target.isDead || target.isUnconscious) continue;

    const save = rollSave(target, action.saveAbility, action.saveDC);
    log(state, save.success ? 'save_success' : 'save_fail', creature.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} ${action.saveAbility.toUpperCase()} save ` +
      `(rolled ${save.roll} vs DC ${action.saveDC})`,
      target.id);

    if (save.success) continue;

    // Save failed → apply each condition (addCondition checks immunity).
    for (const cond of action.conditions) {
      const wasPresent = target.conditions.has(cond);
      addCondition(target, cond);
      log(state, 'condition_add', creature.id,
        `${target.name} gains ${cond} condition${wasPresent ? ' (already present)' : ''} from ${action.id}`,
        target.id);
    }
  }
}

/**
 * Resolve a `damage_no_save` lair action. Each enemy (or ally) within
 * `rangeFt` takes full `damage` (no save — immunity/resistance/vulnerability
 * still apply via `applyDamageWithTempHP`).
 *
 * Example: Adult White Dragon "Jagged ice shards fall, striking up to three
 * creatures (3d6 piercing)".
 */
function handleLairDamageNoSave(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  if (!action.damage) {
    log(state, 'action', creature.id,
      `  → damage_no_save: missing damage roll — no effect`, undefined);
    return;
  }

  const targets = selectLairActionTargets(creature, action, bf);
  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → damage_no_save: no valid targets in range — no effect`, undefined);
    return;
  }

  // Phase 5 (Session 96): `maxTargets` caps the target list. Parsed from
  // "up to N creatures" / "striking up to N creatures" — the White Dragon
  // shards hit "up to three creatures". When undefined, all valid targets
  // in range take damage (v1 behavior). When defined, choose the lowest-
  // current-HP targets first (concentrates damage where it'll drop a target;
  // mirrors the v1 selector's "lowest HP" tie-break in the generic spell
  // targeter).
  let chosenTargets = targets;
  if (action.maxTargets !== undefined && action.maxTargets > 0
      && targets.length > action.maxTargets) {
    chosenTargets = [...targets]
      .filter(t => t.id !== creature.id && !t.isDead && !t.isUnconscious)
      .sort((a, b) => a.currentHP - b.currentHP)
      .slice(0, action.maxTargets);
    log(state, 'action', creature.id,
      `  → damage_no_save: ${targets.length} valid targets in range; ` +
      `capping to ${action.maxTargets} (lowest HP first)`, undefined);
  }

  const dmgType = (action.damage.type as DamageType) ?? undefined;
  let hit = 0;
  for (const target of chosenTargets) {
    if (target.id === creature.id) continue;
    if (target.isDead || target.isUnconscious) continue;

    const dmgRoll = rollLairDamage(action.damage);
    log(state, 'damage', creature.id,
      `${action.id}: ${target.name} takes ${dmgRoll} ${action.damage.type} damage (no save)`,
      target.id, dmgRoll);

    const applied = applyDamageWithTempHP(target, dmgRoll, dmgType);
    if (applied !== dmgRoll) {
      log(state, 'damage', creature.id,
        `  (after immunity/resistance/temp HP: ${applied} effective)`,
        target.id, applied);
    }
    hit++;

    if (target.currentHP === 0 && !target.isDead) {
      log(state, target.isPlayer ? 'unconscious' : 'death', creature.id,
        `${target.name} drops to 0 HP from ${creature.name}'s lair action!`,
        target.id, 0);
    }
  }
  if (hit === 0) {
    log(state, 'action', creature.id,
      `  → damage_no_save: no valid targets hit — no effect`, undefined);
  }
}

/**
 * Resolve a `spell_slot_regen` lair action. The Lich's lair action:
 *   "The lich rolls a d8 and regains a spell slot of that level or lower.
 *    If it has no spent spell slots of that level or lower, nothing happens."
 *
 * Implementation: roll d8 → that's the rolled slot level. Walk levels from
 * `rolledLevel` DOWN to 1; the first level where `monsterSpellSlots[lvl]`
 * has `remaining < max` (a spent slot) gets `remaining += 1`. If no level
 * has a spent slot, log "nothing happens" (the lair action is wasted).
 *
 * If the monster has no `monsterSpellSlots` tracker (e.g., it was never
 * initialized because it hasn't cast a slotted spell yet), call
 * `initMonsterSpellSlots` first to populate it from `monsterSpellcasting.slots`.
 */
function handleLairSpellSlotRegen(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  // Lazily populate the runtime tracker (idempotent — no-op if already set).
  initMonsterSpellSlots(creature);

  if (!creature.monsterSpellSlots) {
    log(state, 'action', creature.id,
      `  → spell_slot_regen: ${creature.name} has no spell slots — nothing happens`, undefined);
    return;
  }

  // Roll d8 → slot level to regain (PHB/Lich lair action).
  const rolledLevel = rollDie(8);
  log(state, 'action', creature.id,
    `  → rolls d8 for spell slot regen: ${rolledLevel}`,
    undefined, rolledLevel);

  // Walk from rolledLevel DOWN to 1; first level with a spent slot regains it.
  let regainedLevel: number | null = null;
  for (let lvl = rolledLevel; lvl >= 1; lvl--) {
    const slot = creature.monsterSpellSlots[lvl];
    if (slot && slot.remaining < slot.max) {
      slot.remaining += 1;
      regainedLevel = lvl;
      break;
    }
  }

  if (regainedLevel === null) {
    log(state, 'action', creature.id,
      `  → no spent spell slots of level ≤ ${rolledLevel} — nothing happens`, undefined);
    return;
  }

  const slot = creature.monsterSpellSlots[regainedLevel];
  log(state, 'heal', creature.id,
    `${creature.name} regains a level-${regainedLevel} spell slot ` +
    `(now ${slot.remaining}/${slot.max})`,
    creature.id, regainedLevel);
}

// ---- Phase 3a helpers ---------------------------------------

/**
 * Select the targets for a lair action based on its `targetsEnemies`,
 * `rangeFt`, and `targetFilter` fields.
 *
 * Returns a list of living, non-dead combatants (does NOT exclude the lair
 * creature itself — handlers do that themselves to keep this helper generic).
 *
 * Targeting model (v1 simplification — Phase 4 will add true point-selection AI):
 *   - If `targetsEnemies`: lair creature's enemies (`livingEnemiesOf`).
 *     Else: lair creature's allies including itself (`livingAlliesOf` + self).
 *   - If `rangeFt` set: only those within `rangeFt` of the lair creature
 *     (Chebyshev distance in feet — 1 square = 5 ft, so distance = chebyshev3D * 5).
 *     This models "the dragon chooses a point within 120 ft of it" as "the
 *     dragon's lair action affects all enemies within 120 ft of the dragon" —
 *     a v1 simplification that over-approximates the AoE (a real dragon would
 *     center the effect on the densest cluster, not on itself).
 *   - `radiusFt` is NOT used for targeting. It represents the AoE size at the
 *     CHOSEN point (e.g., the magma geyser is a 5-ft-radius cylinder), which
 *     would require point-selection AI to place correctly. Phase 4 will add a
 *     `chooseLairActionPoint(action, candidates, bf)` helper that picks the
 *     point maximizing targets hit, at which point `radiusFt` becomes the
 *     targeting constraint. For now, we hit everyone in `rangeFt`.
 *   - If `targetFilter` set: only those whose `creatureType` (lowercased)
 *     contains any of the pipe-separated filter substrings.
 *   - If `rangeFt` is undefined: all living enemies/allies (the action affects
 *     the whole lair — e.g., Androsphinx "every creature in the lair" or
 *     Mummy Lord "each undead in the lair").
 */
function selectLairActionTargets(
  creature: Combatant,
  action: LairAction,
  bf: Battlefield,
): Combatant[] {
  // Base faction filter.
  let candidates: Combatant[] = action.targetsEnemies
    ? livingEnemiesOf(creature, bf)
    : [...livingAlliesOf(creature, bf), creature];  // ally-affecting actions include self

  // Range filter (Chebyshev feet from the lair creature).
  // (radiusFt is intentionally NOT applied here — see doc comment above.)
  if (action.rangeFt !== undefined) {
    candidates = candidates.filter(t =>
      chebyshev3D(creature.pos, t.pos) * 5 <= action.rangeFt!
    );
  }

  // Creature-type filter (e.g., 'undead', 'gnoll|hyena').
  if (action.targetFilter) {
    const filters = action.targetFilter.toLowerCase().split('|').map(s => s.trim());
    candidates = candidates.filter(t => {
      const ct = (t.creatureType ?? '').toLowerCase();
      return filters.some(f => ct.includes(f));
    });
  }

  return candidates;
}

/**
 * Roll a lair-action damage dice expression.
 * `LairAction.damage = { count, sides, type }` — roll `count`d`sides` and sum.
 * (No bonus field on LairAction damage — lair-action damage is always flat
 * NdN + type, no flat bonuses in the parsed 5eTools data.)
 */
function rollLairDamage(dmg: { count: number; sides: number; type: string }): number {
  let total = 0;
  for (let i = 0; i < dmg.count; i++) total += rollDie(dmg.sides);
  return total;
}

// ============================================================
// Session 94 — RFC-LAIRACTIONS Phase 3b: remaining effect handlers
//
// Phase 3a (Session 93) wired the damage/save family (140/324 actions).
// Phase 3b wires the remaining effect-handler categories:
//   - `cast_spell`       (40 actions, 12%) — generic-spell-registry dispatch
//   - `summon`           (22 actions,  7%) — bestiary-backed creature spawn
//   - `buff_ally`        ( 7 actions,  2%) — advantage-on-attacks to allies
//   - `debuff_enemy`     ( 7 actions,  2%) — vulnerability/disadvantage to enemies
//   - `visibility`       (in-scope non-deferred) — battlefield_obstacle obscurement
//   - `movement`         ( 7 actions,  2%) — push/pull via pushAway
//   - `save_only`        (37 actions, 11%) — roll save, log bespoke-pending
//   - `bespoke`          (65 actions, 20%) — per-action.id log; v1 stubs most
//
// Combined with Phase 3a, this brings mechanical coverage to ~245/324 (76%).
// The remaining ~79 actions are `flavor` (6) + `deferred` (16) + unhandled
// `bespoke` (~57) — all logged with their stable IDs for searchability.
//
// v1 simplifications (documented per handler):
//   - `cast_spell`: only spells in the GENERIC_SPELLS registry are executed.
//     Spells with dedicated modules (Fireball, Banishment, etc.) are NOT
//     dispatched here — they'd need their bespoke execute() signatures
//     (which vary: some take (caster, target, state), others (caster, state)).
//     Phase 5 will wire a unified cast dispatch.
//   - `summon`: requires `bf.bestiaryMap` to be populated by the scenario
//     loader / test harness. If absent, logs "bestiary not available".
//   - `buff_ally`/`debuff_enemy`: parses rawText for advantage/disadvantage/
//     vulnerability keywords. Applies a 1-round buff/debuff to matching
//     allies/enemies via `grantSelf`/`grantVulnerability` or direct
//     `damageVulnerabilities` mutation.
//   - `visibility`: applies a `battlefield_obstacle` effect (like Fog Cloud)
//     centered on the lair creature for `durationRounds` (default 1).
//   - `movement`: parses rawText for "pushed/pulled N feet" and applies
//     `pushAway` to each target in range.
//   - `save_only`: rolls the save; on failure logs "bespoke effect not yet
//     implemented" with the action.id (the per-action bespoke effect —
//     push/fall/banish/etc. — is Phase 5 work).
//   - `bespoke`: per-action.id switch; v1 logs "not yet implemented" for
//     all but a few common patterns.
// ============================================================

/**
 * Resolve a `cast_spell` lair action. The lair creature casts the named spell
 * at the parsed `castLevel`. Reuses the GENERIC_SPELLS registry (262 spells).
 *
 * [DD-4] GoI / Counterspell interactions:
 *   - `isSpell: true` actions are blocked by Globe of Invulnerability when
 *     `castLevel ≤ GoI threshold` and the lair creature is outside the barrier.
 *     Phase 5 (Session 96): an EXPLICIT pre-filter now runs before dispatch —
 *     if EVERY potential target in range is GoI-protected (caster outside
 *     barrier), the cast is skipped entirely with a "blocked by GoI" log line.
 *     When only SOME targets are protected, the cast still fires (the spell
 *     module's internal GoI checks will exclude the protected ones — this
 *     matches the regular spell-cast flow's "single-target block, AoE
 *     exclusion is best-effort" semantics).
 *   - Counterspell: the lair creature is the "caster". We do NOT fire
 *     `triggerReactions(state, lairCreature, 'incoming_spell')` here because
 *     lair actions resolve at init count 20 OUTSIDE any actor's turn — the
 *     reaction window is per-turn. A creature that wishes to counterspell a
 *     lair action would need a separate reaction budget. v1 simplification:
 *     lair-action spell casts are NOT counterable. Phase 5 may revisit.
 *
 * v1 simplification: only GENERIC_SPELLS registry spells are executed. Spells
 * with dedicated modules (Fireball, Banishment, Antimagic Field, Command,
 * Darkness, Moonbeam, Simulacrum, Wish) are NOT dispatched here — they have
 * varying execute() signatures. Logged as "spell not in generic registry".
 *
 * Examples:
 *   - Aboleth::0 → phantasmal force (L2) — in registry → executes.
 *   - Zariel::0 → fireball (L3) — NOT in generic registry (has dedicated
 *     module) → logged, no effect.
 *   - Demilich::1 → antimagic field (L8) — NOT in registry → logged.
 */
function handleLairCastSpell(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  if (!action.isSpell || !action.spellName) {
    log(state, 'action', creature.id,
      `  → cast_spell: missing spellName — no effect`, undefined);
    return;
  }

  const castLevel = action.castLevel ?? 1;

  // ── Phase 5 (Session 96) [DD-4]: GoI pre-filter ───────────────────
  // Globe of Invulnerability (PHB p.245): spells of L5 or lower cast from
  // OUTSIDE the barrier can't affect creatures within it. The lair creature
  // is the caster; if every potential target in range is GoI-protected
  // (with the lair creature outside their barrier), the cast has no effect
  // and we skip the dispatch entirely. This makes the GoI block visible in
  // the lair-action log (the generic execute() runs GoI checks internally
  // but only logs at the per-target level, which can be hard to surface in
  // a lair-action context).
  //
  // Cantrips (castLevel ≤ 0) are NEVER blocked by GoI (PHB p.245: "Any spell
  // of 5th level or lower" — cantrips are level 0). The lair creature's own
  // GoI doesn't block their own spell (the creature is INSIDE their own
  // barrier) — `isProtectedByGoI(target, level, bf, casterId)` handles this
  // via the `casterId` spatial check.
  if (castLevel > 0) {
    const potentialTargets = selectLairActionTargets(creature, action, bf)
      .filter(t => t.id !== creature.id)
      .filter(t => !t.isDead && !t.isUnconscious);

    if (potentialTargets.length > 0) {
      const blockedTargets = potentialTargets.filter(t =>
        isProtectedByGoI(t, castLevel, bf, creature.id));
      if (blockedTargets.length === potentialTargets.length) {
        // EVERY target is GoI-protected → cast has no effect.
        log(state, 'action', creature.id,
          `  → cast_spell: "${action.spellName}" (L${castLevel}) blocked by ` +
          `Globe of Invulnerability — all ${blockedTargets.length} target(s) ` +
          `protected (lair creature outside barrier)`,
          undefined);
        return;
      }
      if (blockedTargets.length > 0) {
        // SOME targets protected — log the partial block; the spell module's
        // internal GoI checks will exclude the protected ones at execution.
        log(state, 'action', creature.id,
          `  → cast_spell: "${action.spellName}" (L${castLevel}) — ` +
          `${blockedTargets.length}/${potentialTargets.length} target(s) ` +
          `blocked by Globe of Invulnerability (partial; spell still fires)`,
          undefined);
      }
    }
  }

  const desc = lookupGenericSpell(action.spellName);
  if (!desc) {
    // Spell has a dedicated module (Fireball, Banishment, etc.) or isn't
    // implemented at all. v1: log + skip. Phase 5 will dispatch dedicated
    // modules via a unified cast helper.
    log(state, 'action', creature.id,
      `  → cast_spell: "${action.spellName}" (L${castLevel}) ` +
      `not in GENERIC_SPELLS registry — logged, not executed (Phase 5 will wire dedicated spell modules)`,
      undefined);
    return;
  }

  // Log the spell-cast intent with the cast level.
  log(state, 'action', creature.id,
    `  → casts ${desc.name} (L${castLevel}) via lair action`,
    undefined);

  // Execute the spell. The generic registry's execute() takes (caster, state)
  // and handles target selection / damage / conditions internally.
  // Resource consumption: lair actions do NOT consume the lair creature's
  // spell slots (they're at-will magical effects, not slotted spells). The
  // generic execute() may call consumeSpellSlot() — which is a no-op for
  // monsters (returns null when `resources` is null). This is safe.
  try {
    desc.execute(creature, state);
  } catch (e) {
    // Defensive: if a spell module throws (e.g., expects a target the lair
    // creature can't see), log the error and continue. Don't crash combat.
    log(state, 'action', creature.id,
      `  → cast_spell: "${desc.name}" threw an error — ${e instanceof Error ? e.message : String(e)}`,
      undefined);
  }
}

/**
 * Resolve a `summon` lair action. Spawns `action.summons.count` copies of
 * `action.summons.creature` via `monsterToCombatant`, using the bestiary
 * reference on `Battlefield.bestiaryMap`. The summons share the lair
 * creature's faction and initiative (inserted after the lair creature).
 *
 * v1 simplifications:
 *   - Requires `bf.bestiaryMap` to be populated. If absent, logs "bestiary
 *     not available — cannot spawn" and skips.
 *   - Safety check: if the summons creature name CONTAINS the source creature
 *     name (e.g., summons "Adult Red Dragon" when source is "Red Dragon"),
 *     this is the "Additional Lair Actions" flattening artifact (the intro
 *     text mentions the adult/ancient variant via `@creature` tag, which the
 *     parser mis-classifies as a summon). Skip the spawn and log the artifact.
 *   - Count is parsed from "up to N" or "N <creatures>" patterns; if the
 *     parser couldn't extract it, defaults to 1.
 *   - Summons are NOT concentration-sourced (lair actions don't require
 *     concentration). They persist until killed or combat ends.
 *
 * Examples:
 *   - Lichen Lich::1 → "shambling mound" ×1 — spawns 1 Shambling Mound.
 *   - Red Dragon::3 → "Adult Red Dragon" — artifact, skipped.
 *   - Murgaxor::0 → no summons info parsed → logs "missing summons info".
 */
function handleLairSummon(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;

  if (!action.summons || !action.summons.creature) {
    log(state, 'action', creature.id,
      `  → summon: no summons info parsed from rawText — no effect`,
      undefined);
    return;
  }

  const summonName = action.summons.creature;
  const count = typeof action.summons.count === 'number'
    ? action.summons.count
    : 1;

  // Safety: skip if the summons name contains the source creature name
  // (e.g., "Adult Red Dragon" contains "Red Dragon"). This is the flattening
  // artifact from "Additional Lair Actions" intro text mentioning the
  // adult/ancient variant via `@creature` tag.
  const sourceLower = action.sourceCreature.toLowerCase();
  const summonLower = summonName.toLowerCase();
  if (summonLower.includes(sourceLower) || sourceLower.includes(summonLower)) {
    log(state, 'action', creature.id,
      `  → summon: "${summonName}" appears to be a flattening artifact ` +
      `(matches source creature "${action.sourceCreature}") — skipped`,
      undefined);
    return;
  }

  // Need a bestiary to look up the raw stat block.
  if (!bf.bestiaryMap) {
    log(state, 'action', creature.id,
      `  → summon: bestiary not available on Battlefield — cannot spawn ${count}× ${summonName} (set bf.bestiaryMap to enable)`,
      undefined);
    return;
  }

  const raw = bf.bestiaryMap.get(summonLower) as Raw5etoolsMonster | undefined;
  if (!raw) {
    log(state, 'action', creature.id,
      `  → summon: "${summonName}" not found in bestiary — cannot spawn`,
      undefined);
    return;
  }

  // Spawn N copies. Position: adjacent to the lair creature, spread out so
  // they don't all stack on one square.
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const offset = i + 1;   // 1, 2, 3, ... squares away
    const pos: Vec3 = {
      x: creature.pos.x + offset,
      y: creature.pos.y,
      z: creature.pos.z,
    };
    const profile: AIProfile = 'attackNearest';
    const spawnFaction: 'enemy' | 'neutral' =
      creature.faction === 'party' ? 'enemy' : creature.faction as 'enemy' | 'neutral';
    // (monsterToCombatant only accepts 'enemy' | 'neutral'; we patch faction
    //  to 'party' after if the lair creature is party-aligned.)
    const combatant = monsterToCombatant(raw, pos, profile, spawnFaction);
    if (creature.faction === 'party') combatant.faction = 'party';

    // Tag as lair summon for engine/reporting purposes.
    combatant.isSummon = true;
    combatant.summonerId = creature.id;
    combatant.summonSpellName = `Lair:${action.id}`;

    // Unique ID per spawn.
    combatant.id = `lair_summon_${action.id.replace(/[^a-z0-9]/gi, '_')}_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    combatant.name = `${summonName} (${creature.name} lair)`;

    // Add to battlefield.
    bf.combatants.set(combatant.id, combatant);

    // Insert into initiative after the lair creature.
    if (!bf.pendingInitiativeInserts) bf.pendingInitiativeInserts = [];
    bf.pendingInitiativeInserts.push({
      combatantId: combatant.id,
      insertAfterId: creature.id,
    });

    spawned++;
    log(state, 'action', creature.id,
      `  → summons ${summonName} #${i + 1} (${combatant.maxHP} HP, AC ${combatant.ac})`,
      combatant.id);
  }

  if (spawned === 0) {
    log(state, 'action', creature.id,
      `  → summon: failed to spawn any ${summonName} — no effect`,
      undefined);
  }
}

/**
 * Resolve a `buff_ally` lair action. Applies a 1-round advantage-on-attacks
 * buff to allies of the lair creature (filtered by `targetFilter` if set).
 *
 * v1 simplification:
 *   - Parses rawText for "advantage" + attack/ability/save scope keywords.
 *   - If "advantage" + "attack" found → `grantSelf(ally, 'advantage', 'attack', source, 'until_next_turn')`.
 *   - If "advantage" + "saving throw" found → `grantSelf(ally, 'advantage', 'save', source, 'until_next_turn')`.
 *   - If "advantage" + "ability check" found → `grantSelf(ally, 'advantage', 'ability', source, 'until_next_turn')`.
 *   - If no advantage keyword found → log "buff not parsed — no effect".
 *   - Targets: allies of the lair creature (excluding self) within `rangeFt`
 *     (or all allies if rangeFt undefined), filtered by `targetFilter`.
 *
 * Examples:
 *   - Yeenoghu::0 → "all gnolls and hyenas... advantage on melee weapon attack
 *     rolls" → grantSelf(advantage, 'attack:melee') to gnoll/hyena allies.
 *   - Mummy Lord::1 → "Each undead... advantage on saving throws against
 *     effects that turn undead" → grantSelf(advantage, 'save') to undead allies.
 *   - Elder Brain::2 → "flash of inspiration... advantage on one attack roll,
 *     ability check, or saving throw" → grantSelf(advantage, 'attack') (v1
 *     simplification — grants advantage on attacks only; the "one roll" limit
 *     is Phase 5).
 */
function handleLairBuffAlly(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  const text = action.rawText.toLowerCase();

  // Detect advantage scope from rawText.
  let scope: 'attack' | 'attack:melee' | 'save' | 'ability' | 'all' | null = null;
  if (/advantage\s+on\s+(?:melee\s+)?(?:weapon\s+)?attack/i.test(text)) {
    scope = /melee/i.test(text) ? 'attack:melee' : 'attack';
  } else if (/advantage\s+on\s+saving\s+throws?/i.test(text)) {
    scope = 'save';
  } else if (/advantage\s+on\s+ability\s+checks?/i.test(text)) {
    scope = 'ability';
  } else if (/advantage\s+on\s+attack\s+rolls?,\s+ability\s+checks?,\s+and\s+saving\s+throws/i.test(text)) {
    scope = 'all';
  } else if (/advantage/i.test(text)) {
    scope = 'attack';   // default fallback
  }

  if (!scope) {
    log(state, 'action', creature.id,
      `  → buff_ally: no advantage keyword parsed from rawText — no effect`,
      undefined);
    return;
  }

  // Targets: allies (excluding self), filtered by rangeFt + targetFilter.
  // Reuse selectLairActionTargets but filter out the lair creature itself.
  const targets = selectLairActionTargets(creature, action, bf)
    .filter(t => t.id !== creature.id)
    .filter(t => !t.isDead && !t.isUnconscious);

  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → buff_ally: no valid ally targets in range — no effect`,
      undefined);
    return;
  }

  let buffed = 0;
  for (const ally of targets) {
    grantSelf(ally, 'advantage', scope, `Lair:${action.id}`, 'until_next_turn');
    log(state, 'action', creature.id,
      `  → buff_ally: ${ally.name} gains advantage on ${scope} rolls until its next turn`,
      ally.id);
    buffed++;
  }

  if (buffed === 0) {
    log(state, 'action', creature.id,
      `  → buff_ally: no allies buffed — no effect`, undefined);
  }
}

/**
 * Resolve a `debuff_enemy` lair action. Applies a 1-round debuff to enemies
 * of the lair creature.
 *
 * v1 simplification:
 *   - Parses rawText for "vulnerability" / "disadvantage" keywords.
 *   - If "vulnerability" + damage type found → push to `enemy.damageVulnerabilities`.
 *   - If "disadvantage" + "attack" found → `grantVulnerability(enemy, 'disadvantage', 'attack', source, 'until_next_turn')`.
 *   - If "disadvantage" + "saving throw" found → `grantVulnerability(enemy, 'disadvantage', 'save', source, 'until_next_turn')`.
 *   - If neither found → log "debuff not parsed — no effect".
 *
 * Examples:
 *   - Kraken::1 → "vulnerability to lightning damage" → push 'lightning' to
 *     enemy.damageVulnerabilities for 1 round.
 *   - Fazrian::1 → "disadvantage on saving throws" → grantVulnerability(disadvantage, 'save').
 *   - Graz'zt::1 → "disadvantage on Dexterity (Stealth) checks" → log only
 *     (v1 doesn't model skill-check disadvantage).
 */
function handleLairDebuffEnemy(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  const text = action.rawText.toLowerCase();

  // Detect debuff type from rawText.
  type DebuffKind = 'vulnerability' | 'disadvantage_attack' | 'disadvantage_save' | null;
  let kind: DebuffKind = null;
  let vulnType: string | null = null;

  if (/vulnerability\s+to\s+(\w+)\s+damage/i.test(text)) {
    const m = text.match(/vulnerability\s+to\s+(\w+)\s+damage/i);
    if (m) {
      kind = 'vulnerability';
      vulnType = m[1].toLowerCase();
    }
  } else if (/disadvantage\s+on\s+saving\s+throws?/i.test(text)) {
    kind = 'disadvantage_save';
  } else if (/disadvantage\s+on\s+(?:melee\s+|ranged\s+)?attack/i.test(text)) {
    kind = 'disadvantage_attack';
  } else if (/disadvantage\s+on\s+dexterity/i.test(text)) {
    // Skill-check disadvantage (Stealth, etc.) — v1 doesn't model this.
    kind = null;
  }

  if (!kind) {
    log(state, 'action', creature.id,
      `  → debuff_enemy: no vulnerability/disadvantage keyword parsed — no effect`,
      undefined);
    return;
  }

  // Targets: enemies of the lair creature, filtered by rangeFt + targetFilter.
  const targets = selectLairActionTargets(creature, action, bf)
    .filter(t => t.id !== creature.id)
    .filter(t => !t.isDead && !t.isUnconscious);

  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → debuff_enemy: no valid enemy targets in range — no effect`,
      undefined);
    return;
  }

  let debuffed = 0;
  for (const enemy of targets) {
    if (kind === 'vulnerability' && vulnType) {
      // Session 103: track as an ActiveEffect with per-source expiry instead
      // of a permanent combat-long mutation. The effect mirrors the vuln type
      // into `enemy.damageVulnerabilities` on apply (so applyDamageWithTempHP
      // doubles incoming damage of that type, PHB p.197) and the
      // effect_pipeline's `reevaluateEffects` splices it back out at the start
      // of a later round once `sourceTurnExpires` has passed (default 1-round
      // duration = "until next initiative count 20", per the lair-action text).
      //
      // The `addedVulnerability` flag (mirroring the Session 36
      // Protection-from-Energy `addedResistance` fix) records whether THIS
      // effect actually pushed the type — if the enemy had innate vuln to the
      // same type (or another active effect already added it), the push is a
      // no-op and undoEffect won't wrongly splice the innate entry out.
      const VALID_DAMAGE_TYPES: ReadonlySet<string> = new Set([
        'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
        'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing',
        'thunder',
      ]);
      if (!VALID_DAMAGE_TYPES.has(vulnType)) {
        // The parser's `(\w+)` capture could yield a non-damage word (e.g. a
        // skill or damage type the engine doesn't model). Skip rather than
        // push garbage into damageVulnerabilities.
        log(state, 'action', creature.id,
          `  → debuff_enemy: ${enemy.name} — unrecognised vulnerability type "${vulnType}" — no effect`,
          enemy.id);
        continue;
      }
      const dt = vulnType as DamageType;
      const alreadyPresent = enemy.damageVulnerabilities?.includes(dt) ?? false;
      const durationRounds = action.durationRounds ?? 1;
      const effect: Omit<ActiveEffect, 'id'> = {
        casterId: creature.id,
        spellName: `Lair:${action.id}`,
        effectType: 'damage_vulnerability',
        payload: { damageType: dt, addedVulnerability: !alreadyPresent },
        sourceIsConcentration: false,
        appliedTurn: bf.round,
        // Expire at the END of the durationRounds-th round after application
        // (mirrors handleLairVisibility). appliedTurn = round N →
        // sourceTurnExpires = N + durationRounds - 1, so a 1-round vuln
        // expires at the start of round N+1.
        sourceTurnExpires: bf.round + durationRounds - 1,
      };
      applySpellEffect(enemy, effect);
      log(state, 'action', creature.id,
        `  → debuff_enemy: ${enemy.name} gains vulnerability to ${vulnType} damage ` +
        `(${durationRounds}-round duration, auto-expires at round ${bf.round + durationRounds})`,
        enemy.id);
    } else if (kind === 'disadvantage_attack') {
      grantVulnerability(enemy, 'disadvantage', 'attack', `Lair:${action.id}`, 'until_next_turn');
      log(state, 'action', creature.id,
        `  → debuff_enemy: ${enemy.name} has disadvantage on attack rolls until its next turn`,
        enemy.id);
    } else if (kind === 'disadvantage_save') {
      grantVulnerability(enemy, 'disadvantage', 'save', `Lair:${action.id}`, 'until_next_turn');
      log(state, 'action', creature.id,
        `  → debuff_enemy: ${enemy.name} has disadvantage on saving throws until its next turn`,
        enemy.id);
    }
    debuffed++;
  }

  if (debuffed === 0) {
    log(state, 'action', creature.id,
      `  → debuff_enemy: no enemies debuffed — no effect`, undefined);
  }
}

/**
 * Resolve a `visibility` lair action. Applies a `battlefield_obstacle` effect
 * (like Fog Cloud) centered on the lair creature, blocking vision for
 * `durationRounds` (default 1 — "until next initiative count 20").
 *
 * v1 simplification:
 *   - Obstacle is a square centered on the lair creature with side length
 *     derived from `radiusFt` (default 20 ft → 9×9 grid: radius 2 squares
 *     each side + center = 5 squares wide; we use 2*radiusFt/5 + 1).
 *   - `blocksVision: true`, `blocksMovement: false`, `isMagicalDarkness: false`
 *     (normal obscurement, not magical darkness).
 *   - Phase 6 (Session 97): the obstacle auto-expires after `durationRounds`
 *     rounds via `sourceTurnExpires` on the ActiveEffect. The effect_pipeline's
 *     `reevaluateEffects` runs at the start of each combatant's turn and calls
 *     `removeBattlefieldObstacle` for expired `battlefield_obstacle` effects.
 *     Default durationRounds = 1 ("until initiative count 20 on the next round").
 *
 * Examples:
 *   - Bronze Dragon::0 → "fog cloud" (already a cast_spell action — this
 *     handler only fires for actions categorized as `visibility`, which are
 *     the in-scope non-deferred obscurement actions).
 */
function handleLairVisibility(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  const radiusFt = action.radiusFt ?? 20;
  const radiusSquares = Math.max(1, Math.floor(radiusFt / 5));

  // Build the obstacle (square centered on the lair creature).
  const obstacleId = `lair_vis_${action.id.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const obstacle: Obstacle = {
    id: obstacleId,
    x: creature.pos.x - radiusSquares,
    y: creature.pos.y - radiusSquares,
    z: creature.pos.z,
    width: radiusSquares * 2 + 1,
    depth: radiusSquares * 2 + 1,
    height: 1,
    blocksMovement: false,
    blocksVision: true,
    // isMagicalDarkness NOT set — lair-action obscurement is normal fog/dust,
    // not magical darkness. Darkvision can see through it.
  };

  if (!bf.obstacles) bf.obstacles = [];
  bf.obstacles.push(obstacle);

  // Apply an ActiveEffect on the lair creature so the obstacle can be
  // cleaned up if the lair creature dies (via removeEffectsFromCaster).
  // v1: sourceIsConcentration = false (lair actions don't require conc).
  // Phase 6 (Session 97): set sourceTurnExpires so the obstacle auto-expires
  // after durationRounds. The effect_pipeline's reevaluateEffects (called at
  // the start of each combatant's turn) removes expired effects and calls
  // removeBattlefieldObstacle for battlefield_obstacle effects.
  const durationRounds = action.durationRounds ?? 1;
  const effect: Omit<ActiveEffect, 'id'> = {
    casterId: creature.id,
    spellName: `Lair:${action.id}`,
    effectType: 'battlefield_obstacle',
    payload: {
      obstacleId,
      obstacleCenterX: creature.pos.x,
      obstacleCenterY: creature.pos.y,
      obstacleCenterZ: creature.pos.z,
      obstacleRadiusFt: radiusFt,
    },
    sourceIsConcentration: false,
    appliedTurn: bf.round,
    // Expire at the END of the durationRounds-th round after application.
    // (appliedTurn = round N → sourceTurnExpires = N + durationRounds - 1
    //  so a 1-round obstacle expires at the start of round N+1.)
    sourceTurnExpires: bf.round + durationRounds - 1,
  };
  applySpellEffect(creature, effect);

  log(state, 'action', creature.id,
    `  → visibility: ${radiusFt}-ft-radius obscurement centered on ${creature.name} ` +
    `(blocks vision, ${durationRounds}-round duration, auto-expires at round ${bf.round + durationRounds})`,
    undefined);
}

/**
 * Resolve a `movement` lair action. Pushes each enemy within `rangeFt` away
 * from the lair creature by a distance parsed from rawText (default 10 ft).
 *
 * v1 simplification:
 *   - Parses rawText for "pushed/pulled/moved up to N feet" → pushFt.
 *   - No saveDC for movement actions (the parser didn't extract one) — v1
 *     applies the push automatically to all enemies in range. Phase 5 will
 *     add per-action save mechanics when the parser extracts save info.
 *   - Push direction: away from the lair creature (uses `pushAway`).
 *
 * Examples:
 *   - Yeenoghu::1 → "iron spike... DC 24 DEX or 6d8 piercing + restrained" —
 *     this is actually categorized as `save_only` (has DC + damage + condition
 *     via the spike's effect, not the movement). The pure-movement actions
 *     are like "each gnoll or hyena... can use its reaction to move up to its
 *     speed" — these grant movement to ALLIES, not push enemies.
 *
 * For v1, we handle the "push enemies" pattern. "Grant movement to allies" is
 * a buff_ally effect (logged but not mechanically applied — would need a
 * reaction-budget grant, which is Phase 5).
 */
function handleLairMovement(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  const text = action.rawText.toLowerCase();

  // Parse push/pull distance from rawText.
  let moveFt = 10;   // default
  const pushMatch = text.match(/pushed\s+(?:up\s+to\s+)?(\d+)\s+feet/i);
  const pullMatch = text.match(/pulled\s+(?:up\s+to\s+)?(\d+)\s+feet/i);
  const moveMatch = text.match(/moves?\s+up\s+to\s+(?:its\s+)?(\d+)\s+feet/i);
  if (pushMatch) moveFt = parseInt(pushMatch[1], 10);
  else if (pullMatch) moveFt = parseInt(pullMatch[1], 10);
  else if (moveMatch) moveFt = parseInt(moveMatch[1], 10);

  // Detect "grant movement to allies" pattern (Yeenoghu::2, Zuggtmoy::0/1).
  // These let allies use their reaction to move. v1: log + no mechanical
  // effect (would need a reaction-budget grant — Phase 5).
  if (/reaction\s+to\s+move/i.test(text) || /can\s+use\s+(?:its|their)\s+reaction/i.test(text)) {
    log(state, 'action', creature.id,
      `  → movement: "grant reaction-move to allies" pattern — logged, not yet implemented (Phase 5: reaction-budget grant)`,
      undefined);
    return;
  }

  // Targets: enemies of the lair creature, filtered by rangeFt + targetFilter.
  const targets = selectLairActionTargets(creature, action, bf)
    .filter(t => t.id !== creature.id)
    .filter(t => !t.isDead && !t.isUnconscious);

  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → movement: no valid enemy targets in range — no effect`,
      undefined);
    return;
  }

  let moved = 0;
  for (const target of targets) {
    const oldPos = { ...target.pos };
    const newPos = pushMatch
      ? pushAway(target, creature.pos, moveFt)
      : pullMatch
        ? pullTowardLair(target, creature.pos, moveFt)
        : pushAway(target, creature.pos, moveFt);   // default to push

    if (newPos.x !== oldPos.x || newPos.y !== oldPos.y) {
      log(state, 'action', creature.id,
        `  → movement: ${target.name} ${pushMatch ? 'pushed' : pullMatch ? 'pulled' : 'moved'} ${moveFt} ft ` +
        `(from (${oldPos.x},${oldPos.y}) to (${newPos.x},${newPos.y}))`,
        target.id);
      moved++;
    } else {
      log(state, 'action', creature.id,
        `  → movement: ${target.name} couldn't be moved (blocked or same position)`,
        target.id);
    }
  }

  if (moved === 0) {
    log(state, 'action', creature.id,
      `  → movement: no targets moved — no effect`, undefined);
  }
}

/**
 * Pull a target toward a source position by `pullFt` feet.
 * (Helper for `handleLairMovement` — movement.ts has `pullToward` but it's
 * not imported. We use a simple inline implementation that mirrors `pushAway`
 * but inverts the direction.)
 */
function pullTowardLair(target: Combatant, sourcePos: Vec3, pullFt: number): Vec3 {
  if (target.isDead || target.isUnconscious) return { ...target.pos };
  const squares = Math.floor(pullFt / 5);
  if (squares <= 0) return { ...target.pos };

  const dx = sourcePos.x - target.pos.x;   // toward source
  const dy = sourcePos.y - target.pos.y;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist === 0) return { ...target.pos };

  const dirX = dx === 0 ? 0 : dx / Math.abs(dx);
  const dirY = dy === 0 ? 0 : dy / Math.abs(dy);
  // Don't pull past the source.
  const moveSquares = Math.min(squares, dist - 1);
  if (moveSquares <= 0) return { ...target.pos };

  const dest: Vec3 = {
    x: target.pos.x + dirX * moveSquares,
    y: target.pos.y + dirY * moveSquares,
    z: target.pos.z,
  };
  target.pos = dest;
  return dest;
}

/**
 * Phase 7 batch 2 (Session 99): Establish a Warding Bond TETHER (Lich::1,
 * Illithilich::1). The lair creature picks one target in range and tethers
 * them. From now until the next initiative count 20, whenever the lair
 * creature takes damage, the tethered target must make a CON save (DC 18);
 * on fail, the lair creature takes half damage and the target takes the rest.
 *
 * This function ONLY establishes the tether (sets `Combatant.lairWardingBondTether`
 * on the lair creature). The reactive damage-split is handled by
 * `applyLairWardingBondTetherRedirect`, which is called from the 4 damage
 * hook sites (the same sites that call `applyWardingBondRedirect`).
 *
 * The tether is cleared by `resolveLairActions` at the start of each lair-
 * action checkpoint (the tether lasts "until initiative count 20 on the next
 * round"). It's also cleared lazily in the redirect hook when the target dies
 * or the expiry round passes.
 */
function handleLairWardingBondTetherSetup(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  if (action.saveDC === undefined) {
    log(state, 'action', creature.id,
      `  → save_only: warding-bond tether — missing saveDC — no effect`, undefined);
    return;
  }
  let targets = selectLairActionTargets(creature, action, bf)
    .filter(t => t.id !== creature.id)
    .filter(t => !t.isDead && !t.isUnconscious);
  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → save_only: warding-bond tether — no valid targets in range — no effect`, undefined);
    return;
  }
  // Single-target (maxTargets=1 from "targets one creature").
  if (action.maxTargets !== undefined && action.maxTargets > 0
      && targets.length > action.maxTargets) {
    targets = targets.slice(0, action.maxTargets);
    log(state, 'action', creature.id,
      `  → save_only: single-target tether — picking first valid target`, undefined);
  }
  const target = targets[0];
  // Establish the tether on the lair creature (the damagee). The CON save
  // rolls when the lair creature takes damage (not now).
  creature.lairWardingBondTether = {
    targetId: target.id,
    saveDC: action.saveDC,
    sourceActionId: action.id,
    expiresAtRound: state.battlefield.round + 1,
  };
  log(state, 'action', creature.id,
    `  → save_only: WARDING BOND TETHER established — ${target.name} tethered to ${creature.name} ` +
    `(CON DC ${action.saveDC} on ${creature.name}'s next damage-taken; expires at init-20 round ${state.battlefield.round + 1})`,
    target.id);
}

/**
 * Phase 7 batch 2 (Session 99): Reactive damage-split hook for the Warding
 * Bond TETHER (Lich::1, Illithilich::1). Called at the 4 damage-hook sites
 * (alongside `applyWardingBondRedirect`). When the damagee has a tether:
 *   - The tethered target rolls CON vs tether.saveDC.
 *   - On SUCCESS: no effect — the lair creature takes full damage (already
 *     applied), the target takes none.
 *   - On FAILURE: the lair creature takes half the damage (rounded down) and
 *     the target takes the remainder. Since `dealt` was already applied to
 *     the lair creature, we HEAL BACK the target's share (ceil(dealt/2)) and
 *     apply that share to the target. The healback is correct because `dealt`
 *     is the actual damage taken (post-temp-HP, post-resistance, capped at
 *     current HP) — healing back `ceil(dealt/2)` leaves the lair creature
 *     with `floor(dealt/2)` effective damage taken (exactly "half, rounded
 *     down" per the text).
 *
 * The tether's damage type for the target share is `null` (untyped) —
 * consistent with the existing `applyWardingBondRedirect` spell handler. The
 * text says "the target takes the remaining damage" without specifying a type
 * change, but we don't have the original damage type at this hook point. The
 * target's resistance/immunity is NOT checked (acceptable v1 simplification).
 */
function applyLairWardingBondTetherRedirect(
  lich: Combatant,
  dealt: number,
  state: EngineState,
): void {
  if (!lich.lairWardingBondTether || dealt <= 0) return;
  const tether = lich.lairWardingBondTether;
  // Lazy expiry: clear if the expiry round has passed (the next init-20 checkpoint).
  if (state.battlefield.round >= tether.expiresAtRound) {
    lich.lairWardingBondTether = null;
    return;
  }
  const target = state.battlefield.combatants.get(tether.targetId);
  if (!target || target.isDead || target.isUnconscious) {
    // Target died/fled — tether breaks silently.
    lich.lairWardingBondTether = null;
    return;
  }
  // Target rolls CON save vs tether.saveDC.
  const save = rollSave(target, 'con', tether.saveDC);
  if (save.success) {
    log(state, 'save_success', lich.id,
      `${target.name} succeeds CON save vs Warding Bond tether (DC ${tether.saveDC}, rolled ${save.roll}) — ${lich.name} takes full damage`,
      target.id);
    return;
  }
  // Fail: Lich takes half (rounded down), target takes the remainder.
  const lichHalf = Math.floor(dealt / 2);
  const targetShare = dealt - lichHalf;
  // Healback: restore the target's share to the Lich (capped at maxHP).
  const lichHPBeforeHeal = lich.currentHP;
  lich.currentHP = Math.min(lich.maxHP, lich.currentHP + targetShare);
  const healed = lich.currentHP - lichHPBeforeHeal;
  // Apply targetShare to the tether target (null type — see doc comment above).
  const targetDealt = applyDamageWithTempHP(target, targetShare, null);
  log(state, 'save_fail', lich.id,
    `${target.name} fails CON save vs Warding Bond tether (DC ${tether.saveDC}, rolled ${save.roll}) — ` +
    `${lich.name} takes ${lichHalf} (half${healed > 0 ? `, healed ${healed} back` : ''}), ${target.name} takes ${targetDealt} (remainder)`,
    target.id, targetDealt);
  checkDeath(target, state);
}

/**
 * Phase 8 batch 3 (Session 102): Reactive damage-redirect hook for Demogorgon::1
 * Illusory Duplicate. Called at the 3 attack-damage hook sites in resolveAttack
 * (save-based damage, auto-hit damage, weapon-hit damage — NOT fall damage at
 * site 2838, since fall damage isn't an "attack interaction").
 *
 * When the damagee has an active illusory duplicate:
 *   - The first attack that deals damage triggers a 50% coin-flip (1d100 ≤ 50).
 *   - On SUCCESS (≤50): the illusory duplicate absorbs the hit — heal back the
 *     full damage amount (capped at maxHP), log "illusory duplicate absorbs
 *     the hit and disappears", clear the field. The damagee takes NO damage.
 *   - On FAILURE (>50): the damagee takes the hit normally (damage already
 *     applied), log "illusory duplicate fails to redirect — damagee takes the
 *     hit", clear the field.
 *   - Either way, the duplicate's redirect is consumed (the "first time"
 *     trigger is used up per the text: "The FIRST time a creature or an object
 *     interacts physically with Demogorgon").
 *
 * The healback mirrors `applyLairWardingBondTetherRedirect`'s approach: since
 * `dealt` was already applied to the damagee via `applyDamageWithTempHP`, we
 * heal back the full amount (capped at maxHP) on a successful redirect. This
 * correctly models "the illusory duplicate is affected, not Demogorgon".
 *
 * v1 simplifications:
 *   - The redirect chance is hardcoded at 50% (matches Demogorgon::1's
 *     {@chance 50}). Phase 9+ may parameterize if other creatures use a
 *     different chance.
 *   - The redirect fires on the first damage instance from an attack (dealt >
 *     0). A hit that deals 0 damage (immunity) does NOT consume the redirect.
 *   - "Object interacts physically" (e.g., a trap) is NOT modeled — only
 *     attack damage triggers the redirect.
 */
function applyLairIllusoryDuplicateRedirect(
  damagee: Combatant,
  dealt: number,
  state: EngineState,
): void {
  if (!damagee.lairIllusoryDuplicate || dealt <= 0) return;
  const dup = damagee.lairIllusoryDuplicate;
  // Lazy expiry: clear if the expiry round has passed (the next init-20 checkpoint).
  if (state.battlefield.round >= dup.expiresAtRound) {
    damagee.lairIllusoryDuplicate = null;
    return;
  }
  // Roll 1d100 for the 50% coin-flip.
  const roll = rollDie(100);
  const redirected = roll <= 50;
  if (redirected) {
    // Heal back the full damage amount (capped at maxHP). This models "the
    // illusory duplicate is affected, not Demogorgon" — the damagee takes no
    // net damage from this hit.
    const hpBeforeHeal = damagee.currentHP;
    damagee.currentHP = Math.min(damagee.maxHP, damagee.currentHP + dealt);
    const healed = damagee.currentHP - hpBeforeHeal;
    log(state, 'action', damagee.id,
      `${damagee.name}'s illusory duplicate absorbs the hit (1d100=${roll} ≤ 50) — ${damagee.name} takes NO damage${healed > 0 ? ` (healed ${healed} back)` : ''}! The illusory duplicate disappears.`,
      damagee.id, healed);
  } else {
    log(state, 'action', damagee.id,
      `${damagee.name}'s illusory duplicate fails to redirect (1d100=${roll} > 50) — ${damagee.name} takes the full ${dealt} damage. The illusory duplicate is consumed.`,
      damagee.id, dealt);
  }
  // Either way, the duplicate's redirect is consumed (the "first time" trigger).
  damagee.lairIllusoryDuplicate = null;
}

/**
 * Resolve a `save_only` lair action. Each target rolls `saveAbility` vs
 * `saveDC`; on failure, the bespoke effect (push/fall/banish/etc.) is logged
 * as "not yet implemented" with the action.id. On success, no effect.
 *
 * v1 simplification:
 *   - The save roll is real (uses `rollSave` — advantage/etc. apply).
 *   - The bespoke effect on failure is NOT mechanically applied — the per-
 *     action effect varies (Kraken push, Gold Dragon banish, Lich warding
 *     bond, etc.) and each needs a hand-written handler. Phase 5 will add
 *     per-action.id bespoke handlers.
 *   - The save event is logged with the rolled value vs DC, so the test
 *     harness can verify the save fired.
 *
 * Examples:
 *   - Kraken::0 → DC 23 STR or pushed 60 ft (push 10 ft on success).
 *   - Gold Dragon::1 → DC 15 CHA or banished to dream plane.
 *   - Lich::1 → DC 18 CON (warding-bond-style damage share).
 *   - Androsphinx::0/1 → DC 18 CHA/WIS (roar / silence).
 */
function handleLairSaveOnly(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;

  // ── Phase 7 batch 2 (Session 99): Warding Bond tether (Lich::1, Illithilich::1). ──
  // The lair action ESTABLISHES the tether; the CON save is rolled reactively
  // when the lair creature takes damage (not at lair-action time). So we skip
  // the normal save loop entirely and just set `Combatant.lairWardingBondTether`.
  if (action.lairWardingBondTether) {
    handleLairWardingBondTetherSetup(creature, action, state);
    return;
  }

  // ── Phase 7 batch 2: object-move & environment-manipulation have @dc tags ──
  // that are CHECK DCs (not save DCs). The handler skips the save roll and
  // logs the action (v1 doesn't model battlefield objects or doors).
  if (action.objectMove) {
    log(state, 'action', creature.id,
      `  → save_only: ${action.id} object-move — no combat-relevant object on battlefield (v1: log-only, no mechanical effect)`,
      undefined);
    return;
  }
  if (action.environmentManipulation) {
    log(state, 'action', creature.id,
      `  → save_only: ${action.id} environment-manipulation — doors/windows open/close (v1: log-only, no obstacle model)`,
      undefined);
    return;
  }

  if (action.saveDC === undefined || action.saveAbility === undefined) {
    log(state, 'action', creature.id,
      `  → save_only: missing saveDC/saveAbility — no effect`, undefined);
    return;
  }

  let targets = selectLairActionTargets(creature, action, bf)
    .filter(t => t.id !== creature.id)
    .filter(t => !t.isDead && !t.isUnconscious);

  if (targets.length === 0) {
    log(state, 'action', creature.id,
      `  → save_only: no valid targets in range — no effect`, undefined);
    return;
  }

  // Phase 7 (Session 98): honor `maxTargets` — the single-target patterns
  // (Balhannoth teleport, Elder Brain speed-zero) parse to maxTargets=1.
  // The handler picks the first valid target (the lair creature's choice is
  // arbitrary; the lowest-HP sort used by damage_no_save is unnecessary here
  // since these effects don't deal damage — they just relocate/debuff).
  if (action.maxTargets !== undefined && action.maxTargets > 0
      && targets.length > action.maxTargets) {
    targets = targets.slice(0, action.maxTargets);
    log(state, 'action', creature.id,
      `  → save_only: ${targets.length === 1 ? 'single-target action — picking first valid target' : `capping to ${action.maxTargets} targets`}`,
      undefined);
  }

  // Phase 6 (Session 97) + Phase 7 (Session 98): determine which bespoke
  // effect(s) to apply. The handler checks each field; if none are set, falls
  // back to the "not yet implemented" log (the remaining unmatched save_only
  // actions — Phase 8+ per-action.id handlers).
  const hasPush = action.pushFt !== undefined && action.pushFt > 0;
  const hasBanish = action.banished === true;
  const hasConds = action.applyConditions !== undefined && action.applyConditions.length > 0;
  const hasTeleport = action.teleportToSource === true;
  const hasSpeedZero = action.speedZero === true;
  const hasDisadv = action.disadvOnAttacks === true;

  // ── Phase 7 batch 2 (Session 99): age-alteration (Sphinx::1). ──
  // The @dc 15 IS a real CON save vs aging. On fail, roll 1d20 for the age
  // delta (flavor-only — no age-based mechanics in 5e combat). A greater
  // restoration spell can restore the age (not modeled in v1).
  if (action.ageAlteration) {
    for (const target of targets) {
      const save = rollSave(target, action.saveAbility, action.saveDC);
      log(state, save.success ? 'save_success' : 'save_fail', creature.id,
        `${target.name} ${save.success ? 'succeeds' : 'fails'} ${action.saveAbility.toUpperCase()} save ` +
        `(rolled ${save.roll} vs DC ${action.saveDC})`,
        target.id);
      if (save.success) continue;
      const ageDelta = rollDie(20);
      const direction = rollDie(2) === 1 ? 'older' : 'younger';
      log(state, 'action', creature.id,
        `  → ${target.name} becomes ${ageDelta} years ${direction} (flavor-only — no age-based mechanics in 5e combat; greater restoration can restore)`,
        target.id);
    }
    return;
  }

  for (const target of targets) {
    const save = rollSave(target, action.saveAbility, action.saveDC);
    log(state, save.success ? 'save_success' : 'save_fail', creature.id,
      `${target.name} ${save.success ? 'succeeds' : 'fails'} ${action.saveAbility.toUpperCase()} save ` +
      `(rolled ${save.roll} vs DC ${action.saveDC})`,
      target.id);

    if (save.success) {
      // Half-effect on success: push (Kraken "10 feet on a successful save").
      if (hasPush && action.successPushFt !== undefined && action.successPushFt > 0) {
        const origPos = { ...target.pos };
        const newPos = action.pushDirection === 'pull'
          ? pullToward(target, creature.pos, action.successPushFt)
          : pushAway(target, creature.pos, action.successPushFt);
        if (newPos.x !== origPos.x || newPos.y !== origPos.y) {
          log(state, 'move', creature.id,
            `  → ${target.name} ${action.pushDirection === 'pull' ? 'pulled' : 'pushed'} ${action.successPushFt} ft ` +
            `(success half-effect) → (${newPos.x},${newPos.y})`,
            target.id);
          target.pos = newPos;
        }
      }
      continue;
    }

    // On failure: apply the bespoke effect(s).
    let applied = false;

    // 1. Push/pull.
    if (hasPush) {
      const pushDist = action.pushFt!;
      const origPos = { ...target.pos };
      const newPos = action.pushDirection === 'pull'
        ? pullToward(target, creature.pos, pushDist)
        : pushAway(target, creature.pos, pushDist);
      if (newPos.x !== origPos.x || newPos.y !== origPos.y) {
        log(state, 'move', creature.id,
          `  → ${target.name} ${action.pushDirection === 'pull' ? 'pulled' : 'pushed'} ${pushDist} ft ` +
          `→ (${newPos.x},${newPos.y})`,
          target.id);
        target.pos = newPos;
      }
      applied = true;  // push was applied (even if position unchanged at map edge)
    }

    // 2. Banished (incapacitated for durationRounds; non-native permanently removed).
    if (hasBanish) {
      const creatureType = (target.creatureType ?? '').toLowerCase();
      const NON_NATIVE = new Set(['fey', 'elemental', 'celestial', 'fiend', 'undead']);
      if (NON_NATIVE.has(creatureType)) {
        // Permanently removed (mirrors the Banishment spell module).
        target.isDead = true;
        target.currentHP = 0;
        log(state, 'death', creature.id,
          `  → ${target.name} BANISHED to its home plane (${creatureType}) — permanently removed!`,
          target.id, 0);
      } else {
        // Demiplane: incapacitated for durationRounds.
        addCondition(target, 'incapacitated');
        log(state, 'condition_add', creature.id,
          `  → ${target.name} BANISHED to a demiplane (incapacitated) from ${action.id}`,
          target.id);
      }
      applied = true;
    }

    // 3. Apply-conditions (stunned, restrained, etc.).
    if (hasConds) {
      for (const cond of action.applyConditions!) {
        const wasPresent = target.conditions.has(cond);
        addCondition(target, cond);
        log(state, 'condition_add', creature.id,
          `  → ${target.name} gains ${cond} condition${wasPresent ? ' (already present)' : ''} from ${action.id}`,
          target.id);
      }
      applied = true;
    }

    // 4. Phase 7 (Session 98): teleport-to-source (Balhannoth).
    //    Relocate target to an adjacent square of the lair creature (5 ft
    //    away — within teleportFt default 60 ft). Phase 8+ may add point-
    //    selection for optimal placement (e.g., next to a hazardous terrain
    //    feature, or to set up an OA-bait).
    if (hasTeleport) {
      const origPos = { ...target.pos };
      // Pick the first adjacent square that's within teleportFt of the lair
      // creature (which any adjacent square is, since teleportFt ≥ 5).
      // Adjacency: 8 neighbors (Chebyshev distance 1 square = 5 ft).
      // For simplicity, pick the square directly toward the lair creature
      // (mirroring pullToward's "stop 1 square short" behavior).
      const dx = creature.pos.x - target.pos.x;
      const dy = creature.pos.y - target.pos.y;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      let dest: Vec3;
      if (dist === 0) {
        // Already on top of the lair creature — pick any adjacent square.
        dest = { x: creature.pos.x + 1, y: creature.pos.y, z: creature.pos.z };
      } else {
        // Stop 1 square short of the lair creature (adjacent).
        const dirX = dx === 0 ? 0 : Math.sign(dx);
        const dirY = dy === 0 ? 0 : Math.sign(dy);
        const stopShort = Math.max(0, dist - 1);
        dest = {
          x: target.pos.x + dirX * stopShort,
          y: target.pos.y + dirY * stopShort,
          z: creature.pos.z,
        };
      }
      target.pos = { ...dest };
      log(state, 'move', creature.id,
        `  → ${target.name} TELEPORTED from (${origPos.x},${origPos.y}) to (${dest.x},${dest.y}) — within ${action.teleportFt ?? 60} ft of ${creature.name}`,
        target.id);
      applied = true;
    }

    // 5. Phase 7 (Session 98): speed-zero / can't-leave-space (Elder Brain).
    //    Apply the `restrained` condition for durationRounds (default 1).
    //    Restrained models both "speed 0" and "can't be moved" (PHB p.292:
    //    "A restrained creature's speed becomes 0, and it can't benefit from
    //    any bonus to its speed." / "Attack rolls against the creature have
    //    advantage, and the creature's attack rolls have disadvantage." /
    //    "The creature has disadvantage on Dexterity saving throws.")
    //    The "can't teleport" clause is not modeled (Phase 8+).
    if (hasSpeedZero) {
      const wasPresent = target.conditions.has('restrained');
      addCondition(target, 'restrained');
      log(state, 'condition_add', creature.id,
        `  → ${target.name} ANCHORED — speed reduced to 0 (restrained)${wasPresent ? ' (already present)' : ''} from ${action.id}`,
        target.id);
      applied = true;
    }

    // 6. Phase 7 (Session 98): disadvantage-on-attacks (Belashyrra).
    //    Grant the target a `disadvantage` self-grant on `attack` rolls for
    //    durationRounds (default 1). This models "imposing disadvantage on
    //    the creature's attack rolls" — the perception-alteration makes the
    //    target misjudge the position of its enemies.
    if (hasDisadv) {
      const duration = action.durationRounds ?? 1;
      grantSelf(target, 'disadvantage', 'attack', `Lair:${action.id}`, 'rounds', duration);
      log(state, 'action', creature.id,
        `  → ${target.name} DISADVANTAGE on attack rolls for ${duration} round(s) from ${action.id} (perception altered)`,
        target.id);
      applied = true;
    }

    if (!applied) {
      // No recognized bespoke effect — log as "not yet implemented". After
      // Phase 7 batch 2 (Session 99), ALL bestiary save_only actions are
      // recognized (teleport/speedZero/disadv/push/banish/conds/tether/
      // objectMove/ageAlteration/environmentManipulation) or recategorized
      // (Captain N'ghathrod::0 → summon). This fallback now only fires for
      // synthetic test actions with an unrecognized bespoke effect — Phase 9+
      // per-action.id handlers if new patterns emerge.
      log(state, 'action', creature.id,
        `  → save_only: ${target.name} failed — bespoke effect for ${action.id} not yet implemented (Phase 9: per-action.id handler)`,
        target.id);
    }
  }
}

/**
 * Resolve a `bespoke` lair action. Each action needs a hand-written handler
 * keyed by `action.id`. v1 logs "not yet implemented" for all but a few
 * common patterns.
 *
 * v1 implemented patterns:
 *   - "Fazrian::0" → "no creature within 120 ft can regain hit points" —
 *     applies a 1-round regeneration-suppression debuff to enemies in range.
 *     (Modeled as a `regen_suppressed` flag — Phase 5 will use a proper
 *     ActiveEffect. For v1, we just log it.)
 *
 * Phase 5 will add per-action.id handlers for the common bespoke patterns:
 *   - Healing-suppression fields (Fazrian::0, Mummy Lord::2).
 *   - Wall creation (Sapphire Dragon::2, White Dragon::2).
 *   - Teleport (Archdevil::6).
 *   - Reactive-attack grants (Archdevil::0, Zuggtmoy::0).
 *   - Spell-disruption fields (Mummy Lord::2, Valin Sarnaster::2).
 *
 * Examples:
 *   - Alyxian::2 → bespoke (psychic mirror effect).
 *   - Archdevil::0 → "uses one of their available melee attacks" (free attack).
 *   - Archdevil::3 → "recharges one of their expended abilities".
 *   - Fazrian::0 → "no creature within 120 ft can regain hit points".
 */
function handleLairBespoke(
  creature: Combatant,
  action: LairAction,
  state: EngineState,
): void {
  const bf = state.battlefield;
  const text = action.rawText.toLowerCase();

  // ── Pattern: regeneration / healing suppression ──
  // "no creature/target within N feet... can regain hit points" (Fazrian::0,
  // Mummy Lord::2, Demilich::2). Phase 8 batch 2 broadened the regex from
  // "no creature" to "no (creature|target)" to catch Demilich::2.
  if (/no (?:creature|target).{0,40}can\s+regain\s+hit\s+points/i.test(text)) {
    const targets = selectLairActionTargets(creature, action, bf)
      .filter(t => t.id !== creature.id)
      .filter(t => !t.isDead && !t.isUnconscious);
    log(state, 'action', creature.id,
      `  → bespoke: healing-suppression field — ${targets.length} target(s) in range cannot regain HP until next initiative count 20`,
      undefined);
    for (const t of targets) {
      log(state, 'action', creature.id,
        `    • ${t.name} is in the healing-suppression field`,
        t.id);
    }
    return;
  }

  // ── Pattern: free attack / recharge / teleport (Archdevil family) ──
  // These require per-action handling. v1: log + skip.
  if (/uses\s+one\s+of\s+(?:their|his|her)\s+available\s+(?:melee|ranged)\s+attacks/i.test(text)) {
    log(state, 'action', creature.id,
      `  → bespoke: "free attack" pattern — logged, not yet implemented (Phase 9: free-attack grant)`,
      undefined);
    return;
  }
  if (/recharges\s+one\s+of\s+(?:their|his|her)\s+expended\s+abilities/i.test(text)) {
    log(state, 'action', creature.id,
      `  → bespoke: "recharge ability" pattern — logged, not yet implemented (Phase 9: recharge tracking)`,
      undefined);
    return;
  }
  if (/teleports?\s+(?:themself|himself|herself|itself)\s+to/i.test(text)) {
    log(state, 'action', creature.id,
      `  → bespoke: "self-teleport" pattern — logged, not yet implemented (Phase 9: teleport with point-selection)`,
      undefined);
    return;
  }

  // ── Phase 8 batch 1 (Session 100): eight bespoke-category recognition flags. ──
  // The parser extracted these as structured fields; route to specific handlers
  // instead of the default "not yet implemented" log. Two are MECHANICAL
  // (selfInvisible adds the `invisible` condition; dispelMagic removes low-
  // level enemy active effects). Six are LOG-ONLY for v1 (no obstacle/terrain/
  // perception/eye-ray-table/vessel model — Phase 9+ may add those subsystems).

  // 1. Difficult-terrain field (Beholder::0, Death Tyrant::0) — log-only.
  if (action.lairDifficultTerrain) {
    const radiusFt = action.radiusFt ?? 50;
    const durationRounds = action.durationRounds ?? 1;
    log(state, 'action', creature.id,
      `  → bespoke: difficult-terrain field — ${radiusFt}-ft area within ${action.rangeFt ?? 120} ft of ${creature.name} becomes difficult terrain for ${durationRounds} round(s) (v1: log-only, no terrain-cost model)`,
      undefined);
    return;
  }

  // 2. Self-invisibility (Emerald Dragon::2) — MECHANICAL: adds invisible condition.
  if (action.lairSelfInvisible) {
    const durationRounds = action.durationRounds ?? 1;
    applySpellEffect(creature, {
      casterId: creature.id,
      spellName: `Lair:${action.id}`,
      effectType: 'invisible',
      payload: {},
      sourceIsConcentration: false,
      // No breaksOnAttackOrCast — lair-action invisibility persists for the
      // full "until initiative count 20" duration (no concentration mechanic).
      appliedTurn: bf.round,
      sourceTurnExpires: bf.round + durationRounds - 1,
    });
    log(state, 'action', creature.id,
      `  → bespoke: ${creature.name} becomes INVISIBLE for ${durationRounds} round(s) (advantage on attacks, disadvantage on attacks vs ${creature.name}; auto-expires at round ${bf.round + durationRounds})`,
      creature.id);
    return;
  }

  // 3. Dispel-magic (Topaz Dragon::1, Zargon::1, Darkweaver::0) — MECHANICAL:
  // removes low-level active effects from enemies.
  if (action.lairDispelMagic) {
    const maxLevel = action.lairDispelMagic.maxLevel;
    const targets = selectLairActionTargets(creature, action, bf)
      .filter(t => t.id !== creature.id)
      .filter(t => !t.isDead && !t.isUnconscious);
    let totalRemoved = 0;
    for (const t of targets) {
      // Filter the target's activeEffects to those with sourceSlotLevel ≤ maxLevel.
      // sourceSlotLevel may be undefined for some effects (e.g., racial traits) —
      // treat undefined as level 0 (always dispellable) per Dispel Magic PHB p.236:
      // "Any spell of 3rd level or lower on the target ends."
      const dispellable = t.activeEffects.filter(e =>
        (e.sourceSlotLevel ?? 0) <= maxLevel
      );
      for (const e of dispellable) {
        removeEffectById(t.id, e.id, bf);
        totalRemoved++;
        log(state, 'action', creature.id,
          `    • dispelled ${e.spellName} (level ${e.sourceSlotLevel ?? 0}) from ${t.name}`,
          t.id);
      }
    }
    log(state, 'action', creature.id,
      `  → bespoke: dispel-magic field — ends ${totalRemoved} spell(s) of level ≤ ${maxLevel} on ${targets.length} target(s) (range ${action.rangeFt ?? '∞'} ft)`,
      undefined);
    return;
  }

  // 4. Wall/door creation (Baphomet::2, Crystal Dragon::1, Fraz-Urb'luu::0,
  //    Halaster Blackcloak::0/::1/::2, Sapphire Dragon::1/::2) — log-only.
  if (action.lairWallCreation) {
    log(state, 'action', creature.id,
      `  → bespoke: wall/door creation — ${action.id} creates/removes a wall, door, passage, or magic gate (v1: log-only, no obstacle model)`,
      undefined);
    return;
  }

  // 5. Ethereal-pass (Hag::0, Strahd::0) — log-only.
  if (action.lairEtherealPass) {
    const durationRounds = action.durationRounds ?? 1;
    log(state, 'action', creature.id,
      `  → bespoke: ethereal-pass — ${creature.name} can pass through walls/doors/ceilings/floors for ${durationRounds} round(s) (v1: log-only, no wall model)`,
      undefined);
    return;
  }

  // 6. Random-eye-ray (Beholder::2, Death Tyrant::2, Belashyrra::0) — log-only.
  if (action.lairRandomEyeRay) {
    log(state, 'action', creature.id,
      `  → bespoke: random-eye-ray — ${action.id} opens a spectral eye and shoots one random eye ray (v1: log-only, eye-ray table not modeled)`,
      undefined);
    return;
  }

  // 7. Undead-pinpoint-living (Mummy Lord::0, Valin Sarnaster::0) — log-only.
  if (action.lairUndeadPinpointLiving) {
    const durationRounds = action.durationRounds ?? 1;
    log(state, 'action', creature.id,
      `  → bespoke: undead-pinpoint-living — each undead in the lair pinpoints each living creature within ${action.rangeFt ?? 120} ft for ${durationRounds} round(s) (v1: log-only, perception meta-flag)`,
      undefined);
    return;
  }

  // 8. Vessel-heal (Merrenoloth::0, Merrenoloth::2) — log-only.
  if (action.lairVesselHeal) {
    log(state, 'action', creature.id,
      `  → bespoke: vessel-heal — the ship/vessel regains HP (v1: log-only, no vessel combatant)`,
      undefined);
    return;
  }

  // ── Phase 8 batch 2 (Session 101): six more bespoke-category recognition flags. ──
  // One is MECHANICAL (illusoryAttack rolls a melee attack + applies damage).
  // Five are LOG-ONLY (plane-shift / teleport-with-allies / anti-invisibility /
  // recharge / bespoke-action-invocation).

  // 9. Plane-shift (Sphinx::3) — log-only (out-of-combat effect).
  if (action.lairPlaneShift) {
    log(state, 'action', creature.id,
      `  → bespoke: plane-shift — ${creature.name} shifts itself and up to 7 creatures to another plane (v1: log-only, out-of-combat effect)`,
      undefined);
    return;
  }

  // 10. Teleport-with-allies (Gar Shatterkeel::0) — log-only.
  if (action.lairTeleportAllies) {
    log(state, 'action', creature.id,
      `  → bespoke: teleport-with-allies — ${creature.name} repositions within the lair, bringing up to 5 willing creatures (v1: log-only, no multi-teleport model)`,
      undefined);
    return;
  }

  // 11. Anti-invisibility field (Drow Matron Mother::0) — log-only.
  if (action.lairAntiInvisibility) {
    const durationRounds = action.durationRounds ?? 1;
    log(state, 'action', creature.id,
      `  → bespoke: anti-invisibility field — hostile creatures can't become hidden from ${creature.name} and gain no benefit from invisibility against it for ${durationRounds} round(s) (v1: log-only, perception meta-flag)`,
      undefined);
    return;
  }

  // 12. Illusory-attack (Alyxian::2 x4 variants) — MECHANICAL: rolls a melee
  //     attack vs the target's AC; on hit, applies damage. The illusory form
  //     disappears after the attack regardless of hit/miss.
  if (action.lairIllusoryAttack) {
    const targets = selectLairActionTargets(creature, action, bf)
      .filter(t => t.id !== creature.id)
      .filter(t => !t.isDead && !t.isUnconscious);
    if (targets.length === 0) {
      log(state, 'action', creature.id,
        `  → bespoke: illusory-attack — no valid targets in range — no effect`,
        undefined);
      return;
    }
    // Pick the first valid target (the lair creature targets "one creature").
    const target = targets[0];
    const atkBonus = action.lairIllusoryAttack.attackBonus;
    const dmg = action.lairIllusoryAttack.damage;
    // Roll the melee attack (no advantage/disadvantage — the illusory form
    // doesn't benefit from the lair creature's conditions).
    const atk = rollAttack(atkBonus, false, false);
    const hit = atk.total >= target.ac || atk.isCrit;
    log(state, 'action', creature.id,
      `  → bespoke: illusory-attack — watery form attacks ${target.name} (d20+${atkBonus}=${atk.total}${atk.isCrit ? ' CRIT' : ''} vs AC ${target.ac})`,
      target.id, atk.roll);
    if (hit) {
      const dmgExpr = {
        count: dmg.count,
        sides: dmg.sides,
        bonus: dmg.bonus,
        average: dmg.count * (dmg.sides + 1) / 2 + dmg.bonus,
      };
      const dmgDealt = rollDamage(dmgExpr, atk.isCrit);
      const actualDealt = applyDamageWithTempHP(target, dmgDealt, dmg.type as any);
      log(state, 'damage', creature.id,
        `    → ${target.name} takes ${actualDealt} ${dmg.type} damage from illusory attack${atk.isCrit ? ' (CRIT)' : ''}`,
        target.id, actualDealt);
      checkDeath(target, state);
    } else {
      log(state, 'action', creature.id,
        `    → miss — the watery form disappears after the failed attack`,
        target.id);
    }
    return;
  }

  // 13. Recharge-ability (Greater Tyrant Shadow::1) — log-only.
  if (action.lairRechargeAbility) {
    log(state, 'action', creature.id,
      `  → bespoke: recharge-ability — ${creature.name} recharges one of its expended abilities (v1: log-only, no per-ability recharge tracking)`,
      undefined);
    return;
  }

  // 14. Bespoke-action-invocation (Dyrrn::0, Morkoth::1, Zuggtmoy::2) — log-only.
  if (action.lairBespokeActionInvocation) {
    log(state, 'action', creature.id,
      `  → bespoke: bespoke-action-invocation — ${creature.name} uses a named bespoke action (v1: log-only, named action not modeled)`,
      undefined);
    return;
  }

  // ── Phase 8 batch 3 (Session 102): Demogorgon::1 illusory duplicate. ──
  // 15. Illusory-duplicate (Demogorgon::1) — MECHANICAL: sets a scratch field
  //     on the lair creature. The reactive redirect is handled by
  //     `applyLairIllusoryDuplicateRedirect` at the 3 attack-damage hook sites.
  //     The duplicate lasts until the next init-20 checkpoint (1 round). The
  //     first attack that deals damage to the lair creature triggers a 50%
  //     coin-flip: on ≤50, the duplicate absorbs the hit (healback) and
  //     disappears; on >50, the lair creature takes the hit normally. Either
  //     way, the duplicate's redirect is consumed (the "first time" trigger).
  if (action.lairIllusoryDuplicate) {
    creature.lairIllusoryDuplicate = {
      sourceActionId: action.id,
      expiresAtRound: state.battlefield.round + 1,
    };
    log(state, 'action', creature.id,
      `  → bespoke: illusory-duplicate — ${creature.name} creates an illusory duplicate of itself (lasts until next init-20; first attack has 50% chance to hit the duplicate instead)`,
      undefined);
    return;
  }

  // ── Default: log "not yet implemented" with action.id ──
  // After Phase 8 batch 3 (Session 102), the bespoke fallback should NEVER
  // fire — all 31 bespoke actions are now recognized (28 from batches 1+2 +
  // inline-regex, 1 from batch 3's illusoryDuplicate flag, 2 promoted to
  // cast_spell via the broadened casts-regex). If this log fires, it's a
  // regression or a new bespoke action added to the bestiary.
  log(state, 'action', creature.id,
    `  → bespoke: ${action.id} not yet implemented (Phase 9: per-action.id handler) — no mechanical effect`,
    undefined);
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

    // ── Session 92 RFC-LAIRACTIONS Phase 2: Lair Actions at init-count-20 ──
    //
    // PHB/MM: "On initiative count 20 (losing initiative ties), the [creature]
    // takes a lair action." The lair-action checkpoint fires INSIDE the
    // per-actor turn loop, AFTER all creatures with `initiativeScore ≥ 20`
    // have taken their turn and BEFORE the first creature with `< 20`
    // (RFC [DD-2], §6.1).
    //
    // The boundary is detected by checking the first actor whose
    // `initiativeScore` is < 20 (or undefined — treated as 0 for backward
    // compat with legacy scenarios that pass only an ID array without scores,
    // preserving the original "fire at round start" behavior).
    //
    // Edge cases:
    //   - All creatures have initiative ≥ 20 → lair actions fire at the END
    //     of the round (handled by the post-loop fallback below).
    //   - All creatures have initiative < 20 (or undefined) → fires BEFORE
    //     the first actor's turn (the original Session 60 stub behavior).
    //   - No lair creatures present → `resolveLairActions` is a no-op.
    let lairActionsFiredThisRound = false;

    for (const actorId of initiative) {
      const actor = battlefield.combatants.get(actorId);

      // ── Lair-action checkpoint: fire AFTER ≥-20 creatures, BEFORE <-20 ──
      // (PHB "losing initiative ties" — lair actions resolve AFTER ties at 20.)
      if (!lairActionsFiredThisRound && actor && (actor.initiativeScore ?? 0) < 20) {
        resolveLairActions(state);
        lairActionsFiredThisRound = true;
      }

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
          actor._graspOfHadarUsedThisTurn = false;  // Session 80: Grasp of Hadar once-per-turn
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
      actor._graspOfHadarUsedThisTurn = false;  // Session 80: Grasp of Hadar once-per-turn

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

      // ── Session 62 RFC-VISION-AUDIO Phase 1: refresh detection states ──
      // At the start of each combatant's turn, refresh the detection maps
      // for ALL living observers (perception is symmetric + continuous).
      // O(n²) per turn — fine for v1 small combats. Idempotent; lazy-inits
      // the detection Map on combatants that don't have one yet.
      updateDetectionStates(battlefield);

      // ── Session 64 RFC-COMBINING-EFFECTS Phase 1: priority activation ──
      // At the start of each combatant's turn, re-evaluate the active-effects
      // pipeline: group same-name effects, mark the most potent as active,
      // suppress the rest. This ensures suppressed effects are correctly
      // promoted when the active one was removed since the actor's last turn.
      // (removeEffectsFromCaster also calls reevaluateEffects for immediate
      // promotion on concentration break — this is the periodic refresh.)
      reevaluateEffects(actor, battlefield);

      // ── Session 46 Task #29-follow-up-2: Survivor (Champion 18) regen ──
      // PHB p.73: "At 18th level, you attain the pinnacle of resilience in
      // battle. At the start of each of your turns, you regain hit points
      // equal to 5 + your Constitution modifier, provided you have at least
      // 1 hit point and are below half your hit point maximum."
      //
      // This fires at the very start of the actor's turn, right after
      // resetBudget and BEFORE damage-zone ticks (so a Champion at 1 HP
      // can survive a Cloud of Daggers tick if the regen brings them
      // above 0 — though the zone damage applies after, so they might
      // still go down). The regen does NOT fire if the actor is at 0 HP
      // (dead or unconscious) or at/above half HP.
      if (!actor.isDead && !actor.isUnconscious && actor.currentHP > 0
          && actor.currentHP < Math.floor(actor.maxHP / 2)
          && hasFeature(actor, 'Survivor')) {
        const conMod = abilityMod(actor.con);
        const regenAmount = 5 + conMod;
        if (regenAmount > 0) {
          const before = actor.currentHP;
          actor.currentHP = Math.min(actor.maxHP, actor.currentHP + regenAmount);
          const healed = actor.currentHP - before;
          if (healed > 0) {
            log(state, 'heal', actor.id,
              `${actor.name} regains ${healed} HP from Survivor (Champion 18) — ${before} → ${actor.currentHP}`,
              actor.id, healed);
          }
        }
      }

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

          // Session 78 (GoI AoE exclusion follow-up): check Globe of
          // Invulnerability protection on each per-tick damage application.
          // PHB p.245: "Any spell of 5th level or lower cast from outside
          // the barrier can't affect creatures or objects within it...
          // the spell has no effect on them." This applies to persistent
          // damage zones too — the spell continues to have no effect on
          // GoI-protected creatures for as long as GoI is active.
          //
          // The zone's sourceSlotLevel (set by spell modules in Session 78)
          // determines the spell's effective level for the GoI block check.
          // Legacy zones (pre-Session 78, sourceSlotLevel undefined) default
          // to 0 — which means isProtectedByGoI(actor, 0) returns false
          // (cantrips/level-0 are never blocked), preserving backward compat.
          //
          // The caster's own GoI does NOT block their own spell (PHB p.245:
          // "cast from outside the barrier" — the GoI caster is at the center).
          // Session 82: pass zone.casterId as the casterId arg so that a barrier
          // the zone's caster is INSIDE (their own GoI) provides no protection —
          // consistent with the on-cast Session 81 filterGoIProtectedTargets fix.
          // (Only the identity case — zone caster === GoI caster — is handled;
          // the spatial "caster within radius" case is a documented follow-up.)
          const zoneSlotLevel = zone.sourceSlotLevel ?? 0;
          if (zoneSlotLevel > 0 && actor.id !== zone.casterId && isProtectedByGoI(actor, zoneSlotLevel, state.battlefield, zone.casterId)) {
            log(state, 'damage', zone.casterId,
              `${actor.name} is protected by Globe of Invulnerability — ${zone.spellName} start-of-turn damage negated (L${zoneSlotLevel} ≤ GoI threshold).`,
              actor.id, 0);
            // Do NOT skip ticksRemaining decrement — the zone still "ticks"
            // (time passes), it just does no damage. This ensures timed
            // zones (Cordon of Arrows, Melf's Acid Arrow) still expire
            // on schedule even while blocked by GoI.
            // Fall through to the ticksRemaining decrement below.
          } else {
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
              processFallDamage(state);
              log(state, 'condition_remove', actor.id,
                `${actor.name} loses concentration on ${actor.concentration?.spellName ?? 'spell'} (damaged by ${zone.spellName})!`, undefined);
            }
          }

          // Death check (the damage may have killed the actor).
          checkDeath(actor, state);

          } // end else (not GoI-blocked — damage was applied)

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

      // ── Save-fail tracker (Contagion / Flesh to Stone) ────────────────
      // PHB p.227 (Contagion): "At the end of each of the target's turns,
      //   the target must make a Constitution saving throw..."
      // PHB p.241 (Flesh to Stone): "A creature restrained by this spell
      //   must make another Constitution saving throw at the end of its
      //   next turn."
      //
      // We process this at the START of the target's turn (before they act)
      // rather than at the end. This avoids an off-by-one where the end-of-
      // turn hook would fire on the same turn the spell was cast (the target
      // shouldn't save on the turn they were first affected). For Contagion,
      // the initial hit applies poisoned with no save; the first save comes
      // at the start of the target's next turn. For Flesh to Stone, the
      // initial CON save failure already counts as fail #1; the next save
      // comes at the start of the target's next turn.
      if (actor._saveFailTracker && !actor.isDead && !actor.isUnconscious) {
        const tracker = actor._saveFailTracker;

        // For Flesh to Stone: if the caster is no longer concentrating on
        // this spell, the tracker should have been cleared by _undoEffect
        // when the restrained condition was removed. But as a safety net,
        // check concentration state and skip if broken.
        if (tracker.spellName === 'Flesh to Stone') {
          const ftsCaster = battlefield.combatants.get(tracker.casterId);
          if (!ftsCaster || !ftsCaster.concentration?.active ||
              ftsCaster.concentration.spellName !== 'Flesh to Stone') {
            // Concentration broke — tracker should already be clear, but
            // clean up just in case.
            delete actor._saveFailTracker;
          }
        }

        if (actor._saveFailTracker) {
          // Session 84 (GoI save-fail tracker): PHB p.245 — "Any spell of
          // 5th level or lower cast from outside the barrier can't affect
          // creatures or objects within it... the spell has no effect on
          // them." This applies to the per-turn save rolls of the Contagion
          // / Flesh to Stone save-fail tracker. A GoI-protected creature is
          // NOT forced to make the per-turn save while GoI is active — the
          // tracker is PAUSED (no fail/success increment). When GoI expires
          // (concentration breaks), the save roll resumes on the next turn.
          // Mirrors the damage_zone tick GoI pattern (Session 78 + Session
          // 82 casterId fix). The tracker's caster's own GoI does NOT
          // block their own tracker (casterId → barrier skipped).
          //
          // NOTE: The poisoned (Contagion) / restrained (Flesh to Stone)
          // conditions applied as ActiveEffects are NOT suppressed by this
          // check — only the per-turn save roll is paused. Full condition
          // suppression requires pipeline-level GoI checks (deferred). This
          // is consistent with the damage_zone tick, which skips damage but
          // leaves the effect in place (so it can resume if GoI expires).
          const trackerSlotLevel = tracker.slotLevel ?? 0;
          if (trackerSlotLevel > 0 && actor.id !== tracker.casterId &&
              isProtectedByGoI(actor, trackerSlotLevel, state.battlefield, tracker.casterId)) {
            log(state, 'action', tracker.casterId,
              `${actor.name} is protected by Globe of Invulnerability — ${tracker.spellName} save-fail tracker save negated (L${trackerSlotLevel} ≤ GoI threshold). Tracker paused (no fail/success increment).`,
              actor.id);
            // Do NOT roll the save, do NOT increment fails/successes.
            // Tracker remains intact — resumes when GoI expires.
          } else {
            const save = rollSave(actor, tracker.saveAbility, tracker.saveDC);
            log(state,
              save.success ? 'save_success' : 'save_fail',
              tracker.casterId,
              `${actor.name} ${save.success ? 'succeeds on' : 'fails'} DC ${tracker.saveDC} ${tracker.saveAbility.toUpperCase()} save vs ${tracker.spellName} (start-of-turn tracker: ${tracker.fails} fails / ${tracker.successes} successes → ${save.success ? 'success' : 'fail'} #${save.success ? tracker.successes + 1 : tracker.fails + 1}) (rolled ${save.total})`,
              actor.id, save.roll);

            if (save.success) {
              tracker.successes++;
              if (tracker.successes >= tracker.maxCount) {
                // 3 successes: remove all effects from this tracker spell and clear it.
                // Remove matching active effects and their conditions.
                // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked conditions ──
                // Call undoEffect for each matching effect to clean up
                // _conditionSources and other structural state, then remove
                // from activeEffects, then re-derive conditions via pipeline.
                const matchingEffects = actor.activeEffects.filter(
                  e => e.casterId === tracker.casterId && e.spellName === tracker.spellName
                );
                for (const me of matchingEffects) {
                  undoEffect(actor, me);
                }
                actor.activeEffects = actor.activeEffects.filter(
                  e => !(e.casterId === tracker.casterId && e.spellName === tracker.spellName)
                );
                // Re-derive conditions from the pipeline after removing effects.
                reevaluateEffects(actor, battlefield);
                log(state, 'condition_remove', tracker.casterId,
                  `${actor.name} overcomes ${tracker.spellName}! (3 successful saves — ${tracker.currentCondition} removed)`,
                  actor.id);
                delete actor._saveFailTracker;
              }
            } else {
              tracker.fails++;
              if (tracker.fails >= tracker.maxCount) {
                // 3 fails: escalate condition.
                // Remove the current condition effects from this spell.
                // ── RFC-COMBINING-EFFECTS Phase 4: source-tracked conditions ──
                // Call undoEffect for each matching effect to clean up
                // _conditionSources and other structural state.
                const matchingEffects2 = actor.activeEffects.filter(
                  e => e.casterId === tracker.casterId && e.spellName === tracker.spellName
                );
                for (const me of matchingEffects2) {
                  undoEffect(actor, me);
                }
                actor.activeEffects = actor.activeEffects.filter(
                  e => !(e.casterId === tracker.casterId && e.spellName === tracker.spellName)
                );
                // Re-derive conditions from the pipeline after removing effects.
                reevaluateEffects(actor, battlefield);
                // Apply the escalation condition.
                // For Flesh to Stone: petrified is NOT concentration-sourced (permanent).
                //   Use the TARGET's own ID as casterId so that removeEffectsFromCaster
                //   on the original caster won't remove the petrified condition.
                //   The petrification is self-sustaining once reached (PHB p.241).
                // For Contagion: incapacitated is NOT concentration-sourced (permanent).
                //   Use the original casterId — Contagion has no concentration, so
                //   removeEffectsFromCaster won't be called for it in normal flow.
                const escalationCasterId = tracker.spellName === 'Flesh to Stone'
                  ? actor.id   // petrified is self-sustaining; not tied to caster
                  : tracker.casterId;
                applySpellEffect(actor, {
                  casterId: escalationCasterId,
                  spellName: tracker.spellName,
                  effectType: 'condition_apply',
                  payload: { condition: tracker.conditionOnFail },
                  sourceIsConcentration: false,
                });
                log(state, 'condition_add', tracker.casterId,
                  `${actor.name} succumbs to ${tracker.spellName}! (3 failed saves — ${tracker.currentCondition} → ${tracker.conditionOnFail})`,
                  actor.id);
                delete actor._saveFailTracker;
              }
            }
          }
        }
      }

      // ── Terrain zone start-of-turn check (Grease/Sleet Storm/Watery Sphere) ──
      // PHB p.245 (Grease): "A creature can also fall prone when it enters
      //   the grease or ends its turn there."
      // PHB p.276 (Sleet Storm): "When the grease appears, each creature
      //   in the area must succeed on a Dexterity saving throw or fall prone."
      // XGE p.170 (Watery Sphere): "Any creature in the sphere's space must
      //   make a Strength save... on a failed save, the creature is restrained."
      //
      // v1 simplification: we only check at the START of each creature's turn
      // (like damage_zone ticks). Canon says creatures entering the zone also
      // save immediately; that requires deeper movement system integration (v2).
      // A creature that walks into grease on its turn will save at the start of
      // its NEXT turn — a known deviation documented in the spell metadata.
      const terrainZones = getActiveTerrainZones(battlefield);
      if (terrainZones.length > 0 && !actor.isDead && !actor.isUnconscious) {
        for (const zone of terrainZones) {
          // Skip zones that have no save/condition mechanic (pure difficult terrain)
          if (!zone.condition || !zone.saveAbility) continue;
          // Skip if the creature already has the condition
          if (actor.conditions.has(zone.condition)) continue;
          // Skip allies of the caster (terrain affects enemies only)
          const caster = battlefield.combatants.get(zone.casterId);
          if (caster && actor.faction === caster.faction) continue;

          // Session 83 (GoI terrain_zone tick): PHB p.245 — "Any spell of 5th
          // level or lower cast from outside the barrier can't affect creatures
          // or objects within it... the spell has no effect on them." This
          // applies to terrain zones too — a GoI-protected creature is not
          // affected by the terrain zone's save/condition on per-turn ticks.
          // Mirrors the damage_zone tick GoI check (Session 78 + Session 82
          // casterId fix). The zone's sourceSlotLevel determines the spell's
          // effective level for the GoI block check. The zone's caster's own
          // GoI does NOT block their own spell (casterId → barrier skipped).
          const terrainSlotLevel = zone.sourceSlotLevel ?? 0;
          if (terrainSlotLevel > 0 && actor.id !== zone.casterId && isProtectedByGoI(actor, terrainSlotLevel, state.battlefield, zone.casterId)) {
            log(state, 'action', zone.casterId,
              `${actor.name} is protected by Globe of Invulnerability — ${zone.spellName} terrain tick negated (L${terrainSlotLevel} ≤ GoI threshold).`,
              actor.id);
            continue;  // skip this zone's save/condition — GoI-protected
          }

          // Check if creature is within the zone's radius
          const distFt = chebyshev3D(
            actor.pos,
            { x: zone.centerX, y: zone.centerY, z: zone.centerZ } as Vec3
          ) * 5;
          if (distFt > zone.radiusFt) continue;

          // Roll the terrain save — get save DC from the caster's action
          const casterAction = caster?.actions.find(a => a.name === zone.spellName);
          const saveDC = casterAction?.saveDC ?? 13;

          const save = rollSave(actor, zone.saveAbility, saveDC);
          log(state,
            save.success ? 'save_success' : 'save_fail',
            zone.casterId,
            `${actor.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} ${zone.saveAbility.toUpperCase()} save vs ${zone.spellName} terrain (${zone.condition} on failed save) (rolled ${save.total})`,
            actor.id, save.roll);

          if (!save.success) {
            applySpellEffect(actor, {
              casterId: zone.casterId,
              spellName: zone.spellName,
              effectType: 'condition_apply',
              payload: { condition: zone.condition },
              sourceIsConcentration: zone.sourceIsConcentration,
            });
            log(state, 'condition_add', zone.casterId,
              `${actor.name} is affected by ${zone.spellName}'s terrain! (${zone.condition})`,
              actor.id);
          }
        }
      }

      // ── Moving zone start-of-turn processing (Flaming Sphere / Moonbeam / Call Lightning / Cloudkill) ──
      // PHB p.242 (Flaming Sphere): bonus action to move sphere up to 30 ft.
      // PHB p.261 (Moonbeam): action to move beam up to 60 ft.
      // PHB p.220 (Call Lightning): action to call down another bolt within 60 ft.
      // PHB p.222 (Cloudkill): cloud moves 10 ft away from caster at start of each turn.
      //
      // v1 simplification: the zone moves AUTOMATICALLY at the start of the
      // caster's turn (no action cost). It moves toward the highest-threat
      // enemy and re-applies damage to creatures in its new position. Old
      // targets no longer in the zone have their damage_zone effects removed.
      if (actor._movingZone && actor.concentration?.active &&
          actor.concentration.spellName === actor._movingZone.spellName &&
          !actor.isDead && !actor.isUnconscious) {
        const mz = actor._movingZone;

        // Find the highest-threat enemy within a generous range
        const enemies = livingEnemiesOf(actor, battlefield);
        let bestTarget: Combatant | null = null;
        let bestThreat = -1;
        let bestDist = Infinity;
        for (const e of enemies) {
          const distFt = chebyshev3D(
            { x: mz.centerX, y: mz.centerY, z: mz.centerZ } as Vec3,
            e.pos,
          ) * 5;
          // Only consider enemies within a reasonable range (movePerTurn + radiusFt * 2)
          // so the zone can actually reach them
          if (distFt > mz.movePerTurn + mz.radiusFt * 2 + 60) continue;
          if (e.maxHP > bestThreat || (e.maxHP === bestThreat && distFt < bestDist)) {
            bestTarget = e;
            bestThreat = e.maxHP;
            bestDist = distFt;
          }
        }

        if (bestTarget) {
          // Move the zone toward the best target (up to movePerTurn ft)
          const oldCenter: Vec3 = { x: mz.centerX, y: mz.centerY, z: mz.centerZ };
          const targetPos = bestTarget.pos;

          // Calculate direction from zone center to target
          const dx = targetPos.x - mz.centerX;
          const dy = targetPos.y - mz.centerY;
          const dz = targetPos.z - mz.centerZ;
          const distSquares = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
          const moveSquares = Math.floor(mz.movePerTurn / 5);

          if (distSquares > 0 && moveSquares > 0) {
            const actualMove = Math.min(moveSquares, distSquares);
            // Chebyshev movement: move each axis by sign * actualMove (capped at target)
            const stepX = dx === 0 ? 0 : (Math.abs(dx) <= actualMove ? dx : Math.sign(dx) * actualMove);
            const stepY = dy === 0 ? 0 : (Math.abs(dy) <= actualMove ? dy : Math.sign(dy) * actualMove);
            const stepZ = dz === 0 ? 0 : (Math.abs(dz) <= actualMove ? dz : Math.sign(dz) * actualMove);

            mz.centerX += stepX;
            mz.centerY += stepY;
            mz.centerZ += stepZ;

            const movedFt = chebyshev3D(oldCenter, { x: mz.centerX, y: mz.centerY, z: mz.centerZ } as Vec3) * 5;
            log(state, 'action', actor.id,
              `${actor.name}'s ${mz.spellName} zone moves ${movedFt} ft toward ${bestTarget.name}! (new center: ${mz.centerX},${mz.centerY},${mz.centerZ}, radius: ${mz.radiusFt} ft)`,
              bestTarget.id);
          }

          const newCenter: Vec3 = { x: mz.centerX, y: mz.centerY, z: mz.centerZ };

          // ── Find all enemies in the new zone position ──
          const enemiesInNewZone: Combatant[] = [];
          for (const e of enemies) {
            const distFt = chebyshev3D(newCenter, e.pos) * 5;
            if (distFt <= mz.radiusFt) {
              enemiesInNewZone.push(e);
            }
          }

          // ── Remove damage_zone effects from enemies no longer in the zone ──
          for (const c of battlefield.combatants.values()) {
            if (c.faction === actor.faction) continue;  // skip allies
            const distFt = chebyshev3D(newCenter, c.pos) * 5;
            if (distFt > mz.radiusFt) {
              // This creature is outside the new zone — remove damage_zone effects
              // from this caster for this spell
              const zoneEffects = c.activeEffects.filter(
                e => e.casterId === actor.id && e.spellName === mz.spellName && e.effectType === 'damage_zone'
              );
              for (const eff of zoneEffects) {
                removeEffectById(c.id, eff.id, battlefield);
                log(state, 'condition_remove', actor.id,
                  `${c.name} is no longer in ${mz.spellName}'s zone! (damage_zone effect removed)`,
                  c.id);
              }
            }
          }

          // ── Apply damage to enemies in the new zone that don't already have a damage_zone effect ──
          for (const e of enemiesInNewZone) {
            if (e.isDead || e.isUnconscious) continue;

            // Check if already affected by this caster's damage_zone for this spell
            const alreadyAffected = e.activeEffects.some(
              eff => eff.casterId === actor.id && eff.spellName === mz.spellName && eff.effectType === 'damage_zone'
            );
            if (alreadyAffected) continue;  // already in the zone — damage will tick on their turn

            // Get the spell's action to find saveDC and damage parameters
            const spellAction = actor.actions.find(a => a.name === mz.spellName);
            const saveDC = spellAction?.saveDC ?? 13;

            // Session 83 (GoI moving-zone on-enter): PHB p.245 — "Any spell of
            // 5th level or lower cast from outside the barrier can't affect
            // creatures or objects within it." This applies when the moving
            // zone enters a creature's position — a GoI-protected creature is
            // NOT affected (no damage, no damage_zone effect). Mirrors the
            // on-cast filterGoIProtectedTargets pattern. Uses spellAction's
            // slotLevel for the level check, and actor.id (zone caster) for
            // the caster-inside fix (Session 81/82). Also: the damage_zone
            // effect created below now carries sourceSlotLevel so the per-tick
            // GoI check works for moving zones too (was missing — defaulted to
            // 0 = never blocked).
            const mzSlotLevel = spellAction?.slotLevel ?? 0;
            if (mzSlotLevel > 0 && e.id !== actor.id && isProtectedByGoI(e, mzSlotLevel, state.battlefield, actor.id)) {
              log(state, 'action', actor.id,
                `${e.name} is protected by Globe of Invulnerability — ${mz.spellName} moving-zone damage negated (L${mzSlotLevel} ≤ GoI threshold).`,
                e.id);
              continue;  // skip — GoI-protected
            }

            // Determine spell parameters based on spell name
            let dieCount = 0;
            let dieSides = 0;
            let damageType: import('../types/core').DamageType = 'fire';
            let saveAbility: import('../types/core').AbilityScore | undefined;

            switch (mz.spellName) {
              case 'Flaming Sphere':
                dieCount = 2; dieSides = 6; damageType = 'fire'; saveAbility = 'dex';
                break;
              case 'Moonbeam':
                dieCount = 2; dieSides = 10; damageType = 'radiant'; saveAbility = 'con';
                break;
              case 'Call Lightning':
                dieCount = 3; dieSides = 10; damageType = 'lightning';
                // Call Lightning: no save in v1 (callLightningDexSaveV1SimplifiedToNone)
                break;
              case 'Cloudkill':
                dieCount = 5; dieSides = 8; damageType = 'poison'; saveAbility = 'con';
                break;
            }

            // Roll damage
            let dmgRoll = 0;
            for (let i = 0; i < dieCount; i++) dmgRoll += rollDie(dieSides);

            let actualDmg = dmgRoll;
            let saveDesc = '';

            // Save for half (if applicable)
            if (saveAbility) {
              const save = rollSave(e, saveAbility, saveDC);
              if (save.success) {
                actualDmg = Math.floor(dmgRoll / 2);
              }
              saveDesc = ` (DC ${saveDC} ${saveAbility.toUpperCase()} save: ${save.success ? 'SUCCESS — half damage' : 'FAIL — full damage'} (rolled ${save.total}))`;
              log(state,
                save.success ? 'save_success' : 'save_fail',
                actor.id,
                `${e.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} ${saveAbility.toUpperCase()} save vs ${mz.spellName} (moving zone damage)${saveDesc}`,
                e.id, save.roll);
            }

            const dealt = applyDamageWithTempHP(e, actualDmg, damageType);
            log(state, 'damage', actor.id,
              `${e.name} takes ${dealt} ${damageType} damage from ${mz.spellName} (moving zone entered: ${dieCount}d${dieSides}=${dmgRoll}${actualDmg !== dmgRoll ? `, halved to ${actualDmg}` : ''})`,
              e.id, dealt);

            // Apply a damage_zone effect so the enemy takes start-of-turn damage
            // Session 83: sourceSlotLevel is set so the per-tick GoI check
            // (damage_zone tick loop, line ~6592) works for moving zones.
            // Previously missing → defaulted to 0 = never blocked by GoI.
            applySpellEffect(e, {
              casterId: actor.id,
              spellName: mz.spellName,
              effectType: 'damage_zone',
              payload: {
                dieCount,
                dieSides,
                damageType,
                ...(saveAbility ? { saveDC, saveAbility } : {}),
              },
              sourceIsConcentration: true,
              sourceSlotLevel: mzSlotLevel,
            });

            log(state, 'condition_add', actor.id,
              `${e.name} is caught in ${mz.spellName}'s zone! (will take ${dieCount}d${dieSides} ${damageType} at the start of each of its turns${saveAbility ? `, ${saveAbility.toUpperCase()} save for half` : ''})`,
              e.id);

            // Concentration check if the enemy was concentrating
            if (e.concentration?.active && dealt > 0) {
              const maintained = rollConcentrationSave(e, dealt);
              if (!maintained) {
                removeEffectsFromCaster(e.id, battlefield);
                // Session 34 (TG-002): also process fall damage if the
                // concentration break ends Reverse Gravity / Fly / Levitate
                // on a creature that was lifted. Matches the other 4
                // concentration-break sites (lines ~998, ~1041, ~1723, ~4610).
                processFallDamage(state);
                log(state, 'condition_remove', e.id,
                  `${e.name} loses concentration on ${e.concentration?.spellName ?? 'spell'} (damaged by ${mz.spellName} moving zone)!`, undefined);
              }
            }

            // Death check
            checkDeath(e, state);
          }
        } else {
          // No valid enemy found — zone stays in place
          log(state, 'action', actor.id,
            `${actor.name}'s ${mz.spellName} zone has no target to move toward — stays in place.`);
        }
      }

      // ── Eyebite per-turn re-target (PHB p.238) ──────────────────
      // "On each of your turns until the spell ends, you can use your
      //  action to target another creature."
      // v1 simplification: the re-target is automatic (doesn't consume
      // the caster's action), like damage_zone ticks. The caster still
      // gets their normal turn. This fires at the START of the caster's
      // turn, after damage_zone ticks and save-fail tracker processing.
      if (actor._eyebiteActive && actor.concentration?.active &&
          actor.concentration.spellName === 'Eyebite' &&
          !actor.isDead && !actor.isUnconscious) {
        const saveDC = actor._eyebiteActive.saveDC;

        // Find a new target within 60 ft
        const eyebiteTargets: Combatant[] = [];
        for (const c of battlefield.combatants.values()) {
          if (c.id === actor.id) continue;
          if (c.faction === actor.faction) continue;
          if (c.isDead || c.isUnconscious) continue;
          const distFt = chebyshev3D(actor.pos, c.pos) * 5;
          if (distFt > 60) continue;
          // Skip targets already affected by this caster's Eyebite
          if (c.activeEffects.some(e => e.casterId === actor.id && e.spellName === 'Eyebite' && e.effectType === 'condition_apply')) continue;
          // Skip targets already sleeping/incapacitated (can't be further disabled)
          if (c.conditions.has('sleeping') || c.conditions.has('incapacitated')) continue;
          eyebiteTargets.push(c);
        }

        if (eyebiteTargets.length > 0) {
          // Pick highest-threat target (mirror shouldCast priority)
          eyebiteTargets.sort((a, b) => b.maxHP - a.maxHP);
          const newTarget = eyebiteTargets[0];

          // AI picks best option for this target
          const option = pickEyebiteOption(newTarget, actor);
          const condition = optionToCondition(option);
          const optionLabel = option.charAt(0).toUpperCase() + option.slice(1);

          log(state, 'action', actor.id,
            `${actor.name} uses Eyebite re-target on ${newTarget.name}! (DC ${saveDC} WIS — ${optionLabel} option)`,
            newTarget.id);

          const save = rollSave(newTarget, 'wis', saveDC);
          log(state,
            save.success ? 'save_success' : 'save_fail',
            actor.id,
            `${newTarget.name} ${save.success ? 'succeeds on' : 'fails'} DC ${saveDC} WIS save vs Eyebite re-target (rolled ${save.total})`,
            newTarget.id, save.roll);

          if (!save.success) {
            applySpellEffect(newTarget, {
              casterId: actor.id,
              spellName: 'Eyebite',
              effectType: 'condition_apply',
              payload: { condition },
              sourceIsConcentration: true,
            });

            const effectDescs: Record<string, string> = {
              asleep:   `falls ASLEEP (unconscious, drops what's holding, attacks vs them within 5 ft are crits)!`,
              panicked: `is PANICKED (frightened — disadv on attacks while caster visible, can't approach)!`,
              sickened: `is SICKENED (poisoned — disadv on attacks and ability checks)!`,
            };

            log(state, 'condition_add', actor.id,
              `${newTarget.name} ${effectDescs[option]}`,
              newTarget.id);
          } else {
            log(state, 'action', actor.id,
              `${newTarget.name} resists Eyebite re-target — not ${optionLabel.toLowerCase()}!`,
              newTarget.id);
          }
        }
      }

      // ── Session 89: Aura of Vitality per-turn re-heal (PHB p.216) ──
      // "You can use a bonus action to cause one creature in the aura
      //  (including you) to regain 2d6 hit points."
      // v1 simplification: the heal fires automatically at the START of
      // the caster's turn (no bonus action cost — mirrors the Eyebite
      // pattern). The aura follows the caster (30-ft radius from current
      // position). Targets the most-wounded ally (including self) in range.
      // Gates on: _auraOfVitalityActive flag + concentration active +
      // concentrating on 'Aura of Vitality' + caster alive/conscious.
      if (actor._auraOfVitalityActive && actor.concentration?.active &&
          actor.concentration.spellName === 'Aura of Vitality' &&
          !actor.isDead && !actor.isUnconscious) {
        const pulseTarget = shouldCastPulseAuraOfVitality(actor, battlefield);
        if (pulseTarget) {
          executePulseAuraOfVitality(actor, pulseTarget, state);
        }
      }

      // Plan the turn
      const plan = planTurn(actor, battlefield);

      if (verbose && plan.action) {
        console.log(`  ${actor.name}: ${plan.action.description}`);
      }

      // Execute the plan
      executeTurnPlan(actor, plan, state);

      // ── Session 60: Ambusher turn tracking ──
      // Mark this combatant as having completed their turn. Used by the
      // Ambusher trait: advantage on attack rolls vs creatures that haven't
      // taken a turn yet (round 1 only). Set AFTER executeTurnPlan so the
      // actor's own attacks during their turn still see targets that haven't
      // gone yet as "not taken turn" (correct — the actor is the one attacking,
      // not the target's turn status changing mid-attack).
      actor._hasTakenTurn = true;

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

      // ── Process pending initiative inserts (summon spells, TG-006) ──────
      // TCE Summon spells: "shares your initiative count, takes turn after
      // yours." After each actor's turn, insert any pending summons that
      // should go after this actor. The summon will then get its own turn
      // later in this round (or next round if the round has already passed
      // its position).
      if (battlefield.pendingInitiativeInserts && battlefield.pendingInitiativeInserts.length > 0) {
        const toInsert = battlefield.pendingInitiativeInserts.filter(
          i => i.insertAfterId === actor.id
        );
        for (const insert of toInsert) {
          const afterIdx = battlefield.initiativeOrder.indexOf(insert.insertAfterId);
          if (afterIdx !== -1 && !battlefield.initiativeOrder.includes(insert.combatantId)) {
            battlefield.initiativeOrder.splice(afterIdx + 1, 0, insert.combatantId);
          }
        }
        // Remove processed inserts
        battlefield.pendingInitiativeInserts = battlefield.pendingInitiativeInserts.filter(
          i => i.insertAfterId !== actor.id
        );
      }

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

    // ── Session 92: Lair-action fallback (RFC [DD-2] edge case) ──
    // If EVERY actor this round had `initiativeScore ≥ 20` (or the initiative
    // list was empty), the in-loop checkpoint never fired. PHB: lair actions
    // still resolve at count 20 → fire them at the END of the round (after
    // all turns). This is correct per PHB ("losing initiative ties" —
    // creatures at 20 still act before the lair action).
    if (!lairActionsFiredThisRound) {
      resolveLairActions(state);
      lairActionsFiredThisRound = true;   // (bookkeeping; loop will reset next round)
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
