// ============================================================
// Test: Sapping Sting Cantrip
// EGW p.189 — Level 0 necromancy cantrip (CON save + prone on fail)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d4/3d4/4d4)
//   3. metadata exposes saveAbility = 'con' for AI/parser
//   4. metadata exposes components (V + S — no M)
//   5. metadata exposes conditionInflicted = 'prone'
//   6. applyCantripEffect (module) — adds 'prone' condition to target
//   7. dispatcher integration — 'Sapping Sting' registered in CANTRIP_EFFECTS
//   8. dispatcher safety — unknown cantrip name is a no-op
//   9. cleanup() is a no-op (prone is a condition, not a scratch field)
//  10. resolveAttack save branch: rider applies 'prone' ONLY on save-FAIL
//  11. resolveAttack save branch: save-SUCCESS applies NO prone
//  12. resolveAttack save FAIL → 1d4 necrotic damage (1..4)
//  13. melee attacks vs prone target have ADVANTAGE (control test)
//  14. ranged attacks vs prone target have DISADVANTAGE (control test)
//  15. prone NOT cleared by resetBudget (it's a condition, not a scratch field)
//  16. Sapping Sting respects Total Cover (no bypassesCover flag)
//
// Run: npx ts-node src/test/sapping_sting.test.ts
// ============================================================

import { metadata, applyCantripEffect, cleanup } from '../spells/sapping_sting';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { resetBudget, resolveAttackAdvantage } from '../engine/utils';
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

// A Sapping Sting Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='con'.
// Damage 1d4 necrotic. Range 30 ft. No bypassesCover flag.
const SAPPING_STING_ACTION: Action = {
  name: 'Sapping Sting',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: { count: 1, sides: 4, bonus: 0, average: 2 },
  damageType: 'necrotic',
  saveDC: 13,
  saveAbility: 'con',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Sapping Sting',
};

// Deterministic save-FAIL variant: DC=30 → save always fails.
const SAPPING_STING_FAIL: Action = { ...SAPPING_STING_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS variant: DC=1 + con=30 (+10) → save always succeeds.
const SAPPING_STING_SUCCESS: Action = { ...SAPPING_STING_ACTION, saveDC: 1 };

// A simple MELEE attack action for testing prone-advantage (control test).
const MELEE_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: null,
  hitBonus: 20,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'slashing',
  saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 0, costType: 'action', legendaryCost: 0,
  description: 'Longsword',
};

// A simple RANGED attack action for testing prone-disadvantage (control test).
const RANGED_ACTION: Action = {
  ...MELEE_ACTION,
  name: 'Shortbow',
  attackType: 'ranged',
  range: { normal: 80, long: 320 },
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'piercing',
  description: 'Shortbow',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Sapping Sting');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'necromancy');
  eq('1d. rangeFt (30)', metadata.rangeFt, 30);
  eq('1e. damageDice', metadata.damageDice, '1d4');
  eq('1f. damageType = necrotic', metadata.damageType, 'necrotic');
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
  eq('3a. saveAbility = con', metadata.saveAbility, 'con');
}

// ============================================================
// 4. components: V + S (no M) — EGW p.189
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. metadata exposes conditionInflicted = 'prone'
// ============================================================
console.log('\n--- 5. conditionInflicted ---');
{
  eq('5a. conditionInflicted = prone', metadata.conditionInflicted, 'prone');
}

// ============================================================
// 6. applyCantripEffect (module) — adds 'prone' condition to target
// ============================================================
console.log('\n--- 6. applyCantripEffect: adds prone ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  assert('6a. target NOT prone before', !target.conditions.has('prone'));

  const ret = applyCantripEffect(caster, target, state);
  eq('6b. returns true', ret, true);
  assert('6c. target IS prone after applyCantripEffect', target.conditions.has('prone'));

  const logEntry = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_add' && e.description.includes('Sapping Sting'),
  );
  assert('6d. condition_add log mentions Sapping Sting', logEntry !== undefined);
  assert('6e. log mentions prone', logEntry?.description.includes('prone') === true, true);
}

// ============================================================
// 7. dispatcher integration — 'Sapping Sting' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 7. dispatcher integration ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Sapping Sting', state);

  assert('7a. dispatcher added prone condition', target.conditions.has('prone'));
  const logHit = state.log.events.find((e: CombatEvent) => e.description.includes('Sapping Sting'));
  assert('7b. dispatcher emitted Sapping Sting log', logHit !== undefined);
}

// ============================================================
// 8. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 8. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  assert('8a. unknown cantrip → no prone condition', !target.conditions.has('prone'));
  eq('8b. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 9. cleanup() is a no-op (prone is a condition, not a scratch field)
// ============================================================
console.log('\n--- 9. cleanup is a no-op ---');
{
  const target = makeCombatant('goblin');
  target.conditions.add('prone');

  cleanup(target);

  // Prone should still be set — cleanup does NOT clear it.
  assert('9a. cleanup does NOT clear prone (it is a condition)', target.conditions.has('prone'));
}

// ============================================================
// 10. resolveAttack save branch: rider applies 'prone' ONLY on save-FAIL
// ============================================================
console.log('\n--- 10. save FAIL → prone applies ---');
{
  // DC=30 → guaranteed save FAIL → rider should be applied.
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, SAPPING_STING_FAIL, state);

  assert('10a. prone applied after save FAIL', target.conditions.has('prone'));

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('10b. save_fail event logged', saveFail !== undefined);

  const conditionAdd = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_add' && e.description.includes('Sapping Sting'),
  );
  assert('10c. condition_add event logged', conditionAdd !== undefined);
}

// ============================================================
// 11. resolveAttack save branch: save-SUCCESS applies NO prone
// ============================================================
console.log('\n--- 11. save SUCCESS → NO prone ---');
{
  // DC=1 + con=30 (+10) → guaranteed save SUCCESS → no rider.
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    con: 30,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, SAPPING_STING_SUCCESS, state);

  assert('11a. NO prone after save SUCCESS', !target.conditions.has('prone'));

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  assert('11b. save_success event logged', saveSuccess !== undefined);

  const conditionAdd = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_add' && e.description.includes('Sapping Sting'),
  );
  assert('11c. NO condition_add event (save succeeded)', conditionAdd === undefined);
}

// ============================================================
// 12. resolveAttack save FAIL → 1d4 necrotic damage (1..4)
// ============================================================
console.log('\n--- 12. necrotic damage on save FAIL ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, SAPPING_STING_FAIL, state);

  const dmgEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('necrotic'),
  );
  assert('12a. necrotic damage logged', dmgEvent !== undefined);
  if (dmgEvent) {
    assert('12b. necrotic damage in 1..4 range (1d4)',
      dmgEvent.value! >= 1 && dmgEvent.value! <= 4, `got ${dmgEvent.value}`);
  }
  const damageTaken = 100 - target.currentHP;
  assert('12c. damage taken = 1..4', damageTaken >= 1 && damageTaken <= 4, `got ${damageTaken}`);
}

// ============================================================
// 13. melee attacks vs prone target have ADVANTAGE (control test)
// ============================================================
console.log('\n--- 13. prone → melee attacks have ADVANTAGE ---');
{
  // resolveAttackAdvantage in utils.ts reads target.conditions.has('prone') and
  // grants advantage to melee/spell attackers, disadvantage to ranged attackers.
  const attacker = makeCombatant('fighter', { pos: { x: 0, y: 0, z: 0 } });
  const proneTarget = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
  });
  proneTarget.conditions.add('prone');

  const { advantage, disadvantage } = resolveAttackAdvantage(attacker, proneTarget, 'melee');
  assert('13a. melee vs prone → advantage', advantage === true);
  assert('13b. melee vs prone → NO disadvantage', disadvantage === false);
}
{
  // Also verify spell attacks get advantage vs prone (per resolveAttackAdvantage).
  const attacker = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const proneTarget = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
  });
  proneTarget.conditions.add('prone');

  const { advantage, disadvantage } = resolveAttackAdvantage(attacker, proneTarget, 'spell');
  assert('13c. spell vs prone → advantage', advantage === true);
}

// ============================================================
// 14. ranged attacks vs prone target have DISADVANTAGE (control test)
// ============================================================
console.log('\n--- 14. prone → ranged attacks have DISADVANTAGE ---');
{
  const attacker = makeCombatant('ranger', { pos: { x: 0, y: 0, z: 0 } });
  const proneTarget = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 },
  });
  proneTarget.conditions.add('prone');

  const { advantage, disadvantage } = resolveAttackAdvantage(attacker, proneTarget, 'ranged');
  assert('14a. ranged vs prone → disadvantage', disadvantage === true);
  assert('14b. ranged vs prone → NO advantage', advantage === false);
}

// ============================================================
// 15. prone NOT cleared by resetBudget (it's a condition, not a scratch field)
// ============================================================
console.log('\n--- 15. prone NOT cleared by resetBudget ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, SAPPING_STING_FAIL, state);
  assert('15a. target is prone after save FAIL', target.conditions.has('prone'));

  // Start of target's next turn — resetBudget clears scratch fields (Vicious
  // Mockery, Mind Sliver, Frostbite, Booming Blade), but NOT the 'prone'
  // condition (it's a PHB Appendix A condition, cleared by standing up).
  resetBudget(target);
  assert('15b. prone STILL set after resetBudget (condition, not scratch field)',
    target.conditions.has('prone'));
}

// ============================================================
// 16. Sapping Sting respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 16. Total Cover blocks Sapping Sting ---');
{
  // Wall between caster (0,0) and target (6,0): x=3, y=-1..9, 1 square wide → Total Cover.
  const wall: Obstacle = {
    id: 'wall', x: 3, y: -1, z: 0,
    width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wiz', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [wall]);
  const state = makeState(bf);

  resolveAttack(caster, target, SAPPING_STING_FAIL, state);

  const blockedLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Total Cover'),
  );
  assert('16a. Total Cover blocks Sapping Sting', blockedLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  assert('16b. NO prone applied (blocked by cover)', !target.conditions.has('prone'));
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('16c. no save_fail event (spell blocked)', saveFail === undefined);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
