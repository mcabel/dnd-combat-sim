// ============================================================
// Summon-Type Registry (Phase 5.1)
// Creatures excluded from the main bestiary (no numeric CR, or
// power scales with summoner/caster) are catalogued here with:
//   - Estimated standalone CR (for balanced encounter math)
//   - HP formula keyed by caster/item level
//   - Notes on what controls them
//
// USAGE:
//   import { getSummonEntry, listSummons } from './registry';
//   const entry = getSummonEntry('Giant Fly');
//   const fly = spawnFromSummon(entry, rawBestiaryEntry, pos, 'defend');
//
// ADDING NEW ENTRIES:
//   1. Add a SummonEntry to SUMMON_REGISTRY below.
//   2. The raw 5etools stat block must be in a bestiary JSON
//      (it is loaded via loadBestiaryJson but excluded from main bestiary).
//   3. Set estimatedCR to your best estimate for fair encounter building.
//   4. Set hpByLevel or hpFixed for spawn-time HP override.
// ============================================================

import { AIProfile } from '../types/core';

// ---- Types --------------------------------------------------

export type SummonSource =
  | 'magic_item'       // e.g. Figurine of Wondrous Power
  | 'spell'            // e.g. Conjure Animals, Find Familiar
  | 'class_feature'    // e.g. Ranger Companion (future)
  | 'animated_object'  // e.g. Animate Objects
  | 'other';

/**
 * Role of a summon-type creature in combat:
 * - 'friendly_mount'  : Party-side. Can carry a PC rider. Obeys commands from rider.
 *                       If it can't attack (defend-only), its TRUE CR is 0 for encounter math.
 *                       Example: Giant Fly (Ebony Fly figurine).
 * - 'combat_mount'    : Party-side. Can carry AND attack independently.
 *                       Example: Warhorse, Giant Eagle — has its own attacks and uses them.
 * - 'familiar'        : Party-side. Cannot attack; uses Help action. Tiny, fragile.
 *                       Example: Owl, Cat (Find Familiar).
 * - 'hostile_minion'  : Enemy-side. Can be mounted by enemy non-mount monsters.
 *                       Example: a summoned beast serving a monster band.
 * - 'independent'     : No mount/familiar role — treated like any other monster.
 *                       Example: Avatar of Death.
 */
export type SummonRole =
  | 'friendly_mount'
  | 'combat_mount'
  | 'familiar'
  | 'hostile_minion'
  | 'independent';

export interface SummonEntry {
  /** Canonical name — must match 5etools monster name exactly */
  name: string;

  /** Estimated standalone CR for encounter budget purposes */
  estimatedCR: number;

  /**
   * TRUE CR: effective CR when used in its intended role.
   * For defend-only friendly mounts with no attacks, this is 0
   * (they will lose 100% of solo fights → contribute 0 to encounter budget).
   * For combat mounts that can attack, trueCR == estimatedCR.
   * For familiars, trueCR = 0 (they Help but can't fight).
   */
  trueCR: number;

  /** Source type — affects which test tab handles this creature */
  source: SummonSource;

  /** Combat role — determines which side and how it interacts with mounts */
  role: SummonRole;

  /**
   * Can this creature make attack actions on its own turn?
   * False for defend-only mounts (Giant Fly has no attack in stat block).
   * True for combat mounts (Warhorse has Hooves attack).
   */
  canAttack: boolean;

  /**
   * Can this creature carry a rider?
   * True for friendly_mount and combat_mount roles.
   * Horses, Giant Fly, etc.
   */
  canBeMounted: boolean;

  /**
   * How to determine HP at spawn time.
   * hpFixed:   always this HP regardless of summoner
   * hpByLevel: HP = hpByLevel[casterLevel] (key = 1..9 or item charge level)
   * hpFormula: multiply summoner's maxHP by this fraction (e.g. Avatar of Death = 0.5)
   */
  hp: { type: 'fixed'; value: number }
    | { type: 'byLevel'; table: Record<number, number> }
    | { type: 'summonerFraction'; fraction: number };

  /** Default AI profile when no command is active */
  defaultProfile: AIProfile;

  /** Whether this creature obeys verbal commands (no action cost) */
  obeysVerbalCommands: boolean;

  /** Profile used when a verbal command overrides default behaviour */
  commandedProfile: AIProfile;

  /** Free-text note for the DM / simulation context */
  notes: string;
}

// ---- Registry -----------------------------------------------

export const SUMMON_REGISTRY: SummonEntry[] = [

  // ----------------------------------------------------------
  // Figurine of Wondrous Power — Ebony Fly (DMG p.169)
  // Transforms into a Giant Fly for up to 24 hours (or 12 per week).
  // INT 2 → defend-only unless commanded via verbal order (no action).
  // Designed as a mount; mount rules apply when ridden.
  // Standalone CR estimated 0 (weaker than a Larva in a fight).
  // ----------------------------------------------------------
  {
    name: 'Giant Fly',
    estimatedCR: 0,
    trueCR: 0,            // No attacks → loses 100% solo → TRUE CR 0
    source: 'magic_item',
    role: 'friendly_mount',
    canAttack: false,     // No attack actions in stat block
    canBeMounted: true,
    hp: { type: 'fixed', value: 19 },        // 3d10+3, average 19 per stat block
    defaultProfile: 'defend',
    obeysVerbalCommands: true,
    commandedProfile: 'attackNearest',
    notes: 'Figurine of Wondrous Power (Ebony Fly). Defend-only until commanded. ' +
           'Mount: rider uses mount\'s movement; mount cannot take actions while being ridden ' +
           '(controlled mount rule). TRUE CR 0 — stat block has no attack actions so it ' +
           'loses any solo fight. Only contributes as mobility platform for rider.',
  },

  // ----------------------------------------------------------
  // Deck of Many Things — Avatar of Death (DMG p.164)
  // HP = exactly half the drawing PC's HP maximum.
  // Attacks only the PC who drew the card; neutral to all others.
  // If the PC wins, the Avatar vanishes — it cannot be "looted".
  // ----------------------------------------------------------
  {
    name: 'Avatar of Death',
    estimatedCR: 13,       // effectively "scales to PC" — 13 is the card's threat level
    trueCR: 13,
    source: 'other',
    role: 'independent',
    canAttack: true,
    canBeMounted: false,
    hp: { type: 'summonerFraction', fraction: 0.5 },
    defaultProfile: 'smart',
    obeysVerbalCommands: false,
    commandedProfile: 'smart',
    notes: 'Deck of Many Things, Death card. HP = half summoner maxHP. ' +
           'Attacks only the card drawer; ignores all others. ' +
           'Vanishes if defeated or if 24 hours pass.',
  },

  // ----------------------------------------------------------
  // Placeholder entries for common summon types.
  // Uncomment and verify against your bestiary files.
  // ----------------------------------------------------------

  // Find Familiar — Owl (PHB p.240)
  // {
  //   name: 'Owl',
  //   estimatedCR: 0,
  //   source: 'spell',
  //   hp: { type: 'fixed', value: 1 },
  //   defaultProfile: 'defend',
  //   obeysVerbalCommands: true,
  //   commandedProfile: 'attackNearest',
  //   notes: 'Find Familiar. HP 1. Cannot attack; used for scouting/Help action. ' +
  //          'Telepathic link to caster within 100ft.',
  // },

  // Conjure Animals (level 3 spell) — Wolf ×4 for example
  // {
  //   name: 'Wolf',
  //   estimatedCR: 0.25,
  //   source: 'spell',
  //   hp: { type: 'fixed', value: 11 },
  //   defaultProfile: 'attackNearest',
  //   obeysVerbalCommands: true,
  //   commandedProfile: 'attackNearest',
  //   notes: 'Conjure Animals. Pack Tactics. Knock Prone on hit (STR DC 11).',
  // },

  // ----------------------------------------------------------
  // Combat Mounts — party-side, CAN attack, CAN be ridden
  // These are true combat_mount role: they fight AND carry riders
  // ----------------------------------------------------------

  {
    name: 'Warhorse',
    estimatedCR: 0.5,
    trueCR: 0.5,           // Has Hooves attack — genuinely fights
    source: 'other',
    role: 'combat_mount',
    canAttack: true,       // Hooves: +6, 2d6+4 bludgeoning
    canBeMounted: true,
    hp: { type: 'fixed', value: 19 },    // CR 1/2, avg 19 HP
    defaultProfile: 'attackNearest',
    obeysVerbalCommands: true,
    commandedProfile: 'smart',
    notes: 'Standard warhorse (MM). Hooves attack +6 to hit, 2d6+4 bludgeoning. ' +
           'Used by Paladins and mounted fighters. Counts as combat_mount — ' +
           'it actively participates in combat, not just mobility.',
  },

  {
    name: 'Giant Eagle',
    estimatedCR: 1,
    trueCR: 1,             // Full CR 1 combat capability
    source: 'other',
    role: 'combat_mount',
    canAttack: true,       // Talons + Beak attacks
    canBeMounted: true,
    hp: { type: 'fixed', value: 26 },
    defaultProfile: 'smart',
    obeysVerbalCommands: true,
    commandedProfile: 'smart',
    notes: 'Giant Eagle (MM). Understands Common/Auran. Talons +5, Beak +5. ' +
           'Fly speed 80ft. Frequently used as mount for Small/Medium creatures.',
  },

  {
    name: 'Hippogriff',
    estimatedCR: 1,
    trueCR: 1,
    source: 'other',
    role: 'combat_mount',
    canAttack: true,       // Claws + Beak attacks
    canBeMounted: true,
    hp: { type: 'fixed', value: 19 },
    defaultProfile: 'attackNearest',
    obeysVerbalCommands: true,
    commandedProfile: 'attackNearest',
    notes: 'Hippogriff (MM). Claws +5, Beak +5. Fly speed 60ft. ' +
           'Must be trained — treat as obeying commands once tamed.',
  },

  // ----------------------------------------------------------
  // Friendly Mounts — party-side, limited or no attacks, CAN be ridden
  // These provide mobility but minimal combat contribution
  // ----------------------------------------------------------

  {
    name: 'Riding Horse',
    estimatedCR: 0.25,
    trueCR: 0.25,          // Has Hooves but rarely fights
    source: 'other',
    role: 'friendly_mount',
    canAttack: true,       // Hooves: +4, 2d4+2, but not designed for combat
    canBeMounted: true,
    hp: { type: 'fixed', value: 13 },
    defaultProfile: 'defend',   // Flees by default — not a warhorse
    obeysVerbalCommands: true,
    commandedProfile: 'attackNearest',
    notes: 'Riding Horse (MM). Hooves +4, 2d4+2. Not trained for combat — ' +
           'uses defend profile (flees unless commanded). Speed 60ft ground. ' +
           'trueCR 0.25 but effective combat contribution close to 0 on defend profile.',
  },

  {
    name: 'Mule',
    estimatedCR: 0.125,
    trueCR: 0.125,
    source: 'other',
    role: 'friendly_mount',
    canAttack: true,       // Hooves: +2, 1d4+1, minimal
    canBeMounted: true,
    hp: { type: 'fixed', value: 11 },
    defaultProfile: 'defend',
    obeysVerbalCommands: true,
    commandedProfile: 'attackNearest',
    notes: 'Mule (MM). Pack animal. Hooves +2, minimal damage. ' +
           'Primarily useful for carrying capacity, not combat. Speed 40ft.',
  },

  {
    name: 'Camel',
    estimatedCR: 0.125,
    trueCR: 0.125,
    source: 'other',
    role: 'friendly_mount',
    canAttack: true,       // Bite: +4, 2d4+2
    canBeMounted: true,
    hp: { type: 'fixed', value: 15 },
    defaultProfile: 'defend',
    obeysVerbalCommands: true,
    commandedProfile: 'attackNearest',
    notes: 'Camel (MM). Bite +4, 2d4+2. Desert transport. ' +
           'More resilient than a riding horse (15 HP). Speed 50ft.',
  },

  // ----------------------------------------------------------
  // Familiars — party-side, cannot attack (rules), provide utility
  // ----------------------------------------------------------

  {
    name: 'Owl',
    estimatedCR: 0,
    trueCR: 0,             // Cannot attack in familiar form
    source: 'spell',
    role: 'familiar',
    canAttack: false,      // Find Familiar: familiar cannot attack
    canBeMounted: false,
    hp: { type: 'fixed', value: 1 },
    defaultProfile: 'defend',
    obeysVerbalCommands: true,
    commandedProfile: 'defend',   // Familiar never attacks — Help action only
    notes: 'Owl familiar (Find Familiar, PHB p.240). Cannot attack in familiar form. ' +
           'Flies to any location, delivers touch spells, shares senses with caster. ' +
           'Uses Help action to grant advantage to caster next attack roll. ' +
           'Flyby trait: no opportunity attacks. HP 1 — extremely fragile.',
  },

  {
    name: 'Cat',
    estimatedCR: 0,
    trueCR: 0,
    source: 'spell',
    role: 'familiar',
    canAttack: false,
    canBeMounted: false,
    hp: { type: 'fixed', value: 2 },
    defaultProfile: 'defend',
    obeysVerbalCommands: true,
    commandedProfile: 'defend',
    notes: 'Cat familiar (Find Familiar, PHB p.240). Cannot attack in familiar form. ' +
           'Keen smell and hearing. Uses Help action only.',
  },


];

// ---- Registry helpers ---------------------------------------

/** Look up a summon entry by name (case-insensitive). */
export function getSummonEntry(name: string): SummonEntry | null {
  return SUMMON_REGISTRY.find(e => e.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** All registered summon names. */
export function listSummons(): string[] {
  return SUMMON_REGISTRY.map(e => e.name);
}

/** All summons of a given source type. */
export function getSummonsBySource(source: SummonSource): SummonEntry[] {
  return SUMMON_REGISTRY.filter(e => e.source === source);
}

/** All friendly mounts (party-side, can carry a PC). */
export function getFriendlyMounts(): SummonEntry[] {
  return SUMMON_REGISTRY.filter(e =>
    e.role === 'friendly_mount' || e.role === 'combat_mount'
  );
}

/** All familiars (party-side, cannot attack). */
export function getFamiliars(): SummonEntry[] {
  return SUMMON_REGISTRY.filter(e => e.role === 'familiar');
}

/** All hostile minions (enemy-side, can be mounted by enemy monsters). */
export function getHostileMinions(): SummonEntry[] {
  return SUMMON_REGISTRY.filter(e => e.role === 'hostile_minion');
}

/**
 * Effective CR for encounter budget math.
 * Uses trueCR, not estimatedCR, since trueCR reflects actual combat contribution.
 * A defend-only mount with no attacks = trueCR 0 regardless of its stat block.
 */
export function effectiveCRForBudget(entry: SummonEntry): number {
  return entry.trueCR;
}
