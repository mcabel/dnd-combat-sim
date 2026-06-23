// ============================================================
// Test: Creature Traits 4h — Rejuvenation (Session 53 Batch 4h)
//
// Validates that the Rejuvenation trait is parsed correctly for
// Lich, Mummy Lord, Revenant, Guardian Naga, Flameskull.
// v1 metadata-only — no engine hook (trait only matters in multi-day
// scenarios, not simulated in v1).
//
// Run: npx ts-node src/test/creature_traits_4h.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  Raw5etoolsMonster,
} from '../parser/fivetools';
import { Combatant, Vec3 } from '../types/core';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

const NEEDED_SOURCES = ['mm-2014', 'mm', 'dmg'];
function loadBestiary(): Map<string, Raw5etoolsMonster> {
  const dir = path.join(__dirname, '../../bestiaryData');
  const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const files = allFiles.filter(f => NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
  const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  return mergeBestiaries(...loaded);
}
const bestiary = loadBestiary();

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ============================================================
console.log('\n=== 1. Parser — Rejuvenation (Lich) ===\n');
{
  const lich = spawn('Lich');
  assert('Lich has rejuvenation', lich.rejuvenation !== undefined);
  if (lich.rejuvenation) {
    // Lich: "1d10 days" → min roll = 1 day = 24 hours
    eq('Lich reformTimeHours = 24 (1d10 days min)', lich.rejuvenation.reformTimeHours, 24);
    assert('Lich conditionText mentions phylactery',
      lich.rejuvenation.conditionText?.includes('phylactery') === true);
  }
}

// ============================================================
console.log('\n=== 2. Parser — Rejuvenation (Mummy Lord) ===\n');
{
  const mummy = spawn('Mummy Lord');
  assert('Mummy Lord has rejuvenation', mummy.rejuvenation !== undefined);
  if (mummy.rejuvenation) {
    eq('Mummy Lord reformTimeHours = 24', mummy.rejuvenation.reformTimeHours, 24);
    assert('Mummy Lord conditionText mentions heart',
      mummy.rejuvenation.conditionText?.includes('heart') === true);
  }
}

// ============================================================
console.log('\n=== 3. Parser — Rejuvenation (Flameskull, 1 hour) ===\n');
{
  const fs = spawn('Flameskull');
  assert('Flameskull has rejuvenation', fs.rejuvenation !== undefined);
  if (fs.rejuvenation) {
    eq('Flameskull reformTimeHours = 1', fs.rejuvenation.reformTimeHours, 1);
    assert('Flameskull conditionText mentions holy water or dispel',
      fs.rejuvenation.conditionText?.includes('Holy Water') === true ||
      fs.rejuvenation.conditionText?.includes('dispel') === true);
  }
}

// ============================================================
console.log('\n=== 4. Parser — Rejuvenation (Guardian Naga, 1d6 days) ===\n');
{
  const naga = spawn('Guardian Naga');
  assert('Guardian Naga has rejuvenation', naga.rejuvenation !== undefined);
  if (naga.rejuvenation) {
    eq('Guardian Naga reformTimeHours = 24 (1d6 days min)', naga.rejuvenation.reformTimeHours, 24);
  }
}

// ============================================================
console.log('\n=== 5. Parser — Revenant (no condition) ===\n');
{
  const rev = spawn('Revenant');
  assert('Revenant has rejuvenation', rev.rejuvenation !== undefined);
  if (rev.rejuvenation) {
    eq('Revenant reformTimeHours = 24', rev.rejuvenation.reformTimeHours, 24);
  }
}

// ============================================================
console.log('\n=== 6. Parser — Goblin has NO rejuvenation ===\n');
{
  const goblin = spawn('Goblin');
  eq('Goblin has NO rejuvenation', goblin.rejuvenation, undefined);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
