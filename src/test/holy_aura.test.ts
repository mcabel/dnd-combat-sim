// ============================================================
// holy_aura.test.ts — Holy Aura spell module
// PHB p.251: 8th-level abjuration, 1 action, range Self (30-ft aura),
// concentration (1 min).
// Effect: allies gain advantage on saves vs spells + light + blind-attackers
// (v1 simplified: scope 'save' = all saves; light + blind riders simplified).
//
// Tests cover metadata shape, shouldCast() precondition gates, execute()
// advantage application via querySelf() helper, slot consumption,
// concentration start, sourceIsConcentration flag, concentration-break
// cleanup, the 99-target cap (effectively unlimited), and the cleanup() no-op.
// ============================================================

import { shouldCast, execute, metadata, cleanup } from '../spells/holy_aura';
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

const HA_ACTION: Action = {
  name: 'Holy Aura',
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
  slotLevel: 8,
  costType: 'action',
  legendaryCost: 0,
  description: 'Holy Aura',
};

function withSlots8(remaining = 1): PlayerResources {
  return { spellSlots: { 8: { max: 1, remaining } } };
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

function makeCaster(id: string, pos = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    pos,
    actions: [{ ...HA_ACTION }],
    resources: withSlots8(1),
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

eq('1: name is Holy Aura', metadata.name, 'Holy Aura');
eq('1: level is 8', metadata.level, 8);
eq('1: school is abjuration', metadata.school, 'abjuration');
eq('1: rangeFt is 30', metadata.rangeFt, 30);
eq('1: concentration true', metadata.concentration, true);
eq('1: castingTime action', metadata.castingTime, 'action');
eq('1: maxTargets 99 (effectively unlimited)', metadata.maxTargets, 99);
eq('1: canon flag set', (metadata as any).holyAuraCanonV1Implemented, true);
eq('1: scope-simplified flag set', (metadata as any).holyAuraScopeV1SimplifiedToAllSaves, true);
eq('1: light+blind simplified flag set', (metadata as any).holyAuraLightAndBlindRidersV1Simplified, true);

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
  // 2d: returns null when no Holy Aura action
  const caster = makeCaster('cleric');
  caster.actions = [];
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);
  assert('2d: null when no Holy Aura action', shouldCast(caster, bf) === null);
}

{
  // 2e: returns null when no 8th-level slots remaining
  const caster = makeCaster('cleric');
  caster.resources = withSlots8(0);
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
  // 2g: NO 3-target cap — caster + 5 allies in range all returned (6 total)
  const caster = makeCaster('cleric', { x: 0, y: 0, z: 0 });
  const allies = [1, 2, 3, 4, 5].map(i => makeAlly(`ally${i}`, { x: i, y: 0, z: 0 }));
  const bf     = makeBF([caster, ...allies]);
  const targets = shouldCast(caster, bf);
  // Self is included as a candidate (caster.faction === caster.faction, dist 0).
  assert('2g: all 6 candidates returned (caster + 5 allies, no 3-cap)',
    targets !== null && targets.length === 6,
    `got length=${targets?.length}`);
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
  // 3a: consumes an 8th-level spell slot
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  const slotsBefore = caster.resources!.spellSlots![8].remaining;
  execute(caster, [caster, ally], state);
  const slotsAfter = caster.resources!.spellSlots![8].remaining;
  eq('3a: slot consumed', slotsAfter, slotsBefore - 1);
}

{
  // 3b: concentration started on Holy Aura
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  assert('3b: concentration.active true', caster.concentration?.active === true);
  eq('3b: concentration.spellName', caster.concentration?.spellName, 'Holy Aura');
}

{
  // 3c: advantage on ALL saves applied to each target (simplified scope 'save')
  const caster = makeCaster('cleric');
  const ally1  = makeAlly('fighter');
  const ally2  = makeAlly('rogue', { x: 2, y: 0, z: 0 });
  const ally3  = makeAlly('wizard', { x: 3, y: 0, z: 0 });
  const bf     = makeBF([caster, ally1, ally2, ally3]);
  const state  = makeState(bf);

  execute(caster, [caster, ally1, ally2, ally3], state);

  assert('3c: caster has save advantage', querySelf(caster, 'save').advantage === true);
  assert('3c: ally1 has save advantage',  querySelf(ally1,  'save').advantage === true);
  assert('3c: ally2 has save advantage',  querySelf(ally2,  'save').advantage === true);
  assert('3c: ally3 has save advantage',  querySelf(ally3,  'save').advantage === true);
}

{
  // 3d: advantage does NOT bleed into attack rolls
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  assert('3d: ally does NOT have attack advantage (scope is saves only)',
    querySelf(ally, 'attack').advantage === false);
}

{
  // 3e: advantage_vs sentinel effect applied with sourceIsConcentration true
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  const effect = ally.activeEffects.find(e => e.spellName === 'Holy Aura');
  assert('3e: ally has Holy Aura activeEffect', effect !== undefined);
  eq('3e: effectType is advantage_vs', effect?.effectType, 'advantage_vs');
  eq('3e: advType is advantage', effect?.payload.advType, 'advantage');
  eq('3e: advScope is save (simplified)', effect?.payload.advScope, 'save');
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
    e => e.type === 'action' && e.description.includes('Holy Aura'));
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

  assert('3g: ally save advantage present before break',
    querySelf(ally, 'save').advantage === true);
  assert('3g: ally has activeEffect before break',
    ally.activeEffects.some(e => e.spellName === 'Holy Aura'));

  removeEffectsFromCaster(caster.id, bf);
  caster.concentration = null;

  assert('3g: ally save advantage gone after break',
    querySelf(ally, 'save').advantage === false);
  assert('3g: ally activeEffect gone after break',
    !ally.activeEffects.some(e => e.spellName === 'Holy Aura'));
}

// =============================================================
// Section 4 — cleanup no-op
// =============================================================

console.log('\n--- Section 4: cleanup no-op ---');

{
  const caster = makeCaster('cleric');
  caster.concentration = { active: true, spellName: 'Holy Aura', dcIfHit: 10 };
  cleanup(caster);
  eq('4: cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('4: cleanup does NOT change spellName', caster.concentration?.spellName, 'Holy Aura');
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
