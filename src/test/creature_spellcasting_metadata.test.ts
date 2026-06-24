// ============================================================
// Test: Session 60 — Monster Spellcasting metadata parser (Batch 5b step 1)
//
// Validates that parseMonsterSpellcasting extracts:
//   - saveDC from {@dc N} in headerEntries
//   - spellAttackBonus from {@hit N} in headerEntries
//   - ability (int/wis/cha) from headerEntries text
//   - atWill spell names from the `will` array
//   - daily spell names + uses/day from the `daily` object
//   - slot-based spells from the `spells` object (Lich, Mage, etc.)
//
// v1: metadata-only — NOT consumed by the engine. This test verifies the
// parser extracts the correct data for future Batch 5b step 2 (engine
// integration — HIGH-risk, deferred).
//
// Coverage (15 assertions):
//   1. Lich has monsterSpellcasting
//   2. Lich saveDC = 20
//   3. Lich spellAttackBonus = 12
//   4. Lich ability = int
//   5. Lich has slot-based spells (L1-L9)
//   6. Lich L1 has 4 slots
//   7. Lich L9 has 1 slot
//   8. Drow has monsterSpellcasting
//   9. Drow saveDC = 11
//  10. Drow ability = cha
//  11. Drow atWill includes Dancing Lights
//  12. Drow daily includes Darkness (1/day)
//  13. Mage has monsterSpellcasting + slot-based spells
//  14. Mage saveDC = 14, spellAttackBonus = 6
//  15. Non-spellcasting creature (Goblin) has NO monsterSpellcasting
//
// Run: npx ts-node --transpile-only src/test/creature_spellcasting_metadata.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { Combatant, Vec3 } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Load bestiary ------------------------------------------

const NEEDED_SOURCES = ['mm-2014', 'aatm'];
const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const files = allFiles.filter(f =>
  NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
const fallbackFiles = files.length > 0 ? files : allFiles.filter(f => f !== 'bestiary-mm.json');
const loaded = fallbackFiles.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ============================================================
// 1-7. Lich (MM, slot-based spellcasting)
// ============================================================
console.log('\n--- 1-7. Lich spellcasting ---');
{
  const c = spawn('Lich');
  assert('1. Lich has monsterSpellcasting', c.monsterSpellcasting !== undefined);
  if (c.monsterSpellcasting) {
    eq('2. Lich saveDC = 20', c.monsterSpellcasting.saveDC, 20);
    eq('3. Lich spellAttackBonus = 12', c.monsterSpellcasting.spellAttackBonus, 12);
    eq('4. Lich ability = int', c.monsterSpellcasting.ability, 'int');
    assert('5. Lich has slot-based spells (L1-L9)', c.monsterSpellcasting.slots !== undefined);
    if (c.monsterSpellcasting.slots) {
      eq('6. Lich L1 has 4 slots', c.monsterSpellcasting.slots[1]?.max, 4);
      eq('7. Lich L9 has 1 slot', c.monsterSpellcasting.slots[9]?.max, 1);
    }
  }
}

// ============================================================
// 8-12. Drow (MM, innate spellcasting — at-will + daily)
// ============================================================
console.log('\n--- 8-12. Drow spellcasting ---');
{
  const c = spawn('Drow');
  assert('8. Drow has monsterSpellcasting', c.monsterSpellcasting !== undefined);
  if (c.monsterSpellcasting) {
    eq('9. Drow saveDC = 11', c.monsterSpellcasting.saveDC, 11);
    eq('10. Drow ability = cha', c.monsterSpellcasting.ability, 'cha');
    assert('11. Drow atWill includes Dancing Lights',
      c.monsterSpellcasting.atWill?.some(s => /dancing lights/i.test(s)) === true);
    assert('12. Drow daily includes darkness (1/day)',
      c.monsterSpellcasting.daily?.['darkness'] === 1);
  }
}

// ============================================================
// 13-14. Mage (MM, slot-based spellcasting)
// ============================================================
console.log('\n--- 13-14. Mage spellcasting ---');
{
  const c = spawn('Mage');
  assert('13. Mage has monsterSpellcasting + slot-based spells',
    c.monsterSpellcasting?.slots !== undefined);
  if (c.monsterSpellcasting) {
    eq('14a. Mage saveDC = 14', c.monsterSpellcasting.saveDC, 14);
    eq('14b. Mage spellAttackBonus = 6', c.monsterSpellcasting.spellAttackBonus, 6);
  }
}

// ============================================================
// 15. Non-spellcasting creature has NO monsterSpellcasting
// ============================================================
console.log('\n--- 15. Non-spellcasting creature ---');
{
  const c = spawn('Goblin');
  eq('15. Goblin has NO monsterSpellcasting', c.monsterSpellcasting, undefined);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
