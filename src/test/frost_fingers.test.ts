// ============================================================
// frost_fingers.test.ts — Frost Fingers bespoke spell module (Session 24)
// XGE p.161: 1st-level evocation, action, range Self (15-ft cone),
// NO concentration. Effect: AoE CON save. On fail: 2d8 cold. On
// success: half. Cone is aimed at the nearest enemy within 15 ft.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors burning_hands.test.ts (cone geometry) + shatter.test.ts
// (multi-target save loop) structure, with Frost Fingers' stats
// (L1, self-centred 15-ft cone, 2d8 cold, CON save). Uses withSlots1.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. Euclidean distance × 5 = feet
// (the cone planner uses euclidean for nearest-enemy selection, then
// inConeFt for cone membership — half-angle ≈ 26.57°).
//   - (1,0,0) = 5 ft from caster  → in cone, nearest (cone aims +x)
//   - (2,0,0) = 10 ft from caster → on +x axis, in cone
//   - (0,2,0) = 10 ft from caster → 90° off-axis → OUT of cone
//   - (5,0,0) = 25 ft from caster → beyond 15-ft cone range
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/frost_fingers';
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

function withSlots1(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

const FF_ACTION: Action = {
  name: 'Frost Fingers',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 15, long: 15 },      // Self (15-ft cone)
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Frost Fingers (CON save, 2d8 cold, 15-ft cone)',
};

const FF_ACTION_LOW_DC: Action = {
  ...FF_ACTION,
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

/** Wizard at pos (0,0,0) with Frost Fingers + 2 1st-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = FF_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots1(2),
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

eq('Name is Frost Fingers', metadata.name, 'Frost Fingers');
eq('Level is 1', metadata.level, 1);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 15 ft (cone length)', metadata.rangeFt, 15);
eq('AoE radius is 15 ft (cone alias)', metadata.aoeRadiusFt, 15);
eq('Die count is 2', metadata.dieCount, 2);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is cold', metadata.damageType, 'cold');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Frost Fingers action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots1(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Frost Fingers action', shouldCast(caster, bf), null);
}
// 2b. No 1st-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [FF_ACTION], resources: withSlots1(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 15-ft cone range → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 5 squares = 25 ft > 15 ft cone range
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 15-ft cone range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy within 15 ft', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast cone targeting ------------------------------

console.log('\n=== 3. shouldCast cone targeting ===\n');

// 3a. Cone aimed at nearest enemy (+x axis) catches aligned enemies;
//     off-axis enemy at same range is EXCLUDED.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });    // 5 ft, nearest → cone aims +x
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 });    // 10 ft, on +x axis → IN cone
  const e_offaxis = makeWeakEnemy('e_off', { x: 0, y: 2, z: 0 }); // 10 ft, 90° off-axis → OUT
  const bf = makeBF([caster, e1, e2, e_offaxis]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e1 (nearest, +x) in targets', ids.includes('e1'));
    assert('e2 (10 ft, +x axis) in targets', ids.includes('e2'));
    assert('e_off (90° off-axis) NOT in targets', !ids.includes('e_off'));
    eq('Exactly 2 targets caught (e1 + e2)', (result as Combatant[]).length, 2);
  }
}
// 3b. Enemy beyond 15-ft cone range is NOT a target
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });    // 5 ft → in cone
  const e_far = makeWeakEnemy('e_far', { x: 4, y: 0, z: 0 }); // 20 ft → beyond 15-ft cone range
  const bf = makeBF([caster, e1, e_far]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e1 (5 ft, in range) in targets', ids.includes('e1'));
    assert('e_far (20 ft, out of range) NOT in targets', !ids.includes('e_far'));
  }
}

// ---- 4. execute — guaranteed fail (full 2d8 damage) -------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 1 target', targets !== null && (targets as Combatant[]).length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 2d8 range 2-16
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d8 range (2-16): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 16);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // No condition rider for Frost Fingers (pure damage)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) --------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, FF_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 2d8 (floor), range 1-8
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 1-8 range: got ${dmgDealt}`,
      dmgDealt >= 1 && dmgDealt <= 8);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target cone (multiple saves) -----------

console.log('\n=== 6. execute — multi-target cone ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Both enemies on +x axis (in cone)
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 2 targets (e1, e2)', targets !== null && (targets as Combatant[]).length === 2);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Both took damage (both CON 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 1000 - e2.currentHP;
    assert('e1 took damage in 2d8 range (2-16)', e1Lost >= 2 && e1Lost <= 16, `got ${e1Lost}`);
    assert('e2 took damage in 2d8 range (2-16)', e2Lost >= 2 && e2Lost <= 16, `got ${e2Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('2 save-fail logs (one per target)', saveFails.length, 2);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('2 damage logs emitted (one per target)', dmgLogs.length, 2);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/frost_fingers') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 2d8 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamage max <= 16 (got ${max})`, max <= 16);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
