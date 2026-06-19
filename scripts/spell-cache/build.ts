// ============================================================
// scripts/spell-cache/build.ts
//
// Regenerate the spell cache from testDataSpells/*.json + src/spells/*.ts.
//
// Why: the raw 5etools JSONs total 2.2MB across 17 files (spells-phb.json
// alone is 637KB). Re-parsing them every time an agent wants to ask
// "which cantrips are left to implement?" is wasteful and gives no progress
// tracking. This script precomputes a lean per-level cache with an
// auto-derived `implemented` flag (scanned from src/spells/*.ts), so the
// flag can never drift from reality.
//
// Output:
//   spell-cache/level-{0..9}.json  — per-level cache (sorted by name, source)
//   spell-cache/INDEX.md           — dashboard with per-level counts
//
// Run: npm run spell-cache:build
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'testDataSpells');
const SPELLS_DIR = path.join(ROOT, 'src', 'spells');
const OUT_DIR = path.join(ROOT, 'spell-cache');

// ---- 5etools school code → full name ------------------------
const SCHOOL_MAP: Record<string, string> = {
  A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment',
  I: 'Illusion',   N: 'Necromancy',  T: 'Transmutation', V: 'Evocation',
};

// ---- Sourcebook publication dates (ISO; used for reprint precedence) ----
// PROJECT SCOPE RULE (per user): canon material published PRE-2024 is in scope.
// Reprints within the in-scope corpus follow "NEWER HAS PRECEDENCE" — when the
// same spell appears in PHB (2014) and TCE (2020), the TCE version is canonical.
// Sources published 2024+ (the revised core books: XPHB, and future XMM/XDMG)
// are OUT OF SCOPE and never override pre-2024 content.
//
// Dates are WotC street dates. A few lesser sources are best-effort (marked ~);
// the ordering among them rarely matters since they have 1–19 spells each and
// overlap is minimal. Edit this map freely as dates are confirmed.
const SOURCE_DATES: Record<string, string> = {
  'PHB':        '2014-08-19',  // Player's Handbook
  'XGE':        '2017-11-21',  // Xanathar's Guide to Everything
  'LLK':        '2018-06-08',  // Lost Laboratory of Kwalish  (~)
  'GGR':        '2018-11-20',  // Guildmasters' Guide to Ravnica
  'AI':         '2019-07-16',  // Acquisitions Incorporated
  'EGW':        '2020-03-17',  // Explorer's Guide to Wildemount
  'EFA':        '2020-07-01',  // (~ uncertain; pre-2024)
  'IDRotF':     '2020-09-15',  // Icewind Dale: Rime of the Frostmaiden
  'TCE':        '2020-11-17',  // Tasha's Cauldron of Everything
  'AitFR-AVT':  '2021-07-08',  // Adventures in the Forgotten Realms (MtG)
  'FTD':        '2021-10-26',  // Fizban's Treasury of Dragons
  'SCC':        '2021-12-07',  // Strixhaven: A Curriculum of Chaos
  'AAG':        '2022-08-16',  // Astral Adventurer's Guide (Spelljammer)
  'SatO':       '2022-09-01',  // (~ uncertain; pre-2024)
  'FRHoF':      '2022-11-01',  // (~ uncertain; pre-2024)
  'BMT':        '2023-11-07',  // The Book of Many Things
  'XPHB':       '2024-09-03',  // 2024 Player's Handbook (revised) — OUT OF SCOPE
};

// Sources that are OUT OF SCOPE (2024+ revised core books). Spells that exist
// ONLY in these sources have inScope=false and are excluded from the picker by
// default. Add 'XMM' / 'XDMG' here when those 2024 books are added to testDataSpells.
const OUT_OF_SCOPE_SOURCES: Set<string> = new Set(['XPHB']);

function sourceDate(code: string): string {
  return SOURCE_DATES[code] ?? '1970-01-01'; // unknown → treated as oldest (safe default)
}
function isOutOfScope(code: string): boolean {
  return OUT_OF_SCOPE_SOURCES.has(code);
}

// ---- Types --------------------------------------------------
interface RawSpell {
  name: string;
  source: string;
  page?: number;
  level?: number;
  school?: string;
  time?: { number: number; unit: string }[];
  range?: { type?: string; distance?: { type?: string; amount?: number } };
  components?: { v?: boolean; s?: boolean; m?: string | { text?: string } };
  duration?: { type: string; amount?: number; unit?: string }[];
  entries?: string[];
  scalingLevelDice?: unknown;
  damageInflict?: string[];
  savingThrow?: string[];
  spellAttack?: string[];
  miscTags?: string[];
}

interface SourceRef {
  code: string;              // sourcebook code, e.g. 'PHB', 'TCE', 'XPHB'
  date: string;              // ISO publication date (from SOURCE_DATES)
  inScope: boolean;          // false for 2024+ revised core books (XPHB, …)
}

interface CachedSpell {
  name: string;
  source: string;            // CANONICAL source = newest in-scope source (per project precedence rule)
  sourceDate: string;        // ISO date of the canonical source
  sourceFile: string;        // testDataSpells/<file> for the canonical source
  page: number | null;       // page in the canonical source
  level: number;
  school: string;            // full name
  implemented: boolean;
  implementedModule: string | null;
  inScope: boolean;          // true if ≥1 pre-2024 source exists (false = XPHB-only)
  otherSources: SourceRef[]; // every other source (older in-scope + any out-of-scope), newest-first
  classes: string[];         // from sources.json (best-effort)
  effect: string;            // one-line summary
  meta: {
    time: string;
    range: string;
    duration: string;
    save: string | null;
    attack: string | null;   // 'ranged' | 'melee' | null
    damage: string[];        // e.g. ['1d6 acid']
    scales: boolean;         // cantrip scaling
  };
}

// ---- Helpers ------------------------------------------------

function titleCaseFromFilename(file: string): string {
  const base = path.basename(file, '.ts');
  return base
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Extract the spell name from a spell module's `metadata` const. */
function moduleNameFromFile(file: string): string | null {
  try {
    const src = fs.readFileSync(file, 'utf8');
    // Match name: "..." or name: '...' — allow apostrophes inside double-
    // quoted strings (e.g. "Melf's Acid Arrow") and double quotes inside
    // single-quoted strings. The original regex `[^'"]+` stopped at the
    // first apostrophe, breaking apostrophe-containing names. Session 17 fix.
    const m = src.match(/export\s+const\s+metadata\s*=\s*\{[\s\S]*?name:\s*("([^"]*)"|'([^']*)')/);
    if (m) return m[2] ?? m[3];
  } catch { /* ignore */ }
  return null;
}

/** Scan src/spells/*.ts → Map<spellName, moduleNameFile>. */
function scanImplemented(): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(SPELLS_DIR)) return out;
  for (const file of fs.readdirSync(SPELLS_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const full = path.join(SPELLS_DIR, file);
    const fromMeta = moduleNameFromFile(full);
    const name = fromMeta ?? titleCaseFromFilename(file);
    out.set(name, file);
  }
  return out;
}

function summarizeTime(s: RawSpell): string {
  const t = s.time?.[0];
  if (!t) return '?';
  const unitMap: Record<string, string> = {
    action: 'action', bonus: 'bonus action', reaction: 'reaction',
    minute: 'min', hour: 'hour', round: 'round',
  };
  return `${t.number} ${unitMap[t.unit] ?? t.unit}`;
}

function summarizeRange(s: RawSpell): string {
  const r = s.range;
  if (!r) return '?';
  if (r.type === 'point') {
    const d = r.distance;
    if (!d) return 'point';
    if (d.type === 'touch') return 'Touch';
    if (d.type === 'self') return 'Self';
    return `${d.amount ?? '?'} ${d.type === 'feet' ? 'ft' : d.type}`;
  }
  if (r.type === 'sphere' && r.distance?.amount) return `Self (${r.distance.amount} ft)`;
  if (r.type === 'radius') return `radius ${r.distance?.amount ?? '?'} ft`;
  if (r.type === 'cone') return `cone ${r.distance?.amount ?? '?'} ft`;
  if (r.type === 'line') return `line ${r.distance?.amount ?? '?'} ft`;
  return r.type ?? '?';
}

function summarizeDuration(s: RawSpell): string {
  const d = s.duration?.[0];
  if (!d) return '?';
  if (d.type === 'instant') return 'Instantaneous';
  if (d.type === 'timed' && d.amount != null) return `${d.amount} ${d.unit ?? ''}`.trim();
  if (d.type === 'permanent') return 'Permanent';
  if (d.type === 'untilDispelled') return 'Until dispelled';
  return d.type;
}

/** Extract damage dice from {@damage NdN} in entries[0] only (the primary effect),
 *  paired with damageInflict types. Scaling text lives in entries[1+] and is
 *  excluded to avoid noise like "1d6 + 2d6 + 3d6 + 4d6". */
function summarizeDamage(s: RawSpell): string[] {
  const types = s.damageInflict ?? [];
  const dice: string[] = [];
  const seen = new Set<string>();
  const re = /\{@damage\s+(\d+d\d+)\}/g;
  // Only scan the primary effect entry (entries[0]). Scaling/upgrade text
  // ("increases by ... at 5th level") lives in later entries and would
  // pollute the summary with multiple dice values.
  const primary = s.entries?.[0];
  if (primary) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(primary)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); dice.push(m[1]); }
    }
  }
  if (dice.length === 0) return []; // no dice → utility/buff; damageInflict tags alone are misleading
  const out: string[] = [];
  const n = Math.max(dice.length, types.length);
  for (let i = 0; i < n; i++) {
    const d = dice[i] ?? '?';
    const t = types[i] ?? '';
    out.push(t ? `${d} ${t}` : d);
  }
  return out;
}

function buildEffectLine(s: RawSpell, meta: CachedSpell['meta']): string {
  const parts: string[] = [];
  if (meta.attack) parts.push(`${meta.attack} spell attack`);
  else if (meta.save) parts.push(`${meta.save.toUpperCase()} save`);
  else parts.push('utility');
  if (meta.damage.length) parts.push(meta.damage.join(' + '));
  parts.push(meta.range);
  parts.push(meta.duration);
  if (meta.scales) parts.push('+scales');
  return parts.join(' · ');
}

// ---- Main ---------------------------------------------------

function main(): void {
  const indexFile = path.join(DATA_DIR, 'index.json');
  const sourceMap: Record<string, string> = JSON.parse(fs.readFileSync(indexFile, 'utf8'));

  // Load sources.json (class lists) — best-effort.
  let classIndex: Record<string, Record<string, string[]>> = {};
  const sourcesFile = path.join(DATA_DIR, 'sources.json');
  if (fs.existsSync(sourcesFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
      for (const [srcCode, spells] of Object.entries(raw)) {
        classIndex[srcCode] = {};
        for (const [spellName, info] of Object.entries(spells as any)) {
          const classes = ((info as any).class ?? []).map((c: any) => c.name);
          classIndex[srcCode][spellName] = Array.from(new Set(classes));
        }
      }
    } catch (e) {
      console.warn(`[spell-cache] sources.json parse failed: ${(e as Error).message}`);
    }
  }

  // Collect ALL entries per spell name (a spell may appear in several sourcebooks).
  // We do NOT dedupe creatures-style here — for spells, the project precedence rule
  // is "newest in-scope source wins"; older in-scope + out-of-scope versions are
  // recorded in `otherSources` for reference but do not override the canonical text.
  const byName = new Map<string, Array<{ spell: RawSpell; file: string }>>();

  for (const [srcCode, file] of Object.entries(sourceMap)) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) { console.warn(`[spell-cache] missing ${file}`); continue; }
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const arr: RawSpell[] = data.spell ?? [];
    for (const sp of arr) {
      if (!sp.name) continue;
      if (!byName.has(sp.name)) byName.set(sp.name, []);
      byName.get(sp.name)!.push({ spell: sp, file });
    }
  }

  const implemented = scanImplemented();

  const byLevel: CachedSpell[][] = Array.from({ length: 10 }, () => []);

  for (const [name, entries] of byName) {
    // Canonical = NEWEST in-scope source. If a spell only exists in out-of-scope
    // sources (e.g. a 2024-only spell), canonical = newest out-of-scope, and
    // inScope=false so the picker excludes it by default.
    const inScopeEntries = entries.filter(e => !isOutOfScope(e.spell.source ?? ''));
    const pool = inScopeEntries.length > 0 ? inScopeEntries : entries;
    // Sort newest-first by publication date (ties broken by source code for determinism)
    pool.sort((a, b) => {
      const da = sourceDate(a.spell.source ?? '');
      const db = sourceDate(b.spell.source ?? '');
      if (da !== db) return db.localeCompare(da);
      return (a.spell.source ?? '').localeCompare(b.spell.source ?? '');
    });
    const canonical = pool[0];
    const others = entries.filter(e => e !== canonical);

    const primary = canonical.spell;
    const level = primary.level ?? -1;
    if (level < 0 || level > 9) continue;
    const schoolFull = SCHOOL_MAP[primary.school ?? ''] ?? (primary.school ?? '?');
    const save = primary.savingThrow?.[0] ?? null;
    const attack = primary.spellAttack?.[0] === 'R' ? 'ranged'
      : primary.spellAttack?.[0] === 'M' ? 'melee' : null;
    const damage = summarizeDamage(primary);
    const meta: CachedSpell['meta'] = {
      time: summarizeTime(primary),
      range: summarizeRange(primary),
      duration: summarizeDuration(primary),
      save,
      attack,
      damage,
      scales: !!primary.scalingLevelDice,
    };
    const implMod = implemented.get(name) ?? null;

    // otherSources: every other source (older in-scope + out-of-scope), newest-first
    const otherSources: SourceRef[] = others
      .map(o => ({
        code: o.spell.source ?? '?',
        date: sourceDate(o.spell.source ?? ''),
        inScope: !isOutOfScope(o.spell.source ?? ''),
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));

    const inScope = inScopeEntries.length > 0;
    const classes = classIndex[primary.source ?? '']?.[name] ?? [];
    byLevel[level].push({
      name,
      source: primary.source ?? '?',
      sourceDate: sourceDate(primary.source ?? ''),
      sourceFile: canonical.file,
      page: primary.page ?? null,
      level,
      school: schoolFull,
      implemented: implMod !== null,
      implementedModule: implMod,
      inScope,
      otherSources,
      classes,
      effect: buildEffectLine(primary, meta),
      meta,
    });
  }

  for (const arr of byLevel) {
    arr.sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  let grandTotal = 0, grandImpl = 0, grandRemainingInScope = 0;

  for (let lv = 0; lv <= 9; lv++) {
    const arr = byLevel[lv];
    const impl = arr.filter(s => s.implemented).length;
    const remainingInScope = arr.filter(s => !s.implemented && s.inScope).length;
    grandTotal += arr.length;
    grandImpl += impl;
    grandRemainingInScope += remainingInScope;
    const out = {
      level: lv,
      generatedAt,
      generatorVersion: 2,
      scopeRule: 'pre-2024 canon; reprints: newest in-scope source wins; XPHB(2024) out of scope; creatures keep all variants (not applicable to spells)',
      sourceDates: SOURCE_DATES,
      outOfScopeSources: Array.from(OUT_OF_SCOPE_SOURCES),
      count: arr.length,
      implementedCount: impl,
      remainingInScope,
      spells: arr,
    };
    fs.writeFileSync(
      path.join(OUT_DIR, `level-${lv}.json`),
      JSON.stringify(out, null, 2) + '\n',
    );
  }

  // INDEX.md dashboard
  const lines: string[] = [];
  lines.push('# Spell Cache — Index');
  lines.push('');
  lines.push(`Generated: \`${generatedAt}\``);
  lines.push('');
  lines.push(`**Total spells:** ${grandTotal}  ·  **Implemented:** ${grandImpl}  ·  **Remaining (in-scope, pre-2024):** ${grandRemainingInScope}`);
  lines.push('');
  lines.push('> Scope: **canon published pre-2024**. Reprint precedence: **newest in-scope source wins** (e.g. TCE 2020 overrides PHB 2014 for the same spell). XPHB (2024 revised PHB) is out of scope. Creatures follow a different rule (all variants kept) — not applicable to this spell cache.');
  lines.push('> Regenerated by `npm run spell-cache:build`. Do not edit by hand. Per-level detail: `spell-cache/level-{0..9}.json`. Pick a batch: `npm run spell-cache:pick -- --level 0 --source PHB --count 5`.');
  lines.push('');
  lines.push('| Level | Total | Implemented | Remaining (in-scope) | Canonical source of next 5 | Next 5 unimplemented (in-scope) |');
  lines.push('|-------|-------|-------------|----------------------|------------------------------|----------------------------------|');
  for (let lv = 0; lv <= 9; lv++) {
    const arr = byLevel[lv];
    const impl = arr.filter(s => s.implemented).length;
    const remInScope = arr.filter(s => !s.implemented && s.inScope);
    const next5 = remInScope.slice(0, 5).map(s => `${s.name} (${s.source})`).join(', ') || '—';
    lines.push(`| ${lv} | ${arr.length} | ${impl} | ${remInScope.length} | — | ${next5} |`);
  }
  lines.push('');
  lines.push('## Implemented spells (auto-detected from `src/spells/*.ts`)');
  lines.push('');
  const implList = byLevel.flat().filter(s => s.implemented).sort((a, b) => a.name.localeCompare(b.name));
  if (implList.length === 0) {
    lines.push('_(none yet)_');
  } else {
    lines.push('| Name | Level | School | Canonical source | Module |');
    lines.push('|------|-------|--------|-------------------|--------|');
    for (const s of implList) {
      lines.push(`| ${s.name} | ${s.level} | ${s.school} | ${s.source} (${s.sourceDate}) | \`src/spells/${s.implementedModule}\` |`);
    }
  }
  lines.push('');
  lines.push('## Sourcebook publication dates (for reprint precedence)');
  lines.push('');
  lines.push('| Code | Date | In scope? |');
  lines.push('|------|------|-----------|');
  for (const [code, date] of Object.entries(SOURCE_DATES).sort((a, b) => a[1].localeCompare(b[1]))) {
    const scope = isOutOfScope(code) ? '❌ out (2024+)' : '✅ in';
    lines.push(`| ${code} | ${date} | ${scope} |`);
  }
  lines.push('');
  fs.writeFileSync(path.join(OUT_DIR, 'INDEX.md'), lines.join('\n') + '\n');

  console.log(`[spell-cache] wrote ${byLevel.flat().length} spells across 10 level files → ${OUT_DIR}/`);
  console.log(`[spell-cache] implemented=${grandImpl}  remaining(in-scope)=${grandRemainingInScope}  total=${grandTotal}`);
  console.log(`[spell-cache] INDEX.md dashboard written.`);
}

main();
