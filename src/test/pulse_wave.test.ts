// ============================================================
// pulse_wave.test.ts — Pulse Wave bespoke spell module (Session 24)
// EGtW p.163: 3rd-level evocation, action, range Self (30-ft cone),
// NO concentration. Effect: AoE CON save. On fail: 6d6 force. On
// success: half. Cone is aimed at the nearest enemy within 30 ft.
// Push 15 ft on fail (canon) is NOT modelled in v1.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors frost_fingers.test.ts (cone geometry) + spray_of_cards.test.ts
// (cone + multi-target) structure, with Pulse Wave's stats (L3, self-
// centred 30-ft cone, 6d6 force, CON save). Uses withSlots3.
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
//   - (4,0,0) = 20 ft from caster → on +x axis, in cone (within 30-ft)
//   - (0,2,0) = 10 ft from caster → 90° off-axis → OUT of cone
//   - (7,0,0) = 35 ft from caster → beyond 30-ft cone range
// ============================================================

import { shouldCast, execute, metadata, rollDamage, CONE_RANGE_FT } from '../spells/pulse_wave';
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

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const PW_ACTION: Action = {
  name: 'Pulse Wave',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 30, long: 30 },      // Self (30-ft cone)
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Pulse Wave (CON save, 6d6 force, 30-ft cone)',
};

const PW_ACTION_LOW_DC: Action = {
  ...PW_ACTION,
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

/** Wizard at pos (0,0,0) with Pulse Wave + 2 3rd-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = PW_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots3(2),
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

eq('Name is Pulse Wave', metadata.name, 'Pulse Wave');
eq('Level is 3', metadata.level, 3);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 30 ft (cone length)', metadata.rangeFt, 30);
eq('AoE radius is 30 ft (cone alias)', metadata.aoeRadiusFt, 30);
eq('Die count is 6', metadata.dieCount, 6);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is force', metadata.damageType, 'force');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);
eq('Cone range constant is 30', CONE_RANGE_FT, 30);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Pulse Wave action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots3(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Pulse Wave action', shouldCast(caster, bf), null);
}
// 2b. No 3rd-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [PW_ACTION], resources: withSlots3(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 30-ft cone range → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 7 squares = 35 ft > 30 ft cone range
  const enemy = makeWeakEnemy('e1', { x: 7, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 30-ft cone range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy within 30 ft', result !== null);
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
// 3b. Enemy beyond 30-ft cone range is NOT a target
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });    // 5 ft → in cone
  const e_far = makeWeakEnemy('e_far', { x: 7, y: 0, z: 0 }); // 35 ft → beyond 30-ft cone range
  const bf = makeBF([caster, e1, e_far]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e1 (5 ft, in range) in targets', ids.includes('e1'));
    assert('e_far (35 ft, out of range) NOT in targets', !ids.includes('e_far'));
  }
}

// ---- 4. execute — guaranteed fail (full 6d6 damage) -------------

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

    eq('Slot consumed (3rd level: 2 → 1)',
      (caster.resources as any).spellSlots[3].remaining, 1);
    // 6d6 range 6-36
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 6d6 range (6-36): got ${dmgDealt}`,
      dmgDealt >= 6 && dmgDealt <= 36);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // No condition rider for Pulse Wave (push NOT modelled in v1)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) --------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, PW_ACTION_LOW_DC);
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

// ---- 6. execute — multi-target cone (multiple saves) -----------

console.log('\n=== 6. execute — multi-target cone ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Three enemies on +x axis (all in cone): 5 ft, 10 ft, 20 ft
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeWeakEnemy('e3', { x: 4, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (e1, e2, e3)', targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All took damage (all CON 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 1000 - e2.currentHP;
    const e3Lost = 1000 - e3.currentHP;
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
  try { (require('../spells/pulse_wave') as any).cleanup(caster); }
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
