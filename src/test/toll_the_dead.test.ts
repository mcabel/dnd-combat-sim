// ============================================================
// Test: Toll the Dead Cantrip
// XGE p.169 — Level 0 necromancy cantrip (WIS save, conditional 1d8/1d12)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d8/3d8/4d8 full HP)
//   3. metadata exposes WOUNDED scaling info (2d12/3d12/4d12)
//   4. metadata exposes saveAbility = 'wis' for AI/parser
//   5. metadata exposes components (V + S)
//   6. damageSidesForTarget helper — full HP → 8, wounded → 12
//   7. damageDiceForTarget helper — scales with caster level
//   8. no CANTRIP_EFFECTS entry (no post-hit rider; conditional at Action-build)
//   9. no CANTRIP_SELF_EFFECTS / CANTRIP_AOE_EFFECTS entries
//  10. dispatcher safety — unknown cantrip name is a no-op
//  11. Action shape — save-based, WIS, 60 ft range
//  12. resolveAttack save FAIL → full necrotic damage (full HP target, 1d8)
//  13. resolveAttack save SUCCESS → half necrotic damage
//  14. resolveAttack save FAIL → full necrotic damage (wounded target, 1d12)
//  15. Toll the Dead respects Total Cover (no bypassesCover flag)
//
// Run: npx ts-node src/test/toll_the_dead.test.ts
// ============================================================

import { metadata, damageSidesForTarget, damageDiceForTarget } from '../spells/toll_the_dead';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
} from '../engine/cantrip_effects';
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

// A Toll the Dead Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='wis'.
// Damage 1d8 necrotic (default — full HP). The AI/parser swaps sides to 12
// when target.currentHP < target.maxHP via damageSidesForTarget().
const TOLL_THE_DEAD_ACTION: Action = {
  name: 'Toll the Dead',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 }, // 1d8 (full HP default)
  damageType: 'necrotic',
  saveDC: 13,
  saveAbility: 'wis',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Toll the Dead',
};

// Deterministic save-FAIL: DC=30 → save always fails.
const TOLL_FAIL: Action = { ...TOLL_THE_DEAD_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS: DC=1 + wis=30 (+10) → save always succeeds.
const TOLL_SUCCESS: Action = { ...TOLL_THE_DEAD_ACTION, saveDC: 1 };
// Wounded variant: 1d12 (target is missing HP).
const TOLL_FAIL_WOUNDED: Action = {
  ...TOLL_THE_DEAD_ACTION,
  saveDC: 30,
  damage: { count: 1, sides: 12, bonus: 0, average: 6 },
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Toll the Dead');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'necromancy');
  eq('1d. rangeFt (60)', metadata.rangeFt, 60);
  eq('1e. damageDice (default 1d8)', metadata.damageDice, '1d8');
  eq('1f. damageType = necrotic', metadata.damageType, 'necrotic');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. scaling metadata (full HP track — 1d8 → 4d8)
// ============================================================
console.log('\n--- 2. scaling metadata (full HP) ---');
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
// 3. scaling metadata (wounded track — 1d12 → 4d12)
// ============================================================
console.log('\n--- 3. scaling metadata (wounded) ---');
{
  eq('3a. damageDiceWounded (1d12)', metadata.damageDiceWounded, '1d12');
  eq('3b. scalingDiceWounded[0] = 2d12', metadata.scalingDiceWounded[0], '2d12');
  eq('3c. scalingDiceWounded[1] = 3d12', metadata.scalingDiceWounded[1], '3d12');
  eq('3d. scalingDiceWounded[2] = 4d12', metadata.scalingDiceWounded[2], '4d12');
}

// ============================================================
// 4. save ability exposed for AI/parser
// ============================================================
console.log('\n--- 4. save ability ---');
{
  eq('4a. saveAbility = wis', metadata.saveAbility, 'wis');
}

// ============================================================
// 5. components: V + S (no M) — XGE p.169
// ============================================================
console.log('\n--- 5. components ---');
{
  eq('5a. verbal component', metadata.components.v, true);
  eq('5b. somatic component', metadata.components.s, true);
  eq('5c. no material component', metadata.components.m, false);
}

// ============================================================
// 6. damageSidesForTarget helper — full HP → 8, wounded → 12
// ============================================================
console.log('\n--- 6. damageSidesForTarget helper ---');
{
  const fullHP = makeCombatant('full', { currentHP: 40, maxHP: 40 });
  const wounded = makeCombatant('wounded', { currentHP: 39, maxHP: 40 }); // missing 1 HP
  const badlyWounded = makeCombatant('badly', { currentHP: 1, maxHP: 40 });
  const emptyHP = makeCombatant('empty', { currentHP: 0, maxHP: 40 });

  eq('6a. full HP → sides 8', damageSidesForTarget(fullHP), 8);
  eq('6b. wounded (1 HP missing) → sides 12', damageSidesForTarget(wounded), 12);
  eq('6c. badly wounded → sides 12', damageSidesForTarget(badlyWounded), 12);
  eq('6d. empty HP (0 current) → sides 12', damageSidesForTarget(emptyHP), 12);
}

// ============================================================
// 7. damageDiceForTarget helper — scales with caster level
// ============================================================
console.log('\n--- 7. damageDiceForTarget helper ---');
{
  const fullHP = makeCombatant('full', { currentHP: 40, maxHP: 40 });
  const wounded = makeCombatant('wounded', { currentHP: 30, maxHP: 40 });

  eq('7a. full HP, level 1 → 1d8', damageDiceForTarget(fullHP, 1), '1d8');
  eq('7b. full HP, level 5 → 2d8', damageDiceForTarget(fullHP, 5), '2d8');
  eq('7c. full HP, level 11 → 3d8', damageDiceForTarget(fullHP, 11), '3d8');
  eq('7d. full HP, level 17 → 4d8', damageDiceForTarget(fullHP, 17), '4d8');
  eq('7e. wounded, level 1 → 1d12', damageDiceForTarget(wounded, 1), '1d12');
  eq('7f. wounded, level 5 → 2d12', damageDiceForTarget(wounded, 5), '2d12');
  eq('7g. wounded, level 17 → 4d12', damageDiceForTarget(wounded, 17), '4d12');
}

// ============================================================
// 8. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 8. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Toll the Dead', state);
  eq('8a. no scratch fields set', target._viciousMockeryDisadvNextAttack, undefined);
  eq('8b. no log events from dispatcher', state.log.events.length, 0);
}

// ============================================================
// 9. no CANTRIP_SELF_EFFECTS / CANTRIP_AOE_EFFECTS entries
// ============================================================
console.log('\n--- 9. not a self-buff / not an AoE cantrip ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('9a. resolveCantripAction returns false', resolveCantripAction(caster, 'Toll the Dead', state), false);
  eq('9b. resolveCantripAoE returns false', resolveCantripAoE(caster, 'Toll the Dead', state), false);
  eq('9c. no log events', state.log.events.length, 0);
}

// ============================================================
// 10. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 10. dispatcher safety ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('10a. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 11. Action shape — save-based, WIS, 60 ft range
// ============================================================
console.log('\n--- 11. Action shape ---');
{
  eq('11a. attackType = save', TOLL_THE_DEAD_ACTION.attackType, 'save');
  eq('11b. range.normal = 60', TOLL_THE_DEAD_ACTION.range?.normal, 60);
  eq('11c. damage.sides = 8 (full HP default)', TOLL_THE_DEAD_ACTION.damage?.sides, 8);
  eq('11d. damage.count = 1 (level 1)', TOLL_THE_DEAD_ACTION.damage?.count, 1);
  eq('11e. damageType = necrotic', TOLL_THE_DEAD_ACTION.damageType, 'necrotic');
  eq('11f. saveAbility = wis', TOLL_THE_DEAD_ACTION.saveAbility, 'wis');
  eq('11g. slotLevel = 0 (cantrip)', TOLL_THE_DEAD_ACTION.slotLevel, 0);
}

// ============================================================
// 12. resolveAttack save FAIL → full necrotic damage (full HP target, 1d8)
// ============================================================
console.log('\n--- 12. save FAIL (full HP) → full 1d8 necrotic ---');
{
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    wis: 10, // +0 mod
    currentHP: 100, maxHP: 100, // FULL HP → 1d8 track
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, TOLL_FAIL, state); // DC=30 → guaranteed FAIL

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('12a. save_fail logged', saveFail !== undefined);
  assert('12b. damage logged', damageEvent !== undefined);
  assert('12c. damage mentions necrotic', damageEvent?.description.includes('necrotic') === true,
    `got: ${damageEvent?.description}`);
  // 1d8 damage range: 1–8 (full damage on fail)
  const dmgDealt = 100 - target.currentHP;
  assert('12d. damage in 1–8 range (1d8 full HP)', dmgDealt >= 1 && dmgDealt <= 8, `dmgDealt = ${dmgDealt}`);
}

// ============================================================
// 13. resolveAttack save SUCCESS → half necrotic damage
// ============================================================
console.log('\n--- 13. save SUCCESS → half 1d8 necrotic ---');
{
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('cleric2', {
    pos: { x: 2, y: 0, z: 0 },
    wis: 30, // +10 mod → save = d20+10 ≥ 1 always
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, TOLL_SUCCESS, state); // DC=1 → guaranteed SUCCESS

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('13a. save_success logged', saveSuccess !== undefined);
  // Half damage is still applied on save success for cantrips (resolveAttack save branch
  // uses Math.floor(dmg / 2) for save success).
  assert('13b. damage logged (half on success)', damageEvent !== undefined);
  // 1d8 = 1–8, half = floor(1–8 / 2) = 0–4
  const dmgDealt = 100 - target.currentHP;
  assert('13c. damage in 0–4 range (half 1d8)', dmgDealt >= 0 && dmgDealt <= 4, `dmgDealt = ${dmgDealt}`);
}

// ============================================================
// 14. resolveAttack save FAIL → full necrotic damage (wounded target, 1d12)
// ============================================================
console.log('\n--- 14. save FAIL (wounded) → full 1d12 necrotic ---');
{
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    wis: 10,
    currentHP: 50, maxHP: 100, // WOUNDED → AI/parser swaps to 1d12
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // The AI/parser uses damageSidesForTarget(target) === 12 to build the
  // action with damage.sides = 12 (TOLL_FAIL_WOUNDED).
  resolveAttack(caster, target, TOLL_FAIL_WOUNDED, state); // DC=30 → guaranteed FAIL

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('14a. save_fail logged', saveFail !== undefined);
  assert('14b. damage logged', damageEvent !== undefined);
  // 1d12 damage range: 1–12 (full damage on fail, wounded target)
  const dmgDealt = 50 - target.currentHP;
  assert('14c. damage in 1–12 range (1d12 wounded)', dmgDealt >= 1 && dmgDealt <= 12, `dmgDealt = ${dmgDealt}`);
}

// ============================================================
// 15. Toll the Dead respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 15. Toll the Dead respects Total Cover ---');
{
  const totalWall: Obstacle = {
    id: 'W1', x: 6, y: -1, z: 0, width: 1, depth: 20, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 12, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, TOLL_THE_DEAD_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('15a. Total Cover event logged', coverBlock !== undefined);
  assert('15b. no damage dealt (blocked by Total Cover)', damageEvent === undefined);
  eq('15c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
