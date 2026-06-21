// ============================================================
// protection_from_poison.test.ts — Protection from Poison spell module
// PHB p.270: 2nd-level abjuration, action, range Touch, NO concentration (1 hr).
// Effect: removes 'poisoned' condition + grants advantage on saves vs poison
//         + resistance to poison damage (v1: forward-compat flag on the TARGET
//         for the advantage/resistance; no subsystem reads it yet).
//
// v1 simplifications (documented via metadata flags):
//   - Advantage-on-saves subsystem NOT implemented.
//   - Resistance-to-poison-damage subsystem NOT implemented.
//   - 1-hr duration simplified (persists for combat — no cleanup).
//   - Upcast NOT modelled (no At Higher Levels entry).
//   - NOT a concentration spell (PHB p.270: 1 hr, no concentration).
//
// Tests cover shouldCast() preconditions + target priority (poisoned allies
// preferred, fallback to non-poisoned) + execute() condition removal +
// scratch-field application + slot consumption + logging + integration pipeline.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/protection_from_poison';
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

const PFP_ACTION: Action = {
  name: 'Protection from Poison',
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
  description: 'Protection from Poison (touch, ends poisoned + advantage/resistance, 1 hr, NOT concentration)',
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

/** Cleric at (0,0,0) with Protection from Poison + 2 2nd-level slots */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [PFP_ACTION],
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

eq('name is Protection from Poison', metadata.name, 'Protection from Poison');
eq('level is 2', metadata.level, 2);
eq('school is abjuration', metadata.school, 'abjuration');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: advantage subsystem NOT implemented',
  (metadata as any).protectionFromPoisonAdvantageV1Implemented, false);
eq('v1: resistance subsystem NOT implemented',
  (metadata as any).protectionFromPoisonResistanceV1Implemented, false);
eq('v1: duration simplified (persists for combat)',
  (metadata as any).protectionFromPoisonDurationV1Simplified, true);
eq('v1: upcast NOT implemented',
  (metadata as any).protectionFromPoisonUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Protection from Poison' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns null when caster has no Protection from Poison action', shouldCast(caster, bf), null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2c. No allies in range (caster self always qualifies as a candidate)
  // To force null, mark caster as already PFP-active AND no other allies nearby.
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Protection from Poison',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const farAlly = makeAlly('far', { x: 5, y: 0, z: 0 });  // 25 ft — out of touch range
  const bf = makeBF([caster, farAlly]);
  eq('Returns null when no allies in range (5 ft)', shouldCast(caster, bf), null);
}

{
  // 2d. NOT concentration: cast allowed while concentrating on another spell
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('NOT concentration: cast allowed while concentrating on another spell', result !== null);
}

{
  // 2e. Self first: caster is always a valid target
  const caster = makeCleric();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Self targeted first (caster is a valid ally)', shouldCast(caster, bf)?.id, 'cleric1');
}

// ============================================================
// 3. shouldCast — target priority (poisoned allies preferred)
// ============================================================

console.log('\n=== 3. shouldCast — target priority (poisoned preferred) ===\n');

{
  // 3a. Poisoned ally preferred over non-poisoned ally (caster marked
  // already-PFP'd so caster is skipped).
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Protection from Poison',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const poisoned = makeAlly('poisoned', { x: 1, y: 0, z: 0 });
  poisoned.conditions.add('poisoned');
  const healthy = makeAlly('healthy', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, poisoned, healthy]);
  eq('Poisoned ally preferred over healthy ally', shouldCast(caster, bf)?.id, 'poisoned');
}

{
  // 3b. Falls back to non-poisoned ally if no poisoned allies (preventive buff)
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Protection from Poison',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const hurt = makeAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  const full = makeAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, hurt, full]);
  // Neither poisoned — fallback to lowest-HP% ally
  eq('Falls back to lowest-HP% ally when no poisoned allies', shouldCast(caster, bf)?.id, 'hurt');
}

{
  // 3c. Already PFP-active ally skipped (no stacking)
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Protection from Poison',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const pfp = makeAlly('pfp', { x: 1, y: 0, z: 0 });
  pfp.activeEffects.push({
    id: 'eff_pfp', casterId: caster.id, spellName: 'Protection from Poison',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const fresh = makeAlly('fresh', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, pfp, fresh]);
  eq('Already-PFP ally is skipped', shouldCast(caster, bf)?.id, 'fresh');
}

// ============================================================
// 4. execute — condition removal + scratch field
// ============================================================

console.log('\n=== 4. execute — condition removal + scratch field ===\n');

{
  // 4a. Poisoned condition removed on cast
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  ally.conditions.add('frightened');   // unrelated condition — should NOT be removed
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  assert('Ally has poisoned condition before cast', ally.conditions.has('poisoned'));

  execute(caster, ally, state);

  assert('Ally poisoned condition removed', !ally.conditions.has('poisoned'));
  assert('Ally frightened condition NOT removed (only poisoned)',
    ally.conditions.has('frightened'));
}

{
  // 4b. Forward-compat flag set on target
  const caster = makeCleric();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', ally._protectionFromPoisonActive, undefined);

  execute(caster, ally, state);

  eq('Scratch field set on target', ally._protectionFromPoisonActive, true);
  eq('Scratch field NOT set on caster', caster._protectionFromPoisonActive, undefined);
}

{
  // 4c. Slot consumed + NO concentration
  const caster = makeCleric();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No concentration started', caster.concentration, null);
}

{
  // 4d. No sentinel effect attached (flag persists for combat — no cleanup)
  const caster = makeCleric();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  const sentinels = ally.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Protection from Poison',
  );
  eq('No sentinel effect attached (forward-compat flag only)', sentinels.length, 0);
}

{
  // 4e. Dead target skipped (stale edge case) — slot still consumed,
  // scratch field NOT set, condition NOT removed.
  const caster = makeCleric();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed even for dead target', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Dead target scratch field NOT set', ally._protectionFromPoisonActive, undefined);
  assert('Dead target poisoned NOT removed (skipped)',
    ally.conditions.has('poisoned'));
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  // 5a. Logging when target has poisoned condition
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally.conditions.add('poisoned');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condRemoveEvents = events.filter(e => e.type === 'condition_remove');
  const condAddEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Protection from Poison"',
    actionEvents[0].description.includes('Protection from Poison'));
  eq('1 condition_remove event (poisoned removed)', condRemoveEvents.length, 1);
  assert('condition_remove mentions poisoned',
    condRemoveEvents[0].description.includes('poisoned'));
  eq('1 condition_add event (forward-compat flag granted)', condAddEvents.length, 1);
}

{
  // 5b. Logging when target has NO poisoned condition (no condition_remove event)
  const caster = makeCleric();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  const events = state.log.events as any[];
  const condRemoveEvents = events.filter(e => e.type === 'condition_remove');
  eq('0 condition_remove events (no poisoned to remove)', condRemoveEvents.length, 0);
}

// ============================================================
// 6. cleanup + Integration pipeline
// ============================================================

console.log('\n=== 6. cleanup + Integration pipeline ===\n');

{
  // 6a. cleanup does NOT clear scratch field
  const { cleanup } = require('../spells/protection_from_poison');
  const caster = makeCleric();
  const ally = makeAlly('a1');
  ally._protectionFromPoisonActive = true;
  cleanup(caster);
  eq('Cleanup does NOT clear target scratch field', ally._protectionFromPoisonActive, true);
}

{
  // 6b. Full pipeline: cleric casts PFP on poisoned ally
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Protection from Poison',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: false,
  });
  const poisoned = makeAlly('poisoned', { x: 1, y: 0, z: 0 });
  poisoned.conditions.add('poisoned');
  const healthy = makeAlly('healthy', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, poisoned, healthy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the poisoned ally', target?.id, 'poisoned');
  if (target) execute(caster, target, state);

  assert('Poisoned condition removed', !poisoned.conditions.has('poisoned'));
  eq('Target scratch field set', poisoned._protectionFromPoisonActive, true);
  eq('Healthy ally scratch field NOT set', healthy._protectionFromPoisonActive, undefined);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 6c. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, makeAlly('a2', { x: 1, y: 1, z: 0 })]));
  eq('shouldCast returns null after slots exhausted', t2, null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
