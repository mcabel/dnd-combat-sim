// ============================================================
// regenerate.test.ts — Regenerate spell module
// PHB p.271: 7th-level transmutation, action (canon: 1 min — v1: action),
//   range Touch (5 ft), NO concentration.
//   Effect: 4d8 + WIS mod HP heal. Per-turn 1 HP/turn rider NOT modelled.
//   Severed-limb restoration NOT modelled.
//
// Tests cover shouldCast() preconditions (Touch range), target priority,
// execute() 4d8+mod heal (range), slot consumption, logging, cleanup no-op.
// ============================================================

import { shouldCast, execute, cleanup, metadata } from '../spells/regenerate';
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
  return { spellSlots: { 7: { max: 2, remaining } } };
}

const REGEN_ACTION: Action = {
  name: 'Regenerate',
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
  slotLevel: 7,
  legendaryCost: 0,
  description: 'Regenerate (4d8+WIS heal at Touch range)',
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
    actions: [REGEN_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Regenerate', metadata.name, 'Regenerate');
eq('level is 7', metadata.level, 7);
eq('school is transmutation', metadata.school, 'transmutation');
eq('range is 5 ft (Touch)', metadata.rangeFt, 5);
eq('heal die is d8', metadata.healDie, 8);
eq('heal die count is 4', metadata.healDieCount, 4);
eq('casting ability is wis', metadata.castingAbility, 'wis');
eq('NOT concentration', metadata.concentration, false);
eq('casting time is action', metadata.castingTime, 'action');
assert('v1 cast time simplified flag set (canon 1 min → v1 action)',
  (metadata as any).regenerateCastTimeV1Simplified === true);
assert('v1 per-turn heal NOT modelled flag set',
  (metadata as any).regeneratePerTurnHealV1NotModelled === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Regenerate' action
  const caster = makeCleric();
  caster.actions = [];
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when caster has no Regenerate action', shouldCast(caster, bf) === null);
}

{
  // 2b. No 7th-level slots
  const caster = makeCleric();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no 7th-level slots', shouldCast(caster, bf) === null);
}

{
  // 2c. No wounded ally
  const caster = makeCleric();
  const ally = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 100, maxHP: 100 });
  const bf = makeBF([caster, ally]);
  assert('Returns null when no wounded allies', shouldCast(caster, bf) === null);
}

{
  // 2d. Out of Touch range (> 5 ft = > 1 square)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 2, y: 0, z: 0 }, // 10 ft — outside Touch
    currentHP: 5, maxHP: 100,
  });
  const bf = makeBF([caster, ally]);
  assert('Returns null for ally beyond Touch (10 ft)', shouldCast(caster, bf) === null);
}

{
  // 2e. Undead target excluded
  const caster = makeCleric();
  const undead = makeCombatant('zombie1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isUnconscious: true, isUndead: true,
    faction: 'party',
  });
  const bf = makeBF([caster, undead]);
  assert('Returns null for undead target', shouldCast(caster, bf) === null);
}

// ============================================================
// 3. shouldCast — target selection
// ============================================================

console.log('\n=== 3. shouldCast — target selection ===\n');

{
  // 3a. Priority 1: downed ally within Touch
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 }, // 5 ft — within Touch
    currentHP: 0, isUnconscious: true, maxHP: 100,
  });
  const bf = makeBF([caster, downed]);
  const target = shouldCast(caster, bf);
  assert('Returns downed ally within Touch (priority 1)', target?.id === 'fighter1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3b. Priority 2: self if wounded
  const caster = makeCleric();
  caster.currentHP = 20; caster.maxHP = 100;
  const bf = makeBF([caster]);
  const target = shouldCast(caster, bf);
  assert('Returns self when wounded (priority 2)', target?.id === 'cleric1');
}

{
  // 3c. Priority 3: most-wounded ally within Touch
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const hurt     = makeCombatant('bard1', { pos: { x: 1, y: 0, z: 0 }, maxHP: 100, currentHP: 10 });
  const lessHurt = makeCombatant('rogue1', { pos: { x: 0, y: 1, z: 0 }, maxHP: 100, currentHP: 50 });
  const bf = makeBF([caster, hurt, lessHurt]);
  const target = shouldCast(caster, bf);
  assert('Returns most-wounded ally (largest HP deficit)', target?.id === 'bard1');
}

{
  // 3d. Exactly at 5 ft (1 square) — should be in range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 1, y: 0, z: 0 }, // exactly 5 ft
    currentHP: 5, maxHP: 100,
  });
  const bf = makeBF([caster, ally]);
  const target = shouldCast(caster, bf);
  assert('Accepts target exactly at 5 ft boundary', target?.id === 'ally1');
}

// ============================================================
// 4. execute — healing
// ============================================================

console.log('\n=== 4. execute — healing ===\n');

{
  // 4a. Heals 4d8 + WIS mod (WIS 16 = +3) → range [7, 35]
  const caster = makeCleric();
  const ally   = makeCombatant('fighter1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 500 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const healed = ally.currentHP - 10;
  assert('Ally healed by 7..35 HP (4d8+3 with WIS 16)', healed >= 7 && healed <= 35,
    `healed: ${healed}`);
}

{
  // 4b. Capped at maxHP
  const caster = makeCleric();
  const ally   = makeCombatant('fighter1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 90, maxHP: 100 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  eq('Ally HP capped at maxHP', ally.currentHP, 100);
}

{
  // 4c. Slot consumed
  const caster = makeCleric();
  caster.resources = withSlots(2);
  const ally  = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 500 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('7th-level slot consumed', caster.resources!.spellSlots![7]!.remaining, 1);
}

{
  // 4d. 'action' cast event logged
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 500 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const castEv = state.log.events.find((e: any) => e.type === 'action' && e.actorId === 'cleric1');
  assert('Action event logged', !!castEv);
  assert('Action event mentions Regenerate',
    castEv?.description?.includes('Regenerate'));
}

{
  // 4e. 'heal' event logged
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 10, maxHP: 500 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const healEv = state.log.events.find((e: any) => e.type === 'heal' && e.actorId === 'cleric1');
  assert('Heal event logged', !!healEv);
  assert('Heal event value > 0', (healEv?.value ?? 0) > 0);
  eq('Heal event targets ally', healEv?.targetId, 'ally1');
}

{
  // 4f. Unconscious ally revived
  const caster = makeCleric();
  const downed = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isUnconscious: true, maxHP: 100,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  execute(caster, downed, state);

  assert('Unconscious flag cleared after heal', !downed.isUnconscious);
  assert('HP > 0 after revive', downed.currentHP > 0);
  assert('condition_remove event logged on revive',
    state.log.events.some((e: any) => e.type === 'condition_remove' && e.targetId === 'fighter1'));
}

{
  // 4g. Dead target: no effect
  const caster = makeCleric();
  const dead   = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isDead: true, isUnconscious: true,
  });
  const bf     = makeBF([caster, dead]);
  const state  = makeState(bf);
  const slotsBefore = caster.resources!.spellSlots![7]!.remaining;

  execute(caster, dead, state);

  eq('No slot consumed on dead target', caster.resources!.spellSlots![7]!.remaining, slotsBefore);
  eq('Dead target HP unchanged', dead.currentHP, 0);
}

{
  // 4h. Undead target: no effect
  const caster = makeCleric();
  const zombie = makeCombatant('zombie1', {
    pos: { x: 1, y: 0, z: 0 },
    currentHP: 0, isUnconscious: true, isUndead: true,
  });
  const bf     = makeBF([caster, zombie]);
  const state  = makeState(bf);
  const slotsBefore = caster.resources!.spellSlots![7]!.remaining;

  execute(caster, zombie, state);

  eq('No slot consumed on undead target', caster.resources!.spellSlots![7]!.remaining, slotsBefore);
  const noEffectEv = state.log.events.find((e: any) =>
    e.type === 'action' && e.description?.includes('no effect'));
  assert('No-effect event logged for undead', !!noEffectEv);
}

// ============================================================
// 5. Integration + cleanup
// ============================================================

console.log('\n=== 5. Integration + cleanup ===\n');

{
  // 5a. Full pipeline: shouldCast → execute heals ally at Touch range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally   = makeCombatant('fighter1', {
    pos: { x: 1, y: 0, z: 0 }, // 5 ft
    currentHP: 5, maxHP: 500,
  });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast picks ally within Touch', target?.id === 'fighter1');
  if (target) execute(caster, target, state);
  assert('Ally healed after execute', ally.currentHP > 5);
  eq('Slot consumed (1 remaining)', caster.resources!.spellSlots![7]!.remaining, 1);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots(1);
  const ally  = makeCombatant('ally1', { pos: { x: 1, y: 0, z: 0 }, currentHP: 5, maxHP: 500 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state);

  eq('Slot depleted', caster.resources!.spellSlots![7]!.remaining, 0);
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
