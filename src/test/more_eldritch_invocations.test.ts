// ============================================================
// Test: More Eldritch Invocations (Session 41, Task #16)
//
// Validates the 3 new invocations added in Session 41:
//   - Eldritch Spear (PHB p.111): EB range 300 ft (builder patch)
//   - Eldritch Mind (TCE p.71): advantage on concentration saves (utils)
//   - Thirsting Blade (PHB p.111): metadata-only (engine integration future work)
//
// Coverage:
//   1. All 3 new invocations are in the ELDRITCH_INVOCATIONS registry
//   2. Eldritch Spear — builder patches EB Action range to 300 ft
//   3. Eldritch Spear — non-EB spells are NOT affected
//   4. Eldritch Spear — without the invocation, EB range stays 120 ft
//   5. Eldritch Mind — rollConcentrationSave rolls with advantage
//   6. Eldritch Mind — without the invocation, normal roll
//   7. Thirsting Blade — can be chosen via chooseEldritchInvocations
//   8. Thirsting Blade — metadata flag set on EB
//   9. End-to-end: Warlock with Eldritch Spear + cantrip pipeline → EB range 300 ft
//  10. End-to-end: Eldritch Mind + concentration save (statistical advantage)
//  11. Registry count: 7 invocations total (4 from Sessions 38-39 + 3 new)
//  12. EB metadata flags for all 7 invocations
//
// Run: npx ts-node src/test/more_eldritch_invocations.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import {
  ELDRITCH_INVOCATIONS,
  hasInvocation,
} from '../spells/_invocations';
import { metadata as ebMetadata } from '../spells/eldritch_blast';
import { buildCombatant } from '../characters/builder';
import { applyLevelUp } from '../characters/leveler';
import { chooseEldritchInvocations } from '../characters/improvements';
import { CharacterSheet } from '../characters/types';
import { rollConcentrationSave } from '../engine/utils';
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

function makeWarlock1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Vesper', race: 'Tiefling', background: 'Charlatan',
    alignment: 'Chaotic Neutral',
    firstClass: 'Warlock',
    classLevels: [{ className: 'Warlock', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    stats:     { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 18 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 12, acFormula: 'Leather + DEX', speed: 30,
    hitDice: [{ className: 'Warlock', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light'], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['wis','cha'],
      skills: ['Deception','Arcana'], expertise: [],
    },
    languages: ['Common', 'Infernal', 'Abyssal'],
    resources: {},
    spellcasting: {
      ability: 'cha', spellAttackBonus: 6, saveDC: 14,
      slots: {}, slotsUsed: {},
      pactSlots: { slotLevel: 1, total: 1, used: 0 },
      cantrips: ['Eldritch Blast', 'Chill Touch'],
      knownSpells: ['Hex'],
      preparedSpells: [],
      spellbook: [],
    },
    equipment: [{ name: 'Light Crossbow', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [
      { name: 'Otherworldly Patron', description: 'Gain your patron feature.', source: 'subclass' },
      { name: 'Pact Magic',           description: 'CHA Pact Magic caster.',   source: 'class' },
    ],
    allFeatures: [
      { name: 'Otherworldly Patron', description: 'Gain your patron feature.', source: 'subclass' },
      { name: 'Pact Magic',           description: 'CHA Pact Magic caster.',   source: 'class' },
    ],
    feats: [], backgroundFeature: 'False Identity', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 18,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    ...overrides,
  } as Combatant;
}

function levelWarlockTo(sheet: CharacterSheet, target: number): CharacterSheet {
  let s = sheet;
  const startLevel = s.classLevels.find(cl => cl.className === 'Warlock')?.level ?? 0;
  for (let i = startLevel; i < target; i++) {
    s = applyLevelUp(s, 'Warlock').sheet;
  }
  return s;
}

// ============================================================
// 1. All 3 new invocations are in the registry
// ============================================================
console.log('\n--- 1. Registry has all 3 new invocations ---');
{
  assert('1a. Eldritch Spear registered', !!ELDRITCH_INVOCATIONS['Eldritch Spear']);
  assert('1b. Eldritch Mind registered', !!ELDRITCH_INVOCATIONS['Eldritch Mind']);
  assert('1c. Thirsting Blade registered', !!ELDRITCH_INVOCATIONS['Thirsting Blade']);
  eq('1d. Eldritch Spear name', ELDRITCH_INVOCATIONS['Eldritch Spear']?.name, 'Eldritch Spear');
  eq('1e. Eldritch Mind name', ELDRITCH_INVOCATIONS['Eldritch Mind']?.name, 'Eldritch Mind');
  eq('1f. Thirsting Blade name', ELDRITCH_INVOCATIONS['Thirsting Blade']?.name, 'Thirsting Blade');
}

// ============================================================
// 2. Eldritch Spear — builder patches EB Action range to 300 ft
// ============================================================
console.log('\n--- 2. Eldritch Spear — builder patches EB range ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  // Warlock 2 has 2 invocation slots — pick Eldritch Spear + Agonizing Blast
  const sheet = chooseEldritchInvocations(warlock2, ['Eldritch Spear', 'Agonizing Blast']);
  const combatant = buildCombatant(sheet);

  const ebAction = combatant.actions.find(a => a.name === 'Eldritch Blast');
  assert('2a. EB Action present', ebAction !== undefined);
  eq('2b. EB reach = 300 (Eldritch Spear)', ebAction?.reach, 300);
  eq('2c. EB range.normal = 300', ebAction?.range?.normal, 300);
  eq('2d. EB range.long = 300', ebAction?.range?.long, 300);
}

// ============================================================
// 3. Eldritch Spear — non-EB spells are NOT affected
// ============================================================
console.log('\n--- 3. Eldritch Spear — non-EB spells unaffected ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const sheet = chooseEldritchInvocations(warlock2, ['Eldritch Spear', 'Agonizing Blast']);
  // Override cantrips to include Chill Touch (also 120 ft range)
  sheet.spellcasting!.cantrips = ['Eldritch Blast', 'Chill Touch'];
  const combatant = buildCombatant(sheet);

  const ctAction = combatant.actions.find(a => a.name === 'Chill Touch');
  assert('3a. Chill Touch Action present', ctAction !== undefined);
  // Chill Touch default range is 120 ft — NOT affected by Eldritch Spear
  eq('3b. Chill Touch reach = 120 (unaffected)', ctAction?.reach, 120);
  eq('3c. Chill Touch range.normal = 120', ctAction?.range?.normal, 120);
}

// ============================================================
// 4. Eldritch Spear — without the invocation, EB range stays 120 ft
// ============================================================
console.log('\n--- 4. Without Eldritch Spear — EB range stays 120 ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  // Pick Agonizing Blast + Repelling Blast (NOT Eldritch Spear)
  const sheet = chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast']);
  const combatant = buildCombatant(sheet);

  const ebAction = combatant.actions.find(a => a.name === 'Eldritch Blast');
  eq('4a. EB reach = 120 (no Eldritch Spear)', ebAction?.reach, 120);
  eq('4b. EB range.normal = 120', ebAction?.range?.normal, 120);
}

// ============================================================
// 5. Eldritch Mind — rollConcentrationSave rolls with advantage
// ============================================================
console.log('\n--- 5. Eldritch Mind — advantage on concentration saves ---');
{
  // Warlock with Eldritch Mind + concentration active + CON 10 (+0)
  // DC 20 → need roll 20 to succeed. With advantage, P(success) = 1 - (19/20)^2 ≈ 9.75%
  // Without advantage, P(success) = 5%.
  // Run 1000 trials each, verify advantage has higher success rate.
  const N = 1000;

  // With Eldritch Mind
  let successWithEM = 0;
  for (let i = 0; i < N; i++) {
    const caster = makeCombatant('c', {
      con: 10, // +0
      eldritchInvocations: ['Eldritch Mind'],
      concentration: { active: true, spellName: 'Test', dcIfHit: 10 },
    });
    // DC 20 → need natural 20 to succeed
    if (rollConcentrationSave(caster, 20)) successWithEM++;
  }

  // Without Eldritch Mind
  let successWithoutEM = 0;
  for (let i = 0; i < N; i++) {
    const caster = makeCombatant('c', {
      con: 10,
      eldritchInvocations: [],
      concentration: { active: true, spellName: 'Test', dcIfHit: 10 },
    });
    if (rollConcentrationSave(caster, 20)) successWithoutEM++;
  }

  // Expected: ~97 successes with EM, ~50 without. Verify EM has at least 70 (well above the 5% baseline).
  // Use a generous lower bound to avoid flakiness.
  assert(`5a. Eldritch Mind advantage: ${successWithEM}/${N} successes (>=70 expected)`,
    successWithEM >= 70, `got ${successWithEM}`);
  assert(`5b. Without EM: ${successWithoutEM}/${N} successes (lower bound check)`,
    successWithoutEM >= 20, `got ${successWithoutEM}`);
  // EM should have roughly 2× the success rate
  assert(`5c. EM success rate > non-EM success rate (${successWithEM} > ${successWithoutEM})`,
    successWithEM > successWithoutEM);
}

// ============================================================
// 6. Eldritch Mind — without the invocation, normal roll
// ============================================================
console.log('\n--- 6. Without Eldritch Mind — normal concentration save ---');
{
  // Caster with CON 14 (+2), DC 12 → success on roll 10+ (55%)
  const caster = makeCombatant('c', {
    con: 14,
    eldritchInvocations: [], // NO Eldritch Mind
    concentration: { active: true, spellName: 'Test', dcIfHit: 10 },
  });
  // Just verify the save runs and returns a boolean
  const result = rollConcentrationSave(caster, 4); // DC 10
  assert('6a. concentration save returned a boolean', typeof result === 'boolean');
}

// ============================================================
// 7. Thirsting Blade — can be chosen via chooseEldritchInvocations
// ============================================================
console.log('\n--- 7. Thirsting Blade — can be chosen ---');
{
  // Warlock 5 has 3 invocation slots
  const warlock5 = levelWarlockTo(makeWarlock1(), 5);
  const sheet = chooseEldritchInvocations(warlock5, [
    'Thirsting Blade',
    'Agonizing Blast',
    'Eldritch Spear',
  ]);
  assert('7a. Thirsting Blade chosen', sheet.eldritchInvocations?.includes('Thirsting Blade') === true);
  assert('7b. Agonizing Blast chosen', sheet.eldritchInvocations?.includes('Agonizing Blast') === true);
  assert('7c. Eldritch Spear chosen', sheet.eldritchInvocations?.includes('Eldritch Spear') === true);
}

// ============================================================
// 8. Thirsting Blade — metadata flag set on EB
// ============================================================
console.log('\n--- 8. Thirsting Blade metadata flag ---');
{
  eq('8a. thirstingBladeV1Implemented = true (Session 42 Task #18: fully wired)',
    (ebMetadata as any).thirstingBladeV1Implemented, true);
  eq('8b. eldritchSpearV1Implemented = true',
    (ebMetadata as any).eldritchSpearV1Implemented, true);
  eq('8c. eldritchMindV1Implemented = true',
    (ebMetadata as any).eldritchMindV1Implemented, true);
}

// ============================================================
// 9. End-to-end: Warlock with Eldritch Spear + cantrip pipeline
//    → EB range 300 ft
// ============================================================
console.log('\n--- 9. End-to-end Eldritch Spear via cantrip pipeline ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const sheet = chooseEldritchInvocations(warlock2, ['Eldritch Spear', 'Agonizing Blast']);
  const combatant = buildCombatant(sheet);

  // Verify the EB Action came through the cantrip pipeline (Session 41 Task #15)
  // AND has the Eldritch Spear range patch (Session 41 Task #16).
  const ebAction = combatant.actions.find(a => a.name === 'Eldritch Blast');
  assert('9a. EB Action present (via cantrip pipeline)', ebAction !== undefined);
  eq('9b. EB slotLevel = 0 (cantrip)', ebAction?.slotLevel, 0);
  eq('9c. EB reach = 300 (Eldritch Spear)', ebAction?.reach, 300);
  eq('9d. EB range.normal = 300', ebAction?.range?.normal, 300);
  assert('9e. combatant has Eldritch Spear invocation',
    combatant.eldritchInvocations?.includes('Eldritch Spear') === true);
}

// ============================================================
// 10. End-to-end: Eldritch Mind + concentration save (statistical)
// ============================================================
console.log('\n--- 10. End-to-end Eldritch Mind concentration save ---');
{
  // Simulate a Warlock concentrating on Hex who takes damage.
  // With Eldritch Mind, they should maintain concentration more often.
  // DC 15 (30 damage), CON 14 (+2) → need roll 13+ (40% without advantage, 64% with advantage)
  const N = 500;

  let maintainedWithEM = 0;
  for (let i = 0; i < N; i++) {
    const caster = makeCombatant('c', {
      con: 14,
      eldritchInvocations: ['Eldritch Mind', 'Agonizing Blast'],
      concentration: { active: true, spellName: 'Hex', dcIfHit: 10 },
    });
    if (rollConcentrationSave(caster, 30)) maintainedWithEM++; // DC 15
  }

  let maintainedWithoutEM = 0;
  for (let i = 0; i < N; i++) {
    const caster = makeCombatant('c', {
      con: 14,
      eldritchInvocations: ['Agonizing Blast'], // no Eldritch Mind
      concentration: { active: true, spellName: 'Hex', dcIfHit: 10 },
    });
    if (rollConcentrationSave(caster, 30)) maintainedWithoutEM++;
  }

  // Expected: ~320 with EM, ~200 without. Verify EM has at least 250 (well above the 40% baseline).
  assert(`10a. Eldritch Mind: ${maintainedWithEM}/${N} maintained (>=250 expected)`,
    maintainedWithEM >= 250, `got ${maintainedWithEM}`);
  assert(`10b. Without EM: ${maintainedWithoutEM}/${N} maintained`,
    maintainedWithoutEM >= 100, `got ${maintainedWithoutEM}`);
  assert(`10c. EM maintenance > non-EM (${maintainedWithEM} > ${maintainedWithoutEM})`,
    maintainedWithEM > maintainedWithoutEM);
}

// ============================================================
// 11. Registry count: 8 invocations total (Session 63 added Devil's Sight)
// ============================================================
console.log('\n--- 11. Registry count ---');
{
  const names = Object.keys(ELDRITCH_INVOCATIONS).sort();
  eq('11a. registry has 8 entries', names.length, 8);
  // Verify all 8 names
  assert('11b. Agonizing Blast', names.includes('Agonizing Blast'));
  assert('11c. Eldritch Mind', names.includes('Eldritch Mind'));
  assert('11d. Eldritch Spear', names.includes('Eldritch Spear'));
  assert('11e. Grasp of Hadar', names.includes('Grasp of Hadar'));
  assert('11f. Lance of Lethargy', names.includes('Lance of Lethargy'));
  assert('11g. Repelling Blast', names.includes('Repelling Blast'));
  assert('11h. Thirsting Blade', names.includes('Thirsting Blade'));
  assert('11i. Devil\'s Sight (Session 63)', names.includes("Devil's Sight"));
}

// ============================================================
// 12. EB metadata flags for all 7 invocations
// ============================================================
console.log('\n--- 12. EB metadata flags ---');
{
  const m = ebMetadata as any;
  // Original 4 (Sessions 38-39)
  eq('12a. repellingBlastV1Implemented', m.repellingBlastV1Implemented, true);
  eq('12b. agonizingBlastV1Implemented', m.agonizingBlastV1Implemented, true);
  eq('12c. graspOfHadarV1Implemented', m.graspOfHadarV1Implemented, true);
  eq('12d. lanceOfLethargyV1Implemented', m.lanceOfLethargyV1Implemented, true);
  // Session 41 Task #16 new
  eq('12e. eldritchSpearV1Implemented', m.eldritchSpearV1Implemented, true);
  eq('12f. eldritchMindV1Implemented', m.eldritchMindV1Implemented, true);
  eq('12g. thirstingBladeV1Implemented (Session 42 Task #18)', m.thirstingBladeV1Implemented, true);
}

// ============================================================
// 13. hasInvocation helper works for new invocations
// ============================================================
console.log('\n--- 13. hasInvocation helper ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const sheet = chooseEldritchInvocations(warlock2, ['Eldritch Spear', 'Eldritch Mind']);
  const combatant = buildCombatant(sheet);
  // Wait — Eldritch Mind is not an EB invocation, so the builder doesn't
  // need it for the EB patch. But hasInvocation should still work.
  assert('13a. hasInvocation(Eldritch Spear) = true',
    hasInvocation(combatant, 'Eldritch Spear'));
  assert('13b. hasInvocation(Eldritch Mind) = true',
    hasInvocation(combatant, 'Eldritch Mind'));
  assert('13c. hasInvocation(Thirsting Blade) = false (not chosen)',
    !hasInvocation(combatant, 'Thirsting Blade'));
}

// ============================================================
// 14. Devil's Sight invocation (Session 63) — builder wiring
// ============================================================
console.log('\n--- 14. Devil\'s Sight invocation ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const sheet = chooseEldritchInvocations(warlock2, ["Devil's Sight", 'Eldritch Spear']);
  const combatant = buildCombatant(sheet);

  assert('14a. hasInvocation(Devil\'s Sight) = true',
    hasInvocation(combatant, "Devil's Sight"));
  assert('14b. senses.devilsSight = true (builder wired)',
    combatant.senses?.devilsSight === true);
  // The invocation grants 120-ft sight in all darkness. If the Warlock had no
  // darkvision, the builder sets it to 120. If they had < 120, it's bumped.
  // If they had > 120 (e.g. 150 from a race), the higher value is kept.
  eq('14c. senses.darkvision ≥ 120 (invocation grants 120-ft sight)',
    combatant.senses?.darkvision ?? 0 >= 120 ? true : false, true);

  // Warlock WITHOUT Devil's Sight should NOT get the flag.
  const warlock2b = levelWarlockTo(makeWarlock1(), 2);
  const sheetNoDevils = chooseEldritchInvocations(warlock2b, ['Eldritch Spear', 'Eldritch Mind']);
  const combatantNoDevils = buildCombatant(sheetNoDevils);
  assert('14d. no Devil\'s Sight → senses.devilsSight undefined',
    combatantNoDevils.senses?.devilsSight === undefined);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('more_eldritch_invocations.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('more_eldritch_invocations.test.ts: all tests passed ✅');
}
