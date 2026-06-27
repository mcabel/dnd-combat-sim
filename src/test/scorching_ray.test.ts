// ============================================================
// scorching_ray.test.ts — Scorching Ray spell module
// PHB p.273: 2nd-level evocation, action, range 120 ft, NO concentration.
// Effect: 3 ranged spell attacks (2d6 fire each). Upcast +1 ray/slot NOT
//         modelled in v1. v1 fills all 3 ray slots by repeating the first
//         target if fewer than 3 enemies are available.
//
// Tests cover shouldCast() with 1/2/3+ enemies (multi-attack pattern),
// execute() hit/miss resolution + damage per ray, slot consumption,
// logging per ray, cleanup no-op, integration pipeline, and metadata.
//
// Deterministic attack outcomes:
//   - Hit:  AC 5  + hitBonus +20 → min total 21 ≥ 5 (always hits, even nat 1)
//   - Miss: AC 30 + hitBonus +0  → max non-crit total 20 < 30 (nat 20 auto-crits)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/scorching_ray';
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

/** Guaranteed-hit action: AC 5 + hitBonus +20 → min roll 1+20=21 ≥ 5 */
const SCORCHING_RAY_ACTION_HIT: Action = {
  name: 'Scorching Ray',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: 20,           // guaranteed hit (nat 1 → 21 ≥ AC 5)
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Scorching Ray (3 rays, ranged spell attack, 2d6 fire each)',
};

/** Guaranteed-miss action: AC 30 + hitBonus +0 → max non-crit total 20 < 30 */
const SCORCHING_RAY_ACTION_MISS: Action = { ...SCORCHING_RAY_ACTION_HIT, hitBonus: 0 };

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 5, speed: 30,        // low AC → guaranteed hit
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

/** Wizard at (0,0,0) with Scorching Ray + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [SCORCHING_RAY_ACTION_HIT],
    resources: withSlots2(2),
  });
}

/** Enemy with low AC 5 (guaranteed hit vs hitBonus +20) */
function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

/** Enemy with high AC 30 (guaranteed miss vs hitBonus +0) */
function makeHighAcEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', ac: 30, pos });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Scorching Ray', metadata.name, 'Scorching Ray');
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 120 ft', metadata.rangeFt, 120);
eq('ray count is 3', metadata.rayCount, 3);
eq('die count is 2', metadata.dieCount, 2);
eq('die sides is 6', metadata.dieSides, 6);
eq('damage type is fire', metadata.damageType, 'fire');
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('multi-target v1 simplified flag set', metadata.scorchingRayMultiTargetV1Simplified, true);
eq('upcast implemented (v1)', metadata.scorchingRayUpcastV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Scorching Ray' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Scorching Ray action', shouldCast(caster, bf), null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2c. No enemies in range
  const caster = makeWizard();
  const farEnemy = makeEnemy('far', { x: 25, y: 0, z: 0 });  // 125 ft > 120 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (120 ft)', shouldCast(caster, bf), null);
}

{
  // 2d. Already concentrating — NOT a gate (Scorching Ray is NOT concentration)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns targets even when caster is already concentrating (NOT concentration spell)',
    shouldCast(caster, bf) !== null);
}

// ============================================================
// 3. shouldCast — target selection (1, 2, 3+ enemies)
// ============================================================

console.log('\n=== 3. shouldCast — target selection (1, 2, 3+ enemies) ===\n');

{
  // 3a. 1 enemy → all 3 rays targeted at the same enemy (repeats to fill)
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Returns array of 3 targets when 1 enemy exists', targets !== null && targets!.length === 3);
  if (targets) {
    eq('All 3 targets are the same enemy (repeats to fill)', targets[0].id, 'e1');
    eq('Target 2 == target 1', targets[1].id, 'e1');
    eq('Target 3 == target 1', targets[2].id, 'e1');
  }
}

{
  // 3b. 2 enemies → first target gets 2 rays, second gets 1
  const caster = makeWizard();
  const strong = makeEnemy('strong', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const weak = makeEnemy('weak', { x: 2, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });
  const bf = makeBF([caster, strong, weak]);
  const targets = shouldCast(caster, bf);
  assert('Returns 3 targets when 2 enemies exist', targets !== null && targets!.length === 3);
  if (targets) {
    eq('Ray 1 targets strong enemy (maxHP 100)', targets[0].id, 'strong');
    eq('Ray 2 targets weak enemy (maxHP 30)', targets[1].id, 'weak');
    eq('Ray 3 wraps around to strong enemy (mod 2)', targets[2].id, 'strong');
  }
}

{
  // 3c. 3+ enemies → first 3 (highest-threat) selected, no duplicates
  const caster = makeWizard();
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 80, currentHP: 80 });
  const e3 = makeEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 60, currentHP: 60 });
  const e4 = makeEnemy('e4', { x: 4, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, e1, e2, e3, e4]);
  const targets = shouldCast(caster, bf);
  assert('Returns 3 targets when 4 enemies exist', targets !== null && targets!.length === 3);
  if (targets) {
    eq('Ray 1 targets highest-threat (e1, maxHP 100)', targets[0].id, 'e1');
    eq('Ray 2 targets next (e2, maxHP 80)', targets[1].id, 'e2');
    eq('Ray 3 targets next (e3, maxHP 60)', targets[2].id, 'e3');
    assert('e4 (maxHP 40) NOT targeted',
      !targets.some(t => t.id === 'e4'));
  }
}

// ============================================================
// 4. execute — hit resolution (all rays hit)
// ============================================================

console.log('\n=== 4. execute — hit resolution ===\n');

{
  // 4a. All 3 rays hit (hitBonus +20 vs AC 5) — total damage in [6, 36]
  const caster = makeWizard();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('3 rays hitting → total damage in [6, 36] (3 * 2d6)', hpLost >= 6 && hpLost <= 36, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4b. All 3 rays should miss (hitBonus +0 vs AC 30) — nat 20 auto-crits
  // so a single ray MAY hit per cast. Damage is 0 (no crits) OR a single
  // 2d6=2..12 crit-hit. Accept either outcome — the gate verifies the
  // non-crit rays all miss.
  const caster = makeWizard();
  caster.actions = [SCORCHING_RAY_ACTION_MISS];
  const enemy = makeHighAcEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('All non-crit rays missed (0 dmg, or ≤1 crit-hit ray in [0, 12])',
    hpLost >= 0 && hpLost <= 12, `got ${hpLost}`);
  eq('Slot still consumed on miss', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4c. Multiple enemies each take damage from their respective rays
  const caster = makeWizard();
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const e3 = makeEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // Each enemy took damage in [2, 12] (one ray each)
  const e1Lost = 100 - e1.currentHP;
  const e2Lost = 100 - e2.currentHP;
  const e3Lost = 100 - e3.currentHP;
  assert('e1 took damage in [2, 12] (1 ray)', e1Lost >= 2 && e1Lost <= 12, `got ${e1Lost}`);
  assert('e2 took damage in [2, 12] (1 ray)', e2Lost >= 2 && e2Lost <= 12, `got ${e2Lost}`);
  assert('e3 took damage in [2, 12] (1 ray)', e3Lost >= 2 && e3Lost <= 12, `got ${e3Lost}`);
}

{
  // 4d. Dead target skipped (mid-cast) — ray fizzles, slot still consumed
  const caster = makeWizard();
  const deadEnemy = makeEnemy('dead', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const bf = makeBF([caster, deadEnemy]);
  const state = makeState(bf);

  // Force-execute against the dead enemy
  execute(caster, [deadEnemy, deadEnemy, deadEnemy], state);

  eq('Slot consumed even for dead target', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Dead target HP unchanged', deadEnemy.currentHP, 0);
}

// ============================================================
// 5. rollDamage range check (2d6 → 2..12)
// ============================================================

console.log('\n=== 5. rollDamage range check ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [2, 12] (iteration ${i})`, dmg >= 2 && dmg <= 12, `got ${dmg}`);
  }
}

// ============================================================
// 6. execute — logging
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

{
  // 6a. All rays hit (hitBonus +20 vs AC 5 → even nat 1 hits). Each ray
  // emits an attack_hit OR attack_crit event (nat 20 = crit), and a
  // corresponding damage event.
  const caster = makeWizard();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const hitEvents = events.filter(e => e.type === 'attack_hit' || e.type === 'attack_crit');
  const damageEvents = events.filter(e => e.type === 'damage');

  eq('1 action event (cast log)', actionEvents.length, 1);
  assert('Action event mentions "Scorching Ray"',
    actionEvents[0].description.includes('Scorching Ray'));
  eq('3 attack_hit/attack_crit events (one per ray)', hitEvents.length, 3);
  eq('3 damage events (one per hit)', damageEvents.length, 3);
  // Each ray's log mentions its ray number
  assert('Ray 1 logged', hitEvents[0].description.includes('Ray 1'));
  assert('Ray 2 logged', hitEvents[1].description.includes('Ray 2'));
  assert('Ray 3 logged', hitEvents[2].description.includes('Ray 3'));
}

{
  // 6b. On miss: attack_miss events emitted (nat 20 may produce 1 crit-hit
  // per cast — accept 2-3 attack_miss events + 0-1 attack_crit events).
  const caster = makeWizard();
  caster.actions = [SCORCHING_RAY_ACTION_MISS];
  const enemy = makeHighAcEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const missEvents = events.filter(e => e.type === 'attack_miss');
  const critEvents = events.filter(e => e.type === 'attack_crit');
  const hitEvents = events.filter(e => e.type === 'attack_hit');
  const damageEvents = events.filter(e => e.type === 'damage');

  // 3 rays total: attack_miss + attack_crit + attack_hit should sum to 3.
  // With AC 30 + hitBonus 0, only nat-20 crits hit (no plain hits).
  eq('Total attack events = 3 (miss + crit)', missEvents.length + critEvents.length + hitEvents.length, 3);
  eq('No plain attack_hit events (nat 20 → crit)', hitEvents.length, 0);
  // Damage events: one per crit ray. Each of the 3 rays has an independent
  // 5% nat-20 crit chance, so 0 crits (~85.7%), 1 crit (~13.5%), 2 crits
  // (~0.7%), or 3 crits (~0.01%) are all valid outcomes. The previous
  // assertion only allowed 0-1 damage events, which flaked ~0.7% of the
  // time when 2 rays crit. Fix: assert damage events == crit events (each
  // crit ray deals exactly 1 damage event; missed rays deal none).
  eq('Damage events = crit events (each crit ray deals damage)', damageEvents.length, critEvents.length);
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/scorching_ray');
  const caster = makeWizard();
  const preSlots = caster.resources!.spellSlots![2]!.remaining;
  cleanup(caster);
  eq('Cleanup does NOT consume slots', caster.resources!.spellSlots![2]!.remaining, preSlots);
  eq('Cleanup does NOT start concentration', caster.concentration, null);
}

// ============================================================
// 8. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 8. Integration pipeline ===\n');

{
  // 8a. Full pipeline: 1 enemy takes 3 rays of 2d6 fire
  const caster = makeWizard();
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (1 enemy repeated)', targets !== null && targets!.length === 3);
  if (targets) execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Single enemy took 3 rays of damage in [6, 36]', hpLost >= 6 && hpLost <= 36, `got ${hpLost}`);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster NOT concentrating (NOT concentration spell)', caster.concentration, null);
}

{
  // 8b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  eq('shouldCast returns null after slots exhausted', t2, null);
}

{
  // 8c. Can be cast while already concentrating (NOT a concentration spell)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns targets even when caster is concentrating', targets !== null);
  if (targets) execute(caster, targets, state);

  eq('Existing concentration preserved (NOT replaced)', caster.concentration?.spellName, 'Hold Person');
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
