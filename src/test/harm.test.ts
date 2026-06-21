// ============================================================
// harm.test.ts — Harm bespoke spell module (Session 23)
// PHB p.249: 6th-level necromancy, action, range 60 ft, NO concentration.
// Effect: CON save. On fail: 14d6 necrotic. On success: half.
//         Single-target. Max-HP-reduction rider simplified (no field in v1).
//
// Migrated from the Session 19 generic dispatch registry in Session 23.
// Mirrors catapult.test.ts / blight.test.ts but with Harm's stats (L6,
// 14d6 necrotic, 60-ft range, CON save).
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/harm';
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

const HARM_ACTION: Action = {
  name: 'Harm',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: 'necrotic',
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: false,         // v1: single-target (despite SPELL_DB isAoE flag)
  isControl: false,
  requiresConcentration: false,
  slotLevel: 6,
  costType: 'action',
  legendaryCost: 0,
  description: 'Harm (CON save, 14d6 necrotic, single-target)',
};

const HARM_ACTION_LOW_DC: Action = {
  ...HARM_ACTION,
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

function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = HARM_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots6(2),
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

eq('Name is Harm', metadata.name, 'Harm');
eq('Level is 6', metadata.level, 6);
eq('School is necromancy', metadata.school, 'necromancy');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 14', metadata.dieCount, 14);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is necrotic', metadata.damageType, 'necrotic');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots6(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Harm action', shouldCast(caster, bf), null);
}
{
  const caster = makeCombatant('wiz', { actions: [HARM_ACTION], resources: withSlots6(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 6th-level slots', shouldCast(caster, bf), null);
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
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, e1, e2]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant (not array)',
    result !== null && !Array.isArray(result));
}

// ---- 4. execute — guaranteed fail (full damage 14d6) -----------

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

    eq('Slot consumed (6th level: 2 → 1)',
      (caster.resources as any).spellSlots[6].remaining, 1);
    // 14d6 range 14-84
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 14d6 range (14-84): got ${dmgDealt}`,
      dmgDealt >= 14 && dmgDealt <= 84);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, HARM_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // Half of 14d6, range 7-42
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 7-42 range: got ${dmgDealt}`,
      dmgDealt >= 7 && dmgDealt <= 42);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — single-target (no spillover) ----------------

console.log('\n=== 6. execute — single-target (no spillover) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
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

    const dmg1 = hpBeforeE1 - e1.currentHP;
    const dmg2 = hpBeforeE2 - e2.currentHP;
    const dmg3 = hpBeforeE3 - e3.currentHP;
    const damagedCount = [dmg1, dmg2, dmg3].filter(d => d > 0).length;
    eq('Exactly 1 enemy took damage (single-target spell)', damagedCount, 1);
  }
}

// ---- 7. rollDamage range --------------------------------------

console.log('\n=== 7. rollDamage range ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min ≥ 14 (14d6 min): got ${min}`, min >= 14);
  assert(`rollDamage max ≤ 84 (14d6 max): got ${max}`, max <= 84);
}

// ---- 8. cleanup is a no-op ------------------------------------

console.log('\n=== 8. cleanup is a no-op ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const hpBefore = caster.currentHP;
  const { cleanup } = require('../spells/harm');
  cleanup(caster);
  eq('cleanup does not change currentHP', caster.currentHP, hpBefore);
  assert('cleanup does not set isDead', caster.isDead === false);
}

// ---- Summary --------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
