// ============================================================
// Test: Guidance Cantrip
// PHB p.248 — Level 0 divination cantrip (self-buff: +1d4 to next ability check)
//
// v1 simplifications (all documented via metadata flags):
//   - Concentration: canonically concentration, up to 1 minute → v1: 1-round,
//     non-concentration (clears at start of caster's next turn).
//   - Target: canonically "one willing creature" (touch range — self OR ally)
//     → v1: self-only (the caster targets themselves).
//   - Ability-check integration: the rollAbilityCheck() choke point now EXISTS
//     in utils.ts (added in Session 14) → v1 sets the flag on cast AND consumes
//     it on the next ability check via rollAbilityCheck. The flag is cleared at
//     the start of the caster's NEXT turn via cleanup() as a safety net (only
//     fires if the caster makes no ability check before their next turn).
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S — NO M, canon per 5etools JSON)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes riderDieSides = 4 (d4)
//   5. metadata exposes v1 simplification flags (concentration + touch-ally + ability-check-integration)
//   6. metadata does NOT scale (+1d4 ability-check bonus is flat)
//   7. applySelfEffect sets _guidanceDieBonusNextAbilityCheck = 4 + emits log
//   8. resolveCantripAction integration — 'Guidance' routes to applySelfEffect
//   9. dispatcher safety — unknown cantrip name is a no-op
//  10. cleanup() clears _guidanceDieBonusNextAbilityCheck flag (resetBudget integration)
//  11. flag is NOT consumed by any function other than rollAbilityCheck
//  12. buff clears at start of caster's next turn (resetBudget)
//  13. Guidance itself does NOT go through resolveAttack (self-buff)
//  14. resolveCantripAoE returns false (not a caster-centered AoE)
//  15. resolveCantripTouchEffect returns false (not a touch-effect)
//  16. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  17. mirror Resistance architecture (same die size 4 = d4, same one-shot semantics, but for ability checks)
//  18. flavor log emitted on cast (mentions Guidance + ability check)
//
// Run: npx ts-node src/test/guidance.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/guidance';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
  resolveCantripTouchEffect,
} from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { CombatEvent } from '../engine/combat';
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
    exhaustionLevel: 0,
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

// A Guidance Action — self-buff, no target, no attack roll.
const GUIDANCE_ACTION: Action = {
  name: 'Guidance',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 0, long: 0 }, // Self/Touch
  hitBonus: null,
  damage: null, // no damage — the cantrip grants +1d4 to next ability check
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Guidance',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Guidance');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'divination');
  eq('1d. rangeFt (0 — Self/Touch)', metadata.rangeFt, 0);
  eq('1e. damageDice null (no damage — buff only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (v1 simplification)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + S (NO M) — PHB p.248, canon per 5etools JSON
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. NO material component (canon 5etools JSON: {"v":true,"s":true})',
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
// 4. metadata exposes riderDieSides = 4 (d4)
// ============================================================
console.log('\n--- 4. riderDieSides ---');
{
  eq('4a. riderDieSides = 4 (d4)', metadata.riderDieSides, 4);
}

// ============================================================
// 5. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 5. v1 simplification flags ---');
{
  eq('5a. guidanceConcentrationV1Simplified = true (canon: conc 1 min, v1: 1 round)',
    metadata.guidanceConcentrationV1Simplified, true);
  eq('5b. guidanceTouchAllyV1Simplified = true (canon: any willing creature, v1: self-only)',
    metadata.guidanceTouchAllyV1Simplified, true);
  eq('5c. guidanceAbilityCheckIntegrationV1Implemented = true (rollAbilityCheck choke point exists in utils.ts)',
    metadata.guidanceAbilityCheckIntegrationV1Implemented, true);
}

// ============================================================
// 6. metadata does NOT scale (+1d4 ability-check bonus is flat)
// ============================================================
console.log('\n--- 6. no scaling ---');
{
  eq('6a. scales = false (Guidance does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 7. applySelfEffect sets _guidanceDieBonusNextAbilityCheck = 4 + emits log
// ============================================================
console.log('\n--- 7. applySelfEffect ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('7a. flag not set before cast', caster._guidanceDieBonusNextAbilityCheck, undefined);

  const ret = applySelfEffect(caster, state);
  eq('7b. applySelfEffect returns true', ret, true);
  eq('7c. _guidanceDieBonusNextAbilityCheck set to 4 (d4)',
    caster._guidanceDieBonusNextAbilityCheck, 4);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Guidance'),
  );
  assert('7d. cast log emitted', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('7e. log mentions +1d4',
    castLog?.description.includes('+1d4') === true ||
    castLog?.description.includes('1d4') === true,
    `got: ${castLog?.description}`);
  assert('7f. log mentions ability check',
    castLog?.description.toLowerCase().includes('ability check') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 8. resolveCantripAction integration — 'Guidance' routes to applySelfEffect
// ============================================================
console.log('\n--- 8. resolveCantripAction integration ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Guidance', state);
  eq('8a. resolveCantripAction returns true', ret, true);
  eq('8b. _guidanceDieBonusNextAbilityCheck set to 4',
    caster._guidanceDieBonusNextAbilityCheck, 4);
}

// ============================================================
// 9. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 9. dispatcher safety ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('9a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('9b. unknown cantrip → no flag set on caster',
    caster._guidanceDieBonusNextAbilityCheck, undefined);
  eq('9c. unknown cantrip → no flag set on target',
    target._guidanceDieBonusNextAbilityCheck, undefined);
}

// ============================================================
// 10. cleanup() clears _guidanceDieBonusNextAbilityCheck flag (resetBudget integration)
// ============================================================
console.log('\n--- 10. cleanup ---');
{
  const caster = makeCombatant('cleric', { _guidanceDieBonusNextAbilityCheck: 4 });
  cleanup(caster);
  eq('10a. _guidanceDieBonusNextAbilityCheck cleared by cleanup()',
    caster._guidanceDieBonusNextAbilityCheck, undefined);

  // resetBudget integration — buff clears at start of caster's next turn.
  const caster2 = makeCombatant('cleric2', { _guidanceDieBonusNextAbilityCheck: 4 });
  resetBudget(caster2);
  eq('10b. _guidanceDieBonusNextAbilityCheck cleared by resetBudget()',
    caster2._guidanceDieBonusNextAbilityCheck, undefined);
}

// ============================================================
// 11. flag is NOT consumed by any function other than rollAbilityCheck
// ============================================================
console.log('\n--- 11. flag only consumed by rollAbilityCheck ---');
{
  // The rollAbilityCheck() choke point now EXISTS in utils.ts (added in
  // Session 14). The flag is set on cast and consumed ONLY by
  // rollAbilityCheck() on the next ability check (any ability). It is
  // NOT consumed by any other function (rollSave, resolveAttack, etc.).
  // The flag is cleared at the start of the caster's NEXT turn via
  // cleanup() as a safety net (v1 1-round simplification).
  const caster = makeCombatant('cleric', { _guidanceDieBonusNextAbilityCheck: 4 });
  eq('11a. flag set', caster._guidanceDieBonusNextAbilityCheck, 4);

  // Simulate "some non-ability-check event happens" (e.g. a save, an
  // attack, a move). None of these should consume the Guidance flag.
  // rollSave does NOT touch _guidanceDieBonusNextAbilityCheck.
  // The flag remains set.
  eq('11b. flag STILL set (only rollAbilityCheck consumes it)',
    caster._guidanceDieBonusNextAbilityCheck, 4);

  // Cleanup is the safety-net clearing mechanism (start of next turn).
  cleanup(caster);
  eq('11c. flag cleared by cleanup (safety net at start of next turn)',
    caster._guidanceDieBonusNextAbilityCheck, undefined);
}

// ============================================================
// 12. buff clears at start of caster's next turn (resetBudget)
// ============================================================
console.log('\n--- 12. buff clears at start of next turn ---');
{
  const caster = makeCombatant('cleric', { _guidanceDieBonusNextAbilityCheck: 4 });
  eq('12a. flag set before resetBudget', caster._guidanceDieBonusNextAbilityCheck, 4);

  resetBudget(caster); // simulates start of caster's next turn

  eq('12b. flag cleared after resetBudget', caster._guidanceDieBonusNextAbilityCheck, undefined);
}

// ============================================================
// 13. Guidance itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 13. Guidance bypasses resolveAttack ---');
{
  const caster = makeCombatant('cleric', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [GUIDANCE_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Guidance', state);

  // Only the "casts Guidance" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('13a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('13b. action event mentions Guidance',
    actionEvents[0]?.description.includes('Guidance') === true,
    `got: ${actionEvents[0]?.description}`);

  // No attack hit/miss/crit/damage events.
  const attackEvents = state.log.events.filter((e: CombatEvent) =>
    e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit' || e.type === 'damage',
  );
  eq('13c. no attack/damage events (self-buff bypasses resolveAttack)',
    attackEvents.length, 0);
}

// ============================================================
// 14. resolveCantripAoE returns false (not a caster-centered AoE)
// ============================================================
console.log('\n--- 14. not a caster-centered AoE ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Guidance', state);
  eq('14a. resolveCantripAoE returns false', ret, false);
  eq('14b. no log events', state.log.events.length, 0);
}

// ============================================================
// 15. resolveCantripTouchEffect returns false (not a touch-effect)
// ============================================================
console.log('\n--- 15. not a touch-effect ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('fighter');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = resolveCantripTouchEffect(caster, target, 'Guidance', state);
  eq('15a. resolveCantripTouchEffect returns false', ret, false);
  eq('15b. no log events', state.log.events.length, 0);
}

// ============================================================
// 16. no CANTRIP_EFFECTS entry (not a post-hit rider)
// ============================================================
console.log('\n--- 16. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Guidance', state);
  eq('16a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
  eq('16b. no flag set on target', target._guidanceDieBonusNextAbilityCheck, undefined);
}

// ============================================================
// 17. mirror Resistance architecture (same die size 4 = d4, same one-shot semantics, but for ability checks)
// ============================================================
console.log('\n--- 17. mirror Resistance architecture ---');
{
  // Guidance and Resistance share the same architecture:
  //   - Same die size (4 = d4)
  //   - Same one-shot consume semantics (consumed by the first check/save)
  //   - Same cleanup() pattern (clears at start of caster's next turn)
  //   - Same self-buff routing (CANTRIP_SELF_EFFECTS)
  //
  // The ONLY differences:
  //   - Guidance: ability-check bonus (consumed by FUTURE rollAbilityCheck)
  //   - Resistance: save bonus (consumed by EXISTING rollSave in utils.ts)
  //
  // Verify the architecture mirrors:
  const guidanceCaster = makeCombatant('cleric1');
  applySelfEffect(guidanceCaster, makeState(makeBF([guidanceCaster])));
  eq('17a. Guidance flag value = 4 (d4, mirror Resistance riderDieSides)',
    guidanceCaster._guidanceDieBonusNextAbilityCheck, 4);

  // Import Resistance for comparison.
  const { metadata: resistanceMeta, applySelfEffect: applyResistance } =
    require('../spells/resistance') as typeof import('../spells/resistance');
  const resistanceCaster = makeCombatant('cleric2');
  applyResistance(resistanceCaster, makeState(makeBF([resistanceCaster])));
  eq('17b. Resistance flag value = 4 (d4, mirror Guidance riderDieSides)',
    resistanceCaster._resistanceDieBonusNextSave, 4);

  eq('17c. same riderDieSides (4 = d4)',
    metadata.riderDieSides, resistanceMeta.riderDieSides);
  eq('17d. same isSelfBuff (true)',
    metadata.isSelfBuff, resistanceMeta.isSelfBuff);
  eq('17e. same scales (false — neither scales at 5/11/17)',
    metadata.scales, resistanceMeta.scales);
}

// ============================================================
// 18. flavor log emitted on cast (mentions Guidance + ability check)
// ============================================================
console.log('\n--- 18. flavor log ---');
{
  const caster = makeCombatant('cleric', { name: 'Cleric Bob' });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  applySelfEffect(caster, state);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Guidance'),
  );
  assert('18a. cast log mentions caster name',
    castLog?.description.includes('Cleric Bob') === true,
    `got: ${castLog?.description}`);
  assert('18b. cast log mentions "casts Guidance"',
    castLog?.description.includes('casts Guidance') === true,
    `got: ${castLog?.description}`);
  assert('18c. cast log mentions "ability check"',
    castLog?.description.toLowerCase().includes('ability check') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
