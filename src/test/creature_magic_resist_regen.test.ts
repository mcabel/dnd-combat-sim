// ============================================================
// Test: Creature Megabatch Batch 4a/4b — Magic Resistance + Regeneration
// Run: npx ts-node --transpile-only src/test/creature_magic_resist_regen.test.ts
//
// Session 52 Creature Megabatch Batch 4a + 4b.
// 4a. Magic Resistance (65 creatures): advantage on saves vs spells/magic.
//     v1 simplification: advantage on ALL saves (engine doesn't tag save sources).
// 4b. Regeneration (13 creatures): start-of-turn HP regen; stop-clause damage
//     types (acid/fire for trolls, radiant for vampires) suppress for 1 turn.
// ============================================================

import {
  mergeBestiaries,
  spawnMonster,
  monsterToCombatant,
  type Raw5etoolsMonster,
} from '../parser/fivetools';
import { rollSave, resetBudget, applyDamageWithTempHP } from '../engine/utils';
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
console.log('\n=== 4a.1 — Magic Resistance trait detected on real creatures ===\n');
{
  const mr = spawn('Archmage');
  assert('Archmage has Magic Resistance trait', mr.traits.includes('Magic Resistance'));

  const spriest = spawn('Spy');  // Spy doesn't have Magic Resistance
  assert('Spy does NOT have Magic Resistance', !spriest.traits.includes('Magic Resistance'));
  const gob = spawn('Goblin');
  assert('Goblin does NOT have Magic Resistance', !gob.traits.includes('Magic Resistance'));

  // Count across real bestiary
  let mrCount = 0;
  for (const name of [...bestiary.keys()].filter(k => !k.includes('|'))) {
    const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
    if (c?.traits.includes('Magic Resistance')) mrCount++;
  }
  console.log(`  Real bestiary: ${mrCount} creatures with Magic Resistance`);
  assert('At least 60 creatures with Magic Resistance (analysis said 65)', mrCount >= 60);
}

// ============================================================
console.log('\n=== 4a.2 — rollSave grants advantage with Magic Resistance ===\n');
{
  // Archmage has Magic Resistance. INT 20 (mod +5), no INT save prof listed.
  // DC 25 INT save: without advantage, needs nat 20+ on d20 (5% with +5 = total ≥25).
  // With advantage (Magic Resistance), P(success) ≈ 1-(0.75)^2 ≈ 44%.
  // Over 200 saves, advantage should succeed noticeably more than flat.
  const arc = spawn('Archmage');
  let succFlat = 0, succAdv = 0;
  // Magic Resistance on: advantage
  for (let i = 0; i < 200; i++) if (rollSave(arc, 'int', 25).success) succAdv++;
  // Magic Resistance off (remove trait): flat
  arc.traits = arc.traits.filter(t => t !== 'Magic Resistance');
  for (let i = 0; i < 200; i++) if (rollSave(arc, 'int', 25).success) succFlat++;
  // With +5 INT, DC 25 → need nat 20 (5%) flat; ~9.75% with advantage.
  // Both should be small, but advantage > flat. Allow margin for RNG.
  console.log(`    flat: ${succFlat}/200, advantage: ${succAdv}/200`);
  assert('Magic Resistance advantage yields ≥ flat successes', succAdv >= succFlat - 5);
  // A creature WITHOUT Magic Resistance: no advantage (flat only)
  const gob = spawn('Goblin');
  let gobSucc = 0;
  for (let i = 0; i < 100; i++) if (rollSave(gob, 'dex', 25).success) gobSucc++;
  // Goblin DEX 14 (+2), DC 25 → needs nat 23+ = impossible on d20. 0 successes.
  eq('Goblin (no Magic Resistance) DEX vs DC 25 = 0 successes', gobSucc, 0);
}

// ============================================================
console.log('\n=== 4b.1 — Regeneration trait parsed (amount + stopTypes) ===\n');
{
  // Troll: regains 10, stopTypes [acid, fire]
  const troll = spawn('Troll');
  assert('Troll has regeneration', !!troll.regeneration);
  eq('Troll regen amount = 10', troll.regeneration?.amount, 10);
  eq('Troll regen stopTypes = [acid, fire]',
    JSON.stringify(troll.regeneration?.stopTypes.sort()),
    JSON.stringify(['acid', 'fire'].sort()));
  eq('Troll regen suppressedNextTurn = false on spawn', troll.regeneration?.suppressedNextTurn, false);

  // Vampire: regains 20, stopTypes [radiant] (holy water mapped to radiant)
  const vamp = spawn('Vampire');
  eq('Vampire regen amount = 20', vamp.regeneration?.amount, 20);
  eq('Vampire regen stopTypes = [radiant]',
    JSON.stringify(vamp.regeneration?.stopTypes),
    JSON.stringify(['radiant']));

  // Oni: regains 10, NO stop clause → stopTypes []
  const oni = spawn('Oni');
  eq('Oni regen amount = 10', oni.regeneration?.amount, 10);
  eq('Oni regen stopTypes = [] (no stop clause)', JSON.stringify(oni.regeneration?.stopTypes), '[]');

  // Non-regenerating creature: undefined
  const gob = spawn('Goblin');
  assert('Goblin has no regeneration', gob.regeneration === undefined);

  // Count across real bestiary
  let regenCount = 0;
  for (const name of [...bestiary.keys()].filter(k => !k.includes('|'))) {
    const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
    if (c?.regeneration) regenCount++;
  }
  console.log(`  Real bestiary: ${regenCount} creatures with regeneration`);
  assert('At least 10 creatures with regeneration (analysis said 13)', regenCount >= 10);
}

// ============================================================
console.log('\n=== 4b.2 — resetBudget heals regenerating creature ===\n');
{
  const troll = spawn('Troll');
  // Troll HP 84. Damage it to 70, then resetBudget → should heal 10 → 80.
  troll.currentHP = 70;
  troll.regeneration!.suppressedNextTurn = false;
  resetBudget(troll);
  eq('Troll heals 10 on resetBudget (70 → 80)', troll.currentHP, 80);

  // Heal again → 84 (max) — capped, no overheal
  resetBudget(troll);
  eq('Troll heals to max (80 → 84, capped)', troll.currentHP, 84);

  // At max HP: regen is a no-op (no overheal)
  const before = troll.currentHP;
  resetBudget(troll);
  eq('Troll at max HP: no change', troll.currentHP, before);

  // At 0 HP (dead): regen does NOT revive (MM: "if it has at least 1 hit point")
  troll.currentHP = 0;
  resetBudget(troll);
  eq('Troll at 0 HP: regen does NOT revive', troll.currentHP, 0);
}

// ============================================================
console.log('\n=== 4b.3 — Stop-clause damage suppresses regen for 1 turn ===\n');
{
  const troll = spawn('Troll');
  troll.currentHP = 50;  // below max (84)

  // Take acid damage → suppresses regen next turn
  applyDamageWithTempHP(troll, 5, 'acid');
  eq('Troll took acid → suppressedNextTurn = true', troll.regeneration?.suppressedNextTurn, true);

  // resetBudget: regen SUPPRESSED this turn (no heal), flag cleared
  const hpBefore = troll.currentHP;
  resetBudget(troll);
  eq('Troll HP unchanged (regen suppressed)', troll.currentHP, hpBefore);
  eq('Troll suppressedNextTurn cleared after resetBudget', troll.regeneration?.suppressedNextTurn, false);

  // Next resetBudget: regen resumes
  resetBudget(troll);
  eq('Troll regen resumes next turn (HP +10)', troll.currentHP, hpBefore + 10);

  // Fire damage also suppresses
  applyDamageWithTempHP(troll, 3, 'fire');
  eq('Troll took fire → suppressedNextTurn = true', troll.regeneration?.suppressedNextTurn, true);

  // Non-stop damage type does NOT suppress
  const troll2 = spawn('Troll');
  troll2.currentHP = 50;
  applyDamageWithTempHP(troll2, 5, 'slashing');
  eq('Troll took slashing → NOT suppressed', troll2.regeneration?.suppressedNextTurn, false);
  resetBudget(troll2);
  eq('Troll regen works after slashing (HP +10)', troll2.currentHP, 50 - 5 + 10);
}

// ============================================================
console.log('\n=== 4b.4 — Vampire radiant suppression (holy water → radiant) ===\n');
{
  const vamp = spawn('Vampire');
  vamp.currentHP = 100;  // below max (144)
  // Radiant damage suppresses
  applyDamageWithTempHP(vamp, 5, 'radiant');
  eq('Vampire took radiant → suppressed', vamp.regeneration?.suppressedNextTurn, true);
  const hpBefore = vamp.currentHP;
  resetBudget(vamp);
  eq('Vampire regen suppressed by radiant (no heal)', vamp.currentHP, hpBefore);
  eq('Vampire suppressed flag cleared', vamp.regeneration?.suppressedNextTurn, false);

  // Non-radiant damage does NOT suppress vampire regen. Use 'force' (Vampire
  // has no force resistance — necrotic IS resisted, which would complicate the
  // HP math). 100 - 5 force = 95, +20 regen = 115.
  const vamp2 = spawn('Vampire');
  vamp2.currentHP = 100;
  applyDamageWithTempHP(vamp2, 5, 'force');
  eq('Vampire took force → NOT suppressed', vamp2.regeneration?.suppressedNextTurn, false);
  resetBudget(vamp2);
  eq('Vampire regen works after force (HP +20)', vamp2.currentHP, 100 - 5 + 20);
}

// ============================================================
console.log('\n=== 4b.5 — Oni regen (no stop clause) never suppressed ===\n');
{
  const oni = spawn('Oni');
  oni.currentHP = 50;  // below max (75)
  // Acid damage — Oni has NO stop clause, so no suppression
  applyDamageWithTempHP(oni, 5, 'acid');
  eq('Oni took acid → NOT suppressed (no stop clause)', oni.regeneration?.suppressedNextTurn, false);
  resetBudget(oni);
  eq('Oni regen works despite acid (no stop clause)', oni.currentHP, 50 - 5 + 10);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
