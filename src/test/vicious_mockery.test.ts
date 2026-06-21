// ============================================================
// Test: Vicious Mockery Cantrip
// PHB p.285 — Level 0 enchantment cantrip (WIS save + one-shot disadv rider)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d4/3d4/4d4)
//   3. metadata exposes saveAbility = 'wis' for AI/parser
//   4. metadata exposes components (V only — no S, no M)
//   5. applyCantripEffect (module) — sets _viciousMockeryDisadvNextAttack
//   6. dispatcher integration — 'Vicious Mockery' registered in CANTRIP_EFFECTS
//   7. dispatcher safety — unknown cantrip name is a no-op
//   8. resetBudget cleanup clears the flag
//   9. resolveAttack save branch: rider applies ONLY on save-FAIL
//  10. resolveAttack save branch: save-SUCCESS applies NO rider
//  11. resolveAttack attack branch: disadv folded into attack roll
//  12. resolveAttack attack branch: rider CONSUMED after one attack (one-shot)
//  13. resolveAttack attack branch: second attack has NO disadv (consume verified)
//  14. Vicious Mockery respects Total Cover (no bypassesCover flag)
//
// Run: npx ts-node src/test/vicious_mockery.test.ts
// ============================================================

import { metadata, applyCantripEffect } from '../spells/vicious_mockery';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
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

// A Vicious Mockery Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='wis'.
// Damage 1d4 psychic. Range 60 ft. No bypassesCover flag.
const VICIOUS_MOCKERY_ACTION: Action = {
  name: 'Vicious Mockery',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: { count: 1, sides: 4, bonus: 0, average: 2 },
  damageType: 'psychic',
  saveDC: 13,
  saveAbility: 'wis',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Vicious Mockery',
};

// Deterministic save-FAIL variant: DC=30 → save always fails.
const VICIOUS_MOCKERY_FAIL: Action = { ...VICIOUS_MOCKERY_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS variant: DC=1 + wis=30 (+10) → save always succeeds.
const VICIOUS_MOCKERY_SUCCESS: Action = { ...VICIOUS_MOCKERY_ACTION, saveDC: 1 };

// A simple melee attack for testing the consume-on-attack behavior.
// High hitBonus + low AC guarantees the attack hits (so the roll resolves).
const MELEE_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: null,
  hitBonus: 20, // +20 → always hits AC 10
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'slashing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Vicious Mockery');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'enchantment');
  eq('1d. rangeFt (60)', metadata.rangeFt, 60);
  eq('1e. damageDice', metadata.damageDice, '1d4');
  eq('1f. damageType', metadata.damageType, 'psychic');
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
  eq('2f. scalingDice[0] = 2d4', metadata.scalingDice[0], '2d4');
  eq('2g. scalingDice[1] = 3d4', metadata.scalingDice[1], '3d4');
  eq('2h. scalingDice[2] = 4d4', metadata.scalingDice[2], '4d4');
}

// ============================================================
// 3. save ability exposed for AI/parser
// ============================================================
console.log('\n--- 3. save ability ---');
{
  eq('3a. saveAbility = wis', metadata.saveAbility, 'wis');
}

// ============================================================
// 4. components: V only (no S, no M) — PHB p.285
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. no somatic component', metadata.components.s, false);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. applyCantripEffect (module) — sets _viciousMockeryDisadvNextAttack
// ============================================================
console.log('\n--- 5. applyCantripEffect: sets flag ---');
{
  const caster = makeCombatant('bard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  eq('5a. flag undefined before', target._viciousMockeryDisadvNextAttack, undefined);

  const ret = applyCantripEffect(caster, target, state);
  eq('5b. returns true', ret, true);
  eq('5c. flag set to true', target._viciousMockeryDisadvNextAttack, true);

  const logEntry = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Vicious Mockery'),
  );
  assert('5d. rider logged', logEntry !== undefined, 'expected a log event mentioning Vicious Mockery');
  assert('5e. log mentions disadvantage', logEntry?.description.includes('disadvantage') === true, true);
}

// ============================================================
// 6. dispatcher integration — 'Vicious Mockery' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 6. dispatcher integration ---');
{
  const caster = makeCombatant('bard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Vicious Mockery', state);

  eq('6a. dispatcher set flag', target._viciousMockeryDisadvNextAttack, true);
  const logHit = state.log.events.find((e: CombatEvent) => e.description.includes('Vicious Mockery'));
  assert('6b. dispatcher emitted Vicious Mockery log', logHit !== undefined);
}

// ============================================================
// 7. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 7. dispatcher safety ---');
{
  const caster = makeCombatant('bard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('7a. unknown cantrip → no flag', target._viciousMockeryDisadvNextAttack, undefined);
  eq('7b. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 8. resetBudget cleanup clears the flag
// ============================================================
console.log('\n--- 8. resetBudget cleanup ---');
{
  const caster = makeCombatant('bard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyCantripEffect(caster, target, state);
  eq('8a. flag set', target._viciousMockeryDisadvNextAttack, true);

  // Start of target's next turn — resetBudget clears the rider if not consumed
  resetBudget(target);
  eq('8b. flag cleared by resetBudget', target._viciousMockeryDisadvNextAttack, undefined);
}
{
  // If the flag was already consumed (set to false), resetBudget still clears it.
  const target = makeCombatant('goblin', { _viciousMockeryDisadvNextAttack: false });
  resetBudget(target);
  eq('8c. flag=false also cleared by resetBudget', target._viciousMockeryDisadvNextAttack, undefined);
}

// ============================================================
// 9. resolveAttack save branch: rider applies ONLY on save-FAIL
// ============================================================
console.log('\n--- 9. save FAIL → rider applies ---');
{
  // DC=30 → guaranteed save FAIL → rider should be applied.
  const caster = makeCombatant('bard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    wis: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, VICIOUS_MOCKERY_FAIL, state);

  eq('9a. flag set after save FAIL', target._viciousMockeryDisadvNextAttack, true);

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const riderLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Vicious Mockery') && e.description.includes('disadvantage'),
  );
  assert('9b. save_fail event logged', saveFail !== undefined);
  assert('9c. rider log mentions disadvantage', riderLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 10. resolveAttack save branch: save-SUCCESS applies NO rider
// ============================================================
console.log('\n--- 10. save SUCCESS → no rider ---');
{
  // DC=1 + wis=30 (+10) → guaranteed save SUCCESS → rider should NOT be applied.
  const caster = makeCombatant('bard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('cleric', {
    pos: { x: 2, y: 0, z: 0 },
    wis: 30, // +10 mod
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, VICIOUS_MOCKERY_SUCCESS, state);

  eq('10a. flag NOT set after save SUCCESS', target._viciousMockeryDisadvNextAttack, undefined);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  const riderLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Vicious Mockery') && e.description.includes('disadvantage'),
  );
  assert('10b. save_success event logged', saveSuccess !== undefined);
  assert('10c. NO rider log on save success', riderLog === undefined,
    `unexpected rider log: ${riderLog?.description}`);
}

// ============================================================
// 11. resolveAttack attack branch: disadv folded into attack roll
// ============================================================
console.log('\n--- 11. attack disadv folded from Vicious Mockery flag ---');
{
  // Target was mocked (flag set). When the target attacks, the attack should
  // have disadv logged. Use a high hitBonus so the attack resolves either way.
  const attacker = makeCombatant('goblin', {
    pos: { x: 0, y: 0, z: 0 },
    _viciousMockeryDisadvNextAttack: true, // pre-set: mocked last turn
  });
  const target = makeCombatant('bard', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  resolveAttack(attacker, target, MELEE_ACTION, state);

  const disadvLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Disadvantage') && e.description.includes('Vicious Mockery'),
  );
  assert('11a. disadv log mentions Vicious Mockery', disadvLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 12. resolveAttack attack branch: rider CONSUMED after one attack
// ============================================================
console.log('\n--- 12. rider consumed after one attack ---');
{
  const attacker = makeCombatant('goblin', {
    pos: { x: 0, y: 0, z: 0 },
    _viciousMockeryDisadvNextAttack: true,
  });
  const target = makeCombatant('bard', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  resolveAttack(attacker, target, MELEE_ACTION, state);

  // After the attack resolves, the flag should be consumed (set to false).
  eq('12a. flag consumed (false) after attack', attacker._viciousMockeryDisadvNextAttack, false);

  const consumeLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.description.includes('Vicious Mockery') && e.description.includes('consumed'),
  );
  assert('12b. consume log mentions Vicious Mockery + consumed', consumeLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 13. second attack has NO disadv (one-shot consume verified)
// ============================================================
console.log('\n--- 13. second attack: no disadv (one-shot) ---');
{
  // Pre-consume the flag (simulating the first attack already happened).
  const attacker = makeCombatant('goblin', {
    pos: { x: 0, y: 0, z: 0 },
    _viciousMockeryDisadvNextAttack: false, // already consumed
  });
  const target = makeCombatant('bard', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([attacker, target]);
  const state = makeState(bf);

  resolveAttack(attacker, target, MELEE_ACTION, state);

  // No "Disadvantage (Vicious Mockery)" log on this second attack.
  const disadvLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Disadvantage') && e.description.includes('Vicious Mockery'),
  );
  assert('13a. NO disadv log on second attack (one-shot consumed)', disadvLog === undefined,
    `unexpected disadv log: ${disadvLog?.description}`);

  // Flag stays false (not re-triggered by an attack)
  eq('13b. flag stays false after second attack', attacker._viciousMockeryDisadvNextAttack, false);
}

// ============================================================
// 14. Vicious Mockery respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 14. Vicious Mockery respects Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8]
  const totalWall: Obstacle = {
    id: 'W1', x: 3, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('bard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, VICIOUS_MOCKERY_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('14a. Total Cover event logged', coverBlock !== undefined);
  assert('14b. no damage dealt (Vicious Mockery blocked by Total Cover)', damageEvent === undefined);
  eq('14c. flag NOT set (blocked by cover)', target._viciousMockeryDisadvNextAttack, undefined);
  eq('14d. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
