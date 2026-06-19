// ============================================================
// blur.test.ts — Blur spell module
// PHB p.219: 2nd-level illusion, action, self, concentration 1 min.
// Effect: disadvantage on attack rolls vs caster.
//
// Tests cover shouldCast() preconditions, execute() advantage_vs
// effect application + concentration start + logging, and the
// cleanup no-op pattern.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/blur';
import { Combatant, Action, PlayerResources } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const BLUR_ACTION: Action = {
  name: 'Blur',
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
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Blur (self, disadv on attacks vs caster, concentration)',
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

/** Wizard at (0,0,0) with Blur + 2 2nd-level slots */
function makeWizard(): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    actions: [BLUR_ACTION],
    resources: withSlots2(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 2', metadata.level, 2);
eq('school is illusion', metadata.school, 'illusion');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('concentration required', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Blur' action
  const caster = makeWizard();
  caster.actions = [];
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no Blur action', shouldCast(caster, bf), false);
}

{
  // 2b. No 2nd-level slots
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when no 2nd-level slots', shouldCast(caster, bf), false);
}

{
  // 2c. Already concentrating
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 } as any;
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already concentrating', shouldCast(caster, bf), false);
}

{
  // 2d. Already Blurred (re-cast would be wasteful)
  const caster = makeWizard();
  caster.activeEffects.push({
    id: 'eff_1',
    casterId: caster.id,
    spellName: 'Blur',
    effectType: 'advantage_vs',
    payload: { advType: 'disadvantage', advScope: 'attack' },
    sourceIsConcentration: true,
  });
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already Blurred', shouldCast(caster, bf), false);
}

{
  // 2e. No enemies (buff is useless)
  const caster = makeWizard();
  const ally = makeCombatant('ally1', { faction: 'party' });
  const bf = makeBF([caster, ally]);
  eq('Returns false when no enemies present', shouldCast(caster, bf), false);
}

{
  // 2f. Happy path: has Blur, slot, no concentration, enemy present
  const caster = makeWizard();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all conditions met', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — effect application
// ============================================================

console.log('\n=== 3. execute — effect application ===\n');

{
  // 3a. advantage_vs 'disadvantage' 'attack' effect applied to caster
  const caster = makeWizard();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const effect = caster.activeEffects.find(e => e.spellName === 'Blur');
  assert('Blur effect registered on caster', effect !== undefined);
  if (effect) {
    eq('effect.effectType is advantage_vs', effect.effectType, 'advantage_vs');
    eq('effect.payload.advType is disadvantage', effect.payload.advType, 'disadvantage');
    eq('effect.payload.advScope is attack', effect.payload.advScope, 'attack');
    eq('effect.casterId is wizard1', effect.casterId, 'wizard1');
    eq('effect.sourceIsConcentration is true', effect.sourceIsConcentration, true);
  }
}

{
  // 3b. Slot consumed (2nd level)
  const caster = makeWizard();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3c. Concentration started on caster
  const caster = makeWizard();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  assert('Concentration is active on caster', caster.concentration?.active === true);
  eq('Concentration spellName is Blur', caster.concentration?.spellName, 'Blur');
}

{
  // 3d. Stale concentration cleaned up before starting new
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 } as any;
  // Add a stale Bless effect to verify cleanup
  caster.activeEffects.push({
    id: 'eff_old',
    casterId: caster.id,
    spellName: 'Bless',
    effectType: 'bless_die',
    payload: { dieSides: 4 },
    sourceIsConcentration: true,
  });
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);  // bypass shouldCast (which would gate on concentration)

  assert('Stale Bless effect removed', !caster.activeEffects.some(e => e.spellName === 'Bless'));
  assert('New Blur concentration active', caster.concentration?.spellName === 'Blur');
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeWizard();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('Action event emitted', actionEvents.length >= 1);
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions Blur', actionEvents[0].description.includes('Blur'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const caster = makeWizard();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const effectsBefore = caster.activeEffects.length;
  cleanup(caster);
  const effectsAfter = caster.activeEffects.length;

  eq('cleanup does NOT remove effects (no-op)', effectsAfter, effectsBefore);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: wizard with enemy casts Blur
  const caster = makeWizard();
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const should = shouldCast(caster, bf);
  assert('shouldCast returns true', should === true);
  if (should) execute(caster, state);

  const effect = caster.activeEffects.find(e => e.spellName === 'Blur');
  assert('Blur effect applied to caster', effect !== undefined);
  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  assert('Concentration active', caster.concentration?.active === true);
}

{
  // 6b. After slots exhausted, shouldCast returns false
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const enemy = makeCombatant('e1', { faction: 'enemy' });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  if (shouldCast(caster, bf)) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  eq('shouldCast returns false after slots exhausted', shouldCast(caster, makeBF([caster, enemy])), false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
