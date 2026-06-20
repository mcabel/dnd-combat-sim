// ============================================================
// cacophonic_shield.test.ts — Cacophonic Shield spell module
// AI p.143: 3rd-level evocation, action, range Self (10-ft aura), concentration (10 min).
// Effect (v1 simplified): 2d6 thunder aura on enemies within 10 ft of caster at
//   cast time. No save. Canon emanation is centered on caster (moves with them);
//   v1 simplifies to aura anchored at cast (flag cacophonicShieldMovingAuraV1Simplified).
// ============================================================

import { shouldCast, execute, metadata, rollDamage, cleanup } from '../spells/cacophonic_shield';
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

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const CACOPHONIC_ACTION: Action = {
  name: 'Cacophonic Shield',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 10, long: 10 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Cacophonic Shield (2d6 thunder aura, concentration 10 min)',
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

function makeCaster(id = 'wiz', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Wizard',
    pos,
    actions: [CACOPHONIC_ACTION],
    resources: withSlots3(2),
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

eq('name is Cacophonic Shield', metadata.name, 'Cacophonic Shield');
eq('level is 3', metadata.level, 3);
eq('school is evocation', metadata.school, 'evocation');
eq('rangeFt is 10', metadata.rangeFt, 10);
eq('aoeSizeFt is 10', metadata.aoeSizeFt, 10);
eq('dieCount is 2', metadata.dieCount, 2);
eq('dieSides is 6', metadata.dieSides, 6);
eq('damageType is thunder', metadata.damageType, 'thunder');
eq('is concentration', metadata.concentration, true);
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (moving aura simplified)',
  (metadata as any).cacophonicShieldMovingAuraV1Simplified, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Cacophonic Shield action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots3(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}

{
  // No enemies within 10 ft aura (enemy at x=3 → 15 ft)
  const caster = makeCaster();
  const farEnemy = makeEnemy('far', { x: 3, y: 0, z: 0 });   // 15 ft away
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 10 ft aura', shouldCast(caster, bf), null);
}

{
  // Happy path: enemy at x=2 → 10 ft, within aura
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 2, y: 0, z: 0 });   // 10 ft away (boundary)
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 1 target (enemy at 10 ft boundary)', targets!.length, 1);
  eq('Target is e1', targets![0].id, 'e1');
}

{
  // Multiple enemies in aura — all returned (10 ft radius covers 5x5 cells)
  const caster = makeCaster();
  const e1 = makeEnemy('e1', { x: 2, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 0, y: 2, z: 0 });
  const e3 = makeEnemy('e3', { x: 2, y: 2, z: 0 });  // chebyshev3D = 2 → 10 ft
  const bf = makeBF([caster, e1, e2, e3]);
  const targets = shouldCast(caster, bf);
  eq('Returns 3 targets (all within 10 ft aura)', targets!.length, 3);
}

// ============================================================
// 3. execute — damage_zone payload + immediate damage
// ============================================================

console.log('\n=== 3. execute — damage_zone payload + immediate damage ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![3]!.remaining, 1);
  eq('Caster concentrating on Cacophonic Shield', caster.concentration?.spellName, 'Cacophonic Shield');

  const hpLost = 100 - enemy.currentHP;
  assert('Immediate damage in [2, 12] (2d6 thunder)', hpLost >= 2 && hpLost <= 12, `got ${hpLost}`);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 2', z.payload.dieCount, 2);
    eq('damage_zone dieSides is 6', z.payload.dieSides, 6);
    eq('damage_zone damageType is thunder', z.payload.damageType, 'thunder');
    eq('damage_zone has NO saveDC', z.payload.saveDC, undefined);
    eq('damage_zone has NO saveAbility', z.payload.saveAbility, undefined);
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Cacophonic Shield', z.spellName, 'Cacophonic Shield');
    eq('damage_zone casterId matches caster', z.casterId, caster.id);
  }
}

{
  // Multiple targets all get damage_zone effect
  const caster = makeCaster();
  const e1 = makeEnemy('e1', { x: 2, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 0, y: 2, z: 0 });
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
  const enemy = makeEnemy('e1', { x: 2, y: 0, z: 0 });
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
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions "Cacophonic Shield"', actionEvents[0].description.includes('Cacophonic Shield'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Cacophonic Shield', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Cacophonic Shield');
}

// ============================================================
// 6. rollDamage range check
// ============================================================

console.log('\n=== 6. rollDamage range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [2, 12] (iteration ${i})`, dmg >= 2 && dmg <= 12, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
