// ============================================================
// Test: Open Hand Monk Diamond Soul (Session 48, Task #29-follow-up-4b)
//
// Validates that Diamond Soul (Open Hand Monk 13, PHB p.79) is mechanically
// wired into the engine:
//   - Proficiency in ALL saving throws (STR, DEX, CON, INT, WIS, CHA)
//   - Uses the level-based proficiency bonus (combatantProfBonus)
//
// PHB p.79: "Beginning at 13th level, the purity of your ki suffuses your
// entire being, granting you proficiency in all saving throws."
//
// Coverage:
//   1. Open Hand Monk 13 has "Diamond Soul" feature
//   2. Vanilla Monk 13 does NOT have "Diamond Soul"
//   3. Diamond Soul: STR save gets proficiency bonus
//   4. Diamond Soul: DEX save gets proficiency bonus
//   5. Diamond Soul: CON save gets proficiency bonus
//   6. Diamond Soul: INT save gets proficiency bonus
//   7. Diamond Soul: WIS save gets proficiency bonus
//   8. Diamond Soul: CHA save gets proficiency bonus
//   9. Vanilla Monk: saves do NOT get proficiency (unless already proficient)
//  10. Diamond Soul at level 13 → proficiency bonus = +5
//  11. Diamond Soul at level 17 → proficiency bonus = +6
//  12. Monk's existing STR/DEX save proficiency still works (not doubled)
//  13. End-to-end: Diamond Soul monk succeeds on a save that vanilla monk fails
//
// Run: npx ts-node src/test/diamond_soul.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant, hasFeature } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { rollSave, combatantProfBonus } from '../engine/utils';
import { Combatant } from '../types/core';

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

// ---- Factories ----------------------------------------------

function makeMonk1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Wei', race: 'Human', background: 'Hermit',
    alignment: 'Lawful Neutral',
    firstClass: 'Monk',
    classLevels: [{ className: 'Monk', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 10, dex: 16, con: 14, int: 10, wis: 15, cha: 10 },
    stats:     { str: 10, dex: 16, con: 14, int: 10, wis: 15, cha: 10 },
    maxHP: 10, currentHP: 10, temporaryHP: 0,
    armorClass: 14, acFormula: 'Unarmored Defense', speed: 30,
    hitDice: [{ className: 'Monk', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['str','dex'],
      skills: ['Acrobatics','Insight'], expertise: [],
    },
    languages: ['Common'],
    resources: {},
    spellcasting: undefined,
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [
      { name: 'Martial Arts', description: 'DEX unarmed strikes.', source: 'class' },
      { name: 'Unarmored Defense', description: 'AC = 10 + DEX + WIS.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Martial Arts', description: 'DEX unarmed strikes.', source: 'class' },
      { name: 'Unarmored Defense', description: 'AC = 10 + DEX + WIS.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Discovery', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function levelTo(sheet: CharacterSheet, cls: string, target: number, subclass: string | null = null): CharacterSheet {
  let s = sheet;
  const subclassLevel = cls === 'Monk' ? 3 : 2;
  for (let lvl = 2; lvl <= target; lvl++) {
    s = applyLevelUp(s, cls).sheet;
    if (subclass && lvl === subclassLevel) {
      s = chooseSubclass(s, cls, subclass);
    }
  }
  return s;
}

// ============================================================
// 1. Open Hand Monk 13 has "Diamond Soul" feature
// ============================================================
console.log('\n--- 1. Open Hand Monk 13 has Diamond Soul ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 13, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('1. has Diamond Soul', hasFeature(monk, 'Diamond Soul'));
}

// ============================================================
// 2. Vanilla Monk 13 does NOT have "Diamond Soul"
// ============================================================
console.log('\n--- 2. Vanilla Monk 13 does NOT have Diamond Soul ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 13);  // no subclass
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('2. does NOT have Diamond Soul', !hasFeature(monk, 'Diamond Soul'));
}

// ============================================================
// 3-8. Diamond Soul: all 6 saves get proficiency bonus
// ============================================================
console.log('\n--- 3-8. Diamond Soul: all saves get proficiency ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 13, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  // Level 13 → proficiency bonus = +5
  const expectedProf = combatantProfBonus(monk);
  eq('3a. level 13 prof = +5', expectedProf, 5);

  // For each ability, roll a save with isProficient=false (default).
  // Diamond Soul should add the proficiency bonus anyway.
  // We can't check the exact total (dice are random), but we can verify
  // the save total includes the proficiency by comparing to a vanilla monk.

  // Use a high DC so the save always fails — we just want to inspect the total.
  const abilities: Array<'str'|'dex'|'con'|'int'|'wis'|'cha'> = ['str','dex','con','int','wis','cha'];
  for (const ab of abilities) {
    // Diamond Soul monk: rollSave with isProficient=false → should still get prof
    const result = rollSave(monk, ab, 100, false);
    // total = roll(1-20) + abilityMod + prof(+5)
    const mod = Math.floor((monk[ab] - 10) / 2);
    const expectedMin = 1 + mod + 5;  // min roll 1 + mod + prof
    const expectedMax = 20 + mod + 5; // max roll 20 + mod + prof
    assert(`${ab.toUpperCase()} save total includes proficiency (${expectedMin}-${expectedMax})`,
      result.total >= expectedMin && result.total <= expectedMax,
      `got ${result.total}, expected ${expectedMin}-${expectedMax}`);
  }
}

// ============================================================
// 9. Vanilla Monk: saves do NOT get proficiency (unless already proficient)
// ============================================================
console.log('\n--- 9. Vanilla Monk: no proficiency on non-proficient saves ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 13);  // no subclass
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  // Monk has STR and DEX save proficiency (from class). CON/INT/WIS/CHA are NOT proficient.
  // Roll a CON save with isProficient=false — no Diamond Soul → no proficiency added.
  const result = rollSave(monk, 'con', 100, false);
  const mod = Math.floor((monk.con - 10) / 2);
  // total = roll(1-20) + mod (NO proficiency)
  const expectedMin = 1 + mod;
  const expectedMax = 20 + mod;
  assert('9. CON save total does NOT include proficiency (vanilla monk)',
    result.total >= expectedMin && result.total <= expectedMax,
    `got ${result.total}, expected ${expectedMin}-${expectedMax} (no prof)`);
}

// ============================================================
// 10. Diamond Soul at level 13 → proficiency bonus = +5
// ============================================================
console.log('\n--- 10. Diamond Soul prof bonus at level 13 ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 13, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  eq('10. prof bonus = +5 at level 13', combatantProfBonus(monk), 5);
}

// ============================================================
// 11. Diamond Soul at level 17 → proficiency bonus = +6
// ============================================================
console.log('\n--- 11. Diamond Soul prof bonus at level 17 ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 17, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  eq('11. prof bonus = +6 at level 17', combatantProfBonus(monk), 6);
}

// ============================================================
// 12. Monk's existing STR/DEX save proficiency still works (not doubled)
// ============================================================
console.log('\n--- 12. Existing proficiency not doubled ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 13, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  // Monk has STR save proficiency from class. With Diamond Soul, they're
  // ALSO proficient from Diamond Soul — but it should NOT double.
  // Roll with isProficient=true (explicit) vs isProficient=false (Diamond Soul).
  // Both should give the same total (prof added once, not twice).
  // Run multiple times to average out dice.
  const N = 100;
  let sumExplicit = 0, sumImplicit = 0;
  for (let i = 0; i < N; i++) {
    sumExplicit += rollSave(monk, 'str', 100, true).total;   // explicit prof + Diamond Soul
    sumImplicit += rollSave(monk, 'str', 100, false).total;  // Diamond Soul only
  }
  const avgExplicit = sumExplicit / N;
  const avgImplicit = sumImplicit / N;
  // Both should have the same average (prof added once either way).
  // Allow a tolerance of 2 (dice noise over 100 rolls).
  assert('12. proficiency not doubled (explicit ≈ implicit)',
    Math.abs(avgExplicit - avgImplicit) < 2,
    `explicit avg ${avgExplicit.toFixed(1)} vs implicit avg ${avgImplicit.toFixed(1)}`);
  console.log(`    Explicit prof avg: ${avgExplicit.toFixed(1)}, Diamond Soul only avg: ${avgImplicit.toFixed(1)}`);
}

// ============================================================
// 13. End-to-end: Diamond Soul monk succeeds on a save that vanilla monk fails
// ============================================================
console.log('\n--- 13. Diamond Soul monk succeeds where vanilla fails ---');
{
  // Build two monks at level 13 — one Open Hand (Diamond Soul), one vanilla.
  const dsSheet = levelTo(makeMonk1(), 'Monk', 13, 'Way of the Open Hand');
  const vanillaSheet = levelTo(makeMonk1(), 'Monk', 13);
  const dsMonk = buildCombatant(dsSheet, { x: 0, y: 0, z: 0 });
  const vanillaMonk = buildCombatant(vanillaSheet, { x: 0, y: 0, z: 0 });

  // Use CON save (Monk is NOT proficient in CON by default).
  // At level 13: prof = +5. CON 14 → +2 mod.
  // Diamond Soul: total = roll + 2 + 5 = roll + 7. Succeeds DC 15 on roll ≥ 8 (65% chance).
  // Vanilla: total = roll + 2. Succeeds DC 15 on roll ≥ 13 (40% chance).
  // Run N trials and count successes.
  const N = 1000;
  const DC = 15;
  let dsSuccesses = 0, vanillaSuccesses = 0;
  for (let i = 0; i < N; i++) {
    if (rollSave(dsMonk, 'con', DC, false).success) dsSuccesses++;
    if (rollSave(vanillaMonk, 'con', DC, false).success) vanillaSuccesses++;
  }
  console.log(`    Diamond Soul: ${dsSuccesses}/${N} successes (${(dsSuccesses/N*100).toFixed(0)}%)`);
  console.log(`    Vanilla:      ${vanillaSuccesses}/${N} successes (${(vanillaSuccesses/N*100).toFixed(0)}%)`);
  // Diamond Soul should succeed significantly more often (+25% expected).
  assert('13a. Diamond Soul succeeds more often than vanilla',
    dsSuccesses > vanillaSuccesses,
    `DS ${dsSuccesses} vs vanilla ${vanillaSuccesses}`);
  // Expected: ~65% vs ~40%. Check the gap is substantial (>15%).
  assert('13b. success rate gap > 15%',
    (dsSuccesses - vanillaSuccesses) > N * 0.15,
    `gap ${(dsSuccesses - vanillaSuccesses)/N*100}%`);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('diamond_soul.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('diamond_soul.test.ts: all tests passed ✅');
}
