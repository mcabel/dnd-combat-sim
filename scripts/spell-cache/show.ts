// ============================================================
// scripts/spell-cache/show.ts
//
// Print the FULL raw 5etools JSON entry for a spell by name.
// Used when an agent is about to implement a spell and needs the
// complete entries/damage/scaling data (the cache only stores a summary).
//
// Canonical-source rule (per project scope): among in-scope (pre-2024)
// sources, the NEWEST printing wins. XPHB (2024) is out of scope and only
// used as a last resort (inScope=false spells). So we search every
// sourcebook file and pick the newest in-scope match.
//
// Usage:
//   npm run spell-cache:show -- "Acid Splash"
//   npm run spell-cache:show -- "Chill Touch" --pretty
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'testDataSpells');

// Must mirror build.ts SOURCE_DATES / OUT_OF_SCOPE_SOURCES.
const SOURCE_DATES: Record<string, string> = {
  'PHB': '2014-08-19', 'XGE': '2017-11-21', 'LLK': '2018-06-08', 'GGR': '2018-11-20',
  'AI': '2019-07-16', 'EGW': '2020-03-17', 'EFA': '2020-07-01', 'IDRotF': '2020-09-15',
  'TCE': '2020-11-17', 'AitFR-AVT': '2021-07-08', 'FTD': '2021-10-26', 'SCC': '2021-12-07',
  'AAG': '2022-08-16', 'SatO': '2022-09-01', 'FRHoF': '2022-11-01', 'BMT': '2023-11-07',
  'XPHB': '2024-09-03',
};
const OUT_OF_SCOPE_SOURCES: Set<string> = new Set(['XPHB']);
const dateOf = (c: string) => SOURCE_DATES[c] ?? '1970-01-01';
const inScope = (c: string) => !OUT_OF_SCOPE_SOURCES.has(c);

function main(): void {
  const argv = process.argv.slice(2);
  const pretty = argv.includes('--pretty');
  const name = argv.filter(a => !a.startsWith('--'))[0];
  if (!name) {
    console.error('Usage: npm run spell-cache:show -- "Spell Name" [--pretty]');
    process.exit(1);
  }

  const index: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'),
  );

  // Collect every match across all sourcebooks.
  const matches: { spell: any; file: string; source: string }[] = [];
  for (const [srcCode, file] of Object.entries(index)) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const arr: any[] = data.spell ?? [];
    for (const sp of arr) {
      if (sp.name && sp.name.toLowerCase() === name.toLowerCase()) {
        matches.push({ spell: sp, file, source: sp.source });
      }
    }
  }

  if (matches.length === 0) {
    console.error(`Spell not found: "${name}"`);
    process.exit(1);
  }

  // Canonical = newest in-scope match. Fall back to newest out-of-scope if none in scope.
  const inScopeMatches = matches.filter(m => inScope(m.source));
  const pool = inScopeMatches.length > 0 ? inScopeMatches : matches;
  pool.sort((a, b) => dateOf(b.source).localeCompare(dateOf(a.source)));
  const best = pool[0];

  process.stdout.write(JSON.stringify(best.spell, null, pretty ? 2 : 0) + '\n');
  const scopeNote = inScope(best.source) ? 'in-scope (pre-2024)' : 'OUT OF SCOPE (2024)';
  process.stderr.write(
    `[spell-cache] ${best.spell.name} from ${best.file} (source=${best.source}, ${dateOf(best.source)}, ${scopeNote})` +
    (matches.length > 1 ? ` — ${matches.length - 1} other printing(s): ${matches.filter(m => m !== best).map(m => m.source + '(' + dateOf(m.source) + ')').join(', ')}` : '') +
    '\n',
  );
}

main();
