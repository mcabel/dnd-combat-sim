// ============================================================
// sleep.test.ts
//
// Tests:
//   1. shouldCast  — precondition gates (6 tests)
//   2. execute     — HP bucket mechanic, multi-target, budget exhaustion (11 tests)
//   3. Wake-on-damage — applyDamage clears sleeping state (5 tests)
//   4. Planner     — opener priority, slot and target gates (5 tests)
//   5. Engine      — runCombat integration (3 tests)
//
// Run: ts-node src/test/sleep.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute } from '../spells/sleep';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { runCombat, makeFlatBattlefield, EngineState, CombatLog } from '../engine/combat';
import { applyDamage } from '../engine/utils';
import { Combatant, Battlefield, Action, PlayerResources, Vec3 } from '../types/core';

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

const SLEEP_ACTION: Action = {
  name: 'Sleep',
  isMultiattack: false,
  attackType: null,
  reach: 90,
  range: null,
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: null,
  saveAbility: null,
  isAoE: true,
  isControl: true,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Sleep',
};

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 20, currentHP: 20, ac: 12, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 14, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
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

function makeCaster(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('wizard', {
    faction: 'party', pos,
    actions: [{ ...SLEEP_ACTION }],
    resources: withSlots(2),
  });
}

function makeEnemy(id: string, hp: number, pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'enemy', maxHP: hp, currentHP: hp, pos });
}

function makeBF(all: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of all) map.set(c.id, c);
  return {
    combatants: map, round: 1,
    initiativeOrder: all.map(c => c.id),
    obstacles: [],
    width: 30, height: 30, depth: 1, cells: [],
  } as unknown as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// PC helpers
const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap  = loadPCStatBlocks(rawPCs);
function spawnClass(cls: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown class: ${cls}`);
  return c;
}

// ============================================================
// 1. shouldCast gates
// ============================================================

console.log('\n--- 1. shouldCast gates ---');

{
  // 1a. Returns null when caster has no Sleep action.
  const caster = makeCaster();
  caster.actions = [];
  const enemy  = makeEnemy('e1', 7);
  const bf     = makeBF([caster, enemy]);
  eq('1a. no Sleep action → null', shouldCast(caster, bf), null);
}

{
  // 1b. Returns null when caster has no spell slots.
  const caster = makeCaster();
  caster.resources = withSlots(0);
  const enemy = makeEnemy('e1', 7);
  const bf    = makeBF([caster, enemy]);
  eq('1b. no slots → null', shouldCast(caster, bf), null);
}

{
  // 1c. Returns null when no living enemies exist.
  const caster = makeCaster();
  const bf     = makeBF([caster]);
  eq('1c. no enemies → null', shouldCast(caster, bf), null);
}

{
  // 1d. Returns targets when enemies exist in 90-ft range.
  const caster  = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy   = makeEnemy('e1', 7, { x: 5, y: 0, z: 0 }); // 25 ft
  const bf      = makeBF([caster, enemy]);
  const targets = shouldCast(caster, bf);
  assert('1d. enemy in range → targets returned', targets !== null && targets.length === 1);
}

{
  // 1e. Returns null when enemy is beyond 90 ft (>18 squares).
  const caster  = makeCaster({ x: 0, y: 0, z: 0 });
  const enemy   = makeEnemy('e1', 7, { x: 19, y: 0, z: 0 }); // 95 ft
  const bf      = makeBF([caster, enemy]);
  eq('1e. enemy at 95ft → null (out of range)', shouldCast(caster, bf), null);
}

{
  // 1f. Dead and already-unconscious enemies are excluded.
  const caster      = makeCaster();
  const dead        = makeEnemy('dead', 7, { x: 1, y: 0, z: 0 });
  dead.isDead       = true;
  const sleeping    = makeEnemy('unc', 4, { x: 2, y: 0, z: 0 });
  sleeping.isUnconscious = true;
  const bf          = makeBF([caster, dead, sleeping]);
  eq('1f. dead/unconscious enemies excluded → null', shouldCast(caster, bf), null);
}

// ============================================================
// 2. execute — HP bucket mechanic
// ============================================================

console.log('\n--- 2. execute HP bucket ---');

{
  // 2a. Consumes a spell slot.
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', 7);
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  eq('2a. slot consumed', caster.resources?.spellSlots?.[1]?.remaining, 1);
}

{
  // 2b. Logs the cast action event with budget.
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', 7);
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  const castEvt = state.log.events.find(e => e.type === 'action' && e.description.includes('Sleep') && e.description.includes('5d8'));
  assert('2b. cast event includes budget roll', !!castEvt);
}

{
  // 2c. Single enemy with low HP is put to sleep.
  // HP=5 is always ≤ 5d8 min (5) — guaranteed to sleep on any roll.
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', 5, { x: 1, y: 0, z: 0 }); // always fits in 5d8 budget
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);

  // Run a few times to account for variance — 5 HP should ALWAYS sleep
  // (5d8 minimum possible roll is 5, so even the worst roll puts a 5-HP enemy to sleep)
  assert('2c. enemy (5HP) → isUnconscious', enemy.isUnconscious);
  assert('2c. enemy (5HP) → sleeping condition', enemy.conditions.has('sleeping'));
  assert('2c. enemy (5HP) → unconscious condition', enemy.conditions.has('unconscious'));
  assert('2c. enemy (5HP) → incapacitated condition', enemy.conditions.has('incapacitated'));
}

{
  // 2d. Sleeping creature's currentHP is NOT reduced (Sleep doesn't deal damage).
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', 5, { x: 1, y: 0, z: 0 });
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  eq('2d. HP unchanged — Sleep deals no damage', enemy.currentHP, 5);
}

{
  // 2e. Multiple enemies: sorted ascending HP; lowest put to sleep first.
  // e1=3HP, e2=8HP — both within 5d8 minimum (5): e1 always sleeps.
  // e2 sleeps if budget ≥ 3+8=11 (very likely, avg=22.5).
  const caster = makeCaster();
  const e1     = makeEnemy('e1', 3, { x: 1, y: 0, z: 0 });
  const e2     = makeEnemy('e2', 8, { x: 2, y: 0, z: 0 });
  const bf     = makeBF([caster, e1, e2]);
  const state  = makeState(bf);
  execute(caster, [e2, e1], state);  // pass out-of-order to test internal sorting
  assert('2e. e1 (3HP) sleeping (sorted first)', e1.isUnconscious);
}

{
  // 2f. Budget exhaustion: enemy with HP > remaining budget is NOT put to sleep.
  // Give caster a budget of exactly 5 by controlling dice (we can't, so use
  // a very high HP enemy that exceeds any 5d8 roll — 5d8 max = 40; enemy HP = 50).
  const caster    = makeCaster();
  const highHP    = makeEnemy('boss', 50, { x: 1, y: 0, z: 0 }); // always > 5d8 max (40)
  const bf        = makeBF([caster, highHP]);
  const state     = makeState(bf);
  execute(caster, [highHP], state);
  assert('2f. enemy with 50HP (> 5d8 max 40) NOT put to sleep', !highHP.isUnconscious);
}

{
  // 2g. Budget carries over: if enemy A (high HP) is skipped, remaining
  // budget still affects subsequent lower-HP enemies.
  // NOTE: PHB sorting goes ASCENDING — so lower HP are processed first.
  // This test confirms the module correctly sorts ascending before applying.
  // e1=50HP (never sleeps), e2=3HP (always sleeps).
  const caster = makeCaster();
  const e1     = makeEnemy('e1', 50, { x: 1, y: 0, z: 0 }); // > max budget
  const e2     = makeEnemy('e2', 3,  { x: 2, y: 0, z: 0 }); // always fits
  const bf     = makeBF([caster, e1, e2]);
  const state  = makeState(bf);
  execute(caster, [e1, e2], state);
  assert('2g. e2 (3HP) sleeps — ascending sort means budget reaches e2 before e1', e2.isUnconscious);
  assert('2g. e1 (50HP) does NOT sleep (exceeds budget)', !e1.isUnconscious);
}

{
  // 2h. A creature with active concentration loses it when put to sleep.
  const caster = makeCaster();
  const enemy  = makeEnemy('e1', 5, { x: 1, y: 0, z: 0 });
  enemy.concentration = { active: true, spellName: 'Entangle', dcIfHit: 0 };
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  assert('2h. concentration broken on sleep', enemy.concentration === null);
  const condEvt = state.log.events.find(e => e.type === 'condition_remove' && e.targetId === 'e1');
  assert('2h. condition_remove event for concentration break', !!condEvt);
}

{
  // 2i. condition_add event is logged for each sleeping creature.
  const caster = makeCaster();
  const e1     = makeEnemy('e1', 3, { x: 1, y: 0, z: 0 });
  const e2     = makeEnemy('e2', 4, { x: 2, y: 0, z: 0 });
  const bf     = makeBF([caster, e1, e2]);
  const state  = makeState(bf);
  execute(caster, [e1, e2], state);
  const addEvts = state.log.events.filter(e => e.type === 'condition_add');
  assert('2i. condition_add events for both sleepers', addEvts.length >= 2);
}

{
  // 2j. Already-dead targets are skipped inside execute.
  const caster = makeCaster();
  const dead   = makeEnemy('dead', 5, { x: 1, y: 0, z: 0 });
  dead.isDead  = true;
  const bf     = makeBF([caster, dead]);
  const state  = makeState(bf);
  execute(caster, [dead], state);
  const addEvts = state.log.events.filter(e => e.type === 'condition_add');
  eq('2j. dead target skipped — no sleep applied', addEvts.length, 0);
}

{
  // 2k. Summary log event shows correct slept count.
  const caster = makeCaster();
  const e1     = makeEnemy('e1', 3, { x: 1, y: 0, z: 0 });
  const bf     = makeBF([caster, e1]);
  const state  = makeState(bf);
  execute(caster, [e1], state);
  const summaryEvt = state.log.events.find(e =>
    e.type === 'action' && e.description.match(/\d+ creature/)
  );
  assert('2k. summary event logged with slept count', !!summaryEvt);
}

// ============================================================
// 3. Wake-on-damage (applyDamage)
// ============================================================

console.log('\n--- 3. Wake-on-damage ---');

{
  // 3a. applyDamage clears 'sleeping' condition.
  const target = makeEnemy('e1', 20);
  target.isUnconscious = true;
  target.conditions.add('sleeping');
  target.conditions.add('unconscious');
  target.conditions.add('incapacitated');
  applyDamage(target, 5);
  assert('3a. sleeping condition removed on damage', !target.conditions.has('sleeping'));
}

{
  // 3b. applyDamage clears 'unconscious' condition.
  const target = makeEnemy('e1', 20);
  target.isUnconscious = true;
  target.conditions.add('sleeping');
  target.conditions.add('unconscious');
  target.conditions.add('incapacitated');
  applyDamage(target, 5);
  assert('3b. unconscious condition removed on damage', !target.conditions.has('unconscious'));
}

{
  // 3c. applyDamage sets isUnconscious = false.
  const target = makeEnemy('e1', 20);
  target.isUnconscious = true;
  target.conditions.add('sleeping');
  target.conditions.add('unconscious');
  applyDamage(target, 5);
  assert('3c. isUnconscious = false after waking', !target.isUnconscious);
}

{
  // 3d. Waking deals the damage (HP is reduced).
  const target = makeEnemy('e1', 20);
  target.isUnconscious = true;
  target.conditions.add('sleeping');
  applyDamage(target, 8);
  eq('3d. damage dealt even when waking creature', target.currentHP, 12);
}

{
  // 3e. Zero damage does NOT wake a sleeping creature (PHB: "taking damage wakes").
  const target = makeEnemy('e1', 20);
  target.isUnconscious = true;
  target.conditions.add('sleeping');
  applyDamage(target, 0);
  assert('3e. 0 damage does not wake sleeping creature', target.conditions.has('sleeping'));
}

// ============================================================
// 4. Planner
// ============================================================

console.log('\n--- 4. Planner ---');

{
  // 4a. Wizard picks Sleep when enemy is in range and slot is available.
  const wizard = spawnClass('Wizard', { x: 0, y: 0, z: 0 });
  const enemy  = makeCombatant('goblin', { faction: 'enemy', maxHP: 7, currentHP: 7,
    pos: { x: 2, y: 0, z: 0 } });
  const bf     = makeBF([wizard, enemy]);
  const plan   = planTurn(wizard, bf);
  eq('4a. Wizard picks sleep', plan.action?.type, 'sleep');
}

{
  // 4b. Sorcerer also picks Sleep (they have it in spells_1st).
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  const enemy    = makeCombatant('goblin', { faction: 'enemy', maxHP: 7, currentHP: 7,
    pos: { x: 2, y: 0, z: 0 } });
  const bf       = makeBF([sorcerer, enemy]);
  const plan     = planTurn(sorcerer, bf);
  eq('4b. Sorcerer picks sleep', plan.action?.type, 'sleep');
}

{
  // 4c. Wizard does NOT pick Sleep when out of slots.
  const wizard = spawnClass('Wizard', { x: 0, y: 0, z: 0 });
  if (wizard.resources?.spellSlots) {
    for (const k of Object.keys(wizard.resources.spellSlots)) {
      (wizard.resources.spellSlots as any)[+k].remaining = 0;
    }
  }
  const enemy = makeCombatant('goblin', { faction: 'enemy', maxHP: 7, currentHP: 7,
    pos: { x: 2, y: 0, z: 0 } });
  const bf    = makeBF([wizard, enemy]);
  const plan  = planTurn(wizard, bf);
  assert('4c. no slots → no sleep', plan.action?.type !== 'sleep');
}

{
  // 4d. Sleep fires while concentrating (NOT concentration spell).
  const wizard = spawnClass('Wizard', { x: 0, y: 0, z: 0 });
  wizard.concentration = { active: true, spellName: 'Some Concentration Spell', dcIfHit: 0 };
  const enemy = makeCombatant('goblin', { faction: 'enemy', maxHP: 7, currentHP: 7,
    pos: { x: 2, y: 0, z: 0 } });
  const bf    = makeBF([wizard, enemy]);
  const plan  = planTurn(wizard, bf);
  eq('4d. Sleep fires while concentrating on another spell', plan.action?.type, 'sleep');
}

{
  // 4e. Wizard parsers include Sleep in actions list.
  const wizard   = spawnClass('Wizard');
  const hasSleep = wizard.actions.some(a => a.name === 'Sleep');
  assert('4e. Wizard parsed actions include Sleep', hasSleep);
}

// ============================================================
// 5. Engine integration
// ============================================================

console.log('\n--- 5. Engine integration ---');

{
  // 5a. runCombat fires a Sleep action event.
  const wizard = spawnClass('Wizard', { x: 0, y: 0, z: 0 });
  const e1 = makeCombatant('e1', { name: 'Goblin1', faction: 'enemy', cr: 0.25,
    maxHP: 7, currentHP: 7, ac: 15, pos: { x: 2, y: 0, z: 0 } });
  const bf = makeFlatBattlefield(20, 20, [wizard, e1]);
  const log = runCombat(bf, [wizard.id, e1.id]);
  const hasSleep = log.events.some(e => e.type === 'action' && e.description.includes('Sleep'));
  assert('5a. runCombat fires Sleep action event', hasSleep);
}

{
  // 5b. After Sleep fires, at least one creature has the sleeping condition event.
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  const e1 = makeCombatant('e1', { name: 'Goblin1', faction: 'enemy', cr: 0.25,
    maxHP: 7, currentHP: 7, ac: 15, pos: { x: 2, y: 0, z: 0 } });
  const bf = makeFlatBattlefield(20, 20, [sorcerer, e1]);
  const log = runCombat(bf, [sorcerer.id, e1.id]);
  const sleptEvt = log.events.some(e => e.type === 'condition_add' && e.description.includes('asleep'));
  assert('5b. condition_add "asleep" event appears', sleptEvt);
}

{
  // 5c. Sleep action has attackType null — selectAction never picks it.
  const wizard = spawnClass('Wizard');
  const sleepAction = wizard.actions.find(a => a.name === 'Sleep');
  assert('5c. Sleep attackType is null (not picked by selectAction)', sleepAction?.attackType === null);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
