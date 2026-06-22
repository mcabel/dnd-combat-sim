// ============================================================
// Combat Engine
// Executes TurnPlans produced by the AI planner.
// Handles: attack resolution, movement, OA triggers,
//          legendary action windows, perception updates.
// ============================================================

import {
  Combatant, Battlefield, TurnPlan, PlannedAction, Action, Vec3,
  ReactionTrigger, ReactionOutcome,
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
  effectiveSpeed, rollDie, abilityMod, proficiencyBonus,
  rollDiceString as rollBoomingBladeDice,
  rollAbilityCheck,  // Session 43 Task #26: for rollAbilityCheckReactable
} from './utils';
import {
  chebyshev3D, distanceFt, euclideanDistFt, canReach, estimateMoveCostFt,
  opportunityAttackTriggered, selectOAAction,
  livingEnemiesOf, livingAlliesOf, posKey, pushAway
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
import { removeEffectsFromCaster, removeEffectById, getActiveAcBonus, getActiveAcFloor, getActiveBlessDie, getActiveBaneDie, getActiveHexDie, getActiveDamageZones, getActiveWeaponEnchant, getActiveEnlargeReduce, getActiveTaunt, getActiveCurseAttackDisadv, getActiveCurseRider, applySpellEffect, getActiveTerrainZones, makeTerrainFn } from './spell_effects';
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
import { shouldCast as shouldCastAuraOfVitality,  execute as executeAuraOfVitality }  from '../spells/aura_of_vitality';
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
  // these are always spells. The level is unknown on the plan (v1), so default
  // to 1 (Counterspell auto-succeeds with a L3 slot for L1-3 spells).
  // The spell name is the plan type (camelCase) — we convert to the action
  // name if available, else use the plan type directly.
  const name = plan.action?.name ?? plan.type;
  return { name, level: 1 };
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
      const dmg = rollDamage(action.damage, false);
      const actual = save.success ? Math.floor(dmg / 2) : dmg; // half on save success
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
  const disadvantage = baseDisadv || !!protectionRider || losDisadvantage || chillTouchDisadv || viciousMockeryDisadv || frostbiteDisadv || tauntDisadvantage || curseAttackDisadv
    || attacker.exhaustionLevel >= 3;  // Exhaustion level 3: disadvantage on attack rolls (PHB p.291)
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
    let dmg = rollDamage(action.damage, isCrit);

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
  if (target.concentration?.active) {
    const spellName = target.concentration.spellName ?? 'spell';
    removeEffectsFromCaster(target.id, state.battlefield);
    processFallDamage(state);
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

  const cost = estimateMoveCostFt(
    mover.pos, dest,
    mover.burrowSpeed !== null,
    mover.swimSpeed !== null,
    makeTerrainFn(bf)
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
    const dmg = rollDiceString(dice);
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
      // ── Session 42 Task #18: Thirsting Blade / Extra Attack ──
      // PHB p.111: "You can attack with your pact weapon twice, instead of
      // once, whenever you take the Attack action on your turn."
      // The planner sets plan.attackCount = 2 when the actor has Thirsting
      // Blade + Pact of the Blade + melee attack. Default is 1 (single attack).
      // Loop resolveAttack this many times — each attack is independent
      // (separate attack roll, damage roll, death check). The target may
      // die mid-loop; subsequent attacks are skipped if the target is dead.
      const attackCount = plan.attackCount ?? 1;
      for (let i = 0; i < attackCount; i++) {
        if (effectiveTarget.isDead || effectiveTarget.isUnconscious) break;
        resolveAttack(actor, effectiveTarget, plan.action, state);
        if (attackCount > 1 && i < attackCount - 1) {
          log(state, 'action', actor.id,
            `${actor.name} makes attack ${i + 2}/${attackCount} (Extra Attack / Thirsting Blade)`,
            effectiveTarget.id ?? undefined);
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
      // Magic Missile — PHB p.257: 3 auto-hit darts, each 1d4+1 force. 120 ft, no concentration.
      // Slot consumed inside executeMagicMissile.
      const mmTarget = plan.targetId ? bf.combatants.get(plan.targetId) : null;
      if (!mmTarget || mmTarget.isDead || mmTarget.isUnconscious) break;

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
        dartCount: 3,  // MM default (L1); upcast +1 dart/level not modelled
      });
      if (mmOutcome && mmOutcome.kind === 'negated') {
        // Shield blocked all MM darts. MM slot is still consumed (spell was cast).
        consumeSpellSlot(actor, 1);
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
      // Re-run shouldCast with the live battlefield (target may have died
      // or moved out of range between planTurn and executePlannedAction).
      if (desc.shouldCast(actor, bf)) {
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
              processFallDamage(state);
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
              const matchingEffects = actor.activeEffects.filter(
                e => e.casterId === tracker.casterId && e.spellName === tracker.spellName
              );
              for (const eff of matchingEffects) {
                if (eff.effectType === 'condition_apply' && eff.payload.condition) {
                  actor.conditions.delete(eff.payload.condition);
                }
              }
              actor.activeEffects = actor.activeEffects.filter(
                e => !(e.casterId === tracker.casterId && e.spellName === tracker.spellName)
              );
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
              const matchingEffects = actor.activeEffects.filter(
                e => e.casterId === tracker.casterId && e.spellName === tracker.spellName
              );
              for (const eff of matchingEffects) {
                if (eff.effectType === 'condition_apply' && eff.payload.condition) {
                  actor.conditions.delete(eff.payload.condition);
                }
              }
              actor.activeEffects = actor.activeEffects.filter(
                e => !(e.casterId === tracker.casterId && e.spellName === tracker.spellName)
              );
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
