// ============================================================
// bless.test.ts
//
// Tests:
//   1. shouldCast — planner precondition gates (8 tests)
//   2. execute    — slot/concentration/effect pipeline (8 tests)
//   3. Roll integration — bless die on attacks and saves (7 tests)
//   4. Planner + Engine integration (5 tests)
//
// Run: ts-node src/test/bless.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute } from '../spells/bless';
import { applySpellEffect, removeEffectsFromCaster, getActiveBlessDie } from '../engine/spell_effects';
import { rollSave } from '../engine/utils';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { runCombat, makeFlatBattlefield, EngineState, CombatLog } from '../engine/combat';
import {
  Combatant, Battlefield, Action, PlayerResources,
} from '../types/core';

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

const BLESS_ACTION: Action = {
  name: 'Bless',
  isMultiattack: false,
  attackType: 'save',
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
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Bless',
};

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
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
    actions: [{ ...BLESS_ACTION }],
    resources: withSlots(2),
  });
}

function makeAlly(id: string, pos = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'party', pos });
}

function makeEnemy(id: string, pos = { x: 3, y: 0, z: 0 }): Combatant {
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

// ---- PC factories for integration tests ---------------------

const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap  = loadPCStatBlocks(rawPCs);

function spawnClass(cls: string, pos = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown class: ${cls}`);
  return c;
}

// =============================================================
// Section 1 — shouldCast precondition gates
// =============================================================

console.log('\n--- Section 1: shouldCast gates ---');

{
  // 1a: returns targets when caster + ally in range
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);

  const targets = shouldCast(caster, bf);
  assert('1a: returns targets when in range', targets !== null && targets.length >= 1);
}

{
  // 1b: caster can target self when alone (self is within 0 ft)
  const caster = makeCaster('cleric');
  const bf     = makeBF([caster]);

  const targets = shouldCast(caster, bf);
  assert('1b: caster can target self alone', targets !== null);
  assert('1b: self is first target', targets![0].id === 'cleric');
}

{
  // 1c: returns null when already concentrating
  const caster = makeCaster('cleric');
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);

  assert('1c: null when concentrating', shouldCast(caster, bf) === null);
}

{
  // 1d: returns null when no Bless in actions
  const caster = makeCaster('cleric');
  caster.actions = [];
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);

  assert('1d: null when no Bless action', shouldCast(caster, bf) === null);
}

{
  // 1e: returns null when no spell slots remaining
  const caster = makeCaster('cleric');
  caster.resources = withSlots(0);
  const ally = makeAlly('fighter');
  const bf   = makeBF([caster, ally]);

  assert('1e: null when slots exhausted', shouldCast(caster, bf) === null);
}

{
  // 1f: ally beyond 30ft is excluded (x=7 → 35ft)
  const caster  = makeCaster('cleric', { x: 0, y: 0, z: 0 });
  const farAlly = makeAlly('paladin', { x: 7, y: 0, z: 0 });
  const bf      = makeBF([caster, farAlly]);

  const targets = shouldCast(caster, bf);
  assert('1f: far ally excluded from targets',
    targets === null || !targets.some(t => t.id === 'paladin'));
}

{
  // 1g: skips dead and unconscious allies; caster is still eligible
  const caster     = makeCaster('cleric');
  const deadAlly   = makeAlly('fighter1');
  deadAlly.isDead  = true;
  const uAlly      = makeAlly('fighter2', { x: 2, y: 0, z: 0 });
  uAlly.isUnconscious = true;
  const bf = makeBF([caster, deadAlly, uAlly]);

  const targets = shouldCast(caster, bf);
  assert('1g: dead/unconscious allies skipped from targets',
    targets === null || targets.every(t => !t.isDead && !t.isUnconscious));
}

{
  // 1h: max 3 targets even with 5 eligible in range
  const caster = makeCaster('cleric', { x: 0, y: 0, z: 0 });
  const allies = [1, 2, 3, 4].map(i => makeAlly(`ally${i}`, { x: i, y: 0, z: 0 }));
  const bf     = makeBF([caster, ...allies]);

  const targets = shouldCast(caster, bf);
  assert('1h: max 3 targets returned', targets !== null && targets.length === 3);
}

// =============================================================
// Section 2 — execute pipeline
// =============================================================

console.log('\n--- Section 2: execute pipeline ---');

{
  // 2a: consumes a 1st-level spell slot
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  const slotsBefore = caster.resources!.spellSlots![1].remaining;
  execute(caster, [caster, ally], state);
  const slotsAfter = caster.resources!.spellSlots![1].remaining;

  eq('2a: slot consumed', slotsAfter, slotsBefore - 1);
}

{
  // 2b: concentration starts on 'Bless'
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  assert('2b: concentration.active is true', caster.concentration?.active === true);
  eq('2b: concentration.spellName', caster.concentration?.spellName, 'Bless');
}

{
  // 2c: bless_die effect applied to all targets
  const caster = makeCaster('cleric');
  const ally1  = makeAlly('fighter');
  const ally2  = makeAlly('rogue', { x: 2, y: 0, z: 0 });
  const bf     = makeBF([caster, ally1, ally2]);
  const state  = makeState(bf);

  execute(caster, [caster, ally1, ally2], state);

  eq('2c: caster has bless_die effect (d4)', getActiveBlessDie(caster), 4);
  eq('2c: ally1 has bless_die effect (d4)',  getActiveBlessDie(ally1), 4);
  eq('2c: ally2 has bless_die effect (d4)',  getActiveBlessDie(ally2), 4);
}

{
  // 2d: dieSides is 4 (d4, PHB p.219)
  const caster = makeCaster('cleric');
  const bf     = makeBF([caster]);
  const state  = makeState(bf);

  execute(caster, [caster], state);
  eq('2d: bless_die dieSides = 4', getActiveBlessDie(caster), 4);
}

{
  // 2e: sourceIsConcentration = true (removed on concentration break)
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  const effect = ally.activeEffects.find(e => e.spellName === 'Bless');
  assert('2e: sourceIsConcentration true', effect?.sourceIsConcentration === true);
}

{
  // 2f: action cast event logged
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  const castEvent = state.log.events.find(
    e => e.type === 'action' && e.description.includes('Bless'));
  assert('2f: action event logged for cast', castEvent !== undefined);
}

{
  // 2g: condition_add event logged per target
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  const condEvents = state.log.events.filter(e => e.type === 'condition_add');
  assert('2g: condition_add events for each target', condEvents.length >= 2);
}

{
  // 2h: effects removed when concentration breaks
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [caster, ally], state);

  assert('2h: bless active before break', getActiveBlessDie(ally) === 4);

  removeEffectsFromCaster(caster.id, bf);
  caster.concentration = null;

  eq('2h: ally bless removed after concentration break', getActiveBlessDie(ally), 0);
  eq('2h: caster bless removed after break', getActiveBlessDie(caster), 0);
}

// =============================================================
// Section 3 — Roll integration (bless die applied at resolution)
// =============================================================

console.log('\n--- Section 3: Roll integration ---');

{
  // 3a: rollSave totals are higher on average with bless active vs without
  // 200 trials each; bless adds avg 2.5/roll → expect ≥+150 aggregate lift
  const c = makeCombatant('target', { dex: 10 });

  let plainSum = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) plainSum += rollSave(c, 'dex', 15).total;

  applySpellEffect(c, {
    casterId: 'cleric', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });

  let blessSum = 0;
  for (let i = 0; i < TRIALS; i++) blessSum += rollSave(c, 'dex', 15).total;

  assert('3a: bless raises save totals on aggregate',
    blessSum > plainSum + 150,
    `blessSum=${blessSum} plainSum=${plainSum}`);
}

{
  // 3b: rollSave total >= roll + mod + 1 (minimum bless roll) when blessed
  const c = makeCombatant('target', { wis: 20 }); // +5 mod
  applySpellEffect(c, {
    casterId: 'cleric', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });

  let allGood = true;
  for (let i = 0; i < 20; i++) {
    const r = rollSave(c, 'wis', 15);
    if (r.total < r.roll + 5 + 1) {
      allGood = false;
      break;
    }
  }
  assert('3b: rollSave total always >= roll + mod + min_bless (1)', allGood);
}

{
  // 3c: getActiveBlessDie returns 0 before bless, 4 after
  const c = makeCombatant('t');
  eq('3c: no bless = 0 sides', getActiveBlessDie(c), 0);

  applySpellEffect(c, {
    casterId: 'cleric', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  eq('3c: bless active = 4 sides', getActiveBlessDie(c), 4);
}

{
  // 3d: bless die removed → query returns 0
  const c  = makeCombatant('target', { dex: 10 });
  const bf = makeBF([c]);

  applySpellEffect(c, {
    casterId: 'cleric', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });

  assert('3d: bless active mid-combat', getActiveBlessDie(c) === 4);
  removeEffectsFromCaster('cleric', bf);
  eq('3d: bless removed = 0 sides', getActiveBlessDie(c), 0);
}

{
  // 3e: casterId correctly stamped on effect (needed for removeEffectsFromCaster)
  const caster = makeCaster('cleric');
  const ally   = makeAlly('fighter');
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, [ally], state);

  const effect = ally.activeEffects.find(e => e.spellName === 'Bless');
  eq('3e: effect casterId matches caster', effect?.casterId, 'cleric');
}

{
  // 3f: two separate Bless effects — getActiveBlessDie returns max (no stacking)
  const c = makeCombatant('t');
  applySpellEffect(c, {
    casterId: 'clericA', spellName: 'Bless', effectType: 'bless_die',
    payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  applySpellEffect(c, {
    casterId: 'clericB', spellName: 'Greater Bless', effectType: 'bless_die',
    payload: { dieSides: 6 }, sourceIsConcentration: true,
  });
  eq('3f: getActiveBlessDie returns max of multiple effects', getActiveBlessDie(c), 6);
}

{
  // 3g: enemy does NOT receive bless effect from execute (execute only touches passed targets)
  const caster = makeCaster('cleric');
  const enemy  = makeEnemy('goblin', { x: 2, y: 0, z: 0 });
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);

  execute(caster, [caster], state);  // only targeting self

  eq('3g: enemy has no bless die', getActiveBlessDie(enemy), 0);
}

// =============================================================
// Section 4 — Planner + Engine integration
// =============================================================

console.log('\n--- Section 4: Planner + Engine ---');

{
  // 4a: planTurn returns bless action for Cleric with ally nearby
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  const fighter = spawnClass('Fighter', { x: 2, y: 0, z: 0 });
  fighter.faction = 'party';
  const bf = makeBF([cleric, fighter]);

  const plan = planTurn(cleric, bf);
  eq('4a: plan.action.type === bless', plan.action?.type, 'bless');
}

{
  // 4b: planTurn does NOT plan bless when already concentrating
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  cleric.concentration = { active: true, spellName: 'Guiding Bolt', dcIfHit: 10 };
  const fighter = spawnClass('Fighter', { x: 2, y: 0, z: 0 });
  fighter.faction = 'party';
  const bf = makeBF([cleric, fighter]);

  const plan = planTurn(cleric, bf);
  assert('4b: no bless when already concentrating', plan.action?.type !== 'bless');
}

{
  // 4c: planTurn does NOT re-cast bless when concentrating on Bless
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  cleric.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const fighter = spawnClass('Fighter', { x: 2, y: 0, z: 0 });
  fighter.faction = 'party';
  const bf = makeBF([cleric, fighter]);

  const plan = planTurn(cleric, bf);
  assert('4c: no re-cast when concentrating on Bless', plan.action?.type !== 'bless');
}

{
  // 4d: planTurn — no bless when all slots exhausted
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  if (cleric.resources?.spellSlots) {
    for (const slot of Object.values(cleric.resources.spellSlots)) slot.remaining = 0;
  }
  const fighter = spawnClass('Fighter', { x: 2, y: 0, z: 0 });
  fighter.faction = 'party';
  const bf = makeBF([cleric, fighter]);

  const plan = planTurn(cleric, bf);
  assert('4d: no bless when slots exhausted', plan.action?.type !== 'bless');
}

{
  // 4e: runCombat fires Bless events in round 1
  const cleric  = spawnClass('Cleric', { x: 0, y: 0, z: 0 });
  cleric.maxHP  = 100; cleric.currentHP = 100;
  const fighter = spawnClass('Fighter', { x: 2, y: 0, z: 0 });
  fighter.faction = 'party';
  fighter.maxHP  = 100; fighter.currentHP = 100;
  const goblin  = spawnClass('Fighter', { x: 10, y: 0, z: 0 });
  goblin.faction = 'enemy';

  const bf = makeFlatBattlefield(20, 20, [cleric, fighter, goblin]);
  const result = runCombat(bf, [cleric.id, fighter.id, goblin.id], { maxRounds: 5 });

  const blessEvents = result.events.filter(e => e.description.includes('Bless'));
  assert('4e: Bless events appear in combat log', blessEvents.length > 0);

  const blessAction = result.events.find(
    e => e.type === 'action' && e.description.includes('casts Bless'));
  assert('4e: action event for Bless cast fired', blessAction !== undefined);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
