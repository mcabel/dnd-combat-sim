// ============================================================
// Test: Lightning Lure Cantrip
// TCE p.107 — Level 0 evocation cantrip (STR save + pull + conditional lightning damage)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d8/3d8/4d8)
//   3. metadata exposes saveAbility = 'str' for AI/parser
//   4. metadata exposes components (V only — no S, no M)
//   5. metadata exposes pullDistanceFt = 10 and maxPullSize = 'Large'
//   6. canPullSize helper — Large and smaller = true, Huge+ = false
//   7. applyCantripEffect (module) — pulls target on save-FAIL
//   8. dispatcher integration — 'Lightning Lure' registered in CANTRIP_EFFECTS
//   9. dispatcher safety — unknown cantrip name is a no-op
//  10. cleanup() is a no-op (no scratch fields — pull is instant)
//  11. save FAIL + target 10 ft away → pulled to 5 ft → 1d8 lightning damage
//  12. save FAIL + target 15 ft away → pulled 10 ft → ends 5 ft → damage
//  13. save FAIL + target already within 5 ft → no pull → damage (still in range)
//  14. save SUCCESS → NO pull, NO damage
//  15. damage is 1d8 lightning (1..8) when applied
//  16. pull is forced movement (does NOT trigger Booming Blade rider) — control test
//  17. Huge+ target NOT pulled and takes no damage (size constraint)
//  18. Lightning Lure respects Total Cover (no bypassesCover flag)
//
// Run: npx ts-node src/test/lightning_lure.test.ts
// ============================================================

import {
  metadata,
  applyCantripEffect,
  canPullSize,
  pullTarget,
  cleanup,
  LIGHTNING_LURE_PULL_FT,
  LIGHTNING_LURE_DAMAGE_RANGE_FT,
} from '../spells/lightning_lure';
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

// A Lightning Lure Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='str'.
//
// CRITICAL ARCHITECTURE NOTE: action.damage = null. Lightning Lure's damage
// is CONDITIONAL on the target's post-pull position (TCE p.107: "then take
// 1d8 lightning damage if it is within 5 feet of you"). resolveAttack's save
// branch rolls damage BEFORE applyCantripEffect (the pull rider) is called,
// which would apply damage unconditionally on save-FAIL. To preserve the
// position-conditional semantics, action.damage is null — resolveAttack's
// save branch skips damage entirely, and applyCantripEffect handles all
// damage logic (pull first, then check position, then roll damage if in range).
//
// The metadata.damageDice/damageType fields still expose the damage info for
// the AI/parser to estimate expected damage when planning.
const LIGHTNING_LURE_ACTION: Action = {
  name: 'Lightning Lure',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 15, long: 15 },
  hitBonus: null,
  damage: null, // damage is rolled INSIDE applyCantripEffect (post-pull conditional)
  damageType: 'lightning',
  saveDC: 13,
  saveAbility: 'str',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Lightning Lure',
};

// Deterministic save-FAIL variant: DC=30 → save always fails.
const LIGHTNING_LURE_FAIL: Action = { ...LIGHTNING_LURE_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS variant: DC=1 + str=30 (+10) → save always succeeds.
const LIGHTNING_LURE_SUCCESS: Action = { ...LIGHTNING_LURE_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Lightning Lure');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (15)', metadata.rangeFt, 15);
  eq('1e. damageDice', metadata.damageDice, '1d8');
  eq('1f. damageType = lightning', metadata.damageType, 'lightning');
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
  eq('2f. scalingDice[0] = 2d8', metadata.scalingDice[0], '2d8');
  eq('2g. scalingDice[1] = 3d8', metadata.scalingDice[1], '3d8');
  eq('2h. scalingDice[2] = 4d8', metadata.scalingDice[2], '4d8');
}

// ============================================================
// 3. save ability exposed for AI/parser
// ============================================================
console.log('\n--- 3. save ability ---');
{
  eq('3a. saveAbility = str', metadata.saveAbility, 'str');
}

// ============================================================
// 4. components: V only (no S, no M) — TCE p.107
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. no somatic component', metadata.components.s, false);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. metadata exposes pullDistanceFt = 10 and maxPullSize = 'Large'
// ============================================================
console.log('\n--- 5. pull metadata ---');
{
  eq('5a. pullDistanceFt = 10', metadata.pullDistanceFt, 10);
  eq('5b. maxPullSize = Large', metadata.maxPullSize, 'Large');
  eq('5c. LIGHTNING_LURE_PULL_FT const = 10', LIGHTNING_LURE_PULL_FT, 10);
  eq('5d. LIGHTNING_LURE_DAMAGE_RANGE_FT const = 5', LIGHTNING_LURE_DAMAGE_RANGE_FT, 5);
}

// ============================================================
// 6. canPullSize helper — Large and smaller = true, Huge+ = false
// ============================================================
console.log('\n--- 6. canPullSize ---');
{
  const tiny = makeCombatant('t', { size: 'Tiny' });
  const small = makeCombatant('s', { size: 'Small' });
  const medium = makeCombatant('m', { size: 'Medium' });
  const large = makeCombatant('l', { size: 'Large' });
  const huge = makeCombatant('h', { size: 'Huge' });
  const garg = makeCombatant('g', { size: 'Gargantuan' });
  const undef = makeCombatant('u'); // size undefined → default Medium

  assert('6a. Tiny pullable', canPullSize(tiny));
  assert('6b. Small pullable', canPullSize(small));
  assert('6c. Medium pullable', canPullSize(medium));
  assert('6d. Large pullable', canPullSize(large));
  assert('6e. Huge NOT pullable', !canPullSize(huge));
  assert('6f. Gargantuan NOT pullable', !canPullSize(garg));
  assert('6g. undefined size defaults to Medium (pullable)', canPullSize(undef));
}

// ============================================================
// 7. applyCantripEffect (module) — pulls target on save-FAIL
// ============================================================
console.log('\n--- 7. applyCantripEffect: pulls target ---');
{
  // Target 10 ft away → pulled 5 ft → ends at 5 ft → takes damage.
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away
    str: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const startPos = { ...target.pos };
  const ret = applyCantripEffect(caster, target, state);
  eq('7a. returns true', ret, true);

  // Target should have moved (pulled toward caster).
  assert('7b. target position changed (pulled)',
    target.pos.x !== startPos.x || target.pos.y !== startPos.y,
    `start=${JSON.stringify(startPos)} end=${JSON.stringify(target.pos)}`);

  // Target should be within 5 ft of caster now (Euclidean <= 5).
  const dx = caster.pos.x - target.pos.x;
  const dy = caster.pos.y - target.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy) * 5;
  assert('7c. target now within 5 ft of caster (damage range)',
    dist <= LIGHTNING_LURE_DAMAGE_RANGE_FT, `dist=${dist}`);

  // Lightning damage should have been applied.
  const dmgEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('lightning'),
  );
  assert('7d. lightning damage event logged', dmgEvent !== undefined);
  assert('7e. target took damage', target.currentHP < 100, true);

  // Pull move log.
  const moveLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Lightning Lure'),
  );
  assert('7f. pull move logged', moveLog !== undefined);
}

// ============================================================
// 8. dispatcher integration — 'Lightning Lure' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 8. dispatcher integration ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    str: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Lightning Lure', state);

  const logHit = state.log.events.find((e: CombatEvent) => e.description.includes('Lightning Lure'));
  assert('8a. dispatcher emitted Lightning Lure log', logHit !== undefined);
  assert('8b. target took damage via dispatcher', target.currentHP < 100, true);
}

// ============================================================
// 9. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 9. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin', { pos: { x: 2, y: 0, z: 0 } });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const startPos = { ...target.pos };
  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('9a. unknown cantrip → target not moved',
    target.pos.x, startPos.x);
  eq('9b. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 10. cleanup() is a no-op (no scratch fields — pull is instant)
// ============================================================
console.log('\n--- 10. cleanup is a no-op ---');
{
  const target = makeCombatant('goblin', { pos: { x: 2, y: 0, z: 0 } });
  // cleanup() should not throw and should not change anything.
  cleanup(target);
  eq('10a. cleanup does not change pos.x', target.pos.x, 2);
  eq('10b. cleanup does not change HP', target.currentHP, 40);
}

// ============================================================
// 11. save FAIL + target 10 ft away → pulled to 5 ft → 1d8 lightning damage
// ============================================================
console.log('\n--- 11. save FAIL + 10 ft away → pulled + damaged ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away
    str: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, LIGHTNING_LURE_FAIL, state);

  // Target should have been pulled.
  const dx = caster.pos.x - target.pos.x;
  const dy = caster.pos.y - target.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy) * 5;
  assert('11a. target now within 5 ft of caster', dist <= 5, `dist=${dist}`);

  // 1d8 lightning damage (1..8).
  const damageTaken = 100 - target.currentHP;
  assert('11b. damage in 1..8 range (1d8 lightning)',
    damageTaken >= 1 && damageTaken <= 8, `got ${damageTaken}`);

  // Verify the save FAIL was logged.
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('11c. save_fail logged (STR)', saveFail !== undefined);
  // resolveAttack's save branch logs lowercase saveAbility (e.g. "str save"),
  // so we check case-insensitively.
  assert('11d. save_fail mentions str (case-insensitive)',
    saveFail?.description.toLowerCase().includes('str') === true, true);
}

// ============================================================
// 12. save FAIL + target 15 ft away → pulled 10 ft → ends 5 ft → damage
// ============================================================
console.log('\n--- 12. save FAIL + 15 ft away → pulled 10 ft → damaged ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 3, y: 0, z: 0 }, // 15 ft away
    str: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, LIGHTNING_LURE_FAIL, state);

  // Should be pulled 10 ft closer (3 squares → 1 square).
  const dx = caster.pos.x - target.pos.x;
  const dy = caster.pos.y - target.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy) * 5;
  assert('12a. target pulled within 5 ft of caster', dist <= 5, `dist=${dist}`);

  // Should have taken damage.
  const damageTaken = 100 - target.currentHP;
  assert('12b. damage in 1..8 range (1d8 lightning)',
    damageTaken >= 1 && damageTaken <= 8, `got ${damageTaken}`);
}

// ============================================================
// 13. save FAIL + target already within 5 ft → no pull → damage (still in range)
// ============================================================
console.log('\n--- 13. save FAIL + already within 5 ft → no pull, still damaged ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 }, // 5 ft away (adjacent)
    str: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const startPos = { ...target.pos };
  resolveAttack(caster, target, LIGHTNING_LURE_FAIL, state);

  // Target should NOT have been pulled (already within 5 ft).
  eq('13a. target NOT moved (already within 5 ft)', target.pos.x, startPos.x);
  eq('13b. target.pos.y unchanged', target.pos.y, startPos.y);

  // But damage should still apply (within damage range).
  const damageTaken = 100 - target.currentHP;
  assert('13c. damage in 1..8 range (1d8 lightning)',
    damageTaken >= 1 && damageTaken <= 8, `got ${damageTaken}`);

  // Verify the "no pull needed" log was emitted.
  const noPullLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('no pull needed'),
  );
  assert('13d. "no pull needed" log emitted', noPullLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 14. save SUCCESS → NO pull, NO damage
// ============================================================
console.log('\n--- 14. save SUCCESS → no pull, no damage ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away
    str: 30, // +10 mod → save 11+ vs DC 1 → always succeeds
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const startPos = { ...target.pos };
  resolveAttack(caster, target, LIGHTNING_LURE_SUCCESS, state);

  // Target NOT pulled.
  eq('14a. target NOT moved (save succeeded)', target.pos.x, startPos.x);
  // Target NOT damaged.
  eq('14b. target HP unchanged (no damage)', target.currentHP, 100);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  assert('14c. save_success logged', saveSuccess !== undefined);

  // No pull move log.
  const moveLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'move' && e.description.includes('Lightning Lure'),
  );
  assert('14d. NO pull move log (save succeeded)', moveLog === undefined);
}

// ============================================================
// 15. damage is 1d8 lightning (1..8) when applied
// ============================================================
console.log('\n--- 15. damage = 1d8 lightning (1..8) ---');
{
  // Run multiple iterations to verify the damage range holds.
  for (let i = 0; i < 20; i++) {
    const caster = makeCombatant('wiz', {
      pos: { x: 0, y: 0, z: 0 },
      actions: [LIGHTNING_LURE_ACTION],
    });
    const target = makeCombatant('goblin', {
      pos: { x: 2, y: 0, z: 0 },
      str: 10,
      currentHP: 100, maxHP: 100,
      faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    resolveAttack(caster, target, LIGHTNING_LURE_FAIL, state);

    const damageTaken = 100 - target.currentHP;
    assert(`15.${i}. damage in 1..8 range (iter ${i})`,
      damageTaken >= 1 && damageTaken <= 8, `got ${damageTaken}`);
    if (damageTaken < 1 || damageTaken > 8) break; // stop on first failure
  }
}

// ============================================================
// 16. pull is forced movement (does NOT trigger Booming Blade rider) — control test
// ============================================================
console.log('\n--- 16. pull does NOT trigger Booming Blade (forced movement) ---');
{
  // Setup: a target marked with Booming Blade's pending-damage flag.
  // Cast Lightning Lure on it (save FAIL → pull). The pull is forced movement
  // (direct pos set, NOT executeMove) → Booming Blade's rider should NOT detonate.
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 3, y: 0, z: 0 }, // 15 ft away
    str: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
    // Mark the target with Booming Blade's pending damage flag.
    _boomingBladePendingDamageDice: '1d8',
    _boomingBladeCasterId: 'other-caster',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const hpBeforePull = target.currentHP;
  resolveAttack(caster, target, LIGHTNING_LURE_FAIL, state);

  // Verify the target WAS pulled (position changed).
  assert('16a. target was pulled by Lightning Lure',
    target.pos.x !== 3, `pos.x=${target.pos.x}`);

  // Verify the Booming Blade flag is STILL set (NOT consumed by the pull).
  eq('16b. Booming Blade flag still set (pull is forced movement)',
    target._boomingBladePendingDamageDice, '1d8');

  // Verify the damage taken = ONLY the Lightning Lure damage (1..8),
  // NOT Lightning Lure + Booming Blade detonation (which would be 1..8 + 1..8 = 2..16).
  // If Booming Blade had detonated, the damage would be in 2..16 range.
  // Since Lightning Lure alone is 1..8, the total should be in 1..8.
  const damageTaken = hpBeforePull - target.currentHP;
  assert('16c. damage = ONLY Lightning Lure (1..8), NOT + Booming Blade (2..16)',
    damageTaken >= 1 && damageTaken <= 8, `got ${damageTaken} — Booming Blade may have detonated`);

  // No Booming Blade detonation log.
  const bbLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('Booming Blade'),
  );
  assert('16d. NO Booming Blade detonation log', bbLog === undefined,
    `unexpected BB log: ${bbLog?.description}`);
}

// ============================================================
// 17. Huge+ target NOT pulled and takes no damage (size constraint)
// ============================================================
console.log('\n--- 17. Huge+ target NOT pulled, no damage ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_LURE_ACTION],
  });
  const hugeTarget = makeCombatant('huge', {
    pos: { x: 3, y: 0, z: 0 }, // 15 ft away
    size: 'Huge',
    str: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, hugeTarget]);
  const state = makeState(bf);

  const startPos = { ...hugeTarget.pos };
  resolveAttack(caster, hugeTarget, LIGHTNING_LURE_FAIL, state);

  // Huge+ target should NOT have been pulled (size constraint).
  eq('17a. Huge target NOT moved (size constraint)', hugeTarget.pos.x, startPos.x);

  // And since not pulled to within 5 ft, NO damage should be applied.
  eq('17b. Huge target took NO damage (not pulled to damage range)',
    hugeTarget.currentHP, 100);

  const tooLargeLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('too large'),
  );
  assert('17c. "too large" log emitted', tooLargeLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 18. Lightning Lure respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 18. Total Cover blocks Lightning Lure ---');
{
  // Wall between caster (0,0) and target (6,0): x=3, y=-1..9, 1 square wide → Total Cover.
  // Note: the target at (6,0) is OUTSIDE the 15-ft range of Lightning Lure, but
  // the Total Cover block fires BEFORE the range check (PHB cover rules). We use
  // this setup just to verify the LOS block fires — the spell is blocked by cover
  // regardless of range.
  const wall: Obstacle = {
    id: 'wall', x: 1, y: -1, z: 0,
    width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away — within 15-ft range, BUT blocked by wall
    str: 10,
    currentHP: 100, maxHP: 100,
    faction: 'enemy',
  });
  const bf = makeBF([caster, target], [wall]);
  const state = makeState(bf);

  resolveAttack(caster, target, LIGHTNING_LURE_FAIL, state);

  const blockedLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Total Cover'),
  );
  assert('18a. Total Cover blocks Lightning Lure', blockedLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // No save, no pull, no damage.
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('18b. no save_fail event (spell blocked)', saveFail === undefined);
  eq('18c. target HP unchanged (spell blocked)', target.currentHP, 100);
  // Target NOT pulled.
  eq('18d. target NOT pulled (spell blocked)', target.pos.x, 2);
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Lightning Lure test: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
