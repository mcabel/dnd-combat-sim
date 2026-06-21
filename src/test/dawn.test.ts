// ============================================================
// dawn.test.ts — Dawn spell module
// XGE p.153: 5th-level evocation, action, range 60 ft, concentration (1 min).
// Effect (v1 simplified): 30-ft cylinder centered on highest-threat enemy within 60 ft
//   of caster. 4d10 radiant per turn, CON save for half. Persistent damage_zone effect
//   for per-turn tick.
// ============================================================

import { shouldCast, execute, metadata, rollDamage, cleanup } from '../spells/dawn';
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

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

// DC 25 CON = guaranteed fail for CON 1 (mod -5, max roll 15 < 25)
// DC 5  CON = guaranteed success for CON 30 (mod +10, min roll 11 ≥ 5)
const DAWN_ACTION: Action = {
  name: 'Dawn',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Dawn (4d10 radiant, CON save for half, concentration 1 min)',
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

function makeCaster(id = 'wiz', pos: Vec3 = { x: 0, y: 0, z: 0 }, saveDC = 25): Combatant {
  const action = saveDC === 25 ? DAWN_ACTION : { ...DAWN_ACTION, saveDC };
  return makeCombatant(id, {
    name: 'Cleric',
    pos,
    actions: [action],
    resources: withSlots5(2),
  });
}

function makeWeakEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  // CON 1: guaranteed fail vs DC 25
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 1,
    pos,
    ...overrides,
  });
}

function makeStrongEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  // CON 30: guaranteed success vs DC 5
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 30,
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

eq('name is Dawn', metadata.name, 'Dawn');
eq('level is 5', metadata.level, 5);
eq('school is evocation', metadata.school, 'evocation');
eq('rangeFt is 60', metadata.rangeFt, 60);
eq('aoeSizeFt is 30', metadata.aoeSizeFt, 30);
eq('dieCount is 4', metadata.dieCount, 4);
eq('dieSides is 10', metadata.dieSides, 10);
eq('damageType is radiant', metadata.damageType, 'radiant');
eq('is concentration', metadata.concentration, true);
eq('saveAbility is con', metadata.saveAbility, 'con');
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (center point simplified)',
  (metadata as any).dawnCenterPointV1SimplifiedToHighestThreat, true);
eq('canon flag set (cover rider not modelled)',
  (metadata as any).dawnCoverRiderV1NotModelled, true);
eq('canon flag set (sunlight property not modelled)',
  (metadata as any).dawnSunlightPropertyV1NotModelled, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Spirit Guardians', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Dawn action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots5(0);
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}

{
  // No enemies within 60 ft of caster
  const caster = makeCaster();
  const farEnemy = makeWeakEnemy('far', { x: 13, y: 0, z: 0 });   // 65 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 60 ft of caster', shouldCast(caster, bf), null);
}

{
  // Happy path: highest-threat enemy becomes center; nearby enemies within 30 ft collected
  const caster = makeCaster();
  const center = makeWeakEnemy('center', { x: 3, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  // Enemy at (8,0,0): chebyshev from center (3,0,0) = 5 → 25 ft < 30 ft → within cylinder
  const nearby = makeWeakEnemy('nearby', { x: 8, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 });
  const bf = makeBF([caster, center, nearby]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 2 targets (center + nearby)', targets!.length, 2);
}

{
  // Cylinder-radius exclusion: enemy outside 30 ft of center is NOT a target
  const caster = makeCaster();
  const center = makeWeakEnemy('center', { x: 3, y: 0, z: 0 }, { maxHP: 120, currentHP: 120 });
  // Enemy at (10,0,0): chebyshev from center (3,0,0) = 7 → 35 ft > 30 ft → outside
  const tooFar = makeWeakEnemy('toofar', { x: 10, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 });
  const bf = makeBF([caster, center, tooFar]);
  const targets = shouldCast(caster, bf);
  eq('Returns 1 target (only center; too-far excluded)', targets!.length, 1);
  eq('Only center is targeted', targets![0].id, 'center');
}

// ============================================================
// 3. execute — save resolution (full / half)
// ============================================================

console.log('\n=== 3. execute — save resolution ===\n');

{
  // 3a. Guaranteed fail (CON 1 vs DC 25) → full 4d10 radiant
  const caster = makeCaster();
  const center = makeWeakEnemy('center', { x: 3, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, center]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - center.currentHP;
  assert('Failed save → full damage in [4, 40] (4d10)', hpLost >= 4 && hpLost <= 40, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![5]!.remaining, 1);
  eq('Caster concentrating on Dawn', caster.concentration?.spellName, 'Dawn');
}

{
  // 3b. Guaranteed success (CON 30 vs DC 5) → half damage
  const caster = makeCaster('wiz', { x: 0, y: 0, z: 0 }, 5);
  const center = makeStrongEnemy('center', { x: 3, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, center]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - center.currentHP;
  assert('Successful save → half damage in [2, 20]', hpLost >= 2 && hpLost <= 20, `got ${hpLost}`);
}

// ============================================================
// 4. execute — damage_zone payload
// ============================================================

console.log('\n=== 4. execute — damage_zone payload ===\n');

{
  const caster = makeCaster();
  const center = makeWeakEnemy('center', { x: 3, y: 0, z: 0 });
  const bf = makeBF([caster, center]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const zones = getActiveDamageZones(center);
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 4', z.payload.dieCount, 4);
    eq('damage_zone dieSides is 10', z.payload.dieSides, 10);
    eq('damage_zone damageType is radiant', z.payload.damageType, 'radiant');
    eq('damage_zone saveDC is set (25)', z.payload.saveDC, 25);
    eq('damage_zone saveAbility is con', z.payload.saveAbility, 'con');
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Dawn', z.spellName, 'Dawn');
    eq('damage_zone casterId matches caster', z.casterId, caster.id);
  }
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCaster();
  const center = makeWeakEnemy('center', { x: 3, y: 0, z: 0 });
  const bf = makeBF([caster, center]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const damageEvents = events.filter(e => e.type === 'damage');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Action event emitted', actionEvents.length >= 1);
  assert('Save event emitted', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('Damage event emitted', damageEvents.length >= 1);
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions "Dawn"', actionEvents[0].description.includes('Dawn'));
  assert('Save event mentions CON save', saveEvents[0].description.includes('CON'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Dawn', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Dawn');
}

// ============================================================
// 7. rollDamage range check
// ============================================================

console.log('\n=== 7. rollDamage range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [4, 40] (iteration ${i})`, dmg >= 4 && dmg <= 40, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
