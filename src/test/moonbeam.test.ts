// ============================================================
// moonbeam.test.ts — Moonbeam spell module
// PHB p.261: 2nd-level evocation, action, range 120 ft, concentration 1 min.
// Effect: 2d10 radiant on cast (CON save for half) + persistent damage_zone
//         effect that ticks 2d10 radiant at the start of each of the
//         target's turns (CON save for half).
//
// Tests cover shouldCast() gates + target priority, execute() save
// resolution (full damage on fail, half on success) + damage_zone effect
// with saveDC/saveAbility + slot consumption + logging, rollDamage range
// check, cleanup no-op, integration pipeline, and metadata shape.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/moonbeam';
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

const MOONBEAM_ACTION: Action = {
  name: 'Moonbeam',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Moonbeam (CON save for half, 2d10 radiant, concentration 1 min)',
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

/** Druid at pos (0,0,0) with Moonbeam + 2 2nd-level slots */
function makeDruid(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('druid1', {
    name: 'Druid',
    pos,
    actions: [MOONBEAM_ACTION],
    resources: withSlots2(2),
  });
}

/** Enemy with CON 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos,
    ...overrides,
  });
}

/** Enemy with CON 30 (guaranteed success vs DC 5) — used with a low-DC action */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
    ...overrides,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Moonbeam', metadata.name, 'Moonbeam');
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 120 ft', metadata.rangeFt, 120);
eq('die count is 2', metadata.dieCount, 2);
eq('die sides is 10', metadata.dieSides, 10);
eq('damage type is radiant', metadata.damageType, 'radiant');
eq('is concentration', metadata.concentration, true);
eq('save ability is con', metadata.saveAbility, 'con');
eq('casting time is action', metadata.castingTime, 'action');
eq('cylinder AoE NOT implemented (v1)', metadata.moonbeamCylinderAoeV1Implemented, false);
eq('beam movement NOT implemented (v1)', metadata.moonbeamMovementV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.moonbeamUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.moonbeamConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Call Lightning', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  // 2b. Caster lacks 'Moonbeam' action
  const caster = makeDruid();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Moonbeam action', shouldCast(caster, bf), null);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeDruid();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2d. No enemies in range (120 ft)
  const caster = makeDruid();
  const farEnemy = makeWeakEnemy('far', { x: 25, y: 0, z: 0 });  // 125 ft > 120 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (120 ft)', shouldCast(caster, bf), null);
}

{
  // 2e. Enemy already in Moonbeam zone from this caster — skip
  const caster = makeDruid();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_mb1', casterId: caster.id, spellName: 'Moonbeam',
    effectType: 'damage_zone',
    payload: { dieCount: 2, dieSides: 10, damageType: 'radiant', saveDC: 25, saveAbility: 'con' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when enemy already in Moonbeam zone', shouldCast(caster, bf), null);
}

{
  // 2f. Dead enemy ignored
  const caster = makeDruid();
  const dead = makeWeakEnemy('dead', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const alive = makeWeakEnemy('alive', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, dead, alive]);
  eq('Dead enemy ignored — returns alive enemy', shouldCast(caster, bf)?.id, 'alive');
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeDruid();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeDruid();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 3c. Allied enemy at long range still selectable (within 120 ft)
  const caster = makeDruid();
  const atRange = makeWeakEnemy('atRange', { x: 20, y: 0, z: 0 }, { maxHP: 60, currentHP: 60 });  // 100 ft
  const bf = makeBF([caster, atRange]);
  eq('Enemy at 100 ft is within 120 ft range', shouldCast(caster, bf)?.id, 'atRange');
}

// ============================================================
// 4. execute — save resolution (full / half)
// ============================================================

console.log('\n=== 4. execute — save resolution ===\n');

{
  // 4a. Guaranteed fail (CON 1 vs DC 25) → full 2d10 radiant damage
  const caster = makeDruid();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Failed save → full damage in [2, 20] (2d10)', hpLost >= 2 && hpLost <= 20, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Moonbeam', caster.concentration?.spellName, 'Moonbeam');
}

{
  // 4b. Guaranteed success (CON 30 vs DC 5) → half damage (floor(2d10/2) = 1..10)
  const caster = makeDruid();
  caster.actions = [{ ...MOONBEAM_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Successful save → half damage in [1, 10]', hpLost >= 1 && hpLost <= 10, `got ${hpLost}`);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4c. Dead target skipped (stale edge case — no damage, slot still consumed)
  const caster = makeDruid();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No damage_zone effect on dead target', getActiveDamageZones(enemy).length, 0);
}

// ============================================================
// 5. execute — damage_zone payload
// ============================================================

console.log('\n=== 5. execute — damage_zone payload ===\n');

{
  const caster = makeDruid();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 2', z.payload.dieCount, 2);
    eq('damage_zone dieSides is 10', z.payload.dieSides, 10);
    eq('damage_zone damageType is radiant', z.payload.damageType, 'radiant');
    eq('damage_zone saveDC is set (25)', z.payload.saveDC, 25);
    eq('damage_zone saveAbility is con', z.payload.saveAbility, 'con');
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Moonbeam', z.spellName, 'Moonbeam');
    eq('damage_zone casterId is the druid', z.casterId, 'druid1');
  }
}

// ============================================================
// 6. execute — logging
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

{
  const caster = makeDruid();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Save event emitted', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('Damage event emitted', damageEvents.length === 1);
  assert('Condition_add event emitted (damage_zone applied)', condEvents.length === 1);
  assert('Action event mentions "Moonbeam"', actionEvents[0].description.includes('Moonbeam'));
  assert('Save event mentions CON save', saveEvents[0].description.includes('CON'));
  assert('Damage event mentions "Moonbeam"', damageEvents[0].description.includes('Moonbeam'));
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/moonbeam');
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Moonbeam', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Moonbeam');
}

// ============================================================
// 8. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 8. Integration pipeline ===\n');

{
  // 8a. Full pipeline: caster hits highest-threat enemy
  const caster = makeDruid();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  const hpLostStrong = 120 - strong.currentHP;
  assert('Strong enemy took damage in [2, 20]', hpLostStrong >= 2 && hpLostStrong <= 20);
  eq('Weak enemy NOT damaged', weak.currentHP, 30);
  const zones = getActiveDamageZones(strong);
  eq('Strong enemy has 1 damage_zone effect', zones.length, 1);
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 8b. After slots exhausted, shouldCast returns null
  const caster = makeDruid();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Caster is now concentrating → second shouldCast also returns null
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns null after slots exhausted / concentration active', t2, null);
}

{
  // 8c. rollDamage range check (2d10 → 2..20)
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [2, 20] (iteration ${i})`, dmg >= 2 && dmg <= 20, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
