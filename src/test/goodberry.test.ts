// ============================================================
// goodberry.test.ts — Goodberry spell module
// PHB p.246: 1st-level transmutation, action, range Touch (canon: 5 ft,
//            v1: 30 ft simplified), NO concentration.
// v1 effect: 10-HP flat heal to one ally within 30 ft (simplification of
//            canon 10 berries × 1 HP each, eaten over 10 actions).
//
// Tests cover shouldCast() preconditions, target priority, execute()
// healing (flat 10 HP, capped at maxHP, removes unconscious), slot
// consumption, logging, and cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/goodberry';
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
  return { spellSlots: { 1: { max: 2, remaining } } };
}

const GB_ACTION: Action = {
  name: 'Goodberry',
  costType: 'action',
  attackType: null,
  isMultiattack: false,
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
  slotLevel: 1,
  legendaryCost: 0,
  description: 'Goodberry (10-HP flat heal within 30 ft)',
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

function makeDruid(pos: Vec3 = { x: 0, y: 0, z: 0 }, wis = 16): Combatant {
  return makeCombatant('druid1', {
    name: 'Druid',
    pos,
    wis,
    actions: [GB_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Goodberry', metadata.name, 'Goodberry');
eq('level is 1', metadata.level, 1);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 30 ft (v1 simplified from canon Touch 5 ft)', metadata.rangeFt, 30);
eq('flat heal is 10 HP (10 berries × 1 HP)', metadata.healFlat, 10);
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 multi-berry simplification flag set',
  (metadata as any).goodberryMultiBerryV1SimplifiedToSingleHeal === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Goodberry' action
  const caster = makeDruid();
  caster.actions = [];
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Goodberry action', shouldCast(caster, bf) === null);
}

{
  // 2b. No spell slots remaining
  const caster = makeDruid();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no spell slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No valid target — party at full HP, no downed allies
  const caster = makeDruid();
  const ally = makeCombatant('ally1'); // full HP
  const bf = makeBF([caster, ally]);
  assert('Returns null when all allies are at full HP', shouldCast(caster, bf) === null);
}

{
  // 2d. Downed ally out of range (> 30 ft = > 6 squares of 5 ft)
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 7, y: 0, z: 0 }, // 35 ft — outside range
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null for downed ally beyond 30 ft', shouldCast(caster, bf) === null);
}

{
  // 2e. PHB p.246 — no effect on undead: shouldCast skips undead targets
  const caster = makeDruid();
  const undead = makeCombatant('zombie1', {
    currentHP: 0, isUnconscious: true, isUndead: true,
    faction: 'party', // pretend it's a friendly undead
  });
  const bf = makeBF([caster, undead]);
  assert('Returns null for undead target (PHB p.246)', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target selection
// ============================================================

console.log('\n=== 3. shouldCast — target selection ===\n');

{
  // 3a. Priority 1: downed (unconscious, !isDead) ally within range
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 3, y: 0, z: 0 }, // 15 ft — within range
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, downed]);
  const target = shouldCast(caster, bf);
  assert('Returns downed ally within 30 ft (priority 1)', target?.id === 'fighter1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3b. Priority 2: self if wounded
  const caster = makeDruid();
  caster.currentHP = 10; caster.maxHP = 40;
  const bf = makeBF([caster]);
  const target = shouldCast(caster, bf);
  assert('Returns self when wounded (priority 2)', target?.id === 'druid1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3c. Priority 3: most-wounded ally within range
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const hurt = makeCombatant('bard1', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft
    maxHP: 40, currentHP: 5, // deficit 35
  });
  const lessHurt = makeCombatant('rogue1', {
    pos: { x: 4, y: 0, z: 0 }, // 20 ft
    maxHP: 40, currentHP: 25, // deficit 15
  });
  const bf = makeBF([caster, hurt, lessHurt]);
  const target = shouldCast(caster, bf);
  assert('Returns most-wounded ally (largest HP deficit)', target?.id === 'bard1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3d. Enemy faction: never heals enemies
  const caster = makeDruid();
  const enemy = makeCombatant('goblin1', {
    currentHP: 0, isUnconscious: true,
    faction: 'enemy',
  });
  const bf = makeBF([caster, enemy]);
  assert('Returns null for downed enemy', shouldCast(caster, bf) === null);
}

// ============================================================
// 4. execute — effects and logging
// ============================================================

console.log('\n=== 4. execute — effects and logging ===\n');

{
  // 4a. Heals a wounded (conscious) ally by exactly 10 HP
  const caster = makeDruid();
  const ally   = makeCombatant('fighter1', { currentHP: 10, maxHP: 40 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  eq('Ally healed by exactly 10 HP (flat heal)', ally.currentHP, 20);
}

{
  // 4b. Slot is consumed
  const caster = makeDruid();
  caster.resources = withSlots(2);
  const ally  = makeCombatant('ally1', { currentHP: 5 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Spell slot consumed after execute', caster.resources!.spellSlots![1]!.remaining, 1);
}

{
  // 4c. 'action' cast event logged
  const caster = makeDruid();
  const ally   = makeCombatant('ally1', { currentHP: 10 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const castEv = state.log.events.find((e: any) => e.type === 'action' && e.actorId === 'druid1');
  assert('Action event logged with caster actorId', !!castEv,
    `events: ${state.log.events.map((e: any) => e.type).join(', ')}`);
}

{
  // 4d. 'heal' event logged with correct actor and target
  const caster = makeDruid();
  const ally   = makeCombatant('ally1', { currentHP: 10 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const healEv = state.log.events.find((e: any) => e.type === 'heal' && e.actorId === 'druid1');
  assert('Heal event logged', !!healEv,
    `events: ${state.log.events.map((e: any) => e.type).join(', ')}`);
  assert('Heal event targets ally', healEv?.targetId === 'ally1',
    `targetId: ${healEv?.targetId}`);
  eq('Heal event value is 10 (flat)', healEv?.value, 10);
}

{
  // 4e. Unconscious ally is revived: condition_remove event, isUnconscious cleared
  const caster = makeDruid();
  const downed = makeCombatant('fighter1', {
    currentHP: 0, isUnconscious: true, maxHP: 40,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  execute(caster, downed, state);

  assert('Unconscious flag cleared after heal', !downed.isUnconscious);
  eq('HP is 10 after revive (was 0)', downed.currentHP, 10);

  const reviveEv = state.log.events.find((e: any) =>
    e.type === 'condition_remove' && e.targetId === 'fighter1');
  assert('condition_remove event logged on revive', !!reviveEv);
}

{
  // 4f. Dead target: no effect, no HP change, early return
  const caster = makeDruid();
  const dead   = makeCombatant('fighter1', {
    currentHP: 0, isDead: true, isUnconscious: true,
  });
  const bf     = makeBF([caster, dead]);
  const state  = makeState(bf);
  const slotsBefore = caster.resources!.spellSlots![1]!.remaining;

  execute(caster, dead, state);

  eq('No slot consumed on dead target', caster.resources!.spellSlots![1]!.remaining, slotsBefore);
  eq('Dead target HP unchanged', dead.currentHP, 0);
}

{
  // 4g. HP cannot exceed maxHP
  const caster = makeDruid();
  const ally   = makeCombatant('ally1', { currentHP: 35, maxHP: 40 }); // 5 HP missing
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  assert('HP never exceeds maxHP after heal', ally.currentHP <= ally.maxHP,
    `hp: ${ally.currentHP}, max: ${ally.maxHP}`);
  eq('Ally HP capped at maxHP', ally.currentHP, 40);
}

{
  // 4h. Undead target: no effect (PHB p.246)
  const caster = makeDruid();
  const zombie = makeCombatant('zombie1', {
    currentHP: 0, isUnconscious: true, isUndead: true,
  });
  const bf     = makeBF([caster, zombie]);
  const state  = makeState(bf);
  const slotsBefore = caster.resources!.spellSlots![1]!.remaining;

  execute(caster, zombie, state);

  eq('No slot consumed on undead target', caster.resources!.spellSlots![1]!.remaining, slotsBefore);
  eq('Undead HP unchanged', zombie.currentHP, 0);
  const noEffectEv = state.log.events.find((e: any) =>
    e.type === 'action' && e.description?.includes('no effect'));
  assert('No-effect event logged for undead (PHB p.246)', !!noEffectEv);
}

// ============================================================
// 5. shouldCast + execute integration pipeline
// ============================================================

console.log('\n=== 5. Integration: shouldCast → execute pipeline ===\n');

{
  // 5a. shouldCast → execute revives downed ally
  const caster = makeDruid({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 3, y: 0, z: 0 }, // 15 ft
    currentHP: 0, isUnconscious: true, maxHP: 40,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast picks downed fighter', target?.id === 'fighter1');
  if (target) execute(caster, target, state);
  assert('Fighter revived after execute', !downed.isUnconscious);
  eq('Fighter HP = 10 after execute', downed.currentHP, 10);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeDruid();
  caster.resources = withSlots(1);
  const ally  = makeCombatant('ally1', { currentHP: 5 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![1]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

{
  // 5c. cleanup is a no-op (does not throw)
  const caster = makeDruid();
  let threw = false;
  try { cleanup(caster); } catch { threw = true; }
  assert('cleanup is a no-op (does not throw)', !threw);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
