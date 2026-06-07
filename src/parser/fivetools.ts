// ============================================================
// Parser: 5etools bestiary JSON format → Combatant
// Handles bestiary-dmg.json and all standard 5etools files.
// ============================================================

import {
  Action,
  Combatant,
  DamageType,
  DiceExpression,
  LegendaryAction,
  PerceptionMemory,
  Vec3,
  AIProfile,
  ActionBudget,
  CreatureSize,
} from '../types/core';

// ---- 5etools raw shapes (minimal — only what we need) -------

interface RawSpeed {
  walk?: number;
  fly?: number | { number: number; condition: string };
  swim?: number;
  burrow?: number;
  canHover?: boolean;
}

interface RawHp {
  average?: number;
  formula?: string;
  special?: string;
}

interface RawAction {
  name: string;
  entries: (string | object)[];
}

// Exported so tests/loaders can type their JSON imports
export interface Raw5etoolsMonster {
  name: string;
  source: string;
  cr?: string | { cr: string };
  ac?: (number | { ac: number; from?: string[] })[];
  hp?: RawHp;
  speed?: RawSpeed;
  str?: number; dex?: number; con?: number;
  int?: number; wis?: number; cha?: number;
  action?: RawAction[];
  legendary?: RawAction[];
  trait?: RawAction[];
  type?: string | { type: string };
  size?: string | string[];
}

// ---- Dice parsing -------------------------------------------

/**
 * Parse "2d6 + 3", "1d8", "1d4 - 1",
 * "{@damage 1d8 + 3}", "{@dice 2d6}" into a DiceExpression.
 * Returns null if no dice pattern found.
 */
export function parseDice(raw: string): DiceExpression | null {
  // Strip 5etools inline tags
  const cleaned = raw.replace(/\{@(?:damage|dice|hit)\s+([^}]+)\}/g, '$1').trim();
  const match = cleaned.match(/(\d+)d(\d+)\s*([+-]\s*\d+)?/);
  if (!match) return null;

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const bonusStr = (match[3] ?? '+0').replace(/\s/g, '');
  const bonus = parseInt(bonusStr, 10);
  const average = Math.floor(count * (sides + 1) / 2) + bonus;

  return { count, sides, bonus, average };
}

/** Parse hit bonus from "{@hit 5}", "+5 to hit", or plain integer string */
function parseHitBonus(text: string): number | null {
  const tagMatch = text.match(/\{@hit\s+(-?\d+)\}/);
  if (tagMatch) return parseInt(tagMatch[1], 10);
  const phraseMatch = text.match(/([+-]?\d+)\s+to\s+hit/i);
  if (phraseMatch) return parseInt(phraseMatch[1], 10);
  return null;
}

/** Extract reach: "reach 5 ft." → 5. Defaults to 5. */
function parseReach(text: string): number {
  const m = text.match(/reach\s+(\d+)\s*ft/i);
  return m ? parseInt(m[1], 10) : 5;
}

/** Extract range: "range 20/60 ft." → { normal: 20, long: 60 } */
function parseRange(text: string): { normal: number; long: number } | null {
  const m = text.match(/range\s+(\d+)\/(\d+)\s*ft/i);
  return m ? { normal: parseInt(m[1], 10), long: parseInt(m[2], 10) } : null;
}

/** Detect AoE language in an action description */
function detectAoE(text: string): boolean {
  return /\beach\s+creature\b|radius|cone\b|line\b|cube\b|\d+[\s-]foot\s+(radius|cone|cube|line)/i.test(text);
}

/** Detect control condition language in an action description */
function detectControl(text: string): boolean {
  return /\brestrained\b|\bstunned\b|\bfrightened\b|\bgrappled\b|\bparalyzed\b|\bincapacitated\b|\bprone\b/i.test(text);
}

/** Flatten 5etools entries (strings + nested objects) to plain text */
function flattenEntries(entries: (string | object)[]): string {
  return entries
    .map(e => (typeof e === 'string' ? e : JSON.stringify(e)))
    .join(' ');
}

/** Detect attack type from 5etools {@atk} tags or plain text */
function detectAttackType(text: string): AttackType | null {
  if (/\{@atk\s+mw\}|\bmelee\s+weapon\s+attack\b/i.test(text)) return 'melee';
  if (/\{@atk\s+rw\}|\branged\s+weapon\s+attack\b/i.test(text)) return 'ranged';
  if (/\{@atk\s+m[ws]\}|\{@atk\s+r[ws]\}|\b(melee|ranged)\s+spell\s+attack\b/i.test(text)) return 'spell';
  if (/\bdc\s*\d+\b|\bsaving\s+throw\b/i.test(text)) return 'save';
  // Fallback: "within N feet" + damage dice → infer melee
  if (/within\s+\d+\s*feet?\b/i.test(text) && /\{@damage/.test(text)) return 'melee';
  return null;
}

type AttackType = import('../types/core').AttackType;

/** Parse save DC + ability from text */
function parseSave(text: string): { dc: number; ability: import('../types/core').AbilityScore } | null {
  const dcMatch = text.match(/\{@dc\s+(\d+)\}|dc\s+(\d+)/i);
  if (!dcMatch) return null;
  const dc = parseInt(dcMatch[1] ?? dcMatch[2], 10);

  const abilityMap: Record<string, import('../types/core').AbilityScore> = {
    strength: 'str', str: 'str',
    dexterity: 'dex', dex: 'dex',
    constitution: 'con', con: 'con',
    intelligence: 'int', int: 'int',
    wisdom: 'wis', wis: 'wis',
    charisma: 'cha', cha: 'cha',
  };
  const abilityMatch = text.match(
    /\b(strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha)\b/i
  );
  const ability = abilityMatch
    ? (abilityMap[abilityMatch[1].toLowerCase()] ?? 'str')
    : 'str';
  return { dc, ability };
}

/** Detect primary damage type — returns the FIRST type that appears in the text */
function parseDamageType(text: string): DamageType | null {
  const types: DamageType[] = [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
    'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  ];
  const lower = text.toLowerCase();
  let earliest: { type: DamageType; idx: number } | null = null;
  for (const t of types) {
    const idx = lower.indexOf(t);
    if (idx !== -1 && (earliest === null || idx < earliest.idx)) {
      earliest = { type: t, idx };
    }
  }
  return earliest ? earliest.type : null;
}

// ---- Action parser ------------------------------------------

/**
 * Parse a single 5etools action/legendary entry into our Action type.
 * legendaryCost = 0 for regular actions.
 */

/** Detect if the action description indicates concentration is required */
function detectConcentration(text: string): boolean {
  return /\bconcentration\b/i.test(text);
}
export function parseAction(
  raw: RawAction,
  costType: Action['costType'] = 'action',
  legendaryCost = 0
): Action {
  const description = flattenEntries(raw.entries);
  const attackType = detectAttackType(description);
  const hitBonus = parseHitBonus(description);
  const reach = parseReach(description);
  const range = parseRange(description);
  const isAoE = detectAoE(description);
  const isControl = detectControl(description);
  const damageType = parseDamageType(description);
  const isMultiattack = /multiattack/i.test(raw.name);

  // Primary damage: first {@damage ...} tag, then fallback to plain dice pattern
  let damage: DiceExpression | null = null;
  const tagMatches = [...description.matchAll(/\{@damage\s+([^}]+)\}/g)];
  for (const m of tagMatches) {
    const parsed = parseDice(m[1]);
    if (parsed) { damage = parsed; break; }
  }
  if (!damage) damage = parseDice(description);

  let saveDC: number | null = null;
  let saveAbility: Action['saveAbility'] = null;
  const save = parseSave(description);
  if (save) { saveDC = save.dc; saveAbility = save.ability; }

  return {
    name: raw.name,
    isMultiattack,
    attackType,
    reach,
    range,
    hitBonus,
    damage,
    damageType,
    saveDC,
    saveAbility,
    isAoE,
    isControl,
    requiresConcentration: detectConcentration(description),
    costType,
    legendaryCost,
    description,
  };
}

// ---- Stat block field parsers -------------------------------

function parseCR(cr: Raw5etoolsMonster['cr']): number | null {
  if (cr === undefined) return null;
  const raw = typeof cr === 'string' ? cr : cr.cr;
  if (raw === '1/8') return 0.125;
  if (raw === '1/4') return 0.25;
  if (raw === '1/2') return 0.5;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

function parseAC(ac: Raw5etoolsMonster['ac']): number {
  if (!ac || ac.length === 0) return 10;
  const first = ac[0];
  return typeof first === 'number' ? first : first.ac;
}

function parseHP(hp: RawHp | undefined): number {
  if (!hp) return 1;
  if (hp.average !== undefined) return hp.average;
  if (hp.formula) {
    const dice = parseDice(hp.formula);
    return dice ? dice.average : 1;
  }
  // "special" text (e.g. "half the hit point maximum of its summoner")
  // → use 50 as a safe placeholder; combat engine can override at spawn time
  return 50;
}

function parseSpeeds(speed: RawSpeed | undefined): {
  ground: number; fly: number | null; swim: number | null; burrow: number | null;
} {
  if (!speed) return { ground: 30, fly: null, swim: null, burrow: null };
  const fly = speed.fly === undefined
    ? null
    : typeof speed.fly === 'number' ? speed.fly : speed.fly.number;
  return {
    ground: speed.walk ?? 30,
    fly,
    swim: speed.swim ?? null,
    burrow: speed.burrow ?? null,
  };
}

// ---- Legendary action cost detection -----------------------

/**
 * 5etools encodes legendary action cost as "(Costs X Actions)" in the
 * entry text. Returns 1 if not found (standard cost).
 */
function parseLegendaryCost(description: string): number {
  const m = description.match(/costs?\s+(\d+)\s+actions?/i);
  return m ? parseInt(m[1], 10) : 1;
}

// ---- Default state helpers ----------------------------------

function emptyPerception(): PerceptionMemory {
  return { targets: new Map() };
}

function freshBudget(speedFt: number): ActionBudget {
  return {
    movementFt: speedFt,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    freeObjectUsed: false,
  };
}

let _idCounter = 0;
function nextId(name: string): string {
  return `${name.replace(/\s+/g, '_').toLowerCase()}_${++_idCounter}`;
}

// ---- Main export --------------------------------------------

/**
 * Convert a single 5etools monster entry into a Combatant ready for the engine.
 *
 * @param raw      - monster entry from a 5etools bestiary JSON
 * @param pos      - starting grid position (default origin)
 * @param profile  - AI targeting profile
 * @param faction  - combat side
 * @param hpOverride - override HP (useful for "special" HP monsters like Avatar of Death)
 */

// ---- Q7: Default AI profile per creature type ---------------
export function defaultProfileForType(typeStr: string | { type: string } | undefined): AIProfile {
  const raw = typeof typeStr === 'string' ? typeStr : (typeStr as any)?.type ?? '';
  const t = raw.toLowerCase();
  if (t.includes('beast'))       return 'attackNearest';
  if (t.includes('undead'))      return 'attackNearest';
  if (t.includes('construct'))   return 'attackNearest';
  if (t.includes('plant'))       return 'attackNearest';
  if (t.includes('ooze'))        return 'attackNearest';
  if (t.includes('elemental'))   return 'attackNearest';
  if (t.includes('giant'))       return 'attackWeakest';
  if (t.includes('humanoid'))    return 'smart';
  if (t.includes('monstrosity')) return 'smart';
  if (t.includes('fiend'))       return 'smart';
  if (t.includes('celestial'))   return 'smart';
  if (t.includes('fey'))         return 'smart';
  if (t.includes('dragon'))      return 'smart';
  if (t.includes('aberration'))  return 'smart';
  return 'smart';
}

// ---- Size parsing -------------------------------------------

const SIZE_CODE_MAP: Record<string, CreatureSize> = {
  T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan',
};

/**
 * Parse the 5etools size field (single-letter code array) into CreatureSize.
 * Examples: ["M"] → 'Medium', ["L"] → 'Large'.
 * Falls back to 'Medium' for unrecognised codes.
 */
export function parseSizeCode(
  sizeField: string | string[] | undefined
): CreatureSize {
  const code = Array.isArray(sizeField) ? sizeField[0] : sizeField;
  if (!code) return 'Medium';
  return SIZE_CODE_MAP[code.toUpperCase()] ?? 'Medium';
}

/**
 * Determine if a creature has hands or tentacles — allowing improvised weapon use (PHB p.148).
 * Heuristic based on creature type + action/feature text scan for "tentacle".
 * Humanoids, fiends, fey, many aberrations, and giants have hands.
 * Beasts, oozes, plants, constructs: checked for appendages via name/text.
 * Full hasHands parser coverage is a future improvement; this covers ~90% of CR 0-1 monsters.
 */
export function hasHandsForType(
  typeStr: string | { type: string } | undefined,
  raw: { name?: string; entries?: string[]; actions?: { entries?: string[] }[] }
): boolean {
  const t = (typeof typeStr === 'string' ? typeStr : (typeStr as any)?.type ?? '').toLowerCase();

  // Types that reliably have hands/tentacles
  if (t.includes('humanoid'))    return true;
  if (t.includes('fiend'))       return true;  // demons/devils have hands/claws
  if (t.includes('fey'))         return true;
  if (t.includes('giant'))       return true;
  if (t.includes('celestial'))   return true;

  // Aberrations often have tentacles — scan action text
  if (t.includes('aberration'))  {
    const text = JSON.stringify(raw).toLowerCase();
    return text.includes('tentacle') || text.includes('claw') || text.includes('hand');
  }

  // Monstrosities: scan for limb keywords
  if (t.includes('monstrosity')) {
    const text = JSON.stringify(raw).toLowerCase();
    return text.includes('tentacle') || text.includes('hand') || text.includes('claw') || text.includes('arm');
  }

  // Undead: scan (skeletons have hands; ghosts do not)
  if (t.includes('undead')) {
    const name = (raw.name ?? '').toLowerCase();
    if (name.includes('skeleton') || name.includes('zombie') || name.includes('vampire')
      || name.includes('wight') || name.includes('revenant') || name.includes('lich')) return true;
    return false;
  }

  // Default: no hands assumed for beasts, oozes, plants, constructs, elementals
  // unless the text explicitly mentions a limb
  const text = JSON.stringify(raw).toLowerCase();
  return text.includes('tentacle');
}

export function monsterToCombatant(
  raw: Raw5etoolsMonster,
  pos: Vec3 = { x: 0, y: 0, z: 0 },
  profile?: AIProfile,  // if omitted, auto-detected from creature type
  faction: 'enemy' | 'neutral' = 'enemy',
  hpOverride?: number
): Combatant {
  // Auto-detect profile from creature type if not explicitly provided
  const resolvedProfile: AIProfile = profile ?? defaultProfileForType(raw.type);
  const speeds = parseSpeeds(raw.speed);
  const hp = hpOverride ?? parseHP(raw.hp);
  const ac = parseAC(raw.ac);
  const cr = parseCR(raw.cr);

  const actions: Action[] = (raw.action ?? []).map(a => parseAction(a, 'action', 0));

  const legendaryActions: LegendaryAction[] = (raw.legendary ?? []).map(la => {
    const desc = flattenEntries(la.entries);
    const cost = parseLegendaryCost(desc);
    return {
      name: la.name,
      cost,
      action: parseAction(la, 'legendaryAction', cost),
      description: desc,
    };
  });

  const traits: string[] = (raw.trait ?? []).map(t => t.name);
  const legendaryPoolMax = legendaryActions.length > 0 ? 3 : 0;

  return {
    id: nextId(raw.name),
    name: raw.name,
    isPlayer: false,
    faction,
    maxHP: hp,
    currentHP: hp,
    ac,
    speed: speeds.ground,
    flySpeed: speeds.fly,
    swimSpeed: speeds.swim,
    burrowSpeed: speeds.burrow,
    str: raw.str ?? 10,
    dex: raw.dex ?? 10,
    con: raw.con ?? 10,
    int: raw.int ?? 10,
    wis: raw.wis ?? 10,
    cha: raw.cha ?? 10,
    cr,
    pos: { ...pos },
    actions,
    traits,
    legendaryActions,
    legendaryActionPool: legendaryPoolMax,
    legendaryActionPoolMax: legendaryPoolMax,
    budget: freshBudget(speeds.ground),
    conditions: new Set(),
    aiProfile: resolvedProfile,
    perception: emptyPerception(),
    concentration: null,
    deathSaves: null,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    tempHP: 0,
    resources: null,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: hasHandsForType(raw.type, raw),
    size: parseSizeCode(raw.size),
    isDead: false,
    isUnconscious: false,
    advantages:      [],
    vulnerabilities: [],
    resistances:     [],
    bardicInspirationDie: null,
  };
}

/**
 * Load all monsters from a 5etools bestiary JSON into a lookup map.
 * Key is lowercased monster name.
 *
 * Usage:
 *   import data from './bestiary-dmg.json';
 *   const bestiary = loadBestiaryJson(data);
 */
export function loadBestiaryJson(
  fileData: { monster: Raw5etoolsMonster[] }
): Map<string, Raw5etoolsMonster> {
  const map = new Map<string, Raw5etoolsMonster>();
  for (const m of fileData.monster) {
    map.set(m.name.toLowerCase(), m);
  }
  return map;
}

/**
 * Merge multiple bestiary files into one lookup map.
 * Later files win on name collision (allows overrides).
 */
export function mergeBestiaries(
  ...files: { monster: Raw5etoolsMonster[] }[]
): Map<string, Raw5etoolsMonster> {
  const map = new Map<string, Raw5etoolsMonster>();
  for (const file of files) {
    for (const m of file.monster) {
      map.set(m.name.toLowerCase(), m);
    }
  }
  return map;
}

/**
 * Instantiate a named monster from a loaded bestiary map.
 * Returns null if the name is not found — never throws.
 */
export function spawnMonster(
  bestiaryMap: Map<string, Raw5etoolsMonster>,
  name: string,
  pos: Vec3,
  profile: AIProfile = 'smart',
  faction: 'enemy' | 'neutral' = 'enemy',
  hpOverride?: number
): Combatant | null {
  const raw = bestiaryMap.get(name.toLowerCase());
  if (!raw) return null;
  return monsterToCombatant(raw, pos, profile, faction, hpOverride);
}

/** List all monster names in a bestiary map (sorted). */
export function listMonsters(bestiaryMap: Map<string, Raw5etoolsMonster>): string[] {
  return [...bestiaryMap.keys()].sort();
}
