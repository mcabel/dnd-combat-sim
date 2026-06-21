// ============================================================
// Test: Thunderclap Cantrip
// XGE p.168 — Level 0 evocation cantrip (caster-centered 5-ft AoE, CON save)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d6/3d6/4d6)
//   3. metadata exposes saveAbility = 'con' for AI/parser
//   4. metadata exposes components (S only — no V, no M)
//   5. metadata exposes isCasterCenteredAoE = true
//   6. no CANTRIP_EFFECTS entry (no post-hit rider)
//   7. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   8. resolveCantripAoE registered — 'Thunderclap' routes to execute handler
//   9. resolveCantripAoE safety — unknown cantrip name returns false
//  10. dispatcher (applyCantripEffect) safety — unknown cantrip name is a no-op
//  11. execute integration — multiple enemies within 5 ft each roll a save
//  12. execute integration — caster is NOT hit
//  13. execute integration — enemies beyond 5 ft are NOT hit
//  14. execute integration — 0 creatures in range still consumes the action
//  15. execute integration — save SUCCESS → half damage; save FAIL → full damage
//  16. execute integration — Thunderclap Action on caster.actions drives saveDC
//
// Run: npx ts-node src/test/thunderclap.test.ts
// ============================================================

import { metadata, execute, THUNDERCLAP_RADIUS_FT } from '../spells/thunderclap';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
} from '../engine/cantrip_effects';
import { CombatEvent } from '../engine/combat';
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

// A Thunderclap Action as the AI/parser would build it from metadata.
// Save-based: attackType='save', saveDC = caster's spell save DC, saveAbility='con'.
// Damage 1d6 thunder. Caster-centered 5-ft AoE (isAoE = true, range = 5 ft).
// NOTE: this action lives on the CASTER's actions[] list — the execute handler
// reads saveDC + damage from it.
const THUNDERCLAP_ACTION: Action = {
  name: 'Thunderclap',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: THUNDERCLAP_RADIUS_FT, long: THUNDERCLAP_RADIUS_FT },
  hitBonus: null,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'thunder',
  saveDC: 30, // DC=30 → guaranteed save FAIL for all targets (deterministic test)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Thunderclap',
};

// Save-SUCCESS variant: DC=1 + con=30 (+10) → guaranteed save SUCCESS.
const THUNDERCLAP_SUCCESS_ACTION: Action = { ...THUNDERCLAP_ACTION, saveDC: 1 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Thunderclap');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (5 — caster-centered AoE)', metadata.rangeFt, 5);
  eq('1e. damageDice', metadata.damageDice, '1d6');
  eq('1f. damageType = thunder', metadata.damageType, 'thunder');
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
  eq('3a. saveAbility = con', metadata.saveAbility, 'con');
}

// ============================================================
// 4. components: S only (no V, no M) — XGE p.168
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. no verbal component', metadata.components.v, false);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. metadata exposes isCasterCenteredAoE = true
// ============================================================
console.log('\n--- 5. isCasterCenteredAoE ---');
{
  eq('5a. isCasterCenteredAoE = true', metadata.isCasterCenteredAoE, true);
}

// ============================================================
// 6. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 6. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Thunderclap', state);
  // No scratch fields set on target (no rider), no log events from the dispatcher.
  eq('6a. no flag set on target', target._viciousMockeryDisadvNextAttack, undefined);
  eq('6b. no log events from dispatcher', state.log.events.length, 0);
}

// ============================================================
// 7. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 7. not a self-buff ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('7a. resolveCantripAction returns false', resolveCantripAction(caster, 'Thunderclap', state), false);
  eq('7b. no log events', state.log.events.length, 0);
}

// ============================================================
// 8. resolveCantripAoE registered — 'Thunderclap' routes to execute handler
// ============================================================
console.log('\n--- 8. resolveCantripAoE integration ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [THUNDERCLAP_ACTION],
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 }, // 5 ft away (1 square) — within range
    con: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Thunderclap', state);
  eq('8a. resolveCantripAoE returns true', ret, true);
  // The execute handler should have logged the cast + a save_fail + damage.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Thunderclap'),
  );
  const saveFail = state.log.events.find((e: CombatEvent) => e.type === 'save_fail');
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('8b. cast logged', castLog !== undefined);
  assert('8c. save_fail logged', saveFail !== undefined);
  assert('8d. damage logged', damageEvent !== undefined);
  assert('8e. damage mentions thunder', damageEvent?.description.includes('thunder') === true,
    `got: ${damageEvent?.description}`);
}

// ============================================================
// 9. resolveCantripAoE safety — unknown cantrip name returns false
// ============================================================
console.log('\n--- 9. resolveCantripAoE safety ---');
{
  const caster = makeCombatant('wiz', { pos: { x: 5, y: 5, z: 0 } });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('9a. unknown cantrip → false', resolveCantripAoE(caster, 'Definitely Not A Cantrip', state), false);
  eq('9b. no log events', state.log.events.length, 0);
}

// ============================================================
// 10. dispatcher (applyCantripEffect) safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 10. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('10a. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 11. execute integration — multiple enemies within 5 ft each roll a save
// ============================================================
console.log('\n--- 11. multiple enemies in range ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [THUNDERCLAP_ACTION],
  });
  // Three enemies all within 5 ft (euclidean) of the caster.
  const e1 = makeCombatant('e1', {
    pos: { x: 6, y: 5, z: 0 }, // 5 ft east
    con: 10, currentHP: 100, maxHP: 100,
  });
  const e2 = makeCombatant('e2', {
    pos: { x: 5, y: 6, z: 0 }, // 5 ft north
    con: 10, currentHP: 100, maxHP: 100,
  });
  const e3 = makeCombatant('e3', {
    pos: { x: 6, y: 6, z: 0 }, // ~7 ft diagonal — just within 5 ft? sqrt(2)*5 ≈ 7.07 ft, OUT of range
    con: 10, currentHP: 100, maxHP: 100,
  });
  // e3 is at diagonal distance sqrt(2)*5 ≈ 7.07 ft — OUTSIDE 5 ft radius.
  // Add a properly-in-range 3rd enemy at (5,5) same square? No — that's the caster.
  // Use (4,5) instead: 5 ft west.
  const e3b = makeCombatant('e3b', {
    pos: { x: 4, y: 5, z: 0 }, // 5 ft west
    con: 10, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, e1, e2, e3, e3b]);
  const state = makeState(bf);

  execute(caster, state);

  // Cast log mentions the in-range count (3 — e1, e2, e3b; e3 is out of range).
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Thunderclap'),
  );
  assert('11a. cast logged', castLog !== undefined);
  assert('11b. cast log says 3 creatures in range', castLog?.description.includes('3 creatures') === true,
    `got: ${castLog?.description}`);

  // Three save_fail events (one per in-range enemy).
  const saveFails = state.log.events.filter((e: CombatEvent) => e.type === 'save_fail');
  eq('11c. 3 save_fail events', saveFails.length, 3);

  // Three damage events.
  const damageEvents = state.log.events.filter((e: CombatEvent) => e.type === 'damage');
  eq('11d. 3 damage events', damageEvents.length, 3);

  // All three in-range enemies took damage.
  assert('11e. e1 HP reduced', e1.currentHP < 100);
  assert('11f. e2 HP reduced', e2.currentHP < 100);
  assert('11g. e3b HP reduced', e3b.currentHP < 100);
}

// ============================================================
// 12. execute integration — caster is NOT hit
// ============================================================
console.log('\n--- 12. caster not hit ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [THUNDERCLAP_ACTION],
    currentHP: 100, maxHP: 100,
  });
  const enemy = makeCombatant('goblin', {
    pos: { x: 6, y: 5, z: 0 },
    con: 10, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  // Caster HP unchanged — caster is excluded from the in-range target list.
  eq('12a. caster HP unchanged', caster.currentHP, 100);
  // No damage event targets the caster.
  const casterDamaged = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage' && e.targetId === caster.id,
  );
  assert('12b. no damage event on caster', casterDamaged === undefined,
    `unexpected: ${casterDamaged?.description}`);
}

// ============================================================
// 13. execute integration — enemies beyond 5 ft are NOT hit
// ============================================================
console.log('\n--- 13. enemies beyond 5 ft NOT hit ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [THUNDERCLAP_ACTION],
  });
  const inRange = makeCombatant('inRange', {
    pos: { x: 6, y: 5, z: 0 }, // 5 ft — in range
    con: 10, currentHP: 100, maxHP: 100,
  });
  const outOfRange = makeCombatant('outOfRange', {
    pos: { x: 7, y: 5, z: 0 }, // 10 ft — OUT of range
    con: 10, currentHP: 100, maxHP: 100,
  });
  const diagonal = makeCombatant('diagonal', {
    pos: { x: 6, y: 6, z: 0 }, // ~7.07 ft (sqrt(2)*5) — OUT of range (PHB circle, not Chebyshev)
    con: 10, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, inRange, outOfRange, diagonal]);
  const state = makeState(bf);

  execute(caster, state);

  // Only inRange took damage; outOfRange and diagonal did NOT.
  assert('13a. in-range enemy HP reduced', inRange.currentHP < 100);
  eq('13b. out-of-range enemy HP unchanged', outOfRange.currentHP, 100);
  eq('13c. diagonal enemy HP unchanged (PHB circle, not Chebyshev)', diagonal.currentHP, 100);
}

// ============================================================
// 14. execute integration — 0 creatures in range still consumes the action
// ============================================================
console.log('\n--- 14. 0 creatures in range ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [THUNDERCLAP_ACTION],
  });
  const farEnemy = makeCombatant('far', {
    pos: { x: 15, y: 15, z: 0 }, // 50+ ft away — out of range
    con: 10, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, farEnemy]);
  const state = makeState(bf);

  execute(caster, state);

  // Cast log mentions 0 creatures in range.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Thunderclap'),
  );
  assert('14a. cast logged even with 0 targets', castLog !== undefined);
  assert('14b. cast log says 0 creatures', castLog?.description.includes('0 creatures') === true,
    `got: ${castLog?.description}`);
  // No save events, no damage events.
  const saveEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'save_fail' || e.type === 'save_success');
  eq('14c. 0 save events', saveEvents.length, 0);
  const damageEvents = state.log.events.filter((e: CombatEvent) => e.type === 'damage');
  eq('14d. 0 damage events', damageEvents.length, 0);
  // Far enemy HP unchanged.
  eq('14e. far enemy HP unchanged', farEnemy.currentHP, 100);
}

// ============================================================
// 15. execute integration — save SUCCESS → half damage; save FAIL → full damage
// ============================================================
console.log('\n--- 15. save SUCCESS → half; save FAIL → full ---');
{
  const casterFail = makeCombatant('wizFail', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [THUNDERCLAP_ACTION], // DC=30 → guaranteed FAIL
  });
  const targetFail = makeCombatant('tFail', {
    pos: { x: 6, y: 5, z: 0 },
    con: 10, currentHP: 100, maxHP: 100,
  });
  const bfFail = makeBF([casterFail, targetFail]);
  const stateFail = makeState(bfFail);
  execute(casterFail, stateFail);
  // 1d6 = 1–6 (full damage on fail)
  const dmgFail = 100 - targetFail.currentHP;
  assert('15a. save FAIL → damage in 1..6', dmgFail >= 1 && dmgFail <= 6, `dmgFail = ${dmgFail}`);

  const casterSuccess = makeCombatant('wizSuccess', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [THUNDERCLAP_SUCCESS_ACTION], // DC=1 + con=30 → guaranteed SUCCESS
  });
  const targetSuccess = makeCombatant('tSuccess', {
    pos: { x: 6, y: 5, z: 0 },
    con: 30, // +10 mod → save = d20+10 ≥ 1 always
    currentHP: 100, maxHP: 100,
  });
  const bfSuccess = makeBF([casterSuccess, targetSuccess]);
  const stateSuccess = makeState(bfSuccess);
  execute(casterSuccess, stateSuccess);
  // 1d6 = 1–6, half = floor(1–6 / 2) = 0–3
  const dmgSuccess = 100 - targetSuccess.currentHP;
  assert('15b. save SUCCESS → damage in 0..3 (half)', dmgSuccess >= 0 && dmgSuccess <= 3,
    `dmgSuccess = ${dmgSuccess}`);

  const saveSuccessEvent = stateSuccess.log.events.find((e: CombatEvent) => e.type === 'save_success');
  assert('15c. save_success logged on SUCCESS path', saveSuccessEvent !== undefined);
}

// ============================================================
// 16. execute integration — Thunderclap Action on caster.actions drives saveDC
// ============================================================
console.log('\n--- 16. saveDC read from caster.actions ---');
{
  const customAction: Action = { ...THUNDERCLAP_ACTION, saveDC: 25 };
  const caster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    actions: [customAction],
  });
  const target = makeCombatant('t', {
    pos: { x: 6, y: 5, z: 0 },
    con: 10, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  execute(caster, state);

  // DC=25 should appear in the cast log.
  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('DC 25'),
  );
  assert('16a. cast log mentions DC 25 from Action', castLog !== undefined,
    `got: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
