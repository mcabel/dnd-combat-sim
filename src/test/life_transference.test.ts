// ============================================================
// life_transference.test.ts — Life Transference bespoke spell module (Session 24)
// XGE p.160: 3rd-level necromancy, action, range 60 ft, NO concentration.
// Effect: Caster takes 4d8 necrotic damage (NO save, NO attack). Target
// ALLY regains HP equal to 2× the necrotic damage ACTUALLY taken by the
// caster. This is the FIRST v1 spell with a "self-damage → ally-heal"
// transfer pattern. v1 follows CANON (XGE p.160), NOT the plan spec's
// mis-paraphrase of "CON save + heal CASTER 2×".
//
// This is a HEAL spell targeting ALLIES (same faction), not enemies.
// shouldCast returns a single ALLY Combatant (NOT an array, NOT an enemy).
// execute takes (caster, allyTarget, state).
//
// Faction setup (per task spec):
//   - caster  faction 'party'
//   - allies  faction 'party' (same faction as caster)
//   - enemies faction 'enemy' (NOT targeted by this spell)
// livingAlliesOf(caster, bf) returns same-faction, alive, non-caster
// combatants. shouldCast filters to injured allies (currentHP < maxHP)
// and picks the lowest-current-HP one (most efficient heal target).
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - (1,0,0)  = 5 ft from caster (well within 60-ft range)
//   - (12,0,0) = 60 ft (boundary, in range)
//   - (13,0,0) = 65 ft (out of range)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/life_transference';
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

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

// Life Transference has NO save and NO attack roll. The action's saveDC /
// hitBonus / saveAbility are all null (canon). attackType is set to 'spell'
// since the spell module does not check this field (only uses action.name
// for lookup in shouldCast).
const LIFE_TRANSFERENCE_ACTION: Action = {
  name: 'Life Transference',
  isMultiattack: false,
  attackType: 'spell',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,              // NO save (canon — XGE p.160)
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Life Transference (4d8 necrotic self-damage, ally heals 2× necrotic taken, 60-ft range, NO save)',
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

/** Cleric at pos (0,0,0) with Life Transference + 2 3rd-level slots.
 *  maxHP=1000 so 4d8 self-damage (max 32) cannot drop the caster. */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = LIFE_TRANSFERENCE_ACTION): Combatant {
  return makeCombatant('cleric', {
    name: 'Cleric',
    pos,
    actions: [action],
    resources: withSlots3(2),
    maxHP: 1000,
    currentHP: 1000,
  });
}

/** Injured ALLY (faction 'party') for Life Transference target.
 *  Defaults: maxHP=1000, currentHP=0 (fully injured — max heal deficit
 *  so the full 2× self-damage heal is observable without applyHeal capping). */
function makeInjuredAlly(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'party',
    pos,
    maxHP: 1000,
    currentHP: 0,
    ...overrides,
  });
}

function makeEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Life Transference', metadata.name, 'Life Transference');
eq('Level is 3', metadata.level, 3);
eq('School is necromancy', metadata.school, 'necromancy');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 4', metadata.dieCount, 4);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is necrotic', metadata.damageType, 'necrotic');
eq('Heal multiplier is 2', metadata.healMultiplier, 2);
eq('Not concentration', metadata.concentration, false);
eq('Save ability is null (no save)', metadata.saveAbility, null);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Life Transference action → null
{
  const caster = makeCombatant('cleric', { actions: [], resources: withSlots3(2) });
  const ally = makeInjuredAlly('ally1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, ally]);
  eq('Returns null when caster lacks Life Transference action', shouldCast(caster, bf), null);
}
// 2b. No 3rd-level slots → null
{
  const caster = makeCombatant('cleric', { actions: [LIFE_TRANSFERENCE_ACTION], resources: withSlots3(0) });
  const ally = makeInjuredAlly('ally1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, ally]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}
// 2c. No injured allies → null (full-HP allies are skipped — don't waste slot)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const fullAlly1 = makeCombatant('full1', { faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 100 });
  const fullAlly2 = makeCombatant('full2', { faction: 'party', pos: { x: 2, y: 0, z: 0 }, maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, fullAlly1, fullAlly2]);
  eq('Returns null when all allies are full-HP', shouldCast(caster, bf), null);
}
// 2d. Injured ally in range → returns that ally (single Combatant, NOT array)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const ally = makeInjuredAlly('ally1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when injured ally in range', result !== null);
  if (result) {
    eq('Returns the single ally (Combatant, NOT array)',
      (result as Combatant).id, 'ally1');
    assert('Result is a Combatant (has .id, not an array)',
      typeof (result as any).id === 'string' && !Array.isArray(result));
  }
}
// 2e. No allies at all (only enemies) → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('enemy1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no allies present (only enemies)', shouldCast(caster, bf), null);
}

// ---- 3. shouldCast target selection (lowest-current-HP ally) --------

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Lowest-current-HP ally is chosen (NOT highest maxHP enemy — this
//     targets ALLIES via livingAlliesOf, not enemies via livingEnemiesOf).
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const ally_low = makeInjuredAlly('ally_low', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 10 });
  const ally_high = makeInjuredAlly('ally_high', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 50 });
  // An injured enemy with very high maxHP — should NOT be picked (targets ALLIES)
  const enemy = makeEnemy('enemy_big', { x: 3, y: 0, z: 0 }, { maxHP: 9999, currentHP: 1 });
  const bf = makeBF([caster, ally_low, ally_high, enemy]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks lowest-current-HP ally (ally_low), NOT the injured enemy',
      (result as Combatant).id, 'ally_low');
  }
}
// 3b. Ally beyond 60 ft cannot be the target (and no other allies → null)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Ally 13 squares away = 65 ft > 60 ft range → not a candidate
  const oorAlly = makeInjuredAlly('oorAlly', { x: 13, y: 0, z: 0 });
  const bf = makeBF([caster, oorAlly]);
  eq('Returns null when only ally is beyond 60 ft', shouldCast(caster, bf), null);
}
// 3c. Single Combatant return type — verify NOT an array even with 3 allies
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const a1 = makeInjuredAlly('a1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 30 });
  const a2 = makeInjuredAlly('a2', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 40 });
  const a3 = makeInjuredAlly('a3', { x: 3, y: 0, z: 0 }, { maxHP: 100, currentHP: 50 });
  const bf = makeBF([caster, a1, a2, a3]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant even with 3 injured allies in range',
    result !== null && !Array.isArray(result));
  if (result) {
    eq('Returns one specific Combatant (a1, lowest HP)', (result as Combatant).id, 'a1');
  }
}

// ---- 4. execute — self-damage + ally-heal (no save, no attack) --------

console.log('\n=== 4. execute — self-damage + ally-heal ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const ally = makeInjuredAlly('ally1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the injured ally', target !== null);
  if (target) {
    const casterHPBefore = caster.currentHP;
    const allyHPBefore = ally.currentHP;

    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (3rd level: 2 → 1)',
      (caster.resources as any).spellSlots[3].remaining, 1);
    // 4b. Caster takes 4d8 necrotic self-damage (range 4-32)
    const selfDmg = casterHPBefore - caster.currentHP;
    assert(`Caster self-damage in 4d8 range (4-32): got ${selfDmg}`,
      selfDmg >= 4 && selfDmg <= 32);
    // 4c. Ally heals 2× the actual necrotic taken (range 8-64)
    const healed = ally.currentHP - allyHPBefore;
    assert(`Ally heal in 2×4d8 range (8-64): got ${healed}`,
      healed >= 8 && healed <= 64);
    // 4d. Heal is EXACTLY 2× self-damage (caster has no resistance / temp HP)
    eq('Heal = 2 × actual self-damage', healed, selfDmg * 2);
    // 4e. Log events: 'damage' on caster (self-damage), 'heal' on ally
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    assert('Damage log emitted (on caster, self-damage)', dmgLogs.length === 1);
    if (dmgLogs.length === 1) {
      eq('Damage log targetId is caster (self-damage)', dmgLogs[0].targetId, caster.id);
    }
    const healLogs = state.log.events.filter((e: any) => e.type === 'heal');
    assert('Heal log emitted (on ally)', healLogs.length === 1);
    if (healLogs.length === 1) {
      eq('Heal log targetId is ally', healLogs[0].targetId, ally.id);
    }
    // 4f. No save logs (Life Transference has NO save)
    const saveLogs = state.log.events.filter(
      (e: any) => e.type === 'save_success' || e.type === 'save_fail');
    eq('No save logs (Life Transference has NO save)', saveLogs.length, 0);
    // 4g. No attack logs (no attack roll)
    const attackLogs = state.log.events.filter(
      (e: any) => e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit');
    eq('No attack logs (Life Transference has NO attack roll)', attackLogs.length, 0);
  }
}

// ---- 5. shouldCast — mixed allies (skip full-HP, pick injured) --------

console.log('\n=== 5. shouldCast — mixed allies (skip full-HP) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // One full-HP ally (skipped), one injured ally (targeted)
  const fullAlly = makeCombatant('full', { faction: 'party', pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 100 });
  const injuredAlly = makeInjuredAlly('injured', { x: 2, y: 0, z: 0 }, { maxHP: 100, currentHP: 30 });
  const bf = makeBF([caster, fullAlly, injuredAlly]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks the injured ally (not the full-HP one)', (result as Combatant).id, 'injured');
  }
}

// ---- 6. Cleanup is a no-op ------------------------------------

console.log('\n=== 6. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/life_transference') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 7. rollDamage respects 4d8 -------------------------------

console.log('\n=== 7. rollDamage ===\n');

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
