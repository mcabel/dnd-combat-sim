// ============================================================
// barkskin.test.ts — Barkskin spell module
// PHB p.217: 2nd-level transmutation, action, touch, concentration 1 hr.
// Effect: target's AC can't be less than 16.
//
// Tests cover shouldCast() preconditions + target priority, execute()
// ac_floor effect application + concentration start + logging, the
// engine's effectiveAC integration via getActiveAcFloor(), and the
// cleanup no-op pattern.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/barkskin';
import { getActiveAcFloor } from '../engine/spell_effects';
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

const BARKSKIN_ACTION: Action = {
  name: 'Barkskin',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 13,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Barkskin (AC floor 16, touch, concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
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

/** Druid at pos (0,0,0) with Barkskin + 2 2nd-level slots */
function makeDruid(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('druid1', {
    name: 'Druid',
    pos,
    actions: [BARKSKIN_ACTION],
    resources: withSlots2(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('AC floor is 16', metadata.acFloor, 16);
eq('concentration required', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Barkskin' action
  const caster = makeDruid();
  caster.actions = [];
  const ally = makeCombatant('ally1', { ac: 10 });
  const bf = makeBF([caster, ally]);
  eq('Returns null when caster has no Barkskin action', shouldCast(caster, bf), null);
}

{
  // 2b. No 2nd-level slots
  const caster = makeDruid();
  caster.resources = withSlots2(0);
  const ally = makeCombatant('ally1', { ac: 10 });
  const bf = makeBF([caster, ally]);
  eq('Returns null when no 2nd-level slots', shouldCast(caster, bf), null);
}

{
  // 2c. Already concentrating
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 } as any;
  const ally = makeCombatant('ally1', { ac: 10 });
  const bf = makeBF([caster, ally]);
  eq('Returns null when already concentrating', shouldCast(caster, bf), null);
}

{
  // 2d. Ally already at AC >= 16 (no benefit)
  const caster = makeDruid();
  const ally = makeCombatant('ally1', { ac: 18, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  // Caster has AC 12 < 16, so shouldCast should still return self
  const result = shouldCast(caster, bf);
  assert('Self still valid (AC 12 < 16) when ally already at AC 18', result !== null && result.id === 'druid1');
}

{
  // 2e. No valid target (caster AC >= 16, no allies)
  const caster = makeDruid();
  caster.ac = 18;
  const bf = makeBF([caster]);
  eq('Returns null when caster AC >= 16 and no allies', shouldCast(caster, bf), null);
}

{
  // 2f. Already barkskinned by this caster — skip
  const caster = makeDruid();
  const ally = makeCombatant('ally1', {
    ac: 10,
    pos: { x: 1, y: 0, z: 0 },
    activeEffects: [{
      id: 'eff_1',
      casterId: 'druid1',
      spellName: 'Barkskin',
      effectType: 'ac_floor',
      payload: { acFloor: 16 },
      sourceIsConcentration: true,
    }],
  });
  const bf = makeBF([caster, ally]);
  // Caster AC 12 < 16, so shouldCast returns self
  const result = shouldCast(caster, bf);
  assert('Self still valid when ally already barkskinned', result !== null && result.id === 'druid1');
}

{
  // 2g. Ally out of range (> 5 ft touch)
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  caster.ac = 18; // Caster AC >= 16, so self isn't a valid target
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 2, y: 0, z: 0 } }); // 10 ft
  const bf = makeBF([caster, ally]);
  eq('Returns null when only valid ally is out of touch range', shouldCast(caster, bf), null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Self preferred when AC < 16
  const caster = makeDruid();
  caster.ac = 12;
  const ally = makeCombatant('ally1', { ac: 14, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Self preferred over ally when both AC < 16', result !== null && result.id === 'druid1');
}

{
  // 3b. Lowest-AC ally preferred (when caster AC >= 16)
  const caster = makeDruid();
  caster.ac = 18; // Caster doesn't need Barkskin
  const lowAc = makeCombatant('low', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const highAc = makeCombatant('high', { ac: 15, pos: { x: 2, y: 0, z: 0 } });
  const bf = makeBF([caster, lowAc, highAc]);
  const result = shouldCast(caster, bf);
  eq('Lowest-AC ally picked', result?.id, 'low');
}

// ============================================================
// 4. execute — effect application
// ============================================================

console.log('\n=== 4. execute — effect application ===\n');

{
  // 4a. ac_floor effect applied to target (execute called directly — shouldCast
  // would prefer self since caster AC 12 < 16; here we test execute in isolation)
  const caster = makeDruid();
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);  // direct call, target = ally

  const floor = getActiveAcFloor(ally);
  eq('getActiveAcFloor returns 16 on buffed ally', floor, 16);
  eq('getActiveAcFloor returns 0 on caster (not buffed)', getActiveAcFloor(caster), 0);
}

{
  // 4b. Slot consumed (2nd level)
  const caster = makeDruid();
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);  // direct call

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4c. Concentration started on caster
  const caster = makeDruid();
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);  // direct call

  assert('Concentration is active on caster', caster.concentration?.active === true);
  eq('Concentration spellName is Barkskin', caster.concentration?.spellName, 'Barkskin');
}

{
  // 4d. Active effect registered with correct shape
  const caster = makeDruid();
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);  // direct call

  const effect = ally.activeEffects.find(e => e.spellName === 'Barkskin');
  assert('Barkskin effect registered on ally', effect !== undefined);
  if (effect) {
    eq('effect.effectType is ac_floor', effect.effectType, 'ac_floor');
    eq('effect.payload.acFloor is 16', effect.payload.acFloor, 16);
    eq('effect.casterId is druid1', effect.casterId, 'druid1');
    eq('effect.sourceIsConcentration is true', effect.sourceIsConcentration, true);
  }
}

{
  // 4e. Stale concentration cleaned up before starting new
  const caster = makeDruid();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 } as any;
  // Add a stale Bless effect on caster to verify cleanup
  caster.activeEffects.push({
    id: 'eff_old',
    casterId: caster.id,
    spellName: 'Bless',
    effectType: 'bless_die',
    payload: { dieSides: 4 },
    sourceIsConcentration: true,
  });
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  // shouldCast would normally return null here (concentration active),
  // but we bypass it to test execute's safety net.
  execute(caster, ally, state);

  assert('Stale Bless effect removed from caster', !caster.activeEffects.some(e => e.spellName === 'Bless'));
  assert('New Barkskin concentration active', caster.concentration?.spellName === 'Barkskin');
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeDruid();
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);  // direct call

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Action event emitted', actionEvents.length >= 1);
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions Barkskin', actionEvents[0].description.includes('Barkskin'));
  assert('Action event mentions AC floor 16', actionEvents[0].description.includes('16'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  // cleanup is a no-op for Barkskin (concentration break handles removal)
  const caster = makeDruid();
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);  // direct call

  const effectsBefore = ally.activeEffects.length;
  cleanup(caster); // should NOT remove the effect
  const effectsAfter = ally.activeEffects.length;

  eq('cleanup does NOT remove effects (no-op)', effectsAfter, effectsBefore);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: druid (AC 18, doesn't need buff) buffs ally (AC 10 → AC floor 16)
  const caster = makeDruid();
  caster.ac = 18; // Caster doesn't need Barkskin (AC >= 16)
  const ally = makeCombatant('fighter1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast picks fighter (AC 10 < 16)', target?.id === 'fighter1');
  if (target) execute(caster, target, state);

  eq('getActiveAcFloor returns 16 on fighter', getActiveAcFloor(ally), 16);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('Concentration active', caster.concentration?.active === true);
}

{
  // 7b. After slots exhausted, shouldCast returns null
  const caster = makeDruid();
  caster.resources = withSlots2(1);
  const ally = makeCombatant('ally1', { ac: 10, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  eq('shouldCast returns null after slots exhausted', t2, null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
