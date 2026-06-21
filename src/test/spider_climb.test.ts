// ============================================================
// spider_climb.test.ts — Spider Climb spell module
// PHB p.277: 2nd-level transmutation, action, range Touch, concentration 1 hr.
// Effect: target gains climb speed (v1: forward-compat flag on the TARGET;
//         no climb-speed subsystem in v1).
//
// v1 simplifications (documented via metadata flags):
//   - Climb-speed subsystem NOT implemented — `_spiderClimbActive` flag is
//     forward-compat only.
//   - Concentration started but NOT enforced (TG-002).
//   - Upcast NOT modelled (no At Higher Levels entry).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// scratch-field application + sentinel effect attachment (on TARGET) +
// concentration start + slot consumption + logging + integration pipeline.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/spider_climb';
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

const SPIDER_CLIMB_ACTION: Action = {
  name: 'Spider Climb',
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
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Spider Climb (touch, target gains climb speed, concentration 1 hr)',
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

/** Wizard at (0,0,0) with Spider Climb + 2 2nd-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [SPIDER_CLIMB_ACTION],
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

eq('name is Spider Climb', metadata.name, 'Spider Climb');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('IS concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: climb-speed subsystem NOT implemented',
  (metadata as any).spiderClimbClimbSpeedV1Implemented, false);
eq('v1: upcast NOT implemented',
  (metadata as any).spiderClimbUpcastV1Implemented, false);
eq('v1: concentration enforcement NOT implemented',
  (metadata as any).spiderClimbConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns null when caster is already concentrating', shouldCast(caster, bf), null);
}

{
  // 2b. Caster lacks 'Spider Climb' action
  const caster = makeWizard();
  caster.actions = [];
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns null when caster has no Spider Climb action', shouldCast(caster, bf), null);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2d. No allies in range (caster self is a candidate, so mark caster as
  // already Spider-Climb-active to skip it, then put the only other ally
  // out of range).
  const caster = makeWizard();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Spider Climb',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: true,
  });
  const farAlly = makeAlly('far', { x: 5, y: 0, z: 0 });  // 25 ft — out of touch range
  const bf = makeBF([caster, farAlly]);
  eq('Returns null when no allies in range (5 ft)', shouldCast(caster, bf), null);
}

{
  // 2e. Self first: caster is always a valid target
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Self targeted first (caster is a valid ally)', shouldCast(caster, bf)?.id, 'wizard1');
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Lowest-HP% ally preferred (when caster not in candidate set)
  const caster = makeWizard();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Spider Climb',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: true,
  });
  const hurt = makeAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  const full = makeAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, hurt, full]);
  eq('Lowest-HP% ally selected', shouldCast(caster, bf)?.id, 'hurt');
}

{
  // 3b. Already Spider-Climb-active ally is skipped — fresh ally is selected
  const caster = makeWizard();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Spider Climb',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: true,
  });
  const climbd = makeAlly('climbd', { x: 1, y: 0, z: 0 });
  climbd.activeEffects.push({
    id: 'eff_climbd', casterId: caster.id, spellName: 'Spider Climb',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: true,
  });
  const fresh = makeAlly('fresh', { x: 1, y: 1, z: 0 });
  const bf = makeBF([caster, climbd, fresh]);
  eq('shouldCast skips already-Spider-Climb ally', shouldCast(caster, bf)?.id, 'fresh');
}

// ============================================================
// 4. execute — scratch field + sentinel on TARGET + concentration
// ============================================================

console.log('\n=== 4. execute — scratch field + sentinel on TARGET + concentration ===\n');

{
  // 4a. _spiderClimbActive set to true on target
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', ally._spiderClimbActive, undefined);

  execute(caster, ally, state);

  eq('Scratch field set on target', ally._spiderClimbActive, true);
  eq('Scratch field NOT set on caster', caster._spiderClimbActive, undefined);
}

{
  // 4b. Sentinel damage_zone effect attached ON THE TARGET (not caster)
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  const allySentinels = ally.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Spider Climb',
  );
  const casterSentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Spider Climb',
  );
  eq('Sentinel attached to TARGET', allySentinels.length, 1);
  eq('Sentinel NOT attached to caster', casterSentinels.length, 0);
  if (allySentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', allySentinels[0].payload.dieCount, 0);
    eq('Sentinel damageType is force', allySentinels[0].payload.damageType, 'force');
    eq('Sentinel sourceIsConcentration is true', allySentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the wizard', allySentinels[0].casterId, 'wizard1');
  }
}

{
  // 4c. Slot consumed + concentration started on CASTER (not target)
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Spider Climb', caster.concentration?.spellName, 'Spider Climb');
  eq('Target NOT concentrating', ally.concentration, null);
}

{
  // 4d. Dead target skipped (stale edge case) — slot still consumed,
  // scratch field NOT set, concentration still started.
  const caster = makeWizard();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed even for dead target', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Dead target scratch field NOT set', ally._spiderClimbActive, undefined);
  eq('Concentration still started', caster.concentration?.spellName, 'Spider Climb');
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Spider Climb"',
    actionEvents[0].description.includes('Spider Climb'));
  eq('1 condition_add event (climb speed granted)', condEvents.length, 1);
  assert('condition_add mentions climb',
    condEvents[0].description.includes('climb') ||
    condEvents[0].description.includes('Climb'));
}

// ============================================================
// 6. cleanup — no-op + Integration pipeline
// ============================================================

console.log('\n=== 6. cleanup + Integration pipeline ===\n');

{
  // 6a. cleanup does NOT clear scratch field or break concentration
  const { cleanup } = require('../spells/spider_climb');
  const caster = makeWizard();
  const ally = makeAlly('a1');
  ally._spiderClimbActive = true;
  caster.concentration = { active: true, spellName: 'Spider Climb', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT clear target scratch field', ally._spiderClimbActive, true);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

{
  // 6b. Full pipeline: wizard spider-climbs lowest-HP% ally
  const caster = makeWizard();
  caster.activeEffects.push({
    id: 'eff_self', casterId: caster.id, spellName: 'Spider Climb',
    effectType: 'damage_zone', payload: {}, sourceIsConcentration: true,
  });
  const hurt = makeAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  const full = makeAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, hurt, full]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the lowest-HP% ally (hurt)', target?.id, 'hurt');
  if (target) execute(caster, target, state);

  eq('Hurt ally scratch field set', hurt._spiderClimbActive, true);
  eq('Full ally scratch field NOT set', full._spiderClimbActive, undefined);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Spider Climb', caster.concentration?.spellName, 'Spider Climb');
}

{
  // 6c. Concentration-break cleanup: sentinel removal on TARGET clears the
  // scratch field on the TARGET (not on the caster).
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  const caster = makeWizard();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);
  eq('Target scratch field set before concentration break', ally._spiderClimbActive, true);

  // Simulate concentration break: removeEffectsFromCaster sweeps the caster's
  // effects across the battlefield, finds the sentinel on the ally, runs
  // _undoEffect (which deletes the scratch field).
  removeEffectsFromCaster(caster.id, bf);
  eq('Target scratch field cleared after concentration break', ally._spiderClimbActive, undefined);
  assert('Sentinel effect removed from target',
    !ally.activeEffects.some(e => e.spellName === 'Spider Climb'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
