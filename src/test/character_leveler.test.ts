// ============================================================
// Test: Character Level-Up Logic
// Run: ts-node src/test/character_leveler.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import {
  applyLevelUp,
  popLevel,
  bootstrapLevelHistory,
  computeStandardSlots,
  FULL_CASTER_SLOTS,
  HALF_CASTER_SLOTS,
  ARTIFICER_SLOTS,
  WARLOCK_PACT_SLOTS,
} from '../characters/leveler';
import { CharacterSheet, totalLevel } from '../characters/types';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

/** Base Fighter level-1 sheet (CON 16, CON mod +3). */
function makeFighter(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Gareth', race: 'Mountain Dwarf', background: 'Soldier',
    alignment: 'Lawful Good',
    firstClass: 'Fighter',
    classLevels: [{ className: 'Fighter', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 17, dex: 10, con: 16, int: 8, wis: 12, cha: 13 },
    stats:     { str: 17, dex: 10, con: 16, int: 8, wis: 12, cha: 13 },
    maxHP: 13, currentHP: 13, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail', speed: 25,
    hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','heavy','shield'],
      weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','con'],
      skills: ['Athletics','Intimidation'], expertise: [],
    },
    languages: ['Common', 'Dwarvish'],
    resources: { secondWind: { max: 1, remaining: 1 } },
    spellcasting: undefined,
    equipment: [{ name: 'Greatsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [{ name: 'Second Wind', description: 'Regain HP.', source: 'class' }],
    allFeatures:    [{ name: 'Second Wind', description: 'Regain HP.', source: 'class' }],
    feats: [], backgroundFeature: 'Military Rank', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Base Wizard level-1 sheet (INT 16, CON 13, CON mod +1). */
function makeWizard(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Aelindra', race: 'High Elf', background: 'Sage',
    alignment: 'Chaotic Good',
    firstClass: 'Wizard',
    classLevels: [{ className: 'Wizard', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 15, con: 13, int: 15, wis: 12, cha: 10 },
    stats:     { str: 8, dex: 16, con: 13, int: 16, wis: 12, cha: 10 },
    maxHP: 7, currentHP: 7, temporaryHP: 0,
    armorClass: 13, acFormula: 'DEX Unarmored', speed: 30,
    hitDice: [{ className: 'Wizard', dieSides: 6, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['int','wis'],
      skills: ['Arcana','History'], expertise: [],
    },
    languages: ['Common', 'Elvish'],
    resources: { arcaneRecovery: { usesRemaining: 1 } },
    spellcasting: {
      ability: 'int', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Fire Bolt', 'Minor Illusion'],
      knownSpells: [],
      preparedSpells: ['Magic Missile', 'Sleep'],
      spellbook: ['Magic Missile', 'Sleep', 'Shield'],
    },
    equipment: [{ name: 'Dagger', quantity: 2, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Spellcasting', description: 'INT caster.', source: 'class' }],
    allFeatures:    [{ name: 'Spellcasting', description: 'INT caster.', source: 'class' }],
    feats: [], backgroundFeature: 'Researcher', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Rogue level-1 sheet (DEX 17, CON 14, CON mod +2). */
function makeRogue(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Shiv', race: 'Human', background: 'Criminal',
    alignment: 'Chaotic Neutral',
    firstClass: 'Rogue',
    classLevels: [{ className: 'Rogue', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 10, dex: 17, con: 14, int: 12, wis: 11, cha: 13 },
    stats:     { str: 10, dex: 17, con: 14, int: 12, wis: 11, cha: 13 },
    maxHP: 10, currentHP: 10, temporaryHP: 0,
    armorClass: 13, acFormula: 'Leather + DEX', speed: 30,
    hitDice: [{ className: 'Rogue', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light'], weapons: ['simple-melee','simple-ranged','martial-melee'],
      tools: [], savingThrows: ['dex','int'],
      skills: ['Stealth','Deception','Sleight of Hand'], expertise: ['Stealth','Deception'],
    },
    languages: ['Common', 'Thieves\' Cant'],
    resources: { sneakAttackDice: '1d6' },
    spellcasting: undefined,
    equipment: [{ name: 'Shortsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 5,
    level1Features: [{ name: 'Sneak Attack', description: '1d6 sneak attack.', source: 'class' }],
    allFeatures:    [{ name: 'Sneak Attack', description: '1d6 sneak attack.', source: 'class' }],
    feats: [], backgroundFeature: 'Criminal Contact', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Barbarian level-1 sheet (STR 17, CON 16, CON mod +3). */
function makeBarbarian(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Krog', race: 'Half-Orc', background: 'Outlander',
    alignment: 'Chaotic Neutral',
    firstClass: 'Barbarian',
    classLevels: [{ className: 'Barbarian', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 17, dex: 12, con: 16, int: 8, wis: 11, cha: 9 },
    stats:     { str: 17, dex: 12, con: 16, int: 8, wis: 11, cha: 9 },
    maxHP: 15, currentHP: 15, temporaryHP: 0,
    armorClass: 14, acFormula: '10 + DEX + CON (Unarmored)', speed: 30,
    hitDice: [{ className: 'Barbarian', dieSides: 12, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'], weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','con'],
      skills: ['Athletics','Perception'], expertise: [],
    },
    languages: ['Common', 'Orcish'],
    resources: { rage: { max: 2, remaining: 2 } },
    spellcasting: undefined,
    equipment: [{ name: 'Greataxe', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 0,
    level1Features: [{ name: 'Rage', description: 'Rage 2x/day.', source: 'class' }],
    allFeatures:    [{ name: 'Rage', description: 'Rage 2x/day.', source: 'class' }],
    feats: [], backgroundFeature: 'Wanderer', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Paladin level-1 sheet (STR 17, CHA 15, CON 14, CON mod +2). */
function makePaladin(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Seraphel', race: 'Human', background: 'Noble',
    alignment: 'Lawful Good',
    firstClass: 'Paladin',
    classLevels: [{ className: 'Paladin', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 17, dex: 9, con: 14, int: 10, wis: 11, cha: 15 },
    stats:     { str: 17, dex: 9, con: 14, int: 10, wis: 11, cha: 15 },
    maxHP: 12, currentHP: 12, temporaryHP: 0,
    armorClass: 18, acFormula: 'Plate', speed: 30,
    hitDice: [{ className: 'Paladin', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','heavy','shield'], weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['wis','cha'],
      skills: ['Athletics','Persuasion'], expertise: [],
    },
    languages: ['Common'],
    resources: { layOnHands: { pool: 5, remaining: 5 } },
    spellcasting: undefined,
    equipment: [{ name: 'Longsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 25,
    level1Features: [{ name: 'Lay on Hands', description: 'HP pool 5.', source: 'class' }],
    allFeatures:    [{ name: 'Lay on Hands', description: 'HP pool 5.', source: 'class' }],
    feats: [], backgroundFeature: 'Position of Privilege', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Sorcerer level-1 sheet (CHA 16, CON 14). */
function makeSorcerer(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Lyra', race: 'Tiefling', background: 'Hermit',
    alignment: 'Chaotic Neutral',
    firstClass: 'Sorcerer',
    classLevels: [{ className: 'Sorcerer', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16 },
    stats:     { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 18 },
    maxHP: 8, currentHP: 8, temporaryHP: 0,
    armorClass: 12, acFormula: 'DEX Unarmored', speed: 30,
    hitDice: [{ className: 'Sorcerer', dieSides: 6, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['con','cha'],
      skills: ['Arcana','Deception'], expertise: [],
    },
    languages: ['Common', 'Infernal'],
    resources: {},
    spellcasting: {
      ability: 'cha', spellAttackBonus: 6, saveDC: 14,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Fire Bolt', 'Prestidigitation'],
      knownSpells: ['Burning Hands'],
      preparedSpells: [],
      spellbook: [],
    },
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Spellcasting', description: 'CHA caster.', source: 'class' }],
    allFeatures:    [{ name: 'Spellcasting', description: 'CHA caster.', source: 'class' }],
    feats: [], backgroundFeature: 'Discovery', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Druid level-1 sheet (WIS 16, CON 14). */
function makeDruid(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Rowan', race: 'Wood Elf', background: 'Hermit',
    alignment: 'Neutral Good',
    firstClass: 'Druid',
    classLevels: [{ className: 'Druid', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 10, dex: 14, con: 14, int: 12, wis: 16, cha: 8 },
    stats:     { str: 10, dex: 15, con: 14, int: 12, wis: 17, cha: 8 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 13, acFormula: 'Medium Armor', speed: 35,
    hitDice: [{ className: 'Druid', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'], weapons: ['simple-melee','simple-ranged'],
      tools: ['herbalism-kit'], savingThrows: ['int','wis'],
      skills: ['Nature','Survival'], expertise: [],
    },
    languages: ['Common', 'Elvish', 'Druidic'],
    resources: {},
    spellcasting: {
      ability: 'wis', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Shillelagh', 'Druidcraft'],
      knownSpells: [],
      preparedSpells: ['Entangle', 'Healing Word'],
      spellbook: [],
    },
    equipment: [{ name: 'Scimitar', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [{ name: 'Spellcasting', description: 'WIS caster.', source: 'class' }],
    allFeatures:    [{ name: 'Spellcasting', description: 'WIS caster.', source: 'class' }],
    feats: [], backgroundFeature: 'Discovery', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Helper to bump a sheet to a target level by repeatedly calling applyLevelUp. */
function levelTo(sheet: CharacterSheet, targetLevel: number, className?: string): CharacterSheet {
  const cn = className ?? sheet.firstClass;
  let s = sheet;
  while (totalLevel(s) < targetLevel) {
    s = applyLevelUp(s, cn).sheet;
  }
  return s;
}

/** Ranger level-1 sheet (DEX 16, WIS 14). */
function makeRanger(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Sylvara', race: 'Wood Elf', background: 'Outlander',
    alignment: 'Neutral Good',
    firstClass: 'Ranger',
    classLevels: [{ className: 'Ranger', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 12, dex: 16, con: 14, int: 10, wis: 14, cha: 8 },
    stats:     { str: 12, dex: 17, con: 14, int: 10, wis: 15, cha: 8 },
    maxHP: 11, currentHP: 11, temporaryHP: 0,
    armorClass: 14, acFormula: 'Scale Mail', speed: 35,
    hitDice: [{ className: 'Ranger', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'], weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','dex'],
      skills: ['Perception','Stealth'], expertise: [],
    },
    languages: ['Common', 'Elvish'],
    resources: {},
    equipment: [{ name: 'Longbow', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Favored Enemy', description: 'Choose a favored enemy type.', source: 'class' }],
    allFeatures:    [{ name: 'Favored Enemy', description: 'Choose a favored enemy type.', source: 'class' }],
    feats: [], backgroundFeature: 'Wanderer', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Artificer level-1 sheet (INT 17, CON 14). Spellcasting starts at lv1 (TCE p.16), unlike Paladin/Ranger. */
function makeArtificer(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Cogsworth', race: 'Rock Gnome', background: 'Guild Artisan',
    alignment: 'Lawful Neutral',
    firstClass: 'Artificer',
    classLevels: [{ className: 'Artificer', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 },
    stats:     { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 14, acFormula: 'Scale Mail + DEX', speed: 25,
    hitDice: [{ className: 'Artificer', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'], weapons: ['simple-melee','simple-ranged'],
      tools: ["Thieves' Tools", "Tinker's Tools"], savingThrows: ['con','int'],
      skills: ['Investigation','Arcana'], expertise: [],
    },
    languages: ['Common', 'Gnomish'],
    resources: {},
    spellcasting: {
      ability: 'int', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: {},
      cantrips: ['Mending', 'Guidance'],
      knownSpells: [],
      preparedSpells: ['Cure Wounds', 'Faerie Fire'],
    },
    equipment: [{ name: 'Light Crossbow', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 12,
    level1Features: [
      { name: 'Magical Tinkering', description: 'Imbue a Tiny object with a minor magical property.', source: 'class' },
      { name: 'Spellcasting',      description: 'Cast artificer spells using INT.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Magical Tinkering', description: 'Imbue a Tiny object with a minor magical property.', source: 'class' },
      { name: 'Spellcasting',      description: 'Cast artificer spells using INT.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Guild Membership', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Bard level-1 sheet (CHA 16, DEX 14). */
function makeBard(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Melodia', race: 'Half-Elf', background: 'Entertainer',
    alignment: 'Chaotic Good',
    firstClass: 'Bard',
    classLevels: [{ className: 'Bard', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 16 },
    stats:     { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 18 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 14, acFormula: 'Leather + DEX', speed: 30,
    hitDice: [{ className: 'Bard', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light'], weapons: ['simple-melee','simple-ranged','martial-melee'],
      tools: ['lute'], savingThrows: ['dex','cha'],
      skills: ['Persuasion','Performance','Deception'], expertise: ['Persuasion'],
    },
    languages: ['Common', 'Elvish', 'Gnomish'],
    resources: {
      bardicInspiration: { max: 4, remaining: 4, dieSides: 6 },
    },
    spellcasting: {
      ability: 'cha', spellAttackBonus: 6, saveDC: 14,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Vicious Mockery', 'Minor Illusion'],
      knownSpells: ['Healing Word', 'Dissonant Whispers'],
      preparedSpells: [],
      spellbook: [],
    },
    equipment: [{ name: 'Rapier', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Bardic Inspiration (d6)', description: 'Grant a d6 die to an ally.', source: 'class' },
                     { name: 'Spellcasting',             description: 'CHA caster.',                source: 'class' }],
    allFeatures:    [{ name: 'Bardic Inspiration (d6)', description: 'Grant a d6 die to an ally.', source: 'class' },
                     { name: 'Spellcasting',             description: 'CHA caster.',                source: 'class' }],
    feats: [], backgroundFeature: 'By Popular Demand', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Cleric level-1 sheet (WIS 16, CON 14). */
function makeCleric(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Aldric', race: 'Human', background: 'Acolyte',
    alignment: 'Lawful Good',
    firstClass: 'Cleric',
    classLevels: [{ className: 'Cleric', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
    stats:     { str: 15, dex: 10, con: 14, int: 10, wis: 17, cha: 12 },
    maxHP: 10, currentHP: 10, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail', speed: 30,
    hitDice: [{ className: 'Cleric', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['wis','cha'],
      skills: ['Religion','Medicine'], expertise: [],
    },
    languages: ['Common', 'Celestial'],
    resources: {
      channelDivinity: { max: 1, remaining: 1 },
    },
    spellcasting: {
      ability: 'wis', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Sacred Flame', 'Guidance'],
      knownSpells: [],
      preparedSpells: ['Cure Wounds', 'Bless', 'Guiding Bolt'],
      spellbook: [],
    },
    equipment: [{ name: 'Mace', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Spellcasting',     description: 'WIS caster.',              source: 'class' },
                     { name: 'Divine Domain',     description: 'Choose your Divine Domain.', source: 'subclass' }],
    allFeatures:    [{ name: 'Spellcasting',     description: 'WIS caster.',              source: 'class' },
                     { name: 'Divine Domain',     description: 'Choose your Divine Domain.', source: 'subclass' }],
    feats: [], backgroundFeature: 'Shelter of the Faithful', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Monk level-1 sheet (DEX 16, WIS 14). */
function makeMonk(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Jian', race: 'Human', background: 'Hermit',
    alignment: 'Lawful Neutral',
    firstClass: 'Monk',
    classLevels: [{ className: 'Monk', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 12, dex: 16, con: 12, int: 10, wis: 14, cha: 8 },
    stats:     { str: 12, dex: 17, con: 12, int: 10, wis: 15, cha: 8 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 15, acFormula: 'Unarmored (DEX+WIS)', speed: 30,
    hitDice: [{ className: 'Monk', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: ['herbalism-kit'], savingThrows: ['str','dex'],
      skills: ['Acrobatics','Insight'], expertise: [],
    },
    languages: ['Common', 'Dwarvish'],
    resources: {},
    equipment: [{ name: 'Shortsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 5,
    level1Features: [{ name: 'Martial Arts', description: 'Use DEX for unarmed attacks; unarmed strike deals 1d4.', source: 'class' },
                     { name: 'Unarmored Defense (Monk)', description: 'AC = 10 + DEX mod + WIS mod when unarmored.', source: 'class' }],
    allFeatures:    [{ name: 'Martial Arts', description: 'Use DEX for unarmed attacks; unarmed strike deals 1d4.', source: 'class' },
                     { name: 'Unarmored Defense (Monk)', description: 'AC = 10 + DEX mod + WIS mod when unarmored.', source: 'class' }],
    feats: [], backgroundFeature: 'Discovery', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Warlock level-1 sheet (CHA 16, CON 14). */
function makeWarlock(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Vesper', race: 'Tiefling', background: 'Charlatan',
    alignment: 'Chaotic Neutral',
    firstClass: 'Warlock',
    classLevels: [{ className: 'Warlock', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    stats:     { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 18 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 12, acFormula: 'Leather + DEX', speed: 30,
    hitDice: [{ className: 'Warlock', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light'], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['wis','cha'],
      skills: ['Deception','Arcana'], expertise: [],
    },
    languages: ['Common', 'Infernal', 'Abyssal'],
    resources: {},
    spellcasting: {
      ability: 'cha', spellAttackBonus: 6, saveDC: 14,
      slots: {}, slotsUsed: {},
      pactSlots: { slotLevel: 1, total: 1, used: 0 },
      cantrips: ['Eldritch Blast', 'Chill Touch'],
      knownSpells: ['Hex'],
      preparedSpells: [],
      spellbook: [],
    },
    equipment: [{ name: 'Light Crossbow', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Otherworldly Patron', description: 'Gain your patron feature.', source: 'subclass' },
                     { name: 'Pact Magic',           description: 'CHA Pact Magic caster.',   source: 'class' }],
    allFeatures:    [{ name: 'Otherworldly Patron', description: 'Gain your patron feature.', source: 'subclass' },
                     { name: 'Pact Magic',           description: 'CHA Pact Magic caster.',   source: 'class' }],
    feats: [], backgroundFeature: 'False Identity', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

// =============================================================
// 1. Immutability
// =============================================================

console.log('\n=== 1. Immutability ===\n');

{
  const f   = makeFighter();
  const res = applyLevelUp(f, 'Fighter');
  assert('original sheet not mutated (maxHP)', f.maxHP === 13);
  assert('original classLevels not mutated', f.classLevels[0].level === 1);
  assert('result is new object', res.sheet !== f);
  assert('result classLevels is new array', res.sheet.classLevels !== f.classLevels);
}

// =============================================================
// 2. Class level update
// =============================================================

console.log('\n=== 2. Class Level Update ===\n');

{
  const f   = makeFighter();
  const res = applyLevelUp(f, 'Fighter');
  eq('classLevels[0].level becomes 2', res.sheet.classLevels[0].level, 2);
  eq('totalLevel is now 2', totalLevel(res.sheet), 2);
  eq('classLevels has 1 entry', res.sheet.classLevels.length, 1);
}

// =============================================================
// 3. Hit dice pool
// =============================================================

console.log('\n=== 3. Hit Dice Pool ===\n');

{
  const f   = makeFighter();
  const res = applyLevelUp(f, 'Fighter');
  const hd  = res.sheet.hitDice[0];
  eq('hit die total incremented', hd.total, 2);
  eq('hit die remaining incremented', hd.remaining, 2);
  eq('hit die sides unchanged', hd.dieSides, 10);
}

// =============================================================
// 4. HP — Fighter (d10, CON 16 = +3 mod)
// =============================================================

console.log('\n=== 4. HP Calculation ===\n');

{
  const f    = makeFighter();   // CON 16 → +3 mod
  const avg  = applyLevelUp(f, 'Fighter', 'average');
  // average: floor(10/2)+1+3 = 5+1+3 = 9
  eq('Fighter average HP: 9',  avg.sheet.maxHP,  13 + 9);
  eq('hpGained = 9',           avg.hpGained, 9);

  const max  = applyLevelUp(f, 'Fighter', 'max');
  // max: 10+3 = 13
  eq('Fighter max HP: 13',     max.sheet.maxHP,  13 + 13);
  eq('hpGained = 13',          max.hpGained, 13);

  assert('currentHP also increases', avg.sheet.currentHP === avg.sheet.maxHP);
}

{
  const w   = makeWizard();    // CON 13 → +1 mod
  const avg = applyLevelUp(w, 'Wizard', 'average');
  // average: floor(6/2)+1+1 = 3+1+1 = 5
  eq('Wizard average HP: 5',   avg.hpGained, 5);
  const max = applyLevelUp(w, 'Wizard', 'max');
  // max: 6+1 = 7
  eq('Wizard max HP: 7',       max.hpGained, 7);
}

{
  // HP floor: Wizard with CON 6 (−2 mod): floor(6/2)+1+(−2) = 3+1−2 = 2
  const w = makeWizard({ stats: { str:8, dex:16, con:6, int:16, wis:12, cha:10 } });
  const avg = applyLevelUp(w, 'Wizard', 'average');
  eq('Wizard low CON average HP: 2', avg.hpGained, 2);

  // Absolute floor: CON 1 (−5 mod): 3+1−5 = −1 → clamped to 1
  const wLow = makeWizard({ stats: { str:8, dex:16, con:1, int:16, wis:12, cha:10 } });
  const avgLow = applyLevelUp(wLow, 'Wizard', 'average');
  eq('HP minimum is always 1', avgLow.hpGained, 1);
}

// =============================================================
// 5. Fighter resources & features
// =============================================================

console.log('\n=== 5. Fighter Resources & Features ===\n');

{
  // 1→2: Action Surge
  const f2 = applyLevelUp(makeFighter(), 'Fighter');
  eq('Fighter 2: Second Wind unchanged (max)', f2.sheet.resources.secondWind?.max, 1);
  assert('Fighter 2: Action Surge in newFeatures',
    f2.newFeatures.some(f => f.name === 'Action Surge (1/rest)'));
  assert('Fighter 2: features appended to allFeatures',
    f2.sheet.allFeatures.some(f => f.name === 'Action Surge (1/rest)'));
  assert('Fighter 2: no ASI', f2.abilityScoreImprovement === undefined);
  assert('Fighter 2: no subclass prompt', f2.subclassPrompt === undefined);
}

{
  // 2→3: subclass prompt
  const f3 = applyLevelUp(levelTo(makeFighter(), 2), 'Fighter');
  eq('Fighter 3: level is 3', f3.sheet.classLevels[0].level, 3);
  eq('Fighter 3: subclass prompt is Fighter', f3.subclassPrompt, 'Fighter');
  assert('Fighter 3: no ASI', f3.abilityScoreImprovement === undefined);
}

{
  // 3→4: ASI
  const f4 = applyLevelUp(levelTo(makeFighter(), 3), 'Fighter');
  assert('Fighter 4: ASI available', f4.abilityScoreImprovement === true);
  assert('Fighter 4: no subclass prompt', f4.subclassPrompt === undefined);
}

{
  // 4→5: Extra Attack
  const f5 = applyLevelUp(levelTo(makeFighter(), 4), 'Fighter');
  assert('Fighter 5: Extra Attack in newFeatures',
    f5.newFeatures.some(f => f.name === 'Extra Attack'));
  assert('Fighter 5: no ASI', f5.abilityScoreImprovement === undefined);
}

{
  // 5→6: ASI (Fighter extra)
  const f6 = applyLevelUp(levelTo(makeFighter(), 5), 'Fighter');
  assert('Fighter 6: ASI available', f6.abilityScoreImprovement === true);
}

// =============================================================
// 6. Rogue resources & features
// =============================================================

console.log('\n=== 6. Rogue Resources & Features ===\n');

{
  // 1→2: Cunning Action, sneak attack stays 1d6
  const r2 = applyLevelUp(makeRogue(), 'Rogue');
  eq('Rogue 2: sneakAttackDice = 1d6', r2.sheet.resources.sneakAttackDice, '1d6');
  assert('Rogue 2: cunningAction = true', r2.sheet.resources.cunningAction === true);
  assert('Rogue 2: Cunning Action in newFeatures',
    r2.newFeatures.some(f => f.name === 'Cunning Action'));
}

{
  // 2→3: sneak attack becomes 2d6, subclass prompt
  const r3 = applyLevelUp(levelTo(makeRogue(), 2), 'Rogue');
  eq('Rogue 3: sneakAttackDice = 2d6', r3.sheet.resources.sneakAttackDice, '2d6');
  eq('Rogue 3: subclass prompt', r3.subclassPrompt, 'Rogue');
}

{
  // 4→5: sneak attack becomes 3d6, Uncanny Dodge
  const r5 = applyLevelUp(levelTo(makeRogue(), 4), 'Rogue');
  eq('Rogue 5: sneakAttackDice = 3d6', r5.sheet.resources.sneakAttackDice, '3d6');
  assert('Rogue 5: Uncanny Dodge in newFeatures',
    r5.newFeatures.some(f => f.name === 'Uncanny Dodge'));
}

{
  // 9→10: sneak attack = 5d6, ASI (Rogue extra)
  const r10 = applyLevelUp(levelTo(makeRogue(), 9), 'Rogue');
  eq('Rogue 10: sneakAttackDice = 5d6', r10.sheet.resources.sneakAttackDice, '5d6');
  assert('Rogue 10: ASI available', r10.abilityScoreImprovement === true);
}

// =============================================================
// 7. Barbarian resources
// =============================================================

console.log('\n=== 7. Barbarian Resources ===\n');

{
  // 1→2: Reckless Attack, rage stays 2
  const b2 = applyLevelUp(makeBarbarian(), 'Barbarian');
  eq('Barbarian 2: rage max = 3', b2.sheet.resources.rage?.max, 3);
  assert('Barbarian 2: Reckless Attack in newFeatures',
    b2.newFeatures.some(f => f.name === 'Reckless Attack'));
}

{
  // 2→3: rage = 4, subclass prompt
  const b3 = applyLevelUp(levelTo(makeBarbarian(), 2), 'Barbarian');
  eq('Barbarian 3: rage max = 4', b3.sheet.resources.rage?.max, 4);
  eq('Barbarian 3: subclass prompt', b3.subclassPrompt, 'Barbarian');
}

{
  // 5→6: rage = 5
  const b6 = applyLevelUp(levelTo(makeBarbarian(), 5), 'Barbarian');
  eq('Barbarian 6: rage max = 5', b6.sheet.resources.rage?.max, 5);
}

{
  // 16→17: rage = unlimited (999)
  const b17 = applyLevelUp(levelTo(makeBarbarian(), 16), 'Barbarian');
  eq('Barbarian 17: rage max = 999 (unlimited)', b17.sheet.resources.rage?.max, 999);
}

// =============================================================
// 8. Paladin: Lay on Hands scaling & spell slots appearing
// =============================================================

console.log('\n=== 8. Paladin Resources & Spellcasting ===\n');

{
  // 1→2: Divine Smite + Fighting Style + Spellcasting; LOH pool = 10; slots appear
  const p2 = applyLevelUp(makePaladin(), 'Paladin');
  eq('Paladin 2: LOH pool = 10', p2.sheet.resources.layOnHands?.pool, 10);
  assert('Paladin 2: divineSmite = true', p2.sheet.resources.divineSmite === true);
  assert('Paladin 2: spellcasting initialised', p2.sheet.spellcasting !== undefined);
  eq('Paladin 2: 1st-level slots = 2', p2.sheet.spellcasting?.slots['1'], 2);
  assert('Paladin 2: ability = cha', p2.sheet.spellcasting?.ability === 'cha');
  assert('Paladin 2: spellcasting in newFeatures',
    p2.newFeatures.some(f => f.name === 'Spellcasting'));
}

{
  // 1→2→3: LOH = 15, subclass prompt (Sacred Oath)
  const p3 = applyLevelUp(levelTo(makePaladin(), 2), 'Paladin');
  eq('Paladin 3: LOH pool = 15', p3.sheet.resources.layOnHands?.pool, 15);
  eq('Paladin 3: subclass prompt = Paladin', p3.subclassPrompt, 'Paladin');
}

{
  // Paladin 5: Extra Attack, LOH = 25, slots = [4,2]
  const p5 = levelTo(makePaladin(), 5);
  eq('Paladin 5: LOH pool = 25', p5.resources.layOnHands?.pool, 25);
  eq('Paladin 5: 1st-level slots = 4', p5.spellcasting?.slots['1'], 4);
  eq('Paladin 5: 2nd-level slots = 2', p5.spellcasting?.slots['2'], 2);
  assert('Paladin 5: no 3rd-level slots', p5.spellcasting?.slots['3'] === undefined);
}

// =============================================================
// 9. Wizard spell slots
// =============================================================

console.log('\n=== 9. Wizard Spell Slots ===\n');

{
  // 1→2: no subclass yet; slots [3]
  const w2 = applyLevelUp(makeWizard(), 'Wizard');
  eq('Wizard 2: 1st-level slots = 3', w2.sheet.spellcasting?.slots['1'], 3);
  assert('Wizard 2: no 2nd-level slots', w2.sheet.spellcasting?.slots['2'] === undefined);
  eq('Wizard 2: subclass prompt = Wizard', w2.subclassPrompt, 'Wizard');
}

{
  // 1→2→3: slots [4,2]
  const w3 = levelTo(makeWizard(), 3);
  eq('Wizard 3: 1st-level slots = 4', w3.spellcasting?.slots['1'], 4);
  eq('Wizard 3: 2nd-level slots = 2', w3.spellcasting?.slots['2'], 2);
}

{
  // Wizard 5: slots [4,3,2]
  const w5 = levelTo(makeWizard(), 5);
  eq('Wizard 5: 1st-level slots = 4', w5.spellcasting?.slots['1'], 4);
  eq('Wizard 5: 2nd-level slots = 3', w5.spellcasting?.slots['2'], 3);
  eq('Wizard 5: 3rd-level slots = 2', w5.spellcasting?.slots['3'], 2);
}

{
  // Wizard 9: slots [4,3,3,3,1]
  const w9 = levelTo(makeWizard(), 9);
  eq('Wizard 9: 4th-level slots = 3', w9.spellcasting?.slots['4'], 3);
  eq('Wizard 9: 5th-level slots = 1', w9.spellcasting?.slots['5'], 1);
  assert('Wizard 9: no 6th-level slots', w9.spellcasting?.slots['6'] === undefined);
}

{
  // Proficiency bonus change at level 5 updates spell stats
  // Wizard 4: prof=2, INT=16→+3, spellAttackBonus=5, saveDC=13
  // Wizard 4→5: prof=3, spellAttackBonus should become 6, saveDC=14
  const w4  = levelTo(makeWizard(), 4);
  const w5r = applyLevelUp(w4, 'Wizard');
  eq('Wizard 5: spellAttackBonus = 6', w5r.sheet.spellcasting?.spellAttackBonus, 6);
  eq('Wizard 5: saveDC = 14', w5r.sheet.spellcasting?.saveDC, 14);
}

// =============================================================
// 10. Bard resources
// =============================================================

console.log('\n=== 10. Bard Resources ===\n');

{
  // Bard level-1 sheet (CHA 15 → +2 mod)
  const bard1: CharacterSheet = {
    ...makeFighter(),
    firstClass: 'Bard',
    classLevels: [{ className: 'Bard', level: 1 }],
    hitDice: [{ className: 'Bard', dieSides: 8, total: 1, remaining: 1 }],
    resources: { bardicInspiration: { max: 2, remaining: 2, dieSides: 6 } },
    stats: { str: 10, dex: 14, con: 14, int: 12, wis: 12, cha: 15 },
    maxHP: 10, currentHP: 10,
    spellcasting: {
      ability: 'cha', spellAttackBonus: 4, saveDC: 12,
      slots: { '1': 2 }, slotsUsed: {},
      cantrips: ['Vicious Mockery'], knownSpells: ['Healing Word'], preparedSpells: [],
    },
  };

  // 1→5: Bardic Inspiration die becomes d8
  const bard5 = levelTo(bard1, 5);
  eq('Bard 5: bardicInspiration dieSides = 8', bard5.resources.bardicInspiration?.dieSides, 8);

  // 5→10: Bardic Inspiration die becomes d10
  const bard10 = levelTo(bard5, 10);
  eq('Bard 10: bardicInspiration dieSides = 10', bard10.resources.bardicInspiration?.dieSides, 10);
}

// =============================================================
// 11. Subclass already chosen — no re-prompt
// =============================================================

console.log('\n=== 11. No Duplicate Subclass Prompt ===\n');

{
  // Fighter 2→3 with subclass already chosen: no prompt
  const f2 = levelTo(makeFighter(), 2);
  f2.subclassChoices['Fighter'] = 'Champion';
  const f3 = applyLevelUp(f2, 'Fighter');
  assert('No subclass prompt when already chosen', f3.subclassPrompt === undefined);
}

// =============================================================
// 12. Proficiency bonus tier change
// =============================================================

console.log('\n=== 12. Proficiency Bonus Tier Change ===\n');

{
  // Level 4→5 crosses from prof 2 → prof 3
  const f4 = levelTo(makeFighter(), 4);
  const f5 = applyLevelUp(f4, 'Fighter');
  // Fighter has no spellcasting so we just verify total level
  eq('Level 5: totalLevel = 5', totalLevel(f5.sheet), 5);
  // Verify Wizard spell stats updated (tested in section 9)
}

// =============================================================
// 13. Multiclassing — adding a new class
// =============================================================

console.log('\n=== 13. Multiclassing ===\n');

{
  // Fighter 1 + Wizard 1 = standard caster level 1 → slots [2]
  const f1   = makeFighter();   // STR 17 meets Wizard prereq? No — Wizard needs INT 13
  // Use a fighter with INT 14
  const f1hi = makeFighter({
    stats: { str: 17, dex: 10, con: 16, int: 14, wis: 12, cha: 13 },
  });
  const fw   = applyLevelUp(f1hi, 'Wizard');
  eq('Fighter/Wizard 2: totalLevel = 2', totalLevel(fw.sheet), 2);
  eq('Fighter/Wizard: classLevels length = 2', fw.sheet.classLevels.length, 2);
  const wizEntry = fw.sheet.classLevels.find(cl => cl.className === 'Wizard');
  eq('Wizard entry level = 1', wizEntry?.level, 1);

  // Standard slots: 1 full-caster level → [2]
  eq('Fighter/Wizard: 1st-level slots = 2', fw.sheet.spellcasting?.slots['1'], 2);

  // Hit dice pool should have two entries
  eq('Fighter/Wizard: hitDice has 2 entries', fw.sheet.hitDice.length, 2);
  const wizHD = fw.sheet.hitDice.find(hd => hd.className === 'Wizard');
  eq('Wizard hit die sides = 6', wizHD?.dieSides, 6);
  eq('Wizard hit die total = 1', wizHD?.total, 1);
}

{
  // Paladin 2 multiclassing Fighter (meets STR prereq)
  const p2 = levelTo(makePaladin(), 2);
  const pf = applyLevelUp(p2, 'Fighter');
  eq('Paladin/Fighter totalLevel = 3', totalLevel(pf.sheet), 3);
  assert('Fighter entry added', pf.sheet.classLevels.some(cl => cl.className === 'Fighter'));
  // Paladin 2 is a half-caster; Fighter adds 0 caster levels
  // Paladin caster level contribution to combined = floor(2/2) = 1 → slots [2]
  // But since only half-caster class is Paladin and it now has a non-caster too,
  // we use combined caster level: floor(2/2) = 1 → FULL_CASTER_SLOTS[1] = [2]
  eq('Paladin/Fighter: 1st-level slots = 2', pf.sheet.spellcasting?.slots['1'], 2);
}

// =============================================================
// 14. Warlock Pact Magic
// =============================================================

console.log('\n=== 14. Warlock Pact Magic ===\n');

{
  const wk1: CharacterSheet = {
    ...makeFighter(),
    firstClass: 'Warlock',
    classLevels: [{ className: 'Warlock', level: 1 }],
    hitDice: [{ className: 'Warlock', dieSides: 8, total: 1, remaining: 1 }],
    resources: {},
    stats: { str: 10, dex: 12, con: 12, int: 12, wis: 11, cha: 16 },
    maxHP: 8, currentHP: 8,
    spellcasting: {
      ability: 'cha', spellAttackBonus: 5, saveDC: 13,
      slots: {}, slotsUsed: {},
      pactSlots: { slotLevel: 1, total: 1, used: 0 },
      cantrips: ['Eldritch Blast'], knownSpells: ['Hex'], preparedSpells: [],
    },
  };

  // Warlock 1→2: pact slots become [2 slots, L1]
  const wk2 = applyLevelUp(wk1, 'Warlock');
  eq('Warlock 2: pactSlots total = 2', wk2.sheet.spellcasting?.pactSlots?.total, 2);
  eq('Warlock 2: pactSlots slotLevel = 1', wk2.sheet.spellcasting?.pactSlots?.slotLevel, 1);

  // Warlock 2→3: pact slots become [2 slots, L2]
  const wk3 = applyLevelUp(wk2.sheet, 'Warlock');
  eq('Warlock 3: pactSlots slotLevel = 2', wk3.sheet.spellcasting?.pactSlots?.slotLevel, 2);

  // Warlock 10→11: pact slots become [3 slots, L5]
  const wk11 = levelTo(wk1, 11, 'Warlock');
  eq('Warlock 11: pactSlots total = 3', wk11.spellcasting?.pactSlots?.total, 3);
  eq('Warlock 11: pactSlots slotLevel = 5', wk11.spellcasting?.pactSlots?.slotLevel, 5);
}

// =============================================================
// 15. Error cases
// =============================================================

console.log('\n=== 15. Error Cases ===\n');

{
  // Unknown class
  let threw = false;
  try { applyLevelUp(makeFighter(), 'Dragonborn'); } catch { threw = true; }
  assert('Throws on unknown class', threw);
}

{
  // Level 20 cap
  const f20 = levelTo(makeFighter(), 20);
  let threw = false;
  try { applyLevelUp(f20, 'Fighter'); } catch { threw = true; }
  assert('Throws when already level 20', threw);
}

{
  // Multiclass prereq failure: Wizard needs INT 13; Fighter with INT 8 cannot
  let threw = false;
  try { applyLevelUp(makeFighter(), 'Wizard'); } catch { threw = true; }
  assert('Throws on multiclass prereq failure (INT 8 < 13 for Wizard)', threw);
}

{
  // Fighter prereq OR: STR 13 or DEX 13
  // Character with STR 8, DEX 8 cannot multiclass into Fighter
  const wLow = makeWizard({
    stats: { str: 8, dex: 8, con: 13, int: 16, wis: 12, cha: 10 },
  });
  let threw = false;
  try { applyLevelUp(wLow, 'Fighter'); } catch { threw = true; }
  assert('Throws: Fighter prereq fails (STR 8, DEX 8)', threw);

  // But DEX 14 alone satisfies Fighter prereq
  const wDex = makeWizard({
    stats: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 },
  });
  let noThrow = false;
  try { applyLevelUp(wDex, 'Fighter'); noThrow = true; } catch {}
  assert('Fighter prereq: DEX 14 satisfies OR condition', noThrow);
}

// =============================================================
// 16. Slot table unit tests (data integrity)
// =============================================================

console.log('\n=== 16. Slot Table Integrity ===\n');

{
  // Full caster table: 20 entries (index 0 unused)
  eq('FULL_CASTER_SLOTS has 21 entries (0..20)', FULL_CASTER_SLOTS.length, 21);
  assert('Level 1: 2 first-level slots', FULL_CASTER_SLOTS[1][0] === 2);
  assert('Level 3: 4+2 slots', FULL_CASTER_SLOTS[3][0] === 4 && FULL_CASTER_SLOTS[3][1] === 2);
  assert('Level 20: 9 slot levels', FULL_CASTER_SLOTS[20].length === 9);
  assert('Level 20: 4 first-level slots', FULL_CASTER_SLOTS[20][0] === 4);
}

{
  // Half caster table: Paladin level 1 = no slots
  eq('HALF_CASTER_SLOTS has 21 entries', HALF_CASTER_SLOTS.length, 21);
  eq('Paladin 1: no slots', HALF_CASTER_SLOTS[1].length, 0);
  eq('Paladin 2: 2 first-level slots', HALF_CASTER_SLOTS[2][0], 2);
  eq('Paladin 5: 4+2 slots', HALF_CASTER_SLOTS[5][0], 4);
  eq('Paladin 5: 2nd-level slots', HALF_CASTER_SLOTS[5][1], 2);
}

{
  // Warlock pact table
  eq('WARLOCK_PACT_SLOTS has 21 entries', WARLOCK_PACT_SLOTS.length, 21);
  assert('Warlock 1: 1 slot, L1', WARLOCK_PACT_SLOTS[1][0] === 1 && WARLOCK_PACT_SLOTS[1][1] === 1);
  assert('Warlock 11: 3 slots, L5', WARLOCK_PACT_SLOTS[11][0] === 3 && WARLOCK_PACT_SLOTS[11][1] === 5);
  assert('Warlock 17: 4 slots, L5', WARLOCK_PACT_SLOTS[17][0] === 4 && WARLOCK_PACT_SLOTS[17][1] === 5);
}

{
  // Artificer table (TCE p.17): spellcasting starts at lv1, unlike Paladin/Ranger
  eq('ARTIFICER_SLOTS has 21 entries', ARTIFICER_SLOTS.length, 21);
  eq('Artificer 1: 2 first-level slots', ARTIFICER_SLOTS[1][0], 2);
  eq('Artificer 4: still 3 first-level slots, no 2nd yet', ARTIFICER_SLOTS[4].length, 1);
  eq('Artificer 5: 4+2 slots', ARTIFICER_SLOTS[5][0], 4);
  eq('Artificer 5: 2nd-level slots', ARTIFICER_SLOTS[5][1], 2);
  eq('Artificer 17: reaches 5th-level slots', ARTIFICER_SLOTS[17].length, 5);
  eq('Artificer 17: 1 fifth-level slot', ARTIFICER_SLOTS[17][4], 1);
  eq('Artificer 20: 4,3,3,3,2', JSON.stringify(ARTIFICER_SLOTS[20]), JSON.stringify([4,3,3,3,2]));
}

{
  // computeStandardSlots: full caster
  const slotsWiz1 = computeStandardSlots([{ className: 'Wizard', level: 1 }]);
  eq('computeStandardSlots Wizard 1: 1st=2', slotsWiz1['1'], 2);

  // Half caster alone uses half-caster table
  const slotsPal5 = computeStandardSlots([{ className: 'Paladin', level: 5 }]);
  eq('computeStandardSlots Paladin 5: 1st=4', slotsPal5['1'], 4);
  eq('computeStandardSlots Paladin 5: 2nd=2', slotsPal5['2'], 2);

  // Paladin 2 alone: [2]
  const slotsPal2 = computeStandardSlots([{ className: 'Paladin', level: 2 }]);
  eq('computeStandardSlots Paladin 2: 1st=2', slotsPal2['1'], 2);

  // Paladin 1 alone: no slots
  const slotsPal1 = computeStandardSlots([{ className: 'Paladin', level: 1 }]);
  eq('computeStandardSlots Paladin 1: no slots', Object.keys(slotsPal1).length, 0);

  // Fighter alone: no slots
  const slotsF = computeStandardSlots([{ className: 'Fighter', level: 5 }]);
  eq('computeStandardSlots Fighter: no slots', Object.keys(slotsF).length, 0);

  // Wizard 2 + Paladin 4: combined = 2 + floor(4/2) = 4 → [4,3]
  const slotsMix = computeStandardSlots([
    { className: 'Wizard', level: 2 },
    { className: 'Paladin', level: 4 },
  ]);
  eq('computeStandardSlots Wizard2+Paladin4: 1st=4', slotsMix['1'], 4);
  eq('computeStandardSlots Wizard2+Paladin4: 2nd=3', slotsMix['2'], 3);

  // Single-class Artificer uses the dedicated table, not the combined formula
  const slotsArt1 = computeStandardSlots([{ className: 'Artificer', level: 1 }]);
  eq('computeStandardSlots Artificer 1: 1st=2', slotsArt1['1'], 2);

  const slotsArt5 = computeStandardSlots([{ className: 'Artificer', level: 5 }]);
  eq('computeStandardSlots Artificer 5: 1st=4', slotsArt5['1'], 4);
  eq('computeStandardSlots Artificer 5: 2nd=2', slotsArt5['2'], 2);

  // Artificer alongside a non-caster (Fighter): still uses the dedicated table
  const slotsArtFtr = computeStandardSlots([
    { className: 'Artificer', level: 3 },
    { className: 'Fighter', level: 2 },
  ]);
  eq('computeStandardSlots Artificer3+Fighter2: 1st=3', slotsArtFtr['1'], 3);

  // Artificer multiclassing: TCE p.11 — Artificer levels round UP (ceil),
  // unlike Paladin/Ranger which round down. Artificer 1 + Wizard 1:
  // combined = ceil(1/2) + 1 = 1 + 1 = 2 → FULL_CASTER_SLOTS[2] = [3]
  const slotsArtWiz = computeStandardSlots([
    { className: 'Artificer', level: 1 },
    { className: 'Wizard', level: 1 },
  ]);
  eq('computeStandardSlots Artificer1+Wizard1: 1st=3 (ceil rounding)', slotsArtWiz['1'], 3);

  // Artificer + Paladin (both half-casters, different rounding):
  // combined = ceil(3/2) + floor(2/2) = 2 + 1 = 3 → FULL_CASTER_SLOTS[3] = [4,2]
  const slotsArtPal = computeStandardSlots([
    { className: 'Artificer', level: 3 },
    { className: 'Paladin', level: 2 },
  ]);
  eq('computeStandardSlots Artificer3+Paladin2: 1st=4', slotsArtPal['1'], 4);
  eq('computeStandardSlots Artificer3+Paladin2: 2nd=2', slotsArtPal['2'], 2);
}

// =============================================================
// 17. allFeatures accumulation
// =============================================================

console.log('\n=== 17. allFeatures Accumulation ===\n');

{
  const f = makeFighter();
  const startCount = f.allFeatures.length;
  const f2 = applyLevelUp(f, 'Fighter');
  // Action Surge added
  assert('allFeatures grows on level up', f2.sheet.allFeatures.length > startCount);
  assert('newFeatures subset of allFeatures',
    f2.newFeatures.every(nf => f2.sheet.allFeatures.some(af => af.name === nf.name)));
  assert('old features still present',
    f2.sheet.allFeatures.some(af => af.name === 'Second Wind'));
}

// =============================================================
// 18. updatedAt changes
// =============================================================

console.log('\n=== 18. updatedAt ===\n');

{
  const f    = makeFighter();
  const orig = f.updatedAt;
  // Tiny sleep to ensure timestamp differs
  const res  = applyLevelUp(f, 'Fighter');
  // updatedAt should be a valid ISO string (may be equal if same ms, just check format)
  assert('updatedAt is ISO string', /^\d{4}-\d{2}-\d{2}T/.test(res.sheet.updatedAt));
  assert('id unchanged', res.sheet.id === f.id);
  assert('firstClass unchanged', res.sheet.firstClass === f.firstClass);
}

// =============================================================
// 19. popLevel — stack reversal
// =============================================================

console.log('\n=== 19. popLevel — Stack Reversal ===\n');

{
  // --- 19a. levelHistory is populated by applyLevelUp ----------
  const f1 = makeFighter();
  assert('f1 levelHistory empty', (f1.levelHistory ?? []).length === 0);
  const { sheet: f2 } = applyLevelUp(f1, 'Fighter');
  eq('f2 levelHistory length = 1', f2.levelHistory?.length, 1);
  eq('record.className = Fighter', f2.levelHistory?.[0].className, 'Fighter');
  eq('record.classLevel = 2', f2.levelHistory?.[0].classLevel, 2);
  eq('record.totalLevelAfter = 2', f2.levelHistory?.[0].totalLevelAfter, 2);
  assert('record.hpGained > 0', (f2.levelHistory?.[0].hpGained ?? 0) > 0);
}

{
  // --- 19b. popLevel reverses HP --------------------------------
  const f1 = makeFighter();
  const { sheet: f2 } = applyLevelUp(f1, 'Fighter');
  const hpBefore = f1.maxHP;
  const hpAfter  = f2.maxHP;
  assert('level-up increased maxHP', hpAfter > hpBefore);

  const { sheet: popped } = popLevel(f2);
  eq('popped maxHP equals original', popped.maxHP, hpBefore);
  assert('popped currentHP <= maxHP', popped.currentHP <= popped.maxHP);
  eq('popped levelHistory empty', popped.levelHistory?.length, 0);
}

{
  // --- 19c. popLevel reverts classLevels -----------------------
  const f1 = makeFighter();
  const { sheet: f2 } = applyLevelUp(f1, 'Fighter');
  eq('f2 Fighter level = 2', f2.classLevels.find(c => c.className === 'Fighter')?.level, 2);
  const { sheet: popped } = popLevel(f2);
  eq('popped Fighter level = 1', popped.classLevels.find(c => c.className === 'Fighter')?.level, 1);
  eq('totalLevel after pop = 1', totalLevel(popped), 1);
}

{
  // --- 19d. popLevel reverts hitDice ----------------------------
  const f1 = makeFighter();
  const { sheet: f2 } = applyLevelUp(f1, 'Fighter');
  eq('f2 hitDice total = 2', f2.hitDice.find(h => h.className === 'Fighter')?.total, 2);
  const { sheet: popped } = popLevel(f2);
  eq('popped hitDice total = 1', popped.hitDice.find(h => h.className === 'Fighter')?.total, 1);
}

{
  // --- 19e. popLevel removes added features --------------------
  const f1 = makeFighter();
  const { sheet: f2, newFeatures } = applyLevelUp(f1, 'Fighter'); // adds Action Surge (1/rest)
  assert('Action Surge (1/rest) in f2.allFeatures',
    f2.allFeatures.some(af => af.name === 'Action Surge (1/rest)'));
  assert('newFeatures non-empty', newFeatures.length > 0);

  const { sheet: popped } = popLevel(f2);
  assert('Action Surge removed from popped',
    !popped.allFeatures.some(af => af.name === 'Action Surge (1/rest)'));
  assert('Second Wind still present',
    popped.allFeatures.some(af => af.name === 'Second Wind'));
}

{
  // --- 19f. popLevel reverts resources -------------------------
  const f1 = makeFighter();
  // Level to Barbarian 1 + Barbarian 2 (rage changes from 2 to 3)
  const bar1 = makeFighter({
    firstClass: 'Barbarian',
    classLevels: [{ className: 'Barbarian', level: 1 }],
    hitDice: [{ className: 'Barbarian', dieSides: 12, total: 1, remaining: 1 }],
    resources: { rage: { max: 2, remaining: 2 } },
    maxHP: 15, currentHP: 15,
  });
  const { sheet: bar2 } = applyLevelUp(bar1, 'Barbarian');
  eq('Barbarian 2 rage max = 3', bar2.resources.rage?.max, 3);
  const { sheet: popped } = popLevel(bar2);
  eq('popped rage max = 2', popped.resources.rage?.max, 2);
}

{
  // --- 19g. popLevel ASI reversal ------------------------------
  const f1 = makeFighter();
  // Level to 4 (Fighter 4 grants ASI)
  let sheet = f1;
  for (let i = 0; i < 3; i++) sheet = applyLevelUp(sheet, 'Fighter').sheet;
  eq('Fighter 4 pendingASI = 1', sheet.pendingAbilityScoreImprovements, 1);
  eq('levelHistory length = 3', sheet.levelHistory?.length, 3);

  const { sheet: popped } = popLevel(sheet);
  eq('popped back to level 3', totalLevel(popped), 3);
  eq('pendingASI restored to 0', popped.pendingAbilityScoreImprovements, 0);
}

{
  // --- 19h. popLevel with new multiclass class -----------------
  // Fighter with DEX 14 can multiclass into Rogue (requires DEX 13)
  const f1 = makeFighter({ stats: { str: 15, dex: 14, con: 16, int: 8, wis: 12, cha: 10 } });
  // fighter 1 → add Rogue 1 (new class)
  const { sheet: f1r1 } = applyLevelUp(f1, 'Rogue');
  eq('classLevels length = 2', f1r1.classLevels.length, 2);
  assert('Rogue entry exists', f1r1.classLevels.some(c => c.className === 'Rogue'));

  const { sheet: popped } = popLevel(f1r1);
  eq('classLevels length = 1 after pop', popped.classLevels.length, 1);
  assert('Rogue entry removed', !popped.classLevels.some(c => c.className === 'Rogue'));
  assert('Fighter entry still present', popped.classLevels.some(c => c.className === 'Fighter'));
}

{
  // --- 19i. popLevel error on empty history --------------------
  const f1 = makeFighter();
  let threw = false;
  try { popLevel(f1); } catch { threw = true; }
  assert('popLevel throws on empty history', threw);
}

{
  // --- 19j. multiple pops (3→2→1) ----------------------------
  const f1 = makeFighter();
  const f2 = applyLevelUp(f1, 'Fighter').sheet;
  const f3 = applyLevelUp(f2, 'Fighter').sheet;
  eq('f3 totalLevel = 3', totalLevel(f3), 3);

  const p2 = popLevel(f3).sheet;
  eq('p2 totalLevel = 2', totalLevel(p2), 2);
  eq('p2 levelHistory length = 1', p2.levelHistory?.length, 1);

  const p1 = popLevel(p2).sheet;
  eq('p1 totalLevel = 1', totalLevel(p1), 1);
  eq('p1 levelHistory empty', p1.levelHistory?.length, 0);
  eq('p1 maxHP = f1 maxHP', p1.maxHP, f1.maxHP);
}

// ---- Section 20: bootstrapLevelHistory ----------------------

{
  // --- 20a. level-1 character returns empty history (no-op) ---
  const f1 = makeFighter();
  const result = bootstrapLevelHistory(f1);
  eq('bootstrap lv1: totalLevel unchanged', totalLevel(result), 1);
  eq('bootstrap lv1: history is empty', result.levelHistory?.length, 0);
}

{
  // --- 20b. throws if history already present -----------------
  const f1 = makeFighter();
  const f2 = applyLevelUp(f1, 'Fighter').sheet;
  let threw = false;
  try { bootstrapLevelHistory(f2); } catch { threw = true; }
  assert('bootstrap throws when history already present', threw);
}

{
  // --- 20c. single-class Fighter 5 — produces correct record count ---
  const base = makeFighter();
  // Build a legacy level-5 char (strip history to simulate legacy)
  let sheet = base;
  for (let i = 0; i < 4; i++) sheet = applyLevelUp(sheet, 'Fighter').sheet;
  const legacyLv5 = { ...sheet, levelHistory: [] };  // strip history

  const bootstrapped = bootstrapLevelHistory(legacyLv5);
  eq('bootstrap F5: 4 records', bootstrapped.levelHistory?.length, 4);
  eq('bootstrap F5: totalLevel still 5', totalLevel(bootstrapped), 5);
}

{
  // --- 20d. bootstrapped records allow popLevel to work -------
  const base = makeFighter();
  let sheet = base;
  for (let i = 0; i < 3; i++) sheet = applyLevelUp(sheet, 'Fighter').sheet;
  const legacyLv4 = { ...sheet, levelHistory: [] };

  const bootstrapped = bootstrapLevelHistory(legacyLv4);
  eq('before pop: totalLevel 4', totalLevel(bootstrapped), 4);

  const { sheet: popped } = popLevel(bootstrapped);
  eq('after pop: totalLevel 3', totalLevel(popped), 3);
  eq('after pop: history length 2', popped.levelHistory?.length, 2);
}

{
  // --- 20e. bootstrapped records do NOT revert stats (ASI preservation) ---
  // Simulate a char who received an ASI: bump STR before stripping history.
  const base = makeFighter();
  let sheet = base;
  for (let i = 0; i < 3; i++) sheet = applyLevelUp(sheet, 'Fighter').sheet;
  // Manually apply an ASI to STR (simulating applyASI having run)
  const modifiedStats = { ...sheet.stats, str: sheet.stats.str + 2 };
  const legacyWithASI = { ...sheet, stats: modifiedStats, levelHistory: [] };

  const bootstrapped = bootstrapLevelHistory(legacyWithASI);
  const { sheet: popped } = popLevel(bootstrapped);
  // Stats must NOT be reverted — statsBefore was frozen to current stats
  eq('pop preserves ASI-modified STR', popped.stats.str, modifiedStats.str);
}

{
  // --- 20f. throws for multiclassed legacy character ----------
  const f1 = makeFighter({ stats: { str: 15, dex: 14, con: 16, int: 8, wis: 12, cha: 10 } });
  const { sheet: f1r1 } = applyLevelUp(f1, 'Rogue');
  const legacyMulti = { ...f1r1, levelHistory: [] };

  let threw = false;
  try { bootstrapLevelHistory(legacyMulti); } catch { threw = true; }
  assert('bootstrap throws for multiclass', threw);
}

{
  // --- 20g. Wizard 3 bootstrap — spell slots appear correctly ---
  const wiz = makeWizard();
  let sheet = wiz;
  for (let i = 0; i < 2; i++) sheet = applyLevelUp(sheet, 'Wizard').sheet;
  const legacyWiz3 = { ...sheet, levelHistory: [] };

  const bootstrapped = bootstrapLevelHistory(legacyWiz3);
  eq('wizard bootstrap: 2 records', bootstrapped.levelHistory?.length, 2);
  // Pop once → should be a Wizard 2 state on the stack
  const { sheet: wiz2 } = popLevel(bootstrapped);
  eq('wiz pop to level 2', totalLevel(wiz2), 2);
}


// =============================================================
// 21. New class resources — Action Surge, Sorcery Points, Wild Shape
// =============================================================

{
  // --- 21a. Fighter level 1 has NO actionSurge ---
  const f1 = makeFighter();
  assert('fighter lv1: no actionSurge', f1.resources.actionSurge === undefined);
}

{
  // --- 21b. Fighter level 2 gains Action Surge (1 use) ---
  const f1 = makeFighter();
  const { sheet: f2 } = applyLevelUp(f1, 'Fighter');
  assert('fighter lv2: actionSurge exists', f2.resources.actionSurge !== undefined);
  eq('fighter lv2: actionSurge max=1', f2.resources.actionSurge!.max, 1);
  eq('fighter lv2: actionSurge remaining=1', f2.resources.actionSurge!.remaining, 1);
}

{
  // --- 21c. Fighter level 17 gets 2 Action Surges ---
  let sheet = makeFighter();
  for (let i = 1; i < 17; i++) sheet = applyLevelUp(sheet, 'Fighter').sheet;
  eq('fighter lv17: actionSurge max=2', sheet.resources.actionSurge!.max, 2);
}

{
  // --- 21d. Sorcerer level 1 has no sorceryPoints ---
  assert('sorcerer lv1: no sorceryPoints', makeSorcerer().resources.sorceryPoints === undefined);
}

{
  // --- 21e. Sorcerer level 2 gains Sorcery Points = 2 ---
  const { sheet: s2 } = applyLevelUp(makeSorcerer(), 'Sorcerer');
  assert('sorcerer lv2: sorceryPoints exists', s2.resources.sorceryPoints !== undefined);
  eq('sorcerer lv2: sorceryPoints max=2', s2.resources.sorceryPoints!.max, 2);
  eq('sorcerer lv2: sorceryPoints remaining=2', s2.resources.sorceryPoints!.remaining, 2);
}

{
  // --- 21f. Sorcerer level 5 has 5 Sorcery Points ---
  let sheet = levelTo(makeSorcerer(), 5, 'Sorcerer');
  eq('sorcerer lv5: sorceryPoints max=5', sheet.resources.sorceryPoints!.max, 5);
}

{
  // --- 21g. Druid level 1 has no wildShape ---
  assert('druid lv1: no wildShape', makeDruid().resources.wildShape === undefined);
}

{
  // --- 21h. Druid level 2 gains Wild Shape (2 uses) ---
  const { sheet: d2 } = applyLevelUp(applyLevelUp(makeDruid(), 'Druid').sheet, 'Druid');
  assert('druid lv2: wildShape exists', d2.resources.wildShape !== undefined);
  eq('druid lv2: wildShape max=2', d2.resources.wildShape!.max, 2);
  eq('druid lv2: wildShape remaining=2', d2.resources.wildShape!.remaining, 2);
}

{
  // --- 21i. Druid level 5 still has 2 Wild Shape uses ---
  let sheet = levelTo(makeDruid(), 5, 'Druid');
  eq('druid lv5: wildShape max=2', sheet.resources.wildShape!.max, 2);
}

{
  // --- 21j. popLevel removes Action Surge when reverting Fighter lv2 ---
  const f1 = makeFighter();
  const { sheet: f2 } = applyLevelUp(f1, 'Fighter');
  const { sheet: f1again } = popLevel(f2);
  assert('fighter pop lv2: actionSurge removed', f1again.resources.actionSurge === undefined);
}

// =============================================================
// 22. Subclass prompt tests — Sorcerer, Druid, Ranger
// =============================================================

console.log('\n=== 22. Subclass prompts (Sorcerer / Druid / Ranger) ===\n');

{
  // --- 22a. Sorcerer level 1 triggers subclass prompt (PHB p.99 — Origin chosen at lv1) ---
  // The factory starts at lv1, so the prompt fires during that first applyLevelUp.
  // We check via a fresh lv0-like sheet to simulate first level-up.
  const base = makeSorcerer();
  // Sorcerer SUBCLASS_LEVEL = 1, so a fresh lv1 sheet should already have
  // the prompt; simulate by starting from a pre-lv1 state.
  // Instead: verify the prompt fires when subclassChoices is empty at lv1.
  const lv1NoChoice = { ...base, classLevels: [{ className: 'Sorcerer', level: 0 }], subclassChoices: {} };
  const { subclassPrompt } = applyLevelUp(lv1NoChoice as CharacterSheet, 'Sorcerer');
  eq('Sorcerer lv1: subclass prompt = Sorcerer', subclassPrompt, 'Sorcerer');
}

{
  // --- 22b. Sorcerer lv1 with subclass already chosen: no prompt ---
  const base = makeSorcerer();
  const lv1NoChoice = { ...base, classLevels: [{ className: 'Sorcerer', level: 0 }], subclassChoices: { Sorcerer: 'Wild Magic' } };
  const { subclassPrompt } = applyLevelUp(lv1NoChoice as CharacterSheet, 'Sorcerer');
  assert('Sorcerer lv1 already chosen: no prompt', subclassPrompt === undefined);
}

{
  // --- 22c. Druid level 1→2 triggers Circle subclass prompt (PHB p.67) ---
  const { subclassPrompt } = applyLevelUp(makeDruid(), 'Druid');
  eq('Druid lv2: subclass prompt = Druid', subclassPrompt, 'Druid');
}

{
  // --- 22d. Druid lv1 does not trigger prompt ---
  const d0 = { ...makeDruid(), classLevels: [{ className: 'Druid', level: 0 }], subclassChoices: {} };
  // lv0→lv1: subclass level is 2, so no prompt yet
  const { subclassPrompt } = applyLevelUp(d0 as CharacterSheet, 'Druid');
  assert('Druid lv1: no subclass prompt', subclassPrompt === undefined);
}

{
  // --- 22e. Druid lv2 with subclass already chosen: no prompt ---
  const d1 = { ...makeDruid(), subclassChoices: { Druid: 'Circle of the Moon' } };
  const { subclassPrompt } = applyLevelUp(d1, 'Druid');
  assert('Druid lv2 already chosen: no prompt', subclassPrompt === undefined);
}

{
  // --- 22f. Ranger lv1→2: no subclass prompt (archetype at lv3) ---
  const { subclassPrompt: p2 } = applyLevelUp(makeRanger(), 'Ranger');
  assert('Ranger lv2: no subclass prompt', p2 === undefined);
}

{
  // --- 22g. Ranger lv2→3: subclass prompt fires (PHB p.92 — Ranger Archetype) ---
  const r2 = levelTo(makeRanger(), 2, 'Ranger');
  const { subclassPrompt } = applyLevelUp(r2, 'Ranger');
  eq('Ranger lv3: subclass prompt = Ranger', subclassPrompt, 'Ranger');
}

{
  // --- 22h. Ranger lv3 with subclass already chosen: no prompt ---
  const r2 = levelTo(makeRanger(), 2, 'Ranger');
  const r2chosen = { ...r2, subclassChoices: { Ranger: 'Hunter' } };
  const { subclassPrompt } = applyLevelUp(r2chosen, 'Ranger');
  assert('Ranger lv3 already chosen: no prompt', subclassPrompt === undefined);
}


{
  // --- 22i. Bard lv1→2: no subclass prompt guard (Bard College at lv3, PHB p.54) ---
  const { subclassPrompt } = applyLevelUp(makeBard(), 'Bard');
  assert('Bard lv2: no subclass prompt', subclassPrompt === undefined);
}

{
  // --- 22j. Bard lv2→3: subclass prompt fires (PHB p.54 — Bard College) ---
  const b2 = levelTo(makeBard(), 2, 'Bard');
  const { subclassPrompt } = applyLevelUp(b2, 'Bard');
  eq('Bard lv3: subclass prompt = Bard', subclassPrompt, 'Bard');
}

{
  // --- 22k. Bard lv3 with college already chosen: no prompt ---
  const b2 = levelTo(makeBard(), 2, 'Bard');
  const b2chosen = { ...b2, subclassChoices: { Bard: 'College of Lore' } };
  const { subclassPrompt } = applyLevelUp(b2chosen, 'Bard');
  assert('Bard lv3 already chosen: no prompt', subclassPrompt === undefined);
}

{
  // --- 22l. Cleric lv0→1: subclass prompt fires (PHB p.56 — Divine Domain) ---
  const lv0 = { ...makeCleric(), classLevels: [{ className: 'Cleric' as const, level: 0 }], subclassChoices: {} };
  const { subclassPrompt } = applyLevelUp(lv0 as CharacterSheet, 'Cleric');
  eq('Cleric lv1: subclass prompt = Cleric', subclassPrompt, 'Cleric');
}

{
  // --- 22m. Cleric lv0→1 with domain already chosen: no prompt ---
  const lv0chosen = { ...makeCleric(), classLevels: [{ className: 'Cleric' as const, level: 0 }], subclassChoices: { Cleric: 'Life' } };
  const { subclassPrompt } = applyLevelUp(lv0chosen as CharacterSheet, 'Cleric');
  assert('Cleric lv1 already chosen: no prompt', subclassPrompt === undefined);
}

{
  // --- 22n. Monk lv1→2: no subclass prompt (Monastic Tradition at lv3, PHB p.78) ---
  const { subclassPrompt } = applyLevelUp(makeMonk(), 'Monk');
  assert('Monk lv2: no subclass prompt', subclassPrompt === undefined);
}

{
  // --- 22o. Monk lv2→3: subclass prompt fires (PHB p.78 — Monastic Tradition) ---
  const m2 = levelTo(makeMonk(), 2, 'Monk');
  const { subclassPrompt } = applyLevelUp(m2, 'Monk');
  eq('Monk lv3: subclass prompt = Monk', subclassPrompt, 'Monk');
}

{
  // --- 22p. Monk lv3 with tradition already chosen: no prompt ---
  const m2 = levelTo(makeMonk(), 2, 'Monk');
  const m2chosen = { ...m2, subclassChoices: { Monk: 'Way of the Open Hand' } };
  const { subclassPrompt } = applyLevelUp(m2chosen, 'Monk');
  assert('Monk lv3 already chosen: no prompt', subclassPrompt === undefined);
}

{
  // --- 22q. Warlock lv0→1: subclass prompt fires (PHB p.107 — Otherworldly Patron) ---
  const lv0 = { ...makeWarlock(), classLevels: [{ className: 'Warlock' as const, level: 0 }], subclassChoices: {} };
  const { subclassPrompt } = applyLevelUp(lv0 as CharacterSheet, 'Warlock');
  eq('Warlock lv1: subclass prompt = Warlock', subclassPrompt, 'Warlock');
}

{
  // --- 22r. Warlock lv0→1 with patron already chosen: no prompt ---
  const lv0chosen = { ...makeWarlock(), classLevels: [{ className: 'Warlock' as const, level: 0 }], subclassChoices: { Warlock: 'The Fiend' } };
  const { subclassPrompt } = applyLevelUp(lv0chosen as CharacterSheet, 'Warlock');
  assert('Warlock lv1 already chosen: no prompt', subclassPrompt === undefined);
}

// =============================================================
// 23. Artificer — spellcasting from lv1, ASI, subclass prompt, prereq
// =============================================================

console.log('\n=== 23. Artificer ===\n');

{
  // --- 23a. Artificer lv0→1: spellcasting is already active at level 1 (TCE p.16) ---
  const a0 = { ...makeArtificer(), classLevels: [{ className: 'Artificer' as const, level: 0 }], spellcasting: undefined };
  const { sheet } = applyLevelUp(a0 as CharacterSheet, 'Artificer');
  eq('Artificer lv1: 1st-level slots = 2', sheet.spellcasting?.slots['1'], 2);
  eq('Artificer lv1: spellcasting ability = int', sheet.spellcasting?.ability, 'int');
}

{
  // --- 23b. Artificer hit die is d8 ---
  const a0 = { ...makeArtificer(), classLevels: [{ className: 'Artificer' as const, level: 0 }], hitDice: [{ className: 'Artificer' as const, dieSides: 8, total: 0, remaining: 0 }] };
  const { sheet } = applyLevelUp(a0 as CharacterSheet, 'Artificer');
  const hd = sheet.hitDice.find(h => h.className === 'Artificer');
  eq('Artificer hit die sides = 8', hd?.dieSides, 8);
}

{
  // --- 23c. Artificer lv2→3: subclass prompt fires (TCE p.16 — Artificer Specialist) ---
  const a2 = levelTo(makeArtificer(), 2, 'Artificer');
  const { subclassPrompt } = applyLevelUp(a2, 'Artificer');
  eq('Artificer lv3: subclass prompt = Artificer', subclassPrompt, 'Artificer');
}

{
  // --- 23d. Artificer lv1→2: no subclass prompt yet ---
  const { subclassPrompt } = applyLevelUp(makeArtificer(), 'Artificer');
  assert('Artificer lv2: no subclass prompt', subclassPrompt === undefined);
}

{
  // --- 23e. Artificer lv3→4: ASI prompt (TCE p.16 — standard 4/8/12/16/19) ---
  const a3 = levelTo(makeArtificer(), 3, 'Artificer');
  const { abilityScoreImprovement } = applyLevelUp(a3, 'Artificer');
  assert('Artificer lv4: ASI available', abilityScoreImprovement === true);
}

{
  // --- 23f. Artificer 5: reaches 2nd-level spell slots ---
  const a5 = levelTo(makeArtificer(), 5, 'Artificer');
  eq('Artificer lv5: 1st-level slots = 4', a5.spellcasting?.slots['1'], 4);
  eq('Artificer lv5: 2nd-level slots = 2', a5.spellcasting?.slots['2'], 2);
}

{
  // --- 23g. Multiclass prereq: Artificer requires INT 13 (TCE p.10) ---
  let threw = false;
  try { applyLevelUp(makeFighter(), 'Artificer'); } catch { threw = true; }
  assert('Throws on multiclass prereq failure (INT 8 < 13 for Artificer)', threw);

  const fHighInt = makeFighter({ stats: { str: 17, dex: 10, con: 16, int: 14, wis: 12, cha: 13 } });
  let noThrow = false;
  try { applyLevelUp(fHighInt, 'Artificer'); noThrow = true; } catch {}
  assert('Multiclass into Artificer succeeds with INT 14', noThrow);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
