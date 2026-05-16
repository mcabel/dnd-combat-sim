// ============================================================
// AI Turn Planner
// Implements the turn state machine from combat_ai_design.md §6.
// Produces a TurnPlan for the combat engine to execute.
// ============================================================

// (adjacentEnemyCount and livingEnemiesOf already imported via movement)
import { Combatant, Battlefield, TurnPlan, PlannedAction } from '../types/core';
import { selectTarget } from './targeting';
import {
  shouldRage, activateRagePlan, shouldSecondWind, secondWindPlan,
  shouldLayOnHands, layOnHandsPlan, bardicInspirationTarget, bardicInspirationPlan,
  shouldCastHex, hexPlan,
} from './resources';
import { selectAction, selfPreserveDecision, selectLegendaryAction } from './actions';
import {
  canReach, bestAdjacentPos, bestRangedPosition,
  adjacentEnemyCount, livingEnemiesOf
} from '../engine/movement';

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
    // Dash: move toward target using full double-speed budget
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

  // === SELECT TARGET ===
  const target = selectTarget(self, battlefield);
  if (!target) return plan; // No enemies left

  plan.targetId = target.id;

  // === SELECT ACTION ===
  const chosenAction = selectAction(self, target, battlefield);
  plan.action = chosenAction;

  // === MOVEMENT ===
  const { moveBefore, moveAfter } = planMovement(self, target, chosenAction, battlefield);
  plan.moveBefore = moveBefore;
  plan.moveAfter = moveAfter;

  // === BONUS ACTION ===
  plan.bonusAction = planBonusAction(self, target, battlefield);

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
