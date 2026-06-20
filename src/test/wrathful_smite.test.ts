// ============================================================
// wrathful_smite.test.ts
//
// Tests:
//   1. Metadata (9 assertions)
//   2. shouldCast — planner precondition gates (5 assertions)
//   3. execute — slot/concentration/rider pipeline (9 assertions)
//   4. cleanup — stale-rider clearing + no-op safety (3 assertions)
//
// Run: npx ts-node --transpile-only src/test/wrathful_smite.test.ts
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/wrathful_smite';
import { EngineState, CombatLog } from '../engine/combat';
import { Combatant, Battlefield, Action, PlayerResources } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

const SPELL_ACTION: Action = {
  name: 'Wrathful Smite',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 1,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Wrathful Smite',
};

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
    perception: { knownEnemyPositions: new Map(), lastSeenPositions: new Map() } as any,
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

function makeCaster(id: string, pos = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    pos,
    actions: [{ ...SPELL_ACTION }],
    resources: withSlots(2),
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    combatants: map,
    round: 1,
    initiative: combatants.map((c, i) => ({ id: c.id, initiative: 10 - i })),
    obstacles: [],
  } as unknown as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  const log: CombatLog = { events: [], winner: null, rounds: 0 };
  return {
    battlefield: bf,
    log,
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// =============================================================
// Section 1 — Metadata
// =============================================================

console.log('\n--- Section 1: Metadata ---');

eq('1a: name', metadata.name, 'Wrathful Smite');
eq('1b: level', metadata.level, 1);
eq('1c: concentration true', metadata.concentration, true);
eq('1d: dieSides 6', metadata.dieSides, 6);
eq('1e: count 1', metadata.count, 1);
eq('1f: damageType psychic', metadata.damageType, 'psychic');
eq('1g: canon flag true', metadata.wrathfulSmiteCanonV1Implemented, true);
eq('1h: riders-simplified flag true', metadata.wrathfulSmiteRidersV1Simplified, true);
eq('1i: endOfTurnSave-simplified flag true', metadata.wrathfulSmiteEndOfTurnSaveV1Simplified, true);

// =============================================================
// Section 2 — shouldCast gates
// =============================================================

console.log('\n--- Section 2: shouldCast gates ---');

{
  const caster = makeCaster('paladin');
  caster.actions = [];
  const bf = makeBF([caster]);
  eq('2a: false with no actions', shouldCast(caster, bf), false);
}

{
  const caster = makeCaster('paladin');
  caster.resources = withSlots(0);
  const bf = makeBF([caster]);
  eq('2b: false with no slots', shouldCast(caster, bf), false);
}

{
  const caster = makeCaster('paladin');
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const bf = makeBF([caster]);
  eq('2c: false when already concentrating', shouldCast(caster, bf), false);
}

{
  const caster = makeCaster('paladin');
  caster._nextHitRider = {
    spellName: 'Searing Smite',
    dieSides: 6, count: 1, damageType: 'fire',
  };
  const bf = makeBF([caster]);
  eq('2d: false with pending rider', shouldCast(caster, bf), false);
}

{
  const caster = makeCaster('paladin');
  const bf = makeBF([caster]);
  eq('2e: true on happy path', shouldCast(caster, bf), true);
}

// =============================================================
// Section 3 — execute pipeline
// =============================================================

console.log('\n--- Section 3: execute pipeline ---');

{
  const caster = makeCaster('paladin');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const slotsBefore = caster.resources!.spellSlots![1].remaining;
  execute(caster, state);
  const slotsAfter = caster.resources!.spellSlots![1].remaining;
  eq('3a: slot consumed', slotsAfter, slotsBefore - 1);
}

{
  const caster = makeCaster('paladin');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  assert('3b: concentration.active is true', caster.concentration?.active === true);
  eq('3b: concentration.spellName', caster.concentration?.spellName, 'Wrathful Smite');
}

{
  const caster = makeCaster('paladin');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  assert('3c: _nextHitRider set', caster._nextHitRider != null);
  eq('3d: rider.spellName', caster._nextHitRider!.spellName, 'Wrathful Smite');
  eq('3e: rider.dieSides', caster._nextHitRider!.dieSides, 6);
  eq('3f: rider.count', caster._nextHitRider!.count, 1);
  eq('3g: rider.damageType', caster._nextHitRider!.damageType, 'psychic');
  eq('3h: rider.condition', caster._nextHitRider!.condition, 'frightened');
}

{
  const caster = makeCaster('paladin');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const actionEvent = state.log.events.find(
    e => e.type === 'action' && e.description.includes('Wrathful Smite'));
  assert('3i: action event logged', actionEvent !== undefined);
}

{
  const caster = makeCaster('paladin');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const condEvent = state.log.events.find(
    e => e.type === 'condition_add' && e.description.includes('Wrathful Smite'));
  assert('3j: condition_add event logged', condEvent !== undefined);
}

// =============================================================
// Section 4 — cleanup
// =============================================================

console.log('\n--- Section 4: cleanup ---');

{
  const caster = makeCaster('paladin');
  caster._nextHitRider = {
    spellName: 'Wrathful Smite',
    dieSides: 6, count: 1, damageType: 'psychic', condition: 'frightened',
  };
  caster.concentration = null;
  cleanup(caster);
  assert('4a: stale rider cleared on broken concentration',
    caster._nextHitRider == null);
}

{
  const caster = makeCaster('paladin');
  caster._nextHitRider = {
    spellName: 'Wrathful Smite',
    dieSides: 6, count: 1, damageType: 'psychic', condition: 'frightened',
  };
  caster.concentration = { active: true, spellName: 'Wrathful Smite', dcIfHit: 10 };
  cleanup(caster);
  assert('4b: rider preserved when concentration active on this spell',
    caster._nextHitRider != null);
}

{
  const caster = makeCaster('paladin');
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('4c: cleanup no-op does not throw', !threw);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
