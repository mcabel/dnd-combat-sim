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

interface CachedSpell {
  name: string;
  source: string;            // primary source (PHB preferred)
  sourceFile: string;        // testDataSpells/<file>
  page: number | null;
  level: number;
  school: string;            // full name
  implemented: boolean;
  implementedModule: string | null;
  inScope2014: boolean;      // false if ONLY in XPHB (2024)
  reprintedIn: string[];     // other sourcebook codes
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
    const m = src.match(/export\s+const\s+metadata\s*=\s*\{[\s\S]*?name:\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
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

  // Collect spells, dedupe by name. Prefer PHB as primary source.
  const byName = new Map<string, { primary: RawSpell & { _file: string }; reprints: string[] }>();

  for (const [srcCode, file] of Object.entries(sourceMap)) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) { console.warn(`[spell-cache] missing ${file}`); continue; }
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const arr: RawSpell[] = data.spell ?? [];
    for (const sp of arr) {
      if (!sp.name) continue;
      const existing = byName.get(sp.name);
      const entry = { ...sp, _file: file } as RawSpell & { _file: string };
      if (!existing) {
        byName.set(sp.name, { primary: entry, reprints: [] });
      } else {
        if (sp.source === 'PHB' && existing.primary.source !== 'PHB') {
          existing.reprints.push(existing.primary.source);
          existing.primary = entry;
        } else if (sp.source !== existing.primary.source) {
          existing.reprints.push(sp.source);
        }
      }
    }
  }

  const implemented = scanImplemented();

  const byLevel: CachedSpell[][] = Array.from({ length: 10 }, () => []);

  for (const [name, { primary, reprints }] of byName) {
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
    const allSources = [primary.source, ...reprints];
    const inScope2014 = allSources.some(s => s !== 'XPHB');
    const classes = classIndex[primary.source]?.[name] ?? [];
    byLevel[level].push({
      name,
      source: primary.source,
      sourceFile: primary._file,
      page: primary.page ?? null,
      level,
      school: schoolFull,
      implemented: implMod !== null,
      implementedModule: implMod,
      inScope2014,
      reprintedIn: reprints,
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
  let grandTotal = 0, grandImpl = 0, grandRemaining2014 = 0;

  for (let lv = 0; lv <= 9; lv++) {
    const arr = byLevel[lv];
    const impl = arr.filter(s => s.implemented).length;
    const remaining2014 = arr.filter(s => !s.implemented && s.inScope2014).length;
    grandTotal += arr.length;
    grandImpl += impl;
    grandRemaining2014 += remaining2014;
    const out = {
      level: lv,
      generatedAt,
      generatorVersion: 1,
      count: arr.length,
      implementedCount: impl,
      remainingInScope2014: remaining2014,
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
  lines.push(`**Total spells:** ${grandTotal}  ·  **Implemented:** ${grandImpl}  ·  **Remaining (2014 in-scope):** ${grandRemaining2014}`);
  lines.push('');
  lines.push('> This index is regenerated by `npm run spell-cache:build`. Do not edit by hand.');
  lines.push('> Per-level detail: `spell-cache/level-{0..9}.json`. Pick a batch: `npm run spell-cache:pick -- --level 0 --source PHB --count 5`.');
  lines.push('');
  lines.push('| Level | Total | Implemented | Remaining (2014) | Next 5 unimplemented (2014) |');
  lines.push('|-------|-------|-------------|------------------|------------------------------|');
  for (let lv = 0; lv <= 9; lv++) {
    const arr = byLevel[lv];
    const impl = arr.filter(s => s.implemented).length;
    const rem2014 = arr.filter(s => !s.implemented && s.inScope2014);
    const next5 = rem2014.slice(0, 5).map(s => s.name).join(', ') || '—';
    lines.push(`| ${lv} | ${arr.length} | ${impl} | ${rem2014.length} | ${next5} |`);
  }
  lines.push('');
  lines.push('## Implemented spells (auto-detected from `src/spells/*.ts`)');
  lines.push('');
  const implList = byLevel.flat().filter(s => s.implemented).sort((a, b) => a.name.localeCompare(b.name));
  if (implList.length === 0) {
    lines.push('_(none yet)_');
  } else {
    lines.push('| Name | Level | School | Module |');
    lines.push('|------|-------|--------|--------|');
    for (const s of implList) {
      lines.push(`| ${s.name} | ${s.level} | ${s.school} | \`src/spells/${s.implementedModule}\` |`);
    }
  }
  lines.push('');
  fs.writeFileSync(path.join(OUT_DIR, 'INDEX.md'), lines.join('\n') + '\n');

  console.log(`[spell-cache] wrote ${byLevel.flat().length} spells across 10 level files → ${OUT_DIR}/`);
  console.log(`[spell-cache] implemented=${grandImpl}  remaining(2014)=${grandRemaining2014}  total=${grandTotal}`);
  console.log(`[spell-cache] INDEX.md dashboard written.`);
}

main();
