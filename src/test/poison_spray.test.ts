// ============================================================
// Test: Poison Spray Cantrip
// PHB p.266 — Level 0 conjuration cantrip (CON save, 10 ft range)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d12/3d12/4d12)
//   3. metadata exposes saveAbility = 'con' for AI/parser
//   4. metadata exposes rangeFt = 10 (very short for a cantrip)
//   5. no CANTRIP_EFFECTS entry (no post-hit rider)
//   6. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   7. dispatcher safety — unknown cantrip name is a no-op
//   8. Action built from metadata has correct save shape
//   9. resolveAttack integration — save FAIL deals full poison damage
//  10. resolveAttack integration — save SUCCESS deals half poison damage
//  11. resolveAttack integration — Poison Spray respects Total Cover
//  12. PHB clarification: NOT a cone — single target within 10 ft
//
// Run: npx ts-node src/test/poison_spray.test.ts
// ============================================================

import { metadata } from '../spells/poison_spray';
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

// A Poison Spray Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='con'.
// Damage 1d12 poison. Range 10 ft (very short). No bypassesCover flag.
// NOTE: tests use two variants of this action — one with a very high DC (30)
// to guarantee save FAIL, and one with a very low DC (1) to guarantee save
// SUCCESS — so the save outcomes are deterministic regardless of the d20.
const POISON_SPRAY_ACTION: Action = {
  name: 'Poison Spray',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 10, long: 10 },
  hitBonus: null,
  damage: { count: 1, sides: 12, bonus: 0, average: 6 },
  damageType: 'poison',
  saveDC: 13,
  saveAbility: 'con',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Poison Spray',
};

// Deterministic save-FAIL variant: DC=30 → save always fails.
const POISON_SPRAY_FAIL: Action = { ...POISON_SPRAY_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS variant: DC=1 + con=30 (+10) → save always succeeds.
const POISON_SPRAY_SUCCESS: Action = { ...POISON_SPRAY_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Poison Spray');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'conjuration');
  eq('1d. rangeFt (10)', metadata.rangeFt, 10);
  eq('1e. damageDice', metadata.damageDice, '1d12');
  eq('1f. damageType', metadata.damageType, 'poison');
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
  eq('2f. scalingDice[0] = 2d12', metadata.scalingDice[0], '2d12');
  eq('2g. scalingDice[1] = 3d12', metadata.scalingDice[1], '3d12');
  eq('2h. scalingDice[2] = 4d12', metadata.scalingDice[2], '4d12');
}

// ============================================================
// 3. save ability exposed for AI/parser
// ============================================================
console.log('\n--- 3. save ability ---');
{
  eq('3a. saveAbility = con', metadata.saveAbility, 'con');
}

// ============================================================
// 4. range = 10 ft (very short for a cantrip)
// ============================================================
console.log('\n--- 4. range 10 ft ---');
{
  eq('4a. rangeFt = 10', metadata.rangeFt, 10);
  // Despite the "spray" name, PHB p.266 says range is "point, 10 ft" —
  // a single target within 10 ft, NOT a cone.
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
  dispatchCantrip(caster, target, 'Poison Spray', state);
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

  const ret = resolveCantripAction(caster, 'Poison Spray', state);
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
  eq('8a. attackType = save', POISON_SPRAY_ACTION.attackType, 'save');
  eq('8b. range.normal = 10 (very short)', POISON_SPRAY_ACTION.range?.normal, 10);
  eq('8c. damageType = poison', POISON_SPRAY_ACTION.damageType, 'poison');
  eq('8d. damage.sides = 12', POISON_SPRAY_ACTION.damage?.sides, 12);
  eq('8e. saveDC = 13', POISON_SPRAY_ACTION.saveDC, 13);
  eq('8f. saveAbility = con', POISON_SPRAY_ACTION.saveAbility, 'con');
  eq('8g. hitBonus null (save-based)', POISON_SPRAY_ACTION.hitBonus, null);
  eq('8h. slotLevel = 0 (cantrip)', POISON_SPRAY_ACTION.slotLevel, 0);
  eq('8i. not AoE (single target)', POISON_SPRAY_ACTION.isAoE, false);
  eq('8j. bypassesCover undefined (respects cover)', POISON_SPRAY_ACTION.bypassesCover, undefined);
}

// ============================================================
// 9. resolveAttack integration — save FAIL deals full poison damage
// ============================================================
console.log('\n--- 9. save FAIL: full poison damage ---');
{
  // Caster at (0,0), target at (1,0) — 5 ft apart, within 10 ft range, no cover.
  // DC=30 forces save FAIL regardless of the d20 (max save = 20+mod < 30).
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, POISON_SPRAY_FAIL, state);

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('poison'),
  );

  assert('9a. save_fail event logged (DC 30 → guaranteed fail)', saveFail !== undefined);
  assert('9b. poison damage event logged', damageEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('9c. save fail → full damage (not halved)',
    damageEvent?.description.includes('full') === true,
    `damage desc: ${damageEvent?.description}`);
  assert('9d. target took damage', target.currentHP < 100, true);
}

// ============================================================
// 10. resolveAttack integration — save SUCCESS deals half poison damage
// ============================================================
console.log('\n--- 10. save SUCCESS: half poison damage ---');
{
  // DC=1 + con=30 (+10) → save = d20+10 = min 11 >= 1 → guaranteed success.
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('fighter', {
    pos: { x: 1, y: 0, z: 0 },
    con: 30, // +10 mod
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, POISON_SPRAY_SUCCESS, state);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('poison'),
  );

  assert('10a. save_success event logged (DC 1 + con 30 → guaranteed success)', saveSuccess !== undefined);
  assert('10b. poison damage event logged', damageEvent !== undefined);
  assert('10c. save success → half damage (halved)',
    damageEvent?.description.includes('halved') === true,
    `damage desc: ${damageEvent?.description}`);
}

// ============================================================
// 11. Poison Spray respects Total Cover
// ============================================================
console.log('\n--- 11. Poison Spray respects Total Cover ---');
{
  // Wall between caster (0,0) and target (4,0): x=[2,3], y=[-1,8]
  const totalWall: Obstacle = {
    id: 'W1', x: 2, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 4, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, POISON_SPRAY_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('11a. Total Cover event logged', coverBlock !== undefined);
  assert('11b. no damage dealt (Poison Spray blocked by Total Cover)', damageEvent === undefined);
  eq('11c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// 12. PHB clarification: NOT a cone — single target within 10 ft
// ============================================================
console.log('\n--- 12. not a cone — single target ---');
{
  // Despite the "spray" name, PHB p.266 specifies range as "point, 10 ft"
  // — a single target within 10 ft, NOT a cone AoE. Verify the metadata
  // and Action reflect this.
  eq('12a. metadata.rangeFt = 10 (not a cone radius)', metadata.rangeFt, 10);
  eq('12b. Action.isAoE = false', POISON_SPRAY_ACTION.isAoE, false);
  eq('12c. Action.range.normal = 10', POISON_SPRAY_ACTION.range?.normal, 10);
  // Contrast: Burning Hands is a 15-ft cone AoE; Poison Spray is point-target.
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
