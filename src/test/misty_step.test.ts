// ============================================================
// misty_step.test.ts — Misty Step spell module
// PHB p.260: 2nd-level conjuration, BONUS ACTION, range Self, NO
// concentration. Duration: Instantaneous.
//
// Effect: Teleport up to 30 ft to an unoccupied space you can see.
//
// v1 destination logic: 30 ft toward nearest enemy (or AWAY from
// nearest enemy if caster is below 25% HP), clamped to [0, 29].
//
// Tests cover shouldCast() preconditions + destination logic (toward
// enemy when healthy, away when wounded, clamped to bounds, already
// adjacent skip), execute() teleport + slot consumption + logging,
// integration pipeline, and metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/misty_step';
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

const MISTY_STEP_ACTION: Action = {
  name: 'Misty Step',
  isMultiattack: false,
  attackType: null,
  reach: 0,                  // self
  range: { normal: 0, long: 0 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'bonusAction',
  legendaryCost: 0,
  description: 'Misty Step (bonus action, teleport 30 ft)',
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
    conditions: new Set(),
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

/** Wizard with Misty Step + 2 2nd-level slots, full HP */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [MISTY_STEP_ACTION],
    resources: withSlots2(2),
  });
}

function makeEnemy(id: string, pos: Vec3 = { x: 10, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Misty Step', metadata.name, 'Misty Step');
eq('level is 2', metadata.level, 2);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('teleport range is 30 ft', metadata.teleportRangeFt, 30);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is bonusAction', metadata.castingTime, 'bonusAction');
eq('destination LOS NOT implemented (v1)', metadata.mistyStepDestinationLOSV1Implemented, false);
eq('unoccupied-space check NOT implemented (v1)', metadata.mistyStepUnoccupiedSpaceV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Misty Step' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Misty Step action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No living enemies — no point teleporting
  const caster = makeWizard();
  const deadEnemy = makeEnemy('e1', { x: 10, y: 0, z: 0 }, { isDead: true });
  const bf = makeBF([caster, deadEnemy]);
  assert('Returns null when no living enemies', shouldCast(caster, bf) === null);
}

{
  // 2d. Already adjacent to nearest enemy (when not escaping) — skip
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });   // 1 square = adjacent
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster already adjacent to enemy (not escaping)', shouldCast(caster, bf) === null);
}

{
  // 2e. Concentrating on another spell — NOT a gate (Misty Step is not concentration)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns destination even when caster is concentrating (NOT concentration spell)', result !== null);
}

// ============================================================
// 3. shouldCast — destination logic
// ============================================================

console.log('\n=== 3. shouldCast — destination logic ===\n');

{
  // 3a. Healthy caster → teleport TOWARD enemy (6 squares)
  // caster (0,0,0), enemy (10,0,0) → dest (6,0,0)
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);

  const result = shouldCast(caster, bf);
  assert('shouldCast returns a destination', result !== null);
  if (result) {
    eq('Destination x is 6 (toward enemy, 6 squares)', result.destination.x, 6);
    eq('Destination y is 0', result.destination.y, 0);
    eq('Destination z preserved', result.destination.z, 0);
  }
}

{
  // 3b. Wounded caster (HP < 25%) → teleport AWAY from enemy
  // caster (5,5,0), enemy (10,10,0), HP 20/100 → dest (0,0,0) (clamped)
  const caster = makeWizard({ x: 5, y: 5, z: 0 });
  caster.currentHP = 20;     // 20% < 25% → escaping
  const enemy = makeEnemy('e1', { x: 10, y: 10, z: 0 });
  const bf = makeBF([caster, enemy]);

  const result = shouldCast(caster, bf);
  assert('shouldCast returns a destination when escaping', result !== null);
  if (result) {
    eq('Escaping destination x is 0 (away from enemy, clamped)', result.destination.x, 0);
    eq('Escaping destination y is 0 (away from enemy, clamped)', result.destination.y, 0);
  }
}

{
  // 3c. Destination clamped to upper bound [0, 29]
  // caster (3,3,0), HP low, enemy (5,5,0) → dest clamped from (-3,-3) to (0,0)
  const caster = makeWizard({ x: 3, y: 3, z: 0 });
  caster.currentHP = 10;     // 10% < 25% → escaping
  const enemy = makeEnemy('e1', { x: 5, y: 5, z: 0 });
  const bf = makeBF([caster, enemy]);

  const result = shouldCast(caster, bf);
  assert('shouldCast returns a destination when escaping (clamp test)', result !== null);
  if (result) {
    eq('Clamped destination x ≥ 0', result.destination.x >= 0, true);
    eq('Clamped destination y ≥ 0', result.destination.y >= 0, true);
    eq('Clamped destination x ≤ 29', result.destination.x <= 29, true);
    eq('Clamped destination y ≤ 29', result.destination.y <= 29, true);
  }
}

{
  // 3d. Already adjacent AND wounded — escaping still works (no adjacency gate)
  const caster = makeWizard({ x: 5, y: 5, z: 0 });
  caster.currentHP = 10;     // 10% < 25% → escaping
  const enemy = makeEnemy('e1', { x: 6, y: 5, z: 0 });   // adjacent to caster
  const bf = makeBF([caster, enemy]);

  const result = shouldCast(caster, bf);
  assert('Escaping still triggers when adjacent (no adjacency gate for escape)', result !== null);
}

{
  // 3e. Nearest enemy used for direction (multiple enemies)
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const near = makeEnemy('near', { x: 6, y: 0, z: 0 });    // 6 squares
  const far = makeEnemy('far', { x: 20, y: 0, z: 0 });     // 20 squares
  const bf = makeBF([caster, near, far]);

  const result = shouldCast(caster, bf);
  assert('shouldCast returns a destination', result !== null);
  if (result) {
    // Toward NEAR enemy (closer): 6 squares toward (6,0) = (6,0)
    // (overshoot check uses > not >=, so caster lands AT enemy x)
    eq('Destination x is 6 (toward near enemy)', result.destination.x, 6);
    eq('Destination y is 0', result.destination.y, 0);
  }
}

// ============================================================
// 4. execute — teleport + slot consumption
// ============================================================

console.log('\n=== 4. execute — teleport + slot consumption ===\n');

{
  // 4a. Caster.pos updated to destination; slot consumed
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.destination, state);

  eq('Caster.pos.x updated to destination', caster.pos.x, plan.destination.x);
  eq('Caster.pos.y updated to destination', caster.pos.y, plan.destination.y);
  eq('Caster.pos.z preserved', caster.pos.z, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. Concentration NOT started (instantaneous spell)
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.destination, state);

  eq('Existing concentration preserved (NOT replaced)', caster.concentration?.spellName, 'Hold Person');
  eq('Concentration still active', caster.concentration?.active, true);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.destination, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Condition_add event emitted (flavor)', condEvents.length === 1);
  assert('Action event mentions "Misty Step"', actionEvents[0].description.includes('Misty Step'));
  assert('Action event mentions "teleports"', actionEvents[0].description.includes('teleport'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/misty_step');
  const caster = makeWizard();
  const prePos = { ...caster.pos };
  const preSlots = caster.resources!.spellSlots![2]!.remaining;
  cleanup(caster);
  eq('Cleanup does NOT change caster pos', caster.pos.x, prePos.x);
  eq('Cleanup does NOT consume slots', caster.resources!.spellSlots![2]!.remaining, preSlots);
  eq('Cleanup does NOT start concentration', caster.concentration, null);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: healthy wizard teleports 30 ft toward enemy
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf);
  assert('shouldCast returns a destination', plan !== null);
  if (plan) {
    eq('Destination is (6,0,0) (toward enemy, 6 squares)', plan.destination.x, 6);
    execute(caster, plan.destination, state);
  }

  eq('Caster teleported to (6,0,0)', caster.pos.x, 6);
  eq('Caster y still 0', caster.pos.y, 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1', { x: 10, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const p1 = shouldCast(caster, bf);
  if (p1) execute(caster, p1.destination, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const p2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', p2 === null);
}

{
  // 7c. Wounded wizard escapes AWAY from enemy
  const caster = makeWizard({ x: 5, y: 5, z: 0 });
  caster.currentHP = 20;     // 20% < 25% → escaping
  const enemy = makeEnemy('e1', { x: 10, y: 10, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf);
  assert('shouldCast returns a destination (escaping)', plan !== null);
  if (plan) {
    execute(caster, plan.destination, state);
    // Escaping: teleport AWAY from enemy → from (5,5) toward (0,0) → clamped
    assert('Escaping destination x ≤ 5 (away from enemy at x=10)', caster.pos.x <= 5);
    assert('Escaping destination y ≤ 5 (away from enemy at y=10)', caster.pos.y <= 5);
    eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
