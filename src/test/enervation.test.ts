// ============================================================
// enervation.test.ts — Enervation bespoke spell module (Session 24)
// XGE p.155: 5th-level necromancy, action, range 60 ft. Canon:
// concentration, up to 1 minute. v1: concentration + DoT simplified
// to one-shot. Effect: single-target DEX save. On fail: 4d8 necrotic
// and caster regains HP = half the ACTUAL necrotic dealt. On success:
// half damage and caster heals half that amount.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors vampiric_touch.test.ts (heal-caster-half rider) but with a
// DEX SAVE (not melee attack), 4d8 necrotic (vs 3d6), L5 slot, 60-ft
// range. Uses withSlots5.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Heal rider: caster heals floor(dealt/2). To make the heal OBSERVABLE
// (applyHeal returns the actual HP restored, capped at max-current),
// the caster must be INJURED (currentHP < maxHP). The test sets caster
// currentHP=500 with maxHP=1000 so the full 1-16 heal is absorbed.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/enervation';
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

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

const ENERVATION_ACTION: Action = {
  name: 'Enervation',
  isMultiattack: false,
  attackType: 'save',          // DEX save (not attack)
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: false,         // NOTE: single-target, NOT AoE
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Enervation (DEX save, 4d8 necrotic, heal self half damage dealt)',
};

const ENERVATION_ACTION_LOW_DC: Action = {
  ...ENERVATION_ACTION,
  saveDC: 5,            // guaranteed-success DC (DEX 30 → min 11 ≥ 5)
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

/** Wizard at pos (0,0,0) with Enervation + 2 5th-level slots.
 *  Caster is INJURED (currentHP=500 < maxHP=1000) so the heal rider is
 *  observable — applyHeal returns the actual HP restored, capped at
 *  max-current. With a 1-16 heal, 500 HP of headroom is more than enough. */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = ENERVATION_ACTION): Combatant {
  return makeCombatant('wizard', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots5(2),
    maxHP: 1000,
    currentHP: 500,     // injured — can absorb up to 500 HP heal
  });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Enervation', metadata.name, 'Enervation');
eq('Level is 5', metadata.level, 5);
eq('School is necromancy', metadata.school, 'necromancy');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 4', metadata.dieCount, 4);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is necrotic', metadata.damageType, 'necrotic');
eq('Heal fraction is 2 (heal = floor(dealt/2))', metadata.healFraction, 2);
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Enervation action → null
{
  const caster = makeCombatant('wizard', { actions: [], resources: withSlots5(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Enervation action', shouldCast(caster, bf), null);
}
// 2b. No 5th-level slots → null
{
  const caster = makeCombatant('wizard', { actions: [ENERVATION_ACTION], resources: withSlots5(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 60 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 13 squares away = 65 ft > 60 ft range
  const enemy = makeWeakEnemy('e1', { x: 13, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 60 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns that enemy (single Combatant, NOT array)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  if (result) {
    eq('Returns the single enemy (Combatant, NOT array)',
      (result as Combatant).id, 'e1');
    assert('Result is a Combatant (has .id, no .length property)',
      typeof (result as any).id === 'string' && !Array.isArray(result));
  }
}

// ---- 3. shouldCast target selection (single best target) --------

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Highest-threat enemy within 60 ft is chosen (single target)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 60 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}
// 3b. Enemy beyond 60 ft is NOT chosen — falls back to in-range enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 13 squares away = 65 ft > 60 ft range
  const outOfRange = makeWeakEnemy('oor', { x: 13, y: 0, z: 0 }, { maxHP: 999 });
  // In-range weak enemy
  const inRange = makeWeakEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 65-ft high-threat one)',
      (result as Combatant).id, 'ir');
  }
}
// 3c. Single Combatant return type — verify NOT an array even with 3 enemies
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 50 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e1, e2, e3]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant even with 3 enemies in range',
    result !== null && !Array.isArray(result));
  if (result) {
    eq('Returns one specific Combatant (not array of 3)',
      typeof (result as Combatant).id, 'string');
  }
}

// ---- 4. execute — guaranteed fail (full damage + heal) -----------

console.log('\n=== 4. execute — guaranteed fail (full damage + heal) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const casterHPBefore = caster.currentHP;
    const enemyHPBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (5th level: 2 → 1)',
      (caster.resources as any).spellSlots[5].remaining, 1);
    // 4b. Damage applied: 4d8 necrotic, range 4-32
    const dmgDealt = enemyHPBefore - enemy.currentHP;
    assert(`Damage in 4d8 range (4-32): got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 32);
    // 4c. Caster heals floor(dealt/2): range 2-16
    const healed = caster.currentHP - casterHPBefore;
    assert(`Caster heal in 2-16 range (floor(dmg/2)): got ${healed}`,
      healed >= 2 && healed <= 16);
    // 4d. Heal = floor(dealt / 2) EXACTLY (the enervation heal formula)
    eq('Heal = floor(dealt / 2)', healed, Math.floor(dmgDealt / 2));
    // 4e. Log events — action + save_fail + damage + heal
    const actions = state.log.events.filter(e => e.type === 'action');
    assert('Action log emitted', actions.length >= 1);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted (on enemy)', dmgLogs.length, 1);
    if (dmgLogs.length === 1) {
      eq('Damage log targetId is enemy', dmgLogs[0].targetId, enemy.id);
    }
    const healLogs = state.log.events.filter((e: any) => e.type === 'heal');
    eq('Heal log emitted (on caster)', healLogs.length, 1);
    if (healLogs.length === 1) {
      eq('Heal log targetId is caster', healLogs[0].targetId, caster.id);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage + halved heal) --

console.log('\n=== 5. execute — guaranteed success (half damage + halved heal) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, ENERVATION_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const casterHPBefore = caster.currentHP;
    const enemyHPBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Damage applied: half of 4d8 (floor), range 2-16
    const dmgDealt = enemyHPBefore - enemy.currentHP;
    assert(`Half-damage in 2-16 range: got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 16);
    // 5b. Caster heals floor(dealt/2): range 1-8 (on halved damage)
    const healed = caster.currentHP - casterHPBefore;
    assert(`Caster heal in 1-8 range (floor(halved/2)): got ${healed}`,
      healed >= 1 && healed <= 8);
    // 5c. Heal = floor(dealt / 2) EXACTLY (same formula on halved damage)
    eq('Heal = floor(dealt / 2) (on halved damage)', healed, Math.floor(dmgDealt / 2));
    // 5d. Save-success log
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (DEX 30 vs DC 5)', saveSuccess.length === 1);
    // 5e. Heal log still emitted on save success (heal = half the dealt = quarter-raw)
    const healLogs = state.log.events.filter((e: any) => e.type === 'heal');
    eq('Heal log emitted on save success (halved heal)', healLogs.length, 1);
  }
}

// ---- 6. execute — single-target (no spillover) ----------------

console.log('\n=== 6. execute — single-target (no spillover) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 3 enemies in range; shouldCast picks ONE (highest threat)
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBeforeE1 = e1.currentHP;
    const hpBeforeE2 = e2.currentHP;
    const hpBeforeE3 = e3.currentHP;

    execute(caster, target as Combatant, state);

    // Only ONE enemy takes damage — Enervation is single-target
    const dmg1 = hpBeforeE1 - e1.currentHP;
    const dmg2 = hpBeforeE2 - e2.currentHP;
    const dmg3 = hpBeforeE3 - e3.currentHP;
    const damagedCount = [dmg1, dmg2, dmg3].filter(d => d > 0).length;
    eq('Exactly 1 enemy took damage (single-target spell)', damagedCount, 1);
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    eq('Only 1 save-fail log (single target)', saveFails.length, 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Only 1 damage log (single target)', dmgLogs.length, 1);
    // Heal log still emitted (rider fires on the single target's damage)
    const healLogs = state.log.events.filter((e: any) => e.type === 'heal');
    eq('Only 1 heal log (single-target heal rider)', healLogs.length, 1);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/enervation') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 4d8 --------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamage max <= 32 (got ${max})`, max <= 32);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
