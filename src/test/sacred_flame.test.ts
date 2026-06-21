// ============================================================
// Test: Sacred Flame Cantrip
// PHB p.272 — Level 0 evocation cantrip (DEX save + bypasses cover)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d8/3d8/4d8)
//   3. metadata exposes saveAbility = 'dex' for AI/parser
//   4. metadata exposes bypassesCover = true (PHB special rule)
//   5. no CANTRIP_EFFECTS entry (no post-hit rider)
//   6. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   7. dispatcher safety — unknown cantrip name is a no-op
//   8. Action built from metadata has correct save shape + bypassesCover
//   9. resolveAttack integration — save FAIL deals full radiant damage
//  10. resolveAttack integration — save SUCCESS deals half radiant damage
//  11. bypassesCover=true: Sacred Flame IGNORES Total Cover (PHB p.272)
//  12. bypassesCover=true: cover AC bonus NOT applied to the save
//  13. cover-bypass is opt-in: a save spell WITHOUT bypassesCover is blocked
//
// Run: npx ts-node src/test/sacred_flame.test.ts
// ============================================================

import { metadata } from '../spells/sacred_flame';
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

// A Sacred Flame Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='dex'.
// Damage 1d8 radiant. Range 60 ft. bypassesCover = true (PHB p.272 special rule).
const SACRED_FLAME_ACTION: Action = {
  name: 'Sacred Flame',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'radiant',
  saveDC: 13,
  saveAbility: 'dex',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Sacred Flame',
  bypassesCover: true, // PHB p.272: "The target gains no benefit from cover for this saving throw."
};

// Deterministic save-FAIL variant: DC=30 → save always fails.
const SACRED_FLAME_FAIL: Action = { ...SACRED_FLAME_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS variant: DC=1 + dex=30 (+10) → save always succeeds.
const SACRED_FLAME_SUCCESS: Action = { ...SACRED_FLAME_ACTION, saveDC: 1 };

// A control save spell WITHOUT bypassesCover (for the opt-in test).
const NON_BYPASS_SAVE_ACTION: Action = {
  name: 'Acid Splash', // reuse a non-bypass save spell name
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
  // bypassesCover undefined — default behavior (subject to Total Cover blocking)
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Sacred Flame');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (60)', metadata.rangeFt, 60);
  eq('1e. damageDice', metadata.damageDice, '1d8');
  eq('1f. damageType', metadata.damageType, 'radiant');
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
  eq('3a. saveAbility = dex', metadata.saveAbility, 'dex');
}

// ============================================================
// 4. bypassesCover flag exposed for AI/parser
// ============================================================
console.log('\n--- 4. bypassesCover flag ---');
{
  eq('4a. metadata.bypassesCover = true', metadata.bypassesCover, true);
  // The AI/parser MUST copy this flag onto the Action it builds:
  //   action.bypassesCover = metadata.bypassesCover
  // resolveAttack's save branch checks action.bypassesCover and skips the
  // LOS / total-cover gating when set — Sacred Flame can target a creature
  // even behind total cover (PHB p.272).
}

// ============================================================
// 5. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 5. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Sacred Flame', state);
  eq('5a. dispatcher no-op (no log events added)', state.log.events.length, eventsBefore);
  eq('5b. no scratch flags set', target._viciousMockeryDisadvNextAttack, undefined);
}

// ============================================================
// 6. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 6. no CANTRIP_SELF_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Sacred Flame', state);
  eq('6a. resolveCantripAction returns false', ret, false);
  eq('6b. no log events', state.log.events.length, 0);
}

// ============================================================
// 7. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 7. dispatcher safety ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('7a. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 8. Action built from metadata has correct save shape + bypassesCover
// ============================================================
console.log('\n--- 8. Action shape ---');
{
  eq('8a. attackType = save', SACRED_FLAME_ACTION.attackType, 'save');
  eq('8b. range.normal = 60', SACRED_FLAME_ACTION.range?.normal, 60);
  eq('8c. damageType = radiant', SACRED_FLAME_ACTION.damageType, 'radiant');
  eq('8d. damage.sides = 8', SACRED_FLAME_ACTION.damage?.sides, 8);
  eq('8e. saveDC = 13', SACRED_FLAME_ACTION.saveDC, 13);
  eq('8f. saveAbility = dex', SACRED_FLAME_ACTION.saveAbility, 'dex');
  eq('8g. hitBonus null (save-based)', SACRED_FLAME_ACTION.hitBonus, null);
  eq('8h. slotLevel = 0 (cantrip)', SACRED_FLAME_ACTION.slotLevel, 0);
  eq('8i. not AoE (single target)', SACRED_FLAME_ACTION.isAoE, false);
  eq('8j. bypassesCover = true (PHB p.272 special rule)', SACRED_FLAME_ACTION.bypassesCover, true);
}

// ============================================================
// 9. resolveAttack integration — save FAIL deals full radiant damage
// ============================================================
console.log('\n--- 9. save FAIL: full radiant damage ---');
{
  // Caster at (0,0), target at (2,0) — 10 ft apart, no cover.
  // DC=30 forces save FAIL regardless of the d20.
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    dex: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, SACRED_FLAME_FAIL, state);

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('radiant'),
  );

  assert('9a. save_fail event logged', saveFail !== undefined);
  assert('9b. radiant damage event logged', damageEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('9c. save fail → full damage (not halved)',
    damageEvent?.description.includes('full') === true,
    `damage desc: ${damageEvent?.description}`);
  assert('9d. target took damage', target.currentHP < 100, true);
}

// ============================================================
// 10. resolveAttack integration — save SUCCESS deals half radiant damage
// ============================================================
console.log('\n--- 10. save SUCCESS: half radiant damage ---');
{
  // DC=1 + dex=30 (+10) → save = d20+10 = min 11 >= 1 → guaranteed success.
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('rogue', {
    pos: { x: 2, y: 0, z: 0 },
    dex: 30, // +10 mod
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, SACRED_FLAME_SUCCESS, state);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('radiant'),
  );

  assert('10a. save_success event logged', saveSuccess !== undefined);
  assert('10b. radiant damage event logged', damageEvent !== undefined);
  assert('10c. save success → half damage (halved)',
    damageEvent?.description.includes('halved') === true,
    `damage desc: ${damageEvent?.description}`);
}

// ============================================================
// 11. bypassesCover=true: Sacred Flame IGNORES Total Cover (PHB p.272)
// ============================================================
console.log('\n--- 11. Sacred Flame bypasses Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8] → Total Cover.
  // Sacred Flame has bypassesCover=true → spell resolves normally despite cover.
  const totalWall: Obstacle = {
    id: 'W1', x: 3, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    dex: 1, // -5 mod → save FAILs against DC 30 (deterministic)
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  // Use the deterministic FAIL variant — guarantees damage is dealt
  resolveAttack(caster, target, SACRED_FLAME_FAIL, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const saveEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'save_fail' || e.type === 'save_success',
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.description.includes('radiant'),
  );

  assert('11a. NO Total Cover event (Sacred Flame bypasses)', coverBlock === undefined,
    `unexpected cover block: ${coverBlock?.description}`);
  assert('11b. save event logged (spell resolved despite cover)', saveEvent !== undefined);
  assert('11c. radiant damage event logged', damageEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('11d. target took damage (Total Cover bypassed)', target.currentHP < 100, true);
}

// ============================================================
// 12. bypassesCover=true: cover AC bonus NOT applied to the save
// ============================================================
console.log('\n--- 12. cover bonus NOT applied to save ---');
{
  // PHB p.272: "The target gains no benefit from cover for this saving throw."
  // The save branch doesn't apply cover AC bonus (cover only affects attack
  // rolls vs AC, not save DCs). But the bypassesCover flag means even Total
  // Cover doesn't block the spell. This test verifies that with half cover
  // (which would give +2 AC vs attacks), the save DC is unchanged and the
  // spell resolves normally.
  const halfWall: Obstacle = {
    id: 'HW1', x: 3, y: 0, z: 0, width: 1, depth: 1, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('cleric', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    dex: 1, // -5 mod → save FAILs against DC 30 (deterministic)
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [halfWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, SACRED_FLAME_FAIL, state);

  // The spell should resolve — no "Total Cover" block, save event present,
  // damage dealt. The half cover obstacle doesn't block Sacred Flame.
  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const saveEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'save_fail' || e.type === 'save_success',
  );
  assert('12a. NO Total Cover event', coverBlock === undefined);
  assert('12b. save event logged', saveEvent !== undefined);
  assert('12c. target took damage (cover didn\'t reduce save)', target.currentHP < 100, true);

  // The save_fail log shows the DC was the spell's saveDC (30), not reduced.
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  assert('12d. save DC in log is 30 (not reduced by cover)',
    saveFail?.description.includes('DC 30') === true,
    `save desc: ${saveFail?.description}`);
}

// ============================================================
// 13. cover-bypass is opt-in: a save spell WITHOUT bypassesCover is blocked
// ============================================================
console.log('\n--- 13. opt-in: non-bypass save spell IS blocked by Total Cover ---');
{
  // Control test: a save spell WITHOUT bypassesCover ( Acid Splash ) IS
  // blocked by Total Cover. This proves the bypass is opt-in via the flag,
  // not a blanket behavior for all save spells.
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

  resolveAttack(caster, target, NON_BYPASS_SAVE_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('13a. Total Cover event logged (non-bypass spell blocked)', coverBlock !== undefined);
  assert('13b. no damage dealt (non-bypass spell blocked)', damageEvent === undefined);
  eq('13c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
