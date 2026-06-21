// ============================================================
// pass_without_trace.test.ts — Pass without Trace spell module
// PHB p.264: 2nd-level abjuration, action, range Self (30-ft aura),
//            concentration 1 hr.
// Effect: +10 to DEX (Stealth) for allies within 30 ft (v1: forward-compat
//         flag on the CASTER; no stealth subsystem in v1).
//
// v1 simplifications (documented via metadata flags):
//   - Stealth subsystem NOT implemented — `_passWithoutTraceActive` flag is
//     forward-compat only.
//   - Concentration started but NOT enforced (TG-002).
//   - Upcast NOT modelled (no At Higher Levels entry).
//
// Tests cover shouldCast() preconditions + execute() scratch-field application
// + sentinel effect attachment + concentration start + slot consumption +
// logging + integration pipeline.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/pass_without_trace';
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

const PWT_ACTION: Action = {
  name: 'Pass without Trace',
  isMultiattack: false,
  attackType: 'special',   // self-buff aura — NOT 'melee'/'ranged'
  reach: 0,
  range: { normal: 0, long: 0 },   // Self (30-ft aura)
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
  description: 'Pass without Trace (self, +10 stealth aura 30 ft, concentration 1 hr)',
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

/** Druid at (0,0,0) with Pass without Trace + 2 2nd-level slots */
function makeDruid(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('druid1', {
    name: 'Druid',
    pos,
    actions: [PWT_ACTION],
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

eq('name is Pass without Trace', metadata.name, 'Pass without Trace');
eq('level is 2', metadata.level, 2);
eq('school is abjuration', metadata.school, 'abjuration');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('auraRadiusFt is 30', (metadata as any).auraRadiusFt, 30);
eq('stealthBonus is 10', (metadata as any).stealthBonus, 10);
eq('IS concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: stealth subsystem NOT implemented',
  (metadata as any).passWithoutTraceStealthSubsystemV1Implemented, false);
eq('v1: upcast NOT implemented',
  (metadata as any).passWithoutTraceUpcastV1Implemented, false);
eq('v1: concentration enforcement NOW implemented (Session 34 TG-002)',
  (metadata as any).passWithoutTraceConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns false when caster is already concentrating', shouldCast(caster, bf), false);
}

{
  // 2b. Caster lacks 'Pass without Trace' action
  const caster = makeDruid();
  caster.actions = [];
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns false when caster has no Pass without Trace action', shouldCast(caster, bf), false);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeDruid();
  caster.resources = withSlots2(0);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns false when no 2nd-level slots', shouldCast(caster, bf), false);
}

{
  // 2d. Already Pass-without-Trace-active — skip
  const caster = makeDruid();
  caster._passWithoutTraceActive = true;
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns false when already Pass-without-Trace-active', shouldCast(caster, bf), false);
}

{
  // 2e. Caster is alone — self always qualifies (chebyshev3D(self, self) = 0)
  const caster = makeDruid();
  const bf = makeBF([caster]);
  eq('Returns true when caster is alone (self within 30 ft)', shouldCast(caster, bf), true);
}

{
  // 2f. All preconditions met → returns true
  const caster = makeDruid();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Returns true when all preconditions met', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — scratch field + sentinel + concentration
// ============================================================

console.log('\n=== 3. execute — scratch field + sentinel + concentration ===\n');

{
  // 3a. _passWithoutTraceActive set to true on caster
  const caster = makeDruid();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', caster._passWithoutTraceActive, undefined);

  execute(caster, state);

  eq('Scratch field set', caster._passWithoutTraceActive, true);
}

{
  // 3b. Sentinel damage_zone effect attached (dieCount=0)
  const caster = makeDruid();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, state);

  const sentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Pass without Trace',
  );
  eq('1 sentinel damage_zone effect attached', sentinels.length, 1);
  if (sentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', sentinels[0].payload.dieCount, 0);
    eq('Sentinel damageType is force', sentinels[0].payload.damageType, 'force');
    eq('Sentinel sourceIsConcentration is true', sentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the druid', sentinels[0].casterId, 'druid1');
  }
}

{
  // 3c. Slot consumed + concentration started
  const caster = makeDruid();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Pass without Trace', caster.concentration?.spellName, 'Pass without Trace');
}

{
  // 3d. Existing concentration broken (safety net)
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Barkskin', dcIfHit: 10 };
  // Pre-existing Barkskin effect on caster (simulated)
  caster.activeEffects.push({
    id: 'eff_barkskin', casterId: caster.id, spellName: 'Barkskin',
    effectType: 'ac_floor', payload: { acFloor: 16 }, sourceIsConcentration: true,
  });
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration switched to Pass without Trace', caster.concentration?.spellName, 'Pass without Trace');
  assert('Prior Barkskin effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Barkskin'));
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeDruid();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Pass without Trace"',
    actionEvents[0].description.includes('Pass without Trace'));
  eq('1 condition_add event (aura active)', condEvents.length, 1);
  assert('condition_add mentions stealth / forward-compat',
    condEvents[0].description.includes('stealth') ||
    condEvents[0].description.includes('forward-compat') ||
    condEvents[0].description.includes('shadows'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/pass_without_trace');
  const caster = makeDruid();
  caster._passWithoutTraceActive = true;
  caster.concentration = { active: true, spellName: 'Pass without Trace', dcIfHit: 10 };
  cleanup(caster);
  eq('Cleanup does NOT clear scratch field', caster._passWithoutTraceActive, true);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: druid casts Pass without Trace in combat
  const caster = makeDruid();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const decision = shouldCast(caster, bf);
  eq('shouldCast returns true', decision, true);
  if (decision) execute(caster, state);

  eq('Scratch field set', caster._passWithoutTraceActive, true);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Pass without Trace', caster.concentration?.spellName, 'Pass without Trace');

  const sentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Pass without Trace',
  );
  eq('Sentinel effect attached', sentinels.length, 1);
}

{
  // 6b. After slots exhausted, shouldCast returns false
  const caster = makeDruid();
  caster.resources = withSlots2(1);
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const d1 = shouldCast(caster, bf);
  if (d1) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Caster is now concentrating → second shouldCast also returns false
  const d2 = shouldCast(caster, bf);
  eq('shouldCast returns false after slots exhausted / concentration active', d2, false);
}

{
  // 6c. Concentration-break cleanup: sentinel removal clears the scratch field
  const { removeEffectsFromCaster } = require('../engine/spell_effects');
  const caster = makeDruid();
  const ally = makeAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, state);
  eq('Scratch field set before concentration break', caster._passWithoutTraceActive, true);

  // Simulate concentration break
  removeEffectsFromCaster(caster.id, bf);
  eq('Scratch field cleared after concentration break', caster._passWithoutTraceActive, undefined);
  assert('Sentinel effect removed',
    !caster.activeEffects.some(e => e.spellName === 'Pass without Trace'));
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
