// ============================================================
// armor_of_agathys.test.ts — Armor of Agathys spell module
// PHB p.215: 1st-level abjuration, action, range Self, NO concentration.
//   Effect: +5 temp HP. Retaliation (5 cold to melee attackers) NOT
//   modelled in v1.
//
// Tests cover shouldCast() preconditions (action, slot, not-already-active),
// execute() temp HP application (Math.max, doesn't stack), slot
// consumption, logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/armor_of_agathys';
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

const AOA_ACTION: Action = {
  name: 'Armor of Agathys',
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
  description: 'Armor of Agathys (+5 temp HP self-buff)',
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

function makeWarlock(): Combatant {
  return makeCombatant('warlock1', {
    name: 'Warlock',
    actions: [AOA_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Armor of Agathys', metadata.name, 'Armor of Agathys');
eq('level is 1', metadata.level, 1);
eq('school is abjuration', metadata.school, 'abjuration');
eq('range is 0 ft (Self)', metadata.rangeFt, 0);
eq('temp HP is 5', metadata.tempHP, 5);
eq('retaliation damage is 5', metadata.retaliationDamage, 5);
eq('retaliation type is cold', metadata.retaliationType, 'cold');
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 retaliation NOT modelled flag set',
  (metadata as any).armorOfAgathysRetaliationV1NotModelled === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Armor of Agathys' action
  const caster = makeWarlock();
  caster.actions = [];
  const bf = makeBF([caster]);
  eq('Returns false when caster has no Armor of Agathys action', shouldCast(caster, bf), false);
}

{
  // 2b. No 1st-level slots
  const caster = makeWarlock();
  caster.resources = withSlots(0);
  const bf = makeBF([caster]);
  eq('Returns false when no 1st-level slots', shouldCast(caster, bf), false);
}

{
  // 2c. Already Armor of Agathys-active (re-cast guard)
  const caster = makeWarlock();
  caster._genericSpellActiveSpells = new Set<string>(['Armor of Agathys']);
  const bf = makeBF([caster]);
  eq('Returns false when already Armor of Agathys-active', shouldCast(caster, bf), false);
}

{
  // 2d. Happy path — slots available, not already active
  const caster = makeWarlock();
  const bf = makeBF([caster]);
  eq('Returns true on happy path (slots + not active)', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — temp HP application
// ============================================================

console.log('\n=== 3. execute — temp HP application ===\n');

{
  // 3a. Sets temp HP to 5 when starting at 0
  const caster = makeWarlock();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Caster tempHP set to 5', caster.tempHP, 5);
}

{
  // 3b. Slot consumed
  const caster = makeWarlock();
  caster.resources = withSlots(2);
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('1st-level slot consumed', caster.resources!.spellSlots![1]!.remaining, 1);
}

{
  // 3c. Does NOT stack with existing higher temp HP (Math.max rule)
  const caster = makeWarlock();
  caster.tempHP = 10; // existing 10 temp HP
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Temp HP does NOT stack: Math.max(10, 5) = 10', caster.tempHP, 10);
}

{
  // 3d. Overwrites lower existing temp HP
  const caster = makeWarlock();
  caster.tempHP = 3; // existing 3 temp HP
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Lower existing temp HP overwritten: Math.max(3, 5) = 5', caster.tempHP, 5);
}

{
  // 3e. Marks _genericSpellActiveSpells (so shouldCast gates re-cast)
  const caster = makeWarlock();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Active-spell marker set',
    caster._genericSpellActiveSpells?.has('Armor of Agathys') === true);
}

{
  // 3f. 'action' cast event logged
  const caster = makeWarlock();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const actionEv = state.log.events.find((e: any) => e.type === 'action' && e.actorId === 'warlock1');
  assert('Action event logged', !!actionEv);
  assert('Action event mentions Armor of Agathys',
    actionEv?.description?.includes('Armor of Agathys'));
}

{
  // 3g. 'condition_add' buff event logged
  const caster = makeWarlock();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const condEv = state.log.events.find((e: any) => e.type === 'condition_add' && e.actorId === 'warlock1');
  assert('condition_add event logged', !!condEv);
  assert('condition_add event mentions temp HP',
    condEv?.description?.includes('temp HP'));
}

{
  // 3h. Caster real HP unchanged (temp HP is separate)
  const caster = makeWarlock();
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
  // 4a. Full pipeline: shouldCast → execute applies +5 temp HP
  const caster = makeWarlock();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const decision = shouldCast(caster, bf);
  eq('shouldCast returns true', decision, true);
  if (decision) execute(caster, state);

  eq('Caster tempHP = 5', caster.tempHP, 5);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![1]!.remaining, 1);
  eq('Active-spell marker set',
    caster._genericSpellActiveSpells?.has('Armor of Agathys') ? true : false, true);
}

{
  // 4b. After slots exhausted, shouldCast returns false
  const caster = makeWarlock();
  caster.resources = withSlots(1);
  const bf = makeBF([caster]);
  const state = makeState(bf);

  if (shouldCast(caster, bf)) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![1]!.remaining, 0);
  eq('shouldCast returns false after slots exhausted', shouldCast(caster, bf), false);
}

{
  // 4c. After active-marker set, shouldCast returns false (re-cast guard)
  const caster = makeWarlock();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  if (shouldCast(caster, bf)) execute(caster, state);
  // After execute, the marker is set — shouldCast should now return false
  eq('shouldCast returns false after buff active', shouldCast(caster, bf), false);
  // Slot should NOT be consumed again
  const slotsAfterFirst = caster.resources!.spellSlots![1]!.remaining;
  // (don't call execute again — shouldCast already gated it)
  eq('Slot not double-consumed', slotsAfterFirst, 1);
}

{
  // 4d. cleanup is a no-op (does not throw, does not clear temp HP)
  const caster = makeWarlock();
  caster.tempHP = 5;
  caster._genericSpellActiveSpells = new Set<string>(['Armor of Agathys']);
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('cleanup is a no-op (does not throw)', !threw);
  eq('cleanup does not clear temp HP', caster.tempHP, 5);
  assert('cleanup does not clear active-spell marker',
    caster._genericSpellActiveSpells?.has('Armor of Agathys') === true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
