// ============================================================
// scripts/spell-cache/pick.ts
//
// Pick the next batch of unimplemented spells from the cache and emit a
// markdown table ready to paste into a zHANDOVER / HANDOVER.
//
// Usage:
//   npm run spell-cache:pick -- --level 0 --source PHB --count 5
//   npm run spell-cache:pick -- --level 1 --count 8            # any 2014 source
//   npm run spell-cache:pick -- --level 0 --all                # include out-of-scope (XPHB)
//   npm run spell-cache:pick -- --level 2 --class Wizard       # filter by class
//
// Output: markdown to stdout.
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(ROOT, 'spell-cache');

interface CachedSpell {
  name: string;
  source: string;
  sourceFile: string;
  page: number | null;
  level: number;
  school: string;
  implemented: boolean;
  implementedModule: string | null;
  inScope2014: boolean;
  reprintedIn: string[];
  classes: string[];
  effect: string;
  meta: {
    time: string; range: string; duration: string;
    save: string | null; attack: string | null;
    damage: string[]; scales: boolean;
  };
}

function snakeCase(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseArgs(argv: string[]): {
  level: number; source: string | null; count: number;
  includeAll: boolean; className: string | null;
} {
  const opts = { level: 0, source: null as string | null, count: 5, includeAll: false, className: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--level') opts.level = parseInt(argv[++i], 10);
    else if (a === '--source') opts.source = argv[++i];
    else if (a === '--count') opts.count = parseInt(argv[++i], 10);
    else if (a === '--all') opts.includeAll = true;
    else if (a === '--class') opts.className = argv[++i];
  }
  if (Number.isNaN(opts.level) || opts.level < 0 || opts.level > 9) {
    console.error('Invalid --level. Must be 0..9.');
    process.exit(1);
  }
  if (Number.isNaN(opts.count) || opts.count < 1) opts.count = 5;
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const file = path.join(CACHE_DIR, `level-${opts.level}.json`);
  if (!fs.existsSync(file)) {
    console.error(`Cache file not found: ${file}\nRun \`npm run spell-cache:build\` first.`);
    process.exit(1);
  }
  const cache: { count: number; implementedCount: number; remainingInScope2014: number; spells: CachedSpell[] } =
    JSON.parse(fs.readFileSync(file, 'utf8'));

  let candidates = cache.spells.filter(s => !s.implemented);
  if (!opts.includeAll) candidates = candidates.filter(s => s.inScope2014);
  if (opts.source) candidates = candidates.filter(s => s.source === opts.source || s.reprintedIn.includes(opts.source));
  if (opts.className) {
    candidates = candidates.filter(s => s.classes.some(c => c.toLowerCase() === opts.className!.toLowerCase()));
  }
  // Sort: name asc (cache is already sorted, but be safe)
  candidates.sort((a, b) => a.name.localeCompare(b.name));
  const batch = candidates.slice(0, opts.count);

  const scopeNote = opts.includeAll ? '(all sources incl. XPHB 2024)' : '(2014 in-scope only)';
  const srcNote = opts.source ? `, source ${opts.source}` : '';
  const clsNote = opts.className ? `, class ${opts.className}` : '';
  const levelWord = opts.level === 0 ? 'cantrips' : `level-${opts.level} spells`;

  const out: string[] = [];
  out.push(`## Suggested next batch — ${levelWord}${srcNote}${clsNote}, ${batch.length} spell(s) ${scopeNote}`);
  out.push('');
  out.push(`> Picked from \`spell-cache/level-${opts.level}.json\` ` +
    `(${cache.remainingInScope2014} remaining 2014, ${cache.implementedCount}/${cache.count} implemented).`);
  out.push(`> Regenerate: \`npm run spell-cache:build\` · Re-pick: \`npm run spell-cache:pick -- --level ${opts.level}${opts.source ? ' --source ' + opts.source : ''} --count ${opts.count}\``);
  out.push('');

  if (batch.length === 0) {
    out.push('_No unimplemented spells match these filters. Try `--all` or a different `--source`/`--level`._');
    out.push('');
    process.stdout.write(out.join('\n'));
    return;
  }

  out.push('| # | Name | School | Effect | Source | Page | Module to create |');
  out.push('|---|------|--------|--------|--------|------|------------------|');
  batch.forEach((s, i) => {
    const reprints = s.reprintedIn.length ? ` (also ${s.reprintedIn.join(',')})` : '';
    out.push(`| ${i + 1} | **${s.name}** | ${s.school} | ${s.effect} | ${s.source}${reprints} | ${s.page ?? '—'} | \`src/spells/${snakeCase(s.name)}.ts\` |`);
  });
  out.push('');

  out.push('### Implementation checklist (paste into handover)');
  out.push('');
  const isCantrip = opts.level === 0;
  for (const s of batch) {
    const routing = s.meta.attack
      ? 'post-hit effect → CANTRIP_EFFECTS (if cantrip) or spell-specific handler'
      : s.meta.save
        ? 'save-based → resolveAttack save branch (if cantrip) or spell-specific handler'
        : 'self-buff/utility → CANTRIP_SELF_EFFECTS (if cantrip) or spell-specific handler';
    out.push(`- [ ] **${s.name}** (\`${s.source} p.${s.page ?? '?'}\`) — \`${s.meta.damage.join(' + ') || 'no damage'}\`, ${routing}. Create \`src/spells/${snakeCase(s.name)}.ts\`.`);
  }
  out.push('');

  // Workstream guidance
  out.push('### Workstream routing');
  out.push('');
  if (isCantrip) {
    out.push('- These are **cantrips (level 0)** → **Cantrip workstream** (zHANDOVER).');
    out.push('- Register post-hit effects in `CANTRIP_EFFECTS`, pre-roll advantage in `CANTRIP_ATTACK_ADVANTAGE`, self-buffs in `CANTRIP_SELF_EFFECTS` (all in `src/engine/cantrip_effects.ts`).');
    out.push('- Do NOT add `case \'spellName\'` to `executePlannedAction`.');
  } else {
    out.push(`- These are **level ${opts.level} spells** → **Core Engine workstream** (HANDOVER-SESSION-*) per AGENTS.md.`);
    out.push('- Cantrip agent: do NOT implement these. Hand off to the Core Engine agent.');
  }
  out.push('- After implementing, re-run `npm run spell-cache:build` to refresh the `implemented` flags, then commit the updated cache.');
  out.push('');

  process.stdout.write(out.join('\n'));
}

main();
