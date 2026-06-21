// ============================================================
// maddening_darkness.test.ts — Maddening Darkness bespoke spell module (Session 24)
// XGE p.158: 8th-level evocation, action, range 120 ft. Canon: concentration,
// up to 10 minutes. v1: concentration + darkness simplified to one-shot.
// Effect: AoE WIS save. On fail: 8d8 psychic. On success: half. NO condition
// (the canon "heavily obscured / magical darkness" rider is simplified away
// per the plan: "darkness rider simplified — no condition applied, just 8d8
// psychic").
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors circle_of_death.test.ts structure (AoE radius save, no condition)
// but with Maddening Darkness's stats (L8, WIS save, 8d8 psychic, 120-ft
// range, 60-ft radius, v1 one-shot). Uses withSlots8.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - WIS 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - WIS 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/maddening_darkness';
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

function withSlots8(remaining = 2): PlayerResources {
  return { spellSlots: { 8: { max: 2, remaining } } };
}

const MD_ACTION: Action = {
  name: 'Maddening Darkness',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (WIS 1 → max 15 < 25)
  saveAbility: 'wis',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 8,
  costType: 'action',
  legendaryCost: 0,
  description: 'Maddening Darkness (WIS save, 8d8 psychic, 120-ft range, 60-ft radius AoE)',
};

const MD_ACTION_LOW_DC: Action = {
  ...MD_ACTION,
  saveDC: 5,            // guaranteed-success DC (WIS 30 → min 11 ≥ 5)
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

/** Warlock at pos (0,0,0) with Maddening Darkness + 2 8th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = MD_ACTION): Combatant {
  return makeCombatant('warlock', {
    name: 'Warlock',
    pos,
    actions: [action],
    resources: withSlots8(2),
  });
}

/** Enemy with WIS 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with WIS 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Maddening Darkness', metadata.name, 'Maddening Darkness');
eq('Level is 8', metadata.level, 8);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 120 ft', metadata.rangeFt, 120);
eq('AoE radius is 60 ft', metadata.aoeRadiusFt, 60);
eq('Die count is 8', metadata.dieCount, 8);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is psychic', metadata.damageType, 'psychic');
eq('Save ability is wis', metadata.saveAbility, 'wis');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Maddening Darkness action → null
{
  const caster = makeCombatant('warlock', { actions: [], resources: withSlots8(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Maddening Darkness action', shouldCast(caster, bf), null);
}
// 2b. No 8th-level slots → null
{
  const caster = makeCombatant('warlock', { actions: [MD_ACTION], resources: withSlots8(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 8th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 120 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 25 squares away = 125 ft > 120 ft range
  const enemy = makeWeakEnemy('e1', { x: 25, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 120 ft', shouldCast(caster, bf), null);
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

// ---- 3. shouldCast AoE targeting (center + 60-ft radius) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 120 ft is chosen as center; all within 60 ft are caught
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 200 });
  // nearby within 60 ft of center: chebyshev = 10 → 50 ft
  const nearby = makeWeakEnemy('nearby', { x: 5, y: 10, z: 0 }, { maxHP: 50 });
  // far outside 60 ft of center: chebyshev = 13 → 65 ft
  const far = makeWeakEnemy('far', { x: 5, y: 13, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, center, nearby, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('Includes center', ids.includes('center'));
    assert('Includes nearby (50 ft ≤ 60 ft radius)', ids.includes('nearby'));
    assert('Excludes far (65 ft > 60 ft radius)', !ids.includes('far'));
  }
}

// 3b. Threat selection — highest maxHP is the center
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 2, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Both enemies caught in 60-ft AoE (1 square apart)', (result as Combatant[]).length, 2);
  }
}

// 3c. Out-of-range enemy (beyond 120 ft from caster) cannot be center
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Both enemies at 125 ft (out of 120-ft range); shouldCast → null
  const oor1 = makeWeakEnemy('oor1', { x: 25, y: 0, z: 0 }, { maxHP: 1000 });
  const oor2 = makeWeakEnemy('oor2', { x: 25, y: 1, z: 0 }, { maxHP: 500 });
  const bf = makeBF([caster, oor1, oor2]);
  eq('Returns null when all enemies beyond 120 ft', shouldCast(caster, bf), null);
}

// ---- 4. execute — guaranteed fail (full 8d8 damage) ------------

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

    eq('Slot consumed (8th level: 2 → 1)',
      (caster.resources as any).spellSlots[8].remaining, 1);
    // 8d8 range 8-64
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 8d8 range (8-64): got ${dmgDealt}`,
      dmgDealt >= 8 && dmgDealt <= 64);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (WIS 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // KEY: NO condition for Maddening Darkness (darkness rider simplified per plan)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (darkness rider simplified per plan)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, MD_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 8d8 (floor), range 4-32
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-32 range: got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 32);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (WIS 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target AoE (multiple saves) -----------

console.log('\n=== 6. execute — multi-target AoE ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Three enemies clustered around center e1 (maxHP 1000 at 5 ft):
  //   e2 at (2,0,0) = 5 ft from e1; e3 at (3,0,0) = 10 ft from e1.
  // All within 60-ft radius of e1 → all caught.
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (all clustered within 60 ft of center e1)',
    targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 took damage (all WIS 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 500 - e2.currentHP;
    const e3Lost = 250 - e3.currentHP;
    assert('e1 took damage in 8d8 range (8-64)', e1Lost >= 8 && e1Lost <= 64, `got ${e1Lost}`);
    assert('e2 took damage in 8d8 range (8-64)', e2Lost >= 8 && e2Lost <= 64, `got ${e2Lost}`);
    assert('e3 took damage in 8d8 range (8-64)', e3Lost >= 8 && e3Lost <= 64, `got ${e3Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
    // NO conditions applied (darkness rider simplified per plan)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('Still NO condition-add logs in multi-target case', condAdds.length, 0);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/maddening_darkness') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 8d8 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 8 (got ${min})`, min >= 8);
  assert(`rollDamage max <= 64 (got ${max})`, max <= 64);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
