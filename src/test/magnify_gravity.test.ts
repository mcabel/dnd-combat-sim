// ============================================================
// magnify_gravity.test.ts — Magnify Gravity bespoke spell module (Session 24)
// EGtW p.161: 1st-level transmutation, action, range 60 ft, NO concentration.
// Effect: AoE CON save. On fail: 2d8 force. On success: half. 10-ft-radius
// sphere centered on the highest-threat enemy within 60 ft of the caster.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors shatter.test.ts structure (10-ft-radius AoE CON save centred on
// highest-threat enemy) but with Magnify Gravity's stats (L1, 2d8 force,
// 60-ft range). Uses withSlots1.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D × 5 = feet.
//   - center at (5,0,0) = 25 ft from caster (within 60 ft range)
//   - adj   at (7,0,0) = 10 ft from center (chebyshev=2 → in 10-ft radius)
//   - far   at (8,0,0) = 15 ft from center (chebyshev=3 → out of radius)
//   - oor   at (15,0,0) = 75 ft from caster (beyond 60-ft range, not candidate)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/magnify_gravity';
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

const MG_ACTION: Action = {
  name: 'Magnify Gravity',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Magnify Gravity (CON save, 2d8 force, 10-ft radius AoE)',
};

const MG_ACTION_LOW_DC: Action = {
  ...MG_ACTION,
  saveDC: 5,            // guaranteed-success DC (CON 30 → min 11 ≥ 5)
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

/** Wizard at pos (0,0,0) with Magnify Gravity + 2 1st-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = MG_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots1(2),
  });
}

/** Enemy with CON 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with CON 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    con: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Magnify Gravity', metadata.name, 'Magnify Gravity');
eq('Level is 1', metadata.level, 1);
eq('School is transmutation', metadata.school, 'transmutation');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('AoE radius is 10 ft', metadata.aoeRadiusFt, 10);
eq('Die count is 2', metadata.dieCount, 2);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is force', metadata.damageType, 'force');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Magnify Gravity action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots1(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Magnify Gravity action', shouldCast(caster, bf), null);
}
// 2b. No 1st-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [MG_ACTION], resources: withSlots1(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 1st-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 60 ft range → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 20 squares = 100 ft > 60 ft range
  const enemy = makeWeakEnemy('e1', { x: 20, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 60 ft range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy within 60 ft', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast AoE targeting (highest-threat center) -------

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Highest-threat enemy within 60 ft becomes the center; all within
//     10 ft of center caught; out-of-radius excluded.
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 200 });
  const adj = makeWeakEnemy('adj', { x: 7, y: 0, z: 0 }, { maxHP: 50 });  // 10 ft from center
  const far = makeWeakEnemy('far', { x: 8, y: 0, z: 0 }, { maxHP: 50 });  // 15 ft from center → excluded
  const bf = makeBF([caster, center, adj, far]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('center in targets (highest-threat)', ids.includes('center'));
    assert('adj in targets (10 ft from center)', ids.includes('adj'));
    assert('far NOT in targets (15 ft from center, out of radius)', !ids.includes('far'));
    eq('Exactly 2 targets caught', (result as Combatant[]).length, 2);
  }
}
// 3b. Threat selection — highest-threat within 60 ft is the centre
//     (low-threat adjacent enemy gets caught by proximity).
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const strong = makeWeakEnemy('strong', { x: 6, y: 0, z: 0 }, { maxHP: 100 }); // 30 ft from caster
  const adjacent = makeWeakEnemy('adj', { x: 7, y: 0, z: 0 }, { maxHP: 30 });   // 5 ft from strong
  const bf = makeBF([caster, strong, adjacent]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('strong in targets (highest-threat center)', ids.includes('strong'));
    assert('adjacent in targets (within 10 ft of strong)', ids.includes('adj'));
    eq('Both enemies caught', (result as Combatant[]).length, 2);
  }
}

// ---- 4. execute — guaranteed fail (full 2d8 damage) -------------

console.log('\n=== 4. execute — guaranteed fail (full damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 1 target', targets !== null && (targets as Combatant[]).length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    eq('Slot consumed (1st level: 2 → 1)',
      (caster.resources as any).spellSlots[1].remaining, 1);
    // 2d8 range 2-16
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d8 range (2-16): got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 16);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage log emitted', dmgLogs.length, 1);
    // No condition rider for Magnify Gravity
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add logs (no condition rider)', condAdds.length, 0);
  }
}

// ---- 5. execute — guaranteed success (half damage) --------------

console.log('\n=== 5. execute — guaranteed success (half damage) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, MG_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 2d8 (floor), range 1-8
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 1-8 range: got ${dmgDealt}`,
      dmgDealt >= 1 && dmgDealt <= 8);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
  }
}

// ---- 6. execute — multi-target AoE (multiple saves) ------------

console.log('\n=== 6. execute — multi-target AoE ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Cluster: center + 2 adjacent (all within 10 ft of center)
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const adj1 = makeWeakEnemy('adj1', { x: 6, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const adj2 = makeWeakEnemy('adj2', { x: 5, y: 1, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, center, adj1, adj2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (cluster)', targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 took damage (all CON 1, guaranteed fail vs DC 25)
    const cLost = 1000 - center.currentHP;
    const a1Lost = 1000 - adj1.currentHP;
    const a2Lost = 1000 - adj2.currentHP;
    assert('center took damage in 2d8 range (2-16)', cLost >= 2 && cLost <= 16, `got ${cLost}`);
    assert('adj1 took damage in 2d8 range (2-16)', a1Lost >= 2 && a1Lost <= 16, `got ${a1Lost}`);
    assert('adj2 took damage in 2d8 range (2-16)', a2Lost >= 2 && a2Lost <= 16, `got ${a2Lost}`);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/magnify_gravity') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 8. rollDamage respects 2d8 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamage max <= 16 (got ${max})`, max <= 16);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
