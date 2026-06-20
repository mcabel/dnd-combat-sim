// ============================================================
// feeblemind.test.ts — Feeblemind bespoke spell module (Session 24)
// PHB p.239: 8th-level enchantment, action, range 60 ft, NO concentration.
// Effect (per PHB p.239 "takes 4d6 psychic damage AND must make an INT save"):
//   - 4d6 psychic damage is ALWAYS dealt (regardless of save outcome)
//   - On failed save: + incapacitated (v1 simplification of "INT/CHA→1")
//   - On successful save: just damage (NO half — full 4d6 either way)
// This is an UNUSUAL pattern — damage is NOT halved on save.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors wardaway.test.ts structure (single-target save) but with
// Feeblemind's stats (L8, INT save, 4d6 psychic, 60-ft range, always-damage
// + incapacitated on fail). Uses withSlots8.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - INT 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - INT 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/feeblemind';
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

const FM_ACTION: Action = {
  name: 'Feeblemind',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (INT 1 → max 15 < 25)
  saveAbility: 'int',
  isAoE: false,         // NOTE: single-target, NOT AoE
  isControl: false,
  requiresConcentration: false,
  slotLevel: 8,
  costType: 'action',
  legendaryCost: 0,
  description: 'Feeblemind (INT save, 4d6 psychic ALWAYS + incapacitated on fail, single-target)',
};

const FM_ACTION_LOW_DC: Action = {
  ...FM_ACTION,
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

/** Wizard at pos (0,0,0) with Feeblemind + 2 8th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = FM_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots8(2),
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

eq('Name is Feeblemind', metadata.name, 'Feeblemind');
eq('Level is 8', metadata.level, 8);
eq('School is enchantment', metadata.school, 'enchantment');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 4', metadata.dieCount, 4);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is psychic', metadata.damageType, 'psychic');
eq('Save ability is int', metadata.saveAbility, 'int');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Feeblemind action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots8(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Feeblemind action', shouldCast(caster, bf), null);
}
// 2b. No 8th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [FM_ACTION], resources: withSlots8(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 8th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 60 ft range
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns that enemy (single Combatant, NOT array)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  if (result) {
    eq('Returns the single enemy (Combatant, NOT array)',
      (result as Combatant).id, 'e1');
    assert('Result is a Combatant (has .id, no .length property)',
      typeof (result as any).id === 'string' && !Array.isArray(result));
  }
}

// ---- 3. shouldCast target selection (single best target) --------

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Highest-threat enemy within 60 ft is chosen (single target)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 60 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}
// 3b. Enemy beyond 60 ft is NOT chosen — falls back to in-range enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 13 squares away = 65 ft > 60 ft range
  const outOfRange = makeWeakEnemy('oor', { x: 13, y: 0, z: 0 }, { maxHP: 999 });
  // In-range weak enemy
  const inRange = makeWeakEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 65-ft high-threat one)',
      (result as Combatant).id, 'ir');
  }
}
// 3c. Single Combatant return type — verify NOT an array even with 3 enemies
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 50 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e1, e2, e3]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant even with 3 enemies in range',
    result !== null && !Array.isArray(result));
  if (result) {
    eq('Returns one specific Combatant (not array of 3)',
      typeof (result as Combatant).id, 'string');
  }
}

// ---- 4. execute — guaranteed fail (FULL damage + incapacitated) ----

console.log('\n=== 4. execute — guaranteed fail (full damage + incapacitated) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (8th level: 2 → 1)',
      (caster.resources as any).spellSlots[8].remaining, 1);
    // 4b. KEY: damage is ALWAYS dealt (4d6 psychic, range 4-24) regardless of save outcome.
    //     On fail: FULL 4d6 (NOT halved). The "half on save" rule does NOT apply to Feeblemind.
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in FULL 4d6 range (4-24) — NOT halved on fail: got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 24);
    // 4c. Save-fail log emitted
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (INT 1 vs DC 25)', saveFails.length === 1);
    // 4d. Damage log emitted
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
    // 4e. KEY: incapacitated condition applied on failed save
    assert('Enemy is incapacitated (condition_apply fired)', enemy.conditions.has('incapacitated'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (incapacitated)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Feeblemind');
    assert('ActiveEffect recorded with spellName Feeblemind', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is incapacitated', ckEffects[0].payload.condition, 'incapacitated');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (FULL damage, NO incapacitated) ----

console.log('\n=== 5. execute — guaranteed success (full damage, no incapacitated) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, FM_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. KEY: damage is STILL full 4d6 on save success (range 4-24, NOT halved).
    //     Feeblemind's damage is ALWAYS dealt (PHB p.239 "takes 4d6 AND must make an INT save").
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage STILL in FULL 4d6 range (4-24) on save success — NOT halved: got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 24);
    // 5b. Save-success log emitted
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (INT 30 vs DC 5)', saveSuccess.length === 1);
    // 5c. KEY: NOT incapacitated on successful save
    assert('Enemy is NOT incapacitated on successful save', !enemy.conditions.has('incapacitated'));
    // 5d. No condition_add log for this target
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
    // 5e. Damage log STILL emitted (damage is dealt regardless of save)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log STILL emitted on successful save (always-dealt damage)', dmgLogs.length, 1);
  }
}

// ---- 6. execute — single-target (no multi-target spillover) --------

console.log('\n=== 6. execute — single-target (no spillover) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 3 enemies in range; shouldCast picks ONE (highest threat)
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBeforeE1 = e1.currentHP;
    const hpBeforeE2 = e2.currentHP;
    const hpBeforeE3 = e3.currentHP;

    execute(caster, target as Combatant, state);

    // Only ONE enemy takes damage — Feeblemind is single-target
    const dmg1 = hpBeforeE1 - e1.currentHP;
    const dmg2 = hpBeforeE2 - e2.currentHP;
    const dmg3 = hpBeforeE3 - e3.currentHP;
    const damagedCount = [dmg1, dmg2, dmg3].filter(d => d > 0).length;
    eq('Exactly 1 enemy took damage (single-target spell)', damagedCount, 1);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('Only 1 save-fail log (single target)', saveFails.length, 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Only 1 damage log (single target)', dmgLogs.length, 1);
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('Only 1 condition-add log (single target)', condAdds.length, 1);
  }
}

// ---- 7. execute — already-incapacitated target (no double-apply) ----

console.log('\n=== 7. execute — already-incapacitated target ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-incapacitate the enemy
  enemy.conditions.add('incapacitated' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);
    // Still incapacitated (was already)
    assert('Enemy still incapacitated after re-cast', enemy.conditions.has('incapacitated'));
    // No SECOND activeEffect added (skip-if-already-incapacitated guard)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Feeblemind');
    eq('No Feeblemind activeEffect added (already incapacitated)', ckEffects.length, 0);
    // Damage still applied (always-dealt damage)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-incapacitated target', dmgLogs.length, 1);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/feeblemind') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 4d6 --------------------------------

console.log('\n=== 9. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamage max <= 24 (got ${max})`, max <= 24);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
