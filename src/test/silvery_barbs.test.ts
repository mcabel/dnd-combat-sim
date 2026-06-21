// ============================================================
// silvery_barbs.test.ts — Silvery Barbs reaction spell module (TG-008)
// SCC p.38: 1st-level enchantment, reaction
// Trigger: A creature you can see within 60 ft hits on an attack roll
// Effect: Force reroll, use the lower. If the lower misses, the hit is negated.
//
// v1 simplifications:
//   - Only triggers on attack hits (not save successes or ability check successes)
//   - The "advantage on next attack" rider is NOT modelled
//   - Upcast (+1 creature per slot level) is NOT modelled
// ============================================================

import {
  shouldCastReaction, executeReaction, metadata, cleanup,
} from '../spells/silvery_barbs';
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

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

const SILVERY_BARBS_ACTION: Action = {
  name: 'Silvery Barbs', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Silvery Barbs',
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

function makeAttackHitTrigger(attacker: Combatant, action: Action, roll: number, total: number, ac: number, isCrit = false): ReactionTrigger {
  return {
    kind: 'incoming_attack_hit',
    attacker, action, attackRoll: roll, attackTotal: total, effectiveAC: ac, isCrit,
  };
}

// ============================================================
// Section 1: Metadata shape
// ============================================================

console.log('\n--- Section 1: Metadata shape ---');

eq('metadata.name', metadata.name, 'Silvery Barbs');
eq('metadata.level', metadata.level, 1);
eq('metadata.school', metadata.school, 'enchantment');
eq('metadata.rangeFt', metadata.rangeFt, 60);
eq('metadata.concentration', metadata.concentration, false);
eq('metadata.castingTime', metadata.castingTime, 'reaction');

// ============================================================
// Section 2: shouldCastReaction — preconditions
// ============================================================

console.log('\n--- Section 2: shouldCastReaction preconditions ---');

{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5, damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  eq('Enemy attack hit: cast', shouldCastReaction(caster, bf, makeAttackHitTrigger(attacker, swordAction, 15, 20, 15)), true);
}

// Range gating (60 ft)
{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
    pos: { x: 0, y: 0, z: 0 },
  });
  const farAttacker = makeCombatant('far', { faction: 'enemy', pos: { x: 13, y: 0, z: 0 } });  // 65 ft
  const bf = makeBF([caster, farAttacker]);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5, damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  eq('Attacker at 65 ft: don\'t cast', shouldCastReaction(caster, bf, makeAttackHitTrigger(farAttacker, swordAction, 15, 20, 15)), false);
}

// Self-attack — don't cast
{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([caster]);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5, damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  eq('Self-attack: don\'t cast', shouldCastReaction(caster, bf, makeAttackHitTrigger(caster, swordAction, 15, 20, 15)), false);
}

// Dead attacker — don't cast
{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const deadAttacker = makeCombatant('dead', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, isDead: true });
  const bf = makeBF([caster, deadAttacker]);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5, damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  eq('Dead attacker: don\'t cast', shouldCastReaction(caster, bf, makeAttackHitTrigger(deadAttacker, swordAction, 15, 20, 15)), false);
}

// Wrong trigger kind
{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  const wrongTrigger: ReactionTrigger = {
    kind: 'incoming_damage', attacker: enemy, target: caster, amount: 10, damageType: 'fire',
  };
  eq('Wrong trigger (incoming_damage): don\'t cast', shouldCastReaction(caster, bf, wrongTrigger), false);
}

// ============================================================
// Section 3: executeReaction — reroll mechanic
// ============================================================

console.log('\n--- Section 3: executeReaction reroll mechanic ---');

{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5, damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  // Original roll 15, total 20, AC 15 (hit). Reroll may flip to miss.
  const outcome = executeReaction(caster, state, makeAttackHitTrigger(attacker, swordAction, 15, 20, 15));

  // The outcome is either 'negated' (lower roll missed) or 'failed' (lower roll still hit).
  assert('Outcome is negated or failed', outcome.kind === 'negated' || outcome.kind === 'failed',
    `got ${outcome.kind}`);
  eq('Reaction used', caster.budget.reactionUsed, true);
  eq('Slot consumed', caster.resources!.spellSlots![1].remaining, 1);

  // Log checks
  const sbLog = state.log.events.some(e => e.description.includes('casts Silvery Barbs'));
  assert('Log mentions Silvery Barbs', sbLog);
  const rerollLog = state.log.events.some(e => e.description.includes('reroll'));
  assert('Log mentions reroll', rerollLog);
}

// ============================================================
// Section 4: Reroll uses the lower of the two rolls
// ============================================================

console.log('\n--- Section 4: Reroll uses lower roll ---');

{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5, damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  // Run many times to observe both outcomes.
  let negatedCount = 0;
  let failedCount = 0;
  for (let i = 0; i < 100; i++) {
    caster.budget.reactionUsed = false;
    caster.resources = withSlots(2);
    const state = makeState(bf);
    // Original roll 15, total 20, AC 15 (hit by 5).
    // Reroll: new d20. Lower of (15, new) is used. If new < 15, lower is new.
    //   If new <= 9, total = new + 5 = 14 → miss (negated).
    //   If new >= 10, total >= 15 → still hit (failed).
    // If new >= 15, lower is 15 → still 20 → still hit (failed).
    // P(negated) = P(new <= 9) = 9/20 = 45%.
    const outcome = executeReaction(caster, state, makeAttackHitTrigger(attacker, swordAction, 15, 20, 15));
    if (outcome.kind === 'negated') negatedCount++;
    else if (outcome.kind === 'failed') failedCount++;
  }
  assert('Both outcomes observed', negatedCount > 0 && failedCount > 0,
    `negated=${negatedCount}, failed=${failedCount}`);
  // P(negated) ≈ 45%. Allow wide margin (25-65%).
  assert('Negated rate in reasonable range (25-65%)', negatedCount >= 25 && negatedCount <= 65,
    `negated=${negatedCount}/100`);
}

// ============================================================
// Section 5: High attack roll — reroll rarely flips
// ============================================================

console.log('\n--- Section 5: High attack roll rarely flips ---');

{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 20,  // very high bonus
    damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  // Original roll 20 (nat 20 crit), total 40, AC 15.
  // Reroll: new d20. Lower of (20, new) is used. If new < 20, lower is new.
  //   Total = new + 20. For a miss by total, need new + 20 < 15 → impossible.
  //   BUT: nat 1 auto-misses (PHB p.194). So a reroll of 1 WILL flip to miss.
  //   P(nat 1 reroll) = 1/20 = 5%. Over 50 trials, expect ~2-3 negations.
  let negatedCount = 0;
  for (let i = 0; i < 50; i++) {
    caster.budget.reactionUsed = false;
    caster.resources = withSlots(2);
    const state = makeState(bf);
    const outcome = executeReaction(caster, state, makeAttackHitTrigger(attacker, swordAction, 20, 40, 15, true));
    if (outcome.kind === 'negated') negatedCount++;
  }
  // Only nat-1 rerolls can negate (5% chance). Allow 0-6 (wide margin for randomness).
  assert('High-bonus attack: reroll only negates on nat 1 (0-6 negations)', negatedCount <= 6,
    `negated=${negatedCount}`);
}

// ============================================================
// Section 6: cleanup is a no-op
// ============================================================

console.log('\n--- Section 6: cleanup is a no-op ---');

{
  const caster = makeCombatant('caster');
  cleanup(caster);
  assert('cleanup does not throw', true);
}

// ============================================================
// Section 7: Wrong trigger kind — no-op
// ============================================================

console.log('\n--- Section 7: Wrong trigger kind ---');

{
  const caster = makeCombatant('caster', {
    actions: [SILVERY_BARBS_ACTION],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const wrongTrigger: ReactionTrigger = {
    kind: 'incoming_spell', caster: enemy, spellName: 'Fireball', level: 3,
  };
  const outcome = executeReaction(caster, state, wrongTrigger);
  eq('Wrong trigger: no_effect', outcome.kind, 'no_effect');
  eq('Reaction NOT used', caster.budget.reactionUsed, false);
}

// ============================================================
// Final results
// ============================================================

console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('silvery_barbs.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('silvery_barbs.test.ts: all tests passed ✅');
}
