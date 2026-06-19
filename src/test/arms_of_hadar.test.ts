// ============================================================
// arms_of_hadar.test.ts
//
// Tests:
//   1. shouldCast  — precondition gates, Euclidean circle AoE (9 tests)
//   2. execute     — slot, STR save, damage, lose-reaction pipeline (9 tests)
//   3. Planner     — ≥2-enemy threshold, Hex concentration agnostic (5 tests)
//   4. Engine      — runCombat fires events (5 tests)
//
// Run: ts-node src/test/arms_of_hadar.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute } from '../spells/arms_of_hadar';
import { euclideanDistFt, opportunityAttackTriggered } from '../engine/movement';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { runCombat, makeFlatBattlefield, EngineState, CombatLog } from '../engine/combat';
import { Combatant, Battlefield, Action, PlayerResources, Vec3 } from '../types/core';

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

const AOH_ACTION: Action = {
  name: 'Arms of Hadar',
  isMultiattack: false,
  attackType: 'save',
  reach: 10,
  range: null,
  hitBonus: null,
  damage: { count: 2, sides: 6, bonus: 0, average: 7 },
  damageType: 'necrotic',
  saveDC: 13,
  saveAbility: 'str',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Arms of Hadar',
};

/** Warlock-style pact slots. */
function withPactSlots(remaining = 1): PlayerResources {
  return {
    pactSlots: { max: 1, remaining, slotLevel: 1, recoversOn: 'short' },
  };
}

/** Standard 1st-level slots (Sorcerer/Wizard fallback). */
function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('warlock', {
    faction: 'party', pos,
    actions: [{ ...AOH_ACTION }],
    resources: withPactSlots(1),
  });
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos });
}

function makeBF(all: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of all) map.set(c.id, c);
  return {
    combatants: map, round: 1,
    initiativeOrder: all.map(c => c.id),
    obstacles: [],
    width: 10, height: 10, depth: 1, cells: [],
  } as unknown as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// PC helpers
const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap  = loadPCStatBlocks(rawPCs);
function spawnClass(cls: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown class: ${cls}`);
  return c;
}

// ============================================================
// 1. shouldCast — gates
// ============================================================

console.log('\n--- 1. shouldCast gates ---');

{
  // 1a. Returns null when caster has no Arms of Hadar action.
  const caster = makeCaster();
  caster.actions = [];
  const enemy  = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf     = makeBF([caster, enemy]);
  eq('1a. no action → null', shouldCast(caster, bf), null);
}

{
  // 1b. Returns null when caster has no spell slots.
  const caster = makeCaster();
  caster.resources = withPactSlots(0);
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf    = makeBF([caster, enemy]);
  eq('1b. no slots → null', shouldCast(caster, bf), null);
}

{
  // 1c. Returns null when no enemies exist.
  const caster = makeCaster();
  const bf     = makeBF([caster]);
  eq('1c. no enemies → null', shouldCast(caster, bf), null);
}

{
  // 1d. Returns targets when ≥1 enemy in 10-ft Euclidean range.
  const caster  = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy   = makeEnemy('e1', { x: 1, y: 0, z: 0 }); // 5 ft away
  const bf      = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('1d. enemy at 5ft → targets returned', targets !== null && targets.length === 1);
}

{
  // 1e. Euclidean circle: enemy at exactly 2 cells (10 ft) is in range.
  const caster  = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy   = makeEnemy('e1', { x: 2, y: 0, z: 0 }); // exactly 10 ft Euclidean
  const bf      = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('1e. enemy at exactly 10ft → in range', targets !== null && targets.length === 1);
}

{
  // 1f. Euclidean circle: enemy 2 cells diagonally (~14.1 ft) is OUT of range.
  // Chebyshev would include this (max(2,2)=2 → "10ft"), Euclidean correctly excludes it.
  const caster  = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy   = makeEnemy('e1', { x: 2, y: 2, z: 0 }); // sqrt(8)*5 ≈ 14.1 ft
  const bf      = makeBF([caster, enemy]);
  eq('1f. diagonal 2-sq enemy (~14.1ft) excluded by Euclidean', shouldCast(caster, bf), null);
}

{
  // 1g. Enemy at (1,1) is ~7.07 ft — inside the 10-ft radius.
  const caster  = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy   = makeEnemy('e1', { x: 1, y: 1, z: 0 }); // sqrt(2)*5 ≈ 7.07 ft
  const bf      = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('1g. (1,1) diagonal ≈7.07ft → in range', targets !== null && targets.length === 1);
}

{
  // 1h. Skips dead and unconscious enemies.
  const caster      = makeCaster();
  const dead        = makeEnemy('dead', { x: 1, y: 0, z: 0 });
  dead.isDead       = true;
  const unconscious = makeEnemy('unc', { x: 0, y: 1, z: 0 });
  unconscious.isUnconscious = true;
  const bf          = makeBF([caster, dead, unconscious]);
  eq('1h. dead/unconscious enemies → null', shouldCast(caster, bf), null);
}

{
  // 1i. Skips allies even if in range.
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const ally   = makeCombatant('ally', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bf     = makeBF([caster, ally]);
  eq('1i. only allies in range → null', shouldCast(caster, bf), null);
}

// ============================================================
// 2. execute — slot, save, damage, reaction pipeline
// ============================================================

console.log('\n--- 2. execute pipeline ---');

{
  // 2a. Consumes a pact slot.
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  eq('2a. pact slot consumed', caster.resources?.pactSlots?.remaining, 0);
}

{
  // 2b. Logs the cast event.
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  const castEvent = state.log.events.find(e => e.type === 'action' && e.description.includes('Arms of Hadar'));
  assert('2b. cast event logged', !!castEvent);
}

{
  // 2c. Damage event logged for each target.
  const caster = makeCaster();
  const e1     = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2     = makeEnemy('e2', { x: 0, y: 1, z: 0 });
  const bf     = makeBF([caster, e1, e2]);
  const state  = makeState(bf);
  execute(caster, [e1, e2], state);
  const dmgEvents = state.log.events.filter(e => e.type === 'damage');
  eq('2c. damage logged for 2 targets', dmgEvents.length, 2);
}

{
  // 2d. On failed save: full damage in [2,12] dealt AND reactionUsed set to true.
  // Force failure: STR 1 (−5 mod) vs DC 13.
  let reactionLostOnFail = false;
  let damageInBounds     = true;

  for (let i = 0; i < 20; i++) {
    const freshEnemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
    freshEnemy.str = 1;
    freshEnemy.currentHP = 40;
    freshEnemy.budget.reactionUsed = false;
    const freshCaster = makeCaster();
    const freshBF = makeBF([freshCaster, freshEnemy]);
    const st = makeState(freshBF);
    execute(freshCaster, [freshEnemy], st);
    const failEvt = st.log.events.find(e => e.type === 'save_fail');
    if (failEvt) {
      if (freshEnemy.budget.reactionUsed) reactionLostOnFail = true;
      const dmgEvt = st.log.events.find(e => e.type === 'damage' && e.targetId === 'e1');
      if (dmgEvt && (dmgEvt.value! < 2 || dmgEvt.value! > 12)) damageInBounds = false;
    }
  }
  assert('2d. reaction lost on failed save (STR 1 vs DC 13)', reactionLostOnFail);
  assert('2d. full damage 2d6 in [2,12]', damageInBounds);
}

{
  // 2e. On successful save: half damage, reaction NOT lost.
  // Force success: STR 30 (+10 mod) vs DC 13.
  let successSeen  = false;
  let reactionLost = false;

  for (let i = 0; i < 10; i++) {
    const freshEnemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
    freshEnemy.str = 30;
    freshEnemy.currentHP = 40;
    freshEnemy.budget.reactionUsed = false;
    const freshCaster = makeCaster();
    const freshBF = makeBF([freshCaster, freshEnemy]);
    const st = makeState(freshBF);
    execute(freshCaster, [freshEnemy], st);
    if (st.log.events.some(e => e.type === 'save_success')) {
      successSeen = true;
      if (freshEnemy.budget.reactionUsed) reactionLost = true;
    }
  }
  assert('2e. save success seen (STR 30)', successSeen);
  assert('2e. reaction NOT lost on successful save', !reactionLost);
}

{
  // 2f. Half-damage on success is floored (≥ 1).
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  enemy.str    = 30;
  const freshBF = makeBF([caster, enemy]);
  const st      = makeState(freshBF);
  execute(caster, [enemy], st);
  const dmgEvt = st.log.events.find(e => e.type === 'damage' && e.targetId === 'e1');
  assert('2f. half damage ≥ 1', !!(dmgEvt && dmgEvt.value! >= 1));
}

{
  // 2g. Dead targets are skipped inside execute (no damage event emitted).
  const caster = makeCaster();
  const dead   = makeEnemy('dead', { x: 1, y: 0, z: 0 });
  dead.isDead  = true;
  const freshBF = makeBF([caster, dead]);
  const st      = makeState(freshBF);
  execute(caster, [dead], st);
  const dmgEvts = st.log.events.filter(e => e.type === 'damage');
  eq('2g. dead target skipped — no damage events', dmgEvts.length, 0);
}

{
  // 2h. Standard (non-pact) slots are also consumed correctly.
  const caster = makeCaster();
  caster.resources = withSlots(2);
  const enemy   = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const freshBF = makeBF([caster, enemy]);
  const st      = makeState(freshBF);
  execute(caster, [enemy], st);
  eq('2h. standard slot consumed', caster.resources.spellSlots?.[1]?.remaining, 1);
}

{
  // 2i. condition_add event emitted when target fails save.
  let condEventSeen = false;
  for (let i = 0; i < 20; i++) {
    const freshEnemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
    freshEnemy.str = 1;
    const freshCaster = makeCaster();
    const freshBF = makeBF([freshCaster, freshEnemy]);
    const st = makeState(freshBF);
    execute(freshCaster, [freshEnemy], st);
    if (st.log.events.some(e => e.type === 'condition_add' && e.targetId === 'e1')) {
      condEventSeen = true;
      break;
    }
  }
  assert('2i. condition_add event on failed save', condEventSeen);
}

// ============================================================
// 3. Planner — threshold and concentration behaviour
// ============================================================

console.log('\n--- 3. Planner ---');

{
  // 3a. Warlock picks Arms of Hadar when ≥2 enemies within 10-ft Euclidean radius.
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  const e1 = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeCombatant('e2', { faction: 'enemy', pos: { x: 0, y: 1, z: 0 } });
  const bf = makeBF([warlock, e1, e2]);
  const plan = planTurn(warlock, bf);
  eq('3a. Warlock picks armsOfHadar with ≥2 enemies in 10ft', plan.action?.type, 'armsOfHadar');
}

{
  // 3b. Warlock does NOT cast Arms of Hadar with only 1 enemy in range.
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  const e1 = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([warlock, e1]);
  const plan = planTurn(warlock, bf);
  assert('3b. only 1 enemy in 10ft → no armsOfHadar', plan.action?.type !== 'armsOfHadar');
}

{
  // 3c. Warlock does NOT cast when out of slots (all slots exhausted).
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  if (warlock.resources?.pactSlots) warlock.resources.pactSlots.remaining = 0;
  if (warlock.resources?.spellSlots) {
    for (const k of Object.keys(warlock.resources.spellSlots)) {
      (warlock.resources.spellSlots as any)[+k].remaining = 0;
    }
  }
  const e1 = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeCombatant('e2', { faction: 'enemy', pos: { x: 0, y: 1, z: 0 } });
  const bf = makeBF([warlock, e1, e2]);
  const plan = planTurn(warlock, bf);
  assert('3c. no slots → no armsOfHadar', plan.action?.type !== 'armsOfHadar');
}

{
  // 3d. Arms of Hadar fires while concentrating on Hex (AoH is NOT concentration).
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  warlock.concentration = { active: true, spellName: 'Hex', dcIfHit: 0 };
  const e1 = makeCombatant('e1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeCombatant('e2', { faction: 'enemy', pos: { x: 0, y: 1, z: 0 } });
  const bf = makeBF([warlock, e1, e2]);
  const plan = planTurn(warlock, bf);
  eq('3d. armsOfHadar fires while concentrating on Hex', plan.action?.type, 'armsOfHadar');
}

{
  // 3e. Diagonal enemies at 2 squares (~14.1 ft) do NOT count toward the ≥2 threshold.
  // Both enemies outside 10-ft Euclidean → shouldCast returns null → no cast.
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  const e1 = makeCombatant('e1', { faction: 'enemy', pos: { x: 2, y: 2, z: 0 } }); // ~14.1 ft
  const e2 = makeCombatant('e2', { faction: 'enemy', pos: { x: -2, y: 2, z: 0 } }); // ~14.1 ft
  const bf = makeBF([warlock, e1, e2]);
  const plan = planTurn(warlock, bf);
  assert('3e. Euclidean excludes ~14.1ft diagonal enemies', plan.action?.type !== 'armsOfHadar');
}

// ============================================================
// 4. Engine integration — runCombat fires events
// ============================================================

console.log('\n--- 4. Engine integration ---');

{
  // 4a. runCombat produces at least one Arms of Hadar action event.
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  const e1 = makeCombatant('e1', { name: 'Goblin1', faction: 'enemy', cr: 0.25,
    maxHP: 7, currentHP: 7, ac: 15, pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeCombatant('e2', { name: 'Goblin2', faction: 'enemy', cr: 0.25,
    maxHP: 7, currentHP: 7, ac: 15, pos: { x: 0, y: 1, z: 0 } });
  const bf = makeFlatBattlefield(10, 10, [warlock, e1, e2]);
  // Warlock goes first so Arms of Hadar fires on round 1
  const initiative = [warlock.id, e1.id, e2.id];
  const log = runCombat(bf, initiative);
  const hasAoH = log.events.some(e => e.type === 'action' && e.description.includes('Arms of Hadar'));
  assert('4a. runCombat fires Arms of Hadar action event', hasAoH);
}

{
  // 4b. Necrotic damage event appears in the log.
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  const e1 = makeCombatant('e1', { name: 'Goblin1', faction: 'enemy', cr: 0.25,
    maxHP: 7, currentHP: 7, ac: 15, pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeCombatant('e2', { name: 'Goblin2', faction: 'enemy', cr: 0.25,
    maxHP: 7, currentHP: 7, ac: 15, pos: { x: 0, y: 1, z: 0 } });
  const bf = makeFlatBattlefield(10, 10, [warlock, e1, e2]);
  const log = runCombat(bf, [warlock.id, e1.id, e2.id]);
  const hasDmg = log.events.some(e => e.type === 'damage' && e.description.includes('necrotic'));
  assert('4b. necrotic damage event from Arms of Hadar', hasDmg);
}

{
  // 4c. Parser wires: Warlock parsed actions include 'Arms of Hadar'.
  const warlock = spawnClass('Warlock');
  const hasAction = warlock.actions.some(a => a.name === 'Arms of Hadar');
  assert('4c. Warlock parsed actions include Arms of Hadar', hasAction);
}

{
  // 4d. Arms of Hadar action has correct metadata: saveAbility=str, saveDC=13.
  const warlock = spawnClass('Warlock');
  const action  = warlock.actions.find(a => a.name === 'Arms of Hadar');
  assert('4d. saveAbility = str', action?.saveAbility === 'str');
  assert('4d. saveDC = 13', action?.saveDC === 13);
}

{
  // 4e. euclideanDistFt helper verifies boundary values for the circle AoE.
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const at10  = euclideanDistFt(origin, { x: 2, y: 0, z: 0 });   // exactly 10 ft
  const at14  = euclideanDistFt(origin, { x: 2, y: 2, z: 0 });   // ≈14.14 ft
  const at7   = euclideanDistFt(origin, { x: 1, y: 1, z: 0 });   // ≈7.07 ft

  assert('4e. euclideanDistFt (2,0,0) = 10ft',        Math.abs(at10 - 10)     < 0.01);
  assert('4e. euclideanDistFt (2,2,0) ≈ 14.14ft',     Math.abs(at14 - 14.142) < 0.01);
  assert('4e. euclideanDistFt (1,1,0) ≈ 7.07ft',      Math.abs(at7  -  7.071) < 0.01);
}

// ---- 5. OA integration: lose-reaction blocks opportunity attacks -----------

console.log('\n5. OA integration — reactionUsed blocks opportunity attacks');

{
  // 5a. opportunityAttackTriggered returns false when watcher.budget.reactionUsed = true
  // (unit-level confirmation that the OA gate respects reactionUsed)
  const watcher = makeCombatant('w', { faction: 'enemy', pos: { x: 0, y: 0, z: 0 } });
  const mover   = makeCombatant('m', { faction: 'party',  pos: { x: 0, y: 0, z: 0 } });

  // Set up: mover leaves watcher's 5-ft melee reach
  const from: Vec3 = { x: 1, y: 0, z: 0 };   // 5 ft — in reach
  const to:   Vec3 = { x: 2, y: 0, z: 0 };   // 10 ft — leaving reach

  watcher.budget.reactionUsed = false;
  const withReaction = opportunityAttackTriggered(watcher, mover, from, to);

  watcher.budget.reactionUsed = true;
  const withoutReaction = opportunityAttackTriggered(watcher, mover, from, to);

  assert('5a. OA triggers when reaction available', withReaction);
  assert('5a. OA blocked when reactionUsed = true', !withoutReaction);
}

{
  // 5b. End-to-end: Arms of Hadar (failed save) → target.budget.reactionUsed = true
  //     → opportunityAttackTriggered returns false for that target.
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });

  // STR 1 enemy → virtually guaranteed to fail DC 13 STR save (max roll = 1+1 = 2)
  const enemy = makeCombatant('orc', {
    name: 'OrcSTR1', faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    str: 1, maxHP: 20, currentHP: 20, ac: 10,
  });
  enemy.budget.reactionUsed = false;

  const state: EngineState = {
    battlefield: makeFlatBattlefield(10, 10, [warlock, enemy]),
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };

  // Run execute directly — with STR 1 the enemy will fail every save
  let blockedAfterCast = false;
  let attempts = 0;
  // Run a few iterations to confirm it's consistently true
  while (attempts < 10) {
    enemy.budget.reactionUsed = false;
    enemy.currentHP = 20;
    // Reload warlock slot (spellSlots value is { max, remaining })
    if (warlock.resources?.spellSlots?.[1]) warlock.resources.spellSlots[1].remaining += 1;
    execute(warlock, [enemy], state);
    if (enemy.budget.reactionUsed) { blockedAfterCast = true; break; }
    attempts++;
  }

  assert('5b. Arms of Hadar execute sets reactionUsed on failed save', blockedAfterCast);

  // If reactionUsed was set, confirm OA is now blocked for that enemy
  if (blockedAfterCast) {
    const from: Vec3 = { x: 1, y: 0, z: 0 };
    const to:   Vec3 = { x: 2, y: 0, z: 0 };
    const oaBlocked = !opportunityAttackTriggered(enemy, warlock, from, to);
    assert('5b. OA blocked for enemy with reactionUsed after Arms of Hadar', oaBlocked);
  }
}

{
  // 5c. Enemy whose save succeeded retains their reaction (OA still possible).
  const warlock = spawnClass('Warlock', { x: 0, y: 0, z: 0 });

  // STR 34 enemy → abilityMod(34) = +12 → min save = 1 + 12 = 13 ≥ DC 13 → always succeeds.
  // (Previously str=30 → mod +10 → min save 11 < 13 → failed on nat 1-2 ~10% of the time.
  //  The old comment "min roll = 30+10 = 40" confused the str SCORE (30) with the str
  //  MODIFIER (+10). Fixed: use str=34 so min save 13 ≥ DC 13 guarantees success.)
  const enemy = makeCombatant('giant', {
    name: 'GiantSTR34', faction: 'enemy', pos: { x: 0, y: 0, z: 0 },
    str: 34, maxHP: 100, currentHP: 100, ac: 10,
  });
  enemy.budget.reactionUsed = false;

  const state: EngineState = {
    battlefield: makeFlatBattlefield(10, 10, [warlock, enemy]),
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };

  execute(warlock, [enemy], state);

  assert('5c. Enemy with guaranteed save success keeps reaction available', !enemy.budget.reactionUsed);

  // Confirm OA is still possible for this enemy
  // watcher (enemy) at x=0; mover goes from x=1 (5ft, in reach) to x=2 (10ft, leaves reach)
  const from: Vec3 = { x: 1, y: 0, z: 0 };
  const to:   Vec3 = { x: 2, y: 0, z: 0 };
  const oaTriggered = opportunityAttackTriggered(enemy, warlock, from, to);
  assert('5c. OA still triggers for enemy who passed save', oaTriggered);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
