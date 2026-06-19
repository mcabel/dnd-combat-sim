// ============================================================
// crown_of_madness.test.ts — Crown of Madness spell module
// PHB p.229: 2nd-level enchantment, action, 120 ft, concentration 1 min.
// Effect: WIS save or charmed for the duration.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// save resolution + condition application + slot consumption + logging,
// integration pipeline, and metadata shape.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - WIS 1 + DC 25 = guaranteed fail
//   - WIS 30 + DC 5 = guaranteed success
// ============================================================

import { shouldCast, execute, metadata } from '../spells/crown_of_madness';
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

const CROWN_ACTION: Action = {
  name: 'Crown of Madness',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC for tests
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Crown of Madness (WIS save or charmed, concentration 1 min)',
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

/** Sorcerer at pos (0,0,0) with Crown of Madness + 2 2nd-level slots */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('sorcerer1', {
    name: 'Sorcerer',
    pos,
    actions: [CROWN_ACTION],
    resources: withSlots2(2),
  });
}

function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    wis: 30,           // guaranteed success vs DC 5
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is enchantment', metadata.school, 'enchantment');
eq('range is 120 ft', metadata.rangeFt, 120);
eq('is concentration', metadata.concentration, true);
eq('save ability is wis', metadata.saveAbility, 'wis');
eq('casting time is action', metadata.castingTime, 'action');
eq('forced-attack NOT implemented (v1)', metadata.crownOfMadnessForcedAttackV1Implemented, false);
eq('action maintenance NOT implemented (v1)', metadata.crownOfMadnessActionMaintenanceV1Implemented, false);
eq('end-of-turn save NOT implemented (v1)', metadata.crownOfMadnessEndOfTurnSaveV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Crown of Madness' action
  const caster = makeSorcerer();
  caster.actions = [];
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Crown of Madness action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeSorcerer();
  caster.resources = withSlots2(0);
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeSorcerer();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 };
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range (120 ft — test with far enemy)
  const caster = makeSorcerer();
  const farEnemy = makeWeakEnemy('far', { x: 30, y: 0, z: 0 });  // 150 ft > 120 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (120 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already charmed — skip
  const caster = makeSorcerer();
  const enemy = makeWeakEnemy('e1');
  enemy.conditions.add('charmed');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already charmed', shouldCast(caster, bf) === null);
}

{
  // 2f. Enemy already Crown-of-Madness'd by this caster — skip
  const caster = makeSorcerer();
  const enemy = makeWeakEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Crown of Madness',
    effectType: 'condition_apply', payload: { condition: 'charmed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Crown-of-Madness\'d by this caster', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeSorcerer();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 80) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeSorcerer();
  const far = makeWeakEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeWeakEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

// ============================================================
// 4. execute — save resolution + condition application
// ============================================================

console.log('\n=== 4. execute — save resolution + condition application ===\n');

{
  // 4a. Guaranteed fail (WIS 1 vs DC 25) → charmed applied
  const caster = makeSorcerer();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy charmed on failed save', enemy.conditions.has('charmed'));
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Crown of Madness', caster.concentration?.spellName, 'Crown of Madness');
  assert('Active effect applied (condition_apply:charmed)',
    enemy.activeEffects.some(e => e.effectType === 'condition_apply' && e.payload.condition === 'charmed'));
}

{
  // 4b. Guaranteed success (WIS 30 vs DC 5) → NOT charmed
  const caster = makeSorcerer();
  caster.actions = [{ ...CROWN_ACTION, saveDC: 5 }];
  const enemy = makeStrongEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy NOT charmed on successful save', !enemy.conditions.has('charmed'));
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('No active effect applied on save success',
    !enemy.activeEffects.some(e => e.spellName === 'Crown of Madness'));
}

{
  // 4c. Dead target skipped (stale edge case)
  const caster = makeSorcerer();
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  assert('Dead enemy not charmed', !enemy.conditions.has('charmed'));
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. Concentration started on caster
  const caster = makeSorcerer();
  const enemy = makeWeakEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Crown of Madness', caster.concentration?.spellName, 'Crown of Madness');
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeSorcerer();
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
  assert('Condition_add event emitted (charmed)', condEvents.length === 1);
  assert('Action event mentions "Crown of Madness"', actionEvents[0].description.includes('Crown of Madness'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/crown_of_madness');
  const caster = makeSorcerer();
  caster.concentration = { active: true, spellName: 'Crown of Madness', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster charms highest-threat enemy
  const caster = makeSorcerer();
  const weak = makeWeakEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeWeakEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  assert('Strong enemy charmed', strong.conditions.has('charmed'));
  assert('Weak enemy NOT charmed', !weak.conditions.has('charmed'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeSorcerer();
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
