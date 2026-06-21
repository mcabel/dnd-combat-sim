// ============================================================
// spiritual_weapon.test.ts — Spiritual Weapon spell module
// PHB p.278: 2nd-level evocation, BONUS ACTION, range 60 ft, NO concentration (1 min).
// Effect: Melee spell attack vs target. On hit: 1d8 force. Subsequent turns
//         (canon: bonus action + attack roll) simplified to persistent
//         damage_zone 1d8 force/turn, ticksRemaining: 10 (no attack roll).
//
// Tests cover shouldCast() gates + target priority, execute() attack hit/miss
// resolution + immediate damage + damage_zone attachment (always, even on
// miss) + slot consumption + logging, rollDamage range check, cleanup no-op,
// integration pipeline, and metadata.
//
// Deterministic attack outcomes:
//   - Hit:  AC 5  + hitBonus +20 → min total 21 ≥ 5 (always hits, even nat 1)
//   - Miss: AC 30 + hitBonus +0  → max non-crit total 20 < 30 (nat 20 auto-crits)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/spiritual_weapon';
import { getActiveDamageZones } from '../engine/spell_effects';
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

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

/** Guaranteed-hit action: AC 5 + hitBonus +20 → min roll 1+20=21 ≥ 5 */
const SPIRITUAL_WEAPON_ACTION_HIT: Action = {
  name: 'Spiritual Weapon',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: 20,           // guaranteed hit (nat 1 → 21 ≥ AC 5)
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Spiritual Weapon (bonus action, melee spell attack, 1d8 force)',
};

/** Guaranteed-miss action: AC 30 + hitBonus +0 → max non-crit total 20 < 30 */
const SPIRITUAL_WEAPON_ACTION_MISS: Action = { ...SPIRITUAL_WEAPON_ACTION_HIT, hitBonus: 0 };

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 5, speed: 30,        // low AC → guaranteed hit
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
    width: 30, height: 30, depth: 1,
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

/** Cleric at pos (0,0,0) with Spiritual Weapon + 2 2nd-level slots */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [SPIRITUAL_WEAPON_ACTION_HIT],
    resources: withSlots2(2),
  });
}

/** Enemy with low AC 5 (guaranteed hit vs hitBonus +20) */
function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

/** Enemy with high AC 30 (guaranteed miss vs hitBonus +0) */
function makeHighAcEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', ac: 30, pos });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Spiritual Weapon', metadata.name, 'Spiritual Weapon');
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('die count is 1', metadata.dieCount, 1);
eq('die sides is 8', metadata.dieSides, 8);
eq('damage type is force', metadata.damageType, 'force');
eq('NOT concentration', metadata.concentration, false);
eq('casting time is bonusAction', metadata.castingTime, 'bonusAction');
eq('durationRounds is 10', (metadata as any).durationRounds, 10);
eq('subsequent attack v1 simplified flag set', metadata.spiritualWeaponSubsequentAttackV1Simplified, true);
eq('upcast NOT implemented (v1)', metadata.spiritualWeaponUpcastV1Implemented, false);
eq('retargeting NOT implemented (v1)', metadata.spiritualWeaponRetargetingV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Spiritual Weapon' action
  const caster = makeCleric();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Spiritual Weapon action', shouldCast(caster, bf), null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2c. No enemies in range
  const caster = makeCleric();
  const farEnemy = makeEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf), null);
}

{
  // 2d. Already concentrating — NOT a gate (Spiritual Weapon is NOT concentration)
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns target even when caster is already concentrating (NOT concentration spell)',
    shouldCast(caster, bf)?.id === 'e1');
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeCleric();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeCleric();
  const far = makeEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 4. execute — on hit (immediate 1d8 force + persistent damage_zone)
// ============================================================

console.log('\n=== 4. execute — on hit ===\n');

{
  // 4a. Immediate 1d8 force damage applied on hit
  const caster = makeCleric();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Immediate damage in [1, 8] (1d8)', hpLost >= 1 && hpLost <= 8, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. damage_zone effect attached on hit (1d8 force, ticksRemaining: 10)
  const caster = makeCleric();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect attached', zones.length, 1);
  if (zones.length === 1) {
    eq('damage_zone dieCount is 1', zones[0].payload.dieCount, 1);
    eq('damage_zone dieSides is 8', zones[0].payload.dieSides, 8);
    eq('damage_zone damageType is force', zones[0].payload.damageType, 'force');
    eq('damage_zone ticksRemaining is 10', zones[0].payload.ticksRemaining, 10);
    eq('damage_zone sourceIsConcentration is false (NOT concentration)', zones[0].sourceIsConcentration, false);
    eq('damage_zone spellName is Spiritual Weapon', zones[0].spellName, 'Spiritual Weapon');
  }
}

{
  // 4c. No concentration started on caster (NOT a concentration spell)
  const caster = makeCleric();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration NOT started', caster.concentration, null);
}

// ============================================================
// 5. execute — on miss (no immediate damage, BUT damage_zone attached)
// ============================================================

console.log('\n=== 5. execute — on miss ===\n');

{
  // 5a. On miss: NO immediate damage, but damage_zone STILL attached (v1 simplification)
  const caster = makeCleric();
  caster.actions = [SPIRITUAL_WEAPON_ACTION_MISS];
  const enemy = makeHighAcEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // Damage dealt may be 0 (miss) OR a single 1d8=1..8 (nat-20 crit-hit, rare).
  const hpLost = 100 - enemy.currentHP;
  assert('On miss: 0 damage OR ≤1 crit-hit damage in [0, 8]',
    hpLost >= 0 && hpLost <= 8, `got ${hpLost}`);
  // Damage_zone effect is ALWAYS attached (v1 simplification — weapon persists).
  const zones = getActiveDamageZones(enemy);
  eq('damage_zone STILL attached on miss (v1 simplification)', zones.length, 1);
  if (zones.length === 1) {
    eq('damage_zone ticksRemaining is 10 (on miss)', zones[0].payload.ticksRemaining, 10);
    eq('damage_zone sourceIsConcentration is false (NOT concentration)', zones[0].sourceIsConcentration, false);
  }
  eq('Slot still consumed on miss', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 5b. Dead target skipped (stale plan) — no damage, no effect
  const caster = makeCleric();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('No damage on dead target', enemy.currentHP, 0);
  eq('No damage_zone effect on dead target', getActiveDamageZones(enemy).length, 0);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 6. rollDamage range check (1d8 → 1..8)
// ============================================================

console.log('\n=== 6. rollDamage range check ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [1, 8] (iteration ${i})`, dmg >= 1 && dmg <= 8, `got ${dmg}`);
  }
}

// ============================================================
// 7. execute — logging
// ============================================================

console.log('\n=== 7. execute — logging ===\n');

{
  const caster = makeCleric();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const hitEvents = events.filter(e => e.type === 'attack_hit' || e.type === 'attack_crit');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Attack hit event emitted', hitEvents.length === 1);
  assert('Damage event emitted (immediate 1d8)', damageEvents.length === 1);
  assert('Condition_add event emitted (persistent weapon)', condEvents.length === 1);
  assert('Action event mentions "Spiritual Weapon"',
    actionEvents[0].description.includes('Spiritual Weapon'));
  assert('Damage event description mentions force', damageEvents[0].description.includes('force'));
}

{
  // 7b. On miss: attack_miss event, NO immediate damage event, but condition_add still emitted
  const caster = makeCleric();
  caster.actions = [SPIRITUAL_WEAPON_ACTION_MISS];
  const enemy = makeHighAcEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const events = state.log.events as any[];
  const missEvents = events.filter(e => e.type === 'attack_miss');
  const critEvents = events.filter(e => e.type === 'attack_crit');
  const condEvents = events.filter(e => e.type === 'condition_add');

  // Either attack_miss (no crit) OR attack_crit (nat 20)
  assert('Either attack_miss or attack_crit event emitted',
    missEvents.length === 1 || critEvents.length === 1);
  // Condition_add is ALWAYS emitted (weapon persists regardless of hit/miss)
  eq('Condition_add event always emitted (weapon persists on miss)', condEvents.length, 1);
}

// ============================================================
// 8. cleanup — no-op
// ============================================================

console.log('\n=== 8. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/spiritual_weapon');
  const caster = makeCleric();
  const preSlots = caster.resources!.spellSlots![2]!.remaining;
  cleanup(caster);
  eq('Cleanup does NOT consume slots', caster.resources!.spellSlots![2]!.remaining, preSlots);
  eq('Cleanup does NOT start concentration', caster.concentration, null);
}

// ============================================================
// 9. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 9. Integration pipeline ===\n');

{
  // 9a. Full pipeline: caster hits highest-threat enemy
  const caster = makeCleric();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  const hpLost = 120 - strong.currentHP;
  assert('Strong enemy took immediate damage in [1, 8]', hpLost >= 1 && hpLost <= 8);
  eq('Weak enemy NOT damaged', weak.currentHP, 30);
  eq('Strong enemy has 1 damage_zone effect', getActiveDamageZones(strong).length, 1);
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 9b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns null after slots exhausted', t2, null);
}

{
  // 9c. Can be cast while already concentrating (NOT a concentration spell)
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns target even when caster is concentrating', target?.id === 'e1');
  if (target) execute(caster, target, state);

  eq('Existing concentration preserved (NOT replaced)', caster.concentration?.spellName, 'Bless');
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('damage_zone effect attached to enemy', getActiveDamageZones(enemy).length, 1);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
