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

import { CharacterSheet, ClassName, CharacterFeature, totalLevel } from './types';
import { getFeat } from './feat_data';
import { getMaxInvocationSlots } from './leveler';
import { ELDRITCH_INVOCATIONS } from '../spells/_invocations';

// Valid ability score keys
const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
type AbilityKey = typeof ABILITY_KEYS[number];

function isAbilityKey(v: unknown): v is AbilityKey {
  return ABILITY_KEYS.includes(v as AbilityKey);
}

// All 18 PHB 2014 skill names (mirrors the SkillName union in types.ts —
// kept as a runtime array here since unions aren't inspectable at runtime).
const SKILL_NAMES: string[] = [
  'Athletics', 'Acrobatics', 'Sleight of Hand', 'Stealth',
  'Arcana', 'History', 'Investigation', 'Nature', 'Religion',
  'Animal Handling', 'Insight', 'Medicine', 'Perception', 'Survival',
  'Deception', 'Intimidation', 'Performance', 'Persuasion',
];

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
// applyFeat
// ============================================================
//
// PHB p.165: "Instead of taking an Ability Score Improvement, you can
// forgo it to take the feat of your choice." A feat consumes exactly
// one FULL ASI (the same accounting as applyASI(ability, 2)) — it is
// never combined with a partial +1 split.
//
// Scope (see feat_data.ts header for the full rationale): this applies
// every sheet-computable PHB feat effect — ability score bumps,
// saving-throw/skill/tool/language/armor proficiencies, and Tough's HP
// bonus. Combat-only feat mechanics (Great Weapon Master, Sharpshooter,
// Polearm Master, Sentinel, etc.) have no sheet-side number to apply;
// the feat is still recorded with its full description so it's visible
// on the sheet, but its combat effect must be applied at the table or
// by Core Engine's combat resolution, not here.
//
// Known limitation: unlike a class-level push, taking a feat is not
// recorded in CharacterSheet.levelHistory, so popLevel() cannot reverse
// a feat choice. This mirrors the pre-existing behavior of chooseSubclass
// (also not stack-reversible) rather than introducing a new gap — full
// undo support would require extending LevelRecord to snapshot
// proficiencies/languages/feats, which is out of scope for this pass.
// ============================================================

export interface ApplyFeatChoices {
  /** Required only if the feat's abilityChoice offers more than one option. */
  abilityChoice?: string;
  /** Skilled: skill names chosen (validated against the 18 PHB skills). */
  skillChoices?: string[];
  /** Skilled: tool/instrument/gaming-set names chosen (freeform, not validated). */
  toolChoices?: string[];
  /** Linguist: language names chosen (freeform, not validated). */
  languageChoices?: string[];
}

/**
 * Apply a feat chosen instead of an Ability Score Improvement.
 *
 * @param sheet     Current character sheet
 * @param featName  Exact PHB feat name (see FEAT_NAMES in feat_data.ts)
 * @param choices   Resolves any feat-specific picks (ability/skills/tools/languages)
 * @returns Updated sheet (new object, no mutation)
 * @throws Error if validation fails
 */
export function applyFeat(
  sheet: CharacterSheet,
  featName: string,
  choices: ApplyFeatChoices = {},
): CharacterSheet {
  const feat = getFeat(featName);
  if (!feat) {
    throw new Error(`Unknown feat "${featName}". Must be one of the 42 PHB 2014 feats.`);
  }

  // Most feats can only be taken once. Elemental Adept (PHB p.166) is the sole
  // PHB exception — it can be selected multiple times, once per damage type —
  // but the sheet doesn't track which type was chosen, so we still allow a
  // repeat pick here rather than silently blocking a legal RAW choice.
  if (featName !== 'Elemental Adept' && (sheet.feats || []).includes(featName)) {
    throw new Error(`Character already has the "${featName}" feat.`);
  }

  // Consume one full ASI (2 half-points) — identical accounting to applyASI(ability, 2).
  const pending    = sheet.pendingAbilityScoreImprovements ?? 0;
  const halfPoints = sheet.pendingASIHalfPoints ?? 0;
  const totalHalf  = pending * 2 + halfPoints;
  if (totalHalf < 2) {
    throw new Error(
      `No pending Ability Score Improvement available to spend on a feat. ` +
      `pendingAbilityScoreImprovements=${pending}, pendingASIHalfPoints=${halfPoints}.`
    );
  }

  let newStats   = { ...sheet.stats };
  let newBase    = { ...sheet.baseStats };
  const newSavingThrows = [...sheet.proficiencies.savingThrows];
  const newSkills       = [...sheet.proficiencies.skills];
  const newTools        = [...sheet.proficiencies.tools];
  const newArmor        = [...sheet.proficiencies.armor];
  const newLanguages    = [...sheet.languages];
  let newMaxHP     = sheet.maxHP;
  let newCurrentHP = sheet.currentHP;

  // ---- Ability score increase --------------------------------
  let chosenAbility: AbilityKey | undefined;
  if (feat.abilityChoice) {
    const { options, amount } = feat.abilityChoice;
    if (options.length === 1) {
      chosenAbility = options[0] as AbilityKey;
    } else {
      if (!choices.abilityChoice || !isAbilityKey(choices.abilityChoice) ||
          !options.includes(choices.abilityChoice)) {
        throw new Error(
          `Feat "${featName}" requires an ability choice from: ${options.join(', ')}.`
        );
      }
      chosenAbility = choices.abilityChoice;
    }
    const current = newStats[chosenAbility];
    if (current + amount > 20) {
      throw new Error(
        `Cannot raise ${chosenAbility} above 20 via "${featName}" (current: ${current}).`
      );
    }
    newStats = { ...newStats, [chosenAbility]: current + amount };
    newBase  = { ...newBase,  [chosenAbility]: newBase[chosenAbility] + amount };
  }

  // ---- Saving throw proficiency (Resilient only) ---------------
  if (feat.savingThrowMatchesAbilityChoice && chosenAbility) {
    if (!newSavingThrows.includes(chosenAbility)) newSavingThrows.push(chosenAbility);
  }

  // ---- Skill / tool proficiencies (Skilled only) ----------------
  if (feat.skillOrToolChoiceCount) {
    const skills = choices.skillChoices ?? [];
    const tools  = choices.toolChoices  ?? [];
    const total  = skills.length + tools.length;
    if (total !== feat.skillOrToolChoiceCount) {
      throw new Error(
        `Feat "${featName}" requires exactly ${feat.skillOrToolChoiceCount} ` +
        `skill/tool choices combined (got ${total}).`
      );
    }
    for (const s of skills) {
      if (!SKILL_NAMES.includes(s)) {
        throw new Error(`"${s}" is not a valid PHB skill name.`);
      }
      if (!newSkills.includes(s as typeof newSkills[number])) {
        newSkills.push(s as typeof newSkills[number]);
      }
    }
    for (const t of tools) {
      if (!newTools.includes(t)) newTools.push(t);
    }
  }

  // ---- Languages (Linguist only) ---------------------------------
  if (feat.languageChoiceCount) {
    const langs = choices.languageChoices ?? [];
    if (langs.length !== feat.languageChoiceCount) {
      throw new Error(
        `Feat "${featName}" requires exactly ${feat.languageChoiceCount} language choices ` +
        `(got ${langs.length}).`
      );
    }
    for (const l of langs) {
      if (!newLanguages.includes(l)) newLanguages.push(l);
    }
  }

  // ---- Armor proficiency (Heavily/Moderately/Lightly Armored) ----
  if (feat.armorProficiencyGrant) {
    for (const a of feat.armorProficiencyGrant) {
      if (!newArmor.includes(a)) newArmor.push(a);
    }
  }

  // ---- HP (Tough only): +N x current total level, immediately ----
  if (feat.hpPerLevel) {
    const bonus = feat.hpPerLevel * totalLevel(sheet);
    newMaxHP     += bonus;
    newCurrentHP += bonus;
  }

  // ---- Consume the ASI slot --------------------------------------
  const newTotalHalf = totalHalf - 2;
  const newPending    = Math.floor(newTotalHalf / 2);
  const newHalf       = newTotalHalf % 2;

  const newFeature: CharacterFeature = {
    name:        feat.name,
    description: feat.description,
    source:      'feat',
  };

  const result: CharacterSheet = {
    ...sheet,
    stats:     newStats,
    baseStats: newBase,
    proficiencies: {
      ...sheet.proficiencies,
      savingThrows: newSavingThrows,
      skills:       newSkills,
      tools:        newTools,
      armor:        newArmor,
    },
    languages:  newLanguages,
    maxHP:      newMaxHP,
    currentHP:  newCurrentHP,
    feats:      [...(sheet.feats || []), featName],
    allFeatures: [...sheet.allFeatures, newFeature],
    pendingAbilityScoreImprovements: newPending,
    pendingASIHalfPoints:            newHalf,
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


// ============================================================
// chooseEldritchInvocations
// ============================================================
//
// PHB p.110: "At 2nd level, you gain two eldritch invocations of your
// choice. ... You learn one additional invocation at 5th, 7th, 9th,
// 12th, 15th, and 18th level."
//
// PHB p.110 also says: "Whenever you gain a warlock level, you can
// swap one invocation you know for another." For v1 we allow the full
// list to be replaced at any time (the player picks the entire list,
// not just swaps one). This matches the existing chooseSubclass
// pattern: the caller knows when the swap is allowed (on level-up),
// and the helper just validates the resulting list.
//
// Scope (v1): only the 4 EB-augmenting invocations from Sessions 38–39
// are in the registry:
//   - Repelling Blast   (push 10 ft)
//   - Agonizing Blast   (+CHA mod damage)
//   - Grasp of Hadar    (pull 10 ft)
//   - Lance of Lethargy (reduce speed 10 ft)
// Other invocations (Thirsting Blade, Eldritch Spear, etc.) are out of
// scope for v1 and will be rejected as unknown.
// ============================================================

/**
 * Set the character's Eldritch Invocations list (Warlock-only).
 *
 * Rules enforced:
 *   - sheet must have at least one Warlock class level
 *   - invocations.length must equal getMaxInvocationSlots(warlockLevel)
 *     (use the full list each call — partial lists are rejected so the
 *     sheet is always in a complete, runnable state)
 *   - each invocation name must be a key of ELDRITCH_INVOCATIONS
 *   - no duplicate invocation names
 *
 * @param sheet        Current character sheet
 * @param invocations  Full list of Eldritch Invocation names to set
 * @returns Updated sheet (new object, no mutation)
 * @throws Error if validation fails
 */
export function chooseEldritchInvocations(
  sheet: CharacterSheet,
  invocations: string[],
): CharacterSheet {
  // ---- Validate Warlock class present -----------------------
  const warlockEntry = sheet.classLevels.find(cl => cl.className === 'Warlock');
  if (!warlockEntry) {
    throw new Error(
      `Cannot choose Eldritch Invocations: character has no Warlock class levels. ` +
      `Known classes: ${sheet.classLevels.map(cl => cl.className).join(', ') || '(none)'}.`
    );
  }

  // ---- Validate count vs Warlock level ----------------------
  const warlockLevel = warlockEntry.level;
  const maxSlots = getMaxInvocationSlots(warlockLevel);
  if (maxSlots === 0) {
    throw new Error(
      `Cannot choose Eldritch Invocations: Warlock level ${warlockLevel} is below 2 ` +
      `(the feature unlocks at Warlock 2).`
    );
  }
  if (invocations.length !== maxSlots) {
    throw new Error(
      `Eldritch Invocations count mismatch: Warlock level ${warlockLevel} allows ` +
      `exactly ${maxSlots} invocation${maxSlots === 1 ? '' : 's'}, got ${invocations.length}. ` +
      `(Provide the full list — partial lists are rejected so the sheet stays complete.)`
    );
  }

  // ---- Validate each invocation name is in the registry -----
  // Build a list of all unknown names for a single, helpful error message.
  const known = Object.keys(ELDRITCH_INVOCATIONS);
  const unknown = invocations.filter(n => !known.includes(n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown Eldritch Invocation${unknown.length === 1 ? '' : 's'}: ` +
      `${unknown.map(n => `"${n}"`).join(', ')}. ` +
      `Known invocations (v1): ${known.sort().join(', ')}.`
    );
  }

  // ---- Validate no duplicates -------------------------------
  const seen = new Set<string>();
  for (const name of invocations) {
    if (seen.has(name)) {
      throw new Error(
        `Duplicate Eldritch Invocation "${name}" — each invocation can only be chosen once.`
      );
    }
    seen.add(name);
  }

  // ---- Apply ------------------------------------------------
  return {
    ...sheet,
    eldritchInvocations: [...invocations],
    updatedAt: new Date().toISOString(),
  };
}
