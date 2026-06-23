// ============================================================
// Test: Creature Megabatch Batch 4c/4e — Magic Weapons, Blood Frenzy, Swarm, Siege Monster
// Run: npx ts-node --transpile-only src/test/creature_traits_4ce.test.ts
//
// Session 52 Creature Megabatch Batch 4c + 4e.
// 4c. Magic Weapons (19): flag parsed; full nonmagical-resistance bypass
//     deferred (documented).
// 4e. Blood Frenzy (7): advantage on melee attacks vs bloodied targets.
//     Swarm (10): cannot regain HP / gain temp HP.
//     Siege Monster (5): metadata flag (no object HP in v1).
// ============================================================

import { mergeBestiaries, spawnMonster } from '../parser/fivetools';
import { attackAdvantageState, grantTempHP, resetBudget } from '../engine/utils';
import type { Combatant } from '../types/core';

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean | undefined | null, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected;
  assert(label, ok, ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '../../bestiaryData');
const dataFiles = fs.readdirSync(dataDir).filter((f: string) => f.endsWith('.json'));
const loadedFiles = dataFiles.map((f: string) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loadedFiles);

function spawn(name: string): Combatant {
  const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
  if (!c) throw new Error(`Creature not found: ${name}`);
  return c;
}

// ============================================================
console.log('\n=== 4c.1 — Magic Weapons flag parsed ===\n');
{
  const sphinx = spawn('Androsphinx');
  assert('Androsphinx has attacksAreMagical=true', sphinx.attacksAreMagical === true);
  const gob = spawn('Goblin');
  assert('Goblin attacksAreMagical falsy (no trait)', !gob.attacksAreMagical);

  // Count across real bestiary
  let mwCount = 0;
  for (const name of [...bestiary.keys()].filter(k => !k.includes('|'))) {
    const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
    if (c?.attacksAreMagical) mwCount++;
  }
  console.log(`  Real bestiary: ${mwCount} creatures with Magic Weapons`);
  assert('At least 15 creatures with Magic Weapons (analysis said 19)', mwCount >= 15);
}

// ============================================================
console.log('\n=== 4e.1 — Blood Frenzy: advantage vs bloodied targets ===\n');
{
  const shark = spawn('Giant Shark');
  assert('Giant Shark has Blood Frenzy trait', shark.traits.includes('Blood Frenzy'));

  // Target at full HP → no advantage
  const fullTarget = spawn('Goblin');
  fullTarget.currentHP = fullTarget.maxHP;
  const advFull = attackAdvantageState(shark, fullTarget);
  assert('Blood Frenzy: NO advantage vs full-HP target', !advFull.advantage);

  // Target bloodied (currentHP < maxHP) → advantage
  const bloodied = spawn('Goblin');
  bloodied.currentHP = Math.floor(bloodied.maxHP / 2);
  const advBloodied = attackAdvantageState(shark, bloodied);
  assert('Blood Frenzy: advantage vs bloodied target', advBloodied.advantage);

  // A creature WITHOUT Blood Frenzy → no advantage vs bloodied
  const gob = spawn('Goblin');
  gob.currentHP = 1;
  const advGob = attackAdvantageState(gob, bloodied);
  assert('No Blood Frenzy: no advantage vs bloodied', !advGob.advantage);

  // Count
  let bfCount = 0;
  for (const name of [...bestiary.keys()].filter(k => !k.includes('|'))) {
    const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
    if (c?.traits.includes('Blood Frenzy')) bfCount++;
  }
  console.log(`  Real bestiary: ${bfCount} creatures with Blood Frenzy`);
  assert('At least 5 creatures with Blood Frenzy (analysis said 7)', bfCount >= 5);
}

// ============================================================
console.log('\n=== 4e.2 — Swarm: cannot regain HP / gain temp HP ===\n');
{
  const swarm = spawn('Swarm of Bats');
  assert('Swarm of Bats has cannotRegainHP=true', swarm.cannotRegainHP === true);
  assert('Swarm of Bats has Swarm trait', swarm.traits.includes('Swarm'));

  // grantTempHP is a no-op on a swarm
  swarm.tempHP = 0;
  grantTempHP(swarm, 10);
  eq('Swarm: grantTempHP no-op (tempHP stays 0)', swarm.tempHP, 0);

  // grantTempHP works normally on a non-swarm
  const gob = spawn('Goblin');
  gob.tempHP = 0;
  grantTempHP(gob, 10);
  eq('Non-swarm: grantTempHP works (tempHP=10)', gob.tempHP, 10);

  // Count
  let swarmCount = 0;
  for (const name of [...bestiary.keys()].filter(k => !k.includes('|'))) {
    const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
    if (c?.cannotRegainHP) swarmCount++;
  }
  console.log(`  Real bestiary: ${swarmCount} swarm creatures`);
  assert('At least 8 swarm creatures (analysis said 10)', swarmCount >= 8);
}

// ============================================================
console.log('\n=== 4e.3 — Swarm blocks regeneration (cross-trait) ===\n');
{
  // Synthetic: a swarm that somehow has regeneration (no real creature has both,
  // but the engine guard should still prevent healing). Set regen manually.
  const swarm = spawn('Swarm of Bats');
  swarm.regeneration = { amount: 10, stopTypes: [], suppressedNextTurn: false };
  swarm.currentHP = Math.floor(swarm.maxHP / 2);  // bloodied, below max
  const hpBefore = swarm.currentHP;
  resetBudget(swarm);
  // Swarm can't regain HP → regen blocked
  eq('Swarm with regen field: no heal (cannotRegainHP blocks it)', swarm.currentHP, hpBefore);

  // Non-swarm with regen: heals normally (Troll control)
  const troll = spawn('Troll');
  troll.currentHP = 50;
  resetBudget(troll);
  eq('Troll (non-swarm) heals 10', troll.currentHP, 60);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
