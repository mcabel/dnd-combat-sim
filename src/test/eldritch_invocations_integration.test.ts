// ============================================================
// Test: Eldritch Invocations — Sheet → Combatant Integration
// (Session 40)
//
// Validates the parser/leveler integration for Eldritch Invocations
// (item #14 from Session 39's next-session priorities).
//
// Coverage:
//   1. WARLOCK_INVOCATION_SLOTS table (PHB p.108)
//   2. getMaxInvocationSlots() helper
//   3. chooseEldritchInvocations() validation
//      - non-Warlock throws
//      - Warlock level 1 throws (below feature unlock)
//      - Warlock level 2 with 2 invocations works
//      - Warlock level 2 with wrong count throws
//      - Unknown invocation name throws
//      - Duplicate invocation throws
//      - Warlock level 5 with 3 invocations works
//      - Replacing invocations works (full swap)
//   4. chooseEldritchInvocations immutability (original sheet unchanged)
//   5. CharacterSheet.eldritchInvocations field exists
//   6. buildCombatant transfers sheet.eldritchInvocations → combatant.eldritchInvocations
//   7. buildCombatant leaves combatant.eldritchInvocations undefined for non-Warlock
//   8. End-to-end: applyLevelUp → chooseEldritchInvocations → buildCombatant → resolveAttack
//      (Agonizing Blast + CHA mod damage fires via the engine hook)
//   9. End-to-end: Repelling Blast pushes target 10 ft away via the engine hook
//
// Run: npx ts-node src/test/eldritch_invocations_integration.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import {
  applyLevelUp,
  getMaxInvocationSlots,
  WARLOCK_INVOCATION_SLOTS,
} from '../characters/leveler';
import {
  applyASI,
  chooseEldritchInvocations,
  chooseSubclass,
} from '../characters/improvements';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { ELDRITCH_INVOCATIONS } from '../spells/_invocations';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3 } from '../types/core';

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

/** Warlock level-1 sheet (CHA 18 — matches Session 38/39 test sheets). */
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

/** Non-Warlock sheet (Fighter) for negative tests. */
function makeFighter1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
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
    level1Features: [{ name: 'Second Wind', description: 'Regain HP.', source: 'class' }],
    allFeatures:    [{ name: 'Second Wind', description: 'Regain HP.', source: 'class' }],
    feats: [], backgroundFeature: 'Military Rank', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/** Advance a sheet to the given Warlock level via applyLevelUp (average HP rolls). */
function levelWarlockTo(sheet: CharacterSheet, target: number): CharacterSheet {
  let s = sheet;
  const startLevel = s.classLevels.find(cl => cl.className === 'Warlock')?.level ?? 0;
  for (let i = startLevel; i < target; i++) {
    s = applyLevelUp(s, 'Warlock').sheet;
  }
  return s;
}

// ---- Combat helpers (mirrors eldritch_invocations.test.ts shape) --------

function makeGoblin(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 8, dex: 14, con: 10, int: 8, wis: 8, cha: 8,
    cr: 0.25,
    pos: { x: 5, y: 0, z: 0 },
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

function makeBF(combatants: Combatant[]) {
  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'flat', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

const ELDRITCH_BLAST_ACTION: Action = {
  name: 'Eldritch Blast',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 8,
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'force',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Eldritch Blast',
};

// ============================================================
// 1. WARLOCK_INVOCATION_SLOTS table (PHB p.108)
// ============================================================
console.log('\n--- 1. WARLOCK_INVOCATION_SLOTS table ---');
{
  // PHB p.108: "At 2nd level, you gain two eldritch invocations of your
  // choice. ... You learn one additional invocation at 5th, 7th, 9th,
  // 12th, 15th, and 18th level."
  eq('1a. Lv 0  → 0 invocations', WARLOCK_INVOCATION_SLOTS[0], 0);
  eq('1b. Lv 1  → 0 invocations', WARLOCK_INVOCATION_SLOTS[1], 0);
  eq('1c. Lv 2  → 2 invocations (feature unlocks)', WARLOCK_INVOCATION_SLOTS[2], 2);
  eq('1d. Lv 4  → 2 invocations', WARLOCK_INVOCATION_SLOTS[4], 2);
  eq('1e. Lv 5  → 3 invocations (+1)', WARLOCK_INVOCATION_SLOTS[5], 3);
  eq('1f. Lv 7  → 4 invocations (+1)', WARLOCK_INVOCATION_SLOTS[7], 4);
  eq('1g. Lv 9  → 5 invocations (+1)', WARLOCK_INVOCATION_SLOTS[9], 5);
  eq('1h. Lv 12 → 6 invocations (+1)', WARLOCK_INVOCATION_SLOTS[12], 6);
  eq('1i. Lv 15 → 7 invocations (+1)', WARLOCK_INVOCATION_SLOTS[15], 7);
  eq('1j. Lv 18 → 8 invocations (+1)', WARLOCK_INVOCATION_SLOTS[18], 8);
  eq('1k. Lv 20 → 8 invocations (cap)', WARLOCK_INVOCATION_SLOTS[20], 8);
  // 21 entries (0..20)
  eq('1l. table has 21 entries (0..20)', WARLOCK_INVOCATION_SLOTS.length, 21);
}

// ============================================================
// 2. getMaxInvocationSlots() helper
// ============================================================
console.log('\n--- 2. getMaxInvocationSlots() helper ---');
{
  eq('2a.  getMaxInvocationSlots(0)  = 0', getMaxInvocationSlots(0), 0);
  eq('2b.  getMaxInvocationSlots(1)  = 0', getMaxInvocationSlots(1), 0);
  eq('2c.  getMaxInvocationSlots(2)  = 2', getMaxInvocationSlots(2), 2);
  eq('2d.  getMaxInvocationSlots(5)  = 3', getMaxInvocationSlots(5), 3);
  eq('2e.  getMaxInvocationSlots(9)  = 5', getMaxInvocationSlots(9), 5);
  eq('2f.  getMaxInvocationSlots(18) = 8', getMaxInvocationSlots(18), 8);
  // Out-of-range clamping
  eq('2g.  getMaxInvocationSlots(25) clamps to 20 → 8', getMaxInvocationSlots(25), 8);
  eq('2h.  getMaxInvocationSlots(-3) clamps to 0  → 0', getMaxInvocationSlots(-3), 0);
  // Non-integer floor
  eq('2i.  getMaxInvocationSlots(5.9) floors to 5 → 3', getMaxInvocationSlots(5.9), 3);
}

// ============================================================
// 3. chooseEldritchInvocations() validation
// ============================================================
console.log('\n--- 3. chooseEldritchInvocations() validation ---');

// 3a. Non-Warlock throws
{
  const fighter = makeFighter1();
  throws('3a. non-Warlock throws (no Warlock class)',
    () => chooseEldritchInvocations(fighter, ['Agonizing Blast']),
    'no Warlock class');
}

// 3b. Warlock level 1 throws (below feature unlock)
{
  const warlock1 = makeWarlock1();
  throws('3b. Warlock level 1 throws (below lv2 unlock)',
    () => chooseEldritchInvocations(warlock1, ['Agonizing Blast']),
    'below 2');
}

// 3c. Warlock level 2 with 2 valid invocations works
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const result = chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast']);
  assert('3c. Warlock 2 with 2 invocations succeeds',
    Array.isArray(result.eldritchInvocations) && result.eldritchInvocations.length === 2);
  eq('3c1. first invocation is Agonizing Blast', result.eldritchInvocations![0], 'Agonizing Blast');
  eq('3c2. second invocation is Repelling Blast', result.eldritchInvocations![1], 'Repelling Blast');
}

// 3d. Warlock level 2 with wrong count (too few) throws
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  throws('3d. Warlock 2 with 1 invocation throws (too few)',
    () => chooseEldritchInvocations(warlock2, ['Agonizing Blast']),
    'count mismatch');
}

// 3e. Warlock level 2 with wrong count (too many) throws
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  throws('3e. Warlock 2 with 3 invocations throws (too many)',
    () => chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast', 'Grasp of Hadar']),
    'count mismatch');
}

// 3f. Unknown invocation name throws
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  throws('3f. Unknown invocation throws',
    () => chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Thirsting Blade']),
    'Unknown Eldritch Invocation');
}

// 3g. Duplicate invocation throws
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  throws('3g. Duplicate invocation throws',
    () => chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Agonizing Blast']),
    'Duplicate');
}

// 3h. Warlock level 5 with 3 invocations works
{
  const warlock5 = levelWarlockTo(makeWarlock1(), 5);
  const result = chooseEldritchInvocations(warlock5, ['Agonizing Blast', 'Repelling Blast', 'Grasp of Hadar']);
  eq('3h. Warlock 5 with 3 invocations succeeds (length=3)',
    result.eldritchInvocations!.length, 3);
}

// 3i. Warlock level 9 with 5 invocations works (all 4 known + duplicate-rejection test)
{
  const warlock9 = levelWarlockTo(makeWarlock1(), 9);
  // 4 known invocations; need 5. Should fail because we can't pick duplicates.
  throws('3i1. Warlock 9 with only 4 known invocations available (need 5) — try with 4 throws (count mismatch)',
    () => chooseEldritchInvocations(warlock9, ['Agonizing Blast', 'Repelling Blast', 'Grasp of Hadar', 'Lance of Lethargy']),
    'count mismatch');
  // Try with 5 — must include a duplicate, which fails on the dup check
  throws('3i2. Warlock 9 with 5 invocations + duplicate throws (no 5th unique invocation in v1 registry)',
    () => chooseEldritchInvocations(warlock9, ['Agonizing Blast', 'Repelling Blast', 'Grasp of Hadar', 'Lance of Lethargy', 'Agonizing Blast']),
    'Duplicate');
}

// 3j. Replacing invocations works (full swap, v1 simplification)
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  // First pick
  const first  = chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast']);
  // Swap: replace Agonizing Blast with Lance of Lethargy
  const second = chooseEldritchInvocations(first, ['Lance of Lethargy', 'Repelling Blast']);
  eq('3j. invocation list replaced (Lance of Lethargy present)',
    second.eldritchInvocations!.includes('Lance of Lethargy'), true);
  eq('3j1. invocation list replaced (Repelling Blast present)',
    second.eldritchInvocations!.includes('Repelling Blast'), true);
  eq('3j2. Agonizing Blast removed after swap',
    second.eldritchInvocations!.includes('Agonizing Blast'), false);
}

// 3k. Empty array throws (Warlock 2 needs 2)
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  throws('3k. Empty array throws (Warlock 2 requires 2)',
    () => chooseEldritchInvocations(warlock2, []),
    'count mismatch');
}

// ============================================================
// 4. Immutability — original sheet unchanged
// ============================================================
console.log('\n--- 4. chooseEldritchInvocations immutability ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const before = warlock2.eldritchInvocations;
  const result = chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast']);
  assert('4a. original sheet.eldritchInvocations unchanged (still undefined)',
    warlock2.eldritchInvocations === before);
  assert('4b. result is a new object (not same reference)',
    result !== warlock2);
  assert('4c. result.eldritchInvocations is a new array',
    result.eldritchInvocations !== warlock2.eldritchInvocations);
}

// ============================================================
// 5. CharacterSheet.eldritchInvocations field
// ============================================================
console.log('\n--- 5. CharacterSheet.eldritchInvocations field ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  assert('5a. fresh Warlock 2 sheet has undefined eldritchInvocations (before choice)',
    warlock2.eldritchInvocations === undefined);
  const chosen = chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast']);
  assert('5b. chosen sheet has array eldritchInvocations',
    Array.isArray(chosen.eldritchInvocations));
  eq('5c. chosen sheet has 2 entries',
    chosen.eldritchInvocations!.length, 2);
}

// ============================================================
// 6. buildCombatant transfers sheet.eldritchInvocations → combatant.eldritchInvocations
// ============================================================
console.log('\n--- 6. buildCombatant transfers invocations to Combatant ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const sheet = chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast']);
  const combatant = buildCombatant(sheet);

  assert('6a. combatant.eldritchInvocations is an array',
    Array.isArray(combatant.eldritchInvocations));
  eq('6b. combatant has 2 invocations', combatant.eldritchInvocations!.length, 2);
  assert('6c. combatant has Agonizing Blast',
    combatant.eldritchInvocations!.includes('Agonizing Blast'));
  assert('6d. combatant has Repelling Blast',
    combatant.eldritchInvocations!.includes('Repelling Blast'));
  // Combatant name/id reflect sheet identity
  eq('6e. combatant.name = sheet.name', combatant.name, 'Vesper');
  assert('6f. combatant.id starts with sheet_',
    combatant.id.startsWith('sheet_'));
  // NOTE: combatant.actions does NOT auto-include Eldritch Blast from
  // spellcasting.cantrips — that's a pre-existing limitation of the
  // sheet→combatant pipeline (cantrips aren't passed to lookupSpell in
  // pcToCombatant). The end-to-end tests below pass ELDRITCH_BLAST_ACTION
  // directly to resolveAttack, so the EB action doesn't need to be in
  // combatant.actions for the invocation hooks to fire — they fire based
  // on `action.name === 'Eldritch Blast'`, not on what's in the action list.
  // This limitation will be addressed in a future session (cantrip pipeline
  // integration with buildCombatant).
}

// ============================================================
// 7. buildCombatant leaves combatant.eldritchInvocations undefined for non-Warlock
// ============================================================
console.log('\n--- 7. buildCombatant leaves invocations undefined for non-Warlock ---');
{
  const fighter = makeFighter1();
  const combatant = buildCombatant(fighter);
  assert('7a. fighter combatant.eldritchInvocations is undefined',
    combatant.eldritchInvocations === undefined);
}

// 7b. Warlock with no invocations chosen → undefined on combatant
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  // Warlock 2 with no invocations chosen — sheet.eldritchInvocations is undefined
  const combatant = buildCombatant(warlock2);
  assert('7b. Warlock 2 without chosen invocations → combatant.eldritchInvocations undefined',
    combatant.eldritchInvocations === undefined);
}

// ============================================================
// 8. End-to-end: Agonizing Blast fires via engine hook
//     applyLevelUp(Warlock 2) → chooseEldritchInvocations → buildCombatant → resolveAttack
// ============================================================
console.log('\n--- 8. End-to-end: Agonizing Blast fires via engine ---');
{
  // Warlock 2 with CHA 18 (+4), Agonizing Blast + Repelling Blast chosen
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const sheet    = chooseEldritchInvocations(warlock2, ['Agonizing Blast', 'Repelling Blast']);
  const warlock  = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  // Place goblin 2 squares (10 ft) away — within EB range
  const goblin   = makeGoblin('goblin', { pos: { x: 2, y: 0, z: 0 } });
  const bf       = makeBF([warlock, goblin]);
  const state    = makeState(bf);

  // Force a hit. EB base: 1d10 force = 1..10. Agonizing Blast +4 (CHA 18).
  // Total: 5..14. Repelling Blast pushes goblin from (2,0) to (4,0).
  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force crit */);

  const dmgDealt = 100 - goblin.currentHP;
  // With crit: 2d10 = 2..20, +4 Agonizing Blast (NOT doubled) = 6..24
  assert('8a. damage in 6..24 range (2d10 crit + 4 CHA mod)',
    dmgDealt >= 6 && dmgDealt <= 24, `got ${dmgDealt}`);

  // Agonizing Blast bonus logged
  const agonizingLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Agonizing Blast'));
  assert('8b. Agonizing Blast log entry present', agonizingLog !== undefined);

  // Repelling Blast also fired — goblin pushed from (2,0) to (4,0)
  eq('8c. goblin pushed from x=2 to x=4 by Repelling Blast', goblin.pos.x, 4);
  const repellingLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'move' && e.description.includes('Repelling Blast'));
  assert('8d. Repelling Blast log entry present', repellingLog !== undefined);
}

// ============================================================
// 9. End-to-end: Repelling Blast-only fires push (no Agonizing Blast damage)
// ============================================================
console.log('\n--- 9. End-to-end: Repelling Blast only (no Agonizing Blast) ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  const sheet    = chooseEldritchInvocations(warlock2, ['Repelling Blast', 'Lance of Lethargy']);
  const warlock  = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  const goblin   = makeGoblin('goblin', { pos: { x: 3, y: 0, z: 0 }, speed: 30 });
  const bf       = makeBF([warlock, goblin]);
  const state    = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* force crit */);

  // EB only (no Agonizing): 2d10 crit = 2..20
  const dmgDealt = 100 - goblin.currentHP;
  assert('9a. damage in 2..20 range (no Agonizing Blast bonus)',
    dmgDealt >= 2 && dmgDealt <= 20, `got ${dmgDealt}`);

  // No Agonizing Blast log
  assert('9b. no Agonizing Blast log',
    !state.log.events.some((e: CombatEvent) => e.description.includes('Agonizing Blast')));

  // Repelling Blast pushed from (3,0) to (5,0)
  eq('9c. goblin pushed from x=3 to x=5', goblin.pos.x, 5);

  // Lance of Lethargy reduced speed
  const lanceLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Lance of Lethargy'));
  assert('9d. Lance of Lethargy log entry present', lanceLog !== undefined);
  eq('9e. goblin speed reduced by 10 (30 → 20)', goblin.speed, 20);
}

// ============================================================
// 10. End-to-end: chooseEldritchInvocations preserves CHA-driven damage
//     via Warlock with CHA 20 (+5)
// ============================================================
console.log('\n--- 10. End-to-end: CHA 20 (+5) Agonizing Blast damage ---');
{
  const warlock2 = levelWarlockTo(makeWarlock1(), 2);
  // Override CHA to 20 (+5)
  const sheet    = chooseEldritchInvocations(
    { ...warlock2, stats: { ...warlock2.stats, cha: 20 } },
    ['Agonizing Blast', 'Repelling Blast'],
  );
  const warlock  = buildCombatant(
    { ...sheet, stats: { ...sheet.stats, cha: 20 } },
    { x: 0, y: 0, z: 0 },
  );
  // Sanity check: combatant.cha = 20
  eq('10a. combatant.cha = 20', warlock.cha, 20);
  assert('10b. combatant has Agonizing Blast',
    warlock.eldritchInvocations?.includes('Agonizing Blast') === true);

  const goblin = makeGoblin('goblin', { pos: { x: 2, y: 0, z: 0 } });
  const bf     = makeBF([warlock, goblin]);
  const state  = makeState(bf);

  resolveAttack(warlock, goblin, ELDRITCH_BLAST_ACTION, state, true /* crit */);
  const dmgDealt = 100 - goblin.currentHP;
  // 2d10 crit = 2..20, +5 Agonizing Blast (NOT doubled) = 7..25
  assert('10c. damage in 7..25 range (2d10 crit + 5 CHA mod)',
    dmgDealt >= 7 && dmgDealt <= 25, `got ${dmgDealt}`);

  const agonizingLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Agonizing Blast'));
  assert('10d. Agonizing Blast log mentions +5', agonizingLog?.description.includes('+5') === true);
}

// ============================================================
// 11. ELDRITCH_INVOCATIONS registry has all 4 v1 entries
// ============================================================
console.log('\n--- 11. Registry has all 4 v1 invocations ---');
{
  const names = Object.keys(ELDRITCH_INVOCATIONS).sort();
  eq('11a. registry has 4 entries', names.length, 4);
  assert('11b. includes Agonizing Blast',    names.includes('Agonizing Blast'));
  assert('11c. includes Grasp of Hadar',    names.includes('Grasp of Hadar'));
  assert('11d. includes Lance of Lethargy', names.includes('Lance of Lethargy'));
  assert('11e. includes Repelling Blast',   names.includes('Repelling Blast'));
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('eldritch_invocations_integration.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('eldritch_invocations_integration.test.ts: all tests passed ✅');
}
