// ============================================================
// magic_weapon.test.ts — Magic Weapon spell module
// PHB p.257: 2nd-level transmutation, action, range Touch, concentration (1 hr).
// Effect: touched weapon becomes +1 magic weapon (+1 attack rolls, +1 damage rolls).
//
// v1 simplifications (documented via metadata flags):
//   - Applies to ALL of the wielder's weapon attacks (canon: a specific weapon).
//   - Nonmagical-weapon check skipped.
//   - Upcast +2/+3 NOT modelled.
//   - Concentration started but NOT enforced (TG-002).
//
// Tests cover shouldCast() preconditions + target priority, execute()
// weapon_enchant application via getActiveWeaponEnchant() query helper,
// integration pipeline, and metadata shape.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/magic_weapon';
import { getActiveWeaponEnchant } from '../engine/spell_effects';
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

const MAGIC_WEAPON_ACTION: Action = {
  name: 'Magic Weapon',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 5, long: 5 },
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
  description: 'Magic Weapon (+1 to attack & damage rolls with weapon attacks, concentration 1 hr)',
};

// A melee weapon attack (club) — used to qualify an ally as a Magic Weapon target.
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

// A ranged weapon attack (shortbow) — alternative qualifier.
const SHORTBOW_ACTION: Action = {
  name: 'Shortbow',
  isMultiattack: false,
  attackType: 'ranged',
  reach: 0,
  range: { normal: 80, long: 320 },
  hitBonus: 0,
  damage: { count: 1, sides: 6, bonus: 0, average: 3 },
  damageType: 'piercing',
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 0,
  costType: 'action',
  legendaryCost: 0,
  description: 'Shortbow (ranged weapon attack)',
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

/** Wizard caster at (0,0,0) with Magic Weapon + 2 2nd-level slots.
 *  Wizard has NO weapon attack (so it cannot self-target by default). */
function makeWizard(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard1', {
    name: 'Wizard',
    pos,
    actions: [MAGIC_WEAPON_ACTION],
    resources: withSlots2(2),
  });
}

/** Ally with a melee weapon attack (Club). */
function makeArmedAlly(
  id: string,
  pos: Vec3 = { x: 1, y: 0, z: 0 },
  overrides: Partial<Combatant> = {},
): Combatant {
  return makeCombatant(id, {
    name: id,
    pos,
    actions: [CLUB_ACTION],
    ...overrides,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Magic Weapon', metadata.name, 'Magic Weapon');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('bonus is +1', (metadata as any).bonus, 1);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: per-weapon tracking NOT implemented',
  (metadata as any).magicWeaponPerWeaponV1Implemented, false);
eq('v1: nonmagical-weapon check NOT implemented',
  (metadata as any).magicWeaponNonmagicalCheckV1Implemented, false);
eq('v1: upcast NOT implemented',
  (metadata as any).magicWeaponUpcastV1Implemented, false);
eq('v1: concentration enforcement NOT implemented',
  (metadata as any).magicWeaponConcentrationEnforcementV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates + priority
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates + priority ===\n');

{
  // 2a. Caster is already concentrating — cannot cast
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2b. Caster lacks 'Magic Weapon' action
  const caster = makeWizard();
  caster.actions = [];
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Magic Weapon action', shouldCast(caster, bf) === null);
}

{
  // 2c. No 2nd-level slots remaining
  const caster = makeWizard();
  caster.resources = withSlots2(0);
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2d. No ally with a weapon attack in range
  const caster = makeWizard();
  // Ally has only spell/buff actions — no melee/ranged
  const ally = makeCombatant('a1', {
    name: 'a1',
    pos: { x: 1, y: 0, z: 0 },
    actions: [],
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no ally has a weapon attack', shouldCast(caster, bf) === null);
}

{
  // 2e. Out of range: armed ally >5 ft away
  const caster = makeWizard();
  const farAlly = makeArmedAlly('far', { x: 5, y: 0, z: 0 });  // 25 ft
  const bf = makeBF([caster, farAlly]);
  assert('Returns null when armed ally is out of touch range', shouldCast(caster, bf) === null);
}

{
  // 2f. Ally already Magic-Weapon'd by this caster — skip
  const caster = makeWizard();
  const ally = makeArmedAlly('a1');
  ally.activeEffects.push({
    id: 'eff_1', casterId: caster.id, spellName: 'Magic Weapon',
    effectType: 'weapon_enchant', payload: { attackBonus: 1, damageBonus: 1 },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null when ally already Magic-Weapon\'d by this caster', shouldCast(caster, bf) === null);
}

{
  // 2g. Self first: caster with their OWN weapon attack can self-target
  const caster = makeWizard();
  caster.actions = [MAGIC_WEAPON_ACTION, CLUB_ACTION];
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  eq('Caster with weapon attack targets self', shouldCast(caster, bf)?.id, 'wizard1');
}

{
  // 2h. Lowest-HP% armed ally preferred (caster has no weapon attack)
  const caster = makeWizard();
  const hurt = makeArmedAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  const full = makeArmedAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, hurt, full]);
  eq('Lowest-HP% armed ally selected', shouldCast(caster, bf)?.id, 'hurt');
}

{
  // 2i. Touch range: all non-self allies at chebyshev=1 are at 5 ft — the
  // distance tiebreak cannot differentiate them. Verify stable behaviour:
  // two equal-HP% armed allies both qualify, shouldCast returns one of them.
  const caster = makeWizard();
  const a = makeArmedAlly('a', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 20 });
  const b = makeArmedAlly('b', { x: 0, y: 1, z: 0 }, { maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, a, b]);
  const target = shouldCast(caster, bf)?.id;
  assert('Tie-break selects one of the equal-priority armed allies',
    target === 'a' || target === 'b', `got ${target}`);
}

{
  // 2j. Ranged weapon attack also qualifies (shortbow)
  const caster = makeWizard();
  const archer = makeCombatant('archer', {
    name: 'archer',
    pos: { x: 1, y: 0, z: 0 },
    actions: [SHORTBOW_ACTION],
  });
  const bf = makeBF([caster, archer]);
  eq('Ranged-weapon ally qualifies as target', shouldCast(caster, bf)?.id, 'archer');
}

// ============================================================
// 3. execute — weapon_enchant application
// ============================================================

console.log('\n=== 3. execute — weapon_enchant application ===\n');

{
  // 3a. weapon_enchant effect attached with attackBonus: 1, damageBonus: 1
  const caster = makeWizard();
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const enchants = ally.activeEffects.filter(e => e.effectType === 'weapon_enchant');
  eq('1 weapon_enchant effect applied', enchants.length, 1);
  if (enchants.length === 1) {
    eq('attackBonus is 1', enchants[0].payload.attackBonus, 1);
    eq('damageBonus is 1', enchants[0].payload.damageBonus, 1);
    eq('sourceIsConcentration is true', enchants[0].sourceIsConcentration, true);
    eq('spellName is Magic Weapon', enchants[0].spellName, 'Magic Weapon');
    eq('casterId is the wizard', enchants[0].casterId, 'wizard1');
  }

  // Query helper returns the same values
  const enchant = getActiveWeaponEnchant(ally);
  eq('getActiveWeaponEnchant attackBonus is 1', enchant.attackBonus, 1);
  eq('getActiveWeaponEnchant damageBonus is 1', enchant.damageBonus, 1);

  eq('Slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 3b. Concentration started on caster
  const caster = makeWizard();
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Magic Weapon', caster.concentration?.spellName, 'Magic Weapon');
}

{
  // 3c. Existing concentration broken (safety net) — prior effects removed
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeArmedAlly('a1');
  ally.activeEffects.push({
    id: 'eff_bless', casterId: caster.id, spellName: 'Bless',
    effectType: 'bless_die', payload: { dieSides: 4 }, sourceIsConcentration: true,
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  // shouldCast returned null because caster.concentration?.active is true.
  // So force-execute directly to test the safety-net branch.
  execute(caster, ally, state);

  eq('Concentration switched to Magic Weapon', caster.concentration?.spellName, 'Magic Weapon');
  assert('Prior Bless effect removed from ally',
    !ally.activeEffects.some(e => e.spellName === 'Bless'));
}

{
  // 3d. Dead target skipped (stale edge case) — slot consumed, no effect
  const caster = makeWizard();
  const ally = makeArmedAlly('a1', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Slot consumed even for dead target (stale plan)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('No weapon_enchant on dead target',
    ally.activeEffects.filter(e => e.effectType === 'weapon_enchant').length, 0);
}

{
  // 3e. getActiveWeaponEnchant returns 0/0 with no effects
  const c = makeCombatant('c1');
  const z = getActiveWeaponEnchant(c);
  eq('No weapon_enchant → attackBonus 0', z.attackBonus, 0);
  eq('No weapon_enchant → damageBonus 0', z.damageBonus, 0);
}

// ============================================================
// 4. execute — logging
// ============================================================

console.log('\n=== 4. execute — logging ===\n');

{
  const caster = makeWizard();
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf)!;
  execute(caster, target, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Magic Weapon"',
    actionEvents[0].description.includes('Magic Weapon'));
  eq('1 condition_add event (weapon_enchant applied)', condEvents.length, 1);
  assert('condition_add mentions weapon glows',
    condEvents[0].description.includes('weapon'));
}

// ============================================================
// 5. cleanup — no-op
// ============================================================

console.log('\n=== 5. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/magic_weapon');
  const caster = makeWizard();
  caster.concentration = { active: true, spellName: 'Magic Weapon', dcIfHit: 10 };
  // cleanup should NOT break concentration (concentration break is handled
  // by removeEffectsFromCaster, not by cleanup).
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT change spellName', caster.concentration?.spellName, 'Magic Weapon');
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: caster buffs lowest-HP% armed ally
  const caster = makeWizard();
  const hurt = makeArmedAlly('hurt', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 10 });
  const full = makeArmedAlly('full', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, hurt, full]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  eq('shouldCast returns the lowest-HP% armed ally (hurt)', target?.id, 'hurt');
  if (target) execute(caster, target, state);

  // Hurt ally has weapon_enchant
  const hurtEnchant = getActiveWeaponEnchant(hurt);
  eq('Hurt ally attackBonus is 1', hurtEnchant.attackBonus, 1);
  eq('Hurt ally damageBonus is 1', hurtEnchant.damageBonus, 1);
  // Full ally has NO weapon_enchant
  const fullEnchant = getActiveWeaponEnchant(full);
  eq('Full ally attackBonus is 0 (not targeted)', fullEnchant.attackBonus, 0);
  eq('Full ally damageBonus is 0 (not targeted)', fullEnchant.damageBonus, 0);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Magic Weapon', caster.concentration?.spellName, 'Magic Weapon');
}

{
  // 6b. After slots exhausted, shouldCast returns null
  const caster = makeWizard();
  caster.resources = withSlots2(1);
  const ally = makeArmedAlly('a1');
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  // Caster now concentrating — shouldCast should also return null due to
  // concentration gate (it returns null on EITHER reason; we just assert null)
  const t2 = shouldCast(caster, makeBF([caster, makeArmedAlly('a2')]));
  assert('shouldCast returns null after slots exhausted / concentration active', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
