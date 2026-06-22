// ============================================================
// Test: Open Hand Monk Wholeness of Body (Session 47, Task #29-follow-up-4)
//
// Validates that Wholeness of Body (Open Hand Monk 6, PHB p.79) is
// mechanically wired into the engine:
//   - Self-heal action: restores 3 × monk level HP
//   - Once per long rest (v1: once per combat)
//   - Planner fires when HP < 50% and a use is available
//   - Engine executes the heal and consumes the resource
//
// Coverage:
//   1. Open Hand Monk 6 has "Wholeness of Body" feature
//   2. Vanilla Monk 6 does NOT have "Wholeness of Body"
//   3. Combatant.classLevels is set (Monk → 6)
//   4. Combatant.resources.wholenessOfBody is set (max 1, remaining 1)
//   5. Planner fires Wholeness of Body when HP < 50%
//   6. Planner does NOT fire when HP ≥ 50%
//   7. Planner does NOT fire when no uses remaining
//   8. Planner does NOT fire for vanilla Monk (no feature)
//   9. Planner targetId = self.id (self-heal)
//  10. Engine executes heal: 3 × monk level HP
//  11. Engine consumes the wholenessOfBody resource (1 → 0)
//  12. Engine does NOT re-fire after resource consumed
//  13. Heal caps at maxHP
//  14. Heal works for multiclass (Monk 6 / Fighter 2 → 3 × 6 = 18, not 3 × 8)
//
// Run: npx ts-node src/test/wholeness_of_body.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant, hasFeature } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { planTurn } from '../ai/planner';
import { executePlannedAction, EngineState } from '../engine/combat';
import { Combatant, Battlefield, Vec3 } from '../types/core';

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

function makeEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 10000, currentHP: 10000, ac: 30, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos,
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
// 1. Open Hand Monk 6 has "Wholeness of Body" feature
// ============================================================
console.log('\n--- 1. Open Hand Monk 6 has Wholeness of Body ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('1. has Wholeness of Body', hasFeature(monk, 'Wholeness of Body'));
}

// ============================================================
// 2. Vanilla Monk 6 does NOT have "Wholeness of Body"
// ============================================================
console.log('\n--- 2. Vanilla Monk 6 does NOT have Wholeness of Body ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6);  // no subclass
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('2. does NOT have Wholeness of Body', !hasFeature(monk, 'Wholeness of Body'));
}

// ============================================================
// 3. Combatant.classLevels is set (Monk → 6)
// ============================================================
console.log('\n--- 3. classLevels set correctly ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  eq('3. classLevels[Monk] = 6', monk.classLevels?.['Monk'], 6);
}

// ============================================================
// 4. Combatant.resources.wholenessOfBody is set (max 1, remaining 1)
// ============================================================
console.log('\n--- 4. wholenessOfBody resource set ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('4a. wholenessOfBody resource exists', !!monk.resources?.wholenessOfBody);
  eq('4b. max = 1', monk.resources?.wholenessOfBody?.max, 1);
  eq('4c. remaining = 1', monk.resources?.wholenessOfBody?.remaining, 1);
}

// ============================================================
// 5. Planner fires Wholeness of Body when HP < 50%
// ============================================================
console.log('\n--- 5. Planner fires Wholeness of Body at low HP ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  // Set HP to 40% (below 50% threshold).
  monk.maxHP = 50;
  monk.currentHP = 20;  // 40%
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);

  const plan = planTurn(monk, bf);

  assert('5a. main action planned', plan.action !== null);
  if (plan.action) {
    eq('5b. action type = wholenessOfBody', plan.action.type, 'wholenessOfBody');
    assert('5c. description mentions Wholeness of Body',
      plan.action.description.includes('Wholeness of Body'));
  }
}

// ============================================================
// 6. Planner does NOT fire when HP ≥ 50%
// ============================================================
console.log('\n--- 6. Planner does NOT fire at high HP ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  monk.maxHP = 50;
  monk.currentHP = 30;  // 60% — above threshold
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);

  const plan = planTurn(monk, bf);

  if (plan.action) {
    assert('6. action is NOT wholenessOfBody (HP ≥ 50%)',
      plan.action.type !== 'wholenessOfBody');
  }
}

// ============================================================
// 7. Planner does NOT fire when no uses remaining
// ============================================================
console.log('\n--- 7. Planner does NOT fire when 0 uses remaining ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  monk.maxHP = 50;
  monk.currentHP = 20;  // 40% — below threshold
  // Drain the resource.
  if (monk.resources?.wholenessOfBody) {
    monk.resources.wholenessOfBody.remaining = 0;
  }
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);

  const plan = planTurn(monk, bf);

  if (plan.action) {
    assert('7. action is NOT wholenessOfBody (0 uses)',
      plan.action.type !== 'wholenessOfBody');
  }
}

// ============================================================
// 8. Planner does NOT fire for vanilla Monk (no feature)
// ============================================================
console.log('\n--- 8. Planner does NOT fire for vanilla Monk ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6);  // no subclass
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  monk.maxHP = 50;
  monk.currentHP = 20;  // 40% — below threshold
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);

  const plan = planTurn(monk, bf);

  if (plan.action) {
    assert('8. action is NOT wholenessOfBody (vanilla monk)',
      plan.action.type !== 'wholenessOfBody');
  }
}

// ============================================================
// 9. Planner targetId = self.id (self-heal)
// ============================================================
console.log('\n--- 9. Wholeness of Body targets self ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  monk.maxHP = 50;
  monk.currentHP = 20;  // 40%
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);

  const plan = planTurn(monk, bf);

  if (plan.action?.type === 'wholenessOfBody') {
    eq('9. targetId = self.id', plan.action.targetId, monk.id);
  } else {
    assert('9. precondition: action is wholenessOfBody', false);
  }
}

// ============================================================
// 10. Engine executes heal: 3 × monk level HP
// ============================================================
console.log('\n--- 10. Engine heals 3 × monk level ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  monk.maxHP = 100;
  monk.currentHP = 10;  // well below max so heal isn't capped
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);
  const state = makeState(bf);

  const plan = planTurn(monk, bf);
  assert('10a. plan is wholenessOfBody', plan.action?.type === 'wholenessOfBody');

  if (plan.action?.type === 'wholenessOfBody') {
    const hpBefore = monk.currentHP;
    executePlannedAction(monk, plan.action, state);
    const hpAfter = monk.currentHP;
    const healed = hpAfter - hpBefore;
    // 3 × monk level 6 = 18
    eq('10b. healed 18 HP (3 × monk level 6)', healed, 18);
    console.log(`    HP ${hpBefore} → ${hpAfter} (healed ${healed})`);
  }
}

// ============================================================
// 11. Engine consumes the wholenessOfBody resource (1 → 0)
// ============================================================
console.log('\n--- 11. Resource consumed after use ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  monk.maxHP = 100;
  monk.currentHP = 10;
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);
  const state = makeState(bf);

  const plan = planTurn(monk, bf);
  if (plan.action?.type === 'wholenessOfBody') {
    executePlannedAction(monk, plan.action, state);
    eq('11. remaining = 0 after use', monk.resources?.wholenessOfBody?.remaining, 0);
  }
}

// ============================================================
// 12. Engine does NOT re-fire after resource consumed
// ============================================================
console.log('\n--- 12. Does NOT re-fire after resource consumed ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  monk.maxHP = 100;
  monk.currentHP = 10;  // still low HP
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);
  const state = makeState(bf);

  // First turn: fire Wholeness of Body
  const plan1 = planTurn(monk, bf);
  if (plan1.action?.type === 'wholenessOfBody') {
    executePlannedAction(monk, plan1.action, state);
  }
  // After healing, HP = 10 + 18 = 28. Still below 50% of 100 (50).
  // But the resource is now 0 — the planner should NOT fire again.
  const plan2 = planTurn(monk, bf);
  if (plan2.action) {
    assert('12. action is NOT wholenessOfBody (resource consumed)',
      plan2.action.type !== 'wholenessOfBody');
  }
}

// ============================================================
// 13. Heal caps at maxHP
// ============================================================
console.log('\n--- 13. Heal caps at maxHP ---');
{
  const sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  // Set maxHP = 25, currentHP = 20. Heal = 18. 20 + 18 = 38 > 25 → capped at 25.
  monk.maxHP = 25;
  monk.currentHP = 20;
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);
  const state = makeState(bf);

  const plan = planTurn(monk, bf);
  if (plan.action?.type === 'wholenessOfBody') {
    executePlannedAction(monk, plan.action, state);
    assert('13a. HP ≤ maxHP', monk.currentHP <= monk.maxHP);
    eq('13b. HP = maxHP (capped)', monk.currentHP, 25);
  }
}

// ============================================================
// 14. Multiclass: Monk 6 / Fighter 2 → 3 × 6 = 18, not 3 × 8 = 24
// ============================================================
console.log('\n--- 14. Multiclass uses monk level, not total level ---');
{
  let sheet = levelTo(makeMonk1(), 'Monk', 6, 'Way of the Open Hand');
  // Multiclass into Fighter for 2 levels.
  sheet = applyLevelUp(sheet, 'Fighter').sheet;
  sheet = applyLevelUp(sheet, 'Fighter').sheet;

  const monk = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  // Verify classLevels
  eq('14a. classLevels[Monk] = 6', monk.classLevels?.['Monk'], 6);
  eq('14b. classLevels[Fighter] = 2', monk.classLevels?.['Fighter'], 2);
  eq('14c. total level = 8', monk.level, 8);

  monk.maxHP = 100;
  monk.currentHP = 10;
  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 });
  const bf = makeBF([monk, enemy]);
  const state = makeState(bf);

  const plan = planTurn(monk, bf);
  assert('14d. plan is wholenessOfBody', plan.action?.type === 'wholenessOfBody');

  if (plan.action?.type === 'wholenessOfBody') {
    const hpBefore = monk.currentHP;
    executePlannedAction(monk, plan.action, state);
    const healed = monk.currentHP - hpBefore;
    // 3 × monk level 6 = 18, NOT 3 × total level 8 = 24
    eq('14e. healed 18 HP (3 × monk level, not total)', healed, 18);
    console.log(`    HP ${hpBefore} → ${monk.currentHP} (healed ${healed}, monk lv 6 not total lv 8)`);
  }
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('wholeness_of_body.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('wholeness_of_body.test.ts: all tests passed ✅');
}
