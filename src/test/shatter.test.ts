// ============================================================
// shatter.test.ts — Shatter spell module
// PHB p.275: 2nd-level evocation, action, range 60 ft, NO concentration.
// Effect: CON save. On fail: 3d8 thunder. On success: half. AoE: 10-ft
//         radius around the highest-threat enemy within 60 ft.
//
// Tests cover shouldCast() with single-target and multi-target AoE,
// execute() save resolution (full/half) per target, slot consumption,
// logging per target, cleanup no-op, integration pipeline, and metadata.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/shatter';
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

const SHATTER_ACTION: Action = {
  name: 'Shatter',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Shatter (CON save, 3d8 thunder, 10-ft radius AoE)',
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

/** Warlock at pos (0,0,0) with Shatter + 2 2nd-level slots */
function makeWarlock(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('warlock1', {
    name: 'Warlock',
    pos,
    actions: [SHATTER_ACTION],
    resources: withSlots2(2),
  });
}

/** Enemy with CON 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with CON 30 (guaranteed success vs DC 5) — used with a low-DC action */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Shatter', metadata.name, 'Shatter');
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('AoE radius is 10 ft', metadata.aoeRadiusFt, 10);
eq('die count is 3', metadata.dieCount, 3);
eq('die sides is 8', metadata.dieSides, 8);
eq('damage type is thunder', metadata.damageType, 'thunder');
eq('NOT concentration', metadata.concentration, false);
eq('save ability is con', metadata.saveAbility, 'con');
eq('casting time is action', metadata.castingTime, 'action');
eq('upcast NOT implemented (v1)', metadata.shatterUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Shatter' action
  const caster = makeWarlock();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster has no Shatter action', shouldCast(caster, bf), null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWarlock();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2c. No enemies in range (60 ft)
  const caster = makeWarlock();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  eq('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf), null);
}

{
  // 2d. Already concentrating — NOT a gate (Shatter is NOT concentration)
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns targets even when caster is already concentrating (NOT concentration spell)',
    shouldCast(caster, bf) !== null);
}

// ============================================================
// 3. shouldCast — AoE targeting
// ============================================================

console.log('\n=== 3. shouldCast — AoE targeting ===\n');

{
  // 3a. Single enemy at 5 ft → AoE hits just that one enemy
  const caster = makeWarlock();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('Returns 1 target when 1 enemy in range', targets !== null && targets!.length === 1);
  if (targets) eq('Single target is the enemy', targets[0].id, 'e1');
}

{
  // 3b. Multiple enemies clustered within 10 ft of the highest-threat enemy
  // All 3 enemies at chebyshev ≤ 2 (≤ 10 ft) of each other.
  const caster = makeWarlock();
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });  // 5 ft from caster
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 80, currentHP: 80 });     // 10 ft from e1
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 60, currentHP: 60 });     // 10 ft from e1
  const bf = makeBF([caster, e1, e2, e3]);
  const targets = shouldCast(caster, bf);
  assert('Returns 3 targets (all in 10-ft radius of center)', targets !== null && targets!.length === 3);
  if (targets) {
    // e1 (maxHP 100) is the center; all 3 are within 10 ft (chebyshev ≤ 2)
    assert('e1 in targets', targets.some(t => t.id === 'e1'));
    assert('e2 in targets', targets.some(t => t.id === 'e2'));
    assert('e3 in targets', targets.some(t => t.id === 'e3'));
  }
}

{
  // 3c. Enemy outside the 10-ft radius (chebyshev > 2) is excluded
  const caster = makeWarlock();
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });  // center, 5 ft from caster
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 });   // 20 ft from e1 — excluded
  const bf = makeBF([caster, e1, far]);
  const targets = shouldCast(caster, bf);
  assert('Returns 1 target (far enemy outside 10-ft radius excluded)',
    targets !== null && targets!.length === 1);
  if (targets) eq('Single target is e1 (the center)', targets[0].id, 'e1');
}

{
  // 3d. Highest-threat enemy within 60 ft is chosen as the center
  // Two enemies at 30 ft — the high-HP one becomes the center, and a
  // nearby lower-HP enemy within 10 ft of the center is also caught.
  const caster = makeWarlock();
  const strong = makeWeakEnemy('strong', { x: 6, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });  // 30 ft from caster
  const adjacent = makeWeakEnemy('adj', { x: 7, y: 0, z: 0 }, { maxHP: 30, currentHP: 30 });     // 5 ft from strong
  const bf = makeBF([caster, strong, adjacent]);
  const targets = shouldCast(caster, bf);
  assert('Returns 2 targets (center + adjacent)', targets !== null && targets!.length === 2);
  if (targets) {
    assert('strong in targets', targets.some(t => t.id === 'strong'));
    assert('adjacent in targets', targets.some(t => t.id === 'adj'));
  }
}

// ============================================================
// 4. execute — save resolution
// ============================================================

console.log('\n=== 4. execute — save resolution ===\n');

{
  // 4a. Guaranteed fail (CON 1 vs DC 25) → full 3d8 thunder damage
  const caster = makeWarlock();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Failed save → full damage in [3, 24] (3d8)', hpLost >= 3 && hpLost <= 24, `got ${hpLost}`);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster NOT concentrating (instantaneous)', caster.concentration, null);
}

{
  // 4b. Guaranteed success (CON 30 vs DC 5) → half damage (floor(3d8/2) = 1..12)
  const caster = makeWarlock();
  caster.actions = [{ ...SHATTER_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const hpLost = 100 - enemy.currentHP;
  assert('Successful save → half damage in [1, 12]', hpLost >= 1 && hpLost <= 12, `got ${hpLost}`);
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4c. Multiple targets each save independently
  const caster = makeWarlock();
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // All 3 took damage (all CON 1, guaranteed fail vs DC 25)
  const e1Lost = 100 - e1.currentHP;
  const e2Lost = 100 - e2.currentHP;
  const e3Lost = 100 - e3.currentHP;
  assert('e1 took damage in [3, 24]', e1Lost >= 3 && e1Lost <= 24, `got ${e1Lost}`);
  assert('e2 took damage in [3, 24]', e2Lost >= 3 && e2Lost <= 24, `got ${e2Lost}`);
  assert('e3 took damage in [3, 24]', e3Lost >= 3 && e3Lost <= 24, `got ${e3Lost}`);
}

{
  // 4d. Dead target skipped (stale edge case)
  const caster = makeWarlock();
  const deadEnemy = makeWeakEnemy('dead', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0, maxHP: 100 });
  const alive = makeWeakEnemy('alive', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, deadEnemy, alive]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // Slot still consumed, dead enemy unchanged, alive enemy damaged
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Dead enemy HP unchanged', deadEnemy.currentHP, 0);
  assert('Alive enemy took damage', alive.currentHP < 100);
}

// ============================================================
// 5. rollDamage range check (3d8 → 3..24)
// ============================================================

console.log('\n=== 5. rollDamage range check ===\n');

{
  for (let i = 0; i < 50; i++) {
    const dmg = rollDamage();
    assert(`rollDamage() in [3, 24] (iteration ${i})`, dmg >= 3 && dmg <= 24, `got ${dmg}`);
  }
}

// ============================================================
// 6. execute — logging
// ============================================================

console.log('\n=== 6. execute — logging ===\n');

{
  const caster = makeWarlock();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const damageEvents = events.filter(e => e.type === 'damage');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Shatter"', actionEvents[0].description.includes('Shatter'));
  eq('1 save event per target (1 target)', saveEvents.length, 1);
  assert('Save event is save_fail (guaranteed fail)', saveEvents[0]?.type === 'save_fail');
  // Per-target damage events: 1 'damage' event per target
  assert('Damage event emitted', damageEvents.length >= 1);
  assert('Save event mentions CON save', saveEvents[0].description.includes('CON'));
}

{
  // 6b. Multi-target: 3 save events, 3 damage events
  const caster = makeWarlock();
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const saveEvents = events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  const damageEvents = events.filter(e => e.type === 'damage');

  eq('3 save events (one per target)', saveEvents.length, 3);
  eq('3 damage events (one per target)', damageEvents.length, 3);
}

// ============================================================
// 7. cleanup — no-op
// ============================================================

console.log('\n=== 7. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/shatter');
  const caster = makeWarlock();
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
  // 8a. Full pipeline: caster targets highest-threat enemy cluster
  const caster = makeWarlock();
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 80, currentHP: 80 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 60, currentHP: 60 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  eq('shouldCast returns 3 targets (all clustered)', targets?.length, 3);
  if (targets) execute(caster, targets, state);

  // All 3 took damage
  assert('e1 took damage', e1.currentHP < 100);
  assert('e2 took damage', e2.currentHP < 80);
  assert('e3 took damage', e3.currentHP < 60);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 8b. After slots exhausted, shouldCast returns null
  const caster = makeWarlock();
  caster.resources = withSlots2(1);
  const enemy = makeWeakEnemy('e1');
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
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
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
