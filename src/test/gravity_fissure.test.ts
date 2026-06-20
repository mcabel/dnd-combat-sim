// ============================================================
// gravity_fissure.test.ts — Gravity Fissure bespoke spell module (Session 24)
// EGtW p.162: 6th-level evocation, action, range Self (100-ft line), NO
// concentration. Effect: CON save. On fail: 8d8 force. On success: half.
// AoE: 100-ft × 5-ft line from caster toward the highest-threat enemy
// within 100 ft (uses the inLineFt helper).
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors lightning_bolt.test.ts but with Gravity Fissure's stats (L6,
// 8d8 force, 100-ft × 5-ft line, CON save). Uses withSlots6.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/gravity_fissure';
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

function withSlots6(remaining = 2): PlayerResources {
  return { spellSlots: { 6: { max: 2, remaining } } };
}

const GF_ACTION: Action = {
  name: 'Gravity Fissure',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 100, long: 100 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 6,
  costType: 'action',
  legendaryCost: 0,
  description: 'Gravity Fissure (CON save, 8d8 force, 100-ft × 5-ft line)',
};

const GF_ACTION_LOW_DC: Action = {
  ...GF_ACTION,
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

/** Wizard at pos (0,0,0) with Gravity Fissure + 2 6th-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = GF_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots6(2),
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

eq('Name is Gravity Fissure', metadata.name, 'Gravity Fissure');
eq('Level is 6', metadata.level, 6);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 100 ft', metadata.rangeFt, 100);
eq('Line length is 100 ft', metadata.lineLengthFt, 100);
eq('Line width is 5 ft', metadata.lineWidthFt, 5);
eq('Die count is 8', metadata.dieCount, 8);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is force', metadata.damageType, 'force');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Gravity Fissure action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots6(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Gravity Fissure action', shouldCast(caster, bf), null);
}
// 2b. No 6th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [GF_ACTION], resources: withSlots6(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 6th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft away > 100 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → [enemy]
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns array with 1 target when single enemy in range', result !== null && (result as Combatant[]).length === 1);
  if (result) eq('Target is the enemy', (result as Combatant[])[0].id, 'e1');
}

// ---- 3. shouldCast target selection (line AoE) ----------------------

console.log('\n=== 3. shouldCast target selection (line AoE) ===\n');

// 3a. Line aimed at highest-threat enemy along +X axis; collects all
// on-axis enemies and excludes off-axis enemies (thin-rectangle approx:
// perpendicular distance <= 2.5 ft → only same-row cells qualify).
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Far enemy at (20,0,0) = 100 ft away on +X axis (highest threat → aim)
  const aimAt = makeWeakEnemy('aimAt', { x: 20, y: 0, z: 0 }, { maxHP: 300 });
  // On-axis enemies caught by the 100-ft × 5-ft line
  const onAxis1 = makeWeakEnemy('onAxis1', { x: 5, y: 0, z: 0 }, { maxHP: 50 });
  const onAxis2 = makeWeakEnemy('onAxis2', { x: 10, y: 0, z: 0 }, { maxHP: 50 });
  const onAxis3 = makeWeakEnemy('onAxis3', { x: 15, y: 0, z: 0 }, { maxHP: 50 });
  // Off-axis enemy at y=3 (perpendicular distance = 15 ft > 5/2 = 2.5 ft) — excluded
  const offAxis = makeWeakEnemy('offAxis', { x: 10, y: 3, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, aimAt, onAxis1, onAxis2, onAxis3, offAxis]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id).sort();
    assert('Includes aimAt (on-axis, 100 ft)', ids.includes('aimAt'));
    assert('Includes onAxis1 (on-axis, 25 ft)', ids.includes('onAxis1'));
    assert('Includes onAxis2 (on-axis, 50 ft)', ids.includes('onAxis2'));
    assert('Includes onAxis3 (on-axis, 75 ft)', ids.includes('onAxis3'));
    assert('Excludes offAxis (15 ft perpendicular > 2.5 ft half-width)', !ids.includes('offAxis'));
    eq('Total 4 targets caught (4 on-axis + 0 off-axis)', (result as Combatant[]).length, 4);
  }
}

// 3b. Threat selection — highest maxHP is the aim point
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 10, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  // Both on-axis → both caught. highT is the aim point (higher threat).
  if (result) {
    eq('Both on-axis enemies caught', (result as Combatant[]).length, 2);
  }
}

// ---- 4. execute — guaranteed fail (full damage) ----------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 1 target', targets !== null && (targets as Combatant[]).length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // 4a. Slot consumed
    eq('Slot consumed (6th level: 2 → 1)',
      (caster.resources as any).spellSlots[6].remaining, 1);
    // 4b. Damage applied (8d8 avg 36, range 8-64)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 8d8 range (8-64): got ${dmgDealt}`, dmgDealt >= 8 && dmgDealt <= 64);
    // 4c. Log events
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
    // No condition rider for Gravity Fissure
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, GF_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // 5a. Damage applied (half of 8d8, range 4-32)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-32 range: got ${dmgDealt}`, dmgDealt >= 4 && dmgDealt <= 32);
    // 5b. Save-success log
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target line AoE -----------------------------

console.log('\n=== 6. execute — multi-target line AoE ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // 3 on-axis enemies (all caught in the 100-ft × 5-ft line)
  const e1 = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 10, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeWeakEnemy('e3', { x: 15, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets', targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs emitted (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeWizard();
  let cleanupOk = true;
  try { (require('../spells/gravity_fissure') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 8d8 --------------------------------

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
