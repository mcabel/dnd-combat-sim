// ============================================================
// levitate.test.ts — Levitate spell module
// PHB p.255: 2nd-level transmutation, action, range 60 ft,
// concentration (10 min). Components: V, S, M.
//
// Effect: Target rises vertically up to 20 ft and remains suspended
// for the duration. A creature can use its action to make a CON save
// to end the effect on itself.
//
// v1 simplification: Levitate is modelled as the `restrained`
// condition (closest PHB condition — speed 0, attacks vs target have
// advantage, target has disadv on attacks/Dex saves). Canon Levitate
// does NOT impose attack disadv or attacks-vs-adv (v1 is slightly
// MORE punishing than canon). Documented via the metadata flag
// `levitateAsRestrainedV1Simplified: true`.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// CON save resolution (guaranteed fail → restrained; guaranteed
// success → not restrained), effect attachment (condition_apply:
// restrained, sourceIsConcentration: true), logging, integration
// pipeline, and metadata shape.
//
// Deterministic save outcomes:
//   - CON 1  + DC 25 = guaranteed fail  (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5  = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/levitate';
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

/** Guaranteed-fail action: CON 1 + DC 25 → max save 15 < 25 (always fails) */
const LEVITATE_ACTION_FAIL: Action = {
  name: 'Levitate',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed fail (CON 1 → max 15)
  saveAbility: 'con',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Levitate (DC 25 CON or restrained, concentration 10 min)',
};

/** Guaranteed-success action: CON 30 + DC 5 → min save 11 ≥ 5 (always succeeds) */
const LEVITATE_ACTION_SUCCESS: Action = { ...LEVITATE_ACTION_FAIL, saveDC: 5 };

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

/** Wizard with Levitate + 2 2nd-level slots, DC 25 CON (guaranteed fail) */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [LEVITATE_ACTION_FAIL],
    resources: withSlots2(2),
  });
}

/** Enemy with CON 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    con: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos, ...overrides,
  });
}

/** Enemy with CON 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    con: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Levitate', metadata.name, 'Levitate');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('save ability is con', metadata.saveAbility, 'con');
eq('casting time is action', metadata.castingTime, 'action');
eq('Levitate modelled as restrained (v1 simplified)', metadata.levitateAsRestrainedV1Simplified, true);
eq('end-of-turn CON save NOT implemented (v1)', metadata.levitateEndOfTurnSaveV1Implemented, false);
eq('vertical movement NOT implemented (v1)', metadata.levitateVerticalMovementV1Implemented, false);
eq('object targeting NOT implemented (v1)', metadata.levitateObjectTargetingV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.levitateConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + priority ===\n');

{
  // 2a. Caster lacks 'Levitate' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Levitate action', shouldCast(caster, bf) === null);
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
  // 2c. Caster is already concentrating on another spell
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range
  const caster = makeWizard();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });   // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already restrained — skip
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  enemy.conditions.add('restrained');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already restrained', shouldCast(caster, bf) === null);
}

{
  // 2f. Enemy already Levitate'd by this caster — skip
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Levitate',
    effectType: 'condition_apply', payload: { condition: 'restrained' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Levitate\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2g. Highest-threat (maxHP) enemy selected first
  const caster = makeWizard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 80) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 2h. Tie-break: closest enemy first
  const caster = makeWizard();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 3. execute — save resolution
// ============================================================

console.log('\n=== 3. execute — save resolution ===\n');

{
  // 3a. Guaranteed fail (CON 1 vs DC 25) → restrained applied
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy restrained on failed save', enemy.conditions.has('restrained'));
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Levitate', caster.concentration?.spellName, 'Levitate');
}

{
  // 3b. Guaranteed success (CON 30 vs DC 5) → NOT restrained
  const caster = makeWizard();
  caster.actions = [LEVITATE_ACTION_SUCCESS];      // DC 5
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy NOT restrained on successful save', !enemy.conditions.has('restrained'));
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('No active effect applied on save success',
    !enemy.activeEffects.some(e => e.spellName === 'Levitate'));
}

{
  // 3c. Dead target skipped (stale plan) — no restrained
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  assert('Dead enemy NOT restrained', !enemy.conditions.has('restrained'));
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3d. Concentration started on caster
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Levitate', caster.concentration?.spellName, 'Levitate');
}

{
  // 3e. Existing concentration broken (safety net)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  // Add an effect from prior concentration on enemy
  enemy.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Levitate', caster.concentration?.spellName, 'Levitate');
  assert('Prior Hold Person effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

// ============================================================
// 4. execute — effect attachment (condition_apply:restrained)
// ============================================================

console.log('\n=== 4. execute — effect attachment ===\n');

{
  // 4a. Active effect attached with correct shape
  const caster = makeWizard();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const levEff = enemy.activeEffects.find(e =>
    e.effectType === 'condition_apply' && e.payload.condition === 'restrained'
  );
  assert('Active effect attached (condition_apply:restrained)', levEff !== undefined);
  if (levEff) {
    eq('Effect sourceIsConcentration is true', levEff.sourceIsConcentration, true);
    eq('Effect spellName is Levitate', levEff.spellName, 'Levitate');
    eq('Effect casterId is caster', levEff.casterId, caster.id);
    eq('Effect payload.condition is restrained', levEff.payload.condition, 'restrained');
  }
}

{
  // 4b. No effect attached on save success
  const caster = makeWizard();
  caster.actions = [LEVITATE_ACTION_SUCCESS];
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const levEff = enemy.activeEffects.find(e => e.spellName === 'Levitate');
  assert('No Levitate effect attached on save success', levEff === undefined);
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

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Save event emitted', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  assert('Condition_add event emitted (restrained applied)', condEvents.length === 1);
  assert('First action event mentions "Levitate"', actionEvents[0].description.includes('Levitate'));
}

{
  // 5b. On save success: save_success event, no condition_add event
  const caster = makeWizard();
  caster.actions = [LEVITATE_ACTION_SUCCESS];
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const events = state.log.events as any[];
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Save event is save_success (guaranteed success)', saveEvents[0]?.type === 'save_success');
  assert('No condition_add event on save success', condEvents.length === 0);
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/levitate');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Levitate', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster, not by cleanup)
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Levitate');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster restrains highest-threat enemy
  const caster = makeWizard();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  assert('Strong enemy restrained', strong.conditions.has('restrained'));
  assert('Weak enemy NOT restrained', !weak.conditions.has('restrained'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Levitate', caster.concentration?.spellName, 'Levitate');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 7c. Strong enemy resists — not restrained, slot still consumed
  const caster = makeWizard();
  caster.actions = [LEVITATE_ACTION_SUCCESS];
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Strong enemy NOT restrained (save succeeded)', !enemy.conditions.has('restrained'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration started regardless of save outcome', caster.concentration?.spellName, 'Levitate');
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
