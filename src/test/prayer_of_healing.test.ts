// ============================================================
// prayer_of_healing.test.ts — Prayer of Healing spell module
// PHB p.267: 2nd-level evocation, action (canon: 10 min — v1: action),
//            range 30 ft, NO concentration.
// Effect: up to 3 allies within 30 ft regain 2d8 + spellcasting mod HP.
//
// v1 simplifications (documented via metadata flags):
//   - Action cast (canon: 10 min — out-of-combat; v1 simplification: action).
//   - WIS-mod spellcasting (canon: caster's class spellcasting ability).
//   - Upcast NOT modelled (fixed 2d8 + WIS mod, single 2nd-level slot).
//   - Undead/constructs exclusion NOT modelled.
//   - NOT a concentration spell (PHB p.267: instantaneous).
//
// Tests cover shouldCast() preconditions + target priority + full-HP exclusion,
// execute() HP healing + slot consumption + logging + integration pipeline.
// ============================================================

import { shouldCast, execute, metadata } from '../spells/prayer_of_healing';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

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

const POH_ACTION: Action = {
  name: 'Prayer of Healing',
  isMultiattack: false,
  attackType: null,
  reach: 5,
  range: { normal: 30, long: 30 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: false,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 2,
  costType: 'action',
  legendaryCost: 0,
  description: 'Prayer of Healing (2d8 + WIS heal up to 3 allies within 30 ft, NO concentration)',
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

/** Cleric at (0,0,0) with Prayer of Healing + 2 2nd-level slots, WIS 16 (+3) */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    actions: [POH_ACTION],
    resources: withSlots2(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Prayer of Healing', metadata.name, 'Prayer of Healing');
eq('level is 2', metadata.level, 2);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 30 ft', metadata.rangeFt, 30);
eq('max targets is 3', metadata.maxTargets, 3);
eq('die count is 2', metadata.dieCount, 2);
eq('die sides is 8', metadata.dieSides, 8);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('v1: cast time simplified (canon 10 min → v1 action)',
  (metadata as any).prayerOfHealingCastTimeV1Simplified, true);
eq('v1: upcast NOT implemented',
  (metadata as any).prayerOfHealingUpcastV1Implemented, false);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Prayer of Healing' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Prayer of Healing action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 2nd-level slots remaining
  const caster = makeCleric();
  caster.resources = withSlots2(0);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 2nd-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No wounded allies (caster is full HP too) → null
  const caster = makeCleric();
  const fullAlly = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, fullAlly]);
  assert('Returns null when no wounded allies (all full HP)', shouldCast(caster, bf) === null);
}

{
  // 2d. Caster alone and wounded → [self]
  const caster = makeCleric();
  caster.currentHP = 10;
  caster.maxHP = 40;
  const bf = makeBF([caster]);
  const result = shouldCast(caster, bf);
  assert('Returns [self] when caster is alone and wounded', result !== null && result.length === 1 && result[0].id === 'cleric1');
}

{
  // 2e. NOT concentration: cast allowed while concentrating on another spell
  const caster = makeCleric();
  caster.concentration = { active: true, spellName: 'Bless', dcIfHit: 10 };
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('NOT concentration: cast allowed while concentrating on another spell', result !== null);
}

// ============================================================
// 3. shouldCast — target priority (lowest HP% first, full-HP excluded)
// ============================================================

console.log('\n=== 3. shouldCast — target priority ===\n');

{
  // 3a. Self first when caster is wounded
  const caster = makeCleric();
  caster.currentHP = 5;
  caster.maxHP = 40;
  const ally1 = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 10 });
  const ally2 = makeCombatant('ally2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally1, ally2]);
  const result = shouldCast(caster, bf);
  assert('3 targets returned (self + 2 allies)', result !== null && result.length === 3);
  if (result && result.length === 3) {
    eq('Self is first target', result[0].id, 'cleric1');
  }
}

{
  // 3b. Lowest-HP% ally preferred over full-HP ally (full-HP EXCLUDED)
  const caster = makeCleric();
  // Caster full HP (excluded); wounded ally preferred
  const wounded = makeCombatant('wounded', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 5 });
  const full = makeCombatant('full', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, wounded, full]);
  const result = shouldCast(caster, bf);
  if (result) {
    eq('Only 1 wounded target (full-HP excluded)', result.length, 1);
    eq('Wounded ally selected', result[0].id, 'wounded');
    assert('Full-HP ally NOT in result', !result.some(c => c.id === 'full'));
  } else {
    assert('Result not null', false);
  }
}

{
  // 3c. Max 3 targets enforced
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 10 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 15 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });
  const a4 = makeCombatant('a4', { pos: { x: 4, y: 0, z: 0 }, maxHP: 40, currentHP: 25 });
  const bf = makeBF([caster, a1, a2, a3, a4]);
  const result = shouldCast(caster, bf);
  assert('Max 3 targets enforced (4 wounded allies → 3 picked)', result !== null && result.length === 3);
}

{
  // 3d. Out-of-range ally excluded
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const farAlly = makeCombatant('far', { pos: { x: 7, y: 0, z: 0 }, maxHP: 40, currentHP: 5 });  // 35 ft
  const bf = makeBF([caster, farAlly]);
  assert('Out-of-range ally (35 ft) excluded', shouldCast(caster, bf) === null);
}

// ============================================================
// 4. execute — healing
// ============================================================

console.log('\n=== 4. execute — healing ===\n');

{
  // 4a. Each target heals 2d8 + WIS mod (WIS 16 = +3)
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 5 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const before = ally.currentHP;
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // Heal range: 2d8+3 = 5..19
  assert('Ally healed by 5..19 HP', ally.currentHP - before >= 5 && ally.currentHP - before <= 19);
  assert('Ally HP does not exceed maxHP', ally.currentHP <= ally.maxHP);
}

{
  // 4b. Capped at maxHP (no overheal)
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 38 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('Ally HP capped at maxHP', ally.currentHP, 40);
}

{
  // 4c. Slot consumed
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  eq('2nd-level slot consumed', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 4d. Multiple targets each roll independently (different heal amounts possible)
  const caster = makeCleric();
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 1 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 100, currentHP: 1 });
  const a3 = makeCombatant('a3', { pos: { x: 3, y: 0, z: 0 }, maxHP: 100, currentHP: 1 });
  const bf = makeBF([caster, a1, a2, a3]);
  const state = makeState(bf);

  const before = [a1.currentHP, a2.currentHP, a3.currentHP];
  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  // Each ally healed by at least 5 (min roll 2d8+3 = 5)
  assert('a1 healed', a1.currentHP - before[0] >= 5);
  assert('a2 healed', a2.currentHP - before[1] >= 5);
  assert('a3 healed', a3.currentHP - before[2] >= 5);
  // All targets were included
  eq('3 targets healed', targets.length, 3);
}

{
  // 4e. Dead ally skipped (stale edge case) — slot still consumed, no heal
  const caster = makeCleric();
  const dead = makeCombatant('dead', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 0, isDead: true });
  const live = makeCombatant('live', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 20 });
  const bf = makeBF([caster, dead, live]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  // After shouldCast, mark dead AFTER (simulate stale plan — actually already dead)
  execute(caster, targets, state);

  assert('Dead ally HP unchanged', dead.currentHP === 0);
  assert('Live ally healed', live.currentHP > 20);
}

// ============================================================
// 5. execute — logging
// ============================================================

console.log('\n=== 5. execute — logging ===\n');

{
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 5 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf)!;
  execute(caster, targets, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter(e => e.type === 'action');
  const healEvents = events.filter(e => e.type === 'heal');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  assert('Action event mentions "Prayer of Healing"',
    actionEvents[0].description.includes('Prayer of Healing'));
  eq('Heal events emitted (one per target)', healEvents.length, targets.length);
  // Heal event value is the actual heal amount (capped at maxHP)
  assert('Heal event value is positive', (healEvents[0].value ?? 0) > 0);
}

// ============================================================
// 6. Integration: shouldCast → execute pipeline
// ============================================================

console.log('\n=== 6. Integration pipeline ===\n');

{
  // 6a. Full pipeline: cleric + 2 wounded allies (3 targets — self if wounded)
  const caster = makeCleric();
  caster.currentHP = 10; caster.maxHP = 40;   // caster wounded
  const a1 = makeCombatant('a1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 30, currentHP: 10 });
  const a2 = makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 30, currentHP: 20 });
  const bf = makeBF([caster, a1, a2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  assert('shouldCast returns 3 targets (self + 2 allies)', targets !== null && targets.length === 3);
  if (targets) execute(caster, targets, state);

  // All 3 combatants healed
  assert('Caster healed', caster.currentHP > 10);
  assert('a1 healed', a1.currentHP > 10);
  assert('a2 healed', a2.currentHP > 20);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![2]!.remaining, 1);
}

{
  // 6b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots2(1);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 5 });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![2]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, makeCombatant('a2', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 5 })]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 6c. Full-HP allies skipped — only wounded allies targeted
  const caster = makeCleric();
  const wounded = makeCombatant('wounded', { pos: { x: 1, y: 0, z: 0 }, maxHP: 40, currentHP: 5 });
  const full1 = makeCombatant('full1', { pos: { x: 2, y: 0, z: 0 }, maxHP: 40, currentHP: 40 });
  const full2 = makeCombatant('full2', { pos: { x: 3, y: 0, z: 0 }, maxHP: 40, currentHP: 40 });
  const bf = makeBF([caster, wounded, full1, full2]);
  const state = makeState(bf);

  const targets = shouldCast(caster, bf);
  // Only wounded ally (caster is full HP too — excluded)
  if (targets) {
    eq('Only 1 target (full-HP excluded)', targets.length, 1);
    eq('Wounded ally targeted', targets[0].id, 'wounded');
  } else {
    assert('Result not null', false);
  }
  if (targets) execute(caster, targets, state);
  assert('Wounded ally healed', wounded.currentHP > 5);
  assert('Full allies NOT healed', full1.currentHP === 40 && full2.currentHP === 40);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
