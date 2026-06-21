// ============================================================
// cone_of_cold.test.ts — Cone of Cold bespoke spell module (Session 21)
// PHB p.229: 5th-level evocation, action, range Self (60-ft cone),
// NO concentration. Effect: CON save. On fail: 8d8 cold. On success:
// half. AoE: 60-ft cone from caster toward the highest-threat enemy
// within 60 ft (uses the existing inConeFt helper — same one Burning
// Hands uses).
//
// Migrated from the Session 19 generic dispatch registry in Session 21.
// Mirrors fireball.test.ts but with Cone of Cold's stats (L5, 8d8
// cold, 60-ft cone, CON save). Uses withSlots5 instead of withSlots3.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/cone_of_cold';
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

const COC_ACTION: Action = {
  name: 'Cone of Cold',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Cone of Cold (CON save, 8d8 cold, 60-ft cone)',
};

const COC_ACTION_LOW_DC: Action = {
  ...COC_ACTION,
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

/** Wizard at pos (0,0,0) with Cone of Cold + 2 5th-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = COC_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots5(2),
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

eq('Name is Cone of Cold', metadata.name, 'Cone of Cold');
eq('Level is 5', metadata.level, 5);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 8', metadata.dieCount, 8);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is cold', metadata.damageType, 'cold');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Cone of Cold action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots5(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Cone of Cold action', shouldCast(caster, bf), null);
}
// 2b. No 5th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [COC_ACTION], resources: withSlots5(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // 50 squares away on +X = 250 ft (chebyshev) — well beyond 60-ft cone range
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → [enemy]
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns array with 1 target when single enemy in range', result !== null && result.length === 1);
  if (result) eq('Target is the enemy', result[0].id, 'e1');
}

// ---- 3. shouldCast target selection (cone AoE) ----------------------

console.log('\n=== 3. shouldCast target selection (cone AoE) ===\n');

// 3a. Cone aimed at highest-threat enemy on +X axis; catches in-cone
// enemies (in front of caster) and excludes enemies behind the caster.
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Far enemy at (12,0,0) = 60 ft away on +X axis (highest threat → aim)
  const aimAt = makeWeakEnemy('aimAt', { x: 12, y: 0, z: 0 }, { maxHP: 300 });
  // In-cone enemy on +X axis (15 ft from caster, well inside cone)
  const inCone1 = makeWeakEnemy('inCone1', { x: 3, y: 0, z: 0 }, { maxHP: 50 });
  // In-cone enemy slightly off-axis but inside the 26.57° half-angle
  // (at (6,1,0): angle = atan(1/6) ≈ 9.5° < 26.57° → in cone)
  const inCone2 = makeWeakEnemy('inCone2', { x: 6, y: 1, z: 0 }, { maxHP: 50 });
  // Behind-caster enemy at (-3,0,0) — angle = 180° > 26.57° → excluded
  const behind = makeWeakEnemy('behind', { x: -3, y: 0, z: 0 }, { maxHP: 50 });
  // Off-side enemy at (0,3,0) — angle = 90° > 26.57° → excluded
  const side = makeWeakEnemy('side', { x: 0, y: 3, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, aimAt, inCone1, inCone2, behind, side]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = result.map(c => c.id).sort();
    assert('Includes aimAt (on-axis, 60 ft)', ids.includes('aimAt'));
    assert('Includes inCone1 (on-axis, 15 ft)', ids.includes('inCone1'));
    assert('Includes inCone2 (off-axis 9.5°, inside half-angle 26.57°)', ids.includes('inCone2'));
    assert('Excludes behind-caster enemy (180° > half-angle)', !ids.includes('behind'));
    assert('Excludes side enemy (90° > half-angle)', !ids.includes('side'));
    eq('Total 3 targets caught (3 in-cone + 0 out-of-cone)', result.length, 3);
  }
}

// 3b. Threat selection — highest maxHP is the aim point
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 3, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 6, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  // Both on +X axis → both in cone. highT is the aim point (higher threat).
  if (result) {
    eq('Both in-cone enemies caught', result.length, 2);
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
  assert('shouldCast returns 1 target', targets !== null && targets.length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);

    // 4a. Slot consumed
    eq('Slot consumed (5th level: 2 → 1)',
      (caster.resources as any).spellSlots[5].remaining, 1);
    // 4b. Damage applied (8d8 avg 36, range 8-64)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 8d8 range (8-64): got ${dmgDealt}`, dmgDealt >= 8 && dmgDealt <= 64);
    // 4c. Log events
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, COC_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);

    // 5a. Damage applied (half of 8d8, range 4-32)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-32 range: got ${dmgDealt}`, dmgDealt >= 4 && dmgDealt <= 32);
    // 5b. Save-success log
    const saveSuccess = state.log.events.filter(e => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target cone AoE -----------------------------

console.log('\n=== 6. execute — multi-target cone AoE ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // 3 in-cone enemies on +X axis
  const e1 = makeWeakEnemy('e1', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 6, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeWeakEnemy('e3', { x: 9, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Behind-caster enemy — should NOT be damaged
  const behind = makeWeakEnemy('behind', { x: -3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e3, behind]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 in-cone targets (behind excluded)',
    targets !== null && targets.length === 3);
  if (targets) {
    const hpBehindBefore = behind.currentHP;
    execute(caster, targets, state);
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    eq('3 save-fail logs emitted (one per in-cone target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    eq('3 damage logs emitted (one per in-cone target)', dmgLogs.length, 3);
    // Behind-caster enemy took no damage (not in cone)
    eq('Behind-caster enemy took no damage', behind.currentHP, hpBehindBefore);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeWizard();
  let cleanupOk = true;
  try { (require('../spells/cone_of_cold') as any).cleanup(caster); }
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
