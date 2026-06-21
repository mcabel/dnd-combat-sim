// ============================================================
// fire_storm.test.ts — Fire Storm bespoke spell module (Session 24)
// PHB p.242: 7th-level evocation, action, range 150 ft, NO concentration.
// Effect: AoE DEX save. On fail: 7d10 fire. On success: half.
// AoE: 40-ft radius sphere (v1 simplification of canon "ten 10-ft cubes")
// centred on the highest-threat enemy within 150 ft.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors erupting_earth.test.ts structure (AoE radius save) but with
// Fire Storm's stats (L7, DEX save, 7d10 fire, 150-ft range, 40-ft radius).
// Uses withSlots7.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/fire_storm';
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

function withSlots7(remaining = 2): PlayerResources {
  return { spellSlots: { 7: { max: 2, remaining } } };
}

const FS_ACTION: Action = {
  name: 'Fire Storm',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 7,
  costType: 'action',
  legendaryCost: 0,
  description: 'Fire Storm (DEX save, 7d10 fire, 150-ft range, 40-ft radius AoE)',
};

const FS_ACTION_LOW_DC: Action = {
  ...FS_ACTION,
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

/** Druid at pos (0,0,0) with Fire Storm + 2 7th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = FS_ACTION): Combatant {
  return makeCombatant('druid', {
    name: 'Druid',
    pos,
    actions: [action],
    resources: withSlots7(2),
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

eq('Name is Fire Storm', metadata.name, 'Fire Storm');
eq('Level is 7', metadata.level, 7);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 150 ft', metadata.rangeFt, 150);
eq('AoE radius is 40 ft', metadata.aoeRadiusFt, 40);
eq('Die count is 7', metadata.dieCount, 7);
eq('Die sides is 10', metadata.dieSides, 10);
eq('Damage type is fire', metadata.damageType, 'fire');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Fire Storm action → null
{
  const caster = makeCombatant('druid', { actions: [], resources: withSlots7(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Fire Storm action', shouldCast(caster, bf), null);
}
// 2b. No 7th-level slots → null
{
  const caster = makeCombatant('druid', { actions: [FS_ACTION], resources: withSlots7(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 7th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 150 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 150 ft range
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 });
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

// ---- 3. shouldCast AoE targeting (center + 40-ft radius) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 150 ft is chosen as center; all within 40 ft are caught
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 200 });
  // nearby within 40 ft of center: chebyshev = 7 → 35 ft
  const nearby = makeWeakEnemy('nearby', { x: 5, y: 7, z: 0 }, { maxHP: 50 });
  // far outside 40 ft of center: chebyshev = 9 → 45 ft
  const far = makeWeakEnemy('far', { x: 5, y: 9, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, center, nearby, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('Includes center', ids.includes('center'));
    assert('Includes nearby (35 ft ≤ 40 ft radius)', ids.includes('nearby'));
    assert('Excludes far (45 ft > 40 ft radius)', !ids.includes('far'));
  }
}

// 3b. Boundary test — 40 ft boundary from center is IN (≤ 40)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center at (5,0,0) = 25 ft from caster (in range, maxHP 1000 → primary)
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 1000 });
  // e_in: chebyshev = 8 → 40 ft from center (boundary) → IN radius
  const e_in = makeWeakEnemy('e_in', { x: 13, y: 0, z: 0 }, { maxHP: 50 });
  // e_out: chebyshev = 9 → 45 ft from center → OUT of radius
  const e_out = makeWeakEnemy('e_out', { x: 14, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, center, e_in, e_out]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e_in (40 ft boundary from center) in targets', ids.includes('e_in'));
    assert('e_out (45 ft from center) NOT in targets', !ids.includes('e_out'));
    eq('Exactly 2 targets caught (center + e_in)', (result as Combatant[]).length, 2);
  }
}

// 3c. Out-of-range enemy (beyond 150 ft from caster) cannot be center
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Both enemies at 250 ft (out of 150-ft range); shouldCast → null
  const oor1 = makeWeakEnemy('oor1', { x: 50, y: 0, z: 0 }, { maxHP: 1000 });
  const oor2 = makeWeakEnemy('oor2', { x: 50, y: 1, z: 0 }, { maxHP: 500 });
  const bf = makeBF([caster, oor1, oor2]);
  eq('Returns null when all enemies beyond 150 ft', shouldCast(caster, bf), null);
}

// ---- 4. execute — guaranteed fail (full 7d10 damage) -----------

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

    eq('Slot consumed (7th level: 2 → 1)',
      (caster.resources as any).spellSlots[7].remaining, 1);
    // 7d10 range 7-70
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 7d10 range (7-70): got ${dmgDealt}`,
      dmgDealt >= 7 && dmgDealt <= 70);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // No condition rider for Fire Storm
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, FS_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 7d10 (floor), range 3-35
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 3-35 range: got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 35);
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
  // All within 40-ft radius of e1 → all caught.
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (all clustered within 40 ft of center e1)',
    targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 took damage (all DEX 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 500 - e2.currentHP;
    const e3Lost = 250 - e3.currentHP;
    assert('e1 took damage in 7d10 range (7-70)', e1Lost >= 7 && e1Lost <= 70, `got ${e1Lost}`);
    assert('e2 took damage in 7d10 range (7-70)', e2Lost >= 7 && e2Lost <= 70, `got ${e2Lost}`);
    assert('e3 took damage in 7d10 range (7-70)', e3Lost >= 7 && e3Lost <= 70, `got ${e3Lost}`);
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
  try { (require('../spells/fire_storm') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 7d10 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 7 (got ${min})`, min >= 7);
  assert(`rollDamage max <= 70 (got ${max})`, max <= 70);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
