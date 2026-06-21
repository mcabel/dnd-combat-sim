// ============================================================
// guardian_of_faith.test.ts — Guardian of Faith spell module
// PHB p.246: 4th-level conjuration, action, range 30 ft. NO concentration.
// Effect (v1 simplified): One-shot 20d6 radiant to all enemies within 10 ft of
//   the highest-threat enemy within 60 ft of caster. No save, NO damage_zone effect
//   (no per-turn tick, no budget tracking).
//   Flag guardianOfFaithDamageBudgetV1SimplifiedToOneShot,
//         guardianOfFaithDexSaveV1SimplifiedToNone,
//         guardianOfFaithPlacementV1Simplified.
// ============================================================

import { shouldCast, execute, metadata, rollDamage, cleanup } from '../spells/guardian_of_faith';
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

function withSlots4(remaining = 2): PlayerResources {
  return { spellSlots: { 4: { max: 2, remaining } } };
}

const GUARDIAN_ACTION: Action = {
  name: 'Guardian of Faith',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Guardian of Faith (20d6 radiant one-shot, no concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 500, currentHP: 500, ac: 14, speed: 30,
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
    name: 'Cleric',
    pos,
    actions: [GUARDIAN_ACTION],
    resources: withSlots4(2),
  });
}

function makeEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
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

eq('name is Guardian of Faith', metadata.name, 'Guardian of Faith');
eq('level is 4', metadata.level, 4);
eq('school is conjuration', metadata.school, 'conjuration');
eq('rangeFt is 60 (v1)', metadata.rangeFt, 60);
eq('aoeSizeFt is 10', metadata.aoeSizeFt, 10);
eq('dieCount is 20', metadata.dieCount, 20);
eq('dieSides is 6', metadata.dieSides, 6);
eq('damageType is radiant', metadata.damageType, 'radiant');
eq('is NOT concentration', metadata.concentration, false);
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (damage budget simplified to one-shot)',
  (metadata as any).guardianOfFaithDamageBudgetV1SimplifiedToOneShot, true);
eq('canon flag set (dex save simplified to none)',
  (metadata as any).guardianOfFaithDexSaveV1SimplifiedToNone, true);
eq('canon flag set (placement simplified)',
  (metadata as any).guardianOfFaithPlacementV1Simplified, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // Guardian of Faith is NOT concentration — caster CAN be concentrating on another spell
  // (no concentration.active gate applied).
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Returns targets even when caster is concentrating (GoF is not conc)', targets !== null);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Guardian of Faith action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots4(0);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 4th-level slots', shouldCast(caster, bf), null);
}

{
  // No enemies within 60 ft of caster
  const caster = makeCaster();
  const farEnemy = makeEnemy('far', { x: 13, y: 0, z: 0 });   // 65 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 60 ft of caster', shouldCast(caster, bf), null);
}

{
  // Happy path: highest-threat enemy becomes placement point; nearby enemies collected
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 4, y: 0, z: 0 }, { maxHP: 400, currentHP: 400 });
  const nearby = makeEnemy('nearby', { x: 5, y: 0, z: 0 }, { maxHP: 200, currentHP: 200 });
  const bf = makeBF([caster, center, nearby]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 2 targets (center + nearby)', targets!.length, 2);
}

{
  // Aura-radius exclusion: enemy outside 10 ft of center is NOT a target
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 4, y: 0, z: 0 }, { maxHP: 400, currentHP: 400 });
  const tooFar = makeEnemy('toofar', { x: 7, y: 0, z: 0 }, { maxHP: 200, currentHP: 200 });   // 15 ft from center
  const bf = makeBF([caster, center, tooFar]);
  const targets = shouldCast(caster, bf);
  eq('Returns 1 target (only center; too-far excluded)', targets!.length, 1);
  eq('Only center is targeted', targets![0].id, 'center');
}

// ============================================================
// 3. execute — one-shot damage (NO damage_zone effect)
// ============================================================

console.log('\n=== 3. execute — one-shot damage ===\n');

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 4, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const nearby = makeEnemy('nearby', { x: 5, y: 0, z: 0 }, { maxHP: 300, currentHP: 300 });
  const bf = makeBF([caster, center, nearby]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![4]!.remaining, 1);
  // NO concentration (Guardian of Faith is not concentration)
  eq('Caster NOT concentrating after GoF', caster.concentration, null);

  const hpLostCenter = 500 - center.currentHP;
  assert('Center took one-shot 20d6 radiant in [20, 120]', hpLostCenter >= 20 && hpLostCenter <= 120, `got ${hpLostCenter}`);
  const hpLostNearby = 300 - nearby.currentHP;
  assert('Nearby took one-shot 20d6 radiant in [20, 120]', hpLostNearby >= 20 && hpLostNearby <= 120, `got ${hpLostNearby}`);
}

{
  // NO damage_zone effect applied (one-shot only, no persistent tick)
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 4, y: 0, z: 0 });
  const nearby = makeEnemy('nearby', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, center, nearby]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('NO damage_zone effect on center (one-shot)', getActiveDamageZones(center).length, 0);
  eq('NO damage_zone effect on nearby (one-shot)', getActiveDamageZones(nearby).length, 0);
  eq('NO activeEffects on center', center.activeEffects.length, 0);
  eq('NO activeEffects on nearby', nearby.activeEffects.length, 0);
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 4, y: 0, z: 0 });
  const bf = makeBF([caster, center]);
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
  assert('Action event mentions "Guardian of Faith"', actionEvents[0].description.includes('Guardian of Faith'));
  assert('No save events (no save)', events.filter(e => e.type === 'save_success' || e.type === 'save_fail').length === 0);
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  cleanup(caster);
  eq('Cleanup does NOT start concentration', caster.concentration, null);
  eq('Cleanup does NOT change activeEffects', caster.activeEffects.length, 0);
}

// ============================================================
// 6. rollDamage range check
// ============================================================

console.log('\n=== 6. rollDamage range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [20, 120] (iteration ${i})`, dmg >= 20 && dmg <= 120, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
