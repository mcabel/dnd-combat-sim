// ============================================================
// blight.test.ts — Blight bespoke spell module (Session 23)
// PHB p.219: 4th-level necromancy, action, range 30 ft, NO concentration.
// Effect: CON save. On fail: 8d8 necrotic. On success: half.
//         Single-target.
//
// Migrated from the Session 19 generic dispatch registry in Session 23.
// Mirrors catapult.test.ts but with Blight's stats (L4, 8d8 necrotic,
// 30-ft range, CON save).
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/blight';
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

const BLIGHT_ACTION: Action = {
  name: 'Blight',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: 'necrotic',
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: false,         // v1: single-target (despite SPELL_DB isAoE flag)
  isControl: false,
  requiresConcentration: false,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Blight (CON save, 8d8 necrotic, single-target)',
};

const BLIGHT_ACTION_LOW_DC: Action = {
  ...BLIGHT_ACTION,
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

/** Wizard at pos (0,0,0) with Blight + 2 4th-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = BLIGHT_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
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

eq('Name is Blight', metadata.name, 'Blight');
eq('Level is 4', metadata.level, 4);
eq('School is necromancy', metadata.school, 'necromancy');
eq('Range is 30 ft', metadata.rangeFt, 30);
eq('Die count is 8', metadata.dieCount, 8);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is necrotic', metadata.damageType, 'necrotic');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Blight action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots4(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Blight action', shouldCast(caster, bf), null);
}
// 2b. No 4th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [BLIGHT_ACTION], resources: withSlots4(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 4th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft away > 30 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → enemy
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when single enemy in range', result !== null);
  if (result) eq('Target is the enemy', result.id, 'e1');
}

// ---- 3. shouldCast target selection (single-target) -----------

console.log('\n=== 3. shouldCast target selection (single-target) ===\n');

// 3a. Highest-threat enemy is the target (single-target, NOT AoE)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 2, y: 0, z: 0 }, { maxHP: 300, currentHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    eq('Picks highest-threat enemy (maxHP 300)', result.id, 'highT');
  }
}
// 3b. Returns a single Combatant (not array)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 });
  const bf = makeBF([caster, e1, e2, e3]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant even with 3 enemies in range',
    result !== null && !Array.isArray(result));
  if (result) {
    eq('Returns one specific Combatant (not array of 3)',
      typeof (result as Combatant).id, 'string');
  }
}
// 3c. Range gating — 30 ft limit (chebyshev 6 = 30 ft, 7 = 35 ft out of range)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const inRange = makeWeakEnemy('inRange', { x: 6, y: 0, z: 0 });   // 30 ft — in range
  const outOfRange = makeWeakEnemy('outOfRange', { x: 7, y: 0, z: 0 }); // 35 ft — out
  const bf = makeBF([caster, inRange, outOfRange]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null (1 enemy in range)', result !== null);
  if (result) {
    eq('Picks the in-range enemy (30 ft)', result.id, 'inRange');
  }
}

// ---- 4. execute — guaranteed fail (full damage) ----------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (4th level: 2 → 1)',
      (caster.resources as any).spellSlots[4].remaining, 1);
    // 4b. Damage applied (8d8 range 8-64)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 8d8 range (8-64): got ${dmgDealt}`,
      dmgDealt >= 8 && dmgDealt <= 64);
    // 4c. Log events
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, BLIGHT_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Damage applied (half of 8d8, range 4-32)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-32 range: got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 32);
    // 5b. Save-success log
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — single-target (no multi-target spillover) --------

console.log('\n=== 6. execute — single-target (no spillover) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // 3 enemies in range; shouldCast picks ONE (highest threat)
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBeforeE1 = e1.currentHP;
    const hpBeforeE2 = e2.currentHP;
    const hpBeforeE3 = e3.currentHP;

    execute(caster, target as Combatant, state);

    // Only ONE enemy takes damage — Blight is single-target
    const dmg1 = hpBeforeE1 - e1.currentHP;
    const dmg2 = hpBeforeE2 - e2.currentHP;
    const dmg3 = hpBeforeE3 - e3.currentHP;
    const damagedCount = [dmg1, dmg2, dmg3].filter(d => d > 0).length;
    eq('Exactly 1 enemy took damage (single-target spell)', damagedCount, 1);
  }
}

// ---- 7. rollDamage range --------------------------------------

console.log('\n=== 7. rollDamage range ===\n');

{
  // Roll 1000 times and verify the range is 8-64 (8d8)
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min ≥ 8 (8d8 min): got ${min}`, min >= 8);
  assert(`rollDamage max ≤ 64 (8d8 max): got ${max}`, max <= 64);
}

// ---- 8. cleanup is a no-op ------------------------------------

console.log('\n=== 8. cleanup is a no-op ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const hpBefore = caster.currentHP;
  // cleanup should not throw and should not modify the combatant
  const { cleanup } = require('../spells/blight');
  cleanup(caster);
  eq('cleanup does not change currentHP', caster.currentHP, hpBefore);
  assert('cleanup does not set isDead', caster.isDead === false);
}

// ---- Summary --------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
