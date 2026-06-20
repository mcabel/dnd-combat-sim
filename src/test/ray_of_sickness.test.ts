// ============================================================
// ray_of_sickness.test.ts — Ray of Sickness bespoke spell module (Session 24)
// PHB p.271: 1st-level necromancy, action, range 60 ft, NO concentration.
// Effect: ranged spell attack vs AC. On hit: 2d8 poison + poisoned
// (v1 simplification: poisoned save folded into the hit — no second
// save; poisoned persists for v1 combat). On crit: 4d8 poison (PHB p.196
// — dice doubled) + poisoned. On miss: no damage, no poisoned.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors chromatic_orb.test.ts (ranged spell attack + crit doubling) +
// sunburst.test.ts (condition_apply on hit). Uses withSlots1.
//
// Attack rolls use deterministic hit-bonus extremes (mirrors the
// chromatic_orb.test.ts pattern):
//   - hitBonus: 100  → guaranteed hit (nat 1 → 1+100=101 ≥ AC 14)
//                       5% chance of nat-20 crit (4d8 instead of 2d8)
//   - hitBonus: -100 → guaranteed miss (nat 20 auto-crits per PHB p.194)
//                       5% chance of crit-hit; tests accept either outcome
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/ray_of_sickness';
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
const ROS_ACTION: Action = {
  name: 'Ray of Sickness',
  isMultiattack: false,
  attackType: 'spell',  // ranged spell attack
  reach: 5,
  range: { normal: 60, long: 60 },
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
  description: 'Ray of Sickness (ranged spell attack, 2d8 poison + poisoned on hit, crit 4d8)',
};

/** Guaranteed-miss action: hitBonus -100 → only nat-20 crits can hit */
const ROS_ACTION_MISS: Action = {
  ...ROS_ACTION,
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

/** Sorcerer at pos (0,0,0) with Ray of Sickness + 2 1st-level slots */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = ROS_ACTION): Combatant {
  return makeCombatant('sorc', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots1(2),
  });
}

/** Enemy with AC 14 (default); within 60-ft range when at (1,0,0) */
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

eq('Name is Ray of Sickness', metadata.name, 'Ray of Sickness');
eq('Level is 1', metadata.level, 1);
eq('School is necromancy', metadata.school, 'necromancy');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 2', metadata.dieCount, 2);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is poison', metadata.damageType, 'poison');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Ray of Sickness action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots1(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Ray of Sickness action', shouldCast(caster, bf), null);
}
// 2b. No 1st-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [ROS_ACTION], resources: withSlots1(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 60 ft range
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

// ---- 3. shouldCast target selection (single best target) --------

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Highest-threat enemy within 60 ft is chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const lowT = makeEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 60 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}
// 3b. Enemy beyond 60 ft is NOT chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 13 squares away = 65 ft > 60 ft range
  const outOfRange = makeEnemy('oor', { x: 13, y: 0, z: 0 }, { maxHP: 999 });
  const inRange = makeEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 65-ft high-threat one)',
      (result as Combatant).id, 'ir');
  }
}

// ---- 4. execute — guaranteed hit (damage + poisoned applied) -----

console.log('\n=== 4. execute — guaranteed hit (damage + poisoned) ===\n');

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
    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 4b. Damage applied: 2d8 (range 2-16) on hit, 4d8 (range 4-32) on nat-20 crit
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d8 OR 4d8 range (2-32): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 32);
    // 4c. Log events — action + (attack_hit OR attack_crit) + damage + condition_add
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length >= 1);
    const hitOrCrit = state.log.events.filter(
      e => e.type === 'attack_hit' || e.type === 'attack_crit');
    eq('Exactly 1 attack_hit/attack_crit event emitted', hitOrCrit.length, 1);
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // 4d. KEY: poisoned condition applied on hit
    assert('Enemy is poisoned (condition_apply fired)', enemy.conditions.has('poisoned'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (poisoned)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Ray of Sickness');
    assert('ActiveEffect recorded with spellName Ray of Sickness', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is poisoned', ckEffects[0].payload.condition, 'poisoned');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed miss (no damage, no poisoned) -------

console.log('\n=== 5. execute — guaranteed miss (no damage, no poisoned) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 }, ROS_ACTION_MISS);
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Slot still consumed on miss
    eq('Slot consumed even on miss (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 5b. Damage is 0 (miss) OR 4-32 (rare nat-20 crit-hit)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in [0, 32] (miss or rare crit): got ${dmgDealt}`,
      dmgDealt >= 0 && dmgDealt <= 32);
    // 5c. No plain attack_hit event (nat 20 → crit path; otherwise miss)
    const hitEvents = state.log.events.filter(e => e.type === 'attack_hit');
    eq('No plain attack_hit event (miss or crit only)', hitEvents.length, 0);
    // 5d. Either attack_miss OR attack_crit was emitted (1 attack roll total)
    const missEvents = state.log.events.filter(e => e.type === 'attack_miss');
    const critEvents = state.log.events.filter(e => e.type === 'attack_crit');
    eq('Exactly 1 attack event (miss or crit)', missEvents.length + critEvents.length, 1);
    // 5e. KEY: if it was a clean miss (no crit), NO poisoned condition applied
    if (critEvents.length === 0) {
      assert('Enemy NOT poisoned on clean miss', !enemy.conditions.has('poisoned'));
      const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
      eq('No condition-add log on clean miss', condAdds.length, 0);
    }
  }
}

// ---- 6. execute — already-poisoned target (no double-apply) -----

console.log('\n=== 6. execute — already-poisoned target ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-poison the enemy
  enemy.conditions.add('poisoned' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);
    // Still poisoned (was already)
    assert('Enemy still poisoned after re-cast', enemy.conditions.has('poisoned'));
    // No SECOND activeEffect added (skip-if-already-poisoned guard)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Ray of Sickness');
    eq('No Ray of Sickness activeEffect added (already poisoned)', ckEffects.length, 0);
    // Damage still applied on hit
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-poisoned target', dmgLogs.length, 1);
  }
}

// ---- 7. rollDamage — isCrit=false returns 2d8 (range 2-16) -------

console.log('\n=== 7. rollDamage(isCrit=false) — 2d8 ===\n');

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

// ---- 8. rollDamage — isCrit=true returns 4d8 (range 4-32) --------

console.log('\n=== 8. rollDamage(isCrit=true) — 4d8 ===\n');

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

// ---- 9. Cleanup is a no-op ------------------------------------

console.log('\n=== 9. Cleanup is a no-op ===\n');

{
  const caster = makeSorcerer();
  let cleanupOk = true;
  try { (require('../spells/ray_of_sickness') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
