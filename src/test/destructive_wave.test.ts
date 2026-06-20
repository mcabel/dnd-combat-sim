// ============================================================
// destructive_wave.test.ts — Destructive Wave bespoke spell module (Session 24)
// PHB p.250: 5th-level evocation, action, range Self (30-ft radius),
// NO concentration. Effect: self-centred AoE CON save. On fail: 5d6 thunder
// + knocked prone. On success: half damage, no prone. Caster is EXCLUDED
// from the AoE ("Each other creature"). v1 follows the plan's simplification
// (5d6 thunder only; the radiant/necrotic choice + second 5d6 is dropped).
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors earth_tremor.test.ts structure (self-centred AoE save + prone on
// failed save) but with Destructive Wave's stats (L5, self-centred 30-ft
// radius, 5d6 thunder, prone on fail). The caster is the centre AND is
// excluded from the target list. Uses withSlots5.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
//
// Position convention: 1 square = 5 ft. chebyshev3D * 5 = feet.
//   - (1,0,0) = 5 ft from caster (in 30-ft radius)
//   - (6,0,0) = 30 ft from caster (in 30-ft radius, boundary)
//   - (7,0,0) = 35 ft from caster (out of 30-ft radius)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/destructive_wave';
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

const DW_ACTION: Action = {
  name: 'Destructive Wave',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 0, long: 0 },         // Self (30-ft radius)
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Destructive Wave (CON save, 5d6 thunder + prone on fail, self 30-ft radius AoE)',
};

const DW_ACTION_LOW_DC: Action = {
  ...DW_ACTION,
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

/** Paladin at pos (0,0,0) with Destructive Wave + 2 5th-level slots */
function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = DW_ACTION): Combatant {
  return makeCombatant('paladin', {
    name: 'Paladin',
    pos,
    actions: [action],
    resources: withSlots5(2),
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

eq('Name is Destructive Wave', metadata.name, 'Destructive Wave');
eq('Level is 5', metadata.level, 5);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 0 (Self)', metadata.rangeFt, 0);
eq('AoE radius is 30 ft', metadata.aoeRadiusFt, 30);
eq('Die count is 5', metadata.dieCount, 5);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is thunder', metadata.damageType, 'thunder');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Destructive Wave action → null
{
  const caster = makeCombatant('paladin', { actions: [], resources: withSlots5(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Destructive Wave action', shouldCast(caster, bf), null);
}
// 2b. No 5th-level slots → null
{
  const caster = makeCombatant('paladin', { actions: [DW_ACTION], resources: withSlots5(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 5th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 30 ft → null
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // 7 squares = 35 ft > 30 ft radius
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
  assert('Returns non-null when enemy within 30 ft', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast AoE targeting (caster excluded, radius boundary) ----

console.log('\n=== 3. shouldCast AoE targeting ===\n');

// 3a. Multiple in-range enemies (5ft, 30ft boundary) caught; 35ft excluded
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e5 = makeWeakEnemy('e5', { x: 1, y: 0, z: 0 });    // 5 ft → in
  const e30 = makeWeakEnemy('e30', { x: 6, y: 0, z: 0 });  // 30 ft → in (boundary)
  const e35 = makeWeakEnemy('e35', { x: 7, y: 0, z: 0 });  // 35 ft → out
  const bf = makeBF([caster, e5, e30, e35]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('e5 (5 ft) in targets', ids.includes('e5'));
    assert('e30 (30 ft, boundary) in targets', ids.includes('e30'));
    assert('e35 (35 ft) NOT in targets', !ids.includes('e35'));
    eq('Exactly 2 targets caught', (result as Combatant[]).length, 2);
  }
}
// 3b. Caster is NOT in the target list (PHB p.250: "Each other creature")
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('Caster is NOT in target list (excluded per PHB p.250)',
      !ids.includes(caster.id));
  }
}

// ---- 4. execute — guaranteed fail (full 5d6 damage + prone) ------

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

    eq('Slot consumed (5th level: 2 → 1)',
      (caster.resources as any).spellSlots[5].remaining, 1);
    // 5d6 range 5-30
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 5d6 range (5-30): got ${dmgDealt}`,
      dmgDealt >= 5 && dmgDealt <= 30);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    // KEY: prone condition applied on failed save
    assert('Enemy is prone (condition_apply fired)', enemy.conditions.has('prone'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (prone)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Destructive Wave');
    assert('ActiveEffect recorded with spellName Destructive Wave', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is prone', ckEffects[0].payload.condition, 'prone');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage, NO prone) ------

console.log('\n=== 5. execute — guaranteed success (half damage, no prone) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, DW_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 5d6 (floor), range 2-15
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 2-15 range: got ${dmgDealt}`,
      dmgDealt >= 2 && dmgDealt <= 15);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
    // KEY: NOT prone on successful save
    assert('Enemy is NOT prone on successful save', !enemy.conditions.has('prone'));
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
  }
}

// ---- 6. execute — multi-target AoE + multi-prone ----------------

console.log('\n=== 6. execute — multi-target AoE + multi-prone ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Both enemies weak (CON 1) — both fail save vs DC 25 → both prone
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 0, y: 6, z: 0 }, { maxHP: 1000, currentHP: 1000 }); // 30 ft away
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 2 targets (e1, e2)', targets !== null && (targets as Combatant[]).length === 2);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Both fail save → both prone
    assert('e1 (CON 1, failed save) IS prone', e1.conditions.has('prone'));
    assert('e2 (CON 1, failed save) IS prone', e2.conditions.has('prone'));
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('2 save-fail logs (one per target)', saveFails.length, 2);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('2 damage logs emitted (one per target)', dmgLogs.length, 2);
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('2 condition-add logs (one per prone target)', condAdds.length, 2);
  }
}

// ---- 7. execute — already-prone target (no double-apply) --------

console.log('\n=== 7. execute — already-prone target ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-prone the enemy
  enemy.conditions.add('prone' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Still prone (was already)
    assert('Enemy still prone after re-cast', enemy.conditions.has('prone'));
    // No SECOND activeEffect added (skip-if-already-prone guard)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Destructive Wave');
    eq('No Destructive Wave activeEffect added (already prone)', ckEffects.length, 0);
    // Damage still applied
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-prone target', dmgLogs.length, 1);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let cleanupOk = true;
  try { (require('../spells/destructive_wave') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 5d6 -------------------------------

console.log('\n=== 9. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 5 (got ${min})`, min >= 5);
  assert(`rollDamage max <= 30 (got ${max})`, max <= 30);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
