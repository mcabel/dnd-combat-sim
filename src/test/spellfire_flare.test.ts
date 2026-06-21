// ============================================================
// spellfire_flare.test.ts — Spellfire Flare bespoke spell module (Session 24)
// SCAG p.149: 1st-level evocation, action, range 60 ft, NO concentration.
// Effect: AUTO-HIT 2d10 + spellcasting-ability-mod fire damage. NO
// attack roll, NO saving throw — the target always takes the damage.
// This is the FIRST auto-hit SINGLE-TARGET damage spell in v1 (Magic
// Missile is multi-dart; Spellfire Flare is one big auto-hit blast).
//
// v1 simplification: spellcasting mod falls back to abilityMod(caster.cha)
// (Sorcerer primary — SCAG p.149). For cha=10 → mod 0 (damage 2d10, range
// 2-20). For cha=20 → mod +5 (damage 2d10+5, range 7-25).
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors catapult.test.ts shape (shouldCast → Combatant | null,
// execute → (caster, target, state)) but the execute body skips the
// save/attack entirely (like magic_missile.ts). Uses withSlots1.
//
// This is a NEW pattern — the test verifies that:
//   - execute ALWAYS applies damage (no attack roll, no save)
//   - NO attack_hit/attack_miss/attack_crit events are emitted
//   - only 'action' + 'damage' log events appear
//   - rollDamage(includeMod, spellcastingMod) respects the +mod scaling
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/spellfire_flare';
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

function withSlots1(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

/**
 * Spellfire Flare action. attackType: 'save' is fine (the spell ignores
 * it — there's no save and no attack roll in execute). saveDC: null.
 * hitBonus: null. The execute path uses neither.
 */
const SF_ACTION: Action = {
  name: 'Spellfire Flare',
  isMultiattack: false,
  attackType: 'save',     // ignored by execute (auto-hit, no save)
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,           // no save
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Spellfire Flare (AUTO-HIT 2d10+mod fire, no save, no attack)',
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

/** Sorcerer at pos (0,0,0) with Spellfire Flare + 2 1st-level slots. */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = SF_ACTION): Combatant {
  return makeCombatant('sorc', {
    name: 'Sorcerer',
    pos,
    actions: [action],
    resources: withSlots1(2),
  });
}

/** Enemy within 60-ft range when at (1,0,0). */
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

eq('Name is Spellfire Flare', metadata.name, 'Spellfire Flare');
eq('Level is 1', metadata.level, 1);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Die count is 2', metadata.dieCount, 2);
eq('Die sides is 10', metadata.dieSides, 10);
eq('Damage type is fire', metadata.damageType, 'fire');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Spellfire Flare action → null
{
  const caster = makeCombatant('sorc', { actions: [], resources: withSlots1(2) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Spellfire Flare action', shouldCast(caster, bf), null);
}
// 2b. No 1st-level slots → null
{
  const caster = makeCombatant('sorc', { actions: [SF_ACTION], resources: withSlots1(0) });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 60 ft range
  const enemy = makeEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns that enemy (single Combatant)
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  if (result) eq('Returns the single enemy (Combatant, not array)', (result as Combatant).id, 'e1');
}

// ---- 3. shouldCast target selection (single best target) --------

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. Highest-threat enemy within 60 ft is chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const lowT = makeEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks highest-threat enemy within 60 ft (highT)',
      (result as Combatant).id, 'highT');
  }
}
// 3b. Enemy beyond 60 ft is NOT chosen
{
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  // 13 squares away = 65 ft > 60 ft range
  const outOfRange = makeEnemy('oor', { x: 13, y: 0, z: 0 }, { maxHP: 999 });
  const inRange = makeEnemy('ir', { x: 5, y: 0, z: 0 }, { maxHP: 30 });
  const bf = makeBF([caster, outOfRange, inRange]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Picks in-range enemy (not the 65-ft high-threat one)',
      (result as Combatant).id, 'ir');
  }
}

// ---- 4. execute — auto-hit (damage ALWAYS applied) ---------------

console.log('\n=== 4. execute — auto-hit (damage ALWAYS applied) ===\n');

{
  // Default makeCombatant: cha=10 → abilityMod(cha)=0 → 2d10+0 = range 2-20
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast returns the enemy', target !== null);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 4a. Slot consumed
    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 4b. Damage applied: 2d10+0 (range 2-20)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d10+0 range (2-20): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 20);
    // 4c. KEY: no attack_hit / attack_miss / attack_crit events (auto-hit)
    const hitEvents = state.log.events.filter((e: any) => e.type === 'attack_hit');
    eq('No attack_hit event (auto-hit, no attack roll)', hitEvents.length, 0);
    const missEvents = state.log.events.filter((e: any) => e.type === 'attack_miss');
    eq('No attack_miss event (auto-hit)', missEvents.length, 0);
    const critEvents = state.log.events.filter((e: any) => e.type === 'attack_crit');
    eq('No attack_crit event (no crit path on auto-hit)', critEvents.length, 0);
    // 4d. KEY: only 'action' + 'damage' log events emitted
    const actions = state.log.events.filter((e: any) => e.type === 'action');
    assert('Action log emitted (cast)', actions.length >= 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // No save events either (no save)
    const saveEvents = state.log.events.filter(
      (e: any) => e.type === 'save_success' || e.type === 'save_fail');
    eq('No save_success/save_fail events (no save)', saveEvents.length, 0);
    // No condition rider for Spellfire Flare
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — auto-hit with high CHA (+5 mod) ----------------

console.log('\n=== 5. execute — auto-hit with high CHA (+5 mod) ===\n');

{
  // cha=20 → abilityMod(cha)=+5 → 2d10+5 = range 7-25
  const caster = makeSorcerer({ x: 0, y: 0, z: 0 }, SF_ACTION);
  caster.cha = 20;
  const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  if (target) {
    const hpBefore = enemy.currentHP;
    execute(caster, target as Combatant, state);

    // 5a. Damage applied: 2d10+5 (range 7-25)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d10+5 range (7-25): got ${dmgDealt}`,
      dmgDealt >= 7 && dmgDealt <= 25);
    // 5b. Slot still consumed
    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
  }
}

// ---- 6. execute — multiple runs always apply damage -------------

console.log('\n=== 6. execute — auto-hit always applies damage ===\n');

{
  // Run execute 50 times on fresh state each time; assert damage is ALWAYS
  // > 0 (auto-hit guarantees damage every cast — no miss chance).
  let allHit = true;
  for (let i = 0; i < 50; i++) {
    const caster = makeSorcerer({ x: 0, y: 0, z: 0 });
    caster.resources = withSlots1(50);   // plenty of slots
    const enemy = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000 });
    const bf = makeBF([caster, enemy]);
    const state = makeState(bf);
    const hpBefore = enemy.currentHP;
    execute(caster, enemy, state);
    if (hpBefore - enemy.currentHP <= 0) { allHit = false; break; }
  }
  assert('execute ALWAYS applies damage (50/50 hits — auto-hit, no miss chance)', allHit);
}

// ---- 7. rollDamage — with/without mod ----------------------------

console.log('\n=== 7. rollDamage ===\n');

// 7a. rollDamage(true, 0) — 2d10+0, range 2-20
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true, 0);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true, 0) min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamage(true, 0) max <= 20 (got ${max})`, max <= 20);
}
// 7b. rollDamage(true, 5) — 2d10+5, range 7-25
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage(true, 5);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(true, 5) min >= 7 (got ${min})`, min >= 7);
  assert(`rollDamage(true, 5) max <= 25 (got ${max})`, max <= 25);
}
// 7c. rollDamage(false, ...) — mod IGNORED, 2d10 only, range 2-20
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    // pass a large mod that should be ignored when includeMod=false
    const r = rollDamage(false, 999);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage(false, 999) min >= 2 (mod ignored) (got ${min})`, min >= 2);
  assert(`rollDamage(false, 999) max <= 20 (mod ignored) (got ${max})`, max <= 20);
}
// 7d. rollDamage() defaults — includeMod=true, spellcastingMod=0
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage() (defaults) min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamage() (defaults) max <= 20 (got ${max})`, max <= 20);
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeSorcerer();
  let cleanupOk = true;
  try { (require('../spells/spellfire_flare') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
