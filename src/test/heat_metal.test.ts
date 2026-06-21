// ============================================================
// heat_metal.test.ts — Heat Metal spell module
// PHB p.250: 2nd-level transmutation, action, range 60 ft, concentration 1 min.
// Effect: 2d8 fire on cast (NO save — automatic) + persistent damage_zone
//         effect that ticks 2d8 fire each turn (NO save — automatic).
//         CON save is rolled for LOGGING ONLY (v1 does NOT model drop-object).
//
// Tests cover shouldCast() gates + target priority, execute() automatic
// damage + CON save (logging-only) + damage_zone WITHOUT saveDC + slot
// consumed + logging, rollDamage range check, cleanup no-op, integration
// pipeline, and metadata shape.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//   NOTE: in Heat Metal v1, the CON save result does NOT affect damage —
//   damage is automatic per PHB p.250. We test both save outcomes to
//   confirm the damage is the same (full 2d8) either way.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/heat_metal';
import { getActiveDamageZones } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

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

const HEAT_METAL_ACTION: Action = {
  name: 'Heat Metal',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // CON save DC (rolled for LOGGING ONLY — does not affect damage)
  saveAbility: 'con',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Heat Metal (2d8 fire automatic + persistent, CON save for logging only, concentration 1 min)',
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
    conditions: new Set(),
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
    width: 20, height: 20, depth: 1,
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

/** Bard at pos (0,0,0) with Heat Metal + 2 2nd-level slots */
function makeBard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('bard1', {
    name: 'Bard',
    pos,
    actions: [HEAT_METAL_ACTION],
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

/** Enemy with CON 30 (guaranteed success vs DC 5) */
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

eq('name is Heat Metal', metadata.name, 'Heat Metal');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('die count is 2', metadata.dieCount, 2);
eq('die sides is 8', metadata.dieSides, 8);
eq('damage type is fire', metadata.damageType, 'fire');
eq('is concentration', metadata.concentration, true);
eq('save ability is con', metadata.saveAbility, 'con');
eq('casting time is action', metadata.castingTime, 'action');
eq('bonus-action repeat NOT implemented (v1)', metadata.heatMetalBonusActionRepeatV1Implemented, false);
eq('drop-object mechanic NOT implemented (v1)', metadata.heatMetalDropObjectV1Implemented, false);
eq('holding-disadvantage rider NOT implemented (v1)', metadata.heatMetalHoldingDisadvantageV1Implemented, false);
eq('metal-object check NOT implemented (v1)', metadata.heatMetalMetalObjectCheckV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.heatMetalUpcastV1Implemented, false);
eq('concentration enforcement NOW implemented (Session 34 TG-002)', metadata.heatMetalConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates + target priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + target priority ===\n');

{
  // 2a. Caster lacks 'Heat Metal' action
  const caster = makeBard();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Heat Metal action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeBard();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Crown of Madness', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range (60 ft)
  const caster = makeBard();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already Heat-Metal'd by this caster — skip
  const caster = makeBard();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_hm1', casterId: caster.id, spellName: 'Heat Metal',
    effectType: 'damage_zone',
    payload: { dieCount: 2, dieSides: 8, damageType: 'fire' },  // no saveDC
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Heat-Metal\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2f. Highest-threat (maxHP) enemy selected first
  const caster = makeBard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 2g. Tie-break: closest enemy first
  const caster = makeBard();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 3. execute — automatic damage + CON save (logging only) + damage_zone
// ============================================================

console.log('\n=== 3. execute — automatic damage + CON save (logging only) ===\n');

{
  // 3a. CON 1 vs DC 25 (guaranteed fail) → full 2d8 fire (no save on damage)
  const caster = makeBard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Failed save → full 2d8 fire damage in [2, 16]', hpLost >= 2 && hpLost <= 16, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Heat Metal', caster.concentration?.spellName, 'Heat Metal');
}

{
  // 3b. CON 30 vs DC 5 (guaranteed success) → STILL full 2d8 fire (save doesn't affect damage)
  const caster = makeBard();
  caster.actions = [{ ...HEAT_METAL_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  // Damage is STILL full 2d8 [2, 16] — the CON save doesn't reduce damage in v1.
  assert('Successful save → STILL full 2d8 fire damage in [2, 16]', hpLost >= 2 && hpLost <= 16, `got ${hpLost}`);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3c. damage_zone attached WITHOUT saveDC (damage is automatic)
  const caster = makeBard();
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
    eq('damage_zone dieSides is 8', z.payload.dieSides, 8);
    eq('damage_zone damageType is fire', z.payload.damageType, 'fire');
    assert('damage_zone has NO saveDC (automatic damage)', z.payload.saveDC === undefined);
    assert('damage_zone has NO saveAbility (automatic damage)', z.payload.saveAbility === undefined);
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Heat Metal', z.spellName, 'Heat Metal');
  }
}

{
  // 3d. Dead target skipped (stale edge case — no damage, slot still consumed)
  const caster = makeBard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No damage_zone effect on dead target', getActiveDamageZones(enemy).length, 0);
}

// ============================================================
// 4. rollDamage range check (2d8 → 2..16)
// ============================================================

console.log('\n=== 4. rollDamage range check ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [2, 16] (iteration ${i})`, dmg >= 2 && dmg <= 16, `got ${dmg}`);
  }
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeBard();
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
  assert('Damage event emitted (immediate 2d8)', damageEvents.length === 1);
  assert('Save event emitted (CON save for logging)', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('Condition_add event emitted (damage_zone applied)', condEvents.length === 1);
  assert('Action event mentions "Heat Metal"', actionEvents[0].description.includes('Heat Metal'));
  assert('Damage event mentions "Heat Metal"', damageEvents[0].description.includes('Heat Metal'));
  assert('Save event mentions CON save', saveEvents[0].description.includes('CON'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/heat_metal');
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Heat Metal', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Heat Metal');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster hits highest-threat enemy
  const caster = makeBard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  // Strong enemy took immediate damage
  const hpLostStrong = 120 - strong.currentHP;
  assert('Strong enemy took immediate damage in [2, 16]', hpLostStrong >= 2 && hpLostStrong <= 16);
  // Weak enemy NOT damaged
  eq('Weak enemy NOT damaged', weak.currentHP, 30);
  // Strong enemy has damage_zone effect (without saveDC)
  const zones = getActiveDamageZones(strong);
  eq('Strong enemy has 1 damage_zone effect', zones.length, 1);
  if (zones.length === 1) {
    assert('Strong enemy\'s damage_zone has NO saveDC', zones[0].payload.saveDC === undefined);
  }
  // Weak enemy has NO damage_zone effect
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Heat Metal', caster.concentration?.spellName, 'Heat Metal');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeBard();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted (and concentration active)', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
