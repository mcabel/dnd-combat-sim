// ============================================================
// mind_spike.test.ts — Mind Spike bespoke spell module (Session 24)
// XGE p.162: 2nd-level divination, action, range 60 ft, v1 one-shot
// (canon concentration simplified). WIS save. On fail: 3d8 psychic.
// On success: half.
//
// Mirrors catapult.test.ts / wardaway.test.ts (single-target save)
// but with WIS save, 3d8 psychic, L2 slot, 60-ft range.
//
// Deterministic save outcomes:
//   - WIS 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - WIS 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/mind_spike';
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

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const MIND_SPIKE_ACTION: Action = {
  name: 'Mind Spike',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (WIS 1 → max 15 < 25)
  saveAbility: 'wis',
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Mind Spike (WIS save, 3d8 psychic, 60-ft range, single-target)',
};

const MIND_SPIKE_ACTION_LOW_DC: Action = { ...MIND_SPIKE_ACTION, saveDC: 5 };

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1,
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
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 60, height: 60, depth: 1,
    cells: new Map(), round: 1,
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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = MIND_SPIKE_ACTION): Combatant {
  return makeCombatant('wiz', { name: 'Caster', pos, actions: [action], resources: withSlots2(2) });
}

function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...overrides });
}

function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...overrides });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');
eq('Name is Mind Spike', metadata.name, 'Mind Spike');
eq('Level is 2', metadata.level, 2);
eq('School is divination', metadata.school, 'divination');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 3', metadata.dieCount, 3);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is psychic', metadata.damageType, 'psychic');
eq('Save ability is wis', metadata.saveAbility, 'wis');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots2(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when caster lacks Mind Spike action', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCombatant('wiz', { actions: [MIND_SPIKE_ACTION], resources: withSlots2(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when no 2nd-level slots', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft > 60 ft
  eq('Returns null when no enemies in range', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const result = shouldCast(caster, makeBF([caster, enemy]));
  assert('Returns non-null when enemy in range', result !== null);
  if (result) {
    eq('Returns the single enemy (Combatant, NOT array)', (result as Combatant).id, 'e1');
    assert('Result is a Combatant (has .id, no .length)', typeof (result as any).id === 'string' && !Array.isArray(result));
  }
}

// ---- 3. shouldCast target selection ---------------------------

console.log('\n=== 3. shouldCast target selection ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const result = shouldCast(caster, makeBF([caster, lowT, highT]));
  if (result) eq('Picks highest-threat enemy within 60 ft', (result as Combatant).id, 'highT');
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const oor = makeWeakEnemy('oor', { x: 13, y: 0, z: 0 }, { maxHP: 999 }); // 65 ft > 60
  const inRange = makeWeakEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const result = shouldCast(caster, makeBF([caster, oor, inRange]));
  if (result) eq('Picks in-range enemy (not the 65-ft one)', (result as Combatant).id, 'ir');
}

// ---- 4. execute — guaranteed fail (full damage) ----------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);
    eq('Slot consumed (2nd level: 2 → 1)', (caster.resources as any).spellSlots[2].remaining, 1);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 3d8 range (3-24): got ${dmgDealt}`, dmgDealt >= 3 && dmgDealt <= 24);
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    assert('Save-fail log emitted (WIS 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter(e => e.type === 'damage');
    assert('Damage log emitted', dmgLogs.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage) -------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, MIND_SPIKE_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 1-12 range: got ${dmgDealt}`, dmgDealt >= 1 && dmgDealt <= 12);
    const saveSuccess = state.log.events.filter(e => e.type === 'save_success');
    assert('Save-success log emitted (WIS 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — single-target (no spillover) ----------------

console.log('\n=== 6. execute — single-target (no spillover) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  if (target) {
    const h1 = e1.currentHP, h2 = e2.currentHP, h3 = e3.currentHP;
    execute(caster, target as Combatant, state);
    const damaged = [h1 - e1.currentHP, h2 - e2.currentHP, h3 - e3.currentHP].filter(d => d > 0).length;
    eq('Exactly 1 enemy took damage (single-target)', damaged, 1);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let ok = true;
  try { (require('../spells/mind_spike') as any).cleanup(caster); } catch { ok = false; }
  assert('cleanup() does not throw', ok);
}

// ---- 8. rollDamage respects 3d8 --------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 3 (got ${min})`, min >= 3);
  assert(`rollDamage max <= 24 (got ${max})`, max <= 24);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
