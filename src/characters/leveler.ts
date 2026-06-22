// ============================================================
// Character Level-Up Logic
// D&D 5e Combat Sim — PHB 2014 / MM 2014 / SAC v2.7
//
// applyLevelUp() advances a CharacterSheet by one level.
// Returns a new sheet (the original is never mutated).
//
// Scope:
//   - HP per level (average or max)
//   - classLevels, hitDice pool
//   - Resources scaled to new level
//   - Spell slots (standard casters & half-casters)
//   - Warlock Pact Magic
//   - New feature notifications
//   - ASI flag and subclass prompts
//   - Multiclass prerequisite checking
// ============================================================

import type { AbilityScore } from '../types/core';
import {
  CharacterSheet,
  CharacterFeature,
  CharacterResources,
  SpellcastingInfo,
  ClassLevel,
  ClassName,
  LevelRecord,
  CLASS_HIT_DICE,
  MULTICLASS_PREREQS,
  PROFICIENCY_BONUS_TABLE,
  totalLevel,
  abilityModifier,
} from './types';
import { getFeat } from './feat_data';

// ---- Public types -------------------------------------------

export interface LevelUpResult {
  /** Updated CharacterSheet (new object; original is unmodified). */
  sheet: CharacterSheet;
  /** HP gained from this level-up. Always ≥ 1. */
  hpGained: number;
  /** Features gained at this level. Also appended to sheet.allFeatures. */
  newFeatures: CharacterFeature[];
  /**
   * If set, this level triggers a subclass selection for the named class.
   * Caller should prompt the player and set sheet.subclassChoices[subclassPrompt].
   */
  subclassPrompt?: string;
  /**
   * If set, the character has an Ability Score Improvement available.
   * Caller should prompt the player and update sheet.stats.
   */
  abilityScoreImprovement?: true;
}

// ---- Constants ----------------------------------------------

const VALID_CLASSES = new Set<ClassName>([
  'Artificer','Barbarian','Bard','Cleric','Druid','Fighter','Monk',
  'Paladin','Ranger','Rogue','Sorcerer','Warlock','Wizard',
]);

/**
 * PHB multiclass spell slot table (p.165).
 * Index = combined caster level (1–20). Element = slots per spell level.
 * Used for full casters and multiclass combinations.
 */
const FULL_CASTER_SLOTS: number[][] = [
  /* 0  */ [],
  /* 1  */ [2],
  /* 2  */ [3],
  /* 3  */ [4,2],
  /* 4  */ [4,3],
  /* 5  */ [4,3,2],
  /* 6  */ [4,3,3],
  /* 7  */ [4,3,3,1],
  /* 8  */ [4,3,3,2],
  /* 9  */ [4,3,3,3,1],
  /* 10 */ [4,3,3,3,2],
  /* 11 */ [4,3,3,3,2,1],
  /* 12 */ [4,3,3,3,2,1],
  /* 13 */ [4,3,3,3,2,1,1],
  /* 14 */ [4,3,3,3,2,1,1],
  /* 15 */ [4,3,3,3,2,1,1,1],
  /* 16 */ [4,3,3,3,2,1,1,1],
  /* 17 */ [4,3,3,3,2,1,1,1,1],
  /* 18 */ [4,3,3,3,3,1,1,1,1],
  /* 19 */ [4,3,3,3,3,2,1,1,1],
  /* 20 */ [4,3,3,3,3,2,2,1,1],
];

/**
 * Half-caster slot table for single-class Paladin / Ranger (PHB pp.84,92).
 * Index = class level (1–20).
 */
const HALF_CASTER_SLOTS: number[][] = [
  /* 0  */ [],
  /* 1  */ [],          // no spellcasting at level 1
  /* 2  */ [2],
  /* 3  */ [3],
  /* 4  */ [3],
  /* 5  */ [4,2],
  /* 6  */ [4,2],
  /* 7  */ [4,3],
  /* 8  */ [4,3],
  /* 9  */ [4,3,2],
  /* 10 */ [4,3,2],
  /* 11 */ [4,3,3],
  /* 12 */ [4,3,3],
  /* 13 */ [4,3,3,1],
  /* 14 */ [4,3,3,1],
  /* 15 */ [4,3,3,2],
  /* 16 */ [4,3,3,2],
  /* 17 */ [4,3,3,3,1],
  /* 18 */ [4,3,3,3,1],
  /* 19 */ [4,3,3,3,2],
  /* 20 */ [4,3,3,3,2],
];

/**
 * Half-caster slot table for single-class Artificer (TCE p.17).
 * Index = artificer level (1–20). Unlike Paladin/Ranger, the Artificer
 * gains spellcasting at 1st level instead of 2nd — this table is the
 * Paladin/Ranger progression shifted one level earlier, capped at the
 * same 5th-level-spell ceiling.
 */
const ARTIFICER_SLOTS: number[][] = [
  /* 0  */ [],
  /* 1  */ [2],
  /* 2  */ [2],
  /* 3  */ [3],
  /* 4  */ [3],
  /* 5  */ [4,2],
  /* 6  */ [4,2],
  /* 7  */ [4,3],
  /* 8  */ [4,3],
  /* 9  */ [4,3,2],
  /* 10 */ [4,3,2],
  /* 11 */ [4,3,3],
  /* 12 */ [4,3,3],
  /* 13 */ [4,3,3,1],
  /* 14 */ [4,3,3,1],
  /* 15 */ [4,3,3,2],
  /* 16 */ [4,3,3,2],
  /* 17 */ [4,3,3,3,1],
  /* 18 */ [4,3,3,3,1],
  /* 19 */ [4,3,3,3,2],
  /* 20 */ [4,3,3,3,2],
];

/**
 * Warlock Pact Magic table (PHB p.108).
 * Index = warlock level (1–20). Value = [total slots, slot level].
 */
const WARLOCK_PACT_SLOTS: [number, number][] = [
  /* 0  */ [0, 0],
  /* 1  */ [1, 1],
  /* 2  */ [2, 1],
  /* 3  */ [2, 2],
  /* 4  */ [2, 2],
  /* 5  */ [2, 3],
  /* 6  */ [2, 3],
  /* 7  */ [2, 4],
  /* 8  */ [2, 4],
  /* 9  */ [2, 5],
  /* 10 */ [2, 5],
  /* 11 */ [3, 5],
  /* 12 */ [3, 5],
  /* 13 */ [3, 5],
  /* 14 */ [3, 5],
  /* 15 */ [3, 5],
  /* 16 */ [3, 5],
  /* 17 */ [4, 5],
  /* 18 */ [4, 5],
  /* 19 */ [4, 5],
  /* 20 */ [4, 5],
];

/** Classes that contribute fully (1:1) to combined caster level. */
const FULL_CASTERS = new Set<ClassName>(['Bard','Cleric','Druid','Sorcerer','Wizard']);
/** Classes that contribute half their levels (rounded down) to combined caster level. */
const HALF_CASTERS = new Set<ClassName>(['Paladin','Ranger']);

/** Level at which each class gains its subclass (PHB; TCE for Artificer). */
const SUBCLASS_LEVELS: Record<ClassName, number> = {
  Cleric:    1,
  Sorcerer:  1,
  Warlock:   1,
  Druid:     2,
  Wizard:    2,
  Artificer: 3,
  Bard:      3,
  Barbarian: 3,
  Fighter:   3,
  Monk:      3,
  Paladin:   3,
  Ranger:    3,
  Rogue:     3,
};

/** Levels at which each class grants an ASI (PHB; TCE for Artificer). */
const ASI_LEVELS: Record<ClassName, ReadonlySet<number>> = {
  Artificer: new Set([4,8,12,16,19]),
  Barbarian: new Set([4,8,12,16,19]),
  Bard:      new Set([4,8,12,16,19]),
  Cleric:    new Set([4,8,12,16,19]),
  Druid:     new Set([4,8,12,16,19]),
  Fighter:   new Set([4,6,8,12,14,16,19]),
  Monk:      new Set([4,8,12,16,19]),
  Paladin:   new Set([4,8,12,16,19]),
  Ranger:    new Set([4,8,12,16,19]),
  Rogue:     new Set([4,8,10,12,16,19]),
  Sorcerer:  new Set([4,8,12,16,19]),
  Warlock:   new Set([4,8,12,16,19]),
  Wizard:    new Set([4,8,12,16,19]),
};

/** Spellcasting ability by class. */
const CASTING_ABILITY: Partial<Record<ClassName, AbilityScore>> = {
  Artificer: 'int',
  Bard:     'cha',
  Cleric:   'wis',
  Druid:    'wis',
  Paladin:  'cha',
  Ranger:   'wis',
  Sorcerer: 'cha',
  Warlock:  'cha',
  Wizard:   'int',
};

// ---- Feature table ------------------------------------------
// Mechanically significant class features by level.
// This is the "what the engine cares about" table, not a full
// PHB listing. Subclass features are summarised as prompts.

type RawFeature = { name: string; description: string; source: 'class' | 'subclass' };
type FeatureTable = Partial<Record<ClassName, Record<number, RawFeature[]>>>;

const CLASS_FEATURES: FeatureTable = {
  Artificer: {
    1:  [{ name: 'Magical Tinkering', source: 'class',    description: 'Imbue a Tiny nonmagical object you touch with one of several minor magical properties (light, message recording, sensory illusion, or odor/sound).' },
         { name: 'Spellcasting',      source: 'class',    description: 'Cast artificer spells using INT; gain spell slots.' }],
    2:  [{ name: 'Infuse Item',       source: 'class',    description: 'Learn infusions and imbue up to your maximum number of nonmagical objects with magical properties after a long rest.' }],
    3:  [{ name: 'Artificer Specialist', source: 'subclass', description: 'Choose your Artificer Specialist and gain its first feature.' },
         { name: 'The Right Tool for the Job', source: 'class', description: 'Use tinker\'s tools to magically create one set of artisan\'s tools in your hand (1 hour casting time).' }],
    6:  [{ name: 'Tool Expertise',    source: 'class',    description: 'Double your proficiency bonus for any check made with a tool you are proficient with.' }],
    7:  [{ name: 'Flash of Genius',   source: 'class',    description: 'As a reaction, add your INT modifier to an ability check or saving throw made by yourself or a creature within 30 ft (INT mod uses per long rest).' }],
    10: [{ name: 'Magic Item Adept', source: 'class',     description: 'Attune to up to 4 magic items at once; halve the gold and time needed to craft magic items.' }],
    11: [{ name: 'Spell-Storing Item', source: 'class',   description: 'Imbue an object with a 1st- or 2nd-level spell, usable by anyone holding it, twice per day.' }],
    14: [{ name: 'Magic Item Savant', source: 'class',    description: 'Attune to up to 5 magic items at once; ignore all class, race, and level requirements on attuning to or using a magic item.' }],
    18: [{ name: 'Magic Item Master', source: 'class',    description: 'Attune to up to 6 magic items at once.' }],
    20: [{ name: 'Soul of Artifice',  source: 'class',    description: 'Gain a +1 bonus to all saving throws per magic item you are attuned to; sacrifice an attuned magic item to avoid dropping to 0 HP, dropping to 1 HP instead (once per long rest).' }],
  },
  Barbarian: {
    2:  [{ name: 'Reckless Attack',   source: 'class',    description: 'Attack with advantage on STR melee attacks; attackers have advantage against you until your next turn.' },
         { name: 'Danger Sense',      source: 'class',    description: 'Advantage on DEX saving throws against effects you can see.' }],
    3:  [{ name: 'Primal Path',       source: 'subclass', description: 'Gain your Primal Path feature.' }],
    5:  [{ name: 'Extra Attack',      source: 'class',    description: 'Attack twice when you take the Attack action.' },
         { name: 'Fast Movement',     source: 'class',    description: 'Speed increases by 10 ft while not wearing heavy armor.' }],
    7:  [{ name: 'Feral Instinct',    source: 'class',    description: 'Advantage on initiative; can act on turn 1 even while surprised if you enter rage.' }],
    9:  [{ name: 'Brutal Critical',   source: 'class',    description: 'On a critical hit, roll one additional weapon damage die.' }],
    11: [{ name: 'Relentless Rage',   source: 'class',    description: 'While raging and reduced to 0 HP, make a CON save (DC 10 or half damage taken) to stay at 1 HP.' }],
    15: [{ name: 'Persistent Rage',   source: 'class',    description: 'Rage does not end early for failing to attack or take damage.' }],
    18: [{ name: 'Indomitable Might', source: 'class',    description: 'If your STR check is less than your STR score, use your STR score.' }],
    20: [{ name: 'Primal Champion',   source: 'class',    description: 'STR and CON each increase by 4.' }],
  },
  Bard: {
    2:  [{ name: 'Jack of All Trades', source: 'class',   description: 'Add half your proficiency bonus to ability checks you are not proficient in.' },
         { name: 'Song of Rest (d6)', source: 'class',    description: 'Allies who hear your performance regain 1d6 extra HP on a short rest.' }],
    3:  [{ name: 'Expertise (2)',      source: 'class',   description: 'Double your proficiency bonus for two additional skills.' },
         { name: 'Bard College',       source: 'subclass', description: 'Gain your Bard College feature.' }],
    5:  [{ name: 'Font of Inspiration', source: 'class',  description: 'Regain all Bardic Inspiration on a short or long rest.' }],
    6:  [{ name: 'Countercharm',       source: 'class',   description: 'Use an action to give nearby allies advantage on saves vs. charm and fear.' }],
    9:  [{ name: 'Song of Rest (d8)', source: 'class',    description: 'Song of Rest die becomes 1d8.' }],
    10: [{ name: 'Magical Secrets',    source: 'class',   description: 'Learn 2 spells from any class. These count as bard spells.' },
         { name: 'Expertise (2 more)', source: 'class',   description: 'Double proficiency for 2 more skills or tools.' }],
    13: [{ name: 'Song of Rest (d10)', source: 'class',   description: 'Song of Rest die becomes 1d10.' }],
    14: [{ name: 'Magical Secrets',    source: 'class',   description: 'Learn 2 more spells from any class.' }],
    17: [{ name: 'Song of Rest (d12)', source: 'class',   description: 'Song of Rest die becomes 1d12.' }],
    18: [{ name: 'Magical Secrets',    source: 'class',   description: 'Learn 2 more spells from any class.' }],
    20: [{ name: 'Superior Inspiration', source: 'class', description: 'Regain 1 Bardic Inspiration if you have none when rolling initiative.' }],
  },
  Cleric: {
    1:  [{ name: 'Divine Domain',      source: 'subclass', description: 'Choose your Divine Domain and gain its first feature.' }],
    2:  [{ name: 'Channel Divinity (1/rest)', source: 'class', description: 'Harness divine energy once per short/long rest for domain-specific effects.' }],
    5:  [{ name: 'Destroy Undead (CR 1/2)', source: 'class', description: 'Turn Undead automatically destroys undead of CR 1/2 or lower.' }],
    6:  [{ name: 'Channel Divinity (2/rest)', source: 'class', description: 'Channel Divinity can now be used twice per rest.' }],
    8:  [{ name: 'Destroy Undead (CR 1)', source: 'class', description: 'Turn Undead destroys creatures of CR 1 or lower.' }],
    10: [{ name: 'Divine Intervention', source: 'class',  description: 'Implore your deity for help once per week (DC = cleric level).' }],
    11: [{ name: 'Destroy Undead (CR 2)', source: 'class', description: 'Turn Undead destroys creatures of CR 2 or lower.' }],
    14: [{ name: 'Destroy Undead (CR 3)', source: 'class', description: 'Turn Undead destroys creatures of CR 3 or lower.' }],
    17: [{ name: 'Destroy Undead (CR 4)', source: 'class', description: 'Turn Undead destroys creatures of CR 4 or lower.' }],
    18: [{ name: 'Channel Divinity (3/rest)', source: 'class', description: 'Channel Divinity can now be used three times per rest.' }],
    20: [{ name: 'Divine Intervention (auto)', source: 'class', description: 'Divine Intervention now automatically succeeds.' }],
  },
  Druid: {
    2:  [{ name: 'Wild Shape (CR 1/4)', source: 'class',   description: 'Transform into a beast of CR 1/4 or lower (no fly/swim speed) as an action.' },
         { name: 'Druid Circle',        source: 'subclass', description: 'Gain your Druid Circle feature.' }],
    4:  [{ name: 'Wild Shape (CR 1/2, swim)', source: 'class', description: 'Wild Shape max CR 1/2; swim speed allowed.' }],
    8:  [{ name: 'Wild Shape (CR 1, fly)',    source: 'class', description: 'Wild Shape max CR 1; fly speed allowed.' }],
    18: [{ name: 'Timeless Body',       source: 'class',   description: 'Age 10× slower; immune to magical aging.' },
         { name: 'Beast Spells',        source: 'class',   description: 'Cast spells while in Wild Shape form.' }],
    20: [{ name: 'Archdruid',           source: 'class',   description: 'Unlimited Wild Shape uses.' }],
  },
  Fighter: {
    2:  [{ name: 'Action Surge (1/rest)', source: 'class', description: 'Take one additional action on your turn, once per short or long rest.' }],
    3:  [{ name: 'Martial Archetype',    source: 'subclass', description: 'Gain your Martial Archetype feature.' }],
    5:  [{ name: 'Extra Attack',         source: 'class',  description: 'Attack twice when you take the Attack action.' }],
    9:  [{ name: 'Indomitable (1/day)',  source: 'class',  description: 'Reroll a saving throw once per long rest, using the new result.' }],
    11: [{ name: 'Extra Attack (2)',     source: 'class',  description: 'Attack three times when you take the Attack action.' }],
    13: [{ name: 'Indomitable (2/day)', source: 'class',  description: 'Indomitable can be used twice per long rest.' }],
    17: [{ name: 'Action Surge (2/rest)', source: 'class', description: 'Action Surge can now be used twice per rest.' },
         { name: 'Indomitable (3/day)', source: 'class',  description: 'Indomitable can be used three times per long rest.' }],
    20: [{ name: 'Extra Attack (3)',     source: 'class',  description: 'Attack four times when you take the Attack action.' }],
  },
  Monk: {
    2:  [{ name: 'Ki',                  source: 'class',  description: 'Gain ki points equal to your monk level. Use for Flurry of Blows, Patient Defense, Step of the Wind.' },
         { name: 'Unarmored Movement',  source: 'class',  description: 'Speed increases by 10 ft while not wearing armor or a shield.' }],
    3:  [{ name: 'Deflect Missiles',    source: 'class',  description: 'Reaction to reduce ranged weapon damage; if reduced to 0, catch and throw it back (1 ki).' },
         { name: 'Monastic Tradition',  source: 'subclass', description: 'Gain your Monastic Tradition feature.' }],
    4:  [{ name: 'Slow Fall',           source: 'class',  description: 'Reaction to reduce fall damage by 5 × your monk level.' }],
    5:  [{ name: 'Extra Attack',        source: 'class',  description: 'Attack twice when you take the Attack action.' },
         { name: 'Stunning Strike',     source: 'class',  description: 'After hitting with a melee attack, spend 1 ki to force a CON save or stun until end of your next turn.' }],
    6:  [{ name: 'Ki-Empowered Strikes', source: 'class', description: 'Unarmed strikes count as magical for overcoming resistance.' }],
    7:  [{ name: 'Evasion',             source: 'class',  description: 'On a DEX save for half damage: no damage on success, half on failure.' },
         { name: 'Stillness of Mind',   source: 'class',  description: 'Use an action to end one charm or fear effect on yourself.' }],
    10: [{ name: 'Purity of Body',      source: 'class',  description: 'Immune to poison and disease.' }],
    13: [{ name: 'Tongue of the Sun and Moon', source: 'class', description: 'Understand all spoken languages; all creatures understand you.' }],
    14: [{ name: 'Diamond Soul',        source: 'class',  description: 'Proficiency in all saving throws; spend 1 ki to reroll a failed save.' }],
    15: [{ name: 'Timeless Body',       source: 'class',  description: 'Immune to magical aging; do not suffer the frailty of old age.' }],
    18: [{ name: 'Empty Body',          source: 'class',  description: 'Spend 4 ki to turn invisible and gain resistance to all but force damage (1 minute).' }],
    20: [{ name: 'Perfect Self',        source: 'class',  description: 'Regain 4 ki points if you have none when you roll initiative.' }],
  },
  Paladin: {
    2:  [{ name: 'Divine Smite',        source: 'class',  description: 'After a hit, expend a spell slot to deal 2d8 radiant damage per slot level (max 5d8).' },
         { name: 'Fighting Style',      source: 'class',  description: 'Choose a fighting style specialization.' },
         { name: 'Spellcasting',        source: 'class',  description: 'Cast paladin spells using CHA; gain spell slots.' }],
    3:  [{ name: 'Divine Health',       source: 'class',  description: 'Immune to disease.' },
         { name: 'Sacred Oath',         source: 'subclass', description: 'Swear your Sacred Oath and gain its features.' }],
    5:  [{ name: 'Extra Attack',        source: 'class',  description: 'Attack twice when you take the Attack action.' }],
    6:  [{ name: 'Aura of Protection',  source: 'class',  description: 'Allies within 10 ft (30 ft at level 18) add your CHA modifier to saving throws.' }],
    10: [{ name: 'Aura of Courage',     source: 'class',  description: 'Allies within 10 ft (30 ft at level 18) cannot be frightened while you are conscious.' }],
    11: [{ name: 'Improved Divine Smite', source: 'class', description: 'Deal an additional 1d8 radiant damage on every weapon hit.' }],
    14: [{ name: 'Cleansing Touch',     source: 'class',  description: 'Use an action to end a spell affecting a willing creature (CHA mod uses per long rest).' }],
    18: [{ name: 'Auras (30 ft)',       source: 'class',  description: 'Aura of Protection and Aura of Courage now extend to 30 ft.' }],
  },
  Ranger: {
    2:  [{ name: 'Fighting Style',      source: 'class',  description: 'Choose a fighting style specialization.' },
         { name: 'Spellcasting',        source: 'class',  description: 'Cast ranger spells using WIS; gain spell slots.' }],
    3:  [{ name: 'Primeval Awareness',  source: 'class',  description: 'Expend a spell slot to sense certain creature types within 1 mile (6 miles in favored terrain).' },
         { name: 'Ranger Archetype',    source: 'subclass', description: 'Gain your Ranger Archetype feature.' }],
    5:  [{ name: 'Extra Attack',        source: 'class',  description: 'Attack twice when you take the Attack action.' }],
    8:  [{ name: "Land's Stride",       source: 'class',  description: 'Move through nonmagical difficult terrain without extra cost; advantage on saves vs. magical plants.' }],
    10: [{ name: 'Hide in Plain Sight', source: 'class',  description: 'Spend 1 minute camouflaging yourself; gain +10 to Stealth checks while stationary.' }],
    14: [{ name: 'Vanish',              source: 'class',  description: 'Hide as a bonus action; cannot be tracked by nonmagical means.' }],
    18: [{ name: 'Feral Senses',        source: 'class',  description: 'Aware of invisible creatures within 30 ft; no disadvantage attacking them.' }],
    20: [{ name: 'Foe Slayer',          source: 'class',  description: 'Once per turn, add WIS modifier to an attack or damage roll against a favored enemy.' }],
  },
  Rogue: {
    2:  [{ name: 'Cunning Action',      source: 'class',  description: 'Bonus action to Dash, Disengage, or Hide each turn.' }],
    3:  [{ name: 'Roguish Archetype',   source: 'subclass', description: 'Gain your Roguish Archetype feature.' }],
    5:  [{ name: 'Uncanny Dodge',       source: 'class',  description: 'Reaction to halve damage from one attacker you can see per round.' }],
    7:  [{ name: 'Evasion',             source: 'class',  description: 'On a DEX save for half damage: no damage on success, half on failure.' }],
    11: [{ name: 'Reliable Talent',     source: 'class',  description: 'Treat any roll below 10 as a 10 for ability checks you are proficient in.' }],
    14: [{ name: 'Blindsense',          source: 'class',  description: 'Aware of hidden or invisible creatures within 10 ft.' }],
    15: [{ name: 'Slippery Mind',       source: 'class',  description: 'Gain proficiency in WIS saving throws.' }],
    18: [{ name: 'Elusive',             source: 'class',  description: 'Attackers never have advantage against you as long as you are not incapacitated.' }],
    20: [{ name: 'Stroke of Luck',      source: 'class',  description: 'Once per short/long rest: turn a missed attack into a hit or a failed ability check into a 20.' }],
  },
  Sorcerer: {
    1:  [{ name: 'Sorcerous Origin',    source: 'subclass', description: 'Gain your Sorcerous Origin feature.' }],
    2:  [{ name: 'Font of Magic',       source: 'class',  description: 'Gain sorcery points equal to your sorcerer level. Convert to/from spell slots.' }],
    3:  [{ name: 'Metamagic (2)',       source: 'class',  description: 'Choose 2 Metamagic options (Careful, Distant, Empowered, Extended, Heightened, Quickened, Subtle, Twinned).' }],
    10: [{ name: 'Metamagic (3rd)',     source: 'class',  description: 'Learn an additional Metamagic option.' }],
    17: [{ name: 'Metamagic (4th)',     source: 'class',  description: 'Learn another Metamagic option.' }],
    20: [{ name: 'Sorcerous Restoration', source: 'class', description: 'Regain 4 expended sorcery points on a short rest.' }],
  },
  Warlock: {
    1:  [{ name: 'Otherworldly Patron', source: 'subclass', description: 'Gain your patron\'s Expanded Spell List and first feature.' }],
    2:  [{ name: 'Eldritch Invocations (2)', source: 'class', description: 'Choose 2 Eldritch Invocations.' }],
    3:  [{ name: 'Pact Boon',           source: 'class',  description: 'Choose Pact of the Chain, Blade, or Tome.' }],
    5:  [{ name: 'Eldritch Invocations (+1)', source: 'class', description: 'Learn another Eldritch Invocation.' }],
    11: [{ name: 'Mystic Arcanum (6th)', source: 'class', description: 'Cast a 6th-level spell once per long rest without expending a spell slot.' }],
    13: [{ name: 'Mystic Arcanum (7th)', source: 'class', description: 'Cast a 7th-level spell once per long rest without expending a spell slot.' }],
    15: [{ name: 'Mystic Arcanum (8th)', source: 'class', description: 'Cast an 8th-level spell once per long rest without expending a spell slot.' }],
    17: [{ name: 'Mystic Arcanum (9th)', source: 'class', description: 'Cast a 9th-level spell once per long rest without expending a spell slot.' }],
    20: [{ name: 'Eldritch Master',     source: 'class',  description: 'Spend 1 minute entreating your patron to regain all expended Pact Magic spell slots.' }],
  },
  Wizard: {
    2:  [{ name: 'Arcane Tradition',    source: 'subclass', description: 'Gain your Arcane Tradition (school of magic) feature.' }],
    18: [{ name: 'Spell Mastery',       source: 'class',  description: 'Choose one 1st- and one 2nd-level spell; cast them without a slot once per long rest.' }],
    20: [{ name: 'Signature Spells',    source: 'class',  description: 'Choose two 3rd-level spells; cast them once each without expending a spell slot per short/long rest.' }],
  },
};

// ---- Internal helpers ---------------------------------------

/** Convert a slots array to the Record<"1".."9", number> format. */
function slotsArrayToRecord(slots: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] > 0) out[String(i + 1)] = slots[i];
  }
  return out;
}

/**
 * Compute standard (non-Pact) spell slots for a given set of class levels.
 *
 * Rules (PHB p.164–165; TCE p.11 for Artificer):
 * - Single half-caster class (Paladin/Ranger): use the class-specific slot table
 * - Single-class Artificer: use the dedicated Artificer slot table (spellcasting
 *   starts at level 1, unlike Paladin/Ranger)
 * - All other cases (full casters, mixed multiclass): sum caster levels —
 *   full = 1:1, Paladin/Ranger = floor(level/2), Artificer = ceil(level/2)
 *   (TCE p.11: Artificer is the one half-caster that rounds UP when
 *   multiclassing) — then look up the combined multiclass table
 * - Warlocks do not contribute to standard slots
 */
function computeStandardSlots(classLevels: ClassLevel[]): Record<string, number> {
  let fullCasterLevels = 0;
  const halfCasterEntries: number[] = [];
  let artificerLevel = 0;

  for (const cl of classLevels) {
    const cn = cl.className as ClassName;
    if (cn === 'Artificer') {
      artificerLevel += cl.level;
    } else if (FULL_CASTERS.has(cn)) {
      fullCasterLevels += cl.level;
    } else if (HALF_CASTERS.has(cn)) {
      halfCasterEntries.push(cl.level);
    }
    // Warlocks and non-casters are excluded from standard slots
  }

  const hasStandardCaster = fullCasterLevels > 0 || halfCasterEntries.length > 0 || artificerLevel > 0;
  if (!hasStandardCaster) return {};

  // Pure single half-caster (Paladin/Ranger only): use the dedicated half-caster table
  if (fullCasterLevels === 0 && artificerLevel === 0 && halfCasterEntries.length === 1) {
    const lvl = Math.min(halfCasterEntries[0], 20);
    return slotsArrayToRecord(HALF_CASTER_SLOTS[lvl] ?? []);
  }

  // Pure single-class Artificer: use the dedicated Artificer table
  if (fullCasterLevels === 0 && halfCasterEntries.length === 0 && artificerLevel > 0) {
    const lvl = Math.min(artificerLevel, 20);
    return slotsArrayToRecord(ARTIFICER_SLOTS[lvl] ?? []);
  }

  // Multiclass or pure full-caster: use the combined table
  const halfCasterTotal = halfCasterEntries.reduce((s, l) => s + l, 0);
  const combined = fullCasterLevels
    + Math.floor(halfCasterTotal / 2)
    + Math.ceil(artificerLevel / 2);
  const clamped  = Math.min(Math.max(combined, 0), 20);
  return slotsArrayToRecord(FULL_CASTER_SLOTS[clamped] ?? []);
}

/**
 * Check whether a character meets the PHB multiclass prerequisites
 * for adding a new class. Fighter's OR condition is handled specially.
 */
function meetsMulticlassPrereqs(sheet: CharacterSheet, cn: ClassName): boolean {
  if (cn === 'Fighter') {
    return sheet.stats.str >= 13 || sheet.stats.dex >= 13;
  }
  const prereqs = MULTICLASS_PREREQS[cn];
  return prereqs.every(p => sheet.stats[p.ability] >= p.min);
}

/**
 * Recompute CharacterResources based on the new level in `className`.
 * Returns a new object (no mutation).
 */
function updateResources(
  sheet:         CharacterSheet,
  cn:            ClassName,
  newClassLevel: number,
): CharacterResources {
  const res     = { ...sheet.resources };
  const chaMod  = abilityModifier(sheet.stats.cha);

  switch (cn) {
    case 'Barbarian': {
      // PHB p.47: 2@1, 3@2, 4@3–5, 5@6–11, 6@12–16, unlimited@17+
      const max = newClassLevel >= 17 ? 999
                : newClassLevel >= 12 ? 6
                : newClassLevel >= 6  ? 5
                : newClassLevel >= 3  ? 4
                : newClassLevel >= 2  ? 3
                : 2;
      res.rage = { max, remaining: max };
      break;
    }
    case 'Bard': {
      // PHB p.53: uses = max(1, CHA mod); die scales at 5/10/15
      const max = Math.max(1, chaMod);
      const die = newClassLevel >= 15 ? 12
                : newClassLevel >= 10 ? 10
                : newClassLevel >= 5  ? 8
                : 6;
      res.bardicInspiration = { max, remaining: max, dieSides: die };
      break;
    }
    case 'Fighter': {
      // Second Wind: always 1 use (short or long rest, PHB p.72)
      res.secondWind = { max: 1, remaining: 1 };
      // Action Surge: 1 use at lv2, 2 uses at lv17 (short or long rest, PHB p.72)
      if (newClassLevel >= 2) {
        const aMax = newClassLevel >= 17 ? 2 : 1;
        // Preserve remaining unless max changed (level-up grant)
        const aCur = res.actionSurge ? Math.min(res.actionSurge.remaining, aMax) : aMax;
        res.actionSurge = { max: aMax, remaining: aCur };
      }
      // Indomitable: 1 use @lv9, 2 @lv13, 3 @lv17 (long rest only, PHB p.72)
      if (newClassLevel >= 9) {
        const iMax = newClassLevel >= 17 ? 3 : newClassLevel >= 13 ? 2 : 1;
        const iCur = res.indomitable ? Math.min(res.indomitable.remaining, iMax) : iMax;
        res.indomitable = { max: iMax, remaining: iCur };
      }
      break;
    }
    case 'Paladin': {
      // Lay on Hands pool: 5 × paladin level (PHB p.84)
      const pool = 5 * newClassLevel;
      res.layOnHands = { pool, remaining: pool };
      // Divine Smite unlocks at level 2
      if (newClassLevel >= 2) res.divineSmite = true;
      // Cleansing Touch: CHA-mod uses (min 1), unlocks @lv14 (long rest only, PHB p.91)
      if (newClassLevel >= 14) {
        const ctMax = Math.max(1, chaMod);
        const ctCur = res.cleansingTouch ? Math.min(res.cleansingTouch.remaining, ctMax) : ctMax;
        res.cleansingTouch = { max: ctMax, remaining: ctCur };
      }
      break;
    }
    case 'Rogue': {
      // Sneak Attack: ceil(level / 2) d6 (PHB p.96)
      const saDice = Math.ceil(newClassLevel / 2);
      res.sneakAttackDice = `${saDice}d6`;
      // Cunning Action: level 2+
      if (newClassLevel >= 2) res.cunningAction = true;
      break;
    }
    case 'Wizard': {
      // Arcane Recovery: 1 use per day
      res.arcaneRecovery = { usesRemaining: 1 };
      // Spell Mastery: 2 free casts/long rest of the 2 chosen spells, unlocks @lv18 (PHB p.117)
      if (newClassLevel >= 18) {
        const smMax = 2;
        const smCur = res.spellMastery ? Math.min(res.spellMastery.remaining, smMax) : smMax;
        res.spellMastery = { max: smMax, remaining: smCur };
      }
      break;
    }
    case 'Cleric': {
      // Channel Divinity: 1/rest at lv1, 2/rest at lv6, 3/rest at lv18 (PHB p.58)
      const cdMax = newClassLevel >= 18 ? 3 : newClassLevel >= 6 ? 2 : 1;
      res.channelDivinity = { max: cdMax, remaining: cdMax };
      break;
    }
    case 'Monk': {
      // Ki points = monk level; recharge on short or long rest (PHB p.78)
      res.ki = { max: newClassLevel, remaining: newClassLevel };
      break;
    }
    case 'Sorcerer': {
      // Sorcery Points: = sorcerer level, unlocks at lv2 (long rest, PHB p.101)
      if (newClassLevel >= 2) {
        const spMax = newClassLevel; // 1 per sorcerer level
        const spCur = res.sorceryPoints ? Math.min(res.sorceryPoints.remaining, spMax) : spMax;
        res.sorceryPoints = { max: spMax, remaining: spCur };
      }
      break;
    }
    case 'Druid': {
      // Wild Shape: 2 uses (short or long rest, PHB p.66; unlocks at lv2)
      if (newClassLevel >= 2) {
        const wsMax = 2;
        const wsCur = res.wildShape ? Math.min(res.wildShape.remaining, wsMax) : wsMax;
        res.wildShape = { max: wsMax, remaining: wsCur };
      }
      break;
    }
    case 'Warlock': {
      // Mystic Arcanum: one free cast/long rest of a chosen spell at each level,
      // unlocked individually at lv11 (6th), lv13 (7th), lv15 (8th), lv17 (9th) (PHB p.110).
      // Newly-unlocked levels start "available" (true); already-tracked levels keep
      // whatever used/available state the player left them in. Levels not yet
      // unlocked are left undefined (NOT defaulted to false) so a later level-up
      // can still tell "never unlocked" apart from "unlocked and used".
      const ma: { l6?: boolean; l7?: boolean; l8?: boolean; l9?: boolean } = { ...(res.mysticArcanum ?? {}) };
      if (newClassLevel >= 11 && ma.l6 === undefined) ma.l6 = true;
      if (newClassLevel >= 13 && ma.l7 === undefined) ma.l7 = true;
      if (newClassLevel >= 15 && ma.l8 === undefined) ma.l8 = true;
      if (newClassLevel >= 17 && ma.l9 === undefined) ma.l9 = true;
      if (newClassLevel >= 11) res.mysticArcanum = ma;
      break;
    }
    case 'Artificer': {
      // Flash of Genius: INT-mod uses (min 1), unlocks @lv7 (long rest only, TCE p.16)
      if (newClassLevel >= 7) {
        const intMod = abilityModifier(sheet.stats.int);
        const fgMax = Math.max(1, intMod);
        const fgCur = res.flashOfGenius ? Math.min(res.flashOfGenius.remaining, fgMax) : fgMax;
        res.flashOfGenius = { max: fgMax, remaining: fgCur };
      }
      // Spell-Storing Item: 2/day, unlocks @lv11 (modeled as long-rest recharge, TCE p.16)
      if (newClassLevel >= 11) {
        const ssiMax = 2;
        const ssiCur = res.spellStoringItem ? Math.min(res.spellStoringItem.remaining, ssiMax) : ssiMax;
        res.spellStoringItem = { max: ssiMax, remaining: ssiCur };
      }
      // Soul of Artifice: 1 use, unlocks @lv20 (long rest only, TCE p.17)
      if (newClassLevel >= 20) {
        res.soulOfArtifice = { max: 1, remaining: res.soulOfArtifice ? res.soulOfArtifice.remaining : 1 };
      }
      break;
    }
    default:
      break;
  }

  return res;
}

/**
 * Grant race-based per-rest resources. Called once, when a character takes
 * their very first level (currentTotal === 0 in applyLevelUp) — these are
 * innate traits granted at creation, not re-granted on subsequent level-ups.
 */
function initRaceResources(sheet: CharacterSheet): CharacterResources {
  const res = { ...sheet.resources };
  if (sheet.race === 'Dragonborn') {
    // Breath Weapon (short or long rest, PHB p.34)
    res.breathWeapon = { max: 1, remaining: 1 };
  }
  if (sheet.race === 'Half-Orc') {
    // Relentless Endurance (long rest only, PHB p.41)
    res.relentlessEndurance = { max: 1, remaining: 1 };
  }
  return res;
}

// ---- Public API ---------------------------------------------

/**
 * Advance a CharacterSheet by one level.
 *
 * @param sheet         The current character sheet (not mutated).
 * @param className     The class to level up in (or a new class for multiclassing).
 * @param hpRollMethod  'average' (default) or 'max'. Applies to all non-first levels.
 *                      Level-1 HP (character creation) is always max; this function
 *                      handles levels 2+.
 * @throws Error        If the class is unknown, total level is 20, or multiclass
 *                      prerequisites are not met.
 */
export function applyLevelUp(
  sheet:         CharacterSheet,
  className:     string,
  hpRollMethod:  'average' | 'max' = 'average',
): LevelUpResult {

  // ---- Validation -------------------------------------------

  const cn = className as ClassName;
  if (!VALID_CLASSES.has(cn)) {
    throw new Error(
      `Unknown class "${className}". Valid classes: ${[...VALID_CLASSES].sort().join(', ')}.`,
    );
  }

  const currentTotal = totalLevel(sheet);
  if (currentTotal >= 20) {
    throw new Error(`Character is already level 20 and cannot level up further.`);
  }

  const existingEntry = sheet.classLevels.find(cl => cl.className === className);
  const isNewClass    = !existingEntry;
  const newClassLevel = isNewClass ? 1 : existingEntry!.level + 1;

  if (isNewClass) {
    if (!meetsMulticlassPrereqs(sheet, cn)) {
      const prereqStr = cn === 'Fighter'
        ? 'STR 13 or DEX 13'
        : MULTICLASS_PREREQS[cn].map(p => `${p.ability.toUpperCase()} ${p.min}`).join(' and ');
      throw new Error(
        `Cannot multiclass into ${className}: requires ${prereqStr}.`,
      );
    }
  }

  // ---- Capture "before" snapshots for LevelRecord ----------
  // Must happen before any mutations so we can fully reverse this level.

  const resourcesBefore:      CharacterResources                           = { ...sheet.resources };
  const spellSlotsBefore:     Record<string, number> | null                = sheet.spellcasting ? { ...sheet.spellcasting.slots } : null;
  const spellSlotsUsedBefore: Record<string, number> | null                = sheet.spellcasting ? { ...sheet.spellcasting.slotsUsed } : null;
  const pactSlotsBefore:      { slotLevel: number; total: number; used: number } | null =
    sheet.spellcasting?.pactSlots ? { ...sheet.spellcasting.pactSlots } : null;
  const hadSpellcastingBefore = !!sheet.spellcasting;
  const statsBefore:          typeof sheet.stats                           = { ...sheet.stats };
  const pendingASIBefore      = sheet.pendingAbilityScoreImprovements ?? 0;
  const pendingASIHalfBefore  = sheet.pendingASIHalfPoints ?? 0;

  // ---- Deep copy (no mutation of original) ------------------

  let updated: CharacterSheet = {
    ...sheet,
    subclassChoices: { ...sheet.subclassChoices },
    classLevels:     sheet.classLevels.map(cl => ({ ...cl })),
    hitDice:         sheet.hitDice.map(hd => ({ ...hd })),
    resources:       { ...sheet.resources },
    proficiencies: {
      ...sheet.proficiencies,
      armor:        [...sheet.proficiencies.armor],
      weapons:      [...sheet.proficiencies.weapons],
      tools:        [...sheet.proficiencies.tools],
      savingThrows: [...sheet.proficiencies.savingThrows],
      skills:       [...sheet.proficiencies.skills],
      expertise:    [...sheet.proficiencies.expertise],
    },
    spellcasting: sheet.spellcasting
      ? {
          ...sheet.spellcasting,
          slots:     { ...sheet.spellcasting.slots },
          slotsUsed: { ...sheet.spellcasting.slotsUsed },
          pactSlots: sheet.spellcasting.pactSlots
            ? { ...sheet.spellcasting.pactSlots }
            : undefined,
          cantrips:      [...sheet.spellcasting.cantrips],
          knownSpells:   [...sheet.spellcasting.knownSpells],
          preparedSpells:[...sheet.spellcasting.preparedSpells],
          spellbook:     sheet.spellcasting.spellbook
            ? [...sheet.spellcasting.spellbook]
            : undefined,
        }
      : undefined,
    level1Features: [...sheet.level1Features],
    allFeatures:    [...sheet.allFeatures],
    feats:          [...sheet.feats],
    levelHistory:   [...(sheet.levelHistory ?? [])],
    updatedAt:      new Date().toISOString(),
  };

  // ---- Update class levels ----------------------------------

  if (isNewClass) {
    updated.classLevels.push({ className, level: 1 });
  } else {
    updated.classLevels.find(cl => cl.className === className)!.level = newClassLevel;
  }

  // ---- Update hit dice pool --------------------------------

  const hitDie        = CLASS_HIT_DICE[cn];
  const existingHD    = updated.hitDice.find(hd => hd.className === className);
  if (existingHD) {
    existingHD.total     += 1;
    existingHD.remaining += 1;
  } else {
    updated.hitDice.push({
      className,
      dieSides:  hitDie,
      total:     1,
      remaining: 1,
    });
  }

  // ---- HP gained --------------------------------------------

  const conMod = abilityModifier(sheet.stats.con);
  let hpGained = hpRollMethod === 'max'
    ? hitDie + conMod
    : Math.floor(hitDie / 2) + 1 + conMod;
  hpGained = Math.max(1, hpGained);   // minimum 1 HP per level

  // Tough (PHB p.170): "Whenever you gain a level thereafter, your hit
  // point maximum increases by an additional 2 hit points." Folded into
  // hpGained (rather than applied separately) so the existing popLevel
  // reversal — which simply subtracts record.hpGained — undoes it too.
  for (const fn of sheet.feats || []) {
    const fd = getFeat(fn);
    if (fd?.hpPerLevel) hpGained += fd.hpPerLevel;
  }

  updated.maxHP     += hpGained;
  updated.currentHP += hpGained;

  // ---- Proficiency bonus (may change at tier boundaries) ---

  const newTotal = totalLevel(updated);
  const oldProf  = PROFICIENCY_BONUS_TABLE[Math.min(currentTotal, 20)] ?? 2;
  const newProf  = PROFICIENCY_BONUS_TABLE[Math.min(newTotal, 20)]     ?? 2;
  const profChanged = newProf !== oldProf;

  // ---- Update resources ------------------------------------

  updated.resources = updateResources(updated, cn, newClassLevel);

  // Race-granted per-rest resources (Dragonborn Breath Weapon, Half-Orc
  // Relentless Endurance) are granted once, at character creation — not
  // re-granted on every level-up. currentTotal === 0 means this push is
  // the character's very first level.
  if (currentTotal === 0) {
    updated.resources = initRaceResources(updated);
  }

  // ---- Update spell slots ----------------------------------

  const standardSlots = computeStandardSlots(updated.classLevels);
  const hasStandardCasterClass = updated.classLevels.some(cl =>
    FULL_CASTERS.has(cl.className as ClassName) || HALF_CASTERS.has(cl.className as ClassName)
    || cl.className === 'Artificer',
  );

  if (hasStandardCasterClass) {
    if (!updated.spellcasting && Object.keys(standardSlots).length > 0) {
      // First time gaining spell slots — initialise spellcasting block
      const castAbil  = CASTING_ABILITY[cn] ?? 'int';
      const abilMod   = abilityModifier(sheet.stats[castAbil]);
      const sp: SpellcastingInfo = {
        ability:          castAbil,
        spellAttackBonus: newProf + abilMod,
        saveDC:           8 + newProf + abilMod,
        slots:            standardSlots,
        slotsUsed:        Object.fromEntries(Object.keys(standardSlots).map(k => [k, 0])),
        cantrips:         [],
        knownSpells:      [],
        preparedSpells:   [],
      };
      updated.spellcasting = sp;
    } else if (updated.spellcasting) {
      // Update existing slots; don't decrease slotsUsed below new max
      for (const level of Object.keys(standardSlots)) {
        if (!(level in updated.spellcasting.slotsUsed)) {
          updated.spellcasting.slotsUsed[level] = 0;
        }
      }
      updated.spellcasting.slots = standardSlots;

      if (profChanged) {
        const castAbil = updated.spellcasting.ability;
        const abilMod  = abilityModifier(sheet.stats[castAbil]);
        updated.spellcasting.spellAttackBonus = newProf + abilMod;
        updated.spellcasting.saveDC           = 8 + newProf + abilMod;
      }
    }
  }

  // Update Warlock Pact Magic (tracked separately from standard slots)
  const warlockEntry = updated.classLevels.find(cl => cl.className === 'Warlock');
  if (warlockEntry) {
    const wl = Math.min(warlockEntry.level, 20);
    const [pactTotal, pactLevel] = WARLOCK_PACT_SLOTS[wl];

    if (!updated.spellcasting) {
      // Warlock as primary/only caster — initialise spellcasting
      const abilMod = abilityModifier(sheet.stats.cha);
      updated.spellcasting = {
        ability:          'cha',
        spellAttackBonus: newProf + abilMod,
        saveDC:           8 + newProf + abilMod,
        slots:            {},
        slotsUsed:        {},
        pactSlots:        { slotLevel: pactLevel, total: pactTotal, used: 0 },
        cantrips:         [],
        knownSpells:      [],
        preparedSpells:   [],
      };
    } else {
      // Preserve used count; update total and level
      const prevUsed = updated.spellcasting.pactSlots?.used ?? 0;
      updated.spellcasting.pactSlots = {
        slotLevel: pactLevel,
        total:     pactTotal,
        used:      Math.min(prevUsed, pactTotal),  // can't have used more than total
      };
      if (profChanged) {
        const abilMod = abilityModifier(sheet.stats.cha);
        updated.spellcasting.spellAttackBonus = newProf + abilMod;
        updated.spellcasting.saveDC           = 8 + newProf + abilMod;
      }
    }
  }

  // ---- Collect new features --------------------------------

  const rawFeatures = CLASS_FEATURES[cn]?.[newClassLevel] ?? [];
  const newFeatures: CharacterFeature[] = rawFeatures.map(f => ({
    name:        f.name,
    description: f.description,
    source:      f.source,
  }));

  updated.allFeatures = [...updated.allFeatures, ...newFeatures];

  // ---- Subclass prompt -------------------------------------

  const subclassTrigger = SUBCLASS_LEVELS[cn];
  const subclassPrompt: string | undefined =
    subclassTrigger === newClassLevel && !(cn in updated.subclassChoices)
      ? cn
      : undefined;

  // ---- ASI flag --------------------------------------------

  const abilityScoreImprovement: true | undefined =
    ASI_LEVELS[cn].has(newClassLevel) ? true : undefined;

  // Increment pending ASI count in the sheet so applyASI can validate availability
  if (abilityScoreImprovement) {
    updated = {
      ...updated,
      pendingAbilityScoreImprovements: (updated.pendingAbilityScoreImprovements ?? 0) + 1,
    };
  }

  // ---- Build and push LevelRecord (stack entry) -----------

  const record: LevelRecord = {
    className,
    classLevel:            newClassLevel,
    totalLevelAfter:       totalLevel(updated),
    hpGained,
    featuresAdded:         newFeatures,
    wasNewClass:           isNewClass,
    subclassPrompted:      subclassPrompt,
    resourcesBefore,
    spellSlotsBefore,
    spellSlotsUsedBefore,
    pactSlotsBefore,
    hadSpellcastingBefore,
    statsBefore,
    pendingASIBefore,
    pendingASIHalfBefore,
  };

  updated.levelHistory = [...(updated.levelHistory ?? []), record];

  return {
    sheet: updated,
    hpGained,
    newFeatures,
    ...(subclassPrompt           !== undefined && { subclassPrompt }),
    ...(abilityScoreImprovement  !== undefined && { abilityScoreImprovement }),
  };
}

// ---- popLevel -----------------------------------------------

export interface PopLevelResult {
  /** Updated CharacterSheet with the top level reversed. */
  sheet: CharacterSheet;
  /** The LevelRecord that was popped. */
  poppedRecord: LevelRecord;
}

/**
 * Reverse the most recent applyLevelUp() by reading the top LevelRecord.
 *
 * Reverts: classLevels, hitDice, maxHP/currentHP, resources,
 *          spellcasting slots & pact slots, allFeatures, stats (ASI reversal),
 *          pendingAbilityScoreImprovements, pendingASIHalfPoints.
 *
 * Does NOT revert: equipment, gold, languages, proficiencies added during
 *   character creation (those are not level-stack concerns).
 *   subclassChoices are NOT reversed — choosing a subclass is a separate action
 *   tracked in improvements.ts; the level record only notes the prompt was issued.
 *
 * @throws Error if levelHistory is empty or missing.
 */
export function popLevel(sheet: CharacterSheet): PopLevelResult {
  const history = sheet.levelHistory ?? [];
  if (history.length === 0) {
    throw new Error('Cannot pop level: no level history recorded. ' +
      'This character may have been created before the level-stack was introduced.');
  }

  const record = history[history.length - 1];
  const poppedRecord = record;

  // ---- Deep copy ------------------------------------------------
  let updated: CharacterSheet = {
    ...sheet,
    subclassChoices: { ...sheet.subclassChoices },
    classLevels:     sheet.classLevels.map(cl => ({ ...cl })),
    hitDice:         sheet.hitDice.map(hd => ({ ...hd })),
    resources:       { ...record.resourcesBefore },        // restore pre-level resources
    stats:           { ...record.statsBefore },            // restore pre-level stats (ASI reversal)
    proficiencies: {
      ...sheet.proficiencies,
      armor:        [...sheet.proficiencies.armor],
      weapons:      [...sheet.proficiencies.weapons],
      tools:        [...sheet.proficiencies.tools],
      savingThrows: [...sheet.proficiencies.savingThrows],
      skills:       [...sheet.proficiencies.skills],
      expertise:    [...sheet.proficiencies.expertise],
    },
    level1Features: [...sheet.level1Features],
    allFeatures:    [...sheet.allFeatures],
    feats:          [...sheet.feats],
    levelHistory:   history.slice(0, -1),   // pop the top record
    updatedAt:      new Date().toISOString(),
  };

  // ---- Revert classLevels ---------------------------------------
  if (record.wasNewClass) {
    // Remove the class entry entirely
    updated.classLevels = updated.classLevels.filter(
      cl => cl.className !== record.className,
    );
  } else {
    const entry = updated.classLevels.find(cl => cl.className === record.className);
    if (entry) {
      entry.level -= 1;
      // Guard: remove if somehow dropped to 0 (shouldn't happen with valid data)
      if (entry.level <= 0) {
        updated.classLevels = updated.classLevels.filter(cl => cl.className !== record.className);
      }
    }
  }

  // ---- Revert hit dice pool -------------------------------------
  if (record.wasNewClass) {
    updated.hitDice = updated.hitDice.filter(hd => hd.className !== record.className);
  } else {
    const hdEntry = updated.hitDice.find(hd => hd.className === record.className);
    if (hdEntry) {
      hdEntry.total    -= 1;
      hdEntry.remaining = Math.min(hdEntry.remaining, hdEntry.total);
      if (hdEntry.total <= 0) {
        updated.hitDice = updated.hitDice.filter(hd => hd.className !== record.className);
      }
    }
  }

  // ---- Revert HP ------------------------------------------------
  updated.maxHP     = sheet.maxHP - record.hpGained;
  updated.currentHP = Math.min(sheet.currentHP - record.hpGained, updated.maxHP);
  // Enforce minimum 1 HP (character is alive during level management)
  if (updated.currentHP < 0) updated.currentHP = 0;

  // ---- Revert allFeatures ---------------------------------------
  // Remove features that were added at this level (first-occurrence match per feature)
  const featuresToRemove = [...record.featuresAdded];
  const remainingFeatures: typeof updated.allFeatures = [];
  for (const f of updated.allFeatures) {
    const matchIdx = featuresToRemove.findIndex(
      r => r.name === f.name && r.source === f.source && r.description === f.description,
    );
    if (matchIdx >= 0) {
      featuresToRemove.splice(matchIdx, 1);  // consume one removal slot
    } else {
      remainingFeatures.push(f);
    }
  }
  updated.allFeatures = remainingFeatures;

  // ---- Revert spellcasting ---------------------------------------
  if (!record.hadSpellcastingBefore) {
    // Spellcasting was introduced at this level — remove it
    updated.spellcasting = undefined;
  } else if (updated.spellcasting && record.spellSlotsBefore !== null) {
    // Restore slot counts to pre-level values
    updated.spellcasting = {
      ...sheet.spellcasting!,
      slots:     { ...record.spellSlotsBefore },
      slotsUsed: { ...record.spellSlotsUsedBefore! },
      pactSlots: record.pactSlotsBefore
        ? { ...record.pactSlotsBefore }
        : sheet.spellcasting?.pactSlots
        ? undefined   // pact slots were introduced at this level
        : undefined,
    };
  }

  // ---- Revert pending ASI ---------------------------------------
  updated.pendingAbilityScoreImprovements = record.pendingASIBefore;
  updated.pendingASIHalfPoints            = record.pendingASIHalfBefore;

  return { sheet: updated, poppedRecord };
}

// ---- bootstrapLevelHistory ----------------------------------

/**
 * For legacy characters that have no levelHistory, reconstructs an
 * approximate history by running applyLevelUp on a minimal "ghost"
 * from level 1 up to the character's current level.
 *
 * The resulting records are patched so that:
 *  - statsBefore is set to the CURRENT stats for every record, meaning
 *    popping levels will NOT revert ability score improvements.  This is
 *    the correct trade-off: we cannot know which levels an ASI was taken.
 *  - pendingASIBefore / pendingASIHalfBefore are similarly frozen to
 *    the current values, preserving any pending choices.
 *  - HP gains use average rolls (Math.floor(die/2)+1+CON), which may
 *    differ from the original method.  Acceptable for a DM tool.
 *
 * After bootstrap the character can use popLevel() normally.
 *
 * @throws if the character already has levelHistory (use existing stack)
 * @throws if the character has more than one class (multiclass order
 *         cannot be inferred from the current sheet)
 * @throws if the character is already level 1 (nothing to bootstrap)
 */
export function bootstrapLevelHistory(sheet: CharacterSheet): CharacterSheet {
  if (sheet.levelHistory && sheet.levelHistory.length > 0) {
    throw new Error(
      'bootstrapLevelHistory: character already has a levelHistory stack. ' +
      'Call popLevel() directly.',
    );
  }

  const currentLevel = totalLevel(sheet);
  if (currentLevel <= 1) {
    // Nothing to bootstrap — the character is already at level 1.
    return { ...sheet, levelHistory: [] };
  }

  if (sheet.classLevels.length > 1) {
    throw new Error(
      'bootstrapLevelHistory: cannot reconstruct level history for a ' +
      'multiclassed character because the order in which classes were ' +
      'taken cannot be determined from the current sheet. ' +
      'Recreate this character from level 1 to enable level-down.',
    );
  }

  const cn = sheet.firstClass as ClassName;
  if (!VALID_CLASSES.has(cn)) {
    throw new Error(
      `bootstrapLevelHistory: unknown class "${cn}".`,
    );
  }

  // Build a minimal ghost at level 1 using the real character's stats
  // so that HP calculations use the correct CON modifier.
  const hitDie  = CLASS_HIT_DICE[cn];
  const conMod  = abilityModifier(sheet.stats.con);
  const lv1HP   = Math.max(1, hitDie + conMod);  // PHB: max hit die at level 1

  const ghost: CharacterSheet = {
    ...sheet,
    classLevels:   [{ className: cn, level: 1 }],
    hitDice:       [{ className: cn, dieSides: hitDie, total: 1, remaining: 1 }],
    maxHP:         lv1HP,
    currentHP:     lv1HP,
    temporaryHP:   0,
    resources:     {},
    spellcasting:  undefined,
    allFeatures:   [...(sheet.level1Features ?? [])],
    feats:         [],
    levelHistory:  [],
    subclassChoices:                      {},
    pendingAbilityScoreImprovements:      0,
    pendingASIHalfPoints:                 0,
  };

  // Advance the ghost from level 2 to currentLevel, building levelHistory.
  let advanced: CharacterSheet = ghost;
  for (let lvl = 2; lvl <= currentLevel; lvl++) {
    const result = applyLevelUp(advanced, cn, 'average');
    advanced = result.sheet;
  }

  // Patch every record so that ASI state reflects the real character's
  // current values rather than the ghost's (which has no ASIs).
  const frozenStats       = { ...sheet.stats };
  const frozenPendingASI  = sheet.pendingAbilityScoreImprovements ?? 0;
  const frozenHalfPoints  = sheet.pendingASIHalfPoints ?? 0;

  const patchedHistory: LevelRecord[] = (advanced.levelHistory ?? []).map(record => ({
    ...record,
    statsBefore:          frozenStats,
    pendingASIBefore:     frozenPendingASI,
    pendingASIHalfBefore: frozenHalfPoints,
  }));

  return {
    ...sheet,
    levelHistory: patchedHistory,
  };
}

// ---- Exports (table data for testing) -----------------------

export {
  FULL_CASTER_SLOTS,
  HALF_CASTER_SLOTS,
  ARTIFICER_SLOTS,
  WARLOCK_PACT_SLOTS,
  computeStandardSlots,
};
