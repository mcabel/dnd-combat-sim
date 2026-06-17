// ============================================================
// race_data.ts — PHB 2014 Race & Subrace Data
//
// Sources: PHB 2014, Tasha's Cauldron of Everything (flexible ASI)
// Scope: pre-2024 canonical content only
//
// DESIGN:
//   allotment   — Tasha's flexible amounts (counts only, no stat assignment)
//   defaultASI  — PHB 2014 fixed assignment; absent when player must choose
//   speed       — base walking speed in feet
//   size        — 'Medium' | 'Small'
//   darkvision  — range in feet; absent = no darkvision
//   traits      — notable racial features as brief descriptor strings
// ============================================================

import { CharacterAbilityScores, SkillName } from './types';

export interface RaceEntry {
  name: string;
  allotment: number[];                              // Tasha's flexible ASI amounts
  defaultASI?: Partial<CharacterAbilityScores>;     // PHB 2014 fixed assignment (absent = player must choose)
  speed: number;                                    // base walking speed (ft)
  size: 'Medium' | 'Small';
  darkvision?: number;                              // ft; absent = none
  skillProficiencies?: SkillName[];                 // racial skill proficiencies
  traits: string[];                                 // notable feature descriptors
}

// ── DWARF ─────────────────────────────────────────────────────
const HILL_DWARF: RaceEntry = {
  name: 'Hill Dwarf',
  allotment: [2, 1],
  defaultASI: { con: 2, wis: 1 },
  speed: 25,
  size: 'Medium',
  darkvision: 60,
  traits: [
    'Dwarven Resilience: advantage on saves vs. poison; resistance to poison damage',
    'Dwarven Combat Training: proficiency with battleaxe, handaxe, light hammer, warhammer',
    'Stonecunning: double proficiency on History checks about stonework',
    'Dwarven Toughness: maximum HP increases by 1 per character level',
  ],
};

const MOUNTAIN_DWARF: RaceEntry = {
  name: 'Mountain Dwarf',
  allotment: [2, 2],
  defaultASI: { str: 2, con: 2 },
  speed: 25,
  size: 'Medium',
  darkvision: 60,
  traits: [
    'Dwarven Resilience: advantage on saves vs. poison; resistance to poison damage',
    'Dwarven Combat Training: proficiency with battleaxe, handaxe, light hammer, warhammer',
    'Stonecunning: double proficiency on History checks about stonework',
    'Dwarven Armor Training: proficiency with light and medium armor',
  ],
};

// ── ELF ───────────────────────────────────────────────────────
const HIGH_ELF: RaceEntry = {
  name: 'High Elf',
  allotment: [2, 1],
  defaultASI: { dex: 2, int: 1 },
  speed: 30,
  size: 'Medium',
  darkvision: 60,
  skillProficiencies: ['Perception'],
  traits: [
    'Darkvision 60 ft',
    'Keen Senses: proficiency in the Perception skill',
    'Fey Ancestry: advantage on saves vs. charm; immunity to magical sleep',
    'Trance: 4-hour meditation replaces 8-hour sleep',
    'Elf Weapon Training: proficiency with longsword, shortsword, shortbow, longbow',
    'Cantrip: one wizard cantrip of your choice',
    'Extra Language: one additional language of your choice',
  ],
};

const WOOD_ELF: RaceEntry = {
  name: 'Wood Elf',
  allotment: [2, 1],
  defaultASI: { dex: 2, wis: 1 },
  speed: 35,
  size: 'Medium',
  darkvision: 60,
  skillProficiencies: ['Perception'],
  traits: [
    'Darkvision 60 ft',
    'Keen Senses: proficiency in the Perception skill',
    'Fey Ancestry: advantage on saves vs. charm; immunity to magical sleep',
    'Trance: 4-hour meditation replaces 8-hour sleep',
    'Elf Weapon Training: proficiency with longsword, shortsword, shortbow, longbow',
    'Fleet of Foot: base speed 35 ft',
    'Mask of the Wild: can attempt to hide when lightly obscured by natural phenomena',
  ],
};

const DARK_ELF: RaceEntry = {
  name: 'Dark Elf (Drow)',
  allotment: [2, 1],
  defaultASI: { dex: 2, cha: 1 },
  speed: 30,
  size: 'Medium',
  darkvision: 120,
  skillProficiencies: ['Perception'],
  traits: [
    'Superior Darkvision 120 ft',
    'Keen Senses: proficiency in the Perception skill',
    'Fey Ancestry: advantage on saves vs. charm; immunity to magical sleep',
    'Trance: 4-hour meditation replaces 8-hour sleep',
    'Sunlight Sensitivity: disadvantage on attack rolls and Perception checks in direct sunlight',
    'Drow Magic: Dancing Lights cantrip; Faerie Fire (level 3); Darkness (level 5)',
    'Drow Weapon Training: proficiency with rapier, shortsword, hand crossbow',
  ],
};

// ── HALFLING ──────────────────────────────────────────────────
const LIGHTFOOT_HALFLING: RaceEntry = {
  name: 'Lightfoot Halfling',
  allotment: [2, 1],
  defaultASI: { dex: 2, cha: 1 },
  speed: 25,
  size: 'Small',
  traits: [
    'Lucky: reroll any natural 1 on an attack roll, ability check, or saving throw',
    'Brave: advantage on saving throws against being frightened',
    'Halfling Nimbleness: can move through the space of any creature one size larger',
    'Naturally Stealthy: can attempt to hide when obscured by a creature one size larger',
  ],
};

const STOUT_HALFLING: RaceEntry = {
  name: 'Stout Halfling',
  allotment: [2, 1],
  defaultASI: { dex: 2, con: 1 },
  speed: 25,
  size: 'Small',
  traits: [
    'Lucky: reroll any natural 1 on an attack roll, ability check, or saving throw',
    'Brave: advantage on saving throws against being frightened',
    'Halfling Nimbleness: can move through the space of any creature one size larger',
    'Stout Resilience: advantage on saves vs. poison; resistance to poison damage',
  ],
};

// ── HUMAN ─────────────────────────────────────────────────────
const HUMAN: RaceEntry = {
  name: 'Human',
  allotment: [1, 1, 1, 1, 1, 1],
  defaultASI: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
  speed: 30,
  size: 'Medium',
  traits: [
    'Ability Score Increase: +1 to all six ability scores',
    'Extra Language: one additional language of your choice',
  ],
};

const HUMAN_VARIANT: RaceEntry = {
  name: 'Human (Variant)',
  allotment: [1, 1],
  // defaultASI absent — player chooses which two stats
  speed: 30,
  size: 'Medium',
  traits: [
    'Ability Score Increase: +1 to two different ability scores of your choice',
    'Skills: one skill proficiency of your choice',
    'Feat: one feat of your choice',
  ],
};

// ── DRAGONBORN ────────────────────────────────────────────────
const DRAGONBORN: RaceEntry = {
  name: 'Dragonborn',
  allotment: [2, 1],
  defaultASI: { str: 2, cha: 1 },
  speed: 30,
  size: 'Medium',
  traits: [
    'Draconic Ancestry: choose a dragon type; grants a breath weapon and damage resistance',
    'Breath Weapon: exhale destructive energy (save DC 8 + CON mod + proficiency bonus)',
    'Damage Resistance: resistance to the damage type associated with your draconic ancestry',
  ],
};

// ── GNOME ─────────────────────────────────────────────────────
const FOREST_GNOME: RaceEntry = {
  name: 'Forest Gnome',
  allotment: [2, 1],
  defaultASI: { int: 2, dex: 1 },
  speed: 25,
  size: 'Small',
  darkvision: 60,
  traits: [
    'Darkvision 60 ft',
    'Gnome Cunning: advantage on INT, WIS, and CHA saving throws against magic',
    'Natural Illusionist: Minor Illusion cantrip (INT is the spellcasting ability)',
    'Speak with Small Beasts: communicate simple ideas with Small or smaller beasts',
  ],
};

const ROCK_GNOME: RaceEntry = {
  name: 'Rock Gnome',
  allotment: [2, 1],
  defaultASI: { int: 2, con: 1 },
  speed: 25,
  size: 'Small',
  darkvision: 60,
  traits: [
    'Darkvision 60 ft',
    'Gnome Cunning: advantage on INT, WIS, and CHA saving throws against magic',
    "Artificer's Lore: double proficiency on History checks about magic items, alchemical objects, and tech devices",
    'Tinker: construct tiny clockwork devices (Clockwork Toy, Fire Starter, or Music Box)',
  ],
};

// ── HALF-ELF ──────────────────────────────────────────────────
const HALF_ELF: RaceEntry = {
  name: 'Half-Elf',
  allotment: [2, 1, 1],
  // defaultASI absent — player freely assigns all three amounts under Tasha's
  speed: 30,
  size: 'Medium',
  darkvision: 60,
  traits: [
    'Darkvision 60 ft',
    'Fey Ancestry: advantage on saves vs. charm; immunity to magical sleep',
    'Skill Versatility: proficiency in two skills of your choice',
    'Extra Language: one additional language of your choice',
  ],
};

// ── HALF-ORC ──────────────────────────────────────────────────
const HALF_ORC: RaceEntry = {
  name: 'Half-Orc',
  allotment: [2, 1],
  defaultASI: { str: 2, con: 1 },
  speed: 30,
  size: 'Medium',
  darkvision: 60,
  skillProficiencies: ['Intimidation'],
  traits: [
    'Darkvision 60 ft',
    'Menacing: proficiency in the Intimidation skill',
    'Relentless Endurance: when reduced to 0 HP (not killed outright), drop to 1 HP instead (1/long rest)',
    'Savage Attacks: on a critical hit with a melee weapon, roll one extra damage die',
  ],
};

// ── TIEFLING ──────────────────────────────────────────────────
const TIEFLING: RaceEntry = {
  name: 'Tiefling',
  allotment: [2, 1],
  defaultASI: { int: 1, cha: 2 },
  speed: 30,
  size: 'Medium',
  darkvision: 60,
  traits: [
    'Darkvision 60 ft',
    'Hellish Resistance: resistance to fire damage',
    'Infernal Legacy: Thaumaturgy cantrip; Hellish Rebuke (level 3); Darkness (level 5); CHA is the spellcasting ability',
  ],
};

// ── CUSTOM LINEAGE (Tasha's) ──────────────────────────────────
const CUSTOM_LINEAGE: RaceEntry = {
  name: 'Custom Lineage',
  allotment: [2],
  // defaultASI absent — player chooses which stat
  speed: 30,
  size: 'Medium',  // player may choose Medium or Small
  darkvision: 60,  // player may take darkvision OR a skill proficiency instead
  traits: [
    'Ability Score Increase: +2 to one ability score of your choice',
    'Size: Medium or Small (your choice)',
    'Feat: one feat of your choice',
    'Variable Trait: darkvision 60 ft OR one skill proficiency of your choice',
  ],
};

// ── Master table ──────────────────────────────────────────────

/** All playable races/subraces from PHB 2014 + Custom Lineage (Tasha's). */
export const RACE_DATA: Record<string, RaceEntry> = {
  'Hill Dwarf':          HILL_DWARF,
  'Mountain Dwarf':      MOUNTAIN_DWARF,
  'High Elf':            HIGH_ELF,
  'Wood Elf':            WOOD_ELF,
  'Dark Elf (Drow)':     DARK_ELF,
  'Lightfoot Halfling':  LIGHTFOOT_HALFLING,
  'Stout Halfling':      STOUT_HALFLING,
  'Human':               HUMAN,
  'Human (Variant)':     HUMAN_VARIANT,
  'Dragonborn':          DRAGONBORN,
  'Forest Gnome':        FOREST_GNOME,
  'Rock Gnome':          ROCK_GNOME,
  'Half-Elf':            HALF_ELF,
  'Half-Orc':            HALF_ORC,
  'Tiefling':            TIEFLING,
  'Custom Lineage':      CUSTOM_LINEAGE,
};

/** Sorted list of all race names for API responses. */
export const RACE_NAMES: string[] = Object.keys(RACE_DATA).sort();
