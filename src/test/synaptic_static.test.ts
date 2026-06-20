// ============================================================
// synaptic_static.test.ts — Synaptic Static bespoke spell module (Session 24)
// XGE p.167: 5th-level evocation, action, range 120 ft, NO concentration.
// Effect: AoE INT save. On fail: 8d6 psychic + incapacitated (v1
// simplification of canon's -1d6 rider — no -1d6 debuff effect type
// exists). On success: half damage, no incapacitated. 20-ft-radius sphere
// centered on the highest-threat enemy within 120 ft. (v1 simplifications:
// upcast NOT modelled.)
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors sunburst.test.ts structure (AoE save + condition_apply on
// failed save) but with Synaptic Static's stats (L5, self-targeted 20-ft
// radius, 8d6 psychic, incapacitated on fail [-1d6 simplified], INT save,
// 120-ft range). Uses withSlots5.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - INT 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - INT 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - e_in  at (4,0,0) = 20 ft from center → in radius (boundary)
//   - e_out at (5,0,0) = 25 ft from center → out of radius
//   - oor   at (25,0,0) = 125 ft from caster (> 120 ft range)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/synaptic_static';
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

const SS_ACTION: Action = {
  name: 'Synaptic Static',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (INT 1 → max 15 < 25)
  saveAbility: 'int',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Synaptic Static (INT save, 8d6 psychic + incapacitated on fail [-1d6 simplified], 120-ft range, 20-ft radius AoE)',
};

const SS_ACTION_LOW_DC: Action = {
  ...SS_ACTION,
  saveDC: 5,            // guaranteed-success DC (INT 30 → min 11 ≥ 5)
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

/** Bard at pos (0,0,0) with Synaptic Static + 2 5th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = SS_ACTION): Combatant {
  return makeCombatant('bard', {
    name: 'Bard',
    pos,
    actions: [action],
    resources: withSlots5(2),
  });
}

/** Enemy with INT 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    int: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with INT 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    int: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Synaptic Static', metadata.name, 'Synaptic Static');
eq('Level is 5', metadata.level, 5);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 120 ft', metadata.rangeFt, 120);
eq('AoE radius is 20 ft', metadata.aoeRadiusFt, 20);
eq('Die count is 8', metadata.dieCount, 8);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is psychic', metadata.damageType, 'psychic');
eq('Save ability is int', metadata.saveAbility, 'int');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Synaptic Static action → null
{
  const caster = makeCombatant('bard', { actions: [], resources: withSlots5(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Synaptic Static action', shouldCast(caster, bf), null);
}
// 2b. No 5th-level slots → null
{
  const caster = makeCombatant('bard', { actions: [SS_ACTION], resources: withSlots5(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
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

// ---- 3. shouldCast AoE targeting (center + 20-ft radius) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 120 ft is chosen as the center;
//     nearby lower-HP enemies within 20 ft of the center are also caught.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });  // 25 ft from caster
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    // Center is highT (maxHP 300); lowT is 4 squares (20 ft) from highT → in radius (boundary)
    const ids = (result as Combatant[]).map(c => c.id);
    assert('highT (center) in targets', ids.includes('highT'));
    assert('lowT (within 20 ft of highT) in targets', ids.includes('lowT'));
    eq('Exactly 2 targets caught', (result as Combatant[]).length, 2);
  }
}
// 3b. Enemies within 20 ft of the center are caught; out-of-radius excluded
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center: e_center (maxHP 1000) at (1,0,0) — 5 ft from caster
  const e_center = makeWeakEnemy('e_center', { x: 1, y: 0, z: 0 }, { maxHP: 1000 });
  // e_in: 3 squares from center → 15 ft → IN radius
  const e_in = makeWeakEnemy('e_in', { x: 4, y: 0, z: 0 }, { maxHP: 50 });
  // e_boundary: 4 squares from center → 20 ft (boundary) → IN radius
  const e_boundary = makeWeakEnemy('e_boundary', { x: 5, y: 0, z: 0 }, { maxHP: 50 });
  // e_out: 5 squares from center → 25 ft → OUT of radius
  const e_out = makeWeakEnemy('e_out', { x: 6, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e_center, e_in, e_boundary, e_out]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e_center (center) in targets', ids.includes('e_center'));
    assert('e_in (15 ft from center) in targets', ids.includes('e_in'));
    assert('e_boundary (20 ft boundary from center) in targets', ids.includes('e_boundary'));
    assert('e_out (25 ft from center) NOT in targets', !ids.includes('e_out'));
    eq('Exactly 3 targets caught (e_center + e_in + e_boundary)', (result as Combatant[]).length, 3);
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

// ---- 4. execute — guaranteed fail (full 8d6 damage + incapacitated) ----

console.log('\n=== 4. execute — guaranteed fail (full damage + incapacitated) ===\n');

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

    eq('Slot consumed (5th level: 2 → 1)',
      (caster.resources as any).spellSlots[5].remaining, 1);
    // 8d6 range 8-48
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 8d6 range (8-48): got ${dmgDealt}`,
      dmgDealt >= 8 && dmgDealt <= 48);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (INT 1 vs DC 25)', saveFails.length === 1);
    // KEY: incapacitated condition applied on failed save
    assert('Enemy is incapacitated (condition_apply fired)', enemy.conditions.has('incapacitated'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (incapacitated)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Synaptic Static');
    assert('ActiveEffect recorded with spellName Synaptic Static', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is incapacitated', ckEffects[0].payload.condition, 'incapacitated');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage, NO incapacitated) --

console.log('\n=== 5. execute — guaranteed success (half damage, no incapacitated) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, SS_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 8d6 (floor), range 4-24
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-24 range: got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 24);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (INT 30 vs DC 5)', saveSuccess.length === 1);
    // KEY: NOT incapacitated on successful save
    assert('Enemy is NOT incapacitated on successful save', !enemy.conditions.has('incapacitated'));
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
  }
}

// ---- 6. execute — multi-target AoE + multi-incapacitated --------

console.log('\n=== 6. execute — multi-target AoE + multi-incapacitated ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Both enemies weak (INT 1) — both fail save vs DC 25 → both incapacitated
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 1, y: 1, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 2 targets (e1, e2)', targets !== null && (targets as Combatant[]).length === 2);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Both fail save → both incapacitated
    assert('e1 (INT 1, failed save) IS incapacitated', e1.conditions.has('incapacitated'));
    assert('e2 (INT 1, failed save) IS incapacitated', e2.conditions.has('incapacitated'));
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('2 save-fail logs (one per target)', saveFails.length, 2);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('2 damage logs emitted (one per target)', dmgLogs.length, 2);
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('2 condition-add logs (one per incapacitated target)', condAdds.length, 2);
  }
}

// ---- 7. execute — already-incapacitated target (no double-apply) ----

console.log('\n=== 7. execute — already-incapacitated target ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-incapacitate the enemy
  enemy.conditions.add('incapacitated' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Still incapacitated (was already)
    assert('Enemy still incapacitated after re-cast', enemy.conditions.has('incapacitated'));
    // No SECOND activeEffect added (skip-if-already-incapacitated guard)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Synaptic Static');
    eq('No Synaptic Static activeEffect added (already incapacitated)', ckEffects.length, 0);
    // Damage still applied
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-incapacitated target', dmgLogs.length, 1);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/synaptic_static') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 8d6 -------------------------------

console.log('\n=== 9. rollDamage ===\n');

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
