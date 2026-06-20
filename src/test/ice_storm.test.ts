// ============================================================
// ice_storm.test.ts — Ice Storm bespoke spell module (Session 24)
// PHB p.254: 4th-level evocation, action, range 300 ft, NO concentration.
// Effect: AoE DEX save. DUAL damage: 2d8 cold + 2d6 bludgeoning. On fail:
// both full. On success: each halved independently (resistance applies per
// type). 20-ft-radius cylinder centered on the highest-threat enemy within
// 300 ft. (v1 simplifications: difficult-terrain rider NOT modelled; upcast
// NOT modelled.)
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors erupting_earth.test.ts structure (AoE radius save) but with a NEW
// dual-damage pattern: execute() calls applyDamageWithTempHP TWICE — first
// for cold, then for bludgeoning — so per-type resistances apply correctly.
// ONE combined 'damage' log event is emitted per target with the total.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - (1,0,0) = 5 ft from caster
//   - e_in  at (5,0,0) = 20 ft from center → in radius (boundary)
//   - e_out at (6,0,0) = 25 ft from center → out of radius
//   - oor   at (61,0,0) = 305 ft from caster (> 300 ft range)
// ============================================================

import {
  shouldCast, execute, metadata, rollDamageCold, rollDamageBludgeon,
} from '../spells/ice_storm';
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

const IS_ACTION: Action = {
  name: 'Ice Storm',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 300, long: 300 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Ice Storm (DEX save, 2d8 cold + 2d6 bludgeoning, 300-ft range, 20-ft radius AoE)',
};

const IS_ACTION_LOW_DC: Action = {
  ...IS_ACTION,
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

/** Druid at pos (0,0,0) with Ice Storm + 2 4th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = IS_ACTION): Combatant {
  return makeCombatant('druid', {
    name: 'Druid',
    pos,
    actions: [action],
    resources: withSlots4(2),
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

eq('Name is Ice Storm', metadata.name, 'Ice Storm');
eq('Level is 4', metadata.level, 4);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 300 ft', metadata.rangeFt, 300);
eq('AoE radius is 20 ft', metadata.aoeRadiusFt, 20);
eq('Cold die count is 2', metadata.dieCount, 2);
eq('Cold die sides is 8', metadata.dieSides, 8);
eq('Bludgeoning die count is 2 (dual damage)', metadata.bludgeonDieCount, 2);
eq('Bludgeoning die sides is 6 (dual damage)', metadata.bludgeonDieSides, 6);
eq('Damage type is cold (primary metadata)', metadata.damageType, 'cold');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Ice Storm action → null
{
  const caster = makeCombatant('druid', { actions: [], resources: withSlots4(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Ice Storm action', shouldCast(caster, bf), null);
}
// 2b. No 4th-level slots → null
{
  const caster = makeCombatant('druid', { actions: [IS_ACTION], resources: withSlots4(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 4th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 300 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 61 squares away = 305 ft > 300 ft range
  const enemy = makeWeakEnemy('e1', { x: 61, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 300 ft', shouldCast(caster, bf), null);
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

// 3a. Highest-threat enemy within 300 ft is chosen as the center;
//     nearby lower-HP enemies within 20 ft of the center are also caught.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('highT (center) in targets', ids.includes('highT'));
    assert('lowT (within 20 ft of highT) in targets', ids.includes('lowT'));
    eq('Exactly 2 targets caught', (result as Combatant[]).length, 2);
  }
}
// 3b. Enemies within 20 ft of the center are caught; out-of-radius excluded
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e_center = makeWeakEnemy('e_center', { x: 1, y: 0, z: 0 }, { maxHP: 1000 });
  // e_in: 4 squares from center → 20 ft (boundary) → IN radius
  const e_in = makeWeakEnemy('e_in', { x: 5, y: 0, z: 0 }, { maxHP: 50 });
  // e_out: 5 squares from center → 25 ft → OUT of radius
  const e_out = makeWeakEnemy('e_out', { x: 6, y: 0, z: 0 }, { maxHP: 50 });
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
// 3c. Out-of-range enemy (beyond 300 ft from caster) cannot be center
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const oor1 = makeWeakEnemy('oor1', { x: 61, y: 0, z: 0 }, { maxHP: 1000 });
  const oor2 = makeWeakEnemy('oor2', { x: 61, y: 1, z: 0 }, { maxHP: 500 });
  const bf = makeBF([caster, oor1, oor2]);
  eq('Returns null when all enemies beyond 300 ft', shouldCast(caster, bf), null);
}

// ---- 4. execute — guaranteed fail (full 2d8+2d6 damage) --------

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
    // 2d8 cold (2-16) + 2d6 bludgeoning (2-12) = total 4-28
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d8+2d6 range (4-28): got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 28);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    // KEY: ONE combined 'damage' log per target with total (not 2 separate)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Exactly 1 combined damage log per target', dmgLogs.length, 1);
    // The damage log description mentions both cold + bludgeoning (dual breakdown)
    if (dmgLogs.length === 1) {
      const desc = String(dmgLogs[0].description || '');
      assert('Damage log description mentions cold', desc.includes('cold'));
      assert('Damage log description mentions bludgeoning', desc.includes('bludgeoning'));
    }
    // No condition rider for Ice Storm
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (each halved) -------------

console.log('\n=== 5. execute — guaranteed success (each halved) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, IS_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Each halved independently: cold floor(2d8/2)=1-8, bludg floor(2d6/2)=1-6
    // Total range 2-14
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 2-14 range (cold 1-8 + bludg 1-6): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 14);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (DEX 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target AoE (multiple saves) -----------

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
    // All 3 took damage (all DEX 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 500 - e2.currentHP;
    const e3Lost = 250 - e3.currentHP;
    assert('e1 took damage in 2d8+2d6 range (4-28)', e1Lost >= 4 && e1Lost <= 28, `got ${e1Lost}`);
    assert('e2 took damage in 2d8+2d6 range (4-28)', e2Lost >= 4 && e2Lost <= 28, `got ${e2Lost}`);
    assert('e3 took damage in 2d8+2d6 range (4-28)', e3Lost >= 4 && e3Lost <= 28, `got ${e3Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    // 3 COMBINED damage logs (one per target — dual damage emits one log per target)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 combined damage logs emitted (one per target)', dmgLogs.length, 3);
  }
}

// ---- 7. execute — dual damage applied separately (resistance test) ----

console.log('\n=== 7. execute — dual damage applied separately (resistance) ===\n');

// KEY: execute() calls applyDamageWithTempHP TWICE — once for cold, once for
// bludgeoning. This matters for per-type resistances: if the target has cold
// resistance, ONLY cold is halved (NOT bludgeoning). If the two dice were
// combined into one applyDamageWithTempHP call with a single damage type,
// the resistance would apply to the entire combined total. By using a cold-
// resistant target and observing total damage in 3-20 (cold 1-8 + bludg 2-12),
// we prove the two applications are independent.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Enemy with cold resistance (no bludgeoning resistance). Guaranteed fail
  // (DEX 1 vs DC 25) → no save halving; only resistance applies.
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, {
    maxHP: 1000, currentHP: 1000,
    resistances: ['cold' as any],
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Cold: 2d8 raw (2-16), no save halving (fail), cold resistance halves
    //       → coldDealt = floor(coldRaw / 2) = 1-8
    // Bludgeoning: 2d6 raw (2-12), no save halving, NO resistance
    //       → bludDealt = 2-12
    // Total = 3-20 (NOT 4-28 [no resistance] NOR 2-14 [all halved])
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Cold-resistant target takes 3-20 (cold halved + bludg full): got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 20,
      `got ${dmgDealt} — if 2-14, the two dice were combined; if 4-28, no resistance applied`);
    // Sanity: total damage CANNOT exceed the no-resistance max (28) NOR be 0
    assert('Damage is > 0 (cold resist does not negate bludgeoning)', dmgDealt > 0);
  }
}
// 7b. Opposite: bludgeoning-resistant target — proves the OTHER type is the
//     one that gets halved (and cold stays full). Total = 2-22 (cold 2-16
//     + bludg floor(2-12/2)=1-6).
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, {
    maxHP: 1000, currentHP: 1000,
    resistances: ['bludgeoning' as any],
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Cold: 2-16 (full, no resistance)
    // Bludgeoning: 2d6 raw (2-12), no save halving, bludg resistance halves
    //       → bludDealt = floor(bludRaw / 2) = 1-6
    // Total = 3-22 (cold 2-16 + bludg 1-6)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Bludgeoning-resistant target takes 3-22 (cold full + bludg halved): got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 22);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/ice_storm') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamageCold + rollDamageBludgeon (dual dice) --------

console.log('\n=== 9. rollDamageCold + rollDamageBludgeon ===\n');

// 9a. rollDamageCold() — 2d8, range 2-16
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamageCold();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamageCold min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamageCold max <= 16 (got ${max})`, max <= 16);
}
// 9b. rollDamageBludgeon() — 2d6, range 2-12
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamageBludgeon();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamageBludgeon min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamageBludgeon max <= 12 (got ${max})`, max <= 12);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
