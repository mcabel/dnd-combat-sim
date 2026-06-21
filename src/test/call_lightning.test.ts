// ============================================================
// call_lightning.test.ts — Call Lightning spell module
// PHB p.220: 3rd-level conjuration, action, range 120 ft, concentration (10 min).
// Effect (v1 simplified): Strike point fixed at highest-threat enemy within 60 ft
//   of caster; bolt AoE = 10 ft around that strike point. 3d10 lightning per turn,
//   no save (canon: DEX save for half). Persistent damage_zone effect for per-turn tick.
//   Flag callLightningStrikeChoiceV1Simplified, callLightningBoltRadiusV1SimplifiedTo10Ft,
//   callLightningDexSaveV1SimplifiedToNone.
// ============================================================

import { shouldCast, execute, metadata, rollDamage, cleanup } from '../spells/call_lightning';
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

const CALL_LIGHTNING_ACTION: Action = {
  name: 'Call Lightning',
  isMultiattack: false,
  attackType: 'special',
  reach: 5,
  range: { normal: 120, long: 120 },
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
  description: 'Call Lightning (3d10 lightning bolt, concentration 10 min)',
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
    name: 'Druid',
    pos,
    actions: [CALL_LIGHTNING_ACTION],
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

eq('name is Call Lightning', metadata.name, 'Call Lightning');
eq('level is 3', metadata.level, 3);
eq('school is conjuration', metadata.school, 'conjuration');
eq('rangeFt is 60 (v1)', metadata.rangeFt, 60);
eq('aoeSizeFt is 10 (v1 bolt radius)', metadata.aoeSizeFt, 10);
eq('dieCount is 3', metadata.dieCount, 3);
eq('dieSides is 10', metadata.dieSides, 10);
eq('damageType is lightning', metadata.damageType, 'lightning');
eq('is concentration', metadata.concentration, true);
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (strike choice simplified)',
  (metadata as any).callLightningStrikeChoiceV1Simplified, true);
eq('canon flag set (bolt radius simplified to 10 ft)',
  (metadata as any).callLightningBoltRadiusV1SimplifiedTo10Ft, true);
eq('canon flag set (dex save simplified to none)',
  (metadata as any).callLightningDexSaveV1SimplifiedToNone, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Moonbeam', dcIfHit: 10 };
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Call Lightning action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots3(0);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}

{
  // No enemies within 60 ft of caster (no center point possible)
  const caster = makeCaster();
  const farEnemy = makeEnemy('far', { x: 13, y: 0, z: 0 });   // 65 ft away > 60 ft range
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 60 ft of caster', shouldCast(caster, bf), null);
}

{
  // Happy path: highest-threat enemy becomes strike point; nearby enemies collected
  const caster = makeCaster();
  // center enemy: maxHP 120 at (5,0,0) → 25 ft from caster (within 60 ft)
  const center = makeEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  // nearby enemy at (6,0,0) → 5 ft from center → within 10 ft bolt radius
  const nearby = makeEnemy('nearby', { x: 6, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const bf = makeBF([caster, center, nearby]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 2 targets (center + nearby)', targets!.length, 2);
  assert('center in targets', targets!.some(t => t.id === 'center'));
  assert('nearby in targets', targets!.some(t => t.id === 'nearby'));
}

{
  // Bolt-radius exclusion: enemy outside 10 ft of center is NOT a target
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const tooFar = makeEnemy('toofar', { x: 8, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });  // 15 ft from center
  const bf = makeBF([caster, center, tooFar]);
  const targets = shouldCast(caster, bf);
  eq('Returns 1 target (only center; too-far excluded)', targets!.length, 1);
  eq('Only center is targeted', targets![0].id, 'center');
}

// ============================================================
// 3. execute — damage_zone payload + immediate damage
// ============================================================

console.log('\n=== 3. execute — damage_zone payload + immediate damage ===\n');

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  const nearby = makeEnemy('nearby', { x: 6, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const bf = makeBF([caster, center, nearby]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![3]!.remaining, 1);
  eq('Caster concentrating on Call Lightning', caster.concentration?.spellName, 'Call Lightning');

  const hpLostCenter = 120 - center.currentHP;
  assert('Center took immediate damage in [3, 30] (3d10)', hpLostCenter >= 3 && hpLostCenter <= 30, `got ${hpLostCenter}`);
  const hpLostNearby = 30 - nearby.currentHP;
  assert('Nearby took immediate damage in [3, 30]', hpLostNearby >= 3 && hpLostNearby <= 30, `got ${hpLostNearby}`);
}

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 5, y: 0, z: 0 });
  const nearby = makeEnemy('nearby', { x: 6, y: 0, z: 0 });
  const bf = makeBF([caster, center, nearby]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const centerZones = getActiveDamageZones(center);
  const nearbyZones = getActiveDamageZones(nearby);
  eq('center has 1 damage_zone effect', centerZones.length, 1);
  eq('nearby has 1 damage_zone effect', nearbyZones.length, 1);

  if (centerZones.length === 1) {
    const z = centerZones[0];
    eq('damage_zone dieCount is 3', z.payload.dieCount, 3);
    eq('damage_zone dieSides is 10', z.payload.dieSides, 10);
    eq('damage_zone damageType is lightning', z.payload.damageType, 'lightning');
    eq('damage_zone has NO saveDC (v1: no save)', z.payload.saveDC, undefined);
    eq('damage_zone has NO saveAbility', z.payload.saveAbility, undefined);
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Call Lightning', z.spellName, 'Call Lightning');
    eq('damage_zone casterId matches caster', z.casterId, caster.id);
  }
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 5, y: 0, z: 0 });
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
  assert('Action event mentions "Call Lightning"', actionEvents[0].description.includes('Call Lightning'));
  assert('No save events (v1: no save)', events.filter(e => e.type === 'save_success' || e.type === 'save_fail').length === 0);
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Call Lightning', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Call Lightning');
}

// ============================================================
// 6. rollDamage range check
// ============================================================

console.log('\n=== 6. rollDamage range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [3, 30] (iteration ${i})`, dmg >= 3 && dmg <= 30, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
