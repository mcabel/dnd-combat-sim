// ============================================================
// psychic_scream.test.ts — Psychic Scream bespoke spell module (Session 24)
// XGE p.163: 9th-level enchantment, action, range 90 ft, NO concentration.
// Effect: POINT-TARGETED (NOT AoE — the caster picks up to 10 creatures).
// Each target makes an INT save. On fail: 14d6 psychic + stunned.
// On success: half, no stun.
//
// Migrated from the Session 20 generic dispatch registry in Session 24.
// Mirrors sunburst.test.ts (AoE+condition) but POINT-TARGETED (no radius —
// shouldCast picks up to 10 highest-threat enemies within 90 ft, not all
// in an AoE); 14d6 psychic, stunned (vs blinded), maxTargets 10.
// Uses withSlots9.
//
// Probabilistic save outcomes use deterministic save DCs:
//   - INT 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - INT 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/psychic_scream';
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

function withSlots9(remaining = 2): PlayerResources {
  return { spellSlots: { 9: { max: 2, remaining } } };
}

const PS_ACTION: Action = {
  name: 'Psychic Scream',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 90, long: 90 },
  hitBonus: null,
  damage: null,
  damageType: 'psychic',
  saveDC: 25,           // guaranteed-fail DC (INT 1 → max 15 < 25)
  saveAbility: 'int',
  isAoE: false,         // NOTE: point-targeted (NOT AoE radius); shouldCast picks up to 10.
  isControl: false,
  requiresConcentration: false,
  slotLevel: 9,
  costType: 'action',
  legendaryCost: 0,
  description: 'Psychic Scream (INT save, 14d6 psychic + stunned on fail, point-targeted up to 10)',
};

const PS_ACTION_LOW_DC: Action = {
  ...PS_ACTION,
  saveDC: 5,            // guaranteed-success DC (INT 30 → min 11 ≥ 5)
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

/** Sorcerer at pos (0,0,0) with Psychic Scream + 2 9th-level slots */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = PS_ACTION): Combatant {
  return makeCombatant('wiz', {
    name: 'Wizard',
    pos,
    actions: [action],
    resources: withSlots9(2),
  });
}

/** Enemy with INT 1 (guaranteed fail vs DC 25) */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    int: 1,            // guaranteed fail vs DC 25
    pos,
    ...overrides,
  });
}

/** Enemy with INT 30 (guaranteed success vs DC 5) */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    int: 30,           // guaranteed success vs DC 5
    pos,
    ...overrides,
  });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');

eq('Name is Psychic Scream', metadata.name, 'Psychic Scream');
eq('Level is 9', metadata.level, 9);
eq('School is enchantment', metadata.school, 'enchantment');
eq('Range is 90 ft', metadata.rangeFt, 90);
eq('Max targets is 10', metadata.maxTargets, 10);
eq('Die count is 14', metadata.dieCount, 14);
eq('Die sides is 6', metadata.dieSides, 6);
eq('Damage type is psychic', metadata.damageType, 'psychic');
eq('Save ability is int', metadata.saveAbility, 'int');
eq('Not concentration', metadata.concentration, false);
eq('10-target cap v1 flag set', metadata.psychicScream10TargetCapV1, true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

// 2a. No Psychic Scream action → null
{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots9(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when caster lacks Psychic Scream action', shouldCast(caster, bf), null);
}
// 2b. No 9th-level slots → null
{
  const caster = makeCombatant('wiz', { actions: [PS_ACTION], resources: withSlots9(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no 9th-level slots', shouldCast(caster, bf), null);
}
// 2c. No enemies within 90 ft → null
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // 50 squares away = 250 ft > 90 ft range
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  eq('Returns null when no enemies within 90 ft', shouldCast(caster, bf), null);
}
// 2d. Single enemy in range → returns array with that enemy
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null when enemy in range', result !== null);
  assert('Result is an array (Combatant[])', Array.isArray(result));
  if (result) eq('Array has 1 target', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast target selection (point-targeted, up to 10) ----

console.log('\n=== 3. shouldCast target selection ===\n');

// 3a. All enemies within 90 ft are caught (point-targeted, no radius)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Spread out 3 enemies (no clustering required — point-targeted)
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50 });
  const e2 = makeWeakEnemy('e2', { x: 10, y: 0, z: 0 }, { maxHP: 50 });  // 50 ft away
  const e3 = makeWeakEnemy('e3', { x: 17, y: 0, z: 0 }, { maxHP: 50 });  // 85 ft away (still ≤ 90)
  // Out-of-range enemy (95 ft > 90 ft)
  const oor = makeWeakEnemy('oor', { x: 19, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e1, e2, e3, oor]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('Includes e1 (5 ft)', ids.includes('e1'));
    assert('Includes e2 (50 ft)', ids.includes('e2'));
    assert('Includes e3 (85 ft, still in range)', ids.includes('e3'));
    assert('Excludes oor (95 ft > 90 ft range)', !ids.includes('oor'));
    eq('3 targets caught (point-targeted, no radius)', (result as Combatant[]).length, 3);
  }
}

// 3b. KEY: 10-target cap — place 12 enemies, verify only 10 returned (the 10 highest-threat)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // Place 12 enemies within 90 ft, all on-axis at different distances
  // maxHP ranges from 12 (lowest threat) to 1000 (highest threat)
  const enemies: Combatant[] = [];
  for (let i = 0; i < 12; i++) {
    // Position at (1+i, 0, 0) = (1..12 squares) = (5..60 ft) — all within 90 ft
    // Use unique maxHP per enemy so threat ordering is unambiguous
    enemies.push(makeWeakEnemy(`e${i + 1}`, { x: 1 + i, y: 0, z: 0 }, { maxHP: 1000 - i * 50 }));
  }
  const bf = makeBF([caster, ...enemies]);
  const result = shouldCast(caster, bf);
  assert('Returns non-null', result !== null);
  if (result) {
    eq('Caps at 10 targets (12 enemies within 90 ft)', (result as Combatant[]).length, 10);
    const ids = (result as Combatant[]).map(c => c.id);
    // The 10 HIGHEST-threat enemies are e1..e10 (maxHP 1000, 950, 900, ..., 550)
    // e11 (maxHP 500) and e12 (maxHP 450) should be EXCLUDED
    for (let i = 1; i <= 10; i++) {
      assert(`e${i} (maxHP ${1000 - (i - 1) * 50}, top-10 threat) included`, ids.includes(`e${i}`));
    }
    assert('e11 (maxHP 500, 11th-highest) NOT included', !ids.includes('e11'));
    assert('e12 (maxHP 450, 12th-highest) NOT included', !ids.includes('e12'));
  }
}

// 3c. Fewer than 10 enemies — all returned (no padding)
{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 50 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 50 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 50 });
  const bf = makeBF([caster, e1, e2, e3]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Returns all 3 when fewer than 10 enemies (no padding)', (result as Combatant[]).length, 3);
  }
}

// ---- 4. execute — guaranteed fail (full 14d6 damage + stunned) ------

console.log('\n=== 4. execute — guaranteed fail (full damage + stunned) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 1 target', targets !== null && (targets as Combatant[]).length === 1);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    eq('Slot consumed (9th level: 2 → 1)',
      (caster.resources as any).spellSlots[9].remaining, 1);
    // 14d6 range 14-84
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 14d6 range (14-84): got ${dmgDealt}`,
      dmgDealt >= 14 && dmgDealt <= 84);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (INT 1 vs DC 25)', saveFails.length === 1);
    // KEY: stunned condition applied on failed save
    assert('Enemy is stunned (condition_apply fired)', enemy.conditions.has('stunned'));
    // Condition-add log emitted
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('Condition-add log emitted (stunned)', condAdds.length >= 1);
    // ActiveEffect recorded (condition_apply sourceIsConcentration: false)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Psychic Scream');
    assert('ActiveEffect recorded with spellName Psychic Scream', ckEffects.length === 1);
    if (ckEffects.length === 1) {
      eq('Effect type is condition_apply', ckEffects[0].effectType, 'condition_apply');
      eq('Effect payload condition is stunned', ckEffects[0].payload.condition, 'stunned');
      eq('Effect NOT concentration-sourced', ckEffects[0].sourceIsConcentration, false);
    }
  }
}

// ---- 5. execute — guaranteed success (half damage, NO stunned) ------

console.log('\n=== 5. execute — guaranteed success (half damage, no stunned) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 }, PS_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);

    // Half of 14d6 (floor), range 7-42
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 7-42 range: got ${dmgDealt}`,
      dmgDealt >= 7 && dmgDealt <= 42);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (INT 30 vs DC 5)', saveSuccess.length === 1);
    // KEY: NOT stunned on successful save
    assert('Enemy is NOT stunned on successful save', !enemy.conditions.has('stunned'));
    // No condition_add log for this target
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('No condition-add log on successful save', condAdds.length, 0);
  }
}

// ---- 6. execute — multi-target (point-targeted, multiple saves + stuns) ----

console.log('\n=== 6. execute — multi-target (point-targeted) ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  // 3 enemies, all INT 1 — all fail save vs DC 25 → all stunned
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets', targets !== null && (targets as Combatant[]).length === 3);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 fail save (INT 1) → all 3 stunned
    assert('e1 (INT 1, failed save) IS stunned', e1.conditions.has('stunned'));
    assert('e2 (INT 1, failed save) IS stunned', e2.conditions.has('stunned'));
    assert('e3 (INT 1, failed save) IS stunned', e3.conditions.has('stunned'));
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('3 damage logs emitted (one per target)', dmgLogs.length, 3);
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    eq('3 condition-add logs (one per stunned target)', condAdds.length, 3);
  }
}

// ---- 7. execute — already-stunned target (no double-apply) -----

console.log('\n=== 7. execute — already-stunned target ===\n');

{
  const caster = makeWizard({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  // Pre-stun the enemy
  enemy.conditions.add('stunned' as Condition);
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // Still stunned (was already)
    assert('Enemy still stunned after re-cast', enemy.conditions.has('stunned'));
    // No SECOND activeEffect added (skip-if-already-stunned guard)
    const ckEffects = enemy.activeEffects.filter((e: any) => e.spellName === 'Psychic Scream');
    eq('No Psychic Scream activeEffect added (already stunned)', ckEffects.length, 0);
    // Damage still applied
    const dmgLogs = state.log.events.filter((e: any) => e.type === 'damage');
    eq('Damage still applied to already-stunned target', dmgLogs.length, 1);
  }
}

// ---- 8. Cleanup is a no-op ------------------------------------

console.log('\n=== 8. Cleanup is a no-op ===\n');

{
  const caster = makeWizard();
  let cleanupOk = true;
  try { (require('../spells/psychic_scream') as any).cleanup(caster); }
  catch { cleanupOk = false; }
  assert('cleanup() does not throw', cleanupOk);
}

// ---- 9. rollDamage respects 14d6 -------------------------------

console.log('\n=== 9. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 14 (got ${min})`, min >= 14);
  assert(`rollDamage max <= 84 (got ${max})`, max <= 84);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
