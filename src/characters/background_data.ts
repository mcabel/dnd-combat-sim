// ============================================================
// background_data.ts — PHB 2014 Background Data
//
// Source: Player's Handbook 2014, Chapter 4 (pp.125–141)
// Scope: All 13 PHB 2014 backgrounds; pre-2024 canonical only.
//
// DESIGN:
//   skills          — two skill proficiencies granted
//   tools           — tool proficiency strings (empty if none)
//   languageChoices — number of languages player picks freely
//   gold            — starting gold (gp)
//   feature         — feature name
//   featureDesc     — brief feature description
//
// Variant features (Spy, Gladiator, etc.) are noted but not
// separately modelled — they share the same mechanical grants.
// ============================================================

import { SkillName } from './types';

export interface BackgroundEntry {
  name: string;
  skills: SkillName[];         // always exactly 2
  tools: string[];             // tool/gaming set/instrument proficiencies
  languageChoices: number;     // how many languages the player chooses freely
  gold: number;                // starting gold in gp
  feature: string;             // feature name
  featureDesc: string;         // brief description of the feature
  variants?: string[];         // variant names from PHB (informational)
}

// ── Individual backgrounds ─────────────────────────────────────

const ACOLYTE: BackgroundEntry = {
  name: 'Acolyte',
  skills: ['Insight', 'Religion'],
  tools: [],
  languageChoices: 2,
  gold: 15,
  feature: 'Shelter of the Faithful',
  featureDesc: 'You and your companions can expect free healing and care at temples of your faith, and you have ties to a specific temple.',
};

const CHARLATAN: BackgroundEntry = {
  name: 'Charlatan',
  skills: ['Deception', 'Sleight of Hand'],
  tools: ['Disguise Kit', 'Forgery Kit'],
  languageChoices: 0,
  gold: 15,
  feature: 'False Identity',
  featureDesc: 'You have a second identity, complete with documentation, established acquaintances, and disguises.',
};

const CRIMINAL: BackgroundEntry = {
  name: 'Criminal',
  skills: ['Deception', 'Stealth'],
  tools: ['One gaming set of your choice', "Thieves' Tools"],
  languageChoices: 0,
  gold: 15,
  feature: 'Criminal Contact',
  featureDesc: 'You have a reliable contact who acts as a liaison to a network of criminals, providing a way to pass messages and locate fences.',
  variants: ['Spy'],
};

const ENTERTAINER: BackgroundEntry = {
  name: 'Entertainer',
  skills: ['Acrobatics', 'Performance'],
  tools: ['Disguise Kit', 'One musical instrument of your choice'],
  languageChoices: 0,
  gold: 15,
  feature: 'By Popular Demand',
  featureDesc: 'You can always find a place to perform, receiving free lodging and food in exchange, and you gain the favor of the local crowd.',
  variants: ['Gladiator'],
};

const FOLK_HERO: BackgroundEntry = {
  name: 'Folk Hero',
  skills: ['Animal Handling', 'Survival'],
  tools: ["One artisan's tools of your choice", 'Vehicles (Land)'],
  languageChoices: 0,
  gold: 10,
  feature: 'Rustic Hospitality',
  featureDesc: 'Common folk will shelter you from the law or enemies. They will not risk their lives for you but will help in non-dangerous ways.',
};

const GUILD_ARTISAN: BackgroundEntry = {
  name: 'Guild Artisan',
  skills: ['Insight', 'Persuasion'],
  tools: ["One artisan's tools of your choice"],
  languageChoices: 1,
  gold: 15,
  feature: 'Guild Membership',
  featureDesc: 'As an established guild member, you receive lodging, legal aid, and access to guild resources; in return the guild expects dues and loyalty.',
  variants: ['Guild Merchant'],
};

const HERMIT: BackgroundEntry = {
  name: 'Hermit',
  skills: ['Medicine', 'Religion'],
  tools: ['Herbalism Kit'],
  languageChoices: 1,
  gold: 5,
  feature: 'Discovery',
  featureDesc: 'Your solitary time granted you a unique and powerful discovery — a great truth, a hidden place, or a profound secret.',
};

const NOBLE: BackgroundEntry = {
  name: 'Noble',
  skills: ['History', 'Persuasion'],
  tools: ['One gaming set of your choice'],
  languageChoices: 1,
  gold: 25,
  feature: 'Position of Privilege',
  featureDesc: 'Your noble rank opens doors, secures the best service, and makes common folk and nobles assume the best of you.',
  variants: ['Knight'],
};

const OUTLANDER: BackgroundEntry = {
  name: 'Outlander',
  skills: ['Athletics', 'Survival'],
  tools: ['One musical instrument of your choice'],
  languageChoices: 1,
  gold: 10,
  feature: 'Wanderer',
  featureDesc: 'You have an excellent memory for maps and geography; you can always find food and fresh water for yourself and up to five others.',
};

const SAGE: BackgroundEntry = {
  name: 'Sage',
  skills: ['Arcana', 'History'],
  tools: [],
  languageChoices: 2,
  gold: 10,
  feature: 'Researcher',
  featureDesc: "When you don't know information, you know where to find it: libraries, sages, or other lore sources you can reliably access.",
};

const SAILOR: BackgroundEntry = {
  name: 'Sailor',
  skills: ['Athletics', 'Perception'],
  tools: ["Navigator's Tools", 'Vehicles (Water)'],
  languageChoices: 0,
  gold: 10,
  feature: "Ship's Passage",
  featureDesc: 'You can secure free passage on a sailing ship for you and companions, in exchange for labor during the voyage.',
  variants: ['Pirate'],
};

const SOLDIER: BackgroundEntry = {
  name: 'Soldier',
  skills: ['Athletics', 'Intimidation'],
  tools: ['One gaming set of your choice', 'Vehicles (Land)'],
  languageChoices: 0,
  gold: 10,
  feature: 'Military Rank',
  featureDesc: 'Soldiers loyal to your former military organization still recognize your authority and may defer to you.',
};

const URCHIN: BackgroundEntry = {
  name: 'Urchin',
  skills: ['Sleight of Hand', 'Stealth'],
  tools: ['Disguise Kit', "Thieves' Tools"],
  languageChoices: 0,
  gold: 10,
  feature: 'City Secrets',
  featureDesc: 'You know the secret patterns and flows of cities; you can find passages through the urban sprawl that others miss, moving at twice your normal speed.',
};

// ── Master table ──────────────────────────────────────────────

/** All 13 PHB 2014 backgrounds, keyed by name. */
export const BACKGROUND_DATA: Record<string, BackgroundEntry> = {
  'Acolyte':       ACOLYTE,
  'Charlatan':     CHARLATAN,
  'Criminal':      CRIMINAL,
  'Entertainer':   ENTERTAINER,
  'Folk Hero':     FOLK_HERO,
  'Guild Artisan': GUILD_ARTISAN,
  'Hermit':        HERMIT,
  'Noble':         NOBLE,
  'Outlander':     OUTLANDER,
  'Sage':          SAGE,
  'Sailor':        SAILOR,
  'Soldier':       SOLDIER,
  'Urchin':        URCHIN,
};

/** Sorted list of all background names for API responses. */
export const BACKGROUND_NAMES: string[] = Object.keys(BACKGROUND_DATA).sort();
