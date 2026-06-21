// ============================================================
// web.test.ts — Web spell module
// PHB p.287: 2nd-level conjuration, action, range 60 ft,
// concentration (1 min). Components: V, S, M (a bit of spiderweb).
//
// Effect: DEX save or restrained (canon: 20-ft cube, difficult terrain,
//         flammable — v1: single target only).
//
// v1 simplifications (documented via metadata flags):
//   - Cube/difficult-terrain NOT modelled (single target).
//   - End-of-turn DEX save + STR-check escape NOT modelled.
//   - Fire destruction NOT modelled.
//   - Concentration NOT enforced (TG-002).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// DEX save resolution (guaranteed fail → restrained; guaranteed
// success → not restrained), effect attachment (condition_apply:
// restrained, sourceIsConcentration: true), logging, cleanup no-op,
// integration pipeline, and metadata shape.
//
// Deterministic save outcomes:
//   - DEX 1  + DC 25 = guaranteed fail  (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5  = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata } from '../spells/web';
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

/** Guaranteed-fail action: DEX 1 + DC 25 → max save 15 < 25 (always fails) */
const WEB_ACTION_FAIL: Action = {
  name: 'Web',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed fail (DEX 1 → max 15)
  saveAbility: 'dex',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Web (DC 25 DEX or restrained, concentration 1 min)',
};

/** Guaranteed-success action: DEX 30 + DC 5 → min save 11 ≥ 5 (always succeeds) */
const WEB_ACTION_SUCCESS: Action = { ...WEB_ACTION_FAIL, saveDC: 5 };

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

/** Wizard with Web + 2 2nd-level slots, DC 25 DEX (guaranteed fail) */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [WEB_ACTION_FAIL],
    resources: withSlots2(2),
  });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25) */
function makeSlowEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    dex: 1,            // guaranteed fail vs DC 25 (mod -5, max roll 15 < 25)
    pos, ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5) */
function makeNimbleEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id, faction: 'enemy',
    dex: 30,           // guaranteed success vs DC 5 (mod +10, min roll 11 ≥ 5)
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Web', metadata.name, 'Web');
eq('level is 2', metadata.level, 2);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('is concentration', metadata.concentration, true);
eq('save ability is dex', metadata.saveAbility, 'dex');
eq('casting time is action', metadata.castingTime, 'action');
eq('difficult terrain IS implemented (v1)', metadata.webDifficultTerrainV1Implemented, true);
eq('destruction NOT implemented (v1)', metadata.webDestructionV1Implemented, false);
eq('escape action NOT implemented (v1)', metadata.webEscapeActionV1Implemented, false);
eq('upcast NOT implemented (v1)', metadata.webUpcastV1Implemented, false);
eq('concentration enforcement NOW implemented (Session 34 TG-002)', metadata.webConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates (incl. concentration)
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Web' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeSlowEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster has no Web action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeSlowEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating on another spell
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeSlowEnemy('e1');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No enemies in range
  const caster = makeWizard();
  const farEnemy = makeSlowEnemy('far', { x: 20, y: 0, z: 0 });   // 100 ft > 60 ft
  const bf = makeBF([caster, farEnemy]);
  assert('Returns null when no enemies in range (60 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Enemy already restrained — skip
  const caster = makeWizard();
  const enemy = makeSlowEnemy('e1');
  enemy.conditions.add('restrained');
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already restrained', shouldCast(caster, bf) === null);
}

{
  // 2f. Enemy already Web'd by this caster — skip
  const caster = makeWizard();
  const enemy = makeSlowEnemy('e1');
  enemy.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Web',
    effectType: 'condition_apply', payload: { condition: 'restrained' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null when enemy already Web\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2g. Dead enemy — skip
  const caster = makeWizard();
  const deadEnemy = makeSlowEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  assert('Returns null when only enemy is dead', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Highest-threat (maxHP) enemy selected first
  const caster = makeWizard();
  const weak = makeSlowEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeSlowEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  eq('Highest-threat (maxHP 80) enemy selected', shouldCast(caster, bf)?.id, 'strong');
}

{
  // 3b. Tie-break: closest enemy first
  const caster = makeWizard();
  const far = makeSlowEnemy('far', { x: 5, y: 0, z: 0 }, { maxHP: 40 });
  const near = makeSlowEnemy('near', { x: 1, y: 0, z: 0 }, { maxHP: 40 });
  const bf = makeBF([caster, far, near]);
  eq('Closest enemy wins tie-break', shouldCast(caster, bf)?.id, 'near');
}

{
  // 3c. Same-faction allies skipped
  const caster = makeWizard();
  const ally = makeCombatant('ally', { faction: 'party', maxHP: 90, pos: { x: 1, y: 0, z: 0 } });
  const enemy = makeSlowEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, ally, enemy]);
  eq('Same-faction ally skipped, enemy selected', shouldCast(caster, bf)?.id, 'e1');
}

// ============================================================
// 4. execute — save resolution
// ============================================================

console.log('\n=== 4. execute — save resolution ===\n');

{
  // 4a. Guaranteed fail (DEX 1 vs DC 25) → restrained applied
  const caster = makeWizard();
  const enemy = makeSlowEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy restrained on failed save', enemy.conditions.has('restrained'));
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Web', caster.concentration?.spellName, 'Web');
}

{
  // 4b. Guaranteed success (DEX 30 vs DC 5) → NOT restrained
  const caster = makeWizard();
  caster.actions = [WEB_ACTION_SUCCESS];      // DC 5
  const enemy = makeNimbleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Enemy NOT restrained on successful save', !enemy.conditions.has('restrained'));
  eq('Slot still consumed on save success', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('No active effect applied on save success',
    !enemy.activeEffects.some(e => e.spellName === 'Web'));
}

{
  // 4c. Dead target skipped (stale plan) — no restrained
  const caster = makeWizard();
  const enemy = makeSlowEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  assert('Dead enemy NOT restrained', !enemy.conditions.has('restrained'));
  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. Concentration started on caster
  const caster = makeWizard();
  const enemy = makeSlowEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Web', caster.concentration?.spellName, 'Web');
}

{
  // 4e. Existing concentration broken (safety net)
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Hold Person', dcIfHit: 10 };
  const enemy = makeSlowEnemy('e1');
  // Add an effect from prior concentration on enemy
  enemy.activeEffects.push({
    id: 'eff_hp', casterId: caster.id, spellName: 'Hold Person',
    effectType: 'condition_apply', payload: { condition: 'paralyzed' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  eq('Concentration switched to Web', caster.concentration?.spellName, 'Web');
  assert('Prior Hold Person effect removed from enemy',
    !enemy.activeEffects.some(e => e.spellName === 'Hold Person'));
}

{
  // 4f. Active effect attached with correct shape (on save fail)
  const caster = makeWizard();
  const enemy = makeSlowEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  const webEff = enemy.activeEffects.find(e =>
    e.effectType === 'condition_apply' && e.payload.condition === 'restrained'
  );
  assert('Active effect attached (condition_apply:restrained)', webEff !== undefined);
  if (webEff) {
    eq('Effect sourceIsConcentration is true', webEff.sourceIsConcentration, true);
    eq('Effect spellName is Web', webEff.spellName, 'Web');
    eq('Effect casterId is caster', webEff.casterId, caster.id);
    eq('Effect payload.condition is restrained', webEff.payload.condition, 'restrained');
  }
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  // 5a. On save fail: action + save_fail + condition_add events
  const caster = makeWizard();
  const enemy = makeSlowEnemy('e1');
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
  assert('First action event mentions "Web"', actionEvents[0].description.includes('Web'));
  assert('Condition_add mentions restrained or WEB',
    condEvents[0].description.includes('restrained') || condEvents[0].description.includes('WEB'));
}

{
  // 5b. On save success: save_success event, no condition_add event
  const caster = makeWizard();
  caster.actions = [WEB_ACTION_SUCCESS];
  const enemy = makeNimbleEnemy('e1');
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
  const { cleanup } = require('../spells/web');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Web', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster, not by cleanup)
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change concentration spellName', caster.concentration?.spellName, 'Web');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster restrains highest-threat enemy
  const caster = makeWizard();
  const weak = makeSlowEnemy('weak', { x: 1, y: 0, z: 0 }, { maxHP: 20 });
  const strong = makeSlowEnemy('strong', { x: 2, y: 0, z: 0 }, { maxHP: 80 });
  const bf = makeBF([caster, weak, strong]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the strong enemy (maxHP 80)', target?.id, 'strong');
  if (target) execute(caster, target, state);

  assert('Strong enemy restrained', strong.conditions.has('restrained'));
  assert('Weak enemy NOT restrained', !weak.conditions.has('restrained'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Web', caster.concentration?.spellName, 'Web');
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeSlowEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, enemy]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 7c. Nimble enemy resists — not restrained, slot still consumed
  const caster = makeWizard();
  caster.actions = [WEB_ACTION_SUCCESS];
  const enemy = makeNimbleEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  assert('Nimble enemy NOT restrained (save succeeded)', !enemy.conditions.has('restrained'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration started regardless of save outcome', caster.concentration?.spellName, 'Web');
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
