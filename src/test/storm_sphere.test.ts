// ============================================================
// storm_sphere.test.ts — Storm Sphere bespoke spell module (Session 24)
// XGE p.166: 4th-level evocation, action, range 150 ft. Canon: concentration
// up to 1 min + bonus-action lightning + difficult terrain. v1:
// concentration + riders simplified to one-shot.
// Effect: AoE CON save. On fail: 6d6 thunder. On success: half. 20-ft-radius
// sphere centered on the highest-threat enemy within 150 ft.
// (v1 simplifications: canon 20-ft radius [plan's 40-ft is wrong];
// bonus-action lightning bolt NOT modelled; difficult terrain NOT modelled;
// upcast NOT modelled.)
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors gravity_sinkhole.test.ts / erupting_earth.test.ts structure (AoE
// radius save) but with Storm Sphere's stats (L4, CON save, 6d6 thunder,
// 150-ft range, 20-ft radius). Uses withSlots4.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - center at (5,0,0) = 25 ft from caster (within 150-ft range)
//   - e_in  at (9,0,0) = 20 ft from center (boundary → in radius)
//   - e_out at (10,0,0) = 25 ft from center (out of radius)
//   - oor   at (31,0,0) = 155 ft from caster (> 150 ft range)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/storm_sphere';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots4(remaining = 2): PlayerResources {
  return { spellSlots: { 4: { max: 2, remaining } } };
}

const STSP_ACTION: Action = {
  name: 'Storm Sphere',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Storm Sphere (CON save, 6d6 thunder, 150-ft range, 20-ft radius AoE)',
};

const STSP_ACTION_LOW_DC: Action = {
  ...STSP_ACTION,
  saveDC: 5,            // guaranteed-success DC (CON 30 → min 11 ≥ 5)
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>,
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

function makeBF(combatants: Combatant[]) {
  return {
    width: 60, height: 60, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Sorcerer at pos (0,0,0) with Storm Sphere + 2 4th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = STSP_ACTION): Combatant {
  return makeCombatant('sorc', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots4(2),
  });
}

/** Enemy with CON 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with CON 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Storm Sphere', metadata.name, 'Storm Sphere');
eq('Level is 4', metadata.level, 4);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 150 ft', metadata.rangeFt, 150);
eq('AoE radius is 20 ft (canon; plan\'s 40-ft is wrong)', metadata.aoeRadiusFt, 20);
eq('Die count is 6', metadata.dieCount, 6);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is thunder', metadata.damageType, 'thunder');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Storm Sphere action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots4(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Storm Sphere action', shouldCast(caster, bf), null);
}
// 2b. No 4th-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [STSP_ACTION], resources: withSlots4(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 4th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 150 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 31 squares away = 155 ft > 150 ft range
  const enemy = makeWeakEnemy('e1', { x: 31, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 150 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast AoE targeting (center + 20-ft radius) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 150 ft is chosen as the center;
//     nearby lower-HP enemies within 20 ft of the center are also caught.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });  // 25 ft from caster
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    // Center is highT (maxHP 300); lowT is 4 squares (20 ft) from highT → in radius
    const ids = (result as Combatant[]).map(c => c.id);
    assert('highT (center) in targets', ids.includes('highT'));
    assert('lowT (within 20 ft of highT) in targets', ids.includes('lowT'));
    eq('Exactly 2 targets caught', (result as Combatant[]).length, 2);
  }
}
// 3b. Enemies within 20 ft of the center are caught; out-of-radius excluded
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center: e_center (maxHP 1000) at (5,0,0) — 25 ft from caster
  const e_center = makeWeakEnemy('e_center', { x: 5, y: 0, z: 0 }, { maxHP: 1000 });
  // e_in: 4 squares from center → 20 ft (boundary) → IN radius
  const e_in = makeWeakEnemy('e_in', { x: 9, y: 0, z: 0 }, { maxHP: 50 });
  // e_out: 5 squares from center → 25 ft → OUT of radius
  const e_out = makeWeakEnemy('e_out', { x: 10, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e_center, e_in, e_out]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e_center (center) in targets', ids.includes('e_center'));
    assert('e_in (20 ft boundary from center) in targets', ids.includes('e_in'));
    assert('e_out (25 ft from center) NOT in targets', !ids.includes('e_out'));
    eq('Exactly 2 targets caught (e_center + e_in)', (result as Combatant[]).length, 2);
  }
}
// 3c. Out-of-range enemy (beyond 150 ft from caster) cannot be center
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 31 squares = 155 ft > 150 ft range
  const oor1 = makeWeakEnemy('oor1', { x: 31, y: 0, z: 0 }, { maxHP: 1000 });
  const oor2 = makeWeakEnemy('oor2', { x: 31, y: 1, z: 0 }, { maxHP: 500 });
  const bf = makeBF([caster, oor1, oor2]);
  eq('Returns null when all enemies beyond 150 ft', shouldCast(caster, bf), null);
}

// ---- 4. execute — guaranteed fail (full 6d6 damage) -------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns targets', targets !== null);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    eq('Slot consumed (4th level: 2 → 1)',
      (caster.resources as any).spellSlots[4].remaining, 1);
    // 6d6 range 6-36
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 6d6 range (6-36): got ${dmgDealt}`,
      dmgDealt >= 6 && dmgDealt <= 36);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // No condition rider for Storm Sphere
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) --------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, STSP_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 6d6 (floor), range 3-18
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 3-18 range: got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 18);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target AoE (multiple saves) ------------

console.log('\n=== 6. execute — multi-target AoE ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Three enemies clustered around center e1 (maxHP 1000 at 5 ft):
  //   e2 at (2,0,0) = 5 ft from e1; e3 at (3,0,0) = 10 ft from e1.
  // All within 20-ft radius of e1 → all caught.
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (all clustered within 20 ft of center e1)',
    targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 took damage (all CON 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 500 - e2.currentHP;
    const e3Lost = 250 - e3.currentHP;
    assert('e1 took damage in 6d6 range (6-36)', e1Lost >= 6 && e1Lost <= 36, `got ${e1Lost}`);
    assert('e2 took damage in 6d6 range (6-36)', e2Lost >= 6 && e2Lost <= 36, `got ${e2Lost}`);
    assert('e3 took damage in 6d6 range (6-36)', e3Lost >= 6 && e3Lost <= 36, `got ${e3Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/storm_sphere') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 6d6 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 6 (got ${min})`, min >= 6);
  assert(`rollDamage max <= 36 (got ${max})`, max <= 36);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
