// ============================================================
// Action Selection
// Picks the best Action from a combatant's action list for a given target.
// Called after target selection, before movement planning.
// ============================================================

import { Combatant, Action, Battlefield, PlannedAction } from '../types/core';
import { canReach, livingEnemiesOf, adjacentEnemyCount, distanceFt } from '../engine/movement';
import { expectedDamage, isBloodied, unarmedStrikeAction, hasAmmo, shouldGrapple, rollGrappleContest, rollShoveContest, makeImprovisedUnarmed, makeImprovisedWeapon, canGrappleOrShoveTarget } from '../engine/utils';
import { hasSpellSlot } from './resources';

// ---- Best single-target attack for a given target -----------

/**
 * From all available actions (costType='action', not Multiattack),
 * pick the one with the highest expected damage vs. target AC.
 *
 * Multiattack is selected as its own option — see selectAction().
 */
export function bestAttackAction(
  self: Combatant,
  target: Combatant,
  reachable = true   // if false, only ranged actions considered
): Action | null {
  const alreadyConcentrating = self.concentration?.active === true;
  const candidates = self.actions.filter(a =>
    !a.isMultiattack &&
    a.costType === 'action' &&
    a.attackType !== null &&
    (reachable || a.attackType === 'ranged' || a.attackType === 'spell') &&
    // Ammo check: skip ranged weapons when out of ammo (fall back to melee)
    (a.attackType !== 'ranged' || hasAmmo(self, a.name)) &&
    // Concentration guard: don't cast a concentration spell when already concentrating
    // (would silently drop the active spell — only worthwhile if explicitly better)
    !(a.requiresConcentration && alreadyConcentrating) &&
    // Slot gate: skip leveled spells when no spell slots remain
    !(a.slotLevel && a.slotLevel > 0 && !hasSpellSlot(self))
  );

  if (candidates.length === 0) return null;

  return candidates.reduce((best, a) => {
    const edBest = expectedDamage(best.hitBonus, best.damage, target.ac);
    const edA    = expectedDamage(a.hitBonus, a.damage, target.ac);
    return edA > edBest ? a : best;
  });
}

/**
 * Get the Multiattack action if available.
 * SAC v2.7: Multiattack can only be used as the action on the creature's turn,
 * never for Opportunity Attacks.
 */
export function getMultiattack(self: Combatant): Action | null {
  return self.actions.find(a => a.isMultiattack && a.costType === 'action') ?? null;
}

/**
 * Best AoE action, if any. Returns null if no AoE action exists.
 */
export function bestAoEAction(self: Combatant): Action | null {
  const aoes = self.actions.filter(a => a.isAoE && a.costType === 'action');
  if (aoes.length === 0) return null;
  // Prefer highest average damage
  return aoes.reduce((best, a) =>
    (a.damage?.average ?? 0) > (best.damage?.average ?? 0) ? a : best
  );
}

/**
 * Best control action, if any.
 */
export function bestControlAction(self: Combatant): Action | null {
  const controls = self.actions.filter(a => a.isControl && a.costType === 'action');
  return controls[0] ?? null;
}

// ---- AoE cluster detection ----------------------------------

/**
 * Find the position that maximises enemies hit within `radiusFt`.
 * Returns { center, enemies } or null if fewer than minEnemies can be hit.
 * Simple grid sweep — good enough for level 1 AI.
 */
export function findBestAoECluster(
  self: Combatant,
  battlefield: Battlefield,
  radiusFt: number,
  minEnemies = 2
): { center: import('../types/core').Vec3; enemies: Combatant[] } | null {
  const enemies = livingEnemiesOf(self, battlefield);
  if (enemies.length < minEnemies) return null;

  let best: { center: import('../types/core').Vec3; enemies: Combatant[] } | null = null;

  for (const pivot of enemies) {
    // Use each enemy position as a candidate AoE center
    const hit = enemies.filter(e => {
      const dist = Math.max(
        Math.abs(e.pos.x - pivot.pos.x),
        Math.abs(e.pos.y - pivot.pos.y)
      ) * 5; // 2D Chebyshev in feet
      return dist <= radiusFt;
    });

    // Disallow if any ally would also be caught
    const alliesHit = [...battlefield.combatants.values()].filter(c =>
      c.faction === self.faction && !c.isDead && c.id !== self.id &&
      Math.max(Math.abs(c.pos.x - pivot.pos.x), Math.abs(c.pos.y - pivot.pos.y)) * 5 <= radiusFt
    );

    if (alliesHit.length > 0) continue; // Don't AoE allies (design doc §10.1)

    if (hit.length >= minEnemies && (!best || hit.length > best.enemies.length)) {
      best = { center: pivot.pos, enemies: hit };
    }
  }

  return best;
}

// ---- Main action selector -----------------------------------

export interface ActionDecision {
  plannedAction: PlannedAction;
  needsMoveTo: boolean;  // action requires moving into range first
}

/**
 * Select the best action for `self` targeting `target` this turn.
 * Returns a PlannedAction.
 *
 * Priority (per design doc §5.3.2 Smart, simplified for all profiles):
 *   1. SMART ONLY: Control action if target score is high enough
 *   2. SMART ONLY: AoE if 2+ enemies clustered with no ally
 *   3. Multiattack if in reach
 *   4. Best single attack if in reach
 *   5. Best ranged attack if target not in melee reach
 *   6. DASH (close the gap)
 */
export function selectAction(
  self: Combatant,
  target: Combatant,
  battlefield: Battlefield
): PlannedAction {
  const isSmart = self.aiProfile === 'smart';
  const inMeleeReach = self.actions.some(
    a => !a.isMultiattack && a.attackType === 'melee' && canReach(self, target, a)
  );
  const hasRangedReach = self.actions.some(
    a => (a.attackType === 'ranged' || a.attackType === 'spell' || a.attackType === 'save')
      && canReach(self, target, a)
  );

  // --- 1. Smart: Control before damage on high-threat target ---
  if (isSmart) {
    const controlAction = bestControlAction(self);
    if (controlAction && canReach(self, target, controlAction)) {
      // Only use control if target doesn't already have the condition
      const alreadyControlled = target.conditions.has('grappled')
        || target.conditions.has('restrained')
        || target.conditions.has('stunned');
      if (!alreadyControlled) {
        // Use a simple threshold: smart score > 120 (design doc §5.3.2)
        // Import smartScore here would create a circular dep; use HP proxy instead
        const isHighThreat = !isBloodied(target) && target.maxHP >= 30;
        if (isHighThreat) {
          return {
            type: 'attack',
            action: controlAction,
            targetId: target.id,
            description: `${self.name} uses ${controlAction.name} to control ${target.name}`,
          };
        }
      }
    }
  }

  // --- 1.5. Smart: Grapple high-speed/flying targets ---
  // Grapple replaces one attack (or full action for non-multi creatures).
  // Worth doing for flying or very fast targets the group wants pinned.
  if (isSmart && inMeleeReach && canGrappleOrShoveTarget(self, target)) {
    if (shouldGrapple(self, target, 0)) {
      return {
        type: 'grapple',
        action: null,
        targetId: target.id,
        description: `${self.name} attempts to grapple ${target.name}`,
      };
    }
  }

  // --- 1.6. Smart: Shove prone vs melee target with allies adjacent ---
  // Knocking a target prone gives all adjacent allies melee advantage.
  if (isSmart && inMeleeReach && canGrappleOrShoveTarget(self, target)) {
    const bf_local = (self as any).__battlefield as { combatants: Map<string, import('../types/core').Combatant> } | undefined;
    if (bf_local) {
      const alliesAdj = [...bf_local.combatants.values()].filter(c =>
        c.faction === self.faction && c.id !== self.id && !c.isDead &&
        Math.max(Math.abs(c.pos.x - target.pos.x), Math.abs(c.pos.y - target.pos.y)) <= 1
      ).length;
      if (alliesAdj >= 1 && target.ac >= 16) {  // high-AC target: better to prone than swing
        return {
          type: 'shove',
          action: null,
          targetId: target.id,
          description: `${self.name} shoves ${target.name} prone (ally advantage setup)`,
        };
      }
    }
  }

  // --- 2. Smart: AoE if 2+ enemies clustered ---
  // PHB: casting a concentration spell while already concentrating drops the old spell.
  // Only switch if the new AoE is non-concentration OR we are not concentrating.
  if (isSmart) {
    const aoeAction = bestAoEAction(self);
    if (aoeAction) {
      const alreadyConcentrating = self.concentration?.active === true;
      const wouldDropConcentration = aoeAction.requiresConcentration && alreadyConcentrating;
      if (!wouldDropConcentration) {
        const cluster = findBestAoECluster(self, battlefield, 15); // 15ft radius default
        if (cluster && canReach(self, { pos: cluster.center } as Combatant, aoeAction)) {
          return {
            type: 'cast',
            action: aoeAction,
            targetId: null, // AoE targets a position
            description: `${self.name} uses ${aoeAction.name} hitting ${cluster.enemies.length} enemies`,
          };
        }
      }
    }
  }

  // --- 3. Multiattack if in reach ---
  const multi = getMultiattack(self);
  if (multi && inMeleeReach) {
    return {
      type: 'attack',
      action: multi,
      targetId: target.id,
      description: `${self.name} uses Multiattack on ${target.name}`,
    };
  }

  // --- 4. Best single attack if in reach ---
  // bestAttackAction considers all attack types (melee, spell, save) so a leveled
  // save-based spell (e.g. Dissonant Whispers) may outperform a melee weapon.
  // Use 'cast' type for spell/save actions so executePlannedAction consumes the slot.
  if (inMeleeReach) {
    const attack = bestAttackAction(self, target, true);
    if (attack) {
      const actionType = (attack.attackType === 'save' || attack.attackType === 'spell')
        ? 'cast' : 'attack';
      return {
        type: actionType,
        action: attack,
        targetId: target.id,
        description: actionType === 'cast'
          ? `${self.name} uses ${attack.name} on ${target.name}`
          : `${self.name} attacks ${target.name} with ${attack.name}`,
      };
    }
  }

  // --- 5. Ranged attack if target reachable ---
  if (hasRangedReach) {
    // Pick the highest-expected-damage ranged/spell/save action in reach
    // (slotLevel > 0 spells are filtered out if no slots remain — checked in bestRangedAction)
    const rangedCandidates = self.actions.filter(
      a => a.costType === 'action' &&
        (a.attackType === 'ranged' || a.attackType === 'spell' || a.attackType === 'save') &&
        canReach(self, target, a) &&
        !(a.slotLevel && a.slotLevel > 0 && !hasSpellSlot(self))
    );
    const ranged = rangedCandidates.length > 0
      ? rangedCandidates.reduce((best, a) => {
          const scoreA = a.hitBonus !== null
            ? expectedDamage(a.hitBonus, a.damage, target.ac)
            : (a.damage?.average ?? 0); // auto-hit / save-based: use raw average
          const scoreBest = best.hitBonus !== null
            ? expectedDamage(best.hitBonus, best.damage, target.ac)
            : (best.damage?.average ?? 0);
          return scoreA > scoreBest ? a : best;
        })
      : null;
    if (ranged) {
      return {
        type: ranged.attackType === 'save' ? 'cast' : 'attack',
        action: ranged,
        targetId: target.id,
        description: `${self.name} uses ${ranged.name} on ${target.name}`,
      };
    }
  }

  // --- 6. Improvised / unarmed fallback — if adjacent and no stat-block action worked ---
  // PHB p.195: unarmed strike (1 + STR mod). PHB p.148: improvised weapon (1d4 + STR mod, no prof).
  // Creatures with hands/tentacles prefer improvised weapon for slightly more damage.
  const adjacent = distanceFt(self.pos, target.pos) <= 5;
  if (adjacent) {
    if (self.hasHands) {
      const improv = makeImprovisedWeapon(self);
      return {
        type: 'attack',
        action: improv,
        targetId: target.id,
        description: `${self.name} attacks ${target.name} with an improvised weapon`,
      };
    }
    const unarmed = makeImprovisedUnarmed(self);
    return {
      type: 'attack',
      action: unarmed,
      targetId: target.id,
      description: `${self.name} makes an unarmed strike on ${target.name}`,
    };
  }

  // --- 7. DASH — close the gap ---
  return {
    type: 'dash',
    action: null,
    targetId: target.id,
    description: `${self.name} dashes toward ${target.name}`,
  };
}

// ---- Self-preserve check (Smart only) -----------------------

/**
 * Check if a smart creature should retreat this turn (§5.3.4).
 * Returns 'retreat', 'dodge', or null (no self-preserve needed).
 */
export function selfPreserveDecision(
  self: Combatant,
  battlefield: Battlefield
): 'retreat' | 'dodge' | null {
  const pct = self.currentHP / self.maxHP;
  const adjEnemies = adjacentEnemyCount(self, battlefield);

  // Below 25% HP → try to escape
  if (pct < 0.25) {
    return adjEnemies >= 3 && !self.actions.some(a => a.isAoE) ? 'dodge' : 'retreat';
  }

  // Heavily outnumbered with no AoE → dodge
  if (adjEnemies >= 3 && !self.actions.some(a => a.isAoE)) {
    return 'dodge';
  }

  return null;
}

// ---- Legendary action selector (Smart) ----------------------

/**
 * Pick the best legendary action to spend at end of an enemy's turn.
 * Design doc §5.3.5.
 */
export function selectLegendaryAction(
  self: Combatant,
  target: Combatant | null
): import('../types/core').LegendaryAction | null {
  if (self.legendaryActionPool <= 0) return null;
  if (self.legendaryActions.length === 0) return null;

  let best: import('../types/core').LegendaryAction | null = null;
  let bestValue = -Infinity;

  for (const la of self.legendaryActions) {
    if (la.cost > self.legendaryActionPool) continue;
    if (!la.action) continue;

    let value = 0;
    if (la.action.isControl) {
      value = 50 / la.cost;
    } else if (la.action.damage && target) {
      value = expectedDamage(la.action.hitBonus, la.action.damage, target.ac) / la.cost;
    } else if (!la.action.damage) {
      value = 10 / la.cost; // detect/move type — low priority
    }

    if (value > bestValue) {
      bestValue = value;
      best = la;
    }
  }

  return best;
}
