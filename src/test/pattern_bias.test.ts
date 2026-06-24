// ============================================================
// Test: Pattern Bias AI — Situation-Aware Spell-Selection Weighting
// RFC: docs/RFC-PATTERN-BIAS-AI.md (Phase 1)
//
// Session 65 scope:
//   ✅ 8 pattern detectors (enemyCluster, finisher, woundedAlly,
//     acVsSave, concentrationPreservation, kiting, defensiveEscape,
//     resourceAllOut)
//   ✅ composeBiases() with veto + clamp
//   ✅ estimateConcentrationValue() lookup table
//   ✅ collectCantripBiases() wiring helper
//   ✅ computeSpellWeight() extended with biases parameter
//
// Run: npx ts-node --transpile-only src/test/pattern_bias.test.ts
// ============================================================

import {
  composeBiases,
  enemyClusterBias,
  finisherBias,
  woundedAllyBias,
  acVsSaveBias,
  concentrationPreservationBias,
  estimateConcentrationValue,
  kitingBias,
  defensiveEscapeBias,
  resourceAllOutBias,
  collectCantripBiases,
} from '../ai/pattern_bias';
import {
  computeSpellWeight,
  computeSpellcastContext,
  SpellcastContext,
  SpellTag,
} from '../ai/monster_spellcasting';
import { Combatant, Battlefield, Vec3 } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}
function approx(label: string, a: number, e: number, tol = 0.001): void {
  assert(label, Math.abs(a - e) <= tol, `got ${a}, want ${e} (tol ${tol})`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const id = `c${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 30, currentHP: 30, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...o,
  };
}

function makeBF(combatants: Combatant[], round = 1): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 30, height: 30, depth: 1, cells: [],
    combatants: map, round,
    initiativeOrder: combatants.map(c => c.id),
  };
}

function makeCtx(o: Partial<SpellcastContext> = {}): SpellcastContext {
  return {
    selfHPct: 1.0,
    allyCount: 0,
    enemyCount: 1,
    nearestEnemyDistFt: 30,
    hasDownedAlly: false,
    isOutnumbered: false,
    round: 1,
    ...o,
  };
}

// ============================================================
console.log('\n=== 1. composeBiases — veto wins ===\n');
// ============================================================

{
  eq('1a: veto (0.0) collapses to 0', composeBiases([1.5, 0.0, 2.0]), 0);
  eq('1b: empty array = 1.0', composeBiases([]), 1);
  approx('1c: single 1.5 = 1.5', composeBiases([1.5]), 1.5);
  approx('1d: 1.5 * 2.0 = 3.0', composeBiases([1.5, 2.0]), 3.0);
}

// ============================================================
console.log('\n=== 2. composeBiases — upper clamp ===\n');
// ============================================================

{
  // 3.0 * 3.0 * 3.0 * 3.0 = 81 → clamped to 10.0
  approx('2a: product 81 clamped to 10.0', composeBiases([3.0, 3.0, 3.0, 3.0]), 10.0);
}

// ============================================================
console.log('\n=== 3. composeBiases — lower clamp ===\n');
// ============================================================

{
  // 0.5 ^ 5 = 0.03125 → clamped to 0.1
  approx('3a: product 0.03 clamped to 0.1', composeBiases([0.5, 0.5, 0.5, 0.5, 0.5]), 0.1);
}

// ============================================================
console.log('\n=== 4. finisherBias — target almost dead ===\n');
// ============================================================

{
  const target = makeC({ currentHP: 6 });
  const ctx = makeCtx();
  const bf = makeBF([target]);
  const self = makeC();

  eq('4a: target HP <= avgDmg*1.5 → 1.3', finisherBias(ctx, bf, self, target, 5), 1.3);
  const healthyTarget = makeC({ currentHP: 30 });
  eq('4b: target HP > avgDmg*1.5 → 1.0', finisherBias(ctx, bf, self, healthyTarget, 5), 1.0);
}

// ============================================================
console.log('\n=== 5. woundedAllyBias — downed strong ally ===\n');
// ============================================================

{
  const self = makeC({ faction: 'party' });
  const downedAlly = makeC({ faction: 'party', maxHP: 30, currentHP: 0, isUnconscious: true });
  const bf = makeBF([self, downedAlly]);
  const ctx = makeCtx({ hasDownedAlly: true });

  eq('5a: downed strong ally → 2.5 for healing spell',
    woundedAllyBias(ctx, bf, self, ['healing']), 2.5);
  eq('5b: downed strong ally → 2.5 for defending spell',
    woundedAllyBias(ctx, bf, self, ['defending']), 2.5);
  eq('5c: damage spell → 1.0 (no boost)',
    woundedAllyBias(ctx, bf, self, ['damage']), 1.0);
}

// ============================================================
console.log('\n=== 6. woundedAllyBias — weak ally below threshold ===\n');
// ============================================================

{
  const self = makeC({ faction: 'party' });
  const weakAlly = makeC({ faction: 'party', maxHP: 10, currentHP: 0, isUnconscious: true });
  const bf = makeBF([self, weakAlly]);
  const ctx = makeCtx();

  eq('6a: downed weak ally (maxHP < 25) → 1.0 for healing',
    woundedAllyBias(ctx, bf, self, ['healing']), 1.0);
}

// ============================================================
console.log('\n=== 7. woundedAllyBias — bloodied strong ally ===\n');
// ============================================================

{
  const self = makeC({ faction: 'party' });
  const bloodiedAlly = makeC({ faction: 'party', maxHP: 40, currentHP: 15 }); // 37.5% HP
  const bf = makeBF([self, bloodiedAlly]);
  const ctx = makeCtx();

  eq('7a: bloodied strong ally → 1.8 for healing',
    woundedAllyBias(ctx, bf, self, ['healing']), 1.8);
}

// ============================================================
console.log('\n=== 8. acVsSaveBias — attack roll vs low AC ===\n');
// ============================================================

{
  const target = makeC({ ac: 12, con: 20, wis: 10 });  // low AC, high CON save
  const ctx = makeCtx();
  const bf = makeBF([target]);
  const self = makeC();

  // Attack-roll spell vs low AC + high save → 1.4
  eq('8a: attack-roll vs AC 12 + high save → 1.4',
    acVsSaveBias(ctx, bf, self, target, { attackRoll: true, saveAbility: 'con' }), 1.4);

  // Attack-roll spell vs low AC alone → 1.2
  const targetLowAC = makeC({ ac: 12, con: 10 });
  eq('8b: attack-roll vs AC 12 + normal save → 1.2',
    acVsSaveBias(ctx, bf, self, targetLowAC, { attackRoll: true, saveAbility: 'con' }), 1.2);

  // Attack-roll spell vs high AC → 0.7
  const highACTarget = makeC({ ac: 20 });
  eq('8c: attack-roll vs AC 20 → 0.7',
    acVsSaveBias(ctx, bf, self, highACTarget, { attackRoll: true }), 0.7);
}

// ============================================================
console.log('\n=== 9. acVsSaveBias — save spell targeting ===\n');
// ============================================================

{
  const target = makeC({ wis: 20 });  // high WIS save (+5)
  const ctx = makeCtx();
  const bf = makeBF([target]);
  const self = makeC();

  // Save-or-suck vs high-save target → 0.6
  eq('9a: save-or-suck vs high save → 0.6',
    acVsSaveBias(ctx, bf, self, target, { attackRoll: false, saveAbility: 'wis' }), 0.6);

  // Half-on-save vs high-save target → 1.1
  eq('9b: half-on-save vs high save → 1.1',
    acVsSaveBias(ctx, bf, self, target, { attackRoll: false, saveAbility: 'wis', dealsHalfOnSave: true }), 1.1);

  // Save vs low-save target → 1.3
  const lowSaveTarget = makeC({ wis: 8 });  // WIS 8 = -1 modifier
  eq('9c: save vs low-save target → 1.3',
    acVsSaveBias(ctx, bf, self, lowSaveTarget, { attackRoll: false, saveAbility: 'wis' }), 1.3);
}

// ============================================================
console.log('\n=== 10. concentrationPreservationBias — basic ===\n');
// ============================================================

{
  const ctx = makeCtx({ round: 3 });
  const bf = makeBF([]);
  const selfNoConc = makeC();

  // Not concentrating → 1.0
  eq('10a: not concentrating + concentration candidate → 1.0',
    concentrationPreservationBias(ctx, bf, selfNoConc, true, 3.0), 1.0);

  // Non-concentration spell → 1.0
  eq('10b: concentrating + non-concentration candidate → 1.0',
    concentrationPreservationBias(ctx, bf, selfNoConc, false, 3.0), 1.0);
}

// ============================================================
console.log('\n=== 11. concentrationPreservationBias — churn penalty ===\n');
// ============================================================

{
  const bf = makeBF([]);

  // Currently concentrating on Bless (value 2.5), candidate is Hold Person (value 4.5)
  // swapMerit = 4.5 - 2.5 = 2.0 → partial override (max(churnPenalty, 0.7))
  const selfSwappedLastTurn: Combatant = makeC({
    concentration: { active: true, spellName: 'Bless', dcIfHit: 10 },
  });
  (selfSwappedLastTurn as any)._lastConcentrationSwapTurn = 2;  // swapped last turn
  const ctx = makeCtx({ round: 3 });  // turnsSinceSwap = 1

  // swapMerit = 2.0 → partial override → max(0.0, 0.7) = 0.7
  const bias11a = concentrationPreservationBias(ctx, bf, selfSwappedLastTurn, true, 4.5);
  approx('11a: churn last turn + partial override → 0.7', bias11a, 0.7);

  // swapMerit = 0 (candidate value = current value) → apply churn penalty → 0.0
  const bias11b = concentrationPreservationBias(ctx, bf, selfSwappedLastTurn, true, 2.5);
  eq('11b: churn last turn + no override → 0.0 (veto)', bias11b, 0.0);

  // swapMerit >= 3.0 → full override → 1.0
  const bias11c = concentrationPreservationBias(ctx, bf, selfSwappedLastTurn, true, 6.0);
  eq('11c: churn last turn + high override → 1.0', bias11c, 1.0);
}

// ============================================================
console.log('\n=== 12. concentrationPreservationBias — churn decay ===\n');
// ============================================================

{
  const bf = makeBF([]);
  const self: Combatant = makeC({
    concentration: { active: true, spellName: 'Bless', dcIfHit: 10 },
  });
  (self as any)._lastConcentrationSwapTurn = 1;  // swapped at round 1

  // Round 4 → turnsSinceSwap = 3 → mild penalty 0.8
  const ctx4 = makeCtx({ round: 4 });
  const bias4 = concentrationPreservationBias(ctx4, bf, self, true, 2.5);
  approx('12a: churn 3 turns ago → 0.8', bias4, 0.8);

  // Round 5 → turnsSinceSwap = 4 → full neutral 1.0
  const ctx5 = makeCtx({ round: 5 });
  const bias5 = concentrationPreservationBias(ctx5, bf, self, true, 2.5);
  eq('12b: churn 4+ turns ago → 1.0', bias5, 1.0);
}

// ============================================================
console.log('\n=== 13. estimateConcentrationValue ===\n');
// ============================================================

{
  eq('13a: Bless → 2.5', estimateConcentrationValue('Bless'), 2.5);
  eq('13b: Hold Person → 4.5', estimateConcentrationValue('Hold Person'), 4.5);
  eq('13c: Spirit Guardians → 4.5', estimateConcentrationValue('Spirit Guardians'), 4.5);
  eq('13d: Unknown spell → 1.5 (floor)', estimateConcentrationValue('Unknown Spell'), 1.5);
}

// ============================================================
console.log('\n=== 14. defensiveEscapeBias ===\n');
// ============================================================

{
  const self = makeC({ maxHP: 30, currentHP: 8 });  // < 30% HP
  const enemy1 = makeC({ faction: 'party', pos: { x: 1, y: 0, z: 0 } });  // adjacent
  const enemy2 = makeC({ faction: 'party', pos: { x: 0, y: 1, z: 0 } });  // adjacent
  const bf = makeBF([self, enemy1, enemy2]);
  const ctx = makeCtx({ selfHPct: 8 / 30 });

  // HP < 30% + 2 adjacent enemies → 2.5
  eq('14a: HP < 30% + adjacent enemies → 2.5 for defending',
    defensiveEscapeBias(ctx, bf, self, ['defending']), 2.5);

  // Damage spell → no boost
  eq('14b: damage spell → 1.0',
    defensiveEscapeBias(ctx, bf, self, ['damage']), 1.0);

  // HP >= 30% → no boost even with adjacent enemies
  const healthySelf = makeC({ maxHP: 30, currentHP: 15 });  // 50% HP
  const bf2 = makeBF([healthySelf, enemy1]);
  const ctx2 = makeCtx({ selfHPct: 0.5 });
  eq('14c: HP >= 30% → 1.0',
    defensiveEscapeBias(ctx2, bf2, healthySelf, ['defending']), 1.0);
}

// ============================================================
console.log('\n=== 15. resourceAllOutBias ===\n');
// ============================================================

{
  const ctx = makeCtx();
  const bf = makeBF([]);

  const monster = makeC({ faction: 'enemy' });
  const pc = makeC({ faction: 'party' });

  eq('15a: monster → 1.0 always', resourceAllOutBias(ctx, bf, monster, 5), 1.0);
  eq('15b: PC → 1.0 (Phase 1)', resourceAllOutBias(ctx, bf, pc, 5), 1.0);
}

// ============================================================
console.log('\n=== 16. kitingBias ===\n');
// ============================================================

{
  // Self: ranged-capable, defending-tag spell, enemies far away
  const self = makeC({
    speed: 30,
    actions: [{ name: 'Fire Bolt', attackType: 'spell', isMultiattack: false, reach: 0, range: { normal: 120, long: 120 }, hitBonus: 5, damage: { count: 1, sides: 10, bonus: 0, average: 5 }, damageType: 'fire', saveDC: null, saveAbility: null, isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '' }],
  });
  // Melee-only enemy (no ranged actions)
  const meleeEnemy = makeC({ faction: 'party', speed: 30, pos: { x: 5, y: 5, z: 0 } });
  const bf = makeBF([self, meleeEnemy]);
  const ctx = makeCtx({ nearestEnemyDistFt: 35 });

  // Damage spell → no kiting boost
  eq('16a: damage spell → 1.0', kitingBias(ctx, bf, self, ['damage']), 1.0);

  // Too close → no kiting
  const ctxClose = makeCtx({ nearestEnemyDistFt: 5 });
  eq('16b: too close → 1.0', kitingBias(ctxClose, bf, self, ['defending']), 1.0);
}

// ============================================================
console.log('\n=== 17. computeSpellWeight with biases ===\n');
// ============================================================

{
  const ctx = makeCtx();

  // Without biases (backward-compat)
  const weightNoBias = computeSpellWeight('Fire Bolt', ['damage'], 0, 5, ctx, 30);
  const weightEmptyBias = computeSpellWeight('Fire Bolt', ['damage'], 0, 5, ctx, 30, []);
  approx('17a: no biases = empty biases', weightNoBias, weightEmptyBias);

  // With boost bias
  const weightBoosted = computeSpellWeight('Fire Bolt', ['damage'], 0, 5, ctx, 30, [1.5]);
  assert('17b: boosted weight > unboosted', weightBoosted > weightNoBias);

  // With veto
  const weightVetoed = computeSpellWeight('Fire Bolt', ['damage'], 0, 5, ctx, 30, [0.0]);
  eq('17c: veto → weight = 0', weightVetoed, 0);
}

// ============================================================
console.log('\n=== 18. enemyClusterBias — cluster detection ===\n');
// ============================================================

{
  const self = makeC({ faction: 'enemy' });
  // Two enemies close together (within 15ft)
  const e1 = makeC({ faction: 'party', pos: { x: 3, y: 3, z: 0 } });
  const e2 = makeC({ faction: 'party', pos: { x: 4, y: 3, z: 0 } });
  const bf = makeBF([self, e1, e2]);
  const ctx = makeCtx({ enemyCount: 2 });

  // Damage spell with 2 enemies in radius → 1.6
  const bias2 = enemyClusterBias(ctx, bf, self, ['damage'], 15);
  assert('18a: 2 enemies clustered → >= 1.6', bias2 >= 1.6);

  // Healing spell → no cluster boost
  eq('18b: healing spell → 1.0', enemyClusterBias(ctx, bf, self, ['healing'], 15), 1.0);

  // No enemies nearby → 1.0
  const farEnemy = makeC({ faction: 'party', pos: { x: 20, y: 20, z: 0 } });
  const bfFar = makeBF([self, farEnemy]);
  const ctxFar = makeCtx({ enemyCount: 1 });
  eq('18c: no cluster → 1.0', enemyClusterBias(ctxFar, bfFar, self, ['damage'], 15), 1.0);
}

// ============================================================
console.log('\n=== 19. enemyClusterBias outranks finisherBias ===\n');
// ============================================================

{
  // Per user directive: "'enemies are grouped' would have higher 'bias'
  // bonus than 'target almost dead'". Verify via composition.
  const self = makeC({ faction: 'enemy' });
  const e1 = makeC({ faction: 'party', pos: { x: 3, y: 3, z: 0 }, currentHP: 6 });  // low HP (finisher target)
  const e2 = makeC({ faction: 'party', pos: { x: 4, y: 3, z: 0 }, currentHP: 30 });
  const bf = makeBF([self, e1, e2]);
  const ctx = makeCtx({ enemyCount: 2 });

  // Cluster bias caps at 2.5, finisher caps at 1.3.
  // So cluster * finisher can be up to 3.25, but finisher alone is 1.3.
  const clusterMult = enemyClusterBias(ctx, bf, self, ['damage'], 15);
  const finisherMult = finisherBias(ctx, bf, self, e1, 5);
  assert('19a: cluster bias > finisher bias', clusterMult > finisherMult);
}

// ============================================================
console.log('\n=== 20. collectCantripBiases — returns 8 biases ===\n');
// ============================================================

{
  const self = makeC({ faction: 'enemy' });
  const target = makeC({ faction: 'party', ac: 14, wis: 10, currentHP: 30 });
  const bf = makeBF([self, target]);
  const ctx = makeCtx();

  const biases = collectCantripBiases(ctx, bf, self, target, ['damage'], 5, true, undefined);
  eq('20a: 8 biases collected', biases.length, 8);

  // All biases should be > 0 (no veto for this default setup)
  const allPositive = biases.every(b => b > 0);
  assert('20b: all biases > 0', allPositive);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\nAll tests passed ✅');
