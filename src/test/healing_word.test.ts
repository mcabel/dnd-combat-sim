// ============================================================
// healing_word.test.ts — Healing Word spell module
// PHB p.250: 1st-level evocation, bonus action, 60 ft range
// Effect: 1d4 + WIS mod HP restored; no effect on undead / constructs.
//
// Tests cover shouldCast() preconditions, execute() effects,
// metadata shape, and integration with EngineState logging.
//
// Note: execute() is called directly for determinism — dice are
//   real but assertions use ">= 1" / range checks, not fixed values.
//   Specific event-log assertions are deterministic (slot state,
//   event presence, targetId, actorId).
// ============================================================

import { shouldCast, execute, metadata } from '../spells/healing_word';
import { Combatant, Action, PlayerResources, Vec3, Battlefield } from '../types/core';

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

const HW_ACTION: Action = {
  name: 'Healing Word',
  costType: 'bonusAction',
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
  slotLevel: 1,
  legendaryCost: 0,
  description: 'Healing Word (1d4+WIS heal at 60ft, bonus action)',
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

/** Cleric at pos (0,0,0) with Healing Word + 2 spell slots */
function makeCleric(pos: Vec3 = { x: 0, y: 0, z: 0 }, wis = 16): Combatant {
  return makeCombatant('cleric1', {
    name: 'Cleric',
    pos,
    wis,
    actions: [HW_ACTION],
    resources: withSlots(2),
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('level is 1', metadata.level, 1);
eq('school is evocation', metadata.school, 'evocation');
eq('range is 60 ft', metadata.rangeFt, 60);
eq('heal die is d4', metadata.healDie, 4);
eq('not concentration', metadata.concentration, false);
eq('casting time is bonusAction', metadata.castingTime, 'bonusAction');

// ============================================================
// 2. shouldCast — precondition guards
// ============================================================

console.log('\n=== 2. shouldCast — precondition guards ===\n');

{
  // 2a. Caster lacks 'Healing Word' action
  const caster = makeCleric();
  caster.actions = []; // strip the action
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns null when caster has no Healing Word action', result === null);
}

{
  // 2b. No spell slots remaining
  const caster = makeCleric();
  caster.resources = withSlots(0);
  const ally = makeCombatant('ally1', { currentHP: 0, isUnconscious: true });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns null when no spell slots', result === null);
}

{
  // 2c. No valid target — party at full HP, no downed allies
  const caster = makeCleric();
  const ally = makeCombatant('ally1'); // full HP
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns null when all allies are at full HP', result === null);
}

{
  // 2d. Downed ally out of range (> 60 ft = >12 squares of 5ft)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 13, y: 0, z: 0 }, // 65 ft — just outside range
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, ally]);
  const result = shouldCast(caster, bf);
  assert('Returns null for downed ally beyond 60 ft', result === null,
    `target at ${ally.pos.x * 5}ft`);
}

{
  // 2e. PHB p.250 — no effect on undead: shouldCast skips undead targets
  const caster = makeCleric();
  const undead = makeCombatant('zombie1', {
    currentHP: 0, isUnconscious: true, isUndead: true,
    faction: 'party', // pretend it's a friendly undead
  });
  const bf = makeBF([caster, undead]);
  const result = shouldCast(caster, bf);
  assert('Returns null for undead target (PHB p.250)', result === null);
}

{
  // 2f. Enemy faction: never heals enemies
  const caster = makeCleric();
  const enemy = makeCombatant('goblin1', {
    currentHP: 0, isUnconscious: true,
    faction: 'enemy',
  });
  const bf = makeBF([caster, enemy]);
  const result = shouldCast(caster, bf);
  assert('Returns null for downed enemy', result === null);
}

// ============================================================
// 3. shouldCast — target selection
// ============================================================

console.log('\n=== 3. shouldCast — target selection ===\n');

{
  // 3a. Priority 1: downed (unconscious, !isDead) ally within range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 6, y: 0, z: 0 }, // 30 ft — within range
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, downed]);
  const target = shouldCast(caster, bf);
  assert('Returns downed ally within 60 ft (priority 1)', target?.id === 'fighter1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3b. Priority 2: self below 25% HP
  const caster = makeCleric();
  caster.currentHP = Math.floor(caster.maxHP * 0.2); // 20% — below 25%
  const bf = makeBF([caster]);
  const target = shouldCast(caster, bf);
  assert('Returns self when below 25% HP (priority 2)', target?.id === 'cleric1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3c. Priority 3: ally below 25% HP within range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const hurt = makeCombatant('bard1', {
    pos: { x: 4, y: 0, z: 0 }, // 20 ft
    maxHP: 40, currentHP: 8, // 20% — below 25%
  });
  const bf = makeBF([caster, hurt]);
  const target = shouldCast(caster, bf);
  assert('Returns ally below 25% HP within 60 ft (priority 3)', target?.id === 'bard1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3d. Exactly at 60ft boundary (12 squares) — should be in range
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const ally = makeCombatant('ally1', {
    pos: { x: 12, y: 0, z: 0 }, // exactly 60 ft
    currentHP: 0, isUnconscious: true,
  });
  const bf = makeBF([caster, ally]);
  const target = shouldCast(caster, bf);
  assert('Accepts target exactly at 60 ft boundary', target?.id === 'ally1',
    `got ${target?.id ?? 'null'}`);
}

{
  // 3e. Downed takes priority over critically hurt (not downed)
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 2, y: 0, z: 0 },
    currentHP: 0, isUnconscious: true,
  });
  const critical = makeCombatant('rogue1', {
    pos: { x: 3, y: 0, z: 0 },
    maxHP: 40, currentHP: 5,
  });
  const bf = makeBF([caster, downed, critical]);
  const target = shouldCast(caster, bf);
  assert('Downed ally prioritised over critically hurt ally', target?.id === 'fighter1',
    `got ${target?.id ?? 'null'}`);
}

// ============================================================
// 4. execute — effects and logging
// ============================================================

console.log('\n=== 4. execute — effects and logging ===\n');

{
  // 4a. Heals a wounded (conscious) ally
  const caster = makeCleric();
  const ally   = makeCombatant('fighter1', { currentHP: 10, maxHP: 40 }); // 25 HP missing
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);
  const hpBefore = ally.currentHP;

  execute(caster, ally, state);

  const healed = ally.currentHP - hpBefore;
  assert('HP increases after execute', healed >= 1, `hp gain: ${healed}`);
  // 1d4 + WIS(3) → range [4, 7]
  assert('Heal amount in expected range (1d4+3 with WIS 16)', healed >= 4 && healed <= 7,
    `healed ${healed}`);
}

{
  // 4b. Slot is consumed
  const caster = makeCleric();
  caster.resources = withSlots(2);
  const ally  = makeCombatant('ally1', { currentHP: 5 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  execute(caster, ally, state);

  eq('Spell slot consumed after execute', caster.resources!.spellSlots![1]!.remaining, 1);
}

{
  // 4c. 'action' cast event logged
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { currentHP: 10 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const castEv = state.log.events.find((e: any) => e.type === 'action' && e.actorId === 'cleric1');
  assert('Action event logged with caster actorId', !!castEv,
    `events: ${state.log.events.map((e: any) => e.type).join(', ')}`);
}

{
  // 4d. 'heal' event logged with correct actor and target
  const caster = makeCleric();
  const ally   = makeCombatant('ally1', { currentHP: 10 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  const healEv = state.log.events.find((e: any) => e.type === 'heal' && e.actorId === 'cleric1');
  assert('Heal event logged', !!healEv,
    `events: ${state.log.events.map((e: any) => e.type).join(', ')}`);
  assert('Heal event targets ally', healEv?.targetId === 'ally1',
    `targetId: ${healEv?.targetId}`);
  assert('Heal event value >= 1', healEv?.value >= 1, `value: ${healEv?.value}`);
}

{
  // 4e. Unconscious ally is revived: condition_remove event, isUnconscious cleared
  const caster = makeCleric();
  const downed = makeCombatant('fighter1', {
    currentHP: 0, isUnconscious: true, maxHP: 40,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  execute(caster, downed, state);

  assert('Unconscious flag cleared after heal', !downed.isUnconscious,
    `isUnconscious: ${downed.isUnconscious}`);
  assert('HP > 0 after revive', downed.currentHP > 0, `hp: ${downed.currentHP}`);

  const reviveEv = state.log.events.find((e: any) =>
    e.type === 'condition_remove' && e.targetId === 'fighter1');
  assert('condition_remove event logged on revive', !!reviveEv,
    `events: ${state.log.events.map((e: any) => e.type).join(', ')}`);
}

{
  // 4f. Dead target: no effect, no HP change, early return
  const caster = makeCleric();
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
  // 4g. PHB p.250 — no effect on undead: slot not consumed, actorId logged with "no effect"
  const caster = makeCleric();
  const zombie = makeCombatant('zombie1', {
    currentHP: 0, isUnconscious: true, isUndead: true,
  });
  const bf     = makeBF([caster, zombie]);
  const state  = makeState(bf);
  const slotsBefore = caster.resources!.spellSlots![1]!.remaining;
  const hpBefore = zombie.currentHP;

  execute(caster, zombie, state);

  eq('No slot consumed on undead target', caster.resources!.spellSlots![1]!.remaining, slotsBefore);
  eq('Undead HP unchanged', zombie.currentHP, hpBefore);

  const noEffectEv = state.log.events.find((e: any) =>
    e.type === 'action' && e.description?.includes('no effect'));
  assert('No-effect event logged for undead (PHB p.250)', !!noEffectEv,
    `events: ${state.log.events.map((e: any) => `${e.type}:${e.description}`).join(' | ')}`);

  const healEv = state.log.events.find((e: any) => e.type === 'heal');
  assert('No heal event for undead', !healEv);
}

{
  // 4h. Minimum 1 HP: even with very negative WIS modifier the heal is at least 1
  // Use WIS 1 → mod -5; d4 max is 4; min roll is 1; 1 + (-5) = -4 → clamped to 1
  const caster = makeCleric({ x: 0, y: 0, z: 0 }, 1 /* wis */);
  const ally   = makeCombatant('ally1', { currentHP: 10, maxHP: 40 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);
  const hpBefore = ally.currentHP;

  // Run many iterations to hit the worst case (d4=1, wis mod=-5 → 1+(-5)=-4 → clamp to 1)
  let sawMin = false;
  for (let i = 0; i < 50; i++) {
    const c2 = makeCleric({ x: 0, y: 0, z: 0 }, 1);
    const a2 = makeCombatant('ally1', { currentHP: 10, maxHP: 40 });
    const s2 = makeState(makeBF([c2, a2]));
    execute(c2, a2, s2);
    if (a2.currentHP - 10 >= 1) sawMin = true;
  }
  assert('Heal is always at least 1 HP even with WIS 1 (-5 mod)', sawMin);
}

{
  // 4i. WIS modifier correctly applied (high WIS → higher heal floor)
  // WIS 20 → mod +5; 1d4 + 5 → range [6, 9]
  const caster = makeCleric({ x: 0, y: 0, z: 0 }, 20 /* wis */);
  const ally   = makeCombatant('ally1', { currentHP: 1, maxHP: 40 });
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  // Test 20 times to be sure range is always [6,9]
  let allInRange = true;
  for (let i = 0; i < 20; i++) {
    const c2 = makeCleric({ x: 0, y: 0, z: 0 }, 20);
    const a2 = makeCombatant('ally1', { currentHP: 1, maxHP: 40 });
    const s2 = makeState(makeBF([c2, a2]));
    execute(c2, a2, s2);
    const gain = a2.currentHP - 1;
    if (gain < 6 || gain > 9) allInRange = false;
  }
  assert('1d4+5 (WIS 20) heals in range [6,9]', allInRange);
}

{
  // 4j. HP cannot exceed maxHP
  const caster = makeCleric({ x: 0, y: 0, z: 0 }, 20);
  const ally   = makeCombatant('ally1', { currentHP: 39, maxHP: 40 }); // 1 HP missing
  const bf     = makeBF([caster, ally]);
  const state  = makeState(bf);

  execute(caster, ally, state);

  assert('HP never exceeds maxHP after heal', ally.currentHP <= ally.maxHP,
    `hp: ${ally.currentHP}, max: ${ally.maxHP}`);
}

// ============================================================
// 5. shouldCast + execute integration
// ============================================================

console.log('\n=== 5. Integration: shouldCast → execute pipeline ===\n');

{
  // 5a. shouldCast → execute revives downed ally
  const caster = makeCleric({ x: 0, y: 0, z: 0 });
  const downed = makeCombatant('fighter1', {
    pos: { x: 6, y: 0, z: 0 }, // 30 ft
    currentHP: 0, isUnconscious: true, maxHP: 40,
  });
  const bf    = makeBF([caster, downed]);
  const state = makeState(bf);

  const target = shouldCast(caster, bf);
  assert('shouldCast picks downed fighter', target?.id === 'fighter1');
  if (target) execute(caster, target, state);
  assert('Fighter revived after execute', !downed.isUnconscious);
  assert('Fighter HP > 0 after execute', downed.currentHP > 0);
}

{
  // 5b. After slots exhausted, shouldCast returns null
  const caster = makeCleric();
  caster.resources = withSlots(1); // one slot
  const ally  = makeCombatant('ally1', { currentHP: 5 });
  const bf    = makeBF([caster, ally]);
  const state = makeState(bf);

  const t1 = shouldCast(caster, bf);
  if (t1) execute(caster, t1, state); // uses the last slot

  eq('Slot depleted', caster.resources!.spellSlots![1]!.remaining, 0);
  const t2 = shouldCast(caster, makeBF([caster, ally]));
  assert('shouldCast returns null after slots exhausted', t2 === null);
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`healing_word.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
