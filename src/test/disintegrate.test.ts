// ============================================================
// disintegrate.test.ts — Disintegrate bespoke spell module (Session 23)
// PHB p.233: 6th-level transmutation, action, range 60 ft, NO concentration.
// Effect: DEX save. On fail: 10d6+40 force. On success: half (total halved).
//         Single-target. Disintegrate-on-0-HP simplified (no ash-pile state).
//
// Migrated from the Session 19 generic dispatch registry in Session 23.
// Mirrors catapult.test.ts but with Disintegrate's stats (L6, 10d6+40 force,
// 60-ft range, DEX save, flat +40 bonus). This is the FIRST spell in v1
// with a flat damage bonus on a save spell.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/disintegrate';
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

const DISINTEGRATE_ACTION: Action = {
  name: 'Disintegrate',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: 'force',
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 6,
  costType: 'action',
  legendaryCost: 0,
  description: 'Disintegrate (DEX save, 10d6+40 force, single-target)',
};

const DISINTEGRATE_ACTION_LOW_DC: Action = {
  ...DISINTEGRATE_ACTION,
  saveDC: 5,            // guaranteed-success DC (DEX 30 → min 11 ≥ 5)
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

/** Wizard at pos (0,0,0) with Disintegrate + 2 6th-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = DISINTEGRATE_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots6(2),
  });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 1,
    pos,
    ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 30,
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Disintegrate', metadata.name, 'Disintegrate');
eq('Level is 6', metadata.level, 6);
eq('School is transmutation', metadata.school, 'transmutation');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 10', metadata.dieCount, 10);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Flat damage bonus is 40', metadata.flatDamageBonus, 40);
eq('Damage type is force', metadata.damageType, 'force');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Disintegrate action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots6(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Disintegrate action', shouldCast(caster, bf), null);
}
// 2b. No 6th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [DISINTEGRATE_ACTION], resources: withSlots6(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 6th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft away > 60 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → enemy
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when single enemy in range', result !== null);
  if (result) eq('Target is the enemy', result.id, 'e1');
}

// ---- 3. shouldCast target selection (kill-shot bias) -----------

console.log('\n=== 3. shouldCast target selection (kill-shot bias) ===\n');

// 3a. Lowest-current-HP enemy is the target (kill-shot bias)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const highHp = makeWeakEnemy('highHp', { x: 1, y: 0, z: 0 }, { maxHP: 500, currentHP: 200 });
  const lowHp = makeWeakEnemy('lowHp', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 50 });
  const bf = makeBF([caster, highHp, lowHp]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    eq('Picks lowest-current-HP enemy (kill-shot bias)', result.id, 'lowHp');
  }
}
// 3b. Returns a single Combatant (not array)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, e1, e2]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant (not array)',
    result !== null && !Array.isArray(result));
}

// ---- 4. execute — guaranteed fail (full damage with flat bonus) --

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (6th level: 2 → 1)',
      (caster.resources as any).spellSlots[6].remaining, 1);
    // 4b. Damage applied (10d6+40 range 50-100)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 10d6+40 range (50-100): got ${dmgDealt}`,
      dmgDealt >= 50 && dmgDealt <= 100);
    // 4c. Log events
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage, total halved) --

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, DISINTEGRATE_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Damage applied (half of 10d6+40, range 25-50)
    // Total is 10d6+40 (50-100), halved = 25-50
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 25-50 range: got ${dmgDealt}`,
      dmgDealt >= 25 && dmgDealt <= 50);
    // 5b. Save-success log
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (DEX 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — death + disintegrate flavour log -----------

console.log('\n=== 6. execute — death + disintegrate flavour log ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Enemy with 10 HP — guaranteed to die from 10d6+40 (min 50)
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 10, currentHP: 10 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);

    // 6a. Enemy is dead
    assert('Enemy is dead (HP 10 → 0, killed by 10d6+40)', enemy.isDead === true);
    eq('Enemy currentHP is 0', enemy.currentHP, 0);
    // 6b. Death log emitted with disintegrate flavour
    const deathLogs = state.log.events.filter((e: any) => e.type === 'death');
    assert('Death log emitted', deathLogs.length === 1);
    if (deathLogs.length === 1) {
      assert('Death log mentions "fine gray dust"',
        deathLogs[0].description.includes('fine gray dust'));
    }
  }
}

// ---- 7. rollDamage range (with and without flat bonus) --------

console.log('\n=== 7. rollDamage range ===\n');

{
  // With flat bonus: 10d6+40 = 50-100
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage() with flat: min ≥ 50: got ${min}`, min >= 50);
  assert(`rollDamage() with flat: max ≤ 100: got ${max}`, max <= 100);

  // Without flat bonus (dice only): 10d6 = 10-60
  let minNoFlat = Infinity, maxNoFlat = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < minNoFlat) minNoFlat = r;
    if (r > maxNoFlat) maxNoFlat = r;
  }
  assert(`rollDamage(false) dice-only: min ≥ 10: got ${minNoFlat}`, minNoFlat >= 10);
  assert(`rollDamage(false) dice-only: max ≤ 60: got ${maxNoFlat}`, maxNoFlat <= 60);
}

// ---- 8. cleanup is a no-op ------------------------------------

console.log('\n=== 8. cleanup is a no-op ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const hpBefore = caster.currentHP;
  const { cleanup } = require('../spells/disintegrate');
  cleanup(caster);
  eq('cleanup does not change currentHP', caster.currentHP, hpBefore);
  assert('cleanup does not set isDead', caster.isDead === false);
}

// ---- Summary --------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
