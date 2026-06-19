// ============================================================
// Test: True Strike Cantrip
// PHB p.284 — Level 0 divination cantrip (self-buff: advantage on next attack)
//
// v1 simplifications (both documented via metadata flags):
//   - Concentration: canonically concentration, up to 1 minute → v1: 1-round,
//     non-concentration (clears at start of caster's next turn).
//   - Target: canonically "first attack roll against the target" → v1:
//     target-agnostic (applies to the caster's NEXT attack roll regardless
//     of target).
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (S only — CANON, no M)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes riderAttackTypes = ['melee', 'ranged', 'spell']
//   5. metadata exposes v1 simplification flags
//   6. metadata does NOT scale (advantage buff is flat)
//   7. applySelfEffect sets _trueStrikeAdvNextAttack flag + emits log
//   8. resolveCantripAction integration — 'True Strike' routes to applySelfEffect
//   9. dispatcher safety — unknown cantrip name is a no-op
//  10. cleanup() clears _trueStrikeAdvNextAttack flag (resetBudget integration)
//  11. advantage on next attack roll (set flag, attack, verify advantage)
//  12. buff applies to ANY attack type (melee, ranged, AND spell)
//  13. buff is one-shot (consumed on first attack; second attack does NOT get advantage)
//  14. buff clears at start of caster's next turn (resetBudget)
//  15. True Strike itself does NOT go through resolveAttack (self-buff)
//  16. resolveCantripAoE returns false (not a caster-centered AoE)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//
// Run: npx ts-node src/test/true_strike.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/true_strike';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
} from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3, Cell, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
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

function makeBF(combatants: Combatant[], obstacles: Obstacle[] = []) {
  const width = 10, height = 10, depth = 1;
  const cells: Cell[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'normal', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
    obstacles: obstacles.length ? obstacles : undefined,
  };
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// A True Strike Action — self-buff, no target, no attack roll.
const TRUE_STRIKE_ACTION: Action = {
  name: 'True Strike',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null, // no damage — the cantrip grants advantage on next attack
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'True Strike',
};

// A melee weapon Action (longsword) — used to test the buff's effect on melee attacks.
const LONGSWORD_ACTION: Action = {
  name: 'Longsword',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 0,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'slashing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Longsword',
};

// A ranged weapon Action (shortbow) — used to test the buff on ranged attacks.
const SHORTBOW_ACTION: Action = {
  name: 'Shortbow',
  isMultiattack: false,
  attackType: 'ranged',
  reach: 0,
  range: { normal: 80, long: 320 },
  hitBonus: 0,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'piercing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Shortbow',
};

// A ranged spell attack Action (Fire Bolt) — used to test the buff on spell attacks.
const FIRE_BOLT_ACTION: Action = {
  name: 'Fire Bolt',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 0,
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'fire',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Fire Bolt',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'True Strike');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'divination');
  eq('1d. rangeFt (30)', metadata.rangeFt, 30);
  eq('1e. damageDice null (no damage — buff only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (v1 simplification)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: S only (CANON — 5etools JSON: {"s":true})
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. NO verbal component', metadata.components.v, false);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. NO material component (CANON — 5etools JSON has no M)',
    metadata.components.m, false);
}

// ============================================================
// 3. metadata exposes isSelfBuff = true
// ============================================================
console.log('\n--- 3. isSelfBuff ---');
{
  eq('3a. isSelfBuff = true', metadata.isSelfBuff, true);
}

// ============================================================
// 4. metadata exposes riderAttackTypes = ['melee', 'ranged', 'spell']
// ============================================================
console.log('\n--- 4. riderAttackTypes (any attack type) ---');
{
  eq('4a. riderAttackTypes length 3 (any attack type)',
    metadata.riderAttackTypes.length, 3);
  eq('4b. riderAttackTypes[0] = melee', metadata.riderAttackTypes[0], 'melee');
  eq('4c. riderAttackTypes[1] = ranged', metadata.riderAttackTypes[1], 'ranged');
  eq('4d. riderAttackTypes[2] = spell', metadata.riderAttackTypes[2], 'spell');
}

// ============================================================
// 5. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 5. v1 simplification flags ---');
{
  eq('5a. trueStrikeConcentrationV1Simplified = true (canon: conc 1 min, v1: 1 round)',
    metadata.trueStrikeConcentrationV1Simplified, true);
  eq('5b. trueStrikeTargetAgnosticV1Simplified = true (canon: vs target, v1: target-agnostic)',
    metadata.trueStrikeTargetAgnosticV1Simplified, true);
}

// ============================================================
// 6. metadata does NOT scale (advantage buff is flat)
// ============================================================
console.log('\n--- 6. no scaling ---');
{
  eq('6a. scales = false (True Strike does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 7. applySelfEffect sets _trueStrikeAdvNextAttack flag + emits log
// ============================================================
console.log('\n--- 7. applySelfEffect ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('7a. flag not set before cast', caster._trueStrikeAdvNextAttack, undefined);

  const ret = applySelfEffect(caster, state);
  eq('7b. applySelfEffect returns true', ret, true);
  eq('7c. _trueStrikeAdvNextAttack set to true', caster._trueStrikeAdvNextAttack, true);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('True Strike'),
  );
  assert('7d. cast log emitted', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('7e. log mentions advantage',
    castLog?.description.includes('advantage') === true, `got: ${castLog?.description}`);
}

// ============================================================
// 8. resolveCantripAction integration — 'True Strike' routes to applySelfEffect
// ============================================================
console.log('\n--- 8. resolveCantripAction integration ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'True Strike', state);
  eq('8a. resolveCantripAction returns true', ret, true);
  eq('8b. _trueStrikeAdvNextAttack set', caster._trueStrikeAdvNextAttack, true);
}

// ============================================================
// 9. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 9. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('9a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('9b. unknown cantrip → no flag set on caster',
    caster._trueStrikeAdvNextAttack, undefined);
  eq('9c. unknown cantrip → no flag set on target',
    target._trueStrikeAdvNextAttack, undefined);
}

// ============================================================
// 10. cleanup() clears _trueStrikeAdvNextAttack flag (resetBudget integration)
// ============================================================
console.log('\n--- 10. cleanup ---');
{
  const caster = makeCombatant('wiz', { _trueStrikeAdvNextAttack: true });
  cleanup(caster);
  eq('10a. _trueStrikeAdvNextAttack cleared by cleanup()',
    caster._trueStrikeAdvNextAttack, undefined);

  // resetBudget integration — buff clears at start of caster's next turn.
  const caster2 = makeCombatant('wiz2', { _trueStrikeAdvNextAttack: true });
  resetBudget(caster2);
  eq('10b. _trueStrikeAdvNextAttack cleared by resetBudget()',
    caster2._trueStrikeAdvNextAttack, undefined);
}

// ============================================================
// 11. advantage on next attack roll (set flag, attack, verify advantage)
// ============================================================
console.log('\n--- 11. advantage on next attack ---');
{
  // Caster has the buff active. Make a melee attack. The attack roll should
  // have advantage (verify via the "with Advantage (True Strike)" log).
  const casterWithBuff = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LONGSWORD_ACTION],
    _trueStrikeAdvNextAttack: true,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bf = makeBF([casterWithBuff, target]);
  const state = makeState(bf);

  resolveAttack(casterWithBuff, target, LONGSWORD_ACTION, state, true);

  const advLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Advantage') && e.description.includes('True Strike'),
  );
  assert('11a. "Advantage (True Strike)" log emitted',
    advLog !== undefined, `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // The buff should be CONSUMED after the attack (one-shot).
  eq('11b. flag consumed (set to false) after attack',
    casterWithBuff._trueStrikeAdvNextAttack, false);

  // The consume log should mention "fades".
  const consumeLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'condition_remove' && e.description.includes('True Strike') && e.description.includes('fades'),
  );
  assert('11c. consume log mentions "fades"',
    consumeLog !== undefined, `got: ${consumeLog?.description}`);
}

// ============================================================
// 12. buff applies to ANY attack type (melee, ranged, AND spell)
// ============================================================
console.log('\n--- 12. buff applies to any attack type ---');
{
  // Melee attack with buff.
  const casterMelee = makeCombatant('wiz1', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LONGSWORD_ACTION],
    _trueStrikeAdvNextAttack: true,
  });
  const targetMelee = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bfMelee = makeBF([casterMelee, targetMelee]);
  const stateMelee = makeState(bfMelee);
  resolveAttack(casterMelee, targetMelee, LONGSWORD_ACTION, stateMelee, true);
  const advLogMelee = stateMelee.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Advantage') && e.description.includes('True Strike'),
  );
  assert('12a. melee attack WITH advantage (True Strike)',
    advLogMelee !== undefined, `events: ${stateMelee.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // Ranged attack with buff.
  const casterRanged = makeCombatant('wiz2', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [SHORTBOW_ACTION],
    _trueStrikeAdvNextAttack: true,
  });
  const targetRanged = makeCombatant('goblin2', {
    pos: { x: 5, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bfRanged = makeBF([casterRanged, targetRanged]);
  const stateRanged = makeState(bfRanged);
  resolveAttack(casterRanged, targetRanged, SHORTBOW_ACTION, stateRanged, true);
  const advLogRanged = stateRanged.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Advantage') && e.description.includes('True Strike'),
  );
  assert('12b. ranged attack WITH advantage (True Strike)',
    advLogRanged !== undefined, `events: ${stateRanged.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);

  // Spell attack with buff.
  const casterSpell = makeCombatant('wiz3', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [FIRE_BOLT_ACTION],
    _trueStrikeAdvNextAttack: true,
  });
  const targetSpell = makeCombatant('goblin3', {
    pos: { x: 5, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  const bfSpell = makeBF([casterSpell, targetSpell]);
  const stateSpell = makeState(bfSpell);
  resolveAttack(casterSpell, targetSpell, FIRE_BOLT_ACTION, stateSpell, true);
  const advLogSpell = stateSpell.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Advantage') && e.description.includes('True Strike'),
  );
  assert('12c. spell attack WITH advantage (True Strike)',
    advLogSpell !== undefined, `events: ${stateSpell.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 13. buff is one-shot (consumed on first attack; second attack does NOT get advantage)
// ============================================================
console.log('\n--- 13. one-shot consume ---');
{
  // Caster has the buff active. Make TWO attacks. The first attack should
  // have advantage (and consume the flag); the second attack should NOT
  // have advantage (flag is now false).
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [LONGSWORD_ACTION],
    _trueStrikeAdvNextAttack: true,
  });
  const target1 = makeCombatant('goblin1', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 1000, maxHP: 1000, faction: 'enemy',
  });
  const target2 = makeCombatant('goblin2', {
    pos: { x: -1, y: 0, z: 0 }, ac: 5,
    currentHP: 1000, maxHP: 1000, faction: 'enemy',
  });
  const bf = makeBF([caster, target1, target2]);
  const state = makeState(bf);

  // First attack — should have advantage (flag still true).
  resolveAttack(caster, target1, LONGSWORD_ACTION, state, true);
  eq('13a. flag consumed (false) after first attack',
    caster._trueStrikeAdvNextAttack, false);

  // Second attack — should NOT have advantage (flag is false).
  const eventsBeforeSecond = state.log.events.length;
  resolveAttack(caster, target2, LONGSWORD_ACTION, state, true);

  // Look only at events AFTER the second attack for the second-attack adv log.
  const secondAttackEvents = state.log.events.slice(eventsBeforeSecond);
  const advLogSecond = secondAttackEvents.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Advantage') && e.description.includes('True Strike'),
  );
  assert('13b. second attack does NOT have True Strike advantage (one-shot)',
    advLogSecond === undefined, `unexpected: ${advLogSecond?.description}`);
}

// ============================================================
// 14. buff clears at start of caster's next turn (resetBudget)
// ============================================================
console.log('\n--- 14. buff clears at start of next turn ---');
{
  const caster = makeCombatant('wiz', { _trueStrikeAdvNextAttack: true });
  eq('14a. flag set before resetBudget', caster._trueStrikeAdvNextAttack, true);

  resetBudget(caster); // simulates start of caster's next turn

  eq('14b. flag cleared after resetBudget', caster._trueStrikeAdvNextAttack, undefined);

  // Behavioral: after resetBudget, a melee attack should NOT have advantage.
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 }, ac: 5,
    currentHP: 100, maxHP: 100, faction: 'enemy',
  });
  caster.actions = [LONGSWORD_ACTION];
  caster.pos = { x: 0, y: 0, z: 0 };
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, LONGSWORD_ACTION, state, true);

  const advLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Advantage') && e.description.includes('True Strike'),
  );
  assert('14c. NO True Strike advantage after resetBudget (buff expired)',
    advLog === undefined, `unexpected: ${advLog?.description}`);
}

// ============================================================
// 15. True Strike itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 15. True Strike bypasses resolveAttack ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [TRUE_STRIKE_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'True Strike', state);

  // Only the "casts True Strike" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('15a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('15b. action event mentions True Strike',
    actionEvents[0]?.description.includes('True Strike') === true,
    `got: ${actionEvents[0]?.description}`);

  // No attack hit/miss/crit/damage events.
  const attackEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit' || e.type === 'damage',
  );
  eq('15c. no attack/damage events (self-buff bypasses resolveAttack)',
    attackEvents.length, 0);
}

// ============================================================
// 16. resolveCantripAoE returns false (not a caster-centered AoE)
// ============================================================
console.log('\n--- 16. not a caster-centered AoE ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'True Strike', state);
  eq('16a. resolveCantripAoE returns false', ret, false);
  eq('16b. no log events', state.log.events.length, 0);
}

// ============================================================
// 17. no CANTRIP_EFFECTS entry (not a post-hit rider)
// ============================================================
console.log('\n--- 17. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'True Strike', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
  eq('17b. no flag set on target', target._trueStrikeAdvNextAttack, undefined);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
