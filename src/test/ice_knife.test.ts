// ============================================================
// ice_knife.test.ts — Ice Knife bespoke spell module (Session 21)
// XGE p.157: 1st-level conjuration, action, range 60 ft,
// NO concentration. Effect: HYBRID —
//   Phase 1: ranged spell attack vs AC. On hit: 1d10 piercing.
//            On crit: 2d10 (PHB p.196 — dice doubled).
//   Phase 2: cold explosion (fires on hit OR miss — XGE p.157
//            "Hit or miss, the shard then explodes"). Each enemy
//            within 5 ft of the primary target makes a DEX save:
//            on fail 2d6 cold, on success half.
//
// Migrated from the Session 20 generic dispatch registry in Session 21.
// Mirrors fireball.test.ts structure but with Ice Knife's hybrid
// pattern (attack-roll + AoE-save). shouldCast returns an
// IceKnifePlan { primary, explosion }; execute takes
// (caster, plan, state). Uses withSlots1.
//
// Attack rolls use deterministic hit-bonus extremes:
//   - hitBonus: 100  → guaranteed pierce hit (nat 1 → 101 ≥ AC 14)
//                       5% chance of nat-20 crit (2d10 instead of 1d10)
//   - hitBonus: -100 → guaranteed pierce miss (nat 20 auto-crits)
//                       5% chance of crit-hit; tests accept either outcome
//
// The cold explosion ALWAYS fires (hit or miss) — XGE p.157 canon.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Crit-doubling is verified deterministically by calling
// rollPierceDamage(isCrit=true/false) and rollColdDamage() directly.
// ============================================================

import {
  shouldCast, execute, metadata,
  rollPierceDamage, rollColdDamage,
  IceKnifePlan,
} from '../spells/ice_knife';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots1(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

/**
 * Guaranteed-hit action: hitBonus +100 (nat 1 → 101 ≥ AC 14),
 * saveDC 25 (DEX 1 → max 15 < 25 = guaranteed cold-save fail).
 */
const IK_ACTION: Action = {
  name: 'Ice Knife',
  isMultiattack: false,
  attackType: 'spell',  // ranged spell attack (spell attacks use 'spell' — see scorching_ray.test.ts)
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: 100,        // guaranteed pierce hit
  damage: null,
  damageType: null,
  saveDC: 25,           // cold-save auto-fail (DEX 1)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Ice Knife (ranged spell attack 1d10 piercing, then 2d6 cold DEX save in 5-ft radius)',
};

/** Guaranteed-pierce-miss action: hitBonus -100, saveDC 25 (cold still auto-fails) */
const IK_ACTION_MISS: Action = {
  ...IK_ACTION,
  hitBonus: -100,       // pierce auto-miss (except nat-20 crit)
  // saveDC stays 25 — cold explosion always fires + auto-fails
};

/** Guaranteed-pierce-hit + cold-save auto-success (DEX 30 + DC 5) */
const IK_ACTION_COLD_SUCCESS: Action = {
  ...IK_ACTION,
  saveDC: 5,            // cold-save auto-success (DEX 30)
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set() as Set<Condition>,
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
  return {
    width: 60, height: 60, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Druid at pos (0,0,0) with Ice Knife + 2 1st-level slots */
function makeDruid(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = IK_ACTION): Combatant {
  return makeCombatant('druid', {
    name: 'Druid',
    pos,
    actions: [action],
    resources: withSlots1(2),
  });
}

/** Enemy with DEX 1 (guaranteed cold-save fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 1,            // guaranteed cold-save fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed cold-save success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 30,           // guaranteed cold-save success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Ice Knife', metadata.name, 'Ice Knife');
eq('Level is 1', metadata.level, 1);
eq('School is conjuration', metadata.school, 'conjuration');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('AoE radius is 5 ft', metadata.aoeRadiusFt, 5);
eq('Pierce die count is 1', metadata.pierceDieCount, 1);
eq('Pierce die sides is 10', metadata.pierceDieSides, 10);
eq('Cold die count is 2', metadata.coldDieCount, 2);
eq('Cold die sides is 6', metadata.coldDieSides, 6);
eq('Pierce damage type is piercing', metadata.pierceDamageType, 'piercing');
eq('Cold damage type is cold', metadata.coldDamageType, 'cold');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Ice Knife action → null
{
  const caster = makeCombatant('druid', { actions: [], resources: withSlots1(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Ice Knife action', shouldCast(caster, bf), null);
}
// 2b. No 1st-level slots → null
{
  const caster = makeCombatant('druid', { actions: [IK_ACTION], resources: withSlots1(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 60 ft range
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns IceKnifePlan { primary, explosion }
{
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 3, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null IceKnifePlan when enemy in range', result !== null);
  if (result) {
    const plan = result as IceKnifePlan;
    eq('Plan.primary is the enemy', plan.primary.id, 'e1');
    assert('Plan.explosion is an array', Array.isArray(plan.explosion));
    eq('Plan.explosion includes the primary (within 5 ft of itself)',
      plan.explosion.length, 1);
    eq('Plan.explosion[0] is the primary', plan.explosion[0].id, 'e1');
  }
}

// ---- 3. shouldCast — IceKnifePlan shape & explosion collection ----

console.log('\n=== 3. shouldCast — IceKnifePlan shape & explosion ===\n');

// 3a. Cluster: 2 close enemies + 1 far — primary = high-threat cluster centre,
//     explosion = both close enemies (far excluded)
{
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  // Two enemies within 5 ft of each other (chebyshev = 1)
  const close1 = makeWeakEnemy('close1', { x: 3, y: 0, z: 0 }, { maxHP: 300 });
  const close2 = makeWeakEnemy('close2', { x: 4, y: 0, z: 0 }, { maxHP: 100 });
  // Far enemy — NOT within 5 ft of either close enemy (chebyshev = 7 from close1)
  const far = makeWeakEnemy('far', { x: 10, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, close1, close2, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const plan = result as IceKnifePlan;
    // Both close1 and close2 have cluster density 2 (each is in the other's
    // explosion). Tie-break: highest threat → close1 (maxHP 300 > 100).
    eq('Plan.primary is close1 (cluster density 2, highest threat)',
      plan.primary.id, 'close1');
    eq('Plan.explosion has 2 members (close1 + close2)', plan.explosion.length, 2);
    const expIds = plan.explosion.map(c => c.id).sort();
    assert('Explosion includes close1', expIds.includes('close1'));
    assert('Explosion includes close2', expIds.includes('close2'));
    assert('Explosion excludes far (>5 ft from primary)',
      !expIds.includes('far'));
  }
}

// 3b. Single isolated enemy — explosion = [primary] only
{
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  if (result) {
    const plan = result as IceKnifePlan;
    eq('Isolated enemy: explosion = [primary] only', plan.explosion.length, 1);
    eq('Explosion[0] is primary', plan.explosion[0].id, plan.primary.id);
  }
}

// 3c. Diagonal-cluster — chebyshev=1 in any direction counts as 5 ft
{
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const primary = makeWeakEnemy('p', { x: 3, y: 0, z: 0 }, { maxHP: 200 });
  // Diagonal neighbour at (4,1,0) — chebyshev = 1 → 5 ft → in explosion
  const diag = makeWeakEnemy('d', { x: 4, y: 1, z: 0 }, { maxHP: 100 });
  const bf = makeBF([caster, primary, diag]);
  const result = shouldCast(caster, bf);
  if (result) {
    const plan = result as IceKnifePlan;
    eq('Diagonal neighbour in explosion (chebyshev=1)',
      plan.explosion.length, 2);
  }
}

// ---- 4. execute — guaranteed pierce hit + cold-save fail -----------

console.log('\n=== 4. execute — pierce hit + cold explosion (full damage) ===\n');

{
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf);
  assert('shouldCast returns a plan', plan !== null);
  if (plan) {
    const hpBefore = enemy.currentHP;
    execute(caster, plan as IceKnifePlan, state);

    // 4a. Slot consumed
    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 4b. Total damage: 1d10 pierce (1-10) + 2d6 cold (2-12) = 3-22,
    //     OR 2d10 pierce crit (2-20) + 2d6 cold (2-12) = 4-32 (rare nat-20)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in pierce+cold range (3-32): got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 32);
    // 4c. Action log emitted
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length === 1);
    // 4d. Phase 1 (pierce): exactly 1 attack_hit OR attack_crit event
    const hitOrCrit = state.log.events.filter(
      e => e.type === 'attack_hit' || e.type === 'attack_crit');
    eq('Exactly 1 pierce attack_hit/attack_crit event', hitOrCrit.length, 1);
    // 4e. Phase 2 (cold): exactly 1 save_fail event (DEX 1 vs DC 25)
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    eq('Exactly 1 cold save_fail event (DEX 1 vs DC 25)', saveFails.length, 1);
    // 4f. Damage events: 1 pierce + 1 cold = 2 total
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    eq('2 damage logs (1 pierce + 1 cold)', dmgLogs.length, 2);
  }
}

// ---- 5. execute — pierce MISS, cold explosion STILL fires -----------

console.log('\n=== 5. execute — pierce MISS, cold explosion STILL fires ===\n');

{
  const caster = makeDruid({ x: 0, y: 0, z: 0 }, IK_ACTION_MISS);
  const enemy = makeWeakEnemy('e1', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf);
  if (plan) {
    const hpBefore = enemy.currentHP;
    execute(caster, plan as IceKnifePlan, state);

    // 5a. Slot still consumed (even on pierce miss)
    eq('Slot consumed even on pierce miss (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 5b. Damage: pierce 0 (miss, 95%) OR 2-20 (nat-20 crit, 5%) + 2-12 cold = 2-32
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in [2, 32] (miss+full cold OR rare crit+full cold): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 32);
    // 5c. Phase 1 (pierce): exactly 1 attack event (miss OR crit, never plain hit)
    const hitEvents = state.log.events.filter(e => e.type === 'attack_hit');
    eq('No plain pierce attack_hit (nat 20 → crit path)', hitEvents.length, 0);
    const missEvents = state.log.events.filter(e => e.type === 'attack_miss');
    const critEvents = state.log.events.filter(e => e.type === 'attack_crit');
    eq('Exactly 1 pierce attack event (miss or crit)',
      missEvents.length + critEvents.length, 1);
    // 5d. Phase 2 (cold): ALWAYS fires — 1 save_fail event (DEX 1 vs DC 25)
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    eq('Cold save_fail STILL emitted (explosion fires on miss)', saveFails.length, 1);
    // 5e. Cold damage log ALWAYS emitted (1)
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    // Either 1 damage (cold only, pierce missed) OR 2 damage (rare crit pierce + cold)
    assert(`1 or 2 damage logs (cold always, pierce only on crit): got ${dmgLogs.length}`,
      dmgLogs.length === 1 || dmgLogs.length === 2);
    // 5f. The cold explosion announcement (condition_add) ALWAYS fires
    const explodeAnnounce = state.log.events.filter(e => e.type === 'condition_add');
    eq('Cold explosion announcement ALWAYS emitted (condition_add)',
      explodeAnnounce.length, 1);
  }
}

// ---- 6. execute — cold-save success (DEX 30 vs DC 5, half cold) ----

console.log('\n=== 6. execute — cold-save success (half cold damage) ===\n');

{
  const caster = makeDruid({ x: 0, y: 0, z: 0 }, IK_ACTION_COLD_SUCCESS);
  const enemy = makeStrongEnemy('e1', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf);
  if (plan) {
    const hpBefore = enemy.currentHP;
    execute(caster, plan as IceKnifePlan, state);

    // 6a. Cold save_success emitted (DEX 30 vs DC 5)
    const saveSuccess = state.log.events.filter(e => e.type === 'save_success');
    eq('Cold save_success emitted (DEX 30 vs DC 5)', saveSuccess.length, 1);
    // 6b. Cold damage: half of 2d6 = 1-6 (rounded down)
    //     Pierce damage: 1d10 (1-10) on hit OR 2d10 (2-20) on crit
    //     Total: 2-16 (hit) OR 3-26 (crit)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in pierce + half-cold range (2-26): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 26);
  }
}

// ---- 7. execute — multi-target cold explosion (cluster) -----------

console.log('\n=== 7. execute — multi-target cold explosion (cluster) ===\n');

{
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  // Cluster of 2 enemies within 5 ft of each other
  const primary = makeWeakEnemy('primary', { x: 3, y: 0, z: 0 },
    { maxHP: 1000, currentHP: 1000 });
  const neighbour = makeWeakEnemy('neighbour', { x: 4, y: 0, z: 0 },
    { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, primary, neighbour]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf);
  if (plan) {
    const hpPriBefore = primary.currentHP;
    const hpNeiBefore = neighbour.currentHP;
    execute(caster, plan as IceKnifePlan, state);

    // 7a. Both enemies take damage (pierce + cold for primary, cold for neighbour)
    const priDmg = hpPriBefore - primary.currentHP;
    const neiDmg = hpNeiBefore - neighbour.currentHP;
    assert(`Primary took pierce+cold damage (3-32): got ${priDmg}`,
      priDmg >= 3 && priDmg <= 32);
    assert(`Neighbour took cold damage (2-12): got ${neiDmg}`,
      neiDmg >= 2 && neiDmg <= 12);
    // 7b. 2 cold save_fail events (one per explosion member)
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    eq('2 cold save_fail events (one per explosion member)', saveFails.length, 2);
    // 7c. Damage events: 1 pierce (primary hit) + 2 cold = 3 total
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    eq('3 damage logs (1 pierce + 2 cold)', dmgLogs.length, 3);
  }
}

// ---- 8. rollPierceDamage — isCrit=false returns 1d10 (1-10) --------

console.log('\n=== 8. rollPierceDamage(isCrit=false) — 1d10 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollPierceDamage(false);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollPierceDamage(false) min >= 1 (got ${min})`, min >= 1);
  assert(`rollPierceDamage(false) max <= 10 (got ${max})`, max <= 10);
}

// ---- 9. rollPierceDamage — isCrit=true returns 2d10 (2-20) ---------

console.log('\n=== 9. rollPierceDamage(isCrit=true) — 2d10 ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollPierceDamage(true);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollPierceDamage(true) min >= 2 (got ${min})`, min >= 2);
  assert(`rollPierceDamage(true) max <= 20 (got ${max})`, max <= 20);
}

// ---- 10. rollColdDamage — 2d6 (2-12), NO isCrit parameter ---------

console.log('\n=== 10. rollColdDamage — 2d6 (no isCrit param) ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollColdDamage();   // NOTE: no isCrit param — cold is a save, not attack
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollColdDamage() min >= 2 (got ${min})`, min >= 2);
  assert(`rollColdDamage() max <= 12 (got ${max})`, max <= 12);
}

// ---- 11. Cleanup is a no-op ------------------------------------

console.log('\n=== 11. Cleanup is a no-op ===\n');

{
  const caster = makeDruid();
  let cleanupOk = true;
  try { (require('../spells/ice_knife') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
