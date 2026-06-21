// ============================================================
// dominate_monster.test.ts — Dominate Monster v2 (Session 28)
// PHB p.235: 8th-level enchantment, action, range 60 ft, concentration.
// WIS save or dominated (charmed + incapacitated). Any creature (no type restriction).
// ============================================================

import { shouldCast, execute, metadata } from '../spells/dominate_monster';
import { removeEffectsFromCaster } from '../engine/spell_effects';
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

function withSlots8(remaining = 1): PlayerResources {
  return { spellSlots: { 8: { max: 1, remaining } } };
}

const DM_ACTION: Action = {
  name: 'Dominate Monster',
  isMultiattack: false,
  attackType: 'save',
  reach: 5,
  range: { normal: 60, long: 60 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 25,           // guaranteed-fail DC (WIS 1 → max 15 < 25)
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 8,
  costType: 'action',
  legendaryCost: 0,
  description: 'Dominate Monster (WIS save or dominated, 60-ft range, concentration)',
};

const DM_ACTION_LOW_DC: Action = { ...DM_ACTION, saveDC: 5 };

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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }, action: Action = DM_ACTION): Combatant {
  return makeCombatant('wiz', { name: 'Caster', pos, actions: [action], resources: withSlots8(1) });
}

function makeWeakEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...overrides });
}

function makeStrongEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...overrides });
}

// ---- 1. Metadata v2 -------------------------------------------

console.log('\n=== 1. Metadata v2 ===\n');
eq('Name is Dominate Monster', metadata.name, 'Dominate Monster');
eq('Level is 8', metadata.level, 8);
eq('School is enchantment', metadata.school, 'enchantment');
eq('Range is 60 ft', metadata.rangeFt, 60);
eq('Save ability is wis', metadata.saveAbility, 'wis');
eq('Is concentration', metadata.concentration, true);
assert('v2 control flag', (metadata as any).dominateMonsterControlV2Implemented === true);
assert('v1 control flag removed', !(metadata as any).dominateMonsterControlV1Simplified);

// ---- 2. shouldCast gates --------------------------------------

console.log('\n=== 2. shouldCast gates ===\n');

{
  const caster = makeCombatant('wiz', { actions: [], resources: withSlots8(1) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when caster lacks action', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCombatant('wiz', { actions: [DM_ACTION], resources: withSlots8(0) });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when no 8th-level slots', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  caster.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any;
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('Returns null when caster already concentrating', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 50, y: 0, z: 0 }); // 250 ft > 60
  eq('Returns null when no enemies in range', shouldCast(caster, makeBF([caster, enemy])), null);
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const result = shouldCast(caster, makeBF([caster, enemy]));
  assert('Returns non-null when enemy in range', result !== null);
  if (result) eq('Returns the single enemy', (result as Combatant).id, 'e1');
}

// ---- 3. shouldCast target selection ---------------------------

console.log('\n=== 3. shouldCast target selection ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const lowT = makeWeakEnemy('lowT', { x: 1, y: 0, z: 0 }, { maxHP: 30 });
  const highT = makeWeakEnemy('highT', { x: 5, y: 0, z: 0 }, { maxHP: 300 });
  const result = shouldCast(caster, makeBF([caster, lowT, highT]));
  if (result) eq('Picks highest-threat enemy within 60 ft', (result as Combatant).id, 'highT');
}
{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const charmed = makeWeakEnemy('charmed', { x: 1, y: 0, z: 0 }, { maxHP: 300 });
  charmed.conditions.add('charmed' as Condition);
  const fresh = makeWeakEnemy('fresh', { x: 5, y: 0, z: 0 }, { maxHP: 50 });
  const result = shouldCast(caster, makeBF([caster, charmed, fresh]));
  if (result) eq('Skips already-charmed enemy', (result as Combatant).id, 'fresh');
}

// ---- 4. No creature-type restriction ----

console.log('\n=== 4. No creature-type restriction ===\n');

{
  // Beast — valid target
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const beast = makeWeakEnemy('beast', { x: 1, y: 0, z: 0 }, { creatureType: 'beast' } as any);
  const result = shouldCast(caster, makeBF([caster, beast]));
  assert('Beast is valid target for Dominate Monster', result !== null);
  if (result) eq('Beast id', (result as Combatant).id, 'beast');
}
{
  // Humanoid — valid target
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const humanoid = makeWeakEnemy('hum', { x: 1, y: 0, z: 0 }, { creatureType: 'humanoid' } as any);
  const result = shouldCast(caster, makeBF([caster, humanoid]));
  assert('Humanoid is valid target for Dominate Monster', result !== null);
}
{
  // Undead — valid target
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const undead = makeWeakEnemy('und', { x: 1, y: 0, z: 0 }, { creatureType: 'undead' } as any);
  const result = shouldCast(caster, makeBF([caster, undead]));
  assert('Undead is valid target for Dominate Monster', result !== null);
}
{
  // Fiend — valid target
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const fiend = makeWeakEnemy('fiend', { x: 1, y: 0, z: 0 }, { creatureType: 'fiend' } as any);
  const result = shouldCast(caster, makeBF([caster, fiend]));
  assert('Fiend is valid target for Dominate Monster', result !== null);
}

// ---- 5. execute — dominated effect (charmed + incapacitated) ---

console.log('\n=== 5. execute — dominated effect ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);
    eq('Slot consumed (8th level: 1 → 0)', (caster.resources as any).spellSlots[8].remaining, 0);
    assert('Concentration started', caster.concentration?.active === true);
    assert('Charmed applied', enemy.conditions.has('charmed'));
    assert('Incapacitated applied', enemy.conditions.has('incapacitated'));
    const saveFails = state.log.events.filter((e: any) => e.type === 'save_fail');
    assert('Save-fail log emitted', saveFails.length === 1);
    // Check activeEffects has dominated type
    const domEffect = enemy.activeEffects.find(eff => eff.effectType === 'dominated');
    assert('dominated effect present', domEffect !== undefined);
    if (domEffect) {
      eq('effect spellName', domEffect.spellName, 'Dominate Monster');
      eq('effect casterId', domEffect.casterId, 'wiz');
      assert('sourceIsConcentration', domEffect.sourceIsConcentration === true);
    }
  }
}

// ---- 6. execute — guaranteed success (no charm) ---------------

console.log('\n=== 6. execute — guaranteed success ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 }, DM_ACTION_LOW_DC);
  const enemy = makeStrongEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);
    eq('Slot consumed', (caster.resources as any).spellSlots[8].remaining, 0);
    assert('NOT charmed (save succeeded)', !enemy.conditions.has('charmed'));
    assert('NOT incapacitated (save succeeded)', !enemy.conditions.has('incapacitated'));
    const saveSuccess = state.log.events.filter((e: any) => e.type === 'save_success');
    assert('Save-success log emitted', saveSuccess.length === 1);
  }
}

// ---- 7. Concentration break removes both conditions -----------

console.log('\n=== 7. Concentration break removes both conditions ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const target = shouldCast(caster, bf);
  if (target) {
    execute(caster, target as Combatant, state);
    assert('Charmed before break', enemy.conditions.has('charmed'));
    assert('Incapacitated before break', enemy.conditions.has('incapacitated'));
    // Simulate concentration break
    removeEffectsFromCaster(caster.id, bf);
    assert('Charmed removed after break', !enemy.conditions.has('charmed'));
    assert('Incapacitated removed after break', !enemy.conditions.has('incapacitated'));
    assert('No dominated effect remaining', !enemy.activeEffects.some(eff => eff.effectType === 'dominated'));
  }
}

// ---- 8. Already dominated target skipped by shouldCast ---------

console.log('\n=== 8. Already dominated target skipped ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  // First cast dominates the target
  execute(caster, enemy, state);
  assert('Target is charmed', enemy.conditions.has('charmed'));
  // Second cast — caster is concentrating, so shouldCast returns null
  eq('Returns null when already concentrating', shouldCast(caster, bf), null);
}

// ---- 9. Log messages ------------------------------------------

console.log('\n=== 9. Log messages ===\n');

{
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy = makeWeakEnemy('e1', { x: 5, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  execute(caster, enemy, state);
  const domLogs = state.log.events.filter((x: any) => x.description && x.description.includes('DOMINATED'));
  assert('DOMINATED in log', domLogs.length > 0);
  const charmOnlyLogs = state.log.events.filter((x: any) => x.description && x.description.includes('charm only'));
  assert('No "charm only" log', charmOnlyLogs.length === 0);
}

// ---- 10. Cleanup is a no-op ------------------------------------

console.log('\n=== 10. Cleanup is a no-op ===\n');

{
  const caster = makeCaster();
  let ok = true;
  try { (require('../spells/dominate_monster') as any).cleanup(caster); } catch { ok = false; }
  assert('cleanup() does not throw', ok);
}

// ---- Summary ---------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
