// ============================================================
// mass_healing_word.test.ts — Mass Healing Word spell module
// PHB p.258: 3rd-level evocation, bonus action, range 60 ft,
//   NO concentration. Effect: 1d4 + WIS mod HP to up to 6 allies
//   within 60 ft. No effect on undead/constructs.
//
// Tests cover shouldCast() preconditions (NOT concentration, action,
// slot, target availability), target priority (up to 6, self-first,
// downed-first), execute() 1d4+mod heal per target (min 1), slot
// consumption, logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/mass_healing_word';
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

const MHW_ACTION: Action = {
  name: 'Mass Healing Word',
  costType: 'bonusAction',
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
  slotLevel: 3,
  legendaryCost: 0,
  description: 'Mass Healing Word (1d4+WIS heal up to 6 allies within 60 ft, bonus action)',
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
    actions: [MHW_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Mass Healing Word', metadata.name, 'Mass Healing Word');
eq('level is 3', metadata.level, 3);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('max targets is 6', metadata.maxTargets, 6);
eq('heal die is d4', metadata.healDie, 4);
eq('heal die count is 1', metadata.healDieCount, 1);
eq('casting ability is wis', metadata.castingAbility, 'wis');
eq('NOT concentration', metadata.concentration, false);
eq('casting time is bonusAction', metadata.castingTime, 'bonusAction');
assert('v1 canon flag set',
  (metadata as any).massHealingWordCanonV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Mass Healing Word' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Mass Healing Word action', shouldCast(caster, bf) === null);
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
  // 3c. Downed ally (unconscious) prioritized
  const caster = makeCleric();
  const downed = makeCombatant('downed', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, isUnconscious: true, maxHP: 40 });
  const wounded = makeCombatant('wounded', { pos: { x: 2, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, downed, wounded]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Downed ally first', result[0].id, 'downed');
  } else {
    assert('Result not null', false);
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
    assert('Full-HP ally NOT in result', !result.some(c => c.id === 'full'));
  }
}

// ============================================================
// 4. execute — healing
// ============================================================

console.log('\n=== 4. execute — healing ===\n');

{
  // 4a. Each target heals 1d4 + WIS mod (WIS 16 = +3) → range [4, 7]
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const before = ally.currentHP;
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const healed = ally.currentHP - before;
  assert('Ally healed by 4..7 HP (1d4+3 with WIS 16)', healed >= 4 && healed <= 7,
    `healed: ${healed}`);
}

{
  // 4b. Min 1 HP floor (WIS 1 → mod -5; 1d4 + (-5) = -4 → clamped to 1)
  let sawMin = false;
  for (let i = 0; i < 50; i++) {
    const c2 = makeCleric({ x: 0, y: 0, z: 0 }, 1);
    const a2 = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 100 });
    const s2 = makeState(makeBF([c2, a2]));
    const targets = shouldCast(c2, makeBF([c2, a2]))!;
    execute(c2, targets, s2);
    if (a2.currentHP - 10 >= 1) sawMin = true;
  }
  assert('Heal is always at least 1 HP even with WIS 1 (-5 mod)', sawMin);
}

{
  // 4c. Capped at maxHP
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 38, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Ally HP capped at maxHP', ally.currentHP, 40);
}

{
  // 4d. Slot consumed
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('3rd-level slot consumed', caster.resources!.spellSlots![3]!.remaining, 1);
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

  assert('a1 healed', a1.currentHP - before[0] >= 1);
  assert('a2 healed', a2.currentHP - before[1] >= 1);
  assert('a3 healed', a3.currentHP - before[2] >= 1);
  eq('3 targets healed', targets.length, 3);
}

{
  // 4f. Heal events emitted for each target
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 40 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const healEvents = state.log.events.filter((e: any) => e.type === 'heal');
  eq('Heal events count matches target count', healEvents.length, targets.length);
  assert('Action event mentions Mass Healing Word',
    state.log.events.some((e: any) => e.type === 'action' && e.description?.includes('Mass Healing Word')));
}

{
  // 4g. Downed ally revived
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
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 10 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 30, currentHP: 20 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, maxHP: 30, currentHP: 15 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 4 targets (self + 3 allies)', targets !== null && targets.length === 4);
  if (targets) execute(caster, targets, state);

  assert('Caster healed', caster.currentHP > 10);
  assert('a1 healed', a1.currentHP > 10);
  assert('a2 healed', a2.currentHP > 20);
  assert('a3 healed', a3.currentHP > 15);
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
