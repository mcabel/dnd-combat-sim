// ============================================================
// spray_of_cards.test.ts — Spray of Cards bespoke spell module (Session 24)
// BMT p.50: 2nd-level conjuration, action, Self (15-ft cone), NO
// concentration. DEX save. On fail: 2d10 slashing + blinded. On success:
// half damage, no blindness.
//
// Mirrors frost_fingers.test.ts (cone) + earth_tremor.test.ts (condition).
//
// Deterministic save outcomes:
//   - DEX 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - DEX 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage, CONE_RANGE_FT } from '../spells/spray_of_cards';
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

function withSlots2(remaining = 2): PlayerResources {
  return { spellSlots: { 2: { max: 2, remaining } } };
}

const SPRAY_ACTION: Action = {
  name: 'Spray of Cards',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 15, long: 15 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (DEX 1 → max 15 < 25)
  saveAbility: 'dex',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Spray of Cards (DEX save, 2d10 slashing + blinded, 15-ft cone)',
};

const SPRAY_ACTION_LOW_DC: Action = { ...SPRAY_ACTION, saveDC: 5 };

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1,
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
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 60, height: 60, depth: 1,
    cells: new Map(), round: 1,
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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = SPRAY_ACTION): Combatant {
  return makeCombatant('wiz', { name: 'Caster', pos, actions: [action], resources: withSlots2(2) });
}

/** Enemy with DEX 1 (guaranteed fail vs DC 25). */
function makeWeakEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', dex: 1, pos, ...overrides });
}

/** Enemy with DEX 30 (guaranteed success vs DC 5). */
function makeStrongEnemy(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', dex: 30, pos, ...overrides });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');
eq('Name is Spray of Cards', metadata.name, 'Spray of Cards');
eq('Level is 2', metadata.level, 2);
eq('School is conjuration', metadata.school, 'conjuration');
eq('Range is 15 ft (cone)', metadata.rangeFt, 15);
eq('Die count is 2', metadata.dieCount, 2);
eq('Die sides is 10', metadata.dieSides, 10);
eq('Damage type is slashing', metadata.damageType, 'slashing');
eq('Save ability is dex', metadata.saveAbility, 'dex');
eq('Not concentration', metadata.concentration, false);
eq('Cone range constant is 15', CONE_RANGE_FT, 15);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots2(2) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when caster lacks Spray of Cards action', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCombatant('wiz', { actions: [SPRAY_ACTION], resources: withSlots2(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when no 2nd-level slots', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 10, y: 0, z: 0 }); // 50 ft > 15-ft cone
  eq('Returns null when no enemies within cone range', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }); // 5 ft, in cone
  const result = shouldCast(caster, makeBF([caster, enemy]));
  assert('Returns non-null (array) when enemy in cone', result !== null);
  assert('Result is an array', Array.isArray(result));
  if (result) eq('Array contains the enemy', (result as Combatant[]).length, 1);
}

// ---- 3. shouldCast cone targeting -----------------------------

console.log('\n=== 3. shouldCast cone targeting ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // Three enemies in a line on +x axis (all in the cone aimed at nearest).
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 }); // 5 ft
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 500, currentHP: 500 });   // 10 ft
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 250, currentHP: 250 });   // 15 ft
  const result = shouldCast(caster, makeBF([caster, e1, e2, e3]));
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id).sort();
    eq('Cone catches all 3 in-line enemies', ids.join(','), 'e1,e2,e3');
  }
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const inCone = makeWeakEnemy('inCone', { x: 2, y: 0, z: 0 });   // 10 ft on +x (in cone)
  const offAxis = makeWeakEnemy('offAxis', { x: 0, y: 2, z: 0 }); // 90° off-axis (excluded)
  const result = shouldCast(caster, makeBF([caster, inCone, offAxis]));
  if (result) {
    const ids = (result as Combatant[]).map(c => c.id);
    assert('Cone excludes off-axis enemy', !ids.includes('offAxis'));
    assert('Cone includes in-cone enemy', ids.includes('inCone'));
  }
}

// ---- 4. execute — guaranteed fail (full damage + blinded) ------

console.log('\n=== 4. execute — guaranteed fail (full damage + blinded) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf);
  assert('shouldCast returns targets', targets !== null);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);
    eq('Slot consumed (2nd level: 2 → 1)', (caster.resources as any).spellSlots[2].remaining, 1);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 2d10 range (2-20): got ${dmgDealt}`, dmgDealt >= 2 && dmgDealt <= 20);
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted (DEX 1 vs DC 25)', saveFails.length === 1);
    assert('Enemy is blinded on failed save', enemy.conditions.has('blinded'));
    const condAdds = state.log.events.filter((e: any) => e.type === 'condition_add');
    assert('condition_add log emitted for blinded', condAdds.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage, NO blinded) -

console.log('\n=== 5. execute — guaranteed success (half damage, no blinded) ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, SPRAY_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets as Combatant[], state);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 1-10 range: got ${dmgDealt}`, dmgDealt >= 1 && dmgDealt <= 10);
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted (DEX 30 vs DC 5)', saveSuccess.length === 1);
    assert('Enemy is NOT blinded on successful save', !enemy.conditions.has('blinded'));
  }
}

// ---- 6. execute — multi-target cone ---------------------------

console.log('\n=== 6. execute — multi-target cone ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 2, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e3 = makeWeakEnemy('e3', { x: 3, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2, e3]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf);
  if (targets) {
    execute(caster, targets as Combatant[], state);
    // All 3 took damage
    assert('e1 took damage', e1.currentHP < 1000);
    assert('e2 took damage', e2.currentHP < 1000);
    assert('e3 took damage', e3.currentHP < 1000);
    // All 3 blinded (all failed vs DC 25)
    assert('e1 blinded', e1.conditions.has('blinded'));
    assert('e2 blinded', e2.conditions.has('blinded'));
    assert('e3 blinded', e3.conditions.has('blinded'));
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    eq('3 save-fail logs (one per target)', saveFails.length, 3);
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let ok = true;
  try { (require('../spells/spray_of_cards') as any).cleanup(caster); } catch { ok = false; }
  assert('cleanup() does not throw', ok);
}

// ---- 8. rollDamage respects 2d10 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 2 (got ${min})`, min >= 2);
  assert(`rollDamage max <= 20 (got ${max})`, max <= 20);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
