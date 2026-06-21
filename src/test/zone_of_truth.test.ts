// ============================================================
// zone_of_truth.test.ts — Zone of Truth spell module
// PHB p.289: 2nd-level enchantment, action, range 60 ft,
// concentration (10 min). Components: V, S, M (a pinch of powder + water).
//
// Effect: CHA save. On fail: target can't lie (canon: 15-ft-radius AoE).
//         v1 has no lie/speech subsystem — sets forward-compat flag
//         `_zoneOfTruthActive` on the target (single-target simplification).
//
// v1 simplifications (documented via metadata flags):
//   - Lie/speech subsystem NOT modelled (forward-compat flag only).
//   - AoE / multi-target NOT modelled (single-target simplification).
//   - Concentration NOT enforced (TG-002).
//   - Flag + sentinel ONLY set on save fail (success → no flag, no sentinel).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// CHA save resolution (guaranteed fail → flag set + sentinel; guaranteed
// success → no flag, no sentinel), sentinel effect attachment, slot
// consumption, concentration start, logging, cleanup no-op, integration
// pipeline, and metadata shape.
//
// Deterministic save outcomes:
//   - CHA 1  + DC 25 = guaranteed fail  (mod -5, even nat 20 → 15 < 25)
//   - CHA 30 + DC 5  = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/zone_of_truth';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

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

/** Guaranteed-fail action: CHA 1 + DC 25 → max save 15 < 25 (always fails) */
const ZOT_ACTION_FAIL: Action = {
  name: 'Zone of Truth',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed fail (CHA 1 → max 15)
  saveAbility: 'cha',
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Zone of Truth (DC 25 CHA or can\'t lie, concentration 10 min)',
};

/** Guaranteed-success action: CHA 30 + DC 5 → min save 11 ≥ 5 (always succeeds) */
const ZOT_ACTION_SUCCESS: Action = { ...ZOT_ACTION_FAIL, saveDC: 5 };

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
    conditions: new Set() as Set<Condition>,
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

/** Cleric with Zone of Truth + 2 2nd-level slots, DC 25 CHA (guaranteed fail) */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [ZOT_ACTION_FAIL],
    resources: withSlots2(2),
  });
}

/** Enemy with CHA 1 (guaranteed fail vs DC 25) */
function makeShyEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    cha: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos, ...overrides,
  });
}

/** Enemy with CHA 30 (guaranteed success vs DC 5) */
function makeSmoothEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    cha: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Zone of Truth', metadata.name, 'Zone of Truth');
eq('level is 2', metadata.level, 2);
eq('school is enchantment', metadata.school, 'enchantment');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('AoE radius is 15 ft', metadata.aoeRadiusFt, 15);
eq('is concentration', metadata.concentration, true);
eq('save ability is cha', metadata.saveAbility, 'cha');
eq('casting time is action', metadata.castingTime, 'action');
eq('lie subsystem NOT implemented (v1)', metadata.zoneOfTruthLieSubsystemV1Implemented, false);
eq('AoE multi-target NOT implemented (v1)', metadata.zoneOfTruthAoEMultiTargetV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.zoneOfTruthUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.zoneOfTruthConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates (incl. concentration)
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Zone of Truth' action
  const caster = makeCleric();
  caster.actions = [];
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Zone of Truth action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating on another spell
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range (60 ft)
  const caster = makeCleric();
  const farEnemy = makeShyEnemy('far', { x: 20, y: 0, z: 0 });   // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already Zone-of-Truth'd by this caster — skip
  const caster = makeCleric();
  const enemy = makeShyEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Zone of Truth',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Zone-of-Truth\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2f. Dead enemy — skip
  const caster = makeCleric();
  const deadEnemy = makeShyEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  assert('Returns null when only enemy is dead', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeCleric();
  const weak = makeShyEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeShyEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 80) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeCleric();
  const far = makeShyEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeShyEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 3c. Same-faction allies skipped
  const caster = makeCleric();
  const ally = makeCombatant('ally', { faction: 'party', maxHP: 90, pos: { x: 1, y: 0, z: 0 } });
  const enemy = makeShyEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, ally, enemy]);
  eq('Same-faction ally skipped, enemy selected', shouldCast(caster, bf)?.id, 'e1');
}

// ============================================================
// 4. execute — save resolution (fail → flag + sentinel; success → no flag, no sentinel)
// ============================================================

console.log('\n=== 4. execute — save resolution ===\n');

{
  // 4a. Guaranteed fail (CHA 1 vs DC 25) → flag set + sentinel attached
  const caster = makeCleric();
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Flag undefined before cast', enemy._zoneOfTruthActive, undefined);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Flag set on target after failed save', enemy._zoneOfTruthActive, true);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Zone of Truth', caster.concentration?.spellName, 'Zone of Truth');
}

{
  // 4b. Guaranteed success (CHA 30 vs DC 5) → NO flag, NO sentinel
  const caster = makeCleric();
  caster.actions = [ZOT_ACTION_SUCCESS];      // DC 5
  const enemy = makeSmoothEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Flag NOT set on save success', enemy._zoneOfTruthActive, undefined);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('No active effect applied on save success',
    !enemy.activeEffects.some(e => e.spellName === 'Zone of Truth'));
}

{
  // 4c. Dead target skipped (stale plan) — no flag
  const caster = makeCleric();
  const enemy = makeShyEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Dead enemy: flag NOT set', enemy._zoneOfTruthActive, undefined);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. Concentration started on caster
  const caster = makeCleric();
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Zone of Truth', caster.concentration?.spellName, 'Zone of Truth');
}

{
  // 4e. Existing concentration broken (safety net)
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeShyEnemy('e1');
  // Add an effect from prior concentration on enemy
  enemy.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Zone of Truth', caster.concentration?.spellName, 'Zone of Truth');
  assert('Prior Hold Person effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

{
  // 4f. Sentinel damage_zone effect attached (dieCount=0) on save fail
  const caster = makeCleric();
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const sentinels = enemy.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Zone of Truth',
  );
  eq('1 sentinel damage_zone effect attached on save fail', sentinels.length, 1);
  if (sentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', sentinels[0].payload.dieCount, 0);
    eq('Sentinel dieSides is 0', sentinels[0].payload.dieSides, 0);
    eq('Sentinel sourceIsConcentration is true', sentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the cleric', sentinels[0].casterId, 'cleric1');
  }
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  // 5a. On save fail: action + save_fail + condition_add events
  const caster = makeCleric();
  const enemy = makeShyEnemy('e1');
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
  assert('Condition_add event emitted (truth-bound)', condEvents.length === 1);
  assert('First action event mentions "Zone of Truth"',
    actionEvents[0].description.includes('Zone of Truth'));
  assert('Condition_add mentions truth',
    condEvents[0].description.toLowerCase().includes('truth'));
}

{
  // 5b. On save success: save_success event, no condition_add event
  const caster = makeCleric();
  caster.actions = [ZOT_ACTION_SUCCESS];
  const enemy = makeSmoothEnemy('e1');
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
  const { cleanup } = require('../spells/zone_of_truth');
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Zone of Truth', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster's sentinel cleanup, not by cleanup)
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Zone of Truth');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: cleric binds highest-threat enemy
  const caster = makeCleric();
  const weak = makeShyEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeShyEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  eq('Strong enemy truth-bound (flag set)', strong._zoneOfTruthActive, true);
  eq('Weak enemy NOT truth-bound (flag undefined)', weak._zoneOfTruthActive, undefined);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Zone of Truth', caster.concentration?.spellName, 'Zone of Truth');

  const sentinels = strong.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Zone of Truth',
  );
  eq('Sentinel effect attached', sentinels.length, 1);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 7c. Smooth enemy resists — no flag, slot still consumed
  const caster = makeCleric();
  caster.actions = [ZOT_ACTION_SUCCESS];
  const enemy = makeSmoothEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Smooth enemy NOT truth-bound (flag undefined)', enemy._zoneOfTruthActive, undefined);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration started regardless of save outcome', caster.concentration?.spellName, 'Zone of Truth');
}

{
  // 7d. Sentinel cleanup on concentration break — flag cleared
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  const caster = makeCleric();
  const enemy = makeShyEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Flag set on cast', enemy._zoneOfTruthActive, true);

  // Simulate concentration break (caster's concentration ends)
  removeEffectsFromCaster(caster.id, bf);

  eq('Flag cleared after concentration break', enemy._zoneOfTruthActive, undefined);
  assert('Sentinel effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Zone of Truth'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
