// ============================================================
// mass_heal.test.ts — Mass Heal spell module
// PHB p.257: 9th-level evocation, action, range 60 ft, NO concentration.
//   Effect: 700 HP pool split among wounded allies within 60 ft.
//
// Tests cover shouldCast() preconditions (NOT concentration, slot,
// target availability), target priority (up to 10, self-first,
// downed-first), execute() 700 HP pool split algorithm, slot
// consumption, logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/mass_heal';
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
  return { spellSlots: { 9: { max: 2, remaining } } };
}

const MH_ACTION: Action = {
  name: 'Mass Heal',
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
  slotLevel: 9,
  legendaryCost: 0,
  description: 'Mass Heal (700 HP pool split among wounded allies within 60 ft)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 200, currentHP: 200, ac: 12, speed: 30,
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
    actions: [MH_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Mass Heal', metadata.name, 'Mass Heal');
eq('level is 9', metadata.level, 9);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('heal pool is 700 HP', metadata.healPool, 700);
eq('max targets is 10 (v1 cap)', metadata.maxTargets, 10);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 split algorithm flag set',
  (metadata as any).massHealSplitV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Mass Heal' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 200 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Mass Heal action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 9th-level slots
  const caster = makeCleric();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 200 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 9th-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No wounded ally
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 200, maxHP: 200 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no wounded allies', shouldCast(caster, bf) === null);
}

{
  // 2d. NOT concentration — cast allowed while concentrating on another spell
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 200 });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('NOT concentration: cast allowed while concentrating on another spell', result !== null);
}

{
  // 2e. Out-of-range ally excluded (> 60 ft)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const farAlly = makeCombatant('far', { pos: { x: 13, y: 0, z: 0 }, currentHP: 5, maxHP: 200 }); // 65 ft
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
  caster.currentHP = 50; caster.maxHP = 200;
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 200 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, currentHP: 20, maxHP: 200 });
  const bf = makeBF([caster, a1, a2]);
  const result = shouldCast(caster, bf);
  assert('3 targets returned (self + 2 allies)', result !== null && result.length === 3);
  if (result && result.length === 3) {
    eq('Self is first target', result[0].id, 'cleric1');
  }
}

{
  // 3b. Max 10 targets enforced
  const caster = makeCleric();
  const allies = Array.from({ length: 12 }, (_, i) =>
    makeCombatant(`a${i}`, { pos: { x: i + 1, y: 0, z: 0 }, currentHP: 10, maxHP: 200 })
  );
  const bf = makeBF([caster, ...allies]);
  const result = shouldCast(caster, bf);
  assert('Max 10 targets enforced (12 wounded allies → 10 picked)', result !== null && result.length === 10);
}

{
  // 3c. Downed ally prioritized
  const caster = makeCleric();
  const downed = makeCombatant('downed', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, isUnconscious: true, maxHP: 200 });
  const wounded = makeCombatant('wounded', { pos: { x: 2, y: 0, z: 0 }, currentHP: 5, maxHP: 200 });
  const bf = makeBF([caster, downed, wounded]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Downed ally first', result[0].id, 'downed');
  }
}

{
  // 3d. Full-HP allies excluded
  const caster = makeCleric();
  const wounded = makeCombatant('wounded', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 200 });
  const full    = makeCombatant('full',    { pos: { x: 2, y: 0, z: 0 }, currentHP: 200, maxHP: 200 });
  const bf = makeBF([caster, wounded, full]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Only 1 wounded target (full-HP excluded)', result.length, 1);
    eq('Wounded ally selected', result[0].id, 'wounded');
  }
}

// ============================================================
// 4. execute — pool split
// ============================================================

console.log('\n=== 4. execute — pool split ===\n');

{
  // 4a. Single ally gets all 700 HP (capped at deficit)
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 1000 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // Single ally: base = floor(700/1) = 700, capped at deficit (1000-5=995)
  eq('Single ally gets full 700 HP', ally.currentHP, 705);
}

{
  // 4b. Multiple allies share pool — equal base share
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // 2 allies, each gets base share floor(700/2) = 350
  eq('a1 healed 350 HP', a1.currentHP, 350);
  eq('a2 healed 350 HP', a2.currentHP, 350);
}

{
  // 4c. Total HP restored cannot exceed 700 (pool cap)
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const totalHealed = a1.currentHP + a2.currentHP + a3.currentHP;
  eq('Total HP restored across all allies is 700 (pool cap)', totalHealed, 700);
}

{
  // 4d. Pool distributed — remainder goes to most-wounded
  // 700 / 3 = 233 remainder 1 → most-wounded gets the extra 1 HP
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 }); // most wounded (deficit 1000)
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, currentHP: 0, maxHP: 1000 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // Base share: 233 each. Remainder: 1. Most-wounded (a1 is first-found) gets +1.
  // Total: 233+1 + 233 + 233 = 700
  const total = a1.currentHP + a2.currentHP + a3.currentHP;
  eq('Total = 700 (remainder distributed)', total, 700);
  assert('At least one ally got 234 (remainder)', a1.currentHP === 234 || a2.currentHP === 234 || a3.currentHP === 234);
}

{
  // 4e. Slot consumed
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 1000 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('9th-level slot consumed', caster.resources!.spellSlots![9]!.remaining, 1);
}

{
  // 4f. Heal events emitted
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 1000 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const healEvents = state.log.events.filter((e: any) => e.type === 'heal');
  assert('At least 1 heal event emitted', healEvents.length >= 1);
  assert('Action event mentions Mass Heal',
    state.log.events.some((e: any) => e.type === 'action' && e.description?.includes('Mass Heal')));
}

{
  // 4g. Downed ally revived
  const caster = makeCleric();
  const downed = makeCombatant('downed', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, isUnconscious: true, maxHP: 1000 });
  const bf = makeBF([caster, downed]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  assert('Downed ally revived (unconscious cleared)', !downed.isUnconscious);
  assert('Downed ally HP > 0', downed.currentHP > 0);
  assert('condition_remove event logged',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.targetId === 'downed'));
}

{
  // 4h. Pool not wasted on full-HP allies
  const caster = makeCleric();
  const wounded = makeCombatant('wounded', { pos: { x: 1, y: 0, z: 0 }, currentHP: 0, maxHP: 500 });
  const full = makeCombatant('full', { pos: { x: 2, y: 0, z: 0 }, currentHP: 1000, maxHP: 1000 });
  const bf = makeBF([caster, wounded, full]);
  const state = makeState(bf);

  // Manually craft targets to include the full-HP ally (shouldCast would exclude them)
  execute(caster, [wounded, full], state);

  // Full ally should NOT be healed (no deficit)
  eq('Full-HP ally unchanged', full.currentHP, 1000);
  // Wounded ally gets min(700/2=350, deficit=500) = 350 from base, plus remainder from full ally
  // Base share: 350 each. Wounded heals 350. Full gets 0 (no deficit). Remainder = 700-350-0 = 350.
  // Remainder distributed 1 HP at a time to most-wounded = wounded.
  // So wounded gets 350 + 350 = 700 (capped at deficit 500).
  eq('Wounded ally healed up to deficit', wounded.currentHP, 500);
}

// ============================================================
// 5. Integration + cleanup
// ============================================================

console.log('\n=== 5. Integration + cleanup ===\n');

{
  // 5a. Full pipeline: cleric + 2 wounded allies
  const caster = makeCleric();
  caster.currentHP = 100; caster.maxHP = 200; // deficit 100
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 200, currentHP: 0 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 200, currentHP: 0 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (self + 2 allies)', targets !== null && targets.length === 3);
  if (targets) execute(caster, targets, state);

  // All 3 healers have deficits > 700/3=233, so each gets exactly 233 (with remainder going to most-wounded)
  // Caster deficit 100 < 233 → caster heals 100, remainder redistributes
  const totalHealed = (caster.currentHP - 100) + a1.currentHP + a2.currentHP;
  assert('Total HP restored <= 700 (pool cap)', totalHealed <= 700);
  assert('Caster healed', caster.currentHP > 100);
  assert('a1 healed', a1.currentHP > 0);
  assert('a2 healed', a2.currentHP > 0);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![9]!.remaining, 1);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots(1);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 1000 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![9]!.remaining, 0);
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
