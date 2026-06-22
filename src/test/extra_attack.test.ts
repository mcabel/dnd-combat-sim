// ============================================================
// Test: Extra Attack for Martial Classes (Session 43, Task #24)
//
// Validates that martial classes (Fighter, Barbarian, Paladin, Ranger,
// Monk) gain Extra Attack at level 5 — two attacks per Attack action.
// Also validates Fighter 11 (Extra Attack (2) → 3 attacks) and Fighter
// 20 (Extra Attack (3) → 4 attacks).
//
// Coverage:
//   1. classFeatures transferred to Combatant (Fighter 5 has "Extra Attack")
//   2. hasFeature helper works
//   3. Fighter 5 → attackCount = 2
//   4. Fighter 11 → attackCount = 3 (Extra Attack (2))
//   5. Fighter 20 → attackCount = 4 (Extra Attack (3))
//   6. Fighter 4 → no attackCount (no Extra Attack yet)
//   7. Barbarian 5 → attackCount = 2
//   8. Paladin 5 → attackCount = 2
//   9. Ranger 5 → attackCount = 2 (ranged weapon OK — Extra Attack works with any Attack)
//  10. Monk 5 → attackCount = 2
//  11. Wizard 5 → NO attackCount (no Extra Attack for casters)
//  12. Engine executes 2 attacks for Fighter 5
//  13. Engine executes 3 attacks for Fighter 11
//  14. Engine skips subsequent attacks if target dies (Fighter 5 + 1 HP enemy)
//  15. End-to-end: Fighter 5 with Extra Attack deals ~2× damage vs Fighter 4
//
// Run: npx ts-node src/test/extra_attack.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { buildCombatant, hasFeature } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { planTurn } from '../ai/planner';
import { executePlannedAction, EngineState } from '../engine/combat';
import { Combatant, Action, Vec3, Battlefield } from '../types/core';

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

function makeBarbarian1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Krog', race: 'Half-Orc', background: 'Outlander',
    alignment: 'Chaotic Neutral',
    firstClass: 'Barbarian',
    classLevels: [{ className: 'Barbarian', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 17, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
    stats:     { str: 17, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
    maxHP: 14, currentHP: 14, temporaryHP: 0,
    armorClass: 13, acFormula: 'Unarmored Defense', speed: 30,
    hitDice: [{ className: 'Barbarian', dieSides: 12, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium'], weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','con'],
      skills: ['Athletics','Intimidation'], expertise: [],
    },
    languages: ['Common', 'Orc'],
    resources: { rage: { max: 2, remaining: 2 } },
    spellcasting: undefined,
    equipment: [{ name: 'Greataxe', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [
      { name: 'Rage', description: 'Enter a battle fury.', source: 'class' },
      { name: 'Unarmored Defense', description: 'AC = 10 + DEX + CON.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Rage', description: 'Enter a battle fury.', source: 'class' },
      { name: 'Unarmored Defense', description: 'AC = 10 + DEX + CON.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Wanderer', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function makePaladin1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Sir Aldric', race: 'Human', background: 'Noble',
    alignment: 'Lawful Good',
    firstClass: 'Paladin',
    classLevels: [{ className: 'Paladin', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 14 },
    stats:     { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 14 },
    maxHP: 12, currentHP: 12, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail', speed: 30,
    hitDice: [{ className: 'Paladin', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','heavy','shield'],
      weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['wis','cha'],
      skills: ['Athletics','Persuasion'], expertise: [],
    },
    languages: ['Common'],
    resources: { layOnHands: { pool: 5, remaining: 5 } },
    spellcasting: undefined,
    equipment: [{ name: 'Longsword', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [
      { name: 'Divine Sense', description: 'Detect celestials/fiends/undead.', source: 'class' },
      { name: 'Lay on Hands', description: 'Heal pool.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Divine Sense', description: 'Detect celestials/fiends/undead.', source: 'class' },
      { name: 'Lay on Hands', description: 'Heal pool.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Position of Privilege', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function makeRanger1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Lyra', race: 'Wood Elf', background: 'Outlander',
    alignment: 'Neutral Good',
    firstClass: 'Ranger',
    classLevels: [{ className: 'Ranger', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 12, dex: 17, con: 13, int: 10, wis: 14, cha: 10 },
    stats:     { str: 12, dex: 17, con: 13, int: 10, wis: 14, cha: 10 },
    maxHP: 11, currentHP: 11, temporaryHP: 0,
    armorClass: 14, acFormula: 'Leather + DEX', speed: 35,
    hitDice: [{ className: 'Ranger', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'],
      weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','dex'],
      skills: ['Stealth','Survival'], expertise: [],
    },
    languages: ['Common', 'Elvish'],
    resources: {},
    spellcasting: undefined,
    equipment: [
      { name: 'Longbow', quantity: 1, equipped: true, category: 'weapon' },
      { name: 'Shortsword', quantity: 1, equipped: true, category: 'weapon' },
    ],
    gold: 10,
    level1Features: [
      { name: 'Favored Enemy', description: 'Adv on tracking favored enemies.', source: 'class' },
      { name: 'Natural Explorer', description: 'Difficult terrain immune in favored terrain.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Favored Enemy', description: 'Adv on tracking favored enemies.', source: 'class' },
      { name: 'Natural Explorer', description: 'Difficult terrain immune in favored terrain.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Wanderer', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

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
    armorClass: 14, acFormula: 'Unarmored Defense (Monk)', speed: 30,
    hitDice: [{ className: 'Monk', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','martial-melee'],
      tools: [], savingThrows: ['str','dex'],
      skills: ['Acrobatics','Insight'], expertise: [],
    },
    languages: ['Common'],
    resources: {},
    spellcasting: undefined,
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 5,
    level1Features: [
      { name: 'Unarmored Defense', description: 'AC = 10 + DEX + WIS.', source: 'class' },
      { name: 'Martial Arts', description: 'Use DEX for monk weapons.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Unarmored Defense', description: 'AC = 10 + DEX + WIS.', source: 'class' },
      { name: 'Martial Arts', description: 'Use DEX for monk weapons.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Discovery', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function makeWizard1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Aelindra', race: 'High Elf', background: 'Sage',
    alignment: 'Chaotic Good',
    firstClass: 'Wizard',
    classLevels: [{ className: 'Wizard', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 15, con: 13, int: 15, wis: 12, cha: 10 },
    stats:     { str: 8, dex: 16, con: 13, int: 16, wis: 12, cha: 10 },
    maxHP: 7, currentHP: 7, temporaryHP: 0,
    armorClass: 13, acFormula: 'DEX Unarmored', speed: 30,
    hitDice: [{ className: 'Wizard', dieSides: 6, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['int','wis'],
      skills: ['Arcana','History'], expertise: [],
    },
    languages: ['Common', 'Elvish'],
    resources: { arcaneRecovery: { usesRemaining: 1 } },
    spellcasting: {
      ability: 'int', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Fire Bolt'],
      knownSpells: [],
      preparedSpells: ['Magic Missile'],
      spellbook: ['Magic Missile', 'Shield'],
    },
    equipment: [{ name: 'Dagger', quantity: 2, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Spellcasting', description: 'INT caster.', source: 'class' }],
    allFeatures:    [{ name: 'Spellcasting', description: 'INT caster.', source: 'class' }],
    feats: [], backgroundFeature: 'Researcher', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function levelTo(sheet: CharacterSheet, target: number, className?: string): CharacterSheet {
  let s = sheet;
  const cn = className ?? s.firstClass;
  const startLevel = s.classLevels.find(cl => cl.className === cn)?.level ?? 0;
  for (let i = startLevel; i < target; i++) {
    s = applyLevelUp(s, cn).sheet;
  }
  return s;
}

function makeEnemy(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 200, currentHP: 200, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 1, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
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

function makeBF(combatants: Combatant[]): Battlefield {
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

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ============================================================
// 1. classFeatures transferred to Combatant
// ============================================================
console.log('\n--- 1. classFeatures transferred ---');
{
  const fighter5 = levelTo(makeFighter1(), 5);
  const combatant = buildCombatant(fighter5, { x: 0, y: 0, z: 0 });
  assert('1a. combatant.classFeatures is populated', Array.isArray(combatant.classFeatures) && combatant.classFeatures!.length > 0);
  assert('1b. Fighter 5 has "Extra Attack" feature', combatant.classFeatures?.includes('Extra Attack') === true);
  assert('1c. Fighter 5 has "Second Wind" feature', combatant.classFeatures?.includes('Second Wind') === true);
  // Fighter 2 gets Action Surge
  assert('1d. Fighter 5 has "Action Surge (1/rest)" feature', combatant.classFeatures?.includes('Action Surge (1/rest)') === true);

  // Level 1 fighter doesn't have Extra Attack
  const fighter1Combatant = buildCombatant(makeFighter1(), { x: 0, y: 0, z: 0 });
  assert('1e. Fighter 1 does NOT have "Extra Attack"', fighter1Combatant.classFeatures?.includes('Extra Attack') !== true);
}

// ============================================================
// 2. hasFeature helper works
// ============================================================
console.log('\n--- 2. hasFeature helper ---');
{
  const fighter5 = levelTo(makeFighter1(), 5);
  const combatant = buildCombatant(fighter5, { x: 0, y: 0, z: 0 });
  assert('2a. hasFeature(fighter5, "Extra Attack") = true', hasFeature(combatant, 'Extra Attack'));
  assert('2b. hasFeature(fighter5, "Nonexistent") = false', !hasFeature(combatant, 'Nonexistent'));

  // Monster (no classFeatures) → always false
  const monster = makeEnemy('goblin');
  assert('2c. hasFeature(monster, "Extra Attack") = false', !hasFeature(monster, 'Extra Attack'));
}

// ============================================================
// 3. Fighter 5 → attackCount = 2
// ============================================================
console.log('\n--- 3. Fighter 5 Extra Attack ---');
{
  const fighter5 = levelTo(makeFighter1(), 5);
  const fighter = buildCombatant(fighter5, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);

  assert('3a. plan.action is set', plan.action !== null);
  if (plan.action) {
    eq('3b. plan.action.type = attack', plan.action.type, 'attack');
    eq('3c. plan.action.attackCount = 2 (Extra Attack)', plan.action.attackCount, 2);
  }
}

// ============================================================
// 4. Fighter 11 → attackCount = 3 (Extra Attack (2))
// ============================================================
console.log('\n--- 4. Fighter 11 Extra Attack (2) ---');
{
  const fighter11 = levelTo(makeFighter1(), 11);
  // Pick a subclass for level 3 (Martial Archetype)
  fighter11.subclassChoices['Fighter'] = 'Champion';
  const fighter = buildCombatant(fighter11, { x: 0, y: 0, z: 0 });
  assert('4a. Fighter 11 has "Extra Attack (2)"', hasFeature(fighter, 'Extra Attack (2)'));
  // Fighter 11 also still has "Extra Attack" (from level 5)
  assert('4b. Fighter 11 also has "Extra Attack"', hasFeature(fighter, 'Extra Attack'));

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);
  if (plan.action) {
    eq('4c. plan.action.attackCount = 3 (Extra Attack (2))', plan.action.attackCount, 3);
  }
}

// ============================================================
// 5. Fighter 20 → attackCount = 4 (Extra Attack (3))
// ============================================================
console.log('\n--- 5. Fighter 20 Extra Attack (3) ---');
{
  const fighter20 = levelTo(makeFighter1(), 20);
  fighter20.subclassChoices['Fighter'] = 'Champion';
  const fighter = buildCombatant(fighter20, { x: 0, y: 0, z: 0 });
  assert('5a. Fighter 20 has "Extra Attack (3)"', hasFeature(fighter, 'Extra Attack (3)'));

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);
  if (plan.action) {
    eq('5b. plan.action.attackCount = 4 (Extra Attack (3))', plan.action.attackCount, 4);
  }
}

// ============================================================
// 6. Fighter 4 → no attackCount
// ============================================================
console.log('\n--- 6. Fighter 4 (no Extra Attack) ---');
{
  const fighter4 = levelTo(makeFighter1(), 4);
  const fighter = buildCombatant(fighter4, { x: 0, y: 0, z: 0 });
  assert('6a. Fighter 4 does NOT have "Extra Attack"', !hasFeature(fighter, 'Extra Attack'));

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([fighter, enemy]);
  const plan = planTurn(fighter, bf);
  if (plan.action && plan.action.type === 'attack') {
    assert('6b. attackCount NOT set (Fighter 4 has no Extra Attack)',
      plan.action.attackCount === undefined || plan.action.attackCount === 1);
  }
}

// ============================================================
// 7. Barbarian 5 → attackCount = 2
// ============================================================
console.log('\n--- 7. Barbarian 5 Extra Attack ---');
{
  const barb5 = levelTo(makeBarbarian1(), 5);
  const barb = buildCombatant(barb5, { x: 0, y: 0, z: 0 });
  assert('7a. Barbarian 5 has "Extra Attack"', hasFeature(barb, 'Extra Attack'));

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([barb, enemy]);
  const plan = planTurn(barb, bf);
  if (plan.action && plan.action.type === 'attack') {
    eq('7b. Barbarian 5 attackCount = 2', plan.action.attackCount, 2);
  }
}

// ============================================================
// 8. Paladin 5 → attackCount = 2
// ============================================================
console.log('\n--- 8. Paladin 5 Extra Attack ---');
{
  const pal5 = levelTo(makePaladin1(), 5);
  pal5.subclassChoices['Paladin'] = 'Devotion';
  const pal = buildCombatant(pal5, { x: 0, y: 0, z: 0 });
  assert('8a. Paladin 5 has "Extra Attack"', hasFeature(pal, 'Extra Attack'));

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([pal, enemy]);
  const plan = planTurn(pal, bf);
  if (plan.action && plan.action.type === 'attack') {
    eq('8b. Paladin 5 attackCount = 2', plan.action.attackCount, 2);
  }
}

// ============================================================
// 9. Ranger 5 → attackCount = 2 (works with ranged too)
// ============================================================
console.log('\n--- 9. Ranger 5 Extra Attack (ranged OK) ---');
{
  const ranger5 = levelTo(makeRanger1(), 5);
  ranger5.subclassChoices['Ranger'] = 'Hunter';
  const ranger = buildCombatant(ranger5, { x: 0, y: 0, z: 0 });
  assert('9a. Ranger 5 has "Extra Attack"', hasFeature(ranger, 'Extra Attack'));

  // Enemy at range — Ranger will use Longbow (ranged)
  const enemy = makeEnemy('enemy', { pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([ranger, enemy]);
  const plan = planTurn(ranger, bf);
  if (plan.action && plan.action.type === 'attack') {
    // Extra Attack works with ranged weapons too (PHB p.92: "whenever you
    // take the Attack action on your turn"). The attackCount must be 2
    // regardless of melee vs ranged.
    eq('9b. Ranger 5 attackCount = 2 (ranged OK)', plan.action.attackCount, 2);
  }
}

// ============================================================
// 10. Monk 5 → attackCount = 2
// ============================================================
console.log('\n--- 10. Monk 5 Extra Attack ---');
{
  const monk5 = levelTo(makeMonk1(), 5);
  monk5.subclassChoices['Monk'] = 'Open Hand';
  const monk = buildCombatant(monk5, { x: 0, y: 0, z: 0 });
  assert('10a. Monk 5 has "Extra Attack"', hasFeature(monk, 'Extra Attack'));

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([monk, enemy]);
  const plan = planTurn(monk, bf);
  if (plan.action && plan.action.type === 'attack') {
    eq('10b. Monk 5 attackCount = 2', plan.action.attackCount, 2);
  }
}

// ============================================================
// 11. Wizard 5 → NO attackCount (caster, no Extra Attack)
// ============================================================
console.log('\n--- 11. Wizard 5 (no Extra Attack) ---');
{
  const wiz5 = levelTo(makeWizard1(), 5);
  const wiz = buildCombatant(wiz5, { x: 0, y: 0, z: 0 });
  assert('11a. Wizard 5 does NOT have "Extra Attack"', !hasFeature(wiz, 'Extra Attack'));

  // Wizard 5 will likely cast a spell rather than melee attack,
  // but even if forced to attack, attackCount should not be set.
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([wiz, enemy]);
  const plan = planTurn(wiz, bf);
  if (plan.action && plan.action.type === 'attack') {
    assert('11b. Wizard 5 attackCount NOT set',
      plan.action.attackCount === undefined || plan.action.attackCount === 1);
  } else {
    // Wizard casts a spell instead — also fine, no Extra Attack applies
    assert('11b. Wizard 5 does not attack (casts spell instead)', true);
  }
}

// ============================================================
// 12. Engine executes 2 attacks for Fighter 5
// ============================================================
console.log('\n--- 12. Engine executes 2 attacks (Fighter 5) ---');
{
  const fighter5 = levelTo(makeFighter1(), 5);
  const fighter = buildCombatant(fighter5, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);
  assert('12a. plan has attackCount = 2', plan.action?.attackCount === 2);

  if (plan.action) {
    executePlannedAction(fighter, plan.action, state);
  }

  const attackEvents = state.log.events.filter((e: any) =>
    (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit') &&
    e.actorId === fighter.id
  );
  eq('12b. 2 attack events logged (Extra Attack)', attackEvents.length, 2);

  const extraAttackLog = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('attack 2/2'));
  assert('12c. "attack 2/2" log entry present', extraAttackLog !== undefined);
}

// ============================================================
// 13. Engine executes 3 attacks for Fighter 11
// ============================================================
console.log('\n--- 13. Engine executes 3 attacks (Fighter 11) ---');
{
  const fighter11 = levelTo(makeFighter1(), 11);
  fighter11.subclassChoices['Fighter'] = 'Champion';
  const fighter = buildCombatant(fighter11, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);
  assert('13a. plan has attackCount = 3', plan.action?.attackCount === 3);

  if (plan.action) {
    executePlannedAction(fighter, plan.action, state);
  }

  const attackEvents = state.log.events.filter((e: any) =>
    (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit') &&
    e.actorId === fighter.id
  );
  eq('13b. 3 attack events logged (Fighter 11)', attackEvents.length, 3);
}

// ============================================================
// 14. Engine skips subsequent attacks if target dies (Fighter 5 + 1 HP enemy)
// ============================================================
console.log('\n--- 14. Engine skips dead-target attacks ---');
{
  const fighter5 = levelTo(makeFighter1(), 5);
  // Retry until first attack hits (deterministic — see thirsting_blade test 8
  // for the same retry pattern; Fighter 5 has +6 attack vs AC 10, ~80% hit
  // chance, so first-hit probability is high).
  let attackEventCount = 0;
  let enemyDead = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const fighter = buildCombatant(fighter5, { x: 0, y: 0, z: 0 });
    const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1, currentHP: 1 });
    const bf = makeBF([fighter, enemy]);
    const state = makeState(bf);

    const plan = planTurn(fighter, bf);
    if (!plan.action) continue;
    executePlannedAction(fighter, plan.action, state);

    const events = state.log.events.filter((e: any) =>
      (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit') &&
      e.actorId === fighter.id
    );
    const firstAttackHit = events.length > 0 && events[0].type !== 'attack_miss';
    if (!firstAttackHit) continue;

    attackEventCount = events.length;
    enemyDead = enemy.isDead;
    break;
  }

  eq('14a. only 1 attack event (target died on first)', attackEventCount, 1);
  assert('14b. enemy is dead', enemyDead);
}

// ============================================================
// 15. End-to-end: Fighter 5 with Extra Attack deals ~2× damage vs Fighter 4
// ============================================================
console.log('\n--- 15. End-to-end ~2× damage ---');
{
  const fighter5Sheet = levelTo(makeFighter1(), 5);
  const fighter4Sheet = levelTo(makeFighter1(), 4);

  const N = 60;
  let totalDmgWithExtra = 0;
  let totalDmgWithout = 0;

  for (let i = 0; i < N; i++) {
    // With Extra Attack (Fighter 5)
    const fA = buildCombatant(fighter5Sheet, { x: 0, y: 0, z: 0 });
    const eA = makeEnemy(`eA${i}`, { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
    const bfA = makeBF([fA, eA]);
    const stateA = makeState(bfA);
    const planA = planTurn(fA, bfA);
    if (planA.action) executePlannedAction(fA, planA.action, stateA);
    totalDmgWithExtra += (1000 - eA.currentHP);

    // Without Extra Attack (Fighter 4)
    const fB = buildCombatant(fighter4Sheet, { x: 0, y: 0, z: 0 });
    const eB = makeEnemy(`eB${i}`, { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
    const bfB = makeBF([fB, eB]);
    const stateB = makeState(bfB);
    const planB = planTurn(fB, bfB);
    if (planB.action) executePlannedAction(fB, planB.action, stateB);
    totalDmgWithout += (1000 - eB.currentHP);
  }

  const avgWith = totalDmgWithExtra / N;
  const avgWithout = totalDmgWithout / N;
  console.log(`    Average damage with Extra Attack:    ${avgWith.toFixed(1)}`);
  console.log(`    Average damage without Extra Attack: ${avgWithout.toFixed(1)}`);
  console.log(`    Ratio: ${(avgWith / avgWithout).toFixed(2)}×`);

  // Extra Attack should roughly double damage (2 attacks vs 1).
  // Use a generous bound (1.3×) to account for variance — with N=60
  // trials, the std error of the ratio is small enough that 1.3× is
  // ~5 std below the expected 2.0× ratio. P(ratio < 1.3) ≈ 1e-7.
  assert(`15a. Extra Attack damage > 1.3× non-Extra damage (${avgWith.toFixed(1)} > ${avgWithout.toFixed(1)})`,
    avgWith > avgWithout * 1.3);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('extra_attack.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('extra_attack.test.ts: all tests passed ✅');
}
