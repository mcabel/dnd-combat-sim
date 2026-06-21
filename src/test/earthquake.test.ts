// ============================================================
// earthquake.test.ts — Earthquake bespoke spell module (Session 24)
// PHB p.234: 8th-level evocation, action, range Self (canon 100-ft radius;
// v1 50-ft per plan). Canon: concentration, up to 1 minute. v1: concentration
// + multi-effect simplified to one-shot AUTO-HIT AoE.
// Effect (v1 per plan): AUTO-HIT 5d6 bludgeoning to ALL enemies within 50 ft
// of the caster (no save, no attack roll). Caster is excluded. Per the plan,
// v1 reclassifies from canon CON save + prone to auto-hit AoE (no save).
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors spellfire_flare's auto-hit pattern + earth_tremor's self-centred AoE.
// Uses withSlots8.
//
// AUTO-HIT tests use no DC/save — execute always applies 5d6 bludgeoning
// to each target within 50 ft of the caster. Damage range 5-30 per target.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/earthquake';
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

function withSlots8(remaining = 2): PlayerResources {
  return { spellSlots: { 8: { max: 2, remaining } } };
}

/**
 * Earthquake action. attackType: 'save' is fine (the spell ignores it —
 * there's no save and no attack roll in execute). saveDC: null. hitBonus: null.
 * The execute path uses neither.
 */
const EQ_ACTION: Action = {
  name: 'Earthquake',
  isMultiattack: false,
  attackType: 'save',     // ignored by execute (auto-hit, no save)
  reach: 5,
  range: { normal: 0, long: 0 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,           // no save
  saveAbility: null,
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 8,
  costType: 'action',
  legendaryCost: 0,
  description: 'Earthquake (AUTO-HIT 5d6 bludgeoning, self-centred 50-ft radius AoE)',
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

/** Druid at pos (0,0,0) with Earthquake + 2 8th-level slots. */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = EQ_ACTION): Combatant {
  return makeCombatant('druid', {
    name: 'Druid',
    pos,
    actions: [action],
    resources: withSlots8(2),
  });
}

/** Enemy within 50-ft radius when at (1,0,0) = 5 ft. */
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

eq('Name is Earthquake', metadata.name, 'Earthquake');
eq('Level is 8', metadata.level, 8);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 0 ft (Self)', metadata.rangeFt, 0);
eq('AoE radius is 50 ft (v1 per plan)', metadata.aoeRadiusFt, 50);
eq('Die count is 5', metadata.dieCount, 5);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is bludgeoning', metadata.damageType, 'bludgeoning');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);
eq('Auto-hit v1 flag set', metadata.earthquakeAutoHitV1PerPlan, true);
eq('50-ft radius v1 flag set', metadata.earthquakeRadius50ftV1PerPlan, true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Earthquake action → null
{
  const caster = makeCombatant('druid', { actions: [], resources: withSlots8(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Earthquake action', shouldCast(caster, bf), null);
}
// 2b. No 8th-level slots → null
{
  const caster = makeCombatant('druid', { actions: [EQ_ACTION], resources: withSlots8(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 8th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 50 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 11 squares away = 55 ft > 50 ft radius
  const enemy = makeEnemy('e1', { x: 11, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 50 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast self-centred AoE targeting (50-ft radius) ----

console.log('\n=== 3. shouldCast self-centred AoE targeting ===\n');

// 3a. All enemies within 50 ft of caster are caught; caster EXCLUDED
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 5 ft from caster
  const e_in1 = makeEnemy('e_in1', { x: 1, y: 0, z: 0 }, { maxHP: 50 });
  // 50 ft from caster (boundary) → IN radius (≤ 50)
  const e_in2 = makeEnemy('e_in2', { x: 10, y: 0, z: 0 }, { maxHP: 50 });
  // 55 ft from caster → OUT of radius
  const e_out = makeEnemy('e_out', { x: 11, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e_in1, e_in2, e_out]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('Includes e_in1 (5 ft)', ids.includes('e_in1'));
    assert('Includes e_in2 (50 ft boundary)', ids.includes('e_in2'));
    assert('Excludes e_out (55 ft > 50 ft radius)', !ids.includes('e_out'));
    // CASTER EXCLUDED — Earthquake is "each creature on the ground other than you"
    assert('Caster (druid) NOT in targets', !ids.includes('druid'));
    eq('Exactly 2 targets caught (caster excluded)', (result as Combatant[]).length, 2);
  }
}

// 3b. Single closest enemy caught when only one in range
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Single in-range enemy returned', (result as Combatant[]).length, 1);
    eq('Target is the enemy', (result as Combatant[])[0].id, 'e1');
  }
}

// ---- 4. execute — auto-hit (damage ALWAYS applied; no save, no attack) ----

console.log('\n=== 4. execute — auto-hit (damage ALWAYS applied) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns targets', targets !== null);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // 4a. Slot consumed
    eq('Slot consumed (8th level: 2 → 1)',
      (caster.resources as any).spellSlots[8].remaining, 1);
    // 4b. Damage applied: 5d6 (range 5-30)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 5d6 range (5-30): got ${dmgDealt}`,
      dmgDealt >= 5 && dmgDealt <= 30);
    // 4c. KEY: no attack_hit / attack_miss / attack_crit events (auto-hit)
    const hitEvents = state.log.events.filter((e: any) => e.type === 'attack_hit');
    eq('No attack_hit event (auto-hit, no attack roll)', hitEvents.length, 0);
    const missEvents = state.log.events.filter((e: any) => e.type === 'attack_miss');
    eq('No attack_miss event (auto-hit)', missEvents.length, 0);
    const critEvents = state.log.events.filter((e: any) => e.type === 'attack_crit');
    eq('No attack_crit event (no crit path on auto-hit)', critEvents.length, 0);
    // 4d. KEY: no save_success / save_fail events (auto-hit, no save)
    const saveEvents = state.log.events.filter(
      (e: any) => e.type === 'save_success' || e.type === 'save_fail');
    eq('No save_success/save_fail events (auto-hit)', saveEvents.length, 0);
    // 4e. KEY: only 'action' + 'damage' log events emitted
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted (cast)', actions.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // 4f. No condition rider for Earthquake v1 (no prone per plan)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (v1: prone NOT modelled per plan)', condAdds.length, 0);
  }
}

// ---- 5. execute — multi-target self-AoE (no spillover beyond 50 ft) ----

console.log('\n=== 5. execute — multi-target AoE (no spillover) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 2 enemies within 50 ft, 1 enemy at 55 ft (out of radius)
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e_out = makeEnemy('e_out', { x: 11, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e_out]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 2 targets (e1 + e2; e_out excluded)', targets !== null && (targets as Combatant[]).length === 2);
  if (targets) {
    const hpBeforeE1 = e1.currentHP;
    const hpBeforeE2 = e2.currentHP;
    const hpBeforeOut = e_out.currentHP;
    execute(caster, targets as Combatant[], state);
    // Both in-radius enemies took damage
    const dmg1 = hpBeforeE1 - e1.currentHP;
    const dmg2 = hpBeforeE2 - e2.currentHP;
    assert(`e1 took damage in 5d6 range (5-30): got ${dmg1}`, dmg1 >= 5 && dmg1 <= 30);
    assert(`e2 took damage in 5d6 range (5-30): got ${dmg2}`, dmg2 >= 5 && dmg2 <= 30);
    // Out-of-radius enemy took NO damage
    eq('e_out (out of radius) takes no damage', hpBeforeOut - e_out.currentHP, 0);
    // Only 2 damage logs (not 3)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Only 2 damage logs (no spillover)', dmgLogs.length, 2);
  }
}

// ---- 6. execute — caster excluded (not damaged by their own Earthquake) ----

console.log('\n=== 6. execute — caster excluded ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBeforeCaster = caster.currentHP;
    execute(caster, targets as Combatant[], state);
    // Caster takes NO damage from their own Earthquake (per PHB p.234 "other than you")
    eq('Caster takes NO damage from own Earthquake', hpBeforeCaster - caster.currentHP, 0);
    // Caster is NOT in the targets list
    const ids = (targets as Combatant[]).map(c => c.id);
    assert('Caster ID NOT in targets list', !ids.includes('druid'));
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/earthquake') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 5d6 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 5 (got ${min})`, min >= 5);
  assert(`rollDamage max <= 30 (got ${max})`, max <= 30);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
