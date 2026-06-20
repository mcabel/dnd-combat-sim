// ============================================================
// elemental_weapon.test.ts — Elemental Weapon spell module
// PHB p.234: 3rd-level transmutation, action, range Touch (5 ft), concentration (1 hr).
// Effect: +1 attack, +1d4 fire on weapon attacks (v1: self-buff).
//
// v1 simplifications (documented via metadata flags):
//   - Self-buff (canon: touch ally's weapon).
//   - Element fixed to fire (canon: caster chooses acid/cold/fire/lightning/thunder).
//   - Concentration started but NOT enforced (TG-002).
//
// Tests cover metadata shape, shouldCast() precondition gates, execute()
// weapon_enchant application via getActiveWeaponEnchant() query helper,
// logging, and the cleanup no-op.
// ============================================================

import { shouldCast, execute, metadata, cleanup } from '../spells/elemental_weapon';
import { getActiveWeaponEnchant } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const ELEMENTAL_WEAPON_ACTION: Action = {
  name: 'Elemental Weapon',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Elemental Weapon (+1 attack, +1d4 fire on weapon attacks, concentration 1 hr)',
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

function makeCaster(id = 'paladin1'): Combatant {
  return makeCombatant(id, {
    name: 'Paladin',
    actions: [ELEMENTAL_WEAPON_ACTION],
    resources: withSlots3(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Elemental Weapon', metadata.name, 'Elemental Weapon');
eq('level is 3', metadata.level, 3);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('attackBonus is 1', metadata.attackBonus, 1);
eq('damageBonus is 0', metadata.damageBonus, 0);
eq('damageDie is 4', metadata.damageDie, 4);
eq('damageDieCount is 1', metadata.damageDieCount, 1);
eq('damageType is fire', metadata.damageType, 'fire');
eq('canon flag is set', (metadata as any).elementalWeaponCanonV1Implemented, true);
eq('element-choice simplification flag is set',
  (metadata as any).elementalWeaponElementChoiceV1Simplified, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const bf = makeBF([caster]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const bf = makeBF([caster]);
  assert('Returns false when caster has no Elemental Weapon action', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.resources = withSlots3(0);
  const bf = makeBF([caster]);
  assert('Returns false when no 3rd-level slots', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Elemental Weapon',
    effectType: 'weapon_enchant', payload: { attackBonus: 1, damageBonus: 0, damageDie: 4, damageDieCount: 1, damageDieType: 'fire' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster]);
  assert('Returns false when caster already has Elemental Weapon active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  assert('Returns true when all preconditions met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. execute — weapon_enchant application
// ============================================================

console.log('\n=== 3. execute — weapon_enchant application ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const enchants = caster.activeEffects.filter(e => e.effectType === 'weapon_enchant');
  eq('1 weapon_enchant effect applied', enchants.length, 1);
  if (enchants.length === 1) {
    eq('effectType is weapon_enchant', enchants[0].effectType, 'weapon_enchant');
    eq('attackBonus payload is 1', enchants[0].payload.attackBonus, 1);
    eq('damageBonus payload is 0', enchants[0].payload.damageBonus, 0);
    eq('damageDie payload is 4', enchants[0].payload.damageDie, 4);
    eq('damageDieCount payload is 1', enchants[0].payload.damageDieCount, 1);
    eq('damageDieType payload is fire', enchants[0].payload.damageDieType, 'fire');
    eq('sourceIsConcentration is true', enchants[0].sourceIsConcentration, true);
    eq('spellName is Elemental Weapon', enchants[0].spellName, 'Elemental Weapon');
    eq('casterId is the caster', enchants[0].casterId, 'paladin1');
  }

  const enchant = getActiveWeaponEnchant(caster);
  eq('getActiveWeaponEnchant attackBonus is 1', enchant.attackBonus, 1);
  eq('getActiveWeaponEnchant damageBonus is 0', enchant.damageBonus, 0);
  eq('getActiveWeaponEnchant damageDie is 4', enchant.damageDie, 4);
  eq('getActiveWeaponEnchant damageDieCount is 1', enchant.damageDieCount, 1);
  eq('getActiveWeaponEnchant damageDieType is fire', enchant.damageDieType, 'fire');

  eq('Slot consumed', caster.resources!.spellSlots![3]!.remaining, 1);
}

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Elemental Weapon', caster.concentration?.spellName, 'Elemental Weapon');
}

{
  // Existing concentration broken (safety net)
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  caster.activeEffects.push({
    id: 'eff_bless', casterId: caster.id, spellName: 'Bless',
    effectType: 'bless_die', payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration switched to Elemental Weapon', caster.concentration?.spellName, 'Elemental Weapon');
  assert('Prior Bless effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Bless'));
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions Elemental Weapon',
    actionEvents.some(e => e.description.includes('Elemental Weapon')));
  eq('1 condition_add event (weapon_enchant applied)', condEvents.length, 1);
  assert('condition_add mentions weapon enchanted',
    condEvents[0].description.includes('weapon'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Elemental Weapon', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Elemental Weapon');
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  assert('shouldCast returns true', shouldCast(caster, bf) === true);
  execute(caster, state);

  const enchant = getActiveWeaponEnchant(caster);
  eq('attackBonus 1', enchant.attackBonus, 1);
  eq('damageBonus 0', enchant.damageBonus, 0);
  eq('damageDie 4', enchant.damageDie, 4);
  eq('damageDieCount 1', enchant.damageDieCount, 1);
  eq('damageDieType fire', enchant.damageDieType, 'fire');
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![3]!.remaining, 1);
  eq('Caster concentrating on Elemental Weapon', caster.concentration?.spellName, 'Elemental Weapon');

  assert('shouldCast returns false after cast (concentration active)', shouldCast(caster, bf) === false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
