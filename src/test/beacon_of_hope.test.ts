// ============================================================
// beacon_of_hope.test.ts — Beacon of Hope spell module
// PHB p.217: 3rd-level abjuration, 1 action, range 30 ft, concentration (1 min).
// Effect: allies gain advantage on WIS saves (+ death saves + max-heal rider
// NOT modelled in v1).
//
// Tests cover metadata shape, shouldCast() precondition gates, execute()
// advantage application via querySelf() helper, slot consumption,
// concentration start, sourceIsConcentration flag, concentration-break
// cleanup, and the cleanup() no-op.
// ============================================================

import { shouldCast, execute, metadata, cleanup } from '../spells/beacon_of_hope';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { querySelf } from '../engine/adv_system';
import { Combatant, Battlefield, Action, PlayerResources } from '../types/core';
import { EngineState, CombatLog } from '../engine/combat';

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

const BOH_ACTION: Action = {
  name: 'Beacon of Hope',
  isMultiattack: false,
  attackType: 'special',
  reach: 30,
  range: { normal: 30, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Beacon of Hope',
};

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
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
    actions: [{ ...BOH_ACTION }],
    resources: withSlots3(2),
  });
}

function makeAlly(id: string, pos = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'party', pos });
}

function makeEnemy(id: string, pos = { x: 10, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos });
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

eq('1: name is Beacon of Hope', metadata.name, 'Beacon of Hope');
eq('1: level is 3', metadata.level, 3);
eq('1: school is abjuration', metadata.school, 'abjuration');
eq('1: rangeFt is 30', metadata.rangeFt, 30);
eq('1: concentration true', metadata.concentration, true);
eq('1: castingTime action', metadata.castingTime, 'action');
eq('1: maxTargets 3', metadata.maxTargets, 3);
eq('1: canon flag set', (metadata as any).beaconOfHopeCanonV1Implemented, true);
eq('1: max-heal not-modelled flag set', (metadata as any).beaconOfHopeMaxHealV1NotModelled, true);

// =============================================================
// Section 2 — shouldCast gates
// =============================================================

console.log('\n--- Section 2: shouldCast gates ---');

{
  // 2a: returns targets when caster + ally in range
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const targets = shouldCast(caster, bf);
  assert('2a: returns targets when in range', targets !== null && targets.length >= 1);
}

{
  // 2b: caster can target self when alone
  const caster = makeCaster('cleric');
  const bf     = makeBF([caster]);
  const targets = shouldCast(caster, bf);
  assert('2b: caster can target self alone', targets !== null);
  assert('2b: self is first target', targets![0].id === 'cleric');
}

{
  // 2c: returns null when already concentrating
  const caster = makeCaster('cleric');
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);
  assert('2c: null when concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d: returns null when no Beacon of Hope action
  const caster = makeCaster('cleric');
  caster.actions = [];
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);
  assert('2d: null when no Beacon of Hope action', shouldCast(caster, bf) === null);
}

{
  // 2e: returns null when no 3rd-level slots remaining
  const caster = makeCaster('cleric');
  caster.resources = withSlots3(0);
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);
  assert('2e: null when slots exhausted', shouldCast(caster, bf) === null);
}

{
  // 2f: ally beyond 30ft is excluded (x=7 → 35ft)
  const caster  = makeCaster('cleric', { x: 0, y: 0, z: 0 });
  const farAlly = makeAlly('paladin', { x: 7, y: 0, z: 0 });
  const bf      = makeBF([caster, farAlly]);
  const targets = shouldCast(caster, bf);
  assert('2f: far ally excluded from targets',
    targets === null || !targets.some(t => t.id === 'paladin'));
}

{
  // 2g: max 3 targets even with 4 eligible allies
  const caster = makeCaster('cleric', { x: 0, y: 0, z: 0 });
  const allies = [1, 2, 3, 4].map(i => makeAlly(`ally${i}`, { x: i, y: 0, z: 0 }));
  const bf     = makeBF([caster, ...allies]);
  const targets = shouldCast(caster, bf);
  assert('2g: max 3 targets returned', targets !== null && targets.length === 3);
}

{
  // 2h: enemy in range is NOT a target (faction check)
  const caster = makeCaster('cleric');
  const enemy  = makeEnemy('goblin', { x: 2, y: 0, z: 0 });
  const bf     = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('2h: enemy not in target list',
    targets === null || !targets.some(t => t.id === 'goblin'));
}

// =============================================================
// Section 3 — execute pipeline
// =============================================================

console.log('\n--- Section 3: execute pipeline ---');

{
  // 3a: consumes a 3rd-level spell slot
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  const slotsBefore = caster.resources!.spellSlots![3].remaining;
  execute(caster, [caster, ally], state);
  const slotsAfter = caster.resources!.spellSlots![3].remaining;
  eq('3a: slot consumed', slotsAfter, slotsBefore - 1);
}

{
  // 3b: concentration started on Beacon of Hope
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  assert('3b: concentration.active true', caster.concentration?.active === true);
  eq('3b: concentration.spellName', caster.concentration?.spellName, 'Beacon of Hope');
}

{
  // 3c: advantage on WIS saves applied to each target via grantSelf
  const caster = makeCaster('cleric');
  const ally1  = makeAlly('fighter');
  const ally2  = makeAlly('rogue', { x: 2, y: 0, z: 0 });
  const bf     = makeBF([caster, ally1, ally2]);
  const state  = makeState(bf);

  execute(caster, [caster, ally1, ally2], state);

  // querySelf returns advantage=true for WIS saves (scope 'save:wis')
  const casterQ = querySelf(caster, 'save:wis');
  const ally1Q  = querySelf(ally1,  'save:wis');
  const ally2Q  = querySelf(ally2,  'save:wis');
  assert('3c: caster has WIS-save advantage', casterQ.advantage === true);
  assert('3c: ally1 has WIS-save advantage',  ally1Q.advantage  === true);
  assert('3c: ally2 has WIS-save advantage',  ally2Q.advantage  === true);
}

{
  // 3d: advantage does NOT bleed into other save scopes (e.g. DEX saves)
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  const dexQ = querySelf(ally, 'save:dex');
  assert('3d: ally does NOT have DEX-save advantage (scope is WIS only)',
    dexQ.advantage === false);
}

{
  // 3e: advantage_vs sentinel effect applied to each target with sourceIsConcentration true
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  const effect = ally.activeEffects.find(e => e.spellName === 'Beacon of Hope');
  assert('3e: ally has Beacon of Hope activeEffect', effect !== undefined);
  eq('3e: effectType is advantage_vs', effect?.effectType, 'advantage_vs');
  eq('3e: advType is advantage', effect?.payload.advType, 'advantage');
  eq('3e: advScope is save:wis', effect?.payload.advScope, 'save:wis');
  assert('3e: sourceIsConcentration true', effect?.sourceIsConcentration === true);
  eq('3e: casterId matches caster', effect?.casterId, 'cleric');
}

{
  // 3f: action + condition_add events logged
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  const actionEvt = state.log.events.find(
    e => e.type === 'action' && e.description.includes('Beacon of Hope'));
  assert('3f: action event logged for cast', actionEvt !== undefined);

  const condEvts = state.log.events.filter(e => e.type === 'condition_add');
  assert('3f: condition_add events for each target', condEvts.length >= 2);
}

{
  // 3g: concentration break removes both advantage and the sentinel effect
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  // Before break: advantage present
  assert('3g: ally WIS-save advantage present before break',
    querySelf(ally, 'save:wis').advantage === true);
  assert('3g: ally has activeEffect before break',
    ally.activeEffects.some(e => e.spellName === 'Beacon of Hope'));

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);
  caster.concentration = null;

  // After break: advantage gone, activeEffect gone
  assert('3g: ally WIS-save advantage gone after break',
    querySelf(ally, 'save:wis').advantage === false);
  assert('3g: ally activeEffect gone after break',
    !ally.activeEffects.some(e => e.spellName === 'Beacon of Hope'));
}

// =============================================================
// Section 4 — cleanup no-op
// =============================================================

console.log('\n--- Section 4: cleanup no-op ---');

{
  const caster = makeCaster('cleric');
  caster.concentration = { active: true, spellName: 'Beacon of Hope', dcIfHit: 10 };
  // cleanup should NOT throw, should NOT break concentration, should NOT touch activeEffects
  cleanup(caster);
  eq('4: cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('4: cleanup does NOT change spellName', caster.concentration?.spellName, 'Beacon of Hope');
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
