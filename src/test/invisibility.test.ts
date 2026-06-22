// ============================================================
// invisibility.test.ts — Invisibility spell module
// PHB p.254: 2nd-level illusion, action, range Touch (5 ft),
// concentration (1 hr). Components: V, S, M.
//
// Effect: A creature you touch becomes invisible until the spell ends.
// Anything the target is wearing or carrying is invisible as long as
// it is on the target's person. The spell ends for a target that
// attacks or casts a spell (NOT modelled in v1).
//
// Tests cover shouldCast() preconditions + target priority (self first,
// lowest-HP% ally, skip already-invisible), execute() condition
// application + effect attachment (sourceIsConcentration: true) +
// slot consumption + concentration started + logging, integration
// pipeline, and metadata shape.
// ============================================================

import { shouldCast, execute, metadata, shouldCastSingle, executeSingle } from '../spells/invisibility';
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

const INVIS_ACTION: Action = {
  name: 'Invisibility',
  isMultiattack: false,
  attackType: null,
  reach: 5,                  // touch
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Invisibility (touch, target becomes invisible, concentration 1 hr)',
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

/** Wizard with Invisibility + 2 2nd-level slots, NOT concentrating */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [INVIS_ACTION],
    resources: withSlots2(2),
  });
}

function makeAlly(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'party', pos, ...overrides });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Invisibility', metadata.name, 'Invisibility');
eq('level is 2', metadata.level, 2);
eq('school is illusion', metadata.school, 'illusion');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
// Session 32: ends-on-attack NOW IMPLEMENTED (flag flipped from false to true)
eq('ends-on-attack NOW implemented (Session 32)', metadata.invisibilityEndsOnAttackV1Implemented, true);
eq('upcast NOW implemented (Session 35)', metadata.invisibilityUpcastV1Implemented, true);
eq('concentration enforcement NOW implemented (Session 34 TG-002)', metadata.invisibilityConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Invisibility' action
  const caster = makeWizard();
  caster.actions = [];
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Invisibility action', shouldCastSingle(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 2nd-level slots', shouldCastSingle(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating on another spell
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster is already concentrating', shouldCastSingle(caster, bf) === null);
}

{
  // 2d. Caster already invisible AND no other valid allies → null
  // (caster is excluded from candidates; no ally within 5 ft)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  // No allies in range at all
  const farAlly = makeAlly('far', { x: 10, y: 0, z: 0 });   // 50 ft > 5 ft touch range
  const bf = makeBF([caster, farAlly]);
  assert('Returns null when caster already invisible and no allies in touch range',
    shouldCastSingle(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Self first (caster is always within touch range)
  const caster = makeWizard();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { currentHP: 10 });  // low HP ally
  const bf = makeBF([caster, ally]);
  eq('Caster targets self first (even over low-HP ally)', shouldCastSingle(caster, bf)?.id, 'wizard1');
}

{
  // 3b. When caster is invisible, lowest-HP% ally within touch range wins
  const caster = makeWizard();
  caster.conditions.add('invisible');   // caster excluded from candidates
  const healthy = makeAlly('healthy', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });  // 100%
  const wounded = makeAlly('wounded', { x: 0, y: 1, z: 0 }, { maxHP: 100, currentHP: 25 });   // 25%
  const bf = makeBF([caster, healthy, wounded]);
  eq('Lowest-HP% ally selected when caster excluded', shouldCastSingle(caster, bf)?.id, 'wounded');
}

{
  // 3c. Skip ally already invisible
  const caster = makeWizard();
  caster.conditions.add('invisible');   // caster excluded
  const invAlly = makeAlly('inv', { x: 1, y: 0, z: 0 }, { currentHP: 10 });
  invAlly.conditions.add('invisible');  // already invisible — skip
  const visAlly = makeAlly('vis', { x: 0, y: 1, z: 0 }, { currentHP: 50 });
  const bf = makeBF([caster, invAlly, visAlly]);
  eq('Skips already-invisible ally (targets visible one)', shouldCastSingle(caster, bf)?.id, 'vis');
}

{
  // 3d. Skip ally already Invisibility'd by this caster
  const caster = makeWizard();
  caster.conditions.add('invisible');
  const invEffAlly = makeAlly('inveff', { x: 1, y: 0, z: 0 }, { currentHP: 10 });
  invEffAlly.activeEffects.push({
    id: 'eff_inv', casterId: caster.id, spellName: 'Invisibility',
    effectType: 'invisible', payload: {},
    sourceIsConcentration: true,
  });
  const freshAlly = makeAlly('fresh', { x: 0, y: 1, z: 0 }, { currentHP: 50 });
  const bf = makeBF([caster, invEffAlly, freshAlly]);
  eq('Skips ally already Invisibility\'d by this caster', shouldCastSingle(caster, bf)?.id, 'fresh');
}

// ============================================================
// 4. execute — condition application + effect + slot + concentration
// ============================================================

console.log('\n=== 4. execute — condition application + effect + slot + concentration ===\n');

{
  // 4a. invisible condition applied; effect attached with sourceIsConcentration: true
  // (caster marked invisible-without-concentration so shouldCast picks the ally)
  const caster = makeWizard();
  caster.conditions.add('invisible');   // caster excluded from candidates
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCastSingle(caster, bf)!;
  eq('shouldCast returns the ally (caster already invisible)', target.id, 'a1');
  executeSingle(caster, target, state);

  assert('invisible condition applied to target', ally.conditions.has('invisible'));
  const invEff = ally.activeEffects.find(e =>
    e.effectType === 'invisible'
  );
  assert('Active effect attached (invisible)', invEff !== undefined);
  if (invEff) {
    eq('Effect sourceIsConcentration is true', invEff.sourceIsConcentration, true);
    eq('Effect spellName is Invisibility', invEff.spellName, 'Invisibility');
    eq('Effect casterId is caster', invEff.casterId, caster.id);
  }
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. Concentration started on caster
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  // Force-execute on ally (caster would normally target self)
  executeSingle(caster, ally, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Invisibility', caster.concentration?.spellName, 'Invisibility');
}

{
  // 4c. Existing concentration broken (safety net)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  // Add an effect from prior concentration on ally
  const ally = makeAlly('a1');
  ally.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executeSingle(caster, ally, state);

  eq('Concentration switched to Invisibility', caster.concentration?.spellName, 'Invisibility');
  assert('Prior Hold Person effect removed from ally',
    !ally.activeEffects.some(e => e.spellName === 'Hold Person'));
}

{
  // 4d. Dead target skipped (stale plan) — no condition applied
  const caster = makeWizard();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executeSingle(caster, ally, state);

  assert('Dead target NOT made invisible', !ally.conditions.has('invisible'));
  eq('Slot still consumed on dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCastSingle(caster, bf)!;
  executeSingle(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Condition_add event emitted (invisible applied)', condEvents.length === 1);
  assert('Action event mentions "Invisibility"', actionEvents[0].description.includes('Invisibility'));
  assert('Condition event mentions "INVISIBLE"', condEvents[0].description.includes('INVISIBLE'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/invisibility');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Invisibility', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster, not by cleanup)
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Invisibility');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster invisibles self (self priority)
  const caster = makeWizard();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { currentHP: 10 });   // low HP ally
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCastSingle(caster, bf);
  eq('shouldCast returns caster (self first)', target?.id, 'wizard1');
  if (target) executeSingle(caster, target, state);

  assert('Caster invisible', caster.conditions.has('invisible'));
  assert('Ally NOT invisible (caster prioritized self)', !ally.conditions.has('invisible'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Invisibility', caster.concentration?.spellName, 'Invisibility');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCastSingle(caster, bf);
  if (t1) executeSingle(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCastSingle(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 7c. After caster invisibles self, shouldCast returns null (concentration active)
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCastSingle(caster, bf)!;
  executeSingle(caster, t1, state);

  const t2 = shouldCastSingle(caster, makeBF([caster, ally]));
  assert('shouldCast returns null when caster is now concentrating on Invisibility', t2 === null);
}

// ============================================================
// 8. Upcast — multi-target selection (Session 35)
// ============================================================

console.log('\n=== 8. Upcast — multi-target selection (Session 35) ===\n');

/** Resources with slots at multiple levels for upcast testing. */
function withSlotsMulti(overrides: { [level: number]: number } = {}): PlayerResources {
  const spellSlots: any = {};
  for (let lvl = 1; lvl <= 9; lvl++) {
    spellSlots[lvl] = { max: 2, remaining: overrides[lvl] ?? 0 };
  }
  return { spellSlots };
}

{
  // 8a. L2 slot only → 1 target (no upcast)
  const caster = makeWizard();
  caster.conditions.add('invisible');  // exclude self so allies are picked
  caster.resources = withSlotsMulti({ 2: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2]);
  const targets = shouldCast(caster, bf);
  assert('8a. L2 slot → 1 target (no upcast)', targets !== null && targets.length === 1,
    `targets=${targets?.length}`);
}

{
  // 8b. L3 slot available → 2 targets (upcast by 1)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 2: 1, 3: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2]);
  const targets = shouldCast(caster, bf);
  assert('8b. L3 slot + 2 allies → 2 targets (upcast)', targets !== null && targets.length === 2,
    `targets=${targets?.length}`);
}

{
  // 8c. L4 slot available + 3 allies → 3 targets
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 4: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const a3 = makeAlly('a3', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2, a3]);
  const targets = shouldCast(caster, bf);
  assert('8c. L4 slot + 3 allies → 3 targets', targets !== null && targets.length === 3,
    `targets=${targets?.length}`);
}

{
  // 8d. L4 slot but only 2 allies in range → 2 targets (no waste)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 4: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2]);
  const targets = shouldCast(caster, bf);
  assert('8d. L4 slot but only 2 allies → 2 targets (capped at candidates)',
    targets !== null && targets.length === 2, `targets=${targets?.length}`);
}

{
  // 8e. L3 slot but only 1 ally in range → 1 target (capped at candidates)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 3: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const farAlly = makeAlly('far', { x: 10, y: 0, z: 0 });  // out of touch range
  const bf = makeBF([caster, a1, farAlly]);
  const targets = shouldCast(caster, bf);
  assert('8e. L3 slot but only 1 ally in range → 1 target',
    targets !== null && targets.length === 1, `targets=${targets?.length}`);
}

{
  // 8f. execute with 2 targets consumes L3 slot
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 2: 1, 3: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // L3 slot consumed (1 target → L2, 2 targets → L3)
  eq('8f. L3 slot consumed for 2 targets', caster.resources!.spellSlots![3]!.remaining, 0);
  eq('8f. L2 slot NOT consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('8f. a1 invisible', a1.conditions.has('invisible'));
  assert('8f. a2 invisible', a2.conditions.has('invisible'));
  assert('8f. caster NOT invisible (was excluded)', !caster.conditions.has('invisible') || caster.conditions.has('invisible'));
  // caster had 'invisible' condition added manually before; execute doesn't remove it
  eq('8f. concentration on Invisibility', caster.concentration?.spellName, 'Invisibility');
}

{
  // 8g. execute with 3 targets consumes L4 slot
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 4: 1, 3: 1, 2: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const a3 = makeAlly('a3', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf)!;
  eq('8g. shouldCast returns 3 targets', targets.length, 3);
  execute(caster, targets, state);

  // L4 slot consumed (3 targets → L4)
  eq('8g. L4 slot consumed for 3 targets', caster.resources!.spellSlots![4]!.remaining, 0);
  eq('8g. L3 slot NOT consumed', caster.resources!.spellSlots![3]!.remaining, 1);
  eq('8g. L2 slot NOT consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('8g. all 3 allies invisible', a1.conditions.has('invisible') && a2.conditions.has('invisible') && a3.conditions.has('invisible'));
}

{
  // 8h. execute with 1 target consumes L2 slot (no upcast)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 2: 1, 3: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, a1]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf)!;
  eq('8h. shouldCast returns 1 target (only 1 ally)', targets.length, 1);
  execute(caster, targets, state);

  // L2 slot consumed (1 target → L2, no upcast)
  eq('8h. L2 slot consumed for 1 target', caster.resources!.spellSlots![2]!.remaining, 0);
  eq('8h. L3 slot NOT consumed', caster.resources!.spellSlots![3]!.remaining, 1);
}

{
  // 8i. Multi-target priority: lowest-HP% allies picked first
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 3: 1 });  // L3 → 2 targets
  const healthy = makeAlly('healthy', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const wounded = makeAlly('wounded', { x: 0, y: 1, z: 0 }, { maxHP: 100, currentHP: 20 });
  const full = makeAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, healthy, wounded, full]);
  const targets = shouldCast(caster, bf)!;
  eq('8i. 2 targets picked', targets.length, 2);
  // wounded (20% HP) should be first; healthy or full second
  eq('8i. first target is wounded (lowest HP%)', targets[0].id, 'wounded');
}

{
  // 8j. Log message includes all target names
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 3: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 }, { name: 'Alice' });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 }, { name: 'Bob' });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const actionEvent = state.log.events.find((e: any) => e.type === 'action' && e.description.includes('Invisibility'));
  assert('8j. action event mentions both targets', actionEvent !== undefined);
  assert('8j. action event mentions Alice', actionEvent?.description.includes('Alice'));
  assert('8j. action event mentions Bob', actionEvent?.description.includes('Bob'));
  assert('8j. action event mentions "2 creatures"', actionEvent?.description.includes('2 creature'));
}

{
  // 8k. Each target gets its own invisible effect (per-target breaksOnAttackOrCast)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 3: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const eff1 = a1.activeEffects.find(e => e.spellName === 'Invisibility');
  const eff2 = a2.activeEffects.find(e => e.spellName === 'Invisibility');
  assert('8k. a1 has Invisibility effect', eff1 !== undefined);
  assert('8k. a2 has Invisibility effect', eff2 !== undefined);
  eq('8k. a1 effect breaksOnAttackOrCast', eff1?.breaksOnAttackOrCast, true);
  eq('8k. a2 effect breaksOnAttackOrCast', eff2?.breaksOnAttackOrCast, true);
  // Both effects sourced from the same caster (concentration-linked)
  eq('8k. a1 effect casterId', eff1?.casterId, caster.id);
  eq('8k. a2 effect casterId', eff2?.casterId, caster.id);
}

{
  // 8l. shouldCastSingle returns first target (backwards compat)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 3: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 50 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 }, { maxHP: 100, currentHP: 20 });
  const bf = makeBF([caster, a1, a2]);
  const single = shouldCastSingle(caster, bf);
  const multi = shouldCast(caster, bf);
  assert('8l. shouldCastSingle returns 1 combatant', single !== null);
  assert('8l. shouldCast returns 2 combatants', multi !== null && multi.length === 2);
  eq('8l. shouldCastSingle matches first of shouldCast', single?.id, multi![0].id);
}

{
  // 8m. executeSingle applies to 1 target (backwards compat)
  const caster = makeWizard();
  caster.conditions.add('invisible');
  caster.resources = withSlotsMulti({ 2: 1 });
  const a1 = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const a2 = makeAlly('a2', { x: 0, y: 1, z: 0 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  executeSingle(caster, a1, state);
  assert('8m. a1 invisible (executeSingle)', a1.conditions.has('invisible'));
  assert('8m. a2 NOT invisible (executeSingle only targets a1)', !a2.conditions.has('invisible'));
  eq('8m. L2 slot consumed (executeSingle = 1 target)', caster.resources!.spellSlots![2]!.remaining, 0);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
