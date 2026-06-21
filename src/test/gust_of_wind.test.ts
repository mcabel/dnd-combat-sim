// ============================================================
// gust_of_wind.test.ts — Gust of Wind spell module
// PHB p.248: 2nd-level evocation, action, range Self (line 60 ft),
// concentration (1 min). Components: V, S, M.
//
// Effect: A line of strong wind 60 ft long, 10 ft wide. Each creature
// in the line must succeed on a STR save or be pushed 15 ft away.
//
// v1 simplification: targets a SINGLE enemy within 60 ft; one-shot
// push on cast (no persistent start-of-turn push); difficult-terrain
// rider NOT modelled; concentration is cosmetic.
//
// Tests cover shouldCast() preconditions + closest-first priority,
// execute() STR save resolution (guaranteed fail → pushed 15 ft;
// guaranteed success → not pushed), push direction + clamping,
// logging, integration pipeline, and metadata shape.
//
// Deterministic save outcomes:
//   - STR 1  + DC 25 = guaranteed fail  (mod -5, even nat 20 → 15 < 25)
//   - STR 30 + DC 5  = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/gust_of_wind';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

/** Guaranteed-fail action: STR 1 + DC 25 → max save 15 < 25 (always fails) */
const GUST_ACTION_FAIL: Action = {
  name: 'Gust of Wind',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed fail (STR 1 → max 15)
  saveAbility: 'str',
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Gust of Wind (DC 25 STR or pushed 15 ft, concentration 1 min)',
};

/** Guaranteed-success action: STR 30 + DC 5 → min save 11 ≥ 5 (always succeeds) */
const GUST_ACTION_SUCCESS: Action = { ...GUST_ACTION_FAIL, saveDC: 5 };

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
    conditions: new Set(),
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

/** Wizard with Gust of Wind + 2 2nd-level slots, DC 25 STR (guaranteed fail) */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [GUST_ACTION_FAIL],
    resources: withSlots2(2),
  });
}

/** Enemy with STR 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    str: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos, ...overrides,
  });
}

/** Enemy with STR 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    str: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Gust of Wind', metadata.name, 'Gust of Wind');
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('push is 15 ft', metadata.pushFt, 15);
eq('is concentration', metadata.concentration, true);
eq('save ability is str', metadata.saveAbility, 'str');
eq('casting time is action', metadata.castingTime, 'action');
eq('line AoE NOT implemented (v1 — single-target)', metadata.gustOfWindLineAoeV1Implemented, false);
eq('start-of-turn push NOT implemented (v1)', metadata.gustOfWindStartOfTurnPushV1Implemented, false);
eq('difficult-terrain rider NOT implemented (v1)', metadata.gustOfWindDifficultTerrainV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.gustOfWindConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + priority ===\n');

{
  // 2a. Caster lacks 'Gust of Wind' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Gust of Wind action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating on another spell
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range
  const caster = makeWizard();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });   // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Closest enemy selected first (priority)
  const caster = makeWizard();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 });    // 25 ft
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 });  // 5 ft
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy selected', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 3. execute — save resolution
// ============================================================

console.log('\n=== 3. execute — save resolution ===\n');

{
  // 3a. Guaranteed fail (STR 1 vs DC 25) → pushed 15 ft (3 squares)
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  // Pushed 3 squares from (1,0,0) to (4,0,0) — directly away from caster at (0,0,0)
  eq('Enemy pushed 3 squares away on failed save', enemy.pos.x, 4);
  eq('Enemy y unchanged', enemy.pos.y, 0);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration started on Gust of Wind', caster.concentration?.spellName, 'Gust of Wind');
}

{
  // 3b. Guaranteed success (STR 30 vs DC 5) → NOT pushed
  const caster = makeWizard();
  caster.actions = [GUST_ACTION_SUCCESS];      // DC 5
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Enemy NOT pushed on successful save', enemy.pos.x, 1);
  eq('Enemy y unchanged', enemy.pos.y, 0);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3c. No damage applied on either save outcome (Gust of Wind deals no damage)
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Enemy takes no damage on push', enemy.currentHP, 100);
}

{
  // 3d. Dead target skipped (stale plan) — no push
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Dead enemy NOT pushed', enemy.pos.x, 1);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 4. execute — push direction + clamping
// ============================================================

console.log('\n=== 4. execute — push direction + clamping ===\n');

{
  // 4a. Push direction: caster (5,5,0), target (7,5,0) → target pushed to (10,5,0)
  const caster = makeWizard({ x: 5, y: 5, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 7, y: 5, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Pushed 3 squares in +x direction (away from caster)', enemy.pos.x, 10);
  eq('Pushed y unchanged', enemy.pos.y, 5);
}

{
  // 4b. Push clamped at battlefield edge (max 29)
  const caster = makeWizard({ x: 26, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 28, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // (28+3 = 31, clamped to 29)
  eq('Pushed target clamped to 29 (battlefield upper bound)', enemy.pos.x, 29);
  eq('Pushed y unchanged', enemy.pos.y, 0);
}

{
  // 4c. Push clamped at lower bound (0)
  const caster = makeWizard({ x: 4, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // Pushed in -x direction: 2-3 = -1, clamped to 0
  eq('Pushed target clamped to 0 (battlefield lower bound)', enemy.pos.x, 0);
}

{
  // 4d. Diagonal push: caster (0,0,0), enemy (1,1,0) → push both x and y
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // dx=1, dy=1 → stepX=1, stepY=1 → new pos (4, 4, 0)
  eq('Diagonal push: x = 4', enemy.pos.x, 4);
  eq('Diagonal push: y = 4', enemy.pos.y, 4);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Save event emitted', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('First action event mentions "Gust of Wind"', actionEvents[0].description.includes('Gust of Wind'));
}

{
  // 5b. On save success: save_success event, no push action event
  const caster = makeWizard();
  caster.actions = [GUST_ACTION_SUCCESS];
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const events = state.log.events as any[];
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');

  assert('Save event is save_success (guaranteed success)', saveEvents[0]?.type === 'save_success');
  // Look for the "resists" message
  const resistEvents = events.filter(e => e.description?.includes('resists'));
  assert('"Resists" log emitted on save success', resistEvents.length === 1);
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/gust_of_wind');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Gust of Wind', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Gust of Wind');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster pushes closest enemy 15 ft away
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 });    // 25 ft
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 });  // 5 ft
  const bf = makeBF([caster, far, near]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the nearest enemy', target?.id, 'near');
  if (target) execute(caster, target, state);

  eq('Nearest enemy pushed to (4,0,0)', near.pos.x, 4);
  eq('Far enemy NOT pushed', far.pos.x, 5);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration on Gust of Wind', caster.concentration?.spellName, 'Gust of Wind');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 7c. Strong enemy resists — not pushed, slot still consumed
  const caster = makeWizard();
  caster.actions = [GUST_ACTION_SUCCESS];
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Strong enemy NOT pushed (save succeeded)', enemy.pos.x, 1);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration started regardless of save outcome', caster.concentration?.spellName, 'Gust of Wind');
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
