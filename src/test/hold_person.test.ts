// ============================================================
// hold_person.test.ts — Hold Person spell module
// PHB p.251: 2nd-level enchantment, action, 60 ft, concentration 1 min.
// Effect: WIS save or paralyzed for the duration.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// save resolution + condition application + slot consumption + logging,
// integration pipeline, and metadata shape.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - WIS 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - WIS 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/hold_person';
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

const HOLD_PERSON_ACTION: Action = {
  name: 'Hold Person',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests (WIS 1 → max 15)
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Hold Person (WIS save or paralyzed, concentration 1 min)',
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

/** Cleric at pos (0,0,0) with Hold Person + 2 2nd-level slots, WIS 16 (DC 25 set in action) */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [HOLD_PERSON_ACTION],
    resources: withSlots2(2),
  });
}

/** Enemy with WIS 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos,
    ...overrides,
  });
}

/** Enemy with WIS 30 (guaranteed success vs DC 5) — uses a custom action with low DC */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is enchantment', metadata.school, 'enchantment');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('save ability is wis', metadata.saveAbility, 'wis');
eq('casting time is action', metadata.castingTime, 'action');
eq('end-of-turn save NOT implemented (v1)', metadata.holdPersonEndOfTurnSaveV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.holdPersonUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Hold Person' action
  const caster = makeCleric();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns null when caster has no Hold Person action', result === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns null when no 2nd-level slots', result === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns null when caster is already concentrating', result === null);
}

{
  // 2d. No enemies in range
  const caster = makeCleric();
  const farEnemy = makeWeakEnemy('far', { x: 20, y: 0, z: 0 });  // 100 ft
  const bf = makeBF([caster, farEnemy]);
  const result = shouldCast(caster, bf);
  assert('Returns null when no enemies in range (60 ft)', result === null);
}

{
  // 2e. Enemy already paralyzed — skip
  const caster = makeCleric();
  const enemy = makeWeakEnemy('e1');
  enemy.conditions.add('paralyzed');
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns null when enemy already paralyzed', result === null);
}

{
  // 2f. Enemy already Hold-Person'd by this caster — skip
  const caster = makeCleric();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns null when enemy already Hold-Person\'d by this caster', result === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeCleric();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const result = shouldCast(caster, bf);
  eq('Highest-threat (maxHP 80) enemy selected', result?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeCleric();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  const result = shouldCast(caster, bf);
  eq('Closest enemy wins tie-break', result?.id, 'near');
}

// ============================================================
// 4. execute — save resolution + condition application
// ============================================================

console.log('\n=== 4. execute — save resolution + condition application ===\n');

{
  // 4a. Guaranteed fail (WIS 1 vs DC 25) → paralyzed applied
  const caster = makeCleric();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy paralyzed on failed save', enemy.conditions.has('paralyzed'));
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Hold Person', caster.concentration?.spellName, 'Hold Person');
  assert('Active effect applied (condition_apply:paralyzed)',
    enemy.activeEffects.some(e => e.effectType === 'condition_apply' && e.payload.condition === 'paralyzed'));
}

{
  // 4b. Guaranteed success (WIS 30 vs DC 5) → NOT paralyzed
  const caster = makeCleric();
  // Override the action's saveDC to 5 for guaranteed success
  caster.actions = [{ ...HOLD_PERSON_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy NOT paralyzed on successful save', !enemy.conditions.has('paralyzed'));
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('No active effect applied on save success',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

{
  // 4c. Dead target skipped (stale edge case)
  const caster = makeCleric();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // Force-execute with the dead enemy
  execute(caster, enemy, state);

  assert('Dead enemy not paralyzed', !enemy.conditions.has('paralyzed'));
  // Slot is still consumed (execute started before the dead-check)
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. Concentration started on caster
  const caster = makeCleric();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Hold Person', caster.concentration?.spellName, 'Hold Person');
}

{
  // 4e. Existing concentration broken (safety net)
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  // Add an active effect from the prior concentration
  enemy.activeEffects.push({
    id: 'eff_bless', casterId: caster.id, spellName: 'Bless',
    effectType: 'bless_die', payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Hold Person', caster.concentration?.spellName, 'Hold Person');
  // The prior Bless effect on enemy should be removed by removeEffectsFromCaster
  assert('Prior Bless effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Bless'));
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCleric();
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
  assert('Condition_add event emitted (paralyzed)', condEvents.length === 1);

  // First action event mentions "Hold Person"
  const firstAction = actionEvents[0];
  assert('Action event description mentions "Hold Person"', firstAction.description.includes('Hold Person'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/hold_person');
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster, not by cleanup)
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster paralyzes highest-threat enemy
  const caster = makeCleric();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  assert('Strong enemy paralyzed', strong.conditions.has('paralyzed'));
  assert('Weak enemy NOT paralyzed', !weak.conditions.has('paralyzed'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Hold Person', caster.concentration?.spellName, 'Hold Person');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
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

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
