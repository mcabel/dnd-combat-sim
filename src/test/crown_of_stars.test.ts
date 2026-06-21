// ============================================================
// crown_of_stars.test.ts — Crown of Stars bespoke spell module (Session 24)
// XGE p.152: 7th-level evocation, action, range Self (canon: 7-mote storage
// over 1 hour, no concentration). v1: 7-mote storage simplified to a
// single one-shot ranged spell attack (4d12 radiant, crit doubles).
// Effect: ranged spell attack vs AC. On hit: 4d12 radiant. On crit: 8d24
// (dice doubled per PHB p.196).
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors chromatic_orb.test.ts structure but with Crown of Stars's stats
// (L7, ranged spell attack, 4d12 radiant, 120-ft range, crit doubles, v1
// 7-mote storage simplified). Uses withSlots7.
//
// Attack rolls use deterministic hit-bonus extremes (mirrors the
// chromatic_orb.test.ts pattern):
//   - hitBonus: 100  → guaranteed hit (nat 1 → 1+100=101 ≥ AC 14)
//                       5% chance of nat-20 crit (8d12 instead of 4d12)
//   - hitBonus: -100 → guaranteed miss (nat 20 auto-crits per PHB p.194)
//                       5% chance of crit-hit; tests accept either outcome
// Crit-doubling is verified deterministically by calling
// rollDamage(isCrit=true) and rollDamage(isCrit=false) directly.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/crown_of_stars';
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

function withSlots7(remaining = 2): PlayerResources {
  return { spellSlots: { 7: { max: 2, remaining } } };
}

/** Guaranteed-hit action: hitBonus +100 vs AC 14 → nat 1 hits (101 ≥ 14) */
const COS_ACTION: Action = {
  name: 'Crown of Stars',
  isMultiattack: false,
  attackType: 'spell',  // ranged spell attack (spell attacks use 'spell' — see chromatic_orb.test.ts)
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: 100,        // guaranteed hit (nat 1 → 101 ≥ AC 14)
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 7,
  costType: 'action',
  legendaryCost: 0,
  description: 'Crown of Stars (ranged spell attack, 4d12 radiant, crit 8d12)',
};

/** Guaranteed-miss action: hitBonus -100 → only nat-20 crits can hit */
const COS_ACTION_MISS: Action = {
  ...COS_ACTION,
  hitBonus: -100,
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

/** Sorcerer at pos (0,0,0) with Crown of Stars + 2 7th-level slots */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = COS_ACTION): Combatant {
  return makeCombatant('sorc', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots7(2),
  });
}

/** Enemy with AC 14 (default); within 120-ft range when at (1,0,0) */
function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Crown of Stars', metadata.name, 'Crown of Stars');
eq('Level is 7', metadata.level, 7);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 120 ft', metadata.rangeFt, 120);
eq('Die count is 4', metadata.dieCount, 4);
eq('Die sides is 12', metadata.dieSides, 12);
eq('Damage type is radiant', metadata.damageType, 'radiant');
eq('Not concentration', metadata.concentration, false);
eq('7-mote storage v1 simplified flag set', metadata.crownOfStars7MoteStorageV1Simplified, true);
eq('Crit doubles flag set', metadata.crownOfStarsCritDoublesV1, true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Crown of Stars action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots7(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Crown of Stars action', shouldCast(caster, bf), null);
}
// 2b. No 7th-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [COS_ACTION], resources: withSlots7(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 7th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 120 ft range
  const enemy = makeEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns that enemy (single Combatant)
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  if (result) eq('Returns the single enemy (Combatant, not array)', (result as Combatant).id, 'e1');
}

// ---- 3. shouldCast target selection (single enemy within 120 ft) ----

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Highest-threat enemy within 120 ft is chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const lowT = makeEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 120 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}

// 3b. Enemy beyond 120 ft is NOT chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 25 squares away = 125 ft > 120 ft range
  const outOfRange = makeEnemy('oor', { x: 25, y: 0, z: 0 }, { maxHP: 999 });
  // In-range weak enemy
  const inRange = makeEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 125-ft high-threat one)',
      (result as Combatant).id, 'ir');
  }
}

// ---- 4. execute — guaranteed hit (hitBonus +100) ------------------

console.log('\n=== 4. execute — guaranteed hit (hitBonus +100) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (7th level: 2 → 1)',
      (caster.resources as any).spellSlots[7].remaining, 1);
    // 4b. Damage applied: 4d12 (range 4-48) on hit, 8d12 (range 8-96) on nat-20 crit
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 4d12 OR 8d12 range (4-96): got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 96);
    // 4c. Log events — action + (attack_hit OR attack_crit) + damage
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const hitOrCrit = state.log.events.filter(
      (e: any) => e.type === 'attack_hit' || e.type === 'attack_crit');
    eq('Exactly 1 attack_hit/attack_crit event emitted', hitOrCrit.length, 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
  }
}

// ---- 5. execute — guaranteed miss (hitBonus -100) -----------------

console.log('\n=== 5. execute — guaranteed miss (hitBonus -100) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 }, COS_ACTION_MISS);
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Slot still consumed on miss
    eq('Slot consumed even on miss (7th level: 2 → 1)',
      (caster.resources as any).spellSlots[7].remaining, 1);
    // 5b. Damage is 0 (miss) OR 8-96 (rare nat-20 crit-hit)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in [0, 96] (miss or rare crit): got ${dmgDealt}`,
      dmgDealt >= 0 && dmgDealt <= 96);
    // 5c. No plain attack_hit event (nat 20 → crit path; otherwise miss)
    const hitEvents = state.log.events.filter((e: any) => e.type === 'attack_hit');
    eq('No plain attack_hit event (miss or crit only)', hitEvents.length, 0);
    // 5d. Either attack_miss OR attack_crit was emitted (1 attack roll total)
    const missEvents = state.log.events.filter((e: any) => e.type === 'attack_miss');
    const critEvents = state.log.events.filter((e: any) => e.type === 'attack_crit');
    eq('Exactly 1 attack event (miss or crit)', missEvents.length + critEvents.length, 1);
  }
}

// ---- 6. rollDamage — isCrit=false returns 4d12 (range 4-48) --------

console.log('\n=== 6. rollDamage(isCrit=false) — 4d12 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(false) min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamage(false) max <= 48 (got ${max})`, max <= 48);
}

// ---- 7. rollDamage — isCrit=true returns 8d12 (range 8-96) ---------

console.log('\n=== 7. rollDamage(isCrit=true) — 8d12 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true) min >= 8 (got ${min})`, min >= 8);
  assert(`rollDamage(true) max <= 96 (got ${max})`, max <= 96);
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeSorcerer();
  let cleanupOk = true;
  try { (require('../spells/crown_of_stars') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
