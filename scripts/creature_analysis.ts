// ============================================================
// scripts/creature_analysis.ts
//
// Creature Megabatch Analysis — scans every 5etools bestiary
// JSON in bestiaryData/, deduplicates byte-identical files,
// categorizes each unique creature (keyed by name+source) by
// which unimplemented mechanics it needs, and emits:
//
//   CREATURE-MEGABATCH-ANALYSIS.json   (repo root, overwritten)
//
// Mirrors the structure of MEGABATCH-ANALYSIS.json (the spells
// megabatch) so the project lead can plan a creature batch
// deployment analogous to the 124-spell migration.
//
// Run: npx ts-node --transpile-only scripts/creature_analysis.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ---- Paths --------------------------------------------------
// Note: this script lives at scripts/creature_analysis.ts (one level deep),
// so ROOT is one '..' up from __dirname. The spell-cache scripts live at
// scripts/spell-cache/*.ts (two levels deep) and use two '..'s.
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'bestiaryData');
const OUT_FILE = path.join(ROOT, 'CREATURE-MEGABATCH-ANALYSIS.json');

// ---- Types --------------------------------------------------

/** Minimal view of the 5etools bestiary file shape. */
interface BestiaryFile { monster: RawMonster[]; }

/** Minimal view of the 5etools monster entry — only fields we read. */
interface RawMonster {
  name: string;
  source: string;
  cr?: string | { cr: string; lair?: string; coven?: string; xp?: number };
  type?: string | { type: string; tags?: string[] };
  size?: string[] | string;
  immune?: DefenseEntry[];
  resist?: DefenseEntry[];
  vulnerable?: DefenseEntry[];
  conditionImmune?: string[];
  save?: Record<string, string>;
  skill?: Record<string, string>;
  senses?: string[];
  passive?: number;
  spellcasting?: SpellcastingBlock[];
  legendary?: RawNamedEntry[];
  legendaryGroup?: { name: string; source: string };
  lairActions?: unknown[];   // not present on MM entries (separate lair files), but spec wants the check
  lair?: unknown;
  trait?: RawNamedEntry[];
  action?: RawNamedEntry[];
}

interface RawNamedEntry { name: string; entries?: (string | object)[]; }
interface SpellcastingBlock {
  ability?: string;
  headerEntries?: string[];
  spells?: Record<string, { slots?: number; spells?: string[] }>;
  will?: string[];
  daily?: Record<string, string[]>;
  weekly?: Record<string, string[]>;
  yearly?: Record<string, string[]>;
  [k: string]: unknown;
}

/** A defense entry can be:
 *   - a plain string: "fire"
 *   - an object with an inner array under the same key:
 *       { immune: ["bludgeoning","piercing","slashing"], note: "...", cond: true }
 *   - an object with `special`: { special: "damage from spells" }
 */
type DefenseEntry = string | { [k: string]: unknown };

// ---- Output schema types -----------------------------------

type Priority = 'HIGH' | 'MED' | 'LOW';

interface CreatureAnalysis {
  name: string;
  source: string;
  cr: string;             // raw CR string (e.g. "1/4", "17", or "" if missing)
  crNum: number | null;   // numeric CR (for sorting / mirror selection)
  type: string;
  size: string;
  patterns: string[];
  blocked_reasons: string[];
  mirror_creature: string | null;
  mechanical_summary: string;
  priority: Priority;
  special_notes: string | null;
}

interface Summary {
  unique_creature_count: number;
  duplicate_file_count: number;
  genuine_reprint_count: number;
  by_source: Record<string, number>;
  by_pattern: Record<string, number>;
  by_priority: Record<Priority, number>;
  trait_frequency: [string, number][];
  reprint_list: { name: string; sources: string[] }[];
  pattern_mirrors: Record<string, string>;
  unknown_traits: [string, number][];
  unparseable_shape_warnings: number;
  files_scanned: { file: string; hash: string; duplicate_of: string | null; monster_count: number }[];
}

// ---- Pattern constants -------------------------------------

// Maps a normalized trait name → pattern key. Names are matched
// exactly (after stripping parentheticals + recharge tags + trim).
const TRAIT_TO_PATTERN: Record<string, string> = {
  'Magic Resistance':       'TRAIT_MAGIC_RESISTANCE',
  'Sunlight Sensitivity':   'TRAIT_SUNLIGHT_SENSITIVITY',
  'Regeneration':           'TRAIT_REGENERATION',
  'Death Burst':            'TRAIT_DEATH_BURST',
  "Devil's Sight":          'TRAIT_DEVILS_SIGHT',
  'Blood Frenzy':           'TRAIT_BLOOD_FRENZY',
  'Incorporeal Movement':   'TRAIT_INCORPOREAL_MOVEMENT',
  'False Appearance':       'TRAIT_FALSE_APPEARANCE',
  'Spider Climb':           'TRAIT_SPIDER_CLIMB',
  'Amphibious':             'TRAIT_AMPHIBIOUS',
  'Keen Sight':             'TRAIT_KEEN_SENSES',
  'Keen Smell':             'TRAIT_KEEN_SENSES',
  'Keen Hearing':           'TRAIT_KEEN_SENSES',
  'Keen Hearing and Smell': 'TRAIT_KEEN_SENSES',
  'Keen Sight and Smell':   'TRAIT_KEEN_SENSES',
  'Charge':                 'TRAIT_CHARGE',
  'Pounce':                 'TRAIT_POUNCE',
  'Swarm':                  'TRAIT_SWARM',
  'Siege Monster':          'TRAIT_SIEGE_MONSTER',
  'Magic Weapons':          'TRAIT_MAGIC_WEAPONS',
  'Avoidance':              'TRAIT_AVOIDANCE',
  'Hold Breath':            'TRAIT_HOLD_BREATH',
  'Water Breathing':        'TRAIT_WATER_BREATHING',
  'Shapechanger':           'TRAIT_SHAPECHANGER',
  'Superior Invisibility':  'TRAIT_SUPERIOR_INVISIBILITY',
  'Rejuvenation':           'TRAIT_REJUVENATION',
  'Stone Camouflage':       'TRAIT_STONE_CAMOUFLAGE',
  'Standing Leap':          'TRAIT_STANDING_LEAP',
  'Echolocation':           'TRAIT_ECHOLOCATION',
  'Web Walker':             'TRAIT_WEB_WALKER',
  'Limited Telepathy':      'TRAIT_LIMITED_TELEPATHY',
  'The Colors of Age':      'TRAIT_THE_COLORS_OF_AGE',
};

// Priority lookup for each pattern.
const HIGH_PATTERNS = new Set<string>([
  'DEFENSE_IMMUNE',
  'DEFENSE_RESIST',
  'DEFENSE_VULNERABLE',
  'DEFENSE_CONDITION_IMMUNE',
  'LEGENDARY_RESISTANCE_TRAIT',
  'RECHARGE',
  'TRAIT_MAGIC_RESISTANCE',
  'TRAIT_REGENERATION',
  'TRAIT_DEVILS_SIGHT',
  'TRAIT_SHAPECHANGER',
]);

const MED_PATTERNS = new Set<string>([
  'SPELLCASTER',
  'LEGENDARY',
  'TRAIT_DEATH_BURST',
  'TRAIT_BLOOD_FRENZY',
  'TRAIT_INCORPOREAL_MOVEMENT',
  'TRAIT_CHARGE',
  'TRAIT_POUNCE',
  'TRAIT_SWARM',
  'TRAIT_MAGIC_WEAPONS',
  'TRAIT_AVOIDANCE',
  'TRAIT_REJUVENATION',
  'TRAIT_SUPERIOR_INVISIBILITY',
  'TRAIT_ECHOLOCATION',
  'SAVE_PROFICIENCY',
]);

// LOW patterns (everything else — senses, flavor traits, SKILL_PROFICIENCY).
// Default priority if no patterns at all is also LOW.

// ---- Helpers ------------------------------------------------

/** Parse a 5etools CR value (string OR object form) into a number. */
function parseCR(cr: RawMonster['cr']): number | null {
  if (cr === undefined || cr === null) return null;
  const raw = typeof cr === 'string' ? cr : cr.cr;
  if (raw === undefined || raw === null) return null;
  if (raw === '1/8') return 0.125;
  if (raw === '1/4') return 0.25;
  if (raw === '1/2') return 0.5;
  const n = parseFloat(raw);
  return isNaN(n) ? null : n;
}

/** Render a CR value back to the canonical string for display. */
function crToString(cr: RawMonster['cr']): string {
  if (cr === undefined || cr === null) return '';
  const raw = typeof cr === 'string' ? cr : cr.cr;
  return raw ?? '';
}

/** Extract the creature type as a lowercase string. */
function typeString(t: RawMonster['type']): string {
  if (!t) return '';
  if (typeof t === 'string') return t.toLowerCase();
  return (t.type ?? '').toLowerCase();
}

/** Map 5etools size code → display name. */
function sizeString(s: RawMonster['size']): string {
  const code = Array.isArray(s) ? s[0] : s;
  if (!code) return 'Medium';
  const map: Record<string, string> = {
    T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan',
  };
  return map[code.toUpperCase()] ?? 'Medium';
}

/**
 * Determine if a defense-list field is "present and non-empty",
 * handling both the string-array and object-with-inner-array shapes.
 *
 * `fieldKey` is the name of the outer field (e.g. "immune") so we can
 * find the inner array on object entries that use the same key.
 *
 * Returns: { present: boolean, unparseable: boolean }
 *  - present=true if any meaningful entry is found
 *  - unparseable=true if an entry shape we don't recognize is encountered
 *    (so the caller can increment a warning counter)
 */
function defenseFieldPresent(
  field: DefenseEntry[] | undefined,
  fieldKey: string,
): { present: boolean; unparseable: boolean } {
  if (!field || !Array.isArray(field) || field.length === 0) {
    return { present: false, unparseable: false };
  }
  let present = false;
  let unparseable = false;
  for (const entry of field) {
    if (typeof entry === 'string') {
      present = true;
    } else if (entry && typeof entry === 'object') {
      // Object forms observed in MM data:
      //   { immune: ["bludgeoning","piercing","slashing"], note:"...", cond:true }
      //   { resist: [...], note:"...", cond:true }
      //   { vulnerable: [...], note:"...", cond:true }
      //   { special: "damage from spells" }
      const innerArr = (entry as Record<string, unknown>)[fieldKey];
      if (Array.isArray(innerArr)) {
        present = true;
      } else if ('special' in (entry as Record<string, unknown>)) {
        // {special:"..."} — counts as a defense (we can't enumerate types, but
        // the field is non-empty).
        present = true;
      } else {
        // Unknown object shape — flag it.
        unparseable = true;
      }
    } else {
      unparseable = true;
    }
  }
  return { present, unparseable };
}

/** Strip a trailing parenthetical (e.g. "Legendary Resistance (3/Day)" → "Legendary Resistance"). */
function normalizeTraitName(name: string): string {
  // Strip parenthetical groups (non-nested only — sufficient for 5etools trait names).
  let s = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  // Strip 5etools recharge tags that occasionally leak into trait names.
  s = s.replace(/\s*\{@recharge[^}]*\}\s*/g, ' ').trim();
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Detect a {@recharge N} or {@recharge} tag in an action name. Returns the recharge number (default 6) or null. */
function detectRecharge(name: string): number | null {
  const m = name.match(/\{@recharge(?:\s+(\d+))?\}/);
  if (!m) return null;
  return m[1] ? parseInt(m[1], 10) : 6;
}

/** Strip the recharge tag from an action name for display. */
function stripRecharge(name: string): string {
  return name.replace(/\s*\{@recharge[^}]*\}\s*/g, ' ').trim();
}

/** Sort patterns so the highest-priority pattern appears first (for mirror selection). */
function sortPatterns(patterns: string[]): string[] {
  const rank = (p: string): number => {
    if (HIGH_PATTERNS.has(p)) return 0;
    if (MED_PATTERNS.has(p)) return 1;
    return 2;
  };
  return [...patterns].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

/** Determine the highest priority among a creature's patterns. */
function priorityFor(patterns: string[]): Priority {
  if (patterns.some(p => HIGH_PATTERNS.has(p))) return 'HIGH';
  if (patterns.some(p => MED_PATTERNS.has(p))) return 'MED';
  return 'LOW';
}

/** Hash file contents with sha256 (returns hex). */
function hashFile(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Convert an array of [name,count] into a sorted-by-count-desc array (stable on ties via name asc). */
function sortFrequency(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
}

// ---- Per-creature analysis ---------------------------------

function analyzeMonster(m: RawMonster): {
  patterns: string[];
  blocked_reasons: string[];
  special_notes: string | null;
  unparseable: boolean;
} {
  const patterns = new Set<string>();
  const blocked: string[] = [];
  const notes: string[] = [];
  let unparseable = false;

  // --- Defense patterns -------------------------------------
  const defenseChecks: Array<[DefenseEntry[] | undefined, string]> = [
    [m.immune,         'immune'],
    [m.resist,         'resist'],
    [m.vulnerable,     'vulnerable'],
  ];
  for (const [field, key] of defenseChecks) {
    const r = defenseFieldPresent(field, key);
    if (r.present) {
      const pattern = key === 'immune' ? 'DEFENSE_IMMUNE'
        : key === 'resist' ? 'DEFENSE_RESIST'
        : key === 'vulnerable' ? 'DEFENSE_VULNERABLE'
        : null;
      if (pattern) patterns.add(pattern);
    }
    if (r.unparseable) unparseable = true;
  }
  // conditionImmune is always a string[] (we verified this), but be defensive.
  if (Array.isArray(m.conditionImmune) && m.conditionImmune.length > 0) {
    patterns.add('DEFENSE_CONDITION_IMMUNE');
  }

  // --- Spellcasting pattern ---------------------------------
  if (Array.isArray(m.spellcasting) && m.spellcasting.length > 0) {
    patterns.add('SPELLCASTER');
    const sc = m.spellcasting[0];
    const hasFullList = !!sc.spells || !!sc.will || !!sc.daily || !!sc.weekly || !!sc.yearly;
    if (hasFullList) {
      blocked.push('monster spellcasting lists require SPELL_DB wiring + planner integration (Batch 5 — deferred)');
      if (sc.spells) notes.push('has full leveled spell list');
      else if (sc.will) notes.push('at-will (will) spell list');
      else if (sc.daily) notes.push('per-day (daily) spell list');
    } else {
      // Header-only — note but not strictly blocked (engine still doesn't process it).
      notes.push('spellcasting header only (no parsed spell list)');
    }
  }

  // --- Legendary ACTIONS pattern ----------------------------
  if (Array.isArray(m.legendary) && m.legendary.length > 0) {
    patterns.add('LEGENDARY');
    // Already wired via legendary action pool — no blocked_reason.
  }

  // --- Legendary RESISTANCE trait pattern -------------------
  if (Array.isArray(m.trait)) {
    for (const t of m.trait) {
      const base = normalizeTraitName(t.name);
      if (/^Legendary Resistance$/i.test(base)) {
        patterns.add('LEGENDARY_RESISTANCE_TRAIT');
        blocked.push('auto-success-on-failed-save not yet wired (Batch 4)');
        break;
      }
    }
  }

  // --- Recharge pattern -------------------------------------
  if (Array.isArray(m.action)) {
    const rechargers: string[] = [];
    for (const a of m.action) {
      if (detectRecharge(a.name) !== null) {
        rechargers.push(stripRecharge(a.name));
      }
    }
    if (rechargers.length > 0) {
      patterns.add('RECHARGE');
      blocked.push('Action.recharge field not yet on type; per-combat recharge tracking needed (Batch 3)');
      notes.push(`recharge actions: ${rechargers.join(', ')}`);
    }
  }

  // --- Lair pattern -----------------------------------------
  // Per spec: check lairActions array, lair field, AND legendaryGroup reference.
  // (MM data has 0 entries with lairActions/lair directly; the legendaryGroup
  //  field points to a separate lair-actions file we don't have, so it's the
  //  useful signal.)
  const hasLairField = !!m.lairActions || !!m.lair;
  const hasLairGroup = !!m.legendaryGroup;
  if (hasLairField || hasLairGroup) {
    patterns.add('LAIR');
    blocked.push('lair actions require an initiative-order engine hook (Batch 5 — deferred)');
    if (hasLairGroup && !hasLairField) {
      notes.push(`lair actions referenced via legendaryGroup (${m.legendaryGroup!.name}, ${m.legendaryGroup!.source}) — lair file not in bestiaryData`);
    } else if (hasLairField) {
      notes.push('lair actions present on creature entry');
    }
  }

  // --- Named-trait patterns ---------------------------------
  const unknownTraitNames: string[] = [];
  if (Array.isArray(m.trait)) {
    for (const t of m.trait) {
      const base = normalizeTraitName(t.name);
      // Legendary Resistance handled above — skip here.
      if (/^Legendary Resistance$/i.test(base)) continue;
      const mapped = TRAIT_TO_PATTERN[base];
      if (mapped) {
        patterns.add(mapped);
        // Per-trait blocked reasons:
        if (mapped === 'TRAIT_SHAPECHANGER') {
          blocked.push('polymorph/shapechanger mechanic deferred (Batch 5)');
        } else if (mapped === 'TRAIT_REGENERATION') {
          blocked.push('start-of-turn HP regen hook needed (Batch 4)');
        }
      } else {
        // Unknown trait → bucket into TRAIT_OTHER, track name globally.
        patterns.add('TRAIT_OTHER');
        unknownTraitNames.push(base);
      }
    }
    if (unknownTraitNames.length > 0) {
      notes.push(`unknown traits: ${unknownTraitNames.join(', ')}`);
    }
  }

  // --- Senses patterns --------------------------------------
  if (Array.isArray(m.senses) && m.senses.length > 0) {
    const text = m.senses.join(' ').toLowerCase();
    const sensesFound: string[] = [];
    if (text.includes('darkvision'))  { patterns.add('SENSES_DARKVISION');  sensesFound.push('darkvision'); }
    if (text.includes('blindsight'))  { patterns.add('SENSES_BLINDSIGHT');  sensesFound.push('blindsight'); }
    if (text.includes('truesight'))   { patterns.add('SENSES_TRUESIGHT');   sensesFound.push('truesight'); }
    if (text.includes('tremorsense')) { patterns.add('SENSES_TREMORSENSE'); sensesFound.push('tremorsense'); }
    if (sensesFound.length > 0) {
      blocked.push('requires LOS engine changes (TG-007)');
      notes.push(`senses: ${sensesFound.join(', ')}`);
    }
  }

  // --- Save / skill proficiency patterns --------------------
  if (m.save && typeof m.save === 'object' && Object.keys(m.save).length > 0) {
    patterns.add('SAVE_PROFICIENCY');
    // Infra exists/being-built (Batch 2) — leave blocked empty; note batch in special_notes.
    notes.push(`save proficiencies: ${Object.keys(m.save).join(', ')} (Batch 2)`);
  }
  if (m.skill && typeof m.skill === 'object' && Object.keys(m.skill).length > 0) {
    patterns.add('SKILL_PROFICIENCY');
    notes.push(`skill proficiencies: ${Object.keys(m.skill).join(', ')}`);
  }

  return {
    patterns: sortPatterns([...patterns]),
    blocked_reasons: [...new Set(blocked)],   // dedupe (a creature may have multiple senses)
    special_notes: notes.length > 0 ? notes.join('; ') : null,
    unparseable,
  };
}

/** Build the one-line mechanical summary. */
function buildSummary(m: RawMonster, patterns: string[]): string {
  const parts: string[] = [];
  parts.push(sizeString(m.size));
  parts.push(typeString(m.type) || 'creature');
  parts.push(`CR ${crToString(m.cr) || '?'}`);

  const tagParts: string[] = [];
  if (patterns.includes('DEFENSE_IMMUNE'))          tagParts.push('immune');
  if (patterns.includes('DEFENSE_RESIST'))          tagParts.push('resistant');
  if (patterns.includes('DEFENSE_VULNERABLE'))      tagParts.push('vulnerable');
  if (patterns.includes('DEFENSE_CONDITION_IMMUNE'))tagParts.push('cond-immune');
  if (patterns.includes('LEGENDARY'))               tagParts.push('legendary actions');
  if (patterns.includes('LEGENDARY_RESISTANCE_TRAIT')) tagParts.push('legendary resistance');
  if (patterns.includes('RECHARGE'))                tagParts.push('recharge attacks');
  if (patterns.includes('LAIR'))                    tagParts.push('lair');
  if (patterns.includes('SPELLCASTER'))             tagParts.push('spellcaster');
  if (patterns.includes('TRAIT_MAGIC_RESISTANCE')) tagParts.push('magic resistance');
  if (patterns.includes('TRAIT_REGENERATION'))     tagParts.push('regeneration');
  if (patterns.includes('TRAIT_SHAPECHANGER'))     tagParts.push('shapechanger');
  if (tagParts.length > 0) parts.push(`[${tagParts.join(', ')}]`);
  return parts.join(' ');
}

// ---- Main ---------------------------------------------------

function main(): void {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`[creature-analysis] bestiaryData/ not found at ${DATA_DIR}`);
    process.exit(1);
  }

  // 1. List and hash every .json file in bestiaryData/.
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.error('[creature-analysis] no .json files in bestiaryData/');
    process.exit(1);
  }

  type FileRec = { file: string; hash: string; duplicate_of: string | null; monster_count: number; data: BestiaryFile };
  const fileRecs: FileRec[] = [];
  const hashToFirst: Record<string, string> = {};   // hash → first filename with that hash
  let duplicateFileCount = 0;

  for (const fname of files) {
    const abs = path.join(DATA_DIR, fname);
    const hash = hashFile(abs);
    let duplicate_of: string | null = null;
    if (hashToFirst[hash]) {
      duplicate_of = hashToFirst[hash];
      duplicateFileCount++;
    } else {
      hashToFirst[hash] = fname;
    }
    let data: BestiaryFile;
    try {
      data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      console.error(`[creature_analysis] could not parse ${fname}: ${(e as Error).message}`);
      continue;
    }
    const monster_count = Array.isArray(data.monster) ? data.monster.length : 0;
    fileRecs.push({ file: fname, hash, duplicate_of, monster_count, data });
  }

  // 2. From NON-duplicate files, collect all monster entries.
  //    Deduplicate by (name, source). Track which (file, source) combos we saw
  //    so we can compute genuine reprints (same name, different source).
  const seen = new Map<string, { m: RawMonster; file: string }>();   // key: name|source → entry
  const nameToSources = new Map<string, Set<string>>();               // name → set of distinct sources
  const uniqueMonsters: { m: RawMonster; file: string }[] = [];

  for (const rec of fileRecs) {
    if (rec.duplicate_of) continue;   // skip byte-identical duplicate files entirely
    if (!Array.isArray(rec.data.monster)) continue;
    for (const m of rec.data.monster) {
      if (!m || !m.name || !m.source) continue;
      const key = `${m.name}|${m.source}`;
      if (seen.has(key)) continue;   // same (name,source) already collected — skip silently
      seen.set(key, { m, file: rec.file });
      uniqueMonsters.push({ m, file: rec.file });

      // Track name → sources for genuine-reprint detection.
      if (!nameToSources.has(m.name)) nameToSources.set(m.name, new Set());
      nameToSources.get(m.name)!.add(m.source);
    }
  }

  // 3. Build the reprint_list: names appearing with ≥2 distinct sources.
  const reprintList: { name: string; sources: string[] }[] = [];
  for (const [name, srcs] of nameToSources) {
    if (srcs.size >= 2) {
      reprintList.push({ name, sources: [...srcs].sort() });
    }
  }
  reprintList.sort((a, b) => a.name.localeCompare(b.name));

  // 4. Analyze each unique creature.
  const creatures: CreatureAnalysis[] = [];
  const bySource: Record<string, number> = {};
  const byPattern: Record<string, number> = {};
  const byPriority: Record<Priority, number> = { HIGH: 0, MED: 0, LOW: 0 };
  const traitFreqAll = new Map<string, number>();       // ALL trait base names (for trait_frequency)
  const unknownTraitFreq = new Map<string, number>();    // traits that fell into TRAIT_OTHER
  let unparseableWarnings = 0;

  // For mirror selection: for each pattern, find the lowest-CR creature having it.
  // (Treat null CR as Infinity so it never wins min-CR.)
  const patternBestMirror = new Map<string, { crNum: number; name: string; source: string }>();

  for (const { m } of uniqueMonsters) {
    const a = analyzeMonster(m);

    // Update unknown-trait frequency map.
    if (a.special_notes) {
      const um = a.special_notes.match(/unknown traits: ([^;]+)/);
      if (um) {
        for (const tn of um[1].split(',').map(s => s.trim())) {
          unknownTraitFreq.set(tn, (unknownTraitFreq.get(tn) ?? 0) + 1);
        }
      }
    }

    // Update ALL-trait frequency map (every trait base name across the creature).
    if (Array.isArray(m.trait)) {
      for (const t of m.trait) {
        const base = normalizeTraitName(t.name);
        if (!base) continue;
        traitFreqAll.set(base, (traitFreqAll.get(base) ?? 0) + 1);
        // If it wasn't mapped to a known pattern, it's also in unknown_traits.
        if (!TRAIT_TO_PATTERN[base] && !/^Legendary Resistance$/i.test(base)) {
          // already counted in unknownTraitFreq above; no-op here
        }
      }
    }

    if (a.unparseable) unparseableWarnings++;

    const priority = priorityFor(a.patterns);
    const crNum = parseCR(m.cr);

    // Update by_source / by_pattern / by_priority counters.
    bySource[m.source] = (bySource[m.source] ?? 0) + 1;
    for (const p of a.patterns) {
      byPattern[p] = (byPattern[p] ?? 0) + 1;
    }
    byPriority[priority]++;

    // Update pattern → lowest-CR mirror.
    for (const p of a.patterns) {
      const cur = patternBestMirror.get(p);
      const candidateCr = crNum ?? Infinity;
      if (!cur || candidateCr < cur.crNum
          || (candidateCr === cur.crNum && m.name.localeCompare(cur.name) < 0)) {
        patternBestMirror.set(p, { crNum: candidateCr, name: m.name, source: m.source });
      }
    }

    // Mirror creature for THIS creature is assigned in a SECOND pass below,
    // AFTER the full patternBestMirror map is finalized. Storing the
    // highest-priority pattern here lets the second pass look it up cheaply.
    creatures.push({
      name: m.name,
      source: m.source,
      cr: crToString(m.cr),
      crNum,   // kept in-memory for sorting/mirror selection; stripped from JSON output below
      type: typeString(m.type),
      size: sizeString(m.size),
      patterns: a.patterns,
      blocked_reasons: a.blocked_reasons,
      mirror_creature: null,   // assigned in second pass
      mechanical_summary: buildSummary(m, a.patterns),
      priority,
      special_notes: a.special_notes,
    });
  }

  // 5a. Second pass — assign mirror_creature now that patternBestMirror is final.
  //     (First-pass assignment was wrong because patternBestMirror was being
  //      updated mid-iteration — early-alphabetical creatures would see an
  //      incomplete map and pick a non-minimal mirror.)
  for (const c of creatures) {
    if (c.patterns.length > 0) {
      const top = c.patterns[0];
      const bm = patternBestMirror.get(top);
      if (bm) c.mirror_creature = `${bm.name} (${bm.source})`;
    }
  }

  // 5. Sort creatures: priority HIGH→MED→LOW, then CR desc, then name asc.
  const priorityRank: Record<Priority, number> = { HIGH: 0, MED: 1, LOW: 2 };
  creatures.sort((a, b) => {
    if (priorityRank[a.priority] !== priorityRank[b.priority]) {
      return priorityRank[a.priority] - priorityRank[b.priority];
    }
    const aCr = a.crNum ?? -Infinity;
    const bCr = b.crNum ?? -Infinity;
    if (aCr !== bCr) return bCr - aCr;   // CR desc
    return a.name.localeCompare(b.name);
  });

  // 6. Build pattern_mirrors map (pattern → "name (source)").
  const patternMirrors: Record<string, string> = {};
  for (const [p, bm] of patternBestMirror) {
    patternMirrors[p] = `${bm.name} (${bm.source})`;
  }

  // 7. Assemble summary.
  const summary: Summary = {
    unique_creature_count: uniqueMonsters.length,
    duplicate_file_count: duplicateFileCount,
    genuine_reprint_count: reprintList.length,
    by_source: bySource,
    by_pattern: byPattern,
    by_priority: byPriority,
    trait_frequency: sortFrequency(traitFreqAll).slice(0, 30),
    reprint_list: reprintList,
    pattern_mirrors: patternMirrors,
    unknown_traits: sortFrequency(unknownTraitFreq),
    unparseable_shape_warnings: unparseableWarnings,
    files_scanned: fileRecs.map(r => ({
      file: r.file,
      hash: r.hash.slice(0, 16),
      duplicate_of: r.duplicate_of,
      monster_count: r.monster_count,
    })),
  };

  // 8. Write JSON (overwrite if exists).
  //    Strip the `crNum` helper field (kept in-memory for sorting/mirror
  //    selection) so the JSON matches the spec schema exactly.
  const creaturesOut = creatures.map(c => ({
    name: c.name,
    source: c.source,
    cr: c.cr,
    type: c.type,
    size: c.size,
    patterns: c.patterns,
    blocked_reasons: c.blocked_reasons,
    mirror_creature: c.mirror_creature,
    mechanical_summary: c.mechanical_summary,
    priority: c.priority,
    special_notes: c.special_notes,
  }));
  const out = {
    total_analyzed: uniqueMonsters.length,
    summary,
    creatures: creaturesOut,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');

  // 9. Print human-readable summary to stdout.
  console.log('='.repeat(72));
  console.log('CREATURE MEGABATCH ANALYSIS');
  console.log('='.repeat(72));
  console.log(`Files scanned:        ${fileRecs.length}`);
  console.log(`  duplicates skipped: ${duplicateFileCount}`);
  for (const r of fileRecs) {
    const tag = r.duplicate_of ? `  (DUPLICATE of ${r.duplicate_of})` : '';
    console.log(`  - ${r.file}  hash=${r.hash.slice(0, 16)}…  monsters=${r.monster_count}${tag}`);
  }
  console.log('');
  console.log(`Unique creatures:     ${summary.unique_creature_count}`);
  console.log(`Genuine reprints:     ${summary.genuine_reprint_count}`);
  console.log(`Unparseable shapes:   ${summary.unparseable_shape_warnings} (warning count)`);
  console.log('');
  console.log('--- By source ---');
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src.padEnd(10)} ${n}`);
  }
  console.log('');
  console.log('--- By priority ---');
  console.log(`  HIGH  ${byPriority.HIGH}`);
  console.log(`  MED   ${byPriority.MED}`);
  console.log(`  LOW   ${byPriority.LOW}`);
  console.log('');
  console.log('--- By pattern ---');
  for (const [p, n] of Object.entries(byPattern).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(36)} ${n}`);
  }
  console.log('');
  console.log('--- Top 30 traits (all base names) ---');
  for (const [t, n] of summary.trait_frequency) {
    console.log(`  ${String(n).padStart(4)}  ${t}`);
  }
  console.log('');
  console.log('--- Unknown traits (TRAIT_OTHER bucket, sorted by frequency) ---');
  const ut = summary.unknown_traits;
  if (ut.length === 0) {
    console.log('  (none — every trait mapped to a known pattern)');
  } else {
    for (const [t, n] of ut) {
      console.log(`  ${String(n).padStart(4)}  ${t}`);
    }
  }
  console.log('');
  console.log('--- Pattern mirrors (lowest-CR creature per pattern) ---');
  for (const [p, label] of Object.entries(patternMirrors).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${p.padEnd(36)} ${label}`);
  }
  console.log('');
  console.log('--- Reprint list (same name, different sources) ---');
  if (reprintList.length === 0) {
    console.log('  (none — no genuine cross-sourcebook reprints in current data)');
  } else {
    for (const r of reprintList) {
      console.log(`  ${r.name}: ${r.sources.join(', ')}`);
    }
  }
  console.log('');
  console.log(`First 5 creatures (highest priority, highest CR):`);
  for (const c of creatures.slice(0, 5)) {
    console.log(`  [${c.priority}] CR ${c.cr || '?'}  ${c.name} (${c.source})`);
    console.log(`        patterns: ${c.patterns.join(', ')}`);
    console.log(`        summary:  ${c.mechanical_summary}`);
    if (c.blocked_reasons.length) {
      console.log(`        blocked:  ${c.blocked_reasons.join(' | ')}`);
    }
  }
  console.log('');
  console.log(`Wrote ${OUT_FILE}`);
}

main();
