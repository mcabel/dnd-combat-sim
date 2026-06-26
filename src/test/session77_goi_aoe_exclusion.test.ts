// ============================================================
// Test: Session 77 — RFC-UPCASTING Phase 4 follow-up
//       Globe of Invulnerability AoE exclusion
//
// Closes the `globeOfInvulnerabilityAoEV1Simplified: true` gap for
// the 5 core damage AoE spells (fireball, lightning_bolt, burning_hands,
// shatter, thunderwave). Per PHB p.245:
//
//   "Any spell of 5th level or lower cast from outside the barrier
//    can't affect creatures or objects within it, even if the spell
//    is cast using a higher spell slot. Such a spell can target
//    creatures and objects within the barrier, but the spell has no
//    effect on them."
//
// v1 prior state: AoE spells in AOE_PLAN_TYPES (combat.ts) bypassed
// GoI entirely. v1 follow-up (this session): AoE execute() functions
// call filterGoIProtectedTargets() to exclude GoI-protected targets
// from the damage list. The spell still fires (slot consumed, action
// used, log emitted); protected targets are simply skipped.
//
// Run: npx ts-node --transpile-only src/test/session77_goi_aoe_exclusion.test.ts
// ============================================================

import { Combatant, Action, PlayerResources, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI, filterGoIProtectedTargets } from '../engine/spell_effects';
import { execute as fbExecute } from '../spells/fireball';
import { execute as lbExecute } from '../spells/lightning_bolt';
import { execute as shExecute } from '../spells/shatter';
import { execute as twExecute } from '../spells/thunderwave';
import { execute as bhExecute } from '../spells/burning_hands';
import { EngineState } from '../engine/combat';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Shared helpers -----------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 1, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
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

function makeState(bf: any): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

function withSlots(slots: { [level: number]: { max: number; remaining: number } }): PlayerResources {
  return { spellSlots: slots };
}

/** Construct a GoI ActiveEffect with the given blockThreshold (L6→5, L7→6, etc.). */
function makeGoIEffect(blockThreshold: number, sourceSlotLevel: number = 6): ActiveEffect {
  return {
    id: `eff_goi_${blockThreshold}`,
    casterId: 'self',  // the GoI caster itself is protected
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

// ---- Standard action definitions ----------------------------

const FIREBALL_ACTION: Action = {
  name: 'Fireball', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 150, long: 150 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 3, costType: 'action',
  legendaryCost: 0, description: 'Fireball',
};

const LIGHTNING_BOLT_ACTION: Action = {
  name: 'Lightning Bolt', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 100, long: 100 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 3, costType: 'action',
  legendaryCost: 0, description: 'Lightning Bolt',
};

const SHATTER_ACTION: Action = {
  name: 'Shatter', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 60, long: 60 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 2, costType: 'action',
  legendaryCost: 0, description: 'Shatter',
};

const THUNDERWAVE_ACTION: Action = {
  name: 'Thunderwave', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 15, long: 15 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 1, costType: 'action',
  legendaryCost: 0, description: 'Thunderwave',
};

const BURNING_HANDS_ACTION: Action = {
  name: 'Burning Hands', isMultiattack: false, attackType: 'save',
  reach: 5, range: { normal: 15, long: 15 },
  hitBonus: null, damage: null, damageType: null,
  saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
  requiresConcentration: false, slotLevel: 1, costType: 'action',
  legendaryCost: 0, description: 'Burning Hands',
};

// ============================================================
// Phase 1 — Unit tests for filterGoIProtectedTargets helper
// ============================================================

console.log('\n=== Phase 1 — filterGoIProtectedTargets helper ===\n');

{
  // 1a. No GoI on any target → no filtering
  const t1 = makeCombatant('t1');
  const t2 = makeCombatant('t2');
  const t3 = makeCombatant('t3');
  const result = filterGoIProtectedTargets([t1, t2, t3], 3, 'caster_x');
  eq('1a. No GoI: 3 in, 3 out', result.length, 3);

  // 1b. 1 GoI-protected (L3 spell vs threshold 5) → that target filtered out
  const goiTarget = makeCombatant('goi', { activeEffects: [makeGoIEffect(5)] });
  const result2 = filterGoIProtectedTargets([t1, goiTarget, t3], 3, 'caster_x');
  eq('1b. 1 GoI-protected (L3 vs threshold 5): 3 in, 2 out', result2.length, 2);
  assert('1b. GoI-protected target NOT in result', !result2.includes(goiTarget));
  assert('1b. Non-protected targets still in result', result2.includes(t1) && result2.includes(t3));

  // 1c. All targets GoI-protected → all filtered out (empty array)
  const goiA = makeCombatant('goiA', { activeEffects: [makeGoIEffect(5)] });
  const goiB = makeCombatant('goiB', { activeEffects: [makeGoIEffect(5)] });
  const result3 = filterGoIProtectedTargets([goiA, goiB], 3, 'caster_x');
  eq('1c. All GoI-protected: 2 in, 0 out', result3.length, 0);

  // 1d. Caster's own GoI (caster is in target list) → caster NOT filtered
  // PHB p.245: spells cast from outside the barrier are blocked; the GoI
  // caster is at the center, so their own spells are NOT blocked.
  const casterWithGoI = makeCombatant('self_caster', { activeEffects: [makeGoIEffect(5)] });
  const result4 = filterGoIProtectedTargets([casterWithGoI, t1], 3, 'self_caster');
  eq('1d. Caster in target list with own GoI: caster NOT filtered (2 in, 2 out)', result4.length, 2);
  assert('1d. Caster included in result', result4.includes(casterWithGoI));

  // 1e. Cantrip level (0) → no filtering (cantrips never blocked by GoI)
  const goiForCantrip = makeCombatant('goiCantrip', { activeEffects: [makeGoIEffect(5)] });
  const result5 = filterGoIProtectedTargets([goiForCantrip, t1], 0, 'caster_x');
  eq('1e. Cantrip (level 0): no filtering, 2 in 2 out', result5.length, 2);
  assert('1e. GoI-protected target included for cantrip', result5.includes(goiForCantrip));

  // 1f. Penetrating cast level (L6 spell vs threshold 5) → no filtering
  const goiPenetrated = makeCombatant('goiPene', { activeEffects: [makeGoIEffect(5)] });
  const result6 = filterGoIProtectedTargets([goiPenetrated, t1], 6, 'caster_x');
  eq('1f. Penetrating L6 vs threshold 5: no filtering, 2 in 2 out', result6.length, 2);
  assert('1f. GoI-protected target included when penetrated', result6.includes(goiPenetrated));

  // 1g. Empty input → empty output
  const result7 = filterGoIProtectedTargets([], 3, 'caster_x');
  eq('1g. Empty input → empty output', result7.length, 0);

  // 1h. Different spell_shield (not GoI) → not filtered
  const otherShield = makeCombatant('otherShield', {
    activeEffects: [{
      id: 'eff_other',
      casterId: 'self',
      spellName: 'Some Other Shield',
      effectType: 'spell_shield',
      sourceSlotLevel: 6,
      sourceIsConcentration: true,
      payload: { blockThreshold: 5 },
    } as ActiveEffect],
  });
  const result8 = filterGoIProtectedTargets([otherShield, t1], 3, 'caster_x');
  eq('1h. Non-GoI spell_shield: not filtered, 2 in 2 out', result8.length, 2);
  assert('1h. Non-GoI shield target included', result8.includes(otherShield));

  // 1i. Upcast GoI (L7 → threshold 6) blocks L6 spell
  const goiL7 = makeCombatant('goiL7', { activeEffects: [makeGoIEffect(6, 7)] });
  const result9 = filterGoIProtectedTargets([goiL7, t1], 6, 'caster_x');
  eq('1i. GoI L7 (threshold 6) blocks L6 spell: 2 in, 1 out', result9.length, 1);
  assert('1i. GoI L7-protected target NOT in result', !result9.includes(goiL7));
}

// ============================================================
// Phase 2 — Fireball integration tests
// ============================================================

console.log('\n=== Phase 2 — Fireball AoE exclusion ===\n');

{
  // 2a. Fireball vs GoI-protected target: protected enemy takes 0 damage,
  //     non-protected enemy takes damage, slot is consumed.
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_protected', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exposed', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtectedBefore = enemyProtected.currentHP;
  const hpExposedBefore = enemyExposed.currentHP;
  const slotsBefore = caster.resources!.spellSlots![3].remaining;

  fbExecute(caster, [enemyProtected, enemyExposed], state);

  const hpProtectedDelta = hpProtectedBefore - enemyProtected.currentHP;
  const hpExposedDelta = hpExposedBefore - enemyExposed.currentHP;
  const slotsDelta = slotsBefore - caster.resources!.spellSlots![3].remaining;

  eq('2a. GoI-protected enemy takes 0 damage', hpProtectedDelta, 0);
  assert('2a. Exposed enemy takes damage (>0)', hpExposedDelta > 0);
  eq('2a. Fireball slot consumed (1 slot)', slotsDelta, 1);

  // Log contains the GoI exclusion notice
  const castLog = state.log.events.find(e =>
    e.description.includes('casts Fireball') && e.description.includes('excluded by Globe of Invulnerability')
  );
  assert('2a. Log mentions GoI exclusion', castLog !== undefined);
}

{
  // 2b. Fireball penetration: L6 upcast penetrates L6 GoI (threshold 5).
  //     Both targets take damage.
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 6: { max: 1, remaining: 1 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_protected', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exposed', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtectedBefore = enemyProtected.currentHP;
  const hpExposedBefore = enemyExposed.currentHP;

  fbExecute(caster, [enemyProtected, enemyExposed], state);

  const hpProtectedDelta = hpProtectedBefore - enemyProtected.currentHP;
  const hpExposedDelta = hpExposedBefore - enemyExposed.currentHP;

  // L6 Fireball penetrates threshold 5: both targets take damage.
  assert('2b. L6 Fireball penetrates GoI: protected enemy takes damage', hpProtectedDelta > 0);
  assert('2b. L6 Fireball: exposed enemy takes damage', hpExposedDelta > 0);
  // At L6: 8 + (6-3) = 11d6, range 11-66
  assert('2b. L6 Fireball damage in 11d6 range (11-66) on protected', hpProtectedDelta >= 11 && hpProtectedDelta <= 66);
}

{
  // 2c. No-regression: Fireball without GoI damages all targets normally
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const e1 = makeCombatant('e1', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const e2 = makeCombatant('e2', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, e1, e2]);
  const state = makeState(bf);
  const hp1Before = e1.currentHP;
  const hp2Before = e2.currentHP;

  fbExecute(caster, [e1, e2], state);

  assert('2c. No GoI: enemy 1 takes damage', (hp1Before - e1.currentHP) > 0);
  assert('2c. No GoI: enemy 2 takes damage', (hp2Before - e2.currentHP) > 0);

  // Log should NOT mention GoI exclusion
  const castLog = state.log.events.find(e =>
    e.description.includes('excluded by Globe of Invulnerability')
  );
  assert('2c. No GoI: log does NOT mention exclusion', castLog === undefined);
}

// ============================================================
// Phase 3 — Lightning Bolt integration tests
// ============================================================

console.log('\n=== Phase 3 — Lightning Bolt AoE exclusion ===\n');

{
  // 3a. Lightning Bolt vs GoI-protected target: only exposed takes damage
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [LIGHTNING_BOLT_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_protected', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exposed', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtectedBefore = enemyProtected.currentHP;
  const hpExposedBefore = enemyExposed.currentHP;

  lbExecute(caster, [enemyProtected, enemyExposed], state);

  eq('3a. GoI-protected enemy takes 0 damage from Lightning Bolt', hpProtectedBefore - enemyProtected.currentHP, 0);
  assert('3a. Exposed enemy takes damage from Lightning Bolt', (hpExposedBefore - enemyExposed.currentHP) > 0);
}

// ============================================================
// Phase 4 — Shatter integration tests
// ============================================================

console.log('\n=== Phase 4 — Shatter AoE exclusion ===\n');

{
  // 4a. Shatter vs GoI-protected target: only exposed takes damage
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [SHATTER_ACTION],
    resources: withSlots({ 2: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_protected', {
    faction: 'enemy', dex: 1, con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exposed', {
    faction: 'enemy', dex: 1, con: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtectedBefore = enemyProtected.currentHP;
  const hpExposedBefore = enemyExposed.currentHP;

  shExecute(caster, [enemyProtected, enemyExposed], state);

  eq('4a. GoI-protected enemy takes 0 damage from Shatter', hpProtectedBefore - enemyProtected.currentHP, 0);
  assert('4a. Exposed enemy takes damage from Shatter', (hpExposedBefore - enemyExposed.currentHP) > 0);
}

// ============================================================
// Phase 5 — Thunderwave integration tests (damage + push)
// ============================================================

console.log('\n=== Phase 5 — Thunderwave AoE exclusion (damage + push) ===\n');

{
  // 5a. Thunderwave vs GoI-protected target: no damage AND no push
  //     PHB p.245: "the spell has no effect on them" — push is also negated.
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [THUNDERWAVE_ACTION],
    resources: withSlots({ 1: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_protected', {
    faction: 'enemy', dex: 1, con: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exposed', {
    faction: 'enemy', dex: 1, con: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtectedBefore = enemyProtected.currentHP;
  const hpExposedBefore = enemyExposed.currentHP;
  const posProtectedBefore = { ...enemyProtected.pos };
  const posExposedBefore = { ...enemyExposed.pos };

  twExecute(caster, [enemyProtected, enemyExposed], state);

  eq('5a. GoI-protected enemy takes 0 damage from Thunderwave', hpProtectedBefore - enemyProtected.currentHP, 0);
  assert('5a. Exposed enemy takes damage from Thunderwave', (hpExposedBefore - enemyExposed.currentHP) > 0);
  // PHB p.245: spell has no effect — push is also blocked.
  eq('5a. GoI-protected enemy NOT pushed (x unchanged)', enemyProtected.pos.x, posProtectedBefore.x);
  eq('5a. GoI-protected enemy NOT pushed (y unchanged)', enemyProtected.pos.y, posProtectedBefore.y);
  // Exposed enemy might be pushed (if save failed — random). Just check position
  // hasn't moved into impossible state (no strict assertion since push is save-dependent).
  // We don't assert exposed push because the save roll is randomized.
}

// ============================================================
// Phase 6 — Burning Hands integration tests
// ============================================================

console.log('\n=== Phase 6 — Burning Hands AoE exclusion ===\n');

{
  // 6a. Burning Hands vs GoI-protected target: only exposed takes damage
  //     Burning Hands filters to inCone first, then we apply GoI exclusion.
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [BURNING_HANDS_ACTION],
    resources: withSlots({ 1: { max: 2, remaining: 2 } }),
    int: 20,
  });
  const enemyProtected = makeCombatant('e_protected', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
    activeEffects: [makeGoIEffect(5)],
  });
  const enemyExposed = makeCombatant('e_exposed', {
    faction: 'enemy', dex: 1, pos: { x: 2, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemyProtected, enemyExposed]);
  const state = makeState(bf);
  const hpProtectedBefore = enemyProtected.currentHP;
  const hpExposedBefore = enemyExposed.currentHP;

  bhExecute(caster, [enemyProtected, enemyExposed], state);

  eq('6a. GoI-protected enemy takes 0 damage from Burning Hands', hpProtectedBefore - enemyProtected.currentHP, 0);
  assert('6a. Exposed enemy takes damage from Burning Hands', (hpExposedBefore - enemyExposed.currentHP) > 0);
}

// ============================================================
// Phase 7 — Cantrip AoE is NOT blocked by GoI
// ============================================================

console.log('\n=== Phase 7 — Cantrip (level 0) AoE not blocked by GoI ===\n');

{
  // 7a. filterGoIProtectedTargets with castLevel=0 is a no-op even when
  //     every target is GoI-protected. PHB p.245: cantrips are level 0
  //     and have no slot — they bypass GoI entirely.
  const goiA = makeCombatant('goiA', { activeEffects: [makeGoIEffect(5)] });
  const goiB = makeCombatant('goiB', { activeEffects: [makeGoIEffect(5)] });
  const result = filterGoIProtectedTargets([goiA, goiB], 0, 'caster_x');
  eq('7a. Cantrip (L0) vs GoI: no filtering, 2 in 2 out', result.length, 2);
  assert('7a. GoI-protected A still in result for cantrip', result.includes(goiA));
  assert('7a. GoI-protected B still in result for cantrip', result.includes(goiB));
}

// ============================================================
// Phase 8 — Edge cases
// ============================================================

console.log('\n=== Phase 8 — Edge cases ===\n');

{
  // 8a. Caster with own GoI: can cast Fireball through own GoI normally.
  //     PHB p.245: "cast from outside the barrier" — the GoI caster is
  //     at the center, so their own spells are NOT blocked. The caster
  //     is also typically NOT in their own Fireball target list (all
  //     enemies), but if they were (e.g. friendly fire scenario), they
  //     would NOT be filtered.
  const caster = makeCombatant('wiz', {
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    actions: [FIREBALL_ACTION],
    resources: withSlots({ 3: { max: 2, remaining: 2 } }),
    int: 20,
    activeEffects: [makeGoIEffect(5)],
  });
  const enemy = makeCombatant('e1', {
    faction: 'enemy', dex: 1, pos: { x: 1, y: 0, z: 0 },
    maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);
  const hpEnemyBefore = enemy.currentHP;
  const hpCasterBefore = caster.currentHP;

  // Caster is included in target list (unusual but tests the self-GoI rule)
  fbExecute(caster, [caster, enemy], state);

  // Both should take damage — caster's own GoI doesn't block their own spell.
  // (The caster casting Fireball on themselves is unusual but tests the rule.)
  assert('8a. Caster takes damage from own Fireball (own GoI does not block self)', (hpCasterBefore - caster.currentHP) > 0);
  assert('8a. Enemy takes damage from Fireball', (hpEnemyBefore - enemy.currentHP) > 0);
}

{
  // 8b. Multiple GoI effects on one target (re-cast scenario): treated as
  //     a single block check (isProtectedByGoI uses .some() — true if ANY
  //     active GoI effect blocks the spell).
  const target = makeCombatant('multi_goi', {
    activeEffects: [
      makeGoIEffect(5, 6),  // L6 GoI: threshold 5
      makeGoIEffect(6, 7),  // L7 GoI: threshold 6 (re-cast upcast)
    ],
  });
  // L6 spell vs thresholds {5, 6}: blocked by L7 GoI (6 ≤ 6) but not L6 GoI (6 > 5).
  // .some() → blocked.
  eq('8b. Multiple GoI effects: blocked if ANY blocks', isProtectedByGoI(target, 6), true);
  // L7 spell vs thresholds {5, 6}: not blocked by either (7 > 6 and 7 > 5).
  eq('8b. Multiple GoI effects: not blocked if neither blocks', isProtectedByGoI(target, 7), false);
}

{
  // 8c. All 5 spells are in AOE_PLAN_TYPES (combat.ts), meaning they bypass
  //     the single-target GoI block at the dispatch layer. The per-target
  //     exclusion in execute() is the ONLY GoI protection for these spells.
  //     This test verifies the metadata flag state is consistent.
  const fbMeta = require('../spells/fireball').metadata;
  const lbMeta = require('../spells/lightning_bolt').metadata;
  const shMeta = require('../spells/shatter').metadata;
  const twMeta = require('../spells/thunderwave').metadata;
  const bhMeta = require('../spells/burning_hands').metadata;

  // Upcast flags should remain true (not regressed by the filter addition).
  eq('8c. fireballUpcastV1Implemented still true', fbMeta.fireballUpcastV1Implemented, true);
  eq('8c. lightningBoltUpcastV1Implemented still true', lbMeta.lightningBoltUpcastV1Implemented, true);
  eq('8c. shatterUpcastV1Implemented still true', shMeta.shatterUpcastV1Implemented, true);
  eq('8c. thunderwaveUpcastV1Implemented still true', twMeta.thunderwaveUpcastV1Implemented, true);
  eq('8c. burningHandsUpcastV1Implemented still true', bhMeta.burningHandsUpcastV1Implemented, true);
}

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
