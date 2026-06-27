// ============================================================
// aura_of_vitality.test.ts — Aura of Vitality spell module
// PHB p.216: 3rd-level evocation, bonus action, range Self (30-ft aura),
//   concentration, duration 1 min.
// Canon: bonus action each turn heals 1 ally in aura for 2d6 HP.
// v1 SIMPLIFICATION: on cast, heal up to 3 most-wounded allies within
//   30 ft for 2d6 HP each. Per-turn re-heal NOT modelled.
//
// Tests cover shouldCast() preconditions (concentration gate), target
// priority (up to 3 wounded allies, self-first), execute() concentration
// start, per-target 2d6 heal, slot consumption, logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/aura_of_vitality';
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

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const AOV_ACTION: Action = {
  name: 'Aura of Vitality',
  costType: 'bonusAction',
  attackType: null,
  isMultiattack: false,
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 3,
  legendaryCost: 0,
  description: 'Aura of Vitality (30-ft aura, 2d6 heal/turn, concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
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

function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }, wis = 16): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    wis,
    actions: [AOV_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Aura of Vitality', metadata.name, 'Aura of Vitality');
eq('level is 3', metadata.level, 3);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 30 ft (aura radius)', metadata.rangeFt, 30);
eq('max targets is 3', metadata.maxTargets, 3);
eq('heal die is d6', metadata.healDie, 6);
eq('heal die count is 2', metadata.healDieCount, 2);
eq('IS concentration', metadata.concentration, true);
eq('casting time is bonusAction', metadata.castingTime, 'bonusAction');
assert('v1 per-turn reheal simplified flag is NOW false (Session 89)',
  (metadata as any).auraOfVitalityPerTurnRehealV1Simplified === false);
assert('v1 per-turn reheal implemented flag is true (Session 89)',
  (metadata as any).auraOfVitalityPerTurnRehealV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Aura of Vitality' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Aura of Vitality action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 3rd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 3rd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No wounded allies
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 40, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no wounded allies', shouldCast(caster, bf) === null);
}

{
  // 2d. Already concentrating on another spell
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2e. Out-of-range ally excluded (> 30 ft)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const farAlly = makeCombatant('far', { pos: { x: 7, y: 0, z: 0 }, currentHP: 5, maxHP: 40 }); // 35 ft
  const bf = makeBF([caster, farAlly]);
  assert('Returns null for out-of-range (35 ft) ally', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target selection
// ============================================================

console.log('\n=== 3. shouldCast — target selection ===\n');

{
  // 3a. Self first when caster is wounded
  const caster = makeCleric();
  caster.currentHP = 5; caster.maxHP = 40;
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, currentHP: 20, maxHP: 40 });
  const bf = makeBF([caster, a1, a2]);
  const result = shouldCast(caster, bf);
  assert('3 targets returned (self + 2 allies)', result !== null && result.length === 3);
  if (result && result.length === 3) {
    eq('Self is first target', result[0].id, 'cleric1');
  }
}

{
  // 3b. Max 3 targets enforced
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, currentHP: 15, maxHP: 40 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, currentHP: 20, maxHP: 40 });
  const a4 = makeCombatant('a4', { pos: { x: 4, y: 0, z: 0 }, currentHP: 25, maxHP: 40 });
  const bf = makeBF([caster, a1, a2, a3, a4]);
  const result = shouldCast(caster, bf);
  assert('Max 3 targets enforced (4 wounded allies → 3 picked)', result !== null && result.length === 3);
}

{
  // 3c. Full-HP allies excluded
  const caster = makeCleric();
  const wounded = makeCombatant('wounded', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const full    = makeCombatant('full',    { pos: { x: 2, y: 0, z: 0 }, currentHP: 40, maxHP: 40 });
  const bf = makeBF([caster, wounded, full]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Only 1 wounded target (full-HP excluded)', result.length, 1);
    eq('Wounded ally selected', result[0].id, 'wounded');
  } else {
    assert('Result not null', false);
  }
}

{
  // 3d. Returns just 1 ally if only 1 wounded
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, a1]);
  const result = shouldCast(caster, bf);
  assert('Single wounded ally returned as length-1 array', result !== null && result.length === 1);
}

// ============================================================
// 4. execute — healing + concentration
// ============================================================

console.log('\n=== 4. execute — healing + concentration ===\n');

{
  // 4a. Each target heals 2d6 (range 2..12)
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const healed = ally.currentHP - 5;
  assert('Ally healed by 2..12 HP', healed >= 2 && healed <= 12, `healed: ${healed}`);
}

{
  // 4b. Capped at maxHP
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 38, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Ally HP capped at maxHP', ally.currentHP, 40);
}

{
  // 4c. Slot consumed
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('3rd-level slot consumed', caster.resources!.spellSlots![3]!.remaining, 1);
}

{
  // 4d. Concentration started on 'Aura of Vitality'
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Concentration is active', caster.concentration?.active === true);
  eq('Concentrating on Aura of Vitality', caster.concentration?.spellName, 'Aura of Vitality');
}

{
  // 4e. Multiple targets each roll independently
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 1 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 100, currentHP: 1 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, maxHP: 100, currentHP: 1 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);

  const before = [a1.currentHP, a2.currentHP, a3.currentHP];
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('a1 healed', a1.currentHP - before[0] >= 2);
  assert('a2 healed', a2.currentHP - before[1] >= 2);
  assert('a3 healed', a3.currentHP - before[2] >= 2);
  eq('3 targets healed', targets.length, 3);
}

{
  // 4f. 'action' cast event + 'condition_add' concentration event logged
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const actionEv = state.log.events.find((e: any) => e.type === 'action' && e.actorId === 'cleric1');
  assert('Action event logged', !!actionEv);
  assert('Action event mentions Aura of Vitality',
    actionEv?.description?.includes('Aura of Vitality'));
  const condEv = state.log.events.find((e: any) => e.type === 'condition_add' && e.actorId === 'cleric1');
  assert('condition_add event logged for concentration', !!condEv);
}

{
  // 4g. Heal events emitted for each target
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const healEvents = state.log.events.filter((e: any) => e.type === 'heal');
  eq('Heal events count matches target count', healEvents.length, targets.length);
}

// ============================================================
// 5. Integration + cleanup
// ============================================================

console.log('\n=== 5. Integration + cleanup ===\n');

{
  // 5a. Full pipeline: cleric + 2 wounded allies → 3 targets (self if wounded)
  const caster = makeCleric();
  caster.currentHP = 10; caster.maxHP = 40;
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 10 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 30, currentHP: 20 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (self + 2 allies)', targets !== null && targets.length === 3);
  if (targets) execute(caster, targets, state);

  assert('Caster healed', caster.currentHP > 10);
  assert('a1 healed', a1.currentHP > 10);
  assert('a2 healed', a2.currentHP > 20);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![3]!.remaining, 1);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots(1);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![3]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 5c. cleanup is a no-op (does not throw)
  const caster = makeCleric();
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('cleanup is a no-op (does not throw)', !threw);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
