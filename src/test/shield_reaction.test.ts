// ============================================================
// shield_reaction.test.ts — Shield reaction spell module (TG-008)
// PHB p.275: 1st-level abjuration, reaction
// Trigger: Being hit by an attack (or targeted by Magic Missile — v1: not modelled)
// Effect: +5 AC until start of next turn, including against the triggering attack.
//
// Tests cover the NEW trigger-aware functions (shouldCastReaction /
// executeReaction) and the legacy functions (shouldCast / execute / cleanup).
// ============================================================

import {
  shouldCastReaction, executeReaction, metadata, cleanup,
  shouldCast as shouldCastLegacy, execute as executeLegacy,
} from '../spells/shield';
import { Combatant, Action, PlayerResources, Battlefield, ReactionTrigger } from '../types/core';
import { EngineState } from '../engine/combat';
import { getActiveAcBonus } from '../engine/spell_effects';

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

const SHIELD_ACTION: Action = {
  name: 'Shield', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Shield',
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

eq('metadata.name', metadata.name, 'Shield');
eq('metadata.level', metadata.level, 1);
eq('metadata.school', metadata.school, 'abjuration');
eq('metadata.rangeFt', metadata.rangeFt, 0);
eq('metadata.concentration', metadata.concentration, false);
eq('metadata.castingTime', metadata.castingTime, 'reaction');

// ============================================================
// Section 2: shouldCastReaction — tactical gating
// ============================================================

console.log('\n--- Section 2: shouldCastReaction tactical gating ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
    ac: 15,
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

  // AC 15, attack total 17 → 17 < 15+5=20 → Shield WILL flip to miss → cast
  eq('Attack 17 vs AC 15: +5 flips to miss → cast', 
    shouldCastReaction(caster, bf, makeAttackHitTrigger(attacker, swordAction, 12, 17, 15)), true);

  // AC 15, attack total 20 → 20 >= 15+5=20 → Shield will NOT flip → don't cast
  eq('Attack 20 vs AC 15: +5 does NOT flip → don\'t cast',
    shouldCastReaction(caster, bf, makeAttackHitTrigger(attacker, swordAction, 15, 20, 15)), false);

  // AC 15, attack total 19 → 19 < 20 → Shield WILL flip → cast
  eq('Attack 19 vs AC 15: +5 flips to miss → cast',
    shouldCastReaction(caster, bf, makeAttackHitTrigger(attacker, swordAction, 14, 19, 15)), true);

  // AC 15, attack total 21 → 21 >= 20 → don't cast
  eq('Attack 21 vs AC 15: +5 does NOT flip → don\'t cast',
    shouldCastReaction(caster, bf, makeAttackHitTrigger(attacker, swordAction, 16, 21, 15)), false);
}

// ============================================================
// Section 3: shouldCastReaction — already active guard
// ============================================================

console.log('\n--- Section 3: shouldCastReaction — already active ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
    ac: 15,
    activeEffects: [{
      id: 'eff_1', casterId: 'caster', spellName: 'Shield',
      effectType: 'ac_bonus', payload: { acBonus: 5 },
      sourceIsConcentration: false,
    } as any],
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

  // Shield already active → don't cast again
  eq('Shield already active: don\'t cast', 
    shouldCastReaction(caster, bf, makeAttackHitTrigger(attacker, swordAction, 12, 17, 20)), false);
}

// ============================================================
// Section 4: shouldCastReaction — self-trigger guard
// ============================================================

console.log('\n--- Section 4: shouldCastReaction — self-trigger ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
    ac: 15,
  });
  const bf = makeBF([caster]);
  const swordAction: Action = {
    name: 'Sword', costType: 'action', attackType: 'melee',
    isMultiattack: false, reach: 5, range: { normal: 5, long: 5 },
    hitBonus: 5, damage: null, damageType: 'slashing',
    saveDC: null, saveAbility: null, isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 0, legendaryCost: 0, description: 'Sword',
  };

  // Self-attack → don't cast
  eq('Self-attack: don\'t cast',
    shouldCastReaction(caster, bf, makeAttackHitTrigger(caster, swordAction, 12, 17, 15)), false);
}

// ============================================================
// Section 5: shouldCastReaction — wrong trigger kind
// ============================================================

console.log('\n--- Section 5: shouldCastReaction — wrong trigger ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  // incoming_damage trigger — Shield should ignore
  const wrongTrigger: ReactionTrigger = {
    kind: 'incoming_damage',
    attacker: enemy, target: caster, amount: 10, damageType: 'fire',
  };
  eq('incoming_damage trigger: don\'t cast', shouldCastReaction(caster, bf, wrongTrigger), false);

  // incoming_spell trigger — Shield should ignore
  const spellTrigger: ReactionTrigger = {
    kind: 'incoming_spell', caster: enemy, spellName: 'Fireball', level: 3,
  };
  eq('incoming_spell trigger: don\'t cast', shouldCastReaction(caster, bf, spellTrigger), false);
}

// ============================================================
// Section 6: executeReaction — applies +5 AC, returns negated
// ============================================================

console.log('\n--- Section 6: executeReaction — applies +5 AC ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
    ac: 15,
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

  const outcome = executeReaction(caster, state, makeAttackHitTrigger(attacker, swordAction, 12, 17, 15));

  eq('Outcome kind is negated', outcome.kind, 'negated');
  eq('Reaction used', caster.budget.reactionUsed, true);
  eq('Slot consumed', caster.resources!.spellSlots![1].remaining, 1);

  // Check the +5 AC effect was applied
  eq('getActiveAcBonus returns 5 after Shield', getActiveAcBonus(caster), 5);

  // Check the effect is on the caster's activeEffects
  const shieldEffect = caster.activeEffects.find((e: any) => e.spellName === 'Shield');
  assert('Shield effect on activeEffects', shieldEffect !== undefined);
  eq('Shield effect type is ac_bonus', shieldEffect!.effectType, 'ac_bonus');
  eq('Shield effect acBonus is 5', (shieldEffect!.payload as any).acBonus, 5);
  eq('Shield effect not concentration', shieldEffect!.sourceIsConcentration, false);

  // Check the log
  const logMsg = state.log.events.some(e => e.description.includes('casts Shield'));
  assert('Log mentions Shield', logMsg);
  const negatesMsg = state.log.events.some(e => e.description.includes('negates'));
  assert('Log mentions negates', negatesMsg);
}

// ============================================================
// Section 7: executeReaction — wrong trigger is no-op
// ============================================================

console.log('\n--- Section 7: executeReaction — wrong trigger ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
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
  eq('Reaction NOT used on wrong trigger', caster.budget.reactionUsed, false);
  eq('Slot NOT consumed on wrong trigger', caster.resources!.spellSlots![1].remaining, 2);
}

// ============================================================
// Section 8: cleanup removes Shield effect
// ============================================================

console.log('\n--- Section 8: cleanup removes Shield effect ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
    activeEffects: [{
      id: 'eff_1', casterId: 'caster', spellName: 'Shield',
      effectType: 'ac_bonus', payload: { acBonus: 5 },
      sourceIsConcentration: false,
    } as any],
  });

  eq('Before cleanup: Shield active', caster.activeEffects.some((e: any) => e.spellName === 'Shield'), true);
  cleanup(caster);
  eq('After cleanup: Shield removed', caster.activeEffects.some((e: any) => e.spellName === 'Shield'), false);
  eq('After cleanup: getActiveAcBonus is 0', getActiveAcBonus(caster), 0);
}

// Cleanup with no Shield effect is safe
{
  const caster = makeCombatant('caster');
  cleanup(caster);  // should not throw
  assert('cleanup with no Shield effect is safe', true);
}

// ============================================================
// Section 9: Legacy shouldCast / execute (backwards compat)
// ============================================================

console.log('\n--- Section 9: Legacy shouldCast / execute ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([caster]);

  // Legacy shouldCast — checks preconditions (no tactical gating)
  eq('Legacy shouldCast: true (slot, reaction, spell known)', shouldCastLegacy(caster, bf), true);

  // Legacy shouldCast — no slot
  caster.resources = withSlots(0);
  eq('Legacy shouldCast: false (no slot)', shouldCastLegacy(caster, bf), false);

  // Legacy shouldCast — reaction used
  caster.resources = withSlots(2);
  caster.budget.reactionUsed = true;
  eq('Legacy shouldCast: false (reaction used)', shouldCastLegacy(caster, bf), false);

  // Legacy shouldCast — already active
  caster.budget.reactionUsed = false;
  caster.activeEffects = [{
    id: 'eff_1', casterId: 'caster', spellName: 'Shield',
    effectType: 'ac_bonus', payload: { acBonus: 5 },
    sourceIsConcentration: false,
  } as any];
  eq('Legacy shouldCast: false (already active)', shouldCastLegacy(caster, bf), false);
}

// Legacy execute
{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  executeLegacy(caster, state, 'Longsword');
  eq('Legacy execute: reaction used', caster.budget.reactionUsed, true);
  eq('Legacy execute: slot consumed', caster.resources!.spellSlots![1].remaining, 1);
  eq('Legacy execute: +5 AC applied', getActiveAcBonus(caster), 5);
  const logMsg = state.log.events.some(e => e.description.includes('casts Shield'));
  assert('Legacy execute: logged', logMsg);
}

// ============================================================
// Final results
// ============================================================

console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('shield_reaction.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('shield_reaction.test.ts: all tests passed ✅');
}
