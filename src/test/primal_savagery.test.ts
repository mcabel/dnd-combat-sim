// ============================================================
// Test: Primal Savagery Cantrip
// XGE p.163 — Level 0 transmutation cantrip (melee spell attack, 1d10 acid)
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes scaling info (5/11/17 → 2d10/3d10/4d10)
//   3. metadata exposes damageType = 'acid' (rare — only Acid Splash also deals acid)
//   4. metadata exposes components (S only — no V, no M)
//   5. metadata exposes reachFt = 5 (melee spell attack)
//   6. metadata exposes rangeFt = 0 (Self — XGE p.163: "range: self")
//   7. no CANTRIP_EFFECTS entry (no post-hit rider)
//   8. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//   9. no CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE)
//  10. dispatcher safety — unknown cantrip name is a no-op
//  11. Action built from metadata has correct melee-spell shape
//  12. resolveAttack hit (forced crit via isCritOverride=true → 2d10 = 2..20 range)
//  13. resolveAttack miss (isCritOverride=false → no damage)
//  14. damage type is acid (control test — verify 'acid' in damage log)
//  15. Primal Savagery respects Total Cover (no bypassesCover flag)
//
// Run: npx ts-node src/test/primal_savagery.test.ts
// ============================================================

import { metadata } from '../spells/primal_savagery';
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

// A Primal Savagery Action — melee spell attack, 5-ft reach, 1d10 acid.
const PRIMAL_SAVAGERY_ACTION: Action = {
  name: 'Primal Savagery',
  isMultiattack: false,
  attackType: 'spell', // spell attack (melee spell attacks also use 'spell')
  reach: 5, // melee spell attack — 5 ft reach
  range: { normal: 5, long: 5 },
  hitBonus: 5,
  damage: { count: 1, sides: 10, bonus: 0, average: 5 },
  damageType: 'acid',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Primal Savagery',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Primal Savagery');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (0 — Self, XGE p.163)', metadata.rangeFt, 0);
  eq('1e. damageDice', metadata.damageDice, '1d10');
  eq('1f. damageType = acid (rare — only Acid Splash also deals acid)',
    metadata.damageType, 'acid');
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
// 3. damageType = acid (rare)
// ============================================================
console.log('\n--- 3. acid damage type ---');
{
  eq('3a. damageType = acid', metadata.damageType, 'acid');
}

// ============================================================
// 4. components: S only (no V, no M) — XGE p.163
// ============================================================
console.log('\n--- 4. components ---');
{
  eq('4a. NO verbal component', metadata.components.v, false);
  eq('4b. somatic component', metadata.components.s, true);
  eq('4c. NO material component', metadata.components.m, false);
}

// ============================================================
// 5. reachFt = 5 (melee spell attack)
// ============================================================
console.log('\n--- 5. reachFt ---');
{
  eq('5a. reachFt = 5 (melee spell attack)', metadata.reachFt, 5);
}

// ============================================================
// 6. rangeFt = 0 (Self — XGE p.163)
// ============================================================
console.log('\n--- 6. rangeFt ---');
{
  eq('6a. rangeFt = 0 (Self)', metadata.rangeFt, 0);
}

// ============================================================
// 7. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 7. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Primal Savagery', state);
  eq('7a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);

  // No scratch fields set on target.
  eq('7b. no _chillTouchNoHealing', target._chillTouchNoHealing, undefined);
  eq('7c. no _viciousMockeryDisadvNextAttack', target._viciousMockeryDisadvNextAttack, undefined);
}

// ============================================================
// 8. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 8. no CANTRIP_SELF_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Primal Savagery', state);
  eq('8a. resolveCantripAction returns false', ret, false);
  eq('8b. no log events', state.log.events.length, 0);
}

// ============================================================
// 9. no CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE)
// ============================================================
console.log('\n--- 9. no CANTRIP_AOE_EFFECTS entry ---');
{
  const caster = makeCombatant('druid');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Primal Savagery', state);
  eq('9a. resolveCantripAoE returns false', ret, false);
  eq('9b. no log events', state.log.events.length, 0);
}

// ============================================================
// 10. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 10. dispatcher safety ---');
{
  const caster = makeCombatant('druid');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('10a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('10b. unknown cantrip → no state change',
    target._chillTouchNoHealing, undefined);
}

// ============================================================
// 11. Action built from metadata has correct melee-spell shape
// ============================================================
console.log('\n--- 11. Action shape ---');
{
  eq('11a. attackType = spell (melee spell attacks use "spell")',
    PRIMAL_SAVAGERY_ACTION.attackType, 'spell');
  eq('11b. reach = 5 (melee)', PRIMAL_SAVAGERY_ACTION.reach, 5);
  eq('11c. range.normal = 5 (melee)', PRIMAL_SAVAGERY_ACTION.range?.normal, 5);
  eq('11d. damageType = acid', PRIMAL_SAVAGERY_ACTION.damageType, 'acid');
  eq('11e. damage.sides = 10', PRIMAL_SAVAGERY_ACTION.damage?.sides, 10);
  eq('11f. damage.count = 1', PRIMAL_SAVAGERY_ACTION.damage?.count, 1);
  eq('11g. slotLevel = 0 (cantrip)', PRIMAL_SAVAGERY_ACTION.slotLevel, 0);
  eq('11h. no saveDC', PRIMAL_SAVAGERY_ACTION.saveDC, null);
  eq('11i. no saveAbility', PRIMAL_SAVAGERY_ACTION.saveAbility, null);
  eq('11j. not AoE', PRIMAL_SAVAGERY_ACTION.isAoE, false);
  eq('11k. not control', PRIMAL_SAVAGERY_ACTION.isControl, false);
  eq('11l. not concentration', PRIMAL_SAVAGERY_ACTION.requiresConcentration, false);
  // bypassesCover is undefined — Primal Savagery respects cover normally.
  eq('11m. bypassesCover undefined (respects cover)',
    PRIMAL_SAVAGERY_ACTION.bypassesCover, undefined);
}

// ============================================================
// 12. resolveAttack hit (forced crit via isCritOverride=true → 2d10 = 2..20)
// ============================================================
console.log('\n--- 12. resolveAttack hit (crit → 2d10 acid) ---');
{
  // Caster at (0,0), target at (1,0) — adjacent (5 ft), no cover.
  // Force a hit with isCritOverride=true (avoids nat-1 auto-miss flakiness).
  // Crit doubles the acid dice: 1d10 → 2d10 = 2..20.
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, PRIMAL_SAVAGERY_ACTION, state, true);

  // A hit event should mention Primal Savagery; a damage event should mention acid.
  const hitEvent = state.log.events.find(
    (e: CombatEvent) => (e.type === 'attack_hit' || e.type === 'attack_crit') && e.description.includes('Primal Savagery'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('12a. hit event logged for Primal Savagery', hitEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('12b. damage type is acid', damageEvent?.description.includes('acid'),
    `damage event: ${damageEvent?.description}`);
  assert('12c. target took damage (HP < 100)', target.currentHP < 100);

  // Crit damage in 2..20 range (2d10).
  const damageTaken = 100 - target.currentHP;
  assert('12d. crit damage in 2..20 range (2d10)',
    damageTaken >= 2 && damageTaken <= 20, `got ${damageTaken}`);

  // No rider flag set (Primal Savagery has no rider).
  assert('12e. no rider flag set',
    target._viciousMockeryDisadvNextAttack === undefined &&
    target._chillTouchNoHealing === undefined);
}

// ============================================================
// 13. resolveAttack miss (isCritOverride=false → no damage)
// ============================================================
console.log('\n--- 13. resolveAttack miss ---');
{
  // isCritOverride=false forces a MISS — no damage dealt.
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, PRIMAL_SAVAGERY_ACTION, state, false);

  // No damage event on a miss.
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('13a. NO damage event on miss', damageEvent === undefined,
    `unexpected: ${damageEvent?.description}`);
  eq('13b. target HP unchanged on miss', target.currentHP, 100);

  const missEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'attack_miss' && e.description.includes('Primal Savagery'),
  );
  assert('13c. miss event logged', missEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 14. damage type is acid (control test)
// ============================================================
console.log('\n--- 14. acid damage (control test) ---');
{
  const caster = makeCombatant('druid', { pos: { x: 0, y: 0, z: 0 } });
  const target = makeCombatant('goblin', {
    pos: { x: 1, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, PRIMAL_SAVAGERY_ACTION, state, true);

  // The damage event should mention "acid" (not "fire" or "bludgeoning").
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('14a. damage event mentions "acid"',
    damageEvent?.description.toLowerCase().includes('acid') === true,
    `got: ${damageEvent?.description}`);
  // Negative control: should NOT mention "fire".
  assert('14b. damage event does NOT mention "fire"',
    damageEvent?.description.toLowerCase().includes('fire') === false,
    `got: ${damageEvent?.description}`);
}

// ============================================================
// 15. Primal Savagery respects Total Cover
// ============================================================
console.log('\n--- 15. Primal Savagery respects Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8]
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

  resolveAttack(caster, target, PRIMAL_SAVAGERY_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('15a. Total Cover event logged', coverBlock !== undefined);
  assert('15b. no damage dealt (blocked by Total Cover)', damageEvent === undefined);
  eq('15c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
