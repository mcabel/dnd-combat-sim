// ============================================================
// forced_movement.test.ts — Forced Movement subsystem
// PHB p.195-196: forced movement does NOT provoke opportunity
// attacks; the creature is moved involuntarily.
//
// Tests:
//   1. pushAway — direction, distance, edge cases
//   2. pullToward — direction, clamp, edge cases
//   3. forcedMoveTo — basic movement
//   4. Integration: Thunderwave uses pushAway
//
// Run: ts-node --transpile-only src/test/forced_movement.test.ts
// ============================================================

import { forcedMoveTo, pushAway, pullToward } from '../engine/movement';
import { Combatant, Vec3, Action, PlayerResources } from '../types/core';
import { shouldCast, execute } from '../spells/thunderwave';
import { EngineState } from '../engine/combat';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

function makeCombatant(id: string, pos: Vec3 = { x: 0, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
    cr: 1,
    pos,
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
    perception: { knownEnemyPositions: new Map(), lastSeenPositions: new Map() } as any,
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

const TW_ACTION: Action = {
  name: 'Thunderwave',
  isMultiattack: false,
  attackType: 'save',
  reach: 15,
  range: { normal: 15, long: 30 },
  hitBonus: null,
  damage: { count: 2, sides: 8, bonus: 0, average: 9 },
  damageType: 'thunder',
  saveDC: 13,
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Thunderwave',
};

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeBF(all: Combatant[]) {
  return {
    combatants: new Map(all.map(c => [c.id, c])),
    round: 1,
    initiative: all.map((c, i) => ({ id: c.id, initiative: 10 - i })),
    obstacles: [],
  } as any;
}

function makeState(bf: any): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// =============================================================
// Section 1 — pushAway
// =============================================================

console.log('\n--- Section 1: pushAway ---');

{
  // 1a: push in correct direction (target east of source)
  const target = makeCombatant('orc', { x: 3, y: 0, z: 0 });
  const sourcePos: Vec3 = { x: 0, y: 0, z: 0 };
  pushAway(target, sourcePos, 10);  // 10 ft = 2 squares
  eq('1a: push east — x increased by 2', target.pos.x, 5);
  eq('1a: push east — y unchanged', target.pos.y, 0);
}

{
  // 1b: push in correct direction (target northeast)
  const target = makeCombatant('orc', { x: 3, y: 3, z: 0 });
  const sourcePos: Vec3 = { x: 0, y: 0, z: 0 };
  pushAway(target, sourcePos, 15);  // 15 ft = 3 squares
  eq('1b: push NE — x increased by 3', target.pos.x, 6);
  eq('1b: push NE — y increased by 3', target.pos.y, 6);
}

{
  // 1c: push south (target below source)
  const target = makeCombatant('orc', { x: 0, y: 5, z: 0 });
  const sourcePos: Vec3 = { x: 0, y: 0, z: 0 };
  pushAway(target, sourcePos, 10);
  eq('1c: push south — y increased by 2', target.pos.y, 7);
  eq('1c: push south — x unchanged', target.pos.x, 0);
}

{
  // 1d: no push when target at same position
  const target = makeCombatant('orc', { x: 5, y: 5, z: 0 });
  const sourcePos: Vec3 = { x: 5, y: 5, z: 0 };
  const result = pushAway(target, sourcePos, 10);
  eq('1d: same pos — no push (x)', target.pos.x, 5);
  eq('1d: same pos — no push (y)', target.pos.y, 5);
}

{
  // 1e: no push when pushFt < 5 (less than 1 square)
  const target = makeCombatant('orc', { x: 3, y: 0, z: 0 });
  const sourcePos: Vec3 = { x: 0, y: 0, z: 0 };
  pushAway(target, sourcePos, 4);  // 4 ft = 0 squares
  eq('1e: pushFt < 5 — no push', target.pos.x, 3);
}

{
  // 1f: push does NOT consume movement speed
  const target = makeCombatant('orc', { x: 2, y: 0, z: 0 });
  const budgetBefore = target.budget.movementFt;
  pushAway(target, { x: 0, y: 0, z: 0 }, 10);
  eq('1f: movement budget unchanged', target.budget.movementFt, budgetBefore);
}

{
  // 1g: push dead creature — no movement
  const target = makeCombatant('orc', { x: 2, y: 0, z: 0 }, { isDead: true });
  pushAway(target, { x: 0, y: 0, z: 0 }, 10);
  eq('1g: dead creature not pushed', target.pos.x, 2);
}

{
  // 1h: push unconscious creature — no movement
  const target = makeCombatant('orc', { x: 2, y: 0, z: 0 }, { isUnconscious: true });
  pushAway(target, { x: 0, y: 0, z: 0 }, 10);
  eq('1h: unconscious creature not pushed', target.pos.x, 2);
}

{
  // 1i: push west (target west of source)
  const target = makeCombatant('orc', { x: 0, y: 0, z: 0 });
  const sourcePos: Vec3 = { x: 3, y: 0, z: 0 };
  pushAway(target, sourcePos, 10);
  eq('1i: push west — x decreased by 2', target.pos.x, -2);
  eq('1i: push west — y unchanged', target.pos.y, 0);
}

// =============================================================
// Section 2 — pullToward
// =============================================================

console.log('\n--- Section 2: pullToward ---');

{
  // 2a: pull toward source
  const target = makeCombatant('orc', { x: 10, y: 0, z: 0 });
  const sourcePos: Vec3 = { x: 0, y: 0, z: 0 };
  pullToward(target, sourcePos, 10);  // 10 ft = 2 squares toward source
  eq('2a: pull toward — x decreased by 2', target.pos.x, 8);
  eq('2a: pull toward — y unchanged', target.pos.y, 0);
}

{
  // 2b: pull does not go past source
  const target = makeCombatant('orc', { x: 3, y: 0, z: 0 });
  const sourcePos: Vec3 = { x: 0, y: 0, z: 0 };
  pullToward(target, sourcePos, 50);  // 50 ft = 10 squares, but only 3 away
  eq('2b: pull clamped — ends at source', target.pos.x, 0);
}

{
  // 2c: pull diagonally
  const target = makeCombatant('orc', { x: 5, y: 5, z: 0 });
  const sourcePos: Vec3 = { x: 0, y: 0, z: 0 };
  pullToward(target, sourcePos, 15);  // 15 ft = 3 squares
  eq('2c: pull diagonal — x decreased by 3', target.pos.x, 2);
  eq('2c: pull diagonal — y decreased by 3', target.pos.y, 2);
}

{
  // 2d: pull dead creature — no movement
  const target = makeCombatant('orc', { x: 10, y: 0, z: 0 }, { isDead: true });
  pullToward(target, { x: 0, y: 0, z: 0 }, 10);
  eq('2d: dead creature not pulled', target.pos.x, 10);
}

{
  // 2e: pull when already at source — no movement
  const target = makeCombatant('orc', { x: 5, y: 5, z: 0 });
  pullToward(target, { x: 5, y: 5, z: 0 }, 10);
  eq('2e: already at source — no pull', target.pos.x, 5);
  eq('2e: already at source — no pull (y)', target.pos.y, 5);
}

{
  // 2f: pull with pullFt < 5 — no movement
  const target = makeCombatant('orc', { x: 10, y: 0, z: 0 });
  pullToward(target, { x: 0, y: 0, z: 0 }, 4);
  eq('2f: pullFt < 5 — no pull', target.pos.x, 10);
}

// =============================================================
// Section 3 — forcedMoveTo
// =============================================================

console.log('\n--- Section 3: forcedMoveTo ---');

{
  // 3a: basic forced move
  const target = makeCombatant('orc', { x: 0, y: 0, z: 0 });
  forcedMoveTo(target, { x: 7, y: 3, z: 0 });
  eq('3a: forcedMoveTo x', target.pos.x, 7);
  eq('3a: forcedMoveTo y', target.pos.y, 3);
}

{
  // 3b: forced move dead creature — no movement
  const target = makeCombatant('orc', { x: 2, y: 2, z: 0 }, { isDead: true });
  forcedMoveTo(target, { x: 10, y: 10, z: 0 });
  eq('3b: dead creature not force-moved', target.pos.x, 2);
}

{
  // 3c: forced move unconscious creature — no movement
  const target = makeCombatant('orc', { x: 2, y: 2, z: 0 }, { isUnconscious: true });
  forcedMoveTo(target, { x: 10, y: 10, z: 0 });
  eq('3c: unconscious creature not force-moved', target.pos.x, 2);
}

// =============================================================
// Section 4 — Integration: Thunderwave uses pushAway
// =============================================================

console.log('\n--- Section 4: Integration — Thunderwave push ---');

{
  // 4a: Thunderwave pushes on failed save (DC 99 forces fail)
  const caster = makeCombatant('druid', { x: 0, y: 0, z: 0 }, {
    faction: 'party',
    actions: [{ ...TW_ACTION, saveDC: 99 }],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('orc', { x: 2, y: 0, z: 0 }, { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const posBefore = { ...enemy.pos };
  execute(caster, [enemy], state);

  // With DC 99, save should fail → enemy pushed
  assert('4a: enemy position changed on failed save',
    enemy.pos.x !== posBefore.x || enemy.pos.y !== posBefore.y);
  // Push direction should be away from caster (increasing x)
  assert('4a: push is away from caster (x increased)', enemy.pos.x > posBefore.x);
}

{
  // 4b: Thunderwave does NOT push on successful save (DC 1 forces success)
  const caster = makeCombatant('druid', { x: 0, y: 0, z: 0 }, {
    faction: 'party',
    actions: [{ ...TW_ACTION, saveDC: 1 }],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('orc', { x: 2, y: 0, z: 0 }, { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const posBefore = { ...enemy.pos };
  execute(caster, [enemy], state);

  assert('4b: enemy not pushed on successful save',
    enemy.pos.x === posBefore.x && enemy.pos.y === posBefore.y);
}

{
  // 4c: Push event logged with position info
  const caster = makeCombatant('druid', { x: 0, y: 0, z: 0 }, {
    faction: 'party',
    actions: [{ ...TW_ACTION, saveDC: 99 }],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('orc', { x: 2, y: 0, z: 0 }, { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  const moveEvents = state.log.events.filter((e: any) => e.type === 'move' && e.description.includes('pushed'));
  assert('4c: push move event logged', moveEvents.length >= 1);
  assert('4c: event mentions "10 ft"', moveEvents[0]?.description?.includes('10 ft'));
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
