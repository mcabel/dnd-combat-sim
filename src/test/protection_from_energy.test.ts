// ============================================================
// Test: Protection from Energy (TG-008 closure — 7th reaction-family spell)
// PHB p.266 — 3rd-level abjuration, action, touch, concentration 10 min.
//
// Tests:
//   1. metadata correctness
//   2. pickTarget — single ally in range
//   3. pickTarget — self when alone
//   4. pickTarget — lowest-HP% priority
//   5. pickTarget — already-protected ally excluded
//   6. pickDamageType — most common enemy damage type
//   7. pickDamageType — default to fire
//   8. shouldCast — preconditions (action known, slot, not concentrating, target exists)
//   9. execute — consumes slot, starts concentration, applies resistance + sentinel
//  10. execute — damage halved by resistance
//  11. concentration break — resistance removed, sentinel removed
//  12. concentration break — innate resistance PRESERVED (Session 36 fix)
//  13. execute via generic-registry dispatch (end-to-end)
//  14. Upcast — multi-target selection (Session 36)
//  15. Innate-resistance fix — addedResistance flag (Session 36)
//
// Run: npx ts-node src/test/protection_from_energy.test.ts
// ============================================================

import {
  metadata,
  shouldCast,
  pickTarget,
  pickDamageType,
  execute,
  executeWithTarget,
  executeWithTargets,
} from '../spells/protection_from_energy';
import { lookupGenericSpell } from '../spells/_generic_registry';
import {
  applySpellEffect,
  removeEffectsFromCaster,
  _resetEffectIdCounter,
} from '../engine/spell_effects';
import { startConcentration, applyDamageWithTempHP } from '../engine/utils';
import { Combatant, Action, PlayerResources, Battlefield, DamageType } from '../types/core';
import { EngineState } from '../engine/combat';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  _id++;
  const id = o.id ?? `c${_id}`;
  return {
    id,
    name: o.name ?? id,
    isPlayer: false,
    faction: 'party',
    maxHP: 50,
    currentHP: 50,
    ac: 14,
    speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false,
              reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
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
    bardicInspirationDie: null, wardingBond: null,
    activeEffects: [],
    ...o,
  };
}

function withSlots(remaining = 2): PlayerResources {
  return {
    spellSlots: {
      1: { max: 4, remaining: 4 },
      2: { max: 3, remaining: 3 },
      3: { max: remaining, remaining },
      4: { max: 1, remaining: 1 },
    },
  };
}

/** No slots at L3 or higher (for "no slot" test). */
function withNoHighSlots(): PlayerResources {
  return {
    spellSlots: {
      1: { max: 4, remaining: 4 },
      2: { max: 3, remaining: 3 },
      3: { max: 2, remaining: 0 },
      4: { max: 1, remaining: 0 },
    },
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 20, height: 20, depth: 1,
    cells: [],
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

const PFE_ACTION: Action = {
  name: 'Protection from Energy',
  isMultiattack: false,
  attackType: null,
  reach: 0, range: null,
  hitBonus: null,
  damage: null, damageType: null,
  saveDC: null, saveAbility: null,
  isAoE: false, isControl: false,
  requiresConcentration: false,
  slotLevel: 3,
  costType: 'action',
  legendaryCost: 0,
  description: 'Protection from Energy',
};

function makeAttackAction(damageType: DamageType): Action {
  return {
    name: `${damageType} Breath`,
    isMultiattack: false,
    attackType: 'spell',
    reach: 0, range: { normal: 30, long: 30 },
    hitBonus: 5,
    damage: { count: 2, sides: 6, bonus: 0, average: 7 },
    damageType,
    saveDC: 13, saveAbility: 'dex',
    isAoE: true, isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: `${damageType} Breath`,
  };
}

function reset(): void {
  _resetEffectIdCounter();
}

// ============================================================
// 1. metadata
// ============================================================
console.log('\n=== 1. metadata ===\n');
reset();
{
  eq('name', metadata.name, 'Protection from Energy');
  eq('level is 3', metadata.level, 3);
  eq('school is abjuration', metadata.school, 'abjuration');
  eq('range is 5 ft (touch)', metadata.rangeFt, 5);
  eq('is concentration', metadata.concentration, true);
  eq('casting time is action', metadata.castingTime, 'action');
  eq('upcast NOW implemented (Session 36)', metadata.protectionFromEnergyUpcastV1Implemented, true);
  eq('innate-resistance fix NOW implemented (Session 36)',
    metadata.protectionFromEnergyInnateResistanceFixV1Implemented, true);
  eq('concentration enforcement IS implemented (Session 34 TG-002)',
    metadata.protectionFromEnergyConcentrationEnforcementV1Implemented, true);
  // Eligible types array sanity check
  assert('eligible types has 5 entries',
    metadata.protectionFromEnergyEligibleTypes.length === 5);
  assert('eligible includes fire',
    (metadata.protectionFromEnergyEligibleTypes as readonly string[]).includes('fire'));
}

// ============================================================
// 2. pickTarget — single ally in range
// ============================================================
console.log('\n=== 2. pickTarget — single ally in range ===\n');
reset();
{
  const caster = makeC({ id: 'wiz', name: 'Wizard', pos: { x: 5, y: 5, z: 0 } });
  const ally = makeC({ id: 'ally', name: 'Ally', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, ally]);

  const target = pickTarget(caster, bf);
  assert('2a. pickTarget returns a combatant', target !== null);
  eq('2b. target is the ally (self-priority only when no ally closer/healthier)',
    target?.id, 'ally');
}

// ============================================================
// 3. pickTarget — self when alone
// ============================================================
console.log('\n=== 3. pickTarget — self when alone ===\n');
reset();
{
  const caster = makeC({ id: 'wiz', name: 'Wizard', pos: { x: 5, y: 5, z: 0 } });
  const bf = makeBF([caster]);

  const target = pickTarget(caster, bf);
  assert('3a. pickTarget returns self when alone', target !== null);
  eq('3b. target is the caster', target?.id, 'wiz');
}

// ============================================================
// 4. pickTarget — lowest-HP% priority
// ============================================================
console.log('\n=== 4. pickTarget — lowest-HP% priority ===\n');
reset();
{
  const caster = makeC({ id: 'wiz', name: 'Wizard', pos: { x: 5, y: 5, z: 0 } });
  const hurt = makeC({
    id: 'hurt', name: 'Hurt Ally',
    pos: { x: 6, y: 5, z: 0 },
    maxHP: 50, currentHP: 10,
  });
  const full = makeC({
    id: 'full', name: 'Full HP Ally',
    pos: { x: 7, y: 5, z: 0 },
    maxHP: 50, currentHP: 50,
  });
  const bf = makeBF([caster, hurt, full]);

  const target = pickTarget(caster, bf);
  eq('4a. target is the lowest-HP ally', target?.id, 'hurt');
}

// ============================================================
// 5. pickTarget — already-protected ally excluded
// ============================================================
console.log('\n=== 5. pickTarget — already-protected ally excluded ===\n');
reset();
{
  const caster = makeC({ id: 'wiz', name: 'Wizard', pos: { x: 5, y: 5, z: 0 } });
  const protected1 = makeC({
    id: 'prot', name: 'Protected Ally',
    pos: { x: 6, y: 5, z: 0 },
  });
  // Pre-attach a Protection from Energy effect from this caster
  applySpellEffect(protected1, {
    casterId: caster.id,
    spellName: 'Protection from Energy',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'fire' },
    sourceIsConcentration: true,
  });
  const fresh = makeC({
    id: 'fresh', name: 'Fresh Ally',
    pos: { x: 5, y: 6, z: 0 },  // within 5 ft of caster (chebyshev = 1)
  });
  const bf = makeBF([caster, protected1, fresh]);

  const target = pickTarget(caster, bf);
  eq('5a. protected ally skipped, fresh ally chosen', target?.id, 'fresh');
}

// ============================================================
// 6. pickDamageType — most common enemy damage type
// ============================================================
console.log('\n=== 6. pickDamageType — most common enemy damage type ===\n');
reset();
{
  const caster = makeC({ id: 'wiz', pos: { x: 5, y: 5, z: 0 }, faction: 'party' });
  const e1 = makeC({
    id: 'e1', pos: { x: 0, y: 0, z: 0 }, faction: 'enemy',
    actions: [makeAttackAction('fire'), makeAttackAction('fire')],
  });
  const e2 = makeC({
    id: 'e2', pos: { x: 1, y: 0, z: 0 }, faction: 'enemy',
    actions: [makeAttackAction('cold')],
  });
  const bf = makeBF([caster, e1, e2]);

  const dt = pickDamageType(caster, bf);
  eq('6a. most common enemy type picked (fire x2 > cold x1)', dt, 'fire');
}

// ============================================================
// 7. pickDamageType — default to fire (no eligible enemy types)
// ============================================================
console.log('\n=== 7. pickDamageType — default to fire ===\n');
reset();
{
  const caster = makeC({ id: 'wiz', pos: { x: 5, y: 5, z: 0 }, faction: 'party' });
  const e1 = makeC({
    id: 'e1', pos: { x: 0, y: 0, z: 0 }, faction: 'enemy',
    actions: [makeAttackAction('slashing')],  // slashing NOT eligible
  });
  const bf = makeBF([caster, e1]);

  const dt = pickDamageType(caster, bf);
  eq('7a. defaults to fire when no eligible enemy type', dt, 'fire');
}

// ============================================================
// 8. shouldCast — preconditions
// ============================================================
console.log('\n=== 8. shouldCast — preconditions ===\n');
reset();
{
  // 8a. Happy path: action known, slot available, not concentrating, ally in range
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const ally = makeC({ id: 'ally', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, ally]);
  eq('8a. shouldCast true (happy path)', shouldCast(caster, bf), true);

  // 8b. Caster doesn't know the spell
  const caster2 = makeC({
    id: 'wiz2', pos: { x: 5, y: 5, z: 0 },
    actions: [], resources: withSlots(2),
  });
  eq('8b. shouldCast false (no action)', shouldCast(caster2, bf), false);

  // 8c. No 3rd-level slot
  const caster3 = makeC({
    id: 'wiz3', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withNoHighSlots(),
  });
  eq('8c. shouldCast false (no slot)', shouldCast(caster3, bf), false);

  // 8d. Already concentrating
  const caster4 = makeC({
    id: 'wiz4', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  startConcentration(caster4, 'Bless');
  eq('8d. shouldCast false (already concentrating)', shouldCast(caster4, bf), false);

  // 8e. No ally in touch range (caster alone, but caster themselves is a valid self-target)
  // Actually pickTarget returns self when alone — so shouldCast returns true.
  const caster5 = makeC({
    id: 'wiz5', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const bf5 = makeBF([caster5]);
  eq('8e. shouldCast true (self is a valid target)', shouldCast(caster5, bf5), true);

  // 8f. Caster is dead
  const caster6 = makeC({
    id: 'wiz6', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
    isDead: true,
  });
  const bf6 = makeBF([caster6]);
  eq('8f. shouldCast false when caster dead (no living target in range)',
    shouldCast(caster6, bf6), false);
}

// ============================================================
// 9. execute — consumes slot, starts concentration, applies resistance + sentinel
// ============================================================
console.log('\n=== 9. execute — applies buff correctly ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz', name: 'Wizard',
    pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const ally = makeC({
    id: 'ally', name: 'Ally',
    pos: { x: 6, y: 5, z: 0 },
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executeWithTarget(caster, ally, state, 'fire');

  // 9a. Slot consumed
  eq('9a. 3rd-level slot consumed', caster.resources!.spellSlots![3].remaining, 1);
  // 9b. Concentration started
  eq('9b. concentration active', caster.concentration?.active, true);
  eq('9c. concentration spellName', caster.concentration?.spellName, 'Protection from Energy');
  // 9d. Resistance added
  assert('9d. fire resistance added to ally', ally.resistances.includes('fire'));
  // 9e. Sentinel effect attached
  const sentinel = ally.activeEffects.find(e => e.spellName === 'Protection from Energy');
  assert('9e. sentinel effect attached', sentinel !== undefined);
  eq('9f. sentinel is damage_zone type', sentinel?.effectType, 'damage_zone');
  eq('9g. sentinel dieCount=0 (no start-of-turn damage)', sentinel?.payload.dieCount, 0);
  eq('9h. sentinel damageType stored', sentinel?.payload.damageType, 'fire');
  eq('9i. sentinel sourceIsConcentration', sentinel?.sourceIsConcentration, true);

  // 9j. Log events
  const castEvent = state.log.events.find(e => e.type === 'action' && e.description.includes('casts Protection from Energy'));
  assert('9j. cast logged', castEvent !== undefined);
  const buffEvent = state.log.events.find(e => e.type === 'condition_add' && e.description.includes('resistance to fire'));
  assert('9k. buff logged', buffEvent !== undefined);
}

// ============================================================
// 10. execute — damage halved by resistance
// ============================================================
console.log('\n=== 10. execute — damage halved by resistance ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const ally = makeC({
    id: 'ally', pos: { x: 6, y: 5, z: 0 },
    maxHP: 100, currentHP: 100,
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executeWithTarget(caster, ally, state, 'fire');

  const before = ally.currentHP;
  applyDamageWithTempHP(ally, 40, 'fire');
  // 40 fire damage, resistance → 20 damage taken
  eq('10a. fire damage halved (40 → 20)', before - ally.currentHP, 20);

  // Cold damage NOT halved (resistance is fire only)
  const before2 = ally.currentHP;
  applyDamageWithTempHP(ally, 30, 'cold');
  eq('10b. cold damage NOT halved (full 30)', before2 - ally.currentHP, 30);
}

// ============================================================
// 11. concentration break — resistance + sentinel removed
// ============================================================
console.log('\n=== 11. concentration break — cleanup ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const ally = makeC({
    id: 'ally', pos: { x: 6, y: 5, z: 0 },
    maxHP: 100, currentHP: 100,
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  executeWithTarget(caster, ally, state, 'lightning');

  assert('11a. lightning resistance applied before break', ally.resistances.includes('lightning'));
  assert('11b. sentinel effect attached before break', ally.activeEffects.some(e => e.spellName === 'Protection from Energy'));

  // Simulate concentration break: removeEffectsFromCaster
  removeEffectsFromCaster(caster.id, bf);

  // _undoEffect's 'Protection from Energy' case should remove the resistance
  assert('11c. lightning resistance removed after break', !ally.resistances.includes('lightning'));
  assert('11d. sentinel effect removed after break',
    !ally.activeEffects.some(e => e.spellName === 'Protection from Energy'));

  // Damage no longer halved
  const before = ally.currentHP;
  applyDamageWithTempHP(ally, 40, 'lightning');
  eq('11e. lightning damage NOT halved after break (full 40)', before - ally.currentHP, 40);
}

// ============================================================
// 12. concentration break — innate resistance PRESERVED (Session 36 fix)
// ============================================================
console.log('\n=== 12. concentration break — innate resistance preserved (Session 36 fix) ===\n');
reset();
{
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  // Ally has INNATE fire resistance (e.g. a race feature)
  const ally = makeC({
    id: 'ally', pos: { x: 6, y: 5, z: 0 },
    resistances: ['fire'],
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  // Caster also grants fire resistance via Protection from Energy.
  // The spell's idempotent check means the resistance array doesn't change
  // (no duplicate push), and the sentinel records `addedResistance: false`.
  executeWithTarget(caster, ally, state, 'fire');
  eq('12a. resistances array still has 1 fire entry (idempotent)',
    ally.resistances.filter(r => r === 'fire').length, 1);
  assert('12b. sentinel effect attached', ally.activeEffects.some(e => e.spellName === 'Protection from Energy'));

  // Session 36 fix: the sentinel records addedResistance=false because the
  // spell did NOT push a new entry (the innate one was already there).
  const sentinel = ally.activeEffects.find(e => e.spellName === 'Protection from Energy');
  eq('12c. sentinel payload.addedResistance === false (innate, no push)',
    sentinel?.payload.addedResistance, false);

  // On concentration break, _undoEffect checks addedResistance and does NOT
  // splice — the innate fire resistance is PRESERVED.
  removeEffectsFromCaster(caster.id, bf);

  // Sentinel removed (cleanup worked)
  assert('12d. sentinel effect removed after break',
    !ally.activeEffects.some(e => e.spellName === 'Protection from Energy'));
  // Innate fire resistance PRESERVED (Session 36 fix — was a v1 simplification)
  assert('12e. innate fire resistance PRESERVED after break (Session 36 fix)',
    ally.resistances.includes('fire'));
  eq('12f. resistances array still has exactly 1 fire entry',
    ally.resistances.filter(r => r === 'fire').length, 1);

  // Damage still halved after break (innate resistance persists)
  const before = ally.currentHP;
  applyDamageWithTempHP(ally, 40, 'fire');
  eq('12g. fire damage STILL halved after break (innate resistance intact, 40 → 20)',
    before - ally.currentHP, 20);
}

// ============================================================
// 13. execute via generic-registry dispatch (end-to-end)
// ============================================================
console.log('\n=== 13. generic-registry dispatch ===\n');
reset();
{
  // Verify the spell is registered in the generic registry.
  const desc = lookupGenericSpell('Protection from Energy');
  assert('13a. registered in generic registry', desc !== null);
  eq('13b. registry name', desc?.name, 'Protection from Energy');
  eq('13c. registry level', desc?.level, 3);

  // Drive the spell end-to-end via the registry's shouldCast + execute.
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
    faction: 'party',
  });
  const enemy = makeC({
    id: 'enemy', pos: { x: 0, y: 0, z: 0 }, faction: 'enemy',
    actions: [makeAttackAction('cold')],
  });
  const ally = makeC({
    id: 'ally', pos: { x: 6, y: 5, z: 0 }, faction: 'party',
  });
  const bf = makeBF([caster, enemy, ally]);
  const state = makeState(bf);

  eq('13d. shouldCast returns true', desc!.shouldCast(caster, bf), true);

  // Execute via the registry entry (mirrors combat.ts's case 'genericSpell')
  desc!.execute(caster, state);

  // Verify the buff was applied (target + damageType picked automatically).
  assert('13e. ally got resistance (cold, since enemy deals cold damage)',
    ally.resistances.includes('cold') || caster.resistances.includes('cold'));
  assert('13f. concentration started', caster.concentration?.active === true);
  eq('13g. slot consumed', caster.resources!.spellSlots![3].remaining, 1);
}

// ============================================================
// 14. Upcast — multi-target selection (Session 36)
// ============================================================
console.log('\n=== 14. Upcast — multi-target selection (Session 36) ===\n');

/**
 * Resources with slots at multiple levels for upcast testing.
 * Defaults to NO slots; pass overrides like { 3: 1, 4: 1 }.
 */
function withSlotsMulti(overrides: { [level: number]: number } = {}): PlayerResources {
  const spellSlots: any = {};
  for (let lvl = 1; lvl <= 9; lvl++) {
    spellSlots[lvl] = { max: 2, remaining: overrides[lvl] ?? 0 };
  }
  return { spellSlots };
}

/** Count how many combatants in `bf` currently have a Protection from Energy sentinel. */
function countProtected(bf: Battlefield): number {
  let n = 0;
  for (const c of bf.combatants.values()) {
    if (c.activeEffects.some(e => e.spellName === 'Protection from Energy')) n++;
  }
  return n;
}

{
  // 14a. L3 slot only + 2 allies in range → only 1 ally gets resistance (no upcast)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 3: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  execute(caster, state);
  eq('14a. L3 slot → 1 target protected (no upcast)', countProtected(bf), 1);
  eq('14a. L3 slot consumed', caster.resources!.spellSlots![3].remaining, 0);
}

{
  // 14b. L4 slot + 2 allies → 2 allies get resistance (upcast by 1)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 4: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  execute(caster, state);
  eq('14b. L4 slot + 2 allies → 2 targets protected', countProtected(bf), 2);
  eq('14b. L4 slot consumed', caster.resources!.spellSlots![4].remaining, 0);
}

{
  // 14c. L5 slot + 3 allies → 3 allies get resistance
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 5: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const a3 = makeC({ id: 'a3', pos: { x: 6, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);
  execute(caster, state);
  eq('14c. L5 slot + 3 allies → 3 targets protected', countProtected(bf), 3);
  eq('14c. L5 slot consumed', caster.resources!.spellSlots![5].remaining, 0);
}

{
  // 14d. L5 slot but only 2 allies in range → 2 protected (capped at candidates, no waste)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 5: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const farAlly = makeC({ id: 'far', pos: { x: 15, y: 15, z: 0 }, faction: 'party' });  // out of touch range
  const bf = makeBF([caster, a1, a2, farAlly]);
  const state = makeState(bf);
  execute(caster, state);
  eq('14d. L5 slot but only 2 allies in range → 2 protected (capped)',
    countProtected(bf), 2);
  // far ally NOT protected
  assert('14d. far ally (out of range) NOT protected',
    !farAlly.activeEffects.some(e => e.spellName === 'Protection from Energy'));
}

{
  // 14e. L4 slot but only 1 ally in range → 1 protected (capped at candidates)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 4: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1]);
  const state = makeState(bf);
  execute(caster, state);
  eq('14e. L4 slot but only 1 ally → 1 protected (capped)', countProtected(bf), 1);
}

{
  // 14f. execute with 2 targets consumes L4 slot (not L3)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 3: 1, 4: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  executeWithTargets(caster, [a1, a2], state, 'fire');
  eq('14f. L4 slot consumed for 2 targets', caster.resources!.spellSlots![4].remaining, 0);
  eq('14f. L3 slot NOT consumed', caster.resources!.spellSlots![3].remaining, 1);
  assert('14f. a1 has fire resistance', a1.resistances.includes('fire'));
  assert('14f. a2 has fire resistance', a2.resistances.includes('fire'));
}

{
  // 14g. execute with 3 targets consumes L5 slot (not L3/L4)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 3: 1, 4: 1, 5: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const a3 = makeC({ id: 'a3', pos: { x: 6, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);
  executeWithTargets(caster, [a1, a2, a3], state, 'cold');
  eq('14g. L5 slot consumed for 3 targets', caster.resources!.spellSlots![5].remaining, 0);
  eq('14g. L4 slot NOT consumed', caster.resources!.spellSlots![4].remaining, 1);
  eq('14g. L3 slot NOT consumed', caster.resources!.spellSlots![3].remaining, 1);
  assert('14g. all 3 allies have cold resistance',
    a1.resistances.includes('cold') && a2.resistances.includes('cold') && a3.resistances.includes('cold'));
}

{
  // 14h. execute with 1 target consumes L3 slot (no upcast)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 3: 1, 4: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1]);
  const state = makeState(bf);
  executeWithTargets(caster, [a1], state, 'lightning');
  eq('14h. L3 slot consumed for 1 target', caster.resources!.spellSlots![3].remaining, 0);
  eq('14h. L4 slot NOT consumed', caster.resources!.spellSlots![4].remaining, 1);
}

{
  // 14i. Multi-target priority: lowest-HP% allies picked first
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 4: 1 }),  // L4 → 2 targets
    faction: 'party',
  });
  const healthy = makeC({
    id: 'healthy', name: 'Healthy', pos: { x: 6, y: 5, z: 0 },
    maxHP: 100, currentHP: 100, faction: 'party',
  });
  const wounded = makeC({
    id: 'wounded', name: 'Wounded', pos: { x: 5, y: 6, z: 0 },
    maxHP: 100, currentHP: 20, faction: 'party',
  });
  const full = makeC({
    id: 'full', name: 'Full', pos: { x: 6, y: 6, z: 0 },
    maxHP: 100, currentHP: 100, faction: 'party',
  });
  const bf = makeBF([caster, healthy, wounded, full]);
  const state = makeState(bf);
  execute(caster, state);
  // wounded (20% HP) must be protected; the 2nd target is healthy or full
  assert('14i. wounded (lowest HP%) is protected',
    wounded.activeEffects.some(e => e.spellName === 'Protection from Energy'));
  eq('14i. exactly 2 targets protected', countProtected(bf), 2);
}

{
  // 14j. Log message includes all target names + "2 creatures"
  const caster = makeC({
    id: 'wiz', name: 'Wizard', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 4: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', name: 'Alice', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', name: 'Bob', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  execute(caster, state);
  const actionEvent = state.log.events.find(e => e.type === 'action' && e.description.includes('Protection from Energy'));
  assert('14j. action event logged', actionEvent !== undefined);
  assert('14j. action event mentions Alice', !!(actionEvent && actionEvent.description.includes('Alice')));
  assert('14j. action event mentions Bob', !!(actionEvent && actionEvent.description.includes('Bob')));
  assert('14j. action event mentions "2 creatures"', !!(actionEvent && actionEvent.description.includes('2 creature')));
}

{
  // 14k. Each target gets its own sentinel effect with the correct damageType;
  //      all sourced from the same caster (concentration-linked).
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 4: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  executeWithTargets(caster, [a1, a2], state, 'thunder');
  const eff1 = a1.activeEffects.find(e => e.spellName === 'Protection from Energy');
  const eff2 = a2.activeEffects.find(e => e.spellName === 'Protection from Energy');
  assert('14k. a1 has sentinel', eff1 !== undefined);
  assert('14k. a2 has sentinel', eff2 !== undefined);
  eq('14k. a1 sentinel damageType', eff1?.payload.damageType, 'thunder');
  eq('14k. a2 sentinel damageType', eff2?.payload.damageType, 'thunder');
  eq('14k. a1 sentinel sourceIsConcentration', eff1?.sourceIsConcentration, true);
  eq('14k. a2 sentinel sourceIsConcentration', eff2?.sourceIsConcentration, true);
  eq('14k. a1 sentinel casterId', eff1?.casterId, caster.id);
  eq('14k. a2 sentinel casterId', eff2?.casterId, caster.id);
}

{
  // 14l. executeWithTarget (singular) applies to 1 target only (backwards compat)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 3: 1, 4: 1 }),
    faction: 'party',
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);
  executeWithTarget(caster, a1, state, 'acid');
  assert('14l. a1 has acid resistance (executeWithTarget)',
    a1.resistances.includes('acid'));
  assert('14l. a2 NOT protected (executeWithTarget only targets a1)',
    !a2.resistances.includes('acid'));
  // L3 consumed (1 target → L3, no upcast)
  eq('14l. L3 slot consumed (single target)', caster.resources!.spellSlots![3].remaining, 0);
  eq('14l. L4 slot NOT consumed', caster.resources!.spellSlots![4].remaining, 1);
}

{
  // 14m. All targets share the same damage type (pickDamageType picks once)
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 5: 1 }),  // L5 → 3 targets
    faction: 'party',
  });
  // Enemy deals only cold damage → pickDamageType returns 'cold'
  const enemy = makeC({
    id: 'enemy', pos: { x: 0, y: 0, z: 0 }, faction: 'enemy',
    actions: [makeAttackAction('cold')],
  });
  const a1 = makeC({ id: 'a1', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const a2 = makeC({ id: 'a2', pos: { x: 5, y: 6, z: 0 }, faction: 'party' });
  const a3 = makeC({ id: 'a3', pos: { x: 6, y: 6, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, enemy, a1, a2, a3]);
  const state = makeState(bf);
  execute(caster, state);
  // All 3 targets should have COLD resistance (not fire default)
  assert('14m. a1 has cold resistance (shared type)', a1.resistances.includes('cold'));
  assert('14m. a2 has cold resistance (shared type)', a2.resistances.includes('cold'));
  assert('14m. a3 has cold resistance (shared type)', a3.resistances.includes('cold'));
  // And NOT fire (would be the default if pickDamageType wasn't called)
  assert('14m. a1 does NOT have fire resistance (cold was picked)',
    !a1.resistances.includes('fire'));
}

{
  // 14n. Self-fallback: caster alone with an L5 slot → targets self only,
  //      consumes L3 (no upcast — single target, no waste).
  //      Verifies the "self as fallback when no allies" design.
  const caster = makeC({
    id: 'wiz', name: 'Wizard', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 5: 1, 3: 1 }),
    faction: 'party',
  });
  const bf = makeBF([caster]);  // alone — no allies
  const state = makeState(bf);
  execute(caster, state);
  // Caster protected self (fallback)
  assert('14n. caster self-protected (fallback when alone)',
    caster.activeEffects.some(e => e.spellName === 'Protection from Energy'));
  // Only 1 target (self) → L3 consumed (no upcast, no waste)
  eq('14n. L3 slot consumed (1 target, no upcast)', caster.resources!.spellSlots![3].remaining, 0);
  eq('14n. L5 slot NOT consumed (no waste on single target)', caster.resources!.spellSlots![5].remaining, 1);
}

{
  // 14o. Self excluded when allies present: caster + 1 ally + L4 slot.
  //      Caster is NOT targeted (ally benefits more); only ally protected.
  const caster = makeC({
    id: 'wiz', name: 'Wizard', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 4: 1 }),
    faction: 'party',
  });
  const ally = makeC({ id: 'ally', name: 'Ally', pos: { x: 6, y: 5, z: 0 }, faction: 'party' });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  execute(caster, state);
  assert('14o. ally protected', ally.activeEffects.some(e => e.spellName === 'Protection from Energy'));
  assert('14o. caster NOT protected (self excluded when ally present)',
    !caster.activeEffects.some(e => e.spellName === 'Protection from Energy'));
  // 1 target (ally) → L3 consumed (no upcast — only 1 ally, no benefit from L4)
  eq('14o. L3 NOT consumed (no L3 slot; consumeSpellSlot falls back to L4)',
    caster.resources!.spellSlots![3]?.remaining ?? 0, 0);
  eq('14o. L4 slot consumed (1 ally, fallback from L3)', caster.resources!.spellSlots![4].remaining, 0);
}

// ============================================================
// 15. Innate-resistance fix — addedResistance flag (Session 36)
// ============================================================
console.log('\n=== 15. Innate-resistance fix — addedResistance flag (Session 36) ===\n');
reset();

{
  // 15a. Target WITHOUT innate resistance → addedResistance=true, entry spliced on break
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const ally = makeC({ id: 'ally', pos: { x: 6, y: 5, z: 0 } });  // no innate resistances
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  executeWithTarget(caster, ally, state, 'fire');
  const sentinel = ally.activeEffects.find(e => e.spellName === 'Protection from Energy');
  eq('15a. sentinel addedResistance === true (spell pushed the entry)',
    sentinel?.payload.addedResistance, true);
  assert('15a. fire resistance present before break', ally.resistances.includes('fire'));
  removeEffectsFromCaster(caster.id, bf);
  assert('15a. fire resistance REMOVED after break (spell added it)',
    !ally.resistances.includes('fire'));
}

{
  // 15b. Target WITH innate resistance → addedResistance=false, innate entry PRESERVED on break
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const ally = makeC({
    id: 'ally', pos: { x: 6, y: 5, z: 0 },
    resistances: ['fire'],  // innate fire resistance
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  executeWithTarget(caster, ally, state, 'fire');
  const sentinel = ally.activeEffects.find(e => e.spellName === 'Protection from Energy');
  eq('15b. sentinel addedResistance === false (innate, no push)',
    sentinel?.payload.addedResistance, false);
  removeEffectsFromCaster(caster.id, bf);
  assert('15b. innate fire resistance PRESERVED after break',
    ally.resistances.includes('fire'));
}

{
  // 15c. Multi-target mix: one target has innate fire res, one doesn't.
  //      Both sentinels correct; cleanup preserves innate on one + removes granted on the other.
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlotsMulti({ 4: 1 }),  // L4 → 2 targets
    faction: 'party',
  });
  const innate = makeC({
    id: 'innate', name: 'Innate', pos: { x: 6, y: 5, z: 0 },
    resistances: ['fire'],  // innate fire resistance
    faction: 'party',
  });
  const fresh = makeC({
    id: 'fresh', name: 'Fresh', pos: { x: 5, y: 6, z: 0 },
    faction: 'party',  // no innate resistance
  });
  const bf = makeBF([caster, innate, fresh]);
  const state = makeState(bf);
  executeWithTargets(caster, [innate, fresh], state, 'fire');

  const sentInnate = innate.activeEffects.find(e => e.spellName === 'Protection from Energy');
  const sentFresh = fresh.activeEffects.find(e => e.spellName === 'Protection from Energy');
  eq('15c. innate target sentinel addedResistance === false', sentInnate?.payload.addedResistance, false);
  eq('15c. fresh target sentinel addedResistance === true', sentFresh?.payload.addedResistance, true);
  // Both have exactly 1 fire entry (innate: original; fresh: spell-granted)
  eq('15c. innate has 1 fire entry (idempotent)', innate.resistances.filter(r => r === 'fire').length, 1);
  eq('15c. fresh has 1 fire entry (spell-granted)', fresh.resistances.filter(r => r === 'fire').length, 1);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Innate target: fire resistance PRESERVED
  assert('15c. innate target fire resistance PRESERVED', innate.resistances.includes('fire'));
  // Fresh target: fire resistance REMOVED (spell granted it)
  assert('15c. fresh target fire resistance REMOVED (spell granted)', !fresh.resistances.includes('fire'));
}

{
  // 15d. Backwards compat: legacy sentinel with addedResistance === undefined
  //      is treated as addedResistance === true (original Session 34 behavior).
  //      Simulates a pre-Session 36 sentinel (e.g. from a saved game state).
  const caster = makeC({
    id: 'wiz', pos: { x: 5, y: 5, z: 0 },
    actions: [PFE_ACTION], resources: withSlots(2),
  });
  const ally = makeC({ id: 'ally', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, ally]);
  // Manually apply a legacy sentinel (no addedResistance field) + push resistance
  ally.resistances.push('fire');
  applySpellEffect(ally, {
    casterId: caster.id,
    spellName: 'Protection from Energy',
    effectType: 'damage_zone',
    payload: { dieCount: 0, dieSides: 0, damageType: 'fire' },  // NO addedResistance field
    sourceIsConcentration: true,
  });
  // On break, legacy sentinel (addedResistance undefined → default true) splices
  removeEffectsFromCaster(caster.id, bf);
  assert('15d. legacy sentinel (addedResistance undefined) still splices resistance',
    !ally.resistances.includes('fire'));
}

// ============================================================
// Final results
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) {
  console.error('protection_from_energy.test.ts: SOME TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('protection_from_energy.test.ts: all tests passed ✅');
}
