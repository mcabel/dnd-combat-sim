// ============================================================
// calm_emotions.test.ts — Calm Emotions spell module
// PHB p.221: 2nd-level enchantment, action, 60 ft, concentration 1 min.
// v1 Effect: removes charmed/frightened from allies (allies voluntarily
//            fail the CHA save).
//
// Tests cover shouldCast() preconditions + target selection, execute()
// condition removal + slot consumption + logging, integration pipeline,
// and metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/calm_emotions';
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

const CALM_ACTION: Action = {
  name: 'Calm Emotions',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Calm Emotions (suppress charm/frighten on allies, concentration 1 min)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
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
    width: 20, height: 20, depth: 1,
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

/** Cleric at pos (0,0,0) with Calm Emotions + 2 2nd-level slots */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [CALM_ACTION],
    resources: withSlots2(2),
  });
}

function makeAlly(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, pos, ...overrides });
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is enchantment', metadata.school, 'enchantment');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('save ability is cha', metadata.saveAbility, 'cha');
eq('casting time is action', metadata.castingTime, 'action');
eq('indifference mode NOT implemented (v1)', metadata.calmEmotionsIndifferenceModeV1Implemented, false);
eq('enemy targeting NOT implemented (v1)', metadata.calmEmotionsEnemyTargetingV1Implemented, false);
eq('condition restoration NOT implemented (v1)', metadata.calmEmotionsConditionRestorationV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Calm Emotions' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Calm Emotions action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No charmed/frightened allies → returns null
  const caster = makeCleric();
  const ally = makeAlly('a1');  // no conditions
  const bf = makeBF([caster, ally]);
  assert('Returns null when no allies are charmed/frightened', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy with charmed doesn't count (v1: allies only)
  const caster = makeCleric();
  const enemy = makeEnemy('e1');
  enemy.conditions.add('charmed');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when only enemies are charmed (v1: allies only)', shouldCast(caster, bf) === null);
}

{
  // 2f. Ally out of range (> 60 ft) → excluded
  const caster = makeCleric();
  const farAlly = makeAlly('far', { x: 15, y: 0, z: 0 });  // 75 ft
  farAlly.conditions.add('charmed');
  const bf = makeBF([caster, farAlly]);
  assert('Returns null when charmed ally is out of range (75 ft)', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target selection
// ============================================================

console.log('\n=== 3. shouldCast — target selection ===\n');

{
  // 3a. Charmed ally in range → returned
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Charmed ally returned', result !== null && result.length === 1 && result[0].id === 'a1');
}

{
  // 3b. Frightened ally in range → returned
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('frightened');
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Frightened ally returned', result !== null && result.length === 1 && result[0].id === 'a1');
}

{
  // 3c. Multiple affected allies → all returned
  const caster = makeCleric();
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  a1.conditions.add('charmed');
  const a2 = makeAlly('a2', { x: 2, y: 0, z: 0 });
  a2.conditions.add('frightened');
  const a3 = makeAlly('a3', { x: 3, y: 0, z: 0 });  // no conditions
  const bf = makeBF([caster, a1, a2, a3]);
  const result = shouldCast(caster, bf);
  assert('2 affected allies returned (a3 excluded)', result !== null && result.length === 2);
  if (result) {
    assert('a1 in result', result.some(c => c.id === 'a1'));
    assert('a2 in result', result.some(c => c.id === 'a2'));
    assert('a3 NOT in result', !result.some(c => c.id === 'a3'));
  }
}

// ============================================================
// 4. execute — condition removal
// ============================================================

console.log('\n=== 4. execute — condition removal ===\n');

{
  // 4a. Charmed condition removed
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Charmed removed from ally', !ally.conditions.has('charmed'));
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. Frightened condition removed
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('frightened');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Frightened removed from ally', !ally.conditions.has('frightened'));
}

{
  // 4c. Both charmed and frightened removed
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  ally.conditions.add('frightened');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Charmed removed', !ally.conditions.has('charmed'));
  assert('Frightened removed', !ally.conditions.has('frightened'));
}

{
  // 4d. Other conditions NOT removed (e.g. poisoned)
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  ally.conditions.add('poisoned');  // should NOT be removed
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Charmed removed', !ally.conditions.has('charmed'));
  assert('Poisoned NOT removed (Calm Emotions only suppresses charm/frighten)', ally.conditions.has('poisoned'));
}

{
  // 4e. Concentration started on caster
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Calm Emotions', caster.concentration?.spellName, 'Calm Emotions');
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condRemoveEvents = events.filter(e => e.type === 'condition_remove');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Condition_remove event emitted', condRemoveEvents.length >= 1);
  assert('Action event mentions "Calm Emotions"', actionEvents[0].description.includes('Calm Emotions'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/calm_emotions');
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Calm Emotions', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster removes charm from 2 allies
  const caster = makeCleric();
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  a1.conditions.add('charmed');
  const a2 = makeAlly('a2', { x: 2, y: 0, z: 0 });
  a2.conditions.add('frightened');
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 2 targets', targets !== null && targets.length === 2);
  if (targets) execute(caster, targets, state);

  assert('a1 charmed removed', !a1.conditions.has('charmed'));
  assert('a2 frightened removed', !a2.conditions.has('frightened'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Calm Emotions', caster.concentration?.spellName, 'Calm Emotions');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const ally = makeAlly('a1');
  ally.conditions.add('charmed');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
