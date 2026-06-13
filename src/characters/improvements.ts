// ============================================================
// improvements.ts — Post-level-up character progression
// D&D 5e Combat Sim — PHB 2014 / SAC v2.7
//
// Pure functions (no I/O, no mutation of input).
// Called after applyLevelUp when player resolves pending choices.
//
// ASI rules (PHB p.165):
//   - Each ASI grants +2 ability score points (allocatable freely
//     as +2 to one ability or +1 to two different abilities)
//   - Individual ability scores cannot exceed 20 via ASI
//   - applyLevelUp sets pendingAbilityScoreImprovements += 1 per
//     eligible level; applyASI decrements it on success
//
// Subclass rules (PHB):
//   - Triggered at class-specific levels (e.g. Fighter 3, Wizard 2)
//   - Stored in sheet.subclassChoices[className]
//   - applyLevelUp sets subclassPrompt; caller must call chooseSubclass
// ============================================================

import { CharacterSheet, ClassName } from './types';

// Valid ability score keys
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
type AbilityKey = typeof ABILITY_KEYS[number];

function isAbilityKey(v: unknown): v is AbilityKey {
  return ABILITY_KEYS.includes(v as AbilityKey);
}

// ============================================================
// applyASI
// ============================================================

/**
 * Apply one Ability Score Improvement choice to a character sheet.
 *
 * Rules enforced:
 *   - Sheet must have pendingAbilityScoreImprovements >= 1
 *   - ability must be one of str/dex/con/int/wis/cha
 *   - amount must be 1 or 2
 *   - Neither (stats[ability] + amount) can exceed 20 (PHB p.165)
 *   - A single applyASI call can raise one score by 1 or 2.
 *     To raise two different scores by +1 each, call applyASI twice
 *     with amount=1 for each — the second call consumes a second
 *     pending slot. To spend one ASI on two scores (+1/+1), the
 *     caller should call applyASIDouble (see below) or call
 *     applyASI twice; pendingAbilityScoreImprovements is halved
 *     for half-point allocations via applyASIDouble.
 *
 *   Simple model used here:
 *     - amount=2 → full ASI used, pending -= 1
 *     - amount=1 → half ASI used, pendingHalf += 1 (tracked internally)
 *       When pendingHalf reaches 2, pending -= 1 and pendingHalf resets
 *
 * This handles both "+2 to one ability" and "+1/+1 split" correctly.
 *
 * @param sheet  Current character sheet
 * @param ability  Ability score to increase
 * @param amount  1 or 2
 * @returns Updated sheet (new object, no mutation)
 * @throws Error if validation fails
 */
export function applyASI(
  sheet: CharacterSheet,
  ability: string,
  amount: number,
): CharacterSheet {
  // Validate ability key
  if (!isAbilityKey(ability)) {
    throw new Error(
      `Invalid ability "${ability}". Must be one of: ${ABILITY_KEYS.join(', ')}.`
    );
  }

  // Validate amount
  if (amount !== 1 && amount !== 2) {
    throw new Error(`amount must be 1 or 2, got ${amount}.`);
  }

  // Check pending ASI availability
  const pending    = sheet.pendingAbilityScoreImprovements ?? 0;
  const halfPoints = sheet.pendingASIHalfPoints ?? 0;

  // Total half-points available: pending * 2 + halfPoints
  const totalHalf = pending * 2 + halfPoints;
  if (totalHalf < amount) {
    throw new Error(
      `No pending Ability Score Improvement available. ` +
      `pendingAbilityScoreImprovements=${pending}, pendingASIHalfPoints=${halfPoints}.`
    );
  }

  // Check score cap (PHB p.165)
  const currentScore = sheet.stats[ability as AbilityKey];
  if (currentScore + amount > 20) {
    throw new Error(
      `Cannot raise ${ability} above 20. ` +
      `Current score: ${currentScore}, requested increase: ${amount}.`
    );
  }

  // Apply to both baseStats and stats (racial bonus remains constant)
  const newStats    = { ...sheet.stats,     [ability]: currentScore + amount };
  const newBase     = { ...sheet.baseStats, [ability]: sheet.baseStats[ability as AbilityKey] + amount };

  // Consume half-points
  const newTotalHalf = totalHalf - amount;
  const newPending   = Math.floor(newTotalHalf / 2);
  const newHalf      = newTotalHalf % 2;

  const result: CharacterSheet = {
    ...sheet,
    stats:    newStats,
    baseStats: newBase,
    pendingAbilityScoreImprovements: newPending,
    pendingASIHalfPoints: newHalf,
    updatedAt: new Date().toISOString(),
  };

  return result;
}


// ============================================================
// chooseSubclass
// ============================================================

/**
 * Record a subclass selection for a character.
 *
 * Rules enforced:
 *   - className must be present in sheet.classLevels
 *   - subclassChoices[className] must not already be set (no re-picking)
 *   - subclassName must be a non-empty string
 *
 * @param sheet         Current character sheet
 * @param className     Class for which the subclass is being chosen
 * @param subclassName  Chosen subclass (e.g. "Champion", "Evocation")
 * @returns Updated sheet (new object, no mutation)
 * @throws Error if validation fails
 */
export function chooseSubclass(
  sheet: CharacterSheet,
  className: string,
  subclassName: string,
): CharacterSheet {
  // Validate className in classLevels
  const hasClass = sheet.classLevels.some(cl => cl.className === className);
  if (!hasClass) {
    const known = sheet.classLevels.map(cl => cl.className).join(', ');
    throw new Error(
      `Character does not have class "${className}". ` +
      `Known classes: ${known || '(none)'}.`
    );
  }

  // Validate subclassName
  if (!subclassName || typeof subclassName !== 'string' || subclassName.trim() === '') {
    throw new Error('subclassName must be a non-empty string.');
  }

  // Prevent overwriting an existing choice
  if (sheet.subclassChoices[className]) {
    throw new Error(
      `Subclass for "${className}" is already set to ` +
      `"${sheet.subclassChoices[className]}". Cannot change once chosen.`
    );
  }

  return {
    ...sheet,
    subclassChoices: {
      ...sheet.subclassChoices,
      [className]: subclassName.trim(),
    },
    updatedAt: new Date().toISOString(),
  };
}
