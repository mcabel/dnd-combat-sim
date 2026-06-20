// ============================================================
// ravenous_void.test.ts — Ravenous Void bespoke spell module (Session 24)
// XGE p.159: 9th-level evocation, action, range 1000 ft. Canon: concentration,
// up to 1 minute (CON save + pull + restrained). v1: concentration + pull/
// restrained simplified to one-shot AUTO-HIT AoE per plan.
// Effect (v1 per plan): AUTO-HIT 5d10 force to ALL enemies within 60 ft of
// the highest-threat enemy within 1000 ft (the AoE center is the
// highest-threat enemy, NOT the caster). No save, no attack roll.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors earthquake's auto-hit AoE pattern + sunburst's enemy-centred AoE.
// Uses withSlots9.
//
// AUTO-HIT tests use no DC/save — execute always applies 5d10 force
// to each target within 60 ft of the center. Damage range 5-50 per target.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/ravenous_void';
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

function withSlots9(remaining = 2): PlayerResources {
  return { spellSlots: { 9: { max: 2, remaining } } };
}

/**
 * Ravenous Void action. attackType: 'save' is fine (the spell ignores it —
 * there's no save and no attack roll in execute). saveDC: null. hitBonus: null.
 * The execute path uses neither.
 */
const RV_ACTION: Action = {
  name: 'Ravenous Void',
  isMultiattack: false,
  attackType: 'save',     // ignored by execute (auto-hit, no save)
  reach: 5,
  range: { normal: 1000, long: 1000 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,           // no save
  saveAbility: null,
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 9,
  costType: 'action',
  legendaryCost: 0,
  description: 'Ravenous Void (AUTO-HIT 5d10 force, 1000-ft range, 60-ft radius enemy-centred AoE)',
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

/** Wizard at pos (0,0,0) with Ravenous Void + 2 9th-level slots. */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = RV_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots9(2),
  });
}

/** Enemy within 1000-ft range when at (1,0,0) = 5 ft. */
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

eq('Name is Ravenous Void', metadata.name, 'Ravenous Void');
eq('Level is 9', metadata.level, 9);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 1000 ft', metadata.rangeFt, 1000);
eq('AoE radius is 60 ft', metadata.aoeRadiusFt, 60);
eq('Die count is 5', metadata.dieCount, 5);
eq('Die sides is 10', metadata.dieSides, 10);
eq('Damage type is force', metadata.damageType, 'force');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);
eq('Auto-hit v1 flag set', metadata.ravenousVoidAutoHitV1PerPlan, true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Ravenous Void action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots9(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Ravenous Void action', shouldCast(caster, bf), null);
}
// 2b. No 9th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [RV_ACTION], resources: withSlots9(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 9th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 1000 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 201 squares away = 1005 ft > 1000 ft range (just past)
  const enemy = makeEnemy('e1', { x: 201, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 1000 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // (1,0,0) = 5 ft — well within 1000-ft range
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast AoE targeting (center + 60-ft radius) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 1000 ft is chosen as CENTER; all within 60 ft are caught
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center enemy at (5,0,0) = 25 ft from caster (well in 1000-ft range), maxHP 200 (highest)
  const center = makeEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 200 });
  // nearby within 60 ft of center: chebyshev = 10 → 50 ft
  const nearby = makeEnemy('nearby', { x: 5, y: 10, z: 0 }, { maxHP: 50 });
  // far outside 60 ft of center: chebyshev = 13 → 65 ft
  const far = makeEnemy('far', { x: 5, y: 13, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, center, nearby, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('Includes center (AoE center)', ids.includes('center'));
    assert('Includes nearby (50 ft ≤ 60 ft radius)', ids.includes('nearby'));
    assert('Excludes far (65 ft > 60 ft radius)', !ids.includes('far'));
  }
}

// 3b. Boundary test — 60 ft boundary from center is IN (≤ 60)
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center at (1,0,0) = 5 ft from caster (in range, maxHP 1000 → primary)
  const center = makeEnemy('center', { x: 1, y: 0, z: 0 }, { maxHP: 1000 });
  // e_in: chebyshev = 12 → 60 ft from center (boundary) → IN radius
  const e_in = makeEnemy('e_in', { x: 13, y: 0, z: 0 }, { maxHP: 50 });
  // e_out: chebyshev = 13 → 65 ft from center → OUT of radius
  const e_out = makeEnemy('e_out', { x: 14, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, center, e_in, e_out]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e_in (60 ft boundary from center) in targets', ids.includes('e_in'));
    assert('e_out (65 ft from center) NOT in targets', !ids.includes('e_out'));
    eq('Exactly 2 targets caught (center + e_in)', (result as Combatant[]).length, 2);
  }
}

// 3c. KEY: AoE center is the highest-threat enemy, NOT the caster
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Place a high-threat enemy at (10,0,0) = 50 ft from caster.
  // Place a low-threat enemy at (15,0,0) = 75 ft from caster (25 ft from highT).
  const highT = makeEnemy('highT', { x: 10, y: 0, z: 0 }, { maxHP: 300 });
  const lowT = makeEnemy('lowT', { x: 15, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, highT, lowT]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    // highT is the center (maxHP 300); lowT is within 60 ft of highT → caught
    assert('highT (highest-threat) included', ids.includes('highT'));
    assert('lowT (within 60 ft of highT center) included', ids.includes('lowT'));
    // CASTER NOT in targets (Ravenous Void is enemy-centred, not self-centred)
    assert('Caster (wizard) NOT in targets', !ids.includes('wiz'));
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
    eq('Slot consumed (9th level: 2 → 1)',
      (caster.resources as any).spellSlots[9].remaining, 1);
    // 4b. Damage applied: 5d10 (range 5-50)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 5d10 range (5-50): got ${dmgDealt}`,
      dmgDealt >= 5 && dmgDealt <= 50);
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
    // 4f. No condition rider for Ravenous Void v1 (no pull/restrained per plan)
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (v1: pull/restrained NOT modelled per plan)', condAdds.length, 0);
  }
}

// ---- 5. execute — multi-target AoE (no spillover beyond 60 ft) ----

console.log('\n=== 5. execute — multi-target AoE (no spillover) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center: highT at (5,0,0); 2 in-radius enemies; 1 out-of-radius
  const highT = makeEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e1 = makeEnemy('e1', { x: 6, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 }); // 5 ft from highT
  const e2 = makeEnemy('e2', { x: 7, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 }); // 10 ft from highT
  // e_out: 13 squares from highT = 65 ft → OUT of 60-ft radius
  const e_out = makeEnemy('e_out', { x: 18, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, highT, e1, e2, e_out]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  // highT is the center (maxHP 1000); e1, e2 are within 60 ft; e_out is NOT
  assert('shouldCast returns 3 targets (highT + e1 + e2; e_out excluded)',
    targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    const hpBeforeHighT = highT.currentHP;
    const hpBeforeE1 = e1.currentHP;
    const hpBeforeE2 = e2.currentHP;
    const hpBeforeOut = e_out.currentHP;
    execute(caster, targets as Combatant[], state);
    // All in-radius enemies took damage
    const dmgHighT = hpBeforeHighT - highT.currentHP;
    const dmg1 = hpBeforeE1 - e1.currentHP;
    const dmg2 = hpBeforeE2 - e2.currentHP;
    assert(`highT (center) took damage in 5d10 range (5-50): got ${dmgHighT}`,
      dmgHighT >= 5 && dmgHighT <= 50);
    assert(`e1 took damage in 5d10 range (5-50): got ${dmg1}`, dmg1 >= 5 && dmg1 <= 50);
    assert(`e2 took damage in 5d10 range (5-50): got ${dmg2}`, dmg2 >= 5 && dmg2 <= 50);
    // Out-of-radius enemy took NO damage
    eq('e_out (out of 60-ft radius) takes no damage', hpBeforeOut - e_out.currentHP, 0);
    // Only 3 damage logs (not 4)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Only 3 damage logs (no spillover)', dmgLogs.length, 3);
  }
}

// ---- 6. execute — 1000-ft range coverage -----------------------

console.log('\n=== 6. execute — 1000-ft range coverage ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Enemy at (200,0,0) = 1000 ft away — exactly at the range boundary
  // (1000 ft ≤ 1000 ft → in range). Cast Ravenous Void: it should hit.
  const enemy = makeEnemy('e_far', { x: 200, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns target at exactly 1000 ft (boundary)', targets !== null);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage applied to enemy at 1000 ft: got ${dmgDealt}`,
      dmgDealt >= 5 && dmgDealt <= 50);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/ravenous_void') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 5d10 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 5 (got ${min})`, min >= 5);
  assert(`rollDamage max <= 50 (got ${max})`, max <= 50);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
