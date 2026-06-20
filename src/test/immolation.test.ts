// ============================================================
// immolation.test.ts — Immolation bespoke spell module (Session 24)
// XGE p.157: 5th-level evocation, action, range 90 ft. Canon:
// concentration, until extinguished. v1: concentration + DoT simplified
// to one-shot. Effect: single-target DEX save. On fail: 8d6 fire. On
// success: half. (Canon 4d6/turn DoT rider NOT modelled in v1.)
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors wardaway.test.ts EXACTLY (single-target save pattern) but with
// Immolation's stats (L5, DEX save, 8d6 fire, 90-ft range). Uses withSlots5.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - 18 squares = 90 ft (boundary, in range)
//   - 19 squares = 95 ft (> 90 ft range, out)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/immolation';
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

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

const IMMOLATION_ACTION: Action = {
  name: 'Immolation',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 90, long: 90 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: false,         // NOTE: single-target, NOT AoE
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Immolation (DEX save, 8d6 fire, 90-ft range, single-target)',
};

const IMMOLATION_ACTION_LOW_DC: Action = {
  ...IMMOLATION_ACTION,
  saveDC: 5,            // guaranteed-success DC (DEX 30 → min 11 ≥ 5)
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

/** Sorcerer at pos (0,0,0) with Immolation + 2 5th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = IMMOLATION_ACTION): Combatant {
  return makeCombatant('sorcerer', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots5(2),
  });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Immolation', metadata.name, 'Immolation');
eq('Level is 5', metadata.level, 5);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 90 ft', metadata.rangeFt, 90);
eq('Die count is 8', metadata.dieCount, 8);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is fire', metadata.damageType, 'fire');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Immolation action → null
{
  const caster = makeCombatant('sorcerer', { actions: [], resources: withSlots5(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Immolation action', shouldCast(caster, bf), null);
}
// 2b. No 5th-level slots → null
{
  const caster = makeCombatant('sorcerer', { actions: [IMMOLATION_ACTION], resources: withSlots5(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 90 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 19 squares away = 95 ft > 90 ft range
  const enemy = makeWeakEnemy('e1', { x: 19, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 90 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns that enemy (single Combatant, NOT array)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  if (result) {
    eq('Returns the single enemy (Combatant, NOT array)',
      (result as Combatant).id, 'e1');
    assert('Result is a Combatant (has .id, no .length property)',
      typeof (result as any).id === 'string' && !Array.isArray(result));
  }
}

// ---- 3. shouldCast target selection (single best target) --------

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Highest-threat enemy within 90 ft is chosen (single target)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 90 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}
// 3b. Enemy beyond 90 ft is NOT chosen — falls back to in-range enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 19 squares away = 95 ft > 90 ft range
  const outOfRange = makeWeakEnemy('oor', { x: 19, y: 0, z: 0 }, { maxHP: 999 });
  // In-range weak enemy
  const inRange = makeWeakEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 95-ft high-threat one)',
      (result as Combatant).id, 'ir');
  }
}
// 3c. Single Combatant return type — verify NOT an array even with 3 enemies
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 50 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e1, e2, e3]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant even with 3 enemies in range',
    result !== null && !Array.isArray(result));
  if (result) {
    eq('Returns one specific Combatant (not array of 3)',
      typeof (result as Combatant).id, 'string');
  }
}

// ---- 4. execute — guaranteed fail (full damage) ----------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (5th level: 2 → 1)',
      (caster.resources as any).spellSlots[5].remaining, 1);
    // 4b. Damage applied (8d6, range 8-48)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 8d6 range (8-48): got ${dmgDealt}`,
      dmgDealt >= 8 && dmgDealt <= 48);
    // 4c. Log events
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length >= 1);
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
    // No condition rider for Immolation
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, IMMOLATION_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Damage applied (half of 8d6, floor → range 4-24)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-24 range: got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 24);
    // 5b. Save-success log
    const saveSuccess = state.log.events.filter(e => e.type === 'save_success');
    assert('Save-success log emitted (DEX 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — single-target (no multi-target spillover) --------

console.log('\n=== 6. execute — single-target (no spillover) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
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

    // Only ONE enemy takes damage — Immolation is single-target
    const dmg1 = hpBeforeE1 - e1.currentHP;
    const dmg2 = hpBeforeE2 - e2.currentHP;
    const dmg3 = hpBeforeE3 - e3.currentHP;
    const damagedCount = [dmg1, dmg2, dmg3].filter(d => d > 0).length;
    eq('Exactly 1 enemy took damage (single-target spell)', damagedCount, 1);
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    eq('Only 1 save-fail log (single target)', saveFails.length, 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Only 1 damage log (single target)', dmgLogs.length, 1);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/immolation') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 8d6 --------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 8 (got ${min})`, min >= 8);
  assert(`rollDamage max <= 48 (got ${max})`, max <= 48);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
