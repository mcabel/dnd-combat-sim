// ============================================================
// enhance_ability.test.ts — Enhance Ability spell module
// PHB p.237: 2nd-level transmutation, action, range Touch (5 ft),
//             concentration (1 hr).
// Effect: target gains advantage on one ability's checks.
//
// v1 simplification: only the universal advantage-on-checks benefit is
// modelled. The ability is picked as the target's HIGHEST ability score.
// A `damage_zone` sentinel effect (dieCount=0) anchors concentration-break
// cleanup so the `_enhanceAbilityActive` scratch field is cleared.
//
// Tests cover shouldCast() gates + target priority + ability selection,
// execute() scratch-field set + sentinel effect attached + slot consumed +
// concentration started, logging, cleanup no-op, integration, and metadata.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/enhance_ability';
import { Combatant, Action, PlayerResources, Vec3, AbilityScore } from '../types/core';

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

const ENHANCE_ABILITY_ACTION: Action = {
  name: 'Enhance Ability',
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
  description: 'Enhance Ability (touch, advantage on one ability\'s checks, concentration 1 hr)',
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

/** Cleric at pos (0,0,0) with Enhance Ability + 2 2nd-level slots, WIS 16 (highest ability) */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [ENHANCE_ABILITY_ACTION],
    resources: withSlots2(2),
  });
}

function makeAlly(id: string, pos: Vec3 = { x: 1, y: 0, z: 0 }, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, { name: id, faction: 'party', pos, ...overrides });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Enhance Ability', metadata.name, 'Enhance Ability');
eq('level is 2', metadata.level, 2);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 5 ft (touch)', metadata.rangeFt, 5);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
eq('Bear\'s Endurance temp HP NOT implemented (v1)', metadata.enhanceAbilityTempHPV1Implemented, false);
eq('Cat\'s Grace fall immunity NOT implemented (v1)', metadata.enhanceAbilityFallDamageImmunityV1Implemented, false);
eq('concentration enforcement NOW implemented (Session 34 TG-002)', metadata.enhanceAbilityConcentrationEnforcementV1Implemented, true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Enhance Ability' action
  const caster = makeCleric();
  caster.actions = [];
  const bf = makeBF([caster]);
  assert('Returns null when caster has no Enhance Ability action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const bf = makeBF([caster]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. Caster is already concentrating
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const bf = makeBF([caster]);
  assert('Returns null when caster is already concentrating', shouldCast(caster, bf) === null);
}

{
  // 2d. No allies in touch range (caster alone in bf — but self IS a candidate.
  //     To force "no allies", we mark the caster as already Enhanced.)
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const bf = makeBF([caster]);
  assert('Returns null when caster already Enhanced and no other allies in touch range', shouldCast(caster, bf) === null);
}

{
  // 2e. Allies out of touch range (>5 ft) — caster excluded as already Enhanced
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const farAlly = makeAlly('far', { x: 3, y: 0, z: 0 });  // 15 ft, out of touch range
  const bf = makeBF([caster, farAlly]);
  assert('Returns null when no allies within touch range (5 ft)', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target priority + ability selection
// ============================================================

console.log('\n=== 3. shouldCast — target priority + ability selection ===\n');

{
  // 3a. Self-targeting preferred when caster is a valid candidate
  const caster = makeCleric();  // WIS 16 is caster's highest ability
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, { currentHP: 10 });  // 25% HP, lower than caster
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  eq('Self preferred over lower-HP ally', result?.target.id, 'cleric1');
  eq('Ability is wis (caster\'s highest, WIS 16)', result?.ability, 'wis');
}

{
  // 3b. Lowest-HP% ally selected when caster is excluded (already Enhanced)
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const full = makeAlly('full', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });  // 100%
  const hurt = makeAlly('hurt', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 10 });  // 25%
  const bf = makeBF([caster, full, hurt]);
  const result = shouldCast(caster, bf);
  eq('Lowest-HP% (25%) ally selected', result?.target.id, 'hurt');
}

{
  // 3c. Highest-ability selection: ally with WIS 18 (highest among scores)
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const wiseAlly = makeAlly('wise', { x: 1, y: 0, z: 0 }, {
    str: 8, dex: 12, con: 14, int: 10, wis: 18, cha: 13,
  });
  const bf = makeBF([caster, wiseAlly]);
  const result = shouldCast(caster, bf);
  eq('Target is the WIS-focused ally', result?.target.id, 'wise');
  eq('Ability is wis (highest score: 18)', result?.ability, 'wis');
}

{
  // 3d. Highest-ability selection: ally with STR 20 (highest among scores)
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const strongAlly = makeAlly('strong', { x: 1, y: 0, z: 0 }, {
    str: 20, dex: 12, con: 14, int: 10, wis: 8, cha: 10,
  });
  const bf = makeBF([caster, strongAlly]);
  const result = shouldCast(caster, bf);
  eq('Ability is str (highest score: 20)', result?.ability, 'str');
}

// ============================================================
// 4. execute — scratch field set + sentinel effect attached
// ============================================================

console.log('\n=== 4. execute — scratch field set + sentinel effect attached ===\n');

{
  // 4a. Scratch field _enhanceAbilityActive set on target
  const caster = makeCleric();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 }, {
    str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10,
  });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  // Caster is excluded so ally is targeted (ally has WIS 18, highest)
  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  eq('Scratch field set to wis', ally._enhanceAbilityActive, 'wis');
}

{
  // 4b. Sentinel damage_zone effect attached (dieCount=0)
  const caster = makeCleric();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  assert('Sentinel damage_zone effect attached',
    ally.activeEffects.some(e =>
      e.effectType === 'damage_zone' &&
      e.payload.dieCount === 0 &&
      e.spellName === 'Enhance Ability' &&
      e.sourceIsConcentration === true
    ));
}

{
  // 4c. Slot consumed
  const caster = makeCleric();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. Concentration started on caster
  const caster = makeCleric();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  eq('Concentration active', caster.concentration?.active, true);
  eq('Concentration spellName is Enhance Ability', caster.concentration?.spellName, 'Enhance Ability');
}

{
  // 4e. Self-targeting: scratch field set on caster itself
  const caster = makeCleric();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  eq('Self-targeting: scratch field set on caster', caster._enhanceAbilityActive, 'wis');
  assert('Self-targeting: sentinel effect attached to caster',
    caster.activeEffects.some(e => e.effectType === 'damage_zone' && e.payload.dieCount === 0 && e.spellName === 'Enhance Ability'));
}

{
  // 4f. Dead target skipped (stale edge case — scratch field NOT set)
  const caster = makeCleric();
  const deadAlly = makeAlly('dead', { x: 1, y: 0, z: 0 }, { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, deadAlly]);
  const state = makeState(bf);

  // Force-execute with the dead ally (stale plan)
  execute(caster, deadAlly, 'wis', state);

  eq('Dead ally scratch field NOT set', deadAlly._enhanceAbilityActive, undefined);
  eq('Slot consumed even for dead target', caster.resources!.spellSlots![2]!.remaining, 1);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCleric();
  const ally = makeAlly('a1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const condEvents = events.filter(e => e.type === 'condition_add');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Condition_add event emitted', condEvents.length >= 1);
  assert('Action event mentions "Enhance Ability"', actionEvents[0].description.includes('Enhance Ability'));
  assert('Condition event mentions "advantage"', condEvents[0].description.includes('advantage'));
}

// ============================================================
// 6. cleanup — no-op
// ============================================================

console.log('\n=== 6. cleanup — no-op ===\n');

{
  const { cleanup } = require('../spells/enhance_ability');
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Enhance Ability', dcIfHit: 10 };
  caster._enhanceAbilityActive = 'wis';
  cleanup(caster);
  eq('Cleanup does NOT break concentration', caster.concentration?.active, true);
  eq('Cleanup does NOT clear _enhanceAbilityActive', caster._enhanceAbilityActive, 'wis');
}

// ============================================================
// 7. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 7. Integration pipeline ===\n');

{
  // 7a. Full pipeline: caster Enhances the lowest-HP% ally
  const caster = makeCleric();
  caster.activeEffects.push({
    id: 'eff_ea1', casterId: caster.id, spellName: 'Enhance Ability',
    effectType: 'damage_zone', payload: { dieCount: 0, dieSides: 0, damageType: 'force' },
    sourceIsConcentration: true,
  });
  const full = makeAlly('full', { x: 1, y: 0, z: 0 }, { maxHP: 40, currentHP: 40 });
  const hurt = makeAlly('hurt', { x: 1, y: 1, z: 0 }, { maxHP: 40, currentHP: 10 });
  const bf = makeBF([caster, full, hurt]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  eq('shouldCast returns the hurt ally', plan.target.id, 'hurt');
  execute(caster, plan.target, plan.ability, state);

  eq('Hurt ally has scratch field set', hurt._enhanceAbilityActive, plan.ability);
  eq('Full ally NOT affected', full._enhanceAbilityActive, undefined);
  assert('Hurt ally has sentinel effect',
    hurt.activeEffects.some(e => e.effectType === 'damage_zone' && e.spellName === 'Enhance Ability'));
  eq('Full ally has no sentinel effect', full.activeEffects.some(e => e.spellName === 'Enhance Ability'), false);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
  eq('Caster concentrating on Enhance Ability', caster.concentration?.spellName, 'Enhance Ability');
}

{
  // 7b. After casting, shouldCast returns null (caster is concentrating)
  const caster = makeCleric();
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 1);  // still 1 — only 1 cast
  // Now caster is concentrating → shouldCast returns null
  const retry = shouldCast(caster, makeBF([caster]));
  assert('shouldCast returns null after casting (concentration active)', retry === null);
}

{
  // 7c. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const bf = makeBF([caster]);
  const state = makeState(bf);

  const plan = shouldCast(caster, bf)!;
  execute(caster, plan.target, plan.ability, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const retry = shouldCast(caster, makeBF([caster]));
  assert('shouldCast returns null after slots exhausted', retry === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
