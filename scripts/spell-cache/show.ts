// ============================================================
// scripts/spell-cache/show.ts
//
// Print the FULL raw 5etools JSON entry for a spell by name.
// Used when an agent is about to implement a spell and needs the
// complete entries/damage/scaling data (the cache only stores a summary).
//
// Usage:
//   npm run spell-cache:show -- "Acid Splash"
//   npm run spell-cache:show -- "Chill Touch" --pretty
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'testDataSpells');

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

  // Search every sourcebook file; prefer PHB, then first match.
  let best: { spell: any; file: string; source: string } | null = null;
  for (const [srcCode, file] of Object.entries(index)) {
    const full = path.join(DATA_DIR, file);
    if (!fs.existsSync(full)) continue;
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const arr: any[] = data.spell ?? [];
    const match = arr.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (match) {
      if (!best || match.source === 'PHB') {
        best = { spell: match, file, source: match.source };
        if (match.source === 'PHB') break; // PHB is canonical, stop early
      }
    }
  }

  if (!best) {
    console.error(`Spell not found: "${name}"`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(best.spell, null, pretty ? 2 : 0) + '\n');
  process.stderr.write(`[spell-cache] ${best.spell.name} from ${best.file} (source=${best.source})\n`);
}

main();
