// ============================================================
// phantasmal_force.test.ts — Phantasmal Force spell module
// PHB p.264: 2nd-level illusion, action, range 60 ft, concentration 1 min.
// Effect: INT save. On fail: 1d6 psychic immediately + persistent damage_zone
//         (1d6 psychic/turn, no save). On success: NO damage, NO damage_zone
//         (target disbelieves).
//
// First INT save in the cantrip-z workstream.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - INT 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - INT 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/phantasmal_force';
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

const PHANTASMAL_FORCE_ACTION: Action = {
  name: 'Phantasmal Force',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests (INT 1 → max 15 < 25)
  saveAbility: 'int',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Phantasmal Force (INT save, 1d6 psychic on fail + persistent damage_zone)',
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

/** Bard at pos (0,0,0) with Phantasmal Force + 2 2nd-level slots */
function makeBard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('bard1', {
    name: 'Bard',
    pos,
    actions: [PHANTASMAL_FORCE_ACTION],
    resources: withSlots2(2),
  });
}

/** Enemy with INT 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    int: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos,
    ...overrides,
  });
}

/** Enemy with INT 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    int: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
    ...overrides,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Phantasmal Force', metadata.name, 'Phantasmal Force');
eq('level is 2', metadata.level, 2);
eq('school is illusion', metadata.school, 'illusion');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('die count is 1', metadata.dieCount, 1);
eq('die sides is 6', metadata.dieSides, 6);
eq('damage type is psychic', metadata.damageType, 'psychic');
eq('is concentration', metadata.concentration, true);
eq('save ability is int (first INT save)', metadata.saveAbility, 'int');
eq('casting time is action', metadata.castingTime, 'action');
eq('rationalization NOT implemented (v1)', metadata.phantasmalForceRationalizationV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.phantasmalForceUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.phantasmalForceConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  // 2b. Caster lacks 'Phantasmal Force' action
  const caster = makeBard();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Phantasmal Force action', shouldCast(caster, bf), null);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeBard();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2d. No enemies in range (60 ft)
  const caster = makeBard();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf), null);
}

{
  // 2e. Enemy already Phantasmal-Forced by this caster — skip
  const caster = makeBard();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_pf1', casterId: caster.id, spellName: 'Phantasmal Force',
    effectType: 'damage_zone',
    payload: { dieCount: 1, dieSides: 6, damageType: 'psychic' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when enemy already Phantasmal-Forced', shouldCast(caster, bf), null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeBard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeBard();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 4. execute — save resolution (fail → damage + damage_zone)
// ============================================================

console.log('\n=== 4. execute — save resolution (fail) ===\n');

{
  // 4a. Guaranteed fail (INT 1 vs DC 25) → 1d6 psychic immediately + damage_zone
  const caster = makeBard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Failed save → immediate 1d6 damage in [1, 6]', hpLost >= 1 && hpLost <= 6, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Phantasmal Force', caster.concentration?.spellName, 'Phantasmal Force');
}

{
  // 4b. damage_zone effect attached on fail (1d6 psychic, no save)
  const caster = makeBard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect attached (on fail)', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 1', z.payload.dieCount, 1);
    eq('damage_zone dieSides is 6', z.payload.dieSides, 6);
    eq('damage_zone damageType is psychic', z.payload.damageType, 'psychic');
    eq('damage_zone has NO saveDC (no save, automatic)', z.payload.saveDC, undefined);
    eq('damage_zone has NO saveAbility (no save)', z.payload.saveAbility, undefined);
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Phantasmal Force', z.spellName, 'Phantasmal Force');
  }
}

// ============================================================
// 5. execute — save resolution (success → NO damage, NO damage_zone)
// ============================================================

console.log('\n=== 5. execute — save resolution (success) ===\n');

{
  // 5a. Guaranteed success (INT 30 vs DC 5) → NO damage, NO damage_zone
  const caster = makeBard();
  caster.actions = [{ ...PHANTASMAL_FORCE_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Successful save → NO immediate damage', enemy.currentHP, 100);
  eq('Successful save → NO damage_zone effect', getActiveDamageZones(enemy).length, 0);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  // Concentration still started (the spell "happened" but was disbelieved)
  eq('Concentration still started on save success', caster.concentration?.spellName, 'Phantasmal Force');
}

{
  // 5b. Dead target skipped (stale edge case) — no damage, no effect
  const caster = makeBard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('No damage on dead target', enemy.currentHP, 0);
  eq('No damage_zone effect on dead target', getActiveDamageZones(enemy).length, 0);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 6. rollDamage range check (1d6 → 1..6)
// ============================================================

console.log('\n=== 6. rollDamage range check ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [1, 6] (iteration ${i})`, dmg >= 1 && dmg <= 6, `got ${dmg}`);
  }
}

// ============================================================
// 7. execute — logging
// ============================================================

console.log('\n=== 7. execute — logging ===\n');

{
  // 7a. On fail: action + save_fail + damage + condition_add
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
  assert('Action event mentions "Phantasmal Force"',
    actionEvents[0].description.includes('Phantasmal Force'));
  eq('1 save event', saveEvents.length, 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('Save event mentions INT save', saveEvents[0].description.includes('INT'));
  eq('1 damage event (immediate 1d6)', damageEvents.length, 1);
  eq('1 condition_add event (persistent phantasm)', condEvents.length, 1);
}

{
  // 7b. On success: action + save_success, NO damage, NO condition_add
  const caster = makeBard();
  caster.actions = [{ ...PHANTASMAL_FORCE_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  eq('1 save event', saveEvents.length, 1);
  assert('Save event is save_success (disbelieves)', saveEvents[0]?.type === 'save_success');
  eq('0 damage events on success', damageEvents.length, 0);
  eq('0 condition_add events on success (no persistent effect)', condEvents.length, 0);
}

// ============================================================
// 8. cleanup — no-op
// ============================================================

console.log('\n=== 8. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/phantasmal_force');
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Phantasmal Force', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Phantasmal Force');
}

// ============================================================
// 9. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 9. Integration pipeline ===\n');

{
  // 9a. Full pipeline: caster hits highest-threat enemy (guaranteed fail)
  const caster = makeBard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  const hpLostStrong = 120 - strong.currentHP;
  assert('Strong enemy took immediate damage in [1, 6]', hpLostStrong >= 1 && hpLostStrong <= 6);
  eq('Weak enemy NOT damaged', weak.currentHP, 30);
  eq('Strong enemy has 1 damage_zone effect', getActiveDamageZones(strong).length, 1);
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 9b. After slots exhausted, shouldCast returns null
  const caster = makeBard();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns null after slots exhausted / concentration active', t2, null);
}

{
  // 9c. Existing concentration broken (safety net) — verify removeEffectsFromCaster called
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  // Pre-existing Hold Person effect on enemy (simulated)
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' as any },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Phantasmal Force', caster.concentration?.spellName, 'Phantasmal Force');
  assert('Prior Hold Person effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
