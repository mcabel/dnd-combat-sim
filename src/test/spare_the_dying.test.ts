// ============================================================
// Test: Spare the Dying Cantrip
// PHB p.277 — Level 0 necromancy cantrip (touch-effect: stabilize a downed PC ally)
//
// v1 simplifications (all documented via metadata flags):
//   - Range: canonically Touch (caster must be adjacent to the downed ally)
//     → v1 does NOT enforce adjacency (AI/planner trusted to target allies within 5 ft).
//   - Type exclusion: canonically excludes undead and constructs
//     → v1 does NOT model the type exclusion (handler stabilizes any PC at 0 HP).
//   - Monsters: PHB p.197 canonically says monsters die at 0 HP
//     → v1 handler fizzles on monsters at 0 HP (defensive check).
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S — NO M, canon per 5etools JSON)
//   3. metadata exposes isTouchEffect = true
//   4. metadata exposes v1 simplification flags
//   5. metadata does NOT scale (stabilize is binary)
//   6. applyTouchEffect stabilizes a downed PC ally (sets _isStabilized, resets deathSaves)
//   7. applyTouchEffect on monster at 0 HP → fizzle (no effect, action consumed)
//   8. applyTouchEffect on creature above 0 HP → fizzle (no effect, action consumed)
//   9. applyTouchEffect on dead creature → fizzle (no effect, action consumed)
//  10. CANTRIP_TOUCH_EFFECTS routing — 'Spare the Dying' routes to applyTouchEffect
//  11. dispatcher safety — unknown cantrip name is a no-op
//  12. resolveCantripTouchEffect returns true when target is null (fizzle, action consumed)
//  13. resolveCantripAction returns false (NOT a self-buff)
//  14. resolveCantripAoE returns false (NOT a caster-centered AoE)
//  15. no CANTRIP_EFFECTS entry (NOT a post-hit rider)
//  16. cleanup is a no-op (no scratch fields on the caster)
//  17. CANTRIP_TOUCH_EFFECTS routing bypasses resolveAttack (no attack hit/miss/damage events)
//  18. DEX save NOT triggered (Spare the Dying has no save — touch range, willing target)
//  19. stabilize effect persists (no 1-round expiration on the TARGET's stabilized state)
//  20. canon text documented (undead/construct exclusion TODO via flag)
//
// Run: npx ts-node src/test/spare_the_dying.test.ts
// ============================================================

import { metadata, applyTouchEffect, cleanup } from '../spells/spare_the_dying';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
  resolveCantripTouchEffect,
} from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { resolveAttack } from '../engine/combat';
import { CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3, Cell, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
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

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []) {
  const width = 10, height = 10, depth = 1;
  const cells: Cell[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'normal', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length ? obstacles : undefined,
  };
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// A Spare the Dying Action — touch-effect, no attack roll, no save.
const SPARE_THE_DYING_ACTION: Action = {
  name: 'Spare the Dying',
  isMultiattack: false,
  attackType: 'special', // touch-effect — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 0, long: 0 }, // Touch
  hitBonus: null,
  damage: null, // no damage — the cantrip stabilizes a downed ally
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Spare the Dying',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Spare the Dying');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'necromancy');
  eq('1d. rangeFt (0 — Touch)', metadata.rangeFt, 0);
  eq('1e. damageDice null (no damage — stabilize only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (instant spell)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + S (NO M) — PHB p.277, canon per 5etools JSON
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. NO material component (canon 5etools JSON: {"v":true,"s":true})',
    metadata.components.m, false);
}

// ============================================================
// 3. metadata exposes isTouchEffect = true
// ============================================================
console.log('\n--- 3. isTouchEffect ---');
{
  eq('3a. isTouchEffect = true (routes via CANTRIP_TOUCH_EFFECTS)',
    metadata.isTouchEffect, true);
}

// ============================================================
// 4. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 4. v1 simplification flags ---');
{
  eq('4a. spareTheDyingTypeExclusionV1Implemented = false (canon: no undead/constructs; v1: no exclusion)',
    metadata.spareTheDyingTypeExclusionV1Implemented, false);
  eq('4b. spareTheDyingRangeEnforcementV1Simplified = true (canon: Touch; v1: no adjacency check)',
    metadata.spareTheDyingRangeEnforcementV1Simplified, true);
}

// ============================================================
// 5. metadata does NOT scale (stabilize is binary)
// ============================================================
console.log('\n--- 5. no scaling ---');
{
  eq('5a. scales = false (Spare the Dying does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 6. applyTouchEffect stabilizes a downed PC ally
// ============================================================
console.log('\n--- 6. stabilize downed PC ally ---');
{
  const caster = makeCombatant('cleric', {
    isPlayer: true,
    pos: { x: 5, y: 5, z: 0 },
  });
  const ally = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    maxHP: 30,
    isUnconscious: true,
    deathSaves: { successes: 1, failures: 2 }, // 1 success, 2 failures (close to death)
    conditions: new Set(['unconscious', 'incapacitated'] as any),
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  eq('6a. ally NOT stabilized before cast', ally._isStabilized, undefined);
  eq('6b. ally has death saves before cast (1 success, 2 failures)',
    ally.deathSaves?.failures, 2);

  const ret = applyTouchEffect(caster, ally, state);
  eq('6c. applyTouchEffect returns true', ret, true);
  eq('6d. ally IS stabilized after cast (_isStabilized flag set)',
    ally._isStabilized, true);
  eq('6e. ally deathSaves RESET to {0, 0} (mirror rollDeathSave stable outcome)',
    ally.deathSaves?.successes, 0);
  eq('6f. ally deathSaves failures RESET to 0',
    ally.deathSaves?.failures, 0);
  // PHB p.197: stable creature remains at 0 HP and unconscious
  eq('6g. ally STILL at 0 HP (stabilize does NOT heal)',
    ally.currentHP, 0);
  eq('6h. ally STILL unconscious (stabilize does NOT awaken)',
    ally.isUnconscious, true);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Spare the Dying'),
  );
  assert('6i. cast log emitted', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('6j. log mentions "stabilized"',
    castLog?.description.toLowerCase().includes('stabilized') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 7. applyTouchEffect on monster at 0 HP → fizzle (no effect, action consumed)
// ============================================================
console.log('\n--- 7. monster at 0 HP → fizzle ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  // Monster at 0 HP — per PHB p.197, monsters die at 0 HP (not fall unconscious).
  // In the engine, monsters at 0 HP have isDead=true (set by applyDamage).
  // We test the defensive branch where isPlayer=false && currentHP=0.
  const monster = makeCombatant('goblin', {
    isPlayer: false,
    currentHP: 0,
    isDead: true, // monsters die at 0 HP in this engine
    isUnconscious: true,
    deathSaves: null, // monsters don't make death saves
  });
  const bf = makeBF([caster, monster]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, monster, state);
  eq('7a. applyTouchEffect returns true (action consumed)', ret, true);
  eq('7b. monster NOT stabilized (dead — beyond stabilization)',
    monster._isStabilized, undefined);

  // The handler should have logged a "no effect" message.
  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('7c. fizzle log emitted (no effect on monster)',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 7b. applyTouchEffect on monster at 0 HP WITHOUT isDead (defensive branch)
// ============================================================
console.log('\n--- 7b. monster at 0 HP (not isDead) → fizzle (defensive) ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  // Edge case: a monster somehow at 0 HP but not flagged dead (defensive branch).
  const monster = makeCombatant('goblin', {
    isPlayer: false,
    currentHP: 0,
    isDead: false, // edge case — not yet flagged dead
  });
  const bf = makeBF([caster, monster]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, monster, state);
  eq('7b.a. applyTouchEffect returns true (action consumed)', ret, true);
  eq('7b.b. monster NOT stabilized (monsters die at 0 HP, PHB p.197)',
    monster._isStabilized, undefined);

  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('7b.c. fizzle log emitted (monster exclusion)',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 8. applyTouchEffect on creature above 0 HP → fizzle
// ============================================================
console.log('\n--- 8. creature above 0 HP → fizzle ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const ally = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 10, // above 0 HP — Spare the Dying has no effect
    deathSaves: { successes: 0, failures: 0 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, ally, state);
  eq('8a. applyTouchEffect returns true (action consumed)', ret, true);
  eq('8b. ally NOT stabilized (above 0 HP — no effect)',
    ally._isStabilized, undefined);
  // deathSaves should NOT have been reset (the spell fizzled).
  eq('8c. ally deathSaves NOT reset (spell fizzled)',
    ally.deathSaves?.successes, 0);

  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('8d. fizzle log emitted (not at 0 HP)',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('8e. log mentions "not at 0 HP"',
    fizzleLog?.description.toLowerCase().includes('0 hp') === true ||
    fizzleLog?.description.toLowerCase().includes('not at 0') === true,
    `got: ${fizzleLog?.description}`);
}

// ============================================================
// 9. applyTouchEffect on dead creature → fizzle
// ============================================================
console.log('\n--- 9. dead creature → fizzle ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const corpse = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isDead: true, // already dead — beyond stabilization
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 3 }, // 3 failures = dead
  });
  const bf = makeBF([caster, corpse]);
  const state = makeState(bf);

  const ret = applyTouchEffect(caster, corpse, state);
  eq('9a. applyTouchEffect returns true (action consumed)', ret, true);
  eq('9b. corpse NOT stabilized (already dead)',
    corpse._isStabilized, undefined);
  // deathSaves should NOT have been reset (the spell fizzled).
  eq('9c. corpse deathSaves NOT reset (3 failures preserved)',
    corpse.deathSaves?.failures, 3);

  const fizzleLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.toLowerCase().includes('no effect'),
  );
  assert('9d. fizzle log emitted (already dead)',
    fizzleLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('9e. log mentions "dead"',
    fizzleLog?.description.toLowerCase().includes('dead') === true,
    `got: ${fizzleLog?.description}`);
}

// ============================================================
// 10. CANTRIP_TOUCH_EFFECTS routing — 'Spare the Dying' routes to applyTouchEffect
// ============================================================
console.log('\n--- 10. CANTRIP_TOUCH_EFFECTS routing ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const ally = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 1 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, ally, 'Spare the Dying', state);
  eq('10a. resolveCantripTouchEffect returns true', ret, true);
  eq('10b. ally stabilized via dispatcher',
    ally._isStabilized, true);
  eq('10c. ally deathSaves RESET via dispatcher',
    ally.deathSaves?.failures, 0);
}

// ============================================================
// 11. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 11. dispatcher safety ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const ally = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 1 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, ally, 'Definitely Not A Cantrip', state);
  eq('11a. unknown cantrip → resolveCantripTouchEffect returns false (fall through)',
    ret, false);
  eq('11b. unknown cantrip → no log events', state.log.events.length, 0);
  eq('11c. unknown cantrip → no flag set on ally',
    ally._isStabilized, undefined);
  eq('11d. unknown cantrip → deathSaves NOT reset',
    ally.deathSaves?.failures, 1);
}

// ============================================================
// 12. resolveCantripTouchEffect returns true when target is null (fizzle)
// ============================================================
console.log('\n--- 12. null target → fizzle (action consumed) ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, null, 'Spare the Dying', state);
  eq('12a. null target → returns true (action consumed, spell fizzles)',
    ret, true);
  eq('12b. null target → no log events (handler not called)',
    state.log.events.length, 0);
}

// ============================================================
// 13. resolveCantripAction returns false (NOT a self-buff)
// ============================================================
console.log('\n--- 13. not a self-buff ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Spare the Dying', state);
  eq('13a. resolveCantripAction returns false (NOT a self-buff)', ret, false);
  eq('13b. no log events', state.log.events.length, 0);
  eq('13c. caster has no scratch fields set',
    caster._isStabilized, undefined);
}

// ============================================================
// 14. resolveCantripAoE returns false (NOT a caster-centered AoE)
// ============================================================
console.log('\n--- 14. not a caster-centered AoE ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Spare the Dying', state);
  eq('14a. resolveCantripAoE returns false', ret, false);
  eq('14b. no log events', state.log.events.length, 0);
}

// ============================================================
// 15. no CANTRIP_EFFECTS entry (NOT a post-hit rider)
// ============================================================
console.log('\n--- 15. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const target = makeCombatant('goblin', { isPlayer: false });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Spare the Dying', state);
  eq('15a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
  eq('15b. no flag set on target', target._isStabilized, undefined);
}

// ============================================================
// 16. cleanup is a no-op (no scratch fields on the caster)
// ============================================================
console.log('\n--- 16. cleanup is a no-op ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  // Set a dummy _isStabilized on the caster (unusual — the flag is normally
  // set on the TARGET, but we want to verify cleanup doesn't touch it).
  caster._isStabilized = true;

  cleanup(caster);

  // cleanup is a no-op on the caster — the _isStabilized flag (if somehow
  // set on the caster) is NOT cleared. The flag persists on the TARGET
  // until the target is healed (the heal subsystem's job).
  eq('16a. cleanup does NOT clear _isStabilized (caster cleanup is a no-op)',
    caster._isStabilized, true);

  // resetBudget integration — also a no-op on the caster.
  const caster2 = makeCombatant('cleric2', { isPlayer: true });
  caster2._isStabilized = true; // dummy
  resetBudget(caster2);
  eq('16b. resetBudget does NOT clear _isStabilized on caster',
    caster2._isStabilized, true);
}

// ============================================================
// 17. CANTRIP_TOUCH_EFFECTS routing bypasses resolveAttack
// ============================================================
console.log('\n--- 17. bypasses resolveAttack ---');
{
  const caster = makeCombatant('cleric', {
    isPlayer: true,
    pos: { x: 5, y: 5, z: 0 },
    actions: [SPARE_THE_DYING_ACTION],
  });
  const ally = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 1 },
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  resolveCantripTouchEffect(caster, ally, 'Spare the Dying', state);

  // Only the "casts Spare the Dying" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('17a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('17b. action event mentions Spare the Dying',
    actionEvents[0]?.description.includes('Spare the Dying') === true,
    `got: ${actionEvents[0]?.description}`);

  // No attack hit/miss/crit/damage events.
  const attackEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit' || e.type === 'damage',
  );
  eq('17c. no attack/damage events (touch-effect bypasses resolveAttack)',
    attackEvents.length, 0);

  // No save events.
  const saveEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'save_success' || e.type === 'save_fail',
  );
  eq('17d. no save events (Spare the Dying has no save)', saveEvents.length, 0);
}

// ============================================================
// 18. DEX save NOT triggered (touch range, willing target)
// ============================================================
console.log('\n--- 18. no DEX save triggered ---');
{
  const caster = makeCombatant('cleric', {
    isPlayer: true,
    pos: { x: 5, y: 5, z: 0 },
  });
  const ally = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 0 },
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  applyTouchEffect(caster, ally, state);

  // Verify no save-related logs.
  const saveLogs = state.log.events.filter(
    (e: CombatEvent) => e.type === 'save_success' || e.type === 'save_fail',
  );
  eq('18a. no save_success/save_fail events', saveLogs.length, 0);

  // Also verify no "fails DC ... save" or "succeeds on DC ... save" in any log.
  const anySaveMention = state.log.events.some(
    (e: CombatEvent) => e.description.toLowerCase().includes('save'),
  );
  eq('18b. no log mentions "save"', anySaveMention, false);
}

// ============================================================
// 19. stabilize effect persists (no 1-round expiration on the TARGET)
// ============================================================
console.log('\n--- 19. stabilize persists on TARGET ---');
{
  const caster = makeCombatant('cleric', { isPlayer: true });
  const ally = makeCombatant('fighter', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 1, failures: 2 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  applyTouchEffect(caster, ally, state);
  eq('19a. ally stabilized', ally._isStabilized, true);

  // Simulate the start of the CASTER's next turn (resetBudget on caster).
  resetBudget(caster);

  // The TARGET's stabilized state should PERSIST (cleanup is a no-op on
  // the caster, and the target's _isStabilized flag is not cleared by
  // the caster's resetBudget).
  eq('19b. ally STILL stabilized after caster resetBudget (persists)',
    ally._isStabilized, true);
  eq('19c. ally deathSaves STILL reset (persists)',
    ally.deathSaves?.failures, 0);

  // Simulate the start of the TARGET's next turn (resetBudget on ally).
  // The target's _isStabilized flag SHOULD persist (the stabilized state
  // is permanent until healed — there is no 1-round expiration on the
  // target's stabilized state).
  resetBudget(ally);
  eq('19d. ally STILL stabilized after own resetBudget (persists)',
    ally._isStabilized, true);
}

// ============================================================
// 20. canon text documented (undead/construct exclusion TODO via flag)
// ============================================================
console.log('\n--- 20. canon text documented ---');
{
  // Verify the metadata flag is set (forward-compat TODO acknowledged).
  eq('20a. spareTheDyingTypeExclusionV1Implemented = false (TODO acknowledged)',
    metadata.spareTheDyingTypeExclusionV1Implemented, false);

  // Verify the canon text is documented in the module header (visual check).
  // The canon text: "This spell has no effect on undead or constructs." (PHB p.277)
  // The handler doesn't check isUndead or isConstruct (the latter doesn't exist
  // on Combatant yet). Future work: a creature-type subsystem.
  // For now, the handler stabilizes any PC at 0 HP (no type exclusion).
  const caster = makeCombatant('cleric', { isPlayer: true });
  const undeadAlly = makeCombatant('undead_fighter', {
    isPlayer: true,
    currentHP: 0,
    isUnconscious: true,
    deathSaves: { successes: 0, failures: 1 },
    isUndead: true, // CANON says Spare the Dying should have no effect on undead
  });
  const bf = makeBF([caster, undeadAlly]);
  const state = makeState(bf);

  applyTouchEffect(caster, undeadAlly, state);

  // v1 does NOT model the type exclusion — the undead ally IS stabilized
  // (this is a known v1 simplification, documented via the flag).
  eq('20b. v1 DOES stabilize undead ally (TODO acknowledged via flag)',
    undeadAlly._isStabilized, true);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
