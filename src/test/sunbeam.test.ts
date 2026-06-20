// ============================================================
// sunbeam.test.ts — Sunbeam bespoke spell module (Session 24)
// PHB p.279: 6th-level evocation, action, range Self (60-ft line). Canon:
// concentration, up to 1 minute (repeat action each turn). v1:
// concentration + repeat-action simplified to one-shot.
// Effect: CON save. On fail: 6d8 radiant + blinded. On success: half, no blindness.
// AoE: 60-ft × 5-ft line from caster toward the highest-threat enemy
// within 60 ft (uses the inLineFt helper).
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors lightning_bolt.test.ts (line) + sunburst.test.ts (blinded).
// Uses withSlots6.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - CON 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - CON 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/sunbeam';
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

function withSlots6(remaining = 2): PlayerResources {
  return { spellSlots: { 6: { max: 2, remaining } } };
}

const SUNBEAM_ACTION: Action = {
  name: 'Sunbeam',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: 'radiant',
  saveDC: 25,           // guaranteed-fail DC (CON 1 → max 15 < 25)
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 6,
  costType: 'action',
  legendaryCost: 0,
  description: 'Sunbeam (CON save, 6d8 radiant + blinded on fail, 60-ft × 5-ft line)',
};

const SUNBEAM_ACTION_LOW_DC: Action = {
  ...SUNBEAM_ACTION,
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

/** Wizard at pos (0,0,0) with Sunbeam + 2 6th-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = SUNBEAM_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots6(2),
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

eq('Name is Sunbeam', metadata.name, 'Sunbeam');
eq('Level is 6', metadata.level, 6);
eq('School is evocation', metadata.school, 'evocation');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Line length is 60 ft', metadata.lineLengthFt, 60);
eq('Line width is 5 ft', metadata.lineWidthFt, 5);
eq('Die count is 6', metadata.dieCount, 6);
eq('Die sides is 8', metadata.dieSides, 8);
eq('Damage type is radiant', metadata.damageType, 'radiant');
eq('Save ability is con', metadata.saveAbility, 'con');
eq('Not concentration (v1 one-shot)', metadata.concentration, false);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Sunbeam action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots6(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Sunbeam action', shouldCast(caster, bf), null);
}
// 2b. No 6th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [SUNBEAM_ACTION], resources: withSlots6(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 6th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies in range → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft away > 60 ft
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies in range', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → [enemy]
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns array with 1 target when single enemy in range', result !== null && (result as Combatant[]).length === 1);
  if (result) eq('Target is the enemy', (result as Combatant[])[0].id, 'e1');
}

// ---- 3. shouldCast target selection (line AoE) ----------------------

console.log('\n=== 3. shouldCast target selection (line AoE) ===\n');

// 3a. Line aimed at highest-threat enemy along +X axis; collects all
// on-axis enemies and excludes off-axis enemies (thin-rectangle approx:
// perpendicular distance <= 2.5 ft → only same-row cells qualify).
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Far enemy at (12,0,0) = 60 ft away on +X axis (highest threat → aim)
  const aimAt = makeWeakEnemy('aimAt', { x: 12, y: 0, z: 0 }, { maxHP: 300 });
  // On-axis enemies caught by the 60-ft × 5-ft line
  const onAxis1 = makeWeakEnemy('onAxis1', { x: 3, y: 0, z: 0 }, { maxHP: 50 });
  const onAxis2 = makeWeakEnemy('onAxis2', { x: 6, y: 0, z: 0 }, { maxHP: 50 });
  const onAxis3 = makeWeakEnemy('onAxis3', { x: 9, y: 0, z: 0 }, { maxHP: 50 });
  // Off-axis enemy at y=3 (perpendicular distance = 15 ft > 5/2 = 2.5 ft) — excluded
  const offAxis = makeWeakEnemy('offAxis', { x: 6, y: 3, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, aimAt, onAxis1, onAxis2, onAxis3, offAxis]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id).sort();
    assert('Includes aimAt (on-axis, 60 ft)', ids.includes('aimAt'));
    assert('Includes onAxis1 (on-axis, 15 ft)', ids.includes('onAxis1'));
    assert('Includes onAxis2 (on-axis, 30 ft)', ids.includes('onAxis2'));
    assert('Includes onAxis3 (on-axis, 45 ft)', ids.includes('onAxis3'));
    assert('Excludes offAxis (15 ft perpendicular > 2.5 ft half-width)', !ids.includes('offAxis'));
    eq('Total 4 targets caught (4 on-axis + 0 off-axis)', (result as Combatant[]).length, 4);
  }
}

// 3b. Threat selection — highest maxHP is the aim point
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 3, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 6, y: 0, z: 0 }, { maxHP: 300 });
  const bf = makeBF([caster, lowT, highT]);
  const result = shouldCast(caster, bf);
  // Both on-axis → both caught. highT is the aim point (higher threat).
  if (result) {
    eq('Both on-axis enemies caught', (result as Combatant[]).length, 2);
  }
}

// ---- 4. execute — guaranteed fail (full damage + blinded) ------

console.log('\n=== 4. execute — guaranteed fail (full damage + blinded) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 1 target', targets !== null && (targets as Combatant[]).length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    eq('Slot consumed (6th level: 2 → 1)',
      (caster.resources as any).spellSlots[6].remaining, 1);
    // 6d8 range 6-48
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 6d8 range (6-48): got ${dmgDealt}`,
      dmgDealt >= 6 && dmgDealt <= 48);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (CON 1 vs DC 25)', saveFails.length === 1);
    // KEY: blinded condition applied on failed save
    assert('Enemy is blinded (condition_apply fired)', enemy.conditions.has('blinded'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (blinded)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Sunbeam');
    assert('ActiveEffect recorded with spellName Sunbeam', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is blinded', ckEffects[0].payload.condition, 'blinded');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage, NO blindness) --

console.log('\n=== 5. execute — guaranteed success (half damage, no blindness) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, SUNBEAM_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 6d8, range 3-24
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 3-24 range: got ${dmgDealt}`,
      dmgDealt >= 3 && dmgDealt <= 24);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (CON 30 vs DC 5)', saveSuccess.length === 1);
    // KEY: NOT blinded on successful save
    assert('Enemy is NOT blinded on successful save', !enemy.conditions.has('blinded'));
    // No condition_add log for this target
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
  }
}

// ---- 6. execute — multi-target line AoE + multi-blindness ------

console.log('\n=== 6. execute — multi-target line AoE + multi-blindness ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // 3 on-axis enemies (all caught in the 60-ft × 5-ft line), all CON 1
  const e1 = makeWeakEnemy('e1', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 6, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeWeakEnemy('e3', { x: 9, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets', targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 fail save (CON 1) → all 3 blinded
    assert('e1 (CON 1, failed save) IS blinded', e1.conditions.has('blinded'));
    assert('e2 (CON 1, failed save) IS blinded', e2.conditions.has('blinded'));
    assert('e3 (CON 1, failed save) IS blinded', e3.conditions.has('blinded'));
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('3 condition-add logs (one per blinded target)', condAdds.length, 3);
  }
}

// ---- 7. execute — already-blinded target (no double-apply) -----

console.log('\n=== 7. execute — already-blinded target ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-blind the enemy
  enemy.conditions.add('blinded' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Still blinded (was already)
    assert('Enemy still blinded after re-cast', enemy.conditions.has('blinded'));
    // No SECOND activeEffect added (skip-if-already-blinded guard)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Sunbeam');
    eq('No Sunbeam activeEffect added (already blinded)', ckEffects.length, 0);
    // Damage still applied
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-blinded target', dmgLogs.length, 1);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeWizard();
  let cleanupOk = true;
  try { (require('../spells/sunbeam') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 6d8 -------------------------------

console.log('\n=== 9. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 6 (got ${min})`, min >= 6);
  assert(`rollDamage max <= 48 (got ${max})`, max <= 48);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
