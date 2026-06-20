// ============================================================
// weird.test.ts — Weird bespoke spell module (Session 25 / Batch 2)
// PHB p.288: 9th-level illusion, action, range 120 ft, concentration.
// WIS save. On fail: 4d10 psychic + frightened. On success: half damage.
//
// Mirrors sunburst.test.ts (AoE save + damage + condition) but with
// WIS save, 4d10 psychic, frightened, L9 slot, concentration.
//
// Deterministic save outcomes:
//   - WIS 1 + DC 25 = guaranteed fail (mod -5, even nat 20 → 15 < 25)
//   - WIS 30 + DC 5 = guaranteed success (mod +10, even nat 1 → 11 ≥ 5)
// ============================================================

import { shouldCast, execute, metadata, rollDamage } from '../spells/weird';
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

function withSlots9(remaining = 1): PlayerResources {
  return { spellSlots: { 9: { max: 1, remaining } } };
}

const WEIRD_ACTION: Action = {
  name: 'Weird',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 120, long: 120 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (WIS 1 → max 15 < 25)
  saveAbility: 'wis',
  isAoE: true,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 9,
  costType: 'action',
  legendaryCost: 0,
  description: 'Weird (WIS save, 4d10 psychic + frightened, 120-ft range, 30-ft radius AoE, concentration)',
};

const WEIRD_ACTION_LOW_DC: Action = { ...WEIRD_ACTION, saveDC: 5 };

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
    width: 120, height: 120, depth: 1,
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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = WEIRD_ACTION): Combatant {
  return makeCombatant('wiz', { name: 'Caster', pos, actions: [action], resources: withSlots9(1) });
}

function makeWeakEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...overrides });
}

function makeStrongEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...overrides });
}

// ---- 1. Metadata -----------------------------------------------

console.log('\n=== 1. Metadata ===\n');
eq('Name is Weird', metadata.name, 'Weird');
eq('Level is 9', metadata.level, 9);
eq('School is illusion', metadata.school, 'illusion');
eq('Range is 120 ft', metadata.rangeFt, 120);
eq('AoE radius is 30 ft', metadata.aoeRadiusFt, 30);
eq('Die count is 4', metadata.dieCount, 4);
eq('Die sides is 10', metadata.dieSides, 10);
eq('Damage type is psychic', metadata.damageType, 'psychic');
eq('Save ability is wis', metadata.saveAbility, 'wis');
eq('Is concentration', metadata.concentration, true);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots9(1) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when caster lacks Weird action', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCombatant('wiz', { actions: [WEIRD_ACTION], resources: withSlots9(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when no 9th-level slots', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  caster.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any;
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when caster already concentrating', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft > 120 ft
  eq('Returns null when no enemies in range', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const result = shouldCast(caster, makeBF([caster, enemy]));
  assert('Returns non-null array when enemy in range', result !== null);
  if (result) {
    assert('Result is an array', Array.isArray(result));
    eq('Array contains the single enemy', result.length, 1);
    eq('Enemy id matches', result[0].id, 'e1');
  }
}

// ---- 3. shouldCast AoE target selection -----------------------

console.log('\n=== 3. shouldCast AoE target selection ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  // center is the highest-threat enemy within 120 ft → chosen as sphere center.
  const center = makeWeakEnemy('center', { x: 5, y: 0, z: 0 }, { maxHP: 300 });     // 25 ft from caster
  const near = makeWeakEnemy('near', { x: 7, y: 0, z: 0 }, { maxHP: 50 });          // 10 ft from center → caught
  const far = makeWeakEnemy('far', { x: 12, y: 0, z: 0 }, { maxHP: 200 });          // 35 ft from center (> 30) → excluded
  const result = shouldCast(caster, makeBF([caster, center, near, far]));
  if (result) {
    const ids = result.map((c: Combatant) => c.id).sort();
    // center is highest-threat within 120 ft; near is within 30 ft of center; far is NOT.
    eq('Catches center + near (within 30 ft of center), excludes far', ids.join(','), 'center,near');
  }
}

// ---- 4. execute — guaranteed fail (full damage + frightened) ----

console.log('\n=== 4. execute — guaranteed fail ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf);
  assert('shouldCast returns targets', targets !== null);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);
    eq('Slot consumed (9th level: 1 → 0)', (caster.resources as any).spellSlots[9].remaining, 0);
    assert('Concentration started', caster.concentration?.active === true);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Damage in 4d10 range (4-40): got ${dmgDealt}`, dmgDealt >= 4 && dmgDealt <= 40);
    assert('Frightened applied', enemy.conditions.has('frightened'));
    const saveFails = state.log.events.filter(e => e.type === 'save_fail');
    assert('Save-fail log emitted', saveFails.length === 1);
  }
}

// ---- 5. execute — guaranteed success (half damage, no frightened)

console.log('\n=== 5. execute — guaranteed success ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, WEIRD_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf);
  if (targets) {
    const hpBefore = enemy.currentHP;
    execute(caster, targets, state);
    const dmgDealt = hpBefore - enemy.currentHP;
    assert(`Half-damage in 2-20 range: got ${dmgDealt}`, dmgDealt >= 2 && dmgDealt <= 20);
    assert('NOT frightened (save succeeded)', !enemy.conditions.has('frightened'));
    const saveSuccess = state.log.events.filter(e => e.type === 'save_success');
    assert('Save-success log emitted', saveSuccess.length === 1);
  }
}

// ---- 6. execute — AoE hits multiple, caster excluded ----------

console.log('\n=== 6. execute — AoE hits multiple ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const e1 = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeWeakEnemy('e2', { x: 6, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);
  const targets = shouldCast(caster, bf);
  if (targets) {
    const h1 = e1.currentHP, h2 = e2.currentHP;
    execute(caster, targets, state);
    assert('e1 took damage', e1.currentHP < h1);
    assert('e2 took damage', e2.currentHP < h2);
    assert('Both frightened', e1.conditions.has('frightened') && e2.conditions.has('frightened'));
  }
}

// ---- 7. Cleanup is a no-op ------------------------------------

console.log('\n=== 7. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let ok = true;
  try { (require('../spells/weird') as any).cleanup(caster); } catch { ok = false; }
  assert('cleanup() does not throw', ok);
}

// ---- 8. rollDamage respects 4d10 -------------------------------

console.log('\n=== 8. rollDamage ===\n');

{
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1000; i++) {
    const r = rollDamage();
    if (r < min) min = r;
    if (r > max) max = r;
  }
  assert(`rollDamage min >= 4 (got ${min})`, min >= 4);
  assert(`rollDamage max <= 40 (got ${max})`, max <= 40);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
