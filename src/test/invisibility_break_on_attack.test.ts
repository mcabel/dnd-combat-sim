// ============================================================
// invisibility_break_on_attack.test.ts — Session 32
//
// Tests for the ends-on-attack/cast hook added to Invisibility in Session 32,
// and for Greater Invisibility which does NOT have that clause.
//
// Tests cover:
//   1. Invisibility spell sets breaksOnAttackOrCast: true on its ActiveEffect
//   2. Invisibility ends when the invisible creature makes a weapon attack
//   3. Invisibility ends when the invisible creature casts a spell
//   4. Invisibility does NOT end on movement/dash/dodge
//   5. Greater Invisibility does NOT set breaksOnAttackOrCast
//   6. Greater Invisibility persists through attacks
//   7. Greater Invisibility persists through spell casts
// ============================================================

import { shouldCast as shouldCastInvis, execute as executeInvis, metadata as invisMetadata } from '../spells/invisibility';
import { shouldCast as shouldCastGI, execute as executeGI, metadata as giMetadata } from '../spells/greater_invisibility';
import { resolveAttack } from '../engine/combat';
import { removeEffectsFromCaster } from '../engine/spell_effects';
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

function withSlots2(remaining = 1): PlayerResources {
  return { spellSlots: { 2: { max: 1, remaining } } };
}
function withSlots4(remaining = 1): PlayerResources {
  return { spellSlots: { 4: { max: 1, remaining } } };
}

const INVIS_ACTION: Action = {
  name: 'Invisibility',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 13, saveAbility: 'wis',
  isAoE: false, isControl: true, requiresConcentration: true,
  slotLevel: 2, costType: 'action', legendaryCost: 0,
  description: 'Invisibility',
};

const GREATER_INVIS_ACTION: Action = {
  name: 'Greater Invisibility',
  isMultiattack: false,
  attackType: 'save',
  reach: 0,
  range: { normal: 0, long: 0 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 13, saveAbility: 'wis',
  isAoE: false, isControl: true, requiresConcentration: true,
  slotLevel: 4, costType: 'action', legendaryCost: 0,
  description: 'Greater Invisibility',
};

const LONGSWORD_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 10, // force hit
  damage: { count: 1, sides: 8, bonus: 3, average: 7 },
  damageType: 'slashing',
  saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 0, costType: 'action', legendaryCost: 0,
  description: 'Longsword',
};

const FIREBOLT_ACTION: Action = {
  name: 'Firebolt',
  isMultiattack: false,
  attackType: 'spell',
  reach: 120,
  range: { normal: 120, long: 120 },
  hitBonus: 10, // force hit
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'fire',
  saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 0, costType: 'action', legendaryCost: 0,
  description: 'Firebolt',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 16, dex: 14, con: 12, int: 12, wis: 12, cha: 12,
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

function makeWizard(id: string = 'wiz1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Wizard',
    pos,
    actions: [INVIS_ACTION, LONGSWORD_ACTION, FIREBOLT_ACTION],
    resources: withSlots2(1),
  });
}

function makeBard(id: string = 'bard1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Bard',
    pos,
    actions: [GREATER_INVIS_ACTION, LONGSWORD_ACTION, FIREBOLT_ACTION],
    resources: withSlots4(1),
  });
}

function makeEnemy(id: string = 'goblin', pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    ac: 5, // easy to hit
    pos,
  });
}

// ============================================================
// 1. Metadata — Invisibility flag now true, Greater Invisibility flag false
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('Invisibility name', invisMetadata.name, 'Invisibility');
eq('Invisibility level 2', invisMetadata.level, 2);
assert('Invisibility ends-on-attack NOW IMPLEMENTED (Session 32)',
  invisMetadata.invisibilityEndsOnAttackV1Implemented === true);

eq('Greater Invisibility name', giMetadata.name, 'Greater Invisibility');
eq('Greater Invisibility level 4', giMetadata.level, 4);
assert('Greater Invisibility ends-on-attack flag is false (not applicable)',
  (giMetadata as any).greaterInvisibilityEndsOnAttackV1Implemented === false);

// ============================================================
// 2. Invisibility sets breaksOnAttackOrCast: true
// ============================================================

console.log('\n=== 2. Invisibility sets breaksOnAttackOrCast: true ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // Wizard casts Invisibility on self (touch range includes self)
  executeInvis(caster, caster, state);

  // Find the Invisibility effect on the caster
  const invisEffect = caster.activeEffects.find(e => e.spellName === 'Invisibility');
  assert('Invisibility effect created', !!invisEffect);
  if (invisEffect) {
    eq('Invisibility effect breaksOnAttackOrCast is true', invisEffect.breaksOnAttackOrCast, true);
  }

  // Caster should be invisible
  assert('Caster is invisible', caster.conditions.has('invisible'));
}

// ============================================================
// 3. Invisibility ends on weapon attack
// ============================================================

console.log('\n=== 3. Invisibility ends on weapon attack ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeInvis(caster, caster, state);
  assert('Caster invisible before attack', caster.conditions.has('invisible'));

  // Wizard attacks the enemy with longsword (force hit via isCritOverride=true)
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);

  // Invisibility should end after the attack
  assert('Caster NOT invisible after attack', !caster.conditions.has('invisible'));

  // The effect should be removed from activeEffects
  const invisEffect = caster.activeEffects.find(e => e.spellName === 'Invisibility');
  assert('Invisibility effect removed from activeEffects', !invisEffect);

  // A condition_remove event should be logged
  const removeEvent = state.log.events.find((e: any) =>
    e.type === 'condition_remove' && e.description.includes('Invisibility'));
  assert('condition_remove event logged', !!removeEvent);
  if (removeEvent) {
    assert('Event mentions "attacked or cast"', (removeEvent as any).description.includes('attacked or cast'));
  }
}

// ============================================================
// 4. Invisibility ends on spell cast (spell attack)
// ============================================================

console.log('\n=== 4. Invisibility ends on spell attack ===\n');

{
  const caster = makeWizard();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeInvis(caster, caster, state);
  assert('Caster invisible before spell attack', caster.conditions.has('invisible'));

  // Wizard casts Firebolt at the enemy (attackType='spell' — triggers break-on-attack)
  resolveAttack(caster, enemy, FIREBOLT_ACTION, state, true);

  // Invisibility should end after the spell attack
  assert('Caster NOT invisible after spell attack', !caster.conditions.has('invisible'));
}

// ============================================================
// 5. Greater Invisibility does NOT set breaksOnAttackOrCast
// ============================================================

console.log('\n=== 5. Greater Invisibility does NOT set breaksOnAttackOrCast ===\n');

{
  const caster = makeBard();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  executeGI(caster, caster, state);

  const giEffect = caster.activeEffects.find(e => e.spellName === 'Greater Invisibility');
  assert('Greater Invisibility effect created', !!giEffect);
  if (giEffect) {
    // Greater Invisibility should NOT have breaksOnAttackOrCast (undefined or false)
    eq('Greater Invisibility breaksOnAttackOrCast is undefined/false',
      giEffect.breaksOnAttackOrCast, undefined);
  }

  assert('Caster is invisible', caster.conditions.has('invisible'));
}

// ============================================================
// 6. Greater Invisibility persists through attacks
// ============================================================

console.log('\n=== 6. Greater Invisibility persists through attacks ===\n');

{
  const caster = makeBard();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeGI(caster, caster, state);
  assert('Caster invisible before attack', caster.conditions.has('invisible'));

  // Bard attacks the enemy with longsword
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);

  // Greater Invisibility should NOT end — caster still invisible
  assert('Caster STILL invisible after attack (Greater Invisibility)', caster.conditions.has('invisible'));

  const giEffect = caster.activeEffects.find(e => e.spellName === 'Greater Invisibility');
  assert('Greater Invisibility effect still active', !!giEffect);

  // No condition_remove event for Greater Invisibility
  const removeEvent = state.log.events.find((e: any) =>
    e.type === 'condition_remove' && e.description.includes('Greater Invisibility'));
  assert('No condition_remove event for Greater Invisibility', !removeEvent);

  // Bard attacks again — still invisible
  resolveAttack(caster, enemy, LONGSWORD_ACTION, state, true);
  assert('Caster STILL invisible after 2nd attack', caster.conditions.has('invisible'));
}

// ============================================================
// 7. Greater Invisibility persists through spell casts
// ============================================================

console.log('\n=== 7. Greater Invisibility persists through spell casts ===\n');

{
  const caster = makeBard();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeGI(caster, caster, state);
  assert('Caster invisible before spell cast', caster.conditions.has('invisible'));

  // Bard casts Firebolt (spell attack)
  resolveAttack(caster, enemy, FIREBOLT_ACTION, state, true);

  // Greater Invisibility should NOT end
  assert('Caster STILL invisible after spell cast (Greater Invisibility)', caster.conditions.has('invisible'));
}

// ============================================================
// 8. Concentration break still ends both spells
// ============================================================

console.log('\n=== 8. Concentration break ends both spells ===\n');

{
  const caster = makeBard();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeGI(caster, caster, state);
  assert('Caster invisible before concentration break', caster.conditions.has('invisible'));

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  assert('Caster NOT invisible after concentration break', !caster.conditions.has('invisible'));
  const giEffect = caster.activeEffects.find(e => e.spellName === 'Greater Invisibility');
  assert('Greater Invisibility effect removed', !giEffect);
}

{
  const caster = makeWizard();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeInvis(caster, caster, state);
  assert('Caster invisible before concentration break', caster.conditions.has('invisible'));

  removeEffectsFromCaster(caster.id, bf);

  assert('Caster NOT invisible after concentration break', !caster.conditions.has('invisible'));
  const invisEffect = caster.activeEffects.find(e => e.spellName === 'Invisibility');
  assert('Invisibility effect removed', !invisEffect);
}

// ============================================================
// 9. shouldCast gates
// ============================================================

console.log('\n=== 9. shouldCast gates ===\n');

{
  // Greater Invisibility: caster already invisible → false
  const caster = makeBard();
  caster.conditions.add('invisible');
  const bf = makeBF([caster]);
  assert('Greater Invisibility false when already invisible', shouldCastGI(caster, bf) === false);
}

{
  // Greater Invisibility: caster already concentrating → false
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  const bf = makeBF([caster]);
  assert('Greater Invisibility false when already concentrating', shouldCastGI(caster, bf) === false);
}

{
  // Greater Invisibility: no 4th-level slot → false
  const caster = makeBard();
  caster.resources = withSlots4(0);
  const bf = makeBF([caster]);
  assert('Greater Invisibility false when no L4 slots', shouldCastGI(caster, bf) === false);
}

{
  // Greater Invisibility: all conditions met → true
  const caster = makeBard();
  const bf = makeBF([caster]);
  assert('Greater Invisibility true when all conditions met', shouldCastGI(caster, bf) === true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
