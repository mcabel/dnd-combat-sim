// ============================================================
// darkvision.test.ts — Darkvision spell module
// PHB p.230: 2nd-level transmutation, action, range Touch, NO concentration (8 hr).
// Effect: touched creature gains darkvision 60 ft.
//
// v1 simplifications (documented via metadata flags):
//   - Vision subsystem NOT implemented — `_darkvisionActive` flag is forward-
//     compat only (computeLOS does not query it yet).
//   - 8-hr duration simplified (persists for combat — no cleanup).
//   - Upcast +20 ft/slot-level NOT modelled.
//   - NOT a concentration spell (PHB p.230: 8 hr, no concentration).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// scratch-field application + slot consumption + logging, integration
// pipeline, and metadata shape (including the v1 forward-compat flags).
// ============================================================

import { shouldCast, execute, metadata } from '../spells/darkvision';
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

const DARKVISION_ACTION: Action = {
  name: 'Darkvision',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
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
  description: 'Darkvision (target gains darkvision 60 ft, 8 hr, NOT concentration)',
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

/** Wizard at (0,0,0) with Darkvision + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [DARKVISION_ACTION],
    resources: withSlots2(2),
  });
}

function makeAlly(
  id: string,
  pos: Vec3 = { x: 1, y: 0, z: 0 },
  overrides: Partial<Combatant> = {},
): Combatant {
  return makeCombatant(id, { name: id, pos, ...overrides });
}

// ============================================================
// 1. Metadata (including v1 forward-compat flags)
// ============================================================

console.log('\n=== 1. Metadata (including v1 flags) ===\n');

eq('name is Darkvision', metadata.name, 'Darkvision');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('darkvisionRangeFt is 60', (metadata as any).darkvisionRangeFt, 60);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: vision integration NOT implemented',
  (metadata as any).darkvisionVisionIntegrationV1Implemented, false);
eq('v1: duration simplified (persists for combat)',
  (metadata as any).darkvisionDurationV1Simplified, true);
eq('v1: upcast NOT implemented',
  (metadata as any).darkvisionUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + priority ===\n');

{
  // 2a. Caster lacks 'Darkvision' action
  const caster = makeWizard();
  caster.actions = [];
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Darkvision action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No allies in range. Caster self is a valid candidate, so first
  // mark the caster as already-Darkvision'd (so it is skipped), then put
  // the only other ally out of range.
  const caster = makeWizard();
  caster._darkvisionActive = true;
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const farAlly = makeAlly('far', { x: 5, y: 0, z: 0 });  // 25 ft
  const bf = makeBF([caster, farAlly]);
  assert('Returns null when no allies in range (5 ft)', shouldCast(caster, bf) === null);
}

{
  // 2d. Already concentrating — Darkvision is NOT concentration, so
  // this should NOT block casting.
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('NOT concentration: cast allowed while concentrating on another spell', result !== null);
}

{
  // 2e. Ally already Darkvision'd by this caster — skip. Caster self is
  // also a valid candidate, so mark caster as Darkvision'd too (otherwise
  // shouldCast would just return the caster).
  const caster = makeWizard();
  caster._darkvisionActive = true;
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const ally = makeAlly('a1');
  ally.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone',     // type doesn't matter — match by spellName+casterId
    payload: {},
    sourceIsConcentration: false,
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null when ally already Darkvision\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2f. Self first: caster is always a valid target
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Self targeted first (caster is a valid ally)', shouldCast(caster, bf)?.id, 'wizard1');
}

{
  // 2g. Lowest-HP% ally preferred (when caster not in candidate set — caster
  // can be a candidate, but here we test the ally sort order by giving caster
  // a _darkvisionActive flag so caster is skipped. Then allies compete.)
  const caster = makeWizard();
  caster._darkvisionActive = true;          // skip caster (already darkvision'd)
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const hurt = makeAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  const full = makeAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, hurt, full]);
  eq('Lowest-HP% ally selected', shouldCast(caster, bf)?.id, 'hurt');
}

{
  // 2h. Touch range: all non-self allies at chebyshev=1 are at 5 ft — the
  // distance tiebreak cannot differentiate them. Verify stable behaviour:
  // two equal-HP% allies both qualify, shouldCast returns one of them.
  const caster = makeWizard();
  caster._darkvisionActive = true;
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const a = makeAlly('a', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 20 });
  const b = makeAlly('b', { x: 0, y: 1, z: 0 }, { maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, a, b]);
  const target = shouldCast(caster, bf)?.id;
  assert('Tie-break selects one of the equal-priority allies',
    target === 'a' || target === 'b', `got ${target}`);
}

// ============================================================
// 3. execute — scratch field + slot consumption
// ============================================================

console.log('\n=== 3. execute — scratch field + slot consumption ===\n');

{
  // 3a. _darkvisionActive set to true on target
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', ally._darkvisionActive, undefined);

  execute(caster, ally, state);

  eq('Scratch field set', ally._darkvisionActive, true);
}

{
  // 3b. Slot consumed + NOT concentration
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No concentration started', caster.concentration, null);
}

{
  // 3c. Self-cast: caster targets self
  const caster = makeWizard();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, caster, state);

  eq('Self-cast sets scratch field on caster', caster._darkvisionActive, true);
  eq('Slot consumed on self-cast', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3d. Dead target skipped (stale edge case) — slot still consumed,
  // scratch field NOT set.
  const caster = makeWizard();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Dead target scratch field NOT set', ally._darkvisionActive, undefined);
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Darkvision"',
    actionEvents[0].description.includes('Darkvision'));
  eq('1 condition_add event (darkvision granted)', condEvents.length, 1);
  assert('condition_add mentions 60 ft',
    condEvents[0].description.includes('60'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/darkvision');
  const caster = makeWizard();
  caster._darkvisionActive = true;
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  // cleanup should NOT clear the scratch field or touch concentration.
  cleanup(caster);
  eq('Cleanup does NOT clear scratch field', caster._darkvisionActive, true);
  eq('Cleanup does NOT touch concentration', caster.concentration?.spellName, 'Blur');
  eq('Cleanup does NOT change active flag', caster.concentration?.active, true);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: wizard darkvisions lowest-HP% ally
  const caster = makeWizard();
  caster._darkvisionActive = true;            // skip caster (already darkvision'd)
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const hurt = makeAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  const full = makeAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, hurt, full]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the lowest-HP% ally (hurt)', target?.id, 'hurt');
  if (target) execute(caster, target, state);

  eq('Hurt ally scratch field set', hurt._darkvisionActive, true);
  eq('Full ally scratch field NOT set', full._darkvisionActive, undefined);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster NOT concentrating (NOT a concentration spell)', caster.concentration, null);
}

{
  // 6b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // need a fresh ally (the prior one is now darkvision'd)
  const ally2 = makeAlly('a2', { x: 1, y: 1, z: 0 });
  const t2 = shouldCast(caster, makeBF([caster, ally2]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 6c. Already-darkvision'd ally is skipped — fresh ally is selected instead.
  // Caster self is also a candidate, so mark caster as Darkvision'd too
  // (otherwise shouldCast would return the caster, not 'fresh').
  const caster = makeWizard();
  caster._darkvisionActive = true;
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const dark = makeAlly('dark', { x: 1, y: 0, z: 0 });
  dark.activeEffects.push({
    id: 'eff_dark', casterId: caster.id, spellName: 'Darkvision',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const fresh = makeAlly('fresh', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, dark, fresh]);
  eq('shouldCast skips already-darkvision\'d ally', shouldCast(caster, bf)?.id, 'fresh');
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
