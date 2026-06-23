// ============================================================
// Test: Creature Megabatch Batch 2 — saves / skills / senses parser
// Run: npx ts-node --transpile-only src/test/creature_saves.test.ts
//
// Session 52 Creature Megabatch Batch 2.
// Verifies:
//   1. Adult Red Dragon: saveProficiencies = {dex:6, con:13, wis:7, cha:11};
//      senses = {blindsight:60, darkvision:120, passivePerception:23};
//      rollSave uses listed CON +13 (not derived abilityMod+profBonus).
//   2. Flying Sword: saveProficiencies = {dex:4}; senses = {blindsight:60,
//      passivePerception:7} (parenthetical "blind beyond this radius" ignored).
//   3. Lich: saveProficiencies = {con:10, int:12, wis:9}; senses includes
//      truesight:120; skillProficiencies includes arcana:19.
//   4. Bat: no saves; senses = {blindsight:60, passivePerception:11}.
//   5. Cat: no saves, no senses array, but passive=13 → senses.passivePerception=13.
//   6. Goblin: no saves; skillProficiencies={stealth:6}; senses={darkvision:60,
//      passivePerception:9}.
//   7. A creature with NO save/skill/senses/passive (synthetic) → all undefined.
//   8. rollSave: a creature WITH saveProficiencies uses the listed bonus; a
//      creature WITHOUT uses the derived abilityMod (+ prof if isProficient).
//   9. Parser shape coverage: full ability names ("dexterity"), 3-letter codes
//      ("dex"), signed values ("+6", "-1"), multiple senses, parenthetical
//      qualifiers, "passive perception N" in the senses string.
// ============================================================

import {
  mergeBestiaries,
  spawnMonster,
  monsterToCombatant,
  type Raw5etoolsMonster,
} from '../parser/fivetools';
import { rollSave } from '../engine/utils';
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

// ---- Load real bestiary once --------------------------------
const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '../../bestiaryData');
const dataFiles = fs.readdirSync(dataDir).filter((f: string) => f.endsWith('.json'));
const loadedFiles = dataFiles.map((f: string) =>
  JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'))
);
const bestiary = mergeBestiaries(...loadedFiles);

function spawn(name: string): Combatant {
  const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
  if (!c) throw new Error(`Creature not found: ${name}`);
  return c;
}

// Synthetic raw monster factory for shape-coverage tests
function mk(overrides: Partial<Raw5etoolsMonster>): Raw5etoolsMonster {
  return {
    name: 'Test', source: 'TEST', cr: '1',
    ac: [10], hp: { average: 50, formula: '1d8+2' },
    speed: { walk: 30 },
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    type: 'humanoid', size: ['M'],
    action: [],
    ...overrides,
  };
}

// ============================================================
console.log('\n=== 1. Adult Red Dragon — saves + senses + rollSave integration ===\n');
{
  const d = spawn('Adult Red Dragon');
  // Parser assertions
  eq('Dragon dex save bonus = 6',  d.saveProficiencies?.dex, 6);
  eq('Dragon con save bonus = 13', d.saveProficiencies?.con, 13);
  eq('Dragon wis save bonus = 7',  d.saveProficiencies?.wis, 7);
  eq('Dragon cha save bonus = 11', d.saveProficiencies?.cha, 11);
  assert('Dragon has no str save prof', d.saveProficiencies?.str === undefined);
  eq('Dragon blindsight = 60',  d.senses?.blindsight, 60);
  eq('Dragon darkvision = 120', d.senses?.darkvision, 120);
  eq('Dragon passivePerception = 23', d.senses?.passivePerception, 23);
  assert('Dragon has no truesight', d.senses?.truesight === undefined);
  eq('Dragon perception skill = 13', d.skillProficiencies?.perception, 13);
  eq('Dragon stealth skill = 6',     d.skillProficiencies?.stealth, 6);

  // rollSave integration: CON save with listed +13. Dragon CON is 23 (raw)
  // → abilityMod = +6; CR 17 → profBonus(CR) = +7; derived = 6+7 = 13.
  // So for the dragon, listed (13) == derived (13) — both paths agree.
  // To prove the listed path is USED (not the derived), use a synthetic
  // creature whose listed bonus DIFFERS from the derived value (section 8).
  // Here we just confirm rollSave succeeds vs a low DC.
  const r = rollSave(d, 'con', 10);
  assert('Dragon CON save vs DC 10 succeeds (uses +13 bonus)', r.success);
  assert('Dragon CON save total ≥ 13 (roll + 13, roll ≥ 1)', r.total >= 14);
}

// ============================================================
console.log('\n=== 2. Flying Sword — single save + parenthetical sense ===\n');
{
  const fs1 = spawn('Flying Sword');
  eq('Flying Sword dex save = 4', fs1.saveProficiencies?.dex, 4);
  assert('Flying Sword has no other save profs', Object.keys(fs1.saveProficiencies ?? {}).length === 1);
  eq('Flying Sword blindsight = 60 (parenthetical ignored)', fs1.senses?.blindsight, 60);
  eq('Flying Sword passivePerception = 7', fs1.senses?.passivePerception, 7);
  assert('Flying Sword has no darkvision', fs1.senses?.darkvision === undefined);
}

// ============================================================
console.log('\n=== 3. Lich — truesight + arcana skill ===\n');
{
  const l = spawn('Lich');
  eq('Lich con save = 10', l.saveProficiencies?.con, 10);
  eq('Lich int save = 12', l.saveProficiencies?.int, 12);
  eq('Lich wis save = 9',  l.saveProficiencies?.wis, 9);
  eq('Lich truesight = 120', l.senses?.truesight, 120);
  eq('Lich passivePerception = 19', l.senses?.passivePerception, 19);
  eq('Lich arcana skill = 19',    l.skillProficiencies?.arcana, 19);
  eq('Lich history skill = 12',   l.skillProficiencies?.history, 12);
  eq('Lich insight skill = 9',    l.skillProficiencies?.insight, 9);
  eq('Lich perception skill = 9', l.skillProficiencies?.perception, 9);
}

// ============================================================
console.log('\n=== 4. Bat — blindsight only, no saves ===\n');
{
  const b = spawn('Bat');
  assert('Bat has no saveProficiencies', b.saveProficiencies === undefined || Object.keys(b.saveProficiencies).length === 0);
  eq('Bat blindsight = 60', b.senses?.blindsight, 60);
  eq('Bat passivePerception = 11', b.senses?.passivePerception, 11);
  assert('Bat has no darkvision', b.senses?.darkvision === undefined);
}

// ============================================================
console.log('\n=== 5. Cat — passive only (no senses array) ===\n');
{
  const c = spawn('Cat');
  assert('Cat has no saveProficiencies', c.saveProficiencies === undefined || Object.keys(c.saveProficiencies).length === 0);
  eq('Cat passivePerception = 13 (from passive field, no senses array)', c.senses?.passivePerception, 13);
  eq('Cat perception skill = 3', c.skillProficiencies?.perception, 3);
  eq('Cat stealth skill = 4',    c.skillProficiencies?.stealth, 4);
}

// ============================================================
console.log('\n=== 6. Goblin — darkvision + stealth skill ===\n');
{
  const g = spawn('Goblin');
  assert('Goblin has no saveProficiencies', g.saveProficiencies === undefined || Object.keys(g.saveProficiencies).length === 0);
  eq('Goblin darkvision = 60', g.senses?.darkvision, 60);
  eq('Goblin passivePerception = 9', g.senses?.passivePerception, 9);
  eq('Goblin stealth skill = 6', g.skillProficiencies?.stealth, 6);
}

// ============================================================
console.log('\n=== 7. Synthetic creature with NO save/skill/senses/passive ===\n');
{
  const c = monsterToCombatant(mk({}));
  assert('No save → saveProficiencies empty/undefined',
    c.saveProficiencies === undefined || Object.keys(c.saveProficiencies).length === 0);
  assert('No skill → skillProficiencies empty/undefined',
    c.skillProficiencies === undefined || Object.keys(c.skillProficiencies).length === 0);
  assert('No senses/passive → senses undefined', c.senses === undefined);
}

// ============================================================
console.log('\n=== 8. rollSave uses LISTED bonus when present (not derived) ===\n');
{
  // Synthetic creature: CON 10 (mod 0), CR 1 (prof +2), but LISTED con save = +15.
  // Derived path would give roll + 0 + 2 = roll + 2 (max 22).
  // Listed path gives roll + 15 (max 35).
  // DC 25 → derived path fails (needs roll 23+ on a d20 = impossible);
  //          listed path succeeds on roll 10+.
  // To make it deterministic, we run 50 saves vs DC 25 and assert at least
  // one succeeds (listed path: P(success) = 55% per roll → P(50 fail) ≈ 0).
  const c = monsterToCombatant(mk({
    cr: '1', con: 10,
    save: { con: '+15' },
  }));
  let successes = 0;
  for (let i = 0; i < 50; i++) {
    // Reset any one-shot flags between iterations
    const r = rollSave(c, 'con', 25);
    if (r.success) successes++;
  }
  assert('Listed +15 CON save beats DC 25 at least once (impossible with derived +2)', successes > 0);
  assert('Listed +15 CON save beats DC 25 many times (≈55% rate)', successes >= 15,
    `got ${successes}/50`);

  // Reverse check: a creature with NO save proficiencies + CON 10 (mod 0) +
  // not proficient → derived bonus = 0. DC 25 → needs nat 20+... impossible.
  // (nat 20 is not auto-success on saves per PHB p.179 — only attacks.)
  const c2 = monsterToCombatant(mk({ cr: '1', con: 10 }));   // no save field
  let succ2 = 0;
  for (let i = 0; i < 50; i++) {
    if (rollSave(c2, 'con', 25).success) succ2++;
  }
  eq('No-save creature CON save vs DC 25 = 0 successes (derived +0, max total 20)', succ2, 0);
}

// ============================================================
console.log('\n=== 9. Parser shape coverage ===\n');
{
  // (a) Full ability names ("dexterity") instead of 3-letter codes
  const a = monsterToCombatant(mk({ save: { dexterity: '+6', constitution: '+13' } }));
  eq('Full-name "dexterity" → dex:6', a.saveProficiencies?.dex, 6);
  eq('Full-name "constitution" → con:13', a.saveProficiencies?.con, 13);

  // (b) Negative save bonus
  const b = monsterToCombatant(mk({ save: { str: '-1' } }));
  eq('Negative save bonus str:-1', b.saveProficiencies?.str, -1);

  // (c) Multiple senses + parenthetical qualifier
  const c = monsterToCombatant(mk({
    senses: ['blindsight 30 ft. (blind beyond this radius)', 'darkvision 60 ft.'],
    passive: 14,
  }));
  eq('Parenthetical ignored, blindsight=30', c.senses?.blindsight, 30);
  eq('darkvision=60', c.senses?.darkvision, 60);
  eq('passive from integer field = 14', c.senses?.passivePerception, 14);

  // (d) "passive perception N" in the senses STRING (rare but valid)
  const d = monsterToCombatant(mk({ senses: ['darkvision 60 ft.', 'passive Perception 15'] }));
  eq('passive perception in senses string → 15', d.senses?.passivePerception, 15);

  // (e) Unknown sense type silently dropped
  const e = monsterToCombatant(mk({ senses: ['darkvision 60 ft.', 'unknown sense 40 ft.'] }));
  eq('Unknown sense dropped; darkvision kept', e.senses?.darkvision, 60);
  assert('Unknown sense did not create a key', (e.senses as any)?.['unknown sense'] === undefined);

  // (f) Mixed-case skill keys lowercased
  const f = monsterToCombatant(mk({ skill: { Perception: '+13', 'Animal Handling': '+5' } }));
  eq('Skill key lowercased: perception', f.skillProficiencies?.perception, 13);
  eq('Skill key lowercased: animal handling', f.skillProficiencies?.['animal handling'], 5);

  // (g) Unknown ability key in save dropped
  const g = monsterToCombatant(mk({ save: { foo: '+9', dex: '+4' } }));
  assert('Unknown save key "foo" dropped', (g.saveProficiencies as any)?.foo === undefined);
  eq('Known save key dex kept', g.saveProficiencies?.dex, 4);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
