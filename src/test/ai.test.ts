// ============================================================
// Test: AI targeting + action selection + turn planner
// Run: ts-node src/test/ai.test.ts
// ============================================================

import { selectNearest, selectWeakest, selectSmart, selectTarget } from '../ai/targeting';
import { selectAction, bestAttackAction, getMultiattack, selfPreserveDecision, findBestAoECluster } from '../ai/actions';
import { planTurn, shouldTakeOpportunityAttack } from '../ai/planner';
import { Combatant, Battlefield, Action } from '../types/core';
import { addCondition } from '../engine/utils';

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
  const id = `c${++_id}`;
  return {
    id,
    name: id,
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
    isDead: false,
    isUnconscious: false,
    ...overrides,
  };
}

function meleeAction(name = 'Slash', reach = 5, avg = 8): Action {
  return {
    name, isMultiattack: false, attackType: 'melee', reach, range: null,
    hitBonus: 4, damage: { count: 1, sides: 8, bonus: 3, average: avg },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
  };
}

function rangedAction(name = 'Bow'): Action {
  return {
    name, isMultiattack: false, attackType: 'ranged', reach: 5,
    range: { normal: 80, long: 320 }, hitBonus: 4,
    damage: { count: 1, sides: 6, bonus: 3, average: 6 },
    damageType: 'piercing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
  };
}

function aoeAction(name = 'Breath', radius = 15): Action {
  return {
    name, isMultiattack: false, attackType: 'save', reach: radius,
    range: { normal: radius, long: radius }, hitBonus: null,
    damage: { count: 3, sides: 6, bonus: 0, average: 10 },
    damageType: 'fire', saveDC: 14, saveAbility: 'dex',
    isAoE: true, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
  };
}

function multiAction(): Action {
  return {
    name: 'Multiattack', isMultiattack: true, attackType: 'melee', reach: 5,
    range: null, hitBonus: 4,
    damage: { count: 2, sides: 8, bonus: 3, average: 12 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return { width: 20, height: 20, depth: 1, cells: [], combatants: map, round: 1, initiativeOrder: [] };
}

// ============================================================
// 1. selectNearest
// ============================================================
console.log('\n=== 1. selectNearest ===\n');

const hero = makeC({ faction: 'party', aiProfile: 'attackNearest', pos: {x:0,y:0,z:0} });
const near = makeC({ faction: 'enemy', pos: {x:2,y:0,z:0} });  // 10ft
const far  = makeC({ faction: 'enemy', pos: {x:8,y:0,z:0} });  // 40ft
const bf1  = makeBF([hero, near, far]);

const nearest = selectNearest(hero, bf1);
eq('Selects closer enemy', nearest?.id, near.id);

// Dead enemy excluded
near.isDead = true;
const nearestAlive = selectNearest(hero, bf1);
eq('Skips dead enemy', nearestAlive?.id, far.id);
near.isDead = false;

// No enemies
const loneHero = makeC({ faction: 'party' });
assert('No enemies → null', selectNearest(loneHero, makeBF([loneHero])) === null);

// ============================================================
// 2. selectWeakest
// ============================================================
console.log('\n=== 2. selectWeakest ===\n');

const attacker = makeC({ faction: 'party', aiProfile: 'attackWeakest', pos: {x:0,y:0,z:0} });
const fullHP   = makeC({ faction: 'enemy', currentHP: 20, maxHP: 20, pos: {x:1,y:0,z:0} });
const halfHP   = makeC({ faction: 'enemy', currentHP: 9,  maxHP: 20, pos: {x:1,y:1,z:0} }); // bloodied
const bf2 = makeBF([attacker, fullHP, halfHP]);

const weakest = selectWeakest(attacker, bf2);
eq('Bloodied target selected as weakest', weakest?.id, halfHP.id);

// ============================================================
// 3. selectSmart
// ============================================================
console.log('\n=== 3. selectSmart ===\n');

const smartAtt = makeC({ faction: 'party', aiProfile: 'smart', pos: {x:0,y:0,z:0} });
const normalE  = makeC({ faction: 'enemy', pos: {x:2,y:0,z:0} });
const healerE  = makeC({ faction: 'enemy', pos: {x:3,y:0,z:0} });

// Give healer the perception flag
smartAtt.perception.targets.set(healerE.id, {
  lastSeenPos: healerE.pos,
  visibleArmorType: 'light',
  hasShield: false,
  isBloodied: false,
  castAoEThisCombat: false,
  receivedHealingThisCombat: true,  // ← healer flag: +80 pts
  isFlying: false,
  isRanged: false,
  hasMeleeWeapon: true,
});

const bf3 = makeBF([smartAtt, normalE, healerE]);
const smartTarget = selectSmart(smartAtt, bf3);
eq('Smart prioritises healer', smartTarget?.id, healerE.id);

// ============================================================
// 4. selectTarget dispatch
// ============================================================
console.log('\n=== 4. selectTarget dispatch ===\n');

const nearest2 = makeC({ faction: 'party', aiProfile: 'attackNearest', pos: {x:0,y:0,z:0} });
const e1 = makeC({ faction: 'enemy', pos: {x:1,y:0,z:0} }); // 5ft
const e2 = makeC({ faction: 'enemy', pos: {x:4,y:0,z:0} }); // 20ft
const bf4 = makeBF([nearest2, e1, e2]);

eq('Dispatch: attackNearest → nearest', selectTarget(nearest2, bf4)?.id, e1.id);

// ============================================================
// 5. bestAttackAction
// ============================================================
console.log('\n=== 5. bestAttackAction ===\n');

const slasher = makeC({ actions: [meleeAction('Weak', 5, 4), meleeAction('Strong', 5, 10)] });
const target5 = makeC({ ac: 14 });
const best = bestAttackAction(slasher, target5);
eq('Picks higher-damage action', best?.name, 'Strong');

// Multiattack excluded from bestAttack
const withMulti = makeC({ actions: [multiAction(), meleeAction('Claw', 5, 6)] });
const bestNoMulti = bestAttackAction(withMulti, target5);
eq('Multiattack not picked by bestAttackAction', bestNoMulti?.name, 'Claw');

// getMultiattack
eq('getMultiattack finds it', getMultiattack(withMulti)?.name, 'Multiattack');
assert('No multiattack → null', getMultiattack(makeC({ actions: [meleeAction()] })) === null);

// ============================================================
// 6. selectAction
// ============================================================
console.log('\n=== 6. selectAction ===\n');

const adjE   = makeC({ faction: 'enemy', pos: {x:1,y:0,z:0} }); // 5ft
const distE  = makeC({ faction: 'enemy', pos: {x:10,y:0,z:0} }); // 50ft (out of melee)

// Melee only — adjacent → attack
const meleeOnly = makeC({ faction: 'party', pos: {x:0,y:0,z:0}, aiProfile: 'attackNearest',
  actions: [meleeAction()] });
const bf5a = makeBF([meleeOnly, adjE]);
const bfFar = makeBF([meleeOnly, distE]);

const act1 = selectAction(meleeOnly, adjE, bf5a);
eq('Adjacent melee → attack', act1.type, 'attack');

const act2 = selectAction(meleeOnly, distE, bfFar);
eq('Out of reach, melee only → dash', act2.type, 'dash');

// Ranged — far enemy → ranged attack (not dash)
const archer = makeC({ faction: 'party', pos: {x:0,y:0,z:0}, aiProfile: 'attackNearest',
  actions: [rangedAction()] });
const bfArcher = makeBF([archer, distE]);
const act3 = selectAction(archer, distE, bfArcher);
eq('Far enemy, has ranged → ranged attack', act3.type, 'attack');
eq('Used ranged action', act3.action?.attackType, 'ranged');

// Multiattack preferred over single attack when adjacent
const multiC = makeC({ faction: 'party', pos: {x:0,y:0,z:0}, aiProfile: 'attackNearest',
  actions: [multiAction(), meleeAction('Claw', 5, 6)] });
const bf5b = makeBF([multiC, adjE]);
const act4 = selectAction(multiC, adjE, bf5b);
eq('Adjacent + multiattack → multiattack', act4.action?.name, 'Multiattack');

// ============================================================
// 7. selfPreserveDecision
// ============================================================
console.log('\n=== 7. selfPreserveDecision ===\n');

const healthy = makeC({ maxHP: 20, currentHP: 20, pos: {x:0,y:0,z:0}, aiProfile: 'smart' });
assert('Healthy → null', selfPreserveDecision(healthy, makeBF([healthy])) === null);

// Below 25% HP
const wounded = makeC({ maxHP: 20, currentHP: 4, pos: {x:0,y:0,z:0}, aiProfile: 'smart' });
const surround1 = makeC({ faction: 'party', pos: {x:1,y:0,z:0} });
const surround2 = makeC({ faction: 'party', pos: {x:0,y:1,z:0} });
const surround3 = makeC({ faction: 'party', pos: {x:1,y:1,z:0} });
const bfWound = makeBF([wounded, surround1, surround2, surround3]);
const decision = selfPreserveDecision(wounded, bfWound);
assert('Low HP + surrounded → retreat or dodge', decision === 'retreat' || decision === 'dodge');

// ============================================================
// 8. planTurn — incapacitated
// ============================================================
console.log('\n=== 8. planTurn — incapacitated ===\n');

const stunned = makeC({ faction: 'enemy', pos: {x:0,y:0,z:0} });
addCondition(stunned, 'stunned');
const prey = makeC({ faction: 'party', pos: {x:1,y:0,z:0} });
const bfStunned = makeBF([stunned, prey]);
const stunnedPlan = planTurn(stunned, bfStunned);
assert('Incapacitated → no action', stunnedPlan.action === null);
assert('Incapacitated → no movement', stunnedPlan.moveBefore === null);

// ============================================================
// 9. planTurn — basic attack
// ============================================================
console.log('\n=== 9. planTurn — basic attack ===\n');

const orc = makeC({ faction: 'enemy', pos: {x:0,y:0,z:0}, aiProfile: 'attackNearest',
  actions: [meleeAction()] });
const adventurer = makeC({ faction: 'party', pos: {x:1,y:0,z:0} });
const bfBasic = makeBF([orc, adventurer]);
const basicPlan = planTurn(orc, bfBasic);

eq('Target is adventurer', basicPlan.targetId, adventurer.id);
eq('Action type = attack', basicPlan.action?.type, 'attack');
assert('Action description set', (basicPlan.action?.description.length ?? 0) > 0);

// ============================================================
// 10. planTurn — needs to move
// ============================================================
console.log('\n=== 10. planTurn — needs to move ===\n');

const orc2 = makeC({ faction: 'enemy', pos: {x:0,y:0,z:0}, aiProfile: 'attackNearest',
  actions: [meleeAction()] });
const farAdv = makeC({ faction: 'party', pos: {x:5,y:0,z:0} }); // 25ft — out of melee
const bfFarAdv = makeBF([orc2, farAdv]);
const movePlan = planTurn(orc2, bfFarAdv);

// Out of melee → dash
eq('Out of reach → dash action', movePlan.action?.type, 'dash');

// ============================================================
// 11. shouldTakeOpportunityAttack
// ============================================================
console.log('\n=== 11. OA decision ===\n');

const orcOA = makeC({ faction: 'enemy', aiProfile: 'attackNearest' });
const fleeingPC = makeC({ faction: 'party', currentHP: 5, maxHP: 20 }); // bloodied
const fullPC    = makeC({ faction: 'party', currentHP: 20, maxHP: 20 });
const bfOA = makeBF([orcOA, fleeingPC]);

assert('attackNearest always takes OA', shouldTakeOpportunityAttack(orcOA, fleeingPC, bfOA));
assert('attackNearest takes OA on healthy target too', shouldTakeOpportunityAttack(orcOA, fullPC, bfOA));

const smartOrc = makeC({ faction: 'enemy', aiProfile: 'smart' });
const bfSmart = makeBF([smartOrc, fleeingPC, fullPC]);
assert('Smart takes OA on bloodied target', shouldTakeOpportunityAttack(smartOrc, fleeingPC, bfSmart));

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
