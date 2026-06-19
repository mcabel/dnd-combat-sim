// ============================================================
// Test: Blade Ward Cantrip
// PHB p.218 — Level 0 abjuration cantrip (non-attack self-buff)
//
// Tests:
//   1. metadata correctness
//   2. resolveCantripAction — sets _bladeWardActive, returns true
//   3. resolveCantripAction — unknown cantrip returns false (no-op)
//   4. applyDamageWithTempHP — halves B/P/S when _bladeWardActive
//   5. applyDamageWithTempHP — does NOT halve non-physical (fire/cold)
//   6. applyDamageWithTempHP — no halving when flag not set
//   7. non-stacking — Blade Ward + existing resistance = half (not quarter)
//   8. non-stacking — Blade Ward + Warding Bond = half (not quarter)
//   9. resetBudget cleanup clears _bladeWardActive
//
// Run: npx ts-node src/test/blade_ward.test.ts
// ============================================================

import { metadata, applySelfEffect } from '../spells/blade_ward';
import { resolveCantripAction } from '../engine/cantrip_effects';
import { applyDamageWithTempHP, resetBudget } from '../engine/utils';
import { Combatant, PlayerResources, Vec3, Cell, DamageType } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
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

function makeBF(combatants: Combatant[]) {
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

// Damage a target for a fixed amount of a given type and return HP lost.
function dealFixedDamage(target: Combatant, amount: number, type: DamageType): number {
  const before = target.currentHP;
  applyDamageWithTempHP(target, amount, type);
  return before - target.currentHP;
}

// ============================================================
// 1. metadata
// ============================================================
console.log('\n--- 1. metadata ---');
{
  eq('1a. name', metadata.name, 'Blade Ward');
  eq('1b. level (cantrip)', metadata.level, 0);
  eq('1c. school', metadata.school, 'abjuration');
  eq('1d. rangeFt (self = 0)', metadata.rangeFt, 0);
  eq('1e. not concentration', metadata.concentration, false);
  eq('1f. castingTime', metadata.castingTime, 'action');
  eq('1g. no damage dice', metadata.damageDice, null);
  eq('1h. no damage type', metadata.damageType, null);
}

// ============================================================
// 2. resolveCantripAction — sets _bladeWardActive, returns true
// ============================================================
console.log('\n--- 2. resolveCantripAction: sets active flag ---');
{
  const caster = makeCombatant('wizard', { resources: withSlots(1) });
  const bf = makeBF([caster]);
  const state = makeState(bf);

  eq('2a. flag undefined before cast', caster._bladeWardActive, undefined);
  const ret = resolveCantripAction(caster, 'Blade Ward', state);
  eq('2b. returns true', ret, true);
  eq('2c. flag set after cast', caster._bladeWardActive, true);

  const logEntry = state.log.events.find(
    (e: any) => e.type === 'action' && e.description.includes('Blade Ward'),
  );
  assert('2d. cast logged', logEntry !== undefined, 'expected a log event mentioning Blade Ward');
}
{
  // Direct module call also works (used by the registry internally)
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);
  const ret = applySelfEffect(caster, state);
  eq('2e. module applySelfEffect returns true', ret, true);
  eq('2f. flag set via module', caster._bladeWardActive, true);
}

// ============================================================
// 3. resolveCantripAction — unknown cantrip returns false (no-op)
// ============================================================
console.log('\n--- 3. resolveCantripAction: unknown cantrip no-op ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const ret = resolveCantripAction(caster, 'Eldritch Blast', state);
  eq('3a. unknown cantrip returns false', ret, false);
  eq('3b. flag NOT set', caster._bladeWardActive, undefined);
  eq('3c. no log events', state.log.events.length, 0);
}

// ============================================================
// 4. applyDamageWithTempHP — halves B/P/S when _bladeWardActive
// ============================================================
console.log('\n--- 4. damage reduction: halves B/P/S ---');
{
  const types: DamageType[] = ['bludgeoning', 'piercing', 'slashing'];
  for (const t of types) {
    const caster = makeCombatant('wizard', { currentHP: 100, maxHP: 100, _bladeWardActive: true });
    const lost = dealFixedDamage(caster, 10, t);
    eq(`4. ${t}: 10 → ${lost} (expected 5)`, lost, 5);
  }
}

// ============================================================
// 5. applyDamageWithTempHP — does NOT halve non-physical (fire/cold)
// ============================================================
console.log('\n--- 5. damage reduction: ignores non-physical ---');
{
  const types: DamageType[] = ['fire', 'cold', 'necrotic', 'lightning', 'acid', 'poison', 'psychic', 'radiant', 'force', 'thunder'];
  for (const t of types) {
    const caster = makeCombatant('wizard', { currentHP: 100, maxHP: 100, _bladeWardActive: true });
    const lost = dealFixedDamage(caster, 10, t);
    eq(`5. ${t}: 10 → ${lost} (expected 10, no reduction)`, lost, 10);
  }
}

// ============================================================
// 6. applyDamageWithTempHP — no halving when flag not set
// ============================================================
console.log('\n--- 6. no reduction when flag not set ---');
{
  const caster = makeCombatant('wizard', { currentHP: 100, maxHP: 100 });
  // _bladeWardActive undefined
  const lost = dealFixedDamage(caster, 10, 'slashing');
  eq('6a. slashing 10 → 10 (no flag)', lost, 10);
}
{
  const caster = makeCombatant('wizard', { currentHP: 100, maxHP: 100, _bladeWardActive: false });
  const lost = dealFixedDamage(caster, 10, 'bludgeoning');
  eq('6b. bludgeoning 10 → 10 (flag false)', lost, 10);
}

// ============================================================
// 7. non-stacking — Blade Ward + existing resistance = half (not quarter)
// ============================================================
console.log('\n--- 7. non-stacking: Blade Ward + Rage resistance ---');
{
  // Simulate a Barbarian with Rage (B/P/S in resistances) AND Blade Ward active.
  // PHB p.197: two sources of the same resistance = half, NOT quarter.
  const barb = makeCombatant('barbarian', {
    currentHP: 100, maxHP: 100,
    _bladeWardActive: true,
    resistances: ['bludgeoning', 'piercing', 'slashing'],
  });
  const lost = dealFixedDamage(barb, 16, 'slashing');
  eq('7a. Rage + Blade Ward: 16 → 8 (half, not quarter)', lost, 8);
}

// ============================================================
// 8. non-stacking — Blade Ward + Warding Bond = half (not quarter)
// ============================================================
console.log('\n--- 8. non-stacking: Blade Ward + Warding Bond ---');
{
  const bonded = makeCombatant('paladin', {
    currentHP: 100, maxHP: 100,
    _bladeWardActive: true,
    wardingBond: { casterId: 'cleric' }, // Warding Bond grants resistance to ALL
  });
  const lost = dealFixedDamage(bonded, 16, 'slashing');
  eq('8a. Warding Bond + Blade Ward: 16 → 8 (half, not quarter)', lost, 8);
  const lostFire = dealFixedDamage(bonded, 16, 'fire');
  eq('8b. Warding Bond resists fire too: 16 → 8', lostFire, 8);
}

// ============================================================
// 9. resetBudget cleanup clears _bladeWardActive
// ============================================================
console.log('\n--- 9. resetBudget cleanup ---');
{
  const caster = makeCombatant('wizard');
  const bf = makeBF([caster]);
  const state = makeState(bf);

  resolveCantripAction(caster, 'Blade Ward', state);
  eq('9a. flag set after cast', caster._bladeWardActive, true);

  // Start of caster's next turn — resetBudget clears the flag
  resetBudget(caster);
  eq('9b. flag cleared after resetBudget', caster._bladeWardActive, undefined);

  // Damage is no longer reduced
  caster.currentHP = 100; caster.maxHP = 100;
  const lost = dealFixedDamage(caster, 10, 'slashing');
  eq('9c. slashing no longer reduced after cleanup', lost, 10);
}

// ============================================================
// Results ----------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
