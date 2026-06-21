// ============================================================
// hellish_rebuke.test.ts — Hellish Rebuke reaction spell module (TG-008)
// PHB p.249: 1st-level evocation, reaction
// Trigger: You take damage from a creature within 60 ft
// Effect: 2d10 fire damage to attacker (DEX save half). Upcast: +1d10/slot level.
// ============================================================

import {
  shouldCastReaction, executeReaction, metadata, cleanup,
} from '../spells/hellish_rebuke';
import { Combatant, Action, PlayerResources, Battlefield, DamageType, ReactionTrigger } from '../types/core';
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

const HELLISH_REBUKE_ACTION: Action = {
  name: 'Hellish Rebuke', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Hellish Rebuke',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 15, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 16,
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

function makeDamageTrigger(attacker: Combatant, target: Combatant, amount: number, damageType: DamageType): ReactionTrigger {
  return { kind: 'incoming_damage', attacker, target, amount, damageType };
}

// ============================================================
// Section 1: Metadata shape
// ============================================================

console.log('\n--- Section 1: Metadata shape ---');

eq('metadata.name', metadata.name, 'Hellish Rebuke');
eq('metadata.level', metadata.level, 1);
eq('metadata.school', metadata.school, 'evocation');
eq('metadata.rangeFt', metadata.rangeFt, 60);
eq('metadata.concentration', metadata.concentration, false);
eq('metadata.castingTime', metadata.castingTime, 'reaction');

// ============================================================
// Section 2: shouldCastReaction — preconditions
// ============================================================

console.log('\n--- Section 2: shouldCastReaction preconditions ---');

{
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
    cha: 16,
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);

  eq('Damage taken, attacker in range: cast', shouldCastReaction(caster, bf, makeDamageTrigger(attacker, caster, 10, 'slashing')), true);
}

// Amount 0 — don't cast
{
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);

  eq('Amount 0: don\'t cast', shouldCastReaction(caster, bf, makeDamageTrigger(attacker, caster, 0, 'slashing')), false);
}

// Range gating (60 ft)
{
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
    pos: { x: 0, y: 0, z: 0 },
  });
  const farAttacker = makeCombatant('far', { faction: 'enemy', pos: { x: 13, y: 0, z: 0 } });  // 65 ft
  const bf = makeBF([caster, farAttacker]);

  eq('Attacker at 65 ft: don\'t cast', shouldCastReaction(caster, bf, makeDamageTrigger(farAttacker, caster, 10, 'slashing')), false);
}

// Self-damage — don't cast
{
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([caster]);

  eq('Self-damage: don\'t cast', shouldCastReaction(caster, bf, makeDamageTrigger(caster, caster, 10, 'slashing')), false);
}

// Dead attacker — don't cast
{
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
  });
  const deadAttacker = makeCombatant('dead', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, isDead: true });
  const bf = makeBF([caster, deadAttacker]);

  eq('Dead attacker: don\'t cast', shouldCastReaction(caster, bf, makeDamageTrigger(deadAttacker, caster, 10, 'slashing')), false);
}

// Wrong trigger kind
{
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  const wrongTrigger: ReactionTrigger = {
    kind: 'incoming_attack_hit', attacker: enemy, action: HELLISH_REBUKE_ACTION,
    attackRoll: 15, attackTotal: 20, effectiveAC: 15, isCrit: false,
  };
  eq('Wrong trigger (attack_hit): don\'t cast', shouldCastReaction(caster, bf, wrongTrigger), false);
}

// ============================================================
// Section 3: executeReaction — deals fire damage to attacker
// ============================================================

console.log('\n--- Section 3: executeReaction deals fire damage ---');

{
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
    cha: 16,  // +3 mod → DC = 8 + 3 + 2 = 13
  });
  const attacker = makeCombatant('attacker', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 100, currentHP: 100,
    dex: 10,  // +0 mod
    ac: 15,
  });
  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  const attackerHPBefore = attacker.currentHP;
  const outcome = executeReaction(caster, state, makeDamageTrigger(attacker, caster, 10, 'slashing'));

  eq('Outcome kind is no_effect (damage still applies to target)', outcome.kind, 'no_effect');
  eq('Reaction used', caster.budget.reactionUsed, true);
  eq('Slot consumed', caster.resources!.spellSlots![1].remaining, 1);

  // Attacker should have taken fire damage (2d10 = 2-20, or half on save)
  assert('Attacker took damage', attacker.currentHP < attackerHPBefore,
    `HP: ${attackerHPBefore} → ${attacker.currentHP}`);

  // Log checks
  const hrLog = state.log.events.some(e => e.description.includes('casts Hellish Rebuke'));
  assert('Log mentions Hellish Rebuke', hrLog);
  const fireLog = state.log.events.some(e => e.type === 'damage' && e.description.includes('fire damage'));
  assert('Log mentions fire damage', fireLog);
  const saveLog = state.log.events.some(e => e.type === 'save_success' || e.type === 'save_fail');
  assert('Log has save result', saveLog);
}

// ============================================================
// Section 4: Save DC computation
// ============================================================

console.log('\n--- Section 4: Save DC computation ---');

{
  // CHA 16 (+3) → DC = 8 + 3 + 2 = 13
  const caster1 = makeCombatant('c1', { actions: [HELLISH_REBUKE_ACTION], resources: withSlots(2), cha: 16 });
  const attacker1 = makeCombatant('a1', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, dex: 10 });
  const bf1 = makeBF([caster1, attacker1]);
  const state1 = makeState(bf1);
  executeReaction(caster1, state1, makeDamageTrigger(attacker1, caster1, 10, 'slashing'));
  const dc13Log = state1.log.events.some(e => e.description.includes('DC 13'));
  assert('CHA 16 → DC 13', dc13Log);
}

{
  // CHA 20 (+5) → DC = 8 + 5 + 2 = 15
  const caster2 = makeCombatant('c2', { actions: [HELLISH_REBUKE_ACTION], resources: withSlots(2), cha: 20 });
  const attacker2 = makeCombatant('a2', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 }, dex: 10 });
  const bf2 = makeBF([caster2, attacker2]);
  const state2 = makeState(bf2);
  executeReaction(caster2, state2, makeDamageTrigger(attacker2, caster2, 10, 'slashing'));
  const dc15Log = state2.log.events.some(e => e.description.includes('DC 15'));
  assert('CHA 20 → DC 15', dc15Log);
}

// ============================================================
// Section 5: DEX save halves damage
// ============================================================

console.log('\n--- Section 5: DEX save halves damage ---');

{
  // Run many times to observe both save success and failure.
  const caster = makeCombatant('caster', {
    actions: [HELLISH_REBUKE_ACTION],
    resources: withSlots(2),
    cha: 10,  // +0 mod → DC = 8 + 0 + 2 = 10
  });
  const attacker = makeCombatant('attacker', {
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    dex: 20,  // +5 mod → high save chance vs DC 10
    ac: 15,
  });
  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  let saveSuccessCount = 0;
  let saveFailCount = 0;
  for (let i = 0; i < 50; i++) {
    caster.budget.reactionUsed = false;
    caster.resources = withSlots(2);
    const beforeHP = attacker.currentHP;
    executeReaction(caster, state, makeDamageTrigger(attacker, caster, 10, 'slashing'));
    const afterHP = attacker.currentHP;
    const damage = beforeHP - afterHP;
    // 2d10 = 2-20. Save success → half (1-10). Save fail → full (2-20).
    // If damage <= 10, likely save success. If damage > 10, likely save fail.
    // (Not perfectly accurate due to halving rounding, but a good heuristic.)
    if (damage <= 10) saveSuccessCount++;
    else saveFailCount++;
  }
  assert('Both save outcomes observed (DEX 20 vs DC 10)', saveSuccessCount > 0 && saveFailCount > 0,
    `success=${saveSuccessCount}, fail=${saveFailCount}`);
  // DEX 20 (+5) vs DC 10 → need 5+ on d20 (80% success). Allow wide margin.
  assert('Save success rate is high (DEX 20 vs DC 10)', saveSuccessCount >= 25, `success=${saveSuccessCount}/50`);
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
    actions: [HELLISH_REBUKE_ACTION],
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
  console.error('hellish_rebuke.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('hellish_rebuke.test.ts: all tests passed ✅');
}
