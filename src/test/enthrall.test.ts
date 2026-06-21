// ============================================================
// enthrall.test.ts — Enthrall spell module
// PHB p.238: 2nd-level enchantment, action, range 60 ft,
// concentration (1 min). Components: V, S.
//
// Effect: WIS save (up to N targets within 60 ft). On fail: target has
//         disadvantage on Perception checks. v1 has no perception subsystem —
//         sets forward-compat flag `_enthrallActive` on the CASTER (the
//         caster is the one enthralling).
//
// v1 simplifications (documented via metadata flags):
//   - Perception subsystem NOT modelled (forward-compat flag on caster).
//   - Max 3 targets (shouldCast returns Combatant[]).
//   - Concentration NOT enforced (TG-002).
//   - Sentinel effect attached to the CASTER (not the targets).
//
// Tests cover shouldCast() preconditions + target priority (up to 3),
// execute() caster-flag application + sentinel attachment (on CASTER, not
// targets), per-target WIS save logging, slot consumption, concentration
// start, cleanup no-op, integration pipeline, and metadata shape.
//
// Deterministic save outcomes:
//   - WIS 1  + DC 25 = guaranteed fail  (mod -5, even nat 20 → 15 < 25)
//   - WIS 30 + DC 5  = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/enthrall';
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

/** Guaranteed-fail action: WIS 1 + DC 25 → max save 15 < 25 (always fails) */
const ENTHRALL_ACTION_FAIL: Action = {
  name: 'Enthrall',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed fail (WIS 1 → max 15)
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Enthrall (DC 25 WIS, disadvantage on Perception, concentration 1 min)',
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

/** Bard with Enthrall + 2 2nd-level slots, DC 25 WIS (guaranteed fail) */
function makeBard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('bard1', {
    name: 'Bard',
    pos,
    actions: [ENTHRALL_ACTION_FAIL],
    resources: withSlots2(2),
  });
}

/** Enemy with WIS 1 (guaranteed fail vs DC 25) */
function makeDistractibleEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    wis: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos, ...overrides,
  });
}

/** Enemy with WIS 30 (guaranteed success vs DC 25 — even DC 25 fails on max roll 20+10=30 only ties... actually 30>=25 succeeds) */
function makeStoicEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    wis: 30,           // guaranteed success vs DC 25 (mod +10, even nat 1 → 11 ≥ 25? no, 11 < 25 — only nat 20+10=30 succeeds)
    pos,
  });
}

// Note: For the "guaranteed success" path, we need WIS 30 + DC 5. The main
// test below uses DC 25 (fail), so WIS 30 enemies vs DC 25 will sometimes
// succeed (nat 20 → 30) and sometimes fail. To avoid flaky tests, the
// enthrall.test.ts uses only the guaranteed-fail setup for execute tests,
// and tests save_success vs save_fail counts more loosely.

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Enthrall', metadata.name, 'Enthrall');
eq('level is 2', metadata.level, 2);
eq('school is enchantment', metadata.school, 'enchantment');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('max targets is 3', metadata.maxTargets, 3);
eq('is concentration', metadata.concentration, true);
eq('save ability is wis', metadata.saveAbility, 'wis');
eq('casting time is action', metadata.castingTime, 'action');
eq('perception disadv NOT implemented (v1)', metadata.enthrallPerceptionDisadvV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.enthrallUpcastV1Implemented, false);
eq('concentration enforcement NOW implemented (Session 34 TG-002)', metadata.enthrallConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates (incl. concentration)
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Enthrall' action
  const caster = makeBard();
  caster.actions = [];
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns [] when caster has no Enthrall action', shouldCast(caster, bf).length, 0);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeBard();
  caster.resources = withSlots2(0);
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns [] when no 2nd-level slots', shouldCast(caster, bf).length, 0);
}

{
  // 2c. Caster is already concentrating on another spell
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns [] when caster is already concentrating', shouldCast(caster, bf).length, 0);
}

{
  // 2d. No enemies in range (60 ft)
  const caster = makeBard();
  const farEnemy = makeDistractibleEnemy('far', { x: 20, y: 0, z: 0 });   // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns [] when no enemies in range (60 ft)', shouldCast(caster, bf).length, 0);
}

{
  // 2e. Enemy already Enthralled by this caster — skip
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Enthrall',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  eq('Returns [] when enemy already Enthralled by this caster', shouldCast(caster, bf).length, 0);
}

{
  // 2f. Dead enemy — skip
  const caster = makeBard();
  const deadEnemy = makeDistractibleEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  eq('Returns [] when only enemy is dead', shouldCast(caster, bf).length, 0);
}

// ============================================================
// 3. shouldCast — target priority (up to 3)
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Single enemy → 1 target returned
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  eq('Single enemy → 1 target', result.length, 1);
  eq('Target is the enemy', result[0]?.id, 'e1');
}

{
  // 3b. 3 enemies → 3 targets returned, sorted by threat (desc)
  const caster = makeBard();
  const weak = makeDistractibleEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const mid = makeDistractibleEnemy('mid', { x: 2, y: 0, z: 0 }, { maxHP: 40 });
  const strong = makeDistractibleEnemy('strong', { x: 3, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, mid, strong]);
  const result = shouldCast(caster, bf);
  eq('3 enemies → 3 targets', result.length, 3);
  eq('First target is the strongest (maxHP 80)', result[0]?.id, 'strong');
  eq('Second target is mid (maxHP 40)', result[1]?.id, 'mid');
  eq('Third target is weak (maxHP 20)', result[2]?.id, 'weak');
}

{
  // 3c. 5 enemies → only 3 returned (max 3 cap), highest-threat ones
  const caster = makeBard();
  const e1 = makeDistractibleEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 10 });
  const e2 = makeDistractibleEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 20 });
  const e3 = makeDistractibleEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 30 });
  const e4 = makeDistractibleEnemy('e4', { x: 4, y: 0, z: 0 }, { maxHP: 40 });
  const e5 = makeDistractibleEnemy('e5', { x: 5, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e1, e2, e3, e4, e5]);
  const result = shouldCast(caster, bf);
  eq('5 enemies → capped at 3 targets', result.length, 3);
  eq('First target is the strongest (maxHP 50)', result[0]?.id, 'e5');
  eq('Second target is e4 (maxHP 40)', result[1]?.id, 'e4');
  eq('Third target is e3 (maxHP 30)', result[2]?.id, 'e3');
}

{
  // 3d. Same-faction allies skipped
  const caster = makeBard();
  const ally = makeCombatant('ally', { faction: 'party', maxHP: 90, pos: { x: 1, y: 0, z: 0 } });
  const enemy = makeDistractibleEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, ally, enemy]);
  const result = shouldCast(caster, bf);
  eq('Ally skipped, 1 enemy returned', result.length, 1);
  eq('Target is the enemy', result[0]?.id, 'e1');
}

// ============================================================
// 4. execute — caster flag + sentinel + per-target saves
// ============================================================

console.log('\n=== 4. execute — caster flag + sentinel + per-target saves ===\n');

{
  // 4a. _enthrallActive set on the CASTER (not the targets)
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Caster flag undefined before cast', caster._enthrallActive, undefined);

  const targets = shouldCast(caster, bf);
  execute(caster, targets, state);

  eq('Caster flag set after cast', caster._enthrallActive, true);
  eq('Target flag NOT set (forward-compat flag is on caster)',
    (enemy as any)._enthrallActive, undefined);
}

{
  // 4b. Sentinel damage_zone effect attached to the CASTER (not targets)
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  const casterSentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Enthrall',
  );
  const targetSentinels = enemy.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Enthrall',
  );
  eq('1 sentinel on the CASTER', casterSentinels.length, 1);
  eq('0 sentinels on the target', targetSentinels.length, 0);
  if (casterSentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', casterSentinels[0].payload.dieCount, 0);
    eq('Sentinel dieSides is 0', casterSentinels[0].payload.dieSides, 0);
    eq('Sentinel sourceIsConcentration is true', casterSentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the bard', casterSentinels[0].casterId, 'bard1');
  }
}

{
  // 4c. Slot consumed + concentration started
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Enthrall', caster.concentration?.spellName, 'Enthrall');
}

{
  // 4d. Existing concentration broken (safety net)
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeDistractibleEnemy('e1');
  // Pre-existing Hold Person effect on enemy (simulated)
  enemy.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  eq('Concentration switched to Enthrall', caster.concentration?.spellName, 'Enthrall');
  assert('Prior Hold Person effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

{
  // 4e. Per-target WIS save — 3 targets → 3 save events emitted
  const caster = makeBard();
  const e1 = makeDistractibleEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 80 });
  const e2 = makeDistractibleEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 40 });
  const e3 = makeDistractibleEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 20 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  // All 3 targets have WIS 1 vs DC 25 → guaranteed fail.
  eq('3 save events emitted (one per target)', saveEvents.length, 3);
  assert('All 3 saves are save_fail (guaranteed fail)',
    saveEvents.every(e => e.type === 'save_fail'));
}

{
  // 4f. Dead target skipped (stale plan) — flag still set on caster
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  eq('Caster flag set even if all targets dead (cast succeeds)', caster._enthrallActive, true);
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  // 5a. Action event (cast log) + save events + per-target action events
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Enthrall"',
    actionEvents[0].description.includes('Enthrall'));
  assert('1 save event (single target)', saveEvents.length === 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
}

{
  // 5b. Multi-target action events include all target names
  const caster = makeBard();
  const e1 = makeDistractibleEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 80 });
  const e2 = makeDistractibleEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  eq('2 save events (2 targets)', saveEvents.length, 2);
  const targetIds = saveEvents.map((e: any) => e.targetId).sort();
  eq('Save event 1 targetId is e1', targetIds[0], 'e1');
  eq('Save event 2 targetId is e2', targetIds[1], 'e2');
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/enthrall');
  const caster = makeBard();
  caster.concentration = { active: true, spellName: 'Enthrall', dcIfHit: 10 };
  caster._enthrallActive = true;
  // cleanup should NOT clear the flag or break concentration (concentration
  // break is handled by removeEffectsFromCaster's sentinel cleanup, not by
  // cleanup)
  cleanup(caster);
  eq('Cleanup does NOT clear caster flag', caster._enthrallActive, true);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Enthrall');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: bard enthralls up to 3 highest-threat enemies
  const caster = makeBard();
  const weak = makeDistractibleEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const mid = makeDistractibleEnemy('mid', { x: 2, y: 0, z: 0 }, { maxHP: 40 });
  const strong = makeDistractibleEnemy('strong', { x: 3, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, mid, strong]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  eq('shouldCast returns 3 targets', targets.length, 3);
  eq('First target is strongest', targets[0]?.id, 'strong');
  execute(caster, targets, state);

  eq('Caster flag set', caster._enthrallActive, true);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Enthrall', caster.concentration?.spellName, 'Enthrall');

  const casterSentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Enthrall',
  );
  eq('Sentinel effect attached to caster', casterSentinels.length, 1);
}

{
  // 7b. After slots exhausted, shouldCast returns []
  const caster = makeBard();
  caster.resources = withSlots2(1);
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1.length > 0) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns [] after slots exhausted', t2.length, 0);
}

{
  // 7c. Sentinel cleanup on concentration break — caster flag cleared
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  const caster = makeBard();
  const enemy = makeDistractibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, [enemy], state);

  eq('Caster flag set on cast', caster._enthrallActive, true);

  // Simulate concentration break (caster's concentration ends)
  removeEffectsFromCaster(caster.id, bf);

  eq('Caster flag cleared after concentration break', caster._enthrallActive, undefined);
  assert('Sentinel effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Enthrall'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
