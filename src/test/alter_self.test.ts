// ============================================================
// alter_self.test.ts — Alter Self spell module
// PHB p.211: 2nd-level transmutation, action, range Self, concentration (10 min).
// Effect: choose Aquatic Adaptation / Change Appearance / Natural Weapons.
//         v1 implements ONLY Natural Weapons: unarmed strikes deal 1d6
//         slashing + STR mod (replaces 1 + STR mod).
//
// v1 simplifications (documented via metadata flags):
//   - Only Natural Weapons option (Aquatic Adaptation / Change Appearance NOT modelled).
//   - Always slashing (canon: chosen at cast time).
//   - Magical-unarmed-strike rider moot (no nonmagical-B/P/S resistance subsystem).
//   - Concentration started but NOT enforced (TG-002).
//   - Planner only casts when caster has NO weapon attacks (fallback for
//     spell-only casters).
//
// Tests cover shouldCast() preconditions + execute() scratch-field application
// + sentinel effect attachment + slot consumption + logging.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/alter_self';
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

const ALTER_SELF_ACTION: Action = {
  name: 'Alter Self',
  isMultiattack: false,
  attackType: 'special',  // self-buff — NOT 'melee'/'ranged'
  reach: 0,
  range: { normal: 0, long: 0 },   // Self
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: true,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Alter Self — Natural Weapons (unarmed strikes deal 1d6 slashing, concentration 10 min)',
};

// A melee weapon attack (club) — used to test the "caster has weapon attacks" gate.
const CLUB_ACTION: Action = {
  name: 'Club',
  isMultiattack: false,
  attackType: 'melee',
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: 0,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'bludgeoning',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Club (melee weapon attack)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
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
    width: 20, height: 20, depth: 1,
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

/** Spell-only sorcerer at (0,0,0) with Alter Self + 2 2nd-level slots.
 *  Has NO weapon attacks (only the Alter Self action). */
function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('sorcerer1', {
    name: 'Sorcerer',
    pos,
    actions: [ALTER_SELF_ACTION],
    resources: withSlots2(2),
  });
}

function makeEnemy(
  id: string,
  pos: Vec3 = { x: 1, y: 0, z: 0 },
  overrides: Partial<Combatant> = {},
): Combatant {
  return makeCombatant(id, { name: id, faction: 'enemy', pos, ...overrides });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Alter Self', metadata.name, 'Alter Self');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 0 ft (self)', metadata.rangeFt, 0);
eq('unarmedDieSides is 6', (metadata as any).unarmedDieSides, 6);
eq('unarmedDamageType is slashing', (metadata as any).unarmedDamageType, 'slashing');
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: Aquatic Adaptation NOT implemented',
  (metadata as any).alterSelfAquaticAdaptationV1Implemented, false);
eq('v1: Change Appearance NOT implemented',
  (metadata as any).alterSelfChangeAppearanceV1Implemented, false);
eq('v1: concentration enforcement NOW implemented (Session 34 TG-002)',
  (metadata as any).alterSelfConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeSorcerer();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster is already concentrating', shouldCast(caster, bf), false);
}

{
  // 2b. Caster lacks 'Alter Self' action
  const caster = makeSorcerer();
  caster.actions = [];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has no Alter Self action', shouldCast(caster, bf), false);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeSorcerer();
  caster.resources = withSlots2(0);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when no 2nd-level slots', shouldCast(caster, bf), false);
}

{
  // 2d. Already Alter-Self-active (re-cast would only refresh) — skip
  const caster = makeSorcerer();
  caster._alterSelfActive = 'naturalWeapons';
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when already Alter-Self-active', shouldCast(caster, bf), false);
}

{
  // 2e. Caster HAS a weapon attack → no need for natural weapons → false
  const caster = makeSorcerer();
  caster.actions = [ALTER_SELF_ACTION, CLUB_ACTION];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns false when caster has a weapon attack (no fallback needed)', shouldCast(caster, bf), false);
}

{
  // 2f. No living enemies → buff useless → false
  const caster = makeSorcerer();
  const deadEnemy = makeEnemy('e1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadEnemy]);
  eq('Returns false when no living enemies', shouldCast(caster, bf), false);
}

{
  // 2g. All preconditions met → returns true
  const caster = makeSorcerer();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Returns true when all preconditions met', shouldCast(caster, bf), true);
}

// ============================================================
// 3. execute — scratch field + sentinel + concentration
// ============================================================

console.log('\n=== 3. execute — scratch field + sentinel + concentration ===\n');

{
  // 3a. _alterSelfActive set to 'naturalWeapons'
  const caster = makeSorcerer();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  eq('Scratch field undefined before cast', caster._alterSelfActive, undefined);

  execute(caster, state);

  eq('Scratch field set', caster._alterSelfActive, 'naturalWeapons');
}

{
  // 3b. Sentinel damage_zone effect attached (dieCount=0)
  const caster = makeSorcerer();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const sentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Alter Self',
  );
  eq('1 sentinel damage_zone effect attached', sentinels.length, 1);
  if (sentinels.length === 1) {
    eq('Sentinel dieCount is 0 (no damage tick)', sentinels[0].payload.dieCount, 0);
    eq('Sentinel sourceIsConcentration is true', sentinels[0].sourceIsConcentration, true);
    eq('Sentinel casterId is the sorcerer', sentinels[0].casterId, 'sorcerer1');
  }
}

{
  // 3c. Slot consumed + concentration started
  const caster = makeSorcerer();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Alter Self', caster.concentration?.spellName, 'Alter Self');
}

{
  // 3d. Existing concentration broken (safety net)
  const caster = makeSorcerer();
  caster.concentration = { active: true, spellName: 'Blur', dcIfHit: 10 };
  // Pre-existing Blur effect on caster (simulated)
  caster.activeEffects.push({
    id: 'eff_blur', casterId: caster.id, spellName: 'Blur',
    effectType: 'condition_apply', payload: { condition: 'hidden' as any },
    sourceIsConcentration: true,
  });
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  eq('Concentration switched to Alter Self', caster.concentration?.spellName, 'Alter Self');
  assert('Prior Blur effect removed from caster',
    !caster.activeEffects.some(e => e.spellName === 'Blur'));
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeSorcerer();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Alter Self"',
    actionEvents[0].description.includes('Alter Self'));
  eq('1 condition_add event (natural weapons granted)', condEvents.length, 1);
  assert('condition_add mentions natural weapons',
    condEvents[0].description.includes('natural weapons') ||
    condEvents[0].description.includes('Natural Weapons'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/alter_self');
  const caster = makeSorcerer();
  caster._alterSelfActive = 'naturalWeapons';
  caster.concentration = { active: true, spellName: 'Alter Self', dcIfHit: 10 };
  // cleanup should NOT clear the scratch field or break concentration.
  // (Concentration-break cleanup is handled by removeEffectsFromCaster's
  // _undoEffect branch for the sentinel.)
  cleanup(caster);
  eq('Cleanup does NOT clear scratch field', caster._alterSelfActive, 'naturalWeapons');
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: spell-only sorcerer casts Alter Self in combat
  const caster = makeSorcerer();
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const decision = shouldCast(caster, bf);
  eq('shouldCast returns true', decision, true);
  if (decision) execute(caster, state);

  eq('Scratch field set to naturalWeapons', caster._alterSelfActive, 'naturalWeapons');
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Alter Self', caster.concentration?.spellName, 'Alter Self');

  const sentinels = caster.activeEffects.filter(
    e => e.effectType === 'damage_zone' && e.spellName === 'Alter Self',
  );
  eq('Sentinel effect attached', sentinels.length, 1);
}

{
  // 6b. After slots exhausted, shouldCast returns false
  const caster = makeSorcerer();
  caster.resources = withSlots2(1);
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  const d1 = shouldCast(caster, bf);
  if (d1) execute(caster, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Caster is now concentrating → second shouldCast also returns false
  const d2 = shouldCast(caster, bf);
  eq('shouldCast returns false after slots exhausted / concentration active', d2, false);
}

{
  // 6c. Caster with a weapon attack never gets Alter Self suggested
  const caster = makeSorcerer();
  caster.actions = [ALTER_SELF_ACTION, CLUB_ACTION];
  const enemy = makeEnemy('e1');
  const bf = makeBF([caster, enemy]);
  eq('Caster with weapon attack → shouldCast false', shouldCast(caster, bf), false);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
