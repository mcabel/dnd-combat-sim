// ============================================================
// spirit_guardians.test.ts — Spirit Guardians spell module
// PHB p.278: 3rd-level conjuration, action, range Self (10-ft aura), concentration (10 min).
// Effect (v1 simplified): 3d8 radiant aura (WIS save for half) on enemies within
//   10 ft of caster at cast time. Canon is 15-ft aura with 3d6 (radiant or necrotic
//   by alignment); v1 simplifies to 10-ft 3d8 radiant (per task spec).
// ============================================================

import { shouldCast, execute, metadata, rollDamage, cleanup } from '../spells/spirit_guardians';
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

// DC 25 WIS = guaranteed fail for WIS 1 (mod -5, max roll 15 < 25)
// DC 5  WIS = guaranteed success for WIS 30 (mod +10, min roll 11 ≥ 5)
const SPIRIT_GUARDIANS_ACTION: Action = {
  name: 'Spirit Guardians',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 10, long: 10 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (WIS 1 → max 15 < 25)
  saveAbility: 'wis',
  isAoE: true,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Spirit Guardians (3d8 radiant, WIS save for half, concentration 10 min)',
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

function makeCaster(id = 'wiz', pos: Vec3 = { x: 0, y: 0, z: 0 }, saveDC = 25): Combatant {
  const action = saveDC === 25 ? SPIRIT_GUARDIANS_ACTION : { ...SPIRIT_GUARDIANS_ACTION, saveDC };
  return makeCombatant(id, {
    name: 'Cleric',
    pos,
    actions: [action],
    resources: withSlots3(2),
  });
}

function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  // WIS 1: guaranteed fail vs DC 25
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 1,
    pos,
    ...overrides,
  });
}

function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  // WIS 30: guaranteed success vs DC 5
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 30,
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

eq('name is Spirit Guardians', metadata.name, 'Spirit Guardians');
eq('level is 3', metadata.level, 3);
eq('school is conjuration', metadata.school, 'conjuration');
eq('rangeFt is 10 (v1 simplified)', metadata.rangeFt, 10);
eq('aoeSizeFt is 10', metadata.aoeSizeFt, 10);
eq('dieCount is 3', metadata.dieCount, 3);
eq('dieSides is 8', metadata.dieSides, 8);
eq('damageType is radiant', metadata.damageType, 'radiant');
eq('is concentration', metadata.concentration, true);
eq('saveAbility is wis', metadata.saveAbility, 'wis');
eq('castingTime is action', metadata.castingTime, 'action');
eq('canon flag set (damage type simplified to radiant)',
  (metadata as any).spiritGuardiansDamageTypeV1SimplifiedToRadiant, true);
eq('canon flag set (aura radius simplified to 10 ft)',
  (metadata as any).spiritGuardiansAuraRadiusV1SimplifiedTo10Ft, true);
eq('canon flag set (moving aura simplified)',
  (metadata as any).spiritGuardiansMovingAuraV1Simplified, true);
eq('canon flag set (die sides adjusted to 8)',
  (metadata as any).spiritGuardiansDieSidesV1AdjustedTo8, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Spirit Guardians action', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  caster.resources = withSlots3(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}

{
  // No enemies within 10 ft aura (enemy at x=3 → 15 ft)
  const caster = makeCaster();
  const farEnemy = makeWeakEnemy('far', { x: 3, y: 0, z: 0 });   // 15 ft away
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies within 10 ft aura', shouldCast(caster, bf), null);
}

{
  const caster = makeCaster();
  const enemy = makeWeakEnemy('e1', { x: 2, y: 0, z: 0 });   // 10 ft away (boundary)
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Happy path returns non-null targets array', targets !== null);
  eq('Returns 1 target (enemy at 10 ft boundary)', targets!.length, 1);
  eq('Target is e1', targets![0].id, 'e1');
}

// ============================================================
// 3. execute — save resolution (full / half)
// ============================================================

console.log('\n=== 3. execute — save resolution ===\n');

{
  // 3a. Guaranteed fail (WIS 1 vs DC 25) → full 3d8 radiant damage
  const caster = makeCaster();
  const enemy = makeWeakEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Failed save → full damage in [3, 24] (3d8)', hpLost >= 3 && hpLost <= 24, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![3]!.remaining, 1);
  eq('Caster concentrating on Spirit Guardians', caster.concentration?.spellName, 'Spirit Guardians');
}

{
  // 3b. Guaranteed success (WIS 30 vs DC 5) → half damage (floor(3d8/2))
  const caster = makeCaster('wiz', { x: 0, y: 0, z: 0 }, 5);
  const enemy = makeStrongEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Successful save → half damage in [1, 12]', hpLost >= 1 && hpLost <= 12, `got ${hpLost}`);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![3]!.remaining, 1);
}

// ============================================================
// 4. execute — damage_zone payload
// ============================================================

console.log('\n=== 4. execute — damage_zone payload ===\n');

{
  const caster = makeCaster();
  const enemy = makeWeakEnemy('e1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const zones = getActiveDamageZones(enemy);
  eq('1 damage_zone effect applied', zones.length, 1);
  if (zones.length === 1) {
    const z = zones[0];
    eq('damage_zone dieCount is 3', z.payload.dieCount, 3);
    eq('damage_zone dieSides is 8', z.payload.dieSides, 8);
    eq('damage_zone damageType is radiant', z.payload.damageType, 'radiant');
    eq('damage_zone saveDC is set (25)', z.payload.saveDC, 25);
    eq('damage_zone saveAbility is wis', z.payload.saveAbility, 'wis');
    eq('damage_zone sourceIsConcentration is true', z.sourceIsConcentration, true);
    eq('damage_zone spellName is Spirit Guardians', z.spellName, 'Spirit Guardians');
    eq('damage_zone casterId matches caster', z.casterId, caster.id);
  }
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCaster();
  const enemy = makeWeakEnemy('e1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
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
  assert('Action event mentions "Spirit Guardians"', actionEvents[0].description.includes('Spirit Guardians'));
  assert('Save event mentions WIS save', saveEvents[0].description.includes('WIS'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Spirit Guardians', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Spirit Guardians');
}

// ============================================================
// 7. rollDamage range check
// ============================================================

console.log('\n=== 7. rollDamage range check ===\n');

{
  for (let i = 0; i < 30; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [3, 24] (iteration ${i})`, dmg >= 3 && dmg <= 24, `got ${dmg}`);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
