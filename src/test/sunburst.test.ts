// ============================================================
// sunburst.test.ts — Sunburst bespoke spell module (Session 23)
// PHB p.284: 8th-level evocation, action, range 150 ft, NO concentration.
// Effect: CON save. On fail: 12d6 radiant + blinded. On success: half, no blindness.
//         60-ft radius AoE. Blindness persists for v1 combat (1-min not tracked).
//
// Migrated from the Session 19 generic dispatch registry in Session 23.
// Mirrors fireball.test.ts for the AoE shape + damage, plus blindness_deafness.test.ts
// for the condition_apply on failed save.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/sunburst';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots8(remaining = 2): PlayerResources {
  return { spellSlots: { 8: { max: 2, remaining } } };
}

const SUNBURST_ACTION: Action = {
  name: 'Sunburst',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: 'radiant',
  saveDC: 25,
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 8,
  costType: 'action',
  legendaryCost: 0,
  description: 'Sunburst (CON save, 12d6 radiant + blinded on fail, 60-ft radius AoE)',
};

const SUNBURST_ACTION_LOW_DC: Action = {
  ...SUNBURST_ACTION,
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

function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = SUNBURST_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots8(2),
  });
}

function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 1,
    pos,
    ...overrides,
  });
}

function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 30,
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Sunburst', metadata.name, 'Sunburst');
eq('Level is 8', metadata.level, 8);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 150 ft', metadata.rangeFt, 150);
eq('AoE radius is 60 ft', metadata.aoeRadiusFt, 60);
eq('Die count is 12', metadata.dieCount, 12);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is radiant', metadata.damageType, 'radiant');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots8(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Sunburst action', shouldCast(caster, bf), null);
}
{
  const caster = makeCombatant('wiz', { actions: [SUNBURST_ACTION], resources: withSlots8(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 8th-level slots', shouldCast(caster, bf), null);
}
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft > 150 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when single enemy in range', result !== null);
  if (result) eq('Returns array with 1 target', result.length, 1);
}

// ---- 3. shouldCast target selection (AoE) ----------------------

console.log('\n=== 3. shouldCast target selection (AoE) ===\n');

// 3a. Highest-threat enemy is the AoE center; all within 60 ft are caught
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 200 });
  // nearby is within 60 ft of center: chebyshev = 10 → 50 ft
  const nearby = makeWeakEnemy('nearby', { x: 5, y: 10, z: 0 }, { maxHP: 50 });
  // far is outside 60 ft of center: chebyshev = 13 → 65 ft
  const far = makeWeakEnemy('far', { x: 5, y: 13, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, center, nearby, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = result.map(c => c.id).sort();
    assert('Includes center', ids.includes('center'));
    assert('Includes nearby (50 ft ≤ 60 ft radius)', ids.includes('nearby'));
    assert('Excludes far (65 ft > 60 ft radius)', !ids.includes('far'));
  }
}
// 3b. Threat selection — highest maxHP is the center
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 2, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Both enemies caught in AoE', result.length, 2);
  }
}

// ---- 4. execute — guaranteed fail (full damage + blinded) ------

console.log('\n=== 4. execute — guaranteed fail (full damage + blinded) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 1 target', targets !== null && targets.length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);

    eq('Slot consumed (8th level: 2 → 1)',
      (caster.resources as any).spellSlots[8].remaining, 1);
    // 12d6 range 12-72
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 12d6 range (12-72): got ${dmgDealt}`,
      dmgDealt >= 12 && dmgDealt <= 72);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    // KEY: blinded condition applied on failed save
    assert('Enemy is blinded (condition_apply fired)', enemy.conditions.has('blinded'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (blinded)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Sunburst');
    assert('ActiveEffect recorded with spellName Sunburst', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is blinded', ckEffects[0].payload.condition, 'blinded');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage, NO blindness) --

console.log('\n=== 5. execute — guaranteed success (half damage, no blindness) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, SUNBURST_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);

    // Half of 12d6, range 6-36
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 6-36 range: got ${dmgDealt}`,
      dmgDealt >= 6 && dmgDealt <= 36);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
    // KEY: NOT blinded on successful save
    assert('Enemy is NOT blinded on successful save', !enemy.conditions.has('blinded'));
    // No condition_add log for this target
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
  }
}

// ---- 6. execute — multi-target AoE + multi-blindness --------

console.log('\n=== 6. execute — multi-target AoE + multi-blindness ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Both enemies weak (CON 1) — both fail save vs DC 25 → both blinded
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 1, y: 1, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 2 targets (e1, e2)', targets !== null && targets.length === 2);
  if (targets) {
    execute(caster, targets, state);
    // Both fail save → both blinded
    assert('e1 (CON 1, failed save) IS blinded', e1.conditions.has('blinded'));
    assert('e2 (CON 1, failed save) IS blinded', e2.conditions.has('blinded'));
    // 2 save-fails (one per target)
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('2 save-fail logs (one per target)', saveFails.length, 2);
    // 2 damage logs (one per target)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('2 damage logs emitted (one per target)', dmgLogs.length, 2);
    // 2 condition-add logs (one per blinded target)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('2 condition-add logs (one per blinded target)', condAdds.length, 2);
  }
}

// ---- 7. execute — already-blinded target (no double-apply) -----

console.log('\n=== 7. execute — already-blinded target ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-blind the enemy
  enemy.conditions.add('blinded' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    execute(caster, targets, state);
    // Still blinded (was already)
    assert('Enemy still blinded after re-cast', enemy.conditions.has('blinded'));
    // No SECOND activeEffect added (skip-if-already-blinded guard)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Sunburst');
    eq('No Sunburst activeEffect added (already blinded)', ckEffects.length, 0);
    // Damage still applied
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-blinded target', dmgLogs.length, 1);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeWizard();
  let cleanupOk = true;
  try { (require('../spells/sunburst') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 12d6 -------------------------------

console.log('\n=== 9. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(12);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(12) min >= 12 (got ${min})`, min >= 12);
  assert(`rollDamage(12) max <= 72 (got ${max})`, max <= 72);
}

// ---- Summary --------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
