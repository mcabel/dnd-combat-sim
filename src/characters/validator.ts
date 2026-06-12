// ============================================================
// Character Sheet Validator
// D&D 5e Combat Sim
//
// Validates CharacterSheet and Party objects before save/load.
// Returns a list of error strings (empty = valid).
// Does NOT mutate the input object.
// ============================================================

import {
  CharacterSheet, Party, totalLevel, MULTICLASS_PREREQS,
  XP_THRESHOLDS, CLASS_HIT_DICE, ClassName,
} from './types';

/** Thrown by storage functions when validation fails. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ---- Helpers ------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_REGEX  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const VALID_CLASSES = new Set<string>([
  'Barbarian', 'Bard', 'Cleric', 'Druid',
  'Fighter', 'Monk', 'Paladin', 'Ranger',
  'Rogue', 'Sorcerer', 'Warlock', 'Wizard',
]);

const VALID_ALIGNMENTS = new Set<string>([
  'Lawful Good', 'Neutral Good', 'Chaotic Good',
  'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
  'Lawful Evil', 'Neutral Evil', 'Chaotic Evil',
  'Unaligned',
]);

function isValidScore(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 30;
}

// ---- CharacterSheet Validation ------------------------------

/**
 * Validate a CharacterSheet object.
 * Returns an array of error messages. Empty array = valid.
 */
export function validateCharacterSheet(sheet: CharacterSheet): string[] {
  const errors: string[] = [];

  // ---- Metadata ----
  if (!sheet.id || !UUID_REGEX.test(sheet.id)) {
    errors.push(`id must be a valid UUID (got "${sheet.id}")`);
  }
  if (typeof sheet.version !== 'number' || sheet.version < 1) {
    errors.push(`version must be a positive integer (got ${sheet.version})`);
  }
  if (!sheet.createdAt || !ISO_REGEX.test(sheet.createdAt)) {
    errors.push(`createdAt must be an ISO timestamp (got "${sheet.createdAt}")`);
  }
  if (!sheet.updatedAt || !ISO_REGEX.test(sheet.updatedAt)) {
    errors.push(`updatedAt must be an ISO timestamp (got "${sheet.updatedAt}")`);
  }

  // ---- Identity ----
  if (!sheet.name || typeof sheet.name !== 'string' || sheet.name.trim().length === 0) {
    errors.push('name is required');
  }
  if (!sheet.race || typeof sheet.race !== 'string') {
    errors.push('race is required');
  }
  if (!sheet.background || typeof sheet.background !== 'string') {
    errors.push('background is required');
  }
  if (sheet.alignment && !VALID_ALIGNMENTS.has(sheet.alignment)) {
    // Warn, not error — future-proofing
    errors.push(`alignment "${sheet.alignment}" is not a standard PHB alignment`);
  }

  // ---- Class & Level ----
  if (!sheet.firstClass || !VALID_CLASSES.has(sheet.firstClass)) {
    errors.push(`firstClass must be one of the 12 PHB classes (got "${sheet.firstClass}")`);
  }
  if (!Array.isArray(sheet.classLevels) || sheet.classLevels.length === 0) {
    errors.push('classLevels must be a non-empty array');
  } else {
    for (const cl of sheet.classLevels) {
      if (!VALID_CLASSES.has(cl.className)) {
        errors.push(`unknown class in classLevels: "${cl.className}"`);
      }
      if (!Number.isInteger(cl.level) || cl.level < 1 || cl.level > 20) {
        errors.push(`classLevels ${cl.className} level must be 1–20 (got ${cl.level})`);
      }
    }
    const lvl = totalLevel(sheet);
    if (lvl < 1 || lvl > 20) {
      errors.push(`total character level must be 1–20 (got ${lvl})`);
    }

    // firstClass must appear in classLevels
    const hasFirst = sheet.classLevels.some(cl => cl.className === sheet.firstClass);
    if (!hasFirst) {
      errors.push(`firstClass "${sheet.firstClass}" not found in classLevels`);
    }

    // Multiclass prerequisites check (only if more than 1 class)
    if (sheet.classLevels.length > 1) {
      for (const cl of sheet.classLevels) {
        if (cl.className === sheet.firstClass) continue; // first class exempt
        const reqs = MULTICLASS_PREREQS[cl.className as ClassName];
        if (!reqs) continue;

        if (cl.className === 'Fighter') {
          // Fighter: STR 13 OR DEX 13
          const str = sheet.stats?.str ?? 0;
          const dex = sheet.stats?.dex ?? 0;
          if (str < 13 && dex < 13) {
            errors.push(`Multiclassing into Fighter requires STR 13 or DEX 13`);
          }
        } else {
          for (const req of reqs) {
            const score = sheet.stats?.[req.ability] ?? 0;
            if (score < req.min) {
              errors.push(
                `Multiclassing into ${cl.className} requires ${req.ability.toUpperCase()} ≥ ${req.min} (got ${score})`
              );
            }
          }
        }
      }
    }
  }

  // XP
  if (typeof sheet.experiencePoints !== 'number' || sheet.experiencePoints < 0) {
    errors.push('experiencePoints must be a non-negative number');
  }

  // ---- Ability Scores ----
  const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
  if (!sheet.stats) {
    errors.push('stats is required');
  } else {
    for (const ab of abilities) {
      if (!isValidScore(sheet.stats[ab])) {
        errors.push(`stats.${ab} must be 1–30 (got ${sheet.stats[ab]})`);
      }
    }
  }
  if (!sheet.baseStats) {
    errors.push('baseStats is required');
  } else {
    for (const ab of abilities) {
      if (!isValidScore(sheet.baseStats[ab])) {
        errors.push(`baseStats.${ab} must be 1–30 (got ${sheet.baseStats[ab]})`);
      }
    }
  }

  // ---- Combat Stats ----
  if (typeof sheet.maxHP !== 'number' || sheet.maxHP < 1) {
    errors.push('maxHP must be at least 1');
  }
  if (typeof sheet.currentHP !== 'number' || sheet.currentHP < 0) {
    errors.push('currentHP must be non-negative');
  }
  if (sheet.currentHP > sheet.maxHP) {
    errors.push(`currentHP (${sheet.currentHP}) cannot exceed maxHP (${sheet.maxHP})`);
  }
  if (typeof sheet.temporaryHP !== 'number' || sheet.temporaryHP < 0) {
    errors.push('temporaryHP must be non-negative');
  }
  if (typeof sheet.armorClass !== 'number' || sheet.armorClass < 1) {
    errors.push('armorClass must be at least 1');
  }
  if (typeof sheet.speed !== 'number' || sheet.speed < 0) {
    errors.push('speed must be non-negative');
  }

  // ---- Hit Dice ----
  if (!Array.isArray(sheet.hitDice)) {
    errors.push('hitDice must be an array');
  } else {
    for (const hd of sheet.hitDice) {
      if (!VALID_CLASSES.has(hd.className)) {
        errors.push(`hitDice has unknown className "${hd.className}"`);
      }
      const expectedSides = CLASS_HIT_DICE[hd.className as ClassName];
      if (expectedSides && hd.dieSides !== expectedSides) {
        errors.push(
          `hitDice ${hd.className} dieSides should be ${expectedSides} (got ${hd.dieSides})`
        );
      }
      if (hd.remaining < 0 || hd.remaining > hd.total) {
        errors.push(`hitDice ${hd.className} remaining (${hd.remaining}) out of range 0–${hd.total}`);
      }
    }
  }

  // ---- Proficiencies ----
  if (!sheet.proficiencies) {
    errors.push('proficiencies is required');
  }

  // ---- Exhaustion ----
  if (typeof sheet.exhaustionLevel !== 'number' ||
      !Number.isInteger(sheet.exhaustionLevel) ||
      sheet.exhaustionLevel < 0 ||
      sheet.exhaustionLevel > 6) {
    errors.push(`exhaustionLevel must be 0–6 (got ${sheet.exhaustionLevel})`);
  }

  // ---- Features arrays ----
  if (!Array.isArray(sheet.level1Features)) {
    errors.push('level1Features must be an array');
  }
  if (!Array.isArray(sheet.allFeatures)) {
    errors.push('allFeatures must be an array');
  }
  if (!Array.isArray(sheet.feats)) {
    errors.push('feats must be an array');
  }
  if (!Array.isArray(sheet.equipment)) {
    errors.push('equipment must be an array');
  }
  if (typeof sheet.gold !== 'number' || sheet.gold < 0) {
    errors.push('gold must be a non-negative number');
  }

  return errors;
}

// ---- Party Validation ---------------------------------------

/**
 * Validate a Party object.
 * Returns an array of error messages. Empty array = valid.
 */
export function validateParty(party: Party): string[] {
  const errors: string[] = [];

  if (!party.id || !UUID_REGEX.test(party.id)) {
    errors.push(`id must be a valid UUID (got "${party.id}")`);
  }
  if (!party.name || typeof party.name !== 'string' || party.name.trim().length === 0) {
    errors.push('name is required');
  }
  if (!Array.isArray(party.characterIds)) {
    errors.push('characterIds must be an array');
  } else {
    if (party.characterIds.length > 8) {
      errors.push(`party can have at most 8 members (got ${party.characterIds.length})`);
    }
    for (const id of party.characterIds) {
      if (!UUID_REGEX.test(id)) {
        errors.push(`characterIds contains invalid UUID: "${id}"`);
      }
    }
    // Duplicate check
    const seen = new Set<string>();
    for (const id of party.characterIds) {
      if (seen.has(id)) {
        errors.push(`characterIds contains duplicate: "${id}"`);
      }
      seen.add(id);
    }
  }
  if (!party.createdAt || !ISO_REGEX.test(party.createdAt)) {
    errors.push('createdAt must be an ISO timestamp');
  }
  if (!party.updatedAt || !ISO_REGEX.test(party.updatedAt)) {
    errors.push('updatedAt must be an ISO timestamp');
  }

  return errors;
}
