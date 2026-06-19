// ============================================================
// suggestion.test.ts — Suggestion spell module
// PHB p.279: 2nd-level enchantment, action, range 30 ft,
// concentration (8 hr canon; v1: 1 min combat duration).
// Components: V, M (a snake's tongue + bit of honeycomb or sweet oil).
//
// Effect: WIS save or charmed (one command). v1: charmed condition only —
//         the command-subsystem is NOT modelled.
//
// v1 simplifications (documented via metadata flags):
//   - Command-subsystem NOT modelled (charmed condition only).
//   - Duration simplified (canon 8 hr → v1 1 min).
//   - Damage-end NOT modelled.
//   - Concentration NOT enforced (TG-002).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// WIS save resolution (guaranteed fail → charmed; guaranteed success →
// not charmed), effect attachment (condition_apply:charmed,
// sourceIsConcentration: true), logging, cleanup no-op, integration
// pipeline, and metadata shape.
//
// Deterministic save outcomes:
//   - WIS 1  + DC 25 = guaranteed fail  (mod -5, even nat 20 → 15 < 25)
//   - WIS 30 + DC 5  = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/suggestion';
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
const SUGGESTION_ACTION_FAIL: Action = {
  name: 'Suggestion',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 30, long: 30 },
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
  description: 'Suggestion (DC 25 WIS or charmed, concentration 1 min)',
};

/** Guaranteed-success action: WIS 30 + DC 5 → min save 11 ≥ 5 (always succeeds) */
const SUGGESTION_ACTION_SUCCESS: Action = { ...SUGGESTION_ACTION_FAIL, saveDC: 5 };

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

/** Warlock with Suggestion + 2 2nd-level slots, DC 25 WIS (guaranteed fail) */
function makeWarlock(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('warlock1', {
    name: 'Warlock',
    pos,
    actions: [SUGGESTION_ACTION_FAIL],
    resources: withSlots2(2),
  });
}

/** Enemy with WIS 1 (guaranteed fail vs DC 25) */
function makeGullibleEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    wis: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos, ...overrides,
  });
}

/** Enemy with WIS 30 (guaranteed success vs DC 5) */
function makeStoicEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    wis: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Suggestion', metadata.name, 'Suggestion');
eq('level is 2', metadata.level, 2);
eq('school is enchantment', metadata.school, 'enchantment');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('is concentration', metadata.concentration, true);
eq('save ability is wis', metadata.saveAbility, 'wis');
eq('casting time is action', metadata.castingTime, 'action');
eq('command-subsystem NOT implemented (v1)', metadata.suggestionCommandSubystemV1Implemented, false);
eq('duration simplified (v1)', metadata.suggestionDurationV1Simplified, true);
eq('upcast NOT implemented (v1)', metadata.suggestionUpcastV1Implemented, false);
eq('concentration enforcement NOT implemented (v1)', metadata.suggestionConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates (incl. concentration)
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Suggestion' action
  const caster = makeWarlock();
  caster.actions = [];
  const enemy = makeGullibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Suggestion action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWarlock();
  caster.resources = withSlots2(0);
  const enemy = makeGullibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating on another spell
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeGullibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range (30 ft)
  const caster = makeWarlock();
  const farEnemy = makeGullibleEnemy('far', { x: 20, y: 0, z: 0 });   // 100 ft > 30 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (30 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already charmed — skip
  const caster = makeWarlock();
  const enemy = makeGullibleEnemy('e1');
  enemy.conditions.add('charmed');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already charmed', shouldCast(caster, bf) === null);
}

{
  // 2f. Enemy already Suggested by this caster — skip
  const caster = makeWarlock();
  const enemy = makeGullibleEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Suggestion',
    effectType: 'condition_apply', payload: { condition: 'charmed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Suggested by this caster', shouldCast(caster, bf) === null);
}

{
  // 2g. Dead enemy — skip
  const caster = makeWarlock();
  const deadEnemy = makeGullibleEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  assert('Returns null when only enemy is dead', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeWarlock();
  const weak = makeGullibleEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeGullibleEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 80) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeWarlock();
  const far = makeGullibleEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeGullibleEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 3c. Same-faction allies skipped
  const caster = makeWarlock();
  const ally = makeCombatant('ally', { faction: 'party', maxHP: 90, pos: { x: 1, y: 0, z: 0 } });
  const enemy = makeGullibleEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, ally, enemy]);
  eq('Same-faction ally skipped, enemy selected', shouldCast(caster, bf)?.id, 'e1');
}

// ============================================================
// 4. execute — save resolution
// ============================================================

console.log('\n=== 4. execute — save resolution ===\n');

{
  // 4a. Guaranteed fail (WIS 1 vs DC 25) → charmed applied
  const caster = makeWarlock();
  const enemy = makeGullibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy charmed on failed save', enemy.conditions.has('charmed'));
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Suggestion', caster.concentration?.spellName, 'Suggestion');
}

{
  // 4b. Guaranteed success (WIS 30 vs DC 5) → NOT charmed
  const caster = makeWarlock();
  caster.actions = [SUGGESTION_ACTION_SUCCESS];      // DC 5
  const enemy = makeStoicEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy NOT charmed on successful save', !enemy.conditions.has('charmed'));
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('No active effect applied on save success',
    !enemy.activeEffects.some(e => e.spellName === 'Suggestion'));
}

{
  // 4c. Dead target skipped (stale plan) — no charmed
  const caster = makeWarlock();
  const enemy = makeGullibleEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  assert('Dead enemy NOT charmed', !enemy.conditions.has('charmed'));
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. Concentration started on caster
  const caster = makeWarlock();
  const enemy = makeGullibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Suggestion', caster.concentration?.spellName, 'Suggestion');
}

{
  // 4e. Existing concentration broken (safety net)
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeGullibleEnemy('e1');
  // Add an effect from prior concentration on enemy
  enemy.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Suggestion', caster.concentration?.spellName, 'Suggestion');
  assert('Prior Hold Person effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

{
  // 4f. Active effect attached with correct shape (on save fail)
  const caster = makeWarlock();
  const enemy = makeGullibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const suggEff = enemy.activeEffects.find(e =>
    e.effectType === 'condition_apply' && e.payload.condition === 'charmed'
  );
  assert('Active effect attached (condition_apply:charmed)', suggEff !== undefined);
  if (suggEff) {
    eq('Effect sourceIsConcentration is true', suggEff.sourceIsConcentration, true);
    eq('Effect spellName is Suggestion', suggEff.spellName, 'Suggestion');
    eq('Effect casterId is caster', suggEff.casterId, caster.id);
    eq('Effect payload.condition is charmed', suggEff.payload.condition, 'charmed');
  }
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  // 5a. On save fail: action + save_fail + condition_add events
  const caster = makeWarlock();
  const enemy = makeGullibleEnemy('e1');
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
  assert('Condition_add event emitted (charmed applied)', condEvents.length === 1);
  assert('First action event mentions "Suggestion"', actionEvents[0].description.includes('Suggestion'));
  assert('Condition_add mentions charmed or CHARMED',
    condEvents[0].description.toLowerCase().includes('charmed'));
}

{
  // 5b. On save success: save_success event, no condition_add event
  const caster = makeWarlock();
  caster.actions = [SUGGESTION_ACTION_SUCCESS];
  const enemy = makeStoicEnemy('e1');
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
  const { cleanup } = require('../spells/suggestion');
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Suggestion', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster, not by cleanup)
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Suggestion');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: warlock charms highest-threat enemy
  const caster = makeWarlock();
  const weak = makeGullibleEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeGullibleEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  assert('Strong enemy charmed', strong.conditions.has('charmed'));
  assert('Weak enemy NOT charmed', !weak.conditions.has('charmed'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Suggestion', caster.concentration?.spellName, 'Suggestion');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeWarlock();
  caster.resources = withSlots2(1);
  const enemy = makeGullibleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 7c. Stoic enemy resists — not charmed, slot still consumed
  const caster = makeWarlock();
  caster.actions = [SUGGESTION_ACTION_SUCCESS];
  const enemy = makeStoicEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Stoic enemy NOT charmed (save succeeded)', !enemy.conditions.has('charmed'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration started regardless of save outcome', caster.concentration?.spellName, 'Suggestion');
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
