// ============================================================
// Target Selection
// Used by all three AI profiles (attackNearest, attackWeakest, smart).
// All scoring is bounded by perception — no psychic knowledge.
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { chebyshev3D, livingEnemiesOf } from '../engine/movement';
import { isBloodied, abilityMod } from '../engine/utils';

// ---- Estimated AC from observed armor -----------------------

/**
 * Estimate a target's AC from observed armor type (TargetKnowledge).
 * Used when exact AC is not known (it always is for the engine internally,
 * but the AI should only use what the perception model allows).
 *
 * In a full implementation, monsters only use perceived armor.
 * For now the engine passes actual AC — the perception layer is the gating point.
 */
export function estimatedAC(armorType: 'none' | 'light' | 'medium' | 'heavy' | 'natural'): number {
  switch (armorType) {
    case 'none':    return 10;
    case 'light':   return 13;
    case 'medium':  return 15;
    case 'heavy':   return 17;
    case 'natural': return 14;
  }
}

// ---- Profile: ATTACK NEAREST --------------------------------

/**
 * Select the nearest living enemy.
 * Ties broken by lower index in combatant map (stable).
 */
export function selectNearest(self: Combatant, battlefield: Battlefield): Combatant | null {
  const enemies = livingEnemiesOf(self, battlefield);
  if (enemies.length === 0) return null;

  return enemies.reduce((best, e) => {
    const distBest = chebyshev3D(self.pos, best.pos);
    const distE    = chebyshev3D(self.pos, e.pos);
    return distE < distBest ? e : best;
  });
}

// ---- Profile: ATTACK WEAKEST --------------------------------

/**
 * Score function for attackWeakest.
 * Priorities: bloodied > low AC > closer.
 * Design doc §5.2.
 */
export function weakestScore(self: Combatant, enemy: Combatant): number {
  const knowledge = self.perception.targets.get(enemy.id);

  let score = 0;

  // Bloodied is the strongest signal — enemy near death
  if (knowledge?.isBloodied ?? isBloodied(enemy)) score += 100;

  // Low perceived AC → more reliable hits
  const armorType = knowledge?.visibleArmorType ?? 'none';
  const estAC = estimatedAC(armorType);
  if (estAC < 13) score += 30;

  // Slight preference for closer targets (less movement spent)
  const dist = chebyshev3D(self.pos, enemy.pos) * 5;
  score -= dist * 0.5;

  return score;
}

export function selectWeakest(self: Combatant, battlefield: Battlefield): Combatant | null {
  const enemies = livingEnemiesOf(self, battlefield);
  if (enemies.length === 0) return null;

  return enemies.reduce((best, e) =>
    weakestScore(self, e) > weakestScore(self, best) ? e : best
  );
}

// ---- Profile: SMART -----------------------------------------

/**
 * Full threat-weighted scoring from design doc §5.3.1.
 * Bounded by perception — no psychic knowledge.
 */
export function smartScore(self: Combatant, enemy: Combatant, battlefield: Battlefield): number {
  const knowledge = self.perception.targets.get(enemy.id);
  let score = 0;

  // === PERCEIVED THREAT ===

  // Healer: can undo kills — high priority
  if (knowledge?.receivedHealingThisCombat) score += 80;

  // AoE caster: high action economy threat
  if (knowledge?.castAoEThisCombat) score += 70;

  // Concentrating caster: hitting forces a CON save to break their ongoing spell.
  // Observable proxy: castAoEThisCombat = witnessed a spell cast (V/S components visible).
  // Non-psychic constraint: we do NOT know for certain they are concentrating.
  // This bonus stacks deliberately — a concentrating AoE caster is the top priority.
  if (knowledge?.castAoEThisCombat && !enemy.conditions.has('incapacitated')) {
    score += 50;
  }

  // Bloodied: finish it off — guarantees an action economy gain
  if (knowledge?.isBloodied ?? isBloodied(enemy)) score += 60;

  // Ranged attacker engaging a melee-only creature: hard to punish
  if ((knowledge?.isRanged ?? false) && !self.actions.some(a => a.attackType === 'ranged')) {
    score += 40;
  }

  // Low visible AC → more reliable damage
  const armorType = knowledge?.visibleArmorType ?? 'none';
  score += Math.max(0, 17 - estimatedAC(armorType)) * 3;

  // === TACTICAL OPPORTUNITY ===

  // Flying enemy in melee reach: rare window to ground them
  if ((knowledge?.isFlying ?? false) && chebyshev3D(self.pos, enemy.pos) <= 1) score += 30;

  // Isolated enemy (no allies adjacent): easier focus
  let alliesAdj = 0;
  for (const [, c] of battlefield.combatants) {
    if (c.faction === enemy.faction && c.id !== enemy.id && !c.isDead) {
      if (chebyshev3D(c.pos, enemy.pos) <= 1) alliesAdj++;
    }
  }
  if (alliesAdj === 0) score += 25;

  // === RISK / DISTANCE ===
  const distFt = chebyshev3D(self.pos, enemy.pos) * 5;
  score -= distFt * 0.5;

  return score;
}

export function selectSmart(self: Combatant, battlefield: Battlefield): Combatant | null {
  const enemies = livingEnemiesOf(self, battlefield);
  if (enemies.length === 0) return null;

  return enemies.reduce((best, e) =>
    smartScore(self, e, battlefield) > smartScore(self, best, battlefield) ? e : best
  );
}

// ---- Unified entry point ------------------------------------

/** Select a target using the combatant's configured AI profile. */
export function selectTarget(self: Combatant, battlefield: Battlefield): Combatant | null {
  switch (self.aiProfile) {
    case 'attackNearest': return selectNearest(self, battlefield);
    case 'attackWeakest': return selectWeakest(self, battlefield);
    case 'smart':         return selectSmart(self, battlefield);
    case 'defend':        return selectNearest(self, battlefield); // planner gates actual pursuit
  }
}
