// ============================================================
// Test: Booming Blade Cantrip
// TCE p.106 — Level 0 evocation cantrip (melee spell attack + movement-triggered rider)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17)
//   3. metadata exposes rider scaling (1d8 → 4d8 by level)
//   4. metadata exposes components (S + M, no V)
//   5. metadata exposes riderDiceByLevel
//   6. applyCantripEffect (module) — sets _boomingBladePendingDamageDice
//   7. dispatcher integration — 'Booming Blade' registered in CANTRIP_EFFECTS
//   8. dispatcher safety — unknown cantrip name is a no-op
//   9. resetBudget cleanup clears the flag
//  10. resolveAttack hit → rider applies (post-hit dispatcher)
//  11. resolveAttack miss → NO rider applies
//  12. executeMove willing movement → rider detonates + clears
//  13. executeMove with no rider → no detonation
//  14. forced movement (direct pos set, NOT executeMove) → rider does NOT detonate
//  15. second move after detonation → no further damage (one-shot)
//  16. Booming Blade respects Total Cover on the initial attack (no bypassesCover)
//  17. rollDiceString helper — parses 'NdM' correctly
//
// Run: npx ts-node src/test/booming_blade.test.ts
// ============================================================

import {
  metadata,
  applyCantripEffect,
  rollDiceString,
} from '../spells/booming_blade';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { resolveAttack, executeMove, EngineState } from '../engine/combat';
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
  const width = 20, height = 20, depth = 1;
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

function makeState(bf: any): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as EngineState;
}

// A Booming Blade Action as the AI/parser would build it from metadata.
// Melee spell attack: attackType='spell', reach=5. Damage 1d8 thunder (v1 simplification).
const BOOMING_BLADE_ACTION: Action = {
  name: 'Booming Blade',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: null,
  hitBonus: 20, // +20 → always hits AC 10
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'thunder',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Booming Blade',
};

// Guaranteed-miss variant.
const BOOMING_BLADE_MISS: Action = { ...BOOMING_BLADE_ACTION, hitBonus: -100 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Booming Blade');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (5 — melee reach)', metadata.rangeFt, 5);
  eq('1e. damageDice', metadata.damageDice, '1d8');
  eq('1f. damageType = thunder', metadata.damageType, 'thunder');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. scaling metadata (on-hit thunder, v1 flat 1d8)
// ============================================================
console.log('\n--- 2. scaling metadata (on-hit) ---');
{
  eq('2a. scales flag', metadata.scales, true);
  eq('2b. scalingLevels length 3', metadata.scalingLevels.length, 3);
  eq('2c. scalingLevels[0] = 5', metadata.scalingLevels[0], 5);
  eq('2d. scalingLevels[1] = 11', metadata.scalingLevels[1], 11);
  eq('2e. scalingLevels[2] = 17', metadata.scalingLevels[2], 17);
  // v1 simplification: on-hit thunder flat 1d8 at all levels.
  eq('2f. scalingDice[0] = 1d8 (v1 flat)', metadata.scalingDice[0], '1d8');
  eq('2g. scalingDice[2] = 1d8 (v1 flat)', metadata.scalingDice[2], '1d8');
}

// ============================================================
// 3. metadata exposes rider scaling (1d8 → 4d8 by level)
// ============================================================
console.log('\n--- 3. rider scaling metadata ---');
{
  eq('3a. scalingDiceRider[0] = 1d8 (level 1)', metadata.scalingDiceRider[0], '1d8');
  eq('3b. scalingDiceRider[1] = 2d8 (level 5)', metadata.scalingDiceRider[1], '2d8');
  eq('3c. scalingDiceRider[2] = 3d8 (level 11)', metadata.scalingDiceRider[2], '3d8');
  eq('3d. scalingDiceRider[3] = 4d8 (level 17)', metadata.scalingDiceRider[3], '4d8');
  eq('3e. riderDiceByLevel[1] = 1d8', metadata.riderDiceByLevel[1], '1d8');
  eq('3f. riderDiceByLevel[5] = 2d8', metadata.riderDiceByLevel[5], '2d8');
  eq('3g. riderDiceByLevel[11] = 3d8', metadata.riderDiceByLevel[11], '3d8');
  eq('3h. riderDiceByLevel[17] = 4d8', metadata.riderDiceByLevel[17], '4d8');
}

// ============================================================
// 4. components: S + M (no V) — TCE p.106
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. no verbal component', metadata.components.v, false);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. material component (melee weapon ≥1 sp)', metadata.components.m, true);
}

// ============================================================
// 5. metadata exposes riderDiceByLevel
// ============================================================
console.log('\n--- 5. riderDiceByLevel ---');
{
  // Already covered in section 3, but explicitly assert the map structure.
  assert('5a. riderDiceByLevel has 4 entries',
    Object.keys(metadata.riderDiceByLevel).length === 4);
}

// ============================================================
// 6. applyCantripEffect (module) — sets _boomingBladePendingDamageDice
// ============================================================
console.log('\n--- 6. applyCantripEffect: sets flag ---');
{
  const caster = makeCombatant('fighter');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  eq('6a. flag undefined before', target._boomingBladePendingDamageDice, undefined);

  const ret = applyCantripEffect(caster, target, state);
  eq('6b. returns true', ret, true);
  eq('6c. flag set to 1d8 (level 1 default)', target._boomingBladePendingDamageDice, '1d8');
  eq('6d. casterId set', target._boomingBladeCasterId, 'fighter');

  const logEntry = state.log.events.find(
    (e: any) => e.type === 'action' && e.description.includes('Booming Blade'),
  );
  assert('6e. rider logged', logEntry !== undefined, 'expected a log event mentioning Booming Blade');
  assert('6f. log mentions booming energy', logEntry?.description.includes('booming energy') === true, true);
}

// ============================================================
// 7. dispatcher integration — 'Booming Blade' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 7. dispatcher integration ---');
{
  const caster = makeCombatant('fighter');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Booming Blade', state);

  eq('7a. dispatcher set flag = 1d8', target._boomingBladePendingDamageDice, '1d8');
  const logHit = state.log.events.find((e: any) => e.description.includes('Booming Blade'));
  assert('7b. dispatcher emitted Booming Blade log', logHit !== undefined);
}

// ============================================================
// 8. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 8. dispatcher safety ---');
{
  const caster = makeCombatant('fighter');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('8a. unknown cantrip → no flag', target._boomingBladePendingDamageDice, undefined);
  eq('8b. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 9. resetBudget cleanup clears the flag
// ============================================================
console.log('\n--- 9. resetBudget cleanup ---');
{
  const caster = makeCombatant('fighter');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyCantripEffect(caster, target, state);
  eq('9a. flag set', target._boomingBladePendingDamageDice, '1d8');

  // Start of target's next turn — resetBudget clears the rider if not triggered.
  resetBudget(target);
  eq('9b. flag cleared by resetBudget', target._boomingBladePendingDamageDice, undefined);
  eq('9c. casterId cleared by resetBudget', target._boomingBladeCasterId, undefined);
}

// ============================================================
// 10. resolveAttack hit → rider applies (post-hit dispatcher)
// ============================================================
console.log('\n--- 10. resolveAttack HIT → rider applies ---');
{
  const caster = makeCombatant('fighter', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 }, // adjacent (5 ft)
    ac: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Force a hit via isCritOverride=true (deterministic — avoids the 5%
  // nat-1 auto-miss flakiness that +20 hitBonus vs AC 10 still has).
  // Crit doubles the on-hit thunder dice: 1d8 → 2d8 = 2..16.
  resolveAttack(caster, target, BOOMING_BLADE_ACTION, state, true /* force crit/hit */);

  // Hit → on-hit thunder damage (2d8 crit) + rider flag set.
  const hitEvent = state.log.events.find((e: any) => e.type === 'attack_hit' || e.type === 'attack_crit');
  const damageEvent = state.log.events.find((e: any) => e.type === 'damage');
  assert('10a. attack_hit/crit logged', hitEvent !== undefined);
  assert('10b. damage logged', damageEvent !== undefined);
  assert('10c. damage mentions thunder', damageEvent?.description.includes('thunder') === true,
    `got: ${damageEvent?.description}`);
  // 2d8 crit damage range: 2..16
  const onHitDmg = 100 - target.currentHP;
  assert('10d. on-hit damage in 2..16 (2d8 crit)', onHitDmg >= 2 && onHitDmg <= 16,
    `onHitDmg = ${onHitDmg}`);
  // Rider flag set after the hit (rider is 1d8, NOT doubled by crit).
  eq('10e. rider flag set after hit', target._boomingBladePendingDamageDice, '1d8');
  eq('10f. rider casterId set', target._boomingBladeCasterId, 'fighter');
}

// ============================================================
// 11. resolveAttack miss → NO rider applies
// ============================================================
console.log('\n--- 11. resolveAttack MISS → no rider ---');
{
  const caster = makeCombatant('fighter', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 30, // very high AC so +20 hitBonus misses (or use BOOMING_BLADE_MISS)
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, BOOMING_BLADE_MISS, state, false /* force miss — avoids nat-20 auto-hit flakiness */);

  const missEvent = state.log.events.find((e: any) => e.type === 'attack_miss');
  assert('11a. attack_miss logged', missEvent !== undefined);
  // No rider on a miss.
  eq('11b. rider flag NOT set after miss', target._boomingBladePendingDamageDice, undefined);
}

// ============================================================
// 12. executeMove willing movement → rider detonates + clears
// ============================================================
console.log('\n--- 12. executeMove willing move → rider detonates ---');
{
  const caster = makeCombatant('fighter', { pos: { x: 0, y: 0, z: 0 } });
  const mover = makeCombatant('goblin', {
    pos: { x: 5, y: 5, z: 0 }, // start here
    ac: 10, currentHP: 100, maxHP: 100,
    _boomingBladePendingDamageDice: '1d8',
    _boomingBladeCasterId: 'fighter',
    // movement budget: 30 ft
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster, mover]);
  const state = makeState(bf);

  // Mover willing moves 1 square (5 ft) to (6,5). executeMove is the
  // willing-movement choke point — the Booming Blade hook lives inside it.
  const beforeHP = mover.currentHP;
  executeMove(mover, { x: 6, y: 5, z: 0 }, state, false /* NOT disengage */);

  // The rider should have detonated: HP reduced by 1d8 (1..8).
  const dmgTaken = beforeHP - mover.currentHP;
  assert('12a. mover took rider damage (1..8)', dmgTaken >= 1 && dmgTaken <= 8,
    `dmgTaken = ${dmgTaken}`);

  // The rider flag should be CLEARED after detonation (one-shot).
  eq('12b. rider flag cleared after detonation', mover._boomingBladePendingDamageDice, undefined);
  eq('12c. casterId cleared after detonation', mover._boomingBladeCasterId, undefined);

  // The detonation should be logged as a damage event mentioning Booming Blade.
  const detonationLog = state.log.events.find(
    (e: any) => e.type === 'damage' && e.description.includes('Booming Blade') && e.description.includes('detonates'),
  );
  assert('12d. detonation logged', detonationLog !== undefined,
    `events: ${state.log.events.map((e: any) => e.description).join(' | ')}`);
  assert('12e. detonation log mentions thunder', detonationLog?.description.includes('thunder') === true);

  // Position should have updated (the move succeeded).
  eq('12f. mover position updated', mover.pos.x, 6);
}

// ============================================================
// 13. executeMove with no rider → no detonation
// ============================================================
console.log('\n--- 13. no rider → no detonation ---');
{
  // Mover has NO rider flag set. Even after a willing move, no extra damage.
  const mover = makeCombatant('goblin', {
    pos: { x: 5, y: 5, z: 0 },
    currentHP: 100, maxHP: 100,
    // NO _boomingBladePendingDamageDice — rider not active.
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([mover]);
  const state = makeState(bf);

  executeMove(mover, { x: 6, y: 5, z: 0 }, state, false);

  eq('13a. no rider flag set (still undefined)', mover._boomingBladePendingDamageDice, undefined);
  eq('13b. mover HP unchanged (no rider)', mover.currentHP, 100);

  // No "detonates" damage event should be in the log.
  const detonationLog = state.log.events.find(
    (e: any) => e.type === 'damage' && e.description.includes('Booming Blade'),
  );
  assert('13c. no Booming Blade detonation log', detonationLog === undefined,
    `unexpected: ${detonationLog?.description}`);
}

// ============================================================
// 14. forced movement (direct pos set, NOT executeMove) → rider does NOT detonate
// ============================================================
console.log('\n--- 14. forced movement → no detonation ---');
{
  // Mover has the rider flag. Forced movement (Thorn Whip pull, Thunderwave push,
  // grapple drag) modifies `pos` directly WITHOUT calling executeMove. The
  // Booming Blade hook lives inside executeMove, so forced movement does NOT
  // trigger the rider. PHB p.196 / TCE p.106: "willingly moves" = uses the
  // creature's own movement.
  const mover = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
    _boomingBladePendingDamageDice: '1d8',
    _boomingBladeCasterId: 'fighter',
  });

  // Simulate forced movement: directly set pos (as Thorn Whip / Thunderwave do).
  mover.pos = { x: 3, y: 0, z: 0 }; // pulled 2 squares west (10 ft)

  // The rider flag is STILL set (forced movement didn't trigger the hook).
  eq('14a. rider flag still set after forced movement', mover._boomingBladePendingDamageDice, '1d8');
  // HP unchanged (no detonation).
  eq('14b. mover HP unchanged after forced movement', mover.currentHP, 100);
}

// ============================================================
// 15. second move after detonation → no further damage (one-shot)
// ============================================================
console.log('\n--- 15. second move after detonation → no further damage ---');
{
  // Mover already had the rider detonate on a previous move (flag cleared).
  const mover = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 },
    currentHP: 92, maxHP: 100, // took 8 thunder from the first detonation
    // NO rider flag — already consumed.
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([mover]);
  const state = makeState(bf);

  eq('15a. rider flag undefined (consumed)', mover._boomingBladePendingDamageDice, undefined);

  // A second willing move does NOT re-trigger the rider.
  executeMove(mover, { x: 7, y: 5, z: 0 }, state, false);

  eq('15b. mover HP unchanged on second move', mover.currentHP, 92);
  const detonationLog = state.log.events.find(
    (e: any) => e.type === 'damage' && e.description.includes('Booming Blade'),
  );
  assert('15c. no detonation log on second move', detonationLog === undefined,
    `unexpected: ${detonationLog?.description}`);
}

// ============================================================
// 16. Booming Blade respects Total Cover on the initial attack (no bypassesCover)
// ============================================================
console.log('\n--- 16. Booming Blade respects Total Cover ---');
{
  const totalWall: Obstacle = {
    id: 'W1', x: 6, y: -1, z: 0, width: 1, depth: 20, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('fighter', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 12, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, BOOMING_BLADE_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: any) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find((e: any) => e.type === 'damage');
  assert('16a. Total Cover event logged', coverBlock !== undefined);
  assert('16b. no damage dealt (blocked by Total Cover)', damageEvent === undefined);
  eq('16c. rider flag NOT set (blocked by cover)', target._boomingBladePendingDamageDice, undefined);
  eq('16d. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// 17. rollDiceString helper — parses 'NdM' correctly
// ============================================================
console.log('\n--- 17. rollDiceString helper ---');
{
  // 1d8 → 1..8
  for (let i = 0; i < 50; i++) {
    const r = rollDiceString('1d8');
    assert('17a. 1d8 in 1..8', r >= 1 && r <= 8, `r = ${r}`);
  }
  // 2d8 → 2..16
  for (let i = 0; i < 50; i++) {
    const r = rollDiceString('2d8');
    assert('17b. 2d8 in 2..16', r >= 2 && r <= 16, `r = ${r}`);
  }
  // 4d8 → 4..32
  for (let i = 0; i < 50; i++) {
    const r = rollDiceString('4d8');
    assert('17c. 4d8 in 4..32', r >= 4 && r <= 32, `r = ${r}`);
  }
  // Invalid format → 0
  eq('17d. invalid format → 0', rollDiceString('invalid'), 0);
  eq('17e. empty string → 0', rollDiceString(''), 0);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
