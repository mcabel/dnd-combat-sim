// ============================================================
// PC Stat Block Parser
// Converts pc_stat_blocks_lv1.json entries into Combatants.
// Covers all 12 classes at level 1 (PHB 2014, pre-2024).
// ============================================================

import {
  Combatant, Action, AIProfile, ActionBudget,
  PerceptionMemory, DiceExpression, Vec3,
  PlayerResources, SpellSlots,
} from '../types/core';
import { abilityMod } from '../engine/utils';

// ---- Raw PC JSON shapes -------------------------------------

interface RawWeapon {
  name: string;
  bonus: number;
  damage: string;          // e.g. "1d8+3", "2d6+3+2d8"
  type: string;
  range: string;
  note?: string;
  cost?: string;           // 'bonusAction' for monk unarmed bonus
  isCantrip?: boolean;
  isSave?: boolean;
  saveDC?: number;
  saveAbility?: string;
  noAttackRoll?: boolean;
}

interface RawSpellcasting {
  ability: string;
  spellAttackBonus: number;
  saveDC: number;
  slots?: Record<string, number>;
  pactSlots?: Record<string, number>;
  cantrips?: string[];
  spells_1st?: string[];
  preparedSpells?: string[];
  spellbook?: string[];
}

interface RawResource {
  uses?: number;
  usedToday?: number;
  active?: boolean;
  pool?: number;
  remaining?: number;
  die?: string;
  pactSlots?: number;
  usedThisRest?: boolean;
  effect?: string;
  note?: string;
  recovery?: string;
  dice?: string;
  condition?: string;
}

interface RawResources {
  rage?:               RawResource;
  secondWind?:         RawResource;
  bardicInspiration?:  RawResource;
  sneakAttack?:        RawResource;
  divineSmite?:        boolean | RawResource;
  layOnHands?:         RawResource;
  divineSense?:        RawResource;
  pactMagic?:          RawResource;
  arcaneRecovery?:     RawResource;
}

export interface RawPCEntry {
  class: string;
  subclass: string;
  race: string;
  background: string;
  level: number;
  proficiencyBonus: number;
  ability_scores: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  modifiers:       { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  hp: number;
  ac: number;
  acFormula: string;
  speed: number;
  savingThrows: Record<string, boolean>;
  skills: { proficient: string[]; expertise: string[] };
  weapons: RawWeapon[];
  spellcasting: RawSpellcasting | null;
  resources: RawResources;
  level1Features: { name: string; description: string }[];
  racialTraits: { name: string; description: string }[];
}

// ---- Dice parsing (shared with fivetools, duplicated here to avoid circular) ---

function parseDamageDice(raw: string): DiceExpression | null {
  // Take only the FIRST dice expression (e.g. "1d8+3+2d8" → use "1d8+3" for primary)
  const m = raw.match(/(\d+)d(\d+)\s*([+-]\s*\d+)?/);
  if (!m) return null;
  const count  = parseInt(m[1], 10);
  const sides  = parseInt(m[2], 10);
  const bonus  = parseInt((m[3] ?? '+0').replace(/\s/g, ''), 10);
  return { count, sides, bonus, average: Math.floor(count * (sides + 1) / 2) + bonus };
}

// ---- Weapon → Action conversion -----------------------------

function weaponToAction(w: RawWeapon, profBonus: number): Action {
  const rangeLower = w.range.toLowerCase();
  const isMelee   = rangeLower.includes('melee');
  const isRanged  = rangeLower.includes('ft') && !isMelee;
  const isCantrip = w.isCantrip ?? false;
  const isSave    = w.isSave ?? false;

  // Reach: default 5ft; long weapons might say "10ft"
  const reachMatch = w.range.match(/melee\s+(\d+)ft/i);
  const reach      = reachMatch ? parseInt(reachMatch[1], 10) : 5;

  // Range bands: "ranged 150/600ft" or "thrown 20/60ft"
  let rangeObj: { normal: number; long: number } | null = null;
  const rangeMatch = w.range.match(/(\d+)\/(\d+)\s*ft/i);
  if (rangeMatch) rangeObj = { normal: parseInt(rangeMatch[1], 10), long: parseInt(rangeMatch[2], 10) };

  const damage = parseDamageDice(w.damage);

  // Attack type
  let attackType: Action['attackType'];
  if (isSave)           attackType = 'save';
  else if (isCantrip)   attackType = isMelee ? 'spell' : 'ranged';
  else if (isMelee)     attackType = 'melee';
  else if (isRanged)    attackType = 'ranged';
  else                  attackType = 'special';

  // Cost
  const costType: Action['costType'] =
    w.cost === 'bonusAction' ? 'bonusAction' : 'action';

  return {
    name: w.name,
    isMultiattack: false,
    attackType,
    reach,
    range: rangeObj,
    hitBonus: w.noAttackRoll ? null : w.bonus,
    damage,
    damageType: w.type as Action['damageType'],
    saveDC:      w.saveDC      ?? null,
    saveAbility: (w.saveAbility as Action['saveAbility']) ?? null,
    isAoE:    false,
    isControl: false,
    requiresConcentration: [
      'bless', 'shield of faith', 'entangle', 'faerie fire',
      'hex', "hunter's mark", 'hold person', 'guiding bolt',
    ].some(s => w.name.toLowerCase().includes(s)),
    costType,
    legendaryCost: 0,
    description: w.note ?? w.name,
  };
}

// ---- Fresh budget from speed --------------------------------

function freshBudget(speedFt: number): ActionBudget {
  return {
    movementFt: speedFt,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    freeObjectUsed: false,
  };
}

function emptyPerception(): PerceptionMemory {
  return { targets: new Map() };
}

// ---- Fly speed from race description -----------------------

/** Some races have fly speed listed in racial traits (e.g. Aarakocra). None at level 1 in our set. */
function extractFlySpeed(_pc: RawPCEntry): number | null {
  return null; // Level 1 PCs in our data set have no fly speed
}

// ---- ID generation -----------------------------------------

let _pcId = 0;
function nextPCId(className: string): string {
  return `${className.toLowerCase()}_pc_${++_pcId}`;
}


// ---- Build PlayerResources from raw JSON -------------------

function buildResources(raw: RawPCEntry): PlayerResources | null {
  const r = raw.resources;
  const sp = raw.spellcasting;
  const result: PlayerResources = {};

  // Spell slots (standard casters)
  if (sp?.slots) {
    const slots: SpellSlots = {};
    for (const [lvl, max] of Object.entries(sp.slots)) {
      slots[parseInt(lvl)] = { max: max as number, remaining: max as number };
    }
    result.spellSlots = slots;
  }

  // Pact slots (Warlock — short rest recovery)
  if (sp?.pactSlots) {
    const entries = Object.entries(sp.pactSlots);
    if (entries.length > 0) {
      const [lvl, max] = entries[0];
      result.pactSlots = { max: max as number, remaining: max as number, slotLevel: parseInt(lvl), recoversOn: 'short' };
    }
    // Dark One's Blessing (Fiend patron)
    const className = raw.subclass.toLowerCase();
    if (className.includes('fiend')) {
      // CHA mod + warlock level temp HP on kill
      const chaMod = raw.modifiers.cha ?? 0;
      result.darkOnesBlessing = { amount: Math.max(1, chaMod + raw.level) };
    }
  }

  // Rage (Barbarian)
  if (r?.rage) {
    result.rage = {
      max: r.rage.uses ?? 2,
      remaining: r.rage.uses ?? 2,
      active: false,
      roundsRemaining: 0,
    };
  }

  // Second Wind (Fighter)
  if (r?.secondWind) {
    result.secondWind = { max: 1, remaining: 1 };
  }

  // Bardic Inspiration (Bard)
  if (r?.bardicInspiration) {
    result.bardicInspiration = {
      max: r.bardicInspiration.uses ?? 3,
      remaining: r.bardicInspiration.uses ?? 3,
      die: r.bardicInspiration.die ?? 'd6',
    };
  }

  // Lay on Hands + Divine Smite (Paladin)
  if (r?.layOnHands) {
    result.layOnHands = { pool: r.layOnHands.pool ?? 5, remaining: r.layOnHands.pool ?? 5 };
  }
  if (r?.divineSmite !== undefined) {
    result.divineSmite = true;
  }

  // Sneak Attack (Rogue)
  if (r?.sneakAttack) {
    result.sneakAttackDice = r.sneakAttack.dice ?? '1d6';
  }

  // Arcane Recovery (Wizard)
  if (r?.arcaneRecovery) {
    result.arcaneRecovery = { usesRemaining: 1 };
  }

  // Ammo tracking — check weapons for ammo notes
  const ammoWeapons: { [k: string]: { max: number; remaining: number } } = {};
  for (const w of raw.weapons) {
    // 'ammo' property in JSON e.g. "20 arrows"
    if ((w as any).ammo) {
      const m = String((w as any).ammo).match(/(\d+)/);
      const count = m ? parseInt(m[1]) : 20;
      ammoWeapons[w.name.toLowerCase()] = { max: count, remaining: count };
    }
  }
  if (Object.keys(ammoWeapons).length > 0) result.ammo = ammoWeapons;

  return Object.keys(result).length > 0 ? result : null;
}

// ---- Main export --------------------------------------------

/**
 * Convert a pc_stat_blocks_lv1.json entry into a Combatant.
 *
 * @param raw      - single PC entry from pc_stat_blocks_lv1.json
 * @param pos      - starting grid position
 * @param profile  - AI profile (default: 'balanced' → mapped to 'smart' for now)
 */
export function pcToCombatant(
  raw: RawPCEntry,
  pos: Vec3 = { x: 0, y: 0, z: 0 },
  profile: AIProfile = 'smart'
): Combatant {
  const prof = raw.proficiencyBonus;

  // Convert all weapons to Actions (filter out duplicate +SA entries — those are
  // the same weapon with sneak attack note; the engine applies SA conditionally)
  const actions: Action[] = raw.weapons
    .filter(w => !w.name.includes('+SA') && !w.name.includes('+Smite'))
    .map(w => weaponToAction(w, prof));

  // Traits list = feature names (for Pack Tactics etc. checks)
  const traits: string[] = [
    ...raw.level1Features.map(f => f.name),
    ...raw.racialTraits.map(t => t.name),
  ];

  const flySpeed = extractFlySpeed(raw);

  return {
    id: nextPCId(raw.class),
    name: `${raw.class} (${raw.race})`,
    isPlayer: true,
    faction: 'party',

    maxHP:     raw.hp,
    currentHP: raw.hp,
    ac:        raw.ac,
    speed:     raw.speed,
    flySpeed,
    swimSpeed:   null,
    burrowSpeed: null,

    str: raw.ability_scores.str,
    dex: raw.ability_scores.dex,
    con: raw.ability_scores.con,
    int: raw.ability_scores.int,
    wis: raw.ability_scores.wis,
    cha: raw.ability_scores.cha,

    cr: null, // PCs don't have CR

    pos: { ...pos },

    actions,
    traits,
    legendaryActions:     [],
    legendaryActionPool:  0,
    legendaryActionPoolMax: 0,

    budget: freshBudget(raw.speed),

    conditions: new Set(),

    aiProfile: profile,
    perception: emptyPerception(),

    concentration: null,
    deathSaves: { successes: 0, failures: 0 },   // PCs always have death saves
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    tempHP: 0,
    resources: buildResources(raw),
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    isDead:        false,
    isUnconscious: false,
    advantages:      [],
    vulnerabilities: [],
  };
}

/**
 * Load all PC entries from the parsed JSON array.
 * Returns a map keyed by class name (lowercase).
 */
export function loadPCStatBlocks(
  data: RawPCEntry[]
): Map<string, RawPCEntry> {
  const map = new Map<string, RawPCEntry>();
  for (const pc of data) {
    map.set(pc.class.toLowerCase(), pc);
  }
  return map;
}

/**
 * Spawn a PC by class name from a loaded stat block map.
 * Returns null if not found.
 */
export function spawnPC(
  pcMap: Map<string, RawPCEntry>,
  className: string,
  pos: Vec3,
  profile: AIProfile = 'smart'
): Combatant | null {
  const raw = pcMap.get(className.toLowerCase());
  if (!raw) return null;
  return pcToCombatant(raw, pos, profile);
}
