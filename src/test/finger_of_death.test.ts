// ============================================================
// finger_of_death.test.ts — Finger of Death bespoke spell module (Session 23)
// PHB p.241: 7th-level necromancy, action, range 60 ft, NO concentration.
// Effect: CON save. On fail: 7d8+30 necrotic. On success: half (total halved).
//         Single-target. Zombie-raise-on-kill simplified (TG-006 pending).
//
// Migrated from the Session 19 generic dispatch registry in Session 23.
// Mirrors disintegrate.test.ts but with Finger of Death's stats (L7,
// 7d8+30 necrotic, 60-ft range, CON save, flat +30 bonus).
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/finger_of_death';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots7(remaining = 2): PlayerResources {
  return { spellSlots: { 7: { max: 2, remaining } } };
}

const FOD_ACTION: Action = {
  name: 'Finger of Death',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: 'necrotic',
  saveDC: 25,
  saveAbility: 'con',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 7,
  costType: 'action',
  legendaryCost: 0,
  description: 'Finger of Death (CON save, 7d8+30 necrotic, single-target)',
};

const FOD_ACTION_LOW_DC: Action = {
  ...FOD_ACTION,
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

function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = FOD_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots7(2),
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

eq('Name is Finger of Death', metadata.name, 'Finger of Death');
eq('Level is 7', metadata.level, 7);
eq('School is necromancy', metadata.school, 'necromancy');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 7', metadata.dieCount, 7);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Flat damage bonus is 30', metadata.flatDamageBonus, 30);
eq('Damage type is necrotic', metadata.damageType, 'necrotic');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots7(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Finger of Death action', shouldCast(caster, bf), null);
}
{
  const caster = makeCombatant('wiz', { actions: [FOD_ACTION], resources: withSlots7(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 7th-level slots', shouldCast(caster, bf), null);
}
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when single enemy in range', result !== null);
  if (result) eq('Target is the enemy', result.id, 'e1');
}

// ---- 3. shouldCast target selection (highest-threat bias) ------

console.log('\n=== 3. shouldCast target selection (highest-threat bias) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 2, y: 0, z: 0 }, { maxHP: 300, currentHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    eq('Picks highest-threat enemy (maxHP 300)', result.id, 'highT');
  }
}

// ---- 4. execute — guaranteed fail (full damage 7d8+30) --------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    eq('Slot consumed (7th level: 2 → 1)',
      (caster.resources as any).spellSlots[7].remaining, 1);
    // 7d8+30 range 37-86
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 7d8+30 range (37-86): got ${dmgDealt}`,
      dmgDealt >= 37 && dmgDealt <= 86);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, FOD_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // Half of 7d8+30 (37-86), halved = 18-43
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 18-43 range: got ${dmgDealt}`,
      dmgDealt >= 18 && dmgDealt <= 43);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — death + zombie-raise flavour log -----------

console.log('\n=== 6. execute — death + zombie-raise flavour log ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Enemy with 10 HP — guaranteed to die from 7d8+30 (min 37)
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 10, currentHP: 10 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);

    assert('Enemy is dead (HP 10 → 0, killed by 7d8+30)', enemy.isDead === true);
    eq('Enemy currentHP is 0', enemy.currentHP, 0);
    const deathLogs = state.log.events.filter((e: any) => e.type === 'death');
    assert('Death log emitted', deathLogs.length === 1);
    if (deathLogs.length === 1) {
      assert('Death log mentions necrotic energy / zombie-raise note',
        deathLogs[0].description.includes('necrotic') || deathLogs[0].description.includes('zombie'));
    }
  }
}

// ---- 7. rollDamage range (with and without flat bonus) --------

console.log('\n=== 7. rollDamage range ===\n');

{
  // With flat bonus: 7d8+30 = 37-86
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage() with flat: min ≥ 37: got ${min}`, min >= 37);
  assert(`rollDamage() with flat: max ≤ 86: got ${max}`, max <= 86);

  // Without flat bonus (dice only): 7d8 = 7-56
  let minNoFlat = Infinity, maxNoFlat = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < minNoFlat) minNoFlat = r;
    if (r > maxNoFlat) maxNoFlat = r;
  }
  assert(`rollDamage(false) dice-only: min ≥ 7: got ${minNoFlat}`, minNoFlat >= 7);
  assert(`rollDamage(false) dice-only: max ≤ 56: got ${maxNoFlat}`, maxNoFlat <= 56);
}

// ---- 8. cleanup is a no-op ------------------------------------

console.log('\n=== 8. cleanup is a no-op ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const hpBefore = caster.currentHP;
  const { cleanup } = require('../spells/finger_of_death');
  cleanup(caster);
  eq('cleanup does not change currentHP', caster.currentHP, hpBefore);
  assert('cleanup does not set isDead', caster.isDead === false);
}

// ---- Summary --------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
