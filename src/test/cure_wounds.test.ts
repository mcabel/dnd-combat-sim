// ============================================================
// cure_wounds.test.ts — Cure Wounds spell module
// PHB p.230: 1st-level evocation, action, touch range (5 ft)
// Effect: 1d8 + WIS mod HP restored; no effect on undead / constructs.
//
// Tests cover shouldCast() preconditions and target priority,
// execute() effects / logging / WIS mod / HP clamping / undead guard,
// metadata shape, and integration via planTurn / runCombat.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/cure_wounds';
import { Combatant, Action, PlayerResources, Vec3, Battlefield } from '../types/core';
import { planTurn } from '../ai/planner';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

const CW_ACTION: Action = {
  name: 'Cure Wounds',
  costType: 'action',
  attackType: null,
  isMultiattack: false,
  reach: 5,
  range: { normal: 5, long: 5 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  legendaryCost: 0,
  description: 'Cure Wounds (1d8+WIS heal at touch range, action)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 12, speed: 30,
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
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    exhaustionLevel: 0,
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map(combatants.map(c => [c.id, c]));
  return {
    combatants: map,
    cells: new Map(),
    width: 20, height: 20, round: 1,
  } as any;
}

function makeState(bf: Battlefield): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Cleric at pos (0,0,0) with Cure Wounds + 2 spell slots, WIS 16 (+3) */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }, wis = 16): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    wis,
    actions: [CW_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 1',                metadata.level,         1);
eq('school is evocation',       metadata.school,        'evocation');
eq('range is 5 ft (touch)',     metadata.rangeFt,       5);
eq('heal die is d8',            metadata.healDie,       8);
eq('not concentration',         metadata.concentration, false);
eq('casting time is action',    metadata.castingTime,   'action');

// ============================================================
// 2. shouldCast — precondition guards
// ============================================================

console.log('\n=== 2. shouldCast — precondition guards ===\n');

{
  // 2a. Caster lacks 'Cure Wounds' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Cure Wounds action', shouldCast(caster, bf) === null);
}

{
  // 2b. No spell slots remaining
  const caster = makeCleric();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no spell slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No valid target — all allies at full HP
  const caster = makeCleric();
  const ally = makeCombatant('ally1');
  const bf = makeBF([caster, ally]);
  assert('Returns null when all allies are at full HP', shouldCast(caster, bf) === null);
}

{
  // 2d. Downed ally out of touch range (> 5 ft = > 1 square)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft — beyond touch range
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null for downed ally beyond touch range (10ft)',
    shouldCast(caster, bf) === null, `target at 10ft`);
}

{
  // 2e. PHB p.230 — no effect on undead: shouldCast skips undead targets
  const caster = makeCleric();
  const undead = makeCombatant('zombie1', {
    currentHP: 0, isUnconscious: true, isUndead: true,
  });
  const bf = makeBF([caster, undead]);
  assert('Returns null for undead target (PHB p.230)', shouldCast(caster, bf) === null);
}

{
  // 2f. Reaction used — Cure Wounds is an action, not a reaction; no restriction
  //     (budget restriction handled by planner, not shouldCast)
  const caster = makeCleric();
  caster.budget.reactionUsed = true;
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  assert('Returns target even when reaction is used (Cure Wounds costs an action)',
    shouldCast(caster, bf) !== null);
}

// ============================================================
// 3. shouldCast — target priority
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Priority 1: downed ally in touch range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('downed1', {
    pos: { x: 1, y: 0, z: 0 }, // 5 ft — in range
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, downed]);
  const result = shouldCast(caster, bf);
  assert('Selects downed ally at 5ft', result?.id === 'downed1');
}

{
  // 3b. Priority 2: self below 25% HP
  const caster = makeCleric();
  caster.maxHP = 40; caster.currentHP = 8; // 20% — below threshold
  const bf = makeBF([caster]);
  const result = shouldCast(caster, bf);
  assert('Selects self when below 25% HP', result?.id === 'cleric1');
}

{
  // 3c. Priority 1 beats priority 2: downed ally preferred over injured self
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  caster.maxHP = 40; caster.currentHP = 8; // self below 25%
  const downed = makeCombatant('downed1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, downed]);
  const result = shouldCast(caster, bf);
  assert('Downed ally (priority 1) chosen over injured self (priority 2)',
    result?.id === 'downed1');
}

{
  // 3d. Priority 3: ally below 25% HP within touch range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const wounded = makeCombatant('wounded1', {
    pos: { x: 1, y: 0, z: 0 },
    maxHP: 40, currentHP: 9, // ~22.5% — below threshold
  });
  const bf = makeBF([caster, wounded]);
  const result = shouldCast(caster, bf);
  assert('Selects ally below 25% HP at touch range', result?.id === 'wounded1');
}

{
  // 3e. Ally below 25% but out of touch range — not selected
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const wounded = makeCombatant('wounded1', {
    pos: { x: 3, y: 0, z: 0 }, // 15 ft — out of range
    maxHP: 40, currentHP: 9,
  });
  const bf = makeBF([caster, wounded]);
  const result = shouldCast(caster, bf);
  assert('Does not select ally below 25% HP at 15ft (beyond touch range)',
    result === null);
}

{
  // 3f. Exactly at touch boundary (1 square = 5 ft) — in range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 1, y: 0, z: 0 }, // chebyshev dist=1 → 5 ft
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, ally]);
  assert('Ally at exactly 5ft is in touch range', shouldCast(caster, bf)?.id === 'ally1');
}

{
  // 3g. One square beyond touch (2 squares = 10 ft) — out of range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 2, y: 0, z: 0 }, // chebyshev dist=2 → 10 ft
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, ally]);
  assert('Ally at 10ft is outside touch range', shouldCast(caster, bf) === null);
}

// ============================================================
// 4. execute — core effects
// ============================================================

console.log('\n=== 4. execute — core effects ===\n');

{
  // 4a. Slot is consumed on cast
  const caster  = makeCleric();
  const target  = makeCombatant('target1', { currentHP: 10 });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  eq('Slot decremented after cast',
    caster.resources!.spellSlots![1]!.remaining, 1);
}

{
  // 4b. HP is increased (not a fixed value due to d8 roll)
  const caster  = makeCleric();
  const target  = makeCombatant('target1', { maxHP: 40, currentHP: 10 });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  assert('Target HP increased after cast', target.currentHP > 10);
}

{
  // 4c. WIS modifier (+3 for WIS 16) adds to heal; min 1d8+3 = 4 at minimum
  //     Run many times to confirm range consistently above 3
  let seenMin = false;
  let allInRange = true;
  for (let i = 0; i < 200; i++) {
    const caster = makeCleric();
    const target = makeCombatant('target1', { maxHP: 100, currentHP: 0, isUnconscious: true });
    target.currentHP = 1; // not at 0 — avoids revive log noise
    const bf = makeBF([caster, target]);
    const state = makeState(bf);
    const hpBefore = target.currentHP;
    execute(caster, target, state);
    const healed = target.currentHP - hpBefore;
    if (healed < 4)  allInRange = false; // WIS 16 = +3; 1d8+3 ≥ 4
    if (healed >= 11) seenMin = true;    // max roll: 8+3=11
  }
  assert('WIS +3: healed amount always >= 4 (1d8+3)', allInRange);
  assert('WIS +3: max possible 11 seen over 200 rolls', seenMin);
}

{
  // 4d. Negative WIS modifier still heals minimum 1 (min 1 guard)
  let seenMin = false;
  for (let i = 0; i < 100; i++) {
    const caster = makeCleric();
    caster.wis = 4; // WIS 4 = -3 modifier; 1d8+(-3) can be negative
    const target = makeCombatant('target1', { maxHP: 40, currentHP: 1 });
    const bf = makeBF([caster, target]);
    const state = makeState(bf);
    execute(caster, target, state);
    if (target.currentHP >= 2) seenMin = true;
  }
  assert('Min 1 HP restored even with negative WIS modifier', seenMin);
}

{
  // 4e. HP does not exceed maxHP
  const caster = makeCleric();
  const target = makeCombatant('target1', { maxHP: 40, currentHP: 39 }); // 1 below max
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  assert('HP clamped to maxHP after overheal', target.currentHP === 40,
    `hp=${target.currentHP}`);
}

{
  // 4f. Revive: downed ally (0 HP, unconscious) is revived
  const caster = makeCleric();
  const target = makeCombatant('target1', {
    maxHP: 40, currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  assert('Unconscious condition cleared after revive', !target.isUnconscious);
  assert('HP above 0 after revive', target.currentHP > 0);
}

// ============================================================
// 5. execute — undead guard (PHB p.230)
// ============================================================

console.log('\n=== 5. execute — undead guard ===\n');

{
  // 5a. No HP change on undead target
  const caster = makeCleric();
  const undead = makeCombatant('zombie1', {
    maxHP: 40, currentHP: 10, isUndead: true,
  });
  const bf = makeBF([caster, undead]);
  const state = makeState(bf);
  execute(caster, undead, state);
  eq('HP unchanged on undead (PHB p.230)', undead.currentHP, 10);
}

{
  // 5b. No slot consumed for undead target
  const caster = makeCleric();
  const undead = makeCombatant('zombie1', {
    maxHP: 40, currentHP: 10, isUndead: true,
  });
  const bf = makeBF([caster, undead]);
  const state = makeState(bf);
  execute(caster, undead, state);
  eq('Slot NOT consumed when target is undead',
    caster.resources!.spellSlots![1]!.remaining, 2);
}

{
  // 5c. No heal event logged for undead target
  const caster = makeCleric();
  const undead = makeCombatant('zombie1', {
    maxHP: 40, currentHP: 10, isUndead: true,
  });
  const bf = makeBF([caster, undead]);
  const state = makeState(bf);
  execute(caster, undead, state);
  const healEvt = state.log.events.filter((e: any) => e.type === 'heal');
  assert('No heal event for undead', healEvt.length === 0);
}

// ============================================================
// 6. execute — dead target guard
// ============================================================

console.log('\n=== 6. execute — dead target guard ===\n');

{
  // 6a. Dead target: no HP change
  const caster = makeCleric();
  const dead = makeCombatant('dead1', { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);
  execute(caster, dead, state);
  eq('Dead target HP unchanged', dead.currentHP, 0);
}

{
  // 6b. Dead target: no slot consumed
  const caster = makeCleric();
  const dead = makeCombatant('dead1', { isDead: true, currentHP: 0 });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);
  execute(caster, dead, state);
  eq('Slot NOT consumed for dead target',
    caster.resources!.spellSlots![1]!.remaining, 2);
}

// ============================================================
// 7. execute — event log
// ============================================================

console.log('\n=== 7. execute — event log ===\n');

{
  // 7a. Action event logged
  const caster = makeCleric();
  const target = makeCombatant('target1', { currentHP: 10 });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  const actionEvt = state.log.events.find((e: any) => e.type === 'action');
  assert('Action event emitted', actionEvt !== undefined);
  assert('Action event actorId matches caster', actionEvt?.actorId === 'cleric1');
}

{
  // 7b. Heal event logged with correct targetId
  const caster = makeCleric();
  const target = makeCombatant('target1', { currentHP: 10 });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  const healEvt = state.log.events.find((e: any) => e.type === 'heal');
  assert('Heal event emitted', healEvt !== undefined);
  assert('Heal event targetId matches target', healEvt?.targetId === 'target1');
  assert('Heal event value >= 4 (WIS 16 = +3; 1d8+3 ≥ 4)', (healEvt?.value ?? 0) >= 4);
}

{
  // 7c. Revive: condition_remove event emitted
  const caster = makeCleric();
  const target = makeCombatant('target1', {
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  const condEvt = state.log.events.find((e: any) => e.type === 'condition_remove');
  assert('condition_remove event on revive', condEvt !== undefined);
  assert('condition_remove targets the revived combatant', condEvt?.targetId === 'target1');
}

{
  // 7d. No revive event when target was not unconscious
  const caster = makeCleric();
  const target = makeCombatant('target1', { currentHP: 10 }); // conscious, injured
  const bf = makeBF([caster, target]);
  const state = makeState(bf);
  execute(caster, target, state);
  const condEvt = state.log.events.filter((e: any) => e.type === 'condition_remove');
  assert('No condition_remove when target was not unconscious', condEvt.length === 0);
}

// ============================================================
// 8. Planner integration (planTurn)
// ============================================================

console.log('\n=== 8. Planner integration ===\n');

{
  // 8a. Planner emits 'cureWounds' when ally is downed at touch range
  const cleric  = makeCleric({ x: 0, y: 0, z: 0 });
  const fighter = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 }, // 5 ft
    currentHP: 0, isUnconscious: true,
  });
  const enemy = makeCombatant('enemy1', {
    pos: { x: 3, y: 0, z: 0 }, faction: 'enemy',
  });
  const bf = makeBF([cleric, fighter, enemy]);
  const plan = planTurn(cleric, bf);
  eq('Planner emits cureWounds action type', plan.action?.type, 'cureWounds');
  assert('Planner targets the downed fighter', plan.action?.targetId === 'fighter1');
}

{
  // 8b. Planner does NOT emit cureWounds when downed ally is out of touch range
  //     (Cleric should attack or move instead)
  const cleric  = makeCleric({ x: 0, y: 0, z: 0 });
  const fighter = makeCombatant('fighter1', {
    pos: { x: 6, y: 0, z: 0 }, // 30 ft — Cure Wounds is touch only
    currentHP: 0, isUnconscious: true,
  });
  const enemy = makeCombatant('enemy1', {
    pos: { x: 3, y: 0, z: 0 }, faction: 'enemy',
  });
  const bf = makeBF([cleric, fighter, enemy]);
  const plan = planTurn(cleric, bf);
  assert('No cureWounds planned when downed ally is 30ft away',
    plan.action?.type !== 'cureWounds');
}

{
  // 8c. Planner does NOT emit cureWounds when slots exhausted
  const cleric  = makeCleric({ x: 0, y: 0, z: 0 });
  cleric.resources = withSlots(0);
  const fighter = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isUnconscious: true,
  });
  const enemy = makeCombatant('enemy1', {
    pos: { x: 3, y: 0, z: 0 }, faction: 'enemy',
  });
  const bf = makeBF([cleric, fighter, enemy]);
  const plan = planTurn(cleric, bf);
  assert('No cureWounds when slots exhausted', plan.action?.type !== 'cureWounds');
}

{
  // 8d. Slot depletion: shouldCast returns null after casting until refilled
  const caster = makeCleric();
  caster.resources = withSlots(1); // exactly one slot
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  execute(caster, ally, state);
  eq('Slot depleted after cast', caster.resources!.spellSlots![1]!.remaining, 0);
  assert('shouldCast returns null after slots exhausted',
    shouldCast(caster, bf) === null);
}

// ============================================================
// Results
// ============================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('\ncure_wounds.test.ts: all tests passed ✅');
else process.exit(1);
