// ============================================================
// shadow_of_moil.test.ts — Shadow of Moil spell module
// XGE p.164: 4th-level necromancy, action, self, concentration 1 min.
// Effect: heavily obscured (disadv on attacks vs caster) + 2d8 necrotic
// rider on enemies that hit the caster.
//
// Tests cover shouldCast() preconditions, execute() advantage_vs +
// curse_rider effect application + concentration start + logging,
// and the cleanup no-op pattern.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/shadow_of_moil';
import { Combatant, Action, PlayerResources } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots4(remaining = 1): PlayerResources {
  return { spellSlots: { 4: { max: 1, remaining } } };
}

const SOM_ACTION: Action = {
  name: 'Shadow of Moil',
  isMultiattack: false,
  attackType: null,
  reach: 0,
  range: null,
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 4,
  costType: 'action',
  legendaryCost: 0,
  description: 'Shadow of Moil (self, disadv on attacks vs caster + 2d8 necrotic rider, concentration)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 18, wis: 10, cha: 10,
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

/** Warlock at (0,0,0) with Shadow of Moil + 1 4th-level slot */
function makeWarlock(): Combatant {
  return makeCombatant('warlock1', {
    name: 'Warlock',
    actions: [SOM_ACTION],
    resources: withSlots4(1),
  });
}

/** Enemy at a given position (default adjacent at (0,1,0) = 5 ft) */
function makeEnemy(id: string, pos = { x: 0, y: 1, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 4', metadata.level, 4);
eq('school is necromancy', metadata.school, 'necromancy');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('concentration required', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Shadow of Moil' action
  const caster = makeWarlock();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no Shadow of Moil action', shouldCast(caster, bf), false);
}

{
  // 2b. No 4th-level slots
  const caster = makeWarlock();
  caster.resources = withSlots4(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when no 4th-level slots', shouldCast(caster, bf), false);
}

{
  // 2c. Already concentrating
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 } as any;
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already concentrating', shouldCast(caster, bf), false);
}

{
  // 2d. Already Shadow of Moil'd (re-cast would be wasteful)
  const caster = makeWarlock();
  caster.activeEffects.push({
    id: 'eff_1',
    casterId: caster.id,
    spellName: 'Shadow of Moil',
    effectType: 'advantage_vs',
    payload: { advType: 'disadvantage', advScope: 'attack' },
    sourceIsConcentration: true,
  });
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already Shadow of Moil active', shouldCast(caster, bf), false);
}

{
  // 2e. No enemies (buff is useless)
  const caster = makeWarlock();
  const ally = makeCombatant('ally1', { faction: 'party' });
  const bf = makeBF([caster, ally]);
  eq('Returns false when no enemies present', shouldCast(caster, bf), false);
}

{
  // 2f. Enemy too far (35 ft away — beyond 30 ft rider range)
  const caster = makeWarlock();
  // Chebyshev: (0,7,0) = 7 squares = 35 ft
  const enemy = makeEnemy('e1', { x: 0, y: 7, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when nearest enemy beyond 30 ft', shouldCast(caster, bf), false);
}

{
  // 2g. Happy path: has Shadow of Moil, slot, no concentration, enemy within 30 ft
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all conditions met', shouldCast(caster, bf), true);
}

{
  // 2h. Enemy at exactly 30 ft (6 squares = 30 ft) should be valid
  const caster = makeWarlock();
  const enemy = makeEnemy('e1', { x: 0, y: 6, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns true when enemy at exactly 30 ft', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — advantage_vs effect on caster
// ============================================================

console.log('\n=== 3. execute — advantage_vs effect on caster ===\n');

{
  // 3a. advantage_vs 'disadvantage' 'attack' effect applied to caster
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const effect = caster.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'advantage_vs');
  assert('Shadow of Moil advantage_vs effect registered on caster', effect !== undefined);
  if (effect) {
    eq('effect.effectType is advantage_vs', effect.effectType, 'advantage_vs');
    eq('effect.payload.advType is disadvantage', effect.payload.advType, 'disadvantage');
    eq('effect.payload.advScope is attack', effect.payload.advScope, 'attack');
    eq('effect.casterId is warlock1', effect.casterId, 'warlock1');
    eq('effect.sourceIsConcentration is true', effect.sourceIsConcentration, true);
  }
}

{
  // 3b. Slot consumed (4th level)
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('4th-level slot consumed', caster.resources!.spellSlots![4]!.remaining, 0);
}

{
  // 3c. Concentration started on caster
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Concentration is active on caster', caster.concentration?.active === true);
  eq('Concentration spellName is Shadow of Moil', caster.concentration?.spellName, 'Shadow of Moil');
}

{
  // 3d. Stale concentration cleaned up before starting new
  const caster = makeWarlock();
  caster.concentration = { active: true, spellName: 'Hex', dcIfHit: 10 } as any;
  // Add a stale Hex effect to verify cleanup
  caster.activeEffects.push({
    id: 'eff_old',
    casterId: caster.id,
    spellName: 'Hex',
    effectType: 'hex_damage',
    payload: { hexDie: 6 },
    sourceIsConcentration: true,
  });
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);  // bypass shouldCast (which would gate on concentration)

  assert('Stale Hex effect removed', !caster.activeEffects.some(e => e.spellName === 'Hex'));
  assert('New Shadow of Moil concentration active', caster.concentration?.spellName === 'Shadow of Moil');
}

// ============================================================
// 4. execute — curse_rider effect on enemies
// ============================================================

console.log('\n=== 4. execute — curse_rider effect on enemies ===\n');

{
  // 4a. curse_rider applied to enemy within 30 ft
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const rider = enemy.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  assert('curse_rider effect registered on enemy', rider !== undefined);
  if (rider) {
    eq('rider.effectType is curse_rider', rider.effectType, 'curse_rider');
    eq('rider.payload.riderDie is 8', rider.payload.riderDie, 8);
    eq('rider.payload.riderDieCount is 2', rider.payload.riderDieCount, 2);
    eq('rider.payload.riderDamageType is necrotic', rider.payload.riderDamageType, 'necrotic');
    eq('rider.payload.riderCasterId is warlock1', rider.payload.riderCasterId, 'warlock1');
    eq('rider.casterId is warlock1', rider.casterId, 'warlock1');
    eq('rider.sourceIsConcentration is true', rider.sourceIsConcentration, true);
  }
}

{
  // 4b. Enemy beyond 30 ft does NOT get curse_rider
  const caster = makeWarlock();
  const enemyNear = makeEnemy('e1');
  const enemyFar = makeEnemy('e2', { x: 0, y: 7, z: 0 }); // 35 ft away
  const bf = makeBF([caster, enemyNear, enemyFar]);
  const state = makeState(bf);

  execute(caster, state);

  const nearRider = enemyNear.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  const farRider = enemyFar.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  assert('Near enemy gets curse_rider', nearRider !== undefined);
  assert('Far enemy does NOT get curse_rider', farRider === undefined);
}

{
  // 4c. Multiple enemies within 30 ft all get curse_rider
  const caster = makeWarlock();
  const enemy1 = makeEnemy('e1', { x: 0, y: 1, z: 0 });
  const enemy2 = makeEnemy('e2', { x: 1, y: 0, z: 0 });
  const enemy3 = makeEnemy('e3', { x: 0, y: -1, z: 0 });
  const bf = makeBF([caster, enemy1, enemy2, enemy3]);
  const state = makeState(bf);

  execute(caster, state);

  const r1 = enemy1.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  const r2 = enemy2.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  const r3 = enemy3.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  assert('Enemy 1 gets curse_rider', r1 !== undefined);
  assert('Enemy 2 gets curse_rider', r2 !== undefined);
  assert('Enemy 3 gets curse_rider', r3 !== undefined);
}

{
  // 4d. Allied creatures do NOT get curse_rider
  const caster = makeWarlock();
  const ally = makeCombatant('ally1', { faction: 'party', pos: { x: 0, y: 1, z: 0 } });
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, ally, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const allyRider = ally.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  assert('Ally does NOT get curse_rider', allyRider === undefined);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Action event emitted', actionEvents.length >= 1);
  assert('Condition_add events emitted (caster + enemy)', condEvents.length >= 2);
  assert('Action event mentions Shadow of Moil', actionEvents[0].description.includes('Shadow of Moil'));
  assert('Condition_add event mentions shadows', condEvents.some((e: any) => e.description.includes('shadows')));
  assert('Condition_add event mentions necrotic rider', condEvents.some((e: any) => e.description.includes('necrotic rider')));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const effectsBefore = caster.activeEffects.length;
  cleanup(caster);
  const effectsAfter = caster.activeEffects.length;

  eq('cleanup does NOT remove effects (no-op)', effectsAfter, effectsBefore);
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: warlock with enemy casts Shadow of Moil
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const should = shouldCast(caster, bf);
  assert('shouldCast returns true', should === true);
  if (should) execute(caster, state);

  const advEffect = caster.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'advantage_vs');
  const riderEffect = enemy.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  assert('advantage_vs effect applied to caster', advEffect !== undefined);
  assert('curse_rider effect applied to enemy', riderEffect !== undefined);
  eq('Slot consumed', caster.resources!.spellSlots![4]!.remaining, 0);
  assert('Concentration active', caster.concentration?.active === true);
}

{
  // 7b. After slots exhausted, shouldCast returns false
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  if (shouldCast(caster, bf)) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![4]!.remaining, 0);
  eq('shouldCast returns false after slots exhausted', shouldCast(caster, makeBF([caster, enemy])), false);
}

{
  // 7c. Both advantage_vs and curse_rider are concentration-sourced
  //     (will be cleaned up by removeEffectsFromCaster on concentration break)
  const caster = makeWarlock();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const advEffect = caster.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'advantage_vs');
  const riderEffect = enemy.activeEffects.find(e => e.spellName === 'Shadow of Moil' && e.effectType === 'curse_rider');
  assert('advantage_vs is sourceIsConcentration', advEffect?.sourceIsConcentration === true);
  assert('curse_rider is sourceIsConcentration', riderEffect?.sourceIsConcentration === true);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
