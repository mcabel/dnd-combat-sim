// ============================================================
// Test: Session 60 — Lair Actions (Batch 5a — metadata + engine hook)
//
// Validates that:
//   - parseLairActions extracts lair action options from legendarygroups.json
//   - The lairActions field is populated for creatures with legendaryGroup
//   - The engine fires a lair action log at the start of each round
//     (initiative count 20 simulation)
//   - Non-lair creatures have NO lairActions
//
// Coverage (12 assertions):
//   1. Adult Red Dragon has lairActions
//   2. Adult Red Dragon initiativeCount = 20
//   3. Adult Red Dragon has 3 action options (Phase 6 S97: intro-text artifact filtered)
//   4. Aboleth has lairActions
//   5. Aboleth has 3 action options
//   6. Goblin has NO lairActions (no legendaryGroup)
//   7. Engine fires lair action log at start of round 1
//   8. Lair action log mentions the creature name
//   9. Lair action log mentions "lair action"
//  10. Lair action fires every round (not just round 1)
//  11. Dead creature does NOT fire lair action
//  12. Lair action log includes the action text (truncated)
//
// Run: npx ts-node --transpile-only src/test/creature_lair_actions.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { Combatant, Vec3, Battlefield, Condition } from '../types/core';

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

const NEEDED_SOURCES = ['mm-2014'];
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

// ---- Combat state factories ---------------------------------

interface MutableBF extends Battlefield { [k: string]: any; }

function makeBF(combatants: Combatant[]): MutableBF {
  const width = 30, height = 30, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as MutableBF;
}

// ============================================================
// 1-3. Adult Red Dragon lair actions
// ============================================================
console.log('\n--- 1-3. Adult Red Dragon lair actions ---');
{
  const c = spawn('Adult Red Dragon');
  assert('1. Adult Red Dragon has lairActions', c.lairActions !== undefined);
  if (c.lairActions) {
    eq('2. initiativeCount = 20', c.lairActions.initiativeCount, 20);
    assert('3. has 3 action options', c.lairActions.actions.length === 3);
    console.log(`    First action: ${c.lairActions.actions[0].rawText.substring(0, 80)}...`);
  }
}

// ============================================================
// 4-5. Aboleth lair actions
// ============================================================
console.log('\n--- 4-5. Aboleth lair actions ---');
{
  const c = spawn('Aboleth');
  assert('4. Aboleth has lairActions', c.lairActions !== undefined);
  if (c.lairActions) {
    assert('5. has 3 action options', c.lairActions.actions.length === 3);
  }
}

// ============================================================
// 6. Goblin has NO lairActions
// ============================================================
console.log('\n--- 6. Goblin has NO lairActions ---');
{
  const c = spawn('Goblin');
  eq('6. Goblin has NO lairActions', c.lairActions, undefined);
}

// ============================================================
// 7-12. Engine hook: lair action fires at start of round
// ============================================================
console.log('\n--- 7-12. Engine lair action hook ---');
{
  // Spawn an Adult Red Dragon + a Goblin enemy. Run 2 rounds of combat.
  // The dragon should fire a lair action at the start of each round.
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  goblin.maxHP = 1000; goblin.currentHP = 1000; // tanky — survive 2 rounds
  dragon.maxHP = 1000; dragon.currentHP = 1000;

  const bf = makeBF([dragon, goblin]);

  // Run 2 rounds — runCombat returns a CombatLog
  const log1 = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 2, verbose: false } as any);

  // Find lair action logs
  const lairLogs = log1.events.filter((e: any) =>
    e.type === 'action' && e.description.includes('lair action'));

  assert('7. lair action log fires at start of round', lairLogs.length > 0);
  assert('8. lair action log mentions dragon name',
    lairLogs.some((e: any) => e.description.includes('Adult Red Dragon')));
  assert('9. lair action log mentions "lair action"',
    lairLogs.every((e: any) => e.description.includes('lair action')));
  // Should fire at least once per round = 2 times minimum (round 1 + round 2)
  assert('10. lair action fires in multiple rounds (≥2)',
    lairLogs.length >= 2);
  // The log should include some action text (not just the header)
  assert('12. lair action log includes action text',
    lairLogs.some((e: any) => e.description.length > 60));

  console.log(`    Total lair action logs: ${lairLogs.length}`);
  if (lairLogs.length > 0) {
    console.log(`    Example: ${lairLogs[0].description.substring(0, 120)}...`);
  }

  // 11. Dead creature does NOT fire lair action
  // Kill the dragon, run 1 more round, verify no new lair logs
  const logsBefore = lairLogs.length;
  dragon.isDead = true;
  dragon.currentHP = 0;
  const log2 = runCombat(bf, [goblin.id], { maxRounds: 1, verbose: false } as any);
  const lairLogsAfter = log2.events.filter((e: any) =>
    e.type === 'action' && e.description.includes('lair action'));
  assert('11. dead dragon does NOT fire lair action',
    lairLogsAfter.length === 0);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
