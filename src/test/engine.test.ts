// ============================================================
// Test: movement subsystem + engine utilities
// Run: ts-node src/test/engine.test.ts
// ============================================================

import {
  chebyshev3D, distanceFt, canReach, estimateMoveCostFt,
  opportunityAttackTriggered, selectOAAction,
  isAdjacent, adjacentEnemyCount, livingEnemiesOf
} from '../engine/movement';

import {
  abilityMod, rollDamage, applyDamage, applyHeal, isBloodied,
  resetBudget, effectiveSpeed, spendMovement, attackHits,
  expectedDamage, addCondition, removeCondition, concentrationSaveDC
} from '../engine/utils';

import { Combatant, Battlefield, Action, DiceExpression } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

function eq<T>(label: string, actual: T, expected: T): void {
  assert(label, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Factories ----------------------------------------------

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'test_1',
    name: 'Tester',
    isPlayer: false,
    faction: 'enemy',
    maxHP: 20,
    currentHP: 20,
    ac: 14,
    speed: 30,
    flySpeed: null,
    swimSpeed: null,
    burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [],
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    resources: null,
    tempHP: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    isDead: false,
    isUnconscious: false,
    advantages: [], vulnerabilities: [],
    ...overrides,
  };
}

function makeMeleeAction(reach = 5, avgDamage = 8): Action {
  return {
    name: 'Slash', isMultiattack: false, attackType: 'melee',
    reach, range: null, hitBonus: 4,
    damage: { count: 1, sides: 8, bonus: 3, average: avgDamage },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
  };
}

function makeRangedAction(): Action {
  return {
    name: 'Shortbow', isMultiattack: false, attackType: 'ranged',
    reach: 5, range: { normal: 80, long: 320 }, hitBonus: 4,
    damage: { count: 1, sides: 6, bonus: 3, average: 6 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
  };
}

function makeBattlefield(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return {
    width: 20, height: 20, depth: 1,
    cells: [],     // not needed for these tests
    combatants: map,
    round: 1,
    initiativeOrder: [],
  };
}

// ============================================================
// 1. Chebyshev distance
// ============================================================
console.log('\n=== 1. chebyshev3D / distanceFt ===\n');

eq('Same point = 0', chebyshev3D({x:0,y:0,z:0}, {x:0,y:0,z:0}), 0);
eq('Orthogonal 3 squares', chebyshev3D({x:0,y:0,z:0}, {x:3,y:0,z:0}), 3);
eq('Diagonal = same as ortho', chebyshev3D({x:0,y:0,z:0}, {x:2,y:2,z:0}), 2);
eq('3D diagonal', chebyshev3D({x:0,y:0,z:0}, {x:2,y:2,z:2}), 2);
eq('Mixed: max wins', chebyshev3D({x:0,y:0,z:0}, {x:5,y:2,z:1}), 5);
eq('distanceFt: 1 sq = 5ft', distanceFt({x:0,y:0,z:0}, {x:1,y:0,z:0}), 5);
eq('distanceFt: diagonal = 5ft', distanceFt({x:0,y:0,z:0}, {x:1,y:1,z:0}), 5);
eq('distanceFt: 6 squares = 30ft', distanceFt({x:0,y:0,z:0}, {x:6,y:0,z:0}), 30);

// ============================================================
// 2. canReach
// ============================================================
console.log('\n=== 2. canReach ===\n');

const attacker = makeCombatant({ id: 'att', pos: { x: 0, y: 0, z: 0 } });
const target5 = makeCombatant({ id: 'tgt', pos: { x: 1, y: 0, z: 0 } });   // 5ft away
const target10 = makeCombatant({ id: 'tgt2', pos: { x: 2, y: 0, z: 0 } }); // 10ft away
const target30 = makeCombatant({ id: 'tgt3', pos: { x: 6, y: 0, z: 0 } }); // 30ft away
const melee5 = makeMeleeAction(5);
const melee10 = makeMeleeAction(10);
const ranged = makeRangedAction();

assert('Melee 5ft: adjacent hits', canReach(attacker, target5, melee5));
assert('Melee 5ft: 10ft misses', !canReach(attacker, target10, melee5));
assert('Melee 10ft: 10ft hits', canReach(attacker, target10, melee10));
assert('Melee 10ft: 30ft misses', !canReach(attacker, target30, melee10));
assert('Ranged: 30ft in normal range', canReach(attacker, target30, ranged));
assert('Ranged: 5ft also works', canReach(attacker, target5, ranged));

// ============================================================
// 3. estimateMoveCostFt
// ============================================================
console.log('\n=== 3. estimateMoveCostFt ===\n');

eq('Straight 6 sq = 30ft', estimateMoveCostFt({x:0,y:0,z:0},{x:6,y:0,z:0},false,false), 30);
eq('Diagonal 3 sq = 15ft (Chebyshev)', estimateMoveCostFt({x:0,y:0,z:0},{x:3,y:3,z:0},false,false), 15);
eq('No move = 0ft', estimateMoveCostFt({x:2,y:2,z:0},{x:2,y:2,z:0},false,false), 0);

// Difficult terrain doubles cost
const difficultTerrain = (pos: {x:number,y:number,z:number}) => 'difficult' as const;
eq('Difficult terrain 2 sq = 20ft', estimateMoveCostFt({x:0,y:0,z:0},{x:2,y:0,z:0},false,false,difficultTerrain), 20);

// ============================================================
// 4. Opportunity attack
// ============================================================
console.log('\n=== 4. Opportunity attacks ===\n');

const watcher = makeCombatant({
  id: 'w', faction: 'party', pos: { x: 0, y: 0, z: 0 },
  budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }
});
const walker = makeCombatant({ id: 'wk', faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });

// Moving from 5ft to 10ft (leaving reach)
assert('OA triggered leaving reach',
  opportunityAttackTriggered(watcher, walker, {x:1,y:0,z:0}, {x:2,y:0,z:0}));

// Already outside reach — no OA
assert('No OA if never in reach',
  !opportunityAttackTriggered(watcher, walker, {x:5,y:0,z:0}, {x:6,y:0,z:0}));

// Moving within reach (not leaving)
assert('No OA if staying in reach',
  !opportunityAttackTriggered(watcher, walker, {x:1,y:0,z:0}, {x:1,y:1,z:0}));

// Reaction already used
const watcherUsedReaction = makeCombatant({
  id: 'w2', faction: 'party', pos: { x: 0, y: 0, z: 0 },
  budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: true, freeObjectUsed: false }
});
assert('No OA if reaction used',
  !opportunityAttackTriggered(watcherUsedReaction, walker, {x:1,y:0,z:0}, {x:2,y:0,z:0}));

// Same faction
const allyWalker = makeCombatant({ id: 'ally', faction: 'party', pos: { x: 1, y: 0, z: 0 } });
assert('No OA on ally',
  !opportunityAttackTriggered(watcher, allyWalker, {x:1,y:0,z:0}, {x:2,y:0,z:0}));

// Disengage prevents OA
const disengager = { ...walker, usedDisengage: true } as any;
assert('No OA if disengage used',
  !opportunityAttackTriggered(watcher, disengager, {x:1,y:0,z:0}, {x:2,y:0,z:0}));

// selectOAAction: no multiattack
const multiAttacker = makeCombatant({
  id: 'multi',
  actions: [
    { ...makeMeleeAction(), name: 'Multiattack', isMultiattack: true },
    { ...makeMeleeAction(), name: 'Claw', isMultiattack: false, damage: { count: 1, sides: 6, bonus: 2, average: 5 } },
  ]
});
const oaAction = selectOAAction(multiAttacker);
assert('OA selects non-multiattack action', oaAction?.name === 'Claw');

// ============================================================
// 5. Ability modifier
// ============================================================
console.log('\n=== 5. abilityMod ===\n');

eq('Score 10 → mod 0', abilityMod(10), 0);
eq('Score 8 → mod -1', abilityMod(8), -1);
eq('Score 15 → mod +2', abilityMod(15), 2);
eq('Score 20 → mod +5', abilityMod(20), 5);
eq('Score 1 → mod -5', abilityMod(1), -5);

// ============================================================
// 6. Damage / heal
// ============================================================
console.log('\n=== 6. applyDamage / applyHeal ===\n');

const target = makeCombatant({ id: 'hp_test', maxHP: 20, currentHP: 20 });
eq('Before damage: 20 HP', target.currentHP, 20);

applyDamage(target, 5);
eq('After 5 dmg: 15 HP', target.currentHP, 15);

applyDamage(target, 100); // overkill
eq('Overkill: 0 HP', target.currentHP, 0);
assert('Monster dies at 0', target.isDead);

// Heal
const healTarget = makeCombatant({ id: 'heal_test', maxHP: 20, currentHP: 10 });
applyHeal(healTarget, 7);
eq('Heal 7: 17 HP', healTarget.currentHP, 17);

applyHeal(healTarget, 100); // over-heal
eq('Over-heal caps at maxHP', healTarget.currentHP, 20);

// Unconscious PC is revived by healing
const downedPC = makeCombatant({ id: 'pc', isPlayer: true, currentHP: 0, maxHP: 10, isUnconscious: true });
downedPC.conditions.add('unconscious');
downedPC.conditions.add('incapacitated');
applyHeal(downedPC, 1);
assert('PC revived on heal', !downedPC.isUnconscious);
assert('Unconscious condition removed', !downedPC.conditions.has('unconscious'));

// isBloodied
assert('20/20 not bloodied', !isBloodied(makeCombatant({ maxHP: 20, currentHP: 20 })));
assert('9/20 is bloodied', isBloodied(makeCombatant({ maxHP: 20, currentHP: 9 })));
assert('10/20 not bloodied (exactly 50%)', !isBloodied(makeCombatant({ maxHP: 20, currentHP: 10 })));

// ============================================================
// 7. Action budget
// ============================================================
console.log('\n=== 7. Budget / movement spending ===\n');

const budgetTest = makeCombatant({ id: 'budget', speed: 40 });
budgetTest.budget.movementFt = 0;
budgetTest.budget.actionUsed = true;

resetBudget(budgetTest);
eq('Reset: movementFt = 40', budgetTest.budget.movementFt, 40);
assert('Reset: action unused', !budgetTest.budget.actionUsed);
assert('Reset: bonusAction unused', !budgetTest.budget.bonusActionUsed);

assert('Spend 20ft ok', spendMovement(budgetTest, 20));
eq('After 20ft: 20ft left', budgetTest.budget.movementFt, 20);
assert('Spend 30ft fails (only 20 left)', !spendMovement(budgetTest, 30));
eq('Failed spend: still 20ft', budgetTest.budget.movementFt, 20);

// Grappled speed = 0
const grappled = makeCombatant({ id: 'grp', speed: 30 });
addCondition(grappled, 'grappled');
eq('Grappled effectiveSpeed = 0', effectiveSpeed(grappled), 0);
removeCondition(grappled, 'grappled');
eq('After removing grapple: speed = 30', effectiveSpeed(grappled), 30);

// ============================================================
// 8. attackHits
// ============================================================
console.log('\n=== 8. attackHits ===\n');

assert('Nat 1 always misses', !attackHits(1, 25, 10));    // would otherwise hit
assert('Nat 20 always hits', attackHits(20, 1, 30));       // would otherwise miss
assert('Roll 15 vs AC 14 hits', attackHits(15, 15, 14));
assert('Roll 13 vs AC 14 misses', !attackHits(13, 13, 14));
assert('Total 14 vs AC 14 hits (equal = hit)', attackHits(10, 14, 14));

// ============================================================
// 9. expectedDamage
// ============================================================
console.log('\n=== 9. expectedDamage ===\n');

const d8plus3: DiceExpression = { count: 1, sides: 8, bonus: 3, average: 7 };
// vs AC 14, +4 to hit: min roll to hit = 14-4 = 10; hits on 10-20 = 11 faces out of 20
// pHit = 11/20 = 0.55; pCrit = 0.05; critExtra = 1*(8+1)/2 = 4.5
// expected = 0.55*7 + 0.05*4.5 = 3.85 + 0.225 = 4.075
const ed = expectedDamage(4, d8plus3, 14);
assert('Expected damage is positive', ed > 0);
assert('Expected damage < average (some misses)', ed < 7);
assert('Expected damage roughly correct (~4.0)', Math.abs(ed - 4.075) < 0.1);

// Auto-hit (no hitBonus): returns full average
const edAutoHit = expectedDamage(null, d8plus3, 14);
eq('Auto-hit returns average', edAutoHit, 7);

// No damage
eq('No damage dice = 0', expectedDamage(4, null, 14), 0);

// ============================================================
// 10. concentrationSaveDC
// ============================================================
console.log('\n=== 10. concentrationSaveDC ===\n');

eq('DC for 5 damage = max(10,2)=10', concentrationSaveDC(5), 10);
eq('DC for 20 damage = max(10,10)=10', concentrationSaveDC(20), 10);
eq('DC for 22 damage = max(10,11)=11', concentrationSaveDC(22), 11);
eq('DC for 40 damage = 20', concentrationSaveDC(40), 20);

// ============================================================
// 11. Adjacent helpers
// ============================================================
console.log('\n=== 11. Adjacency / faction helpers ===\n');

assert('(0,0) adj to (1,0)', isAdjacent({x:0,y:0,z:0}, {x:1,y:0,z:0}));
assert('(0,0) adj to (1,1)', isAdjacent({x:0,y:0,z:0}, {x:1,y:1,z:0}));
assert('(0,0) not adj to (2,0)', !isAdjacent({x:0,y:0,z:0}, {x:2,y:0,z:0}));

const hero = makeCombatant({ id: 'hero', faction: 'party', pos: {x:0,y:0,z:0} });
const orc1 = makeCombatant({ id: 'orc1', faction: 'enemy', pos: {x:1,y:0,z:0} });
const orc2 = makeCombatant({ id: 'orc2', faction: 'enemy', pos: {x:5,y:0,z:0} }); // far
const bf = makeBattlefield([hero, orc1, orc2]);

eq('Adjacent enemy count = 1', adjacentEnemyCount(hero, bf), 1);
eq('Living enemies = 2', livingEnemiesOf(hero, bf).length, 2);

// Dead enemy not counted
orc1.isDead = true;
eq('Dead enemy excluded from adjacentCount', adjacentEnemyCount(hero, bf), 0);
eq('Dead enemy excluded from livingEnemies', livingEnemiesOf(hero, bf).length, 1);

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
