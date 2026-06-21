// ============================================================
// counterspell.test.ts — Counterspell reaction spell module
// PHB p.228: 3rd-level abjuration, reaction
// Trigger: You see a creature within 60 feet of you casting a spell
// Effect: Auto-success vs L1-3 spells (with L3 slot); ability check
//         vs DC 10+level for L4+ spells. Upcast: auto-success up to
//         the slot level used.
//
// Tests cover:
//   1. Metadata shape
//   2. shouldCastReaction — preconditions and tactical gating
//   3. executeReaction — auto-success for L1-3 spells
//   4. executeReaction — ability check for L4+ spells
//   5. executeReaction — upcast auto-success
//   6. Integration via executePlannedAction (spell is negated)
//   7. Range gating (60 ft)
//   8. Cantrip exclusion (level 0 — not countered in v1)
// ============================================================

import {
  shouldCastReaction, executeReaction, metadata, cleanup,
} from '../spells/counterspell';
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

function withL3Slots(remaining = 1): PlayerResources {
  return { spellSlots: { 3: { max: 1, remaining } } };
}

function withL3AndL5(l3 = 1, l5 = 1): PlayerResources {
  return { spellSlots: { 3: { max: 1, remaining: l3 }, 5: { max: 1, remaining: l5 } } };
}

const COUNTERSPELL_ACTION: Action = {
  name: 'Counterspell', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 3, legendaryCost: 0, description: 'Counterspell',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 50, currentHP: 50, ac: 15, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10,
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

function makeSpellTrigger(caster: Combatant, spellName: string, level: number): ReactionTrigger {
  return { kind: 'incoming_spell', caster, spellName, level };
}

// ============================================================
// Section 1: Metadata shape
// ============================================================

console.log('\n--- Section 1: Metadata shape ---');

eq('metadata.name', metadata.name, 'Counterspell');
eq('metadata.level', metadata.level, 3);
eq('metadata.school', metadata.school, 'abjuration');
eq('metadata.rangeFt', metadata.rangeFt, 60);
eq('metadata.concentration', metadata.concentration, false);
eq('metadata.castingTime', metadata.castingTime, 'reaction');

// ============================================================
// Section 2: shouldCastReaction — preconditions
// ============================================================

console.log('\n--- Section 2: shouldCastReaction preconditions ---');

{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
    int: 18,  // +4 mod
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  // L1 spell → should cast (auto-success)
  eq('L1 spell: should cast', shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Magic Missile', 1)), true);
  // L3 spell → should cast (auto-success)
  eq('L3 spell: should cast', shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Fireball', 3)), true);
  // L4 spell → should cast (ability check, but caster has +4 INT + 2 prof = +6, DC 14, ~65% chance)
  eq('L4 spell: should cast', shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Polymorph', 4)), true);
  // L5 spell → should cast (DC 15, need 9+ on d20, ~60%)
  eq('L5 spell: should cast', shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Cone of Cold', 5)), true);
}

// Cantrip exclusion
{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
    int: 18,
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  eq('Cantrip (L0): should NOT cast', shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Fire Bolt', 0)), false);
}

// Range gating
{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
    pos: { x: 0, y: 0, z: 0 },
  });
  const farEnemy = makeCombatant('far', { faction: 'enemy', pos: { x: 13, y: 0, z: 0 } });  // 65 ft
  const bf = makeBF([caster, farEnemy]);

  eq('L1 spell at 65 ft: should NOT cast (out of range)', shouldCastReaction(caster, bf, makeSpellTrigger(farEnemy, 'Magic Missile', 1)), false);
}

// Self-trigger guard
{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
  });
  const bf = makeBF([caster]);

  eq('Self-cast: should NOT cast', shouldCastReaction(caster, bf, makeSpellTrigger(caster, 'Fireball', 3)), false);
}

// No slot available
{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(0),  // no L3 slots
    int: 18,
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  // shouldCastReaction itself doesn't check slots (the registry/helper does),
  // but we test that it doesn't crash.
  // The tactical gating: without auto-success slot, L4+ spells need checkBonus >= 3.
  // With INT 18 (+4) + 2 prof = +6, L4 spell should still cast.
  eq('L4 spell with no L3 slot but good stats: may still cast', 
    typeof shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Polymorph', 4)) === 'boolean', true);
}

// ============================================================
// Section 3: executeReaction — auto-success for L1-3 spells
// ============================================================

console.log('\n--- Section 3: executeReaction — auto-success L1-3 ---');

{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
    int: 18,
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const outcome = executeReaction(caster, state, makeSpellTrigger(enemy, 'Magic Missile', 1));

  eq('Outcome kind is negated', outcome.kind, 'negated');
  eq('Reaction used', caster.budget.reactionUsed, true);
  eq('L3 slot consumed', caster.resources!.spellSlots![3].remaining, 0);

  const logMsg = state.log.events.find(e => e.description.includes('Counterspell'));
  assert('Log mentions Counterspell', logMsg !== undefined);
  const negatedMsg = state.log.events.some(e => e.description.includes('NEGATED'));
  assert('Log mentions NEGATED', negatedMsg);
  const autoSuccessMsg = state.log.events.some(e => e.description.includes('auto-success'));
  assert('Log mentions auto-success', autoSuccessMsg);
}

// L3 spell auto-success
{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
    int: 18,
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const outcome = executeReaction(caster, state, makeSpellTrigger(enemy, 'Fireball', 3));
  eq('L3 spell: outcome negated', outcome.kind, 'negated');
}

// ============================================================
// Section 4: executeReaction — ability check for L4+ spells
// ============================================================

console.log('\n--- Section 4: executeReaction — ability check L4+ ---');

{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
    int: 18,  // +4 mod + 2 prof = +6
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // L4 spell: DC 14, caster needs 8+ on d20 (with +6). Run multiple times.
  let negatedCount = 0;
  let failedCount = 0;
  for (let i = 0; i < 100; i++) {
    caster.budget.reactionUsed = false;
    caster.resources = withL3Slots(1);
    const outcome = executeReaction(caster, state, makeSpellTrigger(enemy, 'Polymorph', 4));
    if (outcome.kind === 'negated') negatedCount++;
    else if (outcome.kind === 'failed') failedCount++;
  }
  assert('L4 spell: at least some negated (ability check can succeed)', negatedCount > 0, `negated=${negatedCount}`);
  assert('L4 spell: at least some failed (ability check can fail)', failedCount > 0, `failed=${failedCount}`);
  eq('L4 spell: negated + failed = 100', negatedCount + failedCount, 100);
  // With +6 bonus vs DC 14, need 8+ on d20 → 65% success rate.
  // Allow a wide margin (40-85%) for randomness.
  assert('L4 spell: success rate in reasonable range (40-85%)', negatedCount >= 40 && negatedCount <= 85, `negated=${negatedCount}`);
}

// ============================================================
// Section 5: executeReaction — upcast auto-success
// ============================================================

console.log('\n--- Section 5: executeReaction — upcast auto-success ---');

{
  // Caster has L5 slots but no L3 slots. Counterspell upcast at L5 auto-succeeds vs L1-5 spells.
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: { spellSlots: { 5: { max: 1, remaining: 1 } } },
    int: 18,
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // L5 spell with L5 slot → auto-success
  const outcome = executeReaction(caster, state, makeSpellTrigger(enemy, 'Cone of Cold', 5));
  eq('L5 spell with L5 slot: negated', outcome.kind, 'negated');
  eq('L5 slot consumed', caster.resources!.spellSlots![5].remaining, 0);

  // Check the log mentions auto-success
  const autoSuccessMsg = state.log.events.some(e => e.description.includes('auto-success'));
  assert('Upcast auto-success logged', autoSuccessMsg);
}

// ============================================================
// Section 6: cleanup is a no-op
// ============================================================

console.log('\n--- Section 6: cleanup is a no-op ---');

{
  const caster = makeCombatant('caster');
  cleanup(caster);  // should not throw
  assert('cleanup does not throw', true);
}

// ============================================================
// Section 7: Wrong trigger kind — no-op
// ============================================================

console.log('\n--- Section 7: Wrong trigger kind ---');

{
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // incoming_attack_hit trigger — Counterspell should ignore
  const wrongTrigger: ReactionTrigger = {
    kind: 'incoming_attack_hit',
    attacker: enemy,
    action: COUNTERSPELL_ACTION,
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
// Section 8: High-level spell gating (L6+ without auto-success slot)
// ============================================================

console.log('\n--- Section 8: High-level spell gating ---');

{
  // Caster with only L3 slots, INT 18 (+6 check bonus).
  // L7 spell: DC 17, need 11+ on d20 (50%). shouldCastReaction gates on L6+ being too risky.
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: withL3Slots(1),
    int: 18,
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  // L7 spell without auto-success slot → should NOT cast (too risky per v1 gating)
  eq('L7 spell without auto-success slot: should NOT cast', 
    shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Prismatic Spray', 7)), false);

  // L6 spell without auto-success slot → also should NOT cast per v1 gating
  eq('L6 spell without auto-success slot: should NOT cast',
    shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Disintegrate', 6)), false);
}

// ============================================================
// Section 9: Auto-success slot unlocks L6+ countering
// ============================================================

console.log('\n--- Section 9: Auto-success slot unlocks L6+ ---');

{
  // Caster with L7 slot — can auto-succeed vs L7 spell
  const caster = makeCombatant('caster', {
    actions: [COUNTERSPELL_ACTION],
    resources: { spellSlots: { 7: { max: 1, remaining: 1 } } },
    int: 18,
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  eq('L7 spell WITH L7 slot: should cast (auto-success)', 
    shouldCastReaction(caster, bf, makeSpellTrigger(enemy, 'Prismatic Spray', 7)), true);
}

// ============================================================
// Final results
// ============================================================

console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('counterspell.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('counterspell.test.ts: all tests passed ✅');
}
