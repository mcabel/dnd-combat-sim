// ============================================================
// Test: Shocking Grasp Cantrip
// PHB p.275 — Level 0 evocation cantrip
//
// Tests:
//   1. metadata correctness
//   2. cantripAttackAdvantage — advantage vs metal armor (true/false/undefined)
//   3. getCantripAttackAdvantage registry routing
//   4. applyCantripEffect (module) — locks reactions + logs
//   5. dispatcher integration — 'Shocking Grasp' registered in CANTRIP_EFFECTS
//   6. reaction-lock auto-expires via resetBudget (no dedicated cleanup needed)
//
// Run: npx ts-node src/test/shocking_grasp.test.ts
// ============================================================

import { metadata, cantripAttackAdvantage, applyCantripEffect } from '../spells/shocking_grasp';
import { applyCantripEffect as dispatchCantrip, getCantripAttackAdvantage } from '../engine/cantrip_effects';
import { resetBudget } from '../engine/utils';
import { Combatant, Action, PlayerResources, Vec3, Cell } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
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

function makeBF(combatants: Combatant[]) {
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

const SHOCKING_GRASP_ACTION: Action = {
  name: 'Shocking Grasp',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,            // touch
  range: null,
  hitBonus: 5,         // spell attack mod
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'lightning',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,        // cantrip
  costType: 'action',
  legendaryCost: 0,
  description: 'Shocking Grasp',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Shocking Grasp');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (touch=5)', metadata.rangeFt, 5);
  eq('1e. damageDice', metadata.damageDice, '1d8');
  eq('1f. damageType', metadata.damageType, 'lightning');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. cantripAttackAdvantage — metal armor gating
// ============================================================
console.log('\n--- 2. cantripAttackAdvantage (metal armor) ---');
{
  const caster = makeCombatant('caster');
  const metalTarget = makeCombatant('knight', { hasMetalArmor: true });
  const leatherTarget = makeCombatant('rogue', { hasMetalArmor: false });
  const unknownTarget = makeCombatant('beast'); // hasMetalArmor undefined

  eq('2a. metal armor → advantage', cantripAttackAdvantage(caster, metalTarget), true);
  eq('2b. non-metal armor → no advantage', cantripAttackAdvantage(caster, leatherTarget), false);
  eq('2c. undefined armor → no advantage', cantripAttackAdvantage(caster, unknownTarget), false);
}

// ============================================================
// 3. getCantripAttackAdvantage — registry routing
// ============================================================
console.log('\n--- 3. getCantripAttackAdvantage (registry) ---');
{
  const caster = makeCombatant('caster');
  const metalTarget = makeCombatant('knight', { hasMetalArmor: true });
  const leatherTarget = makeCombatant('rogue', { hasMetalArmor: false });

  eq('3a. Shocking Grasp + metal → true', getCantripAttackAdvantage(caster, metalTarget, 'Shocking Grasp'), true);
  eq('3b. Shocking Grasp + non-metal → false', getCantripAttackAdvantage(caster, leatherTarget, 'Shocking Grasp'), false);
  eq('3c. Unknown cantrip name → false', getCantripAttackAdvantage(caster, metalTarget, 'Eldritch Blast'), false);
  eq('3d. Ray of Frost (not in adv registry) → false', getCantripAttackAdvantage(caster, metalTarget, 'Ray of Frost'), false);
}

// ============================================================
// 4. applyCantripEffect (module) — reaction lock + log
// ============================================================
console.log('\n--- 4. applyCantripEffect (module) ---');
{
  const caster = makeCombatant('caster', { actions: [SHOCKING_GRASP_ACTION], resources: withSlots(1) });
  const target = makeCombatant('goblin', { budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false } });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = applyCantripEffect(caster, target, state);
  eq('4a. returns true', ret, true);
  eq('4b. target reactionUsed locked', target.budget.reactionUsed, true);

  const lockLog = state.log.events.find(
    (e: any) => e.type === 'action' && e.description.includes('Shocking Grasp') && e.description.includes('reactions'),
  );
  assert('4c. reaction-lock logged', lockLog !== undefined, 'expected a log event mentioning Shocking Grasp + reactions');
}
{
  // Idempotent: if target already used its reaction, locking again is a harmless no-op
  const caster = makeCombatant('caster');
  const target = makeCombatant('goblin', { budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: true, freeObjectUsed: false } });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const ret = applyCantripEffect(caster, target, state);
  eq('4d. already-locked still returns true', ret, true);
  eq('4e. reactionUsed stays true', target.budget.reactionUsed, true);
}

// ============================================================
// 5. dispatcher integration — 'Shocking Grasp' registered in CANTRIP_EFFECTS
// ============================================================
console.log('\n--- 5. dispatcher integration ---');
{
  const caster = makeCombatant('wizard', { actions: [SHOCKING_GRASP_ACTION], resources: withSlots(1) });
  const target = makeCombatant('goblin', { budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false } });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Route through the central dispatcher (same path resolveAttack uses)
  dispatchCantrip(caster, target, 'Shocking Grasp', state);

  eq('5a. dispatcher locked target reactions', target.budget.reactionUsed, true);
  const logHit = state.log.events.find((e: any) => e.description.includes('Shocking Grasp'));
  assert('5b. dispatcher emitted Shocking Grasp log', logHit !== undefined);
}
{
  // Unknown cantrip name → dispatcher is a no-op (no throw, no state change)
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('5c. unknown cantrip → no reaction lock', target.budget.reactionUsed, false);
  eq('5d. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 6. reaction-lock auto-expires via resetBudget (no dedicated cleanup)
// ============================================================
console.log('\n--- 6. resetBudget auto-expiry ---');
{
  const caster = makeCombatant('caster');
  const target = makeCombatant('goblin', { budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false } });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  applyCantripEffect(caster, target, state);
  eq('6a. locked after hit', target.budget.reactionUsed, true);

  // Start of target's next turn — resetBudget restores the reaction budget
  resetBudget(target);
  eq('6b. reaction restored after resetBudget', target.budget.reactionUsed, false);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
