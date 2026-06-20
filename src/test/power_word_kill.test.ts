// ============================================================
// power_word_kill.test.ts — Power Word Kill bespoke spell module (Session 23)
// PHB p.266: 9th-level enchantment, action, range 60 ft, NO concentration.
// Effect: NO save, NO attack. If target's currentHP ≤ 100, it dies instantly.
//         If currentHP > 100, the spell has NO effect (slot still consumed).
//
// Migrated from the Session 19 generic dispatch registry in Session 23.
// This is the FIRST spell in v1 with NO save AND NO attack roll — the
// effect is purely an HP check. Mirrors catapult.test.ts's shape
// (shouldCast → Combatant | null, execute → void) but the execute body
// sets HP=0 + isDead instead of rolling a save.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/power_word_kill';
import { Combatant, Action, PlayerResources, Vec3, Condition } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function withSlots9(remaining = 1): PlayerResources {
  return { spellSlots: { 9: { max: 1, remaining } } };
}

const PWK_ACTION: Action = {
  name: 'Power Word Kill',
  isMultiattack: false,
  attackType: null,          // PHB p.266: NO attack roll
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,              // PHB p.266: NO damage roll (instakill)
  damageType: null,
  saveDC: null,              // PHB p.266: NO save
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 9,
  costType: 'action',
  legendaryCost: 0,
  description: 'Power Word Kill (no save, no attack — instakill if HP ≤ 100)',
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

function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [PWK_ACTION],
    resources: withSlots9(1),
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

eq('Name is Power Word Kill', metadata.name, 'Power Word Kill');
eq('Level is 9', metadata.level, 9);
eq('School is enchantment', metadata.school, 'enchantment');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('HP threshold is 100', metadata.hpThreshold, 100);
eq('Not concentration', metadata.concentration, false);
eq('Save ability is null (no save)', metadata.saveAbility, null);
// NEW pattern flags
assert('No save, no attack flag set', metadata.powerWordKillNoSaveNoAttack === true);
assert('HP threshold 100 flag set', metadata.powerWordKillThreshold100Hp === true);
assert('Effect implemented flag set', metadata.powerWordKillEffectV1Implemented === true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No PWK action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots9(1) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Power Word Kill action', shouldCast(caster, bf), null);
}
// 2b. No 9th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [PWK_ACTION], resources: withSlots9(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 9th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 50, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 }); // 250 ft > 60 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Enemy with HP > 100 → null (HP gate)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 200, currentHP: 150 }); // 150 > 100
  const bf = makeBF([caster, enemy]);
  eq('Returns null when enemy HP > 100 (HP gate)', shouldCast(caster, bf), null);
}
// 2e. Enemy with HP ≤ 100 → returns enemy
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 200, currentHP: 80 }); // 80 ≤ 100
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy HP ≤ 100', result !== null);
  if (result) eq('Target is the enemy', result.id, 'e1');
}
// 2f. Enemy with HP exactly 100 → returns enemy (boundary)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy HP = 100 (boundary inclusive)', result !== null);
}
// 2g. Enemy with HP exactly 101 → null (boundary)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 200, currentHP: 101 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when enemy HP = 101 (boundary exclusive)', shouldCast(caster, bf), null);
}

// ---- 3. shouldCast target selection (highest-current-HP bias) ---

console.log('\n=== 3. shouldCast target selection (highest-current-HP ≤ 100 bias) ===\n');

// 3a. Among HP ≤ 100 enemies, picks the HIGHEST current HP (maximise kill value)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const lowHp = makeEnemy('lowHp', { x: 1, y: 0, z: 0 }, { maxHP: 50, currentHP: 10 });
  const highHp = makeEnemy('highHp', { x: 2, y: 0, z: 0 }, { maxHP: 200, currentHP: 95 });
  const bf = makeBF([caster, lowHp, highHp]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    // Both ≤ 100; picks the one with higher current HP (95 > 10) — maximise kill value
    eq('Picks highest-current-HP enemy ≤ 100 (95 HP)', result.id, 'highHp');
  }
}
// 3b. Skips HP > 100 enemy, picks HP ≤ 100 enemy
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const tooHigh = makeEnemy('tooHigh', { x: 1, y: 0, z: 0 }, { maxHP: 200, currentHP: 150 });
  const killable = makeEnemy('killable', { x: 2, y: 0, z: 0 }, { maxHP: 80, currentHP: 50 });
  const bf = makeBF([caster, tooHigh, killable]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    eq('Skips HP > 100 enemy, picks HP ≤ 100 enemy', result.id, 'killable');
  }
}
// 3c. Returns a single Combatant (not array)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 50, currentHP: 50 });
  const bf = makeBF([caster, e1, e2]);
  const result = shouldCast(caster, bf);
  assert('Returns a single Combatant (not array)',
    result !== null && !Array.isArray(result));
}

// ---- 4. execute — instakill (monster, HP ≤ 100) ----------------

console.log('\n=== 4. execute — instakill (monster, HP ≤ 100) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 200, currentHP: 80 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed (unconditionally — PHB p.266)
    eq('Slot consumed (9th level: 1 → 0)',
      (caster.resources as any).spellSlots[9].remaining, 0);
    // 4b. Enemy HP set to 0
    eq('Enemy currentHP is 0', enemy.currentHP, 0);
    // 4c. Enemy is dead (monster)
    assert('Enemy isDead = true (monster instakill)', enemy.isDead === true);
    assert('Enemy isUnconscious = true', enemy.isUnconscious === true);
    // 4d. Conditions: unconscious + incapacitated
    assert('Enemy has unconscious condition', enemy.conditions.has('unconscious'));
    assert('Enemy has incapacitated condition', enemy.conditions.has('incapacitated'));
    // 4e. NO save logs (Power Word Kill has no save)
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('No save-fail logs (no save roll)', saveFails.length, 0);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    eq('No save-success logs (no save roll)', saveSuccess.length, 0);
    // 4f. Death log emitted
    const deathLogs = state.log.events.filter((e: any) => e.type === 'death');
    assert('Death log emitted', deathLogs.length === 1);
    if (deathLogs.length === 1) {
      assert('Death log mentions DIES / instant',
        deathLogs[0].description.includes('DIES') || deathLogs[0].description.includes('instant'));
    }
    // 4g. Action log emitted
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted', actions.length >= 1);
  }
}

// ---- 5. execute — no effect (HP > 100, slot still consumed) ----

console.log('\n=== 5. execute — no effect (HP > 100) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Enemy with 150 HP — above threshold. shouldCast would return null,
  // but we force-execute to test the HP re-check inside execute().
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 200, currentHP: 150 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  // Force-execute (bypass shouldCast — simulate a stale plan where the
  // target was healed above 100 between planTurn and executePlannedAction)
  execute(caster, enemy, state);

  // 5a. Slot STILL consumed (PHB p.266: slot spent regardless)
  eq('Slot consumed even when spell has no effect',
    (caster.resources as any).spellSlots[9].remaining, 0);
  // 5b. Enemy NOT killed
  eq('Enemy currentHP unchanged (150)', enemy.currentHP, 150);
  assert('Enemy isDead = false (spell had no effect)', enemy.isDead === false);
  // 5c. Action log emitted (the cast still happens)
  const actions = state.log.events.filter((e: any) => e.type === 'action');
  assert('Action log emitted (cast still logged)', actions.length >= 1);
  // 5d. NO death log
  const deathLogs = state.log.events.filter((e: any) => e.type === 'death');
  eq('No death log (spell had no effect)', deathLogs.length, 0);
  // 5e. At least one action log mentions "NO EFFECT"
  const noEffectLog = actions.some((a: any) => a.description.includes('NO EFFECT'));
  assert('Action log mentions "NO EFFECT"', noEffectLog);
}

// ---- 6. execute — boundary HP (exactly 100, dies) --------------

console.log('\n=== 6. execute — boundary HP (exactly 100) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 100, currentHP: 100 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);
    eq('Enemy at exactly 100 HP dies (boundary inclusive)', enemy.currentHP, 0);
    assert('Enemy isDead = true (100 HP ≤ 100)', enemy.isDead === true);
  }
}

// ---- 7. execute — already-dead target (no-op) -----------------

console.log('\n=== 7. execute — already-dead target ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50, currentHP: 30 });
  enemy.isDead = true;  // pre-dead
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, enemy, state);

  // Slot still consumed
  eq('Slot consumed even on already-dead target',
    (caster.resources as any).spellSlots[9].remaining, 0);
  // Enemy stays dead (no change)
  assert('Enemy still dead', enemy.isDead === true);
  // No death log (already dead — no new death)
  const deathLogs = state.log.events.filter((e: any) => e.type === 'death');
  eq('No death log (already dead)', deathLogs.length, 0);
}

// ---- 8. cleanup is a no-op ------------------------------------

console.log('\n=== 8. cleanup is a no-op ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const hpBefore = caster.currentHP;
  const { cleanup } = require('../spells/power_word_kill');
  cleanup(caster);
  eq('cleanup does not change currentHP', caster.currentHP, hpBefore);
  assert('cleanup does not set isDead', caster.isDead === false);
}

// ---- Summary --------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
