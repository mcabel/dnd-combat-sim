// ============================================================
// fireball.test.ts — Fireball bespoke spell module (Session 21)
// PHB p.241: 3rd-level evocation, action, range 150 ft, NO concentration.
// Effect: DEX save. On fail: 8d6 fire. On success: half. AoE: 20-ft
//         radius around the highest-threat enemy within 150 ft.
//
// Migrated from the Session 19 generic dispatch registry in Session 21.
// Mirrors shatter.test.ts but with Fireball's stats (L3, 8d6 fire, 20-ft
// radius, 150-ft range, DEX save).
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/fireball';
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

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const FIREBALL_ACTION: Action = {
  name: 'Fireball',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Fireball (DEX save, 8d6 fire, 20-ft radius AoE)',
};

const FIREBALL_ACTION_LOW_DC: Action = {
  ...FIREBALL_ACTION,
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

/** Wizard at pos (0,0,0) with Fireball + 2 3rd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = FIREBALL_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots3(2),
  });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Fireball', metadata.name, 'Fireball');
eq('Level is 3', metadata.level, 3);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 150 ft', metadata.rangeFt, 150);
eq('AoE radius is 20 ft', metadata.aoeRadiusFt, 20);
eq('Die count is 8', metadata.dieCount, 8);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is fire', metadata.damageType, 'fire');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Fireball action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots3(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Fireball action', shouldCast(caster, bf), null);
}
// 2b. No 3rd-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [FIREBALL_ACTION], resources: withSlots3(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft away > 150 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → [enemy]
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns array with 1 target when single enemy in range', result !== null && result.length === 1);
  if (result) eq('Target is the enemy', result[0].id, 'e1');
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
  // Distant enemy (outside 20 ft of center but within 150 ft of caster)
  const far = makeWeakEnemy('far', { x: 10, y: 10, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, center, nearby, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = result.map(c => c.id).sort();
    // 'far' is at (10,10), center is at (5,0) — chebyshev = 10 → 50 ft > 20 ft radius
    // 'nearby' is at (5,4), center is at (5,0) — chebyshev = 4 → 20 ft ≤ 20 ft radius
    // 'center' is at (5,0), center is at (5,0) — chebyshev = 0 → 0 ft ≤ 20 ft radius
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
  // Both enemies within 20 ft of each other — both should be in the result
  // (highT is the center because higher threat; lowT is within 20 ft of highT)
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

    // 4a. Slot consumed
    eq('Slot consumed (3rd level: 2 → 1)',
      (caster.resources as any).spellSlots[3].remaining, 1);
    // 4b. Damage applied (8d6 avg 28, range 8-48)
    const hpAfter = enemy.currentHP;
    const dmgDealt = hpBefore - hpAfter;
    assert(`Damage in 8d6 range (8-48): got ${dmgDealt}`, dmgDealt >= 8 && dmgDealt <= 48);
    // 4c. Log events
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, FIREBALL_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);

    // 5a. Damage applied (half of 8d6, range 4-24)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-24 range: got ${dmgDealt}`, dmgDealt >= 4 && dmgDealt <= 24);
    // 5b. Save-success log
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (DEX 30 vs DC 5)', saveSuccess.length === 1);
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
  // e1 (maxHP 1000) and e2 (maxHP 1000) — tie, both are highest. e3 (maxHP 1000) too.
  // Wait — all have maxHP 1000. shouldCast picks the first one as center (highest threat,
  // tie-broken by closest). e1 is at chebyshev 1 (5 ft); e2 at chebyshev 1 (5 ft); e3 at
  // chebyshev 10 (50 ft). So center = e1 or e2 (tie-broken by which appears first in
  // bf.combatants iteration order). e1 is at (1,0) and e2 at (1,1) — both 5 ft from caster.
  // The first one iterated becomes the center. Within 20 ft of e1: e1 (0), e2 (5 ft), e3 (45 ft).
  // So targets = [e1, e2]. e3 is excluded.
  assert('shouldCast returns 2 targets (e1, e2)', targets !== null && targets.length === 2);
  if (targets) {
    execute(caster, targets, state);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('2 save-fail logs emitted (one per target)', saveFails.length, 2);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('2 damage logs emitted (one per target)', dmgLogs.length, 2);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeWizard();
  // Cleanup runs without error
  let cleanupOk = true;
  try { (require('../spells/fireball') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 8d6 --------------------------------

console.log('\n=== 8. rollDamage ===\n');

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
