// ============================================================
// Test: Create Bonfire Cantrip
// XGE p.152 — Level 0 conjuration cantrip (DEX save, 1d8 fire, persistent hazard v1)
//
// v1 simplification: ON-CAST damage only. The persistent triggers (move-into,
// end-turn) are NOT yet implemented — documented via metadata flag
// `bonfirePersistentV1Implemented: false`.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d8/3d8/4d8)
//   3. metadata exposes saveAbility = 'dex' for AI/parser
//   4. metadata exposes components (V + S — no M)
//   5. metadata exposes concentration = true (XGE p.152: "Concentration, up to 1 minute")
//   6. metadata exposes v1 simplification flag
//   7. metadata exposes bonfireSizeFt = 5 (5-ft cube)
//   8. no CANTRIP_EFFECTS entry (no post-save-FAIL rider — damage is the effect)
//   9. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//  10. no CANTRIP_AOE_EFFECTS entry (not caster-centered — target point in 60 ft)
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. Action built from metadata has correct save-spell shape
//  13. resolveAttack integration — on-cast damage (trigger 1) applies
//  14. resolveAttack integration — save FAIL → full 1d8 fire (1..8)
//  15. resolveAttack integration — save SUCCESS → half (0..4)
//  16. Action requiresConcentration = true (forward-compat for persistent triggers)
//  17. Create Bonfire respects Total Cover (no bypassesCover flag)
//  18. metadata does NOT include persistent-trigger fields (v1 simplification)
//
// Run: npx ts-node src/test/create_bonfire.test.ts
// ============================================================

import { metadata } from '../spells/create_bonfire';
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

// A Create Bonfire Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='dex'.
// Damage 1d8 fire. Range 60 ft. Concentration required (XGE p.152).
const CREATE_BONFIRE_ACTION: Action = {
  name: 'Create Bonfire',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'fire',
  saveDC: 30, // DC=30 → guaranteed save FAIL (deterministic test)
  saveAbility: 'dex',
  isAoE: false,
  isControl: false,
  requiresConcentration: true, // XGE p.152: "Concentration, up to 1 minute"
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Create Bonfire',
};

// Save-SUCCESS variant: DC=1 + dex=30 (+10) → guaranteed save SUCCESS.
const CREATE_BONFIRE_SUCCESS_ACTION: Action = { ...CREATE_BONFIRE_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Create Bonfire');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'conjuration');
  eq('1d. rangeFt (60)', metadata.rangeFt, 60);
  eq('1e. damageDice', metadata.damageDice, '1d8');
  eq('1f. damageType = fire', metadata.damageType, 'fire');
  eq('1g. concentration = true (XGE p.152)', metadata.concentration, true);
  eq('1h. castingTime = action', metadata.castingTime, 'action');
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
  eq('3a. saveAbility = dex', metadata.saveAbility, 'dex');
}

// ============================================================
// 4. components: V + S (no M) — XGE p.152
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. metadata exposes concentration = true
// ============================================================
console.log('\n--- 5. concentration ---');
{
  eq('5a. concentration = true (XGE p.152: Concentration, up to 1 minute)',
    metadata.concentration, true);
  eq('5b. Action requiresConcentration = true', CREATE_BONFIRE_ACTION.requiresConcentration, true);
}

// ============================================================
// 6. metadata exposes v1 simplification flag
// ============================================================
console.log('\n--- 6. v1 simplification flag ---');
{
  eq('6a. bonfirePersistentV1Implemented = false (on-cast damage only)',
    metadata.bonfirePersistentV1Implemented, false);
}

// ============================================================
// 7. metadata exposes bonfireSizeFt = 5 (5-ft cube)
// ============================================================
console.log('\n--- 7. bonfireSizeFt ---');
{
  eq('7a. bonfireSizeFt = 5 (XGE p.152: "fills a 5-foot cube")',
    metadata.bonfireSizeFt, 5);
}

// ============================================================
// 8. no CANTRIP_EFFECTS entry (no post-save-FAIL rider — damage is the effect)
// ============================================================
console.log('\n--- 8. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Dispatcher should be a no-op for Create Bonfire (no rider registered).
  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Create Bonfire', state);
  eq('8a. dispatcher no-op (no log events added)', state.log.events.length, eventsBefore);

  // No scratch fields set on target.
  eq('8b. no _chillTouchNoHealing', target._chillTouchNoHealing, undefined);
  eq('8c. no _viciousMockeryDisadvNextAttack', target._viciousMockeryDisadvNextAttack, undefined);
  eq('8d. no _frostbiteDisadvNextWeaponAttack', target._frostbiteDisadvNextWeaponAttack, undefined);
}

// ============================================================
// 9. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 9. no CANTRIP_SELF_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Create Bonfire', state);
  eq('9a. resolveCantripAction returns false', ret, false);
  eq('9b. no log events', state.log.events.length, 0);
}

// ============================================================
// 10. no CANTRIP_AOE_EFFECTS entry (not caster-centered — target point in 60 ft)
// ============================================================
console.log('\n--- 10. no CANTRIP_AOE_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Create Bonfire', state);
  eq('10a. resolveCantripAoE returns false', ret, false);
  eq('10b. no log events', state.log.events.length, 0);
}

// ============================================================
// 11. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 11. dispatcher safety ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('11a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('11b. unknown cantrip → no state change', target._chillTouchNoHealing, undefined);
}

// ============================================================
// 12. Action built from metadata has correct save-spell shape
// ============================================================
console.log('\n--- 12. Action shape ---');
{
  eq('12a. attackType = save', CREATE_BONFIRE_ACTION.attackType, 'save');
  eq('12b. range.normal = 60', CREATE_BONFIRE_ACTION.range?.normal, 60);
  eq('12c. damageType = fire', CREATE_BONFIRE_ACTION.damageType, 'fire');
  eq('12d. damage.sides = 8', CREATE_BONFIRE_ACTION.damage?.sides, 8);
  eq('12e. damage.count = 1', CREATE_BONFIRE_ACTION.damage?.count, 1);
  eq('12f. slotLevel = 0 (cantrip)', CREATE_BONFIRE_ACTION.slotLevel, 0);
  eq('12g. saveDC = 30 (test default)', CREATE_BONFIRE_ACTION.saveDC, 30);
  eq('12h. saveAbility = dex', CREATE_BONFIRE_ACTION.saveAbility, 'dex');
  eq('12i. hitBonus = null (save-based)', CREATE_BONFIRE_ACTION.hitBonus, null);
  eq('12j. not AoE', CREATE_BONFIRE_ACTION.isAoE, false);
  eq('12k. not control', CREATE_BONFIRE_ACTION.isControl, false);
  eq('12l. requiresConcentration = true', CREATE_BONFIRE_ACTION.requiresConcentration, true);
  // bypassesCover is undefined (not set) — Create Bonfire respects cover normally
  eq('12m. bypassesCover undefined (respects cover)', CREATE_BONFIRE_ACTION.bypassesCover, undefined);
}

// ============================================================
// 13. resolveAttack integration — on-cast damage (trigger 1) applies
// ============================================================
console.log('\n--- 13. on-cast damage (trigger 1) ---');
{
  // v1: the on-cast trigger is the ONLY implemented trigger. The target in
  // the bonfire's space when the spell is cast makes a DEX save. v1 models
  // this as a single-target save cantrip via resolveAttack's save branch.
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [CREATE_BONFIRE_ACTION],
  });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away — within 60-ft range
    dex: 10,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, CREATE_BONFIRE_ACTION, state);

  // save_fail event should be present (DC=30 → guaranteed fail).
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('13a. save_fail event logged', saveFail !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  // Note: Create Bonfire's save_fail log comes from resolveAttack's save branch
  // (combat.ts), which uses lowercase `${action.saveAbility}` (i.e. 'dex').
  // This differs from cantrip modules like Sword Burst that emit their OWN
  // save logs with uppercase 'DEX'.
  assert('13b. save_fail mentions dex (lowercase, from resolveAttack)',
    saveFail?.description.toLowerCase().includes('dex') === true,
    `got: ${saveFail?.description}`);

  // Damage event should be present.
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('fire'),
  );
  assert('13c. damage event logged (fire)', damageEvent !== undefined);

  // Target should have taken damage.
  assert('13d. target took damage (HP < 100)', target.currentHP < 100);
}

// ============================================================
// 14. resolveAttack integration — save FAIL → full 1d8 fire (1..8)
// ============================================================
console.log('\n--- 14. save FAIL → full 1d8 fire (1..8) ---');
{
  // Run multiple iterations to verify the damage range holds.
  for (let i = 0; i < 20; i++) {
    const caster = makeCombatant('druid', {
      pos: { x: 0, y: 0, z: 0 },
      actions: [CREATE_BONFIRE_ACTION], // DC=30 → guaranteed FAIL
    });
    const target = makeCombatant('goblin', {
      pos: { x: 2, y: 0, z: 0 },
      dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);

    resolveAttack(caster, target, CREATE_BONFIRE_ACTION, state);

    const damageTaken = 100 - target.currentHP;
    assert(`14.${i}. damage in 1..8 range (full 1d8 fire)`,
      damageTaken >= 1 && damageTaken <= 8, `got ${damageTaken}`);
    if (damageTaken < 1 || damageTaken > 8) break;
  }
}

// ============================================================
// 15. resolveAttack integration — save SUCCESS → half (0..4)
// ============================================================
console.log('\n--- 15. save SUCCESS → half (0..4) ---');
{
  // DC=1 + dex=30 (+10) → guaranteed SUCCESS → half of 1d8 = 0..4 (floored).
  const caster = makeCombatant('druid', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [CREATE_BONFIRE_SUCCESS_ACTION], // DC=1, SUCCESS
  });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    dex: 30, // +10 mod → save 11+ vs DC 1 → always succeeds
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, CREATE_BONFIRE_SUCCESS_ACTION, state);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  assert('15a. save_success logged', saveSuccess !== undefined);

  // Run multiple iterations to verify the half-damage range holds.
  for (let i = 0; i < 20; i++) {
    const caster2 = makeCombatant('druid', {
      pos: { x: 0, y: 0, z: 0 },
      actions: [CREATE_BONFIRE_SUCCESS_ACTION],
    });
    const target2 = makeCombatant('goblin', {
      pos: { x: 2, y: 0, z: 0 },
      dex: 30, currentHP: 100, maxHP: 100, faction: 'enemy',
    });
    const bf2 = makeBF([caster2, target2]);
    const state2 = makeState(bf2);

    resolveAttack(caster2, target2, CREATE_BONFIRE_SUCCESS_ACTION, state2);

    const damageTaken = 100 - target2.currentHP;
    assert(`15b.${i}. SUCCESS damage in 0..4 range (half of 1d8, floored)`,
      damageTaken >= 0 && damageTaken <= 4, `got ${damageTaken}`);
    if (damageTaken < 0 || damageTaken > 4) break;
  }
}

// ============================================================
// 16. Action requiresConcentration = true (forward-compat for persistent triggers)
// ============================================================
console.log('\n--- 16. concentration flag ---');
{
  eq('16a. metadata.concentration = true', metadata.concentration, true);
  eq('16b. Action.requiresConcentration = true',
    CREATE_BONFIRE_ACTION.requiresConcentration, true);

  // Behavioral: the concentration flag is set on the Action so the engine's
  // concentration system tracks it. v1's on-cast damage doesn't NEED
  // concentration tracking (the damage is instant), but the flag is set for
  // forward-compatibility with the future persistent-hazard subsystem.
  // (Full concentration-tracking behavior is tested in concentration_ai.test.ts
  // and other engine tests — here we just verify the flag is on the Action.)
}

// ============================================================
// 17. Create Bonfire respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 17. Total Cover blocks Create Bonfire ---');
{
  // Wall between caster (0,0) and target (6,0): x=3, y=-1..9, 1 square wide → Total Cover.
  const wall: Obstacle = {
    id: 'wall', x: 1, y: -1, z: 0,
    width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away — within 60-ft range, BUT blocked by wall
    dex: 10, currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([caster, target], [wall]);
  const state = makeState(bf);

  resolveAttack(caster, target, CREATE_BONFIRE_ACTION, state);

  const blockedLog = state.log.events.find(
    (e: CombatEvent) => e.description.includes('Total Cover'),
  );
  assert('17a. Total Cover blocks Create Bonfire', blockedLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // No save, no damage.
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('17b. no save_fail event (spell blocked)', saveFail === undefined);
  eq('17c. target HP unchanged (spell blocked)', target.currentHP, 100);
}

// ============================================================
// 18. metadata does NOT include persistent-trigger fields (v1 simplification)
// ============================================================
console.log('\n--- 18. no persistent-trigger fields in v1 ---');
{
  // v1 implements ONLY trigger (1) (on-cast damage). The persistent-trigger
  // fields (move-into, end-turn) would require a new subsystem. Verify that
  // v1's metadata does NOT claim to implement them.
  eq('18a. bonfirePersistentV1Implemented = false',
    metadata.bonfirePersistentV1Implemented, false);

  // The metadata should still expose bonfireSizeFt for forward-compat.
  eq('18b. bonfireSizeFt = 5 (forward-compat for future persistent subsystem)',
    metadata.bonfireSizeFt, 5);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
