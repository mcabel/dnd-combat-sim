// ============================================================
// power_word_stun.test.ts — Power Word Stun bespoke spell module
// (Session 25 / Batch 2)
// PHB p.267: 8th-level enchantment, action, range 60 ft, NO save, NO
// attack. Stunned if currentHP ≤ 150. NO concentration.
//
// Mirrors power_word_kill.test.ts (HP-gate pattern) but applies
// stunned (not instakill).
// ============================================================

import { shouldCast, execute, metadata } from '../spells/power_word_stun';
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

function withSlots8(remaining = 1): PlayerResources {
  return { spellSlots: { 8: { max: 1, remaining } } };
}

const PWS_ACTION: Action = {
  name: 'Power Word Stun',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: true,
  requiresConcentration: false,
  slotLevel: 8,
  costType: 'action',
  legendaryCost: 0,
  description: 'Power Word Stun (no save, stunned if HP ≤ 150, 60-ft range)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 200, currentHP: 200, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, cr: 1,
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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wiz', { name: 'Caster', pos, actions: [PWS_ACTION], resources: withSlots8(1) });
}

function makeEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');
eq('Name is Power Word Stun', metadata.name, 'Power Word Stun');
eq('Level is 8', metadata.level, 8);
eq('School is enchantment', metadata.school, 'enchantment');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('HP threshold is 150', metadata.hpThreshold, 150);
eq('Not concentration', metadata.concentration, false);
eq('Save ability is null (no save)', metadata.saveAbility, null);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots8(1) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { currentHP: 100 });
  eq('Returns null when caster lacks Power Word Stun action', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCombatant('wiz', { actions: [PWS_ACTION], resources: withSlots8(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { currentHP: 100 });
  eq('Returns null when no 8th-level slots', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { currentHP: 200 }); // > 150
  eq('Returns null when no enemies ≤ 150 HP in range', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 50, y: 0, z: 0 }, { currentHP: 100 }); // 250 ft > 60
  eq('Returns null when enemy out of range', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { currentHP: 100 });
  const result = shouldCast(caster, makeBF([caster, enemy]));
  assert('Returns non-null when enemy ≤ 150 HP in range', result !== null);
  if (result) eq('Returns the single enemy', (result as Combatant).id, 'e1');
}

// ---- 3. shouldCast target selection ---------------------------

console.log('\n=== 3. shouldCast target selection ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowHP = makeEnemy('lowHP', { x: 1, y: 0, z: 0 }, { currentHP: 50, maxHP: 50 });
  const highHP = makeEnemy('highHP', { x: 5, y: 0, z: 0 }, { currentHP: 145, maxHP: 145 });
  const result = shouldCast(caster, makeBF([caster, lowHP, highHP]));
  if (result) eq('Picks highest-current-HP enemy ≤ 150', (result as Combatant).id, 'highHP');
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const stunned = makeEnemy('stunned', { x: 1, y: 0, z: 0 }, { currentHP: 100 });
  stunned.conditions.add('stunned' as Condition);
  const fresh = makeEnemy('fresh', { x: 5, y: 0, z: 0 }, { currentHP: 90 });
  const result = shouldCast(caster, makeBF([caster, stunned, fresh]));
  if (result) eq('Skips already-stunned enemy', (result as Combatant).id, 'fresh');
}

// ---- 4. execute — HP ≤ 150 → stunned ---------------------------

console.log('\n=== 4. execute — HP ≤ 150 → stunned ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { currentHP: 120, maxHP: 200 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    execute(caster, target as Combatant, state);
    eq('Slot consumed (8th level: 1 → 0)', (caster.resources as any).spellSlots[8].remaining, 0);
    assert('Stunned applied', enemy.conditions.has('stunned'));
    eq('Enemy HP unchanged (no damage)', enemy.currentHP, 120);
    const condLogs = state.log.events.filter(e => e.type === 'condition_add');
    assert('condition_add log emitted', condLogs.length >= 1);
  }
}

// ---- 5. execute — HP > 150 → no effect (slot still consumed) ---

console.log('\n=== 5. execute — HP > 150 → no effect ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Enemy at 100 HP at plan time, healed to 200 by execute time.
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { currentHP: 100, maxHP: 300 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  if (target) {
    enemy.currentHP = 200;  // healed above threshold between planTurn and execute
    execute(caster, target as Combatant, state);
    eq('Slot still consumed', (caster.resources as any).spellSlots[8].remaining, 0);
    assert('NOT stunned (HP > 150)', !enemy.conditions.has('stunned'));
    const noEffect = state.log.events.filter(e => e.description.includes('NO EFFECT'));
    assert('NO EFFECT log emitted', noEffect.length === 1);
  }
}

// ---- 6. execute — already-down target -------------------------

console.log('\n=== 6. execute — already-down target ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { currentHP: 100 });
  enemy.isUnconscious = true;
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  // shouldCast skips unconscious, so call execute directly with the enemy.
  execute(caster, enemy, state);
  eq('Slot consumed', (caster.resources as any).spellSlots[8].remaining, 0);
  assert('NOT stunned (already down)', !enemy.conditions.has('stunned'));
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let ok = true;
  try { (require('../spells/power_word_stun') as any).cleanup(caster); } catch { ok = false; }
  assert('cleanup() does not throw', ok);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
