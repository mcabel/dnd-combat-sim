// ============================================================
// chromatic_orb.test.ts — Chromatic Orb bespoke spell module
// (Session 21)
// PHB p.221: 1st-level evocation, action, range 90 ft,
// NO concentration. Effect: ranged spell attack vs AC. On hit: 3d8
// chosen-elemental damage (acid/cold/fire/lightning/poison/thunder).
// On crit: 6d8 (PHB p.196 — dice doubled).
//
// The caster chooses the damage type; v1 picks smartly via
// `pickDamageType(target)` — the FIRST type in ORB_DAMAGE_TYPES order
// that the target does NOT resist. If all types are resisted, falls
// back to the first type (acid).
//
// Migrated from the Session 20 generic dispatch registry in Session 21.
// Mirrors fireball.test.ts structure but with Chromatic Orb's stats
// (L1, ranged spell attack, 3d8 chosen-elemental, 90-ft range, crit
// doubles). Uses withSlots1.
//
// Attack rolls use deterministic hit-bonus extremes (mirrors the
// scorching_ray.test.ts pattern):
//   - hitBonus: 100  → guaranteed hit (nat 1 → 1+100=101 ≥ AC 14)
//                       5% chance of nat-20 crit (6d8 instead of 3d8)
//   - hitBonus: -100 → guaranteed miss (nat 20 auto-crits per PHB p.194)
//                       5% chance of crit-hit; tests accept either outcome
// Crit-doubling is verified deterministically by calling
// rollDamage(isCrit=true) and rollDamage(isCrit=false) directly.
// ============================================================

import {
  shouldCast, execute, metadata, rollDamage,
  pickDamageType, ORB_DAMAGE_TYPES,
} from '../spells/chromatic_orb';
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
const CO_ACTION: Action = {
  name: 'Chromatic Orb',
  isMultiattack: false,
  attackType: 'spell',  // ranged spell attack (spell attacks use 'spell' — see scorching_ray.test.ts)
  reach: 5,
  range: { normal: 90, long: 90 },
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
  description: 'Chromatic Orb (ranged spell attack, 3d8 chosen-elemental, crit 6d8)',
};

/** Guaranteed-miss action: hitBonus -100 → only nat-20 crits can hit */
const CO_ACTION_MISS: Action = {
  ...CO_ACTION,
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

/** Sorcerer at pos (0,0,0) with Chromatic Orb + 2 1st-level slots */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = CO_ACTION): Combatant {
  return makeCombatant('sorc', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots1(2),
  });
}

/** Enemy with AC 14 (default); within 90-ft range when at (1,0,0) */
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

eq('Name is Chromatic Orb', metadata.name, 'Chromatic Orb');
eq('Level is 1', metadata.level, 1);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 90 ft', metadata.rangeFt, 90);
eq('Die count is 3', metadata.dieCount, 3);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Not concentration', metadata.concentration, false);

// ---- 2. ORB_DAMAGE_TYPES constant --------------------------------

console.log('\n=== 2. ORB_DAMAGE_TYPES constant ===\n');

eq('ORB_DAMAGE_TYPES has 6 entries', ORB_DAMAGE_TYPES.length, 6);
eq('First type is acid', ORB_DAMAGE_TYPES[0], 'acid');
eq('Second type is cold', ORB_DAMAGE_TYPES[1], 'cold');
eq('Third type is fire', ORB_DAMAGE_TYPES[2], 'fire');
eq('Fourth type is lightning', ORB_DAMAGE_TYPES[3], 'lightning');
eq('Fifth type is poison', ORB_DAMAGE_TYPES[4], 'poison');
eq('Sixth type is thunder', ORB_DAMAGE_TYPES[5], 'thunder');

// ---- 3. pickDamageType — chooses non-resisted type ---------------

console.log('\n=== 3. pickDamageType ===\n');

// 3a. Target with no resistances → first type (acid)
{
  const target = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('No resistances → acid (first)', pickDamageType(target), 'acid' as DamageType);
}
// 3b. Target resisting fire → first NON-resisted type (acid)
{
  const target = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { resistances: ['fire'] });
  eq('Resists fire → acid (first non-resisted)', pickDamageType(target), 'acid' as DamageType);
}
// 3c. Target resisting acid + cold → next non-resisted (fire)
{
  const target = makeEnemy('e1', { x: 1, y: 0, z: 0 },
    { resistances: ['acid', 'cold'] });
  eq('Resists acid+cold → fire (first non-resisted)', pickDamageType(target), 'fire' as DamageType);
}
// 3d. Target resisting all 6 types → fallback to first (acid)
{
  const target = makeEnemy('e1', { x: 1, y: 0, z: 0 },
    { resistances: ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'] });
  eq('Resists all 6 → acid (fallback to first)', pickDamageType(target), 'acid' as DamageType);
}
// 3e. Target resisting the first 5 types → last type (thunder)
{
  const target = makeEnemy('e1', { x: 1, y: 0, z: 0 },
    { resistances: ['acid', 'cold', 'fire', 'lightning', 'poison'] });
  eq('Resists first 5 → thunder (last non-resisted)', pickDamageType(target), 'thunder' as DamageType);
}

// ---- 4. shouldCast gates --------------------------------------

console.log('\n=== 4. shouldCast gates ===\n');

// 4a. No Chromatic Orb action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots1(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Chromatic Orb action', shouldCast(caster, bf), null);
}
// 4b. No 1st-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [CO_ACTION], resources: withSlots1(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots', shouldCast(caster, bf), null);
}
// 4c. No enemies in range → null
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 90 ft range
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

// ---- 5. shouldCast target selection (single enemy within 90 ft) ----

console.log('\n=== 5. shouldCast target selection ===\n');

// 5a. Highest-threat enemy within 90 ft is chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const lowT = makeEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 90 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}

// 5b. Enemy beyond 90 ft is NOT chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // Enemy 19 squares away = 95 ft > 90 ft range
  const outOfRange = makeEnemy('oor', { x: 19, y: 0, z: 0 }, { maxHP: 999 });
  // In-range weak enemy
  const inRange = makeEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 95-ft high-threat one)',
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
    // 6b. Damage applied: 3d8 (range 3-24) on hit, 6d8 (range 6-48) on nat-20 crit
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 3d8 OR 6d8 range (3-48): got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 48);
    // 6c. Log events — action + (attack_hit OR attack_crit) + damage
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    const hitOrCrit = state.log.events.filter(
      e => e.type === 'attack_hit' || e.type === 'attack_crit');
    eq('Exactly 1 attack_hit/attack_crit event emitted', hitOrCrit.length, 1);
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
  }
}

// ---- 7. execute — guaranteed miss (hitBonus -100) -----------------

console.log('\n=== 7. execute — guaranteed miss (hitBonus -100) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 }, CO_ACTION_MISS);
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
    // 7b. Damage is 0 (miss) OR 6-48 (rare nat-20 crit-hit)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in [0, 48] (miss or rare crit): got ${dmgDealt}`,
      dmgDealt >= 0 && dmgDealt <= 48);
    // 7c. No plain attack_hit event (nat 20 → crit path; otherwise miss)
    const hitEvents = state.log.events.filter(e => e.type === 'attack_hit');
    eq('No plain attack_hit event (miss or crit only)', hitEvents.length, 0);
    // 7d. Either attack_miss OR attack_crit was emitted (1 attack roll total)
    const missEvents = state.log.events.filter(e => e.type === 'attack_miss');
    const critEvents = state.log.events.filter(e => e.type === 'attack_crit');
    eq('Exactly 1 attack event (miss or crit)', missEvents.length + critEvents.length, 1);
  }
}

// ---- 8. rollDamage — isCrit=false returns 3d8 (range 3-24) --------

console.log('\n=== 8. rollDamage(isCrit=false) — 3d8 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(false) min >= 3 (got ${min})`, min >= 3);
  assert(`rollDamage(false) max <= 24 (got ${max})`, max <= 24);
}

// ---- 9. rollDamage — isCrit=true returns 6d8 (range 6-48) ---------

console.log('\n=== 9. rollDamage(isCrit=true) — 6d8 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true) min >= 6 (got ${min})`, min >= 6);
  assert(`rollDamage(true) max <= 48 (got ${max})`, max <= 48);
}

// ---- 10. Cleanup is a no-op ------------------------------------

console.log('\n=== 10. Cleanup is a no-op ===\n');

{
  const caster = makeSorcerer();
  let cleanupOk = true;
  try { (require('../spells/chromatic_orb') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
