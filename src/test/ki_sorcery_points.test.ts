// ============================================================
// Test: TG-024 — Monk Ki + Sorcerer Sorcery Points transfer to Combatant
//
// Validates that ki (Monk, PHB p.76) and sorceryPoints (Sorcerer, PHB p.101)
// are transferred from the CharacterSheet (populated by leveler.ts) through
// the buildCombatant → sheetToRawEntry → buildRawResources → buildResources
// pipeline onto the Combatant's PlayerResources.
//
// Before TG-024: both buildRawResources (builder.ts) and buildResources
// (pc.ts) SKIPPED these fields — a Monk or Sorcerer PC had zero ki /
// sorcery points in combat. This blocked TG-030 (Quivering Palm, 3 ki),
// TG-031 (Open Hand Technique, Flurry 1 ki), and the 5-SP cost on
// Draconic Presence.
//
// The leveler populates:
//   - ki: { max: monkLevel, remaining: monkLevel } for Monk 2+ (PHB p.76:
//     "At 2nd level, you gain the ability to use ki." Monk 1 has NO ki).
//   - sorceryPoints: { max: sorcererLevel, remaining: sorcererLevel } for
//     Sorcerer 2+ (PHB p.101: "At 2nd level, you tap into a deep wellspring
//     of magic within yourself."). Sorcerer 1 has NO sorceryPoints.
//
// Coverage (18 assertions):
//   1. Monk 5: has ki on the Combatant
//   2. Monk 5: ki.max === 5 (monk level)
//   3. Monk 5: ki.remaining === 5 (full on combat start)
//   4a. Monk 1: NO ki (unlocks at level 2, PHB p.76)
//   4b. Monk 2: has ki (unlock point)
//   5. Monk 2: ki.max === 2
//   6. Monk 5 (Open Hand): ki still transfers with subclass chosen
//   7. Sorcerer 5: has sorceryPoints on the Combatant
//   8. Sorcerer 5: sorceryPoints.max === 5 (sorcerer level)
//   9. Sorcerer 5: sorceryPoints.remaining === 5
//  10. Sorcerer 1: NO sorceryPoints (unlocks at level 2)
//  11. Sorcerer 5 (Draconic Bloodline): sorceryPoints transfers with subclass
//  12. Fighter 5: NO ki (wrong class)
//  13. Fighter 5: NO sorceryPoints (wrong class)
//  14. Fighter 5: actionSurge STILL works (regression — pipeline intact)
//  15. Barbarian 5: rage STILL works (regression)
//  16. Monk 5 sheet.resources.ki is the SOURCE (leveler side unaffected)
//  17. Sorcerer 5 sheet.resources.sorceryPoints is the SOURCE
//  18. Monk 5 + Sorcerer 5 resources are independent (no cross-contamination)
//
// Run: npx ts-node --transpile-only src/test/ki_sorcery_points.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
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

function makeSheet(
  cls: string,
  stats: { str: number; dex: number; con: number; int: number; wis: number; cha: number },
): CharacterSheet {
  return {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: `Test${cls}`,
    race: 'Human', background: 'Sage',
    alignment: 'Neutral',
    firstClass: cls,
    classLevels: [{ className: cls, level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: stats,
    stats,
    maxHP: 8, currentHP: 8, temporaryHP: 0,
    armorClass: 12, acFormula: 'No armor + DEX', speed: 30,
    hitDice: [{ className: cls, dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee', 'simple-ranged'],
      tools: [], savingThrows: ['con'],
      skills: ['Athletics'], expertise: [],
    },
    languages: ['Common'],
    resources: {},
    spellcasting: {
      ability: 'cha', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: [],
      knownSpells: [], preparedSpells: [], spellbook: [],
    },
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [],
    allFeatures: [],
    feats: [], backgroundFeature: 'Researcher', exhaustionLevel: 0, levelHistory: [],
  };
}

/**
 * Level a sheet to `target` in `cls`, optionally choosing `subclass` at the
 * class's canonical subclass level (Sorcerer 1, Druid 2, Fighter/Monk 3).
 * Mirrors the levelTo() helper in elemental_affinity.test.ts.
 */
function levelTo(
  sheet: CharacterSheet,
  cls: string,
  target: number,
  subclass: string | null = null,
): CharacterSheet {
  let s = sheet;
  if (subclass && cls === 'Sorcerer') {
    s = chooseSubclass(s, cls, subclass);
  }
  const subclassLevel = cls === 'Druid' ? 2 : cls === 'Fighter' || cls === 'Monk' ? 3 : 1;
  for (let lvl = 2; lvl <= target; lvl++) {
    s = applyLevelUp(s, cls).sheet;
    if (subclass && cls !== 'Sorcerer' && lvl === subclassLevel) {
      s = chooseSubclass(s, cls, subclass);
    }
  }
  return s;
}

// Monk: DEX + WIS matter (Unarmored Defense); CON for HP
function makeMonk1(): CharacterSheet {
  return makeSheet('Monk', { str: 10, dex: 16, con: 14, int: 10, wis: 14, cha: 10 });
}
// Sorcerer: CHA matters
function makeSorcerer1(): CharacterSheet {
  return makeSheet('Sorcerer', { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 17 });
}
// Fighter: STR/CON
function makeFighter1(): CharacterSheet {
  return makeSheet('Fighter', { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 });
}
// Barbarian: STR/CON
function makeBarbarian1(): CharacterSheet {
  return makeSheet('Barbarian', { str: 16, dex: 14, con: 16, int: 10, wis: 10, cha: 8 });
}

// =============================================================
// 1-3. Monk 5: ki transferred correctly
// =============================================================
console.log('\n--- 1-3. Monk 5 ki transfer ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 5);
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('1. Monk 5 has ki on Combatant', monk.resources?.ki !== undefined);
  if (monk.resources?.ki) {
    eq('2. Monk 5 ki.max === 5 (monk level)', monk.resources.ki.max, 5);
    eq('3. Monk 5 ki.remaining === 5 (full)', monk.resources.ki.remaining, 5);
  } else {
    assert('2. Monk 5 ki.max === 5 (skipped — no ki)', false);
  }
}

// =============================================================
// 4-5. Monk 2: ki unlocks at level 2 (PHB p.76)
// =============================================================
console.log('\n--- 4-5. Monk 2 ki (unlocks at L2 per PHB p.76) ---');
{
  // Monk 1 has NO ki yet (PHB p.76: ki is a level-2 feature)
  const monk1 = buildCombatant(makeMonk1(), { x: 0, y: 0, z: 0 });
  assert('4a. Monk 1 has NO ki (unlocks at L2)', monk1.resources?.ki === undefined);

  // Monk 2 unlocks ki = 2 (monk level)
  const sheet = levelTo(makeMonk1(), 'Monk', 2);
  const monk2 = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('4b. Monk 2 has ki', monk2.resources?.ki !== undefined);
  if (monk2.resources?.ki) {
    eq('5. Monk 2 ki.max === 2 (monk level)', monk2.resources.ki.max, 2);
  }
}

// =============================================================
// 6. Monk 5 Open Hand: ki transfers with subclass chosen
// =============================================================
console.log('\n--- 6. Monk 5 Open Hand ki (with subclass) ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 5, 'Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('6. Monk 5 Open Hand has ki', monk.resources?.ki !== undefined);
  if (monk.resources?.ki) {
    eq('6b. Monk 5 Open Hand ki.max === 5', monk.resources.ki.max, 5);
  }
}

// =============================================================
// 7-9. Sorcerer 5: sorceryPoints transferred correctly
// =============================================================
console.log('\n--- 7-9. Sorcerer 5 sorceryPoints transfer ---');
{
  const sheet = levelTo(makeSorcerer1(), 'Sorcerer', 5);
  const sorc = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('7. Sorcerer 5 has sorceryPoints', sorc.resources?.sorceryPoints !== undefined);
  if (sorc.resources?.sorceryPoints) {
    eq('8. Sorcerer 5 sorceryPoints.max === 5 (sorcerer level)',
      sorc.resources.sorceryPoints.max, 5);
    eq('9. Sorcerer 5 sorceryPoints.remaining === 5',
      sorc.resources.sorceryPoints.remaining, 5);
  } else {
    assert('8. Sorcerer 5 sorceryPoints (skipped — none)', false);
  }
}

// =============================================================
// 10. Sorcerer 1: NO sorceryPoints (unlocks at level 2)
// =============================================================
console.log('\n--- 10. Sorcerer 1 has NO sorceryPoints ---');
{
  const sheet = makeSorcerer1();  // level 1
  const sorc = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('10. Sorcerer 1 has NO sorceryPoints (unlocks at L2)',
    sorc.resources?.sorceryPoints === undefined);
}

// =============================================================
// 11. Sorcerer 5 Draconic Bloodline: sorceryPoints with subclass
// =============================================================
console.log('\n--- 11. Sorcerer 5 Draconic Bloodline sorceryPoints ---');
{
  const sheet = levelTo(makeSorcerer1(), 'Sorcerer', 5, 'Draconic Bloodline');
  const sorc = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('11. Sorcerer 5 Draconic has sorceryPoints',
    sorc.resources?.sorceryPoints !== undefined);
  if (sorc.resources?.sorceryPoints) {
    eq('11b. Sorcerer 5 Draconic sorceryPoints.max === 5',
      sorc.resources.sorceryPoints.max, 5);
  }
}

// =============================================================
// 12-13. Fighter 5: NO ki, NO sorceryPoints (wrong class)
// =============================================================
console.log('\n--- 12-13. Fighter 5 has neither ki nor sorceryPoints ---');
{
  const sheet = levelTo(makeFighter1(), 'Fighter', 5);
  const fighter = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('12. Fighter 5 has NO ki', fighter.resources?.ki === undefined);
  assert('13. Fighter 5 has NO sorceryPoints',
    fighter.resources?.sorceryPoints === undefined);
}

// =============================================================
// 14. Fighter 5: actionSurge STILL works (regression)
// =============================================================
console.log('\n--- 14. Fighter 5 actionSurge regression ---');
{
  const sheet = levelTo(makeFighter1(), 'Fighter', 5);
  const fighter = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('14. Fighter 5 has actionSurge (regression intact)',
    fighter.resources?.actionSurge !== undefined);
  if (fighter.resources?.actionSurge) {
    eq('14b. Fighter 5 actionSurge.max === 1', fighter.resources.actionSurge.max, 1);
  }
}

// =============================================================
// 15. Barbarian 5: rage STILL works (regression)
// =============================================================
console.log('\n--- 15. Barbarian 5 rage regression ---');
{
  const sheet = levelTo(makeBarbarian1(), 'Barbarian', 5);
  const barb = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  assert('15. Barbarian 5 has rage (regression intact)',
    barb.resources?.rage !== undefined);
  if (barb.resources?.rage) {
    eq('15b. Barbarian 5 rage.max >= 3 (lv5 = 3 rages)',
      barb.resources.rage.max >= 3, true);
  }
}

// =============================================================
// 16-17. Sheet-side resources are the SOURCE (leveler unaffected)
// =============================================================
console.log('\n--- 16-17. Sheet resources are the source ---');
{
  const monkSheet = levelTo(makeMonk1(), 'Monk', 5);
  assert('16. Monk 5 sheet.resources.ki exists (leveler side)',
    monkSheet.resources?.ki !== undefined);
  if (monkSheet.resources?.ki) {
    eq('16b. Monk 5 sheet.resources.ki.max === 5',
      monkSheet.resources.ki.max, 5);
  }

  const sorcSheet = levelTo(makeSorcerer1(), 'Sorcerer', 5);
  assert('17. Sorcerer 5 sheet.resources.sorceryPoints exists',
    sorcSheet.resources?.sorceryPoints !== undefined);
  if (sorcSheet.resources?.sorceryPoints) {
    eq('17b. Sorcerer 5 sheet.resources.sorceryPoints.max === 5',
      sorcSheet.resources.sorceryPoints.max, 5);
  }
}

// =============================================================
// 18. Monk 5 + Sorcerer 5 resources are independent
// =============================================================
console.log('\n--- 18. Monk + Sorcerer resources independent ---');
{
  const monk = buildCombatant(levelTo(makeMonk1(), 'Monk', 5), { x: 0, y: 0, z: 0 });
  const sorc = buildCombatant(levelTo(makeSorcerer1(), 'Sorcerer', 5), { x: 0, y: 0, z: 0 });

  // Monk has ki but not sorceryPoints
  assert('18a. Monk has ki', monk.resources?.ki !== undefined);
  assert('18b. Monk has NO sorceryPoints', monk.resources?.sorceryPoints === undefined);
  // Sorcerer has sorceryPoints but not ki
  assert('18c. Sorcerer has sorceryPoints', sorc.resources?.sorceryPoints !== undefined);
  assert('18d. Sorcerer has NO ki', sorc.resources?.ki === undefined);
  // They are different objects (no shared reference)
  assert('18e. monk.resources !== sorc.resources',
    monk.resources !== sorc.resources);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
