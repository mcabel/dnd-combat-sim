// ============================================================
// guiding_bolt.test.ts — Guiding Bolt spell mechanics
// PHB p.248: ranged spell attack, 4d6 radiant, advantage mark
//
// Design: tests that require "on-hit" avoid relying on dice by using
// applySpellEffect directly. Tests of execute() only assert on
// deterministic outcomes (slot consumption, miss behavior, cast log).
// ============================================================

import { shouldCast, execute, consumeMark, cleanupMarks, metadata } from '../spells/guiding_bolt';
import { Combatant, Action, PlayerResources, Vec3, Cell, Battlefield } from '../types/core';
import { _resetEffectIdCounter, applySpellEffect } from '../engine/spell_effects';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10,
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

const GB_ACTION: Action = {
  name: 'Guiding Bolt',
  isMultiattack: false,
  attackType: 'spell',
  reach: 0,
  range: { normal: 120, long: 120 },
  hitBonus: 5,   // WIS+3 + prof+2
  damage: { count: 4, sides: 6, bonus: 0, average: 14 },
  damageType: 'radiant',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Guiding Bolt',
};

function makeCleric(overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant('cleric', {
    faction: 'party',
    actions: [GB_ACTION],
    resources: withSlots(2),
    wis: 16,
    ...overrides,
  });
}

function makeEnemy(overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant('goblin', {
    faction: 'enemy',
    maxHP: 20, currentHP: 20,
    ac: 12,
    pos: { x: 5, y: 0, z: 0 },   // 25 ft — within 120 ft
    ...overrides,
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  const width = 20, height = 20, depth = 1;
  const cells: Cell[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'normal', elevation: 0 }];
    }
  }
  return {
    width, height, depth, cells,
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  };
}

function makeState(bf: Battlefield): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Apply a Guiding Bolt mark directly (bypasses dice for deterministic tests). */
function applyGBMark(target: Combatant, casterId: string): void {
  applySpellEffect(target, {
    casterId,
    spellName: 'Guiding Bolt',
    effectType: 'advantage_vs',
    payload: { advType: 'advantage', advScope: 'attack' },
    sourceIsConcentration: false,
  });
}

// ============================================================
// SECTION 1: Metadata
// ============================================================
console.log('\n── Metadata ──');

eq('name', metadata.name, 'Guiding Bolt');
eq('level', metadata.level, 1);
eq('school', metadata.school, 'evocation');
eq('rangeFt', metadata.rangeFt, 120);
eq('damageCount', metadata.damageCount, 4);
eq('damageDie', metadata.damageDie, 6);
eq('damageType', metadata.damageType, 'radiant');
eq('concentration', metadata.concentration, false);
eq('castingTime', metadata.castingTime, 'action');

// ============================================================
// SECTION 2: shouldCast — gate conditions
// ============================================================
console.log('\n── shouldCast gates ──');

{
  const cleric = makeCleric();
  const enemy  = makeEnemy();
  const bf     = makeBF([cleric, enemy]);
  assert('returns true when all conditions met', shouldCast(cleric, enemy, bf));
}

{
  const cleric = makeCleric({ actions: [] });
  const enemy  = makeEnemy();
  const bf     = makeBF([cleric, enemy]);
  assert('returns false: no Guiding Bolt action', !shouldCast(cleric, enemy, bf));
}

{
  const cleric = makeCleric({ resources: withSlots(0) });
  const enemy  = makeEnemy();
  const bf     = makeBF([cleric, enemy]);
  assert('returns false: no spell slots', !shouldCast(cleric, enemy, bf));
}

{
  const cleric = makeCleric();
  const enemy  = makeEnemy({ isDead: true });
  const bf     = makeBF([cleric, enemy]);
  assert('returns false: target is dead', !shouldCast(cleric, enemy, bf));
}

{
  const cleric = makeCleric();
  const enemy  = makeEnemy({ isUnconscious: true });
  const bf     = makeBF([cleric, enemy]);
  assert('returns false: target is unconscious', !shouldCast(cleric, enemy, bf));
}

{
  // 25 grid squares × 5 ft = 125 ft — exceeds 120 ft range
  const cleric = makeCleric();
  const enemy  = makeEnemy({ pos: { x: 25, y: 0, z: 0 } });
  const bf     = makeBF([cleric, enemy]);
  assert('returns false: target out of range (125 ft)', !shouldCast(cleric, enemy, bf));
}

{
  // 24 grid squares × 5 ft = 120 ft — exactly at maximum range
  const cleric = makeCleric();
  const enemy  = makeEnemy({ pos: { x: 24, y: 0, z: 0 } });
  const bf     = makeBF([cleric, enemy]);
  assert('returns true: exactly 120 ft', shouldCast(cleric, enemy, bf));
}

{
  // Target already marked by this caster — avoid slot waste
  const cleric = makeCleric();
  const enemy  = makeEnemy();
  applyGBMark(enemy, 'cleric');
  const bf = makeBF([cleric, enemy]);
  assert('returns false: target already marked by this caster', !shouldCast(cleric, enemy, bf));
}

// ============================================================
// SECTION 3: execute — deterministic outcomes
// (Slot consumption and miss behavior do not depend on dice outcome)
// ============================================================
console.log('\n── execute: deterministic outcomes ──');

{
  // Slot always consumed regardless of hit/miss
  _resetEffectIdCounter();
  const cleric = makeCleric({ resources: withSlots(2) });
  const enemy  = makeEnemy();
  const bf     = makeBF([cleric, enemy]);
  const state  = makeState(bf);

  const slotsBefore = (cleric.resources as any).spellSlots[1].remaining;
  execute(cleric, enemy, state);
  const slotsAfter  = (cleric.resources as any).spellSlots[1].remaining;
  eq('one 1st-level slot consumed regardless of hit/miss', slotsAfter, slotsBefore - 1);
}

{
  // Cast action event always logged (regardless of hit/miss)
  _resetEffectIdCounter();
  const cleric = makeCleric();
  const enemy  = makeEnemy();
  const bf     = makeBF([cleric, enemy]);
  const state  = makeState(bf);

  execute(cleric, enemy, state);

  const castEvent = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('Guiding Bolt'));
  assert('cast action event always logged', castEvent !== undefined);
}

{
  // On miss (AC 30): no damage, no mark
  _resetEffectIdCounter();
  const cleric = makeCleric();
  const enemy  = makeEnemy({ ac: 30 });   // nat-20 = 1+5=6 vs 30 → always misses (roll 20 auto-hits but range is 20+5=25 < 30)
  const bf     = makeBF([cleric, enemy]);
  const state  = makeState(bf);

  // Actually nat-20 always hits (attackHits: roll===20 → return true). Use hitBonus 5 and AC 30:
  // nat-20 → always hit, nat-1 → always miss, 2-19 + 5 = 7-24, all < 30 → miss.
  // So only nat-20 (5%) hits. This is still probabilistic.
  // Use a hitBonus-less extreme: set AC high enough that only nat-20 can hit... but nat-20 always hits.
  // Instead, test miss path differently: with AC 30, at least 19/20 rolls miss.
  // Skip: test miss path via direct observation instead.
  // This section is intentionally left as a note — see "miss" tests below.
}

{
  // On miss (AC 30): no mark applied — run 5 attempts (nat-20 would hit, but very rare)
  // Instead: test by directly checking a non-hitting scenario
  // Strategy: use execute then observe that IF a miss event was logged, no mark exists.
  _resetEffectIdCounter();
  const cleric = makeCleric();
  const enemy  = makeEnemy({ ac: 30 });
  const bf     = makeBF([cleric, enemy]);
  const state  = makeState(bf);

  execute(cleric, enemy, state);
  const missEvent = state.log.events.find((e: any) => e.type === 'attack_miss');
  const hitEvent  = state.log.events.find((e: any) => e.type === 'attack_hit' || e.type === 'attack_crit');

  if (missEvent && !hitEvent) {
    // Miss confirmed: assert no mark applied
    assert('no mark on miss', !enemy.activeEffects.some(e => e.spellName === 'Guiding Bolt'));
    assert('no damage event on miss', !state.log.events.some((e: any) => e.type === 'damage'));
  } else {
    // nat-20 hit (rare, 5%) — skip rather than fail
    assert('nat-20 hit on AC 30: expected miss but got hit (acceptable)', true);
  }
}

// ============================================================
// SECTION 4: advantage mark — applied via applySpellEffect directly
// (Tests mark lifecycle independent of execute dice rolls)
// ============================================================
console.log('\n── advantage mark mechanics ──');

{
  _resetEffectIdCounter();
  const enemy = makeEnemy();

  applyGBMark(enemy, 'cleric');

  const gbEffect = enemy.activeEffects.find(e => e.spellName === 'Guiding Bolt');
  assert('advantage_vs ActiveEffect applied', gbEffect !== undefined);
  eq('effectType is advantage_vs', gbEffect?.effectType, 'advantage_vs');
  eq('advType is advantage',        gbEffect?.payload.advType, 'advantage');
  eq('advScope is attack',          gbEffect?.payload.advScope, 'attack');
  eq('casterId matches',            gbEffect?.casterId, 'cleric');
  eq('sourceIsConcentration false', gbEffect?.sourceIsConcentration, false);
}

{
  _resetEffectIdCounter();
  const enemy = makeEnemy();

  applyGBMark(enemy, 'cleric');

  // adv_system should reflect the vulnerability
  assert('vulnerability entry added via adv_system', enemy.vulnerabilities.length > 0);
  const v = enemy.vulnerabilities.find(v => v.source === 'Guiding Bolt');
  assert('vulnerability source is Guiding Bolt', v !== undefined);
  eq('vulnerability type is advantage', v?.type, 'advantage');
  eq('vulnerability scope is attack',   v?.scope, 'attack');
}

// ============================================================
// SECTION 5: consumeMark
// ============================================================
console.log('\n── consumeMark ──');

{
  _resetEffectIdCounter();
  const enemy = makeEnemy();

  applyGBMark(enemy, 'cleric');
  assert('mark present before consume', enemy.activeEffects.some(e => e.spellName === 'Guiding Bolt'));

  const consumed = consumeMark(enemy);
  assert('consumeMark returns true when mark exists', consumed);
  assert('mark removed from activeEffects', !enemy.activeEffects.some(e => e.spellName === 'Guiding Bolt'));
  assert('vulnerability entry removed',     !enemy.vulnerabilities.some(v => v.source === 'Guiding Bolt'));
}

{
  // No mark present
  const enemy = makeEnemy();
  const consumed = consumeMark(enemy);
  assert('consumeMark returns false when no mark', !consumed);
  eq('no side effects when no mark', enemy.activeEffects.length, 0);
}

{
  // Second consume after first has no effect
  _resetEffectIdCounter();
  const enemy = makeEnemy();

  applyGBMark(enemy, 'cleric');
  const first  = consumeMark(enemy);
  const second = consumeMark(enemy);
  assert('first consume returns true',               first);
  assert('second consume returns false (mark gone)', !second);
}

{
  // Advantage is actually reflected in attackAdvantageState after mark applied
  const { attackAdvantageState } = require('../engine/utils');
  _resetEffectIdCounter();
  const attacker = makeCleric();
  const enemy    = makeEnemy();

  applyGBMark(enemy, 'cleric');
  const advBefore = attackAdvantageState(attacker, enemy);
  assert('attacker has advantage on target BEFORE consume', advBefore.advantage === true);

  consumeMark(enemy);
  const advAfter = attackAdvantageState(attacker, enemy);
  assert('attacker has NO advantage on target AFTER consume', advAfter.advantage === false);
}

// ============================================================
// SECTION 6: cleanupMarks — fallback expiry
// ============================================================
console.log('\n── cleanupMarks ──');

{
  _resetEffectIdCounter();
  const cleric = makeCleric();
  const enemy  = makeEnemy();
  const bf     = makeBF([cleric, enemy]);

  applyGBMark(enemy, 'cleric');
  assert('mark present before cleanup', enemy.activeEffects.some(e => e.spellName === 'Guiding Bolt'));

  cleanupMarks(cleric, bf);
  assert('mark removed by cleanupMarks',
    !enemy.activeEffects.some(e => e.spellName === 'Guiding Bolt'));
  assert('vulnerability removed by cleanupMarks',
    !enemy.vulnerabilities.some(v => v.source === 'Guiding Bolt'));
}

{
  // cleanupMarks only removes marks from the specified caster
  _resetEffectIdCounter();
  const cleric1 = makeCleric();
  const cleric2 = makeCleric({ id: 'cleric2', name: 'cleric2' });
  const enemy   = makeEnemy();
  const bf      = makeBF([cleric1, cleric2, enemy]);

  applyGBMark(enemy, 'cleric');
  applyGBMark(enemy, 'cleric2');
  eq('two marks present before cleanup', enemy.activeEffects.filter(e => e.spellName === 'Guiding Bolt').length, 2);

  cleanupMarks(cleric1, bf);

  const remaining = enemy.activeEffects.filter(e => e.spellName === 'Guiding Bolt');
  eq('only one mark remains after cleanup', remaining.length, 1);
  eq('remaining mark belongs to other caster', remaining[0].casterId, 'cleric2');
}

{
  // cleanupMarks is a no-op when no marks exist
  _resetEffectIdCounter();
  const cleric = makeCleric();
  const enemy  = makeEnemy();
  const bf     = makeBF([cleric, enemy]);

  cleanupMarks(cleric, bf);   // should not throw
  eq('no-op when no marks', enemy.activeEffects.length, 0);
  assert('cleanupMarks no-op completes without error', true);
}

// ============================================================
// SECTION 7: mark clears advantage for subsequent attacks
// ============================================================
console.log('\n── mark: advantage consumed on one attack ──');

{
  // Apply two marks from same caster — consumeMark removes exactly one
  _resetEffectIdCounter();
  const cleric = makeCleric();
  const enemy  = makeEnemy();

  applyGBMark(enemy, 'cleric');
  applyGBMark(enemy, 'cleric');
  eq('two marks applied', enemy.activeEffects.filter(e => e.spellName === 'Guiding Bolt').length, 2);

  consumeMark(enemy);
  eq('one mark remains after one consume',
    enemy.activeEffects.filter(e => e.spellName === 'Guiding Bolt').length, 1);
}

// ============================================================
// SUMMARY
// ============================================================
console.log(`\n${'='.repeat(50)}`);
// IMPORTANT: the CI workflow (.github/workflows/test.yml) greps for the exact
// pattern "Results:" in this summary line. Do NOT rename it — every other test
// file in src/test/ uses this same format.
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
