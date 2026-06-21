// ============================================================
// Test: Eldritch Blast Cantrip
// PHB p.237 — Level 0 evocation cantrip (ranged spell attack, 1d10 force)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17)
//   3. metadata exposes multi-beam scaling info (scalesByBeamCount etc.)
//   4. metadata exposes components (V + S)
//   5. damage type is `force` (new to cantrip roster)
//   6. no CANTRIP_EFFECTS entry (no post-hit rider)
//   7. no CANTRIP_SELF_EFFECTS / CANTRIP_AOE_EFFECTS entries
//   8. dispatcher safety — unknown cantrip name is a no-op
//   9. Action built from metadata has correct spell-attack shape
//  10. resolveAttack integration — hit deals force damage
//  11. resolveAttack integration — miss deals no damage
//  12. Eldritch Blast respects Total Cover (no bypassesCover flag)
//  13. v1 simplification: multi-beam NOT yet implemented (documented)
//
// Run: npx ts-node src/test/eldritch_blast.test.ts
// ============================================================

import { metadata } from '../spells/eldritch_blast';
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
  const width = 20, height = 20, depth = 1;
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

// An Eldritch Blast Action as the AI/parser would build it from metadata.
// Ranged spell attack: attackType='spell', hitBonus = caster's spell attack mod.
// Damage 1d10 force. Range 120 ft. v1 = SINGLE beam (multi-beam is TODO).
const ELDRITCH_BLAST_ACTION: Action = {
  name: 'Eldritch Blast',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 8, // +8 spell attack (high enough to hit AC 14 reliably)
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'force',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Eldritch Blast',
};

// A guaranteed-miss variant: hitBonus = -100 → never hits AC 14.
const ELDRITCH_BLAST_MISS: Action = { ...ELDRITCH_BLAST_ACTION, hitBonus: -100 };

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Eldritch Blast');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'evocation');
  eq('1d. rangeFt (120)', metadata.rangeFt, 120);
  eq('1e. damageDice', metadata.damageDice, '1d10');
  eq('1f. damageType = force', metadata.damageType, 'force');
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
  // Per-beam damage is CONSTANT 1d10 (scales by beam count, not die size).
  eq('2f. scalingDice[0] = 1d10 (per-beam constant)', metadata.scalingDice[0], '1d10');
  eq('2g. scalingDice[1] = 1d10', metadata.scalingDice[1], '1d10');
  eq('2h. scalingDice[2] = 1d10', metadata.scalingDice[2], '1d10');
}

// ============================================================
// 3. multi-beam scaling metadata (Eldritch Blast-specific)
// ============================================================
console.log('\n--- 3. multi-beam scaling metadata ---');
{
  eq('3a. scalesByBeamCount = true', metadata.scalesByBeamCount, true);
  eq('3b. beamCountByLevel[5] = 2', metadata.beamCountByLevel[5], 2);
  eq('3c. beamCountByLevel[11] = 3', metadata.beamCountByLevel[11], 3);
  eq('3d. beamCountByLevel[17] = 4', metadata.beamCountByLevel[17], 4);
  // v1: multi-beam is NOT yet implemented.
  eq('3e. multiBeamV1Implemented = false', metadata.multiBeamV1Implemented, false);
}

// ============================================================
// 4. components: V + S (no M) — PHB p.237
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. verbal component', metadata.components.v, true);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. no material component', metadata.components.m, false);
}

// ============================================================
// 5. damage type is `force` (new to cantrip roster — no prior cantrip deals force)
// ============================================================
console.log('\n--- 5. force damage type ---');
{
  eq('5a. damageType = force', metadata.damageType, 'force');
  // Confirm `force` is a valid DamageType by checking it's one of the known types.
  const knownTypes = ['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'];
  assert('5b. force is a valid DamageType', knownTypes.includes(metadata.damageType));
}

// ============================================================
// 6. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 6. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('warlock');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Dispatching 'Eldritch Blast' should be a no-op (no rider registered).
  dispatchCantrip(caster, target, 'Eldritch Blast', state);

  // No scratch fields set on target, no log events from the dispatcher.
  eq('6a. no flag set on target', target._viciousMockeryDisadvNextAttack, undefined);
  eq('6b. no log events from dispatcher', state.log.events.length, 0);
}

// ============================================================
// 7. no CANTRIP_SELF_EFFECTS / CANTRIP_AOE_EFFECTS entries
// ============================================================
console.log('\n--- 7. not a self-buff / not an AoE cantrip ---');
{
  const caster = makeCombatant('warlock');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  // resolveCantripAction returns false (Eldritch Blast is NOT a self-buff).
  eq('7a. resolveCantripAction returns false', resolveCantripAction(caster, 'Eldritch Blast', state), false);
  // resolveCantripAoE returns false (Eldritch Blast is NOT a caster-centered AoE).
  eq('7b. resolveCantripAoE returns false', resolveCantripAoE(caster, 'Eldritch Blast', state), false);
  // No log events emitted (both routers fell through without firing).
  eq('7c. no log events', state.log.events.length, 0);
}

// ============================================================
// 8. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 8. dispatcher safety ---');
{
  const caster = makeCombatant('warlock');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('8a. unknown cantrip → no log events', state.log.events.length, 0);
}

// ============================================================
// 9. Action built from metadata has correct spell-attack shape
// ============================================================
console.log('\n--- 9. Action shape ---');
{
  eq('9a. attackType = spell', ELDRITCH_BLAST_ACTION.attackType, 'spell');
  eq('9b. range.normal = 120', ELDRITCH_BLAST_ACTION.range?.normal, 120);
  eq('9c. damage.sides = 10', ELDRITCH_BLAST_ACTION.damage?.sides, 10);
  eq('9d. damage.count = 1 (v1 single beam)', ELDRITCH_BLAST_ACTION.damage?.count, 1);
  eq('9e. damageType = force', ELDRITCH_BLAST_ACTION.damageType, 'force');
  eq('9f. slotLevel = 0 (cantrip)', ELDRITCH_BLAST_ACTION.slotLevel, 0);
  eq('9g. saveDC = null (attack roll, not save)', ELDRITCH_BLAST_ACTION.saveDC, null);
}

// ============================================================
// 10. resolveAttack integration — hit deals force damage
// ============================================================
console.log('\n--- 10. resolveAttack hit → force damage ---');
{
  const caster = makeCombatant('warlock', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft away — within 120 ft range
    ac: 10,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  // Force a hit via isCritOverride=true (deterministic — avoids the 5%
  // nat-1 auto-miss flakiness). Crit doubles the force dice: 1d10 → 2d10 = 2..20.
  resolveAttack(caster, target, ELDRITCH_BLAST_ACTION, state, true /* force crit/hit */);

  const hitEvent = state.log.events.find((e: CombatEvent) => e.type === 'attack_hit' || e.type === 'attack_crit');
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('10a. attack_hit/crit logged', hitEvent !== undefined);
  assert('10b. damage logged', damageEvent !== undefined);
  assert('10c. damage event mentions force', damageEvent?.description.includes('force') === true,
    `got: ${damageEvent?.description}`);
  assert('10d. target HP reduced', target.currentHP < 100,
    `currentHP = ${target.currentHP}`);
  // 2d10 crit damage range: 2–20
  const dmgDealt = 100 - target.currentHP;
  assert('10e. damage in 2–20 range (2d10 crit)', dmgDealt >= 2 && dmgDealt <= 20, `dmgDealt = ${dmgDealt}`);
}

// ============================================================
// 11. resolveAttack integration — miss deals no damage
// ============================================================
console.log('\n--- 11. resolveAttack miss → no damage ---');
{
  const caster = makeCombatant('warlock', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 2, y: 0, z: 0 },
    ac: 30, // very high AC so +8 hitBonus misses
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, ELDRITCH_BLAST_MISS, state, false /* force miss — avoids nat-20 auto-hit flakiness */);

  const missEvent = state.log.events.find((e: CombatEvent) => e.type === 'attack_miss');
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('11a. attack_miss logged', missEvent !== undefined);
  assert('11b. NO damage logged', damageEvent === undefined, `unexpected: ${damageEvent?.description}`);
  eq('11c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// 12. Eldritch Blast respects Total Cover (no bypassesCover flag)
// ============================================================
console.log('\n--- 12. Eldritch Blast respects Total Cover ---');
{
  // Wall between caster (0,0) and target (12,0): x=[6,7], y=[-1,18]
  const totalWall: Obstacle = {
    id: 'W1', x: 6, y: -1, z: 0, width: 1, depth: 20, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('warlock', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 12, y: 0, z: 0 },
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, ELDRITCH_BLAST_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find((e: CombatEvent) => e.type === 'damage');
  assert('12a. Total Cover event logged', coverBlock !== undefined);
  assert('12b. no damage dealt (blocked by Total Cover)', damageEvent === undefined);
  eq('12c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// 13. v1 simplification: multi-beam NOT yet implemented
// ============================================================
console.log('\n--- 13. v1 multi-beam simplification ---');
{
  // The v1 Action has damage.count = 1 (single beam). At 5th+ level this is
  // a known simplification — the AI planner should emit multiple `cast`
  // PlannedActions (one per beam) in a future batch. For now, the engine
  // resolves a single 1d10 force attack.
  eq('13a. v1 single beam (damage.count = 1)', ELDRITCH_BLAST_ACTION.damage?.count, 1);
  eq('13b. metadata.multiBeamV1Implemented = false', metadata.multiBeamV1Implemented, false);
  eq('13c. metadata.scalesByBeamCount = true (signals future work)', metadata.scalesByBeamCount, true);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
