// ============================================================
// shield_reaction.test.ts — Shield reaction spell module (TG-008 + Session 37)
// PHB p.275: 1st-level abjuration, reaction
// Trigger: Being hit by an attack OR targeted by Magic Missile (Session 37)
// Effect: +5 AC until start of next turn, including against the triggering
//         attack. Also blocks ALL Magic Missile damage.
//
// Tests cover the NEW trigger-aware functions (shouldCastReaction /
// executeReaction) and the legacy functions (shouldCast / execute / cleanup).
// Session 37 adds section 8: Magic Missile blocking tests.
// ============================================================

import {
  shouldCastReaction, executeReaction, metadata, cleanup,
  shouldCast as shouldCastLegacy, execute as executeLegacy,
} from '../spells/shield';
import { Combatant, Action, PlayerResources, Battlefield, ReactionTrigger } from '../types/core';
import { EngineState, executePlannedAction } from '../engine/combat';
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
eq('metadata.shieldMagicMissileBlockingV1Implemented (Session 37)',
  (metadata as any).shieldMagicMissileBlockingV1Implemented, true);

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
// Section 8: Magic Missile blocking (Session 37)
// PHB p.275: "When you are hit by an attack or targeted by Magic Missile."
// Shield blocks ALL Magic Missile damage + grants +5 AC until start of
// next turn. Tests cover shouldCastReaction + executeReaction with the
// `targeted_by_magic_missile` trigger kind, plus end-to-end dispatch.
// ============================================================
console.log('\n--- Section 8: Magic Missile blocking (Session 37) ---');

function makeMagicMissileTrigger(caster: Combatant, target: Combatant, dartCount = 3): ReactionTrigger {
  return {
    kind: 'targeted_by_magic_missile',
    caster,
    target,
    dartCount,
  };
}

// 8a. shouldCastReaction: true for targeted_by_magic_missile (always cast — blocks all MM)
{
  const mmCaster = makeCombatant('mage', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const shielder = makeCombatant('wiz', {
    actions: [SHIELD_ACTION], resources: withSlots(2),
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
  });
  const bf = makeBF([mmCaster, shielder]);
  const trigger = makeMagicMissileTrigger(mmCaster, shielder);
  eq('8a. shouldCastReaction true for MM trigger', shouldCastReaction(shielder, bf, trigger), true);
}

// 8b. shouldCastReaction: false if caster targets self with MM (don't Shield own MM)
{
  const mmCaster = makeCombatant('mage', {
    actions: [SHIELD_ACTION], resources: withSlots(2),
  });
  const bf = makeBF([mmCaster]);
  // MM caster targets themselves (weird edge case) — Shield should not fire
  const trigger = makeMagicMissileTrigger(mmCaster, mmCaster);
  eq('8b. shouldCastReaction false (self-targeted MM)', shouldCastReaction(mmCaster, bf, trigger), false);
}

// 8c. shouldCastReaction: false if Shield already active (no benefit to recasting)
{
  const mmCaster = makeCombatant('mage', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const shielder = makeCombatant('wiz', {
    actions: [SHIELD_ACTION], resources: withSlots(2),
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    activeEffects: [{
      id: 'eff_1', casterId: 'wiz', spellName: 'Shield',
      effectType: 'ac_bonus', payload: { acBonus: 5 },
      sourceIsConcentration: false,
    } as any],
  });
  const bf = makeBF([mmCaster, shielder]);
  const trigger = makeMagicMissileTrigger(mmCaster, shielder);
  eq('8c. shouldCastReaction false (Shield already active)', shouldCastReaction(shielder, bf, trigger), false);
}

// 8d. shouldCastReaction: false for other trigger kinds (Shield only responds to attack-hit + MM)
{
  const shielder = makeCombatant('wiz', {
    actions: [SHIELD_ACTION], resources: withSlots(2),
  });
  const bf = makeBF([shielder]);
  // Construct a falling trigger (Shield should NOT respond to this)
  const fallingTrigger: ReactionTrigger = {
    kind: 'falling', fallerIds: ['wiz'], fallHeightFt: 50,
  };
  eq('8d. shouldCastReaction false for falling trigger',
    shouldCastReaction(shielder, bf, fallingTrigger), false);
}

// 8e. executeReaction: consumes slot, marks reaction used, applies +5 AC, returns negated
{
  const mmCaster = makeCombatant('mage', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const shielder = makeCombatant('wiz', {
    name: 'Wizard', actions: [SHIELD_ACTION], resources: withSlots(2),
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
  });
  const bf = makeBF([mmCaster, shielder]);
  const state = makeState(bf);
  const trigger = makeMagicMissileTrigger(mmCaster, shielder, 3);

  const outcome = executeReaction(shielder, state, trigger);

  eq('8e. outcome is negated', outcome.kind, 'negated');
  eq('8e. slot consumed', shielder.resources!.spellSlots![1].remaining, 1);
  eq('8e. reaction used', shielder.budget.reactionUsed, true);
  eq('8e. +5 AC applied', getActiveAcBonus(shielder), 5);
  // Log mentions Shield + Magic Missile + dart count
  const logEvent = state.log.events.find(e =>
    e.type === 'action' && e.description.includes('Shield') && e.description.includes('Magic Missile'));
  assert('8e. log event mentions Shield + Magic Missile', logEvent !== undefined);
  assert('8e. log event mentions 3 darts', !!(logEvent && logEvent.description.includes('3')));
}

// 8f. executeReaction: Shield effect has correct spellName + sourceIsConcentration=false
{
  const mmCaster = makeCombatant('mage', { faction: 'enemy' });
  const shielder = makeCombatant('wiz', {
    actions: [SHIELD_ACTION], resources: withSlots(2),
  });
  const bf = makeBF([mmCaster, shielder]);
  const state = makeState(bf);
  const trigger = makeMagicMissileTrigger(mmCaster, shielder);
  executeReaction(shielder, state, trigger);

  const shieldEffect = shielder.activeEffects.find(e => e.spellName === 'Shield');
  assert('8f. Shield effect attached', shieldEffect !== undefined);
  eq('8f. Shield effect type is ac_bonus', shieldEffect?.effectType, 'ac_bonus');
  eq('8f. Shield effect acBonus', shieldEffect?.payload.acBonus, 5);
  eq('8f. Shield effect sourceIsConcentration', shieldEffect?.sourceIsConcentration, false);
  eq('8f. Shield effect casterId is self', shieldEffect?.casterId, 'wiz');
}

// 8g. executeReaction: cleanup removes the Shield effect (same as attack-hit path)
{
  const mmCaster = makeCombatant('mage', { faction: 'enemy' });
  const shielder = makeCombatant('wiz', {
    actions: [SHIELD_ACTION], resources: withSlots(2),
  });
  const bf = makeBF([mmCaster, shielder]);
  const state = makeState(bf);
  const trigger = makeMagicMissileTrigger(mmCaster, shielder);
  executeReaction(shielder, state, trigger);
  assert('8g. Shield active before cleanup', getActiveAcBonus(shielder) === 5);
  cleanup(shielder);
  eq('8g. Shield removed after cleanup', getActiveAcBonus(shielder), 0);
}

// 8h. End-to-end: Magic Missile dispatch with Shield → no damage, MM slot consumed,
//     Shield slot consumed, reaction used, +5 AC active on the target.
//     This tests the `case 'magicMissile':` dispatch in combat.ts.
{
  // Build a Wizard (Shield caster) + Mage (Magic Missile caster).
  // We drive the dispatch directly via executePlannedAction.
  const MM_ACTION: Action = {
    name: 'Magic Missile', costType: 'action', attackType: 'spell',
    isMultiattack: false, reach: 0, range: { normal: 120, long: 120 },
    hitBonus: null, damage: { count: 1, sides: 4, bonus: 1, average: 3 },
    damageType: 'force', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 1, legendaryCost: 0, description: 'Magic Missile',
  };
  const mage = makeCombatant('mage', {
    name: 'Mage', faction: 'enemy', pos: { x: 5, y: 0, z: 0 },
    actions: [MM_ACTION], resources: withSlots(2),
  });
  const wiz = makeCombatant('wiz', {
    name: 'Wizard', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [SHIELD_ACTION], resources: withSlots(2),
    currentHP: 50, maxHP: 50,
  });
  const bf = makeBF([mage, wiz]);
  const state = makeState(bf);

  const hpBefore = wiz.currentHP;
  executePlannedAction(mage, {
    type: 'magicMissile', targetId: 'wiz',
    action: MM_ACTION, spellName: 'Magic Missile',
  } as any, state);

  // Shield fired → no damage to Wizard
  eq('8h. Wizard took NO damage (Shield blocked MM)', wiz.currentHP, hpBefore);
  // MM slot consumed (spell was cast)
  eq('8h. Mage MM slot consumed', mage.resources!.spellSlots![1].remaining, 1);
  // Shield slot consumed (reaction fired)
  eq('8h. Wizard Shield slot consumed', wiz.resources!.spellSlots![1].remaining, 1);
  // Reaction used
  eq('8h. Wizard reaction used', wiz.budget.reactionUsed, true);
  // +5 AC active on Wizard
  eq('8h. +5 AC active on Wizard', getActiveAcBonus(wiz), 5);
  // Log mentions the block
  const blockLog = state.log.events.some(e =>
    e.description.includes('BLOCKED') && e.description.includes('Shield'));
  assert('8h. block logged', blockLog);
}

// 8i. End-to-end: Magic Missile WITHOUT Shield → damage applies normally
//     (control: Shield trigger doesn't fire when target has no Shield)
{
  const MM_ACTION: Action = {
    name: 'Magic Missile', costType: 'action', attackType: 'spell',
    isMultiattack: false, reach: 0, range: { normal: 120, long: 120 },
    hitBonus: null, damage: { count: 1, sides: 4, bonus: 1, average: 3 },
    damageType: 'force', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 1, legendaryCost: 0, description: 'Magic Missile',
  };
  const mage = makeCombatant('mage', {
    name: 'Mage', faction: 'enemy', pos: { x: 5, y: 0, z: 0 },
    actions: [MM_ACTION], resources: withSlots(2),
  });
  // Fighter has NO Shield action — MM damage applies normally
  const fighter = makeCombatant('fighter', {
    name: 'Fighter', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [], resources: null,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([mage, fighter]);
  const state = makeState(bf);

  const hpBefore = fighter.currentHP;
  executePlannedAction(mage, {
    type: 'magicMissile', targetId: 'fighter',
    action: MM_ACTION, spellName: 'Magic Missile',
  } as any, state);

  // MM dealt damage (3 darts × 1d4+1 = 6..18 force damage)
  const dmgTaken = hpBefore - fighter.currentHP;
  assert('8i. Fighter took damage (no Shield, MM hit normally)', dmgTaken >= 6 && dmgTaken <= 18,
    `got ${dmgTaken}`);
  // No Shield effect on fighter
  eq('8i. no Shield effect on fighter', getActiveAcBonus(fighter), 0);
}

// 8j. End-to-end: Shield blocks MM but Shield already active from earlier → no recast,
//     MM damage applies (Shield is already active but MM auto-hits, so +5 AC doesn't
//     help — Shield's MM-blocking is a one-time reaction, not a passive aura).
//     Actually PHB p.275: "acts as a shield against Magic Missile" — this is the
//     REACTION effect, not a passive aura. If Shield is already active (from a prior
//     attack-hit reaction this round), the caster can't react again (reaction budget
//     used). So MM damage applies. This tests the reaction-budget gating.
{
  const MM_ACTION: Action = {
    name: 'Magic Missile', costType: 'action', attackType: 'spell',
    isMultiattack: false, reach: 0, range: { normal: 120, long: 120 },
    hitBonus: null, damage: { count: 1, sides: 4, bonus: 1, average: 3 },
    damageType: 'force', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    slotLevel: 1, legendaryCost: 0, description: 'Magic Missile',
  };
  const mage = makeCombatant('mage', {
    name: 'Mage', faction: 'enemy', pos: { x: 5, y: 0, z: 0 },
    actions: [MM_ACTION], resources: withSlots(2),
  });
  const wiz = makeCombatant('wiz', {
    name: 'Wizard', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    actions: [SHIELD_ACTION], resources: withSlots(2),
    currentHP: 100, maxHP: 100,
    // Already used reaction this round (e.g. Shielded against a prior attack)
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false,
              reactionUsed: true, freeObjectUsed: false },
  });
  const bf = makeBF([mage, wiz]);
  const state = makeState(bf);

  const hpBefore = wiz.currentHP;
  executePlannedAction(mage, {
    type: 'magicMissile', targetId: 'wiz',
    action: MM_ACTION, spellName: 'Magic Missile',
  } as any, state);

  // Reaction already used → Shield can't fire → MM damage applies
  const dmgTaken = hpBefore - wiz.currentHP;
  assert('8j. Wizard took damage (reaction already used, Shield can\'t fire)',
    dmgTaken >= 6 && dmgTaken <= 18, `got ${dmgTaken}`);
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
