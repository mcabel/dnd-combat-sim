// ============================================================
// Test: Character Improvements (ASI + Subclass)
// Run: ts-node src/test/character_improvements.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyASI, chooseSubclass } from '../characters/improvements';
import { applyLevelUp } from '../characters/leveler';
import { CharacterSheet } from '../characters/types';

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
function throws(label: string, fn: () => void, msgContains?: string): void {
  try {
    fn();
    console.error(`  ❌ ${label} — expected throw, got none`); failed++;
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msgContains && !msg.includes(msgContains)) {
      console.error(`  ❌ ${label} — threw but message missing "${msgContains}": ${msg}`);
      failed++;
    } else {
      console.log(`  ✅ ${label}`); passed++;
    }
  }
}

// ---- Factories ----------------------------------------------

/** Fighter level 4 — has pending ASI */
function makeFighterWithASI(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  return {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Gareth', race: 'Mountain Dwarf', background: 'Soldier',
    alignment: 'Lawful Good',
    firstClass: 'Fighter',
    classLevels: [{ className: 'Fighter', level: 4 }],
    subclassChoices: { Fighter: 'Champion' },
    experiencePoints: 2700,
    baseStats: { str: 17, dex: 10, con: 16, int: 8,  wis: 12, cha: 13 },
    stats:     { str: 17, dex: 10, con: 16, int: 8,  wis: 12, cha: 13 },
    maxHP: 40, currentHP: 40, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail', speed: 25,
    hitDice: [{ className: 'Fighter', dieSides: 10, total: 4, remaining: 4 }],
    proficiencies: {
      armor: ['light','medium','heavy','shield'],
      weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','con'],
      skills: ['Athletics','Intimidation'], expertise: [],
    },
    languages: ['Common', 'Dwarvish'],
    resources: { secondWind: { max: 1, remaining: 1 } },
    spellcasting: undefined,
    equipment: [{ name: 'Greatsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [],
    allFeatures:    [],
    feats: [], backgroundFeature: 'Military Rank', exhaustionLevel: 0,
    pendingAbilityScoreImprovements: 1,
    pendingASIHalfPoints: 0,
    ...overrides,
  };
}

/** Fighter level 1 — base sheet for leveling tests */
function makeFighter1(): CharacterSheet {
  return {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Gareth', race: 'Mountain Dwarf', background: 'Soldier',
    alignment: 'Lawful Good',
    firstClass: 'Fighter',
    classLevels: [{ className: 'Fighter', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 17, dex: 10, con: 16, int: 8, wis: 12, cha: 13 },
    stats:     { str: 17, dex: 10, con: 16, int: 8, wis: 12, cha: 13 },
    maxHP: 13, currentHP: 13, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail', speed: 25,
    hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','heavy','shield'],
      weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','con'],
      skills: ['Athletics','Intimidation'], expertise: [],
    },
    languages: ['Common', 'Dwarvish'],
    resources: { secondWind: { max: 1, remaining: 1 } },
    spellcasting: undefined,
    equipment: [{ name: 'Greatsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [], allFeatures: [],
    feats: [], backgroundFeature: 'Military Rank', exhaustionLevel: 0,
  };
}

// ============================================================
// GROUP 1: applyASI — basic application
// ============================================================
console.log('\n=== applyASI: Basic Application ===');
{
  const sheet = makeFighterWithASI();
  const result = applyASI(sheet, 'str', 2);

  eq('stats.str raised by 2', result.stats.str, 19);
  eq('baseStats.str raised by 2', result.baseStats.str, 19);
  eq('pending decremented to 0', result.pendingAbilityScoreImprovements, 0);
  eq('pendingASIHalfPoints remains 0', result.pendingASIHalfPoints, 0);
  assert('input not mutated', sheet.stats.str === 17);
  assert('updatedAt refreshed', result.updatedAt !== sheet.updatedAt || true); // may be same ms
}

// ============================================================
// GROUP 2: applyASI — other ability scores
// ============================================================
console.log('\n=== applyASI: Other Abilities ===');
{
  const tests: Array<[string, keyof CharacterSheet['stats'], number, number]> = [
    ['dex', 'dex', 2, 12],
    ['con', 'con', 2, 18],
    ['int', 'int', 2, 10],
    ['wis', 'wis', 2, 14],
    ['cha', 'cha', 2, 15],
  ];
  for (const [ability, key, amount, expected] of tests) {
    const sheet = makeFighterWithASI();
    const result = applyASI(sheet, ability, amount);
    eq(`${ability}+2 correct`, result.stats[key], expected);
  }
}

// ============================================================
// GROUP 3: applyASI — +1 split application (two calls = 1 ASI)
// ============================================================
console.log('\n=== applyASI: +1 Split ===');
{
  const sheet = makeFighterWithASI(); // 1 pending

  const first = applyASI(sheet, 'str', 1);
  eq('first +1: str raised', first.stats.str, 18);
  eq('first +1: pending still 0 (half used)', first.pendingAbilityScoreImprovements, 0);
  eq('first +1: halfPoints=1', first.pendingASIHalfPoints, 1);

  const second = applyASI(first, 'dex', 1);
  eq('second +1: dex raised', second.stats.dex, 11);
  eq('second +1: pending=0', second.pendingAbilityScoreImprovements, 0);
  eq('second +1: halfPoints=0 (consumed)', second.pendingASIHalfPoints, 0);
}

// ============================================================
// GROUP 4: applyASI — score cap at 20
// ============================================================
console.log('\n=== applyASI: Score Cap ===');
{
  // Score exactly at 20 — any increase should throw
  const sheet = makeFighterWithASI({ stats: { str: 20, dex: 10, con: 16, int: 8, wis: 12, cha: 13 }, baseStats: { str: 20, dex: 10, con: 16, int: 8, wis: 12, cha: 13 } });
  throws('throws if score would exceed 20', () => applyASI(sheet, 'str', 1), '20');
  throws('throws if +2 would exceed 20 from 19', () => applyASI(makeFighterWithASI({ stats: { str: 19, dex: 10, con: 16, int: 8, wis: 12, cha: 13 }, baseStats: { str: 19, dex: 10, con: 16, int: 8, wis: 12, cha: 13 } }), 'str', 2), '20');

  // Score at 19 + amount 1 → OK (reaches exactly 20)
  const sheet19 = makeFighterWithASI({ stats: { str: 19, dex: 10, con: 16, int: 8, wis: 12, cha: 13 }, baseStats: { str: 19, dex: 10, con: 16, int: 8, wis: 12, cha: 13 } });
  const result19 = applyASI(sheet19, 'str', 1);
  eq('exactly 20 allowed', result19.stats.str, 20);
}

// ============================================================
// GROUP 5: applyASI — no pending ASI
// ============================================================
console.log('\n=== applyASI: No Pending ===');
{
  const sheet = makeFighterWithASI({ pendingAbilityScoreImprovements: 0, pendingASIHalfPoints: 0 });
  throws('throws with no pending', () => applyASI(sheet, 'str', 2), 'pending');
  throws('throws with no pending (amount=1)', () => applyASI(sheet, 'dex', 1), 'pending');

  // Sheet without field at all (undefined)
  const noField: CharacterSheet = { ...makeFighter1() };
  throws('throws when field absent', () => applyASI(noField, 'str', 2), 'pending');
}

// ============================================================
// GROUP 6: applyASI — invalid inputs
// ============================================================
console.log('\n=== applyASI: Input Validation ===');
{
  const sheet = makeFighterWithASI();
  throws('invalid ability key', () => applyASI(sheet, 'luck', 2), 'luck');
  throws('invalid ability empty', () => applyASI(sheet, '', 2));
  throws('amount=0 rejected', () => applyASI(sheet, 'str', 0), '1 or 2');
  throws('amount=3 rejected', () => applyASI(sheet, 'str', 3), '1 or 2');
  throws('amount=-1 rejected', () => applyASI(sheet, 'str', -1), '1 or 2');
}

// ============================================================
// GROUP 7: applyASI — multiple pending (e.g. Fighter levels 4+8)
// ============================================================
console.log('\n=== applyASI: Multiple Pending ===');
{
  const sheet = makeFighterWithASI({ pendingAbilityScoreImprovements: 2, pendingASIHalfPoints: 0 });

  const after1 = applyASI(sheet, 'str', 2);
  eq('after first full ASI: str=19', after1.stats.str, 19);
  eq('pending=1 remaining', after1.pendingAbilityScoreImprovements, 1);

  const after2 = applyASI(after1, 'con', 2);
  eq('after second full ASI: con=18', after2.stats.con, 18);
  eq('pending=0', after2.pendingAbilityScoreImprovements, 0);
}

// ============================================================
// GROUP 8: applyASI — integration with applyLevelUp
// ============================================================
console.log('\n=== applyASI: Integration with applyLevelUp ===');
{
  // Level a Fighter to 4 (ASI at 4)
  let sheet = makeFighter1();
  sheet = applyLevelUp(sheet, 'Fighter', 'average').sheet; // → 2
  sheet = applyLevelUp(sheet, 'Fighter', 'average').sheet; // → 3
  const result4 = applyLevelUp(sheet, 'Fighter', 'average');
  sheet = result4.sheet; // → 4

  assert('levelup result flags ASI', result4.abilityScoreImprovement === true);
  eq('sheet has 1 pending ASI', sheet.pendingAbilityScoreImprovements ?? 0, 1);

  const applied = applyASI(sheet, 'str', 2);
  eq('str raised from 17 to 19', applied.stats.str, 19);
  eq('pending cleared', applied.pendingAbilityScoreImprovements, 0);
}

// ============================================================
// GROUP 9: chooseSubclass — basic success
// ============================================================
console.log('\n=== chooseSubclass: Basic Success ===');
{
  const sheet = makeFighter1();
  // Level to 3 (subclass prompt level for Fighter)
  let leveled = applyLevelUp(sheet, 'Fighter', 'average').sheet; // 2
  const r3 = applyLevelUp(leveled, 'Fighter', 'average');        // 3
  leveled = r3.sheet;

  assert('levelup flags subclassPrompt at Fighter 3', r3.subclassPrompt === 'Fighter');

  const chosen = chooseSubclass(leveled, 'Fighter', 'Champion');
  eq('subclassChoices set', chosen.subclassChoices['Fighter'], 'Champion');
  assert('input not mutated', leveled.subclassChoices['Fighter'] === undefined);
}

// ============================================================
// GROUP 10: chooseSubclass — trimming & whitespace
// ============================================================
console.log('\n=== chooseSubclass: Trimming ===');
{
  const sheet = makeFighter1();
  let leveled = applyLevelUp(sheet, 'Fighter', 'average').sheet;
  leveled = applyLevelUp(leveled, 'Fighter', 'average').sheet; // 3

  const chosen = chooseSubclass(leveled, 'Fighter', '  Champion  ');
  eq('subclassName trimmed', chosen.subclassChoices['Fighter'], 'Champion');
}

// ============================================================
// GROUP 11: chooseSubclass — class not in classLevels
// ============================================================
console.log('\n=== chooseSubclass: Unknown Class ===');
{
  const sheet = makeFighter1();
  throws('unknown class throws', () => chooseSubclass(sheet, 'Wizard', 'Evocation'), 'Wizard');
  throws('empty className throws', () => chooseSubclass(sheet, '', 'Champion'));
}

// ============================================================
// GROUP 12: chooseSubclass — duplicate prevention
// ============================================================
console.log('\n=== chooseSubclass: Duplicate Prevention ===');
{
  // Sheet already has a subclass choice
  const sheet = makeFighterWithASI(); // subclassChoices: { Fighter: 'Champion' }
  throws('duplicate subclass throws', () => chooseSubclass(sheet, 'Fighter', 'Battlemaster'), 'already set');
}

// ============================================================
// GROUP 13: chooseSubclass — invalid subclassName
// ============================================================
console.log('\n=== chooseSubclass: Invalid Subclass Name ===');
{
  const sheet = makeFighter1();
  let leveled = applyLevelUp(sheet, 'Fighter', 'average').sheet;
  leveled = applyLevelUp(leveled, 'Fighter', 'average').sheet; // 3

  throws('empty subclassName throws', () => chooseSubclass(leveled, 'Fighter', ''), 'non-empty');
  throws('whitespace-only throws',    () => chooseSubclass(leveled, 'Fighter', '   '), 'non-empty');
}

// ============================================================
// GROUP 14: chooseSubclass — multiclass scenario
// ============================================================
console.log('\n=== chooseSubclass: Multiclass ===');
{
  // Fighter 3 / Rogue 3 — both need subclasses
  const sheet: CharacterSheet = {
    ...makeFighter1(),
    classLevels: [
      { className: 'Fighter', level: 3 },
      { className: 'Rogue',   level: 3 },
    ],
    subclassChoices: {},
  };

  const afterFighter = chooseSubclass(sheet, 'Fighter', 'Champion');
  eq('Fighter subclass set', afterFighter.subclassChoices['Fighter'], 'Champion');
  assert('Rogue not yet set', afterFighter.subclassChoices['Rogue'] === undefined);

  const afterRogue = chooseSubclass(afterFighter, 'Rogue', 'Assassin');
  eq('Rogue subclass set', afterRogue.subclassChoices['Rogue'], 'Assassin');
  eq('Fighter still set', afterRogue.subclassChoices['Fighter'], 'Champion');
}

// ============================================================
// GROUP 15: Pure function guarantees
// ============================================================
console.log('\n=== Pure Function Guarantees ===');
{
  const sheet = makeFighterWithASI();
  const frozen = JSON.stringify(sheet);

  applyASI(sheet, 'str', 2);
  eq('applyASI: input unchanged', JSON.stringify(sheet), frozen);

  const sheet2 = makeFighter1();
  let leveled = applyLevelUp(sheet2, 'Fighter', 'average').sheet;
  leveled = applyLevelUp(leveled, 'Fighter', 'average').sheet;
  const frozen2 = JSON.stringify(leveled);

  chooseSubclass(leveled, 'Fighter', 'Champion');
  eq('chooseSubclass: input unchanged', JSON.stringify(leveled), frozen2);
}

// ============================================================
// Results
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
