// ============================================================
// heal.test.ts — Heal spell module
// PHB p.250: 6th-level evocation, action, range 60 ft, NO concentration.
//   Effect: 70 HP flat heal + remove blinded/deafened. No effect on
//   undead/constructs. Disease removal NOT modelled in v1.
//
// Tests cover shouldCast() preconditions, target priority (downed,
// self, most-wounded, ally-with-removable-condition), execute() flat
// 70 HP heal, condition removal (blinded, deafened), slot consumption,
// logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/heal';
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

const HEAL_ACTION: Action = {
  name: 'Heal',
  costType: 'action',
  attackType: null,
  isMultiattack: false,
  reach: 5,
  range: { normal: 60, long: 60 },
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
  description: 'Heal (70 HP flat + remove blinded/deafened, 60 ft)',
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

function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }, wis = 16): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    wis,
    actions: [HEAL_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Heal', metadata.name, 'Heal');
eq('level is 6', metadata.level, 6);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('flat heal is 70 HP', metadata.healFlat, 70);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 disease removal NOT modelled flag set',
  (metadata as any).healDiseaseRemovalV1NotModelled === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Heal' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { currentHP: 10, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Heal action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 6th-level slots
  const caster = makeCleric();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { currentHP: 10, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 6th-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No wounded ally (and no ally with removable condition)
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { currentHP: 100, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when all allies are at full HP', shouldCast(caster, bf) === null);
}

{
  // 2d. Downed ally out of range (> 60 ft)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 13, y: 0, z: 0 }, // 65 ft — outside range
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null for downed ally beyond 60 ft', shouldCast(caster, bf) === null);
}

{
  // 2e. PHB p.250 — no effect on undead: shouldCast skips undead targets
  const caster = makeCleric();
  const undead = makeCombatant('zombie1', {
    currentHP: 0, isUnconscious: true, isUndead: true,
    faction: 'party',
  });
  const bf = makeBF([caster, undead]);
  assert('Returns null for undead target (PHB p.250)', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target selection
// ============================================================

console.log('\n=== 3. shouldCast — target selection ===\n');

{
  // 3a. Priority 1: downed ally within range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 6, y: 0, z: 0 }, // 30 ft
    currentHP: 0, isUnconscious: true, maxHP: 100,
  });
  const bf = makeBF([caster, downed]);
  const target = shouldCast(caster, bf);
  assert('Returns downed ally within 60 ft (priority 1)', target?.id === 'fighter1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3b. Priority 2: self if wounded
  const caster = makeCleric();
  caster.currentHP = 20; caster.maxHP = 100;
  const bf = makeBF([caster]);
  const target = shouldCast(caster, bf);
  assert('Returns self when wounded (priority 2)', target?.id === 'cleric1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3c. Priority 3: most-wounded ally within range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const hurt     = makeCombatant('bard1', { pos: { x: 4, y: 0, z: 0 }, maxHP: 100, currentHP: 10 });
  const lessHurt = makeCombatant('rogue1', { pos: { x: 3, y: 0, z: 0 }, maxHP: 100, currentHP: 50 });
  const bf = makeBF([caster, hurt, lessHurt]);
  const target = shouldCast(caster, bf);
  assert('Returns most-wounded ally (largest HP deficit)', target?.id === 'bard1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3d. Priority 4: ally with removable condition (blinded/deafened), even at full HP
  const caster = makeCleric();
  const fullButBlind = makeCombatant('paladin1', { currentHP: 100, maxHP: 100 });
  fullButBlind.conditions.add('blinded');
  const bf = makeBF([caster, fullButBlind]);
  const target = shouldCast(caster, bf);
  assert('Returns ally with blinded condition (priority 4)', target?.id === 'paladin1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3e. Ally with deafened condition
  const caster = makeCleric();
  const deafAlly = makeCombatant('bard1', { currentHP: 100, maxHP: 100 });
  deafAlly.conditions.add('deafened');
  const bf = makeBF([caster, deafAlly]);
  const target = shouldCast(caster, bf);
  assert('Returns ally with deafened condition', target?.id === 'bard1',
    `got ${target?.id ?? 'null'}`);
}

// ============================================================
// 4. execute — healing and condition removal
// ============================================================

console.log('\n=== 4. execute — healing and condition removal ===\n');

{
  // 4a. Heals a wounded ally by exactly 70 HP
  const caster = makeCleric();
  const ally   = makeCombatant('fighter1', { currentHP: 10, maxHP: 200 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  eq('Ally healed by exactly 70 HP (flat heal)', ally.currentHP, 80);
}

{
  // 4b. Capped at maxHP
  const caster = makeCleric();
  const ally   = makeCombatant('fighter1', { currentHP: 50, maxHP: 100 }); // 50 HP missing
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  eq('Ally HP capped at maxHP (would heal 70 but only 50 missing)', ally.currentHP, 100);
}

{
  // 4c. Slot consumed
  const caster = makeCleric();
  caster.resources = withSlots(2);
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 200 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('6th-level slot consumed', caster.resources!.spellSlots![6]!.remaining, 1);
}

{
  // 4d. Removes blinded condition
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { currentHP: 30, maxHP: 100 });
  ally.conditions.add('blinded');
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  assert('blinded condition removed', !ally.conditions.has('blinded'));
  assert('condition_remove event logged for blinded',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.description?.includes('blinded')));
}

{
  // 4e. Removes deafened condition
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { currentHP: 30, maxHP: 100 });
  ally.conditions.add('deafened');
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  assert('deafened condition removed', !ally.conditions.has('deafened'));
  assert('condition_remove event logged for deafened',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.description?.includes('deafened')));
}

{
  // 4f. Removes BOTH blinded and deafened at once
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { currentHP: 30, maxHP: 100 });
  ally.conditions.add('blinded');
  ally.conditions.add('deafened');
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  assert('blinded removed when both present', !ally.conditions.has('blinded'));
  assert('deafened removed when both present', !ally.conditions.has('deafened'));
}

{
  // 4g. Dead target: no effect, no HP change, early return
  const caster = makeCleric();
  const dead   = makeCombatant('fighter1', {
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
  // 4h. Undead target: no effect
  const caster = makeCleric();
  const zombie = makeCombatant('zombie1', {
    currentHP: 0, isUnconscious: true, isUndead: true,
  });
  const bf     = makeBF([caster, zombie]);
  const state  = makeState(bf);
  const slotsBefore = caster.resources!.spellSlots![6]!.remaining;

  execute(caster, zombie, state);

  eq('No slot consumed on undead target', caster.resources!.spellSlots![6]!.remaining, slotsBefore);
  eq('Undead HP unchanged', zombie.currentHP, 0);
  const noEffectEv = state.log.events.find((e: any) =>
    e.type === 'action' && e.description?.includes('no effect'));
  assert('No-effect event logged for undead', !!noEffectEv);
}

{
  // 4i. Revives a downed ally
  const caster = makeCleric();
  const downed = makeCombatant('fighter1', {
    currentHP: 0, isUnconscious: true, maxHP: 100,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  execute(caster, downed, state);

  assert('Unconscious flag cleared after heal', !downed.isUnconscious);
  eq('Downed ally HP = 70 after revive', downed.currentHP, 70);
  assert('condition_remove event logged on revive',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.targetId === 'fighter1'));
}

{
  // 4j. 'heal' event logged with correct value
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { currentHP: 10, maxHP: 200 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const healEv = state.log.events.find((e: any) => e.type === 'heal' && e.actorId === 'cleric1');
  assert('Heal event logged', !!healEv);
  eq('Heal event value is 70', healEv?.value, 70);
  eq('Heal event targets ally', healEv?.targetId, 'ally1');
}

// ============================================================
// 5. Integration + cleanup
// ============================================================

console.log('\n=== 5. Integration + cleanup ===\n');

{
  // 5a. Full pipeline: shouldCast → execute heals downed ally
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 6, y: 0, z: 0 }, // 30 ft
    currentHP: 0, isUnconscious: true, maxHP: 100,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast picks downed fighter', target?.id === 'fighter1');
  if (target) execute(caster, target, state);
  assert('Fighter revived after execute', !downed.isUnconscious);
  eq('Fighter HP = 70 after execute', downed.currentHP, 70);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots(1);
  const ally  = makeCombatant('ally1', { currentHP: 5, maxHP: 200 });
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
  const caster = makeCleric();
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('cleanup is a no-op (does not throw)', !threw);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
