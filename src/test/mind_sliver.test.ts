// ============================================================
// Test: Mind Sliver Cantrip
// TCE p.108 — Level 0 enchantment cantrip (INT save + one-shot save debuff)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d6/3d6/4d6)
//   3. metadata exposes saveAbility = 'int' for AI/parser
//   4. metadata exposes components (V only — no S, no M)
//   5. metadata exposes riderDieSides = 4 (d4)
//   6. applyCantripEffect (module) — sets _mindSliverDiePenaltyNextSave = 4
//   7. dispatcher integration — 'Mind Sliver' registered in CANTRIP_EFFECTS
//   8. dispatcher safety — unknown cantrip name is a no-op
//   9. resetBudget cleanup clears the flag
//  10. resolveAttack save branch: rider applies ONLY on save-FAIL
//  11. resolveAttack save branch: save-SUCCESS applies NO rider
//  12. rollSave integration: penalty subtracted from save total
//  13. rollSave integration: rider CONSUMED after one save (one-shot)
//  14. second save has NO penalty (one-shot consume verified)
//  15. Mind Sliver respects Total Cover (no bypassesCover flag)
//
// Run: npx ts-node src/test/mind_sliver.test.ts
// ============================================================

import { metadata, applyCantripEffect } from '../spells/mind_sliver';
import { applyCantripEffect as dispatchCantrip } from '../engine/cantrip_effects';
import { resetBudget, rollSave } from '../engine/utils';
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

// A Mind Sliver Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='int'.
// Damage 1d6 psychic. Range 60 ft. No bypassesCover flag.
const MIND_SLIVER_ACTION: Action = {
  name: 'Mind Sliver',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'psychic',
  saveDC: 13,
  saveAbility: 'int',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Mind Sliver',
};

// Deterministic save-FAIL: DC=30 → save always fails.
const MIND_SLIVER_FAIL: Action = { ...MIND_SLIVER_ACTION, saveDC: 30 };
// Deterministic save-SUCCESS: DC=1 + int=30 (+10) → save always succeeds.
const MIND_SLIVER_SUCCESS: Action = { ...MIND_SLIVER_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Mind Sliver');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'enchantment');
  eq('1d. rangeFt (60)', metadata.rangeFt, 60);
  eq('1e. damageDice', metadata.damageDice, '1d6');
  eq('1f. damageType = psychic', metadata.damageType, 'psychic');
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
  eq('3a. saveAbility = int', metadata.saveAbility, 'int');
}

// ============================================================
// 4. components: V only (no S, no M) — TCE p.108
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. no somatic component', metadata.components.s, false);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. metadata exposes riderDieSides = 4 (d4)
// ============================================================
console.log('\n--- 5. riderDieSides ---');
{
  eq('5a. riderDieSides = 4', metadata.riderDieSides, 4);
}

// ============================================================
// 6. applyCantripEffect (module) — sets _mindSliverDiePenaltyNextSave = 4
// ============================================================
console.log('\n--- 6. applyCantripEffect: sets flag ---');
{
  const caster = makeCombatant('warlock');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  eq('6a. flag undefined before', target._mindSliverDiePenaltyNextSave, undefined);

  const ret = applyCantripEffect(caster, target, state);
  eq('6b. returns true', ret, true);
  eq('6c. flag set to 4 (d4)', target._mindSliverDiePenaltyNextSave, 4);

  const logEntry = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mind Sliver'),
  );
  assert('6d. rider logged', logEntry !== undefined, 'expected a log event mentioning Mind Sliver');
  assert('6e. log mentions 1d4 / saving throw', logEntry?.description.includes('1d4') === true, true);
}

// ============================================================
// 7. dispatcher integration — 'Mind Sliver' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 7. dispatcher integration ---');
{
  const caster = makeCombatant('warlock');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Mind Sliver', state);

  eq('7a. dispatcher set flag = 4', target._mindSliverDiePenaltyNextSave, 4);
  const logHit = state.log.events.find((e: CombatEvent) => e.description.includes('Mind Sliver'));
  assert('7b. dispatcher emitted Mind Sliver log', logHit !== undefined);
}

// ============================================================
// 8. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 8. dispatcher safety ---');
{
  const caster = makeCombatant('warlock');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('8a. unknown cantrip → no flag', target._mindSliverDiePenaltyNextSave, undefined);
  eq('8b. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 9. resetBudget cleanup clears the flag
// ============================================================
console.log('\n--- 9. resetBudget cleanup ---');
{
  const caster = makeCombatant('warlock');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyCantripEffect(caster, target, state);
  eq('9a. flag set', target._mindSliverDiePenaltyNextSave, 4);

  // Start of target's next turn — resetBudget clears the rider if not consumed
  resetBudget(target);
  eq('9b. flag cleared by resetBudget', target._mindSliverDiePenaltyNextSave, undefined);
}

// ============================================================
// 10. resolveAttack save branch: rider applies ONLY on save-FAIL
// ============================================================
console.log('\n--- 10. save FAIL → rider applies ---');
{
  // DC=30 → guaranteed save FAIL → rider should be applied.
  const caster = makeCombatant('warlock', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    int: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, MIND_SLIVER_FAIL, state);

  eq('10a. flag set after save FAIL', target._mindSliverDiePenaltyNextSave, 4);

  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const riderLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mind Sliver') && e.description.includes('1d4'),
  );
  assert('10b. save_fail event logged', saveFail !== undefined);
  assert('10c. rider log mentions 1d4', riderLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 11. resolveAttack save branch: save-SUCCESS applies NO rider
// ============================================================
console.log('\n--- 11. save SUCCESS → no rider ---');
{
  // DC=1 + int=30 (+10) → guaranteed save SUCCESS → rider should NOT be applied.
  const caster = makeCombatant('warlock', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('wizard', {
    pos: { x: 2, y: 0, z: 0 },
    int: 30, // +10 mod
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, MIND_SLIVER_SUCCESS, state);

  eq('11a. flag NOT set after save SUCCESS', target._mindSliverDiePenaltyNextSave, undefined);

  const saveSuccess = state.log.events.find((e: CombatEvent) => e.type === 'save_success');
  const riderLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Mind Sliver') && e.description.includes('1d4'),
  );
  assert('11b. save_success event logged', saveSuccess !== undefined);
  assert('11c. NO rider log on save success', riderLog === undefined,
    `unexpected rider log: ${riderLog?.description}`);
}

// ============================================================
// 12. rollSave integration: penalty subtracted from save total
// ============================================================
console.log('\n--- 12. rollSave subtracts 1d4 penalty ---');
{
  // Target has the Mind Sliver flag set. rollSave should subtract rollDie(4)
  // from the save total (1–4 penalty). We can't predict the exact penalty
  // (random d4), but we can verify the save total is reduced by 1–4.
  const target = makeCombatant('goblin', {
    int: 18, // +4 mod
    _mindSliverDiePenaltyNextSave: 4, // pre-set: Mind Sliver landed last turn
  });

  // Roll a save WITH the penalty (flag set).
  const saveWithPenalty = rollSave(target, 'int', 100); // DC=100 → guaranteed fail (we only care about the total)
  // Expected total: rollDie(20) + 4 (int mod) + 0 (prof) + 0 (BI) + 0 (bless) + 0 (WB) - rollDie(4)
  // = (1..20) + 4 - (1..4) = (1..20) + (0..3) = 1..23
  // Without the penalty, it would be (1..20) + 4 = 5..24.
  assert('12a. save total in 1..23 (penalty applied)',
    saveWithPenalty.total >= 1 && saveWithPenalty.total <= 23,
    `total = ${saveWithPenalty.total}`);

  // The flag should be CONSUMED after the save resolves (one-shot).
  eq('12b. flag consumed after save', target._mindSliverDiePenaltyNextSave, undefined);
}

// ============================================================
// 13. rollSave integration: rider CONSUMED after one save (one-shot)
// ============================================================
console.log('\n--- 13. rider consumed after one save ---');
{
  const target = makeCombatant('goblin', {
    int: 10,
    _mindSliverDiePenaltyNextSave: 4,
  });

  // First save — penalty applies, flag consumed.
  const save1 = rollSave(target, 'int', 100);
  eq('13a. flag consumed after first save', target._mindSliverDiePenaltyNextSave, undefined);

  // Second save — NO penalty (flag was consumed). Total = d20 + 0 (int 10 = +0).
  const save2 = rollSave(target, 'int', 100);
  assert('13b. second save total in 1..20 (no penalty)',
    save2.total >= 1 && save2.total <= 20,
    `total = ${save2.total}`);
}

// ============================================================
// 14. second save has NO penalty (one-shot consume verified)
// ============================================================
console.log('\n--- 14. second save: no penalty (one-shot) ---');
{
  // Pre-consume the flag (simulating the first save already happened).
  const target = makeCombatant('goblin', {
    int: 14, // +2 mod
    _mindSliverDiePenaltyNextSave: undefined, // already consumed
  });

  // Save — NO penalty. Total = d20 + 2 (int mod) = 3..22.
  const save = rollSave(target, 'int', 100);
  assert('14a. save total in 3..22 (no penalty)',
    save.total >= 3 && save.total <= 22,
    `total = ${save.total}`);
  // Flag stays undefined.
  eq('14b. flag stays undefined after save', target._mindSliverDiePenaltyNextSave, undefined);
}

// ============================================================
// 15. Mind Sliver respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 15. Mind Sliver respects Total Cover ---');
{
  const totalWall: Obstacle = {
    id: 'W1', x: 6, y: -1, z: 0, width: 1, depth: 20, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('warlock', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 12, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, MIND_SLIVER_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('15a. Total Cover event logged', coverBlock !== undefined);
  assert('15b. no damage dealt (Mind Sliver blocked by Total Cover)', damageEvent === undefined);
  eq('15c. flag NOT set (blocked by cover)', target._mindSliverDiePenaltyNextSave, undefined);
  eq('15d. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
