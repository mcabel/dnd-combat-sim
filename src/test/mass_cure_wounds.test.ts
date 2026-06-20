// ============================================================
// mass_cure_wounds.test.ts — Mass Cure Wounds spell module
// PHB p.258: 5th-level evocation, action, range 60 ft, NO concentration.
//   Effect: 3d8 + WIS mod HP to up to 6 allies within 60 ft.
//   No effect on undead/constructs.
//
// Tests cover shouldCast() preconditions (NOT concentration, slot,
// target availability), target priority (up to 6, self-first,
// downed-first), execute() 3d8+mod heal per target, slot consumption,
// logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/mass_cure_wounds';
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
  return { spellSlots: { 5: { max: 2, remaining } } };
}

const MCW_ACTION: Action = {
  name: 'Mass Cure Wounds',
  costType: 'action',
  attackType: null,
  isMultiattack: false,
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  legendaryCost: 0,
  description: 'Mass Cure Wounds (3d8+WIS heal up to 6 allies within 60 ft)',
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
    actions: [MCW_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Mass Cure Wounds', metadata.name, 'Mass Cure Wounds');
eq('level is 5', metadata.level, 5);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('max targets is 6', metadata.maxTargets, 6);
eq('heal die is d8', metadata.healDie, 8);
eq('heal die count is 3', metadata.healDieCount, 3);
eq('casting ability is wis', metadata.castingAbility, 'wis');
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 canon flag set',
  (metadata as any).massCureWoundsCanonV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Mass Cure Wounds' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Mass Cure Wounds action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 5th-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 5th-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No wounded allies
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 40, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no wounded allies', shouldCast(caster, bf) === null);
}

{
  // 2d. NOT concentration — cast allowed while concentrating on another spell
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('NOT concentration: cast allowed while concentrating on another spell', result !== null);
}

{
  // 2e. Out-of-range ally excluded (> 60 ft)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const farAlly = makeCombatant('far', { pos: { x: 13, y: 0, z: 0 }, currentHP: 5, maxHP: 40 }); // 65 ft
  const bf = makeBF([caster, farAlly]);
  assert('Returns null for out-of-range (65 ft) ally', shouldCast(caster, bf) === null);
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
  // 3b. Max 6 targets enforced
  const caster = makeCleric();
  const allies = Array.from({ length: 8 }, (_, i) =>
    makeCombatant(`a${i}`, { pos: { x: i + 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 })
  );
  const bf = makeBF([caster, ...allies]);
  const result = shouldCast(caster, bf);
  assert('Max 6 targets enforced (8 wounded allies → 6 picked)', result !== null && result.length === 6);
}

{
  // 3c. Downed ally prioritized
  const caster = makeCleric();
  const downed = makeCombatant('downed', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, isUnconscious: true, maxHP: 40 });
  const wounded = makeCombatant('wounded', { pos: { x: 2, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, downed, wounded]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Downed ally first', result[0].id, 'downed');
  }
}

{
  // 3d. Full-HP allies excluded
  const caster = makeCleric();
  const wounded = makeCombatant('wounded', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const full    = makeCombatant('full',    { pos: { x: 2, y: 0, z: 0 }, currentHP: 40, maxHP: 40 });
  const bf = makeBF([caster, wounded, full]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Only 1 wounded target (full-HP excluded)', result.length, 1);
    eq('Wounded ally selected', result[0].id, 'wounded');
  }
}

// ============================================================
// 4. execute — healing
// ============================================================

console.log('\n=== 4. execute — healing ===\n');

{
  // 4a. Each target heals 3d8 + WIS mod (WIS 16 = +3) → range [6, 27]
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 200 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const before = ally.currentHP;
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const healed = ally.currentHP - before;
  assert('Ally healed by 6..27 HP (3d8+3 with WIS 16)', healed >= 6 && healed <= 27,
    `healed: ${healed}`);
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

  eq('5th-level slot consumed', caster.resources!.spellSlots![5]!.remaining, 1);
}

{
  // 4d. Multiple targets each roll independently
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 200, currentHP: 1 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 200, currentHP: 1 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, maxHP: 200, currentHP: 1 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);

  const before = [a1.currentHP, a2.currentHP, a3.currentHP];
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('a1 healed', a1.currentHP - before[0] >= 6);
  assert('a2 healed', a2.currentHP - before[1] >= 6);
  assert('a3 healed', a3.currentHP - before[2] >= 6);
  eq('3 targets healed', targets.length, 3);
}

{
  // 4e. Heal events emitted for each target
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const healEvents = state.log.events.filter((e: any) => e.type === 'heal');
  eq('Heal events count matches target count', healEvents.length, targets.length);
  assert('Action event mentions Mass Cure Wounds',
    state.log.events.some((e: any) => e.type === 'action' && e.description?.includes('Mass Cure Wounds')));
}

{
  // 4f. Downed ally revived
  const caster = makeCleric();
  const downed = makeCombatant('downed', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, isUnconscious: true, maxHP: 40 });
  const bf = makeBF([caster, downed]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Downed ally revived (unconscious cleared)', !downed.isUnconscious);
  assert('Downed ally HP > 0', downed.currentHP > 0);
  assert('condition_remove event logged',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.targetId === 'downed'));
}

// ============================================================
// 5. Integration + cleanup
// ============================================================

console.log('\n=== 5. Integration + cleanup ===\n');

{
  // 5a. Full pipeline: cleric + 3 wounded allies
  const caster = makeCleric();
  caster.currentHP = 10; caster.maxHP = 40;
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 10 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 100, currentHP: 20 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, maxHP: 100, currentHP: 15 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 4 targets (self + 3 allies)', targets !== null && targets.length === 4);
  if (targets) execute(caster, targets, state);

  assert('Caster healed', caster.currentHP > 10);
  assert('a1 healed', a1.currentHP > 10);
  assert('a2 healed', a2.currentHP > 20);
  assert('a3 healed', a3.currentHP > 15);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![5]!.remaining, 1);
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

  eq('Slot depleted', caster.resources!.spellSlots![5]!.remaining, 0);
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
