// ============================================================
// Test: Action Surge Engine Integration (Session 43, Task #23)
//
// Validates that Fighter 2+ can use Action Surge to take one additional
// action on their turn (PHB p.72). The planner sets plan.extraAction
// when actionSurge.remaining > 0; the engine executes it after the main
// action and consumes one use.
//
// Coverage:
//   1. actionSurge transferred to Combatant (Fighter 2 has it, Fighter 1 doesn't)
//   2. actionSurge max values (Fighter 2 = 1, Fighter 17 = 2)
//   3. Planner sets plan.extraAction when actionSurge available
//   4. Planner does NOT set plan.extraAction when actionSurge.remaining = 0
//   5. Planner does NOT set plan.extraAction for non-Fighters (no actionSurge)
//   6. Engine executes extraAction (Fighter 2 makes 2 attacks: 1 main + 1 surge)
//   7. Engine consumes actionSurge (remaining goes from 1 to 0)
//   8. Engine does NOT execute extraAction if actionSurge is depleted
//   9. Action Surge + Extra Attack (Fighter 5 = 4 attacks total: 2 main + 2 surge)
//  10. Action Surge + Extra Attack (2) (Fighter 11 = 6 attacks total)
//  11. "uses Action Surge" log entry present
//  12. End-to-end: Fighter 2 with Action Surge deals ~2× damage vs without
//
// Run: npx ts-node src/test/action_surge.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { planTurn } from '../ai/planner';
import { executeTurnPlan, EngineState } from '../engine/combat';
import { Combatant, Vec3, Battlefield, TurnPlan } from '../types/core';

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

// Helper: count attack events from a given actor
function countAttackEvents(state: EngineState, actorId: string): number {
  return state.log.events.filter((e: any) =>
    (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit') &&
    e.actorId === actorId
  ).length;
}

// ============================================================
// 1. actionSurge transferred to Combatant
// ============================================================
console.log('\n--- 1. actionSurge transferred ---');
{
  const fighter1 = makeFighter1();
  const fighter2 = levelTo(makeFighter1(), 2);
  const c1 = buildCombatant(fighter1, { x: 0, y: 0, z: 0 });
  const c2 = buildCombatant(fighter2, { x: 0, y: 0, z: 0 });

  assert('1a. Fighter 1 has NO actionSurge', c1.resources?.actionSurge === undefined);
  assert('1b. Fighter 2 has actionSurge', c2.resources?.actionSurge !== undefined);
  eq('1c. Fighter 2 actionSurge.max = 1', c2.resources?.actionSurge?.max, 1);
  eq('1d. Fighter 2 actionSurge.remaining = 1', c2.resources?.actionSurge?.remaining, 1);
}

// ============================================================
// 2. actionSurge max values (Fighter 17 = 2 uses)
// ============================================================
console.log('\n--- 2. actionSurge max at Fighter 17 ---');
{
  const fighter17 = levelTo(makeFighter1(), 17);
  fighter17.subclassChoices['Fighter'] = 'Champion';
  const c17 = buildCombatant(fighter17, { x: 0, y: 0, z: 0 });
  eq('2a. Fighter 17 actionSurge.max = 2', c17.resources?.actionSurge?.max, 2);
  eq('2b. Fighter 17 actionSurge.remaining = 2', c17.resources?.actionSurge?.remaining, 2);
}

// ============================================================
// 3. Planner sets plan.extraAction when actionSurge available
// ============================================================
console.log('\n--- 3. Planner sets plan.extraAction ---');
{
  const fighter2 = levelTo(makeFighter1(), 2);
  const fighter = buildCombatant(fighter2, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);
  assert('3a. plan.extraAction is set', plan.extraAction !== null && plan.extraAction !== undefined);
  if (plan.extraAction) {
    eq('3b. extraAction.type = attack', plan.extraAction.type, 'attack');
    eq('3c. extraAction.targetId = enemy.id', plan.extraAction.targetId, 'enemy');
    // Fighter 2 has no Extra Attack, so attackCount should be undefined (1 attack)
    assert('3d. extraAction.attackCount is undefined (Fighter 2 has no Extra Attack)',
      plan.extraAction.attackCount === undefined || plan.extraAction.attackCount === 1);
  }
}

// ============================================================
// 4. Planner does NOT set plan.extraAction when actionSurge.remaining = 0
// ============================================================
console.log('\n--- 4. No extraAction when actionSurge depleted ---');
{
  const fighter2 = levelTo(makeFighter1(), 2);
  const fighter = buildCombatant(fighter2, { x: 0, y: 0, z: 0 });
  // Manually deplete actionSurge
  if (fighter.resources?.actionSurge) {
    fighter.resources.actionSurge.remaining = 0;
  }
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([fighter, enemy]);

  const plan = planTurn(fighter, bf);
  assert('4a. plan.extraAction is NOT set (actionSurge.remaining = 0)',
    plan.extraAction === null || plan.extraAction === undefined);
}

// ============================================================
// 5. Planner does NOT set plan.extraAction for non-Fighters
// ============================================================
console.log('\n--- 5. No extraAction for non-Fighters ---');
{
  const wizard5 = levelTo(makeWizard1(), 5);
  const wiz = buildCombatant(wizard5, { x: 0, y: 0, z: 0 });
  // Wizard doesn't have actionSurge
  assert('5a. Wizard has NO actionSurge resource', wiz.resources?.actionSurge === undefined);

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([wiz, enemy]);
  const plan = planTurn(wiz, bf);
  // Wizard doesn't attack (casts spell), so extraAction wouldn't apply anyway
  assert('5b. plan.extraAction is NOT set for Wizard',
    plan.extraAction === null || plan.extraAction === undefined);
}

// ============================================================
// 6. Engine executes extraAction (Fighter 2 makes 2 attacks)
// ============================================================
console.log('\n--- 6. Engine executes extraAction ---');
{
  const fighter2 = levelTo(makeFighter1(), 2);
  const fighter = buildCombatant(fighter2, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);
  assert('6a. plan.extraAction is set', plan.extraAction !== null && plan.extraAction !== undefined);

  executeTurnPlan(fighter, plan, state);

  // Fighter 2 with Action Surge should make 2 attacks (1 main + 1 surge)
  const attackCount = countAttackEvents(state, fighter.id);
  eq('6b. 2 attack events (1 main + 1 Action Surge)', attackCount, 2);
}

// ============================================================
// 7. Engine consumes actionSurge (remaining: 1 → 0)
// ============================================================
console.log('\n--- 7. actionSurge consumed ---');
{
  const fighter2 = levelTo(makeFighter1(), 2);
  const fighter = buildCombatant(fighter2, { x: 0, y: 0, z: 0 });
  eq('7a. actionSurge.remaining = 1 before turn', fighter.resources?.actionSurge?.remaining, 1);

  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);
  executeTurnPlan(fighter, plan, state);

  eq('7b. actionSurge.remaining = 0 after turn', fighter.resources?.actionSurge?.remaining, 0);
}

// ============================================================
// 8. Engine does NOT execute extraAction if actionSurge is depleted
//     (simulate a 2nd turn after the 1st used Action Surge)
// ============================================================
console.log('\n--- 8. No extraAction on 2nd turn (depleted) ---');
{
  const fighter2 = levelTo(makeFighter1(), 2);
  const fighter = buildCombatant(fighter2, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  // Turn 1: uses Action Surge
  const plan1 = planTurn(fighter, bf);
  executeTurnPlan(fighter, plan1, state);
  eq('8a. actionSurge.remaining = 0 after turn 1', fighter.resources?.actionSurge?.remaining, 0);

  // Reset turn budget for turn 2
  fighter.budget.actionUsed = false;
  fighter.budget.bonusActionUsed = false;
  fighter.budget.movementFt = fighter.speed;

  // Turn 2: no Action Surge left
  const plan2 = planTurn(fighter, bf);
  assert('8b. plan.extraAction NOT set on turn 2 (depleted)',
    plan2.extraAction === null || plan2.extraAction === undefined);

  const attacksBeforeTurn2 = countAttackEvents(state, fighter.id);
  executeTurnPlan(fighter, plan2, state);
  const attacksAfterTurn2 = countAttackEvents(state, fighter.id);
  // Only 1 attack on turn 2 (no Action Surge)
  eq('8c. only 1 attack on turn 2 (no surge)', attacksAfterTurn2 - attacksBeforeTurn2, 1);
}

// ============================================================
// 9. Action Surge + Extra Attack (Fighter 5 = 4 attacks total)
// ============================================================
console.log('\n--- 9. Fighter 5 Action Surge + Extra Attack ---');
{
  const fighter5 = levelTo(makeFighter1(), 5);
  const fighter = buildCombatant(fighter5, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);
  // Main action should have attackCount = 2 (Extra Attack)
  eq('9a. plan.action.attackCount = 2 (Extra Attack)', plan.action?.attackCount, 2);
  // Extra action should also have attackCount = 2 (Extra Attack applies per Attack action)
  eq('9b. plan.extraAction.attackCount = 2 (Extra Attack on surge)', plan.extraAction?.attackCount, 2);

  executeTurnPlan(fighter, plan, state);
  // Total attacks: 2 (main) + 2 (surge) = 4
  const attackCount = countAttackEvents(state, fighter.id);
  eq('9c. 4 attack events (2 main + 2 Action Surge)', attackCount, 4);
}

// ============================================================
// 10. Action Surge + Extra Attack (2) (Fighter 11 = 6 attacks total)
// ============================================================
console.log('\n--- 10. Fighter 11 Action Surge + Extra Attack (2) ---');
{
  const fighter11 = levelTo(makeFighter1(), 11);
  fighter11.subclassChoices['Fighter'] = 'Champion';
  const fighter = buildCombatant(fighter11, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);
  // Main: 3 attacks (Extra Attack (2))
  eq('10a. plan.action.attackCount = 3 (Extra Attack (2))', plan.action?.attackCount, 3);
  // Surge: also 3 attacks
  eq('10b. plan.extraAction.attackCount = 3', plan.extraAction?.attackCount, 3);

  executeTurnPlan(fighter, plan, state);
  // Total: 3 + 3 = 6 attacks
  const attackCount = countAttackEvents(state, fighter.id);
  eq('10c. 6 attack events (3 main + 3 Action Surge)', attackCount, 6);
}

// ============================================================
// 11. "uses Action Surge" log entry present
// ============================================================
console.log('\n--- 11. Action Surge log entry ---');
{
  const fighter2 = levelTo(makeFighter1(), 2);
  const fighter = buildCombatant(fighter2, { x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy', { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([fighter, enemy]);
  const state = makeState(bf);

  const plan = planTurn(fighter, bf);
  executeTurnPlan(fighter, plan, state);

  const surgeLog = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('Action Surge'));
  assert('11a. "Action Surge" log entry present', surgeLog !== undefined);
}

// ============================================================
// 12. End-to-end: Fighter 2 with Action Surge deals ~2× damage
// ============================================================
console.log('\n--- 12. End-to-end ~2× damage ---');
{
  // Fighter 2 WITH Action Surge (default — remaining = 1)
  const fighter2Sheet = levelTo(makeFighter1(), 2);

  const N = 30;
  let totalDmgWithSurge = 0;
  let totalDmgWithout = 0;

  for (let i = 0; i < N; i++) {
    // With Action Surge
    const fA = buildCombatant(fighter2Sheet, { x: 0, y: 0, z: 0 });
    const eA = makeEnemy(`eA${i}`, { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
    const bfA = makeBF([fA, eA]);
    const stateA = makeState(bfA);
    const planA = planTurn(fA, bfA);
    executeTurnPlan(fA, planA, stateA);
    totalDmgWithSurge += (1000 - eA.currentHP);

    // Without Action Surge (manually deplete before turn)
    const fB = buildCombatant(fighter2Sheet, { x: 0, y: 0, z: 0 });
    if (fB.resources?.actionSurge) fB.resources.actionSurge.remaining = 0;
    const eB = makeEnemy(`eB${i}`, { pos: { x: 1, y: 0, z: 0 }, maxHP: 1000, currentHP: 1000 });
    const bfB = makeBF([fB, eB]);
    const stateB = makeState(bfB);
    const planB = planTurn(fB, bfB);
    executeTurnPlan(fB, planB, stateB);
    totalDmgWithout += (1000 - eB.currentHP);
  }

  const avgWith = totalDmgWithSurge / N;
  const avgWithout = totalDmgWithout / N;
  console.log(`    Average damage with Action Surge:    ${avgWith.toFixed(1)}`);
  console.log(`    Average damage without Action Surge: ${avgWithout.toFixed(1)}`);
  console.log(`    Ratio: ${(avgWith / avgWithout).toFixed(2)}×`);

  // Action Surge should roughly double damage (2 attacks vs 1)
  assert(`12a. Action Surge damage > 1.5× non-surge (${avgWith.toFixed(1)} > ${avgWithout.toFixed(1)})`,
    avgWith > avgWithout * 1.5);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('action_surge.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('action_surge.test.ts: all tests passed ✅');
}
