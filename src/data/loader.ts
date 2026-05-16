// ============================================================
// Bestiary Loader
// Scans a directory of 5etools-format bestiary JSON files and
// merges them into a single lookup map.
//
// Skips "summon-type" creatures — those whose CR is undefined or
// whose power is meant to scale with summoner/caster level.
// These include: summoned demons, animated objects, familiars,
// companions, and creatures that are magic-item mounts (e.g. Giant Fly).
// They will be handled separately with override CR/HP at spawn time.
//
// Usage:
//   const result = loadBestiaryDir('./bestiaryData');
//   const goblin = spawnMonster(result.bestiary, 'Goblin', pos);
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Raw5etoolsMonster, mergeBestiaries } from '../parser/fivetools';

export interface LoadResult {
  bestiary: Map<string, Raw5etoolsMonster>;
  filesLoaded: string[];
  filesSkipped: string[];          // non-JSON or missing 'monster' array
  summonTypeSkipped: string[];     // monsters skipped due to missing/special CR
  monsterCount: number;
}

/**
 * Detect whether a raw monster entry is a "summon-type" creature:
 * one whose CR is undefined, missing, or flagged as scaling-based.
 *
 * Criteria:
 * - cr field is absent entirely
 * - cr field is an object with no usable numeric value (e.g. special text)
 *
 * Examples that ARE skipped: Giant Fly (no CR), summoned elemental variants,
 * animated objects, familiars.
 * Examples that are NOT skipped: CR "0" (Larva), CR "1/4" (Goblin).
 */
function isSummonType(raw: Raw5etoolsMonster): boolean {
  if (raw.cr === undefined || raw.cr === null) return true;

  // CR can be a string or { cr: string, lair?: string }
  const crStr = typeof raw.cr === 'string' ? raw.cr : raw.cr.cr;

  // Known numeric-ish values are valid (including "0", "1/8", "1/4", "1/2", "1".."30")
  if (/^(\d+|1\/8|1\/4|1\/2)$/.test(crStr.trim())) return false;

  // Anything else (empty string, "Unknown", special text) → treat as summon-type
  return true;
}

/**
 * Load every `.json` file in `dirPath` that has a top-level `monster` array.
 * Summon-type creatures (no usable CR) are excluded from the returned bestiary
 * and reported separately so they can be handled with overrides.
 * Later files win on name collision (allows homebrew overrides).
 *
 * @param dirPath  - absolute or relative path to the bestiary folder
 * @param verbose  - log each file and skip reason (default: false)
 */
export function loadBestiaryDir(dirPath: string, verbose = false): LoadResult {
  const absDir = path.resolve(dirPath);

  if (!fs.existsSync(absDir)) {
    throw new Error(`Bestiary directory not found: ${absDir}`);
  }

  const files = fs.readdirSync(absDir).filter(f => f.endsWith('.json'));
  const loaded: { monster: Raw5etoolsMonster[] }[] = [];
  const filesLoaded: string[] = [];
  const filesSkipped: string[] = [];
  const summonTypeSkipped: string[] = [];

  for (const file of files.sort()) {
    const filePath = path.join(absDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(data.monster)) {
        filesSkipped.push(file + ' (no monster array)');
        continue;
      }

      // Filter out summon-type entries within each file
      const valid: Raw5etoolsMonster[] = [];
      for (const m of data.monster as Raw5etoolsMonster[]) {
        if (isSummonType(m)) {
          summonTypeSkipped.push(`${m.name} [${file}]`);
        } else {
          valid.push(m);
        }
      }

      if (valid.length > 0) {
        loaded.push({ monster: valid });
      }
      filesLoaded.push(file);

      if (verbose) {
        console.log(`  ${file}: ${valid.length} loaded, ${data.monster.length - valid.length} summon-type skipped`);
      }
    } catch (e) {
      filesSkipped.push(file + ` (parse error: ${(e as Error).message})`);
    }
  }

  const bestiary = loaded.length > 0 ? mergeBestiaries(...loaded) : new Map();

  return {
    bestiary,
    filesLoaded,
    filesSkipped,
    summonTypeSkipped,
    monsterCount: bestiary.size,
  };
}

/**
 * Quick summary print after loading.
 */
export function printLoadSummary(result: LoadResult): void {
  console.log(`Bestiary: ${result.monsterCount} monsters from ${result.filesLoaded.length} file(s)`);
  if (result.filesSkipped.length > 0) {
    console.warn(`  File errors: ${result.filesSkipped.join(', ')}`);
  }
  if (result.summonTypeSkipped.length > 0) {
    console.log(`  Summon-type skipped (${result.summonTypeSkipped.length}): ${result.summonTypeSkipped.join(', ')}`);
  }
}
