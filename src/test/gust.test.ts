// ============================================================
// Test: Gust Cantrip
// XGE p.157 — Level 0 transmutation cantrip (STR save + push-away forced movement)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes saveAbility = 'str' for AI/parser
//   3. metadata exposes components (V + S — CANON, no M)
//   4. metadata exposes moveDistanceFt = 5
//   5. metadata exposes maxSize = 'Medium' (canon size constraint)
//   6. metadata exposes v1 simplification flag (Mode 1 utility skipped)
//   7. metadata does NOT scale (Gust is flat at all levels)
//   8. metadata exposes null damageDice (Gust is pure control — no damage)
//   9. canPushSize() — Medium and smaller return true; Large+ return false
//  10. pushAway() — pushes target 5 ft AWAY from caster (deterministic direction)
//  11. pushAway() — target ends up FARTHER from caster than before
//  12. pushAway() — blocked destination → no push (reuse Infestation's helper)
//  13. pushAway() — Large+ target NOT pushed (size constraint, canon)
//  14. pushAway() — same-position degenerate case → no push
//  15. applyCantripEffect (module) — applies push on save-FAIL
//  16. dispatcher integration — 'Gust' registered in CANTRIP_EFFECTS
//  17. dispatcher safety — unknown cantrip name is a no-op
//  18. cleanup() is a no-op (push is instant, no scratch fields)
//  19. save FAIL → target pushed 5 ft AWAY from caster (50 iterations)
//  20. save SUCCESS → NO push (rider applies only on save-FAIL)
//  21. forced movement does NOT trigger Booming Blade rider (control test)
//  22. no damage dealt (Gust is pure control — action.damage is null)
//  23. Gust respects Total Cover (no bypassesCover flag)
//  24. push direction is AWAY from caster (distinct from Thorn Whip / Lightning Lure)
//
// Run: npx ts-node src/test/gust.test.ts
// ============================================================

import {
  metadata,
  applyCantripEffect,
  pushAway,
  canPushSize,
  cleanup,
  GUST_PUSH_FT,
  GUST_RANGE_FT,
  GUST_MAX_SIZE,
  GUST_PUSHABLE_SIZES,
} from '../spells/gust';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3, Cell, Obstacle, CreatureSize } from '../types/core';

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

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = [], width = 20, height = 20) {
  const depth = 1;
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

// A Gust Action — STR save, no damage, 30 ft range. The save FAIL
// dispatches to applyCantripEffect (push-away rider).
const GUST_ACTION: Action = {
  name: 'Gust',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null, // Gust has NO damage dice — pure control
  damageType: null,
  saveDC: 30, // guaranteed save FAIL
  saveAbility: 'str',
  isAoE: false,
  isControl: true,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Gust',
};

// A Gust Action with a low DC so the target SUCCEEDS (for testing the
// "no rider on save success" path).
const GUST_ACTION_SUCCESS: Action = {
  ...GUST_ACTION,
  saveDC: 1, // DC=1 + str=30 → guaranteed save SUCCESS
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Gust');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (30)', metadata.rangeFt, 30);
  eq('1e. damageDice null (no damage — pure control)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. saveAbility = 'str'
// ============================================================
console.log('\n--- 2. saveAbility ---');
{
  eq('2a. saveAbility = str (XGE p.157)', metadata.saveAbility, 'str');
}

// ============================================================
// 3. components: V + S (CANON — no M; 5etools JSON: {"v":true,"s":true})
// ============================================================
console.log('\n--- 3. components ---');
{
  eq('3a. verbal component', metadata.components.v, true);
  eq('3b. somatic component', metadata.components.s, true);
  eq('3c. NO material component (CANON — 5etools JSON has no M)',
    metadata.components.m, false);
}

// ============================================================
// 4. moveDistanceFt = 5
// ============================================================
console.log('\n--- 4. moveDistanceFt ---');
{
  eq('4a. moveDistanceFt = 5 (XGE p.157: "pushed up to 5 feet")',
    metadata.moveDistanceFt, 5);
  eq('4b. GUST_PUSH_FT = 5', GUST_PUSH_FT, 5);
  eq('4c. GUST_RANGE_FT = 30', GUST_RANGE_FT, 30);
}

// ============================================================
// 5. maxSize = 'Medium' (canon — XGE p.157: "Medium or smaller")
// ============================================================
console.log('\n--- 5. maxSize ---');
{
  eq('5a. maxSize = Medium (XGE p.157 canon)', metadata.maxSize, 'Medium');
  eq('5b. GUST_MAX_SIZE = Medium', GUST_MAX_SIZE, 'Medium');
  eq('5c. GUST_PUSHABLE_SIZES length 3 (Tiny/Small/Medium)',
    GUST_PUSHABLE_SIZES.length, 3);
  eq('5d. GUST_PUSHABLE_SIZES[0] = Tiny', GUST_PUSHABLE_SIZES[0], 'Tiny');
  eq('5e. GUST_PUSHABLE_SIZES[1] = Small', GUST_PUSHABLE_SIZES[1], 'Small');
  eq('5f. GUST_PUSHABLE_SIZES[2] = Medium', GUST_PUSHABLE_SIZES[2], 'Medium');
}

// ============================================================
// 6. v1 simplification flag (Mode 1 utility skipped)
// ============================================================
console.log('\n--- 6. v1 simplification flag ---');
{
  eq('6a. gustUtilityModeV1Implemented = false (Mode 1 utility TODO)',
    metadata.gustUtilityModeV1Implemented, false);
}

// ============================================================
// 7. does NOT scale (Gust is flat at all levels)
// ============================================================
console.log('\n--- 7. no scaling ---');
{
  eq('7a. scales = false (Gust does NOT scale at 5/11/17)', metadata.scales, false);
}

// ============================================================
// 8. null damageDice (pure control — no damage)
// ============================================================
console.log('\n--- 8. no damage ---');
{
  eq('8a. damageDice null (pure control — no damage dice)', metadata.damageDice, null);
}

// ============================================================
// 9. canPushSize() — Medium and smaller return true; Large+ return false
// ============================================================
console.log('\n--- 9. canPushSize ---');
{
  const tiny = makeCombatant('imp', { size: 'Tiny' });
  const small = makeCombatant('halfling', { size: 'Small' });
  const medium = makeCombatant('human', { size: 'Medium' });
  const large = makeCombatant('ogre', { size: 'Large' });
  const huge = makeCombatant('giant', { size: 'Huge' });
  const gargantuan = makeCombatant('tarrasque', { size: 'Gargantuan' });
  const unset = makeCombatant('unset'); // no size → defaults to Medium

  eq('9a. Tiny pushable', canPushSize(tiny), true);
  eq('9b. Small pushable', canPushSize(small), true);
  eq('9c. Medium pushable', canPushSize(medium), true);
  eq('9d. Large NOT pushable', canPushSize(large), false);
  eq('9e. Huge NOT pushable', canPushSize(huge), false);
  eq('9f. Gargantuan NOT pushable', canPushSize(gargantuan), false);
  eq('9g. unset size defaults to Medium (pushable)', canPushSize(unset), true);
}

// ============================================================
// 10. pushAway() — pushes target 5 ft AWAY from caster (deterministic)
// ============================================================
console.log('\n--- 10. pushAway deterministic direction ---');
{
  // Caster at (5,5), target at (7,5) — target is EAST of caster.
  // Push AWAY from caster → target moves further EAST to (8,5).
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const moved = pushAway(caster, target, state);
  eq('10a. pushAway returned true (target moved)', moved, true);
  eq('10b. target moved from (7,5) to (8,5)', target.pos.x, 8);
  eq('10c. target y unchanged', target.pos.y, 5);

  // Push NORTH: caster at (5,5), target at (5,3) — target is NORTH of caster.
  // Push AWAY → target moves further NORTH to (5,2).
  const caster2 = makeCombatant('wiz2', { pos: { x: 5, y: 5, z: 0 } });
  const target2 = makeCombatant('goblin2', {
    pos: { x: 5, y: 3, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf2 = makeBF([caster2, target2]);
  const state2 = makeState(bf2);

  pushAway(caster2, target2, state2);
  eq('10d. target pushed NORTH (y decreases) — from (5,3) to (5,2)',
    target2.pos.x === 5 && target2.pos.y === 2, true);
}

// ============================================================
// 11. pushAway() — target ends up FARTHER from caster than before
// ============================================================
console.log('\n--- 11. target farther from caster ---');
{
  // Run multiple iterations on different relative positions; verify the
  // Euclidean distance from caster to target INCREASES after the push.
  const testCases: Array<{ caster: Vec3; target: Vec3; label: string }> = [
    { caster: { x: 5, y: 5, z: 0 }, target: { x: 7, y: 5, z: 0 }, label: 'target EAST of caster' },
    { caster: { x: 5, y: 5, z: 0 }, target: { x: 3, y: 5, z: 0 }, label: 'target WEST of caster' },
    { caster: { x: 5, y: 5, z: 0 }, target: { x: 5, y: 7, z: 0 }, label: 'target NORTH of caster' },
    { caster: { x: 5, y: 5, z: 0 }, target: { x: 5, y: 3, z: 0 }, label: 'target SOUTH of caster' },
    { caster: { x: 5, y: 5, z: 0 }, target: { x: 7, y: 7, z: 0 }, label: 'target NE of caster (diagonal)' },
    { caster: { x: 5, y: 5, z: 0 }, target: { x: 8, y: 6, z: 0 }, label: 'target off-axis NE' },
  ];

  for (const tc of testCases) {
    const caster = makeCombatant('wiz', { pos: tc.caster });
    const target = makeCombatant('goblin', {
      pos: tc.target, size: 'Medium',
      str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    const distBefore = Math.sqrt(
      (target.pos.x - caster.pos.x) ** 2 + (target.pos.y - caster.pos.y) ** 2,
    );
    pushAway(caster, target, state);
    const distAfter = Math.sqrt(
      (target.pos.x - caster.pos.x) ** 2 + (target.pos.y - caster.pos.y) ** 2,
    );
    assert(`11. ${tc.label}: dist increased (${distBefore.toFixed(2)} → ${distAfter.toFixed(2)})`,
      distAfter > distBefore,
      `before=${distBefore}, after=${distAfter}, target now at (${target.pos.x},${target.pos.y})`);
  }
}

// ============================================================
// 12. pushAway() — blocked destination → no push (wall)
// ============================================================
console.log('\n--- 12. blocked destination ---');
{
  // Target at (1,5), caster at (3,5) — target is WEST of caster.
  // Push AWAY → target would move to (0,5). Place a wall obstacle at (0,5).
  const wall: Obstacle = {
    id: 'W1', x: 0, y: 5, z: 0, width: 1, depth: 1, height: 1,
    blocksMovement: true, blocksVision: false,
  };
  const caster = makeCombatant('wiz', { pos: { x: 3, y: 5, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 5, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target], [wall]);
  const state = makeState(bf);

  const moved = pushAway(caster, target, state);
  eq('12a. pushAway returned false (blocked)', moved, false);
  eq('12b. target NOT moved (still at (1,5))',
    target.pos.x === 1 && target.pos.y === 5, true);

  const blockedLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('blocked'),
  );
  assert('12c. "blocked" log emitted', blockedLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 13. pushAway() — Large+ target NOT pushed (size constraint, canon)
// ============================================================
console.log('\n--- 13. Large+ target NOT pushed ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const target = makeCombatant('ogre', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Large',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const moved = pushAway(caster, target, state);
  eq('13a. pushAway returned false (Large size)', moved, false);
  eq('13b. target NOT moved (still at (7,5))',
    target.pos.x === 7 && target.pos.y === 5, true);

  const tooLargeLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('too large'),
  );
  assert('13c. "too large" log emitted', tooLargeLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // Huge target also NOT pushed.
  const target2 = makeCombatant('giant', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Huge',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf2 = makeBF([caster, target2]);
  const state2 = makeState(bf2);
  pushAway(caster, target2, state2);
  eq('13d. Huge target NOT moved',
    target2.pos.x === 7 && target2.pos.y === 5, true);
}

// ============================================================
// 14. pushAway() — same-position degenerate case → no push
// ============================================================
console.log('\n--- 14. same-position degenerate case ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 5, y: 5, z: 0 }, // SAME as caster
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const moved = pushAway(caster, target, state);
  eq('14a. pushAway returned false (same position)', moved, false);
  eq('14b. target NOT moved',
    target.pos.x === 5 && target.pos.y === 5, true);
}

// ============================================================
// 15. applyCantripEffect (module) — applies push on save-FAIL
// ============================================================
console.log('\n--- 15. applyCantripEffect (module) ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = applyCantripEffect(caster, target, state);
  eq('15a. applyCantripEffect returns true', ret, true);
  // Target should have been pushed EAST (away from caster).
  eq('15b. target moved to (8,5)',
    target.pos.x === 8 && target.pos.y === 5, true);
}

// ============================================================
// 16. dispatcher integration — 'Gust' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 16. dispatcher integration ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Use the dispatcher (not the module function directly).
  dispatchCantrip(caster, target, 'Gust', state);
  eq('16a. dispatcher pushed target EAST (8,5)',
    target.pos.x === 8 && target.pos.y === 5, true);

  const moveLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Gust'),
  );
  assert('16b. move log mentions Gust', moveLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 17. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 17. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin', { pos: { x: 7, y: 5, z: 0 } });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('17a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('17b. unknown cantrip → target NOT moved',
    target.pos.x === 7 && target.pos.y === 5, true);
}

// ============================================================
// 18. cleanup() is a no-op (push is instant, no scratch fields)
// ============================================================
console.log('\n--- 18. cleanup no-op ---');
{
  const caster = makeCombatant('wiz');
  const before = JSON.stringify(caster);
  cleanup(caster);
  eq('18a. cleanup is a no-op (caster unchanged)',
    JSON.stringify(caster), before);

  // resetBudget integration — no scratch fields to clear, but no errors.
  const caster2 = makeCombatant('wiz2');
  resetBudget(caster2);
  eq('18b. resetBudget does not throw', caster2.isDead, false);
}

// ============================================================
// 19. save FAIL → target pushed 5 ft AWAY from caster (50 iterations)
// ============================================================
console.log('\n--- 19. save FAIL → push away (50 iterations) ---');
{
  let allMovedAway = true;
  let allValidDistance = true;
  for (let i = 0; i < 50; i++) {
    // Caster at (5,5), target at (8,5) — EAST of caster.
    // Push AWAY → target moves to (9,5).
    const caster = makeCombatant('wiz', {
      pos: { x: 5, y: 5, z: 0 },
      actions: [GUST_ACTION],
    });
    const target = makeCombatant('goblin', {
      pos: { x: 8, y: 5, z: 0 },
      size: 'Medium',
      str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    resolveAttack(caster, target, GUST_ACTION, state);

    // After the push, target should be at (9,5) — 1 square farther EAST.
    // (Note: with 1-square push and integer rounding, the target always
    // ends up exactly 1 square farther along the line.)
    const distBefore = Math.sqrt((8 - 5) ** 2 + (5 - 5) ** 2); // 3
    const distAfter = Math.sqrt(
      (target.pos.x - 5) ** 2 + (target.pos.y - 5) ** 2,
    );
    if (distAfter <= distBefore) {
      allMovedAway = false;
      console.error(`    iter ${i}: target did NOT move away — pos=(${target.pos.x},${target.pos.y}) distBefore=${distBefore} distAfter=${distAfter}`);
      break;
    }
    // Push distance should be ~1 square (5 ft) — distAfter should be ~4
    // (within rounding to the nearest grid cell, 3..5 is acceptable).
    if (distAfter < 3 || distAfter > 5) {
      allValidDistance = false;
      console.error(`    iter ${i}: invalid push distance — pos=(${target.pos.x},${target.pos.y}) distAfter=${distAfter}`);
      break;
    }
  }
  assert('19a. all 50 iterations: target moved AWAY from caster', allMovedAway);
  assert('19b. all 50 iterations: push distance ~5 ft (1 square)',
    allValidDistance);
}

// ============================================================
// 20. save SUCCESS → NO push (rider applies only on save-FAIL)
// ============================================================
console.log('\n--- 20. save SUCCESS → no push ---');
{
  // DC=1 + str=30 (+10) → guaranteed save SUCCESS → rider should NOT apply.
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [GUST_ACTION_SUCCESS],
  });
  const target = makeCombatant('goliath', {
    pos: { x: 8, y: 5, z: 0 },
    size: 'Medium',
    str: 30, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, GUST_ACTION_SUCCESS, state);

  eq('20a. target NOT moved (still at (8,5))',
    target.pos.x === 8 && target.pos.y === 5, true);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  const pushLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Gust'),
  );
  assert('20b. save_success event logged', saveSuccess !== undefined);
  assert('20c. NO push log on save success', pushLog === undefined,
    `unexpected push log: ${pushLog?.description}`);
}

// ============================================================
// 21. forced movement does NOT trigger Booming Blade rider (control test)
// ============================================================
console.log('\n--- 21. forced movement does NOT trigger Booming Blade ---');
{
  // Setup: a target marked with Booming Blade's pending-damage flag.
  // Cast Gust on it (save FAIL → push away). The push is forced movement
  // (direct pos set, NOT executeMove) → Booming Blade's rider should NOT
  // detonate.
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [GUST_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  // Inject movement_rider to simulate BB landed on a prior turn (RFC-001).
  target.activeEffects.push(makeBBRider('other-caster'));
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, GUST_ACTION, state);

  // Verify the target WAS moved (position changed).
  assert('21a. target was moved by Gust',
    target.pos.x !== 7 || target.pos.y !== 5, `pos=(${target.pos.x},${target.pos.y})`);

  // Verify the movement_rider is STILL active (Gust push is forced — NOT willing movement).
  eq('21b. movement_rider still active (move is forced movement)',
    hasBBRider(target), true);

  // Verify NO damage was dealt (Gust has no damage dice; Booming Blade
  // did NOT detonate). The target's HP should be unchanged at 100.
  eq('21c. target HP unchanged (Gust no damage + no BB detonation)',
    target.currentHP, 100);

  // No Booming Blade detonation log.
  const bbLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('Booming Blade'),
  );
  assert('21d. NO Booming Blade detonation log', bbLog === undefined,
    `unexpected BB log: ${bbLog?.description}`);
}

// ============================================================
// 22. no damage dealt (Gust is pure control — action.damage is null)
// ============================================================
console.log('\n--- 22. no damage ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [GUST_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, GUST_ACTION, state);

  // Gust has NO damage dice — target HP should be unchanged.
  eq('22a. target HP unchanged (Gust is pure control)', target.currentHP, 100);

  // No damage event should be logged.
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('22b. NO damage event logged', damageEvent === undefined,
    `unexpected damage event: ${damageEvent?.description}`);
}

// ============================================================
// 23. Gust respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 23. Gust respects Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8]
  // → blocks line of effect → "Total Cover!" logged, no push.
  const totalWall: Obstacle = {
    id: 'W1', x: 3, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [GUST_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, GUST_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const pushLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Gust'),
  );
  assert('23a. Total Cover event logged', coverBlock !== undefined);
  assert('23b. NO push (Gust blocked by Total Cover)', pushLog === undefined);
  eq('23c. target NOT moved', target.pos.x, 6);
}

// ============================================================
// 24. push direction is AWAY from caster (distinct from Thorn Whip / Lightning Lure)
// ============================================================
console.log('\n--- 24. push direction AWAY (vs Thorn Whip / Lightning Lure TOWARD) ---');
{
  // Caster at (5,5), target at (7,5) — target is EAST of caster.
  // Gust pushes AWAY → target moves to (8,5) (FURTHER EAST).
  // (Thorn Whip / Lightning Lure would pull TOWARD → target would move to (6,5).)
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [GUST_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 7, y: 5, z: 0 },
    size: 'Medium',
    str: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, GUST_ACTION, state);

  // Target should be at (8,5) — AWAY from caster (FURTHER EAST).
  // If it were at (6,5), that would be TOWARD the caster (Thorn Whip behavior).
  eq('24a. target moved AWAY (8,5), not TOWARD (6,5)',
    target.pos.x === 8 && target.pos.y === 5, true);

  const pushLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Gust') && e.description.includes('away'),
  );
  assert('24b. push log mentions "away"',
    pushLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

function makeBBRider(casterId: string, dice = '1d8') {
  return {
    id: `eff_bb_${casterId}`,
    casterId,
    spellName: 'Booming Blade',
    effectType: 'movement_rider' as const,
    payload: { moveDamageDice: dice, moveDamageType: 'thunder' as const },
    sourceIsConcentration: false,
  };
}
function hasBBRider(c: any, dice = '1d8'): boolean {
  return (c.activeEffects ?? []).some(
    (e: any) => e.effectType === 'movement_rider' &&
                e.spellName === 'Booming Blade' &&
                e.payload.moveDamageDice === dice,
  );
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
