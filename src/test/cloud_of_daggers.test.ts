// ============================================================
// cloud_of_daggers.test.ts — Cloud of Daggers spell module
// PHB p.222: 2nd-level conjuration, action, 60 ft, concentration 1 min.
// Effect: 4d4 slashing on cast (no save) + persistent damage_zone effect
//         that ticks 4d4 at the start of each of the target's turns.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// damage application + damage_zone effect + slot consumption + logging,
// damage_zone query helper, integration pipeline, and metadata shape.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/cloud_of_daggers';
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

const CLOUD_ACTION: Action = {
  name: 'Cloud of Daggers',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Cloud of Daggers (4d4 slashing + persistent, concentration 1 min)',
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

/** Wizard at pos (0,0,0) with Cloud of Daggers + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [CLOUD_ACTION],
    resources: withSlots2(2),
  });
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('die count is 4', metadata.dieCount, 4);
eq('die sides is 4', metadata.dieSides, 4);
eq('damage type is slashing', metadata.damageType, 'slashing');
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('multi-target NOT implemented (v1)', metadata.cloudOfDaggersMultiTargetV1Implemented, false);
eq('movement tracking NOT implemented (v1)', metadata.cloudOfDaggersMovementTrackingV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.cloudOfDaggersUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Cloud of Daggers' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Cloud of Daggers action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range
  const caster = makeWizard();
  const farEnemy = makeEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already in Cloud of Daggers zone from this caster — skip
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Cloud of Daggers',
    effectType: 'damage_zone',
    payload: { dieCount: 4, dieSides: 4, damageType: 'slashing' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already in Cloud of Daggers zone', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeWizard();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 120) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeWizard();
  const far = makeEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const near = makeEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 4. execute — immediate damage + damage_zone effect
// ============================================================

console.log('\n=== 4. execute — immediate damage + damage_zone effect ===\n');

{
  // 4a. Immediate 4d4 slashing damage on cast
  const caster = makeWizard();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  // 4d4 range: 4..16
  const hpLost = 100 - enemy.currentHP;
  assert('Immediate damage in [4, 16] (4d4)', hpLost >= 4 && hpLost <= 16);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. damage_zone effect applied on target
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = enemy.activeEffects.filter(e => e.effectType === 'damage_zone');
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    eq('damage_zone dieCount is 4', zones[0].payload.dieCount, 4);
    eq('damage_zone dieSides is 4', zones[0].payload.dieSides, 4);
    eq('damage_zone damageType is slashing', zones[0].payload.damageType, 'slashing');
    eq('damage_zone sourceIsConcentration is true', zones[0].sourceIsConcentration, true);
    eq('damage_zone spellName is Cloud of Daggers', zones[0].spellName, 'Cloud of Daggers');
  }
}

{
  // 4c. Concentration started on caster
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Cloud of Daggers', caster.concentration?.spellName, 'Cloud of Daggers');
}

{
  // 4d. Dead target skipped (stale edge case) — no damage, no effect
  const caster = makeWizard();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // Slot is consumed (execute started before the dead-check)
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  // No damage_zone effect applied to dead target
  const zones = enemy.activeEffects.filter(e => e.effectType === 'damage_zone');
  eq('No damage_zone effect on dead target', zones.length, 0);
}

// ============================================================
// 5. rollDamage helper
// ============================================================

console.log('\n=== 5. rollDamage helper ===\n');

{
  // 5a. rollDamage returns a value in [4, 16] (4d4)
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [4, 16] (iteration ${i})`, dmg >= 4 && dmg <= 16, `got ${dmg}`);
  }
}

// ============================================================
// 6. getActiveDamageZones query helper
// ============================================================

console.log('\n=== 6. getActiveDamageZones query helper ===\n');

{
  // 6a. No damage_zone effects → returns empty array
  const c = makeCombatant('c1');
  eq('No damage_zone effects → empty array', getActiveDamageZones(c).length, 0);
}

{
  // 6b. After execute, target has 1 damage_zone effect
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const zones = getActiveDamageZones(enemy);
  eq('getActiveDamageZones returns 1 zone after execute', zones.length, 1);
  eq('Zone dieCount is 4', zones[0].payload.dieCount, 4);
}

// ============================================================
// 7. execute — logging
// ============================================================

console.log('\n=== 7. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Damage event emitted (immediate 4d4)', damageEvents.length === 1);
  assert('Condition_add event emitted (damage_zone applied)', condEvents.length === 1);
  assert('Action event mentions "Cloud of Daggers"', actionEvents[0].description.includes('Cloud of Daggers'));
  assert('Damage event mentions "Cloud of Daggers"', damageEvents[0].description.includes('Cloud of Daggers'));
}

// ============================================================
// 8. cleanup — no-op
// ============================================================

console.log('\n=== 8. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/cloud_of_daggers');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Cloud of Daggers', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 9. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 9. Integration pipeline ===\n');

{
  // 9a. Full pipeline: caster hits highest-threat enemy
  const caster = makeWizard();
  const weak = makeEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const strong = makeEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 120)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  // Strong enemy took immediate damage
  const hpLost = 120 - strong.currentHP;
  assert('Strong enemy took immediate damage [4, 16]', hpLost >= 4 && hpLost <= 16);
  // Weak enemy NOT damaged
  eq('Weak enemy NOT damaged', weak.currentHP, 30);
  // Strong enemy has damage_zone effect
  const zones = getActiveDamageZones(strong);
  eq('Strong enemy has 1 damage_zone effect', zones.length, 1);
  // Weak enemy has NO damage_zone effect
  eq('Weak enemy has 0 damage_zone effects', getActiveDamageZones(weak).length, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 9b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
