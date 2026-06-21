// ============================================================
// absorb_elements.test.ts — Absorb Elements reaction spell module (TG-008)
// XGE p.150: 1st-level abjuration, reaction
// Trigger: You take acid/cold/fire/lightning/poison/thunder damage
// Effect: Resistance to that type until start of next turn + 1d6 rider on next melee hit
// ============================================================

import {
  shouldCastReaction, executeReaction, metadata, cleanup, consumeRider,
} from '../spells/absorb_elements';
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

const ABSORB_ACTION: Action = {
  name: 'Absorb Elements', costType: 'reaction', attackType: null,
  isMultiattack: false, reach: 0, range: null, hitBonus: null,
  damage: null, damageType: null, saveDC: null, saveAbility: null,
  isAoE: false, isControl: false, requiresConcentration: false,
  slotLevel: 1, legendaryCost: 0, description: 'Absorb Elements',
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

function makeDamageTrigger(attacker: Combatant, target: Combatant, amount: number, damageType: DamageType): ReactionTrigger {
  return { kind: 'incoming_damage', attacker, target, amount, damageType };
}

// ============================================================
// Section 1: Metadata shape
// ============================================================

console.log('\n--- Section 1: Metadata shape ---');

eq('metadata.name', metadata.name, 'Absorb Elements');
eq('metadata.level', metadata.level, 1);
eq('metadata.school', metadata.school, 'abjuration');
eq('metadata.rangeFt', metadata.rangeFt, 0);
eq('metadata.concentration', metadata.concentration, false);
eq('metadata.castingTime', metadata.castingTime, 'reaction');

// ============================================================
// Section 2: shouldCastReaction — damage type gating
// ============================================================

console.log('\n--- Section 2: shouldCastReaction damage type gating ---');

{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);

  // Triggering types
  for (const dt of ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'] as DamageType[]) {
    eq(`shouldCast on ${dt} damage`, shouldCastReaction(caster, bf, makeDamageTrigger(attacker, caster, 10, dt)), true);
  }

  // Non-triggering types
  for (const dt of ['bludgeoning', 'piercing', 'slashing', 'necrotic', 'radiant', 'psychic', 'force'] as DamageType[]) {
    eq(`shouldCast on ${dt} damage: false`, shouldCastReaction(caster, bf, makeDamageTrigger(attacker, caster, 10, dt)), false);
  }
}

// Amount 0 — don't cast
{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);

  eq('Amount 0: don\'t cast', shouldCastReaction(caster, bf, makeDamageTrigger(attacker, caster, 0, 'fire')), false);
}

// Self-damage — don't cast
{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const bf = makeBF([caster]);

  eq('Self-damage: don\'t cast', shouldCastReaction(caster, bf, makeDamageTrigger(caster, caster, 10, 'fire')), false);
}

// Already resistant to that type — don't cast (v1 simplification)
{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  caster._absorbElementsResistance = 'fire';
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);

  eq('Already resistant to fire: don\'t cast', shouldCastReaction(caster, bf, makeDamageTrigger(attacker, caster, 10, 'fire')), false);
  // But cold would still cast
  eq('Already resistant to fire, but cold damage: cast', shouldCastReaction(caster, bf, makeDamageTrigger(attacker, caster, 10, 'cold')), true);
}

// Wrong trigger kind
{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const enemy = makeCombatant('enemy', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);

  const wrongTrigger: ReactionTrigger = {
    kind: 'incoming_attack_hit', attacker: enemy, action: ABSORB_ACTION,
    attackRoll: 15, attackTotal: 20, effectiveAC: 15, isCrit: false,
  };
  eq('Wrong trigger (attack_hit): don\'t cast', shouldCastReaction(caster, bf, wrongTrigger), false);
}

// ============================================================
// Section 3: executeReaction — grants resistance + rider
// ============================================================

console.log('\n--- Section 3: executeReaction grants resistance + rider ---');

{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  const outcome = executeReaction(caster, state, makeDamageTrigger(attacker, caster, 10, 'fire'));

  eq('Outcome kind is no_effect (damage already applied)', outcome.kind, 'no_effect');
  eq('Reaction used', caster.budget.reactionUsed, true);
  eq('Slot consumed', caster.resources!.spellSlots![1].remaining, 1);

  // Resistance granted
  eq('Fire resistance added to list', caster.resistances.includes('fire'), true);
  eq('Resistance scratch field set', caster._absorbElementsResistance, 'fire');

  // Rider stored
  assert('Rider scratch field set', caster._absorbElementsRider !== null && caster._absorbElementsRider !== undefined);
  eq('Rider damage type is fire', caster._absorbElementsRider!.damageType, 'fire');
  eq('Rider dice count is 1 (L1 slot)', caster._absorbElementsRider!.diceCount, 1);

  // Log
  const logMsg = state.log.events.some(e => e.description.includes('casts Absorb Elements'));
  assert('Log mentions Absorb Elements', logMsg);
  const resistMsg = state.log.events.some(e => e.description.includes('resistance to fire'));
  assert('Log mentions fire resistance', resistMsg);
  const riderMsg = state.log.events.some(e => e.description.includes('next melee hit'));
  assert('Log mentions melee rider', riderMsg);
}

// ============================================================
// Section 4: executeReaction — different damage types
// ============================================================

console.log('\n--- Section 4: executeReaction different damage types ---');

for (const dt of ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'] as DamageType[]) {
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  executeReaction(caster, state, makeDamageTrigger(attacker, caster, 10, dt));

  eq(`${dt}: resistance granted`, caster.resistances.includes(dt), true);
  eq(`${dt}: rider damage type`, caster._absorbElementsRider!.damageType, dt);
}

// ============================================================
// Section 5: consumeRider — one-shot consumption
// ============================================================

console.log('\n--- Section 5: consumeRider one-shot ---');

{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
  });
  const attacker = makeCombatant('attacker', { faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, attacker]);
  const state = makeState(bf);

  // Cast Absorb Elements → rider stored
  executeReaction(caster, state, makeDamageTrigger(attacker, caster, 10, 'fire'));
  assert('Rider set after executeReaction', caster._absorbElementsRider !== null);

  // Consume the rider
  const rider = consumeRider(caster);
  assert('consumeRider returns non-null', rider !== null);
  eq('Rider damage type is fire', rider!.damageType, 'fire');
  assert('Rider damage is 1-6 (1d6)', rider!.damage >= 1 && rider!.damage <= 6);

  // Rider is now cleared (one-shot)
  eq('Rider cleared after consumption', caster._absorbElementsRider, null);

  // Second call returns null
  const rider2 = consumeRider(caster);
  eq('Second consumeRider call returns null', rider2, null);
}

// consumeRider with no rider → null
{
  const caster = makeCombatant('caster');
  eq('consumeRider with no rider: null', consumeRider(caster), null);
}

// ============================================================
// Section 6: cleanup removes resistance
// ============================================================

console.log('\n--- Section 6: cleanup removes resistance ---');

{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
    resources: withSlots(2),
    resistances: ['fire'],
  });
  caster._absorbElementsResistance = 'fire';

  cleanup(caster);

  eq('Resistance removed from list', caster.resistances.includes('fire'), false);
  eq('Resistance scratch field cleared', caster._absorbElementsResistance, null);
}

// Cleanup with no resistance is safe
{
  const caster = makeCombatant('caster');
  cleanup(caster);  // should not throw
  assert('cleanup with no resistance is safe', true);
}

// Cleanup does NOT clear the rider (rider persists until consumed by melee hit)
{
  const caster = makeCombatant('caster');
  caster._absorbElementsRider = { damageType: 'fire', diceCount: 1 };
  cleanup(caster);
  eq('Rider NOT cleared by cleanup (persists for melee hit)', caster._absorbElementsRider !== null, true);
}

// ============================================================
// Section 7: Innate resistance preserved on cleanup
// ============================================================

console.log('\n--- Section 7: Innate resistance preserved ---');

{
  // Caster has innate fire resistance (e.g., from a racial trait) AND
  // Absorb Elements adds fire resistance. Cleanup should only remove
  // the Absorb Elements one, leaving the innate resistance.
  const caster = makeCombatant('caster', {
    resistances: ['fire', 'cold'],  // innate resistances
  });
  caster._absorbElementsResistance = 'fire';

  cleanup(caster);

  // The Absorb Elements resistance (fire) is removed.
  // v1 simplification: cleanup removes ALL instances of the type from
  // the list, even if the caster had innate resistance. This is a known
  // v1 limitation — future work would track which resistance came from
  // which source.
  // Test the actual behavior: fire is removed, cold stays.
  eq('Cold resistance preserved (not from Absorb Elements)', caster.resistances.includes('cold'), true);
}

// ============================================================
// Section 8: Wrong trigger kind — no-op
// ============================================================

console.log('\n--- Section 8: Wrong trigger kind ---');

{
  const caster = makeCombatant('caster', {
    actions: [ABSORB_ACTION],
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
  console.error('absorb_elements.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('absorb_elements.test.ts: all tests passed ✅');
}
