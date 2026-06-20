// ============================================================
// AI Turn Planner
// Implements the turn state machine from combat_ai_design.md §6.
// Produces a TurnPlan for the combat engine to execute.
// ============================================================

// (adjacentEnemyCount and livingEnemiesOf already imported via movement)
import { Combatant, Battlefield, TurnPlan, PlannedAction, Vec3 } from '../types/core';
import { selectTarget } from './targeting';
import {
  shouldRage, activateRagePlan, shouldSecondWind, secondWindPlan,
  shouldLayOnHands, layOnHandsPlan, bardicInspirationTarget, bardicInspirationPlan,
  shouldCastHex, hexPlan,
  shouldCastCureWounds, spellHealPlan,
} from './resources';
import { shouldCast as shouldCastHW } from '../spells/healing_word';
import { shouldCast as shouldCastFaerieFire } from '../spells/faerie_fire';
import { shouldCast as shouldCastBless } from '../spells/bless';
import { shouldCast as shouldCastMageArmor } from '../spells/mage_armor';
import { shouldCast as shouldCastMagicMissile } from '../spells/magic_missile';
import { shouldCast as shouldCastEntangle } from '../spells/entangle';
import { shouldCast as shouldCastThunderwave } from '../spells/thunderwave';
import { shouldCast as shouldCastArmsOfHadar } from '../spells/arms_of_hadar';
import { shouldCast as shouldCastBurningHands, execute as executeBurningHands } from '../spells/burning_hands';
import { shouldCast as shouldCastDissonantWhispers } from '../spells/dissonant_whispers';
import { shouldCast as shouldCastGuidingBolt } from '../spells/guiding_bolt';
import { shouldCast as shouldCastSleep } from '../spells/sleep';
import { shouldCast as shouldCastWardingBond } from '../spells/warding_bond';
import { shouldCast as shouldCastShieldOfFaith } from '../spells/shield_of_faith';
import { shouldCast as shouldCastAid } from '../spells/aid';
import { shouldCast as shouldCastBarkskin } from '../spells/barkskin';
import { shouldCast as shouldCastBlur } from '../spells/blur';
import { shouldCast as shouldCastBlindnessDeafness } from '../spells/blindness_deafness';
import { shouldCast as shouldCastBrandingSmite } from '../spells/branding_smite';
import { shouldCast as shouldCastCalmEmotions } from '../spells/calm_emotions';
import { shouldCast as shouldCastCloudOfDaggers } from '../spells/cloud_of_daggers';
import { shouldCast as shouldCastCrownOfMadness } from '../spells/crown_of_madness';
import { shouldCast as shouldCastHoldPerson } from '../spells/hold_person';
import { shouldCast as shouldCastMirrorImage } from '../spells/mirror_image';
// ── Session 17 — level-2 batch 3 (15 new PHB level-2 spells) ──────────────
import { shouldCast as shouldCastEnlargeReduce } from '../spells/enlarge_reduce';
import { shouldCast as shouldCastEnhanceAbility } from '../spells/enhance_ability';
import { shouldCast as shouldCastFlameBlade } from '../spells/flame_blade';
import { shouldCast as shouldCastFlamingSphere } from '../spells/flaming_sphere';
import { shouldCast as shouldCastHeatMetal } from '../spells/heat_metal';
import { shouldCast as shouldCastMelfsAcidArrow } from '../spells/melf_s_acid_arrow';
import { shouldCast as shouldCastMistyStep } from '../spells/misty_step';
import { shouldCast as shouldCastInvisibility } from '../spells/invisibility';
import { shouldCast as shouldCastGustOfWind } from '../spells/gust_of_wind';
import { shouldCast as shouldCastLevitate } from '../spells/levitate';
import { shouldCast as shouldCastLesserRestoration } from '../spells/lesser_restoration';
import { shouldCast as shouldCastMagicWeapon } from '../spells/magic_weapon';
import { shouldCast as shouldCastCordonOfArrows } from '../spells/cordon_of_arrows';
import { shouldCast as shouldCastAlterSelf } from '../spells/alter_self';
import { shouldCast as shouldCastDarkvision } from '../spells/darkvision';
// ── Session 18 — level-2 batch 4 (20 new PHB level-2 spells) ──────────────
import { shouldCast as shouldCastMoonbeam } from '../spells/moonbeam';
import { shouldCast as shouldCastScorchingRay } from '../spells/scorching_ray';
import { shouldCast as shouldCastShatter } from '../spells/shatter';
import { shouldCast as shouldCastSpikeGrowth } from '../spells/spike_growth';
import { shouldCast as shouldCastSpiritualWeapon } from '../spells/spiritual_weapon';
import { shouldCast as shouldCastPhantasmalForce } from '../spells/phantasmal_force';
import { shouldCast as shouldCastRayOfEnfeeblement } from '../spells/ray_of_enfeeblement';
import { shouldCast as shouldCastWeb } from '../spells/web';
import { shouldCast as shouldCastSilence } from '../spells/silence';
import { shouldCast as shouldCastSuggestion } from '../spells/suggestion';
import { shouldCast as shouldCastZoneOfTruth } from '../spells/zone_of_truth';
import { shouldCast as shouldCastEnthrall } from '../spells/enthrall';
import { shouldCast as shouldCastDetectThoughts } from '../spells/detect_thoughts';
import { shouldCast as shouldCastSeeInvisibility } from '../spells/see_invisibility';
import { shouldCast as shouldCastSpiderClimb } from '../spells/spider_climb';
import { shouldCast as shouldCastPassWithoutTrace } from '../spells/pass_without_trace';
import { shouldCast as shouldCastProtectionFromPoison } from '../spells/protection_from_poison';
import { shouldCast as shouldCastPrayerOfHealing } from '../spells/prayer_of_healing';
import { shouldCast as shouldCastKnock } from '../spells/knock';
import { shouldCast as shouldCastArcaneLock } from '../spells/arcane_lock';

// ── Session 21 — Real-mechanics migration (7 combat damage spells) ─────────
// Migrated from the Session 19/20 generic dispatch registry to bespoke
// implementations with real mechanical effects (DEX/CON saves, spell
// attack rolls, AoE damage). Each planner branch mirrors the Session 18
// bespoke pattern (Moonbeam / Shatter / Scorching Ray).
import { shouldCast as shouldCastFireball } from '../spells/fireball';
import { shouldCast as shouldCastLightningBolt } from '../spells/lightning_bolt';
import { shouldCast as shouldCastConeOfCold } from '../spells/cone_of_cold';
import { shouldCast as shouldCastInflictWounds } from '../spells/inflict_wounds';
import { shouldCast as shouldCastChromaticOrb } from '../spells/chromatic_orb';
import { shouldCast as shouldCastCatapult } from '../spells/catapult';
import { shouldCast as shouldCastIceKnife } from '../spells/ice_knife';

// ── Session 23 — Real-mechanics migration batch 2 (7 high-damage spells L4-9) ─
// Migrated from the Session 19/20 generic dispatch registry to bespoke
// implementations with real mechanical effects (CON/DEX saves, HP-check
// instakill, AoE damage + blindness). Each planner branch mirrors the
// Session 22 bespoke pattern (Catapult / Shatter / Fireball), plus a NEW
// HP-check instakill pattern for Power Word Kill.
import { shouldCast as shouldCastBlight } from '../spells/blight';
import { shouldCast as shouldCastCloudkill } from '../spells/cloudkill';
import { shouldCast as shouldCastDisintegrate } from '../spells/disintegrate';
import { shouldCast as shouldCastHarm } from '../spells/harm';
import { shouldCast as shouldCastFingerOfDeath } from '../spells/finger_of_death';
import { shouldCast as shouldCastSunburst } from '../spells/sunburst';
import { shouldCast as shouldCastPowerWordKill } from '../spells/power_word_kill';

// ── Session 24 — Megabatch batch 1 (L1 combat damage spells) ────────────
// Migrated from the Session 19/20 generic dispatch registry to bespoke
// implementations with real mechanical effects. Each planner branch mirrors
// the Session 21/22/23 bespoke pattern. Witch Bolt's branch auto-detects
// DoT mode (concentrating on Witch Bolt) vs fresh cast.
import { shouldCast as shouldCastChaosBolt } from '../spells/chaos_bolt';
import { shouldCast as shouldCastEarthTremor } from '../spells/earth_tremor';
import { shouldCast as shouldCastFrostFingers } from '../spells/frost_fingers';
import { shouldCast as shouldCastMagnifyGravity } from '../spells/magnify_gravity';
import { shouldCast as shouldCastRayOfSickness } from '../spells/ray_of_sickness';
import { shouldCast as shouldCastSpellfireFlare } from '../spells/spellfire_flare';
import { shouldCast as shouldCastWardaway } from '../spells/wardaway';
import { shouldCast as shouldCastWitchBolt } from '../spells/witch_bolt';
import { shouldCast as shouldCastMindSpike } from '../spells/mind_spike';
import { shouldCast as shouldCastSprayOfCards } from '../spells/spray_of_cards';
import { shouldCast as shouldCastEruptingEarth } from '../spells/erupting_earth';
import { shouldCast as shouldCastLifeTransference } from '../spells/life_transference';
import { shouldCast as shouldCastPulseWave } from '../spells/pulse_wave';
import { shouldCast as shouldCastTidalWave } from '../spells/tidal_wave';
import { shouldCast as shouldCastVampiricTouch } from '../spells/vampiric_touch';
import { shouldCast as shouldCastElementalBane } from '../spells/elemental_bane';
import { shouldCast as shouldCastGravitySinkhole } from '../spells/gravity_sinkhole';
import { shouldCast as shouldCastIceStorm } from '../spells/ice_storm';
import { shouldCast as shouldCastSickeningRadiance } from '../spells/sickening_radiance';
import { shouldCast as shouldCastSpellfireStorm } from '../spells/spellfire_storm';
import { shouldCast as shouldCastStormSphere } from '../spells/storm_sphere';
import { shouldCast as shouldCastVitriolicSphere } from '../spells/vitriolic_sphere';
import { shouldCast as shouldCastDestructiveWave } from '../spells/destructive_wave';
import { shouldCast as shouldCastEnervation } from '../spells/enervation';
import { shouldCast as shouldCastFlameStrike } from '../spells/flame_strike';
import { shouldCast as shouldCastImmolation } from '../spells/immolation';
import { shouldCast as shouldCastMaelstrom } from '../spells/maelstrom';
import { shouldCast as shouldCastNegativeEnergyFlood } from '../spells/negative_energy_flood';
import { shouldCast as shouldCastSteelWindStrike } from '../spells/steel_wind_strike';
import { shouldCast as shouldCastSynapticStatic } from '../spells/synaptic_static';
import { shouldCast as shouldCastChainLightning } from '../spells/chain_lightning';
import { shouldCast as shouldCastCircleOfDeath } from '../spells/circle_of_death';
import { shouldCast as shouldCastGravityFissure } from '../spells/gravity_fissure';
import { shouldCast as shouldCastMentalPrison } from '../spells/mental_prison';
import { shouldCast as shouldCastSunbeam } from '../spells/sunbeam';
import { shouldCast as shouldCastCrownOfStars } from '../spells/crown_of_stars';
import { shouldCast as shouldCastFireStorm } from '../spells/fire_storm';
import { shouldCast as shouldCastDarkStar } from '../spells/dark_star';
import { shouldCast as shouldCastEarthquake } from '../spells/earthquake';
import { shouldCast as shouldCastFeeblemind } from '../spells/feeblemind';
import { shouldCast as shouldCastIncendiaryCloud } from '../spells/incendiary_cloud';
import { shouldCast as shouldCastMaddeningDarkness } from '../spells/maddening_darkness';
import { shouldCast as shouldCastPsychicScream } from '../spells/psychic_scream';
import { shouldCast as shouldCastRavenousVoid } from '../spells/ravenous_void';

// ── Session 25 — Megabatch batch 2 (save-or-condition spells) ────────────
import { shouldCast as shouldCastWeird } from '../spells/weird';
import { shouldCast as shouldCastPowerWordStun } from '../spells/power_word_stun';
import { shouldCast as shouldCastDominateMonster } from '../spells/dominate_monster';
import { shouldCast as shouldCastPowerWordPain } from '../spells/power_word_pain';
import { shouldCast as shouldCastWhirlwind } from '../spells/whirlwind';
import { shouldCast as shouldCastReverseGravity } from '../spells/reverse_gravity';
import { shouldCast as shouldCastEyebite } from '../spells/eyebite';
import { shouldCast as shouldCastFleshToStone } from '../spells/flesh_to_stone';
import { shouldCast as shouldCastMassSuggestion } from '../spells/mass_suggestion';

// ── Session 19 — bulk-implementation generic dispatch (262 new spells) ────
import { GENERIC_SPELL_LIST } from '../spells/_generic_registry';
import { selectAction, selfPreserveDecision, selectLegendaryAction } from './actions';
import {
  canReach, bestAdjacentPos, bestRangedPosition,
  adjacentEnemyCount, livingEnemiesOf, livingAlliesOf, posKey, distanceFt, chebyshev3D
} from '../engine/movement';
import { makeImprovisedUnarmed, makeImprovisedWeapon, effectiveSpeed } from '../engine/utils';
import { hasLineOfSight } from '../engine/los';
import { bestAttackAction } from './actions';

// ---- Empty plan helper --------------------------------------

function emptyPlan(self: Combatant): TurnPlan {
  return {
    combatantId: self.id,
    targetId: null,
    action: null,
    bonusAction: null,
    reaction: null,
    moveBefore: null,
    moveAfter: null,
  };
}

// ---- Condition gate -----------------------------------------

/**
 * Check incapacitating conditions at the start of the turn.
 * Returns true if the creature cannot act (plan remains empty).
 * Design doc §6: CONDITION CHECK node.
 */
function isIncapacitated(self: Combatant): boolean {
  return self.conditions.has('incapacitated')
      || self.conditions.has('paralyzed')
      || self.conditions.has('stunned')
      || self.conditions.has('unconscious');
}

// ---- Movement planner ---------------------------------------

/**
 * Plan where to move relative to the chosen action and target.
 * - Melee: move adjacent to target (or toward it if out of movement)
 * - Ranged/Spell: find a safe ranged position
 * - Dash: move as far as possible toward target
 * Returns { moveBefore, moveAfter } positions.
 */
function planMovement(
  self: Combatant,
  target: Combatant,
  chosenAction: PlannedAction,
  battlefield: Battlefield
): { moveBefore: TurnPlan['moveBefore']; moveAfter: TurnPlan['moveAfter'] } {
  if (chosenAction.type === 'dash') {
    // Action Dash: the engine will add a speed stipend before executing this move.
    // Plan to move adjacent to the target with the enlarged budget.
    const dest = bestAdjacentPos(self, target, battlefield);
    return { moveBefore: dest, moveAfter: null };
  }

  const action = chosenAction.action;
  const isRanged = action?.attackType === 'ranged' || action?.attackType === 'spell';

  if (isRanged && action?.range) {
    // Ranged: find position in range but safe from melee
    const idealRange = action.range.normal;
    const safePos = bestRangedPosition(self, target, idealRange, 10, battlefield);
    return { moveBefore: safePos, moveAfter: null };
  }

  // Melee: move adjacent before action if not already in reach
  if (action && !canReach(self, target, action)) {
    const dest = bestAdjacentPos(self, target, battlefield);
    return { moveBefore: dest, moveAfter: null };
  }

  // Already in reach: no movement needed (or optional repositioning)
  return { moveBefore: null, moveAfter: null };
}

// ---- Cunning Action (Rogue Level 2+) ------------------------

/**
 * Compute a 1-square retreat destination for the hit-and-run Disengage pattern.
 * Steps one grid square directly away from the target; clamps to battlefield bounds.
 * Falls back to the orthogonal axis if the primary retreat direction goes off-map.
 * @param startPos — position from which the Rogue is attacking (after moveBefore)
 */
function cunningRetreatPos(startPos: Vec3, target: Combatant, bf: Battlefield): Vec3 {
  const dx = startPos.x - target.pos.x;
  const dy = startPos.y - target.pos.y;

  // Try candidates in priority order: primary axis away from target, then secondary
  const candidates: Vec3[] = [];

  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    // Primary: step in x (dominant)
    candidates.push({ x: startPos.x + Math.sign(dx), y: startPos.y, z: startPos.z });
    // Secondary: step in y
    if (dy !== 0) {
      candidates.push({ x: startPos.x, y: startPos.y + Math.sign(dy), z: startPos.z });
    } else {
      candidates.push({ x: startPos.x, y: startPos.y + 1, z: startPos.z });
    }
  } else if (dy !== 0) {
    // Primary: step in y
    candidates.push({ x: startPos.x, y: startPos.y + Math.sign(dy), z: startPos.z });
    // Secondary: step in x
    if (dx !== 0) {
      candidates.push({ x: startPos.x + Math.sign(dx), y: startPos.y, z: startPos.z });
    } else {
      candidates.push({ x: startPos.x + 1, y: startPos.y, z: startPos.z });
    }
  } else {
    // Exactly on top of target — default to north
    candidates.push({ x: startPos.x, y: startPos.y + 1, z: startPos.z });
  }

  // Return the first candidate that's within bounds and differs from startPos
  for (const c of candidates) {
    const clamped: Vec3 = {
      x: Math.max(0, Math.min(bf.width  - 1, c.x)),
      y: Math.max(0, Math.min(bf.height - 1, c.y)),
      z: startPos.z,
    };
    if (posKey(clamped) !== posKey(startPos)) return clamped;
  }

  // All directions off-map (1×1 battlefield?) — return startPos; caller checks
  return startPos;
}

/**
 * Plan Cunning Action bonus for a Rogue (Level 2+).
 * Returns { bonusAction, moveAfter } for the caller to apply to the TurnPlan.
 *
 * Implemented:
 *   DISENGAGE — after a melee attack, Disengage as bonus action and step back.
 *   "Hit and run": attack → disengage → retreat 5 ft. No OA possible.
 *
 * Deferred:
 *   DASH — bonus-action Dash needs to fire before movement (engine ordering change).
 *   HIDE — requires LOS/cover tracking to resolve stealth meaningfully.
 *
 * @param startPos — the Rogue's planned attack position (plan.moveBefore ?? self.pos)
 */
function planCunningAction(
  self: Combatant,
  chosenAction: PlannedAction | null,
  target: Combatant | null,
  startPos: Vec3,
  bf: Battlefield
): {
  bonusAction: PlannedAction | null;
  moveAfter:   Vec3 | null;
  moveBefore?: Vec3 | null;   // set when Dash overrides movement
  overrideAction?: PlannedAction | null; // set when Dash converts action-Dash → melee attack
} {
  // ── Case 1: DISENGAGE ─────────────────────────────────────
  // After a melee attack, use bonus action to Disengage and step back (hit-and-run).
  if (
    chosenAction?.type === 'attack' &&
    chosenAction.action?.attackType === 'melee' &&
    target !== null
  ) {
    const retreatDest = cunningRetreatPos(startPos, target, bf);
    const canRetreat  = posKey(retreatDest) !== posKey(startPos);
    return {
      bonusAction: {
        type: 'disengage',
        action: null,
        targetId: null,
        description: `${self.name} uses Cunning Action: Disengage`,
      },
      moveAfter: canRetreat ? retreatDest : null,
    };
  }

  // ── Case 2: DASH ──────────────────────────────────────────
  // The AI chose action-Dash because it couldn't reach the target with normal move.
  // PHB p.96: Rogue can instead use the BONUS action to Dash, freeing the main action
  // for an attack.  This is only worthwhile if the bonus Dash's stipend covers the gap.
  //
  // PHB p.192: Dash gives a stipend equal to speed after condition modifiers.
  // So: totalBudget = current movementFt (from resetBudget) + effectiveSpeed.
  //
  // IMPORTANT: use self.pos (current position), not startPos (action-Dash destination).
  // We are OVERRIDING the action-Dash, so movement still starts from self.pos.
  if (chosenAction?.type === 'dash' && target !== null) {
    const eff         = effectiveSpeed(self);
    const totalBudget = self.budget.movementFt + eff;
    // Distance from current position, not the planned (now-cancelled) Dash destination.
    const dist        = distanceFt(self.pos, target.pos);

    // Find the best melee action available to the Rogue.
    const meleeCandidates = self.actions.filter(
      a => !a.isMultiattack && a.costType === 'action' && a.attackType === 'melee'
    );
    const bestReach = meleeCandidates.length > 0
      ? Math.max(...meleeCandidates.map(a => a.reach))
      : 0;
    const movementNeeded = Math.max(0, dist - bestReach);

    if (meleeCandidates.length > 0 && totalBudget >= movementNeeded) {
      // Pick the highest-damage melee attack (same ranking as bestAttackAction).
      const bestMelee = meleeCandidates.reduce((best, a) => {
        // Simple tiebreak: prefer higher reach, then first listed
        return (a.reach ?? 5) > (best.reach ?? 5) ? a : best;
      });

      const dest = bestAdjacentPos(self, target, bf);
      return {
        bonusAction: {
          type: 'dash',
          action: null,
          targetId: null,
          description: `${self.name} uses Cunning Action: Dash`,
        },
        moveAfter:      null,
        moveBefore:     dest,
        overrideAction: {
          type: 'attack',
          action: bestMelee,
          targetId: target.id,
          description: `${self.name} attacks ${target.name} with ${bestMelee.name} (Cunning Dash)`,
        },
      };
    }
  }

  // ── Case 3: HIDE ──────────────────────────────────────────
  // PHB p.96: Rogue can use Cunning Action to Hide as a bonus action.
  //
  // Conditions for planning Hide:
  //   1. No attack planned this turn (attacking while hidden immediately reveals you)
  //   2. Rogue is not already hidden
  //   3. Battlefield has at least one open vision-blocking obstacle
  //   4. No living enemy currently has line of sight to the Rogue's position
  //
  // LOS check uses self.pos (current position). In most Case-3 scenarios,
  // no moveBefore was planned, so self.pos = startPos. If a moveBefore was
  // planned to a non-attack action, this check is slightly conservative.
  const noAttackPlanned = chosenAction?.type !== 'attack';
  if (noAttackPlanned && !self.conditions.has('hidden')) {
    const hasVisionObstacle = (bf.obstacles ?? []).some(
      o => !o.isOpen && o.blocksVision
    );
    if (hasVisionObstacle) {
      const enemies = [...bf.combatants.values()].filter(
        c => c.faction !== self.faction && !c.isDead && !c.isUnconscious
      );
      const anyEnemySees = enemies.some(e => hasLineOfSight(e, self, bf));
      if (!anyEnemySees) {
        return {
          bonusAction: {
            type: 'hide',
            action: null,
            targetId: null,
            description: `${self.name} uses Cunning Action: Hide`,
          },
          moveAfter: null,
        };
      }
    }
  }

  return { bonusAction: null, moveAfter: null };
}

// ---- Bonus action planner -----------------------------------

/**
 * Plan bonus action for all combatants.
 * Order of priority (PC-specific resources first, then stat-block bonus actions):
 *   1. Rage (Barbarian) — always worth it if enemies present
 *   2. Second Wind (Fighter) — if wounded
 *   3. Bardic Inspiration — give to highest-value ally
 *   4. Hex (Warlock) — before first attack if slot available
 *   5. Stat-block bonus action attacks (monsters + monk Martial Arts)
 */
function planBonusAction(
  self: Combatant,
  target: Combatant | null,
  battlefield: Battlefield
): PlannedAction | null {
  // --- 1. Rage ---
  if (self.resources?.rage !== undefined && shouldRage(self, battlefield)) {
    return activateRagePlan(self);
  }

  // --- 2. Second Wind ---
  if (self.resources?.secondWind !== undefined && shouldSecondWind(self)) {
    return secondWindPlan(self);
  }

  // --- 2.5. Healing Word (Cleric / Druid / Bard — bonus action heal) ---
  // Higher priority than Bardic Inspiration: reviving a downed ally is urgent.
  // Only triggers when a heal target exists (downed ally or critical HP within 60ft).
  {
    const hwTarget = shouldCastHW(self, battlefield);
    if (hwTarget) {
      return {
        type: 'healingWord',
        action: null,
        targetId: hwTarget.id,
        description: `${self.name} casts Healing Word on ${hwTarget.name}`,
      };
    }
  }

  // --- 2.7. Shield of Faith (bonus action concentration buff) ---
  // Priority: after emergency heals, before Bardic Inspiration.
  // Never casts if already concentrating (shouldCast guards this).
  {
    const sofTarget = shouldCastShieldOfFaith(self, battlefield);
    if (sofTarget && self.actions.some(a => a.name === 'Shield of Faith')) {
      return {
        type: 'shieldOfFaith',
        action: null,
        targetId: sofTarget.id,
        description: `${self.name} casts Shield of Faith on ${sofTarget.name}`,
      };
    }
  }

  // --- 2.8. Branding Smite (Paladin/Ranger bonus action self-buff) ---
  // PHB p.219: bonus action, self, concentration 1 min. Next weapon hit
  // deals +2d6 radiant. Cast BEFORE the caster's main-action weapon attack
  // on the same turn so the buff is primed for that attack.
  // v1: 1-round scratch flag (`_brandingSmiteActive`); concentration not
  // enforced (TG-002). Should be cast whenever the caster has a weapon
  // attack planned AND a 2nd-level slot AND no other concentration.
  // Priority: after Shield of Faith (which is also concentration), before
  // Bardic Inspiration. Only triggers when shouldCastBrandingSmite returns
  // true (caster has a weapon attack, an enemy exists, not already primed).
  if (self.actions.some(a => a.name === 'Branding Smite') && shouldCastBrandingSmite(self, battlefield)) {
    return {
      type: 'brandingSmite',
      action: null,
      targetId: self.id,
      description: `${self.name} casts Branding Smite (next weapon hit +2d6 radiant)`,
    };
  }

  // --- 2.9. Misty Step (Sorcerer/Warlock/Wizard bonus-action teleport) ---
  // PHB p.260: bonus action, self, NO concentration. Teleport up to 30 ft.
  // v1: teleports toward the nearest enemy (to close distance) or away from
  // it (if below 25% HP — escape). NOT concentration, so it can stack with
  // an existing concentration spell. Priority: after Branding Smite (which
  // is concentration), before Bardic Inspiration. Fires when the caster is
  // out of range of its primary target (closing distance) or low on HP
  // (escaping). shouldCast returns { destination } or null.
  if (self.actions.some(a => a.name === 'Misty Step')) {
    const ms = shouldCastMistyStep(self, battlefield);
    if (ms) {
      return {
        type: 'mistyStep',
        action: null,
        targetId: self.id,    // self-targeted; destination is in the plan
        description: `${self.name} casts Misty Step (teleport 30 ft)`,
      };
    }
  }

  // --- 2.10. Spiritual Weapon (Cleric bonus-action attack + persistent zone) ---
  // PHB p.278: bonus action, 60 ft, melee spell attack 1d8 force + persistent
  // damage_zone 1d8 force/turn (ticksRemaining: 10), NO concentration, 1 min.
  // Strong bonus action — pairs with a main-action attack or cantrip. The
  // persistent damage_zone represents the spiritual weapon attacking the same
  // target on subsequent turns (v1 simplification: no separate bonus-action
  // attack command — the damage_zone auto-ticks). Priority: after Misty Step
  // (which is movement-utility), before Bardic Inspiration. shouldCast
  // returns Combatant | null (single highest-threat enemy within 60 ft).
  if (self.actions.some(a => a.name === 'Spiritual Weapon')) {
    const swTarget = shouldCastSpiritualWeapon(self, battlefield);
    if (swTarget) {
      return {
        type: 'spiritualWeapon',
        action: null,
        targetId: swTarget.id,
        description: `${self.name} casts Spiritual Weapon at ${swTarget.name} (1d8 force + persistent)`,
      };
    }
  }

  // --- 3. Bardic Inspiration ---
  if (self.resources?.bardicInspiration !== undefined) {
    const biTarget = bardicInspirationTarget(self, battlefield);
    if (biTarget) return bardicInspirationPlan(self, biTarget);
  }

  // --- 4. Hex (Warlock) ---
  if (target && self.resources?.pactSlots !== undefined && shouldCastHex(self, target.id)) {
    return hexPlan(self, target.id);
  }

  // --- 5. Stat-block bonus action attack ---
  const baAttack = self.actions.find(
    a => a.costType === 'bonusAction' && a.attackType !== null
  );
  if (baAttack && target && canReach(self, target, baAttack)) {
    return {
      type: 'attack',
      action: baAttack,
      targetId: target.id,
      description: `${self.name} bonus action: ${baAttack.name} on ${target.name}`,
    };
  }

  return null;
}

// ---- Retreat plan -------------------------------------------

function planRetreat(
  self: Combatant,
  battlefield: Battlefield
): TurnPlan {
  const plan = emptyPlan(self);
  const adjEnemies = adjacentEnemyCount(self, battlefield);

  // Find a retreat position: away from all enemies
  const enemies = livingEnemiesOf(self, battlefield);
  if (enemies.length === 0) return plan;

  // Simple retreat: move away from nearest enemy centroid
  const cx = enemies.reduce((s, e) => s + e.pos.x, 0) / enemies.length;
  const cy = enemies.reduce((s, e) => s + e.pos.y, 0) / enemies.length;
  const dx = self.pos.x - cx;
  const dy = self.pos.y - cy;
  const mag = Math.sqrt(dx * dx + dy * dy) || 1;
  const steps = Math.floor((self.budget.movementFt / 5));
  const retreatPos = {
    x: Math.round(self.pos.x + (dx / mag) * steps),
    y: Math.round(self.pos.y + (dy / mag) * steps),
    z: self.pos.z,
  };

  if (adjEnemies > 0) {
    // Must Disengage first to avoid OA
    plan.action = {
      type: 'disengage',
      action: null,
      targetId: null,
      description: `${self.name} disengages`,
    };
  } else {
    // Already not in melee — Dash
    plan.action = {
      type: 'dash',
      action: null,
      targetId: null,
      description: `${self.name} dashes away`,
    };
  }

  plan.moveBefore = retreatPos;
  return plan;
}

// ---- Main planner -------------------------------------------

/**
 * Plan a full turn for `self` based on its AI profile.
 * Implements the state machine from design doc §6.
 *
 * The engine is responsible for:
 * - Calling resetBudget() before planTurn()
 * - Executing the TurnPlan (rolling dice, applying damage, moving)
 * - Calling updatePerception() after each action
 */
export function planTurn(self: Combatant, battlefield: Battlefield): TurnPlan {
  const plan = emptyPlan(self);

  // === CONDITION GATE ===
  if (isIncapacitated(self)) {
    // Can't act — frightened handling would go here too
    return plan;
  }

  // === DEFENDER MODE ===
  // Defender creatures may only Dash, Dodge, or Hide. Never attack.
  // Controlled mounts follow the same restriction via the mount branch in combat.ts,
  // but explicit isDefender covers non-mount creatures (pack animals, non-combatants, etc.)
  if (self.isDefender) {
    plan.action = {
      type: 'dodge',
      action: null,
      targetId: null,
      description: `${self.name} takes Dodge action (defender mode)`,
    };
    return plan;
  }

  // === CANNOT ATTACK GATE ===
  // Statblock explicitly prohibits attacking. Creature still takes Dodge as best option.
  if (self.cannotAttack) {
    plan.action = {
      type: 'dodge',
      action: null,
      targetId: null,
      description: `${self.name} takes Dodge action (cannot attack)`,
    };
    return plan;
  }

  // === GRAPPLE ESCAPE ===
  // PHB p.195: a grappled creature (speed = 0) may use its action to attempt escape.
  // Smart AI always escapes; nearest/weakest AI escape only when no melee target is reachable.
  if (self.conditions.has('grappled') && self.grappledBy) {
    const grappler = battlefield.combatants.get(self.grappledBy);
    const shouldEscape = (() => {
      if (!grappler || grappler.isDead || grappler.isUnconscious) return true; // auto-free
      if (self.aiProfile === 'smart') return true;
      // For other profiles: escape if can't reach any enemy (speed is effectively 0)
      const enemies = [...battlefield.combatants.values()].filter(
        c => c.faction !== self.faction && !c.isDead && !c.isUnconscious
      );
      const inMelee = enemies.some(e => {
        const dx = Math.abs(e.pos.x - self.pos.x);
        const dy = Math.abs(e.pos.y - self.pos.y);
        const dz = Math.abs(e.pos.z - self.pos.z);
        const dist = Math.max(dx, dy, dz) * 5; // Chebyshev 3D → feet
        const reach = (self.actions[0]?.range?.normal ?? 5);
        return dist <= reach;
      });
      return !inMelee;
    })();

    if (shouldEscape) {
      plan.action = {
        type: 'escapeGrapple',
        action: null,
        targetId: self.grappledBy,
        description: `${self.name} attempts to escape ${grappler?.name ?? 'the grapple'}!`,
      };
      return plan;
    }
  }

  // === SELF-PRESERVE CHECK (Smart only) ===
  if (self.aiProfile === 'smart') {
    const preserve = selfPreserveDecision(self, battlefield);
    if (preserve === 'retreat') return planRetreat(self, battlefield);
    if (preserve === 'dodge') {
      plan.action = {
        type: 'dodge',
        action: null,
        targetId: null,
        description: `${self.name} dodges (outnumbered)`,
      };
      return plan;
    }
  }

  // === LAY ON HANDS HEALING OVERRIDE (Paladin) ===
  // Higher priority than target selection — revive downed allies first.
  if (self.resources?.layOnHands) {
    const loh = shouldLayOnHands(self, battlefield);
    if (loh.use && loh.targetId) {
      plan.targetId = loh.targetId;
      plan.action = layOnHandsPlan(self, loh.targetId);
      return plan;
    }
  }

  // === FAMILIAR HELP ACTION ===
  // Familiars (role: 'familiar') use Help to grant advantage to bonded caster's next attack.
  // Help is an action that targets one ally whose attack you can see before the end of your turn.
  if (self.role === 'familiar' && self.bonded) {
    const bonded = battlefield.combatants.get(self.bonded);
    const allies = livingAlliesOf(self, battlefield);
    
    // Only use Help if bonded ally is present, healthy, and in melee range
    if (bonded && allies.includes(bonded)) {
      const distToBonded = Math.max(
        Math.abs(bonded.pos.x - self.pos.x),
        Math.abs(bonded.pos.y - self.pos.y),
        Math.abs(bonded.pos.z - self.pos.z)
      );
      
      // If bonded caster is healthy and within 5ft (melee help range), use Help action
      if (distToBonded <= 1 && bonded.currentHP >= bonded.maxHP * 0.5) {
        plan.targetId = bonded.id;
        plan.action = {
          type: 'help',
          action: null,
          targetId: bonded.id,
          description: `${self.name} uses Help action on ${bonded.name}`,
        };
        return plan;
      }
    }
  }

  // === DEFEND PROFILE (explicitly passive creatures) ===
  // Only creatures whose stat block or lore says "defends unless commanded"
  // are spawned with aiProfile: 'defend' (e.g. Giant Fly from Ebony Fly figurine).
  // INT score alone does NOT determine this — a T-Rex (INT 2) still attacks freely.
  if (self.aiProfile === 'defend') {
    // Only retaliate against enemies already in melee reach — never pursue
    const adjEnemy = livingEnemiesOf(self, battlefield).find(
      e => Math.max(Math.abs(e.pos.x - self.pos.x), Math.abs(e.pos.y - self.pos.y)) <= 1
    ) ?? null;
    if (adjEnemy) {
      plan.targetId = adjEnemy.id;
      plan.action = selectAction(self, adjEnemy, battlefield);
    }
    return plan;  // nothing adjacent: stand still
  }

  // === BLESS (buff allies) — cast before target selection ===
  // Bless is a buff spell that targets allies — it fires regardless of whether the caster
  // has an enemy target. Cast round 1 before anything else, when conditions are met.
  // Only fires when caster is NOT already concentrating.
  // GUARD: skip Bless if there is a downed ally in Cure Wounds range (5ft) — urgent healing
  // takes higher priority. The Cure Wounds check after selectTarget will handle it.
  {
    const hasDownedAllyInReach = self.actions.some(a => a.name === 'Cure Wounds')
      && [...battlefield.combatants.values()].some(
        c => c.faction === self.faction && c.isUnconscious && !c.isDead
          && chebyshev3D(self.pos, c.pos) * 5 <= 5
      );

    if (!hasDownedAllyInReach) {
      const blessTargets = shouldCastBless(self, battlefield);
      if (blessTargets) {
        plan.action = {
          type: 'bless',
          action: null,
          targetId: blessTargets[0].id,
          description: `${self.name} casts Bless`,
        };
        plan.targetId = blessTargets[0].id;
        plan.bonusAction = planBonusAction(self, null, battlefield);
        return plan;
      }
    }
  }

  // === SELECT TARGET ===
  const target = selectTarget(self, battlefield);
  if (!target) return plan; // No enemies left

  plan.targetId = target.id;

  // === CURE WOUNDS (action heal) — checked before attack ===
  // Reviving a downed ally or saving a critical ally takes precedence over attacking.
  // Only fires when the caster has 'Cure Wounds' in their actions AND a slot available.
  if (self.actions.some(a => a.name === 'Cure Wounds')) {
    const cwTarget = shouldCastCureWounds(self, battlefield);
    if (cwTarget) {
      plan.action = spellHealPlan(self, cwTarget.id, false);
      plan.targetId = cwTarget.id;
      // Movement: move toward the heal target if needed (Cure Wounds is touch range)
      const dist = chebyshev3D(self.pos, cwTarget.pos) * 5;
      if (dist > 5) {
        plan.moveBefore = bestAdjacentPos(self, cwTarget, battlefield);
      }
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === WARDING BOND (action buff) — protect an adjacent ally before combat heats up ===
  // Cast once, early in the fight. Requires resources.wardingBond.remaining > 0 and
  // a living unbonded ally within 5 ft (touch range). Does NOT require concentration.
  // Priority: after Cure Wounds (urgent heal) but before Faerie Fire (offensive advantage).
  if (self.resources?.wardingBond && self.resources.wardingBond.remaining > 0) {
    const wbTarget = shouldCastWardingBond(self, battlefield);
    if (wbTarget) {
      plan.action = {
        type: 'wardingBond',
        action: null,
        targetId: wbTarget.id,
        description: `${self.name} casts Warding Bond on ${wbTarget.name}`,
      };
      plan.targetId = wbTarget.id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === SLEEP (no-save AoE stun) — strongest opener at level 1 ===
  // 5d8 HP budget, no attack roll, no saving throw.  Starting from the lowest-HP
  // enemy, renders creatures unconscious.  More reliable than Entangle (which
  // allows a STR save) and more decisive (unconscious > restrained).
  //
  // Cast conditions: has Sleep, has slot, ≥1 enemy in 90ft whose HP is plausibly
  // within a 5d8 budget.  At level 1, essentially all enemies qualify (5d8 avg ≈ 22.5
  // HP; most level-1 enemies have ≤ 14 HP).  We let shouldCast decide viability —
  // if it returns targets, we cast.  Sleep is NOT concentration so it fires freely.
  //
  // Sorcerer: Sleep is their primary crowd-control (no Entangle, no Faerie Fire).
  // Wizard: likewise; Sleep + Thunderwave form their level-1 toolkit.
  {
    const sleepTargets = shouldCastSleep(self, battlefield);
    if (sleepTargets && sleepTargets.length >= 1) {
      plan.action = {
        type: 'sleep',
        action: null,
        targetId: sleepTargets[0].id,
        description: `${self.name} casts Sleep`,
      };
      plan.targetId = sleepTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === ENTANGLE (action control) — cast before attacking if conditions met ===
  // Restrained enemies have: speed 0, disadvantage on attacks, attacks vs them have advantage.
  // Stronger overall than Faerie Fire (which only grants advantage). Cast first.
  // Only fires when caster is NOT already concentrating.
  {
    const entangleTargets = shouldCastEntangle(self, battlefield);
    if (entangleTargets) {
      plan.action = {
        type: 'entangle',
        action: null,
        targetId: entangleTargets[0].id,
        description: `${self.name} casts Entangle`,
      };
      plan.targetId = entangleTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === THUNDERWAVE (melee AoE damage + push) — fires when ≥2 enemies within 15 ft ===
  // NOT concentration — can be used while concentrating on Entangle/Faerie Fire/Bless.
  // Only justified by slot cost when multiple enemies are in range (splash value).
  // A single adjacent enemy is handled by normal attacks (no slot needed).
  {
    const twTargets = shouldCastThunderwave(self, battlefield);
    if (twTargets && twTargets.length >= 2) {
      plan.action = {
        type: 'thunderwave',
        action: null,
        targetId: twTargets[0].id,
        description: `${self.name} casts Thunderwave`,
      };
      plan.targetId = twTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === BURNING HANDS (15-ft cone fire AoE) — fires when ≥1 enemy in cone range ===
  // NOT concentration. Sorcerer/Wizard. DEX save: fail = 3d6, success = half.
  // Cone aims toward nearest enemy; all enemies in that cone are affected.
  // Fires on ≥1 target — even single-target 3d6 avg 10.5 beats Fire Bolt avg 5.5.
  // Placed after Thunderwave (15-ft cube) since overlapping range profile.
  {
    const bhTargets = shouldCastBurningHands(self, battlefield);
    if (bhTargets && bhTargets.length >= 1) {
      plan.action = {
        type: 'burningHands',
        action: null,
        targetId: bhTargets[0].id,
        description: `${self.name} casts Burning Hands`,
      };
      plan.targetId = bhTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === ARMS OF HADAR (close-range AoE damage + reaction denial) — ≥2 enemies within 10 ft ===
  // 10-ft radius sphere centred on caster (Euclidean circle AoE), NOT concentration.
  // Tighter range than Thunderwave (10 ft vs 15 ft), but strips reactions on failed save —
  // preventing OAs and mounted-redirect until the target's next turn.
  // Only worthwhile when multiple enemies are in the circle; a single adjacent enemy is
  // better handled by Eldritch Blast or a melee attack.
  {
    const aohTargets = shouldCastArmsOfHadar(self, battlefield);
    if (aohTargets && aohTargets.length >= 2) {
      plan.action = {
        type: 'armsOfHadar',
        action: null,
        targetId: aohTargets[0].id,
        description: `${self.name} casts Arms of Hadar`,
      };
      plan.targetId = aohTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === FAERIE FIRE (action control) — cast before attacking if conditions met ===
  // Best early in a fight: advantage on all attacks against outlined enemies is
  // extremely valuable. Only fires when caster is NOT already concentrating.
  {
    const ffTargets = shouldCastFaerieFire(self, battlefield);
    if (ffTargets) {
      plan.action = {
        type: 'faerieFire',
        action: null,
        targetId: ffTargets[0].id,
        description: `${self.name} casts Faerie Fire`,
      };
      plan.targetId = ffTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === DISSONANT WHISPERS (action, single-target, Bard) ===
  // WIS save: fail = 3d6 psychic + forced flee at full speed (reaction used).
  // Success = half, no movement. No concentration. Range 60 ft.
  // Bard's primary offensive spell. Fires when no higher-priority spell was chosen.
  if (!plan.action) {
    const dwTarget = shouldCastDissonantWhispers(self, battlefield);
    if (dwTarget) {
      plan.action = {
        type: 'dissonantWhispers',
        action: null,
        targetId: dwTarget.id,
        description: `${self.name} casts Dissonant Whispers on ${dwTarget.name}`,
      };
      plan.targetId = dwTarget.id;
      plan.bonusAction = planBonusAction(self, dwTarget, battlefield);
      return plan;
    }
  }

  // === GUIDING BOLT (action, single-target, Cleric) ===
  // Ranged spell attack, 120 ft. On hit: 4d6 radiant + next attack vs target has advantage.
  // Cleric's primary offensive spell. Fires when no AoE/control spell was chosen.
  if (!plan.action && target && shouldCastGuidingBolt(self, target, battlefield)) {
    plan.action = {
      type: 'guidingBolt',
      action: null,
      targetId: target.id,
      description: `${self.name} casts Guiding Bolt at ${target.name}`,
    };
    plan.targetId = target.id;
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }

  // === MAGIC MISSILE (action, single-target, ranged) ===
  // Auto-hit reliable damage. Fire when no AoE/control spell was chosen and target is in range.
  // Outperforms Fire Bolt (cantrip) in expected damage at the cost of a spell slot.
  if (!plan.action && target && shouldCastMagicMissile(self, target, battlefield)) {
    plan.action = {
      type: 'magicMissile',
      action: null,
      targetId: target.id,
      description: `${self.name} casts Magic Missile at ${target.name}`,
    };
  }

  // === LEVEL-2 SPELLS (action-time, added in Cantrip-z pivot Session 16) ===
  // These are 4 new PHB level-2 spells implemented in this session. Each is
  // guarded by `if (!plan.action)` so it only fires when no higher-priority
  // spell was chosen. Order within the block: Aid (multi-ally buff, highest
  // value) → Barkskin (single-ally buff) → Blur (self-buff) → Blindness/
  // Deafness (single-target debuff). All four return early via `return plan`
  // when they fire so the AI doesn't fall through to SELECT ACTION.

  // --- 11A. AID (multi-ally HP buff, no concentration) ---
  // PHB p.211: action, range 30 ft, up to 3 allies, +5 max & current HP.
  // 8 hr duration (no concentration) — fires freely alongside Bless / Faerie
  // Fire. Priority: after all concentration spells (in case the caster has
  // Bless/Faerie Fire/Entangle AND Aid, the concentration spell wins
  // because Aid can be cast later without breaking concentration).
  if (!plan.action && self.actions.some(a => a.name === 'Aid')) {
    const aidTargets = shouldCastAid(self, battlefield);
    if (aidTargets && aidTargets.length > 0) {
      plan.action = {
        type: 'aid',
        action: null,
        targetId: aidTargets[0].id,
        description: `${self.name} casts Aid on ${aidTargets.length} all${aidTargets.length !== 1 ? 'ies' : 'y'}`,
      };
      plan.targetId = aidTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // --- 11B. BARKSKIN (single-ally touch AC floor, concentration) ---
  // PHB p.217: action, touch, concentration 1 hr. AC ≥ 16. Only fires when
  // the caster is NOT already concentrating and an ally (or self) with AC<16
  // is in touch range. Priority: after Aid (which has no concentration
  // requirement, so Aid fires first if both are available).
  if (!plan.action && self.actions.some(a => a.name === 'Barkskin')) {
    const bkTarget = shouldCastBarkskin(self, battlefield);
    if (bkTarget) {
      plan.action = {
        type: 'barkskin',
        action: null,
        targetId: bkTarget.id,
        description: `${self.name} casts Barkskin on ${bkTarget.name}`,
      };
      plan.targetId = bkTarget.id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // --- 11C. BLINDNESS/DEAFNESS (single-target debuff, NO concentration) ---
  // PHB p.219: action, range 30 ft, CON save or blinded (v1: always blinded).
  // 1 min duration, NO concentration — fires freely alongside concentration
  // spells. Priority: after Barkskin (concentration); Blindness/Deafness
  // fires only when no concentration spell was chosen (so the caster can
  // keep their concentration slot open for Bless/Faerie Fire/Entangle).
  if (!plan.action && target && self.actions.some(a => a.name === 'Blindness/Deafness')) {
    const bdTarget = shouldCastBlindnessDeafness(self, battlefield);
    if (bdTarget) {
      plan.action = {
        type: 'blindnessDeafness',
        action: null,
        targetId: bdTarget.id,
        description: `${self.name} casts Blindness/Deafness at ${bdTarget.name}`,
      };
      plan.targetId = bdTarget.id;
      plan.bonusAction = planBonusAction(self, bdTarget, battlefield);
      return plan;
    }
  }

  // --- 11D. BLUR (self-buff, concentration) ---
  // PHB p.219: action, self, concentration 1 min. Disadv on attacks vs caster.
  // Lowest priority of the 4 new spells — fires only when no other spell was
  // chosen. Useful for squishy casters in melee range. The caster must NOT be
  // already concentrating (shouldCast guards this).
  if (!plan.action && self.actions.some(a => a.name === 'Blur') && shouldCastBlur(self, battlefield)) {
    plan.action = {
      type: 'blur',
      action: null,
      targetId: self.id,
      description: `${self.name} casts Blur`,
    };
    plan.targetId = self.id;
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }

  // === LEVEL-2 SPELLS batch 2 (action-time, added in Cantrip-z Session 16) ===
  // 5 new PHB level-2 spells. Each is guarded by `if (!plan.action)` so it
  // only fires when no higher-priority spell was chosen. Order within the
  // block: Hold Person (save-or-paralyzed, highest control value) →
  // Crown of Madness (save-or-charmed, similar but weaker) →
  // Cloud of Daggers (damage + persistent zone) →
  // Calm Emotions (ally debuff removal, niche) →
  // Mirror Image (self-buff, NO concentration — can stack with the above).
  // All five return early via `return plan` when they fire so the AI
  // doesn't fall through to SELECT ACTION.

  // --- 11E. HOLD PERSON (single-target save-or-paralyzed, concentration) ---
  // PHB p.251: action, 60 ft, WIS save or paralyzed, concentration 1 min.
  // Paralyzed is one of the strongest conditions in 5e (incapacitated +
  // can't move + attacks vs target have advantage + melee attacks auto-crit
  // — though v1's engine doesn't model the auto-crit). Highest priority of
  // the 5 new spells — removing the biggest enemy's action economy for the
  // entire combat (v1: end-of-turn save NOT modelled) is game-changing.
  // The caster must NOT be already concentrating (shouldCast guards this).
  if (!plan.action && self.actions.some(a => a.name === 'Hold Person')) {
    const hpTarget = shouldCastHoldPerson(self, battlefield);
    if (hpTarget) {
      plan.action = {
        type: 'holdPerson',
        action: null,
        targetId: hpTarget.id,
        description: `${self.name} casts Hold Person at ${hpTarget.name}`,
      };
      plan.targetId = hpTarget.id;
      plan.bonusAction = planBonusAction(self, hpTarget, battlefield);
      return plan;
    }
  }

  // --- 11F. CROWN OF MADNESS (single-target save-or-charmed, concentration) ---
  // PHB p.229: action, 120 ft, WIS save or charmed, concentration 1 min.
  // v1: forced-attack rider NOT modelled — functionally a save-or-charmed
  // debuff. Priority: after Hold Person (paralyzed is strictly stronger
  // than charmed). The caster must NOT be already concentrating.
  if (!plan.action && self.actions.some(a => a.name === 'Crown of Madness')) {
    const comTarget = shouldCastCrownOfMadness(self, battlefield);
    if (comTarget) {
      plan.action = {
        type: 'crownOfMadness',
        action: null,
        targetId: comTarget.id,
        description: `${self.name} casts Crown of Madness at ${comTarget.name}`,
      };
      plan.targetId = comTarget.id;
      plan.bonusAction = planBonusAction(self, comTarget, battlefield);
      return plan;
    }
  }

  // --- 11G. CLOUD OF DAGGERS (single-target damage + persistent zone, concentration) ---
  // PHB p.222: action, 60 ft, 4d4 slashing on cast (no save) + persistent
  // damage_zone (4d4 at start of each of target's turns). Priority: after
  // the save-or-control spells (Hold Person / Crown of Madness) since
  // those remove enemy action economy entirely, while Cloud of Daggers
  // "only" deals damage. The caster must NOT be already concentrating.
  if (!plan.action && self.actions.some(a => a.name === 'Cloud of Daggers')) {
    const codTarget = shouldCastCloudOfDaggers(self, battlefield);
    if (codTarget) {
      plan.action = {
        type: 'cloudOfDaggers',
        action: null,
        targetId: codTarget.id,
        description: `${self.name} casts Cloud of Daggers at ${codTarget.name}`,
      };
      plan.targetId = codTarget.id;
      plan.bonusAction = planBonusAction(self, codTarget, battlefield);
      return plan;
    }
  }

  // --- 11H. CALM EMOTIONS (ally debuff removal, concentration) ---
  // PHB p.221: action, 60 ft, concentration 1 min. v1: removes
  // charmed/frightened from allies (allies voluntarily fail the CHA save).
  // Niche — only fires when an ally is charmed or frightened. Priority:
  // after the offensive spells (Hold Person / Crown of Madness / Cloud of
  // Daggers) since those are more universally useful. The caster must NOT
  // be already concentrating.
  if (!plan.action && self.actions.some(a => a.name === 'Calm Emotions')) {
    const ceTargets = shouldCastCalmEmotions(self, battlefield);
    if (ceTargets && ceTargets.length > 0) {
      plan.action = {
        type: 'calmEmotions',
        action: null,
        targetId: ceTargets[0].id,
        description: `${self.name} casts Calm Emotions (suppressing charm/frighten on ${ceTargets.length} all${ceTargets.length !== 1 ? 'ies' : 'y'})`,
      };
      plan.targetId = ceTargets[0].id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // --- 11I. MIRROR IMAGE (self-buff, NO concentration) ---
  // PHB p.260: action, self, NO concentration, 1 min. 3 illusory
  // duplicates; attackers must roll d20 to retarget. Lowest priority of
  // the 5 new spells — fires only when no other spell was chosen. NOT
  // concentration, so it can stack with an existing concentration spell
  // (e.g. a Wizard concentrating on Blur could also cast Mirror Image).
  // Useful for squishy casters expecting to be attacked.
  if (!plan.action && self.actions.some(a => a.name === 'Mirror Image') && shouldCastMirrorImage(self, battlefield)) {
    plan.action = {
      type: 'mirrorImage',
      action: null,
      targetId: self.id,
      description: `${self.name} casts Mirror Image`,
    };
    plan.targetId = self.id;
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }

  // === LEVEL-2 SPELLS batch 3 (action-time, added in Cantrip-z Session 17) ===
  // 15 new PHB level-2 spells. Each is guarded by `if (!plan.action)` so it
  // only fires when no higher-priority spell was chosen. Order within the
  // block is by tactical priority:
  //   11J. Melf's Acid Arrow (ranged spell attack, highest damage, NO concentration — like a harder-hitting Fire Bolt)
  //   11K. Heat Metal (CON save, persistent 2d8 fire/turn, concentration)
  //   11L. Flaming Sphere (DEX save, persistent 2d6 fire/turn, concentration)
  //   11M. Cordon of Arrows (DEX save, persistent 1d6 piercing/turn × 4, NO concentration)
  //   11N. Enlarge/Reduce (CON save, buff/debuff, concentration)
  //   11O. Gust of Wind (STR save, push 15 ft, concentration)
  //   11P. Levitate (CON save or restrained, concentration)
  //   11Q. Invisibility (touch, invisible condition, concentration)
  //   11R. Magic Weapon (touch, weapon +1, concentration)
  //   11S. Enhance Ability (touch, ability-check advantage, concentration)
  //   11T. Flame Blade (self, +3d6 fire rider, concentration)
  //   11U. Alter Self (self, natural weapons, concentration)
  //   11V. Lesser Restoration (touch, condition removal, NO concentration)
  //   11W. Darkvision (touch, forward-compat, NO concentration)
  // All return early via `return plan` when they fire. Misty Step is a
  // BONUS ACTION and is added in planBonusAction (section 2.9).

  // --- 11J. MELF'S ACID ARROW (ranged spell attack, NO concentration) ---
  // PHB p.259: action, 90 ft, ranged spell attack, 4d4 acid + 2d4 delayed.
  // Highest-priority of the 15 new spells — it's a hard-hitting single-target
  // damage spell with no concentration requirement (can be cast while
  // concentrating on something else). The 4d4+2d4 acid total (avg 15) is
  // the highest damage of any level-2 spell in v1.
  if (!plan.action && self.actions.some(a => a.name === "Melf's Acid Arrow")) {
    const maaTarget = shouldCastMelfsAcidArrow(self, battlefield);
    if (maaTarget) {
      plan.action = {
        type: 'melfsAcidArrow',
        action: null,
        targetId: maaTarget.id,
        description: `${self.name} casts Melf's Acid Arrow at ${maaTarget.name}`,
      };
      plan.targetId = maaTarget.id;
      plan.bonusAction = planBonusAction(self, maaTarget, battlefield);
      return plan;
    }
  }

  // --- 11K. HEAT METAL (CON save, persistent damage_zone, concentration) ---
  // PHB p.250: action, 60 ft, 2d8 fire + persistent 2d8 fire/turn, concentration.
  // Very high damage potential (2d8 on cast + 2d8/turn = up to 18 dmg/round
  // at level 2). Priority after Melf's Acid Arrow (Heat Metal requires
  // concentration; Melf's doesn't).
  if (!plan.action && self.actions.some(a => a.name === 'Heat Metal')) {
    const hmTarget = shouldCastHeatMetal(self, battlefield);
    if (hmTarget) {
      plan.action = {
        type: 'heatMetal',
        action: null,
        targetId: hmTarget.id,
        description: `${self.name} casts Heat Metal on ${hmTarget.name}'s equipment`,
      };
      plan.targetId = hmTarget.id;
      plan.bonusAction = planBonusAction(self, hmTarget, battlefield);
      return plan;
    }
  }

  // --- 11L. FLAMING SPHERE (DEX save, persistent damage_zone, concentration) ---
  // PHB p.242: action, 60 ft, DEX save 2d6 fire (half on save) + persistent
  // 2d6 fire/turn (DEX save for half), concentration. Lower per-hit damage
  // than Heat Metal (2d6 vs 2d8) but the DEX save (vs Heat Metal's no-save)
  // can halve the damage.
  if (!plan.action && self.actions.some(a => a.name === 'Flaming Sphere')) {
    const fsTarget = shouldCastFlamingSphere(self, battlefield);
    if (fsTarget) {
      plan.action = {
        type: 'flamingSphere',
        action: null,
        targetId: fsTarget.id,
        description: `${self.name} casts Flaming Sphere at ${fsTarget.name}`,
      };
      plan.targetId = fsTarget.id;
      plan.bonusAction = planBonusAction(self, fsTarget, battlefield);
      return plan;
    }
  }

  // --- 11M. CORDON OF ARROWS (DEX save, persistent damage_zone × 4, NO concentration) ---
  // PHB p.228: action, 5 ft, DEX save 1d6 piercing (half on save), 4-piece
  // damage_zone (ticksRemaining: 4). NO concentration — can stack with
  // another concentration spell. Requires adjacency (5 ft) — risky for
  // squishy casters. Lower priority than the concentration damage spells
  // because the per-tick damage is lower (1d6 vs 2d6/2d8) and it requires
  // being in melee range.
  if (!plan.action && self.actions.some(a => a.name === 'Cordon of Arrows')) {
    const coaTarget = shouldCastCordonOfArrows(self, battlefield);
    if (coaTarget) {
      plan.action = {
        type: 'cordonOfArrows',
        action: null,
        targetId: coaTarget.id,
        description: `${self.name} casts Cordon of Arrows around ${coaTarget.name}`,
      };
      plan.targetId = coaTarget.id;
      plan.bonusAction = planBonusAction(self, coaTarget, battlefield);
      return plan;
    }
  }

  // --- 11N. ENLARGE/REDUCE (CON save, buff/debuff, concentration) ---
  // PHB p.237: action, 30 ft, CON save, concentration 1 min. v1: 'reduce'
  // (enemy debuff — half weapon damage, disadv STR) or 'enlarge' (ally buff
  // — +1d8 weapon damage, adv STR). Strong vs weapon-attack enemies.
  if (!plan.action && self.actions.some(a => a.name === 'Enlarge/Reduce')) {
    const er = shouldCastEnlargeReduce(self, battlefield);
    if (er) {
      const verb = er.mode === 'enlarge' ? 'on' : 'at';
      plan.action = {
        type: 'enlargeReduce',
        action: null,
        targetId: er.target.id,
        description: `${self.name} casts ${er.mode === 'enlarge' ? 'Enlarge' : 'Reduce'} ${verb} ${er.target.name}`,
      };
      plan.targetId = er.target.id;
      plan.bonusAction = planBonusAction(self, er.target, battlefield);
      return plan;
    }
  }

  // --- 11O. GUST OF WIND (STR save, push 15 ft, concentration) ---
  // PHB p.248: action, line 60 ft, STR save or pushed 15 ft, concentration.
  // v1: single-target, one-shot push. Useful for battlefield control —
  // pushing a melee enemy 15 ft delays their engagement by 1-2 turns.
  if (!plan.action && self.actions.some(a => a.name === 'Gust of Wind')) {
    const gowTarget = shouldCastGustOfWind(self, battlefield);
    if (gowTarget) {
      plan.action = {
        type: 'gustOfWind',
        action: null,
        targetId: gowTarget.id,
        description: `${self.name} casts Gust of Wind at ${gowTarget.name}`,
      };
      plan.targetId = gowTarget.id;
      plan.bonusAction = planBonusAction(self, gowTarget, battlefield);
      return plan;
    }
  }

  // --- 11P. LEVITATE (CON save or restrained, concentration) ---
  // PHB p.255: action, 60 ft, CON save or restrained (v1), concentration.
  // v1: modeled as restrained (closest PHB condition). Strong vs melee
  // enemies (speed 0, attacks vs them have advantage).
  if (!plan.action && self.actions.some(a => a.name === 'Levitate')) {
    const levTarget = shouldCastLevitate(self, battlefield);
    if (levTarget) {
      plan.action = {
        type: 'levitate',
        action: null,
        targetId: levTarget.id,
        description: `${self.name} casts Levitate at ${levTarget.name}`,
      };
      plan.targetId = levTarget.id;
      plan.bonusAction = planBonusAction(self, levTarget, battlefield);
      return plan;
    }
  }

  // --- 11Q. INVISIBILITY (touch, invisible condition, concentration) ---
  // PHB p.254: action, touch, concentration 1 hr. Grants invisible condition
  // (advantage on attacks, disadvantage on attacks vs them). v1: ends-on-
  // attack NOT modelled. Priority: defensive buff for squishy allies.
  if (!plan.action && self.actions.some(a => a.name === 'Invisibility')) {
    const invTarget = shouldCastInvisibility(self, battlefield);
    if (invTarget) {
      plan.action = {
        type: 'invisibility',
        action: null,
        targetId: invTarget.id,
        description: `${self.name} casts Invisibility on ${invTarget.name}`,
      };
      plan.targetId = invTarget.id;
      plan.bonusAction = planBonusAction(self, invTarget, battlefield);
      return plan;
    }
  }

  // --- 11R. MAGIC WEAPON (touch, weapon +1, concentration) ---
  // PHB p.257: action, touch, concentration 1 hr. +1 to attack and damage
  // rolls with weapon attacks. Priority: offensive buff for weapon-attack
  // allies (Fighter, Paladin, Ranger).
  if (!plan.action && self.actions.some(a => a.name === 'Magic Weapon')) {
    const mwTarget = shouldCastMagicWeapon(self, battlefield);
    if (mwTarget) {
      plan.action = {
        type: 'magicWeapon',
        action: null,
        targetId: mwTarget.id,
        description: `${self.name} casts Magic Weapon on ${mwTarget.name}'s weapon`,
      };
      plan.targetId = mwTarget.id;
      plan.bonusAction = planBonusAction(self, mwTarget, battlefield);
      return plan;
    }
  }

  // --- 11S. ENHANCE ABILITY (touch, ability-check advantage, concentration) ---
  // PHB p.237: action, touch, concentration 1 hr. Advantage on one ability's
  // checks. Lower combat relevance (no attack-roll or save benefit) — fires
  // late in the priority order. v1: picks the target's highest ability.
  if (!plan.action && self.actions.some(a => a.name === 'Enhance Ability')) {
    const ea = shouldCastEnhanceAbility(self, battlefield);
    if (ea) {
      plan.action = {
        type: 'enhanceAbility',
        action: null,
        targetId: ea.target.id,
        description: `${self.name} casts Enhance Ability on ${ea.target.name} (${ea.ability.toUpperCase()} advantage)`,
      };
      plan.targetId = ea.target.id;
      plan.bonusAction = planBonusAction(self, ea.target, battlefield);
      return plan;
    }
  }

  // --- 11T. FLAME BLADE (self, +3d6 fire rider, concentration) ---
  // PHB p.242: action, self, concentration 10 min. v1: +3d6 fire rider on
  // melee weapon attacks (canon: new melee weapon). Requires the caster to
  // have a melee weapon attack. Priority: self-buff for melee casters
  // (Druid, some Clerics).
  if (!plan.action && self.actions.some(a => a.name === 'Flame Blade') && shouldCastFlameBlade(self, battlefield)) {
    plan.action = {
      type: 'flameBlade',
      action: null,
      targetId: self.id,
      description: `${self.name} casts Flame Blade`,
    };
    plan.targetId = self.id;
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }

  // --- 11U. ALTER SELF (self, natural weapons, concentration) ---
  // PHB p.211: action, self, concentration 10 min. v1: Natural Weapons only
  // (unarmed strikes → 1d6 slashing). Niche — only fires for spell-only
  // casters with no weapon attacks (fallback option).
  if (!plan.action && self.actions.some(a => a.name === 'Alter Self') && shouldCastAlterSelf(self, battlefield)) {
    plan.action = {
      type: 'alterSelf',
      action: null,
      targetId: self.id,
      description: `${self.name} casts Alter Self — Natural Weapons`,
    };
    plan.targetId = self.id;
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }

  // --- 11V. LESSER RESTORATION (touch, condition removal, NO concentration) ---
  // PHB p.255: action, touch, NO concentration. Ends blinded/deafened/
  // paralyzed/poisoned. Niche — only fires when an ally has a removable
  // condition. Priority: defensive (removes debuffs from allies).
  if (!plan.action && self.actions.some(a => a.name === 'Lesser Restoration')) {
    const lrTarget = shouldCastLesserRestoration(self, battlefield);
    if (lrTarget) {
      plan.action = {
        type: 'lesserRestoration',
        action: null,
        targetId: lrTarget.id,
        description: `${self.name} casts Lesser Restoration on ${lrTarget.name}`,
      };
      plan.targetId = lrTarget.id;
      plan.bonusAction = planBonusAction(self, lrTarget, battlefield);
      return plan;
    }
  }

  // --- 11W. DARKVISION (touch, forward-compat, NO concentration) ---
  // PHB p.230: action, touch, NO concentration, 8 hr. v1: forward-compat flag
  // only (vision subsystem not implemented). Lowest priority — no mechanical
  // effect in v1. Fires only when no other spell was chosen (the AI casts it
  // for realism, even though it has no v1 effect).
  if (!plan.action && self.actions.some(a => a.name === 'Darkvision')) {
    const dvTarget = shouldCastDarkvision(self, battlefield);
    if (dvTarget) {
      plan.action = {
        type: 'darkvision',
        action: null,
        targetId: dvTarget.id,
        description: `${self.name} casts Darkvision on ${dvTarget.name}`,
      };
      plan.targetId = dvTarget.id;
      plan.bonusAction = planBonusAction(self, dvTarget, battlefield);
      return plan;
    }
  }

  // === LEVEL-2 SPELLS batch 4 (action-time, added in Cantrip-z Session 18) ===
  // 19 new PHB level-2 spells. Each is guarded by `if (!plan.action)` so it
  // only fires when no higher-priority spell was chosen. Order within the
  // block is by tactical priority (highest first):
  //   11X. Scorching Ray (3 rays, multi-attack, highest damage, NO concentration)
  //   11Y. Shatter (3d8 thunder AoE, NO concentration)
  //   11Z. Moonbeam (2d10 radiant + persistent, concentration)
  //   11AA. Spiritual Weapon (1d8 force + persistent 1d8/turn, NO concentration)
  //   11AB. Spike Growth (2d4 piercing persistent, concentration)
  //   11AC. Phantasmal Force (1d6 psychic + persistent, concentration)
  //   11AD. Ray of Enfeeblement (debuff — half weapon damage, concentration)
  //   11AE. Web (DEX save or restrained, concentration)
  //   11AF. Suggestion (WIS save or charmed, concentration)
  //   11AG. Silence (AoE blocks verbal spells forward-compat, concentration)
  //   11AH. Zone of Truth (CHA save forward-compat, concentration)
  //   11AI. Enthrall (WIS save, perception debuff forward-compat, concentration)
  //   11AJ. Prayer of Healing (multi-ally heal, NO concentration)
  //   11AK. Protection from Poison (condition removal + buff, NO concentration)
  //   11AL. Detect Thoughts (forward-compat, concentration)
  //   11AM. See Invisibility (forward-compat, NO concentration)
  //   11AN. Spider Climb (forward-compat, concentration)
  //   11AO. Pass without Trace (forward-compat, concentration)
  //   11AP. Knock (forward-compat, NO concentration)
  //   11AQ. Arcane Lock (forward-compat, NO concentration)
  // Spiritual Weapon is a BONUS ACTION and is added in planBonusAction (2.10).

  // --- 11X. SCORCHING RAY (3 ranged spell attacks, NO concentration) ---
  // PHB p.273: action, 120 ft, 3 rays 2d6 fire each. Highest-priority of the
  // 19 new action-time spells — multi-attack with the highest damage potential
  // (6d6 avg 21 if all 3 hit). NO concentration — can stack with another.
  if (!plan.action && self.actions.some(a => a.name === 'Scorching Ray')) {
    const srTargets = shouldCastScorchingRay(self, battlefield);
    if (srTargets) {
      const names = srTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'scorchingRay',
        action: null,
        targetId: srTargets[0].id,
        description: `${self.name} casts Scorching Ray at ${names} (3 rays)`,
      };
      plan.targetId = srTargets[0].id;
      plan.bonusAction = planBonusAction(self, srTargets[0], battlefield);
      return plan;
    }
  }

  // --- 11Y. SHATTER (CON save 3d8 thunder AoE, NO concentration) ---
  // PHB p.275: action, 60 ft, 3d8 thunder (half on save), 10-ft radius AoE.
  // High-priority AoE damage spell — avg 13.5 dmg to each enemy in radius.
  if (!plan.action && self.actions.some(a => a.name === 'Shatter')) {
    const shTargets = shouldCastShatter(self, battlefield);
    if (shTargets) {
      const names = shTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'shatter',
        action: null,
        targetId: shTargets[0].id,
        description: `${self.name} casts Shatter on ${names}`,
      };
      plan.targetId = shTargets[0].id;
      plan.bonusAction = planBonusAction(self, shTargets[0], battlefield);
      return plan;
    }
  }

  // --- 11Z. MOONBEAM (CON save 2d10 radiant + persistent, concentration) ---
  // PHB p.261: action, 120 ft, CON save 2d10 radiant (half on save) +
  // persistent 2d10 radiant/turn (CON save for half), concentration 1 min.
  if (!plan.action && self.actions.some(a => a.name === 'Moonbeam')) {
    const mbTarget = shouldCastMoonbeam(self, battlefield);
    if (mbTarget) {
      plan.action = {
        type: 'moonbeam',
        action: null,
        targetId: mbTarget.id,
        description: `${self.name} casts Moonbeam on ${mbTarget.name}`,
      };
      plan.targetId = mbTarget.id;
      plan.bonusAction = planBonusAction(self, mbTarget, battlefield);
      return plan;
    }
  }

  // --- 11AA. SPIRITUAL WEAPON (1d8 force + persistent, NO concentration) ---
  // NOTE: Spiritual Weapon is a BONUS ACTION — this action-time branch is
  // a fallback for the rare case where the caster has only Spiritual Weapon
  // (no other action-time spell available). The primary cast is via the
  // bonus-action branch in planBonusAction (section 2.10). Action-time cast
  // is allowed per PHB p.278 (the spell's casting time is bonus action, but
  // the engine doesn't enforce action/bonus-action distinction for spell
  // selection — v1 simplification).
  if (!plan.action && self.actions.some(a => a.name === 'Spiritual Weapon')) {
    const swTarget = shouldCastSpiritualWeapon(self, battlefield);
    if (swTarget) {
      plan.action = {
        type: 'spiritualWeapon',
        action: null,
        targetId: swTarget.id,
        description: `${self.name} casts Spiritual Weapon at ${swTarget.name}`,
      };
      plan.targetId = swTarget.id;
      plan.bonusAction = planBonusAction(self, swTarget, battlefield);
      return plan;
    }
  }

  // --- 11AB. SPIKE GROWTH (2d4 piercing persistent, concentration) ---
  // PHB p.277: action, 150 ft, 2d4 piercing damage_zone/turn (no save),
  // concentration 10 min. NO on-cast damage (canon: target enters area).
  if (!plan.action && self.actions.some(a => a.name === 'Spike Growth')) {
    const sgTarget = shouldCastSpikeGrowth(self, battlefield);
    if (sgTarget) {
      plan.action = {
        type: 'spikeGrowth',
        action: null,
        targetId: sgTarget.id,
        description: `${self.name} casts Spike Growth on ${sgTarget.name}`,
      };
      plan.targetId = sgTarget.id;
      plan.bonusAction = planBonusAction(self, sgTarget, battlefield);
      return plan;
    }
  }

  // --- 11AC. PHANTASMAL FORCE (1d6 psychic + persistent, concentration) ---
  // PHB p.264: action, 60 ft, INT save 1d6 psychic + persistent 1d6/turn,
  // concentration 1 min. On save success: no effect (target disbelieves).
  if (!plan.action && self.actions.some(a => a.name === 'Phantasmal Force')) {
    const pfTarget = shouldCastPhantasmalForce(self, battlefield);
    if (pfTarget) {
      plan.action = {
        type: 'phantasmalForce',
        action: null,
        targetId: pfTarget.id,
        description: `${self.name} casts Phantasmal Force at ${pfTarget.name}`,
      };
      plan.targetId = pfTarget.id;
      plan.bonusAction = planBonusAction(self, pfTarget, battlefield);
      return plan;
    }
  }

  // --- 11AD. RAY OF ENFEEBLEMENT (debuff, concentration) ---
  // PHB p.271: action, 60 ft, ranged spell attack, target deals half weapon
  // damage, concentration 1 min. Strong vs weapon-attack enemies.
  if (!plan.action && self.actions.some(a => a.name === 'Ray of Enfeeblement')) {
    const roeTarget = shouldCastRayOfEnfeeblement(self, battlefield);
    if (roeTarget) {
      plan.action = {
        type: 'rayOfEnfeeblement',
        action: null,
        targetId: roeTarget.id,
        description: `${self.name} casts Ray of Enfeeblement at ${roeTarget.name}`,
      };
      plan.targetId = roeTarget.id;
      plan.bonusAction = planBonusAction(self, roeTarget, battlefield);
      return plan;
    }
  }

  // --- 11AE. WEB (DEX save or restrained, concentration) ---
  // PHB p.287: action, 60 ft, DEX save or restrained, concentration 1 min.
  if (!plan.action && self.actions.some(a => a.name === 'Web')) {
    const webTarget = shouldCastWeb(self, battlefield);
    if (webTarget) {
      plan.action = {
        type: 'web',
        action: null,
        targetId: webTarget.id,
        description: `${self.name} casts Web at ${webTarget.name}`,
      };
      plan.targetId = webTarget.id;
      plan.bonusAction = planBonusAction(self, webTarget, battlefield);
      return plan;
    }
  }

  // --- 11AF. SUGGESTION (WIS save or charmed, concentration) ---
  // PHB p.279: action, 30 ft, WIS save or charmed, concentration (canon 8 hr;
  // v1: 1 min simplification).
  if (!plan.action && self.actions.some(a => a.name === 'Suggestion')) {
    const sugTarget = shouldCastSuggestion(self, battlefield);
    if (sugTarget) {
      plan.action = {
        type: 'suggestion',
        action: null,
        targetId: sugTarget.id,
        description: `${self.name} casts Suggestion on ${sugTarget.name}`,
      };
      plan.targetId = sugTarget.id;
      plan.bonusAction = planBonusAction(self, sugTarget, battlefield);
      return plan;
    }
  }

  // --- 11AG. SILENCE (AoE blocks verbal spells forward-compat, concentration) ---
  // PHB p.275: action, 120 ft, AoE blocks verbal spells (forward-compat flag),
  // concentration 10 min. v1: no spell-block subsystem — forward-compat only.
  if (!plan.action && self.actions.some(a => a.name === 'Silence')) {
    const silTarget = shouldCastSilence(self, battlefield);
    if (silTarget) {
      plan.action = {
        type: 'silence',
        action: null,
        targetId: silTarget.id,
        description: `${self.name} casts Silence on ${silTarget.name}`,
      };
      plan.targetId = silTarget.id;
      plan.bonusAction = planBonusAction(self, silTarget, battlefield);
      return plan;
    }
  }

  // --- 11AH. ZONE OF TRUTH (CHA save forward-compat, concentration) ---
  // PHB p.289: action, 60 ft, CHA save, can't lie in 15-ft radius (forward-
  // compat flag), concentration 10 min. v1: no lie subsystem.
  if (!plan.action && self.actions.some(a => a.name === 'Zone of Truth')) {
    const zotTarget = shouldCastZoneOfTruth(self, battlefield);
    if (zotTarget) {
      plan.action = {
        type: 'zoneOfTruth',
        action: null,
        targetId: zotTarget.id,
        description: `${self.name} casts Zone of Truth on ${zotTarget.name}`,
      };
      plan.targetId = zotTarget.id;
      plan.bonusAction = planBonusAction(self, zotTarget, battlefield);
      return plan;
    }
  }

  // --- 11AI. ENTHRALL (WIS save, perception debuff forward-compat, concentration) ---
  // PHB p.238: action, 60 ft, WIS save multi-target (up to 3), disadv on
  // Perception (forward-compat flag), concentration 1 min. v1: no perception.
  if (!plan.action && self.actions.some(a => a.name === 'Enthrall')) {
    const entTargets = shouldCastEnthrall(self, battlefield);
    if (entTargets) {
      const names = entTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'enthrall',
        action: null,
        targetId: entTargets[0].id,
        description: `${self.name} casts Enthrall at ${names}`,
      };
      plan.targetId = entTargets[0].id;
      plan.bonusAction = planBonusAction(self, entTargets[0], battlefield);
      return plan;
    }
  }

  // --- 11AJ. PRAYER OF HEALING (multi-ally heal, NO concentration) ---
  // PHB p.267: action (canon: 10 min — v1: action simplification), 30 ft,
  // 2d8+spellcasting heal up to 3 creatures, NO concentration.
  if (!plan.action && self.actions.some(a => a.name === 'Prayer of Healing')) {
    const pohTargets = shouldCastPrayerOfHealing(self, battlefield);
    if (pohTargets) {
      const names = pohTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'prayerOfHealing',
        action: null,
        targetId: pohTargets[0].id,
        description: `${self.name} casts Prayer of Healing on ${names}`,
      };
      plan.targetId = pohTargets[0].id;
      plan.bonusAction = planBonusAction(self, pohTargets[0], battlefield);
      return plan;
    }
  }

  // --- 11AK. PROTECTION FROM POISON (condition removal + buff, NO concentration) ---
  // PHB p.270: action, touch, removes poisoned + advantage on saves vs poison
  // (forward-compat flag), NO concentration, 1 hr. Priority: defensive
  // (removes debuffs from allies).
  if (!plan.action && self.actions.some(a => a.name === 'Protection from Poison')) {
    const pfpTarget = shouldCastProtectionFromPoison(self, battlefield);
    if (pfpTarget) {
      plan.action = {
        type: 'protectionFromPoison',
        action: null,
        targetId: pfpTarget.id,
        description: `${self.name} casts Protection from Poison on ${pfpTarget.name}`,
      };
      plan.targetId = pfpTarget.id;
      plan.bonusAction = planBonusAction(self, pfpTarget, battlefield);
      return plan;
    }
  }

  // --- 11AL. DETECT THOUGHTS (forward-compat, concentration) ---
  // PHB p.231: action, self, WIS save probe (forward-compat flag), concentration.
  if (!plan.action && self.actions.some(a => a.name === 'Detect Thoughts')) {
    if (shouldCastDetectThoughts(self, battlefield)) {
      plan.action = {
        type: 'detectThoughts',
        action: null,
        targetId: self.id,
        description: `${self.name} casts Detect Thoughts`,
      };
      plan.targetId = self.id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // --- 11AM. SEE INVISIBILITY (forward-compat, NO concentration) ---
  // PHB p.274: action, self, see invisible 60 ft (forward-compat flag),
  // NO concentration, 1 hr.
  if (!plan.action && self.actions.some(a => a.name === 'See Invisibility')) {
    if (shouldCastSeeInvisibility(self, battlefield)) {
      plan.action = {
        type: 'seeInvisibility',
        action: null,
        targetId: self.id,
        description: `${self.name} casts See Invisibility`,
      };
      plan.targetId = self.id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // --- 11AN. SPIDER CLIMB (forward-compat, concentration) ---
  // PHB p.277: action, touch, climb speed (forward-compat flag), concentration.
  if (!plan.action && self.actions.some(a => a.name === 'Spider Climb')) {
    const scTarget = shouldCastSpiderClimb(self, battlefield);
    if (scTarget) {
      plan.action = {
        type: 'spiderClimb',
        action: null,
        targetId: scTarget.id,
        description: `${self.name} casts Spider Climb on ${scTarget.name}`,
      };
      plan.targetId = scTarget.id;
      plan.bonusAction = planBonusAction(self, scTarget, battlefield);
      return plan;
    }
  }

  // --- 11AO. PASS WITHOUT TRACE (forward-compat, concentration) ---
  // PHB p.264: action, self, +10 stealth aura (forward-compat flag), concentration.
  if (!plan.action && self.actions.some(a => a.name === 'Pass without Trace')) {
    if (shouldCastPassWithoutTrace(self, battlefield)) {
      plan.action = {
        type: 'passWithoutTrace',
        action: null,
        targetId: self.id,
        description: `${self.name} casts Pass without Trace`,
      };
      plan.targetId = self.id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // --- 11AP. KNOCK (forward-compat, NO concentration) ---
  // PHB p.254: action, 60 ft, opens objects (forward-compat flag), NO concentration.
  if (!plan.action && self.actions.some(a => a.name === 'Knock')) {
    if (shouldCastKnock(self, battlefield)) {
      plan.action = {
        type: 'knock',
        action: null,
        targetId: self.id,
        description: `${self.name} casts Knock`,
      };
      plan.targetId = self.id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // --- 11AQ. ARCANE LOCK (forward-compat, NO concentration) ---
  // PHB p.215: action, touch, locks object (forward-compat flag), permanent,
  // NO concentration. Lowest priority — no mechanical effect in v1.
  if (!plan.action && self.actions.some(a => a.name === 'Arcane Lock')) {
    if (shouldCastArcaneLock(self, battlefield)) {
      plan.action = {
        type: 'arcaneLock',
        action: null,
        targetId: self.id,
        description: `${self.name} casts Arcane Lock`,
      };
      plan.targetId = self.id;
      plan.bonusAction = planBonusAction(self, target, battlefield);
      return plan;
    }
  }

  // === SESSION 21 — REAL-MECHANICS MIGRATION (7 combat damage spells) ===
  // Migrated from the Session 19/20 generic dispatch registry to bespoke
  // implementations with real mechanical effects (DEX/CON saves, spell
  // attack rolls, AoE damage). Each branch sits ABOVE the generic spell
  // loop so the migrated spell wins over its generic-registry shadow
  // (the migrated spell's module file OVERRIDES the generic-registry
  // entry — but the generic registry still has a stale entry that we
  // also remove in this session).
  //
  // Tactical priority order (highest first):
  //   12A. Cone of Cold (L5, 8d8 cold AoE — highest single-cast damage)
  //   12B. Fireball (L3, 8d6 fire AoE — most iconic combat spell)
  //   12C. Lightning Bolt (L3, 8d6 lightning line AoE)
  //   12D. Ice Knife (L1, hybrid 1d10 pierce + 2d6 cold AoE)
  //   12E. Inflict Wounds (L1, melee spell attack 3d10 necrotic)
  //   12F. Chromatic Orb (L1, ranged spell attack 3d8 chosen-elemental)
  //   12G. Catapult (L1, DEX save 3d8 bludgeoning single-target)
  // L5 spells first (more damage), then L3 (iconic AoE), then L1 by
  // expected damage (Ice Knife hybrid > Inflict Wounds melee > Chromatic
  // Orb ranged > Catapult save-for-half).

  // --- 12A. CONE OF COLD (CON save 8d8 cold cone AoE, L5, NO concentration) ---
  // PHB p.229: action, self (60-ft cone), CON save 8d8 cold (half on save).
  // Highest single-cast damage of the 7 migrated spells (avg 36).
  if (!plan.action && self.actions.some(a => a.name === 'Cone of Cold')) {
    const cocTargets = shouldCastConeOfCold(self, battlefield);
    if (cocTargets) {
      const names = cocTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'coneOfCold',
        action: null,
        targetId: cocTargets[0].id,
        description: `${self.name} casts Cone of Cold on ${names}`,
      };
      plan.targetId = cocTargets[0].id;
      plan.bonusAction = planBonusAction(self, cocTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12B. FIREBALL (DEX save 8d6 fire AoE, L3, NO concentration) ---
  // PHB p.241: action, 150 ft, DEX save 8d6 fire (half on save), 20-ft radius
  // AoE. The most iconic combat spell in D&D — avg 28 dmg to each enemy in radius.
  if (!plan.action && self.actions.some(a => a.name === 'Fireball')) {
    const fbTargets = shouldCastFireball(self, battlefield);
    if (fbTargets) {
      const names = fbTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'fireball',
        action: null,
        targetId: fbTargets[0].id,
        description: `${self.name} casts Fireball on ${names}`,
      };
      plan.targetId = fbTargets[0].id;
      plan.bonusAction = planBonusAction(self, fbTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12C. LIGHTNING BOLT (DEX save 8d6 lightning line AoE, L3, NO concentration) ---
  // PHB p.255: action, 100-ft × 5-ft line from caster, DEX save 8d6 lightning
  // (half on save). Same damage as Fireball but a line shape (better vs
  // formations, worse vs clusters).
  if (!plan.action && self.actions.some(a => a.name === 'Lightning Bolt')) {
    const lbTargets = shouldCastLightningBolt(self, battlefield);
    if (lbTargets) {
      const names = lbTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'lightningBolt',
        action: null,
        targetId: lbTargets[0].id,
        description: `${self.name} casts Lightning Bolt on ${names}`,
      };
      plan.targetId = lbTargets[0].id;
      plan.bonusAction = planBonusAction(self, lbTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12D. ICE KNIFE (ranged spell attack 1d10 pierce + 2d6 cold DEX save AoE, L1, NO concentration) ---
  // XGE p.157: action, 60 ft, ranged spell attack 1d10 piercing + 2d6 cold
  // DEX save in 5-ft radius AoE (explodes on hit OR miss). Hybrid attack +
  // AoE — first of its kind in v1. Avg 5.5 pierce + 7 cold (per target in AoE,
  // half on save) = solid L1 value.
  if (!plan.action && self.actions.some(a => a.name === 'Ice Knife')) {
    const ikPlan = shouldCastIceKnife(self, battlefield);
    if (ikPlan) {
      const expNames = ikPlan.explosion.map(t => t.name).join(', ');
      plan.action = {
        type: 'iceKnife',
        action: null,
        targetId: ikPlan.primary.id,
        description: `${self.name} casts Ice Knife at ${ikPlan.primary.name} (explosion: ${expNames})`,
      };
      plan.targetId = ikPlan.primary.id;
      plan.bonusAction = planBonusAction(self, ikPlan.primary, battlefield);
      return plan;
    }
  }

  // --- 12E. INFLICT WOUNDS (melee spell attack 3d10 necrotic, L1, NO concentration) ---
  // PHB p.253: action, touch (5 ft), melee spell attack 3d10 necrotic (crit
  // doubles). Highest single-target L1 damage (avg 16.5) — but requires
  // adjacency, so it's situational for spellcasters.
  if (!plan.action && self.actions.some(a => a.name === 'Inflict Wounds')) {
    const iwTarget = shouldCastInflictWounds(self, battlefield);
    if (iwTarget) {
      plan.action = {
        type: 'inflictWounds',
        action: null,
        targetId: iwTarget.id,
        description: `${self.name} casts Inflict Wounds on ${iwTarget.name}`,
      };
      plan.targetId = iwTarget.id;
      plan.bonusAction = planBonusAction(self, iwTarget, battlefield);
      return plan;
    }
  }

  // --- 12F. CHROMATIC ORB (ranged spell attack 3d8 chosen-elemental, L1, NO concentration) ---
  // PHB p.221: action, 90 ft, ranged spell attack 3d8 chosen-elemental (picker
  // avoids target's resistances, crit doubles). Solid L1 ranged damage (avg 13.5)
  // with smart-type-choice heuristic.
  if (!plan.action && self.actions.some(a => a.name === 'Chromatic Orb')) {
    const coTarget = shouldCastChromaticOrb(self, battlefield);
    if (coTarget) {
      plan.action = {
        type: 'chromaticOrb',
        action: null,
        targetId: coTarget.id,
        description: `${self.name} casts Chromatic Orb at ${coTarget.name}`,
      };
      plan.targetId = coTarget.id;
      plan.bonusAction = planBonusAction(self, coTarget, battlefield);
      return plan;
    }
  }

  // --- 12G. CATAPULT (DEX save 3d8 bludgeoning single-target, L1, NO concentration) ---
  // XGE p.15: action, 60 ft, DEX save 3d8 bludgeoning (half on save),
  // single-target. Lowest expected damage of the 7 migrated spells
  // (avg 13.5 fail, 6.75 save — DEX is a common strong save).
  if (!plan.action && self.actions.some(a => a.name === 'Catapult')) {
    const catTarget = shouldCastCatapult(self, battlefield);
    if (catTarget) {
      plan.action = {
        type: 'catapult',
        action: null,
        targetId: catTarget.id,
        description: `${self.name} casts Catapult at ${catTarget.name}`,
      };
      plan.targetId = catTarget.id;
      plan.bonusAction = planBonusAction(self, catTarget, battlefield);
      return plan;
    }
  }

  // === SESSION 23 — REAL-MECHANICS MIGRATION BATCH 2 (7 high-damage spells L4-9) ===
  // Migrated from the Session 19 generic dispatch registry to bespoke
  // implementations with real mechanical effects (CON/DEX saves, HP-check
  // instakill, AoE damage + blindness). Each branch sits ABOVE the generic
  // spell loop so the migrated spell wins over its generic-registry shadow
  // (the migrated spell's module file OVERRIDES the generic-registry
  // entry — but the generic registry still has a stale entry that we
  // also remove in this session).
  //
  // Tactical priority order (highest first):
  //   12H. Power Word Kill (L9, instakill if HP ≤ 100 — premier kill-shot)
  //   12I. Sunburst (L8, 12d6 radiant 60-ft AoE + blindness — highest AoE damage)
  //   12J. Finger of Death (L7, 7d8+30 necrotic single-target — avg 61.5)
  //   12K. Disintegrate (L6, 10d6+40 force single-target — avg 75, kill-shot bias)
  //   12L. Harm (L6, 14d6 necrotic single-target — avg 49)
  //   12M. Cloudkill (L5, 5d8 poison 20-ft AoE — avg 22.5 per target)
  //   12N. Blight (L4, 8d8 necrotic single-target — avg 36)
  // L9 first (instakill), then L8 (biggest AoE), then L7, then L6 by kill-shot
  // bias (Disintegrate before Harm), then L5 (AoE), then L4 (single-target).

  // --- 12H. POWER WORD KILL (NO save, NO attack — instakill if HP ≤ 100, L9, NO concentration) ---
  // PHB p.266: action, 60 ft, no save, no attack — if target's currentHP ≤ 100,
  // it dies instantly. The premier kill-shot spell in D&D — a 9th-level slot
  // that bypasses all defences (no save, no AC) for any creature under 100 HP.
  // shouldCast gates on the target's currentHP (FIRST spell in v1 to do so).
  if (!plan.action && self.actions.some(a => a.name === 'Power Word Kill')) {
    const pwkTarget = shouldCastPowerWordKill(self, battlefield);
    if (pwkTarget) {
      plan.action = {
        type: 'powerWordKill',
        action: null,
        targetId: pwkTarget.id,
        description: `${self.name} casts Power Word Kill at ${pwkTarget.name} (HP ${pwkTarget.currentHP} ≤ 100)`,
      };
      plan.targetId = pwkTarget.id;
      plan.bonusAction = planBonusAction(self, pwkTarget, battlefield);
      return plan;
    }
  }

  // --- 12I. SUNBURST (CON save 12d6 radiant 60-ft AoE + blinded on fail, L8, NO concentration) ---
  // PHB p.284: action, 150 ft, CON save 12d6 radiant (half on save), 60-ft radius
  // AoE + blinded on failed save. Highest single-cast AoE damage in v1
  // (avg 42 per target) + a potent rider (blinded = disadv on attacks, adv vs them).
  if (!plan.action && self.actions.some(a => a.name === 'Sunburst')) {
    const sbTargets = shouldCastSunburst(self, battlefield);
    if (sbTargets) {
      const names = sbTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'sunburst',
        action: null,
        targetId: sbTargets[0].id,
        description: `${self.name} casts Sunburst on ${names}`,
      };
      plan.targetId = sbTargets[0].id;
      plan.bonusAction = planBonusAction(self, sbTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12J. FINGER OF DEATH (CON save 7d8+30 necrotic single-target, L7, NO concentration) ---
  // PHB p.241: action, 60 ft, CON save 7d8+30 necrotic (half on save), single-target.
  // Zombie-raise-on-kill rider simplified away (TG-006 summon subsystem pending).
  // Avg 61.5 damage on fail — premier single-target L7 damage.
  if (!plan.action && self.actions.some(a => a.name === 'Finger of Death')) {
    const fodTarget = shouldCastFingerOfDeath(self, battlefield);
    if (fodTarget) {
      plan.action = {
        type: 'fingerOfDeath',
        action: null,
        targetId: fodTarget.id,
        description: `${self.name} casts Finger of Death at ${fodTarget.name}`,
      };
      plan.targetId = fodTarget.id;
      plan.bonusAction = planBonusAction(self, fodTarget, battlefield);
      return plan;
    }
  }

  // --- 12K. DISINTEGRATE (DEX save 10d6+40 force single-target, L6, NO concentration) ---
  // PHB p.233: action, 60 ft, DEX save 10d6+40 force (half on save), single-target.
  // Disintegrate-on-0-HP rider simplified away (no "disintegrated" death-state).
  // Avg 75 damage on fail — highest single-target L6 damage. shouldCast prioritises
  // lowest-current-HP targets (kill-shot bias — the disintegrate-on-0-HP rider
  // would fire on a kill, though it's simplified away in v1).
  if (!plan.action && self.actions.some(a => a.name === 'Disintegrate')) {
    const disTarget = shouldCastDisintegrate(self, battlefield);
    if (disTarget) {
      plan.action = {
        type: 'disintegrate',
        action: null,
        targetId: disTarget.id,
        description: `${self.name} casts Disintegrate at ${disTarget.name}`,
      };
      plan.targetId = disTarget.id;
      plan.bonusAction = planBonusAction(self, disTarget, battlefield);
      return plan;
    }
  }

  // --- 12L. HARM (CON save 14d6 necrotic single-target, L6, NO concentration) ---
  // PHB p.249: action, 60 ft, CON save 14d6 necrotic (half on save), single-target.
  // Max-HP-reduction rider simplified away (no maxHP-reduction field in v1).
  // Avg 49 damage on fail — solid L6 single-target damage (CON is a common
  // strong save, so effective damage is lower than Disintegrate's DEX-targeting).
  if (!plan.action && self.actions.some(a => a.name === 'Harm')) {
    const harmTarget = shouldCastHarm(self, battlefield);
    if (harmTarget) {
      plan.action = {
        type: 'harm',
        action: null,
        targetId: harmTarget.id,
        description: `${self.name} casts Harm at ${harmTarget.name}`,
      };
      plan.targetId = harmTarget.id;
      plan.bonusAction = planBonusAction(self, harmTarget, battlefield);
      return plan;
    }
  }

  // --- 12M. CLOUDKILL (CON save 5d8 poison 20-ft AoE, L5, NO concentration in v1) ---
  // PHB p.222: action, 120 ft, CON save 5d8 poison (half on save), 20-ft radius AoE.
  // v1: one-shot (moving-AoE + concentration rider simplified away). Avg 22.5
  // poison damage per target on fail — solid L5 AoE (poison is a commonly
  // resisted type, but v1 doesn't model immunity checks in shouldCast).
  if (!plan.action && self.actions.some(a => a.name === 'Cloudkill')) {
    const ckTargets = shouldCastCloudkill(self, battlefield);
    if (ckTargets) {
      const names = ckTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'cloudkill',
        action: null,
        targetId: ckTargets[0].id,
        description: `${self.name} casts Cloudkill on ${names}`,
      };
      plan.targetId = ckTargets[0].id;
      plan.bonusAction = planBonusAction(self, ckTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12N. BLIGHT (CON save 8d8 necrotic single-target, L4, NO concentration) ---
  // PHB p.219: action, 30 ft, CON save 8d8 necrotic (half on save), single-target.
  // Plant-creature disadvantage + undead/construct immunity simplified away
  // (no creature-type tag in v1). Avg 36 damage on fail — solid L4 single-target
  // (short 30-ft range limits its use to casters near the front line).
  if (!plan.action && self.actions.some(a => a.name === 'Blight')) {
    const blightTarget = shouldCastBlight(self, battlefield);
    if (blightTarget) {
      plan.action = {
        type: 'blight',
        action: null,
        targetId: blightTarget.id,
        description: `${self.name} casts Blight at ${blightTarget.name}`,
      };
      plan.targetId = blightTarget.id;
      plan.bonusAction = planBonusAction(self, blightTarget, battlefield);
      return plan;
    }
  }

  // ── Session 24 — Megabatch batch 1 (L1 combat damage spells) ──────
  // 8 L1 bespoke spell branches. Numbered 12O–12V. Tactical priority:
  // all L1 (lowest bespoke priority) — these sit after the L4–L9
  // Session 22/23 branches and before the Session 19 generic loop.
  // Witch Bolt (12V) auto-detects DoT mode (concentrating on Witch Bolt)
  // vs fresh cast via shouldCast's internal check.

  // --- 12O. CHAOS BOLT (ranged spell attack 2d8 random-type, L1, NO concentration) ---
  // XGE p.151: 120 ft, ranged spell attack, 2d8 random chaos-type damage,
  // crit doubles. Avg 9 damage on hit. Sorcerer-only spell.
  if (!plan.action && self.actions.some(a => a.name === 'Chaos Bolt')) {
    const cbTarget = shouldCastChaosBolt(self, battlefield);
    if (cbTarget) {
      plan.action = {
        type: 'chaosBolt',
        action: null,
        targetId: cbTarget.id,
        description: `${self.name} casts Chaos Bolt at ${cbTarget.name}`,
      };
      plan.targetId = cbTarget.id;
      plan.bonusAction = planBonusAction(self, cbTarget, battlefield);
      return plan;
    }
  }

  // --- 12P. EARTH TREMOR (CON save 1d6 bludgeoning + prone, L1, NO concentration) ---
  // XGE p.155: Self (10-ft radius), CON save 1d6 bludgeoning + prone on fail,
  // caster excluded. AoE — shouldCast returns Combatant[] (all enemies within
  // 10 ft of the caster). Avg 3.5 damage + prone rider.
  if (!plan.action && self.actions.some(a => a.name === 'Earth Tremor')) {
    const etTargets = shouldCastEarthTremor(self, battlefield);
    if (etTargets) {
      const names = etTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'earthTremor',
        action: null,
        targetId: etTargets[0].id,
        description: `${self.name} casts Earth Tremor, catching ${names}`,
      };
      plan.targetId = etTargets[0].id;
      plan.bonusAction = planBonusAction(self, etTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12Q. FROST FINGERS (CON save 2d8 cold, L1, NO concentration) ---
  // XGE p.161: Self (15-ft cone), CON save 2d8 cold (half on save). AoE —
  // shouldCast returns Combatant[] (enemies in the cone). Avg 9 cold.
  if (!plan.action && self.actions.some(a => a.name === 'Frost Fingers')) {
    const ffTargets = shouldCastFrostFingers(self, battlefield);
    if (ffTargets) {
      const names = ffTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'frostFingers',
        action: null,
        targetId: ffTargets[0].id,
        description: `${self.name} casts Frost Fingers, catching ${names}`,
      };
      plan.targetId = ffTargets[0].id;
      plan.bonusAction = planBonusAction(self, ffTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12R. MAGNIFY GRAVITY (CON save 2d8 force, L1, NO concentration) ---
  // EGtW p.161: 60 ft, CON save 2d8 force (half on save), 10-ft radius AoE.
  // shouldCast returns Combatant[] (enemies in the sphere). Avg 9 force.
  if (!plan.action && self.actions.some(a => a.name === 'Magnify Gravity')) {
    const mgTargets = shouldCastMagnifyGravity(self, battlefield);
    if (mgTargets) {
      const names = mgTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'magnifyGravity',
        action: null,
        targetId: mgTargets[0].id,
        description: `${self.name} casts Magnify Gravity, catching ${names}`,
      };
      plan.targetId = mgTargets[0].id;
      plan.bonusAction = planBonusAction(self, mgTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12S. RAY OF SICKNESS (ranged spell attack 2d8 poison + poisoned, L1, NO concentration) ---
  // PHB p.271: 60 ft, ranged spell attack, 2d8 poison + poisoned on hit, crit
  // doubles. Avg 9 poison + poison rider (disadv on target's attacks).
  if (!plan.action && self.actions.some(a => a.name === 'Ray of Sickness')) {
    const rosTarget = shouldCastRayOfSickness(self, battlefield);
    if (rosTarget) {
      plan.action = {
        type: 'rayOfSickness',
        action: null,
        targetId: rosTarget.id,
        description: `${self.name} casts Ray of Sickness at ${rosTarget.name}`,
      };
      plan.targetId = rosTarget.id;
      plan.bonusAction = planBonusAction(self, rosTarget, battlefield);
      return plan;
    }
  }

  // --- 12T. SPELLFIRE FLARE (AUTO-HIT 2d10+mod fire, L1, NO concentration) ---
  // SCAG p.149: 60 ft, auto-hit (no save, no attack), 2d10+spellcasting mod
  // fire. Avg 11+mod guaranteed damage. Sorcerer-associated spell.
  if (!plan.action && self.actions.some(a => a.name === 'Spellfire Flare')) {
    const sfTarget = shouldCastSpellfireFlare(self, battlefield);
    if (sfTarget) {
      plan.action = {
        type: 'spellfireFlare',
        action: null,
        targetId: sfTarget.id,
        description: `${self.name} casts Spellfire Flare at ${sfTarget.name} (auto-hit)`,
      };
      plan.targetId = sfTarget.id;
      plan.bonusAction = planBonusAction(self, sfTarget, battlefield);
      return plan;
    }
  }

  // --- 12U. WARDAWAY (CON save 2d4 force, L1, NO concentration) ---
  // 60 ft, CON save 2d4 force (half on save), single-target. Avg 5 force
  // (force is rarely resisted — reliable chip damage).
  if (!plan.action && self.actions.some(a => a.name === 'Wardaway')) {
    const waTarget = shouldCastWardaway(self, battlefield);
    if (waTarget) {
      plan.action = {
        type: 'wardaway',
        action: null,
        targetId: waTarget.id,
        description: `${self.name} casts Wardaway at ${waTarget.name}`,
      };
      plan.targetId = waTarget.id;
      plan.bonusAction = planBonusAction(self, waTarget, battlefield);
      return plan;
    }
  }

  // --- 12V. WITCH BOLT (ranged spell attack 1d12 lightning + concentration DoT, L1) ---
  // PHB p.289: 30 ft, ranged spell attack 1d12 lightning on hit + START
  // concentration. On subsequent turns while concentrating, shouldCast
  // returns the linked target (DoT mode: auto-hit 1d12, no slot). The
  // "ends on other action" guard in combat.ts breaks concentration if the
  // caster uses their action for anything else.
  if (!plan.action && self.actions.some(a => a.name === 'Witch Bolt')) {
    const wbTarget = shouldCastWitchBolt(self, battlefield);
    if (wbTarget) {
      const isDoT = !!self.concentration?.active && self.concentration.spellName === 'Witch Bolt';
      plan.action = {
        type: 'witchBolt',
        action: null,
        targetId: wbTarget.id,
        description: isDoT
          ? `${self.name} sustains Witch Bolt on ${wbTarget.name} (DoT)`
          : `${self.name} casts Witch Bolt at ${wbTarget.name}`,
      };
      plan.targetId = wbTarget.id;
      plan.bonusAction = planBonusAction(self, wbTarget, battlefield);
      return plan;
    }
  }

  // ── Session 24 — L2 combat damage spells (12W–12X) ──────────────
  // NOTE on priority: the plan specifies L9 > L8 > ... > L1 ordering.
  // These L2 branches are appended after the L1 block (12O–12V) for
  // numbering continuity, so a caster with BOTH a migrated L1 spell
  // and a migrated L2 spell available would prefer the L1 spell. This
  // is a minor AI suboptimality in a rare dual-spell scenario; reorder
  // (place L2+ above L1) once enough L2+ spells exist to justify it.

  // --- 12W. MIND SPIKE (WIS save 3d8 psychic, L2, v1 one-shot) ---
  // XGE p.162: 60 ft, WIS save 3d8 psychic (half on save), single-target.
  // v1 simplifies canon concentration to one-shot. Avg 13.5 psychic.
  if (!plan.action && self.actions.some(a => a.name === 'Mind Spike')) {
    const msTarget = shouldCastMindSpike(self, battlefield);
    if (msTarget) {
      plan.action = {
        type: 'mindSpike',
        action: null,
        targetId: msTarget.id,
        description: `${self.name} casts Mind Spike at ${msTarget.name}`,
      };
      plan.targetId = msTarget.id;
      plan.bonusAction = planBonusAction(self, msTarget, battlefield);
      return plan;
    }
  }

  // --- 12X. SPRAY OF CARDS (DEX save 2d10 slashing + blinded, L2, NO concentration) ---
  // BMT p.50: Self (15-ft cone), DEX save 2d10 slashing + blinded on fail.
  // AoE — shouldCast returns Combatant[] (enemies in the cone). Avg 11 slashing + blind.
  if (!plan.action && self.actions.some(a => a.name === 'Spray of Cards')) {
    const socTargets = shouldCastSprayOfCards(self, battlefield);
    if (socTargets) {
      const names = socTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'sprayOfCards',
        action: null,
        targetId: socTargets[0].id,
        description: `${self.name} casts Spray of Cards, catching ${names}`,
      };
      plan.targetId = socTargets[0].id;
      plan.bonusAction = planBonusAction(self, socTargets[0], battlefield);
      return plan;
    }
  }

  // ── Session 24 — L3 combat damage spells (12Y–12AC) ────────────
  // NOTE on priority: L3 spells are appended after L1+L2 for numbering
  // continuity. See the L2 caveat above — reorder (place higher-level
  // branches ABOVE L1) once enough L3+ spells exist to justify it.

  // --- 12Y. ERUPTING EARTH (DEX save 3d12 bludgeoning, L3, NO concentration) ---
  // XGE p.155: 60 ft, DEX save 3d12 bludgeoning (half on save), 20-ft radius AoE.
  // shouldCast returns Combatant[] (enemies in the 20-ft cube). Avg 19.5 bludgeoning.
  if (!plan.action && self.actions.some(a => a.name === 'Erupting Earth')) {
    const eeTargets = shouldCastEruptingEarth(self, battlefield);
    if (eeTargets) {
      const names = eeTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'eruptingEarth',
        action: null,
        targetId: eeTargets[0].id,
        description: `${self.name} casts Erupting Earth, catching ${names}`,
      };
      plan.targetId = eeTargets[0].id;
      plan.bonusAction = planBonusAction(self, eeTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12Z. LIFE TRANSFERENCE (self-damage 4d8 necrotic + heal ally 2×, L3, NO concentration) ---
  // XGE p.160 canon: caster takes 4d8 necrotic (no save), target ALLY heals 2× the
  // necrotic taken. shouldCast returns a single ALLY Combatant (lowest-HP injured
  // ally within 60 ft). This is a HEAL spell, not a damage spell — branches below
  // the damage-dealing bespoke branches are fine (heal spells don't compete with
  // damage spells for the same priority slot).
  if (!plan.action && self.actions.some(a => a.name === 'Life Transference')) {
    const ltAlly = shouldCastLifeTransference(self, battlefield);
    if (ltAlly) {
      plan.action = {
        type: 'lifeTransference',
        action: null,
        targetId: ltAlly.id,
        description: `${self.name} casts Life Transference to heal ${ltAlly.name}`,
      };
      plan.targetId = ltAlly.id;
      plan.bonusAction = planBonusAction(self, ltAlly, battlefield);
      return plan;
    }
  }

  // --- 12AA. PULSE WAVE (CON save 6d6 force cone, L3, NO concentration) ---
  // EGtW p.163: Self (30-ft cone), CON save 6d6 force (half on save). AoE —
  // shouldCast returns Combatant[] (enemies in the cone). Avg 21 force.
  if (!plan.action && self.actions.some(a => a.name === 'Pulse Wave')) {
    const pwTargets = shouldCastPulseWave(self, battlefield);
    if (pwTargets) {
      const names = pwTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'pulseWave',
        action: null,
        targetId: pwTargets[0].id,
        description: `${self.name} casts Pulse Wave, catching ${names}`,
      };
      plan.targetId = pwTargets[0].id;
      plan.bonusAction = planBonusAction(self, pwTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AB. TIDAL WAVE (STR save 4d8 bludgeoning + prone line, L3, NO concentration) ---
  // XGE p.168: 30-ft line (v1 per plan; canon single-target), STR save 4d8 bludgeoning
  // + prone on fail. AoE — shouldCast returns Combatant[] (enemies in the line). Avg 18 + prone.
  if (!plan.action && self.actions.some(a => a.name === 'Tidal Wave')) {
    const twTargets = shouldCastTidalWave(self, battlefield);
    if (twTargets) {
      const names = twTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'tidalWave',
        action: null,
        targetId: twTargets[0].id,
        description: `${self.name} casts Tidal Wave, catching ${names}`,
      };
      plan.targetId = twTargets[0].id;
      plan.bonusAction = planBonusAction(self, twTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AC. VAMPIRIC TOUCH (melee spell attack 3d6 necrotic + heal self half, L3, v1 one-shot) ---
  // PHB p.287: touch (5 ft), melee spell attack 3d6 necrotic + heal caster half the
  // necrotic dealt (crit doubles dice). v1 simplifies canon concentration to one-shot.
  // shouldCast returns a single adjacent enemy. Avg 10.5 necrotic + ~5 self-heal.
  if (!plan.action && self.actions.some(a => a.name === 'Vampiric Touch')) {
    const vtTarget = shouldCastVampiricTouch(self, battlefield);
    if (vtTarget) {
      plan.action = {
        type: 'vampiricTouch',
        action: null,
        targetId: vtTarget.id,
        description: `${self.name} casts Vampiric Touch on ${vtTarget.name}`,
      };
      plan.targetId = vtTarget.id;
      plan.bonusAction = planBonusAction(self, vtTarget, battlefield);
      return plan;
    }
  }

  // ── Session 24 — L4 combat damage spells (12AD–12AJ) ────────────

  // --- 12AD. ELEMENTAL BANE (WIS save 2d6 acid, L4, v1 one-shot) ---
  // XGE p.154: 90 ft, WIS save 2d6 acid (half on save), single-target.
  // v1 simplifies canon concentration + vulnerability rider. Avg 7 acid.
  if (!plan.action && self.actions.some(a => a.name === 'Elemental Bane')) {
    const ebTarget = shouldCastElementalBane(self, battlefield);
    if (ebTarget) {
      plan.action = {
        type: 'elementalBane',
        action: null,
        targetId: ebTarget.id,
        description: `${self.name} casts Elemental Bane at ${ebTarget.name}`,
      };
      plan.targetId = ebTarget.id;
      plan.bonusAction = planBonusAction(self, ebTarget, battlefield);
      return plan;
    }
  }

  // --- 12AE. GRAVITY SINKHOLE (CON save 5d10 force, L4, NO concentration) ---
  // EGtW p.162: 60 ft, CON save 5d10 force (half on save), 20-ft radius AoE.
  // shouldCast returns Combatant[] (enemies in the 20-ft sphere). Avg 27.5 force.
  if (!plan.action && self.actions.some(a => a.name === 'Gravity Sinkhole')) {
    const gsTargets = shouldCastGravitySinkhole(self, battlefield);
    if (gsTargets) {
      const names = gsTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'gravitySinkhole',
        action: null,
        targetId: gsTargets[0].id,
        description: `${self.name} casts Gravity Sinkhole, catching ${names}`,
      };
      plan.targetId = gsTargets[0].id;
      plan.bonusAction = planBonusAction(self, gsTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AF. ICE STORM (DEX save 2d8 cold + 2d6 bludgeoning, L4, NO concentration) ---
  // PHB p.254: 300 ft, DEX save 2d8 cold + 2d6 bludgeoning (half on save, dual damage),
  // 20-ft radius AoE. shouldCast returns Combatant[]. Avg 17 cold+bludgeoning.
  if (!plan.action && self.actions.some(a => a.name === 'Ice Storm')) {
    const isTargets = shouldCastIceStorm(self, battlefield);
    if (isTargets) {
      const names = isTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'iceStorm',
        action: null,
        targetId: isTargets[0].id,
        description: `${self.name} casts Ice Storm, catching ${names}`,
      };
      plan.targetId = isTargets[0].id;
      plan.bonusAction = planBonusAction(self, isTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AG. SICKENING RADIANCE (CON save 4d10 radiant + poisoned, L4, v1 one-shot) ---
  // XGE p.164: 120 ft, CON save 4d10 radiant + poisoned on fail (exhaustion simplified),
  // 30-ft radius AoE. v1 simplifies canon concentration. shouldCast returns Combatant[].
  // Avg 22 radiant + poisoned.
  if (!plan.action && self.actions.some(a => a.name === 'Sickening Radiance')) {
    const srTargets = shouldCastSickeningRadiance(self, battlefield);
    if (srTargets) {
      const names = srTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'sickeningRadiance',
        action: null,
        targetId: srTargets[0].id,
        description: `${self.name} casts Sickening Radiance, catching ${names}`,
      };
      plan.targetId = srTargets[0].id;
      plan.bonusAction = planBonusAction(self, srTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AH. SPELLFIRE STORM (AUTO-HIT 4d10 fire, L4, v1 one-shot) ---
  // SCAG p.150: 60 ft, auto-hit (no save, no attack) 4d10 fire, single-target.
  // v1 simplifies canon concentration + DoT. Avg 22 guaranteed fire.
  if (!plan.action && self.actions.some(a => a.name === 'Spellfire Storm')) {
    const sfTarget = shouldCastSpellfireStorm(self, battlefield);
    if (sfTarget) {
      plan.action = {
        type: 'spellfireStorm',
        action: null,
        targetId: sfTarget.id,
        description: `${self.name} casts Spellfire Storm at ${sfTarget.name} (auto-hit)`,
      };
      plan.targetId = sfTarget.id;
      plan.bonusAction = planBonusAction(self, sfTarget, battlefield);
      return plan;
    }
  }

  // --- 12AI. STORM SPHERE (CON save 6d6 thunder, L4, v1 one-shot) ---
  // XGE p.166: 150 ft, CON save 6d6 thunder (half on save), 20-ft radius AoE (canon; plan's 40-ft is wrong).
  // v1 simplifies canon concentration + lightning rider. shouldCast returns Combatant[]. Avg 21 thunder.
  if (!plan.action && self.actions.some(a => a.name === 'Storm Sphere')) {
    const ssTargets = shouldCastStormSphere(self, battlefield);
    if (ssTargets) {
      const names = ssTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'stormSphere',
        action: null,
        targetId: ssTargets[0].id,
        description: `${self.name} casts Storm Sphere, catching ${names}`,
      };
      plan.targetId = ssTargets[0].id;
      plan.bonusAction = planBonusAction(self, ssTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AJ. VITRIOLIC SPHERE (DEX save 10d4 acid, L4, NO concentration) ---
  // XGE p.168: 150 ft, DEX save 10d4 acid (half on save), 20-ft radius AoE.
  // DoT simplified. shouldCast returns Combatant[]. Avg 25 acid.
  if (!plan.action && self.actions.some(a => a.name === 'Vitriolic Sphere')) {
    const vsTargets = shouldCastVitriolicSphere(self, battlefield);
    if (vsTargets) {
      const names = vsTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'vitriolicSphere',
        action: null,
        targetId: vsTargets[0].id,
        description: `${self.name} casts Vitriolic Sphere, catching ${names}`,
      };
      plan.targetId = vsTargets[0].id;
      plan.bonusAction = planBonusAction(self, vsTargets[0], battlefield);
      return plan;
    }
  }

  // ── Session 24 — L5 combat damage spells (12AK–12AR) ────────────

  // --- 12AK. DESTRUCTIVE WAVE (CON save 5d6 thunder + prone, L5, NO concentration) ---
  // PHB p.250: Self (30-ft radius), CON save 5d6 thunder + prone on fail, caster excluded.
  // v1 follows plan (5d6 thunder only; canon 5d6 thunder + 5d6 radiant/necrotic simplified).
  // shouldCast returns Combatant[] (enemies within 30 ft of caster). Avg 17.5 thunder + prone.
  if (!plan.action && self.actions.some(a => a.name === 'Destructive Wave')) {
    const dwTargets = shouldCastDestructiveWave(self, battlefield);
    if (dwTargets) {
      const names = dwTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'destructiveWave',
        action: null,
        targetId: dwTargets[0].id,
        description: `${self.name} casts Destructive Wave, catching ${names}`,
      };
      plan.targetId = dwTargets[0].id;
      plan.bonusAction = planBonusAction(self, dwTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AL. ENERVATION (DEX save 4d8 necrotic + heal self half, L5, v1 one-shot) ---
  // XGE p.155: 60 ft, DEX save 4d8 necrotic + heal caster half (half on save). v1 one-shot.
  // shouldCast returns a single enemy. Avg 18 necrotic + ~9 self-heal.
  if (!plan.action && self.actions.some(a => a.name === 'Enervation')) {
    const enTarget = shouldCastEnervation(self, battlefield);
    if (enTarget) {
      plan.action = {
        type: 'enervation',
        action: null,
        targetId: enTarget.id,
        description: `${self.name} casts Enervation at ${enTarget.name}`,
      };
      plan.targetId = enTarget.id;
      plan.bonusAction = planBonusAction(self, enTarget, battlefield);
      return plan;
    }
  }

  // --- 12AM. FLAME STRIKE (DEX save 4d6 fire + 4d6 radiant, L5, NO concentration) ---
  // PHB p.243: 60 ft, DEX save 4d6 fire + 4d6 radiant (dual damage, half on save), 10-ft radius.
  // shouldCast returns Combatant[]. Avg 28 fire+radiant.
  if (!plan.action && self.actions.some(a => a.name === 'Flame Strike')) {
    const fsTargets = shouldCastFlameStrike(self, battlefield);
    if (fsTargets) {
      const names = fsTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'flameStrike',
        action: null,
        targetId: fsTargets[0].id,
        description: `${self.name} casts Flame Strike, catching ${names}`,
      };
      plan.targetId = fsTargets[0].id;
      plan.bonusAction = planBonusAction(self, fsTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AN. IMMOLATION (DEX save 8d6 fire, L5, v1 one-shot) ---
  // XGE p.157: 90 ft, DEX save 8d6 fire (half on save), single-target. v1 one-shot.
  // shouldCast returns a single enemy. Avg 28 fire.
  if (!plan.action && self.actions.some(a => a.name === 'Immolation')) {
    const imTarget = shouldCastImmolation(self, battlefield);
    if (imTarget) {
      plan.action = {
        type: 'immolation',
        action: null,
        targetId: imTarget.id,
        description: `${self.name} casts Immolation at ${imTarget.name}`,
      };
      plan.targetId = imTarget.id;
      plan.bonusAction = planBonusAction(self, imTarget, battlefield);
      return plan;
    }
  }

  // --- 12AO. MAELSTROM (DEX save 6d6 bludgeoning + restrained, L5, v1 one-shot) ---
  // XGE p.160: 120 ft, DEX save 6d6 bludgeoning + restrained on fail, 20-ft radius. v1 one-shot.
  // shouldCast returns Combatant[]. Avg 21 bludgeoning + restrained.
  if (!plan.action && self.actions.some(a => a.name === 'Maelstrom')) {
    const maTargets = shouldCastMaelstrom(self, battlefield);
    if (maTargets) {
      const names = maTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'maelstrom',
        action: null,
        targetId: maTargets[0].id,
        description: `${self.name} casts Maelstrom, catching ${names}`,
      };
      plan.targetId = maTargets[0].id;
      plan.bonusAction = planBonusAction(self, maTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AP. NEGATIVE ENERGY FLOOD (CON save 5d12 necrotic, L5, NO concentration) ---
  // XGE p.162: 60 ft, CON save 5d12 necrotic (half on save), single-target. Undead-boost simplified.
  // shouldCast returns a single enemy. Avg 32.5 necrotic.
  if (!plan.action && self.actions.some(a => a.name === 'Negative Energy Flood')) {
    const nefTarget = shouldCastNegativeEnergyFlood(self, battlefield);
    if (nefTarget) {
      plan.action = {
        type: 'negativeEnergyFlood',
        action: null,
        targetId: nefTarget.id,
        description: `${self.name} casts Negative Energy Flood at ${nefTarget.name}`,
      };
      plan.targetId = nefTarget.id;
      plan.bonusAction = planBonusAction(self, nefTarget, battlefield);
      return plan;
    }
  }

  // --- 12AQ. STEEL WIND STRIKE (5 melee spell attacks 6d10 force, L5, NO concentration) ---
  // XGE p.166: 30 ft, 5 melee spell attacks 6d10 force (crit doubles), multi-target. Teleport simplified.
  // shouldCast returns Combatant[] (5 targets, may repeat). Avg 33 force per hit × 5 hits.
  if (!plan.action && self.actions.some(a => a.name === 'Steel Wind Strike')) {
    const swsTargets = shouldCastSteelWindStrike(self, battlefield);
    if (swsTargets) {
      const names = [...new Set(swsTargets.map(t => t.name))].join(', ');
      plan.action = {
        type: 'steelWindStrike',
        action: null,
        targetId: swsTargets[0].id,
        description: `${self.name} casts Steel Wind Strike at ${names} (5 attacks)`,
      };
      plan.targetId = swsTargets[0].id;
      plan.bonusAction = planBonusAction(self, swsTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AR. SYNAPTIC STATIC (INT save 8d6 psychic + incapacitated, L5, NO concentration) ---
  // XGE p.167: 120 ft, INT save 8d6 psychic + incapacitated on fail (-1d6 simplified), 20-ft radius.
  // shouldCast returns Combatant[]. Avg 28 psychic + incapacitated.
  if (!plan.action && self.actions.some(a => a.name === 'Synaptic Static')) {
    const ssTargets = shouldCastSynapticStatic(self, battlefield);
    if (ssTargets) {
      const names = ssTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'synapticStatic',
        action: null,
        targetId: ssTargets[0].id,
        description: `${self.name} casts Synaptic Static, catching ${names}`,
      };
      plan.targetId = ssTargets[0].id;
      plan.bonusAction = planBonusAction(self, ssTargets[0], battlefield);
      return plan;
    }
  }

  // ── Session 24 — L6 combat damage spells (12AS–12AW) ────────────

  // --- 12AS. CHAIN LIGHTNING (auto-hit 10d8 lightning multi-target, L6, NO concentration) ---
  // PHB p.221: 150 ft, AUTO-HIT 10d8 lightning to 1 primary + 3 arcs (4 targets max).
  // v1 auto-hit per plan. shouldCast returns Combatant[] (up to 4). Avg 45 lightning per target.
  if (!plan.action && self.actions.some(a => a.name === 'Chain Lightning')) {
    const clTargets = shouldCastChainLightning(self, battlefield);
    if (clTargets) {
      const names = clTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'chainLightning',
        action: null,
        targetId: clTargets[0].id,
        description: `${self.name} casts Chain Lightning at ${names} (auto-hit)`,
      };
      plan.targetId = clTargets[0].id;
      plan.bonusAction = planBonusAction(self, clTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AT. CIRCLE OF DEATH (CON save 8d6 necrotic, L6, NO concentration) ---
  // PHB p.221: 60 ft, CON save 8d6 necrotic (half on save), 60-ft radius AoE.
  // shouldCast returns Combatant[]. Avg 28 necrotic.
  if (!plan.action && self.actions.some(a => a.name === 'Circle of Death')) {
    const codTargets = shouldCastCircleOfDeath(self, battlefield);
    if (codTargets) {
      const names = codTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'circleOfDeath',
        action: null,
        targetId: codTargets[0].id,
        description: `${self.name} casts Circle of Death, catching ${names}`,
      };
      plan.targetId = codTargets[0].id;
      plan.bonusAction = planBonusAction(self, codTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AU. GRAVITY FISSURE (CON save 8d8 force line, L6, NO concentration) ---
  // EGtW p.162: 100-ft line, CON save 8d8 force (half on save). Secondary AoE + pull simplified.
  // shouldCast returns Combatant[]. Avg 36 force.
  if (!plan.action && self.actions.some(a => a.name === 'Gravity Fissure')) {
    const gfTargets = shouldCastGravityFissure(self, battlefield);
    if (gfTargets) {
      const names = gfTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'gravityFissure',
        action: null,
        targetId: gfTargets[0].id,
        description: `${self.name} casts Gravity Fissure, catching ${names}`,
      };
      plan.targetId = gfTargets[0].id;
      plan.bonusAction = planBonusAction(self, gfTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12AV. MENTAL PRISON (INT save 5d10 psychic, L6, v1 one-shot) ---
  // XGE p.161: 60 ft, INT save 5d10 psychic (half on save), single-target. v1 one-shot.
  // shouldCast returns a single enemy. Avg 27.5 psychic.
  if (!plan.action && self.actions.some(a => a.name === 'Mental Prison')) {
    const mpTarget = shouldCastMentalPrison(self, battlefield);
    if (mpTarget) {
      plan.action = {
        type: 'mentalPrison',
        action: null,
        targetId: mpTarget.id,
        description: `${self.name} casts Mental Prison at ${mpTarget.name}`,
      };
      plan.targetId = mpTarget.id;
      plan.bonusAction = planBonusAction(self, mpTarget, battlefield);
      return plan;
    }
  }

  // --- 12AW. SUNBEAM (CON save 6d8 radiant + blinded line, L6, v1 one-shot) ---
  // PHB p.279: 60-ft line, CON save 6d8 radiant + blinded on fail. v1 one-shot (canon concentration + repeat-action).
  // shouldCast returns Combatant[]. Avg 27 radiant + blinded.
  if (!plan.action && self.actions.some(a => a.name === 'Sunbeam')) {
    const sbTargets = shouldCastSunbeam(self, battlefield);
    if (sbTargets) {
      const names = sbTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'sunbeam',
        action: null,
        targetId: sbTargets[0].id,
        description: `${self.name} casts Sunbeam, catching ${names}`,
      };
      plan.targetId = sbTargets[0].id;
      plan.bonusAction = planBonusAction(self, sbTargets[0], battlefield);
      return plan;
    }
  }

  // ── Session 24 — L7 combat damage spells (12AX–12AY) ────────────

  // --- 12AX. CROWN OF STARS (ranged spell attack 4d12 radiant, L7, v1 one-shot) ---
  // XGE p.152: 120 ft, ranged spell attack 4d12 radiant (crit doubles), single-target.
  // v1 one-shot (7-mote storage simplified). shouldCast returns a single enemy. Avg 26 radiant.
  if (!plan.action && self.actions.some(a => a.name === 'Crown of Stars')) {
    const cosTarget = shouldCastCrownOfStars(self, battlefield);
    if (cosTarget) {
      plan.action = {
        type: 'crownOfStars',
        action: null,
        targetId: cosTarget.id,
        description: `${self.name} casts Crown of Stars at ${cosTarget.name}`,
      };
      plan.targetId = cosTarget.id;
      plan.bonusAction = planBonusAction(self, cosTarget, battlefield);
      return plan;
    }
  }

  // --- 12AY. FIRE STORM (DEX save 7d10 fire, L7, NO concentration) ---
  // PHB p.242: 150 ft, DEX save 7d10 fire (half on save), 40-ft radius AoE (canon ten-10ft-cubes simplified).
  // shouldCast returns Combatant[]. Avg 38.5 fire.
  if (!plan.action && self.actions.some(a => a.name === 'Fire Storm')) {
    const fsTargets = shouldCastFireStorm(self, battlefield);
    if (fsTargets) {
      const names = fsTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'fireStorm',
        action: null,
        targetId: fsTargets[0].id,
        description: `${self.name} casts Fire Storm, catching ${names}`,
      };
      plan.targetId = fsTargets[0].id;
      plan.bonusAction = planBonusAction(self, fsTargets[0], battlefield);
      return plan;
    }
  }

  // ── Session 24 — L8 combat damage spells (12AZ–12BD) ────────────

  // --- 12AZ. DARK STAR (CON save 8d8 necrotic + blinded, L8, v1 one-shot) ---
  // XGE p.153: 150 ft, CON save 8d8 necrotic + blinded on fail, 40-ft radius. v1 one-shot.
  // shouldCast returns Combatant[]. Avg 36 necrotic + blinded.
  if (!plan.action && self.actions.some(a => a.name === 'Dark Star')) {
    const dsTargets = shouldCastDarkStar(self, battlefield);
    if (dsTargets) {
      const names = dsTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'darkStar',
        action: null,
        targetId: dsTargets[0].id,
        description: `${self.name} casts Dark Star, catching ${names}`,
      };
      plan.targetId = dsTargets[0].id;
      plan.bonusAction = planBonusAction(self, dsTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12BA. EARTHQUAKE (AUTO-HIT 5d6 bludgeoning, L8, v1 one-shot) ---
  // PHB p.234: Self (50-ft radius per plan), AUTO-HIT 5d6 bludgeoning (no save per plan). v1 one-shot.
  // shouldCast returns Combatant[]. Avg 17.5 bludgeoning.
  if (!plan.action && self.actions.some(a => a.name === 'Earthquake')) {
    const eqTargets = shouldCastEarthquake(self, battlefield);
    if (eqTargets) {
      const names = eqTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'earthquake',
        action: null,
        targetId: eqTargets[0].id,
        description: `${self.name} casts Earthquake, catching ${names}`,
      };
      plan.targetId = eqTargets[0].id;
      plan.bonusAction = planBonusAction(self, eqTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12BB. FEEBLEMIND (INT save 4d6 psychic + incapacitated, L8, NO concentration) ---
  // PHB p.239: 60 ft, INT save 4d6 psychic (always dealt) + incapacitated on fail (INT/CHA→1 simplified).
  // shouldCast returns a single enemy. Avg 14 psychic + incapacitated.
  if (!plan.action && self.actions.some(a => a.name === 'Feeblemind')) {
    const fmTarget = shouldCastFeeblemind(self, battlefield);
    if (fmTarget) {
      plan.action = {
        type: 'feeblemind',
        action: null,
        targetId: fmTarget.id,
        description: `${self.name} casts Feeblemind at ${fmTarget.name}`,
      };
      plan.targetId = fmTarget.id;
      plan.bonusAction = planBonusAction(self, fmTarget, battlefield);
      return plan;
    }
  }

  // --- 12BC. INCENDIARY CLOUD (DEX save 10d8 fire, L8, NO concentration) ---
  // PHB p.253: 150 ft, DEX save 10d8 fire (half on save), 20-ft radius. Moving-cloud simplified.
  // shouldCast returns Combatant[]. Avg 45 fire.
  if (!plan.action && self.actions.some(a => a.name === 'Incendiary Cloud')) {
    const icTargets = shouldCastIncendiaryCloud(self, battlefield);
    if (icTargets) {
      const names = icTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'incendiaryCloud',
        action: null,
        targetId: icTargets[0].id,
        description: `${self.name} casts Incendiary Cloud, catching ${names}`,
      };
      plan.targetId = icTargets[0].id;
      plan.bonusAction = planBonusAction(self, icTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12BD. MADDENING DARKNESS (WIS save 8d8 psychic, L8, v1 one-shot) ---
  // XGE p.158: 120 ft, WIS save 8d8 psychic (half on save), 60-ft radius. Darkness rider simplified. v1 one-shot.
  // shouldCast returns Combatant[]. Avg 36 psychic.
  if (!plan.action && self.actions.some(a => a.name === 'Maddening Darkness')) {
    const mdTargets = shouldCastMaddeningDarkness(self, battlefield);
    if (mdTargets) {
      const names = mdTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'maddeningDarkness',
        action: null,
        targetId: mdTargets[0].id,
        description: `${self.name} casts Maddening Darkness, catching ${names}`,
      };
      plan.targetId = mdTargets[0].id;
      plan.bonusAction = planBonusAction(self, mdTargets[0], battlefield);
      return plan;
    }
  }

  // ── Session 24 — L9 combat damage spells (12BE–12BF) ────────────

  // --- 12BE. PSYCHIC SCREAM (INT save 14d6 psychic + stunned, L9, NO concentration) ---
  // XGE p.163: 90 ft, INT save 14d6 psychic + stunned on fail, up to 10 targets (point-targeted).
  // shouldCast returns Combatant[] (up to 10). Avg 49 psychic + stunned per target.
  if (!plan.action && self.actions.some(a => a.name === 'Psychic Scream')) {
    const psTargets = shouldCastPsychicScream(self, battlefield);
    if (psTargets) {
      const names = psTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'psychicScream',
        action: null,
        targetId: psTargets[0].id,
        description: `${self.name} casts Psychic Scream at ${names}`,
      };
      plan.targetId = psTargets[0].id;
      plan.bonusAction = planBonusAction(self, psTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12BF. RAVENOUS VOID (AUTO-HIT 5d10 force, L9, v1 one-shot) ---
  // XGE p.159: 1000 ft, AUTO-HIT 5d10 force (no save per plan), 60-ft radius. v1 one-shot.
  // shouldCast returns Combatant[]. Avg 27.5 force per target.
  if (!plan.action && self.actions.some(a => a.name === 'Ravenous Void')) {
    const rvTargets = shouldCastRavenousVoid(self, battlefield);
    if (rvTargets) {
      const names = rvTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'ravenousVoid',
        action: null,
        targetId: rvTargets[0].id,
        description: `${self.name} casts Ravenous Void, catching ${names}`,
      };
      plan.targetId = rvTargets[0].id;
      plan.bonusAction = planBonusAction(self, rvTargets[0], battlefield);
      return plan;
    }
  }

  // ── Session 25 — Megabatch batch 2 (save-or-condition spells) ──────
  // 35 L1-L9 save-or-condition spells. Numbered 12BG–12CO. Tactical
  // priority (per MEGABATCH-MIGRATION-PLAN.md): L9 > L8 > ... > L1, and
  // fully-disabling conditions (stunned, paralyzed, unconscious, petrified)
  // rank above partial (frightened, poisoned, prone). Single-target spells
  // set plan.targetId to the chosen enemy; AoE spells set it to the first
  // target (the sphere/cone center).

  // --- 12BG. WEIRD (WIS save 4d10 psychic + frightened, L9, AoE, concentration) ---
  // PHB p.288: 120 ft, WIS save 4d10 psychic (half on save) + frightened on
  // fail, 30-ft radius AoE. concentration (DoT simplified one-shot).
  // shouldCast returns Combatant[]. Avg 22 psychic + frightened per target.
  if (!plan.action && self.actions.some(a => a.name === 'Weird')) {
    const wTargets = shouldCastWeird(self, battlefield);
    if (wTargets) {
      const names = wTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'weird',
        action: null,
        targetId: wTargets[0].id,
        description: `${self.name} casts Weird, catching ${names}`,
      };
      plan.targetId = wTargets[0].id;
      plan.bonusAction = planBonusAction(self, wTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12BH. POWER WORD STUN (HP-gate ≤150 → stunned, L8, NO save/attack) ---
  // PHB p.267: 60 ft, NO save, NO attack — stunned if currentHP ≤ 150.
  // shouldCast returns single Combatant (highest-cur-HP enemy ≤ 150 in range).
  if (!plan.action && self.actions.some(a => a.name === 'Power Word Stun')) {
    const pwsTarget = shouldCastPowerWordStun(self, battlefield);
    if (pwsTarget) {
      plan.action = {
        type: 'powerWordStun',
        action: null,
        targetId: pwsTarget.id,
        description: `${self.name} casts Power Word Stun at ${pwsTarget.name}`,
      };
      plan.targetId = pwsTarget.id;
      plan.bonusAction = planBonusAction(self, pwsTarget, battlefield);
      return plan;
    }
  }

  // --- 12BI. DOMINATE MONSTER (WIS save or charmed, L8, concentration) ---
  // PHB p.235: 60 ft, WIS save or charmed (control simplified), any creature.
  // shouldCast returns single Combatant.
  if (!plan.action && self.actions.some(a => a.name === 'Dominate Monster')) {
    const dmTarget = shouldCastDominateMonster(self, battlefield);
    if (dmTarget) {
      plan.action = {
        type: 'dominateMonster',
        action: null,
        targetId: dmTarget.id,
        description: `${self.name} casts Dominate Monster at ${dmTarget.name}`,
      };
      plan.targetId = dmTarget.id;
      plan.bonusAction = planBonusAction(self, dmTarget, battlefield);
      return plan;
    }
  }

  // --- 12BJ. POWER WORD PAIN (HP-gate ≤60 → 4d8 psychic + restrained, L7) ---
  // XGE p.163: 60 ft, NO save/attack — 4d8 psychic + restrained if HP ≤ 60.
  // shouldCast returns single Combatant (highest-cur-HP enemy ≤ 60 in range).
  if (!plan.action && self.actions.some(a => a.name === 'Power Word Pain')) {
    const pwpTarget = shouldCastPowerWordPain(self, battlefield);
    if (pwpTarget) {
      plan.action = {
        type: 'powerWordPain',
        action: null,
        targetId: pwpTarget.id,
        description: `${self.name} casts Power Word Pain at ${pwpTarget.name}`,
      };
      plan.targetId = pwpTarget.id;
      plan.bonusAction = planBonusAction(self, pwpTarget, battlefield);
      return plan;
    }
  }

  // --- 12BK. WHIRLWIND (CON save or restrained, L7, 50-ft cone, concentration) ---
  // PHB p.298: 50-ft cone, CON save or restrained, concentration (no damage v1).
  // shouldCast returns Combatant[].
  if (!plan.action && self.actions.some(a => a.name === 'Whirlwind')) {
    const whTargets = shouldCastWhirlwind(self, battlefield);
    if (whTargets) {
      const names = whTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'whirlwind',
        action: null,
        targetId: whTargets[0].id,
        description: `${self.name} casts Whirlwind, catching ${names}`,
      };
      plan.targetId = whTargets[0].id;
      plan.bonusAction = planBonusAction(self, whTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12BL. REVERSE GRAVITY (DEX save or restrained, L7, 50-ft radius, conc) ---
  // PHB p.277: 100 ft, 50-ft radius AoE, DEX save or restrained, concentration.
  // shouldCast returns Combatant[].
  if (!plan.action && self.actions.some(a => a.name === 'Reverse Gravity')) {
    const rgTargets = shouldCastReverseGravity(self, battlefield);
    if (rgTargets) {
      const names = rgTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'reverseGravity',
        action: null,
        targetId: rgTargets[0].id,
        description: `${self.name} casts Reverse Gravity, catching ${names}`,
      };
      plan.targetId = rgTargets[0].id;
      plan.bonusAction = planBonusAction(self, rgTargets[0], battlefield);
      return plan;
    }
  }

  // --- 12BM. EYEBITE (WIS save or sleeping, L6, concentration, one-shot) ---
  // PHB p.238: 60 ft, WIS save or sleeping (Asleep option), concentration.
  // shouldCast returns single Combatant.
  if (!plan.action && self.actions.some(a => a.name === 'Eyebite')) {
    const ebTarget = shouldCastEyebite(self, battlefield);
    if (ebTarget) {
      plan.action = {
        type: 'eyebite',
        action: null,
        targetId: ebTarget.id,
        description: `${self.name} casts Eyebite at ${ebTarget.name}`,
      };
      plan.targetId = ebTarget.id;
      plan.bonusAction = planBonusAction(self, ebTarget, battlefield);
      return plan;
    }
  }

  // --- 12BN. FLESH TO STONE (CON save or restrained, L6, concentration) ---
  // PHB p.241: 60 ft, CON save or restrained, concentration (3-fail petrified simplified).
  // shouldCast returns single Combatant.
  if (!plan.action && self.actions.some(a => a.name === 'Flesh to Stone')) {
    const ftsTarget = shouldCastFleshToStone(self, battlefield);
    if (ftsTarget) {
      plan.action = {
        type: 'fleshToStone',
        action: null,
        targetId: ftsTarget.id,
        description: `${self.name} casts Flesh to Stone at ${ftsTarget.name}`,
      };
      plan.targetId = ftsTarget.id;
      plan.bonusAction = planBonusAction(self, ftsTarget, battlefield);
      return plan;
    }
  }

  // --- 12BO. MASS SUGGESTION (WIS save or charmed, L6, up to 12, NO conc) ---
  // PHB p.258: 60 ft, WIS save or charmed, up to 12 targets, NO concentration.
  // shouldCast returns Combatant[] (up to 12).
  if (!plan.action && self.actions.some(a => a.name === 'Mass Suggestion')) {
    const msTargets = shouldCastMassSuggestion(self, battlefield);
    if (msTargets) {
      const names = msTargets.map(t => t.name).join(', ');
      plan.action = {
        type: 'massSuggestion',
        action: null,
        targetId: msTargets[0].id,
        description: `${self.name} casts Mass Suggestion at ${names}`,
      };
      plan.targetId = msTargets[0].id;
      plan.bonusAction = planBonusAction(self, msTargets[0], battlefield);
      return plan;
    }
  }

  // === SESSION 19 — GENERIC SPELL LOOP (262 bulk-implemented spells) ===
  // Iterate the GENERIC_SPELL_LIST (ordered by level, then name) and pick
  // the first spell whose shouldCast returns true. Each spell module's
  // shouldCast already checks (a) caster has the spell in actions, (b) slot
  // available, (c) not already active. The generic-spell branch in combat.ts
  // dispatches the chosen spell via lookupGenericSpell(plan.spellName).
  //
  // This loop sits BELOW all bespoke spell branches (11X–11AQ) so it only
  // fires when no bespoke spell was chosen. It sits ABOVE Mage Armor / the
  // improvised-attack fallback so a generic spell always wins over an
  // improvised weapon attack.
  //
  // PERF: precompute the caster's action-name Set ONCE per planTurn call
  // (not 262 times inside the loop). Most combatants have 0–10 spell
  // actions, so the Set lookup is O(1) per spell instead of O(N actions).
  if (!plan.action) {
    const actionNames = new Set(self.actions.map(a => a.name));
    for (const desc of GENERIC_SPELL_LIST) {
      if (!actionNames.has(desc.name)) continue;
      if (desc.shouldCast(self, battlefield)) {
        plan.action = {
          type: 'genericSpell',
          action: null,
          targetId: self.id,
          description: `${self.name} casts ${desc.name}`,
          spellName: desc.name,
        };
        plan.targetId = self.id;
        plan.bonusAction = planBonusAction(self, target, battlefield);
        return plan;
      }
    }
  }

  // === MAGE ARMOR (action, self) ===
  // Cast as first action if unarmored and slot available. No concentration needed.
  if (!plan.action && shouldCastMageArmor(self, battlefield)) {
    plan.action = { type: 'mageArmor', action: null, targetId: self.id,
      description: `${self.name} casts Mage Armor` };
  }

  // === SELECT ACTION ===
  let chosenAction = selectAction(self, target, battlefield);

  // === IMPROVISED ATTACK FALLBACK ===
  // If the creature has no actions that apply (e.g. statblock with non-attack actions only),
  // fall back to improvised weapon (hasHands → 1d4+STR, no prof) or unarmed (1+STR, uses prof).
  // This ensures every non-defender, non-cannotAttack creature can always contribute.
  if (!chosenAction) {
    if (self.hasHands) {
      const improv = makeImprovisedWeapon(self);
      chosenAction = {
        type: 'attack',
        action: improv,
        targetId: target.id,
        description: `${self.name} attacks with an improvised weapon`,
      };
    } else {
      const unarmed = makeImprovisedUnarmed(self);
      chosenAction = {
        type: 'attack',
        action: unarmed,
        targetId: target.id,
        description: `${self.name} strikes with an unarmed attack`,
      };
    }
  }

  // Don't overwrite a self-buff action (e.g. mageArmor) already planned above.
  if (!plan.action) plan.action = chosenAction;

  // === MOVEMENT ===
  const { moveBefore, moveAfter } = planMovement(self, target, chosenAction, battlefield);
  plan.moveBefore = moveBefore;
  plan.moveAfter = moveAfter;

  // === BONUS ACTION ===
  plan.bonusAction = planBonusAction(self, target, battlefield);

  // === CUNNING ACTION (Rogue Level 2+) ===
  // Adds Disengage or Dash as bonus action when cunningAction is available
  // and no higher-priority bonus action was already planned (rage, second wind, etc.).
  if (!plan.bonusAction && self.resources?.cunningAction) {
    const postMovePos = plan.moveBefore ?? self.pos;
    const ca = planCunningAction(self, chosenAction, target, postMovePos, battlefield);
    if (ca.bonusAction) {
      plan.bonusAction = ca.bonusAction;
      // Disengage: add retreat moveAfter only if movement wasn't already planned.
      if (ca.moveAfter && !plan.moveAfter) {
        plan.moveAfter = ca.moveAfter;
      }
      // Dash: override moveBefore (move adjacent) and action (melee attack).
      // ca.moveBefore / ca.overrideAction are only set when type === 'dash'.
      if (ca.moveBefore !== undefined) {
        plan.moveBefore = ca.moveBefore;
      }
      if (ca.overrideAction !== undefined && ca.overrideAction !== null) {
        plan.action = ca.overrideAction;
        chosenAction = ca.overrideAction;  // keep local reference consistent
      }
    }
  }

  return plan;
}

/**
 * Plan a legendary action for a creature after an enemy's turn.
 * Called by the engine at the end of each other creature's turn.
 * Design doc §6: LEGENDARY ACTION WINDOW.
 */
export function planLegendaryAction(
  self: Combatant,
  battlefield: Battlefield
): PlannedAction | null {
  if (self.legendaryActionPool <= 0) return null;

  // Use smart targeting even if aiProfile isn't smart (legendary creatures warrant it)
  const target = selectTarget(self, battlefield);
  const la = selectLegendaryAction(self, target);
  if (!la || !la.action) return null;

  return {
    type: 'legendary',
    action: la.action,
    targetId: target?.id ?? null,
    description: `${self.name} legendary action: ${la.name}`,
  };
}

/**
 * Decide whether to take an opportunity attack against `mover`.
 * Called by the engine when an OA is triggered (§7 of design doc).
 */
export function shouldTakeOpportunityAttack(
  self: Combatant,
  mover: Combatant,
  _battlefield: Battlefield
): boolean {
  if (self.budget.reactionUsed) return false;

  switch (self.aiProfile) {
    case 'attackNearest':
    case 'attackWeakest':
      return true; // Always take OA

    case 'smart': {
      const moverIsBloodied = mover.currentHP < mover.maxHP * 0.5;
      return moverIsBloodied || mover.conditions.size === 0;
    }
    case 'defend':
      return true; // defend-mode creatures still take OA if something tries to leave
  }
  return false;
}
