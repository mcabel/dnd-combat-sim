// ============================================================
// storm_of_vengeance.test.ts — Storm of Vengeance spell module
// PHB p.279: 9th-level conjuration, action, range sight, concentration (1 min).
// Effect (v1 simplified): 60-ft cloud (canon: 360 ft) centered on highest-threat
//   enemy within 60 ft of caster. DUAL damage: 2d6 thunder + 6d6 lightning per turn,
//   no save (canon: CON save for half). TWO damage_zone effects per target.
//   Flag stormOfVengeanceOtherEffectsV1Simplified, stormOfVengeanceRadiusV1SimplifiedTo60Ft,
//   stormOfVengeanceConSaveV1SimplifiedToNone.
// ============================================================

import { shouldCast, execute, metadata, rollThunderDamage, rollLightningDamage, cleanup } from '../spells/storm_of_vengeance';
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

function withSlots9(remaining = 1): PlayerResources {
  return { spellSlots: { 9: { max: 1, remaining } } };
}

const STORM_ACTION: Action = {
  name: 'Storm of Vengeance',
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
  isControl: true,
  requiresConcentration: true,
  slotLevel: 9,
  costType: 'action',
  legendaryCost: 0,
  description: 'Storm of Vengeance (2d6 thunder + 6d6 lightning, no save, concentration 1 min)',
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
    name: 'Druid',
    pos,
    actions: [STORM_ACTION],
    resources: withSlots9(1),
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

eq('name is Storm of Vengeance', metadata.name, 'Storm of Vengeance');
eq('level is 9', metadata.level, 9);
eq('school is conjuration', metadata.school, 'conjuration');
eq('rangeFt is 60 (v1)', metadata.rangeFt, 60);
eq('aoeSizeFt is 60 (v1 cloud radius)', metadata.aoeSizeFt, 60);
eq('thunderDieCount is 2', metadata.thunderDieCount, 2);
eq('thunderDieSides is 6', metadata.thunderDieSides, 6);
eq('lightningDieCount is 6', metadata.lightningDieCount, 6);
eq('lightningDieSides is 6', metadata.lightningDieSides, 6);
eq('thunderDamageType is thunder', metadata.thunderDamageType, 'thunder');
eq('lightningDamageType is lightning', metadata.lightningDamageType, 'lightning');
eq('is concentration', metadata.concentration, true);
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (radius simplified to 60 ft)',
  (metadata as any).stormOfVengeanceRadiusV1SimplifiedTo60Ft, true);
eq('canon flag set (center point simplified)',
  (metadata as any).stormOfVengeanceCenterPointV1SimplifiedToHighestThreat, true);
eq('canon flag set (con save simplified to none)',
  (metadata as any).stormOfVengeanceConSaveV1SimplifiedToNone, true);
eq('canon flag set (other effects simplified)',
  (metadata as any).stormOfVengeanceOtherEffectsV1Simplified, true);

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
  eq('Returns null when caster has no Storm of Vengeance action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots9(0);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 9th-level slots', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  const farEnemy = makeEnemy('far', { x: 13, y: 0, z: 0 });   // 65 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 60 ft of caster', shouldCast(caster, bf), null);
}

{
  // Happy path: highest-threat enemy becomes center; nearby enemies collected (within 60 ft of center)
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 2, y: 0, z: 0 }, { maxHP: 400, currentHP: 400 });
  // Enemy at (10,0,0): chebyshev from center (2,0,0) = 8 → 40 ft < 60 ft → within cloud
  const nearby = makeEnemy('nearby', { x: 10, y: 0, z: 0 }, { maxHP: 200, currentHP: 200 });
  const bf = makeBF([caster, center, nearby]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 2 targets (center + nearby)', targets!.length, 2);
}

{
  // Cloud-radius exclusion: enemy outside 60 ft of center is NOT a target
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 2, y: 0, z: 0 }, { maxHP: 400, currentHP: 400 });
  // Enemy at (15,0,0): chebyshev from center (2,0,0) = 13 → 65 ft > 60 ft → outside
  const tooFar = makeEnemy('toofar', { x: 15, y: 0, z: 0 }, { maxHP: 200, currentHP: 200 });
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
  const center = makeEnemy('center', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const bf = makeBF([caster, center]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Slot consumed (0 remaining)', caster.resources!.spellSlots![9]!.remaining, 0);
  eq('Caster concentrating on Storm of Vengeance', caster.concentration?.spellName, 'Storm of Vengeance');

  // 2d6 thunder + 6d6 lightning immediate: thunder in [2, 12], lightning in [6, 36]; total in [8, 48]
  const hpLost = 500 - center.currentHP;
  assert('Center took immediate dual damage in [8, 48]', hpLost >= 8 && hpLost <= 48, `got ${hpLost}`);
}

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 2, y: 0, z: 0 });
  const nearby = makeEnemy('nearby', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, center, nearby]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // DUAL: each target should have 2 damage_zone effects (one thunder, one lightning)
  const centerZones = getActiveDamageZones(center);
  const nearbyZones = getActiveDamageZones(nearby);
  eq('center has 2 damage_zone effects (thunder + lightning)', centerZones.length, 2);
  eq('nearby has 2 damage_zone effects (thunder + lightning)', nearbyZones.length, 2);

  if (centerZones.length === 2) {
    const thunderZone = centerZones.find(z => z.payload.damageType === 'thunder');
    const lightningZone = centerZones.find(z => z.payload.damageType === 'lightning');
    assert('thunder damage_zone found', thunderZone !== undefined);
    assert('lightning damage_zone found', lightningZone !== undefined);
    if (thunderZone) {
      eq('thunder zone dieCount is 2', thunderZone.payload.dieCount, 2);
      eq('thunder zone dieSides is 6', thunderZone.payload.dieSides, 6);
      eq('thunder zone has NO saveDC', thunderZone.payload.saveDC, undefined);
      eq('thunder zone sourceIsConcentration is true', thunderZone.sourceIsConcentration, true);
      eq('thunder zone spellName is Storm of Vengeance', thunderZone.spellName, 'Storm of Vengeance');
      eq('thunder zone casterId matches caster', thunderZone.casterId, caster.id);
    }
    if (lightningZone) {
      eq('lightning zone dieCount is 6', lightningZone.payload.dieCount, 6);
      eq('lightning zone dieSides is 6', lightningZone.payload.dieSides, 6);
      eq('lightning zone sourceIsConcentration is true', lightningZone.sourceIsConcentration, true);
      eq('lightning zone spellName is Storm of Vengeance', lightningZone.spellName, 'Storm of Vengeance');
    }
  }
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeCaster();
  const center = makeEnemy('center', { x: 2, y: 0, z: 0 });
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
  assert('Condition_add event emitted (1 per target)', condEvents.length === 1);
  assert('Action event mentions "Storm of Vengeance"', actionEvents[0].description.includes('Storm of Vengeance'));
  assert('Damage event mentions "thunder"', damageEvents[0].description.includes('thunder'));
  assert('Damage event mentions "lightning"', damageEvents[0].description.includes('lightning'));
  assert('No save events (no save)', events.filter(e => e.type === 'save_success' || e.type === 'save_fail').length === 0);
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Storm of Vengeance', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Storm of Vengeance');
}

// ============================================================
// 6. rollThunderDamage + rollLightningDamage range checks
// ============================================================

console.log('\n=== 6. rollThunderDamage + rollLightningDamage range checks ===\n');

{
  for (let i = 0; i < 30; i++) {
    const thunder = rollThunderDamage();
    assert(`rollThunderDamage() in [2, 12] (iteration ${i})`, thunder >= 2 && thunder <= 12, `got ${thunder}`);
  }
  for (let i = 0; i < 30; i++) {
    const lightning = rollLightningDamage();
    assert(`rollLightningDamage() in [6, 36] (iteration ${i})`, lightning >= 6 && lightning <= 36, `got ${lightning}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
