// ============================================================
// death_armor.test.ts — Death Armor spell module
// XGE / Planescape: 2nd-level abjuration, action, range Self (5-ft aura),
// concentration (1 min).
// Effect (v1 simplified): 1d4 slashing aura on enemies within 5 ft of caster
//   at cast time. No save. Canon is retaliation-on-attack; v1 simplifies to
//   start-of-turn damage_zone aura (flag deathArmorRetaliationV1SimplifiedToAura).
//
// Tests cover metadata shape, shouldCast() precondition gates + aura radius,
// execute() immediate damage + damage_zone payload + slot consumption +
// concentration start + logging, and cleanup() no-op.
// ============================================================

import { shouldCast, execute, metadata, rollDamage, cleanup } from '../spells/death_armor';
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

// ---- Factories ----------------------------------------------

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const DEATH_ARMOR_ACTION: Action = {
  name: 'Death Armor',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Death Armor (1d4 slashing aura, concentration 1 min)',
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

function makeCaster(id = 'wiz', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Wizard',
    pos,
    actions: [DEATH_ARMOR_ACTION],
    resources: withSlots2(2),
  });
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
    ...overrides,
  });
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

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Death Armor', metadata.name, 'Death Armor');
eq('level is 2', metadata.level, 2);
eq('school is abjuration', metadata.school, 'abjuration');
eq('rangeFt is 5', metadata.rangeFt, 5);
eq('aoeSizeFt is 5', metadata.aoeSizeFt, 5);
eq('dieCount is 1', metadata.dieCount, 1);
eq('dieSides is 4', metadata.dieSides, 4);
eq('damageType is slashing', metadata.damageType, 'slashing');
eq('is concentration', metadata.concentration, true);
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (retaliation simplified to aura)',
  (metadata as any).deathArmorRetaliationV1SimplifiedToAura, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  // 2b. Caster lacks 'Death Armor' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Death Armor action', shouldCast(caster, bf), null);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2d. No enemies within 5 ft aura (enemy at x=2 → 10 ft > 5 ft)
  const caster = makeCaster();
  const farEnemy = makeEnemy('far', { x: 2, y: 0, z: 0 });   // 10 ft away
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 5 ft aura', shouldCast(caster, bf), null);
}

{
  // 2e. Happy path: enemy at x=1 → 5 ft, within aura
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });   // 5 ft away
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 1 target (enemy in aura)', targets!.length, 1);
  eq('Target is e1', targets![0].id, 'e1');
}

{
  // 2f. Multiple enemies in aura — all returned
  const caster = makeCaster();
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 0, y: 1, z: 0 });
  const e3 = makeEnemy('e3', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, e1, e2, e3]);
  const targets = shouldCast(caster, bf);
  eq('Returns 3 targets (all in 5 ft aura)', targets!.length, 3);
}

{
  // 2g. Dead enemy ignored
  const caster = makeCaster();
  const dead = makeEnemy('dead', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const alive = makeEnemy('alive', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, dead, alive]);
  const targets = shouldCast(caster, bf);
  eq('Dead enemy ignored', targets!.length, 1);
  eq('Alive enemy returned', targets![0].id, 'alive');
}

// ============================================================
// 3. execute — damage_zone payload + immediate damage
// ============================================================

console.log('\n=== 3. execute — damage_zone payload + immediate damage ===\n');

{
  // 3a. Slot consumed, concentration started
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Death Armor', caster.concentration?.spellName, 'Death Armor');
}

{
  // 3b. Immediate on-cast damage: 1d4 slashing → HP reduced by [1, 4]
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Immediate damage in [1, 4] (1d4 slashing)', hpLost >= 1 && hpLost <= 4, `got ${hpLost}`);
}

{
  // 3c. damage_zone effect applied with correct payload
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 1', z.payload.dieCount, 1);
    eq('damage_zone dieSides is 4', z.payload.dieSides, 4);
    eq('damage_zone damageType is slashing', z.payload.damageType, 'slashing');
    eq('damage_zone has NO saveDC (canon: no save)', z.payload.saveDC, undefined);
    eq('damage_zone has NO saveAbility', z.payload.saveAbility, undefined);
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Death Armor', z.spellName, 'Death Armor');
    eq('damage_zone casterId matches caster', z.casterId, caster.id);
  }
}

{
  // 3d. Multiple targets all get damage_zone effect
  const caster = makeCaster();
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('e1 has 1 damage_zone effect', getActiveDamageZones(e1).length, 1);
  eq('e2 has 1 damage_zone effect', getActiveDamageZones(e2).length, 1);
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Action event emitted', actionEvents.length >= 1);
  assert('Damage event emitted', damageEvents.length >= 1);
  assert('Condition_add event emitted (damage_zone applied)', condEvents.length >= 1);
  assert('Action event mentions "Death Armor"', actionEvents[0].description.includes('Death Armor'));
  assert('Damage event mentions "Death Armor"', damageEvents[0].description.includes('Death Armor'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Death Armor', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Death Armor');
}

// ============================================================
// 6. rollDamage range check
// ============================================================

console.log('\n=== 6. rollDamage range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [1, 4] (iteration ${i})`, dmg >= 1 && dmg <= 4, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
