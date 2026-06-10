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
  shouldCastCureWounds, shouldCastHealingWord, spellHealPlan,
} from './resources';
import { shouldCast as shouldCastFaerieFire } from '../spells/faerie_fire';
import { shouldCast as shouldCastBless } from '../spells/bless';
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
    const hwTarget = shouldCastHealingWord(self, battlefield);
    if (hwTarget && self.actions.some(a => a.name === 'Healing Word')) {
      return spellHealPlan(self, hwTarget.id, true);
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

  plan.action = chosenAction;

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
