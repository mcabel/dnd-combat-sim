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
