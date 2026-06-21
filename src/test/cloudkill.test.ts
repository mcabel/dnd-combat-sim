// ============================================================
// cloudkill.test.ts — Cloudkill bespoke spell module (Session 23)
// PHB p.222: 5th-level conjuration, action, range 120 ft, NO concentration (v1).
// Effect: CON save. On fail: 5d8 poison. On success: half.
//         20-ft radius AoE. v1: one-shot (moving-AoE simplified).
//
// Migrated from the Session 19 generic dispatch registry in Session 23.
// Mirrors fireball.test.ts but with Cloudkill's stats (L5, 5d8 poison,
// 120-ft range, 20-ft radius AoE, CON save).
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/cloudkill';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

const CLOUDKILL_ACTION: Action = {
  name: 'Cloudkill',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: 'poison',
  saveDC: 25,
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: true,   // v2: concentration now modelled
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Cloudkill (CON save, 5d8 poison, 20-ft radius AoE)',
};

const CLOUDKILL_ACTION_LOW_DC: Action = {
  ...CLOUDKILL_ACTION,
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

function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = CLOUDKILL_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots5(2),
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

eq('Name is Cloudkill', metadata.name, 'Cloudkill');
eq('Level is 5', metadata.level, 5);
eq('School is conjuration', metadata.school, 'conjuration');
eq('Range is 120 ft', metadata.rangeFt, 120);
eq('AoE radius is 20 ft', metadata.aoeRadiusFt, 20);
eq('Die count is 5', metadata.dieCount, 5);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is poison', metadata.damageType, 'poison');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Concentration (v2 persistent)', metadata.concentration, true);
assert('v2 persistent flag', (metadata as any).cloudkillPersistentV2Implemented === true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots5(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Cloudkill action', shouldCast(caster, bf), null);
}
{
  const caster = makeCombatant('wiz', { actions: [CLOUDKILL_ACTION], resources: withSlots5(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}
{
  const caster = makeCombatant('wiz', { actions: [CLOUDKILL_ACTION], resources: withSlots5(2) });
  caster.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any;
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when already concentrating', shouldCast(caster, bf), null);
}
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft > 120 ft
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

// 3a. Highest-threat enemy is the AoE center; all within 20 ft are caught
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Far enemy (high threat, will be the center)
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 200 });
  // Near enemy (within 20 ft of center: chebyshev = 4 → 20 ft)
  const nearby = makeWeakEnemy('nearby', { x: 5, y: 4, z: 0 }, { maxHP: 50 });
  // Distant enemy (outside 20 ft of center but within 120 ft of caster)
  const far = makeWeakEnemy('far', { x: 10, y: 10, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, center, nearby, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = result.map(c => c.id).sort();
    assert('Includes center', ids.includes('center'));
    assert('Includes nearby (within 20 ft of center)', ids.includes('nearby'));
    assert('Excludes far (>20 ft from center)', !ids.includes('far'));
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

// ---- 4. execute — guaranteed fail (full damage) ----------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

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

    eq('Slot consumed (5th level: 2 → 1)',
      (caster.resources as any).spellSlots[5].remaining, 1);
    // 5d8 range 5-40
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 5d8 range (5-40): got ${dmgDealt}`,
      dmgDealt >= 5 && dmgDealt <= 40);
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    // Concentration started on caster
    assert('Concentration started on caster', caster.concentration?.active === true);
    eq('Concentration spell is Cloudkill', caster.concentration?.spellName, 'Cloudkill');
    // damage_zone applied on target for per-turn tick
    const dzEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Cloudkill' && e.effectType === 'damage_zone');
    assert('damage_zone effect on target', dzEffects.length === 1);
    if (dzEffects.length === 1) {
      eq('damage_zone dieCount', dzEffects[0].payload.dieCount, 5);
      eq('damage_zone dieSides', dzEffects[0].payload.dieSides, 8);
      eq('damage_zone damageType', dzEffects[0].payload.damageType, 'poison');
      eq('damage_zone IS concentration-sourced', dzEffects[0].sourceIsConcentration, true);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, CLOUDKILL_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);

    // Half of 5d8, range 2-20
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 2-20 range: got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 20);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
    // damage_zone still applied on target even on save success (per-turn tick)
    const dzEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Cloudkill' && e.effectType === 'damage_zone');
    assert('damage_zone effect applied even on save success', dzEffects.length === 1);
  }
}

// ---- 6. execute — multi-target AoE -----------------------------

console.log('\n=== 6. execute — multi-target AoE ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 1, y: 1, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeWeakEnemy('e3', { x: 10, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 }); // outside AoE
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  // All maxHP 1000 — center is e1 or e2 (closest). Within 20 ft of e1: e1, e2.
  assert('shouldCast returns 2 targets (e1, e2)', targets !== null && targets.length === 2);
  if (targets) {
    execute(caster, targets, state);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('2 save-fail logs emitted (one per target)', saveFails.length, 2);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('2 damage logs emitted (one per target)', dmgLogs.length, 2);
  }
}

// ---- 7. damage_zone removed on concentration break ===

console.log('\n=== 7. damage_zone removed on concentration break ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) { execute(caster, targets, state); }
  const dzBefore = enemy.activeEffects.filter((e: any) => e.spellName === 'Cloudkill' && e.effectType === 'damage_zone');
  assert('damage_zone present before conc break', dzBefore.length === 1);
  // Simulate concentration break
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  removeEffectsFromCaster('wiz', bf);
  const dzAfter = enemy.activeEffects.filter((e: any) => e.spellName === 'Cloudkill' && e.effectType === 'damage_zone');
  eq('damage_zone removed after conc break', dzAfter.length, 0);
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeWizard();
  let cleanupOk = true;
  try { (require('../spells/cloudkill') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 5d8 --------------------------------

console.log('\n=== 9. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 5 (got ${min})`, min >= 5);
  assert(`rollDamage max <= 40 (got ${max})`, max <= 40);
}

// ---- Summary --------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
