// ============================================================
// chaos_bolt.test.ts — Chaos Bolt bespoke spell module (Session 24)
// XGE p.151: 1st-level evocation, action, range 120 ft,
// NO concentration. Effect: ranged spell attack vs AC. On hit: 2d8
// RANDOM damage type (acid/cold/fire/lightning/poison/thunder — chaos
// flavour). On crit: 4d8 (PHB p.196 — dice doubled).
//
// v1 simplification: the caster chooses the damage type per XGE p.151;
// v1 picks a RANDOM type per cast to reflect the "chaotic energy" theme.
// This differs from Chromatic Orb's smart picker (first non-resisted
// type). pickDamageType() takes NO arguments — it rolls a fresh random
// type each call.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors chromatic_orb.test.ts structure but with Chaos Bolt's stats
// (L1, ranged spell attack, 2d8 random-type, 120-ft range, crit 4d8).
// Uses withSlots1.
//
// Attack rolls use deterministic hit-bonus extremes (mirrors the
// chromatic_orb.test.ts pattern):
//   - hitBonus: 100  → guaranteed hit (nat 1 → 1+100=101 ≥ AC 14)
//                       5% chance of nat-20 crit (4d8 instead of 2d8)
//   - hitBonus: -100 → guaranteed miss (nat 20 auto-crits per PHB p.194)
//                       5% chance of crit-hit; tests accept either outcome
// Crit-doubling is verified deterministically by calling
// rollDamage(isCrit=true) and rollDamage(isCrit=false) directly.
// ============================================================

import {
  shouldCast, execute, metadata, rollDamage,
  pickDamageType, CHAOS_DAMAGE_TYPES,
} from '../spells/chaos_bolt';
import { Combatant, Action, PlayerResources, Vec3, Condition, DamageType } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots1(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

/** Guaranteed-hit action: hitBonus +100 vs AC 14 → nat 1 hits (101 ≥ 14) */
const CB_ACTION: Action = {
  name: 'Chaos Bolt',
  isMultiattack: false,
  attackType: 'spell',  // ranged spell attack
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
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Chaos Bolt (ranged spell attack, 2d8 random-type, crit 4d8)',
};

/** Guaranteed-miss action: hitBonus -100 → only nat-20 crits can hit */
const CB_ACTION_MISS: Action = {
  ...CB_ACTION,
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

/** Sorcerer at pos (0,0,0) with Chaos Bolt + 2 1st-level slots */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = CB_ACTION): Combatant {
  return makeCombatant('sorc', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots1(2),
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

eq('Name is Chaos Bolt', metadata.name, 'Chaos Bolt');
eq('Level is 1', metadata.level, 1);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 120 ft', metadata.rangeFt, 120);
eq('Die count is 2', metadata.dieCount, 2);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Not concentration', metadata.concentration, false);

// ---- 2. CHAOS_DAMAGE_TYPES constant ----------------------------

console.log('\n=== 2. CHAOS_DAMAGE_TYPES constant ===\n');

eq('CHAOS_DAMAGE_TYPES has 6 entries', CHAOS_DAMAGE_TYPES.length, 6);
eq('First type is acid', CHAOS_DAMAGE_TYPES[0], 'acid');
eq('Second type is cold', CHAOS_DAMAGE_TYPES[1], 'cold');
eq('Third type is fire', CHAOS_DAMAGE_TYPES[2], 'fire');
eq('Fourth type is lightning', CHAOS_DAMAGE_TYPES[3], 'lightning');
eq('Fifth type is poison', CHAOS_DAMAGE_TYPES[4], 'poison');
eq('Sixth type is thunder', CHAOS_DAMAGE_TYPES[5], 'thunder');

// ---- 3. pickDamageType — returns one of the 6 valid types -----

console.log('\n=== 3. pickDamageType ===\n');

// 3a. Each call returns one of the 6 canonical chaos types.
{
  const valid = new Set<DamageType>(CHAOS_DAMAGE_TYPES as readonly DamageType[]);
  let allValid = true;
  for (let i = 0; i < 200; i++) {
    const t = pickDamageType();
    if (!valid.has(t)) { allValid = false; break; }
  }
  assert('pickDamageType always returns one of the 6 chaos types', allValid);
}
// 3b. Over many calls, multiple distinct types appear (sanity check that
// the random index isn't stuck on one value).
{
  const seen = new Set<DamageType>();
  for (let i = 0; i < 500; i++) seen.add(pickDamageType());
  assert(`pickDamageType returns multiple distinct types (got ${seen.size}/6)`,
    seen.size >= 2);
}

// ---- 4. shouldCast gates --------------------------------------

console.log('\n=== 4. shouldCast gates ===\n');

// 4a. No Chaos Bolt action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots1(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Chaos Bolt action', shouldCast(caster, bf), null);
}
// 4b. No 1st-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [CB_ACTION], resources: withSlots1(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots', shouldCast(caster, bf), null);
}
// 4c. No enemies in range → null
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 120 ft range
  const enemy = makeEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 4d. Single enemy in range → returns that enemy (single Combatant)
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  if (result) eq('Returns the single enemy (Combatant, not array)', (result as Combatant).id, 'e1');
}

// ---- 5. shouldCast target selection (single enemy within 120 ft) ----

console.log('\n=== 5. shouldCast target selection ===\n');

// 5a. Highest-threat enemy within 120 ft is chosen
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
// 5b. Enemy beyond 120 ft is NOT chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // Enemy 25 squares away = 125 ft > 120 ft range
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

// ---- 6. execute — guaranteed hit (hitBonus +100) ------------------

console.log('\n=== 6. execute — guaranteed hit (hitBonus +100) ===\n');

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

    // 6a. Slot consumed
    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 6b. Damage applied: 2d8 (range 2-16) on hit, 4d8 (range 4-32) on nat-20 crit
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d8 OR 4d8 range (2-32): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 32);
    // 6c. Log events — action + (attack_hit OR attack_crit) + damage
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length >= 1);
    const hitOrCrit = state.log.events.filter(
      e => e.type === 'attack_hit' || e.type === 'attack_crit');
    eq('Exactly 1 attack_hit/attack_crit event emitted', hitOrCrit.length, 1);
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // 6d. The logged damage description mentions one of the 6 chaos types
    const valid = new Set<string>(['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder']);
    const dmgDesc = (dmgLogs[0] as any)?.description ?? '';
    const mentioned = ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder']
      .filter(t => dmgDesc.toUpperCase().includes(t.toUpperCase()));
    assert(`Logged damage type is one of the 6 chaos types (got: ${mentioned.join(',') || 'NONE'})`,
      mentioned.length >= 1 && mentioned.every(t => valid.has(t)));
  }
}

// ---- 7. execute — guaranteed miss (hitBonus -100) -----------------

console.log('\n=== 7. execute — guaranteed miss (hitBonus -100) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 }, CB_ACTION_MISS);
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 7a. Slot still consumed on miss
    eq('Slot consumed even on miss (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 7b. Damage is 0 (miss) OR 4-32 (rare nat-20 crit-hit)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in [0, 32] (miss or rare crit): got ${dmgDealt}`,
      dmgDealt >= 0 && dmgDealt <= 32);
    // 7c. No plain attack_hit event (nat 20 → crit path; otherwise miss)
    const hitEvents = state.log.events.filter(e => e.type === 'attack_hit');
    eq('No plain attack_hit event (miss or crit only)', hitEvents.length, 0);
    // 7d. Either attack_miss OR attack_crit was emitted (1 attack roll total)
    const missEvents = state.log.events.filter(e => e.type === 'attack_miss');
    const critEvents = state.log.events.filter(e => e.type === 'attack_crit');
    eq('Exactly 1 attack event (miss or crit)', missEvents.length + critEvents.length, 1);
  }
}

// ---- 8. rollDamage — isCrit=false returns 2d8 (range 2-16) --------

console.log('\n=== 8. rollDamage(isCrit=false) — 2d8 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(false) min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamage(false) max <= 16 (got ${max})`, max <= 16);
}

// ---- 9. rollDamage — isCrit=true returns 4d8 (range 4-32) ---------

console.log('\n=== 9. rollDamage(isCrit=true) — 4d8 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true) min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamage(true) max <= 32 (got ${max})`, max <= 32);
}

// ---- 10. Cleanup is a no-op ------------------------------------

console.log('\n=== 10. Cleanup is a no-op ===\n');

{
  const caster = makeSorcerer();
  let cleanupOk = true;
  try { (require('../spells/chaos_bolt') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
