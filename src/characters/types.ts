// ============================================================
// Character Sheet Types
// D&D 5e Combat Sim — PHB 2014 / MM 2014 / SAC v2.7
//
// The CharacterSheet is the AUTHOR-TIME representation of a
// character (what a player creates and edits). It is distinct
// from the Combatant (the RUNTIME object used by the engine).
//
// Bridge:  CharacterSheet → builder.ts → Combatant
// Storage: CharacterSheet ↔ characters/<id>.json
// ============================================================

import type { AbilityScore } from '../types/core';

// ---- Enums & Primitives -------------------------------------

export type ArmorCategory = 'none' | 'light' | 'medium' | 'heavy' | 'shield';
export type WeaponCategory =
  | 'simple-melee' | 'simple-ranged'
  | 'martial-melee' | 'martial-ranged';
export type ToolProficiency = string;   // "Thieves' Tools", "Herbalism Kit", etc.
export type Language = string;          // "Common", "Elvish", etc.

export type SkillName =
  | 'Athletics'
  | 'Acrobatics' | 'Sleight of Hand' | 'Stealth'
  | 'Arcana' | 'History' | 'Investigation' | 'Nature' | 'Religion'
  | 'Animal Handling' | 'Insight' | 'Medicine' | 'Perception' | 'Survival'
  | 'Deception' | 'Intimidation' | 'Performance' | 'Persuasion';

// All 12 PHB 2014 classes
export type ClassName =
  | 'Barbarian' | 'Bard' | 'Cleric' | 'Druid'
  | 'Fighter' | 'Monk' | 'Paladin' | 'Ranger'
  | 'Rogue' | 'Sorcerer' | 'Warlock' | 'Wizard';

export const CLASS_HIT_DICE: Record<ClassName, number> = {
  Barbarian: 12,
  Fighter:   10,
  Paladin:   10,
  Ranger:    10,
  Bard:       8,
  Cleric:     8,
  Druid:      8,
  Monk:       8,
  Rogue:      8,
  Warlock:    8,
  Sorcerer:   6,
  Wizard:     6,
};

// Proficiency bonus by total character level (PHB p.15)
export const PROFICIENCY_BONUS_TABLE: Record<number, number> = {
  1: 2, 2: 2, 3: 2, 4: 2,
  5: 3, 6: 3, 7: 3, 8: 3,
  9: 4, 10: 4, 11: 4, 12: 4,
  13: 5, 14: 5, 15: 5, 16: 5,
  17: 6, 18: 6, 19: 6, 20: 6,
};

// XP thresholds (PHB p.15)
/** CR to XP table (MM 2014, p.9). Key = CR string as printed ("0","1/8","1/4","1/2","1"…"30"). */
export const CR_XP_TABLE: Record<string, number> = {
  '0':   10, '1/8': 25, '1/4': 50, '1/2': 100,
  '1':  200, '2':  450, '3':  700, '4':  1100,
  '5': 1800, '6': 2300, '7': 2900, '8':  3900,
  '9': 5000, '10':5900, '11':7200, '12': 8400,
  '13':10000,'14':11500,'15':13000,'16':15000,
  '17':18000,'18':20000,'19':22000,'20':25000,
  '21':33000,'22':41000,'23':50000,'24':62000,
  '25':75000,'26':90000,'27':105000,'28':120000,
  '29':135000,'30':155000,
};

/** Convert a bestiary CR value to XP. Returns 0 for unknown CRs. */
export function crToXP(cr: string | { cr: string } | undefined): number {
  if (!cr) return 0;
  const raw = typeof cr === 'string' ? cr : cr.cr;
  return CR_XP_TABLE[raw] ?? 0;
}

export const XP_THRESHOLDS: number[] = [
  0,       // Level 1
  300,     // Level 2
  900,     // Level 3
  2700,    // Level 4
  6500,    // Level 5
  14000,   // Level 6
  23000,   // Level 7
  34000,   // Level 8
  48000,   // Level 9
  64000,   // Level 10
  85000,   // Level 11
  100000,  // Level 12
  120000,  // Level 13
  140000,  // Level 14
  165000,  // Level 15
  195000,  // Level 16
  225000,  // Level 17
  265000,  // Level 18
  305000,  // Level 19
  355000,  // Level 20
];

// Multiclass ability score prerequisites (PHB p.163)
// Each entry is a list of { ability, minimum } — ALL must be met
export const MULTICLASS_PREREQS: Record<ClassName, { ability: AbilityScore; min: number }[]> = {
  Barbarian: [{ ability: 'str', min: 13 }],
  Bard:      [{ ability: 'cha', min: 13 }],
  Cleric:    [{ ability: 'wis', min: 13 }],
  Druid:     [{ ability: 'wis', min: 13 }],
  Fighter:   [{ ability: 'str', min: 13 }],  // OR DEX 13 — checked specially
  Monk:      [{ ability: 'dex', min: 13 }, { ability: 'wis', min: 13 }],
  Paladin:   [{ ability: 'str', min: 13 }, { ability: 'cha', min: 13 }],
  Ranger:    [{ ability: 'dex', min: 13 }, { ability: 'wis', min: 13 }],
  Rogue:     [{ ability: 'dex', min: 13 }],
  Sorcerer:  [{ ability: 'cha', min: 13 }],
  Warlock:   [{ ability: 'cha', min: 13 }],
  Wizard:    [{ ability: 'int', min: 13 }],
};

// ---- Sub-structures -----------------------------------------

export interface ClassLevel {
  className: string;   // e.g. "Fighter"
  level: number;       // levels in this class (1–20)
}

/** One type of hit die in the pool (one entry per class taken) */
export interface HitDieRecord {
  className: string;   // which class grants this die
  dieSides: number;    // 6 | 8 | 10 | 12
  total: number;       // = level in that class
  remaining: number;   // dice not yet spent (spent on short rests)
}

/** Raw + final ability scores */
export interface CharacterAbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

/** Spellcasting state for one class's magic */
export interface SpellcastingInfo {
  ability: AbilityScore;           // casting stat
  spellAttackBonus: number;        // computed: prof + ability mod
  saveDC: number;                  // computed: 8 + prof + ability mod
  // Spell slots — keyed by level "1".."9"
  slots: Record<string, number>;   // max slots at each spell level
  slotsUsed: Record<string, number>;  // slots expended this day
  // Pact Magic (Warlock) — stored separately from standard slots
  pactSlots?: {
    slotLevel: number;
    total: number;
    used: number;
  };
  cantrips: string[];
  knownSpells: string[];           // for known-casters (Bard, Sorcerer, Warlock, Ranger)
  preparedSpells: string[];        // for prepared-casters (Cleric, Druid, Paladin, Wizard)
  spellbook?: string[];            // Wizard: full list including unprepared spells
}

export interface EquipmentItem {
  name: string;
  quantity: number;
  equipped: boolean;
  category: 'weapon' | 'armor' | 'shield' | 'tool' | 'gear' | 'pack';
  notes?: string;
}

export interface CharacterProficiencies {
  armor: ArmorCategory[];
  weapons: WeaponCategory[];
  tools: ToolProficiency[];
  savingThrows: AbilityScore[];
  skills: SkillName[];
  expertise: SkillName[];      // double proficiency bonus
}

/** Class resources (per-rest pool tracking) */
export interface CharacterResources {
  // Barbarian
  rage?:              { max: number; remaining: number };
  // Fighter
  secondWind?:        { max: number; remaining: number };
  // Bard
  bardicInspiration?: { max: number; remaining: number; dieSides: number };
  // Paladin
  layOnHands?:        { pool: number; remaining: number };
  divineSmite?:       boolean;
  // Rogue
  sneakAttackDice?:   string;           // e.g. "1d6"
  cunningAction?:     boolean;          // Level 2+ only
  // Wizard
  arcaneRecovery?:    { usesRemaining: number };
  // Warlock (Pact Magic tracked in spellcasting.pactSlots)
  darkOnesBlessing?:  { amount: number };
  // Warding Bond
  wardingBond?:       { remaining: number };
  // Cleric — Channel Divinity (short or long rest)
  channelDivinity?:   { max: number; remaining: number };
  // Monk — Ki points (short or long rest)
  ki?:                { max: number; remaining: number };
}

/** Named features from race, class, subclass, background */
export interface CharacterFeature {
  name: string;
  description: string;
  source: 'race' | 'class' | 'subclass' | 'background' | 'feat';
}

// ---- Level Stack Record ------------------------------------
//
// ---- Level0Record -------------------------------------------
// Level0Record is the IMMUTABLE stack bottom — the character's state
// before any class levels are applied.  It captures race, background,
// and the ability score allotment that was chosen at character creation.
//
// Racial ASI uses Tasha's (2020) flexible placement rules, which are
// accepted as pre-2024 canon: each race has a defined allotment of bonus
// amounts (e.g. Mountain Dwarf [+2, +2]) but the player freely assigns
// those amounts to any distinct ability scores.  Normal Human (+1 to all
// six) is handled by listing six separate 1s.
//
// Custom Lineage (Tasha's) is treated as a first-class race with its
// own allotment of [+2] to one stat of the player's choice.
//
// popLevel() refuses to pop a character whose levelHistory is already
// empty if level0Record is present; the character is at Level 0.

export interface Level0Record {
  // ---- Race -------------------------------------------------------
  /** Race name, e.g. "Mountain Dwarf", "High Elf", "Custom Lineage" */
  race: string;
  /**
   * Racial bonus allotment (amounts only, not destinations).
   * Examples:
   *   Most races      → [2, 1]
   *   Mountain Dwarf  → [2, 2]
   *   Normal Human    → [1, 1, 1, 1, 1, 1]
   *   Human Variant   → [1, 1]
   *   Custom Lineage  → [2]
   */
  racialASIAllotment: number[];
  /**
   * How the allotment was actually distributed.
   * Keys are ability-score names; values are the bonus applied.
   * The sum per key may span multiple allotment slots (e.g. a race
   * with [2, 1] whose player puts both on STR would give { str: 3 }).
   */
  appliedRacialASI: Partial<CharacterAbilityScores>;

  // ---- Ability Scores -------------------------------------------
  /**
   * Base scores BEFORE any racial bonus was applied.
   * Preserves the raw array / point-buy allocation.
   */
  baseScores: CharacterAbilityScores;

  // ---- Background -----------------------------------------------
  /** Background name, e.g. "Acolyte", "Soldier" */
  background: string;
  /** Skill proficiencies granted by this background */
  backgroundSkills: string[];
  /** Tool proficiencies granted by this background */
  backgroundTools: string[];
  /** Extra languages granted by this background */
  backgroundLanguages: string[];
  /** Starting gold from this background */
  backgroundGold: number;
  /** Name of the background feature, e.g. "Shelter of the Faithful" */
  backgroundFeature: string;
}

// LevelRecord captures EXACTLY what one call to applyLevelUp() added.
// CharacterSheet.levelHistory is a stack (oldest-first).
// popLevel() reads the top record and fully reverses the changes,
// enabling true level-down without a full rebuild.

export interface LevelRecord {
  /** Class that was leveled up. */
  className: string;
  /** Level reached in that class after this push (1-based). */
  classLevel: number;
  /** Total character level after this push. */
  totalLevelAfter: number;
  /** HP added to maxHP (and currentHP at time of level-up). */
  hpGained: number;
  /** Features appended to allFeatures at this level. */
  featuresAdded: CharacterFeature[];
  /** True if this push added a brand-new classLevels entry. */
  wasNewClass: boolean;
  /** If a subclass prompt was triggered at this level, its className. */
  subclassPrompted?: string;

  // ---- "Before" snapshots for full reversal -----------------
  /** sheet.resources snapshot before updateResources() ran. */
  resourcesBefore: CharacterResources;
  /** sheet.spellcasting.slots before slot recompute (null = spellcasting didn't exist). */
  spellSlotsBefore: Record<string, number> | null;
  /** sheet.spellcasting.slotsUsed before slot recompute. */
  spellSlotsUsedBefore: Record<string, number> | null;
  /** sheet.spellcasting.pactSlots before update (null = none). */
  pactSlotsBefore: { slotLevel: number; total: number; used: number } | null;
  /** True if spellcasting block existed before this level. */
  hadSpellcastingBefore: boolean;
  /** sheet.stats before this level (captures any ASI applied earlier for correct pop). */
  statsBefore: CharacterAbilityScores;
  /** sheet.pendingAbilityScoreImprovements before this push. */
  pendingASIBefore: number;
  /** sheet.pendingASIHalfPoints before this push. */
  pendingASIHalfBefore: number;
}

// ---- Main CharacterSheet ------------------------------------

/**
 * CharacterSheet — the author-time representation of a PC.
 * Stored as characters/<id>.json. Converted to Combatant via builder.ts.
 *
 * Schema version: 1 (increment when fields are added/removed).
 */
export interface CharacterSheet {
  // Metadata
  id: string;                           // UUID v4
  version: number;                      // schema version for migration
  createdAt: string;                    // ISO 8601 timestamp
  updatedAt: string;                    // ISO 8601 timestamp

  // Identity
  name: string;                         // Custom character name (e.g. "Garrett Ironforge")
  race: string;                         // e.g. "Mountain Dwarf", "High Elf", "Human"
  background: string;                   // e.g. "Soldier", "Sage", "Criminal"
  alignment: string;                    // e.g. "Lawful Good", "Chaotic Neutral"
  notes?: string;                       // Optional freeform notes

  // Class & Level
  firstClass: string;                   // Class chosen at level 1 (IMPORTANT: affects starting HP)
  classLevels: ClassLevel[];            // All class levels; sum = total level
  subclassChoices: Record<string, string>;  // className → subclass name (added when eligible)
  experiencePoints: number;             // Total XP accumulated

  // Ability Scores
  baseStats: CharacterAbilityScores;   // Raw scores BEFORE racial bonuses
  stats: CharacterAbilityScores;       // Final scores (racial bonuses applied)

  // Combat Stats (computed from class + equipment + features, stored for speed)
  maxHP: number;
  currentHP: number;
  temporaryHP: number;
  armorClass: number;
  acFormula: string;                    // Human-readable, e.g. "Chain Mail 16"
  speed: number;                        // Base walking speed (ft)
  flySpeed?: number;
  swimSpeed?: number;
  burrowSpeed?: number;

  // Hit Dice pool
  hitDice: HitDieRecord[];

  // Proficiencies & Languages
  proficiencies: CharacterProficiencies;
  languages: string[];

  // Resources, Spellcasting, Equipment
  resources: CharacterResources;
  spellcasting?: SpellcastingInfo;
  equipment: EquipmentItem[];
  gold: number;

  // Features
  level1Features: CharacterFeature[];   // Features from race + class at level 1
  allFeatures: CharacterFeature[];      // All features across all levels (grows as you level up)
  feats: string[];                      // Feat names (resolved from registry at runtime)
  backgroundFeature: string;            // Background feature description

  // Status
  exhaustionLevel: number;              // 0–6 (PHB p.291)

  // Pending progression choices (set by applyLevelUp; consumed by applyASI / chooseSubclass)
  pendingAbilityScoreImprovements?: number;  // # of ASI choices not yet applied (each = +2 total, split freely)
  pendingASIHalfPoints?: number;             // 0 or 1 — leftover half-point from a +1 split application

  // ---- Level history stack ----------------------------------
  // Ordered oldest → newest. Top = last element.
  // Optional for backward compatibility with pre-stack sheets.
  levelHistory?: LevelRecord[];

  // ---- Level 0 (stack bottom) --------------------------------
  // Immutable record of race + background + base scores from character
  // creation.  When present, popLevel() refuses to pop below level 1.
  // New characters should always carry this; legacy characters may not.
  level0Record?: Level0Record;

  // ---- Conditions (PHB p.290) -------------------------------
  // Active conditions on this character. Optional for backward compat.
  conditions?: string[];

  // ---- Death Saves (PHB p.197) ------------------------------
  // Tracked out-of-combat (reset on heal above 0 or long rest).
  deathSaves?: { successes: number; failures: number };

  // ---- Inspiration (PHB p.125) ------------------------------
  inspiration?: boolean;

  // ---- Concentration (PHB p.203) ----------------------------
  // Name of the spell currently being concentrated on; null/absent = not concentrating.
  concentrating?: string | null;
}

// ---- Party --------------------------------------------------

export interface Party {
  id: string;                           // UUID v4
  name: string;                         // e.g. "The Sundered Shield"
  characterIds: string[];               // IDs of member CharacterSheets
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

// ---- Derived Stats Helper -----------------------------------

/** Computed stats derived from a CharacterSheet (not stored, computed at runtime) */
export interface DerivedStats {
  totalLevel: number;
  proficiencyBonus: number;
  abilityModifiers: CharacterAbilityScores;
  passivePerception: number;
  levelForNextXP: number;               // XP needed to reach next level
  xpForNextLevel: number | null;        // null at level 20
}

// ---- Utility Functions (pure, no side effects) --------------

/** Compute ability modifier (floor((score - 10) / 2)) */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Sum all class levels to get total character level */
export function totalLevel(sheet: CharacterSheet): number {
  return sheet.classLevels.reduce((sum, cl) => sum + cl.level, 0);
}

/** Compute proficiency bonus from total level */
export function proficiencyBonus(sheet: CharacterSheet): number {
  const lvl = totalLevel(sheet);
  return PROFICIENCY_BONUS_TABLE[Math.min(Math.max(lvl, 1), 20)] ?? 2;
}

/** Compute all derived stats for a character sheet */
export function deriveStats(sheet: CharacterSheet): DerivedStats {
  const lvl   = totalLevel(sheet);
  const prof   = proficiencyBonus(sheet);
  const mods: CharacterAbilityScores = {
    str: abilityModifier(sheet.stats.str),
    dex: abilityModifier(sheet.stats.dex),
    con: abilityModifier(sheet.stats.con),
    int: abilityModifier(sheet.stats.int),
    wis: abilityModifier(sheet.stats.wis),
    cha: abilityModifier(sheet.stats.cha),
  };
  const hasPerfProf = sheet.proficiencies.skills.includes('Perception') ||
                      sheet.proficiencies.expertise.includes('Perception');
  const expertisePerc = sheet.proficiencies.expertise.includes('Perception');
  const percBonus = hasPerfProf ? (expertisePerc ? prof * 2 : prof) : 0;
  const passivePerception = 10 + mods.wis + percBonus;

  const nextLvl = Math.min(lvl + 1, 20);
  const xpForNextLevel = lvl >= 20 ? null : XP_THRESHOLDS[nextLvl - 1];

  return {
    totalLevel: lvl,
    proficiencyBonus: prof,
    abilityModifiers: mods,
    passivePerception,
    levelForNextXP: nextLvl,
    xpForNextLevel,
  };
}

/** Compute XP level from XP amount (returns 1–20) */
export function levelFromXP(xp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return Math.min(level, 20);
}
