// ============================================================
// entangle.test.ts
//
// Tests:
//   1. shouldCast — planner precondition gates (7 tests)
//   2. execute    — slot/concentration/save/condition pipeline (8 tests)
//   3. Mechanical integration — restrained effects on speed/attacks (6 tests)
//   4. Planner + Engine integration (5 tests)
//
// Run: ts-node src/test/entangle.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute } from '../spells/entangle';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { effectiveSpeed } from '../engine/utils';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { runCombat, makeFlatBattlefield, EngineState, CombatLog } from '../engine/combat';
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

const ENTANGLE_ACTION: Action = {
  name: 'Entangle',
  isMultiattack: false,
  attackType: 'save',
  reach: 90,
  range: { normal: 90, long: 180 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 13,
  saveAbility: 'str',
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Entangle',
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
    isDefender: false, cannotAttack: false, hasHands: true,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    ...overrides,
  };
}

function makeDruid(pos = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('druid', {
    faction: 'party',
    pos,
    actions: [{ ...ENTANGLE_ACTION }],
    resources: withSlots(2),
  });
}

function makeEnemy(id: string, pos = { x: 3, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos, str: 10 });
}

function makeStrongEnemy(id: string, pos = { x: 3, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos, str: 20 }); // +5 STR → almost always saves
}

function makeBF(casters: Combatant[], enemies: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of [...casters, ...enemies]) map.set(c.id, c);
  return {
    combatants: map,
    round: 1,
    initiative: [...casters, ...enemies].map((c, i) => ({ id: c.id, initiative: 10 - i })),
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

// PC factories
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
  // 1a: returns targets when enemy in range
  const druid = makeDruid();
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);

  const targets = shouldCast(druid, bf);
  assert('1a: returns targets when enemy in range', targets !== null && targets.length >= 1);
  assert('1a: enemy is in target list', targets?.[0]?.id === 'orc');
}

{
  // 1b: returns null when already concentrating
  const druid = makeDruid();
  druid.concentration = { active: true, spellName: 'Faerie Fire', dcIfHit: 10 };
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);

  assert('1b: null when concentrating', shouldCast(druid, bf) === null);
}

{
  // 1c: returns null when no Entangle in actions
  const druid = makeDruid();
  druid.actions = [];
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);

  assert('1c: null when no Entangle action', shouldCast(druid, bf) === null);
}

{
  // 1d: returns null when no spell slots
  const druid = makeDruid();
  druid.resources = withSlots(0);
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);

  assert('1d: null when slots exhausted', shouldCast(druid, bf) === null);
}

{
  // 1e: enemy beyond 90ft is excluded (x=19 → 95ft)
  const druid   = makeDruid({ x: 0, y: 0, z: 0 });
  const farFoe  = makeEnemy('orc', { x: 19, y: 0, z: 0 }); // 95ft
  const bf      = makeBF([druid], [farFoe]);

  assert('1e: enemy at 95ft excluded', shouldCast(druid, bf) === null);
}

{
  // 1f: skips dead and unconscious enemies
  const druid   = makeDruid();
  const dead    = makeEnemy('orc1');
  dead.isDead   = true;
  const uncon   = makeEnemy('orc2', { x: 4, y: 0, z: 0 });
  uncon.isUnconscious = true;
  const bf      = makeBF([druid], [dead, uncon]);

  assert('1f: null when only dead/unconscious enemies', shouldCast(druid, bf) === null);
}

{
  // 1g: skips allies, targets only enemies
  const druid = makeDruid();
  const ally  = makeCombatant('fighter', { faction: 'party', pos: { x: 2, y: 0, z: 0 } });
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid, ally], [enemy]);

  const targets = shouldCast(druid, bf);
  assert('1g: ally not in targets', targets !== null && !targets.some(t => t.id === 'fighter'));
  assert('1g: enemy IS in targets',  targets !== null && targets.some(t => t.id === 'orc'));
}

// =============================================================
// Section 2 — execute pipeline
// =============================================================

console.log('\n--- Section 2: execute pipeline ---');

{
  // 2a: consumes a 1st-level spell slot
  const druid = makeDruid();
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  const slotsBefore = druid.resources!.spellSlots![1].remaining;
  execute(druid, [enemy], state);
  eq('2a: slot consumed', druid.resources!.spellSlots![1].remaining, slotsBefore - 1);
}

{
  // 2b: concentration starts on 'Entangle'
  const druid = makeDruid();
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  execute(druid, [enemy], state);

  assert('2b: concentration.active = true', druid.concentration?.active === true);
  eq('2b: concentration.spellName', druid.concentration?.spellName, 'Entangle');
}

{
  // 2c: action cast event logged
  const druid = makeDruid();
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  execute(druid, [enemy], state);

  const castEvent = state.log.events.find(
    e => e.type === 'action' && e.description.includes('Entangle'));
  assert('2c: cast action event logged', castEvent !== undefined);
}

{
  // 2d: save event logged per target
  const druid = makeDruid();
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  execute(druid, [enemy], state);

  const saveEvents = state.log.events.filter(
    e => e.type === 'save_success' || e.type === 'save_fail');
  assert('2d: save event logged for each target', saveEvents.length >= 1);
}

{
  // 2e: guaranteed restrained on DC 99 (no one saves)
  const druid = makeDruid();
  const action = druid.actions.find(a => a.name === 'Entangle')!;
  action.saveDC = 99;   // impossible to save
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  execute(druid, [enemy], state);

  assert('2e: restrained condition applied on failed save',
    enemy.conditions.has('restrained'));
}

{
  // 2f: guaranteed save on DC 1 (everyone saves)
  const druid = makeDruid();
  const action = druid.actions.find(a => a.name === 'Entangle')!;
  action.saveDC = 1;  // trivially easy
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  execute(druid, [enemy], state);

  assert('2f: not restrained when save succeeds', !enemy.conditions.has('restrained'));
}

{
  // 2g: sourceIsConcentration = true on the applied effect
  const druid = makeDruid();
  const druidAction = druid.actions.find(a => a.name === 'Entangle')!;
  druidAction.saveDC = 99;  // force fail
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  execute(druid, [enemy], state);

  const eff = enemy.activeEffects.find(e => e.spellName === 'Entangle');
  assert('2g: sourceIsConcentration true', eff?.sourceIsConcentration === true);
}

{
  // 2h: restrained removed when concentration breaks
  const druid = makeDruid();
  const action = druid.actions.find(a => a.name === 'Entangle')!;
  action.saveDC = 99;
  const enemy = makeEnemy('orc');
  const bf    = makeBF([druid], [enemy]);
  const state = makeState(bf);

  execute(druid, [enemy], state);
  assert('2h: restrained before break', enemy.conditions.has('restrained'));

  removeEffectsFromCaster(druid.id, bf);
  druid.concentration = null;

  assert('2h: restrained removed after concentration break',
    !enemy.conditions.has('restrained'));
}

// =============================================================
// Section 3 — Mechanical integration
// =============================================================

console.log('\n--- Section 3: Mechanical integration ---');

{
  // 3a: restrained → effectiveSpeed = 0
  const c = makeCombatant('orc', { faction: 'enemy', speed: 30 });
  c.conditions.add('restrained');
  eq('3a: restrained creature speed = 0', effectiveSpeed(c), 0);
}

{
  // 3b: restrained → speed 0 (no restrained)
  const c = makeCombatant('orc', { faction: 'enemy', speed: 30 });
  eq('3b: un-restrained creature speed = 30', effectiveSpeed(c), 30);
}

{
  // 3c: execute with multiple targets — all processed (some may save)
  const druid  = makeDruid();
  const action = druid.actions.find(a => a.name === 'Entangle')!;
  action.saveDC = 99;  // guarantee all fail
  const e1     = makeEnemy('orc1', { x: 3, y: 0, z: 0 });
  const e2     = makeEnemy('orc2', { x: 4, y: 0, z: 0 });
  const e3     = makeEnemy('orc3', { x: 5, y: 0, z: 0 });
  const bf     = makeBF([druid], [e1, e2, e3]);
  const state  = makeState(bf);

  execute(druid, [e1, e2, e3], state);

  assert('3c: all 3 enemies restrained (DC 99)',
    e1.conditions.has('restrained') &&
    e2.conditions.has('restrained') &&
    e3.conditions.has('restrained'));
}

{
  // 3d: casterId stamped correctly on effect
  const druid  = makeDruid();
  const action = druid.actions.find(a => a.name === 'Entangle')!;
  action.saveDC = 99;
  const enemy  = makeEnemy('orc');
  const bf     = makeBF([druid], [enemy]);
  const state  = makeState(bf);

  execute(druid, [enemy], state);

  const eff = enemy.activeEffects.find(e => e.spellName === 'Entangle');
  eq('3d: effect casterId = druid', eff?.casterId, 'druid');
}

{
  // 3e: 90ft range check — enemy at exactly 90ft is included
  const druid  = makeDruid({ x: 0, y: 0, z: 0 });
  const edge   = makeEnemy('orc', { x: 18, y: 0, z: 0 }); // exactly 90ft
  const bf     = makeBF([druid], [edge]);

  const targets = shouldCast(druid, bf);
  assert('3e: enemy at exactly 90ft is a valid target', targets !== null);
}

{
  // 3f: enemy at 90ft+1 cell (95ft) is excluded
  const druid  = makeDruid({ x: 0, y: 0, z: 0 });
  const far    = makeEnemy('orc', { x: 19, y: 0, z: 0 }); // 95ft
  const bf     = makeBF([druid], [far]);

  assert('3f: enemy at 95ft is excluded', shouldCast(druid, bf) === null);
}

// =============================================================
// Section 4 — Planner + Engine integration
// =============================================================

console.log('\n--- Section 4: Planner + Engine ---');

{
  // 4a: planTurn returns entangle when Druid has enemy in range
  const druid  = spawnClass('Druid', { x: 0, y: 0, z: 0 });
  const goblin = spawnClass('Fighter', { x: 6, y: 0, z: 0 });
  goblin.faction = 'enemy';
  const bf = makeBF([druid], [goblin]);

  const plan = planTurn(druid, bf);
  eq('4a: plan.action.type === entangle', plan.action?.type, 'entangle');
}

{
  // 4b: planTurn does NOT cast entangle when already concentrating
  const druid = spawnClass('Druid', { x: 0, y: 0, z: 0 });
  druid.concentration = { active: true, spellName: 'Faerie Fire', dcIfHit: 10 };
  const goblin = spawnClass('Fighter', { x: 6, y: 0, z: 0 });
  goblin.faction = 'enemy';
  const bf = makeBF([druid], [goblin]);

  const plan = planTurn(druid, bf);
  assert('4b: no entangle when concentrating', plan.action?.type !== 'entangle');
}

{
  // 4c: planTurn does NOT cast entangle when slots exhausted
  const druid = spawnClass('Druid', { x: 0, y: 0, z: 0 });
  if (druid.resources?.spellSlots) {
    for (const slot of Object.values(druid.resources.spellSlots)) slot.remaining = 0;
  }
  const goblin = spawnClass('Fighter', { x: 6, y: 0, z: 0 });
  goblin.faction = 'enemy';
  const bf = makeBF([druid], [goblin]);

  const plan = planTurn(druid, bf);
  assert('4c: no entangle when slots exhausted', plan.action?.type !== 'entangle');
}

{
  // 4d: Druid picks Entangle over Faerie Fire when neither is active (Entangle = priority)
  const druid  = spawnClass('Druid', { x: 0, y: 0, z: 0 });
  const goblin = spawnClass('Fighter', { x: 6, y: 0, z: 0 });
  goblin.faction = 'enemy';
  const bf = makeBF([druid], [goblin]);

  const plan = planTurn(druid, bf);
  // Druid has both Entangle and Faerie Fire; Entangle has higher priority in the planner
  assert('4d: Druid picks Entangle over Faerie Fire when both available',
    plan.action?.type === 'entangle');
}

{
  // 4e: runCombat — Entangle events appear in log
  const druid  = spawnClass('Druid', { x: 0, y: 0, z: 0 });
  druid.maxHP  = 100; druid.currentHP = 100;
  const goblin = spawnClass('Fighter', { x: 6, y: 0, z: 0 });
  goblin.faction = 'enemy';

  const bf = makeFlatBattlefield(20, 20, [druid, goblin]);
  const result = runCombat(bf, [druid.id, goblin.id], { maxRounds: 5 });

  const entangleEvents = result.events.filter(e => e.description.includes('Entangle'));
  assert('4e: Entangle events appear in combat log', entangleEvents.length > 0);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
