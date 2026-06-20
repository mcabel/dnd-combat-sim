// ============================================================
// hunger_of_hadar.test.ts — Hunger of Hadar spell module
// PHB p.251: 3rd-level conjuration, action, range 150 ft, concentration (1 min).
// Effect (v1 simplified): 20-ft sphere centered on highest-threat enemy within 60 ft
//   of caster. DUAL damage: 2d6 cold + 4d6 acid per turn, no save. TWO damage_zone
//   effects applied per target (one for cold, one for acid).
// ============================================================

import { shouldCast, execute, metadata, rollColdDamage, rollAcidDamage, cleanup } from '../spells/hunger_of_hadar';
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

const HUNGER_ACTION: Action = {
  name: 'Hunger of Hadar',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Hunger of Hadar (2d6 cold + 4d6 acid, no save, concentration 1 min)',
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
    name: 'Warlock',
    pos,
    actions: [HUNGER_ACTION],
    resources: withSlots3(2),
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

eq('name is Hunger of Hadar', metadata.name, 'Hunger of Hadar');
eq('level is 3', metadata.level, 3);
eq('school is conjuration', metadata.school, 'conjuration');
eq('rangeFt is 60 (v1)', metadata.rangeFt, 60);
eq('aoeSizeFt is 20', metadata.aoeSizeFt, 20);
eq('coldDieCount is 2', metadata.coldDieCount, 2);
eq('coldDieSides is 6', metadata.coldDieSides, 6);
eq('acidDieCount is 4', metadata.acidDieCount, 4);
eq('acidDieSides is 6', metadata.acidDieSides, 6);
eq('coldDamageType is cold', metadata.coldDamageType, 'cold');
eq('acidDamageType is acid', metadata.acidDamageType, 'acid');
eq('is concentration', metadata.concentration, true);
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (acid die adjusted to 4d6)',
  (metadata as any).hungerOfHadarAcidDieV1AdjustedTo4d6, true);
eq('canon flag set (center point simplified to 60 ft)',
  (metadata as any).hungerOfHadarCenterPointV1SimplifiedTo60Ft, true);
eq('canon flag set (blindness and terrain not modelled)',
  (metadata as any).hungerOfHadarBlindnessAndTerrainV1NotModelled, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Hunger of Hadar action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots3(0);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}

{
  // No enemies within 60 ft of caster
  const caster = makeCaster();
  const farEnemy = makeEnemy('far', { x: 13, y: 0, z: 0 });   // 65 ft away > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 60 ft of caster', shouldCast(caster, bf), null);
}

{
  // Happy path: highest-threat enemy becomes center; nearby enemies collected (within 20 ft of center)
  const caster = makeCaster();
  // center enemy: maxHP 120 at (3,0,0) → 15 ft from caster (within 60 ft)
  const center = makeEnemy('center', { x: 3, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  // nearby enemy at (5,0,0) → 10 ft from center → within 20 ft sphere
  const nearby = makeEnemy('nearby', { x: 5, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const bf = makeBF([caster, center, nearby]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 2 targets (center + nearby)', targets!.length, 2);
}

{
  // Sphere-radius exclusion: enemy outside 20 ft of center is NOT a target
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 3, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const tooFar = makeEnemy('toofar', { x: 8, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });  // 25 ft from center
  const bf = makeBF([caster, center, tooFar]);
  const targets = shouldCast(caster, bf);
  eq('Returns 1 target (only center; too-far excluded)', targets!.length, 1);
  eq('Only center is targeted', targets![0].id, 'center');
}

// ============================================================
// 3. execute — DUAL damage_zone payload + immediate damage
// ============================================================

console.log('\n=== 3. execute — DUAL damage_zone payload + immediate damage ===\n');

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 3, y: 0, z: 0 }, { maxHP: 200, currentHP: 200 });
  const bf = makeBF([caster, center]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![3]!.remaining, 1);
  eq('Caster concentrating on Hunger of Hadar', caster.concentration?.spellName, 'Hunger of Hadar');

  // 2d6 cold + 4d6 acid immediate: cold in [2, 12], acid in [4, 24]; total in [6, 36]
  const hpLost = 200 - center.currentHP;
  assert('Center took immediate dual damage in [6, 36]', hpLost >= 6 && hpLost <= 36, `got ${hpLost}`);
}

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 3, y: 0, z: 0 });
  const nearby = makeEnemy('nearby', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, center, nearby]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // DUAL: each target should have 2 damage_zone effects (one cold, one acid)
  const centerZones = getActiveDamageZones(center);
  const nearbyZones = getActiveDamageZones(nearby);
  eq('center has 2 damage_zone effects (cold + acid)', centerZones.length, 2);
  eq('nearby has 2 damage_zone effects (cold + acid)', nearbyZones.length, 2);

  if (centerZones.length === 2) {
    const coldZone = centerZones.find(z => z.payload.damageType === 'cold');
    const acidZone = centerZones.find(z => z.payload.damageType === 'acid');
    assert('cold damage_zone found', coldZone !== undefined);
    assert('acid damage_zone found', acidZone !== undefined);
    if (coldZone) {
      eq('cold zone dieCount is 2', coldZone.payload.dieCount, 2);
      eq('cold zone dieSides is 6', coldZone.payload.dieSides, 6);
      eq('cold zone has NO saveDC', coldZone.payload.saveDC, undefined);
      eq('cold zone sourceIsConcentration is true', coldZone.sourceIsConcentration, true);
      eq('cold zone spellName is Hunger of Hadar', coldZone.spellName, 'Hunger of Hadar');
      eq('cold zone casterId matches caster', coldZone.casterId, caster.id);
    }
    if (acidZone) {
      eq('acid zone dieCount is 4', acidZone.payload.dieCount, 4);
      eq('acid zone dieSides is 6', acidZone.payload.dieSides, 6);
      eq('acid zone sourceIsConcentration is true', acidZone.sourceIsConcentration, true);
      eq('acid zone spellName is Hunger of Hadar', acidZone.spellName, 'Hunger of Hadar');
    }
  }
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 3, y: 0, z: 0 });
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
  assert('Condition_add event emitted (1 per target — not 2)', condEvents.length === 1);
  assert('Action event mentions "Hunger of Hadar"', actionEvents[0].description.includes('Hunger of Hadar'));
  assert('Damage event mentions "cold"', damageEvents[0].description.includes('cold'));
  assert('Damage event mentions "acid"', damageEvents[0].description.includes('acid'));
  assert('No save events (no save)', events.filter(e => e.type === 'save_success' || e.type === 'save_fail').length === 0);
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Hunger of Hadar', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Hunger of Hadar');
}

// ============================================================
// 6. rollColdDamage + rollAcidDamage range checks
// ============================================================

console.log('\n=== 6. rollColdDamage + rollAcidDamage range checks ===\n');

{
  for (let i = 0; i < 30; i++) {
    const cold = rollColdDamage();
    assert(`rollColdDamage() in [2, 12] (iteration ${i})`, cold >= 2 && cold <= 12, `got ${cold}`);
  }
  for (let i = 0; i < 30; i++) {
    const acid = rollAcidDamage();
    assert(`rollAcidDamage() in [4, 24] (iteration ${i})`, acid >= 4 && acid <= 24, `got ${acid}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
