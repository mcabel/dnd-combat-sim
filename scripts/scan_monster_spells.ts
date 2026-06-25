// ============================================================
// scripts/scan_monster_spells.ts
// Session 67 — Monster Spell Coverage Tracker
//
// Scans every monster in `bestiaryData/` and collects spell names from
// `monsterSpellcasting` (atWill + daily + slots[0..9]). Cross-references
// each name against:
//   (a) the spell cache (spell-cache/level-{0..9}.json) — auto-derived
//       `implemented` flag from `src/spells/*.ts`
//   (b) `listCantripTemplateNames()` from `src/ai/monster_spellcasting.ts`
//       (monster-only combat cantrips not in the spell cache)
//
// Output:
//   - Console summary
//   - `docs/MONSTER-SPELL-COVERAGE.md` (full report — committed for humans
//     and future agents to consult when picking the next spell to build)
//
// Run:  npx ts-node --transpile-only scripts/scan_monster_spells.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { loadBestiaryDir } from '../src/data/loader';
import { listCantripTemplateNames } from '../src/ai/monster_spellcasting';

// ---- Types --------------------------------------------------

interface SpellCacheEntry {
  name: string;
  level: number;
  implemented: boolean;
  inScope: boolean;
  school?: string;
  source?: string;
}

interface MonsterSpellRef {
  spellName: string;        // raw name as it appears in monsterSpellcasting
  creatureName: string;
  source: string;           // bestiary source file
  bucket: 'atWill' | 'daily' | 'slot';
  level: number;            // -1 for atWill/daily (unknown), 0-9 for slot
}

interface SpellAggregate {
  canonicalName: string;    // best canonical match (cache name if present, else raw)
  rawName: string;          // first raw spelling seen
  creatureCount: number;    // unique creatures using it
  totalRefs: number;        // total references (incl. duplicates within same creature)
  creatures: string[];      // up to N example creatures
  levels: Set<number>;      // levels where this spell appears (slot-based); -1 for atWill
  implemented: boolean;
  inScope: boolean;
  source?: string;
  school?: string;
  fromCantripTemplates: boolean;
}

// ---- Helpers ------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const BESTIARY_DIR = path.join(REPO_ROOT, 'bestiaryData');
const SPELL_CACHE_DIR = path.join(REPO_ROOT, 'spell-cache');
const REPORT_PATH = path.join(REPO_ROOT, 'docs', 'MONSTER-SPELL-COVERAGE.md');

/** Build a lowercased → SpellCacheEntry map from spell-cache/level-*.json. */
function loadSpellCache(): Map<string, SpellCacheEntry> {
  const out = new Map<string, SpellCacheEntry>();
  for (let lvl = 0; lvl <= 9; lvl++) {
    const p = path.join(SPELL_CACHE_DIR, `level-${lvl}.json`);
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      spells: Array<{
        name: string;
        level: number;
        implemented?: boolean;
        inScope?: boolean;
        school?: string;
        source?: string;
      }>;
    };
    for (const s of data.spells) {
      out.set(s.name.toLowerCase(), {
        name: s.name,
        level: s.level,
        implemented: !!s.implemented,
        inScope: s.inScope !== false,
        school: s.school,
        source: s.source,
      });
    }
  }
  return out;
}

/** Normalize a raw spell name from monsterSpellcasting for matching. */
function normalize(raw: string): string {
  return raw
    .trim()
    // Strip ALL 5etools {@tag value|metadata} annotations, keeping only the
    // inner `value`. This is broader than the inline `{@spell ...}` strip
    // because parentheticals can contain OTHER tags too — e.g. the bestiary
    // entry "Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage)" has an
    // inner {@damage 13d6} that must be reduced to "13d6" before the outer
    // paren is stripped, otherwise the outer-paren regex would fail to match
    // the literal `}` characters. (Session 71 fix — generalizes the Session 69
    // {@spell}-only strip to all {@tag} variants.)
    .replace(/\{@\w+\s+([^}|]+)(?:\|[^}]*)?\}/g, '$1')
    // Strip trailing parentheticals like "(self only)" or "(as an action)".
    // Handles ONE level of nesting (e.g. "(45 (13d6) damage)" — the outer
    // paren wraps an inner paren). Applied iteratively to handle multiple
    // trailing parentheticals, e.g. "Foo (a) (b)" → "Foo". (Session 71 fix —
    // the old [^)]* regex broke on nested parens like the Otiluke's entry,
    // leaving the spell unmatched against the cache and incorrectly counted
    // as "unbuilt".)
    .replace(/\s*\((\([^()]*\)|[^()]*)*\)\s*$/, '')
    .replace(/\s*\((\([^()]*\)|[^()]*)*\)\s*$/, '')
    // strip trailing 5etools cross-reference asterisks (e.g. "Mirror Image*",
    // "acid splash *"). The * marks spells sourced from a different book
    // than the monster's source — it's a metadata marker, not part of the
    // spell name. Without this strip, ~100+ already-implemented spells were
    // incorrectly counted as "unbuilt" because "Mirror Image*" didn't match
    // the cache entry "Mirror Image". (Session 69 fix.)
    .replace(/\s*\*+\s*$/, '')
    .trim();
}

/** Convert "Acid Arrow" / "acid arrow" → "Acid Arrow" (title-case fallback). */
function titleCase(s: string): string {
  return s.split(/\s+/).map(w =>
    w.length <= 3 && w !== w.toUpperCase()
      ? w.toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

// ---- Main ---------------------------------------------------

function main(): void {
  console.log('[scan] loading bestiary…');
  const loadResult = loadBestiaryDir(BESTIARY_DIR);
  console.log(`[scan] ${loadResult.monsterCount} unique monsters loaded from ${loadResult.filesLoaded.length} files`);

  console.log('[scan] loading spell cache…');
  const cache = loadSpellCache();
  console.log(`[scan] ${cache.size} cache entries`);

  // Cantrip templates (monster-only, may not be in spell cache)
  const cantripTemplateNames = new Set(
    listCantripTemplateNames().map(n => n.toLowerCase())
  );
  console.log(`[scan] ${cantripTemplateNames.size} cantrip templates`);

  // Walk all monsters and collect spell refs.
  const refs: MonsterSpellRef[] = [];
  let monstersWithSpellcasting = 0;

  for (const [key, raw] of loadResult.bestiary.entries()) {
    // Skip dual-keyed duplicates (e.g. "Goblin|MM")
    if (key.includes('|')) continue;

    const sc = (raw as any).spellcasting;
    if (!sc || !Array.isArray(sc) || sc.length === 0) continue;
    const s = sc[0];
    const creatureName: string = (raw as any).name ?? key;
    const source: string = (raw as any).source ?? '?';

    let hasAny = false;

    // atWill
    if (Array.isArray(s.will)) {
      for (const sp of s.will) {
        // Session 71 fix: skip non-string entries. A small number of bestiary
        // entries have an object instead of a string for a spell (5etools data
        // bug) — without this guard, String(sp) produces "[object Object]"
        // which pollutes the unbuilt list with a phantom "[object Object]"
        // spell (5 creature-refs in the v0.1 bestiary).
        if (typeof sp !== 'string') continue;
        const name = normalize(sp.replace(/\{@spell\s+([^}|]+)(?:\|[^}]*)?\}/i, '$1').trim());
        if (!name) continue;
        refs.push({ spellName: name, creatureName, source, bucket: 'atWill', level: -1 });
        hasAny = true;
      }
    }

    // daily { "1e": [...], "2e": [...] }
    if (s.daily && typeof s.daily === 'object') {
      for (const spells of Object.values(s.daily) as any[]) {
        if (!Array.isArray(spells)) continue;
        for (const sp of spells) {
          // Session 71 fix: skip non-string entries (see atWill comment above).
          if (typeof sp !== 'string') continue;
          const name = normalize(sp.replace(/\{@spell\s+([^}|]+)(?:\|[^}]*)?\}/i, '$1').trim());
          if (!name) continue;
          refs.push({ spellName: name, creatureName, source, bucket: 'daily', level: -1 });
          hasAny = true;
        }
      }
    }

    // slots { "0": { spells: [...] }, "1": { slots: N, spells: [...] }, ... }
    if (s.spells && typeof s.spells === 'object') {
      for (const [lvlStr, ld] of Object.entries(s.spells) as [string, any][]) {
        const lvl = parseInt(lvlStr, 10);
        if (isNaN(lvl) || lvl < 0 || lvl > 9) continue;
        if (!ld || !Array.isArray(ld.spells)) continue;
        for (const sp of ld.spells) {
          // Session 71 fix: skip non-string entries (see atWill comment above).
          if (typeof sp !== 'string') continue;
          const name = normalize(sp.replace(/\{@spell\s+([^}|]+)(?:\|[^}]*)?\}/i, '$1').trim());
          if (!name) continue;
          refs.push({ spellName: name, creatureName, source, bucket: 'slot', level: lvl });
          hasAny = true;
        }
      }
    }

    if (hasAny) monstersWithSpellcasting++;
  }

  console.log(`[scan] ${monstersWithSpellcasting} monsters have spellcasting`);
  console.log(`[scan] ${refs.length} total spell references (with duplicates)`);

  // Aggregate by lowercased spell name.
  const agg = new Map<string, SpellAggregate>();

  for (const r of refs) {
    const lower = r.spellName.toLowerCase();
    const cacheEntry = cache.get(lower);
    const isCantripTemplate = cantripTemplateNames.has(lower);
    const implemented = (cacheEntry?.implemented ?? false) || isCantripTemplate;
    const inScope = cacheEntry?.inScope ?? true; // unknown spells default in-scope

    let a = agg.get(lower);
    if (!a) {
      a = {
        canonicalName: cacheEntry?.name ?? titleCase(r.spellName),
        rawName: r.spellName,
        creatureCount: 0,
        totalRefs: 0,
        creatures: [],
        levels: new Set<number>(),
        implemented,
        inScope,
        source: cacheEntry?.source,
        school: cacheEntry?.school,
        fromCantripTemplates: isCantripTemplate,
      };
      agg.set(lower, a);
    }
    a.totalRefs++;
    a.levels.add(r.level);
    if (!a.creatures.includes(r.creatureName)) {
      a.creatureCount++;
      if (a.creatures.length < 5) a.creatures.push(r.creatureName);
    }
  }

  const all = Array.from(agg.values());
  const built = all.filter(a => a.implemented);
  const unbuilt = all.filter(a => !a.implemented);

  // Sort unbuilt by creatureCount desc, then by totalRefs desc, then by name.
  unbuilt.sort((a, b) =>
    b.creatureCount !== a.creatureCount
      ? b.creatureCount - a.creatureCount
      : b.totalRefs !== a.totalRefs
        ? b.totalRefs - a.totalRefs
        : a.canonicalName.localeCompare(b.canonicalName)
  );

  // ---- Console summary --------------------------------------
  console.log('');
  console.log('============================================================');
  console.log(' Monster Spell Coverage — Summary');
  console.log('============================================================');
  console.log(` Total creatures (bestiary)            : ${loadResult.monsterCount}`);
  console.log(` Creatures with monsterSpellcasting    : ${monstersWithSpellcasting}`);
  console.log(` Total spell references (incl. dupes)  : ${refs.length}`);
  console.log(` Unique spells referenced              : ${all.length}`);
  console.log(`   ├─ already implemented              : ${built.length}`);
  console.log(`   └─ NOT yet implemented              : ${unbuilt.length}`);
  console.log('');
  console.log(' Top 30 unbuilt spells (by # creatures using them):');
  console.log(' ┌─────┬──────────────────────────────────────────────┬───────────┬──────────────┐');
  console.log(' │  #  │ Spell                                         │ # Creatrs │ Example      │');
  console.log(' ├─────┼──────────────────────────────────────────────┼───────────┼──────────────┤');
  for (let i = 0; i < Math.min(30, unbuilt.length); i++) {
    const a = unbuilt[i];
    const name = a.canonicalName.padEnd(44).slice(0, 44);
    const cnt = String(a.creatureCount).padStart(9);
    const ex = (a.creatures[0] ?? '').padEnd(12).slice(0, 12);
    console.log(` │ ${String(i + 1).padStart(3)} │ ${name} │ ${cnt} │ ${ex} │`);
  }
  console.log(' └─────┴──────────────────────────────────────────────┴───────────┴──────────────┘');
  console.log('');

  // ---- Markdown report --------------------------------------
  writeReport({
    generatedAt: new Date().toISOString(),
    monsterCount: loadResult.monsterCount,
    monstersWithSpellcasting,
    totalRefs: refs.length,
    uniqueSpells: all.length,
    builtCount: built.length,
    unbuiltCount: unbuilt.length,
    unbuilt,
    built,
  });
  console.log(`[scan] report written → ${path.relative(REPO_ROOT, REPORT_PATH)}`);
}

function writeReport(opts: {
  generatedAt: string;
  monsterCount: number;
  monstersWithSpellcasting: number;
  totalRefs: number;
  uniqueSpells: number;
  builtCount: number;
  unbuiltCount: number;
  unbuilt: SpellAggregate[];
  built: SpellAggregate[];
}): void {
  const lines: string[] = [];
  lines.push('# Monster Spell Coverage Report');
  lines.push('');
  lines.push(`Generated: \`${opts.generatedAt}\``);
  lines.push(`Source: ${opts.monsterCount} bestiary entries from \`bestiaryData/\`, scanned via \`scripts/scan_monster_spells.ts\`.`);
  lines.push('');
  lines.push('> **Purpose:** This report guides which spell modules to build next for the');
  lines.push('> Monster Spellcasting engine (`src/ai/monster_spellcasting.ts`). Spells used by');
  lines.push('> many creatures but not yet implemented are the highest-value targets — each');
  lines.push('> new module unlocks AI behavior for every creature that knows it.');
  lines.push('>');
  lines.push('> **Regenerate** after implementing new spells: `npx ts-node --transpile-only scripts/scan_monster_spells.ts`');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total creatures in bestiary | ${opts.monsterCount} |`);
  lines.push(`| Creatures with \`monsterSpellcasting\` | ${opts.monstersWithSpellcasting} (${pct(opts.monstersWithSpellcasting, opts.monsterCount)}) |`);
  lines.push(`| Total spell references (incl. duplicates) | ${opts.totalRefs} |`);
  lines.push(`| Unique spells referenced | ${opts.uniqueSpells} |`);
  lines.push(`| ├─ Already implemented | ${opts.builtCount} (${pct(opts.builtCount, opts.uniqueSpells)}) |`);
  lines.push(`| └─ NOT yet implemented | ${opts.unbuiltCount} (${pct(opts.unbuiltCount, opts.uniqueSpells)}) |`);
  lines.push('');

  lines.push('## Top 50 Unbuilt Spells (by creature frequency)');
  lines.push('');
  lines.push('Priority for future spell-module work. Each row lists the spell name, the number');
  lines.push('of distinct creatures that know it, total references (a creature may list the same');
  lines.push('spell at multiple slot levels — counted separately), and a few example creatures.');
  lines.push('');
  lines.push('| Rank | Spell | # Creatures | Total Refs | Example Creatures | Notes |');
  lines.push('|------|-------|-------------|------------|-------------------|-------|');
  const top = opts.unbuilt.slice(0, 50);
  for (let i = 0; i < top.length; i++) {
    const a = top[i];
    const ex = a.creatures.slice(0, 3).join(', ');
    const levelsStr = formatLevels(a.levels);
    const notes = [
      a.source ? `\`${a.source}\`` : null,
      a.school ? a.school : null,
      levelsStr ? `levels: ${levelsStr}` : null,
      a.fromCantripTemplates ? '⚠️ in cantrip templates' : null,
      !a.inScope ? 'out of scope' : null,
    ].filter(Boolean).join(' · ');
    lines.push(`| ${i + 1} | ${a.canonicalName} | ${a.creatureCount} | ${a.totalRefs} | ${ex} | ${notes} |`);
  }
  lines.push('');

  // Full unbuilt list (ranked)
  lines.push('## Full Unbuilt Spells List (all)');
  lines.push('');
  lines.push('| Rank | Spell | # Creatures | Total Refs |');
  lines.push('|------|-------|-------------|------------|');
  for (let i = 0; i < opts.unbuilt.length; i++) {
    const a = opts.unbuilt[i];
    lines.push(`| ${i + 1} | ${a.canonicalName} | ${a.creatureCount} | ${a.totalRefs} |`);
  }
  lines.push('');

  // Implemented-spell summary (count by level for visibility)
  lines.push('## Implemented Spells (already built — summary)');
  lines.push('');
  const builtByLevel = new Map<number, number>();
  for (const a of opts.built) {
    // For cantrip templates without cache entry, level is 0 by convention.
    let lvl = -1;
    if (a.fromCantripTemplates && !a.source) lvl = 0;
    // If we have a cache entry, use its level.
    // (We didn't store the level on SpellAggregate — derive from raw levels set.)
    if (lvl === -1) {
      // Prefer the lowest non-negative level
      const ls = Array.from(a.levels).filter(x => x >= 0).sort((x, y) => x - y);
      lvl = ls.length ? ls[0] : -1;
    }
    builtByLevel.set(lvl, (builtByLevel.get(lvl) ?? 0) + 1);
  }
  lines.push('| Level | Implemented count |');
  lines.push('|-------|-------------------|');
  for (const lvl of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const c = builtByLevel.get(lvl) ?? 0;
    if (c > 0) {
      lines.push(`| ${lvl === -1 ? 'unknown' : lvl} | ${c} |`);
    }
  }
  lines.push('');

  // Methodology
  lines.push('## Methodology');
  lines.push('');
  lines.push('1. **Bestiary scan**: iterates every JSON in `bestiaryData/`, parses each');
  lines.push('   creature\'s 5etools `spellcasting` block, and collects spell names from the');
  lines.push('   `will` (at-will), `daily`, and `spells` (slot-based, levels 0–9) fields.');
  lines.push('   `@spell` tags are stripped, parentheticals like `(self only)` are removed.');
  lines.push('');
  lines.push('2. **Implementation check**: a spell is "implemented" if EITHER:');
  lines.push('   - it appears in `spell-cache/level-*.json` with `implemented: true` (i.e. has');
  lines.push('     a module in `src/spells/<name>.ts` registered via `_generic_registry.ts` or a');
  lines.push('     dedicated `case` in `combat.ts`), OR');
  lines.push('   - it appears in `CANTRIP_TEMPLATES` in `src/ai/monster_spellcasting.ts` (the');
  lines.push('     monster-only combat cantrip templates handled directly by the monster');
  lines.push('     spellcasting engine — these are not in the spell cache).');
  lines.push('');
  lines.push('3. **Frequency**: creature count is the number of distinct creatures that list');
  lines.push('   the spell in any field. Total refs includes duplicates when a creature lists');
  lines.push('   the same spell at multiple slot levels.');
  lines.push('');

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join('\n'));
}

function pct(n: number, d: number): string {
  if (!d) return '0%';
  return `${(100 * n / d).toFixed(1)}%`;
}

function formatLevels(s: Set<number>): string {
  const arr = Array.from(s).sort((a, b) => a - b);
  if (arr.length === 0) return '';
  return arr.map(l => l === -1 ? 'atWill/daily' : `L${l}`).join(',');
}

main();
