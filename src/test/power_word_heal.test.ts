// ============================================================
// power_word_heal.test.ts — Power Word Heal spell module
// XGE p.151: 6th-level evocation, action, range Touch (5 ft),
//   NO concentration.
//   Effect: Full HP (currentHP = maxHP) + remove blinded/deafened/
//   frightened/paralyzed/stunned.
//
// Tests cover shouldCast() preconditions (Touch range), target priority
// (downed, self, most-wounded, ally-with-removable-condition),
// execute() full HP set, 5-condition removal, slot consumption, logging,
// cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/power_word_heal';
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

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 6: { max: 2, remaining } } };
}

const PWH_ACTION: Action = {
  name: 'Power Word Heal',
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
  slotLevel: 6,
  legendaryCost: 0,
  description: 'Power Word Heal (full HP + remove 5 conditions, Touch)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 12, speed: 30,
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

function makeBF(combatants: Combatant[]): any {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  };
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

function makeBard(pos: Vec3 = { x: 0, y: 0, z: 0 }, wis = 16): Combatant {
  return makeCombatant('bard1', {
    name: 'Bard',
    pos,
    wis,
    actions: [PWH_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Power Word Heal', metadata.name, 'Power Word Heal');
eq('level is 6', metadata.level, 6);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 5 ft (Touch)', metadata.rangeFt, 5);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
eq('5 removable conditions listed',
  metadata.removedConditions.length, 5);
assert('blinded in removed conditions',
  metadata.removedConditions.includes('blinded'));
assert('deafened in removed conditions',
  metadata.removedConditions.includes('deafened'));
assert('frightened in removed conditions',
  metadata.removedConditions.includes('frightened'));
assert('paralyzed in removed conditions',
  metadata.removedConditions.includes('paralyzed'));
assert('stunned in removed conditions',
  metadata.removedConditions.includes('stunned'));
assert('v1 canon flag set',
  (metadata as any).powerWordHealCanonV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Power Word Heal' action
  const caster = makeBard();
  caster.actions = [];
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Power Word Heal action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 6th-level slots
  const caster = makeBard();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 6th-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No wounded ally (and no ally with removable condition)
  const caster = makeBard();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 100, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no wounded allies (and no removable conditions)', shouldCast(caster, bf) === null);
}

{
  // 2d. Out of Touch range (> 5 ft)
  const caster = makeBard({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft
    currentHP: 5, maxHP: 100,
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null for ally beyond Touch (10 ft)', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target selection
// ============================================================

console.log('\n=== 3. shouldCast — target selection ===\n');

{
  // 3a. Priority 1: downed ally within Touch
  const caster = makeBard({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 }, // 5 ft
    currentHP: 0, isUnconscious: true, maxHP: 100,
  });
  const bf = makeBF([caster, downed]);
  const target = shouldCast(caster, bf);
  assert('Returns downed ally within Touch (priority 1)', target?.id === 'fighter1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3b. Priority 2: self if wounded
  const caster = makeBard();
  caster.currentHP = 20; caster.maxHP = 100;
  const bf = makeBF([caster]);
  const target = shouldCast(caster, bf);
  assert('Returns self when wounded (priority 2)', target?.id === 'bard1');
}

{
  // 3c. Priority 3: most-wounded ally within Touch
  const caster = makeBard({ x: 0, y: 0, z: 0 });
  const hurt     = makeCombatant('bard2', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 10 });
  const lessHurt = makeCombatant('rogue1', { pos: { x: 0, y: 1, z: 0 }, maxHP: 100, currentHP: 50 });
  const bf = makeBF([caster, hurt, lessHurt]);
  const target = shouldCast(caster, bf);
  assert('Returns most-wounded ally', target?.id === 'bard2');
}

{
  // 3d. Priority 4: ally with removable condition (even at full HP)
  const caster = makeBard();
  const stunnedAlly = makeCombatant('paladin1', { currentHP: 100, maxHP: 100 });
  stunnedAlly.conditions.add('stunned');
  const bf = makeBF([caster, stunnedAlly]);
  const target = shouldCast(caster, bf);
  assert('Returns ally with stunned condition (priority 4)', target?.id === 'paladin1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3e. Self qualifies if carrying a removable condition (even at full HP)
  const caster = makeBard();
  caster.currentHP = 100; caster.maxHP = 100;
  caster.conditions.add('frightened');
  const bf = makeBF([caster]);
  const target = shouldCast(caster, bf);
  assert('Self qualifies when carrying frightened (priority 2)', target?.id === 'bard1');
}

// ============================================================
// 4. execute — full HP + condition removal
// ============================================================

console.log('\n=== 4. execute — full HP + condition removal ===\n');

{
  // 4a. Sets currentHP to maxHP
  const caster = makeBard();
  const ally   = makeCombatant('fighter1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 150 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  eq('Ally HP set to maxHP (150)', ally.currentHP, 150);
}

{
  // 4b. Already at full HP — no HP change but slot still consumed
  const caster = makeBard();
  const ally   = makeCombatant('fighter1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 100, maxHP: 100 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  eq('Ally HP unchanged (was already at maxHP)', ally.currentHP, 100);
  eq('Slot still consumed', caster.resources!.spellSlots![6]!.remaining, 1);
}

{
  // 4c. Slot consumed
  const caster = makeBard();
  caster.resources = withSlots(2);
  const ally  = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 100 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('6th-level slot consumed', caster.resources!.spellSlots![6]!.remaining, 1);
}

{
  // 4d. Removes blinded
  const caster = makeBard();
  const ally   = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 30, maxHP: 100 });
  ally.conditions.add('blinded');
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  assert('blinded removed', !ally.conditions.has('blinded'));
  assert('condition_remove event for blinded',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.description?.includes('blinded')));
}

{
  // 4e. Removes all 5 conditions at once
  const caster = makeBard();
  const ally   = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 30, maxHP: 100 });
  ally.conditions.add('blinded');
  ally.conditions.add('deafened');
  ally.conditions.add('frightened');
  ally.conditions.add('paralyzed');
  ally.conditions.add('stunned');
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  assert('blinded removed', !ally.conditions.has('blinded'));
  assert('deafened removed', !ally.conditions.has('deafened'));
  assert('frightened removed', !ally.conditions.has('frightened'));
  assert('paralyzed removed', !ally.conditions.has('paralyzed'));
  assert('stunned removed', !ally.conditions.has('stunned'));
}

{
  // 4f. Does NOT remove conditions outside the 5-list (e.g. poisoned, restrained)
  const caster = makeBard();
  const ally   = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 30, maxHP: 100 });
  ally.conditions.add('poisoned');
  ally.conditions.add('restrained');
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  assert('poisoned NOT removed (not in canon list)', ally.conditions.has('poisoned'));
  assert('restrained NOT removed (not in canon list)', ally.conditions.has('restrained'));
}

{
  // 4g. Downed ally revived — currentHP = maxHP, unconscious cleared
  const caster = makeBard();
  const downed = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isUnconscious: true, maxHP: 100,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  execute(caster, downed, state);

  assert('Unconscious flag cleared', !downed.isUnconscious);
  eq('HP set to maxHP after revive', downed.currentHP, 100);
  assert('condition_remove event logged for unconscious',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.description?.includes('consciousness')));
}

{
  // 4h. Dead target: no effect
  const caster = makeBard();
  const dead   = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isDead: true, isUnconscious: true,
  });
  const bf     = makeBF([caster, dead]);
  const state  = makeState(bf);
  const slotsBefore = caster.resources!.spellSlots![6]!.remaining;

  execute(caster, dead, state);

  eq('No slot consumed on dead target', caster.resources!.spellSlots![6]!.remaining, slotsBefore);
  eq('Dead target HP unchanged', dead.currentHP, 0);
}

{
  // 4i. 'heal' event logged with full-heal value
  const caster = makeBard();
  const ally   = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 30, maxHP: 100 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const healEv = state.log.events.find((e: any) => e.type === 'heal' && e.actorId === 'bard1');
  assert('Heal event logged', !!healEv);
  eq('Heal event value is 70 (maxHP - currentHP)', healEv?.value, 70);
}

// ============================================================
// 5. Integration + cleanup
// ============================================================

console.log('\n=== 5. Integration + cleanup ===\n');

{
  // 5a. Full pipeline: shouldCast → execute fully heals + removes stunned
  const caster = makeBard({ x: 0, y: 0, z: 0 });
  const ally   = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 5, maxHP: 100,
  });
  ally.conditions.add('stunned');
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast picks wounded ally', target?.id === 'fighter1');
  if (target) execute(caster, target, state);
  eq('Ally HP = maxHP after execute', ally.currentHP, 100);
  assert('Stunned removed', !ally.conditions.has('stunned'));
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![6]!.remaining, 1);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeBard();
  caster.resources = withSlots(1);
  const ally  = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 100 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![6]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 5c. cleanup is a no-op (does not throw)
  const caster = makeBard();
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('cleanup is a no-op (does not throw)', !threw);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
