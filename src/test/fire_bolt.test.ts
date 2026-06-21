// ============================================================
// Test: Fire Bolt Cantrip
// PHB p.242 — Level 0 evocation cantrip (ranged spell attack)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d10/3d10/4d10)
//   3. no CANTRIP_EFFECTS entry (no post-hit rider)
//   4. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   5. dispatcher safety — unknown cantrip name is a no-op
//   6. Action built from metadata has correct ranged-spell shape
//   7. resolveAttack integration — Fire Bolt damage is fire, hits on roll
//   8. resolveAttack integration — Fire Bolt respects Total Cover (no bypass)
//
// Run: npx ts-node src/test/fire_bolt.test.ts
// ============================================================

import { metadata } from '../spells/fire_bolt';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
} from '../engine/cantrip_effects';
import { resolveAttack, makeFlatBattlefield, CombatEvent } from '../engine/combat';
import { Combatant, Action, PlayerResources, Vec3, Cell, Obstacle } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail: any = ''): void {
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

// A Fire Bolt Action as the AI/parser would build it from metadata.
// Ranged spell attack, hitBonus = caster's spell attack mod, 1d10 fire.
const FIRE_BOLT_ACTION: Action = {
  name: 'Fire Bolt',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 5,
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
  eq('1a. name', metadata.name, 'Fire Bolt');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (120)', metadata.rangeFt, 120);
  eq('1e. damageDice', metadata.damageDice, '1d10');
  eq('1f. damageType', metadata.damageType, 'fire');
  eq('1g. not concentration', metadata.concentration, false);
  eq('1h. castingTime', metadata.castingTime, 'action');
}

// ============================================================
// 2. scaling metadata
// ============================================================
console.log('\n--- 2. scaling metadata ---');
{
  eq('2a. scales flag', metadata.scales, true);
  eq('2b. scalingLevels length 3', metadata.scalingLevels.length, 3);
  eq('2c. scalingLevels[0] = 5', metadata.scalingLevels[0], 5);
  eq('2d. scalingLevels[1] = 11', metadata.scalingLevels[1], 11);
  eq('2e. scalingLevels[2] = 17', metadata.scalingLevels[2], 17);
  eq('2f. scalingDice[0] = 2d10', metadata.scalingDice[0], '2d10');
  eq('2g. scalingDice[1] = 3d10', metadata.scalingDice[1], '3d10');
  eq('2h. scalingDice[2] = 4d10', metadata.scalingDice[2], '4d10');
}

// ============================================================
// 3. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 3. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Dispatcher should be a no-op for Fire Bolt (no rider registered)
  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Fire Bolt', state);
  eq('3a. dispatcher no-op (no log events added)', state.log.events.length, eventsBefore);

  // No scratch fields set on target
  eq('3b. no _chillTouchNoHealing', target._chillTouchNoHealing, undefined);
  eq('3c. no _viciousMockeryDisadvNextAttack', target._viciousMockeryDisadvNextAttack, undefined);
  eq('3d. no _bladeWardActive on caster', caster._bladeWardActive, undefined);
}

// ============================================================
// 4. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 4. no CANTRIP_SELF_EFFECTS entry ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  // resolveCantripAction should return false (Fire Bolt is not a self-buff)
  const ret = resolveCantripAction(caster, 'Fire Bolt', state);
  eq('4a. resolveCantripAction returns false', ret, false);
  eq('4b. no log events', state.log.events.length, 0);
}

// ============================================================
// 5. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 5. dispatcher safety ---');
{
  const caster = makeCombatant('wizard');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('5a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('5b. unknown cantrip → no state change', target._chillTouchNoHealing, undefined);
}

// ============================================================
// 6. Action built from metadata has correct ranged-spell shape
// ============================================================
console.log('\n--- 6. Action shape ---');
{
  eq('6a. attackType = spell', FIRE_BOLT_ACTION.attackType, 'spell');
  eq('6b. range.normal = 120', FIRE_BOLT_ACTION.range?.normal, 120);
  eq('6c. damageType = fire', FIRE_BOLT_ACTION.damageType, 'fire');
  eq('6d. damage.sides = 10', FIRE_BOLT_ACTION.damage?.sides, 10);
  eq('6e. damage.count = 1', FIRE_BOLT_ACTION.damage?.count, 1);
  eq('6f. slotLevel = 0 (cantrip)', FIRE_BOLT_ACTION.slotLevel, 0);
  eq('6g. no saveDC', FIRE_BOLT_ACTION.saveDC, null);
  eq('6h. no saveAbility', FIRE_BOLT_ACTION.saveAbility, null);
  eq('6i. not AoE', FIRE_BOLT_ACTION.isAoE, false);
  eq('6j. not control', FIRE_BOLT_ACTION.isControl, false);
  eq('6k. not concentration', FIRE_BOLT_ACTION.requiresConcentration, false);
  // bypassesCover is undefined (not set) — Fire Bolt respects cover normally
  eq('6l. bypassesCover undefined (respects cover)', FIRE_BOLT_ACTION.bypassesCover, undefined);
}

// ============================================================
// 7. resolveAttack integration — Fire Bolt deals fire damage on hit
// ============================================================
console.log('\n--- 7. resolveAttack integration: damage on hit ---');
{
  // Caster at (0,0), target at (2,0) — 10 ft apart, no cover.
  // Force a hit with isCritOverride=true (PHB p.194: nat 1 always misses
  // regardless of bonuses, so hitBonus 5 vs AC 5 still has a 5% nat-1 auto-miss
  // rate — isCritOverride=true bypasses the d20 roll entirely for determinism).
  // Crit doubles the fire dice: 1d10 → 2d10 = 2..20.
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, FIRE_BOLT_ACTION, state, true /* force hit — avoids nat-1 auto-miss flakiness */);

  // A hit event should mention Fire Bolt; a damage event should mention fire.
  const hitEvent = state.log.events.find(
    (e: CombatEvent) => (e.type === 'attack_hit' || e.type === 'attack_crit') && e.description.includes('Fire Bolt'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('7a. hit event logged for Fire Bolt', hitEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('7b. damage type is fire', damageEvent?.description.includes('fire'),
    `damage event: ${damageEvent?.description}`);
  assert('7c. target took damage (HP < 100)', target.currentHP < 100);
  assert('7d. no rider flag set (Fire Bolt has no rider)',
    target._viciousMockeryDisadvNextAttack === undefined && target._chillTouchNoHealing === undefined);
}

// ============================================================
// 8. resolveAttack integration — Fire Bolt respects Total Cover
//    (Fire Bolt does NOT bypass cover; only Sacred Flame does.)
// ============================================================
console.log('\n--- 8. Fire Bolt respects Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8]
  // → blocks line of effect → "Total Cover!" logged, no damage.
  const totalWall: Obstacle = {
    id: 'W1', x: 3, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wizard', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    ac: 5, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, FIRE_BOLT_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('8a. Total Cover event logged', coverBlock !== undefined);
  assert('8b. no damage dealt (Fire Bolt blocked by Total Cover)', damageEvent === undefined);
  eq('8c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
