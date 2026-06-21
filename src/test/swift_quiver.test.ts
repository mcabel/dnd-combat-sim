// ============================================================
// swift_quiver.test.ts — Swift Quiver spell module
// PHB p.279: 5th-level transmutation, bonus action, range Touch (5 ft), concentration (1 min).
// Effect: bonus-action extra attack — NOT modelled in v1 (marker only).
//
// v1 simplifications (documented via metadata flags):
//   - Self-buff (canon: touch ally's quiver).
//   - v1: marker effect only; canon bonus-action extra attack NOT modelled.
//   - LOW tactical value in v1.
//   - Concentration started but NOT enforced (TG-002).
//
// Tests cover metadata shape, shouldCast() precondition gates, execute()
// weapon_enchant marker application (all-zero payload), logging, and the
// cleanup no-op.
// ============================================================

import { shouldCast, execute, metadata, cleanup } from '../spells/swift_quiver';
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

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

const SWIFT_QUIVER_ACTION: Action = {
  name: 'Swift Quiver',
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
  slotLevel: 5,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Swift Quiver (v1: marker effect; canon bonus-action extra attack NOT modelled)',
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

function makeCaster(id = 'ranger1'): Combatant {
  return makeCombatant(id, {
    name: 'Ranger',
    actions: [SWIFT_QUIVER_ACTION],
    resources: withSlots5(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Swift Quiver', metadata.name, 'Swift Quiver');
eq('level is 5', metadata.level, 5);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('is concentration', metadata.concentration, true);
eq('casting time is bonus action', metadata.castingTime, 'bonus action');
eq('attackBonus is 0 (marker)', metadata.attackBonus, 0);
eq('damageBonus is 0 (marker)', metadata.damageBonus, 0);
eq('canon flag is set', (metadata as any).swiftQuiverCanonV1Implemented, true);
eq('bonus-action-attack NOT modelled flag is set',
  (metadata as any).swiftQuiverBonusActionAttackV1NotModelled, true);
// Swift Quiver has NO damage die — metadata should omit damageDie.
eq('metadata omits damageDie (no damage die)',
  (metadata as any).damageDie, undefined);
eq('metadata omits damageDieCount (no damage die)',
  (metadata as any).damageDieCount, undefined);
eq('metadata omits damageType (no damage die)',
  (metadata as any).damageType, undefined);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hunter\'s Mark', dcIfHit: 10 };
  const bf = makeBF([caster]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const bf = makeBF([caster]);
  assert('Returns false when caster has no Swift Quiver action', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.resources = withSlots5(0);
  const bf = makeBF([caster]);
  assert('Returns false when no 5th-level slots', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  caster.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Swift Quiver',
    effectType: 'weapon_enchant', payload: { attackBonus: 0, damageBonus: 0 },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster]);
  assert('Returns false when caster already has Swift Quiver active', shouldCast(caster, bf) === false);
}

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  assert('Returns true when all preconditions met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. execute — weapon_enchant marker application
// ============================================================

console.log('\n=== 3. execute — weapon_enchant marker application ===\n');

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const enchants = caster.activeEffects.filter(e => e.effectType === 'weapon_enchant');
  eq('1 weapon_enchant effect applied', enchants.length, 1);
  if (enchants.length === 1) {
    eq('effectType is weapon_enchant', enchants[0].effectType, 'weapon_enchant');
    eq('attackBonus payload is 0 (marker)', enchants[0].payload.attackBonus, 0);
    eq('damageBonus payload is 0 (marker)', enchants[0].payload.damageBonus, 0);
    eq('damageDie payload is undefined (marker)', enchants[0].payload.damageDie, undefined);
    eq('damageDieCount payload is undefined (marker)', enchants[0].payload.damageDieCount, undefined);
    eq('damageDieType payload is undefined (marker)', enchants[0].payload.damageDieType, undefined);
    eq('sourceIsConcentration is true', enchants[0].sourceIsConcentration, true);
    eq('spellName is Swift Quiver', enchants[0].spellName, 'Swift Quiver');
    eq('casterId is the caster', enchants[0].casterId, 'ranger1');
  }

  // Query helper returns all-zero values (no bonuses, no damage die)
  const enchant = getActiveWeaponEnchant(caster);
  eq('getActiveWeaponEnchant attackBonus is 0', enchant.attackBonus, 0);
  eq('getActiveWeaponEnchant damageBonus is 0', enchant.damageBonus, 0);
  eq('getActiveWeaponEnchant damageDie is 0', enchant.damageDie, 0);
  eq('getActiveWeaponEnchant damageDieCount is 0', enchant.damageDieCount, 0);

  eq('Slot consumed', caster.resources!.spellSlots![5]!.remaining, 1);
}

{
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Swift Quiver', caster.concentration?.spellName, 'Swift Quiver');
}

{
  // Existing concentration broken (safety net)
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hunter\'s Mark', dcIfHit: 10 };
  caster.activeEffects.push({
    id: 'eff_hm', casterId: caster.id, spellName: 'Hunter\'s Mark',
    effectType: 'hex_damage', payload: { hexDie: 6 }, sourceIsConcentration: true,
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration switched to Swift Quiver', caster.concentration?.spellName, 'Swift Quiver');
  assert('Prior Hunter\'s Mark effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Hunter\'s Mark'));
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
  assert('Action event mentions Swift Quiver',
    actionEvents.some(e => e.description.includes('Swift Quiver')));
  eq('1 condition_add event (marker applied)', condEvents.length, 1);
  assert('condition_add mentions weapon enchanted',
    condEvents[0].description.includes('weapon'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Swift Quiver', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Swift Quiver');
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
  eq('attackBonus 0 (marker)', enchant.attackBonus, 0);
  eq('damageBonus 0 (marker)', enchant.damageBonus, 0);
  eq('damageDie 0 (marker)', enchant.damageDie, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![5]!.remaining, 1);
  eq('Caster concentrating on Swift Quiver', caster.concentration?.spellName, 'Swift Quiver');

  assert('shouldCast returns false after cast (concentration active)', shouldCast(caster, bf) === false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
