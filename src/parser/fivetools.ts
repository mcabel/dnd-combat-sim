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
  /** 5etools spellcasting block — present on spellcasting monsters only. */
  spellcasting?: Array<{
    ability?: string;          // 'int' | 'wis' | 'cha' etc.
    headerEntries?: string[];  // may contain "is a Nth-level spellcaster"
    [k: string]: unknown;
  }>;
  // ── Session 52 Creature Megabatch Batch 1: damage defenses ──
  // Each is an array of EITHER a plain damage-type string ('fire') OR an
  // object with an inner same-named array (`{immune:['bludgeoning','piercing',
  // 'slashing'], note:'from nonmagical attacks', cond:true}`) OR an object
  // with a `special` field (`{special:'damage from spells'}`). The helper
  // parseDamageDefenseList() below handles all three shapes (mirrors
  // scripts/creature_analysis.ts defenseFieldPresent()).
  immune?: Array<string | { [k: string]: unknown }>;
  resist?: Array<string | { [k: string]: unknown }>;
  vulnerable?: Array<string | { [k: string]: unknown }>;
  // conditionImmune is always a string[] in MM data (verified across all 453
  // creatures by creature_analysis.ts), but we accept the same permissive
  // shape for forward-compat with future sourcebooks.
  conditionImmune?: Array<string | { [k: string]: unknown }>;
  // ── Session 52 Creature Megabatch Batch 2: saves/skills/senses ──
  // save/skill: { ability: "+N" } maps (e.g. { "con":"+13", "dex":"+6" }).
  // senses: string array like ["blindsight 60 ft.", "darkvision 120 ft."].
  // passive: integer passive perception score.
  save?: Record<string, string>;
  skill?: Record<string, string>;
  senses?: string[];
  passive?: number;
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

/**
 * Session 52 Batch 3a: detect a {@recharge N} or {@recharge} tag in an
 * action name. Returns { min, recharged } where min is the threshold (default
 * 6 for bare {@recharge}) and recharged=true (available on spawn). Returns
 * undefined when no recharge tag is present.
 */
function parseRechargeTag(actionName: string): { min: number; recharged: boolean } | undefined {
  const m = actionName.match(/\{@recharge(?:\s+(\d+))?\}/);
  if (!m) return undefined;
  const min = m[1] ? parseInt(m[1], 10) : 6;  // bare {@recharge} = Recharge 6
  return { min, recharged: true };            // available on first turn
}

/** Strip the {@recharge ...} tag (and surrounding whitespace) from a name. */
function stripRechargeTag(actionName: string): string {
  return actionName.replace(/\s*\{@recharge[^}]*\}\s*/g, ' ').trim();
}

/**
 * Session 52 Batch 3b: parse "Legendary Resistance (N/Day)" trait name into
 * { max: N, remaining: N }. Returns undefined if the trait name doesn't match.
 */
function parseLegendaryResistance(traitNames: string[]): { max: number; remaining: number } | undefined {
  for (const name of traitNames) {
    const m = name.match(/Legendary\s+Resistance\s*\((\d+)\s*\/\s*Day\)/i);
    if (m) {
      const max = parseInt(m[1], 10);
      return { max, remaining: max };
    }
  }
  return undefined;
}

/**
 * Session 52 Batch 4b: parse a Regeneration trait. Scans the trait entries
 * (flattened to text) for:
 *   - "regains N hit points" → amount = N
 *   - "takes [acid or fire|radiant or ...] damage, this trait doesn't function"
 *     → stopTypes = [acid, fire] (lowercased DamageType strings)
 *
 * Returns undefined if no "regains N hit points" pattern is found. Creatures
 * without a stop clause (e.g. Oni: just "regains 10 hit points") get
 * stopTypes: []. The Vampire's "holy water" stop clause is mapped to 'radiant'
 * (holy water deals radiant damage per DMG) — v1 simplification documented in
 * the worklog.
 */
function parseRegeneration(
  traits: { name: string; entries: (string | object)[] }[],
): { amount: number; stopTypes: import('../types/core').DamageType[]; suppressedNextTurn: boolean } | undefined {
  const VALID_DAMAGE_TYPES: ReadonlySet<string> = new Set<import('../types/core').DamageType>([
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
    'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  ]);
  for (const t of traits) {
    if (!/Regeneration/i.test(t.name)) continue;
    const text = flattenEntries(t.entries);
    // "regains N hit points"
    const amtMatch = text.match(/regains\s+(\d+)\s+hit\s+points/i);
    if (!amtMatch) continue;
    const amount = parseInt(amtMatch[1], 10);

    // Stop clause: find the sentence containing "doesn't function" (or "does not
    // function"), then scan it for damage-type keywords. This handles both the
    // Troll form ("takes acid or fire damage, this trait doesn't function") and
    // the Vampire form ("takes radiant damage or damage from holy water, this
    // trait doesn't function"). "Holy water" is mapped to 'radiant' (it deals
    // radiant damage per DMG).
    const stopTypes: import('../types/core').DamageType[] = [];
    const stopSentenceMatch = text.match(/[^.]*?(?:doesn'?t|does\s+not)\s+function[^.]*/i);
    if (stopSentenceMatch) {
      const stopSentence = stopSentenceMatch[0].toLowerCase();
      // Map "holy water" → "radiant" before keyword scanning
      const normalized = stopSentence.replace(/holy\s+water/g, 'radiant');
      for (const dt of VALID_DAMAGE_TYPES) {
        if (new RegExp(`\\b${dt}\\b`).test(normalized)) {
          stopTypes.push(dt as import('../types/core').DamageType);
        }
      }
    }
    return { amount, stopTypes, suppressedNextTurn: false };
  }
  return undefined;
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

  // Session 52 Batch 3a: strip {@recharge N} from the display name and
  // record the recharge threshold on the Action. The tag is NOT part of
  // the canonical action name (MM prints "Fire Breath (Recharge 5-6)").
  const cleanName = stripRechargeTag(raw.name);
  const recharge = parseRechargeTag(raw.name);

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
    name: cleanName,
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
    recharge,
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

// ---- Defense field parsers (Session 52 Batch 1) -------------

/**
 * The set of damage types the engine recognises. Used to validate strings
 * parsed from 5etools defense arrays before they enter a `DamageType[]`
 * field — anything else (typos, future sourcebook additions, or damage-type
 * qualifiers like "from nonmagical attacks") is silently dropped.
 */
const VALID_DAMAGE_TYPES: ReadonlySet<string> = new Set<DamageType>([
  'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
  'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
]);

/**
 * Parse a 5etools damage-defense field (immune / resist / vulnerable) into a
 * `DamageType[]`. Handles every shape observed across all 453 creatures
 * (mirrors `defenseFieldPresent()` in scripts/creature_analysis.ts):
 *
 *   1. Plain string array:       `["fire"]`
 *   2. Object with inner array:  `[{ immune:["bludgeoning","piercing","slashing"],
 *                                    note:"from nonmagical attacks", cond:true }]`
 *                                (the inner array key matches `fieldName`)
 *   3. Object with `special`:    `[{ special:"damage from spells" }]`
 *                                (rare — v1 SKIPS these; the engine has no way
 *                                to enumerate the matched damage types)
 *
 * v1 simplification — conditional defenses (the `cond: true` flag paired with
 * a note like "from nonmagical attacks" / "that aren't silvered"): applied
 * UNCONDITIONALLY in v1. Honouring the "nonmagical only" condition requires
 * an `isNonmagical` flag on incoming attacks — deferred to Batch 4c Magic
 * Weapons, which adds `attacksAreMagical?: boolean` to Combatant and updates
 * applyDamageWithTempHP to skip conditional defenses for magical attacks.
 *
 * @param rawField   The raw 5etools field value (e.g. `raw.immune`).
 * @param fieldName  The field's own name ('immune' | 'resist' | 'vulnerable')
 *                   — used to find the inner array on object entries that use
 *                   the same key.
 */
function parseDamageDefenseList(
  rawField: Raw5etoolsMonster['immune'],
  fieldName: 'immune' | 'resist' | 'vulnerable',
): DamageType[] {
  if (!rawField || !Array.isArray(rawField) || rawField.length === 0) {
    return [];
  }
  const out: DamageType[] = [];
  for (const entry of rawField) {
    if (typeof entry === 'string') {
      // Plain damage-type string (e.g. "fire").
      const t = entry.toLowerCase();
      if (VALID_DAMAGE_TYPES.has(t)) {
        out.push(t as DamageType);
      }
      // else: silently drop unknown strings (5etools occasionally uses tags
      // we don't model, e.g. "psychic" is valid but "force" qualifies).
    } else if (entry && typeof entry === 'object') {
      // Object form — look for an inner array under the same key as the
      // outer field (e.g. immune:[...] inside an entry of raw.immune).
      const innerArr = (entry as Record<string, unknown>)[fieldName];
      if (Array.isArray(innerArr)) {
        for (const inner of innerArr) {
          if (typeof inner === 'string') {
            const t = inner.toLowerCase();
            if (VALID_DAMAGE_TYPES.has(t)) {
              out.push(t as DamageType);
            }
          }
        }
      }
      // Object form with `special` (e.g. {special:"damage from spells"}):
      // skipped — no way to enumerate the matched types in v1. Documented
      // in CREATURE-MEGABATCH-MIGRATION-PLAN.md Batch 1.
      // Unknown object shapes are also silently dropped (the analysis script
      // reported 0 unparseable shapes across all 453 creatures, so this is
      // purely defensive).
    }
  }
  // Dedupe (a creature may legitimately list both "fire" plain and inside a
  // conditional object form).
  return Array.from(new Set(out));
}

/**
 * Parse a 5etools `conditionImmune` field into an array of lowercased
 * condition-name strings. Handles both the canonical string-array shape
 * (`["charmed","frightened"]`) and the object-with-inner-array shape used by
 * some 5etools entries (`[{conditionImmune:["charmed","frightened"]}]`),
 * for forward-compatibility with future sourcebooks even though MM data is
 * always the plain string-array form (verified across all 453 creatures).
 *
 * Returned names are lowercased to match the engine's `Condition` type
 * strings ('charmed', 'frightened', 'paralyzed', etc.). Unknown strings are
 * still included — engine's addCondition() checks `conditionImmunities`
 * before validating the condition name, so unknown-immune entries are
 * harmless (they just never match a real Condition).
 */
function parseConditionImmune(
  rawField: Raw5etoolsMonster['conditionImmune'],
): string[] {
  if (!rawField || !Array.isArray(rawField) || rawField.length === 0) {
    return [];
  }
  const out: string[] = [];
  for (const entry of rawField) {
    if (typeof entry === 'string') {
      out.push(entry.toLowerCase());
    } else if (entry && typeof entry === 'object') {
      // Forward-compat: object form `{conditionImmune:[...]}` (none in MM
      // data today, but the parallel immune/resist/vulnerable fields use it).
      const innerArr = (entry as Record<string, unknown>)['conditionImmune'];
      if (Array.isArray(innerArr)) {
        for (const inner of innerArr) {
          if (typeof inner === 'string') out.push(inner.toLowerCase());
        }
      }
      // `special` and other object shapes: skipped (no condition name to
      // extract).
    }
  }
  return Array.from(new Set(out));
}

// ---- Save / skill / senses parsers (Session 52 Batch 2) ----

/** Map 5etools ability keys to our AbilityScore union. */
const ABILITY_KEY_MAP: Record<string, import('../types/core').AbilityScore> = {
  str: 'str', strength: 'str',
  dex: 'dex', dexterity: 'dex',
  con: 'con', constitution: 'con',
  int: 'int', intelligence: 'int',
  wis: 'wis', wisdom: 'wis',
  cha: 'cha', charisma: 'cha',
};

/**
 * Parse a 5etools `save` field (`{ "dex":"+6", "con":"+13", ... }`) into a
 * per-ability bonus map. The values are the FULL listed save bonus (ability
 * mod + proficiency already folded in) — rollSave() uses this total directly
 * instead of recomputing abilityMod + profBonus(CR).
 *
 * Keys may be full ability names ("dexterity") or 3-letter codes ("dex");
 * both appear in 5etools data. Values are signed-int strings ("+6", "-1").
 */
function parseSaves(
  rawField: Raw5etoolsMonster['save'],
): Partial<Record<import('../types/core').AbilityScore, number>> {
  if (!rawField || typeof rawField !== 'object') return {};
  const out: Partial<Record<import('../types/core').AbilityScore, number>> = {};
  for (const [key, val] of Object.entries(rawField)) {
    const ability = ABILITY_KEY_MAP[key.toLowerCase()];
    if (!ability) continue;            // unknown key — skip
    const n = parseInt(String(val), 10);
    if (!isNaN(n)) out[ability] = n;
  }
  return out;
}

/**
 * Parse a 5etools `skill` field (`{ "perception":"+13", "stealth":"+6" }`)
 * into a skill-name → bonus map. Skill names are lowercased. Not consumed by
 * the engine in v1 (no skill-check subsystem); recorded as metadata.
 */
function parseSkills(
  rawField: Raw5etoolsMonster['skill'],
): Record<string, number> {
  if (!rawField || typeof rawField !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(rawField)) {
    const n = parseInt(String(val), 10);
    if (!isNaN(n)) out[key.toLowerCase()] = n;
  }
  return out;
}

/**
 * Parse a 5etools `senses` string array (e.g.
 * `["blindsight 60 ft.", "darkvision 120 ft."]`) into a structured object.
 * Also folds in `passive` (integer passive perception) if provided.
 *
 * Each sense string is matched for a vision-mode keyword + a number (the
 * range in feet). Parenthetical qualifiers like "(blind beyond this radius)"
 * are ignored. Unknown sense types are silently dropped.
 */
function parseSenses(
  rawSenses: Raw5etoolsMonster['senses'],
  rawPassive: Raw5etoolsMonster['passive'],
): Combatant['senses'] {
  const out: NonNullable<Combatant['senses']> = {};
  if (rawSenses && Array.isArray(rawSenses)) {
    for (const s of rawSenses) {
      if (typeof s !== 'string') continue;
      const lower = s.toLowerCase();
      // Match "<mode> <number> ft." — capture mode + number.
      const m = lower.match(/(darkvision|blindsight|truesight|tremorsense)\s+(\d+)\s*ft/);
      if (m) {
        const key = m[1] as 'darkvision' | 'blindsight' | 'truesight' | 'tremorsense';
        out[key] = parseInt(m[2], 10);
      }
      // "passive perception N" — rare in the string form (usually the separate
      // `passive` integer field), but handle it for robustness.
      const ppm = lower.match(/passive\s+perception\s+(\d+)/);
      if (ppm) out.passivePerception = parseInt(ppm[1], 10);
    }
  }
  if (rawPassive !== undefined && typeof rawPassive === 'number') {
    out.passivePerception = rawPassive;
  }
  // Return undefined if nothing was parsed (keeps Combatant clean for
  // creatures with no senses, e.g. Cat).
  return Object.keys(out).length > 0 ? out : undefined;
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

// ---- TG-004: parser tech debt helpers -----------------------

/** Extract the base type string from raw.type (string or object form). */
function rawCreatureType(type: Raw5etoolsMonster['type']): string {
  if (!type) return '';
  if (typeof type === 'string') return type.toLowerCase();
  return (type.type ?? '').toLowerCase();
}

/** True when the creature is of type Undead (PHB — Chill Touch, Cure Wounds, etc.). */
function parseIsUndead(type: Raw5etoolsMonster['type']): boolean {
  return rawCreatureType(type) === 'undead';
}

/** True when the creature is a Construct (PHB — Spare the Dying, etc.). */
function parseIsConstruct(type: Raw5etoolsMonster['type']): boolean {
  return rawCreatureType(type) === 'construct';
}

/**
 * Metal armor keywords per PHB p.143 equipment table.
 * Matches 5etools item names like "{@item chain mail|phb}", "breastplate", etc.
 */
const METAL_ARMOR_RE = /chain\s*(?:mail|shirt)|plate\s*(?:armor|mail)|scale\s*mail|ring\s*mail|splint|half[\s-]plate|breastplate/i;

/**
 * True when any AC entry lists metal armor as a source.
 * Shocking Grasp (PHB p.275) grants advantage against creatures wearing metal armor.
 */
function parseHasMetalArmor(ac: Raw5etoolsMonster['ac']): boolean {
  if (!ac) return false;
  for (const entry of ac) {
    if (typeof entry === 'object' && entry.from) {
      for (const source of entry.from) {
        if (METAL_ARMOR_RE.test(source)) return true;
      }
    }
  }
  return false;
}

/**
 * Spellcasting ability modifier derived from the monster's spellcasting block.
 * Returns undefined for non-spellcasters (no block present).
 * Used by Green-Flame Blade splash, etc.
 */
function parseSpellcastingMod(raw: Raw5etoolsMonster): number | undefined {
  const sc = (raw.spellcasting ?? [])[0];
  if (!sc?.ability) return undefined;
  const abilityMap: Record<string, keyof Pick<Raw5etoolsMonster, 'str'|'dex'|'con'|'int'|'wis'|'cha'>> = {
    str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha',
  };
  const key = abilityMap[sc.ability.toLowerCase()];
  if (!key) return undefined;
  const score: number = (raw[key] as number) ?? 10;
  return Math.floor((score - 10) / 2);
}

/**
 * Caster level from "is a Nth-level spellcaster" in the spellcasting header.
 * Falls back to ceil(CR) for innate spellcasters that list no explicit level.
 * Returns undefined for non-spellcasters.
 * Used for cantrip damage scaling (5th/11th/17th thresholds).
 */
function parseCasterLevel(raw: Raw5etoolsMonster): number | undefined {
  const sc = (raw.spellcasting ?? [])[0];
  if (!sc) return undefined;
  for (const header of sc.headerEntries ?? []) {
    const m = String(header).match(/is\s+an?\s+(\d+)(?:st|nd|rd|th)-level\s+spellcaster/i);
    if (m) return parseInt(m[1], 10);
  }
  // Innate spellcasters: use CR as a proxy (minimum 1)
  const cr = parseCR(raw.cr);
  return cr !== null ? Math.max(1, Math.ceil(cr)) : undefined;
}

export function monsterToCombatant(
  raw: Raw5etoolsMonster,
  pos: Vec3 = { x: 0, y: 0, z: 0 },
  profile?: AIProfile,  // if omitted, auto-detected from creature type
  faction: 'enemy' | 'neutral' = 'enemy',
  hpOverride?: number,
  /**
   * Session 52 Creature Megabatch Batch 0: optional sourcebook code to append
   * as a subname suffix (e.g. "VGM") when this creature is a genuine reprint
   * (same name exists in 2+ sourcebooks). Computed by spawnMonster() from the
   * bestiary's reprintNames index; undefined for unique-name creatures → no
   * suffix. Direct monsterToCombatant() callers can pass it explicitly.
   */
  subname?: string
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
  // Session 52 Batch 3b: parse "Legendary Resistance (N/Day)" trait
  const legendaryResistance = parseLegendaryResistance(traits);
  // Session 52 Batch 4b: parse Regeneration trait (amount + stop-clause types)
  const regeneration = parseRegeneration(raw.trait ?? []);

  return {
    id: nextId(raw.name),
    name: subname ? `${raw.name} (${subname})` : raw.name,
    isPlayer: false,
    faction,
    source: raw.source,                       // Session 52 Batch 0: sourcebook provenance
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
    legendaryResistance,   // Session 52 Batch 3b: undefined for non-legendary creatures
    regeneration,          // Session 52 Batch 4b: undefined for non-regenerating creatures
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
    creatureType: rawCreatureType(raw.type),   // MM p.6 — beast/humanoid/undead/etc. (TG-004: handles string + object forms)
    isUndead:    parseIsUndead(raw.type),        // TG-004
    isConstruct: parseIsConstruct(raw.type),     // TG-004
    hasMetalArmor: parseHasMetalArmor(raw.ac),  // TG-004 — Shocking Grasp advantage check
    spellcastingMod: parseSpellcastingMod(raw), // TG-004 — GFB splash, etc.
    casterLevel:     parseCasterLevel(raw),      // TG-004 — cantrip scaling
    tempHP: 0,
    exhaustionLevel: 0,
    resources: null,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: hasHandsForType(raw.type, raw),
    wearingArmor: false,   // monsters use natural armor; Mage Armor can technically apply
    size: parseSizeCode(raw.size),
    isDead: false,
    isUnconscious: false,
    advantages:      [],
    vulnerabilities: [],   // d20-roll vulnerabilities (Dodge/Reckless Attack); NOT damage types
    // ── Session 52 Creature Megabatch Batch 1: damage defenses ──
    // Populated from raw 5etools fields. Mirrors `defenseFieldPresent()` +
    // `conditionImmune` handling in scripts/creature_analysis.ts (handles
    // string-array, object-with-inner-array, and `{special:"..."}` shapes —
    // `special` is skipped because the engine can't enumerate the matched
    // damage types). Conditional defenses (`cond:true` nonmagical-only) are
    // applied UNCONDITIONALLY in v1 — see parseDamageDefenseList() comment.
    // Honoring the "nonmagical only" condition requires an `isNonmagical`
    // attack flag, deferred to Batch 4c Magic Weapons.
    resistances:            parseDamageDefenseList(raw.resist,    'resist'),
    immunities:             parseDamageDefenseList(raw.immune,    'immune'),
    damageVulnerabilities:  parseDamageDefenseList(raw.vulnerable,'vulnerable'),
    conditionImmunities:    parseConditionImmune(raw.conditionImmune),
    // ── Session 52 Creature Megabatch Batch 2: saves/skills/senses ──
    saveProficiencies:      parseSaves(raw.save),
    skillProficiencies:     parseSkills(raw.skill),
    senses:                 parseSenses(raw.senses, raw.passive),
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects:   [],
  };
}

/**
 * Session 52 Creature Megabatch Batch 0: a bestiary map with reprint awareness.
 *
 * The map is DUAL-KEYED for backward compatibility + disambiguation:
 *   - Bare lowercased name (`'goblin'`) → first entry encountered for that name
 *     across all loaded files. Backward compatible with `map.get(name)`.
 *   - `name|source` lowercased (`'goblin|vgm'`) → the specific source's entry.
 *     Used by spawnMonster() when disambiguating reprints.
 *
 * `reprintNames` lists bare names that appear in 2+ DIFFERENT sourcebooks
 * (genuine reprints). For those names, spawnMonster() appends the source as a
 * subname suffix (e.g. "Goblin (VGM)") so callers can visually differentiate.
 *
 * Two entries with the SAME source (e.g. a duplicated file) are NOT reprints —
 * the second is silently dropped (first-wins) to avoid false-reprint artifacts.
 */
export type BestiaryMap = Map<string, Raw5etoolsMonster> & {
  reprintNames: Set<string>;
};

/** Create an empty BestiaryMap with the reprintNames side-index initialized. */
function newBestiaryMap(): BestiaryMap {
  const map = new Map<string, Raw5etoolsMonster>() as BestiaryMap;
  map.reprintNames = new Set<string>();
  return map;
}

/** Build the `name|source` lookup key (both lowercased). */
function bestiaryKey(name: string, source: string): string {
  return `${name.toLowerCase()}|${source.toLowerCase()}`;
}

/**
 * Load all monsters from a 5etools bestiary JSON into a lookup map.
 * Single-file load: no reprints possible (one source), but the map is still
 * dual-keyed (bare name + name|source) for consistency with mergeBestiaries().
 *
 * Usage:
 *   import data from './bestiary-dmg.json';
 *   const bestiary = loadBestiaryJson(data);
 */
export function loadBestiaryJson(
  fileData: { monster: Raw5etoolsMonster[] }
): BestiaryMap {
  const map = newBestiaryMap();
  for (const m of fileData.monster) {
    const bareKey = m.name.toLowerCase();
    if (!map.has(bareKey)) map.set(bareKey, m);            // first-wins (backward compat)
    map.set(bestiaryKey(m.name, m.source ?? ''), m);       // explicit source key
  }
  return map;
}

/**
 * Merge multiple bestiary files into one lookup map.
 * Dual-keyed (bare name + name|source). First file wins on the bare-name key
 * (stable ordering). `reprintNames` is populated with any name appearing in
 * 2+ DIFFERENT sourcebooks.
 */
export function mergeBestiaries(
  ...files: { monster: Raw5etoolsMonster[] }[]
): BestiaryMap {
  const map = newBestiaryMap();
  // Track which sources each name appeared in (to detect genuine reprints).
  const nameSources = new Map<string, Set<string>>();
  for (const file of files) {
    for (const m of file.monster) {
      const bareKey = m.name.toLowerCase();
      const src = (m.source ?? '').toLowerCase();
      // Record source provenance
      if (!nameSources.has(bareKey)) nameSources.set(bareKey, new Set());
      nameSources.get(bareKey)!.add(src);
      // Bare-name key: first-wins (stable, backward compat for map.get(name))
      if (!map.has(bareKey)) map.set(bareKey, m);
      // name|source key: always set (last-wins within same source is harmless)
      map.set(bestiaryKey(m.name, m.source ?? ''), m);
    }
  }
  // Genuine reprint = name in 2+ distinct sources
  for (const [name, srcs] of nameSources) {
    if (srcs.size > 1) map.reprintNames.add(name);
  }
  return map;
}

/**
 * Instantiate a named monster from a loaded bestiary map.
 * Returns null if the name is not found — never throws.
 *
 * Session 52 Batch 0: if the name is a genuine reprint (in bestiary.reprintNames)
 * OR `sourceOverride` is provided, the spawned Combatant's `name` gets a
 * `(SOURCE)` subname suffix and `source` is set to the sourcebook code.
 * Unique-name creatures get no suffix (backward compatible).
 *
 * @param sourceOverride Optional sourcebook code (e.g. 'VGM') to disambiguate
 *                       a reprint. When omitted, the first entry for the name
 *                       is used (backward compat).
 */
export function spawnMonster(
  bestiaryMap: Map<string, Raw5etoolsMonster>,
  name: string,
  pos: Vec3,
  profile: AIProfile = 'smart',
  faction: 'enemy' | 'neutral' = 'enemy',
  hpOverride?: number,
  sourceOverride?: string
): Combatant | null {
  const nameKey = name.toLowerCase();
  let raw: Raw5etoolsMonster | undefined;
  if (sourceOverride) {
    raw = bestiaryMap.get(bestiaryKey(name, sourceOverride));
  } else {
    raw = bestiaryMap.get(nameKey);
  }
  if (!raw) return null;
  // Subname suffix when this is a reprint (auto-detected) or explicitly disambiguated
  const isReprint = (bestiaryMap as BestiaryMap).reprintNames?.has(nameKey) ?? false;
  const subname = (isReprint || sourceOverride) ? raw.source : undefined;
  return monsterToCombatant(raw, pos, profile, faction, hpOverride, subname);
}

/**
 * List all monster names in a bestiary map (sorted).
 * Returns the bare display names (excludes the `name|source` disambiguation
 * keys). For reprinted names, returns the bare name — callers who need the
 * disambiguated form should use listMonstersDetailed().
 */
export function listMonsters(bestiaryMap: Map<string, Raw5etoolsMonster>): string[] {
  const names: string[] = [];
  for (const key of bestiaryMap.keys()) {
    if (!key.includes('|')) names.push(key);   // exclude name|source keys
  }
  return names.sort();
}

/**
 * Session 52 Batch 0: list all monsters with source provenance + reprint flag.
 * Each entry is `{ name, source, isReprint }`. Reprinted names appear once per
 * source. Useful for UI dropdowns that need to show "Goblin (MM)" vs "Goblin (VGM)".
 */
export function listMonstersDetailed(
  bestiaryMap: Map<string, Raw5etoolsMonster>
): { name: string; source: string; isReprint: boolean }[] {
  const out: { name: string; source: string; isReprint: boolean }[] = [];
  const reprintNames = (bestiaryMap as BestiaryMap).reprintNames ?? new Set<string>();
  const seen = new Set<string>();
  for (const [key, m] of bestiaryMap) {
    if (!key.includes('|')) continue;   // skip bare-name keys; iterate name|source keys
    const composite = `${m.name.toLowerCase()}|${(m.source ?? '').toLowerCase()}`;
    if (seen.has(composite)) continue;
    seen.add(composite);
    out.push({
      name: m.name,
      source: m.source ?? '',
      isReprint: reprintNames.has(m.name.toLowerCase()),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}
