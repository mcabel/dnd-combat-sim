// ============================================================
// Test: Cantrip Planner Branches (9 offensive cantrips)
// Verifies that each cantrip's explicit planner branch fires
// when conditions are met and does NOT fire when conditions
// aren't met.
//
// Run: npx ts-node src/test/cantrip_planner.test.ts
// ============================================================

import { planTurn } from '../ai/planner';
import { Combatant, Action, Battlefield } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
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
    maxHP: 30,
    currentHP: 30,
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
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false, wearingArmor: false,
    isDead: false,
    isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return { width: 20, height: 20, depth: 1, cells: [], combatants: map, round: 1, initiativeOrder: [] };
}

// ---- Cantrip Action factories -------------------------------

function boomingBladeAction(): Action {
  return {
    name: 'Booming Blade',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: null,
    hitBonus: 5,
    damage: { count: 1, sides: 8, bonus: 0, average: 4.5 },
    damageType: 'thunder',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Booming Blade',
  };
}

function frostbiteAction(): Action {
  return {
    name: 'Frostbite',
    isMultiattack: false,
    attackType: 'save',
    reach: 0,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'cold',
    saveDC: 14,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Frostbite',
  };
}

function mindSliverAction(): Action {
  return {
    name: 'Mind Sliver',
    isMultiattack: false,
    attackType: 'save',
    reach: 0,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'psychic',
    saveDC: 14,
    saveAbility: 'int',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Mind Sliver',
  };
}

function poisonSprayAction(): Action {
  return {
    name: 'Poison Spray',
    isMultiattack: false,
    attackType: 'save',
    reach: 0,
    range: { normal: 10, long: 10 },
    hitBonus: null,
    damage: { count: 1, sides: 12, bonus: 0, average: 6.5 },
    damageType: 'poison',
    saveDC: 14,
    saveAbility: 'con',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Poison Spray',
  };
}

function shockingGraspAction(): Action {
  return {
    name: 'Shocking Grasp',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: null,
    hitBonus: 5,
    damage: { count: 1, sides: 8, bonus: 0, average: 4.5 },
    damageType: 'lightning',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Shocking Grasp',
  };
}

function swordBurstAction(): Action {
  return {
    name: 'Sword Burst',
    isMultiattack: false,
    attackType: 'save',
    reach: 0,
    range: { normal: 5, long: 5 },
    hitBonus: null,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'force',
    saveDC: 14,
    saveAbility: 'dex',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Sword Burst',
  };
}

function thunderclapAction(): Action {
  return {
    name: 'Thunderclap',
    isMultiattack: false,
    attackType: 'save',
    reach: 0,
    range: { normal: 5, long: 5 },
    hitBonus: null,
    damage: { count: 1, sides: 6, bonus: 0, average: 3.5 },
    damageType: 'thunder',
    saveDC: 14,
    saveAbility: 'con',
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Thunderclap',
  };
}

function trueStrikeAction(): Action {
  return {
    name: 'True Strike',
    isMultiattack: false,
    attackType: null,       // self-buff, no attack roll
    reach: 0,
    range: { normal: 30, long: 30 },
    hitBonus: null,
    damage: null,
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
}

function tollTheDeadAction(): Action {
  return {
    name: 'Toll the Dead',
    isMultiattack: false,
    attackType: 'save',
    reach: 0,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: { count: 1, sides: 8, bonus: 0, average: 4.5 },
    damageType: 'necrotic',
    saveDC: 14,
    saveAbility: 'wis',
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Toll the Dead',
  };
}

// A dummy leveled save spell (for Mind Sliver setup test)
function holdPersonAction(): Action {
  return {
    name: 'Hold Person',
    isMultiattack: false,
    attackType: 'save',
    reach: 0,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: null,
    damageType: null,
    saveDC: 14,
    saveAbility: 'wis',
    isAoE: false,
    isControl: true,
    requiresConcentration: true,
    slotLevel: 2,
    costType: 'action',
    legendaryCost: 0,
    description: 'Hold Person',
  };
}

function rangedWeaponAction(): Action {
  return {
    name: 'Longbow',
    isMultiattack: false,
    attackType: 'ranged',
    reach: 5,
    range: { normal: 150, long: 600 },
    hitBonus: 5,
    damage: { count: 1, sides: 8, bonus: 3, average: 7.5 },
    damageType: 'piercing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    costType: 'action',
    legendaryCost: 0,
    description: 'Longbow',
  };
}

// ============================================================
// 1. Booming Blade
// ============================================================
console.log('\n=== 1. Booming Blade ===\n');
{
  // POSITIVE: adjacent enemy with ranged weapon (wants to move)
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [boomingBladeAction()],
  });
  const enemy = makeC({
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    actions: [rangedWeaponAction()],
  });
  const bf = makeBF([caster, enemy]);
  const plan = planTurn(caster, bf);
  eq('1a. Booming Blade planned vs ranged enemy', plan.action?.type, 'cast');
  assert('1b. Action is Booming Blade', plan.action?.action?.name === 'Booming Blade');
  eq('1c. Target is enemy', plan.targetId, enemy.id);

  // NEGATIVE: adjacent enemy with only melee attacks (not likely to move)
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [boomingBladeAction()],
  });
  const meleeEnemy = makeC({
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    actions: [{
      name: 'Slash', isMultiattack: false, attackType: 'melee', reach: 5, range: null,
      hitBonus: 4, damage: { count: 1, sides: 8, bonus: 3, average: 7.5 },
      damageType: 'slashing', saveDC: null, saveAbility: null,
      isAoE: false, isControl: false, requiresConcentration: false, costType: 'action', legendaryCost: 0, description: '',
    }],
  });
  const bf2 = makeBF([caster2, meleeEnemy]);
  const plan2 = planTurn(caster2, bf2);
  assert('1d. Booming Blade NOT planned vs melee-only enemy (falls through)',
    plan2.action?.action?.name !== 'Booming Blade');
}

// ============================================================
// 2. Frostbite
// ============================================================
console.log('\n=== 2. Frostbite ===\n');
{
  // POSITIVE: enemy with weapon attacks, not already debuffed
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [frostbiteAction()],
  });
  const enemy = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 }, // 10ft away — within 60ft range
    actions: [rangedWeaponAction()],
  });
  const bf = makeBF([caster, enemy]);
  const plan = planTurn(caster, bf);
  eq('2a. Frostbite planned vs weapon enemy', plan.action?.type, 'cast');
  assert('2b. Action is Frostbite', plan.action?.action?.name === 'Frostbite');
  eq('2c. Target is enemy', plan.targetId, enemy.id);

  // NEGATIVE: enemy already has Frostbite debuff
  const caster3 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [frostbiteAction()],
  });
  const debuffedEnemy = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 },
    actions: [rangedWeaponAction()],
    _frostbiteDisadvNextWeaponAttack: true,
  });
  const bf3 = makeBF([caster3, debuffedEnemy]);
  const plan3 = planTurn(caster3, bf3);
  assert('2d. Frostbite NOT planned when enemy already debuffed',
    plan3.action?.action?.name !== 'Frostbite');
}

// ============================================================
// 3. Mind Sliver
// ============================================================
console.log('\n=== 3. Mind Sliver ===\n');
{
  // POSITIVE: caster has save-based leveled spell + spell slots
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [mindSliverAction(), holdPersonAction()],
    resources: {
      spellSlots: {
        1: { max: 2, remaining: 2 },
        2: { max: 2, remaining: 2 },
        3: { max: 0, remaining: 0 },
        4: { max: 0, remaining: 0 },
        5: { max: 0, remaining: 0 },
        6: { max: 0, remaining: 0 },
        7: { max: 0, remaining: 0 },
        8: { max: 0, remaining: 0 },
        9: { max: 0, remaining: 0 },
      },
    },
  });
  const enemy = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 }, // within 60ft range
  });
  const bf = makeBF([caster, enemy]);
  const plan = planTurn(caster, bf);
  eq('3a. Mind Sliver planned with save spell available', plan.action?.type, 'cast');
  assert('3b. Action is Mind Sliver', plan.action?.action?.name === 'Mind Sliver');
  eq('3c. Target is enemy', plan.targetId, enemy.id);

  // NEGATIVE: caster has no save-based leveled spell
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [mindSliverAction()],
  });
  const enemy2 = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 },
  });
  const bf2 = makeBF([caster2, enemy2]);
  const plan2 = planTurn(caster2, bf2);
  assert('3d. Mind Sliver NOT planned without save spell setup',
    plan2.action?.action?.name !== 'Mind Sliver');
}

// ============================================================
// 4. Poison Spray
// ============================================================
console.log('\n=== 4. Poison Spray ===\n');
{
  // POSITIVE: normal enemy within 10ft
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [poisonSprayAction()],
  });
  const enemy = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 }, // 10ft away — within range
  });
  const bf = makeBF([caster, enemy]);
  const plan = planTurn(caster, bf);
  eq('4a. Poison Spray planned vs normal enemy', plan.action?.type, 'cast');
  assert('4b. Action is Poison Spray', plan.action?.action?.name === 'Poison Spray');

  // NEGATIVE: undead enemy (immune to poison)
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [poisonSprayAction()],
  });
  const undeadEnemy = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 },
    isUndead: true,
  });
  const bf2 = makeBF([caster2, undeadEnemy]);
  const plan2 = planTurn(caster2, bf2);
  assert('4c. Poison Spray NOT planned vs undead (immune)',
    plan2.action?.action?.name !== 'Poison Spray');

  // NEGATIVE: construct enemy (immune to poison)
  const caster3 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [poisonSprayAction()],
  });
  const constructEnemy = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 },
    isConstruct: true,
  });
  const bf3 = makeBF([caster3, constructEnemy]);
  const plan3 = planTurn(caster3, bf3);
  assert('4d. Poison Spray NOT planned vs construct (immune)',
    plan3.action?.action?.name !== 'Poison Spray');
}

// ============================================================
// 5. Shocking Grasp
// ============================================================
console.log('\n=== 5. Shocking Grasp ===\n');
{
  // POSITIVE: enemy in metal armor (advantage)
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [shockingGraspAction()],
  });
  const metalEnemy = makeC({
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 }, // adjacent (5ft)
    hasMetalArmor: true,
  });
  const bf = makeBF([caster, metalEnemy]);
  const plan = planTurn(caster, bf);
  eq('5a. Shocking Grasp planned vs metal-armored enemy', plan.action?.type, 'cast');
  assert('5b. Action is Shocking Grasp', plan.action?.action?.name === 'Shocking Grasp');
  assert('5c. Description mentions metal armor advantage',
    plan.action?.description?.includes('metal armor') === true);

  // POSITIVE: adjacent enemy without metal armor (still usable, just no advantage mention)
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [shockingGraspAction()],
  });
  const normalEnemy = makeC({
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    hasMetalArmor: false,
  });
  const bf2 = makeBF([caster2, normalEnemy]);
  const plan2 = planTurn(caster2, bf2);
  eq('5d. Shocking Grasp planned vs non-metal adjacent enemy', plan2.action?.type, 'cast');
  assert('5e. Action is Shocking Grasp (no metal)', plan2.action?.action?.name === 'Shocking Grasp');

  // NEGATIVE: enemy out of melee range
  const caster3 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [shockingGraspAction()],
  });
  const farEnemy = makeC({
    faction: 'enemy',
    pos: { x: 3, y: 0, z: 0 }, // 15ft away — out of touch range
    hasMetalArmor: true,
  });
  const bf3 = makeBF([caster3, farEnemy]);
  const plan3 = planTurn(caster3, bf3);
  // With no other actions, the planner should dash, not cast Shocking Grasp
  assert('5f. Shocking Grasp NOT planned vs out-of-range enemy',
    plan3.action?.action?.name !== 'Shocking Grasp');
}

// ============================================================
// 6. Sword Burst
// ============================================================
console.log('\n=== 6. Sword Burst ===\n');
{
  // POSITIVE: 2 adjacent enemies
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [swordBurstAction()],
  });
  const e1 = makeC({ faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeC({ faction: 'enemy', pos: { x: 0, y: 1, z: 0 } });
  const bf = makeBF([caster, e1, e2]);
  const plan = planTurn(caster, bf);
  eq('6a. Sword Burst planned with 2+ adjacent enemies', plan.action?.type, 'cast');
  assert('6b. Action is Sword Burst', plan.action?.action?.name === 'Sword Burst');
  assert('6c. Description mentions AoE', plan.action?.description?.includes('AoE') === true);

  // NEGATIVE: only 1 adjacent enemy
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [swordBurstAction()],
  });
  const single = makeC({ faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf2 = makeBF([caster2, single]);
  const plan2 = planTurn(caster2, bf2);
  assert('6d. Sword Burst NOT planned with only 1 adjacent enemy',
    plan2.action?.action?.name !== 'Sword Burst');

  // NEGATIVE: no adjacent enemies
  const caster3 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [swordBurstAction()],
  });
  const farEnemy = makeC({ faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf3 = makeBF([caster3, farEnemy]);
  const plan3 = planTurn(caster3, bf3);
  assert('6e. Sword Burst NOT planned with no adjacent enemies',
    plan3.action?.action?.name !== 'Sword Burst');
}

// ============================================================
// 7. Thunderclap
// ============================================================
console.log('\n=== 7. Thunderclap ===\n');
{
  // POSITIVE: 2 adjacent enemies
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [thunderclapAction()],
  });
  const e1 = makeC({ faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeC({ faction: 'enemy', pos: { x: 0, y: 1, z: 0 } });
  const bf = makeBF([caster, e1, e2]);
  const plan = planTurn(caster, bf);
  eq('7a. Thunderclap planned with 2+ adjacent enemies', plan.action?.type, 'cast');
  assert('7b. Action is Thunderclap', plan.action?.action?.name === 'Thunderclap');
  assert('7c. Description mentions AoE', plan.action?.description?.includes('AoE') === true);

  // NEGATIVE: only 1 adjacent enemy
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [thunderclapAction()],
  });
  const single = makeC({ faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const bf2 = makeBF([caster2, single]);
  const plan2 = planTurn(caster2, bf2);
  assert('7d. Thunderclap NOT planned with only 1 adjacent enemy',
    plan2.action?.action?.name !== 'Thunderclap');
}

// ============================================================
// 8. True Strike
// ============================================================
console.log('\n=== 8. True Strike ===\n');
{
  // POSITIVE: caster has True Strike + an attack action (setup turn)
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [trueStrikeAction(), rangedWeaponAction()],
  });
  const enemy = makeC({
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 }, // far away, out of range
  });
  const bf = makeBF([caster, enemy]);
  const plan = planTurn(caster, bf);
  eq('8a. True Strike planned as setup when has attack action', plan.action?.type, 'cast');
  assert('8b. Action is True Strike', plan.action?.action?.name === 'True Strike');
  eq('8c. Target is self', plan.targetId, caster.id);

  // NEGATIVE: caster has True Strike but no attack action to benefit
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [trueStrikeAction()],
  });
  const enemy2 = makeC({
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
  });
  const bf2 = makeBF([caster2, enemy2]);
  const plan2 = planTurn(caster2, bf2);
  assert('8d. True Strike NOT planned without attack action to benefit',
    plan2.action?.action?.name !== 'True Strike');
}

// ============================================================
// 9. Toll the Dead
// ============================================================
console.log('\n=== 9. Toll the Dead ===\n');
{
  // POSITIVE: damaged enemy (d12 damage die)
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [tollTheDeadAction()],
  });
  const damaged = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 15,
    maxHP: 30, // damaged — should trigger d12 preference
  });
  const bf = makeBF([caster, damaged]);
  const plan = planTurn(caster, bf);
  eq('9a. Toll the Dead planned vs damaged enemy', plan.action?.type, 'cast');
  assert('9b. Action is Toll the Dead', plan.action?.action?.name === 'Toll the Dead');
  assert('9c. Description mentions d12/damaged', plan.action?.description?.includes('d12') === true);

  // NEGATIVE: enemy at full HP (Toll the Dead planner only fires for damaged targets)
  const caster2 = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [tollTheDeadAction()],
  });
  const fullHP = makeC({
    faction: 'enemy',
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 30,
    maxHP: 30, // full HP — planner branch won't fire
  });
  const bf2 = makeBF([caster2, fullHP]);
  const plan2 = planTurn(caster2, bf2);
  assert('9d. Toll the Dead planner NOT fired vs full-HP enemy (falls through to selectAction)',
    plan2.action?.action?.name !== 'Toll the Dead' ||
    !plan2.action?.description?.includes('d12'));
}

// ============================================================
// 10. Cantrip planner branches don't interfere with each other
// ============================================================
console.log('\n=== 10. Multiple cantrips on same caster ===\n');
{
  // Caster with both Sword Burst and Thunderclap — should pick Sword Burst
  // (appears first in the planner section 13F before 13G)
  const caster = makeC({
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [swordBurstAction(), thunderclapAction()],
  });
  const e1 = makeC({ faction: 'enemy', pos: { x: 1, y: 0, z: 0 } });
  const e2 = makeC({ faction: 'enemy', pos: { x: 0, y: 1, z: 0 } });
  const bf = makeBF([caster, e1, e2]);
  const plan = planTurn(caster, bf);
  assert('10a. First cantrip (Sword Burst) wins when both available',
    plan.action?.action?.name === 'Sword Burst');
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
