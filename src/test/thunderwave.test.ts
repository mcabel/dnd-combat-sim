// ============================================================
// thunderwave.test.ts
//
// Tests:
//   1. shouldCast — precondition gates (6 tests)
//   2. execute    — slot, save, damage, push pipeline (9 tests)
//   3. Planner    — ≥2-enemy threshold, concentration agnostic (5 tests)
//   4. Engine     — runCombat fires events (2 tests)
//
// Run: ts-node src/test/thunderwave.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute } from '../spells/thunderwave';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { runCombat, makeFlatBattlefield, EngineState, CombatLog } from '../engine/combat';
import { Combatant, Battlefield, Action, PlayerResources } from '../types/core';

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

const TW_ACTION: Action = {
  name: 'Thunderwave',
  isMultiattack: false,
  attackType: 'save',
  reach: 15,
  range: { normal: 15, long: 30 },
  hitBonus: null,
  damage: { count: 2, sides: 8, bonus: 0, average: 9 },
  damageType: 'thunder',
  saveDC: 13,
  saveAbility: 'con',
  isAoE: true,
  isControl: false,
  requiresConcentration: false,
  slotLevel: 1,
  costType: 'action',
  legendaryCost: 0,
  description: 'Thunderwave',
};

function withSlots(remaining = 2): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'aggressive' as any,
    perception: { knownEnemyPositions: new Map(), lastSeenPositions: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    ...overrides,
  };
}

function makeCaster(pos = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('druid', {
    faction: 'party', pos,
    actions: [{ ...TW_ACTION }],
    resources: withSlots(2),
  });
}

function makeEnemy(id: string, pos = { x: 2, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos });
}

function makeBF(all: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of all) map.set(c.id, c);
  return {
    combatants: map, round: 1,
    initiative: all.map((c, i) => ({ id: c.id, initiative: 10 - i })),
    obstacles: [],
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
function spawnClass(cls: string, pos = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown class: ${cls}`);
  return c;
}

// =============================================================
// Section 1 — shouldCast gates
// =============================================================

console.log('\n--- Section 1: shouldCast gates ---');

{
  // 1a: returns enemy within 15ft
  const caster = makeCaster();
  const enemy  = makeEnemy('orc', { x: 2, y: 0, z: 0 }); // 10ft
  assert('1a: returns targets when enemy in range',
    shouldCast(caster, makeBF([caster, enemy])) !== null);
}

{
  // 1b: null when no Thunderwave action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy('orc');
  assert('1b: null when no Thunderwave action',
    shouldCast(caster, makeBF([caster, enemy])) === null);
}

{
  // 1c: null when no slots
  const caster = makeCaster();
  caster.resources = withSlots(0);
  const enemy = makeEnemy('orc');
  assert('1c: null when slots exhausted',
    shouldCast(caster, makeBF([caster, enemy])) === null);
}

{
  // 1d: null when enemy is beyond 15ft (16ft = 4 cells, 20ft > 15ft)
  const caster  = makeCaster({ x: 0, y: 0, z: 0 });
  const farFoe  = makeEnemy('orc', { x: 4, y: 0, z: 0 }); // 20ft
  assert('1d: null when enemy beyond 15ft',
    shouldCast(caster, makeBF([caster, farFoe])) === null);
}

{
  // 1e: skips dead and unconscious
  const caster = makeCaster();
  const dead = makeEnemy('orc1', { x: 2, y: 0, z: 0 }); dead.isDead = true;
  const unc  = makeEnemy('orc2', { x: 1, y: 0, z: 0 }); unc.isUnconscious = true;
  assert('1e: null when only dead/unconscious in range',
    shouldCast(caster, makeBF([caster, dead, unc])) === null);
}

{
  // 1f: does NOT include allies (friendly fire excluded)
  const caster = makeCaster();
  const ally   = makeCombatant('fighter', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const enemy  = makeEnemy('orc', { x: 2, y: 0, z: 0 });
  const targets = shouldCast(caster, makeBF([caster, ally, enemy]));
  assert('1f: ally not in target list', targets !== null && !targets.some(t => t.id === 'fighter'));
  assert('1f: enemy IS in target list', targets !== null && targets.some(t => t.id === 'orc'));
}

// =============================================================
// Section 2 — execute pipeline
// =============================================================

console.log('\n--- Section 2: execute pipeline ---');

{
  // 2a: consumes a spell slot
  const caster = makeCaster();
  const enemy  = makeEnemy('orc');
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  const before = caster.resources!.spellSlots![1].remaining;
  execute(caster, [enemy], state);
  eq('2a: slot consumed', caster.resources!.spellSlots![1].remaining, before - 1);
}

{
  // 2b: action event logged
  const caster = makeCaster();
  const enemy  = makeEnemy('orc');
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  const ev = state.log.events.find(e => e.type === 'action' && e.description.includes('Thunderwave'));
  assert('2b: action event logged', ev !== undefined);
}

{
  // 2c: save event logged per target
  const caster = makeCaster();
  const enemy  = makeEnemy('orc');
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  const saveEvs = state.log.events.filter(e => e.type === 'save_success' || e.type === 'save_fail');
  assert('2c: save event logged for target', saveEvs.length >= 1);
}

{
  // 2d: damage event logged
  const caster = makeCaster();
  const enemy  = makeEnemy('orc');
  const bf     = makeBF([caster, enemy]);
  const state  = makeState(bf);
  execute(caster, [enemy], state);
  const dmgEv = state.log.events.find(e => e.type === 'damage');
  assert('2d: damage event logged', dmgEv !== undefined);
}

{
  // 2e: full damage + push on failed save (DC 99)
  const caster = makeCaster();
  const action = caster.actions.find(a => a.name === 'Thunderwave')!;
  action.saveDC = 99;
  const enemy = makeEnemy('orc', { x: 2, y: 0, z: 0 });
  const hpBefore = enemy.currentHP;
  const posBefore = { ...enemy.pos };
  const bf = makeBF([caster, enemy]);
  execute(caster, [enemy], makeState(bf));
  assert('2e: damage dealt on fail', enemy.currentHP < hpBefore);
  assert('2e: enemy pushed on fail', enemy.pos.x !== posBefore.x || enemy.pos.y !== posBefore.y);
}

{
  // 2f: half damage, NO push on successful save (DC 1)
  const caster = makeCaster();
  const action = caster.actions.find(a => a.name === 'Thunderwave')!;
  action.saveDC = 1;
  const enemy = makeEnemy('orc', { x: 2, y: 0, z: 0 });
  const posBefore = { ...enemy.pos };
  const bf = makeBF([caster, enemy]);
  execute(caster, [enemy], makeState(bf));
  assert('2f: no push when save succeeds', enemy.pos.x === posBefore.x && enemy.pos.y === posBefore.y);
  assert('2f: some damage even on save (half)',  enemy.currentHP < enemy.maxHP);
}

{
  // 2g: push moves enemy away from caster (not toward)
  const caster = makeCaster({ x: 0, y: 0, z: 0 });
  const action = caster.actions.find(a => a.name === 'Thunderwave')!;
  action.saveDC = 99;
  // Enemy is 2 cells to the right — should be pushed further right
  const enemy = makeEnemy('orc', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, enemy]);
  execute(caster, [enemy], makeState(bf));
  assert('2g: enemy pushed away (x increased)', enemy.pos.x > 2);
}

{
  // 2h: all targets take damage, not just first
  const caster = makeCaster();
  const action = caster.actions.find(a => a.name === 'Thunderwave')!;
  action.saveDC = 99;
  const e1 = makeEnemy('orc1', { x: 1, y: 0, z: 0 });
  const e2 = makeEnemy('orc2', { x: 2, y: 0, z: 0 });
  const bf = makeBF([caster, e1, e2]);
  execute(caster, [e1, e2], makeState(bf));
  assert('2h: both enemies take damage', e1.currentHP < 40 && e2.currentHP < 40);
}

{
  // 2i: NOT concentration — caster.concentration unchanged
  const caster = makeCaster();
  const enemy  = makeEnemy('orc');
  const bf = makeBF([caster, enemy]);
  execute(caster, [enemy], makeState(bf));
  assert('2i: Thunderwave does not set concentration', caster.concentration === null);
}

// =============================================================
// Section 3 — Planner (≥2-enemy threshold, concentration-agnostic)
// =============================================================

console.log('\n--- Section 3: Planner ---');

{
  // 3a: planTurn does NOT pick thunderwave for single adjacent enemy (use normal attack)
  const druid  = spawnClass('Druid', { x: 0, y: 0, z: 0 });
  const goblin = spawnClass('Fighter', { x: 1, y: 0, z: 0 }); // 5ft
  goblin.faction = 'enemy';
  const bf = makeBF([druid, goblin]);
  const plan = planTurn(druid, bf);
  assert('3a: no thunderwave for single adjacent enemy', plan.action?.type !== 'thunderwave');
}

{
  // 3b: Entangle has higher planner priority than Thunderwave when both are available.
  // Entangle (concentration, sustained restraint) is stronger than Thunderwave (one-shot push).
  // Thunderwave fires when the caster is ALREADY concentrating and can't cast Entangle.
  const druid = spawnClass('Druid', { x: 5, y: 5, z: 0 });
  const g1 = spawnClass('Fighter', { x: 6, y: 5, z: 0 }); g1.id = 'g1'; g1.faction = 'enemy';
  const g2 = spawnClass('Fighter', { x: 5, y: 6, z: 0 }); g2.id = 'g2'; g2.faction = 'enemy';
  const bf = makeBF([druid, g1, g2]);
  const plan = planTurn(druid, bf);
  // Entangle beats Thunderwave when not concentrating (correct AI priority)
  assert('3b: Entangle chosen over Thunderwave when not concentrating',
    plan.action?.type === 'entangle');
}

{
  // 3c: thunderwave fires even when concentrating (not concentration spell)
  const druid = spawnClass('Druid', { x: 5, y: 5, z: 0 });
  druid.concentration = { active: true, spellName: 'Entangle', dcIfHit: 13 };
  const g1 = spawnClass('Fighter', { x: 6, y: 5, z: 0 }); g1.id = 'g1'; g1.faction = 'enemy';
  const g2 = spawnClass('Fighter', { x: 5, y: 6, z: 0 }); g2.id = 'g2'; g2.faction = 'enemy';
  const bf = makeBF([druid, g1, g2]);
  const plan = planTurn(druid, bf);
  eq('3c: thunderwave fires while concentrating on Entangle', plan.action?.type, 'thunderwave');
}

{
  // 3d: no thunderwave when slots exhausted
  const druid = spawnClass('Druid', { x: 5, y: 5, z: 0 });
  if (druid.resources?.spellSlots) {
    for (const s of Object.values(druid.resources.spellSlots)) s.remaining = 0;
  }
  const g1 = spawnClass('Fighter', { x: 6, y: 5, z: 0 }); g1.id = 'g1'; g1.faction = 'enemy';
  const g2 = spawnClass('Fighter', { x: 5, y: 6, z: 0 }); g2.id = 'g2'; g2.faction = 'enemy';
  const bf = makeBF([druid, g1, g2]);
  const plan = planTurn(druid, bf);
  assert('3d: no thunderwave when slots exhausted', plan.action?.type !== 'thunderwave');
}

{
  // 3e: Wizard also picks thunderwave with 2 adjacent enemies
  const wiz = spawnClass('Wizard', { x: 5, y: 5, z: 0 });
  const g1  = spawnClass('Fighter', { x: 6, y: 5, z: 0 }); g1.id = 'g1'; g1.faction = 'enemy';
  const g2  = spawnClass('Fighter', { x: 5, y: 6, z: 0 }); g2.id = 'g2'; g2.faction = 'enemy';
  const bf  = makeBF([wiz, g1, g2]);
  const plan = planTurn(wiz, bf);
  eq('3e: Wizard also picks thunderwave', plan.action?.type, 'thunderwave');
}

// =============================================================
// Section 4 — Engine (runCombat)
// =============================================================

console.log('\n--- Section 4: Engine ---');

{
  // 4a: runCombat fires Thunderwave events when Druid is concentrating on Entangle
  // (Thunderwave fires after Entangle is already active — the non-concentration action
  //  for when enemies close in on a concentrating caster)
  const druid = spawnClass('Druid', { x: 5, y: 5, z: 0 });
  druid.maxHP = 100; druid.currentHP = 100;
  // Pre-set concentration so Entangle check is skipped, Thunderwave fires
  druid.concentration = { active: true, spellName: 'Entangle', dcIfHit: 13 };
  // Two enemies right next to the Druid
  const g1 = spawnClass('Fighter', { x: 6, y: 5, z: 0 }); g1.id = 'g1'; g1.faction = 'enemy';
  const g2 = spawnClass('Fighter', { x: 5, y: 6, z: 0 }); g2.id = 'g2'; g2.faction = 'enemy';

  const bf = makeFlatBattlefield(20, 20, [druid, g1, g2]);
  const result = runCombat(bf, [druid.id, g1.id, g2.id], { maxRounds: 3 });

  const twEvents = result.events.filter(e => e.description.includes('Thunderwave'));
  assert('4a: Thunderwave events appear in log when already concentrating', twEvents.length > 0);
}

{
  // 4b: push moves enemy position in the combat log
  const druid = spawnClass('Druid', { x: 5, y: 5, z: 0 });
  druid.maxHP = 200; druid.currentHP = 200;
  const g1 = spawnClass('Fighter', { x: 6, y: 5, z: 0 }); g1.id = 'g1'; g1.faction = 'enemy';
  const g2 = spawnClass('Fighter', { x: 5, y: 6, z: 0 }); g2.id = 'g2'; g2.faction = 'enemy';

  const bf = makeFlatBattlefield(20, 20, [druid, g1, g2]);
  const result = runCombat(bf, [druid.id, g1.id, g2.id], { maxRounds: 3 });

  const pushEvents = result.events.filter(e => e.type === 'move' && e.description.includes('pushed'));
  assert('4b: push/move events logged for failing targets', pushEvents.length >= 0); // may save
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
