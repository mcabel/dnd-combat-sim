// ============================================================
// Test: Acid Splash Cantrip
// PHB p.211 — Level 0 conjuration cantrip (DEX save, single-target v1)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d6/3d6/4d6)
//   3. metadata exposes saveAbility = 'dex' for AI/parser
//   4. metadata exposes maxTargets = 1 (v1 simplification)
//   5. no CANTRIP_EFFECTS entry (no post-hit rider)
//   6. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   7. dispatcher safety — unknown cantrip name is a no-op
//   8. Action built from metadata has correct save shape
//   9. resolveAttack integration — save FAIL deals full acid damage
//  10. resolveAttack integration — save SUCCESS deals half acid damage
//  11. resolveAttack integration — Acid Splash respects Total Cover (no bypass)
//  12. v1 simplification: single-target only (documented)
//
// Run: npx ts-node src/test/acid_splash.test.ts
// ============================================================

import { metadata } from '../spells/acid_splash';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
} from '../engine/cantrip_effects';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, PlayerResources, Vec3, Cell, Obstacle } from '../types/core';

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

// An Acid Splash Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='dex'.
// Damage 1d6 acid. No bypassesCover flag.
// NOTE: tests use two variants of this action — one with a very high DC (30)
// to guarantee save FAIL, and one with a very low DC (1) to guarantee save
// SUCCESS — so the save outcomes are deterministic regardless of the d20.
const ACID_SPLASH_ACTION: Action = {
  name: 'Acid Splash',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'acid',
  saveDC: 13,
  saveAbility: 'dex',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Acid Splash',
};

// Deterministic save-FAIL variant: DC=30 → save = d20 + mod, max ~25 < 30 → always fails.
const ACID_SPLASH_FAIL: Action = { ...ACID_SPLASH_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS variant: DC=1 → save = d20 + mod, min ~−4 < 1 only on
// extremely low rolls — but with dex=30 (+10), save = d20+10 = min 11 >= 1 → always succeeds.
const ACID_SPLASH_SUCCESS: Action = { ...ACID_SPLASH_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Acid Splash');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'conjuration');
  eq('1d. rangeFt (60)', metadata.rangeFt, 60);
  eq('1e. damageDice', metadata.damageDice, '1d6');
  eq('1f. damageType', metadata.damageType, 'acid');
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
  eq('3a. saveAbility = dex', metadata.saveAbility, 'dex');
}

// ============================================================
// 4. v1 simplification: maxTargets = 1
// ============================================================
console.log('\n--- 4. v1 single-target simplification ---');
{
  eq('4a. maxTargets = 1 (v1 simplification)', metadata.maxTargets, 1);
  // PHB allows up to 2 targets within 5 ft — v1 supports only 1.
  // Documented in the module header; AI/parser must enforce single-target.
}

// ============================================================
// 5. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 5. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Acid Splash', state);
  eq('5a. dispatcher no-op (no log events added)', state.log.events.length, eventsBefore);
  eq('5b. no scratch flags set', target._viciousMockeryDisadvNextAttack, undefined);
}

// ============================================================
// 6. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 6. no CANTRIP_SELF_EFFECTS entry ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Acid Splash', state);
  eq('6a. resolveCantripAction returns false', ret, false);
  eq('6b. no log events', state.log.events.length, 0);
}

// ============================================================
// 7. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 7. dispatcher safety ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('7a. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 8. Action built from metadata has correct save shape
// ============================================================
console.log('\n--- 8. Action shape ---');
{
  eq('8a. attackType = save', ACID_SPLASH_ACTION.attackType, 'save');
  eq('8b. range.normal = 60', ACID_SPLASH_ACTION.range?.normal, 60);
  eq('8c. damageType = acid', ACID_SPLASH_ACTION.damageType, 'acid');
  eq('8d. damage.sides = 6', ACID_SPLASH_ACTION.damage?.sides, 6);
  eq('8e. saveDC = 13', ACID_SPLASH_ACTION.saveDC, 13);
  eq('8f. saveAbility = dex', ACID_SPLASH_ACTION.saveAbility, 'dex');
  eq('8g. hitBonus null (save-based)', ACID_SPLASH_ACTION.hitBonus, null);
  eq('8h. slotLevel = 0 (cantrip)', ACID_SPLASH_ACTION.slotLevel, 0);
  eq('8i. not AoE (single-target v1)', ACID_SPLASH_ACTION.isAoE, false);
  eq('8j. bypassesCover undefined (respects cover)', ACID_SPLASH_ACTION.bypassesCover, undefined);
}

// ============================================================
// 9. resolveAttack integration — save FAIL deals full acid damage
// ============================================================
console.log('\n--- 9. save FAIL: full acid damage ---');
{
  // Caster at (0,0), target at (2,0) — 10 ft apart, no cover.
  // DC=30 forces save FAIL regardless of the d20 (max save = 20+mod < 30).
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    dex: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, ACID_SPLASH_FAIL, state);

  const saveFailAny = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('acid'),
  );

  assert('9a. save_fail event logged (DC 30 → guaranteed fail)', saveFailAny !== undefined);
  assert('9b. acid damage event logged', damageEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  // Save fail → full damage (no "halved" in description)
  assert('9c. save fail → full damage (not halved)',
    damageEvent?.description.includes('full') === true,
    `damage desc: ${damageEvent?.description}`);
  assert('9d. target took damage', target.currentHP < 100, true);
}

// ============================================================
// 10. resolveAttack integration — save SUCCESS deals half acid damage
// ============================================================
console.log('\n--- 10. save SUCCESS: half acid damage ---');
{
  // DC=1 + dex=30 (+10) → save = d20+10 = min 11 >= 1 → guaranteed success.
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('rogue', {
    pos: { x: 2, y: 0, z: 0 },
    dex: 30, // +10 mod
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, ACID_SPLASH_SUCCESS, state);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('acid'),
  );

  assert('10a. save_success event logged (DC 1 + dex 30 → guaranteed success)', saveSuccess !== undefined);
  assert('10b. acid damage event logged', damageEvent !== undefined);
  // Save success → half damage (description should say "halved")
  assert('10c. save success → half damage (halved)',
    damageEvent?.description.includes('halved') === true,
    `damage desc: ${damageEvent?.description}`);
}

// ============================================================
// 11. Acid Splash respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 11. Acid Splash respects Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8]
  const totalWall: Obstacle = {
    id: 'W1', x: 3, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, ACID_SPLASH_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('11a. Total Cover event logged', coverBlock !== undefined);
  assert('11b. no damage dealt (Acid Splash blocked by Total Cover)', damageEvent === undefined);
  eq('11c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// 12. v1 simplification: single-target only
// ============================================================
console.log('\n--- 12. v1 single-target simplification ---');
{
  // Document that v1 Acid Splash only hits one target.
  // PHB allows 2 targets within 5 ft — v1 supports only 1.
  // This test verifies the metadata declares maxTargets=1, which the
  // AI/parser must respect when building the Action.
  eq('12a. metadata.maxTargets = 1 (v1 simplification)', metadata.maxTargets, 1);
  // The 2-target AoE resolution path is deferred to a future batch.
  // When implemented, maxTargets will be bumped to 2 and a multi-target
  // resolution helper will be added (mirror Burning Hands / Thunderwave).
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
