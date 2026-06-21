// ============================================================
// shield.test.ts — Simple version focusing on core mechanics
// ============================================================

import { shouldCast, execute, cleanup } from '../spells/shield';
import { Combatant, Action, PlayerResources, Vec3, Cell } from '../types/core';

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

const SHIELD_ACTION: Action = {
  name: 'Shield',
  isMultiattack: false,
  attackType: null,
  reach: 0,
  range: null,
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'reaction',
  legendaryCost: 0,
  description: 'Shield',
};

function makeBF(combatants: Combatant[]) {
  const width = 10;
  const height = 10;
  const depth = 1;
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

// ============================================================
// 1. shouldCast — precondition gates
// ============================================================

console.log('\n--- 1. shouldCast gates ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  eq('1a. Has Shield action + slot + reaction', shouldCast(caster, bf), true);
}

{
  const caster = makeCombatant('caster', {
    actions: [],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  eq('1b. No Shield action → false', shouldCast(caster, bf), false);
}

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(0),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  eq('1c. No spell slot → false', shouldCast(caster, bf), false);
}

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: true, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  eq('1d. Reaction used → false', shouldCast(caster, bf), false);
}

// ============================================================
// 2. execute — slot consumption, reaction mark, AC bonus
// ============================================================

console.log('\n--- 2. execute mechanics ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(2),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const slots = caster.resources?.spellSlots?.[1];
  eq('2a. Slot consumed', slots?.remaining, 1);
}

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  eq('2b. Reaction marked as used', caster.budget.reactionUsed, true);
}

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const shieldEffect = caster.activeEffects.find(e => e.spellName === 'Shield');
  assert('2c. Shield effect applied', shieldEffect !== undefined);
  eq('2c. Shield effect acBonus = 5', shieldEffect?.payload.acBonus, 5);
}

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);

  const logEvent = state.log.events.find((e: any) => e.type === 'action' && e.description.includes('Shield'));
  assert('2d. Shield action logged', logEvent !== undefined);
}

// ============================================================
// 3. cleanup — expiration at next turn
// ============================================================

console.log('\n--- 3. cleanup (expiration) ---');

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  execute(caster, state);
  eq('3a. Shield effect exists after cast', caster.activeEffects.filter((e: any) => e.spellName === 'Shield').length, 1);

  cleanup(caster);
  eq('3a. Shield effect removed after cleanup', caster.activeEffects.filter((e: any) => e.spellName === 'Shield').length, 0);
}

{
  const caster = makeCombatant('caster', {
    actions: [SHIELD_ACTION],
    resources: withSlots(1),
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
  });
  cleanup(caster);
  eq('3b. cleanup without Shield effect is safe', caster.activeEffects.length, 0);
}

// ============================================================
// Results ----------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
