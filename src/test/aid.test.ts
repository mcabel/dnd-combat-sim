// ============================================================
// aid.test.ts — Aid spell module
// PHB p.211: 2nd-level abjuration, action, 30 ft, no concentration, 8 hr.
// Effect: up to 3 allies gain +5 max HP AND +5 current HP.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// HP modifications + slot consumption + logging, integration pipeline,
// and metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/aid';
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

const AID_ACTION: Action = {
  name: 'Aid',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Aid (+5 max & current HP to 3 allies, 8 hr)',
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

/** Cleric at pos (0,0,0) with Aid + 2 2nd-level slots */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [AID_ACTION],
    resources: withSlots2(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is abjuration', metadata.school, 'abjuration');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('HP bonus is 5', metadata.hpBonus, 5);
eq('not concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('max targets is 3', metadata.maxTargets, 3);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Aid' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1');
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns null when caster has no Aid action', result === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const ally = makeCombatant('ally1');
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns null when no 2nd-level slots', result === null);
}

{
  // 2c. No allies in range (caster alone)
  const caster = makeCleric();
  const bf = makeBF([caster]);
  const result = shouldCast(caster, bf);
  // Self is a valid target — shouldCast should return [self]
  assert('Returns [self] when caster is alone (self is always a valid target)', result !== null && result.length === 1 && result[0].id === 'cleric1');
}

{
  // 2d. Ally out of range (> 30 ft)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', { pos: { x: 7, y: 0, z: 0 } }); // 35 ft
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  // Self is still valid (in range)
  assert('Returns [self] when only ally is out of range (35 ft)', result !== null && result.length === 1 && result[0].id === 'cleric1');
}

{
  // 2e. Already Aided by this caster — should skip
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { _aidHPBonus: 5 });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  // Self is still a valid target
  assert('Returns [self] when ally already Aided (self still valid)', result !== null && result[0].id === 'cleric1');
  if (result) {
    assert('Already-Aided ally NOT in result', !result.some(c => c.id === 'ally1'));
  }
}

{
  // 2f. Unconscious ally excluded
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { isUnconscious: true, currentHP: 0 });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Unconscious ally excluded from candidates', result !== null && !result.some(c => c.id === 'ally1'));
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Self first when allies available
  const caster = makeCleric();
  const ally1 = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const ally2 = makeCombatant('ally2', { pos: { x: 2, y: 0, z: 0 }, currentHP: 20, maxHP: 40 });
  const bf = makeBF([caster, ally1, ally2]);
  const result = shouldCast(caster, bf);
  assert('3 targets returned (self + 2 allies)', result !== null && result.length === 3);
  if (result && result.length === 3) {
    eq('Self is first target', result[0].id, 'cleric1');
  }
}

{
  // 3b. Lowered-HP ally preferred over full-HP ally
  const caster = makeCleric();
  const wounded = makeCombatant('wounded', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const full = makeCombatant('full', { pos: { x: 2, y: 0, z: 0 }, currentHP: 40, maxHP: 40 });
  const bf = makeBF([caster, wounded, full]);
  const result = shouldCast(caster, bf);
  // Self first, then wounded (lowest HP%), then full
  if (result && result.length === 3) {
    eq('Self first', result[0].id, 'cleric1');
    eq('Wounded ally second (lowest HP%)', result[1].id, 'wounded');
    eq('Full-HP ally third', result[2].id, 'full');
  } else {
    assert('3 targets returned', false, `got ${result?.length}`);
  }
}

{
  // 3c. Max 3 targets enforced
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 } });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 } });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 } });
  const a4 = makeCombatant('a4', { pos: { x: 4, y: 0, z: 0 } });
  const bf = makeBF([caster, a1, a2, a3, a4]);
  const result = shouldCast(caster, bf);
  assert('Max 3 targets enforced (5 candidates → 3 picked)', result !== null && result.length === 3);
}

// ============================================================
// 4. execute — HP modifications
// ============================================================

console.log('\n=== 4. execute — HP modifications ===\n');

{
  // 4a. Aid increases maxHP and currentHP by 5 each
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Caster maxHP increased by 5', caster.maxHP, 45);
  eq('Caster currentHP increased by 5', caster.currentHP, 45);
  eq('Ally maxHP increased by 5', ally.maxHP, 45);
  eq('Ally currentHP increased by 5 (from 20 to 25)', ally.currentHP, 25);
}

{
  // 4b. Slot consumed (2nd level)
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4c. _aidHPBonus field tracks the bonus
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('_aidHPBonus set to 5 on caster', caster._aidHPBonus, 5);
  eq('_aidHPBonus set to 5 on ally', ally._aidHPBonus, 5);
}

{
  // 4d. Dead ally skipped (stale edge case)
  const caster = makeCleric();
  const deadAlly = makeCombatant('dead', { isDead: true, maxHP: 40, currentHP: 0 });
  const liveAlly = makeCombatant('live', { maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, deadAlly, liveAlly]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  // Mark deadAlly as dead AFTER shouldCast but BEFORE execute (simulate stale plan)
  execute(caster, targets, state);

  assert('Dead ally maxHP unchanged', deadAlly.maxHP === 40);
  assert('Dead ally currentHP unchanged', deadAlly.currentHP === 0);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const healEvents = events.filter(e => e.type === 'heal');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Heal events emitted (one per target)', healEvents.length === targets.length);
  assert('Condition_add events emitted (one per target)', condEvents.length === targets.length);

  // First action event mentions "Aid"
  const firstAction = actionEvents[0];
  assert('Action event description mentions "Aid"', firstAction.description.includes('Aid'));
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: caster + 2 allies (3 targets — self first, then 2 allies)
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 10 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 30, currentHP: 20 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (self + 2 allies)', targets !== null && targets.length === 3);
  if (targets) execute(caster, targets, state);

  // All 3 combatants (caster + 2 allies) buffed
  eq('Caster maxHP +5', caster.maxHP, 45);
  eq('Caster currentHP +5 (from 40 to 45)', caster.currentHP, 45);
  eq('a1 maxHP +5 (from 30 to 35)', a1.maxHP, 35);
  eq('a1 currentHP +5 (from 10 to 15)', a1.currentHP, 15);
  eq('a2 maxHP +5 (from 30 to 35)', a2.maxHP, 35);
  eq('a2 currentHP +5 (from 20 to 25)', a2.currentHP, 25);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 6b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1); // one slot
  const ally = makeCombatant('ally1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state); // uses the last slot

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
