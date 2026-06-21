// ============================================================
// witch_bolt.test.ts — Witch Bolt bespoke spell module (Session 24)
// PHB p.289: 1st-level evocation, action, range 30 ft, CONCENTRATION
// (1 min). Effect: ranged spell attack vs AC. On hit: 1d12 lightning +
// START concentration (store targetId in caster.concentration). On each
// of your turns for the duration, you can use your action to deal 1d12
// lightning damage to the target automatically (DoT mode — no slot, no
// attack roll). The spell ends if you use your action for anything else.
//
// This is the FIRST spell in v1 with a per-turn ACTION-DoT gated on
// concentration — a NEW pattern. The execute path auto-detects DoT mode
// (caster.concentration.spellName === 'Witch Bolt') vs fresh-cast mode.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors chromatic_orb.test.ts (initial attack + crit doubling) +
// NEW DoT-mode tests. Uses withSlots1.
//
// Attack rolls use deterministic hit-bonus extremes:
//   - hitBonus: 100  → guaranteed hit (nat 1 → 1+100=101 ≥ AC 14)
//                       5% chance of nat-20 crit (2d12 instead of 1d12)
//   - hitBonus: -100 → guaranteed miss (nat 20 auto-crits per PHB p.194)
//                       5% chance of crit-hit; tests accept either outcome
//
// DoT mode setup (test c):
//   - Pre-set caster.concentration = { active: true, spellName: 'Witch Bolt',
//     dcIfHit: 10, targetId: enemy.id }
//   - shouldCast returns the linked enemy (DoT mode auto-detected)
//   - execute applies 1d12 lightning with NO slot consumed, NO attack roll
//
// DoT mode edge cases (test d):
//   - Linked target dead → shouldCast returns null
//   - Linked target > 30 ft away → shouldCast returns null
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/witch_bolt';
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

function withSlots1(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

/** Guaranteed-hit action: hitBonus +100 vs AC 14 → nat 1 hits (101 ≥ 14) */
const WB_ACTION: Action = {
  name: 'Witch Bolt',
  isMultiattack: false,
  attackType: 'spell',  // ranged spell attack
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: 100,        // guaranteed hit (nat 1 → 101 ≥ AC 14)
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,   // PHB p.289: concentration
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Witch Bolt (ranged spell attack, 1d12 lightning + conc DoT, crit 2d12)',
};

/** Guaranteed-miss action: hitBonus -100 → only nat-20 crits can hit */
const WB_ACTION_MISS: Action = {
  ...WB_ACTION,
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

/** Warlock at pos (0,0,0) with Witch Bolt + 2 1st-level slots */
function makeWarlock(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = WB_ACTION): Combatant {
  return makeCombatant('lock', {
    name: 'Warlock',
    pos,
    actions: [action],
    resources: withSlots1(2),
  });
}

/** Enemy with AC 14 (default); within 30-ft range when at (1,0,0) */
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

eq('Name is Witch Bolt', metadata.name, 'Witch Bolt');
eq('Level is 1', metadata.level, 1);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 30 ft', metadata.rangeFt, 30);
eq('Die count is 1', metadata.dieCount, 1);
eq('Die sides is 12', metadata.dieSides, 12);
eq('Damage type is lightning', metadata.damageType, 'lightning');
eq('IS concentration', metadata.concentration, true);

// ---- 2. shouldCast gates (fresh-cast mode) --------------------

console.log('\n=== 2. shouldCast gates (fresh-cast mode) ===\n');

// 2a. No Witch Bolt action → null
{
  const caster = makeCombatant('lock', { actions: [], resources: withSlots1(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Witch Bolt action', shouldCast(caster, bf), null);
}
// 2b. No 1st-level slots → null (fresh cast only)
{
  const caster = makeCombatant('lock', { actions: [WB_ACTION], resources: withSlots1(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots (fresh cast)', shouldCast(caster, bf), null);
}
// 2c. No enemies within 30 ft → null
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 30 ft range
  const enemy = makeEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 30 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns that enemy (single Combatant)
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  if (result) eq('Returns the single enemy (Combatant, not array)', (result as Combatant).id, 'e1');
}

// ---- 3. shouldCast target selection (fresh-cast mode) ----------

console.log('\n=== 3. shouldCast target selection (fresh-cast) ===\n');

// 3a. Highest-threat enemy within 30 ft is chosen
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  const lowT = makeEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeEnemy('highT', { x: 4, y: 0, z: 0 }, { maxHP: 300 }); // 20 ft
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 30 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}
// 3b. Enemy beyond 30 ft is NOT chosen
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  // 7 squares away = 35 ft > 30 ft range
  const outOfRange = makeEnemy('oor', { x: 7, y: 0, z: 0 }, { maxHP: 999 });
  const inRange = makeEnemy('ir', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 35-ft high-threat one)',
      (result as Combatant).id, 'ir');
  }
}

// ---- 4. execute — fresh cast, guaranteed hit (damage + conc set) --

console.log('\n=== 4. execute — fresh cast, guaranteed hit ===\n');

{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 4b. Damage applied: 1d12 (range 1-12) on hit, 2d12 (range 2-24) on nat-20 crit
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 1d12 OR 2d12 range (1-24): got ${dmgDealt}`,
      dmgDealt >= 1 && dmgDealt <= 24);
    // 4c. Log events — action + (attack_hit OR attack_crit) + damage + condition_add (conc)
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length >= 1);
    const hitOrCrit = state.log.events.filter(
      (e: any) => e.type === 'attack_hit' || e.type === 'attack_crit');
    eq('Exactly 1 attack_hit/attack_crit event emitted', hitOrCrit.length, 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // 4d. KEY: concentration set with spellName 'Witch Bolt' + targetId === enemy.id
    assert('Concentration is active', caster.concentration?.active === true);
    eq('Concentration spellName is "Witch Bolt"', caster.concentration?.spellName, 'Witch Bolt');
    eq('Concentration targetId === enemy.id', caster.concentration?.targetId ?? null, 'e1');
  }
}

// ---- 5. execute — fresh cast, guaranteed miss (no dmg, no conc) --

console.log('\n=== 5. execute — fresh cast, guaranteed miss ===\n');

{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 }, WB_ACTION_MISS);
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Slot still consumed on miss (PHB: slot is spent on the cast, not the hit)
    eq('Slot consumed even on miss (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 5b. Damage is 0 (miss) OR 2-24 (rare nat-20 crit-hit)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in [0, 24] (miss or rare crit): got ${dmgDealt}`,
      dmgDealt >= 0 && dmgDealt <= 24);
    // 5c. No plain attack_hit event (nat 20 → crit path; otherwise miss)
    const hitEvents = state.log.events.filter((e: any) => e.type === 'attack_hit');
    eq('No plain attack_hit event (miss or crit only)', hitEvents.length, 0);
    // 5d. Either attack_miss OR attack_crit was emitted (1 attack roll total)
    const missEvents = state.log.events.filter((e: any) => e.type === 'attack_miss');
    const critEvents = state.log.events.filter((e: any) => e.type === 'attack_crit');
    eq('Exactly 1 attack event (miss or crit)', missEvents.length + critEvents.length, 1);
    // 5e. KEY: concentration NOT set on miss (clean miss)
    if (critEvents.length === 0) {
      eq('Concentration NOT set on clean miss', caster.concentration, null);
    }
  }
}

// ---- 6. execute — DoT mode (pre-set concentration) -------------

console.log('\n=== 6. execute — DoT mode (auto-hit, no slot) ===\n');

// 6a. DoT mode: shouldCast returns the linked enemy
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 });   // 25 ft — within 30 ft
  // Pre-set Witch Bolt concentration with linked target
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: enemy.id,
  };
  const bf = makeBF([caster, enemy]);

  const result = shouldCast(caster, bf);
  assert('DoT mode: shouldCast returns the linked enemy', result !== null);
  if (result) eq('DoT mode: returns the linked target (e1)', (result as Combatant).id, 'e1');
}
// 6b. DoT mode: execute applies 1d12 lightning, NO slot consumed, NO attack roll
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: enemy.id,
  };
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const slotsBefore = (caster.resources as any).spellSlots[1].remaining;
  const target = shouldCast(caster, bf);
  assert('DoT mode: shouldCast returns the linked enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 6b.i. KEY: NO slot consumed in DoT mode (slot was spent on initial cast)
    eq('DoT mode: slot count UNCHANGED (no slot consumed)',
      (caster.resources as any).spellSlots[1].remaining, slotsBefore);
    // 6b.ii. Damage applied: 1d12 lightning (range 1-12 — no crit on DoT)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`DoT mode: damage in 1d12 range (1-12): got ${dmgDealt}`,
      dmgDealt >= 1 && dmgDealt <= 12);
    // 6b.iii. KEY: NO attack events (DoT is auto-hit, no attack roll)
    const hitEvents = state.log.events.filter((e: any) => e.type === 'attack_hit');
    eq('DoT mode: no attack_hit event', hitEvents.length, 0);
    const missEvents = state.log.events.filter((e: any) => e.type === 'attack_miss');
    eq('DoT mode: no attack_miss event', missEvents.length, 0);
    const critEvents = state.log.events.filter((e: any) => e.type === 'attack_crit');
    eq('DoT mode: no attack_crit event (no attack roll)', critEvents.length, 0);
    // 6b.iv. Only 'action' + 'damage' log events
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('DoT mode: action log emitted', actions.length >= 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('DoT mode: damage log emitted', dmgLogs.length, 1);
    // 6b.v. Concentration still active (DoT doesn't end it)
    assert('DoT mode: concentration still active after tick',
      caster.concentration?.active === true);
    eq('DoT mode: concentration spellName still Witch Bolt',
      caster.concentration?.spellName, 'Witch Bolt');
  }
}

// ---- 7. DoT mode — returns null when linked target down/out-of-range --

console.log('\n=== 7. DoT mode — null when linked target invalid ===\n');

// 7a. DoT mode: linked target DEAD → shouldCast returns null
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: enemy.id,
  };
  const bf = makeBF([caster, enemy]);
  eq('DoT mode: returns null when linked target is dead', shouldCast(caster, bf), null);
}
// 7b. DoT mode: linked target UNCONSCIOUS → shouldCast returns null
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { isUnconscious: true });
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: enemy.id,
  };
  const bf = makeBF([caster, enemy]);
  eq('DoT mode: returns null when linked target is unconscious', shouldCast(caster, bf), null);
}
// 7c. DoT mode: linked target > 30 ft away → shouldCast returns null
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  // 7 squares = 35 ft > 30 ft range
  const enemy = makeEnemy('e1', { x: 7, y: 0, z: 0 });
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: enemy.id,
  };
  const bf = makeBF([caster, enemy]);
  eq('DoT mode: returns null when linked target > 30 ft away', shouldCast(caster, bf), null);
}
// 7d. DoT mode: linked target exactly at 30 ft boundary → still valid
{
  const caster = makeWarlock({ x: 0, y: 0, z: 0 });
  // 6 squares = 30 ft (boundary — `> 30` is the cutoff, so 30 is still in range)
  const enemy = makeEnemy('e1', { x: 6, y: 0, z: 0 });
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: enemy.id,
  };
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('DoT mode: returns linked target at 30 ft boundary (inclusive)', result !== null);
}

// ---- 8. rollDamage — isCrit=false returns 1d12 (range 1-12) ------

console.log('\n=== 8. rollDamage(isCrit=false) — 1d12 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(false);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(false) min >= 1 (got ${min})`, min >= 1);
  assert(`rollDamage(false) max <= 12 (got ${max})`, max <= 12);
}

// ---- 9. rollDamage — isCrit=true returns 2d12 (range 2-24) -------

console.log('\n=== 9. rollDamage(isCrit=true) — 2d12 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true) min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamage(true) max <= 24 (got ${max})`, max <= 24);
}

// ---- 10. Cleanup clears Witch Bolt concentration ----------------

console.log('\n=== 10. Cleanup clears Witch Bolt concentration ===\n');

{
  const caster = makeWarlock();
  // Pre-set Witch Bolt concentration
  caster.concentration = {
    active: true,
    spellName: 'Witch Bolt',
    dcIfHit: 10,
    targetId: 'someEnemy',
  };
  (require('../spells/witch_bolt') as any).cleanup(caster);
  eq('cleanup() clears Witch Bolt concentration', caster.concentration, null);
}
// 10b. cleanup does NOT clear a non-Witch-Bolt concentration
{
  const caster = makeWarlock();
  caster.concentration = {
    active: true,
    spellName: 'Hold Person',
    dcIfHit: 10,
  };
  (require('../spells/witch_bolt') as any).cleanup(caster);
  eq('cleanup() does NOT clear non-Witch-Bolt concentration',
    caster.concentration?.spellName, 'Hold Person');
}
// 10c. cleanup is a no-op when concentration is already null
{
  const caster = makeWarlock();
  let cleanupOk = true;
  try { (require('../spells/witch_bolt') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw when concentration is null', cleanupOk);
  eq('Concentration still null after cleanup', caster.concentration, null);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
