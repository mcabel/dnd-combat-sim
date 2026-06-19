// ============================================================
// Test: Produce Flame Cantrip
// PHB p.269 — Level 0 conjuration cantrip (ranged spell attack, fire)
//
// v1 simplification: THROW-ONLY (Mode 2 — ranged spell attack).
// The CREATE mode (Mode 1 — utility light source) is NOT
// implemented. Documented via metadata flag
// `produceFlameCreateModeV1Implemented: false`.
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d8/3d8/4d8)
//   3. metadata exposes components (V + S — no M)
//   4. v1 simplification flag: produceFlameCreateModeV1Implemented = false
//   5. no CANTRIP_EFFECTS entry (no post-hit rider)
//   6. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   7. no CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE)
//   8. dispatcher safety — unknown cantrip name is a no-op
//   9. Action built from metadata has correct ranged-spell shape
//  10. resolveAttack integration — Produce Flame damage is fire, hits on roll
//  11. resolveAttack integration — Produce Flame respects Total Cover
//  12. resolveAttack miss — no damage on miss (no auto-hit)
//
// Run: npx ts-node src/test/produce_flame.test.ts
// ============================================================

import { metadata } from '../spells/produce_flame';
import {
  applyCantripEffect as dispatchCantrip,
  resolveCantripAction,
  resolveCantripAoE,
} from '../engine/cantrip_effects';
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

// A Produce Flame Action as the AI/parser would build it from metadata.
// Ranged spell attack (THROW mode), hitBonus = caster's spell attack mod, 1d8 fire.
// Range 30 ft (PHB p.269: "hurl the flame at a creature within 30 feet of you").
const PRODUCE_FLAME_ACTION: Action = {
  name: 'Produce Flame',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 30, long: 30 },
  hitBonus: 5,
  damage: { count: 1, sides: 8, bonus: 0, average: 4 },
  damageType: 'fire',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Produce Flame',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Produce Flame');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'conjuration');
  eq('1d. rangeFt (30 — throw range)', metadata.rangeFt, 30);
  eq('1e. damageDice', metadata.damageDice, '1d8');
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
  eq('2f. scalingDice[0] = 2d8', metadata.scalingDice[0], '2d8');
  eq('2g. scalingDice[1] = 3d8', metadata.scalingDice[1], '3d8');
  eq('2h. scalingDice[2] = 4d8', metadata.scalingDice[2], '4d8');
}

// ============================================================
// 3. components: V + S (no M) — PHB p.269
// ============================================================
console.log('\n--- 3. components ---');
{
  eq('3a. verbal component', metadata.components.v, true);
  eq('3b. somatic component', metadata.components.s, true);
  eq('3c. no material component', metadata.components.m, false);
}

// ============================================================
// 4. v1 simplification flag: produceFlameCreateModeV1Implemented = false
// ============================================================
console.log('\n--- 4. v1 simplification flag ---');
{
  eq('4a. produceFlameCreateModeV1Implemented = false (THROW-only v1)',
    metadata.produceFlameCreateModeV1Implemented, false);
}

// ============================================================
// 5. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 5. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Produce Flame', state);
  eq('5a. dispatcher no-op (no log events added)', state.log.events.length, eventsBefore);

  // No scratch fields set on target
  eq('5b. no _chillTouchNoHealing', target._chillTouchNoHealing, undefined);
  eq('5c. no _viciousMockeryDisadvNextAttack', target._viciousMockeryDisadvNextAttack, undefined);
  eq('5d. no _bladeWardActive on caster', caster._bladeWardActive, undefined);
}

// ============================================================
// 6. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 6. no CANTRIP_SELF_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Produce Flame', state);
  eq('6a. resolveCantripAction returns false', ret, false);
  eq('6b. no log events', state.log.events.length, 0);
}

// ============================================================
// 7. no CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE)
// ============================================================
console.log('\n--- 7. no CANTRIP_AOE_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Produce Flame', state);
  eq('7a. resolveCantripAoE returns false', ret, false);
  eq('7b. no log events', state.log.events.length, 0);
}

// ============================================================
// 8. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 8. dispatcher safety ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('8a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('8b. unknown cantrip → no state change', target._chillTouchNoHealing, undefined);
}

// ============================================================
// 9. Action built from metadata has correct ranged-spell shape
// ============================================================
console.log('\n--- 9. Action shape ---');
{
  eq('9a. attackType = spell', PRODUCE_FLAME_ACTION.attackType, 'spell');
  eq('9b. range.normal = 30 (throw range)', PRODUCE_FLAME_ACTION.range?.normal, 30);
  eq('9c. damageType = fire', PRODUCE_FLAME_ACTION.damageType, 'fire');
  eq('9d. damage.sides = 8', PRODUCE_FLAME_ACTION.damage?.sides, 8);
  eq('9e. damage.count = 1', PRODUCE_FLAME_ACTION.damage?.count, 1);
  eq('9f. slotLevel = 0 (cantrip)', PRODUCE_FLAME_ACTION.slotLevel, 0);
  eq('9g. no saveDC', PRODUCE_FLAME_ACTION.saveDC, null);
  eq('9h. no saveAbility', PRODUCE_FLAME_ACTION.saveAbility, null);
  eq('9i. not AoE', PRODUCE_FLAME_ACTION.isAoE, false);
  eq('9j. not control', PRODUCE_FLAME_ACTION.isControl, false);
  eq('9k. not concentration', PRODUCE_FLAME_ACTION.requiresConcentration, false);
  // bypassesCover is undefined (not set) — Produce Flame respects cover normally
  eq('9l. bypassesCover undefined (respects cover)', PRODUCE_FLAME_ACTION.bypassesCover, undefined);
}

// ============================================================
// 10. resolveAttack integration — Produce Flame deals fire damage on hit
// ============================================================
console.log('\n--- 10. resolveAttack integration: damage on hit ---');
{
  // Caster at (0,0), target at (2,0) — 10 ft apart, no cover.
  // Force a hit with isCritOverride=true (PHB p.194: nat 1 always misses
  // regardless of bonuses, so hitBonus 5 vs AC 5 still has a 5% nat-1 auto-miss
  // rate — isCritOverride=true bypasses the d20 roll entirely for determinism).
  // Crit doubles the fire dice: 1d8 → 2d8 = 2..16.
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, PRODUCE_FLAME_ACTION, state, true /* force hit — avoids nat-1 auto-miss flakiness */);

  // A hit event should mention Produce Flame; a damage event should mention fire.
  const hitEvent = state.log.events.find(
    (e: CombatEvent) => (e.type === 'attack_hit' || e.type === 'attack_crit') && e.description.includes('Produce Flame'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('10a. hit event logged for Produce Flame', hitEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('10b. damage type is fire', damageEvent?.description.includes('fire'),
    `damage event: ${damageEvent?.description}`);
  assert('10c. target took damage (HP < 100)', target.currentHP < 100);

  // Crit doubles 1d8 → 2d8 = 2..16 range
  const damageTaken = 100 - target.currentHP;
  assert('10d. crit damage in 2..16 range (2d8)',
    damageTaken >= 2 && damageTaken <= 16, `got ${damageTaken}`);

  assert('10e. no rider flag set (Produce Flame has no rider)',
    target._viciousMockeryDisadvNextAttack === undefined && target._chillTouchNoHealing === undefined);
}

// ============================================================
// 11. resolveAttack integration — Produce Flame respects Total Cover
// ============================================================
console.log('\n--- 11. Produce Flame respects Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8]
  // → blocks line of effect → "Total Cover!" logged, no damage.
  const totalWall: Obstacle = {
    id: 'W1', x: 3, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    ac: 5, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, PRODUCE_FLAME_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('11a. Total Cover event logged', coverBlock !== undefined);
  assert('11b. no damage dealt (Produce Flame blocked by Total Cover)', damageEvent === undefined);
  eq('11c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// 12. resolveAttack miss — no damage on miss (no auto-hit)
// ============================================================
console.log('\n--- 12. resolveAttack miss → no damage ---');
{
  // Force a miss with isCritOverride=false (forces miss — see Session 7 notes).
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, PRODUCE_FLAME_ACTION, state, false /* force miss */);

  const missEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'attack_miss',
  );
  assert('12a. attack_miss logged', missEvent !== undefined);
  eq('12b. target HP unchanged (miss)', target.currentHP, 100);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
