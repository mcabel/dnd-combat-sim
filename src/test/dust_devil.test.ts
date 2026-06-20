// ============================================================
// dust_devil.test.ts — Dust Devil spell module
// XGE p.154: 2nd-level conjuration, action, range 60 ft, concentration (1 min).
// Effect (v1 simplified): 1d8 bludgeoning aura on enemies within 5 ft of caster
//   at cast time. No save. Canon the cube moves with bonus action; v1 simplifies
//   to aura anchored at cast (flag dustDevilMovingAuraV1Simplified).
// ============================================================

import { shouldCast, execute, metadata, rollDamage, cleanup } from '../spells/dust_devil';
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

const DUST_DEVIL_ACTION: Action = {
  name: 'Dust Devil',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 60, long: 60 },
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
  description: 'Dust Devil (1d8 bludgeoning aura, concentration 1 min)',
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
    actions: [DUST_DEVIL_ACTION],
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

eq('name is Dust Devil', metadata.name, 'Dust Devil');
eq('level is 2', metadata.level, 2);
eq('school is conjuration', metadata.school, 'conjuration');
eq('rangeFt is 60', metadata.rangeFt, 60);
eq('aoeSizeFt is 5', metadata.aoeSizeFt, 5);
eq('dieCount is 1', metadata.dieCount, 1);
eq('dieSides is 8', metadata.dieSides, 8);
eq('damageType is bludgeoning', metadata.damageType, 'bludgeoning');
eq('is concentration', metadata.concentration, true);
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (moving aura simplified)',
  (metadata as any).dustDevilMovingAuraV1Simplified, true);

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
  eq('Returns null when caster has no Dust Devil action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  const farEnemy = makeEnemy('far', { x: 2, y: 0, z: 0 });   // 10 ft away
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 5 ft aura', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 1 target (enemy in aura)', targets!.length, 1);
  eq('Target is e1', targets![0].id, 'e1');
}

{
  // Enemy already in this caster's Dust Devil zone — skipped
  const caster = makeCaster();
  const enemy = makeEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_dd1', casterId: caster.id, spellName: 'Dust Devil',
    effectType: 'damage_zone',
    payload: { dieCount: 1, dieSides: 8, damageType: 'bludgeoning' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when enemy already in this caster\'s Dust Devil zone', shouldCast(caster, bf), null);
}

// ============================================================
// 3. execute — damage_zone payload + immediate damage
// ============================================================

console.log('\n=== 3. execute — damage_zone payload + immediate damage ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Dust Devil', caster.concentration?.spellName, 'Dust Devil');

  const hpLost = 100 - enemy.currentHP;
  assert('Immediate damage in [1, 8] (1d8 bludgeoning)', hpLost >= 1 && hpLost <= 8, `got ${hpLost}`);
}

{
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
    eq('damage_zone dieSides is 8', z.payload.dieSides, 8);
    eq('damage_zone damageType is bludgeoning', z.payload.damageType, 'bludgeoning');
    eq('damage_zone has NO saveDC', z.payload.saveDC, undefined);
    eq('damage_zone has NO saveAbility', z.payload.saveAbility, undefined);
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Dust Devil', z.spellName, 'Dust Devil');
    eq('damage_zone casterId matches caster', z.casterId, caster.id);
  }
}

{
  // Multiple targets
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
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions "Dust Devil"', actionEvents[0].description.includes('Dust Devil'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Dust Devil', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Dust Devil');
}

// ============================================================
// 6. rollDamage range check
// ============================================================

console.log('\n=== 6. rollDamage range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [1, 8] (iteration ${i})`, dmg >= 1 && dmg <= 8, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
