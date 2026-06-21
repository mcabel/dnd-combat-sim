// ============================================================
// shadow_blade.test.ts — Shadow Blade spell module
// PHB p.275: 2nd-level illusion, bonus action, range Self, concentration (1 min).
// Effect: +1 attack, +2d8 psychic on weapon attacks (self-buff).
//
// v1 simplifications (documented via metadata flags):
//   - v1 enchants existing weapon (canon: creates a new weapon).
//   - Bonus-action attack on cast NOT modelled.
//   - Concentration started but NOT enforced (TG-002).
//
// Tests cover metadata shape, shouldCast() precondition gates, execute()
// weapon_enchant application via getActiveWeaponEnchant() query helper,
// logging, and the cleanup no-op.
// ============================================================

import { shouldCast, execute, metadata, cleanup } from '../spells/shadow_blade';
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

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const SHADOW_BLADE_ACTION: Action = {
  name: 'Shadow Blade',
  isMultiattack: false,
  attackType: null,
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
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Shadow Blade (+1 attack, +2d8 psychic on weapon attacks, concentration 1 min)',
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

function makeCaster(id = 'warlock1'): Combatant {
  return makeCombatant(id, {
    name: 'Warlock',
    actions: [SHADOW_BLADE_ACTION],
    resources: withSlots2(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Shadow Blade', metadata.name, 'Shadow Blade');
eq('level is 2', metadata.level, 2);
eq('school is illusion', metadata.school, 'illusion');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('is concentration', metadata.concentration, true);
eq('casting time is bonus action', metadata.castingTime, 'bonus action');
eq('attackBonus is 1', metadata.attackBonus, 1);
eq('damageBonus is 0', metadata.damageBonus, 0);
eq('damageDie is 8', metadata.damageDie, 8);
eq('damageDieCount is 2', metadata.damageDieCount, 2);
eq('damageType is psychic', metadata.damageType, 'psychic');
eq('canon flag is set', (metadata as any).shadowBladeCanonV1Implemented, true);
eq('creates-weapon simplification flag is set',
  (metadata as any).shadowBladeCreatesWeaponV1Simplified, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  const bf = makeBF([caster]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2b. Caster lacks 'Shadow Blade' action
  const caster = makeCaster();
  caster.actions = [];
  const bf = makeBF([caster]);
  assert('Returns false when caster has no Shadow Blade action', shouldCast(caster, bf) === false);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots2(0);
  const bf = makeBF([caster]);
  assert('Returns false when no 2nd-level slots', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster already enchanted with Shadow Blade — skip
  const caster = makeCaster();
  caster.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Shadow Blade',
    effectType: 'weapon_enchant', payload: { attackBonus: 1, damageBonus: 0, damageDie: 8, damageDieCount: 2, damageDieType: 'psychic' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster]);
  assert('Returns false when caster already has Shadow Blade active', shouldCast(caster, bf) === false);
}

{
  // 2e. Happy path — all preconditions met
  const caster = makeCaster();
  const bf = makeBF([caster]);
  assert('Returns true when all preconditions met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. execute — weapon_enchant application
// ============================================================

console.log('\n=== 3. execute — weapon_enchant application ===\n');

{
  // 3a. weapon_enchant effect attached with correct payload
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
    eq('damageDie payload is 8', enchants[0].payload.damageDie, 8);
    eq('damageDieCount payload is 2', enchants[0].payload.damageDieCount, 2);
    eq('damageDieType payload is psychic', enchants[0].payload.damageDieType, 'psychic');
    eq('sourceIsConcentration is true', enchants[0].sourceIsConcentration, true);
    eq('spellName is Shadow Blade', enchants[0].spellName, 'Shadow Blade');
    eq('casterId is the caster', enchants[0].casterId, 'warlock1');
  }

  // Query helper returns the same values
  const enchant = getActiveWeaponEnchant(caster);
  eq('getActiveWeaponEnchant attackBonus is 1', enchant.attackBonus, 1);
  eq('getActiveWeaponEnchant damageBonus is 0', enchant.damageBonus, 0);
  eq('getActiveWeaponEnchant damageDie is 8', enchant.damageDie, 8);
  eq('getActiveWeaponEnchant damageDieCount is 2', enchant.damageDieCount, 2);
  eq('getActiveWeaponEnchant damageDieType is psychic', enchant.damageDieType, 'psychic');

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3b. Concentration started on caster
  const caster = makeCaster();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Shadow Blade', caster.concentration?.spellName, 'Shadow Blade');
}

{
  // 3c. Existing concentration broken (safety net)
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  caster.activeEffects.push({
    id: 'eff_hex', casterId: caster.id, spellName: 'Hex',
    effectType: 'hex_damage', payload: { hexDie: 6 }, sourceIsConcentration: true,
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration switched to Shadow Blade', caster.concentration?.spellName, 'Shadow Blade');
  assert('Prior Hex effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Hex'));
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
  assert('Action event mentions Shadow Blade',
    actionEvents.some(e => e.description.includes('Shadow Blade')));
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
  caster.concentration = { active: true, spellName: 'Shadow Blade', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Shadow Blade');
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
  eq('damageDie 8', enchant.damageDie, 8);
  eq('damageDieCount 2', enchant.damageDieCount, 2);
  eq('damageDieType psychic', enchant.damageDieType, 'psychic');
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Shadow Blade', caster.concentration?.spellName, 'Shadow Blade');

  assert('shouldCast returns false after cast (concentration active)', shouldCast(caster, bf) === false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
