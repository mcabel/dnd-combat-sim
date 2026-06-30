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
  ShapechangerForm,
  LairAction,
  LairActionCategory,
  AbilityScore,
  Condition,
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
  type?: string | { type: string | string[] | { choose?: string[] } } | { choose?: string[] };
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
  // ── Session 60 Batch 5a: lair actions ──
  // legendaryGroup: { name, source } — references an entry in
  // legendarygroups.json which contains lairActions + regionalEffects.
  legendaryGroup?: { name: string; source: string };
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

/**
 * Session 53 Batch 4d: parse a Death Burst trait. Scans the trait entries
 * (flattened to text) for:
 *   - "{@dc N} <ability> saving throw" → saveDC = N, saveAbility = ability
 *   - "{@damage XdY}" → damage = { count: X, sides: Y, bonus: 0 }
 *   - "[N] foot radius" / "within N feet" → radius = N
 *   - "[type] damage" → damageType (one of the 13 DamageTypes)
 *   - "{@condition <name>}" → conditions list (applied on FAILED save)
 *
 * Returns undefined if the trait name isn't "Death Burst" or no save DC is
 * found. Creatures with no damage (Mud Mephit: condition-only) get
 * damage: null + halfOnSuccess: false. Creatures with damage get
 * halfOnSuccess: true (typical "half as much on a successful one" wording).
 *
 * v1 simplification: complex rider effects (Frost Worm's "Each creature
 * that fails is also {@condition paralyzed}}") are captured via conditions[]
 * — the paralyze lasts 1 minute in the source but v1 doesn't track
 * condition durations; the condition is applied without an expiry. Future:
 * extend addCondition to accept a duration.
 */
function parseDeathBurst(
  traits: { name: string; entries: (string | object)[] }[],
): Combatant['deathBurst'] | undefined {
  const VALID_DAMAGE_TYPES: ReadonlySet<string> = new Set<DamageType>([
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
    'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  ]);
  for (const t of traits) {
    if (!/Death\s+Burst/i.test(t.name)) continue;
    const rawText = flattenEntries(t.entries);
    // Strip 5etools tag wrappers: {@dc 11} → 11, {@damage 2d6} → 2d6,
    // {@condition blinded} → blinded, {@hit +5} → +5, etc.
    // Pattern: {@<tag> <args>} where args may contain pipe-separated parts.
    // We keep the first pipe-separated segment of args (the canonical name).
    const text = rawText.replace(/\{@(\w+)\s+([^}]+)\}/g, (_m, _tag, args) => {
      const firstArg = String(args).split('|')[0].trim();
      return firstArg;
    });

    // Save DC + ability: "DC 11 Dexterity saving throw" or "DC 14 Constitution"
    // (after stripping, "{@dc 11}" → "11", so the text reads "make a 11 Dexterity")
    // Match either "DC N" or the bare "N" right before the ability name.
    const saveMatch = text.match(/(?:dc\s+)?(\d+)\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)/i);
    if (!saveMatch) continue; // no save → not a damage burst (skip; v1 only handles save-based bursts)
    const saveDC = parseInt(saveMatch[1], 10);
    const saveAbility = saveMatch[2].toLowerCase().slice(0, 3) as
      'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

    // Radius: "10-foot-radius", "10 foot radius", "within 10 feet", "within 5 feet of it"
    let radius = 5; // default for mephits that say "within 5 feet of it"
    const radiusMatch = text.match(/(\d+)[- ](?:foot|feet)[- ]?(?:radius|sphere|of)/i)
      ?? text.match(/within\s+(\d+)\s+feet/i)
      ?? text.match(/(\d+)\s+feet\s+of\s+(?:it|itself|the)/i);
    if (radiusMatch) radius = parseInt(radiusMatch[1], 10);

    // Damage: "{@damage XdY}" flattened to "XdY", optionally with a bonus like
    // "11 ({@damage 2d10})" — we capture just the XdY part (bonus derived from
    // the literal "N (XdY)" prefix when present, else 0).
    let damage: DiceExpression | null = null;
    let damageType: DamageType | undefined = undefined; // undefined when no damage (condition-only bursts)
    let halfOnSuccess = false;
    const dmgMatch = text.match(/(\d+)d(\d+)/i);
    if (dmgMatch) {
      const count = parseInt(dmgMatch[1], 10);
      const sides = parseInt(dmgMatch[2], 10);
      // Look for the literal bonus prefix: "N (XdY)" — N is the average+bonus
      // rolled up. We just use 0 as bonus since the dice roll is what matters
      // for simulation (PHB average is for the DM; the engine rolls dice).
      // If the text has "XdY+Z" form, capture Z.
      const bonusMatch = text.match(/\d+d\d+\s*\+\s*(\d+)/i);
      const bonus = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;
      // Average = floor(count * (sides+1) / 2) + bonus (PHB convention)
      const average = Math.floor(count * (sides + 1) / 2) + bonus;
      damage = { count, sides, bonus, average };

      // Damage type: scan for a DamageType keyword near the dice
      for (const dt of VALID_DAMAGE_TYPES) {
        if (new RegExp(`\\b${dt}\\b`, 'i').test(text)) {
          damageType = dt as DamageType;
          break;
        }
      }
      // "half as much on a successful one" → halve on success
      halfOnSuccess = /half/i.test(text);
    }

    // Conditions: extract from {@condition <name>} tags in the RAW text (before
    // stripping). This avoids false positives from condition names mentioned in
    // other contexts (e.g. Slithering Bloodfin: "is no longer {@condition blinded}
    // or {@condition restrained}" — those are REMOVALS, not applications).
    // We exclude conditions preceded by "no longer" or "ending" (removal context).
    const KNOWN_CONDITIONS = [
      'blinded', 'deafened', 'paralyzed', 'petrified', 'poisoned',
      'prone', 'restrained', 'stunned', 'unconscious',
    ];
    const conditions: string[] = [];
    const conditionTagRegex = /\{@condition\s+([^}|]+)(?:\|[^}]*)?\}/gi;
    let condMatch;
    while ((condMatch = conditionTagRegex.exec(rawText)) !== null) {
      const condName = condMatch[1].trim().toLowerCase();
      if (!KNOWN_CONDITIONS.includes(condName)) continue;
      // Check the 50 chars BEFORE the tag for "no longer" / "ending" (removal context).
      // 50 chars covers the span between two adjacent {@condition} tags (e.g.
      // Slithering Bloodfin: "is no longer {@condition blinded} or {@condition restrained}"
      // — the "no longer" is 37 chars before the "restrained" tag).
      const beforeTag = rawText.substring(Math.max(0, condMatch.index - 50), condMatch.index).toLowerCase();
      if (/no\s+longer|ending|removes|cures/.test(beforeTag)) continue; // removal — skip
      if (!conditions.includes(condName)) conditions.push(condName);
    }

    return {
      damage,
      damageType,
      saveDC,
      saveAbility,
      radius,
      conditions: conditions.length > 0 ? conditions : undefined,
      halfOnSuccess,
    };
  }
  return undefined;
}

/**
 * Session 53 Batch 4g: parse a Charge trait. Scans the trait entries
 * (flattened + 5etools tags stripped) for:
 *   - "moves at least N feet straight toward" → minMoveFt = N
 *   - "extra X (YdZ) [type] damage" → damage + damageType
 *   - "DC N Strength saving throw" → saveDC = N
 *   - "pushed up to M feet away" → pushFt = M (optional)
 *   - "knocked prone" → knockProne = true
 *
 * Returns undefined if the trait name isn't "Charge" or no minMoveFt is found.
 */
function parseCharge(
  traits: { name: string; entries: (string | object)[] }[],
): Combatant['charge'] | undefined {
  const VALID_DAMAGE_TYPES: ReadonlySet<string> = new Set<DamageType>([
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning',
    'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  ]);
  for (const t of traits) {
    if (!/^Charge$/i.test(t.name.trim())) continue;
    const rawText = flattenEntries(t.entries);
    const text = rawText.replace(/\{@(\w+)\s+([^}]+)\}/g, (_m, _tag, args) => {
      return String(args).split('|')[0].trim();
    });

    // minMoveFt: "moves at least 20 feet straight toward"
    const minMatch = text.match(/moves\s+at\s+least\s+(\d+)\s+feet\s+straight\s+toward/i);
    if (!minMatch) continue;
    const minMoveFt = parseInt(minMatch[1], 10);

    // Damage: "extra 27 (6d8) bludgeoning damage" or "extra 11 (2d10) slashing"
    // After tag stripping: "extra 27 (6d8) bludgeoning damage"
    let damage: DiceExpression | undefined;
    let damageType: DamageType = 'bludgeoning';
    const dmgMatch = text.match(/(\d+)d(\d+)/i);
    if (dmgMatch) {
      const count = parseInt(dmgMatch[1], 10);
      const sides = parseInt(dmgMatch[2], 10);
      const bonusMatch = text.match(/\d+d\d+\s*\+\s*(\d+)/i);
      const bonus = bonusMatch ? parseInt(bonusMatch[1], 10) : 0;
      const average = Math.floor(count * (sides + 1) / 2) + bonus;
      damage = { count, sides, bonus, average };
      for (const dt of VALID_DAMAGE_TYPES) {
        if (new RegExp(`\\b${dt}\\b`, 'i').test(text)) {
          damageType = dt as DamageType;
          break;
        }
      }
    }
    if (!damage) continue; // no damage → not a valid Charge

    // Save DC: after tag stripping, "{@dc 21}" → "21", so the text reads
    // "succeed on a 21 Strength saving throw". Match "(?:dc )?N Strength".
    // Some Charge variants (e.g. Centaur) have NO save — just extra damage.
    // saveDC is optional; if absent, pushFt/knockProne are not applied.
    const dcMatch = text.match(/(?:dc\s+)?(\d+)\s+strength/i);
    const saveDC = dcMatch ? parseInt(dcMatch[1], 10) : 0;  // 0 = no save

    // Push: "pushed up to 20 feet away" (optional)
    const pushMatch = text.match(/pushed\s+up\s+to\s+(\d+)\s+feet/i);
    const pushFt = pushMatch ? parseInt(pushMatch[1], 10) : undefined;

    // Knock prone: "knocked prone" or "knocked {@condition prone}"
    const knockProne = /\bprone\b/i.test(text);

    return { minMoveFt, damage, damageType, saveDC, pushFt, knockProne };
  }
  return undefined;
}

/**
 * Session 53 Batch 4g: parse a Pounce trait. Scans for:
 *   - "moves at least N feet straight toward" → minMoveFt = N
 *   - "DC N Strength saving throw" → saveDC = N
 *   - "make one [weapon] attack against it as a bonus action" → bonusActionAttackName
 *
 * Returns undefined if the trait name isn't "Pounce" or no minMoveFt is found.
 */
function parsePounce(
  traits: { name: string; entries: (string | object)[] }[],
): Combatant['pounce'] | undefined {
  for (const t of traits) {
    if (!/^Pounce$/i.test(t.name.trim())) continue;
    const rawText = flattenEntries(t.entries);
    const text = rawText.replace(/\{@(\w+)\s+([^}]+)\}/g, (_m, _tag, args) => {
      return String(args).split('|')[0].trim();
    });

    // minMoveFt: "moves at least 30 feet straight toward"
    const minMatch = text.match(/moves\s+at\s+least\s+(\d+)\s+feet\s+straight\s+toward/i);
    if (!minMatch) continue;
    const minMoveFt = parseInt(minMatch[1], 10);

    // Save DC: after tag stripping, "{@dc 13}" → "13", so the text reads
    // "succeed on a 13 Strength saving throw". Match "(?:dc )?N Strength".
    const dcMatch = text.match(/(?:dc\s+)?(\d+)\s+strength/i);
    if (!dcMatch) continue;
    const saveDC = parseInt(dcMatch[1], 10);

    // Bonus action attack: "make one bite attack" or "make one claw attack"
    const bonusMatch = text.match(/make\s+one\s+(\w+)\s+attack/i);
    const bonusActionAttackName = bonusMatch ? bonusMatch[1] : undefined;

    return { minMoveFt, saveDC, bonusActionAttackName };
  }
  return undefined;
}

/**
 * Session 53 Batch 4h: parse a Rejuvenation trait. Extracts:
 *   - reformTimeHours: N (from "1 hour", "24 hours", "1d6 days", "1d10 days")
 *     For dice-based times (1d6 days), uses the MINIMUM roll (1 day = 24 hrs).
 *   - conditionText: the "if X" clause (e.g. "if its phylactery is intact")
 *
 * Returns undefined if the trait name isn't "Rejuvenation". v1 metadata-only
 * — the trait only matters in multi-day scenarios (not simulated in v1).
 */
function parseRejuvenation(
  traits: { name: string; entries: (string | object)[] }[],
): Combatant['rejuvenation'] | undefined {
  for (const t of traits) {
    if (!/^Rejuvenation$/i.test(t.name.trim())) continue;
    const rawText = flattenEntries(t.entries);
    const text = rawText.replace(/\{@(\w+)\s+([^}]+)\}/g, (_m, _tag, args) => {
      return String(args).split('|')[0].trim();
    });

    let reformTimeHours = 24; // default: 24 hours (most common)

    // "1 hour" / "1 hours"
    const hrMatch = text.match(/(\d+)\s+hours?/i);
    if (hrMatch) {
      reformTimeHours = parseInt(hrMatch[1], 10);
    }
    // "1d6 days" / "1d10 days" — use minimum roll (1 day = 24 hrs)
    const diceDaysMatch = text.match(/(\d+)d(\d+)\s+days?/i);
    if (diceDaysMatch) {
      reformTimeHours = 24; // min roll = 1 day
    }
    // "24 hours" (already captured by hrMatch above)

    // Condition: text after "if" (e.g. "if its phylactery is intact")
    let conditionText: string | undefined;
    const condMatch = text.match(/\bif\s+(.+?)(?:\.|$)/i);
    if (condMatch) {
      conditionText = condMatch[1].trim();
    }

    return { reformTimeHours, conditionText };
  }
  return undefined;
}

/**
 * Session 60 Batch 5b step 1: parse monster spellcasting data from the
 * 5etools `spellcasting` field. 945 pre-2024 creatures have this.
 *
 * Extracts:
 *   - saveDC: from "spell save {@dc N}" in headerEntries
 *   - spellAttackBonus: from "{@hit +N}" in headerEntries
 *   - ability: from "using [Ability] as the spellcasting ability"
 *   - atWill: spell names from the `will` array (strip {@spell } tags)
 *   - daily: spell name → uses/day from the `daily` object
 *     (keys: "1e" = 1/day, "2e" = 2/day, "3e" = 3/day, etc.)
 *
 * v1: metadata-only — NOT consumed by the engine. Future Batch 5b step 2
 * would wire this into the planner for monster spell casting.
 */
function parseMonsterSpellcasting(
  raw: Raw5etoolsMonster,
): Combatant['monsterSpellcasting'] {
  const sc = raw.spellcasting;
  if (!sc || !Array.isArray(sc) || sc.length === 0) return undefined;
  const s = sc[0]; // first spellcasting entry (creatures rarely have 2)

  // Flatten headerEntries for regex extraction
  const headerText = flattenEntries(s.headerEntries ?? []);

  // Save DC: search RAW text for {@dc N} tag (before stripping)
  let saveDC: number | undefined;
  const dcTagMatch = headerText.match(/\{@dc\s+(\d+)\}/i);
  if (dcTagMatch) saveDC = parseInt(dcTagMatch[1], 10);

  // Spell attack bonus: search RAW text for {@hit +N} or {@hit N} tag
  let spellAttackBonus: number | undefined;
  const hitTagMatch = headerText.match(/\{@hit\s+([+-]?\d+)\}/i);
  if (hitTagMatch) spellAttackBonus = parseInt(hitTagMatch[1], 10);

  // Ability: "using Intelligence as the spellcasting ability"
  let ability: 'int' | 'wis' | 'cha' | undefined;
  if (/\bintelligence\b/i.test(headerText)) ability = 'int';
  else if (/\bwisdom\b/i.test(headerText)) ability = 'wis';
  else if (/\bcharisma\b/i.test(headerText)) ability = 'cha';

  // At-will spells: strip {@spell name} → name
  // ── Defensive: some bestiary entries have non-string spell entries
  // (objects with notes). Use String(sp) to coerce, matching the daily/
  // slots parsers below. Fixes creature_magic_resist_regen crash.
  const atWill: string[] | undefined = Array.isArray(s.will)
    ? s.will.map((sp: unknown) => String(sp).replace(/\{@spell\s+([^}|]+)(?:\|[^}]*)?\}/i, '$1').trim()).filter(Boolean)
    : undefined;

  // Daily spells: { "1e": [...], "2e": [...] } → { spellName: usesPerDay }
  let daily: { [spellName: string]: number } | undefined;
  if (s.daily && typeof s.daily === 'object') {
    daily = {};
    for (const [key, spells] of Object.entries(s.daily)) {
      // key format: "1e" = 1/day, "2e" = 2/day, "3e" = 3/day
      const usesPerDay = parseInt(key, 10);
      if (isNaN(usesPerDay) || !Array.isArray(spells)) continue;
      for (const sp of spells) {
        const spellName = String(sp)
          .replace(/\{@spell\s+([^}|]+)(?:\|[^}]*)?\}/i, '$1')
          .trim()
          // Remove parenthetical notes like "(self only)" or "(as an action)"
          .replace(/\s*\([^)]*\)\s*$/, '')
          .trim();
        if (spellName) daily[spellName] = usesPerDay;
      }
    }
    if (Object.keys(daily).length === 0) daily = undefined;
  }

  // Slot-based spells (Lich, Mage, etc.): { "0": { spells: [...] }, "1": { slots: 4, spells: [...] }, ... }
  // Level 0 = cantrips (at-will). Levels 1-9 = spell slots.
  let slots: { [level: number]: { max: number; spells: string[] } } | undefined;
  if (s.spells && typeof s.spells === 'object') {
    slots = {};
    for (const [levelStr, levelData] of Object.entries(s.spells)) {
      const level = parseInt(levelStr, 10);
      if (isNaN(level) || level < 0 || level > 9) continue;
      const ld = levelData as any;
      if (!ld || !Array.isArray(ld.spells)) continue;
      const spellNames = ld.spells.map((sp: string) =>
        String(sp).replace(/\{@spell\s+([^}|]+)(?:\|[^}]*)?\}/i, '$1').trim()
      ).filter(Boolean);
      const max = typeof ld.slots === 'number' ? ld.slots : 0;
      slots[level] = { max, spells: spellNames };
    }
    if (Object.keys(slots).length === 0) slots = undefined;
  }

  // Return undefined if nothing was extracted
  if (saveDC === undefined && spellAttackBonus === undefined &&
      !atWill && !daily && !slots) return undefined;

  return { saveDC, spellAttackBonus, ability, atWill, daily, slots };
}

/**
 * Session 60 Batch 5a: parse lair actions from legendarygroups.json.
 * Session 91 RFC-LAIRACTIONS Phase 1: structured schema + per-action tagging.
 *
 * 115 legendary groups (from legendarygroups.json) carry lair actions (~324
 * parsed options). The data lives in a separate file (not the bestiary),
 * matched via the creature's `legendaryGroup` field ({ name, source }).
 *
 * Phase 1 extracts, per flattened action option:
 *   - `rawText`: cleaned English text (5eTools `{@tag arg|…}` → first arg)
 *   - structured fields from inline tags: `saveDC` (@dc), `damage` (@damage +
 *     type), `conditions` (@condition), `summons` (@creature + "up to N"),
 *     `rangeFt` / `radiusFt` / `durationRounds` (text inference)
 *   - per-action `isMagical` / `isSpell` / `spellName` / `castLevel` tagging
 *     per [DD-4] (no blanket rule — each action read individually)
 *   - `outOfScope` / `deferred` registry tags with stable IDs
 *     (`lair_oos_NNN` / `lair_def_NNN`) from docs/LAIR-ACTIONS-OUT-OF-SCOPE.md
 *   - a `category` for the Phase 2+ dispatcher to route on
 *
 * The engine stub (combat.ts round-start hook) still fires and logs
 * `action.rawText` — no mechanical effect yet (Phase 2 wires dispatch).
 */
let _legendaryGroupsCache: Map<string, any> | null = null;

function loadLegendaryGroups(): Map<string, any> {
  if (_legendaryGroupsCache) return _legendaryGroupsCache;
  _legendaryGroupsCache = new Map();
  try {
    const fs = require('fs');
    const path = require('path');
    const lgPath = path.join(__dirname, '../../bestiaryData/legendarygroups.json');
    if (fs.existsSync(lgPath)) {
      const data = JSON.parse(fs.readFileSync(lgPath, 'utf8'));
      if (data.legendaryGroup && Array.isArray(data.legendaryGroup)) {
        for (const g of data.legendaryGroup) {
          _legendaryGroupsCache.set(g.name + '|' + g.source, g);
        }
      }
    }
  } catch {
    // File not found or parse error — return empty map (no lair actions)
  }
  return _legendaryGroupsCache;
}

/**
 * Base spell level lookup for the 31 distinct spells referenced by lair-action
 * `@spell` tags (extracted from legendarygroups.json). Keyed by lowercase
 * canonical name. Used to populate `castLevel` for GoI threshold checks.
 *
 * A static map is used (rather than importing the GENERIC_SPELLS registry) to
 * keep the parser self-contained and avoid load-order coupling — the parser
 * runs at bestiary-load time, before the spell registry is necessarily ready.
 * If a lair action references a spell not in this map, `castLevel` is left
 * undefined (the dispatcher can fall back to a registry lookup in Phase 2).
 */
const LAIR_SPELL_LEVELS: Record<string, number> = {
  'haste': 3, 'hold monster': 5, 'antimagic field': 8, 'banishment': 4,
  'cloud of daggers': 2, 'command': 1, 'confusion': 4, 'creation': 5,
  'darkness': 2, 'dispel magic': 3, 'fireball': 3, 'fog cloud': 1,
  'forcecage': 7, 'giant insect': 4, 'greater restoration': 5,
  'insect plague': 5, 'lesser restoration': 2, 'lightning bolt': 3,
  'major image': 3, 'mirage arcane': 7, 'misty step': 2, 'moonbeam': 2,
  'phantasmal force': 2, 'power word kill': 9, 'remove curse': 3,
  'simulacrum': 7, 'sleet storm': 3, 'slow': 3, 'spike growth': 2,
  'wall of force': 5, 'wish': 9,
};

/** The 13 distinct conditions that appear in lair-action `@condition` tags. */
const LAIR_VALID_CONDITIONS: Set<string> = new Set([
  'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled',
  'incapacitated', 'invisible', 'petrified', 'poisoned', 'prone',
  'restrained', 'stunned',
]);

/** Known 5e damage types, used to type-extract `@damage` rolls. */
const LAIR_DAMAGE_TYPES: string[] = [
  'fire', 'cold', 'lightning', 'thunder', 'poison', 'acid', 'psychic',
  'necrotic', 'radiant', 'force', 'bludgeoning', 'piercing', 'slashing',
];

/**
 * Phase 0 registry — the 15 known out-of-scope / deferred lair actions with
 * stable IDs (docs/LAIR-ACTIONS-OUT-OF-SCOPE.md). Matched by legendary-group
 * name + a distinctive phrase regex against the raw (un-cleaned) action text.
 *
 * The heuristic classifier (below) runs as a safety net: if it flags an
 * action the registry doesn't list, that action gets a generated ID
 * (`lair_oos_auto_*` / `lair_def_auto_*`) and surfaces for registry update.
 */
interface LairRegistryEntry {
  sourceCreature: string;
  match: RegExp;
  kind: 'oos' | 'deferred';
  id: string;
  deferredTag?: string;
}
const LAIR_REGISTRY: LairRegistryEntry[] = [
  // ── Out-of-scope (flavor / social / narrative — permanently excluded) ──
  { sourceCreature: 'Balhannoth', match: /warps reality|terrain.{0,40}reshapes to assume/i, kind: 'oos', id: 'lair_oos_001' },
  { sourceCreature: 'Ki-rin', match: /conjures? up one or more temporary objects made of stone or metal/i, kind: 'oos', id: 'lair_oos_003' },
  { sourceCreature: 'Merrenoloth', match: /strong wind propels the vessel/i, kind: 'oos', id: 'lair_oos_004' },
  // ── Deferred (mechanical, awaiting a subsystem) ──
  { sourceCreature: 'Black Dragon', match: /Magical darkness spreads/i, kind: 'deferred', id: 'lair_def_001', deferredTag: 'magical-darkness' },
  { sourceCreature: 'Nafas', match: /sphere of multiversal dust/i, kind: 'deferred', id: 'lair_def_002', deferredTag: 'visibility' },
  { sourceCreature: 'Olhydra', match: /becomes murky and opaque/i, kind: 'deferred', id: 'lair_def_003', deferredTag: 'visibility' },
  { sourceCreature: 'Storm Giant Quintessent', match: /sphere of fog/i, kind: 'deferred', id: 'lair_def_004', deferredTag: 'visibility' },
  { sourceCreature: 'Sphinx', match: /reroll initiative/i, kind: 'deferred', id: 'lair_def_006', deferredTag: 'meta-initiative' },
  { sourceCreature: 'Baphomet', match: /gravity is reversed/i, kind: 'deferred', id: 'lair_def_007', deferredTag: 'gravity' },
  { sourceCreature: 'Sphinx', match: /flow of time within the lair is altered/i, kind: 'deferred', id: 'lair_def_008', deferredTag: 'meta-time' },
  // [VERIFY-2] Juiblex green slime → recommended deferred: 'dmg-hazard' (next sequential id)
  { sourceCreature: 'Juiblex', match: /green slime/i, kind: 'deferred', id: 'lair_def_009', deferredTag: 'dmg-hazard' },
  // ── Session 103: promote 4 heuristic-caught `magical-darkness` deferred
  //    actions to stable IDs. The handover (S102) cited "7" auto entries, but
  //    that count was stale from Session 91 — Demogorgon/Morkoth darkness
  //    actions were since promoted to `cast_spell` (they carry `@spell
  //    darkness` tags → `isSpell` takes precedence over the heuristic). The
  //    actual remaining auto entries are 4 unique sourceCreature base names
  //    (White Dragon covers both adult + ancient; Olhydra has a SECOND
  //    deferred action besides lair_def_003), covering 10 bestiary entries
  //    with source variants (|mm, |pota, |egw). Each `match` phrase was
  //    verified to match ONLY the intended action and none of the creature's
  //    other lair actions. Note: 3 of 4 (White Dragon, Imix, Olhydra::2)
  //    also deal damage — they remain `deferred` here (the damage portion
  //    can be wired in a future phase as a save_damage/damage_no_save rider
  //    once the vision/light subsystem lands); this commit is ID-promotion
  //    only, per the S102 task list. ──
  { sourceCreature: 'White Dragon', match: /freezing fog fills/i, kind: 'deferred', id: 'lair_def_010', deferredTag: 'magical-darkness' },
  { sourceCreature: 'Sea Fury', match: /foggy or murky/i, kind: 'deferred', id: 'lair_def_011', deferredTag: 'magical-darkness' },
  { sourceCreature: 'Imix', match: /black smoke and burning embers/i, kind: 'deferred', id: 'lair_def_012', deferredTag: 'magical-darkness' },
  { sourceCreature: 'Olhydra', match: /freezing fog fills/i, kind: 'deferred', id: 'lair_def_013', deferredTag: 'magical-darkness' },
];

/**
 * Session 91 RFC-LAIRACTIONS Phase 1: extract structured fields + per-action
 * magical/spell tagging from a single flattened lair-action text.
 *
 * Pure function — exported for direct unit testing (the parser test exercises
 * it both via spawnMonster end-to-end AND directly on synthetic strings).
 * `parseLairActions()` calls this once per flattened action option.
 *
 * Tagging per [DD-4] (no blanket rule):
 *   - `isSpell: true` when an `@spell` tag is present OR the text matches a
 *     "casts <known-spell>" pattern. `spellName` + `castLevel` populated from
 *     the LAIR_SPELL_LEVELS lookup. These are blocked by GoI + counterable.
 *   - `isMagical: true` by default for ALL actions (MM: lair actions are
 *     "magical effects"). `isMagical: false` is reserved for purely physical
 *     effects (rare — none currently identified in the 324-action corpus).
 */
export function extractLairAction(
  rawText: string,
  sourceCreature: string,
  index: number,
): LairAction {
  // ── 1. Clean the text: reduce {@tag arg|…} → first arg (canonical name). ──
  const cleaned = rawText
    .replace(/\{@(\w+)\s+([^}]+)\}/g, (_m, _tag, args) => {
      const firstArg = String(args).split('|')[0].trim();
      return firstArg;
    })
    .replace(/\s+/g, ' ')
    .trim();

  // ── 2. [DD-4] isSpell / spellName / castLevel ──
  // Per [DD-4]: "no blanket rule — read each action individually." An `@spell`
  // tag usually means the lair action CASTS that spell (isSpell=true). But a
  // minority of `@spell` tags are REMEDY-REFERENCES — the spell is named as a
  // counter to the lair action's effect (e.g., Sphinx "A greater restoration
  // spell cast on the target ends this effect"), NOT cast by the action. Those
  // are tagged isSpell=false (the lair creature is not casting that spell).
  //
  // Detection: scan every `@spell` tag; isSpell=true if ANY tag is in a
  // casting context (not a remedy-reference). Remedy signals: "ends this
  // effect", "cast on the target ends", "can be ended/removed/reversed by",
  // "dispelled by", "only a <spell> spell can…".
  let isSpell = false;
  let spellName: string | undefined;
  let castLevel: number | undefined;
  const spellTagRe = /\{@spell\s+([^}|]+)(?:\|[^}]*)?\}/gi;
  let sm: RegExpExecArray | null;
  while ((sm = spellTagRe.exec(rawText)) !== null) {
    const name = sm[1].trim();
    const tagStart = sm.index;
    const tagEnd = tagStart + sm[0].length;
    const beforeCtx = rawText.substring(Math.max(0, tagStart - 30), tagStart);
    const afterCtx = rawText.substring(tagEnd, Math.min(rawText.length, tagEnd + 80));
    const isRemedyRef = /ends?\s+this\s+effect|cast\s+on\s+(?:the\s+)?target\s+ends|can\s+(?:be\s+)?(?:ended|removed|reversed|undone)|dispelled\s+by|only\s+(?:a\s+)?(?:this\s+)?spell|if\s+(?:a\s+)?(?:this\s+)?spell|\bspell\s+can\b|\bspell\s+cast\s+on/i.test(beforeCtx + ' ' + afterCtx);
    if (!isRemedyRef) {
      isSpell = true;
      spellName = name;
      castLevel = LAIR_SPELL_LEVELS[name.toLowerCase()];
      break; // first non-remedy @spell wins
    }
  }
  if (!isSpell) {
    // "casts <spell>" / "casts the <spell> spell" phrasing without an @spell
    // tag — only accept known spells (avoids false positives like "casts a
    // shadow"). This is rare; the @spell tag covers the vast majority.
    //
    // Phase 8 batch 3 (Session 102): broadened the trailing-delimiter
    // alternation to ALSO accept `(` — this catches the Githzerai Anarch
    // phrasing "casts the creation spell (as a 9th-level spell)" and "casts
    // the lightning bolt spell (at 5th level)" (MPMM has no @spell tag on
    // these). The cast-level override (below) then extracts the actual level
    // from the parenthetical.
    const castsMatch = cleaned.match(/\bcasts?\s+(?:the\s+)?([a-z][a-z\s'-]+?)(?:\s+spell)?(?:\s+on|\s*,|\s*\.|\s+affecting|\s*\(|$)/i);
    if (castsMatch) {
      const candidate = castsMatch[1].trim().toLowerCase();
      if (LAIR_SPELL_LEVELS[candidate] !== undefined) {
        isSpell = true;
        spellName = candidate;
        castLevel = LAIR_SPELL_LEVELS[candidate];
      }
    }
  }
  // ── Phase 8 batch 3 (Session 102): cast-level override. ──
  // Some lair actions cast a spell at a HIGHER level than the spell's base
  // level (e.g., Githzerai Anarch::0 casts creation at 9th level; ::2 casts
  // lightning bolt at 5th level). The static LAIR_SPELL_LEVELS table only
  // knows the base level (creation=5, lightning bolt=3). When the lair-action
  // text includes "(as a Nth-level spell)" or "(at Nth level)", override
  // castLevel with the text-specified value.
  //
  // Verified: the regex matches ONLY the 4 Githzerai Anarch lair actions
  // (2 in MPMM, 2 in MTF) — no other lair action in the bestiary uses this
  // parenthetical phrasing. Safe to apply globally (gated on isSpell=true).
  if (isSpell && spellName) {
    const lvlMatch = cleaned.match(/\(\s*(?:as\s+a\s+|at\s+)(\d+)(?:st|nd|rd|th)?[-\s]*level(?:\s+spell)?\s*\)/i);
    if (lvlMatch) {
      const txtLevel = parseInt(lvlMatch[1], 10);
      if (txtLevel >= 1 && txtLevel <= 9) {  // sanity guard (spell levels 1-9)
        castLevel = txtLevel;
      }
    }
  }

  // ── 3. saveDC from {@dc N} ──
  const dcMatch = rawText.match(/\{@dc\s+(\d+)\}/i);
  const saveDC = dcMatch ? parseInt(dcMatch[1], 10) : undefined;

  // ── 4. saveAbility from "<Ability> saving throw" ──
  let saveAbility: AbilityScore | undefined;
  const abilityMap: Record<string, AbilityScore> = {
    strength: 'str', dexterity: 'dex', constitution: 'con',
    intelligence: 'int', wisdom: 'wis', charisma: 'cha',
  };
  const abilityMatch = cleaned.match(
    /\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw/i,
  );
  if (abilityMatch) saveAbility = abilityMap[abilityMatch[1].toLowerCase()];

  // ── 5. damage from {@damage NdN} + type from surrounding text ──
  let damage: { count: number; sides: number; type: string } | undefined;
  const dmgMatch = rawText.match(/\{@damage\s+(\d+)d(\d+)\}/i);
  if (dmgMatch) {
    const count = parseInt(dmgMatch[1], 10);
    const sides = parseInt(dmgMatch[2], 10);
    let type = 'untyped';
    for (const t of LAIR_DAMAGE_TYPES) {
      if (new RegExp('\\b' + t + '\\b', 'i').test(cleaned)) { type = t; break; }
    }
    damage = { count, sides, type };
  }

  // ── 5b. Phase 5 (Session 96): halfOnSave for save_damage actions. ──
  // Default true (PHB p.205 — "Half damage is the default for damaging spells").
  // Set false ONLY when the action explicitly says "no damage on a successful
  // save" / "takes no damage on a successful save" / "takes the full damage
  // only on a failed save" etc. The ~5% of actions with this phrasing include:
  //   - Adult Black Dragon "Miasmal Tide" (acid stream)
  //   - Adult Bronze Dragon "Lights" (DC 15 WIS or blinded; on success no dmg)
  //   - Adult Copper Dragon "Slow Gas" (DC 15 CON, no dmg on success)
  // Most actions say "or half as much damage on a successful one" → stays true.
  let halfOnSave = true;
  if (/no damage on a successful save|takes? no damage on a successful|deals? no damage on a successful/i.test(cleaned)) {
    halfOnSave = false;
  }

  // ── 5c. Phase 5 (Session 96): maxTargets for damage_no_save actions. ──
  // Parsed from "up to N creatures" / "striking up to N creatures" /
  // "affects up to N creatures". When set, the handler caps the target list
  // at this many (chosen by lowest HP first). For other categories this is
  // undefined (the handler ignores it).
  //
  // Phase 7 (Session 98): also catch "targets one creature" /
  // "targets a creature" / "targets one creature within N feet" — these
  // single-target patterns (Balhannoth::0/::1, Elder Brain::1/::2) need
  // maxTargets=1 so the teleport/speed-zero effect only hits one target.
  let maxTargets: number | undefined;
  {
    // Match "up to <number-word-or-digit> creatures". 5eTools text usually
    // uses word-form numbers ("up to three creatures") so we map words → ints.
    const wordMap: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    };
    const m = cleaned.match(/up to (?:a maximum of )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+creatures/i);
    if (m) {
      const k = m[1].toLowerCase();
      maxTargets = /^\d+$/.test(k) ? parseInt(k, 10) : wordMap[k];
    }
  }
  // Phase 7 (Session 98): single-target actions — "targets one creature" /
  // "targets a creature" / "targets one creature within N feet of it".
  // These are the Balhannoth teleport + Elder Brain speed-zero patterns.
  // (Important: maxTargets only constrains the handler — the save_only handler
  // honors it by picking the first valid target only. The damage_no_save
  // handler sorts by lowest HP first; for save_only, picking the first valid
  // target is sufficient — the lair creature's choice is arbitrary.)
  if (maxTargets === undefined) {
    if (/\btargets\s+(?:one|a|an)\s+creature\b/i.test(cleaned)) {
      maxTargets = 1;
    }
  }

  // ── 5d. Phase 6 (Session 97): save_only bespoke-effect fields. ──
  // These are ONLY meaningful for save_only actions (the only category where
  // the bespoke effect isn't already handled by a dedicated category handler).
  // Parse: pushFt / pushDirection / successPushFt, banished, applyConditions.
  let pushFt: number | undefined;
  let pushDirection: 'push' | 'pull' | undefined;
  let successPushFt: number | undefined;
  let banished: boolean | undefined;
  let applyConditions: Condition[] | undefined;

  // Push/pull: "pushed up to N feet" / "pulled up to N feet".
  // Also captures "pushed N feet" (no "up to") for tighter phrasings.
  const pushMatch = cleaned.match(/(pushed|pulled)\s+(?:up\s+to\s+)?(\d+)\s+feet/i);
  if (pushMatch) {
    pushFt = parseInt(pushMatch[2], 10);
    pushDirection = /pulled/i.test(pushMatch[1]) ? 'pull' : 'push';
  }
  // Phase 7 (Session 98): "move N feet closer to the [creature]" —
  // Thessalkraken::2's lure pattern. Treated as a pull (toward the lair
  // creature) with N ft. The "if able to do so" qualifier is ignored (v1
  // doesn't model movement-blocking conditions like restrained for lair
  // action forced movement).
  if (pushFt === undefined) {
    const closerMatch = cleaned.match(/move\s+(\d+)\s+feet\s+closer\s+to/i);
    if (closerMatch) {
      pushFt = parseInt(closerMatch[1], 10);
      pushDirection = 'pull';
    }
  }
  // Half-effect on success: two phrasings:
  //   1. "N feet on a successful save" (general pattern)
  //   2. "On a success, ... pushed N feet" (Kraken's phrasing)
  const successPushMatch = cleaned.match(/(\d+)\s+feet\s+on\s+a\s+successful\s+save/i);
  if (successPushMatch) {
    successPushFt = parseInt(successPushMatch[1], 10);
  } else {
    const onSuccessMatch = cleaned.match(/on\s+a\s+success,?\s+(?:the\s+\w+\s+(?:is|are)\s+)?(?:pushed|pulled)\s+(\d+)\s+feet/i);
    if (onSuccessMatch) {
      successPushFt = parseInt(onSuccessMatch[1], 10);
    }
  }

  // Banished: "is banished" / "be banished" / "banished to".
  if (/\bbanish(?:ed|ment)?\b/i.test(cleaned)) {
    banished = true;
  }

  // (applyConditions is parsed AFTER the @condition tag extraction below —
  // it references `conditions` to avoid double-tagging.)

  // ── 6. conditions from {@condition X} (deduped, order of first appearance) ──
  let conditions: Condition[] | undefined;
  {
    const condRe = /\{@condition\s+([^}|]+)(?:\|[^}]*)?\}/gi;
    const seen = new Set<string>();
    const list: Condition[] = [];
    let cm: RegExpExecArray | null;
    while ((cm = condRe.exec(rawText)) !== null) {
      const c = cm[1].trim().toLowerCase() as Condition;
      if (!seen.has(c) && LAIR_VALID_CONDITIONS.has(c)) {
        seen.add(c);
        list.push(c);
      }
    }
    if (list.length > 0) conditions = list;
  }

  // ── 6b. Phase 6 (Session 97): applyConditions for save_only actions. ──
  // For save_only actions whose rawText mentions a condition in prose (not via
  // @condition tag — those are save_condition). Patterns: "has the stunned
  // condition" / "is restrained" / "becomes paralyzed". The handler applies
  // each condition to failed-save targets via addCondition (with immunity
  // cascade). Skip conditions already in `conditions` (avoid double-apply).
  //
  // Phase 7 (Session 98): also catch "liquid in their eyes/its eyes/the eyes"
  // → blinded (Kyrilla::2 drowning-pools pattern). The text says "avoid
  // getting liquid in their eyes and mouths" — the implication is that on a
  // FAILED save, the creature gets liquid in its eyes (blinded).
  {
    const condList: Condition[] = [];
    if (/\bstunned\b/i.test(cleaned) && !conditions?.includes('stunned')) condList.push('stunned');
    if (/\brestrained\b/i.test(cleaned) && !conditions?.includes('restrained')) condList.push('restrained');
    if (/\bparalyzed\b/i.test(cleaned) && !conditions?.includes('paralyzed')) condList.push('paralyzed');
    if (/\bpetrified\b/i.test(cleaned) && !conditions?.includes('petrified')) condList.push('petrified');
    if (/\bblinded\b/i.test(cleaned) && !conditions?.includes('blinded')) condList.push('blinded');
    if (/\bdeafened\b/i.test(cleaned) && !conditions?.includes('deafened')) condList.push('deafened');
    if (/\bfrightened\b/i.test(cleaned) && !conditions?.includes('frightened')) condList.push('frightened');
    if (/\bincapacitated\b/i.test(cleaned) && !conditions?.includes('incapacitated')) condList.push('incapacitated');
    if (/\bpoisoned\b/i.test(cleaned) && !conditions?.includes('poisoned')) condList.push('poisoned');
    if (/\bprone\b/i.test(cleaned) && !conditions?.includes('prone')) condList.push('prone');
    // Phase 7: "liquid in their eyes/its eyes/the eyes" → blinded (Kyrilla::2).
    if (!conditions?.includes('blinded') && !condList.includes('blinded')
        && /\b(?:in\s+(?:their|its|the)\s+eyes|eyes?\s+and\s+mouths?)\b/i.test(cleaned)) {
      condList.push('blinded');
    }
    if (condList.length > 0) applyConditions = condList;
  }

  // ── 6c. Phase 7 (Session 98): additional save_only bespoke-effect fields. ──
  // Three new patterns identified by enumerating the 27 remaining
  // unrecognized save_only actions after Phase 6:
  //
  //   1. teleport-to-source (Balhannoth::0/::1): "teleports to an unoccupied
  //      space of the [creature]'s choice within N feet of it". The handler
  //      relocates the failed-save target to an adjacent square of the lair
  //      creature (within teleportFt).
  //
  //   2. speed-zero / can't-leave-space (Elder Brain::1/::2): "its speed is
  //      reduced to 0" / "be unable to leave its current space". The handler
  //      applies the `restrained` condition for durationRounds.
  //
  //   3. disadvantage-on-attacks (Belashyrra::2): "imposing disadvantage on
  //      the creature's attack rolls". The handler grants the failed-save
  //      target a `disadvantage` self-grant on `attack` rolls for
  //      durationRounds.
  let teleportToSource: boolean | undefined;
  let teleportFt: number | undefined;
  let speedZero: boolean | undefined;
  let disadvOnAttacks: boolean | undefined;

  // Teleport-to-source: "teleports to an unoccupied space ... within N feet
  // of it/him/her/them". Capture N for teleportFt (default 60 if pattern
  // matches but N is absent — defensive).
  {
    const tpMatch = cleaned.match(/teleports?\s+to\s+an?\s+unoccupied\s+space.*?within\s+(\d+)\s+feet\s+of\s+(?:it|him|her|them)/i);
    if (tpMatch) {
      teleportToSource = true;
      teleportFt = parseInt(tpMatch[1], 10);
    } else if (/teleports?\s+to\s+an?\s+unoccupied\s+space/i.test(cleaned)) {
      // Teleport pattern present but no distance — default to 60 ft.
      teleportToSource = true;
      teleportFt = 60;
    }
  }

  // Speed-zero: "its speed is reduced to 0" / "speed is reduced to 0" /
  // "unable to leave its current space" (Elder Brain::2 variant).
  if (/speed\s+(?:is\s+)?(?:reduced\s+to|becomes)\s+0\b/i.test(cleaned)
      || /unable\s+to\s+leave\s+(?:its|her|his|their)\s+current\s+space/i.test(cleaned)) {
    speedZero = true;
  }

  // Disadvantage-on-attacks: "imposing disadvantage on the creature's attack
  // rolls" / "disadvantage on attack rolls".
  if (/disadvantage\s+on\s+(?:the\s+creature'?s\s+)?attack\s+rolls/i.test(cleaned)) {
    disadvOnAttacks = true;
  }

  // ── 6d. Phase 7 batch 2 (Session 99): four more save_only bespoke-effect flags. ──
  // Identified by enumerating the remaining ~7 unrecognized save_only actions
  // after Phase 7 batch 1. Each flag routes the handler to a specific code path
  // (tether-setup / log-only / age-roll). The scorer uses the flags to assign
  // appropriate expected-value weights.
  let lairWardingBondTether: boolean | undefined;
  let objectMove: boolean | undefined;
  let ageAlteration: boolean | undefined;
  let environmentManipulation: boolean | undefined;

  // Warding Bond tether (Lich::1, Illithilich::1): "A crackling cord of
  // negative energy tethers the [lich] to the target" + "Whenever the [lich]
  // takes damage, the target must make a ... saving throw". The save is NOT
  // rolled at lair-action time — it's rolled reactively when the lich takes
  // damage. The handler sets `Combatant.lairWardingBondTether` on the lich.
  if (/crackling\s+cord\s+of\s+negative\s+energy\s+tethers/i.test(cleaned)
      || /whenever\s+the\s+\w+\s+takes\s+damage,?\s+the\s+target\s+must\s+make/i.test(cleaned)) {
    lairWardingBondTether = true;
  }

  // Object-move (Githzerai Anarch::1): "magically move an object it can see
  // within 150 feet of it by making a Wisdom check". The @dc tags here are
  // check DCs by object size, NOT save DCs. The handler logs "object-move —
  // no combat-relevant object" (v1 doesn't model battlefield objects).
  if (/magically\s+move\s+an?\s+object/i.test(cleaned)) {
    objectMove = true;
  }

  // Age-alteration (Sphinx::1): "become 1d20 years older or younger" /
  // "years older or younger". The @dc 15 IS a real CON save vs aging. The
  // handler rolls the save; on fail, rolls 1d20 for the age delta (flavor).
  if (/\byears\s+(?:older|younger)\b/i.test(cleaned)
      || /become\s+\{@dice\s+\d+d\d+\}\s+years/i.test(rawText)) {
    ageAlteration = true;
  }

  // Environment-manipulation (Strahd::1): "targets any number of doors and
  // windows" / "causing each one to either open or close". The @dc 20 here is
  // the STR check to force open a locked door, NOT a save DC. The handler
  // logs "environment manipulation — doors/windows" (v1 doesn't model doors).
  if (/\bdoors\s+and\s+windows\b/i.test(cleaned)) {
    environmentManipulation = true;
  }

  // ── 6e. Phase 8 batch 1 (Session 100): bespoke-category recognition flags. ──
  // Eight patterns identified by enumerating the bespoke-category lair actions.
  // Two are MECHANICAL (selfInvisible adds the `invisible` condition;
  // dispelMagic removes low-level enemy active effects). Six are LOG-ONLY for
  // v1 (no obstacle/terrain/perception/eye-ray-table/vessel model). The flags
  // let the handler route to a specific code path instead of the default
  // "not yet implemented" log, and the scorer assigns appropriate weights.
  let lairDifficultTerrain: boolean | undefined;
  let lairSelfInvisible: boolean | undefined;
  let lairDispelMagic: { maxLevel: number } | undefined;
  let lairWallCreation: boolean | undefined;
  let lairEtherealPass: boolean | undefined;
  let lairRandomEyeRay: boolean | undefined;
  let lairUndeadPinpointLiving: boolean | undefined;
  let lairVesselHeal: boolean | undefined;

  // Difficult-terrain (Beholder::0, Death Tyrant::0): "that area is difficult
  // terrain until initiative count 20". v1 doesn't model difficult terrain;
  // the handler logs "difficult-terrain field — no terrain model".
  // (Merrenoloth::0's "is difficult terrain + save vs prone" is save_condition
  // because of the @dc — not this flag.)
  if (/\bdifficult\s+terrain\b/i.test(cleaned)) {
    lairDifficultTerrain = true;
  }

  // Self-invisibility (Emerald Dragon::2): "becomes invisible until initiative
  // count 20 on the next round". The handler applies an `invisible`
  // ActiveEffect (mirrors Greater Invisibility) for `durationRounds` (1).
  if (/\bbecomes?\s+invisible\s+until\s+initiative\s+count\s+20/i.test(cleaned)) {
    lairSelfInvisible = true;
  }

  // Dispel-magic (Topaz Dragon::1, Zargon::1, Darkweaver::0): "ends the spell"
  // / "All spells of Nth level or lower ... end" / "the spell that created the
  // light is dispelled". Extract the max spell level. The handler iterates
  // each enemy's activeEffects and removes those with sourceSlotLevel ≤ max.
  //   - Darkweaver::0: "spell of 2nd level or lower" → maxLevel 2.
  //   - Topaz Dragon::1: "spell of 5th level or lower" → maxLevel 5.
  //   - Zargon::1: "spells of 5th level or lower" → maxLevel 5.
  // The "spell(s) of Nth level or lower" pattern is the strong signal — BUT
  // we must require a dispel/end signal word nearby, otherwise we false-positive
  // on Mummy Lord::2 / Valin Sarnaster::2 ("tries to cast a spell of 4th level
  // or lower ... is wracked with pain" — that's a spell-disruption FIELD that
  // deals damage on a failed save, NOT a dispel).
  {
    const dispelMatch = cleaned.match(/\bspells?\s+of\s+(\d+)(?:st|nd|rd|th)?\s+level\s+or\s+lower\b/i);
    if (dispelMatch) {
      const lvl = parseInt(dispelMatch[1], 10);
      // Sanity guard: lair-action dispel caps at 9th level (no 10th+ in 5e).
      if (lvl >= 1 && lvl <= 9) {
        // Require a dispel/end signal within ~80 chars of the level phrase.
        // (Mummy Lord::2 says "tries to cast a spell of 4th level or lower ...
        // is wracked with pain" — no dispel/end signal — does NOT trigger.)
        const idx = cleaned.toLowerCase().indexOf(dispelMatch[0].toLowerCase());
        const winStart = Math.max(0, idx - 80);
        const winEnd = idx + dispelMatch[0].length + 80;
        const window = cleaned.substring(winStart, winEnd).toLowerCase();
        if (/\b(?:ends?|dispel(?:led)?|ending)\b/.test(window)) {
          lairDispelMagic = { maxLevel: lvl };
        }
      }
    }
  }

  // Wall/obstacle-creation (Baphomet::2, Crystal Dragon::1, Fraz-Urb'luu::0,
  // Halaster Blackcloak::0/::1/::2, Sapphire Dragon::1/::2). v1 doesn't model
  // walls — the handler logs "wall/door creation — no obstacle model".
  // Match common phrasings (covers all 8 known actions):
  //   - Baphomet::2: "seals one doorway or other entryway"
  //   - Fraz-Urb'luu::0: "causes up to five doors within the lair to become walls"
  //   - Crystal Dragon::1: "open a passage through a wall of ice or snow"
  //   - Halaster::0: "turning the open space to solid, worked stone"
  //   - Halaster::1: "causes one door or archway ... to disappear"
  //   - Halaster::2: "deactivates or reactivates one of Undermountain's magic gates"
  //   - Sapphire Dragon::1: "form the stone into any shape"
  //   - Sapphire Dragon::2: "shape the stone to open or close a passage through a wall"
  if (/\b(?:seals?\s+(?:one|a)\s+doorway|doors?\s+(?:within\s+the\s+lair\s+)?(?:to\s+)?become\s+walls|open\s+(?:a|the)\s+passage\s+through\s+a\s+wall|open\s+space\s+to\s+solid|form\s+the\s+stone|shape\s+the\s+stone|door\s+or\s+archway|deactivates?\s+or\s+reactivates?\s+one\s+of)\b/i.test(cleaned)) {
    lairWallCreation = true;
  }

  // Ethereal-pass (Hag::0, Strahd::0): "can pass through solid walls, doors,
  // ceilings, and floors as if ... weren't there". v1 doesn't model walls —
  // the handler logs "ethereal-pass — no wall model".
  if (/\bpass\s+through\s+solid\s+walls,?\s+doors,?\s+ceilings,?\s+and\s+floors\b/i.test(cleaned)) {
    lairEtherealPass = true;
  }

  // Random-eye-ray (Beholder::2, Death Tyrant::2, Belashyrra::0): "An eye
  // opens on a solid surface ... One random eye ray of the [creature] shoots
  // from that eye ...". v1 doesn't model eye-ray tables — the handler logs
  // "random-eye-ray — eye-ray table not modeled".
  if (/\brandom\s+eye\s+ray\b/i.test(cleaned)
      || /\beye\s+opens\s+on\s+a\s+solid\s+surface\b/i.test(cleaned)
      || /\beye\s+opens\s+in\s+the\s+air\s+at\s+a\s+point\b/i.test(cleaned)) {
    lairRandomEyeRay = true;
  }

  // Undead-pinpoint-living (Mummy Lord::0, Valin Sarnaster::0): "Each undead
  // creature in the lair can pinpoint the location of each living creature
  // within 120 feet of it". v1's perception model doesn't have a "pinpoint
  // all living" meta-flag — the handler logs "undead-pinpoint-living —
  // perception meta-flag".
  if (/\bundead\s+creature\s+in\s+the\s+lair\s+can\s+pinpoint\b/i.test(cleaned)
      || /\bpinpoint\s+the\s+location\s+of\s+each\s+living\s+creature\b/i.test(cleaned)) {
    lairUndeadPinpointLiving = true;
  }

  // Vessel-heal (Merrenoloth::0, Merrenoloth::2): "The ship regains 22 (4d10)
  // hit points" / "The vessel regains 22 (4d10) hit points". v1 doesn't model
  // the vessel as a combatant — the handler logs "vessel-heal — no vessel
  // combatant". Note: Baernaloth::0's reactive self-heal is NOT this flag
  // (different mechanic — reactive trigger when others take damage).
  if (/\b(?:ship|vessel)\s+regains?\s+\d+\s*\(\{@dice\s+\d+d\d+\}/i.test(cleaned)
      || /\b(?:ship|vessel)\s+regains?\s+\d+\s*\(\d+d\d+\)/i.test(cleaned)) {
    lairVesselHeal = true;
  }

  // ── 6f. Phase 8 batch 2 (Session 101): six more bespoke-category recognition flags. ──
  // Covers 12 of the 15 remaining unrecognized bespoke actions from Session 100's
  // §19 coverage sweep. One is MECHANICAL (illusoryAttack rolls melee attack +
  // damage). Five are LOG-ONLY (plane-shift / teleport-with-allies / anti-
  // invisibility / recharge / bespoke-action-invocation).
  let lairPlaneShift: boolean | undefined;
  let lairTeleportAllies: boolean | undefined;
  let lairAntiInvisibility: boolean | undefined;
  let lairIllusoryAttack: { attackBonus: number; damage: { count: number; sides: number; bonus: number; type: string } } | undefined;
  let lairRechargeAbility: boolean | undefined;
  let lairBespokeActionInvocation: boolean | undefined;
  // Phase 8 batch 3 (Session 102): Demogorgon::1 illusory duplicate.
  let lairIllusoryDuplicate: boolean | undefined;

  // Plane-shift (Sphinx::3): "shifts itself and up to N other creatures ... to
  // another plane of existence". Out-of-combat effect — log-only v1.
  // Note: the count can be a digit OR a word-number ("seven", "five", etc.).
  if (/\bshifts?\s+(?:itself|themself)\s+and\s+(?:up\s+to\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+other\s+creatures?\b/i.test(cleaned)
      && /\bplane\s+of\s+existence\b/i.test(cleaned)) {
    lairPlaneShift = true;
  }

  // Teleport-with-allies (Gar Shatterkeel::0): "teleports ... bringing up to N
  // willing creatures". Log-only v1 (lair creature can already move freely).
  // The count can be a digit OR a word-number.
  if (/\bteleports?\s+.{0,60}bringing\s+(?:up\s+to\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+willing\s+creatures\b/i.test(cleaned)) {
    lairTeleportAllies = true;
  }

  // Anti-invisibility field (Drow Matron Mother::0): "can't become hidden from
  // her and gain no benefit from the invisible condition against her". Log-only
  // v1 (perception meta-flag not modeled).
  if (/\bcan'?t\s+become\s+hidden\b/i.test(cleaned)
      && /\binvisible\s+condition\b/i.test(cleaned)) {
    lairAntiInvisibility = true;
  }

  // Illusory-attack (Alyxian the Absolved::2 / Callous::2 / Dispossessed::2 /
  // Tormented::2): "makes one melee weapon attack (N to hit) against it. On a
  // hit, the attack deals M (XdY + Z) [type] damage." Extract attackBonus from
  // "(N to hit)" and damage from "XdY + Z" + damage type from the surrounding
  // text. MECHANICAL handler rolls the attack + applies damage.
  // Note: the rawText has already been cleaned (5eTools {@dice} tags reduced to
  // their first arg), so we match the dice pattern in `cleaned` directly.
  {
    const attackMatch = cleaned.match(/\bmakes?\s+one\s+melee\s+weapon\s+attack\s+\((\d+)\s+to\s+hit\)\s+against/i);
    if (attackMatch) {
      const attackBonus = parseInt(attackMatch[1], 10);
      // Extract damage from "XdY + Z" followed by a damage type word. The dice
      // is in the cleaned text as "10d8 + 4" or "1d8 + 4" (the {@dice} tag was
      // reduced to its first arg by the cleaning step).
      const dmgMatch = cleaned.match(/(\d+)d(\d+)\s*(?:\+\s*(\d+))?\s*\)?\s*(bludgeoning|piercing|slashing|fire|cold|lightning|thunder|poison|acid|psychic|necrotic|radiant|force)\s+damage/i);
      if (dmgMatch) {
        const count = parseInt(dmgMatch[1], 10);
        const sides = parseInt(dmgMatch[2], 10);
        const bonus = dmgMatch[3] ? parseInt(dmgMatch[3], 10) : 0;
        const type = dmgMatch[4].toLowerCase();
        // Sanity guard: count 1-20, sides 1-20, bonus 0-50 (within 5e bounds).
        if (count >= 1 && count <= 20 && sides >= 1 && sides <= 20 && bonus >= 0 && bonus <= 50) {
          lairIllusoryAttack = {
            attackBonus,
            damage: { count, sides, bonus, type },
          };
        }
      }
    }
  }

  // Recharge-ability (Greater Tyrant Shadow::1): "recharges its [Ability Name]
  // ability". Log-only v1 (no per-ability recharge tracking). Distinct from
  // the inline-regex `/recharges\s+one\s+of/` (Archdevil::3 "recharges one of
  // their expended abilities") — this flag covers the specific "recharges its
  // X ability" phrasing.
  if (/\brecharges?\s+(?:its|his|her)\s+\w[\w\s]*\bability\b/i.test(cleaned)) {
    lairRechargeAbility = true;
  }

  // Bespoke-action-invocation (Dyrrn::0, Morkoth::1, Zuggtmoy::2): "uses its
  // [X] action" / "uses either her [X] or [Y]". Log-only v1 (each named action
  // would need its own handler). Match "uses its/his/her [Name] action" — the
  // strong signal is "uses ... action" with a possessive pronoun.
  // (Excludes "uses one of their available attacks" — that's the inline-regex
  // free-attack pattern, already handled.)
  if (/\buses?\s+(?:its|his|her)\s+\w[\w\s]*\baction\b/i.test(cleaned)
      && !/uses\s+one\s+of\s+(?:their|his|her)\s+available/i.test(cleaned)) {
    lairBespokeActionInvocation = true;
  }
  // Also catch "uses either her X or her Y" (Zuggtmoy::2 pattern — no "action"
  // word but clearly invokes a named ability).
  if (/uses?\s+either\s+(?:its|his|her)\s+\w+/i.test(cleaned)
      && !/uses\s+one\s+of\s+(?:their|his|her)\s+available/i.test(cleaned)) {
    lairBespokeActionInvocation = true;
  }

  // ── 6g. Phase 8 batch 3 (Session 102): Demogorgon::1 illusory duplicate. ──
  // The text: "creates an illusory duplicate of himself... The first time a
  // creature or an object interacts physically with Demogorgon (for example,
  // by hitting him with an attack), there is a {@chance 50} chance that the
  // illusory duplicate is affected, not Demogorgon, in which case the
  // illusion disappears."
  //
  // Parser extracts `lairIllusoryDuplicate = true` from the conjunction of:
  //   - "illusory duplicate" (the effect name)
  //   - "interacts physically" (the trigger phrase)
  //   - "{@chance 50}" or "50% chance" (the redirect probability — we don't
  //     parse the exact % because v1 hardcodes 50%; Phase 9+ may parameterize)
  //
  // The MECHANICAL handler sets `Combatant.lairIllusoryDuplicate` (scratch
  // field). The reactive redirect is in `applyLairIllusoryDuplicateRedirect`
  // (called at 3 attack-damage hook sites in resolveAttack).
  //
  // Verified: the regex matches ONLY Demogorgon::1 (MPMM + MTF) — no other
  // lair action uses "illusory duplicate" + "interacts physically" together.
  if (/\billusory\s+duplicate\b/i.test(cleaned)
      && /\binteracts?\s+physically\b/i.test(cleaned)) {
    lairIllusoryDuplicate = true;
  }

  // ── 7. summons from {@creature X} + "up to N" / "N <creatures> rise as" ──
  // Fallback: "creating a/summoning a <creature>" (Lichen Lich shambling mound,
  // which has no @creature tag — [VERIFY-1] recommended summon classification).
  let summons: { creature: string; count: number | string } | undefined;
  const creatureMatch = rawText.match(/\{@creature\s+([^}|]+)(?:\|[^}]*)?\}/i);
  if (creatureMatch) {
    const creature = creatureMatch[1].trim();
    let count: number | string = 1;
    const upToMatch = cleaned.match(/up to (\d+)/i);
    if (upToMatch) count = parseInt(upToMatch[1], 10);
    else {
      const nMatch = cleaned.match(/(\d+)\s+(?:corpses|bodies|spirits|skeletons|zombies|creatures|knights|warriors|cultists)\b/i);
      if (nMatch) count = parseInt(nMatch[1], 10);
    }
    summons = { creature, count };
  } else {
    // Fallback: "creating a/summons a/conjures a <creature-name>" — only when
    // the text also mentions "obeys" / "appears in an unoccupied space" /
    // "acts on the creature's turn" (strong summon signals).
    if (/\b(?:creating|summons?|conjures?)\s+(?:a|an|one|up to \d+)\s+([a-z][a-z\s'-]+?)(?:\.|,| that| which| obeys| appears)/i.test(cleaned)
        && /\b(?:obeys|appears in an unoccupied space|acts on .* turn|under .* control)\b/i.test(cleaned)) {
      const nameMatch = cleaned.match(/\b(?:creating|summons?|conjures?)\s+(?:a|an|one|up to \d+)\s+([a-z][a-z\s'-]+?)(?:\.|,| that| which| obeys| appears)/i);
      if (nameMatch) {
        summons = { creature: nameMatch[1].trim(), count: 1 };
      }
    }
    // Phase 7 batch 2 (Session 99): "statistics of a/an [normal] <creature>"
    // — Captain N'ghathrod::0 psionic duplicate pattern. The text says "The
    // duplicate has the statistics of a normal mind flayer". This is a SUMMON
    // misclassified as save_only (the @dc 15 is the dispel DC, not a save).
    // Extract the creature name and clear saveDC/saveAbility so the category
    // becomes `summon`.
    if (!summons) {
      const statsMatch = cleaned.match(/statistics of (?:a|an|the)\s+(?:normal\s+)?([a-z][a-z\s'-]+?)(?:\s+and\s+is|\s*,|\s*\.|$)/i);
      if (statsMatch
          && /\b(?:duplicate|copy|clone|apparition)\b/i.test(cleaned)) {
        const creatureName = statsMatch[1].trim();
        // Guard against obviously-wrong captures (too long = regex over-matched).
        if (creatureName.length > 0 && creatureName.length <= 40 && creatureName.split(/\s+/).length <= 4) {
          summons = { creature: creatureName, count: 1 };
        }
      }
    }
  }

  // ── 8. rangeFt from "within N feet" ──
  const rangeMatch = cleaned.match(/within\s+(\d+)\s*feet/i);
  const rangeFt = rangeMatch ? parseInt(rangeMatch[1], 10) : undefined;

  // ── 9. radiusFt from "N-foot-radius" / "N-foot-radius sphere" ──
  const radiusMatch = cleaned.match(/(\d+)[- ]?(?:foot|feet)[- ]?radius/i);
  const radiusFt = radiusMatch ? parseInt(radiusMatch[1], 10) : undefined;

  // ── 9b. centerOnPoint — true when the text explicitly describes
  // point-selection AoE targeting ("centered on a point the [creature]
  // chooses/can see within N feet of it"). Session 103. This is the opt-in
  // signal for chooseLairActionPoint (vs. the v1 over-approximation that
  // centers the AoE on the lair creature itself).
  //
  // Session 105 — regex broadened. The S103 regex matched ONLY "centered on a
  // point". The S104 handover (next-action #5) audited the remaining radiusFt
  // actions and found 4 more with explicit point-selection phrasing that the
  // S103 regex missed (they use "a point the [creature] chooses/can see" +
  // "centered on that point", not "centered on a point"):
  //   • Black Dragon::2  — "spreads from a point the dragon chooses ... filling a 15-foot-radius sphere"
  //   • Bronze Dragon::1 — "originates at a point the dragon can see ... centered on that point"
  //   • Copper Dragon::0 — "chooses a point on the ground that it can see ... centered on that point"
  //   • Red Dragon::0    — "erupts from a point on the ground the dragon can see ... 5-foot-radius geyser"
  // The new alternation `a point ... (chooses|can see)` catches all 4 (plus 6
  // radiusFt=undefined actions with the same phrasing — Drow Matron Mother::1,
  // Geryon::0/::1, Hythonia::1, Yeenoghu::0/::1 — which get the flag but stay
  // on v1 because selectLairActionPoints requires radiusFt !== undefined to
  // activate the point-selection branch; the flag is still semantically
  // correct and future-proofs for when radiusFt extraction is extended to
  // "within N feet of that point" / "cube N feet on a side" phrasings).
  //
  // The regex does NOT match centered-on-self phrasing ("within N feet of the
  // [creature]" / "around the [creature]" / "centered on him") — those have no
  // "a point ... chooses/can see" clause, so they stay on v1. The 4 borderline
  // cases ("a N-foot-radius sphere/area within N feet of [creature]" — Imix::1,
  // Ogrémoch::0/::1, Olhydra::2) mechanically ARE point-selection but omit the
  // "chooses/can see" qualifier; they stay on v1 (conservative — a future
  // session can revisit with more context). Verified against the bestiary:
  // 22 actions now use centerOnPoint (12 "centered on a point" + 10
  // "a point ... chooses/can see"); 5 centered-on-self + 4 borderline + 1
  // ambiguous (Gar Shatterkeel::1) stay false.
  const centerOnPoint =
    /centered on a point/i.test(cleaned) ||
    /a point\b[^.]*?\b(?:chooses|can see)\b/i.test(cleaned);

  // ── 10. durationRounds ──
  let durationRounds: number | undefined;
  if (/until\s+initiative\s+count\s+20\s+on\s+the\s+round\s+after\s+next/i.test(cleaned)) {
    durationRounds = 2;
  } else if (/until\s+initiative\s+count\s+20\s+on\s+the\s+next\s+round/i.test(cleaned)) {
    durationRounds = 1;
  } else if (/\b1\s+minute\b/i.test(cleaned)) {
    durationRounds = 10;
  } else if (/until\s+(?:it\s+)?(?:dismissed|dispelled|dies|the\s+\w+\s+dies)/i.test(cleaned)) {
    durationRounds = Infinity;
  } else if (/for\s+1\s+hour|\bdies after 1 hour\b/i.test(cleaned)) {
    // Lichen Lich shambling mound (1 hour >> combat) → treat as persistent summon.
    durationRounds = Infinity;
  }

  // ── 11. targetsEnemies (best-effort; refined in Phase 4 scoring) ──
  let targetsEnemies = true;
  if (/\bfriendly\s+creature/i.test(cleaned)) targetsEnemies = false;
  else if (/\b(?:themself|itself)\b/i.test(cleaned)
           && /\b(?:casts|gains|targets .* itself)\b/i.test(cleaned)
           && !/\beach\s+creature\b/i.test(cleaned)) {
    targetsEnemies = false;
  }

  // ── 12. targetFilter from "each <type> or <type>" ──
  let targetFilter: string | undefined;
  {
    const tfMatch = cleaned.match(
      /\beach\s+((?:non-)?(?:undead|humanoid|beast|fiend|fey|celestial|dragon|aberration|monstrosity|ooze|elemental|plant|construct|giant|gnoll|hyena|goblinoid|elf|dwarf|human|tiefling|halfling|gnome|half-orc)(?:\s+or\s+(?:undead|humanoid|beast|fiend|fey|celestial|dragon|aberration|monstrosity|ooze|elemental|plant|construct|giant|gnoll|hyena|goblinoid|elf|dwarf|human|tiefling|halfling|gnome|half-orc))*)/i,
    );
    if (tfMatch) {
      targetFilter = tfMatch[1].toLowerCase().replace(/\s+or\s+/g, '|').trim();
    }
  }

  // ── 13. [DD-4] isMagical — default true (MM: "magical effects"). ──
  // `isMagical: false` is reserved for purely physical effects (rare; none
  // currently identified in the 324-action corpus). Flagged [VERIFY] if found.
  const isMagical = true;

  // ── 14. outOfScope / deferred — registry-first, heuristic safety-net. ──
  let outOfScope = false;
  let outOfScopeId: string | undefined;
  let deferred: string | undefined;
  let deferredId: string | undefined;

  // Registry match (by sourceCreature + distinctive phrase).
  for (const entry of LAIR_REGISTRY) {
    if (entry.sourceCreature === sourceCreature && entry.match.test(rawText)) {
      if (entry.kind === 'oos') {
        outOfScope = true;
        outOfScopeId = entry.id;
      } else {
        deferred = entry.deferredTag;
        deferredId = entry.id;
      }
      break;
    }
  }

  // Heuristic safety-net (only when no registry match).
  if (!outOfScope && !deferred) {
    const hasMechanicalTag = /\{@(?:dc|damage|condition|creature|spell|hit|dice|status|hazard)\s/i.test(rawText);
    // Out-of-scope: no mechanical tag AND a flavor signal.
    if (!hasMechanicalTag) {
      if (/after 10 minutes|terrain.{0,30}reshapes|conjures? up one or more (?:temporary|permanent) objects|propels the vessel/i.test(cleaned)) {
        outOfScope = true;
        outOfScopeId = `lair_oos_auto_${sourceCreature.replace(/[^a-z0-9]/gi, '_')}_${index}`;
      }
    }
    // Deferred: mechanical but awaiting a subsystem (matched by keyword).
    if (!outOfScope) {
      if (/reverse gravity|gravity is reversed/i.test(cleaned)) {
        deferred = 'gravity';
        deferredId = `lair_def_auto_${sourceCreature.replace(/[^a-z0-9]/gi, '_')}_${index}`;
      } else if (/magical darkness|can't see through.{0,40}darkness|heavily obscured/i.test(cleaned)) {
        deferred = 'magical-darkness';
        deferredId = `lair_def_auto_${sourceCreature.replace(/[^a-z0-9]/gi, '_')}_${index}`;
      } else if (/\{@hazard\s/i.test(rawText)) {
        deferred = 'dmg-hazard';
        deferredId = `lair_def_auto_${sourceCreature.replace(/[^a-z0-9]/gi, '_')}_${index}`;
      } else if (/flow of time.{0,30}(altered|changed)|reroll initiative/i.test(cleaned)) {
        deferred = /reroll initiative/i.test(cleaned) ? 'meta-initiative' : 'meta-time';
        deferredId = `lair_def_auto_${sourceCreature.replace(/[^a-z0-9]/gi, '_')}_${index}`;
      }
    }
  }

  // ── 15. category (dispatcher routing tag — Phase 2+). ──
  let category: LairActionCategory;
  if (outOfScope) {
    category = 'flavor';
  } else if (deferred) {
    category = 'deferred';
  } else if (isSpell) {
    category = 'cast_spell';
  } else if (summons) {
    category = 'summon';
  } else if (saveDC && damage) {
    category = 'save_damage';
  } else if (saveDC && conditions && conditions.length > 0) {
    category = 'save_condition';
  } else if (saveDC) {
    category = 'save_only';
  } else if (damage) {
    category = 'damage_no_save';
  } else if (/regain.{0,30}spell\s+slot|spell\s+slot.{0,30}regain/i.test(cleaned)) {
    category = 'spell_slot_regen';
  } else if (/\b(magic|magical)\b/i.test(cleaned) && /regain.{0,20}hit\s+points|regains?\s+\d+\s+\(/i.test(cleaned)) {
    // e.g., Merrenoloth "The vessel regains 22 (4d10) hit points" — a buff_ally heal.
    category = 'buff_ally';
  } else if (/vulnerability/i.test(cleaned)) {
    category = 'debuff_enemy';
  } else if (/\badvantage\b/i.test(cleaned)
             && /\b(?:saving throw|attack|allies|friendly|undead)\b/i.test(cleaned)) {
    category = 'buff_ally';
  } else if (/\bdisadvantage\b/i.test(cleaned)) {
    category = 'debuff_enemy';
  } else if (/\bheavily obscured\b/i.test(cleaned) || /\bfog\b/i.test(cleaned)) {
    category = 'visibility';
  } else if (/\b(?:pushed|pulled|knocked|fall|moves?\s+up\s+to)\b/i.test(cleaned)) {
    category = 'movement';
  } else {
    category = 'bespoke';
  }

  return {
    id: `${sourceCreature}::${index}`,
    sourceCreature,
    rawText: cleaned,
    outOfScope,
    outOfScopeId,
    deferred,
    deferredId,
    isMagical,
    isSpell,
    spellName,
    castLevel,
    saveDC,
    saveAbility,
    damage,
    halfOnSave,
    maxTargets,
    conditions,
    summons,
    rangeFt,
    radiusFt,
    centerOnPoint,
    durationRounds,
    targetsEnemies,
    targetFilter,
    // Phase 6 (Session 97): save_only bespoke-effect fields.
    pushFt,
    pushDirection,
    successPushFt,
    banished,
    applyConditions,
    // Phase 7 (Session 98): additional save_only bespoke-effect fields.
    teleportToSource,
    teleportFt,
    speedZero,
    disadvOnAttacks,
    // Phase 7 batch 2 (Session 99): four more save_only bespoke-effect flags.
    lairWardingBondTether,
    objectMove,
    ageAlteration,
    environmentManipulation,
    // Phase 8 batch 1 (Session 100): eight bespoke-category recognition flags.
    lairDifficultTerrain,
    lairSelfInvisible,
    lairDispelMagic,
    lairWallCreation,
    lairEtherealPass,
    lairRandomEyeRay,
    lairUndeadPinpointLiving,
    lairVesselHeal,
    // Phase 8 batch 2 (Session 101): six more bespoke-category recognition flags.
    lairPlaneShift,
    lairTeleportAllies,
    lairAntiInvisibility,
    lairIllusoryAttack,
    lairRechargeAbility,
    lairBespokeActionInvocation,
    // Phase 8 batch 3 (Session 102): Demogorgon::1 illusory duplicate.
    lairIllusoryDuplicate,
    category,
  };
}

function parseLairActions(
  raw: Raw5etoolsMonster,
): Combatant['lairActions'] {
  if (!raw.legendaryGroup) return undefined;
  const lgMap = loadLegendaryGroups();
  const lg = lgMap.get(raw.legendaryGroup.name + '|' + raw.legendaryGroup.source);
  if (!lg || !lg.lairActions) return undefined;

  // Flatten the lairActions array: strings stay as-is, {type:'list', items:[...]}
  // objects get their items extracted, {type:'entries', entries:[...]} get flattened.
  // (Unchanged from Session 60 — preserves the exact action count for backward
  // compat with existing tests, e.g. Adult Red Dragon = 4 options.)
  const flat = (e: any): string => {
    if (typeof e === 'string') return e;
    if (Array.isArray(e)) return e.map(flat).join(' ');
    if (e.items) return e.items.map(flat).join(' ');
    if (e.entries) return e.entries.map(flat).join(' ');
    return '';
  };

  // The lairActions array is: [intro text, {type:'list', items:[action1, action2, ...]}, ...]
  // Extract the individual action options (the items in the list).
  const rawActions: string[] = [];
  for (const entry of lg.lairActions) {
    if (typeof entry === 'string') {
      // Intro text — skip (not an action option)
      continue;
    }
    if (entry.items && Array.isArray(entry.items)) {
      // List of action options
      for (const item of entry.items) {
        const text = flat(item).trim();
        if (text) rawActions.push(text);
      }
    } else if (entry.entries) {
      // Nested entries — flatten
      const text = flat(entry).trim();
      if (text) rawActions.push(text);
    }
  }

  if (rawActions.length === 0) return undefined;

  // Extract initiative count from the intro text (usually "On initiative count 20")
  let initiativeCount = 20; // PHB default
  const introText = lg.lairActions.find((e: any) => typeof e === 'string') as string || '';
  const initMatch = introText.match(/initiative\s+count\s+(\d+)/i);
  if (initMatch) initiativeCount = parseInt(initMatch[1], 10);

  // Build structured LairAction[] via the per-action extractor.
  const sourceCreature = raw.legendaryGroup.name;
  let actions: LairAction[] = rawActions.map((text, idx) =>
    extractLairAction(text, sourceCreature, idx),
  );

  // Phase 6 (Session 97) Phase 1 review: filter intro-text flattening artifacts.
  // The "Additional Lair Actions" variant (At your discretion, a legendary
  // (Adult Black Dragon...) black dragon can use one or more of the following
  // additional lair actions...) is INTRO TEXT for a variant rule, not an
  // action. The 5eTools JSON nests it in a `entries` list alongside the real
  // actions, so `flat()` extracts it as an action string. The parser then
  // mis-classifies it as a `summon` action (because of the `@creature` tags
  // for Adult/Ancient variants) — the Phase 3b handler skips the spawn (the
  // summons name matches the source creature name), and the Phase 4 scorer
  // scores it -1000 (never picked). But it still consumes an action slot and
  // an action ID, which:
  //   1. Shifts the IDs of the real "additional" actions (e.g., Black Dragon::3
  //      instead of Black Dragon::2).
  //   2. Confuses the 2-entry history (the artifact is never picked, but it's
  //      still a "candidate" that clogs the selection).
  //
  // Filter: drop any action whose rawText starts with "At your discretion" —
  // this is the intro-text signature. The 48 artifacts all match this pattern.
  // (Verified: no real lair action starts with "At your discretion" — they
  // all start with the action's subject, e.g., "Magma erupts...", "A cloud...")
  //
  // Re-index the remaining actions so IDs are contiguous (Black Dragon::0,
  // ::1, ::2 instead of ::0, ::1, ::2, ::3-with-::3-being-the-artifact).
  // This changes the IDs of some "additional" actions — the session92/93/94/95/96
  // tests that assert on exact IDs for the Adult Red Dragon's 4 actions are
  // unaffected (the Red Dragon has no "additional" variant → no artifact).
  // The Black Dragon, Blue Dragon, Brass Dragon, Bronze Dragon, Copper Dragon,
  // Green Dragon, Silver Dragon, White Dragon each lose their ::3 (or ::2)
  // artifact action and their real "additional" actions shift down by 1.
  // This is the intended behavior — the artifact was never a real action.
  const INTRO_TEXT_RE = /^(at your discretion|on initiative count|the following|when\s+\w+\s+is\s+in\s+its\s+lair)/i;
  actions = actions.filter(a => !INTRO_TEXT_RE.test(a.rawText.trim()));

  // Re-index IDs to be contiguous after filtering.
  actions = actions.map((a, idx) => ({ ...a, id: `${sourceCreature}::${idx}` }));

  return { actions, initiativeCount };
}

/**
 * Session 61 RFC-SHAPECHANGER Phase 1: parse the "Shapechanger" trait.
 *
 * 76 pre-2024 creatures have this trait. The trait text follows a few patterns:
 *
 * Pattern A (most common — single form, no speed change):
 *   "The X can use its action to polymorph into a Y or back into its true form.
 *    Its statistics, other than its size, are the same in each form."
 *
 * Pattern B (multi-form with per-form speed):
 *   "Strahd ... can use his action to polymorph into a Tiny bat, a Medium wolf,
 *    or a Medium cloud of mist, or back into his true form. ... In bat form,
 *    his walking speed is 5 feet, and he has a flying speed of 30 feet. In wolf
 *    form, his walking speed is 40 feet. ... In mist form, ... can't take any
 *    actions ... immune to all nonmagical damage ..."
 *
 * Pattern C (inline speed in parentheses):
 *   "The imp can use its action to polymorph into a beast form that resembles
 *    a rat (speed 20 ft.), a raven (20 ft., fly 60 ft.), or a spider
 *    (20 ft., climb 20 ft.), or back into its true form."
 *
 * Pattern D (AC change):
 *   "The werebear can use its action to polymorph into a Large bear-humanoid
 *    hybrid or into a Large polar bear, or back into its goliath form. Its
 *    statistics, other than its size and AC, are the same in each form."
 *
 * v1 parser strategy:
 *   1. Strip {@tag arg} 5etools tags → plain text.
 *   2. Find the "polymorph into X, Y, or back into its true form" clause.
 *      Split on commas + "or" to extract form names.
 *   3. For each form name, parse leading size word (Tiny/Small/Medium/etc.).
 *   4. Parse inline "(speed N ft., fly N ft.)" parenthetical speeds.
 *   5. Parse "In <form> form, ..." clauses for per-form speed + special flags.
 *   6. Detect "other than ... size and AC" → flag AC changes apply (metadata-only).
 *
 * v1 simplifications:
 *   - Only ONE form per "polymorph into" clause variant is kept per name
 *     (e.g., Usagt's "Small, Medium, or Large humanoid" → 1 "humanoid" form,
 *     size = first encountered = 'Small').
 *   - AC change is flagged but not extracted (text doesn't say what the new AC
 *     is — it's in a different field of the stat block). v1 engine hook does
 *     NOT apply AC change.
 *   - "Reverts to true form if it dies" — handled in engine's death hook
 *     (reset _currentForm to 'true' for logging; no mechanical effect).
 *   - Forms with no mechanical differences from the base form are still
 *     recorded (for planner consideration), but transforming into them is
 *     a no-op.
 *
 * Returns undefined if no Shapechanger trait is present.
 */
const SIZE_WORD_MAP: { [word: string]: CreatureSize } = {
  'tiny': 'Tiny',
  'small': 'Small',
  'medium': 'Medium',
  'large': 'Large',
  'huge': 'Huge',
  'gargantuan': 'Gargantuan',
};

function parseShapechanger(
  traits: { name: string; entries: (string | object)[] }[],
): Combatant['shapechangerForms'] {
  let scTrait: { name: string; entries: (string | object)[] } | undefined;
  for (const t of traits) {
    if (/^Shapechanger$/i.test(t.name.trim())) {
      scTrait = t;
      break;
    }
  }
  if (!scTrait) return undefined;

  // Flatten entries → plain text, stripping {@tag arg|...} tags.
  const rawText = flattenEntries(scTrait.entries);
  const text = rawText.replace(/\{@(\w+)\s+([^}]+)\}/g, (_m, _tag, args) => {
    return String(args).split('|')[0].trim();
  });

  // Step 1: Find the "polymorph into ... or back into its true form" clause.
  // Capture the text between "polymorph into" and "or back into" (or end of sentence).
  const polyMatch = text.match(/polymorph\s+into\s+(.+?)(?:\s+or\s+back\s+into\s+(?:its|her|his)\s+true\s+form|\.)/i);
  if (!polyMatch) return undefined;
  let polyClause = polyMatch[1];

  // Step 1b: Truncate polyClause at "or back into" / "or into" to avoid the
  // "...or back into its goliath form" trailing form (which is the implicit true form).
  const backMatch = polyClause.match(/\s+or\s+back\s+into\s+/i);
  if (backMatch) polyClause = polyClause.slice(0, backMatch.index);

  // Step 2: Split the polyClause into individual form descriptions.
  // Strategy: replace "or" with a comma ONLY when followed by an article (a/an/the),
  // size word, or "into a/an/the" — this avoids splitting "in person or telepathically"
  // (Usagt) or "speak or manipulate objects" (Strahd mist form) which aren't form lists.
  const sizeWordAlt = Object.keys(SIZE_WORD_MAP).join('|');
  const orAsCommaRegex = new RegExp(
    `,?\\s+or\\s+(?=(?:a|an|the)\\s+|(?:${sizeWordAlt})\\s+|into\\s+(?:a|an|the)\\s+)`,
    'gi',
  );
  const normalized = polyClause.replace(orAsCommaRegex, ', ');
  // Now split on commas — but watch for commas inside parentheses.
  const rawForms: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of normalized) {
    if (ch === '(') { depth++; current += ch; }
    else if (ch === ')') { depth--; current += ch; }
    else if (ch === ',' && depth === 0) {
      if (current.trim()) rawForms.push(current.trim());
      current = '';
    }
    else current += ch;
  }
  if (current.trim()) rawForms.push(current.trim());

  // Step 3: For each raw form, extract size + name + inline speeds.
  const forms: ShapechangerForm[] = [];
  const seenNames = new Set<string>();  // dedupe by canonical name

  for (let rawForm of rawForms) {
    // Strip leading "a", "an", "the"
    rawForm = rawForm.replace(/^(?:a|an|the)\s+/i, '').trim();
    if (!rawForm) continue;
    // Skip "true form" / "true, amorphous form" / "back into" patterns —
    // those are the implicit default form.
    if (/true\s+form/i.test(rawForm)) continue;
    if (/^(?:back\s+into\s+|into\s+(?:a|an|the)\s+)/i.test(rawForm)) {
      // e.g., "into a Large polar bear" → strip "into a" and keep parsing
      rawForm = rawForm.replace(/^(?:back\s+into\s+|into\s+)/i, '').trim();
      rawForm = rawForm.replace(/^(?:a|an|the)\s+/i, '').trim();
    }
    // Skip bare "amorphous form" / "goliath form" / "<X> form" — those are
    // the implicit true form, not a separate alternate form.
    if (/^(?:amorphous|goliath|true|natural|human(?:oid)?)\s+form$/i.test(rawForm)) continue;
    if (!rawForm || /^form$/i.test(rawForm)) continue;

    // Parse leading size word: "Tiny bat", "Medium wolf", etc.
    let size: CreatureSize | undefined;
    const firstWord = rawForm.split(/\s+/)[0] || '';
    if (SIZE_WORD_MAP[firstWord.toLowerCase()]) {
      size = SIZE_WORD_MAP[firstWord.toLowerCase()];
      rawForm = rawForm.slice(firstWord.length).trim();
    }

    // Extract inline parenthetical: "rat (speed 20 ft., fly 60 ft.)"
    let speedWalk: number | undefined;
    let speedFly: number | undefined;
    let speedClimb: number | undefined;
    let speedSwim: number | undefined;
    const parenMatch = rawForm.match(/\(([^)]+)\)\s*$/);
    if (parenMatch) {
      const paren = parenMatch[1];
      // Strip the parenthetical from the form name.
      rawForm = rawForm.slice(0, parenMatch.index).trim();
      // Parse speed expressions: "speed 20 ft.", "fly 60 ft.", "climb 20 ft.", "20 ft., fly 60 ft."
      const speedMatches = paren.matchAll(/(?:(\w+)\s+)?(\d+)\s*(?:feet|ft\.?)\b/gi);
      for (const m of speedMatches) {
        const kind = (m[1] || '').toLowerCase();
        const value = parseInt(m[2], 10);
        if (kind === 'fly') speedFly = value;
        else if (kind === 'climb') speedClimb = value;
        else if (kind === 'swim') speedSwim = value;
        else if (kind === 'walk' || kind === 'speed' || kind === '') speedWalk = value;
      }
    }

    // Canonical name: strip "beast form that resembles a/an" prefix.
    let name = rawForm
      .replace(/^beast\s+form\s+that\s+resembles\s+(?:a|an)\s+/i, '')
      .replace(/^form\s+that\s+resembles\s+(?:a|an)\s+/i, '')
      .replace(/^form\s+resembling\s+(?:a|an)\s+/i, '')
      .trim();
    if (!name) continue;
    // Strip trailing "it has seen in person or telepathically" style rider.
    name = name.replace(/\s+it\s+has\s+seen.*$/i, '').trim();
    if (!name) continue;

    // Dedupe by canonical name (Usagt's "Small, Medium, or Large humanoid" → 1 form).
    if (seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    forms.push({
      name,
      size,
      speedWalk,
      speedFly,
      speedClimb,
      speedSwim,
      description: name,  // will be enriched below if "In <form> form" clause exists
    });
  }

  // Step 4: Parse "In <form> form, ..." clauses for per-form speed + special flags.
  // Strategy: split text into sentences; for each sentence starting with "In "
  // or "While in ", extract the form names mentioned + the clause text.
  // ALSO: scan the NEXT 2 sentences after a form clause for additional flags
  // (Strahd's mist form has "immune to all nonmagical damage" 2 sentences later).
  const sentences = text.split(/(?<=\.)\s+/);
  const formClauses: { formNames: string[]; text: string }[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const m = s.match(/^(?:while\s+)?in\s+([^,]+?(?:\s+or\s+[^,]+?)?)\s+form\s*,?\s*(.+)$/i);
    if (m) {
      const formsList = m[1].trim();
      const clause = m[2].trim();
      // Split the forms list on "or" to get individual form names.
      const individualForms = formsList.split(/\s+or\s+/i).map(f => f.trim().toLowerCase());
      // Combine with the next 1-3 sentences for additional flag capture
      // (e.g., Strahd mist form: "He has advantage on ... immune to all
      // nonmagical damage" is 3 sentences after the "While in mist form" intro).
      const followup = [
        sentences[i + 1] || '',
        sentences[i + 2] || '',
        sentences[i + 3] || '',
      ].filter(s => s && !/^(?:while\s+)?in\s+/i.test(s))  // stop at next form clause
        .join(' ');
      formClauses.push({ formNames: individualForms, text: followup ? `${clause} ${followup}` : clause });
    }
  }

  // For each form, scan ALL matching clauses and aggregate the speed/flag info.
  for (const form of forms) {
    const formNameLower = form.name.toLowerCase();
    const matchingClauses: string[] = [];
    for (const fc of formClauses) {
      // Check if any of the clause's form names match our form (whole-word match).
      const matches = fc.formNames.some(fn =>
        fn === formNameLower ||
        fn.includes(formNameLower) ||
        formNameLower.includes(fn),
      );
      if (matches) matchingClauses.push(fc.text);
    }
    if (matchingClauses.length === 0) continue;

    const allClauseText = matchingClauses.join(' ');
    form.description = `${form.name}: ${allClauseText.slice(0, 200)}`;

    // Walking speed: "walking speed is 5 feet" or "walk speed of 5 feet"
    const walkMatch = allClauseText.match(/walk(?:ing)?\s+speed\s+(?:is\s+)?(\d+)\s*(?:feet|ft\.?)/i);
    if (walkMatch) form.speedWalk = parseInt(walkMatch[1], 10);

    // Flying speed: "flying speed of 30 feet" or "fly speed of 30 feet" or "has a flying speed of 30 feet"
    const flyMatch = allClauseText.match(/fly(?:ing)?\s+speed\s+(?:of\s+|is\s+)?(\d+)\s*(?:feet|ft\.?)/i);
    if (flyMatch) form.speedFly = parseInt(flyMatch[1], 10);

    // Climbing speed
    const climbMatch = allClauseText.match(/climb(?:ing)?\s+speed\s+(?:of\s+|is\s+)?(\d+)\s*(?:feet|ft\.?)/i);
    if (climbMatch) form.speedClimb = parseInt(climbMatch[1], 10);

    // Swimming speed
    const swimMatch = allClauseText.match(/swim(?:ming)?\s+speed\s+(?:of\s+|is\s+)?(\d+)\s*(?:feet|ft\.?)/i);
    if (swimMatch) form.speedSwim = parseInt(swimMatch[1], 10);

    // Special flags
    if (/can'?t\s+take\s+any\s+actions/i.test(allClauseText)) form.cantTakeActions = true;
    if (/immune\s+to\s+all\s+nonmagical\s+damage/i.test(allClauseText)) form.immuneNonmagical = true;
    if (/advantage\s+on\s+strength,?\s+dexterity,?\s+and\s+constitution\s+saving\s+throws/i.test(allClauseText)) {
      form.advantageOnStrDexConSaves = true;
    }
  }

  // Step 5: Detect "other than ... AC" → flag that AC changes apply (metadata-only).
  // We don't extract the actual AC value because it's typically in a separate
  // stat block field, not in the trait text. v1 engine hook does NOT apply AC
  // change — this is recorded for future Phase 4 work.
  // (No-op for now; the form.ac field stays undefined for all parsed forms.)

  if (forms.length === 0) return undefined;
  return forms;
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
export function defaultProfileForType(typeStr: Raw5etoolsMonster['type'] | undefined): AIProfile {
  const t = rawCreatureType(typeStr);
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
  typeStr: Raw5etoolsMonster['type'] | undefined,
  raw: { name?: string; entries?: string[]; actions?: { entries?: string[] }[] }
): boolean {
  const t = rawCreatureType(typeStr);

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
export function rawCreatureType(type: Raw5etoolsMonster['type']): string {
  if (!type) return '';
  if (typeof type === 'string') return type.toLowerCase();
  // Session 53: bestiary-mpp.json (and possibly others) uses the
  // `{ type: { choose: ['celestial', 'fiend'] } }` shape for creatures whose
  // type is chosen at spawn time (e.g. Planar Incarnate). We return the first
  // candidate — v1 doesn't model the choice, and parsers downstream tolerate
  // an empty-string return. Future: extend monsterToCombatant to surface the
  // choice list as metadata.
  if (typeof type !== 'object' || type === null) return '';
  const inner = 'type' in type ? (type as { type?: unknown }).type : undefined;
  if (typeof inner === 'string') return inner.toLowerCase();
  if (Array.isArray(inner) && inner.length > 0 && typeof inner[0] === 'string') {
    return inner[0].toLowerCase();
  }
  if (inner && typeof inner === 'object' && 'choose' in inner) {
    const choose = (inner as { choose?: unknown }).choose;
    if (Array.isArray(choose) && choose.length > 0 && typeof choose[0] === 'string') {
      return String(choose[0]).toLowerCase();
    }
  }
  // Direct `choose` on the outer object (rare): `{ choose: ['celestial','fiend'] }`
  if ('choose' in type) {
    const choose = (type as { choose?: unknown }).choose;
    if (Array.isArray(choose) && choose.length > 0 && typeof choose[0] === 'string') {
      return String(choose[0]).toLowerCase();
    }
  }
  return '';
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
  // Session 53 Batch 4d: parse Death Burst trait (damage + save + conditions)
  const deathBurst = parseDeathBurst(raw.trait ?? []);
  // Session 52 Batch 4c/4e: trait-name flags (parsed once at spawn; engine
  // checks the flag rather than re-scanning the traits array each call).
  const attacksAreMagical = traits.some(t => /^Magic\s+Weapons$/i.test(t.trim()));
  const cannotRegainHP = traits.some(t => /^Swarm/i.test(t.trim()));
  // Session 53 Batch 4e-remaining: trait-name flags + small numeric traits.
  // Each is parsed once at spawn; engine consumption varies (see core.ts
  // doc comments for which are wired vs metadata-only).
  const sunlightSensitivity = traits.some(t => /^Sunlight\s+Sensitivity$/i.test(t.trim()));
  const avoidance = traits.some(t => /^Avoidance$/i.test(t.trim()));
  const ambusher = traits.some(t => /^Ambusher$/i.test(t.trim()));
  const brute = traits.some(t => /^Brute$/i.test(t.trim()));
  const falseAppearance = traits.some(t => /^False\s+Appearance$/i.test(t.trim()));
  // Session 60: False Appearance initiative-advantage variant — 27 of 83
  // False Appearance creatures have "advantage on its initiative roll" in the
  // trait text. The other 56 have the disguise-only variant (no init effect).
  // Check the trait TEXT (not just the name) for the "initiative" keyword.
  const falseAppearanceInitAdv = (raw.trait ?? []).some(t =>
    /^False\s+Appearance$/i.test((t.name || '').trim()) &&
    /initiative/i.test(flattenEntries(t.entries ?? []))
  );
  const siegeMonster = traits.some(t => /^Siege\s+Monster$/i.test(t.trim()));
  const waterBreathing = traits.some(t => /^Water\s+Breathing$/i.test(t.trim()));
  // Session 63 RFC-COMBINING-EFFECTS: Devil's Sight trait (MM: Imp, Barbed
  // Devil, Horned Devil, etc.). "Magical darkness doesn't impede the devil's
  // darkvision." Parsed as a boolean flag on senses; consumed by
  // isVisionBlocked() in los.ts to skip magical-darkness obstacles.
  const hasDevilsSight = traits.some(t => /^Devil'?s?\s+Sight$/i.test(t.trim()));
  // Session 53 Batch 4f: Superior Invisibility + Incorporeal Movement
  const superiorInvisibility = traits.some(t => /^Superior\s+Invisibility$/i.test(t.trim()));
  const incorporealMovement = traits.some(t => /^Incorporeal\s+Movement$/i.test(t.trim()));
  // Session 53 Batch 4g: Charge + Pounce (movement-triggered riders)
  const charge = parseCharge(raw.trait ?? []);
  const pounce = parsePounce(raw.trait ?? []);
  // Session 53 Batch 4h: Rejuvenation (metadata-only)
  const rejuvenation = parseRejuvenation(raw.trait ?? []);
  // Session 60 Batch 5b step 1: parse monster spellcasting (metadata-only)
  const monsterSpellcasting = parseMonsterSpellcasting(raw);
  // Session 60 Batch 5a: parse lair actions (metadata + basic engine hook)
  const lairActions = parseLairActions(raw);
  // Session 61 RFC-SHAPECHANGER Phase 1: parse Shapechanger trait
  const shapechangerForms = parseShapechanger(raw.trait ?? []);
  // Hold Breath: extract the minutes count from the entry text
  // ("can hold its breath for 1 hour" → 60 minutes; "for 30 minutes" → 30)
  let holdBreathMinutes: number | undefined;
  for (const t of raw.trait ?? []) {
    if (!/^Hold\s+Breath$/i.test(t.name)) continue;
    const text = flattenEntries(t.entries);
    const minMatch = text.match(/(\d+)\s*(?:minutes|minute)/i);
    const hrMatch = text.match(/(\d+)\s*(?:hours|hour)/i);
    if (minMatch) holdBreathMinutes = parseInt(minMatch[1], 10);
    else if (hrMatch) holdBreathMinutes = parseInt(hrMatch[1], 10) * 60;
    break;
  }

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
    attacksAreMagical,     // Session 52 Batch 4c: true for "Magic Weapons" trait (19 creatures)
    cannotRegainHP,        // Session 52 Batch 4e: true for "Swarm" trait (10 creatures)
    deathBurst,            // Session 53 Batch 4d: undefined for non-death-burst creatures
    sunlightSensitivity,   // Session 53 Batch 4e: true for Sunlight Sensitivity trait
    avoidance,             // Session 53 Batch 4e: true for Avoidance trait
    ambusher,              // Session 53 Batch 4e: true for Ambusher trait
    brute,                 // Session 53 Batch 4e: true for Brute trait
    falseAppearance,       // Session 53 Batch 4e: true for False Appearance trait
    falseAppearanceInitAdv, // Session 60: true only for the init-advantage variant
    siegeMonster,          // Session 53 Batch 4e: true for Siege Monster trait
    waterBreathing,        // Session 53 Batch 4e: true for Water Breathing trait
    holdBreathMinutes,     // Session 53 Batch 4e: N minutes (undefined if no Hold Breath trait)
    superiorInvisibility,  // Session 53 Batch 4f: true for Superior Invisibility trait
    incorporealMovement,   // Session 53 Batch 4f: true for Incorporeal Movement trait
    charge,                // Session 53 Batch 4g: undefined for non-Charge creatures
    pounce,                // Session 53 Batch 4g: undefined for non-Pounce creatures
    rejuvenation,          // Session 53 Batch 4h: undefined for non-Rejuvenation creatures
    monsterSpellcasting,   // Session 60 Batch 5b step 1: metadata-only (945 creatures)
    lairActions,           // Session 60 Batch 5a: metadata + engine hook (137 creatures)
    // Session 92 RFC-LAIRACTIONS Phase 2 [DD-1]: default `true` when lairActions
    // is defined. A dragon encountered outside its lair can be set to `false`
    // via scenario JSON, the character-builder toggle, or direct mutation.
    isInLair: lairActions ? true : undefined,
    shapechangerForms,     // Session 61 RFC-SHAPECHANGER Phase 1: 76 creatures
    _currentForm: shapechangerForms ? 'true' : undefined,  // scratch: starts in true form
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
    senses:                 (() => {
      const s = parseSenses(raw.senses, raw.passive);
      // Merge Devil's Sight trait flag into senses (Session 63).
      if (hasDevilsSight) {
        if (!s) return { devilsSight: true };
        return { ...s, devilsSight: true };
      }
      return s;
    })(),
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
    // ── Defensive guard: some bestiaryData JSON files are not monster
    // lists (e.g. legendarygroups.json has `legendaryGroup`, not
    // `monster`). Skip files that lack a valid monster array so loading
    // the full bestiary doesn't crash with "file.monster is not
    // iterable". Fixes the 5 creature_* test crashes.
    if (!file?.monster || !Array.isArray(file.monster)) continue;
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
