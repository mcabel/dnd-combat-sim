// ============================================================
// Test: isConstruct field + construct-specific spell interactions
//
// Tests:
//   1. isConstruct field exists on Combatant (can be set)
//   2. isConstruct defaults to undefined (not a construct)
//   3. Spare the Dying fizzles on constructs
//   4. Spare the Dying fizzles on undead
//   5. Spare the Dying works on non-construct, non-undead at 0 HP
//   6. Spare the Dying metadata flag updated to true
//
// Run: bun test src/test/is_construct.test.ts
// ============================================================

import { metadata, applyTouchEffect } from '../spells/spare_the_dying';
import { Combatant, Cell, Obstacle } from '../types/core';
import { CombatEvent } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
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
  };
}

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []) {
  const width = 10, height = 10, depth = 1;
  const cells: Cell[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'normal', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length ? obstacles : undefined,
  };
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

// ============================================================
// 1. isConstruct field exists on Combatant (can be set)
// ============================================================
console.log('\n--- 1. isConstruct field exists on Combatant ---');
{
  const construct = makeCombatant('golem', {
    isConstruct: true,
  });
  eq('1a. isConstruct can be set to true', construct.isConstruct, true);
}

// ============================================================
// 2. isConstruct defaults to undefined (not a construct)
// ============================================================
console.log('\n--- 2. isConstruct defaults to undefined ---');
{
  const human = makeCombatant('human');
  eq('2a. isConstruct is undefined by default', human.isConstruct, undefined);
}

// ============================================================
// 3. Spare the Dying fizzles on constructs
// ============================================================
console.log('\n--- 3. Spare the Dying fizzles on constructs ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const constructAlly = makeCombatant('golem_ally', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 1 },
    isConstruct: true,
  });
  const bf = makeBF([caster, constructAlly]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, constructAlly, state);
  eq('3a. applyTouchEffect returns true (action consumed)', ret, true);
  eq('3b. construct NOT stabilized (constructs excluded by PHB p.277)',
    constructAlly._isStabilized, undefined);

  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('3c. fizzle log emitted',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('3d. fizzle log mentions construct',
    fizzleLog?.description.toLowerCase().includes('construct') === true,
    `got: ${fizzleLog?.description}`);
}

// ============================================================
// 4. Spare the Dying fizzles on undead
// ============================================================
console.log('\n--- 4. Spare the Dying fizzles on undead ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const undeadAlly = makeCombatant('undead_ally', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 1 },
    isUndead: true,
  });
  const bf = makeBF([caster, undeadAlly]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, undeadAlly, state);
  eq('4a. applyTouchEffect returns true (action consumed)', ret, true);
  eq('4b. undead NOT stabilized (undead excluded by PHB p.277)',
    undeadAlly._isStabilized, undefined);

  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('4c. fizzle log emitted',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('4d. fizzle log mentions undead',
    fizzleLog?.description.toLowerCase().includes('undead') === true,
    `got: ${fizzleLog?.description}`);
}

// ============================================================
// 5. Spare the Dying works on non-construct, non-undead at 0 HP
// ============================================================
console.log('\n--- 5. Spare the Dying works on non-construct, non-undead at 0 HP ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const livingAlly = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 1, failures: 2 },
    // isConstruct and isUndead left undefined (normal living creature)
  });
  const bf = makeBF([caster, livingAlly]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, livingAlly, state);
  eq('5a. applyTouchEffect returns true', ret, true);
  eq('5b. living ally IS stabilized',
    livingAlly._isStabilized, true);
  eq('5c. deathSaves reset (successes)', livingAlly.deathSaves?.successes, 0);
  eq('5d. deathSaves reset (failures)', livingAlly.deathSaves?.failures, 0);

  const stabilizeLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('stabilized'),
  );
  assert('5e. stabilize log emitted',
    stabilizeLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 6. Spare the Dying metadata flag updated to true
// ============================================================
console.log('\n--- 6. Spare the Dying metadata flag ---');
{
  eq('6a. spareTheDyingTypeExclusionV1Implemented = true',
    metadata.spareTheDyingTypeExclusionV1Implemented, true);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
