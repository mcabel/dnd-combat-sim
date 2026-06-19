// ============================================================
// flame_blade.test.ts — Flame Blade spell module
// PHB p.242: 2nd-level evocation, action, range Self, concentration (10 min).
// Effect: self-buff — melee weapon attacks deal +3d6 fire damage.
//
// v1 simplification: canon creates a NEW melee weapon (melee spell attack,
// 3d6 fire). v1 models this as a +3d6 fire RIDER on the caster's existing
// melee weapon attacks (mirrors Shillelagh's pattern). The caster's
// `_flameBladeActive` scratch field flags the rider. A `damage_zone`
// sentinel effect (dieCount=0) anchors concentration-break cleanup so the
// scratch field is cleared.
//
// Tests cover shouldCast() gates (action, slots, concentration, already
// active, no melee attack, no enemies), execute() scratch field set +
// sentinel effect attached + slot consumed + concentration started,
// logging, cleanup no-op, integration pipeline, and metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/flame_blade';
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

const FLAME_BLADE_ACTION: Action = {
  name: 'Flame Blade',
  isMultiattack: false,
  attackType: null,        // self-buff — not an attack action
  reach: 0,
  range: { normal: 0, long: 0 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Flame Blade (self-buff, +3d6 fire on melee attacks, concentration 10 min)',
};

/** Separate melee weapon attack — Flame Blade's rider fires on this. */
const MELEE_ATTACK: Action = {
  name: 'Scimitar',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 5,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Scimitar melee attack',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
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

/** Druid at pos (0,0,0) with Flame Blade + Scimitar melee attack + 2 2nd-level slots */
function makeDruid(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('druid1', {
    name: 'Druid',
    pos,
    actions: [FLAME_BLADE_ACTION, MELEE_ATTACK],
    resources: withSlots2(2),
  });
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Flame Blade', metadata.name, 'Flame Blade');
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('damage dice is 3', metadata.damageDice, 3);
eq('damage die sides is 6', metadata.damageDieSides, 6);
eq('damage type is fire', metadata.damageType, 'fire');
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('as-weapon-rider v1 simplification IS active', metadata.flameBladeAsWeaponRiderV1Simplified, true);
eq('re-evoke (bonus action) NOT implemented (v1)', metadata.flameBladeReEvokeV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.flameBladeUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.flameBladeConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Flame Blade' action
  const caster = makeDruid();
  caster.actions = [MELEE_ATTACK];  // has melee but no Flame Blade
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Flame Blade action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeDruid();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 2nd-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. Caster is already concentrating
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2d. Flame Blade already active (scratch field set)
  const caster = makeDruid();
  caster._flameBladeActive = true;
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when Flame Blade already active', shouldCast(caster, bf) === false);
}

{
  // 2e. Caster has no MELEE weapon attack (only ranged)
  const caster = makeDruid();
  caster.actions = [
    FLAME_BLADE_ACTION,
    { ...MELEE_ATTACK, name: 'Shortbow', attackType: 'ranged', range: { normal: 80, long: 320 }, reach: 0 },
  ];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no melee weapon attack', shouldCast(caster, bf) === false);
}

{
  // 2f. No enemies in bf
  const caster = makeDruid();
  const bf = makeBF([caster]);
  assert('Returns false when no enemies in bf', shouldCast(caster, bf) === false);
}

{
  // 2g. Happy path: caster has Flame Blade + melee + slots + enemy → returns true
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all preconditions met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. execute — scratch field set + sentinel effect attached
// ============================================================

console.log('\n=== 3. execute — scratch field set + sentinel effect attached ===\n');

{
  // 3a. _flameBladeActive scratch field set to true
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('_flameBladeActive set to true', caster._flameBladeActive, true);
}

{
  // 3b. Sentinel damage_zone effect attached (dieCount=0)
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Sentinel damage_zone effect attached',
    caster.activeEffects.some(e =>
      e.effectType === 'damage_zone' &&
      e.payload.dieCount === 0 &&
      e.spellName === 'Flame Blade' &&
      e.sourceIsConcentration === true
    ));
}

{
  // 3c. Slot consumed
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('2nd-level slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3d. Concentration started
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Flame Blade', caster.concentration?.spellName, 'Flame Blade');
}

{
  // 3e. Existing concentration broken (safety net)
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  // Add a Barkskin sentinel effect on the caster (so we can verify it's removed)
  caster.activeEffects.push({
    id: 'eff_barkskin', casterId: caster.id, spellName: 'Barkskin',
    effectType: 'ac_floor', payload: { acFloor: 16 }, sourceIsConcentration: true,
  });
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration switched to Flame Blade', caster.concentration?.spellName, 'Flame Blade');
  assert('Prior Barkskin effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Barkskin'));
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions "Flame Blade"', actionEvents[0].description.includes('Flame Blade'));
  assert('Action event mentions fire damage dice (3d6)', actionEvents[0].description.includes('3d6'));
  assert('Condition event mentions "fiery blade"',
    condEvents[0].description.toLowerCase().includes('blade'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/flame_blade');
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Flame Blade', dcIfHit: 10 };
  caster._flameBladeActive = true;
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT clear _flameBladeActive', caster._flameBladeActive, true);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: caster casts Flame Blade, scratch field set
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  assert('shouldCast returns true', shouldCast(caster, bf) === true);
  execute(caster, state);

  eq('_flameBladeActive set to true', caster._flameBladeActive, true);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration started on Flame Blade', caster.concentration?.spellName, 'Flame Blade');
  assert('Sentinel effect attached to caster',
    caster.activeEffects.some(e => e.effectType === 'damage_zone' && e.payload.dieCount === 0 && e.spellName === 'Flame Blade'));
}

{
  // 6b. After casting, shouldCast returns false (already active + concentrating)
  const caster = makeDruid();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  assert('shouldCast returns false after Flame Blade already active', shouldCast(caster, bf) === false);
}

{
  // 6c. After slots exhausted, shouldCast returns false
  const caster = makeDruid();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  assert('shouldCast returns false after slots exhausted', shouldCast(caster, bf) === false);
}

{
  // 6d. Caster with no melee weapon attack cannot cast Flame Blade
  const caster = makeDruid();
  caster.actions = [FLAME_BLADE_ACTION];  // no melee attack
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('shouldCast returns false when caster has no melee attack', shouldCast(caster, bf) === false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
