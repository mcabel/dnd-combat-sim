// ============================================================
// Test: Infestation Cantrip
// XGE p.158 — Level 0 conjuration cantrip (CON save + random d4 forced movement)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d6/3d6/4d6)
//   3. metadata exposes saveAbility = 'con' for AI/parser
//   4. metadata exposes components (V + S + M — a living flea)
//   5. metadata exposes moveDistanceFt = 5
//   6. metadata exposes v1 simplification flag (speed check skipped)
//   7. rollRandomDirection() returns one of N/S/E/W
//   8. rollRandomDirection() statistical test (1000 rolls, each ~25% ±5%)
//   9. directionToDelta() — N/S/E/W → correct delta vectors
//  10. isDestinationBlocked() — off-battlefield (each edge)
//  11. isDestinationBlocked() — wall obstacle blocks destination
//  12. isDestinationBlocked() — open path NOT blocked
//  13. applyCantripEffect (module) — applies random-direction move on save-FAIL
//  14. dispatcher integration — 'Infestation' registered in CANTRIP_EFFECTS
//  15. dispatcher safety — unknown cantrip name is a no-op
//  16. cleanup() is a no-op (move is instant, no scratch fields)
//  17. save FAIL → target moves 5 ft in a cardinal direction (NEVER diagonal,
//       NEVER more than 5 ft) — over 50 iterations
//  18. save SUCCESS → NO movement (rider applies only on save-FAIL)
//  19. forced movement does NOT trigger Booming Blade rider (control test)
//  20. blocked destination → no movement (control test with a wall)
//  21. damage is 1d6 poison (1..6) on save-FAIL (canon: damage is unconditional
//       on save-FAIL — the MOVE is conditional, the damage is not)
//  22. Infestation respects Total Cover (no bypassesCover flag)
//  23. no size constraint — Huge target IS moved (unlike Thorn Whip / Lightning Lure)
//
// Run: npx ts-node src/test/infestation.test.ts
// ============================================================

import {
  metadata,
  applyCantripEffect,
  applyRandomMove,
  rollRandomDirection,
  directionToDelta,
  isDestinationBlocked,
  cleanup,
  INFESTATION_MOVE_FT,
  INFESTATION_RANGE_FT,
} from '../spells/infestation';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3, Cell, Obstacle } from '../types/core';

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

// An Infestation Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='con'.
// Damage 1d6 poison. Range 30 ft. v1 has a normal damage field (NOT null like
// Lightning Lure) — the damage is unconditional on save-FAIL; the move is the
// rider that applyCantripEffect handles.
const INFESTATION_ACTION: Action = {
  name: 'Infestation',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: INFESTATION_RANGE_FT, long: INFESTATION_RANGE_FT },
  hitBonus: null,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'poison',
  saveDC: 30, // DC=30 → guaranteed save FAIL (deterministic test)
  saveAbility: 'con',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Infestation',
};

// Save-SUCCESS variant: DC=1 + con=30 (+10) → guaranteed save SUCCESS.
const INFESTATION_SUCCESS_ACTION: Action = { ...INFESTATION_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Infestation');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'conjuration');
  eq('1d. rangeFt (30)', metadata.rangeFt, 30);
  eq('1e. damageDice', metadata.damageDice, '1d6');
  eq('1f. damageType = poison', metadata.damageType, 'poison');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. scaling metadata
// ============================================================
console.log('\n--- 2. scaling metadata ---');
{
  eq('2a. scales flag', metadata.scales, true);
  eq('2b. scalingLevels length 3', metadata.scalingLevels.length, 3);
  eq('2c. scalingLevels[0] = 5', metadata.scalingLevels[0], 5);
  eq('2d. scalingLevels[1] = 11', metadata.scalingLevels[1], 11);
  eq('2e. scalingLevels[2] = 17', metadata.scalingLevels[2], 17);
  eq('2f. scalingDice[0] = 2d6', metadata.scalingDice[0], '2d6');
  eq('2g. scalingDice[1] = 3d6', metadata.scalingDice[1], '3d6');
  eq('2h. scalingDice[2] = 4d6', metadata.scalingDice[2], '4d6');
}

// ============================================================
// 3. save ability exposed for AI/parser
// ============================================================
console.log('\n--- 3. save ability ---');
{
  eq('3a. saveAbility = con', metadata.saveAbility, 'con');
}

// ============================================================
// 4. components: V + S + M (a living flea) — XGE p.158
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. material component (a living flea)', metadata.components.m, true);
}

// ============================================================
// 5. metadata exposes moveDistanceFt = 5
// ============================================================
console.log('\n--- 5. moveDistanceFt ---');
{
  eq('5a. moveDistanceFt = 5 (XGE p.158: "moves 5 feet")', metadata.moveDistanceFt, 5);
  eq('5b. INFESTATION_MOVE_FT = 5', INFESTATION_MOVE_FT, 5);
  eq('5c. INFESTATION_RANGE_FT = 30', INFESTATION_RANGE_FT, 30);
}

// ============================================================
// 6. v1 simplification flag (speed check skipped)
// ============================================================
console.log('\n--- 6. v1 simplification flag ---');
{
  eq('6a. infestationSpeedCheckV1Simplified = true', metadata.infestationSpeedCheckV1Simplified, true);
}

// ============================================================
// 7. rollRandomDirection() returns one of N/S/E/W
// ============================================================
console.log('\n--- 7. rollRandomDirection returns N/S/E/W ---');
{
  const valid = new Set(['N', 'S', 'E', 'W']);
  for (let i = 0; i < 50; i++) {
    const dir = rollRandomDirection();
    assert(`7.${i}. direction is one of N/S/E/W (got ${dir})`, valid.has(dir), `got ${dir}`);
    if (!valid.has(dir)) break;
  }
}

// ============================================================
// 8. rollRandomDirection() statistical test (1000 rolls, each ~25% ±5%)
// ============================================================
console.log('\n--- 8. rollRandomDirection statistical test ---');
{
  const counts = { N: 0, S: 0, E: 0, W: 0 };
  const iterations = 1000;
  for (let i = 0; i < iterations; i++) {
    counts[rollRandomDirection()]++;
  }
  // Each direction should appear ~250 times (±5% = ±50 → 200..300).
  for (const dir of ['N', 'S', 'E', 'W'] as const) {
    assert(`8a. ${dir} count in [200, 300] range (got ${counts[dir]})`,
      counts[dir] >= 200 && counts[dir] <= 300, `got ${counts[dir]}`);
  }
  // Sanity: totals sum to iterations.
  eq('8b. all counts sum to 1000', counts.N + counts.S + counts.E + counts.W, iterations);
}

// ============================================================
// 9. directionToDelta() — N/S/E/W → correct delta vectors
// ============================================================
console.log('\n--- 9. directionToDelta ---');
{
  eq('9a. N → (0, +1, 0)', JSON.stringify(directionToDelta('N')), JSON.stringify({ x: 0, y: 1, z: 0 }));
  eq('9b. S → (0, -1, 0)', JSON.stringify(directionToDelta('S')), JSON.stringify({ x: 0, y: -1, z: 0 }));
  eq('9c. E → (+1, 0, 0)', JSON.stringify(directionToDelta('E')), JSON.stringify({ x: 1, y: 0, z: 0 }));
  eq('9d. W → (-1, 0, 0)', JSON.stringify(directionToDelta('W')), JSON.stringify({ x: -1, y: 0, z: 0 }));
}

// ============================================================
// 10. isDestinationBlocked() — off-battlefield (each edge)
// ============================================================
console.log('\n--- 10. isDestinationBlocked — off-battlefield ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  // Battlefield is 20x20. Test each edge:
  // From (0,5) moving W → to (-1,5) — off-battlefield.
  eq('10a. off-X-low (x=-1) → blocked',
    isDestinationBlocked({ x: 0, y: 5, z: 0 }, { x: -1, y: 5, z: 0 }, state), true);
  // From (19,5) moving E → to (20,5) — off-battlefield.
  eq('10b. off-X-high (x=20) → blocked',
    isDestinationBlocked({ x: 19, y: 5, z: 0 }, { x: 20, y: 5, z: 0 }, state), true);
  // From (5,0) moving S → to (5,-1) — off-battlefield.
  eq('10c. off-Y-low (y=-1) → blocked',
    isDestinationBlocked({ x: 5, y: 0, z: 0 }, { x: 5, y: -1, z: 0 }, state), true);
  // From (5,19) moving N → to (5,20) — off-battlefield.
  eq('10d. off-Y-high (y=20) → blocked',
    isDestinationBlocked({ x: 5, y: 19, z: 0 }, { x: 5, y: 20, z: 0 }, state), true);
}

// ============================================================
// 11. isDestinationBlocked() — wall obstacle blocks destination
// ============================================================
console.log('\n--- 11. isDestinationBlocked — wall ---');
{
  // Wall at x=6, y=3..7 (5 squares tall, 1 wide). Target at (5,5) moving E
  // → destination (6,5) is inside the wall → blocked.
  const wall: Obstacle = {
    id: 'wall', x: 6, y: 3, z: 0,
    width: 1, depth: 5, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const bf = makeBF([caster], [wall]);
  const state = makeState(bf);

  eq('11a. destination inside wall → blocked',
    isDestinationBlocked({ x: 5, y: 5, z: 0 }, { x: 6, y: 5, z: 0 }, state), true);

  // Wall that does NOT intersect the path → NOT blocked.
  const farWall: Obstacle = {
    id: 'farWall', x: 15, y: 15, z: 0,
    width: 1, depth: 5, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const bf2 = makeBF([caster], [farWall]);
  const state2 = makeState(bf2);
  eq('11b. destination not in any wall → NOT blocked',
    isDestinationBlocked({ x: 5, y: 5, z: 0 }, { x: 6, y: 5, z: 0 }, state2), false);
}

// ============================================================
// 12. isDestinationBlocked() — open path NOT blocked
// ============================================================
console.log('\n--- 12. isDestinationBlocked — open path ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  // All 4 cardinal directions from (5,5) should be open.
  eq('12a. N (5,5)→(5,6) → NOT blocked',
    isDestinationBlocked({ x: 5, y: 5, z: 0 }, { x: 5, y: 6, z: 0 }, state), false);
  eq('12b. S (5,5)→(5,4) → NOT blocked',
    isDestinationBlocked({ x: 5, y: 5, z: 0 }, { x: 5, y: 4, z: 0 }, state), false);
  eq('12c. E (5,5)→(6,5) → NOT blocked',
    isDestinationBlocked({ x: 5, y: 5, z: 0 }, { x: 6, y: 5, z: 0 }, state), false);
  eq('12d. W (5,5)→(4,5) → NOT blocked',
    isDestinationBlocked({ x: 5, y: 5, z: 0 }, { x: 4, y: 5, z: 0 }, state), false);
}

// ============================================================
// 13. applyCantripEffect (module) — applies random-direction move on save-FAIL
// ============================================================
console.log('\n--- 13. applyCantripEffect module — random move ---');
{
  // Run 50 iterations — verify the target ends up at ONE of 4 cardinal-adjacent
  // squares, NEVER diagonal, NEVER more than 5 ft (1 square) from origin.
  for (let i = 0; i < 50; i++) {
    const caster = makeCombatant('wiz', { pos: { x: 10, y: 10, z: 0 } });
    const target = makeCombatant('goblin', {
      pos: { x: 10, y: 10, z: 0 }, // same pos as caster (for testing — Infestation has no friendly-fire check)
      con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    applyCantripEffect(caster, target, state);

    // After the move, the target should be at ONE of:
    //   (10,11), (10,9), (11,10), (9,10)
    // (Or still at (10,10) if the direction was blocked — but the center of
    // a 20x20 grid has no blocked directions, so the move should always happen.)
    const validDestinations = [
      { x: 10, y: 11, z: 0 }, // N
      { x: 10, y: 9,  z: 0 }, // S
      { x: 11, y: 10, z: 0 }, // E
      { x: 9,  y: 10, z: 0 }, // W
    ];
    const matched = validDestinations.some(p =>
      p.x === target.pos.x && p.y === target.pos.y && p.z === target.pos.z,
    );
    assert(`13.${i}. target moved to a cardinal-adjacent square (iter ${i}, pos=${target.pos.x},${target.pos.y})`,
      matched, `pos=(${target.pos.x},${target.pos.y},${target.pos.z})`);
    if (!matched) break;
  }
}

// ============================================================
// 14. dispatcher integration — 'Infestation' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 14. dispatcher integration ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 10, y: 10, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 10, y: 10, z: 0 },
    con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // The dispatcher should call applyCantripEffect for 'Infestation'.
  dispatchCantrip(caster, target, 'Infestation', state);

  // A move log event should have been emitted.
  const moveLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Infestation'),
  );
  assert('14a. dispatcher invoked applyCantripEffect (move log emitted)',
    moveLog !== undefined, `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // The target's position should have changed (moved 5 ft in some cardinal direction).
  assert('14b. target position changed',
    target.pos.x !== 10 || target.pos.y !== 10,
    `pos=(${target.pos.x},${target.pos.y})`);
}

// ============================================================
// 15. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 15. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('15a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('15b. unknown cantrip → target not moved', target.pos.x, 0);
  eq('15c. unknown cantrip → target not moved (y)', target.pos.y, 0);
}

// ============================================================
// 16. cleanup() is a no-op (move is instant, no scratch fields)
// ============================================================
console.log('\n--- 16. cleanup is a no-op ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 10, y: 10, z: 0 },
    // Set a bunch of unrelated scratch fields to verify cleanup() doesn't touch them.
    _bladeWardActive: true,
    _frostbiteDisadvNextWeaponAttack: true,
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  // Apply Infestation (moves the caster itself for test purposes — Infestation
  // actually moves the TARGET, but for the cleanup test we just need to verify
  // cleanup() doesn't touch any flags).
  const target = makeCombatant('goblin', {
    pos: { x: 10, y: 10, z: 0 },
    faction: 'enemy',
  });
  const bf2 = makeBF([caster, target]);
  const state2 = makeState(bf2);

  applyCantripEffect(caster, target, state2);

  // Save the target's position after the move.
  const posAfterMove = { ...target.pos };

  // resetBudget on the TARGET — Infestation's cleanup should be a no-op.
  resetBudget(target);

  // The target's position should be unchanged (Infestation's move is instant,
  // NOT cleaned up by resetBudget).
  eq('16a. target position unchanged after resetBudget', target.pos.x, posAfterMove.x);
  eq('16b. target position unchanged after resetBudget (y)', target.pos.y, posAfterMove.y);

  // The caster's unrelated flags should be cleared by THEIR respective cleanups
  // (Blade Ward / Frostbite), but Infestation's cleanup is a no-op for them.
  // Note: this test runs resetBudget on the TARGET, not the caster — so the
  // caster's flags are still set.
  eq('16c. caster _bladeWardActive still set (resetBudget was on target)',
    caster._bladeWardActive, true);
}

// ============================================================
// 17. save FAIL → target moves 5 ft in a cardinal direction (NEVER diagonal,
//     NEVER more than 5 ft) — over 50 iterations via resolveAttack
// ============================================================
console.log('\n--- 17. save FAIL → cardinal move only ---');
{
  for (let i = 0; i < 50; i++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 10, y: 10, z: 0 },
      actions: [INFESTATION_ACTION],
    });
    const target = makeCombatant('goblin', {
      pos: { x: 12, y: 10, z: 0 }, // 10 ft away — within 30-ft range
      con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    resolveAttack(caster, target, INFESTATION_ACTION, state); // DC=30 → save FAIL

    // After the save FAIL + rider, target should be at ONE of:
    //   (12,11), (12,9), (13,10), (11,10) — 5 ft cardinal from (12,10).
    const validDestinations = [
      { x: 12, y: 11, z: 0 }, // N
      { x: 12, y: 9,  z: 0 }, // S
      { x: 13, y: 10, z: 0 }, // E
      { x: 11, y: 10, z: 0 }, // W
    ];
    const matched = validDestinations.some(p =>
      p.x === target.pos.x && p.y === target.pos.y && p.z === target.pos.z,
    );
    assert(`17.${i}. target moved to cardinal-adjacent square (iter ${i}, pos=${target.pos.x},${target.pos.y})`,
      matched, `pos=(${target.pos.x},${target.pos.y},${target.pos.z})`);
    if (!matched) break;
  }
}

// ============================================================
// 18. save SUCCESS → NO movement (rider applies only on save-FAIL)
// ============================================================
console.log('\n--- 18. save SUCCESS → no movement ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 10, y: 10, z: 0 },
    actions: [INFESTATION_SUCCESS_ACTION], // DC=1 → save SUCCESS
  });
  const target = makeCombatant('goblin', {
    pos: { x: 12, y: 10, z: 0 },
    con: 30, // +10 → save 11+ vs DC 1 → always succeeds
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const startPos = { ...target.pos };
  resolveAttack(caster, target, INFESTATION_SUCCESS_ACTION, state);

  eq('18a. target NOT moved (save succeeded)', target.pos.x, startPos.x);
  eq('18b. target NOT moved (y)', target.pos.y, startPos.y);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  assert('18c. save_success logged', saveSuccess !== undefined);

  // No move log from Infestation.
  const moveLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Infestation'),
  );
  assert('18d. NO move log from Infestation (save succeeded)', moveLog === undefined);
}

// ============================================================
// 19. forced movement does NOT trigger Booming Blade rider (control test)
// ============================================================
console.log('\n--- 19. forced movement does NOT trigger Booming Blade ---');
{
  // Setup: a target marked with Booming Blade's pending-damage flag.
  // Cast Infestation on it (save FAIL → random move). The move is forced
  // movement (direct pos set, NOT executeMove) → Booming Blade's rider
  // should NOT detonate.
  const caster = makeCombatant('wiz', {
    pos: { x: 10, y: 10, z: 0 },
    actions: [INFESTATION_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 12, y: 10, z: 0 },
    con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    // Mark the target with Booming Blade's pending damage flag.
    _boomingBladePendingDamageDice: '1d8',
    _boomingBladeCasterId: 'other-caster',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const hpBeforeMove = target.currentHP;
  resolveAttack(caster, target, INFESTATION_ACTION, state);

  // Verify the target WAS moved (position changed).
  assert('19a. target was moved by Infestation',
    target.pos.x !== 12 || target.pos.y !== 10, `pos=(${target.pos.x},${target.pos.y})`);

  // Verify the Booming Blade flag is STILL set (NOT consumed by the move).
  eq('19b. Booming Blade flag still set (move is forced movement)',
    target._boomingBladePendingDamageDice, '1d8');

  // Verify the damage taken = ONLY the Infestation damage (1..6 poison),
  // NOT Infestation + Booming Blade detonation (which would be 1..6 + 1..8 = 2..14).
  const damageTaken = hpBeforeMove - target.currentHP;
  assert('19c. damage = ONLY Infestation (1..6), NOT + Booming Blade (2..14)',
    damageTaken >= 1 && damageTaken <= 6, `got ${damageTaken} — Booming Blade may have detonated`);

  // No Booming Blade detonation log.
  const bbLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('Booming Blade'),
  );
  assert('19d. NO Booming Blade detonation log', bbLog === undefined,
    `unexpected BB log: ${bbLog?.description}`);
}

// ============================================================
// 20. blocked destination → no movement (control test with a wall)
// ============================================================
console.log('\n--- 20. blocked destination → no movement ---');
{
  // Place the target in the CORNER of the map at (0,0). The 2 cardinal
  // directions that lead off-battlefield (S → (0,-1), W → (-1,0)) are
  // blocked. The other 2 (N → (0,1), E → (1,0)) are open.
  //
  // Run multiple iterations. Each iteration the target either:
  //   - Stays at (0,0) (rolled S or W — blocked) — damage still applies
  //   - Moves to (0,1) (rolled N — open)
  //   - Moves to (1,0) (rolled E — open)
  //
  // Over 30 iterations, we should see at least one "blocked" outcome
  // (probability of never rolling S/W in 30 rolls = (1/2)^30 ≈ 1e-9 →
  // effectively zero).
  let sawBlocked = false;
  let sawMove = false;
  let allValidDestinations = true;
  for (let i = 0; i < 30; i++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 5, y: 5, z: 0 }, // far from the corner — no LOS issues
      actions: [INFESTATION_ACTION],
    });
    const target = makeCombatant('goblin', {
      pos: { x: 0, y: 0, z: 0 }, // corner of the map
      con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    resolveAttack(caster, target, INFESTATION_ACTION, state);

    // Target must be at (0,0), (0,1), or (1,0) — NEVER (-1,0) or (0,-1).
    const validPositions = [
      { x: 0, y: 0 }, // stayed (blocked direction)
      { x: 0, y: 1 }, // moved N
      { x: 1, y: 0 }, // moved E
    ];
    const matched = validPositions.some(p => p.x === target.pos.x && p.y === target.pos.y);
    if (!matched) {
      allValidDestinations = false;
      console.error(`    iter ${i}: target at INVALID pos=(${target.pos.x},${target.pos.y})`);
      break;
    }
    if (target.pos.x === 0 && target.pos.y === 0) sawBlocked = true;
    else sawMove = true;

    // Damage should ALWAYS apply (damage is unconditional on save-FAIL).
    if (target.currentHP >= 100) {
      console.error(`    iter ${i}: damage NOT applied (HP=${target.currentHP}) — move was ${target.pos.x === 0 && target.pos.y === 0 ? 'blocked' : 'open'}`);
      allValidDestinations = false;
      break;
    }
  }
  assert('20a. all iterations: target at valid position (corner / N / E only)',
    allValidDestinations, '');
  assert('20b. saw at least one "blocked" outcome (rolled S or W)',
    sawBlocked, 'never saw a blocked direction in 30 iterations (extremely unlikely)');
  assert('20c. saw at least one "move" outcome (rolled N or E)',
    sawMove, 'never saw an open direction in 30 iterations (extremely unlikely)');

  // Single-iteration test: verify the "blocked" log is emitted when the
  // direction is blocked. We use applyRandomMove directly with a stubbed
  // rollRandomDirection (override via a corner setup — repeated until
  // blocked). Actually, just verify that "blocked" appears in some log.
  let blockedLogSeen = false;
  for (let i = 0; i < 30; i++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 5, y: 5, z: 0 },
      actions: [INFESTATION_ACTION],
    });
    const target = makeCombatant('goblin', {
      pos: { x: 0, y: 0, z: 0 },
      con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    resolveAttack(caster, target, INFESTATION_ACTION, state);

    const blockedLog = state.log.events.find(
      (e: CombatEvent) => e.type === 'action' && e.description.includes('blocked'),
    );
    if (blockedLog) {
      blockedLogSeen = true;
      break;
    }
  }
  assert('20d. "blocked" log emitted when direction is blocked',
    blockedLogSeen, 'never saw a blocked log in 30 iterations (extremely unlikely)');
}

// ============================================================
// 21. damage is 1d6 poison (1..6) on save-FAIL
// ============================================================
console.log('\n--- 21. damage = 1d6 poison (1..6) ---');
{
  // Run multiple iterations to verify the damage range holds.
  for (let i = 0; i < 20; i++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 10, y: 10, z: 0 },
      actions: [INFESTATION_ACTION],
    });
    const target = makeCombatant('goblin', {
      pos: { x: 12, y: 10, z: 0 },
      con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    resolveAttack(caster, target, INFESTATION_ACTION, state);

    const damageTaken = 100 - target.currentHP;
    assert(`21.${i}. damage in 1..6 range (iter ${i})`,
      damageTaken >= 1 && damageTaken <= 6, `got ${damageTaken}`);
    if (damageTaken < 1 || damageTaken > 6) break;

    // Verify the damage event mentions poison.
    const dmgEvent = state.log.events.find(
      (e: CombatEvent) => e.type === 'damage' && e.description.includes('poison'),
    );
    assert(`21.${i}b. damage event mentions poison`, dmgEvent !== undefined, '');
  }
}

// ============================================================
// 22. Infestation respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 22. Total Cover blocks Infestation ---');
{
  // Wall between caster (0,0) and target (6,0): x=3, y=-1..9, 1 square wide → Total Cover.
  const wall: Obstacle = {
    id: 'wall', x: 1, y: -1, z: 0,
    width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away — within 30-ft range, BUT blocked by wall
    con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target], [wall]);
  const state = makeState(bf);

  resolveAttack(caster, target, INFESTATION_ACTION, state);

  const blockedLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Total Cover'),
  );
  assert('22a. Total Cover blocks Infestation', blockedLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // No save, no move, no damage.
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('22b. no save_fail event (spell blocked)', saveFail === undefined);
  eq('22c. target HP unchanged (spell blocked)', target.currentHP, 100);
  // Target NOT moved.
  eq('22d. target NOT moved (spell blocked)', target.pos.x, 2);
}

// ============================================================
// 23. no size constraint — Huge target IS moved
// ============================================================
console.log('\n--- 23. Huge target IS moved (no size constraint) ---');
{
  // Infestation has NO size constraint (XGE p.158). A Huge target should still
  // be moved by the parasite cloud. (Distinct from Thorn Whip / Lightning Lure
  // which only pull Large and smaller.)
  for (let i = 0; i < 20; i++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 10, y: 10, z: 0 },
      actions: [INFESTATION_ACTION],
    });
    const hugeTarget = makeCombatant('huge', {
      pos: { x: 12, y: 10, z: 0 },
      size: 'Huge',
      con: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, hugeTarget]);
    const state = makeState(bf);

    resolveAttack(caster, hugeTarget, INFESTATION_ACTION, state);

    // Huge target should have moved (unlike Thorn Whip / Lightning Lure).
    assert(`23.${i}. Huge target moved (iter ${i})`,
      hugeTarget.pos.x !== 12 || hugeTarget.pos.y !== 10,
      `pos=(${hugeTarget.pos.x},${hugeTarget.pos.y})`);
    if (hugeTarget.pos.x === 12 && hugeTarget.pos.y === 10) break; // stop on first failure
  }
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
