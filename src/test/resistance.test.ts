// ============================================================
// Test: Resistance Cantrip
// PHB p.272 — Level 0 abjuration cantrip (self-buff: +1d4 to next save)
//
// v1 simplifications (both documented via metadata flags):
//   - Concentration: canonically concentration, up to 1 minute → v1: 1-round,
//     non-concentration (clears at start of caster's next turn).
//   - Target: canonically "one willing creature" (touch range — self OR ally)
//     → v1: self-only (the caster targets themselves).
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes components (V + S + M — a miniature cloak)
//   3. metadata exposes isSelfBuff = true
//   4. metadata exposes riderDieSides = 4 (d4)
//   5. metadata exposes v1 simplification flags
//   6. metadata does NOT scale (+1d4 save bonus is flat)
//   7. applySelfEffect sets _resistanceDieBonusNextSave = 4 + emits log
//   8. resolveCantripAction integration — 'Resistance' routes to applySelfEffect
//   9. dispatcher safety — unknown cantrip name is a no-op
//  10. cleanup() clears _resistanceDieBonusNextSave flag (resetBudget integration)
//  11. rollSave integration: bonus ADDED to save total (+1d4)
//  12. rollSave integration: rider CONSUMED after one save (one-shot)
//  13. second save has NO bonus (one-shot consume verified)
//  14. buff clears at start of caster's next turn (resetBudget)
//  15. Resistance itself does NOT go through resolveAttack (self-buff)
//  16. resolveCantripAoE returns false (not a caster-centered AoE)
//  17. no CANTRIP_EFFECTS entry (not a post-hit rider)
//  18. mirror Mind Sliver architecture, opposite sign (ADD vs SUBTRACT)
//
// Run: npx ts-node src/test/resistance.test.ts
// ============================================================

import { metadata, applySelfEffect, cleanup } from '../spells/resistance';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
} from '../engine/cantrip_effects';
import { resetBudget, rollSave } from '../engine/utils';
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

// A Resistance Action — self-buff, no target, no attack roll.
const RESISTANCE_ACTION: Action = {
  name: 'Resistance',
  isMultiattack: false,
  attackType: 'special', // self-buff — not 'melee'/'ranged'/'spell'/'save'
  reach: 0,
  range: { normal: 0, long: 0 }, // Self/Touch
  hitBonus: null,
  damage: null, // no damage — the cantrip grants +1d4 to next save
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Resistance',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Resistance');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'abjuration');
  eq('1d. rangeFt (0 — Self/Touch)', metadata.rangeFt, 0);
  eq('1e. damageDice null (no damage — buff only)', metadata.damageDice, null);
  eq('1f. damageType null', metadata.damageType, null);
  eq('1g. not concentration (v1 simplification)', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. components: V + S + M (a miniature cloak) — PHB p.272
// ============================================================
console.log('\n--- 2. components ---');
{
  eq('2a. verbal component', metadata.components.v, true);
  eq('2b. somatic component', metadata.components.s, true);
  eq('2c. material component (a miniature cloak)', metadata.components.m, true);
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
  eq('5a. resistanceConcentrationV1Simplified = true (canon: conc 1 min, v1: 1 round)',
    metadata.resistanceConcentrationV1Simplified, true);
  eq('5b. resistanceTouchAllyV1Simplified = true (canon: any willing creature, v1: self-only)',
    metadata.resistanceTouchAllyV1Simplified, true);
}

// ============================================================
// 6. metadata does NOT scale (+1d4 save bonus is flat)
// ============================================================
console.log('\n--- 6. no scaling ---');
{
  eq('6a. scales = false (Resistance does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 7. applySelfEffect sets _resistanceDieBonusNextSave = 4 + emits log
// ============================================================
console.log('\n--- 7. applySelfEffect ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('7a. flag not set before cast', caster._resistanceDieBonusNextSave, undefined);

  const ret = applySelfEffect(caster, state);
  eq('7b. applySelfEffect returns true', ret, true);
  eq('7c. _resistanceDieBonusNextSave set to 4 (d4)',
    caster._resistanceDieBonusNextSave, 4);

  const castLog = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Resistance'),
  );
  assert('7d. cast log emitted', castLog !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('7e. log mentions +1d4',
    castLog?.description.includes('+1d4') === true ||
    castLog?.description.includes('1d4') === true,
    `got: ${castLog?.description}`);
}

// ============================================================
// 8. resolveCantripAction integration — 'Resistance' routes to applySelfEffect
// ============================================================
console.log('\n--- 8. resolveCantripAction integration ---');
{
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Resistance', state);
  eq('8a. resolveCantripAction returns true', ret, true);
  eq('8b. _resistanceDieBonusNextSave set to 4',
    caster._resistanceDieBonusNextSave, 4);
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
    caster._resistanceDieBonusNextSave, undefined);
  eq('9c. unknown cantrip → no flag set on target',
    target._resistanceDieBonusNextSave, undefined);
}

// ============================================================
// 10. cleanup() clears _resistanceDieBonusNextSave flag (resetBudget integration)
// ============================================================
console.log('\n--- 10. cleanup ---');
{
  const caster = makeCombatant('cleric', { _resistanceDieBonusNextSave: 4 });
  cleanup(caster);
  eq('10a. _resistanceDieBonusNextSave cleared by cleanup()',
    caster._resistanceDieBonusNextSave, undefined);

  // resetBudget integration — buff clears at start of caster's next turn.
  const caster2 = makeCombatant('cleric2', { _resistanceDieBonusNextSave: 4 });
  resetBudget(caster2);
  eq('10b. _resistanceDieBonusNextSave cleared by resetBudget()',
    caster2._resistanceDieBonusNextSave, undefined);
}

// ============================================================
// 11. rollSave integration: bonus ADDED to save total (+1d4)
// ============================================================
console.log('\n--- 11. rollSave adds 1d4 bonus ---');
{
  // Caster has the Resistance flag set. rollSave should add rollDie(4)
  // to the save total (1-4 bonus). Verify the save total is increased by 1-4.
  const caster = makeCombatant('cleric', {
    wis: 18, // +4 mod
    _resistanceDieBonusNextSave: 4, // pre-set: Resistance landed last turn
  });

  // Roll a save WITH the bonus (flag set).
  const saveWithBonus = rollSave(caster, 'wis', 100); // DC=100 → guaranteed fail
  // Expected total: rollDie(20) + 4 (wis mod) + 0 (prof) + 0 (BI) + 0 (bless) + 0 (WB) + rollDie(4)
  // = (1..20) + 4 + (1..4) = 6..28
  // Without the bonus, it would be (1..20) + 4 = 5..24.
  assert('11a. save total in 6..28 (bonus applied)',
    saveWithBonus.total >= 6 && saveWithBonus.total <= 28,
    `total = ${saveWithBonus.total}`);

  // The flag should be CONSUMED after the save resolves (one-shot).
  eq('11b. flag CONSUMED after save (one-shot)',
    caster._resistanceDieBonusNextSave, undefined);
}

// ============================================================
// 12. rollSave integration: rider CONSUMED after one save (one-shot)
// ============================================================
console.log('\n--- 12. rider CONSUMED after one save ---');
{
  // Set the flag, roll a save, verify the flag is cleared.
  const caster = makeCombatant('cleric', {
    wis: 10,
    _resistanceDieBonusNextSave: 4,
  });
  eq('12a. flag set before save', caster._resistanceDieBonusNextSave, 4);

  rollSave(caster, 'wis', 100);

  eq('12b. flag cleared after save (one-shot consume)',
    caster._resistanceDieBonusNextSave, undefined);
}

// ============================================================
// 13. second save has NO bonus (one-shot consume verified)
// ============================================================
console.log('\n--- 13. second save has NO bonus ---');
{
  // Caster has the Resistance flag set. Roll TWO saves. The first save
  // should have the +1d4 bonus (and consume the flag); the second save
  // should NOT have the bonus (flag is now undefined).
  const caster = makeCombatant('cleric', {
    wis: 18, // +4 mod
    _resistanceDieBonusNextSave: 4,
  });

  // First save — should have the +1d4 bonus (total in 6..28 range).
  const save1 = rollSave(caster, 'wis', 100);
  eq('13a. flag consumed after first save',
    caster._resistanceDieBonusNextSave, undefined);
  assert('13b. first save total in 6..28 (with +1d4 bonus)',
    save1.total >= 6 && save1.total <= 28, `got ${save1.total}`);

  // Second save — should NOT have the bonus (total in 5..24 range).
  // Without bonus: (1..20) + 4 (wis mod) = 5..24.
  const save2 = rollSave(caster, 'wis', 100);
  assert('13c. second save total in 5..24 (NO bonus — one-shot)',
    save2.total >= 5 && save2.total <= 24, `got ${save2.total}`);
}

// ============================================================
// 14. buff clears at start of caster's next turn (resetBudget)
// ============================================================
console.log('\n--- 14. buff clears at start of next turn ---');
{
  const caster = makeCombatant('cleric', { _resistanceDieBonusNextSave: 4 });
  eq('14a. flag set before resetBudget', caster._resistanceDieBonusNextSave, 4);

  resetBudget(caster); // simulates start of caster's next turn

  eq('14b. flag cleared after resetBudget', caster._resistanceDieBonusNextSave, undefined);

  // Behavioral: after resetBudget, a save should NOT have the bonus.
  // Without bonus: (1..20) + 4 (wis mod) = 5..24.
  caster.wis = 18; // +4 mod
  const save = rollSave(caster, 'wis', 100);
  assert('14c. save after resetBudget in 5..24 (NO bonus — buff expired)',
    save.total >= 5 && save.total <= 24, `got ${save.total}`);
}

// ============================================================
// 15. Resistance itself does NOT go through resolveAttack (self-buff)
// ============================================================
console.log('\n--- 15. Resistance bypasses resolveAttack ---');
{
  const caster = makeCombatant('cleric', {
    pos: { x: 0, y: 0, z: 0 },
    actions: [RESISTANCE_ACTION],
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Resistance', state);

  // Only the "casts Resistance" action event should be present.
  const actionEvents = state.log.events.filter((e: CombatEvent) => e.type === 'action');
  eq('15a. exactly 1 action event (the cast)', actionEvents.length, 1);
  assert('15b. action event mentions Resistance',
    actionEvents[0]?.description.includes('Resistance') === true,
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
  const caster = makeCombatant('cleric');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Resistance', state);
  eq('16a. resolveCantripAoE returns false', ret, false);
  eq('16b. no log events', state.log.events.length, 0);
}

// ============================================================
// 17. no CANTRIP_EFFECTS entry (not a post-hit rider)
// ============================================================
console.log('\n--- 17. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('cleric');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Resistance', state);
  eq('17a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);
  eq('17b. no flag set on target', target._resistanceDieBonusNextSave, undefined);
}

// ============================================================
// 18. mirror Mind Sliver architecture, opposite sign (ADD vs SUBTRACT)
// ============================================================
console.log('\n--- 18. mirror Mind Sliver (opposite sign) ---');
{
  // Resistance: +1d4 to save total (BUFF on self/ally, ADD).
  // Mind Sliver: -1d4 to save total (DEBUFF on enemy, SUBTRACT).
  // Verify the architecture mirrors: same die size (4 = d4), same choke
  // point (rollSave in utils.ts), same one-shot consume semantics.
  // Only the SIGN differs (ADD vs SUBTRACT) and the TARGET differs
  // (self/ally vs enemy).

  // Resistance — set flag on self (caster).
  const buffedCaster = makeCombatant('cleric', {
    wis: 10, // +0 mod (isolate the +1d4 bonus)
    _resistanceDieBonusNextSave: 4,
  });
  const saveWithBuff = rollSave(buffedCaster, 'wis', 100);
  // Expected: (1..20) + 0 + rollDie(4) = 2..24 (the +1d4 makes the floor 2, not 1)
  // Actually (1..20) + (1..4) = 2..24.
  assert('18a. Resistance save total in 2..24 (with +1d4 ADD)',
    saveWithBuff.total >= 2 && saveWithBuff.total <= 24,
    `got ${saveWithBuff.total}`);

  // Mind Sliver — set flag on enemy (target). rollSave SUBTRACTS 1d4.
  const debuffedTarget = makeCombatant('goblin', {
    wis: 10, // +0 mod (isolate the -1d4 penalty)
    _mindSliverDiePenaltyNextSave: 4,
  });
  const saveWithDebuff = rollSave(debuffedTarget, 'wis', 100);
  // Expected: (1..20) + 0 - rollDie(4) = -3..19 (the -1d4 makes the ceiling 19, not 20)
  assert('18b. Mind Sliver save total in -3..19 (with -1d4 SUBTRACT)',
    saveWithDebuff.total >= -3 && saveWithDebuff.total <= 19,
    `got ${saveWithDebuff.total}`);

  // Verify both flags are CONSUMED after the save (one-shot, same architecture).
  eq('18c. Resistance flag CONSUMED (mirror Mind Sliver one-shot)',
    buffedCaster._resistanceDieBonusNextSave, undefined);
  eq('18d. Mind Sliver flag CONSUMED (mirror Resistance one-shot)',
    debuffedTarget._mindSliverDiePenaltyNextSave, undefined);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
