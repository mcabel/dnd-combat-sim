// ============================================================
// enlarge_reduce.test.ts — Enlarge/Reduce spell module
// PHB p.237: 2nd-level transmutation, action, 30 ft, concentration 1 min.
// Effect: CON save or target is Enlarged (+1d8 weapon dmg, adv STR) or
//         Reduced (half weapon dmg, disadv STR).
//
// v1: mode is chosen by the planner — 'reduce' for enemies (PRIORITY),
//     'enlarge' for allies (fallback when no enemy is in range).
//
// Tests cover shouldCast() gates + target priority + mode selection,
// execute() save resolution + enlarge_reduce ActiveEffect application,
// logging, cleanup no-op, integration pipeline, and metadata shape.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, EnlargeReduceMode } from '../spells/enlarge_reduce';
import { getActiveEnlargeReduce } from '../engine/spell_effects';
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

const ENLARGE_REDUCE_ACTION: Action = {
  name: 'Enlarge/Reduce',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Enlarge/Reduce (CON save, enlarge/reduce, concentration 1 min)',
};

/** Separate melee weapon attack — used by allies so they qualify as enlarge targets. */
const MELEE_ATTACK: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 5,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword melee attack',
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

/** Wizard at pos (0,0,0) with Enlarge/Reduce + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [ENLARGE_REDUCE_ACTION],
    resources: withSlots2(2),
  });
}

/** Enemy with CON 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos,
    ...overrides,
  });
}

/** Enemy with CON 30 (guaranteed success vs DC 5) — uses a custom action with low DC */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
    ...overrides,
  });
}

/** Ally with a melee weapon attack (qualifies for enlarge) */
function makeAlly(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'party',
    actions: [MELEE_ATTACK],
    pos,
    ...overrides,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Enlarge/Reduce', metadata.name, 'Enlarge/Reduce');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('save ability is con', metadata.saveAbility, 'con');
eq('casting time is action', metadata.castingTime, 'action');
eq('enlarge damage die sides is 8 (+1d8 weapon dmg)', metadata.enlargeDamageDieSides, 8);
eq('size category change NOT implemented (v1)', metadata.enlargeReduceSizeCategoryV1Implemented, false);
eq('object targeting NOT implemented (v1)', metadata.enlargeReduceObjectTargetingV1Implemented, false);
eq('concentration enforcement NOW implemented (Session 34 TG-002)', metadata.enlargeReduceConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Enlarge/Reduce' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Enlarge/Reduce action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies or allies in range (caster has no weapon attack → can't self-enlarge)
  const caster = makeWizard();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft, out of 30 ft range
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no targets in range (30 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. No allies with weapon attacks (enlarge fallback fails)
  const caster = makeWizard();
  const unarmedAlly = makeCombatant('ally1', {
    name: 'Ally', faction: 'party',
    pos: { x: 1, y: 0, z: 0 },
    actions: [],  // no weapon attack → cannot benefit from enlarge
  });
  const bf = makeBF([caster, unarmedAlly]);
  assert('Returns null when no allies with weapon attacks in range', shouldCast(caster, bf) === null);
}

{
  // 2f. Enemy already Enlarge/Reduce'd by this caster — skip
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_er1', casterId: caster.id, spellName: 'Enlarge/Reduce',
    effectType: 'enlarge_reduce', payload: { enlargeReduceMode: 'reduce' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Enlarge/Reduce\'d by this caster', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority + mode selection
// ============================================================

console.log('\n=== 3. shouldCast — target priority + mode selection ===\n');

{
  // 3a. Enemy reduce prioritized over ally enlarge
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const ally = makeAlly('a1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, enemy, ally]);
  const result = shouldCast(caster, bf);
  eq('Enemy targeted when both enemy + ally in range', result?.target.id, 'e1');
  eq('Mode is reduce for enemy target', result?.mode, 'reduce');
}

{
  // 3b. Ally enlarge fallback when no enemies in range
  const caster = makeWizard();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft, out of range
  const bf = makeBF([caster, ally, farEnemy]);
  const result = shouldCast(caster, bf);
  eq('Ally targeted (enlarge) when no enemies in range', result?.target.id, 'a1');
  eq('Mode is enlarge for ally target', result?.mode, 'enlarge');
}

{
  // 3c. Highest-threat (maxHP) enemy selected for reduce
  const caster = makeWizard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const result = shouldCast(caster, bf);
  eq('Highest-threat (maxHP 80) enemy selected', result?.target.id, 'strong');
  eq('Mode is reduce', result?.mode, 'reduce');
}

{
  // 3d. Lowest-HP% ally selected for enlarge (caster excluded — no weapon attack)
  const caster = makeWizard();  // caster has no weapon attack → excluded from enlarge candidates
  const full = makeAlly('full', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });  // 100%
  const hurt = makeAlly('hurt', { x: 2, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });  // 25%
  const bf = makeBF([caster, full, hurt]);
  const result = shouldCast(caster, bf);
  eq('Lowest-HP% (25%) ally selected for enlarge', result?.target.id, 'hurt');
  eq('Mode is enlarge', result?.mode, 'enlarge');
}

{
  // 3e. Tie-break: closest enemy first (same maxHP)
  const caster = makeWizard();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  const result = shouldCast(caster, bf);
  eq('Closest enemy wins tie-break', result?.target.id, 'near');
  eq('Mode is reduce', result?.mode, 'reduce');
}

// ============================================================
// 4. execute — save resolution + enlarge_reduce effect application
// ============================================================

console.log('\n=== 4. execute — save resolution + enlarge_reduce effect application ===\n');

{
  // 4a. Guaranteed fail (CON 1 vs DC 25) → enlarge_reduce effect applied (reduce)
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.mode, state);

  eq('Plan mode is reduce', plan.mode, 'reduce');
  eq('getActiveEnlargeReduce returns reduce', getActiveEnlargeReduce(enemy), 'reduce');
  assert('enlarge_reduce ActiveEffect attached with mode=reduce',
    enemy.activeEffects.some(e =>
      e.effectType === 'enlarge_reduce' &&
      e.payload.enlargeReduceMode === 'reduce' &&
      e.spellName === 'Enlarge/Reduce' &&
      e.sourceIsConcentration === true
    ));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Enlarge/Reduce', caster.concentration?.spellName, 'Enlarge/Reduce');
}

{
  // 4b. Guaranteed success (CON 30 vs DC 5) → NO effect applied
  const caster = makeWizard();
  caster.actions = [{ ...ENLARGE_REDUCE_ACTION, saveDC: 5 }];  // guaranteed-success DC
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.mode, state);

  eq('getActiveEnlargeReduce returns null (save succeeded)', getActiveEnlargeReduce(enemy), null);
  assert('No enlarge_reduce ActiveEffect attached on save success',
    !enemy.activeEffects.some(e => e.effectType === 'enlarge_reduce'));
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration still started on save success', caster.concentration?.spellName, 'Enlarge/Reduce');
}

{
  // 4c. Concentration started on caster
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, 'reduce', state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Enlarge/Reduce', caster.concentration?.spellName, 'Enlarge/Reduce');
}

{
  // 4d. Existing concentration broken (safety net — planner prevents this,
  //     but execute clears stale concentration effects before starting new).
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_blur', casterId: caster.id, spellName: 'Blur',
    effectType: 'ac_bonus', payload: { acBonus: 0 }, sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, 'reduce', state);

  eq('Concentration switched to Enlarge/Reduce', caster.concentration?.spellName, 'Enlarge/Reduce');
  assert('Prior Blur effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Blur'));
}

{
  // 4e. Dead target skipped (stale edge case — slot still consumed)
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, 'reduce', state);

  eq('getActiveEnlargeReduce is null on dead target', getActiveEnlargeReduce(enemy), null);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.mode, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Save event emitted', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('Condition_add event emitted (enlarge_reduce applied)', condEvents.length === 1);
  assert('Action event mentions "Enlarge" or "Reduce" (verb)',
    actionEvents[0].description.includes('Enlarge') || actionEvents[0].description.includes('Reduce'));
  assert('Save event mentions CON save', saveEvents[0].description.includes('CON'));
  assert('Condition event mentions REDUCED', condEvents[0].description.includes('REDUCED'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/enlarge_reduce');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Enlarge/Reduce', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster, not by cleanup).
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Enlarge/Reduce');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster reduces highest-threat enemy
  const caster = makeWizard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  eq('shouldCast returns strong enemy (maxHP 80)', plan.target.id, 'strong');
  eq('shouldCast mode is reduce', plan.mode, 'reduce');
  execute(caster, plan.target, plan.mode, state);

  eq('Strong enemy reduced', getActiveEnlargeReduce(strong), 'reduce');
  eq('Weak enemy NOT affected', getActiveEnlargeReduce(weak), null);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Enlarge/Reduce', caster.concentration?.spellName, 'Enlarge/Reduce');
}

{
  // 7b. After casting, shouldCast returns null (caster is now concentrating)
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.mode, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const retry = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted (and concentration active)', retry === null);
}

{
  // 7c. Enemy already affected is skipped (re-cast prevention)
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const p1 = shouldCast(caster, bf)!;
  execute(caster, p1.target, p1.mode, state);

  // Now shouldCast on a bf where the only enemy is already affected → null
  // (caster is concentrating AND enemy is already affected)
  const retry = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null when enemy already Enlarge/Reduce\'d by this caster', retry === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
