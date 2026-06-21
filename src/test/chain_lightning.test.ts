// ============================================================
// chain_lightning.test.ts — Chain Lightning bespoke spell module (Session 24)
// PHB p.221: 6th-level evocation, action, range 150 ft, NO concentration.
// Effect (v1): AUTO-HIT 10d8 lightning to up to 4 targets (1 primary + 3
// arcs within 30 ft of primary). Per the plan, v1 reclassifies the canon
// DEX save as auto-hit (chainLightningAutoHitV1PerPlan: true). No save, no
// attack roll — each target always takes the damage.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors magic_missile's auto-hit + fireball's multi-target. shouldCast
// returns up to 4 Combatants (primary = highest-threat enemy within 150 ft
// of caster; arcs = up to 3 nearest enemies within 30 ft of primary).
// Uses withSlots6.
//
// AUTO-HIT tests use no DC/save — execute always applies 10d8 lightning
// to each target. Damage range 10-80 per target.
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/chain_lightning';
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

function withSlots6(remaining = 2): PlayerResources {
  return { spellSlots: { 6: { max: 2, remaining } } };
}

/**
 * Chain Lightning action. attackType: 'save' is fine (the spell ignores it —
 * there's no save and no attack roll in execute). saveDC: null. hitBonus: null.
 * The execute path uses neither.
 */
const CL_ACTION: Action = {
  name: 'Chain Lightning',
  isMultiattack: false,
  attackType: 'save',     // ignored by execute (auto-hit, no save)
  reach: 5,
  range: { normal: 150, long: 150 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,           // no save
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 6,
  costType: 'action',
  legendaryCost: 0,
  description: 'Chain Lightning (AUTO-HIT 10d8 lightning to 1 primary + 3 arcs)',
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

/** Sorcerer at pos (0,0,0) with Chain Lightning + 2 6th-level slots. */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = CL_ACTION): Combatant {
  return makeCombatant('sorc', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots6(2),
  });
}

/** Enemy within 150-ft range when at (1,0,0). */
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

eq('Name is Chain Lightning', metadata.name, 'Chain Lightning');
eq('Level is 6', metadata.level, 6);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 150 ft', metadata.rangeFt, 150);
eq('Max targets is 4 (1 primary + 3 arcs)', metadata.maxTargets, 4);
eq('Arc range is 30 ft', metadata.arcRangeFt, 30);
eq('Die count is 10', metadata.dieCount, 10);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is lightning', metadata.damageType, 'lightning');
eq('Not concentration', metadata.concentration, false);
eq('Auto-hit v1 flag set', metadata.chainLightningAutoHitV1PerPlan, true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Chain Lightning action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots6(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Chain Lightning action', shouldCast(caster, bf), null);
}
// 2b. No 6th-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [CL_ACTION], resources: withSlots6(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 6th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 150 ft range
  const enemy = makeEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with 1 target (primary only, no arcs)
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target (primary only, no arcs)', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast target selection (primary + 3 arcs within 30 ft) ----

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Primary is highest-threat enemy within 150 ft; arcs are 3 nearest within 30 ft of primary.
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // Primary: highT at (5,0,0) = 25 ft from caster, maxHP 300 (highest threat)
  const highT = makeEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  // Arcs: 3 nearby enemies within 30 ft of highT
  const arc1 = makeEnemy('arc1', { x: 6, y: 0, z: 0 }, { maxHP: 50 }); // 5 ft from highT
  const arc2 = makeEnemy('arc2', { x: 7, y: 0, z: 0 }, { maxHP: 50 }); // 10 ft from highT
  const arc3 = makeEnemy('arc3', { x: 8, y: 0, z: 0 }, { maxHP: 50 }); // 15 ft from highT
  const bf = makeBF([caster, highT, arc1, arc2, arc3]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    eq('Returns 4 targets (primary + 3 arcs)', (result as Combatant[]).length, 4);
    eq('Primary is highT (first in array)', (result as Combatant[])[0].id, 'highT');
    assert('arc1 (within 30 ft) in targets', ids.includes('arc1'));
    assert('arc2 (within 30 ft) in targets', ids.includes('arc2'));
    assert('arc3 (within 30 ft) in targets', ids.includes('arc3'));
  }
}

// 3b. Enemy beyond 30 ft of primary is NOT caught as an arc (but may be a different primary candidate)
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // Primary: only enemy in range → no arcs
  const primary = makeEnemy('primary', { x: 1, y: 0, z: 0 }, { maxHP: 300 });
  // 7 squares (35 ft) from primary → OUTSIDE 30-ft arc range
  const outOfArc = makeEnemy('outOfArc', { x: 8, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, primary, outOfArc]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    // Primary is highest-threat (primary at maxHP 300); outOfArc at maxHP 50 cannot be primary
    eq('Primary is selected (maxHP 300)', (result as Combatant[])[0].id, 'primary');
    assert('outOfArc (35 ft from primary, OUTSIDE 30-ft arc range) NOT in targets',
      !ids.includes('outOfArc'));
    eq('Only 1 target (no arcs within 30 ft of primary)', (result as Combatant[]).length, 1);
  }
}

// 3c. 4+ enemies within 30 ft of primary → cap at 3 arcs (4 total max)
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const primary = makeEnemy('primary', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  // 4 nearby enemies — but only 3 arcs allowed (maxTargets 4 = 1 primary + 3 arcs)
  const arc1 = makeEnemy('arc1', { x: 6, y: 0, z: 0 }, { maxHP: 50 });
  const arc2 = makeEnemy('arc2', { x: 7, y: 0, z: 0 }, { maxHP: 50 });
  const arc3 = makeEnemy('arc3', { x: 8, y: 0, z: 0 }, { maxHP: 50 });
  const arc4 = makeEnemy('arc4', { x: 9, y: 0, z: 0 }, { maxHP: 50 }); // 20 ft from primary
  const bf = makeBF([caster, primary, arc1, arc2, arc3, arc4]);
  const result = shouldCast(caster, bf);
  if (result) {
    // Cap at 4 targets total (primary + 3 nearest arcs).
    eq('Caps at 4 targets (primary + 3 nearest arcs)', (result as Combatant[]).length, 4);
    // The 3 NEAREST arcs (arc1, arc2, arc3 at 5/10/15 ft) are picked; arc4 (20 ft) is dropped
    const ids = (result as Combatant[]).map(c => c.id);
    assert('arc1 (5 ft from primary) in targets', ids.includes('arc1'));
    assert('arc2 (10 ft from primary) in targets', ids.includes('arc2'));
    assert('arc3 (15 ft from primary) in targets', ids.includes('arc3'));
    assert('arc4 (20 ft from primary) NOT in targets (4-target cap)', !ids.includes('arc4'));
  }
}

// 3d. Highest-threat enemy is the primary (not just nearest)
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const lowT = makeEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    // highT is primary (maxHP 300); lowT is within 30 ft of highT (4 squares = 20 ft) → arc
    eq('Primary is highT (highest threat)', (result as Combatant[])[0].id, 'highT');
    const ids = (result as Combatant[]).map(c => c.id);
    assert('lowT (within 30 ft of highT) included as arc', ids.includes('lowT'));
  }
}

// ---- 4. execute — auto-hit (damage ALWAYS applied; no save, no attack) ----

console.log('\n=== 4. execute — auto-hit (damage ALWAYS applied) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 4 targets: primary + 3 arcs. Give them 1000 HP to survive 10d8 (avg 45).
  const primary = makeEnemy('primary', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const arc1 = makeEnemy('arc1', { x: 6, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const arc2 = makeEnemy('arc2', { x: 7, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const arc3 = makeEnemy('arc3', { x: 8, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, primary, arc1, arc2, arc3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 4 targets', targets !== null && (targets as Combatant[]).length === 4);
  if (targets) {
    const hpBeforePrimary = primary.currentHP;
    const hpBeforeArc1 = arc1.currentHP;
    const hpBeforeArc2 = arc2.currentHP;
    const hpBeforeArc3 = arc3.currentHP;
    execute(caster, targets as Combatant[], state);

    // 4a. Slot consumed
    eq('Slot consumed (6th level: 2 → 1)',
      (caster.resources as any).spellSlots[6].remaining, 1);
    // 4b. Damage applied to each target (10d8 range 10-80)
    const dmgPrimary = hpBeforePrimary - primary.currentHP;
    const dmgArc1 = hpBeforeArc1 - arc1.currentHP;
    const dmgArc2 = hpBeforeArc2 - arc2.currentHP;
    const dmgArc3 = hpBeforeArc3 - arc3.currentHP;
    assert(`Primary damage in 10d8 range (10-80): got ${dmgPrimary}`,
      dmgPrimary >= 10 && dmgPrimary <= 80);
    assert(`Arc1 damage in 10d8 range (10-80): got ${dmgArc1}`,
      dmgArc1 >= 10 && dmgArc1 <= 80);
    assert(`Arc2 damage in 10d8 range (10-80): got ${dmgArc2}`,
      dmgArc2 >= 10 && dmgArc2 <= 80);
    assert(`Arc3 damage in 10d8 range (10-80): got ${dmgArc3}`,
      dmgArc3 >= 10 && dmgArc3 <= 80);
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
    eq('4 damage logs emitted (one per target)', dmgLogs.length, 4);
    // 4f. No condition rider for Chain Lightning
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — multi-target spillover (4 targets, no extras) ----

console.log('\n=== 5. execute — multi-target (no spillover beyond 4) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 5 clustered enemies within 30 ft of primary, but shouldCast caps at 4
  const primary = makeEnemy('primary', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const arc1 = makeEnemy('arc1', { x: 6, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const arc2 = makeEnemy('arc2', { x: 7, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const arc3 = makeEnemy('arc3', { x: 8, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const arc4 = makeEnemy('arc4', { x: 9, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, primary, arc1, arc2, arc3, arc4]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns at most 4 targets', targets !== null && (targets as Combatant[]).length === 4);
  if (targets) {
    const hpBeforeArc4 = arc4.currentHP;
    execute(caster, targets as Combatant[], state);
    // arc4 (4th arc, dropped by 4-target cap) takes NO damage
    const dmgArc4 = hpBeforeArc4 - arc4.currentHP;
    eq('arc4 (dropped by 4-target cap) takes no damage', dmgArc4, 0);
    // Only 4 damage logs (not 5)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Only 4 damage logs (no spillover beyond cap)', dmgLogs.length, 4);
  }
}

// ---- 6. execute — single-target (only primary in range) --------

console.log('\n=== 6. execute — single-target (no arcs) ===\n');

{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const primary = makeEnemy('primary', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // No other enemies within 30 ft of primary (next nearest is 100+ ft away)
  const far = makeEnemy('far', { x: 50, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, primary, far]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBeforePrimary = primary.currentHP;
    const hpBeforeFar = far.currentHP;
    execute(caster, targets as Combatant[], state);
    const dmgPrimary = hpBeforePrimary - primary.currentHP;
    const dmgFar = hpBeforeFar - far.currentHP;
    assert(`Primary took damage in 10d8 range (10-80): got ${dmgPrimary}`,
      dmgPrimary >= 10 && dmgPrimary <= 80);
    eq('far (out of arc range) takes no damage', dmgFar, 0);
    // Only 1 damage log
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Only 1 damage log (single target)', dmgLogs.length, 1);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeSorcerer();
  let cleanupOk = true;
  try { (require('../spells/chain_lightning') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 10d8 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 10 (got ${min})`, min >= 10);
  assert(`rollDamage max <= 80 (got ${max})`, max <= 80);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
