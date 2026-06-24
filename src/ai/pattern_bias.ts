// ============================================================
// Pattern Bias AI — Situation-Aware Spell-Selection Weighting
// RFC: docs/RFC-PATTERN-BIAS-AI.md
//
// Module: src/ai/pattern_bias.ts
//
// Implements the 8 pattern detectors that feed multipliers into
// computeSpellWeight(). Each is a pure function that takes context +
// candidate spell info and returns a multiplier in [0.0, 3.0].
// Default (no pattern match) = 1.0 (neutral — passes through).
//
// The composition formula: composeBiases(biases) multiplies all
// biases together; any 0.0 collapses to 0 (veto). Final result is
// clamped to [0.1, 10.0].
//
// Phase 1 (this module):
//   - All 8 pattern detectors as pure functions.
//   - composeBiases() helper.
//   - estimateConcentrationValue() 12-entry lookup table.
//   - Wired into monster_spellcasting.ts computeSpellWeight().
//
// Phase 2 (DEFERRED): AC-vs-Save targeting with real savingThrows map.
// Phase 3 (DEFERRED): Concentration churn tracking (_lastConcentrationSwapTurn).
// Phase 4 (DEFERRED): Kiting + defensive escape planner wiring.
// Phase 5 (DEFERRED): PC conservation factor.
// ============================================================

import { Combatant, Battlefield, AbilityScore } from '../types/core';
import { SpellTag, SpellcastContext } from './monster_spellcasting';
import { findBestAoECluster } from './actions';
import { livingAlliesOf, livingEnemiesOf, adjacentEnemyCount } from '../engine/movement';
import { abilityMod } from '../engine/utils';

// ---- Composition Formula ------------------------------------

/**
 * Compose multiple bias multipliers into a single factor.
 *
 * Rules:
 *   - Any 0.0 → result is 0 (veto wins).
 *   - Multiply all non-zero biases together.
 *   - Clamp to [0.1, 10.0] to prevent runaway.
 */
export function composeBiases(biases: number[]): number {
  for (const b of biases) {
    if (b === 0) return 0;
  }
  const product = biases.reduce((acc, b) => acc * b, 1);
  return Math.max(0.1, Math.min(10.0, product));
}

// ---- Pattern Detector 1: enemyClusterBias -------------------

/**
 * Boost AoE/damage/cc spells when >=2 enemies are clustered within a
 * typical spell radius. Per the user's directive: "'enemies are grouped'
 * would have higher 'bias' bonus than 'target almost dead'" — this bias
 * caps at 2.5 (vs finisher's 1.3).
 *
 * Uses findBestAoECluster() from src/ai/actions.ts — no duplication.
 *
 * Only boosts spells with 'damage' or 'cc' tag.
 */
export function enemyClusterBias(
  _ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
  spellRadiusFt: number,
): number {
  if (!spellTags.includes('damage') && !spellTags.includes('cc')) return 1.0;
  const cluster = findBestAoECluster(self, bf, spellRadiusFt, 2);
  if (!cluster) return 1.0;
  if (cluster.enemies.length >= 4) return 2.5;
  if (cluster.enemies.length === 3) return 2.0;
  return 1.6;  // exactly 2
}

// ---- Pattern Detector 2: finisherBias -----------------------

/**
 * Boost spells that can kill the target this turn. Lower magnitude than
 * enemyClusterBias (1.3 vs 2.5) per the user's explicit ranking.
 */
export function finisherBias(
  _ctx: SpellcastContext,
  _bf: Battlefield,
  _self: Combatant,
  target: Combatant,
  avgDmg: number,
): number {
  if (target.currentHP <= avgDmg * 1.5) return 1.3;
  return 1.0;
}

// ---- Pattern Detector 3: woundedAllyBias --------------------

/**
 * Boost healing/defending spells when a "strong" ally (maxHP >= 25)
 * is bloodied (< 50% HP). Downed allies trigger max boost (2.5).
 */
export function woundedAllyBias(
  _ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
): number {
  if (!spellTags.includes('healing') && !spellTags.includes('defending')) return 1.0;

  const STRONG_ALLY_MIN_HP = 25;
  let bestBoost = 1.0;

  for (const ally of livingAlliesOf(self, bf)) {
    if (ally.id === self.id) continue;
    if (ally.maxHP < STRONG_ALLY_MIN_HP) continue;
    if (ally.isUnconscious && !ally.isDead) {
      bestBoost = Math.max(bestBoost, 2.5);  // revive the downed
    } else if (ally.currentHP < ally.maxHP * 0.5) {
      bestBoost = Math.max(bestBoost, 1.8);  // heal the bloodied
    }
  }

  // Also check downed allies (they are NOT in livingAlliesOf since
  // they are unconscious, but they ARE valid healing targets).
  for (const c of bf.combatants.values()) {
    if (c.id === self.id) continue;
    if (c.faction !== self.faction) continue;
    if (c.isDead) continue;
    if (!c.isUnconscious) continue;  // already handled above
    if (c.maxHP < STRONG_ALLY_MIN_HP) continue;
    bestBoost = Math.max(bestBoost, 2.5);  // revive the downed
  }

  return bestBoost;
}

// ---- Pattern Detector 4: acVsSaveBias -----------------------

/**
 * Compare the spell's targeting axis (attack-roll vs save) to the
 * target's weakest defense. Two sub-cases per the user's directive:
 *
 * (a) Attack-roll spell vs low-AC target → boost.
 * (b) Save spell: half-on-save vs high-save → still favored (1.1);
 *     save-or-suck vs high-save → penalised (0.6).
 *
 * Phase 1: target save bonus approximated from ability modifier only.
 * Phase 2: will use Combatant.savingThrows map when available.
 */
export function acVsSaveBias(
  _ctx: SpellcastContext,
  _bf: Battlefield,
  _self: Combatant,
  target: Combatant,
  spell: { attackRoll: boolean; saveAbility?: AbilityScore; dealsHalfOnSave?: boolean },
): number {
  // (a) Attack-roll spell vs low-AC / high-save target
  if (spell.attackRoll) {
    if (target.ac <= 14) {
      const saveBonus = spell.saveAbility
        ? abilityMod(target[spell.saveAbility])
        : 0;
      if (saveBonus >= 5) return 1.4;
      return 1.2;  // low AC alone is still good
    }
    if (target.ac >= 19) return 0.7;  // hard to hit
    return 1.0;
  }
  // (b) Save spell
  if (spell.saveAbility) {
    const saveBonus = abilityMod(target[spell.saveAbility]);
    if (saveBonus >= 5) {
      return spell.dealsHalfOnSave ? 1.1 : 0.6;
    }
    if (saveBonus <= 0) return 1.3;  // easy save target
    return 1.0;
  }
  return 1.0;
}

// ---- Pattern Detector 5: concentrationPreservationBias ------

/**
 * Concentration value lookup table (12 most common monster concentration
 * spells). Returns a rough "power score" (1–10) for the currently-held
 * concentration spell in the current context.
 *
 * Context axes: single-target, multi-enemy (3+), wounded-ally, enemy-cluster.
 * For simplicity Phase 1 uses a single estimate per spell; Phase 3 will
 * add context-sensitivity via the decision matrix in §5.3.
 */
const CONCENTRATION_VALUE_TABLE: Record<string, number> = {
  'Bless': 2.5,
  'Bane': 2.5,
  'Hold Person': 4.5,
  'Hold Monster': 4.5,
  'Haste': 3.5,
  'Barkskin': 1.5,
  'Blur': 2.0,
  'Web': 3.5,
  'Spirit Guardians': 4.5,
  'Hunger of Hadar': 3.5,
  'Suggestion': 2.0,
  'Hex': 2.0,
  'Darkness': 2.5,
  'Faerie Fire': 3.0,
  'Shield of Faith': 2.0,
  'Flaming Sphere': 2.5,
  'Call Lightning': 3.0,
  'Spiritual Weapon': 2.5,
};

/**
 * Estimate the value of a concentration spell. Returns the table value
 * or a floor of 1.5 for unknown spells (conservative — encourages
 * keeping them, per the "preserve concentration" directive).
 */
export function estimateConcentrationValue(spellName: string): number {
  return CONCENTRATION_VALUE_TABLE[spellName] ?? 1.5;
}

/**
 * Penalise casting a concentration spell when already concentrating —
 * UNLESS the new spell is significantly higher-value than the current
 * concentration spell (situation-merits-swap override).
 *
 * Returns 0.0 (veto) for churn-within-2-turns swaps that aren't
 * overridden; 0.5 for mild churn; 1.0 for neutral (not concentrating,
 * or candidate isn't concentration); never exceeds 1.0.
 *
 * Phase 1: reads _lastConcentrationSwapTurn if present (optional
 * scratch field). When undefined, treats as "never swapped" (no penalty).
 */
export function concentrationPreservationBias(
  ctx: SpellcastContext,
  _bf: Battlefield,
  self: Combatant,
  candidateIsConcentration: boolean,
  candidateValueEstimate: number,
): number {
  if (!candidateIsConcentration) return 1.0;
  if (!self.concentration?.active) return 1.0;

  // Currently concentrating. Compare new spell's value to the existing one.
  const currentSpellName = self.concentration.spellName ?? '';
  const currentValue = estimateConcentrationValue(currentSpellName);
  const swapMerit = candidateValueEstimate - currentValue;

  // Churn penalty: scales with how recently we last swapped.
  // _lastConcentrationSwapTurn is an optional scratch field — when
  // undefined, treat as "never swapped" (fully decayed).
  const lastSwap = (self as unknown as Record<string, unknown>)._lastConcentrationSwapTurn as number | undefined;
  const turnsSinceSwap = lastSwap !== undefined ? ctx.round - lastSwap : Infinity;

  let churnPenalty = 1.0;
  if (turnsSinceSwap <= 1) churnPenalty = 0.0;    // swapped last turn — hard veto
  else if (turnsSinceSwap <= 2) churnPenalty = 0.5;
  else if (turnsSinceSwap <= 3) churnPenalty = 0.8;

  // High-value situation overrides churn.
  if (swapMerit >= 3.0) return 1.0;              // clearly better
  if (swapMerit >= 1.5) return Math.max(churnPenalty, 0.7);  // somewhat better
  return churnPenalty;
}

// ---- Pattern Detector 6: kitingBias -------------------------

/**
 * Boost mobility/defending spells when self is a ranged caster and the
 * nearest enemies are melee-only and slower. Encourages Misty Step /
 * Dimension Door to maintain distance and pick enemies apart.
 *
 * Detection:
 *   - self has any ranged/spell action (ranged-capable)
 *   - no enemy adjacent (we have distance to keep)
 *   - majority of enemies have only melee actions
 *   - majority of enemies have speed <= self.speed
 *
 * Only boosts spells with the 'defending' tag.
 */
export function kitingBias(
  ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
): number {
  if (!spellTags.includes('defending')) return 1.0;
  if (ctx.nearestEnemyDistFt <= 10) return 1.0;  // too close — kiting not safe

  const selfIsRanged = self.actions.some(
    a => a.attackType === 'ranged' || a.attackType === 'spell' || a.attackType === 'save',
  );
  if (!selfIsRanged) return 1.0;

  const enemies = livingEnemiesOf(self, bf);
  if (enemies.length === 0) return 1.0;

  const meleeOnlyCount = enemies.filter(
    e => !e.actions.some(a => a.attackType === 'ranged' || a.attackType === 'spell'),
  ).length;
  const slowerCount = enemies.filter(e => e.speed <= self.speed).length;

  if (meleeOnlyCount / enemies.length >= 0.5
      && slowerCount / enemies.length >= 0.5) {
    return 1.8;  // kite opportunity
  }
  return 1.0;
}

// ---- Pattern Detector 7: defensiveEscapeBias ----------------

/**
 * Boost teleport/escape spells when self HP < 30% AND an adjacent
 * enemy threatens. Encourages Misty Step / Dimension Door to break
 * engagement and reach a safe square.
 *
 * Stacks with woundedAllyBias and kitingBias. The composition cap
 * [0.1, 10.0] keeps the combined multiplier bounded.
 */
export function defensiveEscapeBias(
  ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  spellTags: SpellTag[],
): number {
  if (!spellTags.includes('defending')) return 1.0;
  if (ctx.selfHPct >= 0.30) return 1.0;
  const adj = adjacentEnemyCount(self, bf);
  if (adj === 0) return 1.0;
  return adj >= 2 ? 2.5 : 1.8;
}

// ---- Pattern Detector 8: resourceAllOutBias -----------------

/**
 * Monsters: NEVER penalise daily-use or high-slot spells for conservation.
 * The user directive is explicit — monsters go all out, fights are to the
 * death, monster parties are always rested on spawn.
 *
 * PCs: mild conservation factor for high-slot spells (Phase 5, not yet
 * implemented). For now returns 1.0 for everyone.
 */
export function resourceAllOutBias(
  _ctx: SpellcastContext,
  _bf: Battlefield,
  self: Combatant,
  _spellLevel: number,
): number {
  if (self.faction === 'enemy') return 1.0;  // all-out — no penalty
  // Phase 5 (PC conservation): return < 1.0 for high-slot spells in easy fights.
  return 1.0;
}

// ---- Bias Collection Helper ---------------------------------

/**
 * Collect all applicable biases for a cantrip candidate.
 * Returns an array of multipliers to be passed to composeBiases().
 *
 * This is the Phase 1 wiring point: called from selectMonsterSpell()
 * after computing the base weight, feeding the biases into
 * computeSpellWeight() via the new `biases` parameter.
 */
export function collectCantripBiases(
  ctx: SpellcastContext,
  bf: Battlefield,
  self: Combatant,
  target: Combatant,
  spellTags: SpellTag[],
  avgDmg: number,
  attackRoll: boolean,
  saveAbility: AbilityScore | undefined,
): number[] {
  const biases: number[] = [];

  // 1. Enemy cluster (highest priority per user)
  biases.push(enemyClusterBias(ctx, bf, self, spellTags, 15));  // default 15ft radius for cantrips

  // 2. Finisher (lower than cluster per user)
  biases.push(finisherBias(ctx, bf, self, target, avgDmg));

  // 3. Wounded ally
  biases.push(woundedAllyBias(ctx, bf, self, spellTags));

  // 4. AC vs Save targeting
  biases.push(acVsSaveBias(ctx, bf, self, target, {
    attackRoll,
    saveAbility,
    dealsHalfOnSave: false,  // cantrips don't deal half on save
  }));

  // 5. Concentration preservation (cantrips are never concentration,
  //    so this always returns 1.0 — included for forward-compat)
  biases.push(concentrationPreservationBias(ctx, bf, self, false, 0));

  // 6. Kiting (only for defending-tag spells)
  biases.push(kitingBias(ctx, bf, self, spellTags));

  // 7. Defensive escape (only for defending-tag spells)
  biases.push(defensiveEscapeBias(ctx, bf, self, spellTags));

  // 8. Resource all-out (monsters go all out)
  biases.push(resourceAllOutBias(ctx, bf, self, 0));

  return biases;
}
