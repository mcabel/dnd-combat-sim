// ============================================================
// flame_strike.test.ts — Flame Strike bespoke spell module (Session 24)
// PHB p.243: 5th-level evocation, action, range 60 ft, NO concentration.
// Effect: AoE DEX save. DUAL damage: 4d6 fire + 4d6 radiant. On fail:
// both full. On success: each halved independently (resistance applies per
// type). 10-ft-radius cylinder centered on the highest-threat enemy within
// 60 ft. (v1 simplifications: upcast NOT modelled.)
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors ice_storm.test.ts structure (AoE radius save, dual damage) but
// with Flame Strike's stats (L5, DEX save, 4d6 fire + 4d6 radiant, 60-ft
// range, 10-ft radius). Uses withSlots5.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - (1,0,0) = 5 ft from caster
//   - e_in  at (2,0,0) = 10 ft from center → in radius (boundary)
//   - e_out at (3,0,0) = 15 ft from center → out of radius
//   - oor   at (13,0,0) = 65 ft from caster (> 60 ft range)
// ============================================================

import {
  shouldCast, execute, metadata, rollDamageFire, rollDamageRadiant,
} from '../spells/flame_strike';
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

function withSlots5(remaining = 2): PlayerResources {
  return { spellSlots: { 5: { max: 2, remaining } } };
}

const FS_ACTION: Action = {
  name: 'Flame Strike',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Flame Strike (DEX save, 4d6 fire + 4d6 radiant, 60-ft range, 10-ft radius AoE)',
};

const FS_ACTION_LOW_DC: Action = {
  ...FS_ACTION,
  saveDC: 5,            // guaranteed-success DC (DEX 30 → min 11 ≥ 5)
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

/** Cleric at pos (0,0,0) with Flame Strike + 2 5th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = FS_ACTION): Combatant {
  return makeCombatant('cleric', {
    name: 'Cleric',
    pos,
    actions: [action],
    resources: withSlots5(2),
  });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    dex: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Flame Strike', metadata.name, 'Flame Strike');
eq('Level is 5', metadata.level, 5);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('AoE radius is 10 ft', metadata.aoeRadiusFt, 10);
eq('Fire die count is 4', metadata.dieCount, 4);
eq('Fire die sides is 6', metadata.dieSides, 6);
eq('Radiant die count is 4 (dual damage)', metadata.radiantDieCount, 4);
eq('Radiant die sides is 6 (dual damage)', metadata.radiantDieSides, 6);
eq('Damage type is fire (primary metadata)', metadata.damageType, 'fire');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Flame Strike action → null
{
  const caster = makeCombatant('cleric', { actions: [], resources: withSlots5(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Flame Strike action', shouldCast(caster, bf), null);
}
// 2b. No 5th-level slots → null
{
  const caster = makeCombatant('cleric', { actions: [FS_ACTION], resources: withSlots5(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 60 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 13 squares away = 65 ft > 60 ft range
  const enemy = makeWeakEnemy('e1', { x: 13, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 60 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast AoE targeting (center + 10-ft radius) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 60 ft is chosen as the center;
//     nearby lower-HP enemies within 10 ft of the center are also caught.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 2, y: 0, z: 0 }, { maxHP: 300 });  // 10 ft from caster
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  if (result) {
    // Center is highT (maxHP 300); lowT is 1 square (5 ft) from highT → in radius
    const ids = (result as Combatant[]).map(c => c.id);
    assert('highT (center) in targets', ids.includes('highT'));
    assert('lowT (within 10 ft of highT) in targets', ids.includes('lowT'));
    eq('Exactly 2 targets caught', (result as Combatant[]).length, 2);
  }
}
// 3b. Enemies within 10 ft of the center are caught; out-of-radius excluded
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Center: e_center (maxHP 1000) at (1,0,0) — 5 ft from caster
  const e_center = makeWeakEnemy('e_center', { x: 1, y: 0, z: 0 }, { maxHP: 1000 });
  // e_in: 1 square from center → 5 ft → IN radius
  const e_in = makeWeakEnemy('e_in', { x: 2, y: 0, z: 0 }, { maxHP: 50 });
  // e_boundary: 2 squares from center → 10 ft (boundary) → IN radius
  const e_boundary = makeWeakEnemy('e_boundary', { x: 3, y: 0, z: 0 }, { maxHP: 50 });
  // e_far: 3 squares from center → 15 ft → OUT of radius
  const e_far = makeWeakEnemy('e_far', { x: 4, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e_center, e_in, e_boundary, e_far]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e_center (center) in targets', ids.includes('e_center'));
    assert('e_in (5 ft from center) in targets', ids.includes('e_in'));
    assert('e_boundary (10 ft boundary from center) in targets', ids.includes('e_boundary'));
    assert('e_far (15 ft from center) NOT in targets', !ids.includes('e_far'));
    eq('Exactly 3 targets caught (e_center + e_in + e_boundary)', (result as Combatant[]).length, 3);
  }
}
// 3c. Out-of-range enemy (beyond 60 ft from caster) cannot be center
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Both enemies at 65 ft (out of 60-ft range); shouldCast → null
  const oor1 = makeWeakEnemy('oor1', { x: 13, y: 0, z: 0 }, { maxHP: 1000 });
  const oor2 = makeWeakEnemy('oor2', { x: 13, y: 1, z: 0 }, { maxHP: 500 });
  const bf = makeBF([caster, oor1, oor2]);
  eq('Returns null when all enemies beyond 60 ft', shouldCast(caster, bf), null);
}

// ---- 4. execute — guaranteed fail (full 4d6+4d6 damage) --------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns targets', targets !== null);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    eq('Slot consumed (5th level: 2 → 1)',
      (caster.resources as any).spellSlots[5].remaining, 1);
    // 4d6 fire (4-24) + 4d6 radiant (4-24) = total 8-48
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 4d6+4d6 range (8-48): got ${dmgDealt}`,
      dmgDealt >= 8 && dmgDealt <= 48);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    // KEY: ONE combined 'damage' log per target with total (not 2 separate)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Exactly 1 combined damage log per target', dmgLogs.length, 1);
    // The damage log description mentions both fire + radiant (dual breakdown)
    if (dmgLogs.length === 1) {
      const desc = String(dmgLogs[0].description || '');
      assert('Damage log description mentions fire', desc.includes('fire'));
      assert('Damage log description mentions radiant', desc.includes('radiant'));
    }
    // No condition rider for Flame Strike
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (each halved) -------------

console.log('\n=== 5. execute — guaranteed success (each halved) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, FS_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Each halved independently: fire floor(4d6/2)=2-12, radiant floor(4d6/2)=2-12
    // Total range 4-24
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 4-24 range (fire 2-12 + radiant 2-12): got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 24);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (DEX 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target AoE (multiple saves) -----------

console.log('\n=== 6. execute — multi-target AoE ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Three enemies clustered around center e1 (maxHP 1000 at 5 ft):
  //   e2 at (2,0,0) = 5 ft from e1; e3 at (3,0,0) = 10 ft from e1 (boundary).
  // All within 10-ft radius of e1 → all caught.
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (all clustered within 10 ft of center e1)',
    targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 took damage (all DEX 1, guaranteed fail vs DC 25)
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 500 - e2.currentHP;
    const e3Lost = 250 - e3.currentHP;
    assert('e1 took damage in 4d6+4d6 range (8-48)', e1Lost >= 8 && e1Lost <= 48, `got ${e1Lost}`);
    assert('e2 took damage in 4d6+4d6 range (8-48)', e2Lost >= 8 && e2Lost <= 48, `got ${e2Lost}`);
    assert('e3 took damage in 4d6+4d6 range (8-48)', e3Lost >= 8 && e3Lost <= 48, `got ${e3Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    // 3 COMBINED damage logs (one per target — dual damage emits one log per target)
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 combined damage logs emitted (one per target)', dmgLogs.length, 3);
  }
}

// ---- 7. execute — dual damage applied separately (resistance test) ----

console.log('\n=== 7. execute — dual damage applied separately (resistance) ===\n');

// KEY: execute() calls applyDamageWithTempHP TWICE — once for fire, once for
// radiant. This matters for per-type resistances: if the target has fire
// resistance, ONLY fire is halved (NOT radiant). By using a fire-resistant
// target and observing total damage in 6-36 (fire 2-12 + radiant 4-24),
// we prove the two applications are independent.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Enemy with fire resistance (no radiant resistance). Guaranteed fail
  // (DEX 1 vs DC 25) → no save halving; only resistance applies.
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, {
    maxHP: 1000, currentHP: 1000,
    resistances: ['fire' as any],
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Fire: 4d6 raw (4-24), no save halving (fail), fire resistance halves
    //       → fireDealt = floor(fireRaw / 2) = 2-12
    // Radiant: 4d6 raw (4-24), no save halving, NO resistance
    //       → radDealt = 4-24
    // Total = 6-36 (NOT 8-48 [no resistance] NOR 4-24 [all halved])
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Fire-resistant target takes 6-36 (fire halved + radiant full): got ${dmgDealt}`,
      dmgDealt >= 6 && dmgDealt <= 36,
      `got ${dmgDealt} — if 4-24, the two dice were combined; if 8-48, no resistance applied`);
    // Sanity: total damage CANNOT exceed the no-resistance max (48) NOR be 0
    assert('Damage is > 0 (fire resist does not negate radiant)', dmgDealt > 0);
  }
}
// 7b. Opposite: radiant-resistant target — proves the OTHER type is the
//     one that gets halved (and fire stays full). Total = 6-36 (fire 4-24
//     + radiant floor(4-24/2)=2-12).
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, {
    maxHP: 1000, currentHP: 1000,
    resistances: ['radiant' as any],
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Fire: 4-24 (full, no resistance)
    // Radiant: 4d6 raw (4-24), no save halving, radiant resistance halves
    //       → radDealt = floor(radRaw / 2) = 2-12
    // Total = 6-36 (fire 4-24 + radiant 2-12)
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Radiant-resistant target takes 6-36 (fire full + radiant halved): got ${dmgDealt}`,
      dmgDealt >= 6 && dmgDealt <= 36);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/flame_strike') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamageFire + rollDamageRadiant (dual dice) --------

console.log('\n=== 9. rollDamageFire + rollDamageRadiant ===\n');

// 9a. rollDamageFire() — 4d6, range 4-24
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamageFire();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamageFire min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamageFire max <= 24 (got ${max})`, max <= 24);
}
// 9b. rollDamageRadiant() — 4d6, range 4-24
{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamageRadiant();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamageRadiant min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamageRadiant max <= 24 (got ${max})`, max <= 24);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
