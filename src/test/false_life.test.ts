// ============================================================
// false_life.test.ts — False Life spell module
// PHB p.239: 1st-level necromancy, action, range Self, NO concentration.
//   Effect: 1d4 + 4 temp HP (self-buff for 1 hr).
//
// Tests cover shouldCast() preconditions (action, slot, not-already-active),
// execute() 1d4+4 temp HP application (Math.max, doesn't stack, range
// [5, 8]), slot consumption, logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/false_life';
import { Combatant, Action, PlayerResources } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

const FL_ACTION: Action = {
  name: 'False Life',
  costType: 'action',
  attackType: null,
  isMultiattack: false,
  reach: 5,
  range: { normal: 0, long: 0 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  legendaryCost: 0,
  description: 'False Life (1d4+4 temp HP self-buff)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 30, currentHP: 30, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16,
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

function makeBF(combatants: Combatant[]): any {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  };
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

function makeSorcerer(): Combatant {
  return makeCombatant('sorcerer1', {
    name: 'Sorcerer',
    actions: [FL_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is False Life', metadata.name, 'False Life');
eq('level is 1', metadata.level, 1);
eq('school is necromancy', metadata.school, 'necromancy');
eq('range is 0 ft (Self)', metadata.rangeFt, 0);
eq('temp HP die is d4', metadata.tempHPDie, 4);
eq('temp HP die count is 1', metadata.tempHPDieCount, 1);
eq('temp HP bonus is 4', metadata.tempHPBonus, 4);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 canon flag set',
  (metadata as any).falseLifeCanonV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'False Life' action
  const caster = makeSorcerer();
  caster.actions = [];
  const bf = makeBF([caster]);
  eq('Returns false when caster has no False Life action', shouldCast(caster, bf), false);
}

{
  // 2b. No 1st-level slots
  const caster = makeSorcerer();
  caster.resources = withSlots(0);
  const bf = makeBF([caster]);
  eq('Returns false when no 1st-level slots', shouldCast(caster, bf), false);
}

{
  // 2c. Already False Life-active (re-cast guard)
  const caster = makeSorcerer();
  caster._genericSpellActiveSpells = new Set<string>(['False Life']);
  const bf = makeBF([caster]);
  eq('Returns false when already False Life-active', shouldCast(caster, bf), false);
}

{
  // 2d. Happy path — slots available, not already active
  const caster = makeSorcerer();
  const bf = makeBF([caster]);
  eq('Returns true on happy path (slots + not active)', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — temp HP application
// ============================================================

console.log('\n=== 3. execute — temp HP application ===\n');

{
  // 3a. Sets temp HP to 1d4 + 4 (range [5, 8])
  const caster = makeSorcerer();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Caster tempHP in range [5, 8] (1d4+4)',
    caster.tempHP >= 5 && caster.tempHP <= 8, `tempHP: ${caster.tempHP}`);
}

{
  // 3b. Multiple casts in range [5, 8]
  const allInRange = Array.from({ length: 20 }, () => {
    const c = makeSorcerer();
    const s = makeState(makeBF([c]));
    execute(c, s);
    return c.tempHP >= 5 && c.tempHP <= 8;
  }).every(Boolean);
  assert('All 20 casts produce temp HP in [5, 8]', allInRange);
}

{
  // 3c. Slot consumed
  const caster = makeSorcerer();
  caster.resources = withSlots(2);
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('1st-level slot consumed', caster.resources!.spellSlots![1]!.remaining, 1);
}

{
  // 3d. Does NOT stack with existing higher temp HP (Math.max rule)
  const caster = makeSorcerer();
  caster.tempHP = 10; // existing 10 temp HP
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Temp HP does NOT stack: Math.max(10, roll) = 10', caster.tempHP, 10);
}

{
  // 3e. Overwrites lower existing temp HP
  const caster = makeSorcerer();
  caster.tempHP = 2; // existing 2 temp HP (less than min roll 5)
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Lower existing temp HP overwritten: Math.max(2, roll) ≥ 5',
    caster.tempHP >= 5 && caster.tempHP <= 8);
}

{
  // 3f. Marks _genericSpellActiveSpells (so shouldCast gates re-cast)
  const caster = makeSorcerer();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Active-spell marker set',
    caster._genericSpellActiveSpells?.has('False Life') === true);
}

{
  // 3g. 'action' cast event logged
  const caster = makeSorcerer();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const actionEv = state.log.events.find((e: any) => e.type === 'action' && e.actorId === 'sorcerer1');
  assert('Action event logged', !!actionEv);
  assert('Action event mentions False Life',
    actionEv?.description?.includes('False Life'));
}

{
  // 3h. 'condition_add' buff event logged
  const caster = makeSorcerer();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const condEv = state.log.events.find((e: any) => e.type === 'condition_add' && e.actorId === 'sorcerer1');
  assert('condition_add event logged', !!condEv);
  assert('condition_add event mentions temp HP',
    condEv?.description?.includes('temp HP'));
}

{
  // 3i. Caster real HP unchanged (temp HP is separate)
  const caster = makeSorcerer();
  caster.currentHP = 15; caster.maxHP = 30;
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Caster current HP unchanged (temp HP separate)', caster.currentHP, 15);
}

// ============================================================
// 4. Integration + cleanup
// ============================================================

console.log('\n=== 4. Integration + cleanup ===\n');

{
  // 4a. Full pipeline: shouldCast → execute applies 1d4+4 temp HP
  const caster = makeSorcerer();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const decision = shouldCast(caster, bf);
  eq('shouldCast returns true', decision, true);
  if (decision) execute(caster, state);

  assert('Caster tempHP in [5, 8]', caster.tempHP >= 5 && caster.tempHP <= 8);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![1]!.remaining, 1);
  assert('Active-spell marker set',
    caster._genericSpellActiveSpells?.has('False Life') === true);
}

{
  // 4b. After slots exhausted, shouldCast returns false
  const caster = makeSorcerer();
  caster.resources = withSlots(1);
  const bf = makeBF([caster]);
  const state = makeState(bf);

  if (shouldCast(caster, bf)) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![1]!.remaining, 0);
  eq('shouldCast returns false after slots exhausted', shouldCast(caster, bf), false);
}

{
  // 4c. After active-marker set, shouldCast returns false (re-cast guard)
  const caster = makeSorcerer();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  if (shouldCast(caster, bf)) execute(caster, state);
  eq('shouldCast returns false after buff active', shouldCast(caster, bf), false);
  eq('Slot not double-consumed', caster.resources!.spellSlots![1]!.remaining, 1);
}

{
  // 4d. cleanup is a no-op (does not throw, does not clear temp HP)
  const caster = makeSorcerer();
  caster.tempHP = 7;
  caster._genericSpellActiveSpells = new Set<string>(['False Life']);
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('cleanup is a no-op (does not throw)', !threw);
  eq('cleanup does not clear temp HP', caster.tempHP, 7);
  assert('cleanup does not clear active-spell marker',
    caster._genericSpellActiveSpells?.has('False Life') === true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
