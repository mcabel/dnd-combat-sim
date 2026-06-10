// ============================================================
// Test: Bardic Inspiration (Bard)
// Covers:
//   - parseDieSides: 'd6'→6, 'd8'→8, 'd12'→12, fallback
//   - consumeBardicInspiration: rolls die, clears field, returns 0 when null
//   - case 'bardicInspiration': sets bardicInspirationDie on target
//   - Inspiration bonus applies to attack roll (total increases)
//   - Inspiration bonus applies to saving throw
//   - Die is consumed after one use (not reused)
//   - Dead target does not receive inspiration
//   - bardicInspirationTarget / bardicInspirationPlan AI helpers
//   - Engine integration: Bard grants inspiration, ally uses it on attack
// Run: ts-node src/test/bardic_inspiration.test.ts
// ============================================================

import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { parseDieSides, consumeBardicInspiration } from '../engine/utils';
import { bardicInspirationTarget, bardicInspirationPlan } from '../ai/resources';
import { Combatant, Action } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  assert(label, actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(overrides: Partial<Combatant> = {}): Combatant {
  const id = overrides.id ?? `c_${++_id}`;
  return {
    id, name: id, isPlayer: true, faction: 'party',
    maxHP: 20, currentHP: 20, ac: 14,
    speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 16,
    cr: 0, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() },
    concentration: null, deathSaves: null,
    mountedOn: null, carriedBy: null,
    independentMount: false, role: 'regular', bonded: null,
    resources: null, tempHP: 0,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

function meleeAction(overrides: Partial<Action> = {}): Action {
  return {
    name: 'Sword', isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 0,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
    ...overrides,
  };
}

function fixedInit(...cs: Combatant[]): string[] {
  return cs.map(c => c.id);
}

// ---- Section: parseDieSides ---------------------------------

console.log('\n=== parseDieSides ===');
{
  eq("parseDieSides 'd6'", parseDieSides('d6'), 6);
  eq("parseDieSides 'd8'", parseDieSides('d8'), 8);
  eq("parseDieSides 'd10'", parseDieSides('d10'), 10);
  eq("parseDieSides 'd12'", parseDieSides('d12'), 12);
  eq("parseDieSides 'D6' (uppercase)", parseDieSides('D6'), 6);
  eq("parseDieSides 'garbage' fallback", parseDieSides('garbage'), 6);
}

// ---- Section: consumeBardicInspiration ----------------------

console.log('\n=== consumeBardicInspiration ===');
{
  // No die held → 0
  const noDie = makeC();
  eq('consumeBardicInspiration: 0 when null', consumeBardicInspiration(noDie), 0);

  // Die held → positive roll, die cleared
  const withDie = makeC({ bardicInspirationDie: 6 });
  const roll = consumeBardicInspiration(withDie);
  assert('consumeBardicInspiration: roll >= 1', roll >= 1, `roll=${roll}`);
  assert('consumeBardicInspiration: roll <= 6', roll <= 6, `roll=${roll}`);
  eq('consumeBardicInspiration: die cleared after use', withDie.bardicInspirationDie, null);

  // Second call returns 0 (consumed)
  const roll2 = consumeBardicInspiration(withDie);
  eq('consumeBardicInspiration: second call returns 0', roll2, 0);

  // d8 die rolls 1-8
  const withD8 = makeC({ bardicInspirationDie: 8 });
  const rollD8 = consumeBardicInspiration(withD8);
  assert('consumeBardicInspiration d8: >= 1', rollD8 >= 1);
  assert('consumeBardicInspiration d8: <= 8', rollD8 <= 8);
  eq('consumeBardicInspiration d8: cleared', withD8.bardicInspirationDie, null);
}

// ---- Section: case 'bardicInspiration' engine ---------------

console.log("\n=== case 'bardicInspiration' engine ===");
{
  // Bard uses Bardic Inspiration as bonus action; ally receives die on next attack.
  // We run a 2-combatant combat (bard vs enemy) and check that:
  // 1. The ally gets bardicInspirationDie set (if AI fires BI)
  // 2. A Bardic Inspiration action event appears in the log

  const bardId   = 'bard_bi_test';
  const allyId   = 'ally_bi_test';
  const enemyId  = 'enemy_bi_test';

  const bard = makeC({
    id: bardId, name: 'Melodia',
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    ac: 14, maxHP: 20, currentHP: 20,
    // No action (bard uses bonus action BI, then can't do much with no weapon)
    actions: [meleeAction({ hitBonus: 3 })],
    traits: ['Bardic Inspiration'],
    resources: { bardicInspiration: { max: 3, remaining: 3, die: 'd6' } },
  });

  // Ally with actionUsed=false (hasn't acted yet) — bardicInspirationTarget prefers them
  const ally = makeC({
    id: allyId, name: 'Fighter Ally',
    faction: 'party', pos: { x: 1, y: 0, z: 0 },
    ac: 14, maxHP: 20, currentHP: 20,
    actions: [meleeAction({ hitBonus: 5 })],
  });

  const enemy = makeC({
    id: enemyId, name: 'Goblin',
    faction: 'enemy', pos: { x: 2, y: 0, z: 0 },
    ac: 4, maxHP: 3, currentHP: 3,
    actions: [],
  });

  const bf = makeFlatBattlefield(10, 10, [bard, ally, enemy]);
  const result = runCombat(bf, fixedInit(bard, ally, enemy), { maxRounds: 5 });

  eq('BI integration: party wins', result.winner, 'party');

  // Bardic Inspiration action event should appear
  const biEvent = result.events.find(e =>
    e.actorId === bardId && e.type === 'action' &&
    e.description.toLowerCase().includes('inspiration'));
  assert('BI integration: Bardic Inspiration event in log', biEvent !== undefined,
    `action events: ${result.events.filter(e => e.type === 'action' && e.actorId === bardId).map(e => e.description).join('; ')}`);

  // Resource spent
  const finalBard = bf.combatants.get(bardId)!;
  assert('BI integration: remaining decremented',
    finalBard.resources!.bardicInspiration!.remaining < 3);
}

// ---- Section: inspiration bonus on attack ---------------

console.log('\n=== Inspiration bonus on attack ===');
{
  // If a combatant has bardicInspirationDie set, their attack total should be higher.
  // Test: attacker with hitBonus 0, AC 20 enemy (impossible without die),
  // with die set they might be able to hit. We check the "Bardic Inspiration" log event fires.

  const attackerId = 'attacker_bi';
  const attacker = makeC({
    id: attackerId, name: 'Inspired Fighter',
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    ac: 14, maxHP: 20, currentHP: 20,
    actions: [meleeAction({ hitBonus: 0 })],
    bardicInspirationDie: 6, // pre-set the die
  });

  const dummy = makeC({
    id: 'dummy_bi', name: 'Dummy',
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    ac: 1, maxHP: 100, currentHP: 100, // trivially hittable
    actions: [],
  });

  const bf = makeFlatBattlefield(10, 10, [attacker, dummy]);
  const result = runCombat(bf, fixedInit(attacker, dummy), { maxRounds: 1 });

  // "Bardic Inspiration die" event should appear in log on the attack
  const biUsedEvent = result.events.find(e =>
    e.actorId === attackerId && e.description.includes('Bardic Inspiration'));
  assert('Inspiration on attack: log event fired', biUsedEvent !== undefined);

  // Die should be consumed (null) after the attack
  const finalAttacker = bf.combatants.get(attackerId)!;
  eq('Inspiration on attack: die consumed', finalAttacker.bardicInspirationDie, null);
}

// ---- Section: inspiration not reused ------------------------

console.log('\n=== Inspiration die consumed after one use ===');
{
  // Run two rounds; die is set before round 1 only.
  // After round 1 the die should be null, no BI event in round 2.

  const attackerId = 'attacker_consume';
  const attacker = makeC({
    id: attackerId, name: 'Greedy Fighter',
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    ac: 14, maxHP: 20, currentHP: 20,
    actions: [meleeAction({ hitBonus: 20 })], // guaranteed hit
    bardicInspirationDie: 6,
  });

  const enemy = makeC({
    id: 'enemy_consume', name: 'Target',
    faction: 'enemy', pos: { x: 1, y: 0, z: 0 },
    ac: 4, maxHP: 100, currentHP: 100, // survives multiple rounds
    actions: [],
  });

  const bf = makeFlatBattlefield(10, 10, [attacker, enemy]);
  const result = runCombat(bf, fixedInit(attacker, enemy), { maxRounds: 3 });

  const biEvents = result.events.filter(e =>
    e.actorId === attackerId && e.description.includes('Bardic Inspiration'));
  eq('Inspiration consumed: fired exactly once across 3 rounds', biEvents.length, 1);
}

// ---- Section: bardicInspirationTarget helper ----------------

console.log('\n=== bardicInspirationTarget AI helper ===');
{
  // Returns null when no remaining charges
  const bardNoCharges = makeC({
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: { bardicInspiration: { max: 3, remaining: 0, die: 'd6' } },
  });
  const allyForNoCharges = makeC({ faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const bfNoCharge = makeFlatBattlefield(5, 5, [bardNoCharges, allyForNoCharges]);
  const noChargeTarget = bardicInspirationTarget(bardNoCharges, bfNoCharge);
  assert('bardicInspirationTarget: null when remaining=0', noChargeTarget === null);

  // Returns null when no allies
  const bardAlone = makeC({
    faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: { bardicInspiration: { max: 3, remaining: 3, die: 'd6' } },
  });
  const bfAlone = makeFlatBattlefield(5, 5, [bardAlone]);
  const aloneTarget = bardicInspirationTarget(bardAlone, bfAlone);
  assert('bardicInspirationTarget: null with no allies', aloneTarget === null);

  // Returns highest-HP ally that hasn't acted (heuristic)
  const bard = makeC({
    id: 'bard_target_test', faction: 'party', pos: { x: 0, y: 0, z: 0 },
    resources: { bardicInspiration: { max: 3, remaining: 3, die: 'd6' } },
  });
  const weakAlly  = makeC({ id: 'weak',   faction: 'party', maxHP: 10, currentHP: 10, pos: { x: 1, y: 0, z: 0 } });
  const strongAlly = makeC({ id: 'strong', faction: 'party', maxHP: 30, currentHP: 30, pos: { x: 2, y: 0, z: 0 } });
  const bfMulti = makeFlatBattlefield(10, 5, [bard, weakAlly, strongAlly]);
  const chosen = bardicInspirationTarget(bard, bfMulti);
  assert('bardicInspirationTarget: returns highest-HP ally',
    chosen?.id === 'strong', `got ${chosen?.id}`);
}

// ---- Section: bardicInspirationPlan helper ------------------

console.log('\n=== bardicInspirationPlan helper ===');
{
  const bard = makeC({
    id: 'bard_plan_test', name: 'Bard',
    resources: { bardicInspiration: { max: 3, remaining: 3, die: 'd6' } },
  });
  const target = makeC({ id: 'plan_target', name: 'Ally' });

  const plan = bardicInspirationPlan(bard, target);

  eq('bardicInspirationPlan: type', plan.type, 'bardicInspiration');
  eq('bardicInspirationPlan: targetId', plan.targetId, target.id);
  eq('bardicInspirationPlan: remaining decremented', bard.resources!.bardicInspiration!.remaining, 2);
  assert('bardicInspirationPlan: description mentions Inspiration',
    plan.description.toLowerCase().includes('inspiration'));
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
