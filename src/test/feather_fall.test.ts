// ============================================================
// feather_fall.test.ts — Feather Fall reaction spell module
// PHB p.239: 1st-level transmutation, reaction
// Trigger: You or a creature within 60 feet of you falls
// Effect: Up to 5 falling creatures take NO fall damage.
//
// Tests cover:
//   1. Metadata shape
//   2. shouldCastReaction — preconditions and range gating
//   3. executeReaction — marks fallers, negates fall damage
//   4. Max 5 fallers cap
//   6. Range check per-faller
//   7. cleanup is a no-op
// ============================================================

import {
  shouldCastReaction, executeReaction, metadata, cleanup,
} from '../spells/feather_fall';
import { Combatant, Action, PlayerResources, Battlefield, ReactionTrigger } from '../types/core';
import { EngineState } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

const FEATHER_FALL_ACTION: Action = {
  name: 'Feather Fall', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Feather Fall',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 50, currentHP: 50, ac: 15, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(), aiProfile: 'smart', perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, resources: null,
    tempHP: 0, mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null,
    activeEffects: [], exhaustionLevel: 0,
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    combatants: new Map(combatants.map(c => [c.id, c])),
    cells: new Map(), width: 20, height: 20, round: 1,
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

function makeFallingTrigger(fallerIds: string[], fallHeightFt: number): ReactionTrigger {
  return { kind: 'falling', fallerIds, fallHeightFt };
}

// ============================================================
// Section 1: Metadata shape
// ============================================================

console.log('\n--- Section 1: Metadata shape ---');

eq('metadata.name', metadata.name, 'Feather Fall');
eq('metadata.level', metadata.level, 1);
eq('metadata.school', metadata.school, 'transmutation');
eq('metadata.rangeFt', metadata.rangeFt, 60);
eq('metadata.concentration', metadata.concentration, false);
eq('metadata.castingTime', metadata.castingTime, 'reaction');

// ============================================================
// Section 2: shouldCastReaction — preconditions
// ============================================================

console.log('\n--- Section 2: shouldCastReaction preconditions ---');

{
  const caster = makeCombatant('caster', {
    actions: [FEATHER_FALL_ACTION],
    resources: withSlots(2),
  });
  const faller = makeCombatant('faller', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, faller]);

  eq('Faller within 60 ft: should cast', shouldCastReaction(caster, bf, makeFallingTrigger(['faller'], 50)), true);
  eq('Self-fall: should cast (can self-cast)', shouldCastReaction(caster, bf, makeFallingTrigger(['caster'], 50)), true);
}

// Range gating
{
  const caster = makeCombatant('caster', {
    actions: [FEATHER_FALL_ACTION],
    resources: withSlots(2),
    pos: { x: 0, y: 0, z: 0 },
  });
  const farFaller = makeCombatant('far', { pos: { x: 13, y: 0, z: 0 } });  // 65 ft
  const bf = makeBF([caster, farFaller]);

  eq('Faller at 65 ft: should NOT cast', shouldCastReaction(caster, bf, makeFallingTrigger(['far'], 50)), false);
}

// Fall height 0 — no damage to negate
{
  const caster = makeCombatant('caster', {
    actions: [FEATHER_FALL_ACTION],
    resources: withSlots(2),
  });
  const faller = makeCombatant('faller', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, faller]);

  eq('Fall height 0: should NOT cast', shouldCastReaction(caster, bf, makeFallingTrigger(['faller'], 0)), false);
  eq('Empty faller list: should NOT cast', shouldCastReaction(caster, bf, makeFallingTrigger([], 50)), false);
}

// ============================================================
// Section 3: executeReaction — marks fallers, negates damage
// ============================================================

console.log('\n--- Section 3: executeReaction — marks fallers ---');

{
  const caster = makeCombatant('caster', {
    actions: [FEATHER_FALL_ACTION],
    resources: withSlots(2),
  });
  const faller1 = makeCombatant('f1', { pos: { x: 1, y: 0, z: 0 } });
  const faller2 = makeCombatant('f2', { pos: { x: 2, y: 0, z: 0 } });
  const bf = makeBF([caster, faller1, faller2]);
  const state = makeState(bf);

  const outcome = executeReaction(caster, state, makeFallingTrigger(['f1', 'f2'], 50));

  eq('Outcome kind is negated', outcome.kind, 'negated');
  eq('Reaction used', caster.budget.reactionUsed, true);
  eq('Slot consumed', caster.resources!.spellSlots![1].remaining, 1);
  eq('Faller1 marked', (faller1 as any)._featherFallActive, true);
  eq('Faller2 marked', (faller2 as any)._featherFallActive, true);

  const logMsg = state.log.events.some(e => e.description.includes('casts Feather Fall'));
  assert('Log mentions Feather Fall', logMsg);
  const noDmgMsg = state.log.events.some(e => e.description.includes('NO fall damage'));
  assert('Log mentions NO fall damage', noDmgMsg);
}

// ============================================================
// Section 4: Max 5 fallers cap
// ============================================================

console.log('\n--- Section 4: Max 5 fallers cap ---');

{
  const caster = makeCombatant('caster', {
    actions: [FEATHER_FALL_ACTION],
    resources: withSlots(2),
    pos: { x: 0, y: 0, z: 0 },
  });
  const fallers: Combatant[] = [];
  for (let i = 1; i <= 7; i++) {
    fallers.push(makeCombatant(`f${i}`, { pos: { x: i, y: 0, z: 0 } }));
  }
  const bf = makeBF([caster, ...fallers]);
  const state = makeState(bf);

  const fallerIds = fallers.map(f => f.id);
  const outcome = executeReaction(caster, state, makeFallingTrigger(fallerIds, 50));

  eq('Outcome negated with 7 fallers', outcome.kind, 'negated');

  // Only the first 5 should be marked
  let markedCount = 0;
  for (const f of fallers) {
    if ((f as any)._featherFallActive) markedCount++;
  }
  eq('Only 5 fallers marked (cap)', markedCount, 5);

  // Check the log mentions "5 creatures"
  const countMsg = state.log.events.some(e => e.description.includes('5 creature'));
  assert('Log mentions 5 creatures', countMsg);
}

// ============================================================
// Section 5: Range check per-faller
// ============================================================

console.log('\n--- Section 5: Range check per-faller ---');

{
  const caster = makeCombatant('caster', {
    actions: [FEATHER_FALL_ACTION],
    resources: withSlots(2),
    pos: { x: 0, y: 0, z: 0 },
  });
  const nearFaller = makeCombatant('near', { pos: { x: 1, y: 0, z: 0 } });  // 5 ft
  const farFaller = makeCombatant('far', { pos: { x: 13, y: 0, z: 0 } });   // 65 ft
  const bf = makeBF([caster, nearFaller, farFaller]);
  const state = makeState(bf);

  const outcome = executeReaction(caster, state, makeFallingTrigger(['near', 'far'], 50));

  eq('Outcome negated (1 faller in range)', outcome.kind, 'negated');
  eq('Near faller marked', (nearFaller as any)._featherFallActive, true);
  eq('Far faller NOT marked (out of range)', (farFaller as any)._featherFallActive, undefined);
}

// ============================================================
// Section 6: Wrong trigger kind — no-op
// ============================================================

console.log('\n--- Section 6: Wrong trigger kind ---');

{
  const caster = makeCombatant('caster', {
    actions: [FEATHER_FALL_ACTION],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const wrongTrigger: ReactionTrigger = {
    kind: 'incoming_attack_hit',
    attacker: enemy,
    action: FEATHER_FALL_ACTION,
    attackRoll: 15,
    attackTotal: 20,
    effectiveAC: 15,
    isCrit: false,
  };
  eq('shouldCastReaction on wrong trigger: false', shouldCastReaction(caster, bf, wrongTrigger), false);

  const outcome = executeReaction(caster, state, wrongTrigger);
  eq('executeReaction on wrong trigger: no_effect', outcome.kind, 'no_effect');
  eq('Reaction NOT used on wrong trigger', caster.budget.reactionUsed, false);
}

// ============================================================
// Section 7: cleanup is a no-op
// ============================================================

console.log('\n--- Section 7: cleanup is a no-op ---');

{
  const caster = makeCombatant('caster');
  cleanup(caster);
  assert('cleanup does not throw', true);
}

// ============================================================
// Final results
// ============================================================

console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('feather_fall.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('feather_fall.test.ts: all tests passed ✅');
}
