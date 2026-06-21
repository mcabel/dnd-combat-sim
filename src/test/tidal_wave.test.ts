// ============================================================
// tidal_wave.test.ts — Tidal Wave bespoke spell module (Session 24)
// XGE p.168: 3rd-level conjuration, action, range 30 ft (v1: 30-ft line
// per plan — canon is single-target, but the plan spec says "approximate
// the 'wave' as a 30-ft line via inLineFt"), NO concentration. Effect:
// AoE STR save. On fail: 4d8 bludgeoning + prone. On success: half
// damage, NO prone. v1 aims the line at the highest-threat enemy within
// 30 ft and collects all enemies inside the 30-ft × 5-ft line rectangle.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors lightning_bolt.test.ts (line geometry) + earth_tremor.test.ts
// (prone condition_apply on failed save) structure, with Tidal Wave's
// stats (L3, 30-ft line, 4d8 bludgeoning, STR save + prone on fail).
// Uses withSlots3.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - STR 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - STR 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - (1,0,0) = 5 ft from caster (in 30-ft line range; aim point)
//   - (6,0,0) = 30 ft from caster (line boundary)
//   - (7,0,0) = 35 ft from caster (out of 30-ft line range)
//   - (0,1,0) = 5 ft perpendicular (off-line)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/tidal_wave';
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

function withSlots3(remaining = 2): PlayerResources {
  return { spellSlots: { 3: { max: 2, remaining } } };
}

const TW_ACTION: Action = {
  name: 'Tidal Wave',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (STR 1 → max 15 < 25)
  saveAbility: 'str',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Tidal Wave (STR save, 4d8 bludgeoning + prone on fail, 30-ft line)',
};

const TW_ACTION_LOW_DC: Action = {
  ...TW_ACTION,
  saveDC: 5,            // guaranteed-success DC (STR 30 → min 11 ≥ 5)
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

/** Druid at pos (0,0,0) with Tidal Wave + 2 3rd-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = TW_ACTION): Combatant {
  return makeCombatant('druid', {
    name: 'Druid',
    pos,
    actions: [action],
    resources: withSlots3(2),
  });
}

/** Enemy with STR 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    str: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with STR 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    str: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Tidal Wave', metadata.name, 'Tidal Wave');
eq('Level is 3', metadata.level, 3);
eq('School is conjuration', metadata.school, 'conjuration');
eq('Range is 30 ft', metadata.rangeFt, 30);
eq('Line length is 30 ft', metadata.lineLengthFt, 30);
eq('Line width is 5 ft', metadata.lineWidthFt, 5);
eq('Die count is 4', metadata.dieCount, 4);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is bludgeoning', metadata.damageType, 'bludgeoning');
eq('Save ability is str', metadata.saveAbility, 'str');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Tidal Wave action → null
{
  const caster = makeCombatant('druid', { actions: [], resources: withSlots3(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Tidal Wave action', shouldCast(caster, bf), null);
}
// 2b. No 3rd-level slots → null
{
  const caster = makeCombatant('druid', { actions: [TW_ACTION], resources: withSlots3(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 3rd-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 30-ft line range → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 7 squares = 35 ft > 30 ft range
  const enemy = makeWeakEnemy('e1', { x: 7, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 30 ft', shouldCast(caster, bf), null);
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

// ---- 3. shouldCast line targeting ------------------------------

console.log('\n=== 3. shouldCast line targeting ===\n');

// 3a. Line aimed at highest-threat enemy (+x axis) catches aligned
//     enemies; off-line enemy at same range is EXCLUDED.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Highest-threat enemy at (1,0,0) → line aims +x
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 50 });    // on +x axis → IN line
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 50 });    // on +x axis → IN line
  const e_offline = makeWeakEnemy('e_off', { x: 0, y: 1, z: 0 }, { maxHP: 50 }); // perpendicular → OUT
  const bf = makeBF([caster, e1, e2, e3, e_offline]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e1 (highest-threat, aim point) in targets', ids.includes('e1'));
    assert('e2 (10 ft, +x axis) in targets', ids.includes('e2'));
    assert('e3 (15 ft, +x axis) in targets', ids.includes('e3'));
    assert('e_off (perpendicular) NOT in targets', !ids.includes('e_off'));
    eq('Exactly 3 targets caught (e1 + e2 + e3)', (result as Combatant[]).length, 3);
  }
}
// 3b. Enemy beyond 30-ft line range is NOT a target
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000 });
  // e_far at (7,0,0) is 35 ft from caster — beyond 30-ft line length
  const e_far = makeWeakEnemy('e_far', { x: 7, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e1, e_far]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e1 (aim point, in line) in targets', ids.includes('e1'));
    assert('e_far (35 ft, beyond 30-ft line) NOT in targets', !ids.includes('e_far'));
  }
}

// ---- 4. execute — guaranteed fail (full 4d8 damage + prone) -----

console.log('\n=== 4. execute — guaranteed fail (full damage + prone) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 1 target', targets !== null && (targets as Combatant[]).length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    eq('Slot consumed (3rd level: 2 → 1)',
      (caster.resources as any).spellSlots[3].remaining, 1);
    // 4d8 range 4-32
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 4d8 range (4-32): got ${dmgDealt}`,
      dmgDealt >= 4 && dmgDealt <= 32);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (STR 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // KEY: prone condition applied on failed save
    assert('Enemy is prone (condition_apply fired)', enemy.conditions.has('prone'));
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (prone)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply, sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Tidal Wave');
    assert('ActiveEffect recorded with spellName Tidal Wave', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is prone', ckEffects[0].payload.condition, 'prone');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage, NO prone) ----

console.log('\n=== 5. execute — guaranteed success (half damage, no prone) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, TW_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 4d8 (floor), range 2-16
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 2-16 range: got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 16);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (STR 30 vs DC 5)', saveSuccess.length === 1);
    // KEY: NOT prone on successful save
    assert('Enemy is NOT prone on successful save', !enemy.conditions.has('prone'));
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
  }
}

// ---- 6. execute — multi-target line (multiple saves + prone) ---

console.log('\n=== 6. execute — multi-target line ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Three enemies on +x axis (all in line): 5 ft, 10 ft, 15 ft
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (e1, e2, e3)', targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 fail save (STR 1 vs DC 25) → all 3 prone + damaged
    assert('e1 (STR 1, failed save) IS prone', e1.conditions.has('prone'));
    assert('e2 (STR 1, failed save) IS prone', e2.conditions.has('prone'));
    assert('e3 (STR 1, failed save) IS prone', e3.conditions.has('prone'));
    const e1Lost = 1000 - e1.currentHP;
    const e2Lost = 500 - e2.currentHP;
    const e3Lost = 250 - e3.currentHP;
    assert('e1 took damage in 4d8 range (4-32)', e1Lost >= 4 && e1Lost <= 32, `got ${e1Lost}`);
    assert('e2 took damage in 4d8 range (4-32)', e2Lost >= 4 && e2Lost <= 32, `got ${e2Lost}`);
    assert('e3 took damage in 4d8 range (4-32)', e3Lost >= 4 && e3Lost <= 32, `got ${e3Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('3 condition-add logs (one per prone target)', condAdds.length, 3);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/tidal_wave') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 4d8 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamage max <= 32 (got ${max})`, max <= 32);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
