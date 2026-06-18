// ============================================================
// stat_optimizer.ts — Standard Array Assignment Optimizer
//
// Source: PHB 2014 class mechanics
// Scope: pre-2024 canonical content only
//
// ALGORITHM (rearrangement inequality):
//   Assign standard array values to ability scores such that the
//   highest value goes to the highest-priority stat for the class.
//   Racial ASI is additive and does not change the optimal base
//   assignment — it only shifts effective scores after allocation.
//
//   For flexible-ASI races (no defaultASI), the allotment amounts
//   are placed on the highest-priority stats in descending order.
// ============================================================

import { ClassName, CharacterAbilityScores } from './types';
import { RaceEntry } from './race_data';

export type AbilityKey = keyof CharacterAbilityScores;

/** The standard 5e ability score array from PHB 2014 p.13. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

// ── Class Stat Priority LUT ────────────────────────────────────
// Each entry lists all 6 ability keys in priority order for the class,
// from most important to least important. Based on PHB 2014 class
// mechanics. Melee-default is assumed for ambiguous classes.
//
// Barbarian: STR (attack), CON (survivability + Unarmored Defense), DEX (AC bonus)
// Bard:      CHA (spellcasting), DEX (light armor), CON (concentration)
// Cleric:    WIS (spellcasting), CON (survivability), STR (melee default)
// Druid:     WIS (spellcasting), CON (survivability), DEX (medium armor max-2 still useful)
// Fighter:   STR (melee default), CON (survivability), DEX (Initiative + some saves)
// Monk:      DEX (AC + attack), WIS (Unarmored Defense + saves), CON (survivability)
// Paladin:   STR (attack), CHA (smite saves aura + spellcasting), CON (survivability)
// Ranger:    DEX (finesse/ranged default), WIS (spellcasting), CON (survivability)
// Rogue:     DEX (attack + light armor + Initiative), CON (survivability), INT (Arcane Trickster/checks)
// Sorcerer:  CHA (spellcasting), CON (concentration + survivability), DEX (light armor)
// Warlock:   CHA (spellcasting), CON (concentration + survivability), DEX (light armor)
// Wizard:    INT (spellcasting), CON (concentration + survivability), DEX (light armor + Initiative)
export const CLASS_STAT_PRIORITY: Record<ClassName, AbilityKey[]> = {
  Barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
  Bard:      ['cha', 'dex', 'con', 'wis', 'int', 'str'],
  Cleric:    ['wis', 'con', 'str', 'dex', 'cha', 'int'],
  Druid:     ['wis', 'con', 'dex', 'int', 'cha', 'str'],
  Fighter:   ['str', 'con', 'dex', 'wis', 'int', 'cha'],
  Monk:      ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  Paladin:   ['str', 'cha', 'con', 'dex', 'wis', 'int'],
  Ranger:    ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  Rogue:     ['dex', 'con', 'int', 'wis', 'cha', 'str'],
  Sorcerer:  ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  Warlock:   ['cha', 'con', 'dex', 'wis', 'int', 'str'],
  Wizard:    ['int', 'con', 'dex', 'wis', 'cha', 'str'],
};

export interface StatOptimizerResult {
  race: string;
  /** Class name. */
  class: string;
  /** The fixed standard array values (always [15,14,13,12,10,8]). */
  standardArray: readonly number[];
  /** Class stat priority from highest to lowest. */
  priorityOrder: AbilityKey[];
  /** Recommended base scores (before racial ASI). */
  baseScores: CharacterAbilityScores;
  /**
   * For flexible-ASI races (no defaultASI): suggested asiAssignment to pass to
   * create-level0. For fixed-ASI races: empty object (defaultASI applies automatically).
   */
  suggestedAsiAssignment: Partial<CharacterAbilityScores>;
  /** Effective racial ASI that will be applied (either defaultASI or suggestedAsiAssignment). */
  racialASI: Partial<CharacterAbilityScores>;
  /** Final effective scores = baseScores + racialASI. */
  finalScores: CharacterAbilityScores;
  /**
   * True when the race has no defaultASI and the player must provide asiAssignment.
   * The suggestedAsiAssignment field gives the recommended placement.
   */
  isFlexibleASI: boolean;
}

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * Compute the optimal standard-array assignment (and suggested flexible ASI
 * placement) for the given class + race combination.
 */
export function computeStatRecommendation(
  className: ClassName,
  raceEntry: RaceEntry,
): StatOptimizerResult {
  const priorityOrder = CLASS_STAT_PRIORITY[className];

  // Standard array sorted descending (already sorted, but explicit for clarity)
  const sortedArray = [...STANDARD_ARRAY].sort((a, b) => b - a);

  // Assign standard array to stats by priority (rearrangement inequality)
  const baseScores: CharacterAbilityScores = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  for (let i = 0; i < 6; i++) {
    baseScores[priorityOrder[i]] = sortedArray[i];
  }

  // Resolve racial ASI
  let racialASI: Partial<CharacterAbilityScores>;
  let suggestedAsiAssignment: Partial<CharacterAbilityScores>;
  const isFlexibleASI = !raceEntry.defaultASI;

  if (raceEntry.defaultASI) {
    // Fixed ASI — use defaultASI directly
    racialASI = { ...raceEntry.defaultASI };
    suggestedAsiAssignment = {};
  } else {
    // Flexible ASI — place allotment amounts on highest-priority stats
    // Sort allotment descending so the largest bonus goes to rank-1 stat
    const sortedAllotment = [...raceEntry.allotment].sort((a, b) => b - a);
    const suggested: Partial<CharacterAbilityScores> = {};
    for (let i = 0; i < sortedAllotment.length && i < 6; i++) {
      const stat = priorityOrder[i];
      suggested[stat] = (suggested[stat] ?? 0) + sortedAllotment[i];
    }
    suggestedAsiAssignment = suggested;
    racialASI = { ...suggested };
  }

  // Compute final scores (capped at 30, though standard array + racial bonuses
  // never reach 20 at Level 0)
  const finalScores: CharacterAbilityScores = { ...baseScores };
  for (const ab of ABILITIES) {
    const bonus = (racialASI as Record<string, number>)[ab] ?? 0;
    finalScores[ab] = Math.min(30, baseScores[ab] + bonus);
  }

  return {
    race: raceEntry.name,
    class: className,
    standardArray: STANDARD_ARRAY,
    priorityOrder,
    baseScores,
    suggestedAsiAssignment,
    racialASI,
    finalScores,
    isFlexibleASI,
  };
}
