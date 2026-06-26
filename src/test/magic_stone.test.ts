// ============================================================
// Test: Magic Stone Cantrip
// XGE p.160 — Level 0 transmutation cantrip (ranged spell attack, 1d6 + spellcastingMod bludgeoning)
//
// v1 simplifications (all documented via metadata flags):
//   - Ally-throw mode: canonically enchant 1-3 pebbles that ALLIES can throw
//     using the CASTER's spell attack mod → v1: SELF-THROW mode only.
//   - Bonus-action economy: canonically bonus-action enchant + action throw →
//     v1: single action that does both (costType='action').
//   - Persistent enchantment: canonically 1-minute duration (multiple throws) →
//     v1: each throw is a fresh cast + throw (no persistent tracking).
//
// Tests:
//   1. metadata correctness
//   2. metadata exposes damageType = 'bludgeoning' (pebbles deal bludgeoning)
//   3. metadata exposes components (V + S — no M, pebbles are target not component)
//   4. metadata exposes castingTime = 'bonusAction' (canon — XGE p.160)
//   5. metadata exposes throwRangeFt = 60 (canon — XGE p.160)
//   6. metadata exposes v1 simplification flags
//   7. metadata does NOT scale (Magic Stone is flat at all levels)
//   8. metadata exposes damageBonusField = 'spellcastingMod'
//   9. no CANTRIP_EFFECTS entry (no post-hit rider)
//  10. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
//  11. no CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE)
//  12. dispatcher safety — unknown cantrip name is a no-op
//  13. Action built from metadata has correct ranged-spell shape
//  14. resolveAttack hit (forced crit via isCritOverride=true → 2d6 + spellcastingMod)
//  15. resolveAttack miss (isCritOverride=false → no damage)
//  16. damage type is bludgeoning (control test — verify 'bludgeoning' in damage log)
//  17. Magic Stone respects Total Cover (no bypassesCover flag)
//  18. does NOT scale — verify 1d6 flat at all levels (metadata.scales = false)
//
// Run: npx ts-node src/test/magic_stone.test.ts
// ============================================================

import { metadata } from '../spells/magic_stone';
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

// A Magic Stone Action — ranged spell attack, 60 ft throw range,
// 1d6 + spellcastingMod bludgeoning. v1: costType='action' (collapsed
// enchant + throw into a single action).
const MAGIC_STONE_ACTION: Action = {
  name: 'Magic Stone',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 60, long: 60 }, // throw range (canon — XGE p.160: 60 ft)
  hitBonus: 5, // caster's spell attack mod
  // damage = 1d6 + spellcastingMod. The spellcastingMod is added as damage.bonus.
  // spellcastingMod defaults to 3 (typical level-1 caster with 16 in casting stat).
  damage: { count: 1, sides: 6, bonus: 3, average: 6 },
  damageType: 'bludgeoning',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  noCantripScaling: true,  // XGE p.160: flat 1d6+mod at all levels, no tier scaling
  costType: 'action', // v1: single action (collapsed bonus-action enchant + action throw)
  legendaryCost: 0,
  description: 'Magic Stone',
};

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Magic Stone');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'transmutation');
  eq('1d. rangeFt (0 — Touch, the pebbles are the target)', metadata.rangeFt, 0);
  eq('1e. damageDice', metadata.damageDice, '1d6');
  eq('1f. damageType = bludgeoning (pebbles deal bludgeoning)',
    metadata.damageType, 'bludgeoning');
  eq('1g. not concentration', metadata.concentration, false);
  // castingTime = 'bonusAction' is canon (XGE p.160); v1 collapses enchant+throw
  // into a single action via the Action's costType='action'. See test 4.
  eq('1h. castingTime (canon — XGE p.160)', metadata.castingTime, 'bonusAction');
}

// ============================================================
// 2. damageType = bludgeoning (pebbles deal bludgeoning)
// ============================================================
console.log('\n--- 2. bludgeoning damage type ---');
{
  eq('2a. damageType = bludgeoning', metadata.damageType, 'bludgeoning');
}

// ============================================================
// 3. components: V + S (no M — pebbles are TARGET, not component)
// ============================================================
console.log('\n--- 3. components ---');
{
  eq('3a. verbal component', metadata.components.v, true);
  eq('3b. somatic component', metadata.components.s, true);
  eq('3c. NO material component (pebbles are the target, not a component)',
    metadata.components.m, false);
}

// ============================================================
// 4. castingTime = 'bonusAction' (canon — XGE p.160)
// ============================================================
console.log('\n--- 4. castingTime (bonusAction canon) ---');
{
  eq('4a. castingTime = bonusAction (XGE p.160 — canon)',
    metadata.castingTime, 'bonusAction');
  // v1 simplification: the built Action has costType='action' (collapsed
  // enchant + throw). Documented via the v1 flag.
  eq('4b. magicStoneBonusActionEconomyV1Simplified = true',
    metadata.magicStoneBonusActionEconomyV1Simplified, true);
}

// ============================================================
// 5. throwRangeFt = 60 (canon — XGE p.160)
// ============================================================
console.log('\n--- 5. throwRangeFt ---');
{
  eq('5a. throwRangeFt = 60 (canon — XGE p.160)', metadata.throwRangeFt, 60);
}

// ============================================================
// 6. metadata exposes v1 simplification flags
// ============================================================
console.log('\n--- 6. v1 simplification flags ---');
{
  eq('6a. magicStoneAllyThrowV1Implemented = false (ally-throw TODO)',
    metadata.magicStoneAllyThrowV1Implemented, false);
  eq('6b. magicStoneBonusActionEconomyV1Simplified = true (enchant+throw collapsed)',
    metadata.magicStoneBonusActionEconomyV1Simplified, true);
  eq('6c. magicStonePersistentEnchantmentV1Simplified = true (1-min → per-throw cast)',
    metadata.magicStonePersistentEnchantmentV1Simplified, true);
}

// ============================================================
// 7. metadata does NOT scale (Magic Stone is flat at all levels)
// ============================================================
console.log('\n--- 7. no scaling ---');
{
  eq('7a. scales = false (Magic Stone does NOT scale at 5/11/17)',
    metadata.scales, false);
}

// ============================================================
// 8. metadata exposes damageBonusField = 'spellcastingMod'
// ============================================================
console.log('\n--- 8. damageBonusField ---');
{
  eq('8a. damageBonusField = spellcastingMod (1d6 + spellcastingMod per XGE p.160)',
    metadata.damageBonusField, 'spellcastingMod');
}

// ============================================================
// 9. no CANTRIP_EFFECTS entry (no post-hit rider)
// ============================================================
console.log('\n--- 9. no CANTRIP_EFFECTS entry ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  const eventsBefore = state.log.events.length;
  dispatchCantrip(caster, target, 'Magic Stone', state);
  eq('9a. dispatcher no-op (no log events added)',
    state.log.events.length, eventsBefore);

  // No scratch fields set on target.
  eq('9b. no _chillTouchNoHealing', target._chillTouchNoHealing, undefined);
  eq('9c. no _viciousMockeryDisadvNextAttack',
    target._viciousMockeryDisadvNextAttack, undefined);
}

// ============================================================
// 10. no CANTRIP_SELF_EFFECTS entry (not a self-buff)
// ============================================================
console.log('\n--- 10. no CANTRIP_SELF_EFFECTS entry ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Magic Stone', state);
  eq('10a. resolveCantripAction returns false', ret, false);
  eq('10b. no log events', state.log.events.length, 0);
}

// ============================================================
// 11. no CANTRIP_AOE_EFFECTS entry (not a caster-centered AoE)
// ============================================================
console.log('\n--- 11. no CANTRIP_AOE_EFFECTS entry ---');
{
  const caster = makeCombatant('wiz');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAoE(caster, 'Magic Stone', state);
  eq('11a. resolveCantripAoE returns false', ret, false);
  eq('11b. no log events', state.log.events.length, 0);
}

// ============================================================
// 12. dispatcher safety — unknown cantrip name is a no-op
// ============================================================
console.log('\n--- 12. dispatcher safety ---');
{
  const caster = makeCombatant('wiz');
  const target = makeCombatant('goblin');
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  dispatchCantrip(caster, target, 'Definitely Not A Cantrip', state);
  eq('12a. unknown cantrip → no log events', state.log.events.length, 0);
  eq('12b. unknown cantrip → no state change',
    target._chillTouchNoHealing, undefined);
}

// ============================================================
// 13. Action built from metadata has correct ranged-spell shape
// ============================================================
console.log('\n--- 13. Action shape ---');
{
  eq('13a. attackType = spell', MAGIC_STONE_ACTION.attackType, 'spell');
  eq('13b. range.normal = 60 (throw range, canon)', MAGIC_STONE_ACTION.range?.normal, 60);
  eq('13c. damageType = bludgeoning', MAGIC_STONE_ACTION.damageType, 'bludgeoning');
  eq('13d. damage.sides = 6', MAGIC_STONE_ACTION.damage?.sides, 6);
  eq('13e. damage.count = 1', MAGIC_STONE_ACTION.damage?.count, 1);
  eq('13f. damage.bonus = 3 (spellcastingMod)', MAGIC_STONE_ACTION.damage?.bonus, 3);
  eq('13g. slotLevel = 0 (cantrip)', MAGIC_STONE_ACTION.slotLevel, 0);
  eq('13h. no saveDC', MAGIC_STONE_ACTION.saveDC, null);
  eq('13i. no saveAbility', MAGIC_STONE_ACTION.saveAbility, null);
  eq('13j. not AoE', MAGIC_STONE_ACTION.isAoE, false);
  eq('13k. not control', MAGIC_STONE_ACTION.isControl, false);
  eq('13l. not concentration', MAGIC_STONE_ACTION.requiresConcentration, false);
  // bypassesCover is undefined — Magic Stone respects cover normally.
  eq('13m. bypassesCover undefined (respects cover)',
    MAGIC_STONE_ACTION.bypassesCover, undefined);
  // v1: costType='action' (collapsed enchant + throw).
  eq('13n. costType = action (v1 single-action model)',
    MAGIC_STONE_ACTION.costType, 'action');
}

// ============================================================
// 14. resolveAttack hit (forced crit via isCritOverride=true → 2d6 + spellcastingMod)
// ============================================================
console.log('\n--- 14. resolveAttack hit (crit → 2d6 + spellcastingMod) ---');
{
  // Caster at (0,0), target at (5,0) — 25 ft apart, within 60 ft throw range.
  // Force a hit with isCritOverride=true (avoids nat-1 auto-miss flakiness).
  // Crit doubles the BLUDGEONING dice: 1d6 → 2d6. The +spellcastingMod
  // bonus is FLAT (not doubled — PHB p.196: only dice are doubled, not
  // flat bonuses). So crit damage = 2d6 + 3 = 5..15.
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, MAGIC_STONE_ACTION, state, true);

  // A hit event should mention Magic Stone; a damage event should mention bludgeoning.
  const hitEvent = state.log.events.find(
    (e: CombatEvent) => (e.type === 'attack_hit' || e.type === 'attack_crit') && e.description.includes('Magic Stone'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('14a. hit event logged for Magic Stone', hitEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
  assert('14b. damage type is bludgeoning',
    damageEvent?.description.includes('bludgeoning'),
    `damage event: ${damageEvent?.description}`);
  assert('14c. target took damage (HP < 100)', target.currentHP < 100);

  // Crit damage in 5..15 range (2d6 + 3 spellcastingMod).
  const damageTaken = 100 - target.currentHP;
  assert('14d. crit damage in 5..15 range (2d6 + 3)',
    damageTaken >= 5 && damageTaken <= 15, `got ${damageTaken}`);

  // No rider flag set (Magic Stone has no rider).
  assert('14e. no rider flag set',
    target._viciousMockeryDisadvNextAttack === undefined &&
    target._chillTouchNoHealing === undefined);
}

// ============================================================
// 15. resolveAttack miss (isCritOverride=false → no damage)
// ============================================================
console.log('\n--- 15. resolveAttack miss ---');
{
  // isCritOverride=false forces a MISS — no damage dealt.
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, MAGIC_STONE_ACTION, state, false);

  // No damage event on a miss.
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('15a. NO damage event on miss', damageEvent === undefined,
    `unexpected: ${damageEvent?.description}`);
  eq('15b. target HP unchanged on miss', target.currentHP, 100);

  const missEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'attack_miss' && e.description.includes('Magic Stone'),
  );
  assert('15c. miss event logged', missEvent !== undefined,
    `events: ${state.log.events.map((e: CombatEvent) => e.description).join(' | ')}`);
}

// ============================================================
// 16. damage type is bludgeoning (control test)
// ============================================================
console.log('\n--- 16. bludgeoning damage (control test) ---');
{
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 5, y: 0, z: 0 },
    ac: 5,
    currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);

  resolveAttack(caster, target, MAGIC_STONE_ACTION, state, true);

  // The damage event should mention "bludgeoning" (not "fire" or "piercing").
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('16a. damage event mentions "bludgeoning"',
    damageEvent?.description.toLowerCase().includes('bludgeoning') === true,
    `got: ${damageEvent?.description}`);
  // Negative control: should NOT mention "fire".
  assert('16b. damage event does NOT mention "fire"',
    damageEvent?.description.toLowerCase().includes('fire') === false,
    `got: ${damageEvent?.description}`);
}

// ============================================================
// 17. Magic Stone respects Total Cover
// ============================================================
console.log('\n--- 17. Magic Stone respects Total Cover ---');
{
  // Wall between caster (0,0) and target (6,0): x=[3,4], y=[-1,8]
  const totalWall: Obstacle = {
    id: 'W1', x: 3, y: -1, z: 0, width: 1, depth: 10, height: 1,
    blocksMovement: true, blocksVision: true,
  };
  const caster = makeCombatant('wiz', {
    pos: { x: 0, y: 0, z: 0 },
    spellcastingMod: 3,
  });
  const target = makeCombatant('goblin', {
    pos: { x: 6, y: 0, z: 0 },
    ac: 5, currentHP: 100, maxHP: 100,
  });
  const bf = makeBF([caster, target], [totalWall]);
  const state = makeState(bf);

  resolveAttack(caster, target, MAGIC_STONE_ACTION, state);

  const coverBlock = state.log.events.find(
    (e: CombatEvent) => e.type === 'action' && e.description.includes('Total Cover'),
  );
  const damageEvent = state.log.events.find(
    (e: CombatEvent) => e.type === 'damage',
  );
  assert('17a. Total Cover event logged', coverBlock !== undefined);
  assert('17b. no damage dealt (blocked by Total Cover)', damageEvent === undefined);
  eq('17c. target HP unchanged', target.currentHP, 100);
}

// ============================================================
// 18. does NOT scale — verify 1d6 flat at all levels (metadata.scales = false)
// ============================================================
console.log('\n--- 18. no scaling ---');
{
  eq('18a. metadata.scales = false (Magic Stone does NOT scale at 5/11/17)',
    metadata.scales, false);

  // Magic Stone does NOT have scalingLevels / scalingDice fields. Verify
  // by checking that the metadata object does NOT have these properties.
  // (Fire Bolt / Primal Savagery / etc. DO have them — see fire_bolt.test.ts
  // section 2 and primal_savagery.test.ts section 2.)
  assert('18b. metadata has NO scalingLevels field (no scaling track)',
    !('scalingLevels' in metadata),
    `unexpected: scalingLevels = ${(metadata as any).scalingLevels}`);
  assert('18c. metadata has NO scalingDice field (no scaling track)',
    !('scalingDice' in metadata),
    `unexpected: scalingDice = ${(metadata as any).scalingDice}`);

  // The Action's damage is 1d6 + 3 at ALL caster levels — verify by
  // forcing a crit at "level 1" and "level 17" (simulated by setting
  // casterLevel). The damage should be the SAME (2d6 + 3 = 5..15).
  const damageAtLevel1: number[] = [];
  const damageAtLevel17: number[] = [];
  for (let i = 0; i < 20; i++) {
    const c1 = makeCombatant('wiz1', {
      pos: { x: 0, y: 0, z: 0 },
      spellcastingMod: 3, casterLevel: 1,
    });
    const t1 = makeCombatant('g1', {
      pos: { x: 5, y: 0, z: 0 }, ac: 5,
      currentHP: 1000, maxHP: 1000,
    });
    const bf1 = makeBF([c1, t1]);
    const s1 = makeState(bf1);
    resolveAttack(c1, t1, MAGIC_STONE_ACTION, s1, true);
    damageAtLevel1.push(1000 - t1.currentHP);

    const c17 = makeCombatant('wiz17', {
      pos: { x: 0, y: 0, z: 0 },
      spellcastingMod: 3, casterLevel: 17,
    });
    const t17 = makeCombatant('g17', {
      pos: { x: 5, y: 0, z: 0 }, ac: 5,
      currentHP: 1000, maxHP: 1000,
    });
    const bf17 = makeBF([c17, t17]);
    const s17 = makeState(bf17);
    resolveAttack(c17, t17, MAGIC_STONE_ACTION, s17, true);
    damageAtLevel17.push(1000 - t17.currentHP);
  }
  // All damage values should be in 5..15 (2d6 + 3) regardless of caster level.
  const allLevel1InRange = damageAtLevel1.every(d => d >= 5 && d <= 15);
  const allLevel17InRange = damageAtLevel17.every(d => d >= 5 && d <= 15);
  assert('18d. level-1 crit damage in 5..15 (2d6+3, no scaling)',
    allLevel1InRange, `got: ${damageAtLevel1.join(',')}`);
  assert('18e. level-17 crit damage in 5..15 (2d6+3, NO scaling — flat at all levels)',
    allLevel17InRange, `got: ${damageAtLevel17.join(',')}`);
}

// ============================================================
// Summary
// ============================================================
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
