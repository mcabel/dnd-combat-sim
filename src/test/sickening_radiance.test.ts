// ============================================================
// sickening_radiance.test.ts — Sickening Radiance bespoke spell module (Session 24)
// XGE p.164: 4th-level evocation, action, range 120 ft. Canon: concentration
// up to 10 min. v1: concentration simplified to one-shot.
// Effect: AoE CON save. On fail: 4d10 radiant + poisoned (exhaustion
// simplified to poisoned). On success: half, no poisoned. 30-ft-radius
// sphere centered on the highest-threat enemy within 120 ft.
// (v1 simplifications: concentration one-shot; exhaustion→poisoned; upcast
// NOT modelled.)
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors sunburst.test.ts structure (AoE save + condition_apply) but with
// Sickening Radiance's stats (L4, CON save, 4d10 radiant + poisoned on fail,
// 120-ft range, 30-ft radius). Uses withSlots4.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - center at (1,0,0) = 5 ft from caster
//   - e_in  at (6,0,0) = 25 ft from center → in 30-ft radius
//   - e_out at (8,0,0) = 35 ft from center → out of 30-ft radius
//   - oor   at (25,0,0) = 125 ft from caster (> 120 ft range)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/sickening_radiance';
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

const SR_ACTION: Action = {
  name: 'Sickening Radiance',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: 'radiant',
  saveDC: 25,
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Sickening Radiance (CON save, 4d10 radiant + poisoned on fail, 120-ft range, 30-ft radius AoE)',
};

const SR_ACTION_LOW_DC: Action = {
  ...SR_ACTION,
  saveDC: 5,
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

/** Sorcerer at pos (0,0,0) with Sickening Radiance + 2 4th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = SR_ACTION): Combatant {
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

eq('Name is Sickening Radiance', metadata.name, 'Sickening Radiance');
eq('Level is 4', metadata.level, 4);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 120 ft', metadata.rangeFt, 120);
eq('AoE radius is 30 ft', metadata.aoeRadiusFt, 30);
eq('Die count is 4', metadata.dieCount, 4);
eq('Die sides is 10', metadata.dieSides, 10);
eq('Damage type is radiant', metadata.damageType, 'radiant');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Sickening Radiance action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots4(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Sickening Radiance action', shouldCast(caster, bf), null);
}
// 2b. No 4th-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [SR_ACTION], resources: withSlots4(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 4th-level slots', shouldCast(caster, bf), null);
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

// ---- 3. shouldCast AoE targeting (center + 30-ft radius) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 120 ft is chosen as the center;
//     nearby lower-HP enemies within 30 ft of the center are also caught.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    // Center is highT (maxHP 300); lowT is 4 squares (20 ft) from highT → in radius
    const ids = (result as Combatant[]).map(c => c.id);
    assert('highT (center) in targets', ids.includes('highT'));
    assert('lowT (within 30 ft of highT) in targets', ids.includes('lowT'));
    eq('Exactly 2 targets caught', (result as Combatant[]).length, 2);
  }
}
// 3b. Enemies within 30 ft of the center are caught; out-of-radius excluded
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center: e_center (maxHP 1000) at (1,0,0) — 5 ft from caster
  const e_center = makeWeakEnemy('e_center', { x: 1, y: 0, z: 0 }, { maxHP: 1000 });
  // e_in: 6 squares from center → 30 ft (boundary) → IN 30-ft radius
  const e_in = makeWeakEnemy('e_in', { x: 7, y: 0, z: 0 }, { maxHP: 50 });
  // e_out: 8 squares from center → 40 ft → OUT of 30-ft radius
  const e_out = makeWeakEnemy('e_out', { x: 9, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e_center, e_in, e_out]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e_center (center) in targets', ids.includes('e_center'));
    assert('e_in (30 ft boundary from center) in targets', ids.includes('e_in'));
    assert('e_out (40 ft from center) NOT in targets', !ids.includes('e_out'));
    eq('Exactly 2 targets caught (e_center + e_in)', (result as Combatant[]).length, 2);
  }
}
// 3c. Out-of-range enemy (beyond 120 ft from caster) cannot be center
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 25 squares = 125 ft > 120 ft range
  const oor1 = makeWeakEnemy('oor1', { x: 25, y: 0, z: 0 }, { maxHP: 1000 });
  const oor2 = makeWeakEnemy('oor2', { x: 25, y: 1, z: 0 }, { maxHP: 500 });
  const bf = makeBF([caster, oor1, oor2]);
  eq('Returns null when all enemies beyond 120 ft', shouldCast(caster, bf), null);
}

// ---- 4. execute — guaranteed fail (full damage + poisoned) ------

console.log('\n=== 4. execute — guaranteed fail (full damage + poisoned) ===\n');

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

    eq('Slot consumed (4th level: 2 → 1)',
      (caster.resources as any).spellSlots[4].remaining, 1);
    // 4d10 range 4-40
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 4d10 range (4-40): got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 40);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    // KEY: poisoned condition applied on failed save
    assert('Enemy is poisoned (condition_apply fired)', enemy.conditions.has('poisoned'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (poisoned)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false — v1 one-shot)
    const srEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Sickening Radiance');
    assert('ActiveEffect recorded with spellName Sickening Radiance', srEffects.length === 1);
    if (srEffects.length === 1) {
      eq('Effect type is condition_apply', srEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is poisoned', srEffects[0].payload.condition, 'poisoned');
      eq('Effect NOT concentration-sourced (v1 one-shot)', srEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage, NO poisoned) --

console.log('\n=== 5. execute — guaranteed success (half damage, no poisoned) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, SR_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 4d10 (floor), range 2-20
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 2-20 range: got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 20);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
    // KEY: NOT poisoned on successful save
    assert('Enemy is NOT poisoned on successful save', !enemy.conditions.has('poisoned'));
    // No condition_add log for this target
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
  }
}

// ---- 6. execute — multi-target AoE + multi-poisoned --------

console.log('\n=== 6. execute — multi-target AoE + multi-poisoned ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Three enemies clustered around center e1 (maxHP 1000 at 5 ft):
  //   e2 at (2,0,0) = 5 ft from e1; e3 at (3,0,0) = 10 ft from e1.
  // All within 30-ft radius of e1 → all caught.
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (all clustered within 30 ft of center e1)',
    targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 fail save → all poisoned
    assert('e1 (CON 1, failed save) IS poisoned', e1.conditions.has('poisoned'));
    assert('e2 (CON 1, failed save) IS poisoned', e2.conditions.has('poisoned'));
    assert('e3 (CON 1, failed save) IS poisoned', e3.conditions.has('poisoned'));
    // All 3 took damage (all CON 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 500 - e2.currentHP;
    const e3Lost = 250 - e3.currentHP;
    assert('e1 took damage in 4d10 range (4-40)', e1Lost >= 4 && e1Lost <= 40, `got ${e1Lost}`);
    assert('e2 took damage in 4d10 range (4-40)', e2Lost >= 4 && e2Lost <= 40, `got ${e2Lost}`);
    assert('e3 took damage in 4d10 range (4-40)', e3Lost >= 4 && e3Lost <= 40, `got ${e3Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('3 condition-add logs (one per poisoned target)', condAdds.length, 3);
  }
}

// ---- 7. execute — already-poisoned target (no double-apply) ----

console.log('\n=== 7. execute — already-poisoned target ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-poison the enemy
  enemy.conditions.add('poisoned' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Still poisoned (was already)
    assert('Enemy still poisoned after re-cast', enemy.conditions.has('poisoned'));
    // No SECOND activeEffect added (skip-if-already-poisoned guard)
    const srEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Sickening Radiance');
    eq('No Sickening Radiance activeEffect added (already poisoned)', srEffects.length, 0);
    // Damage still applied
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-poisoned target', dmgLogs.length, 1);
    // No condition_add log (skip-if-already-poisoned guard)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log for already-poisoned target', condAdds.length, 0);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/sickening_radiance') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 4d10 -------------------------------

console.log('\n=== 9. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamage max <= 40 (got ${max})`, max <= 40);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
