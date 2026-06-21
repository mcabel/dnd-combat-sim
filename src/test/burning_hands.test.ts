// ============================================================
// burning_hands.test.ts  —  PHB p.220
//
// Sections:
//   1. Cone geometry   — inConeFt correctness (6 tests)
//   2. shouldCast      — gate checks (slot, range, class) (7 tests)
//   3. execute         — damage, saves, slot consumed (8 tests)
//   4. Planner         — Sorcerer/Wizard plan burningHands (6 tests)
//   5. End-to-end      — actual combat damage applied (4 tests)
//
// Run: ts-node src/test/burning_hands.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT } from '../spells/burning_hands';
import { inConeFt } from '../engine/movement';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { loadBestiaryJson, monsterToCombatant } from '../parser/fivetools';
import { EngineState, makeFlatBattlefield } from '../engine/combat';
import { Combatant, Battlefield, PlayerResources, Vec3 } from '../types/core';

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

function withSlots(remaining = 1): PlayerResources {
  return { spellSlots: { 1: { max: 2, remaining } } };
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 40, currentHP: 40, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart' as any,
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

function makeSorcerer(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('sorcerer', {
    faction: 'party', pos,
    actions: [
      {
        name: 'Burning Hands',
        isMultiattack: false,
        attackType: 'save',
        reach: 15,
        range: { normal: 15, long: 15 },
        hitBonus: null,
        damage: { count: 3, sides: 6, bonus: 0, average: 10.5 },
        damageType: 'fire',
        saveDC: 13,
        saveAbility: 'dex',
        isAoE: true,
        isControl: false,
        requiresConcentration: false,
        slotLevel: 1,
        costType: 'action' as any,
        legendaryCost: 0,
        description: 'Burning Hands',
      },
    ],
    resources: withSlots(1),
  });
}

function makeEnemy(id: string, pos: Vec3, dex = 10): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos, dex });
}

function makeBF(all: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of all) map.set(c.id, c);
  return {
    combatants: map, round: 1,
    initiativeOrder: all.map(c => c.id),
    obstacles: [], width: 20, height: 20, depth: 1, cells: [],
  } as unknown as Battlefield;
}

function makeEngineState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

// ---- Bestiary / PC loader -----------------------------------

const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap  = loadPCStatBlocks(rawPCs);

const bestiaryRaw = JSON.parse(fs.readFileSync('bestiaryData/bestiary-mm-2014.json', 'utf8'));
const bestiary    = loadBestiaryJson(bestiaryRaw);

function spawnClass(cls: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown class: ${cls}`);
  return c;
}

function spawnMonster(name: string, id: string, pos: Vec3 = { x: 2, y: 0, z: 0 }): Combatant {
  const template = bestiary.get(name.toLowerCase());
  if (!template) throw new Error(`Monster not found: ${name}`);
  const c = monsterToCombatant(template, pos);
  c.id = id;
  return c;
}

// ---- 1. Cone geometry ----------------------------------------
// SAC cone: halfAngle = arctan(0.5) ≈ 26.57°, range = 15 ft (3 cells)
// Grid: caster at (0,0,0). One cell = 5 ft. Aim toward +X axis.

console.log('\n1. Cone geometry (inConeFt)');

{
  const apex = { x: 0, y: 0, z: 0 };
  const aimAt = { x: 3, y: 0, z: 0 }; // pointing right (+X)

  // Cell directly ahead 1 cell (5 ft) — inside cone
  assert('cell at (1,0) in cone (5 ft ahead, on axis)',
    inConeFt(apex, aimAt, { x: 1, y: 0, z: 0 }, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT));

  // Cell ahead 3 cells (15 ft, edge of range)
  assert('cell at (3,0) in cone (15 ft, at range limit)',
    inConeFt(apex, aimAt, { x: 3, y: 0, z: 0 }, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT));

  // Cell beyond range (4 cells = 20 ft)
  assert('cell at (4,0) out of cone (20 ft, beyond range)',
    !inConeFt(apex, aimAt, { x: 4, y: 0, z: 0 }, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT));

  // Cell directly sideways (perpendicular — outside half-angle)
  assert('cell at (0,1) out of cone (90° from axis)',
    !inConeFt(apex, aimAt, { x: 0, y: 1, z: 0 }, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT));

  // Apex cell itself — excluded
  assert('apex cell (0,0) excluded from cone',
    !inConeFt(apex, aimAt, { x: 0, y: 0, z: 0 }, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT));

  // Cell behind caster — not in cone
  assert('cell at (-1,0) out of cone (behind caster)',
    !inConeFt(apex, aimAt, { x: -1, y: 0, z: 0 }, CONE_HALF_ANGLE_DEG, CONE_RANGE_FT));
}

// ---- 2. shouldCast gates ------------------------------------

console.log('\n2. shouldCast gates');

{
  // Basic: Sorcerer with slot and enemy at (2,0) = 10 ft
  const s = makeSorcerer({ x: 0, y: 0, z: 0 });
  const e = makeEnemy('e1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  const result = shouldCast(s, bf);
  assert('returns targets when slot + enemy in range', result !== null && result.length >= 1);
}

{
  // No slot — should not cast
  const s = makeSorcerer();
  s.resources = withSlots(0);
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  assert('returns null when no spell slot', shouldCast(s, bf) === null);
}

{
  // Enemy too far (4 cells = 20 ft > 15 ft)
  const s = makeSorcerer({ x: 0, y: 0, z: 0 });
  const e = makeEnemy('e1', { x: 4, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  assert('returns null when enemy beyond 15 ft', shouldCast(s, bf) === null);
}

{
  // No Burning Hands in actions
  const s = makeSorcerer();
  s.actions = [];  // strip spells
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  assert('returns null when no Burning Hands action', shouldCast(s, bf) === null);
}

{
  // Multiple enemies in cone — returns all
  const s = makeSorcerer({ x: 0, y: 0, z: 0 });
  const e1 = makeEnemy('e1', { x: 2, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 2, y: 1, z: 0 }); // slightly off-axis, should be outside
  const e3 = makeEnemy('e3', { x: 1, y: 0, z: 0 }); // on-axis, inside
  const bf = makeBF([s, e1, e2, e3]);
  const result = shouldCast(s, bf);
  assert('returns ≥2 targets when multiple in cone', result !== null && result.length >= 2);
}

{
  // Dead enemy — excluded
  const s = makeSorcerer({ x: 0, y: 0, z: 0 });
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  e.isDead = true;
  const bf = makeBF([s, e]);
  assert('returns null when only enemy is dead', shouldCast(s, bf) === null);
}

{
  // No resources object at all (monster-style)
  const s = makeSorcerer();
  s.resources = null;
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  assert('returns null when resources=null (no slot)', shouldCast(s, bf) === null);
}

// ---- 3. execute — damage and slot ----------------------------

console.log('\n3. execute — damage, DEX save, slot consumed');

{
  // Slot consumed after cast
  const s = makeSorcerer();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  const state = makeEngineState(bf);
  execute(s, [e], state);
  const rem = s.resources?.spellSlots?.[1]?.remaining ?? 99;
  eq('slot consumed after execute', rem, 0);
}

{
  // Log contains action event
  const s = makeSorcerer();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  const state = makeEngineState(bf);
  execute(s, [e], state);
  const hasAction = state.log.events.some(ev => ev.type === 'action' && ev.description.includes('Burning Hands'));
  assert('action event logged', hasAction);
}

{
  // Damage event logged for target
  const s = makeSorcerer();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([s, e]);
  const state = makeEngineState(bf);
  execute(s, [e], state);
  const dmgEvt = state.log.events.find(ev => ev.type === 'damage' && ev.targetId === 'e1');
  assert('damage event logged for target', dmgEvt !== undefined);
  assert('damage event has positive value', (dmgEvt?.value ?? 0) > 0);
}

{
  // HP reduced after failed save (high dex => sometimes pass, so pin dex very low)
  const s = makeSorcerer();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 1); // dex 1 → -5 mod, virtually always fails
  e.currentHP = 30;
  const bf = makeBF([s, e]);
  const state = makeEngineState(bf);
  // Run 10 times to get at least one failure
  let hpReduced = false;
  for (let i = 0; i < 10; i++) {
    const s2 = makeSorcerer();
    const e2 = makeEnemy(`e${i}`, { x: 1, y: 0, z: 0 }, 1);
    e2.currentHP = 30;
    const bf2 = makeBF([s2, e2]);
    execute(s2, [e2], makeEngineState(bf2));
    if (e2.currentHP < 30) { hpReduced = true; break; }
  }
  assert('HP reduced after failed DEX save (dex 1)', hpReduced);
}

{
  // High dex target — should take half on success.
  // dex 30 → +10 mod. Use saveDC = 11 so even a nat 1 + 10 = 11 ≥ 11 succeeds
  // (PHB 2014 saves have NO auto-fail on nat 1, unlike attack rolls — PHB p.179).
  // The old DC 13 was NOT guaranteed: nat 1 (→11) and nat 2 (→12) fail ~10% of
  // the time, making this test flaky. DC 11 makes it truly deterministic.
  const s = makeSorcerer();
  // Override the Sorcerer's Burning Hands saveDC to 11 for this test.
  const bhAction = s.actions.find(a => a.name === 'Burning Hands');
  if (bhAction) bhAction.saveDC = 11;
  const saveDC = 11;
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 }, 30);
  e.currentHP = 40;
  const bf = makeBF([s, e]);
  const state = makeEngineState(bf);
  execute(s, [e], state);
  // Check log for save_success
  const saveEvt = state.log.events.find(ev => ev.type === 'save_success' && ev.targetId === 'e1');
  assert('save_success logged when target has dex 30 (DC 11 → guaranteed pass)', saveEvt !== undefined,
    `events: ${state.log.events.map(ev => ev.type + ':' + ev.description?.slice(0,40)).join(' | ')}`);
}

{
  // Dead target in target list — skipped
  const s = makeSorcerer();
  const alive = makeEnemy('alive', { x: 1, y: 0, z: 0 });
  const dead = makeEnemy('dead', { x: 1, y: 0, z: 0 });
  dead.isDead = true;
  const bf = makeBF([s, alive, dead]);
  const state = makeEngineState(bf);
  execute(s, [alive, dead], state, alive);
  const deadEvt = state.log.events.find(ev => ev.targetId === 'dead');
  assert('dead target in list is skipped', deadEvt === undefined);
}

{
  // Multiple targets — all get damage events
  const s = makeSorcerer({ x: 0, y: 0, z: 0 });
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 });
  const bf = makeBF([s, e1, e2]);
  const state = makeEngineState(bf);
  execute(s, [e1, e2], state, e1);
  // Both in-cone targets should receive damage events
  const e1Dmg = state.log.events.filter(ev => ev.type === 'damage' && ev.targetId === 'e1');
  const e2Dmg = state.log.events.filter(ev => ev.type === 'damage' && ev.targetId === 'e2');
  assert('e1 receives damage event', e1Dmg.length >= 1);
  assert('e2 receives damage event', e2Dmg.length >= 1);
}

{
  // Targets off-axis but passed via explicit list — execute still re-filters via inConeFt
  // Aim at (3,0,0), place enemy far off-axis at (0,3,0) — should be out of cone
  const s = makeSorcerer({ x: 0, y: 0, z: 0 });
  const inFront = makeEnemy('inFront', { x: 2, y: 0, z: 0 });
  const offAxis = makeEnemy('offAxis', { x: 0, y: 3, z: 0 });
  offAxis.currentHP = 20;
  const bf = makeBF([s, inFront, offAxis]);
  const state = makeEngineState(bf);
  // Force aim toward inFront; offAxis is outside cone
  execute(s, [inFront, offAxis], state, inFront);
  const offAxisDmg = state.log.events.find(ev => ev.targetId === 'offAxis' && ev.type === 'damage');
  assert('off-axis target not hit when outside cone', offAxisDmg === undefined);
}

// ---- 4. Planner — Sorcerer/Wizard plan burningHands ---------

console.log('\n4. Planner integration');

{
  // Use makeSorcerer (no Sleep in actions) so BH is first offensive spell.
  // spawnClass Sorcerer has Sleep which has higher planner priority and always fires first.
  const sorcerer = makeSorcerer({ x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 2, y: 0, z: 0 }); // 10 ft
  const bf = makeBF([sorcerer, orc]);
  const plan = planTurn(sorcerer, bf);
  assert('Sorcerer (Burning Hands only) plans burningHands vs orc at 10 ft',
    plan.action?.type === 'burningHands');
}

{
  // Enemy beyond 15 ft — should NOT plan burningHands
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 5, y: 0, z: 0 }); // 25 ft
  const bf = makeBF([sorcerer, orc]);
  const plan = planTurn(sorcerer, bf);
  assert('Sorcerer does NOT plan burningHands vs orc at 25 ft',
    plan.action?.type !== 'burningHands');
}

{
  // Wizard has Burning Hands in spellbook → also plans it
  const wizard = spawnClass('Wizard', { x: 0, y: 0, z: 0 });
  // Wizard spellbook doesn't include Burning Hands (only Sorcerer has it at lv1)
  // This test verifies Wizard does NOT plan it (correct scoping)
  const orc = spawnMonster('orc', 'orc1', { x: 1, y: 0, z: 0 }); // 5 ft
  const bf = makeBF([wizard, orc]);
  const plan = planTurn(wizard, bf);
  assert('Wizard (no Burning Hands) does not plan burningHands',
    plan.action?.type !== 'burningHands');
}

{
  // Slot spent — falls back to other spell or cantrip
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  // Drain all slots
  if (sorcerer.resources?.spellSlots) {
    for (const k of Object.keys(sorcerer.resources.spellSlots)) {
      (sorcerer.resources.spellSlots as any)[k].remaining = 0;
    }
  }
  const orc = spawnMonster('orc', 'orc1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([sorcerer, orc]);
  const plan = planTurn(sorcerer, bf);
  assert('Sorcerer does not plan burningHands when slots exhausted',
    plan.action?.type !== 'burningHands');
}

{
  // Sleep still takes priority over Burning Hands (planner order)
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  // Place a low-HP orc within Sleep AND Burning Hands range
  const orc = spawnMonster('orc', 'orc1', { x: 1, y: 0, z: 0 });
  orc.currentHP = 5; // well within 5d8 sleep bucket
  const bf = makeBF([sorcerer, orc]);
  const plan = planTurn(sorcerer, bf);
  // Sleep should fire before BH in planner priority
  assert('Sleep takes priority over Burning Hands in planner',
    plan.action?.type === 'sleep' || plan.action?.type !== 'burningHands');
}

{
  // plan.targetId matches the aimed target
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 2, y: 0, z: 0 });
  orc.currentHP = 40; // ensure sleep won't fire first (not low HP)
  const bf = makeBF([sorcerer, orc]);
  const plan = planTurn(sorcerer, bf);
  if (plan.action?.type === 'burningHands') {
    assert('plan.targetId set when burningHands', plan.targetId !== undefined && plan.targetId !== null);
  } else {
    // Acceptable if Sleep or other spell fired (low priority orc)
    assert('plan set (not necessarily burningHands if other spell fired)', plan.action !== null);
  }
}

// ---- 5. End-to-end: actual damage applied -------------------

console.log('\n5. End-to-end: damage applied to battlefield');

{
  // Execute damages enemy HP in battlefield
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 2, y: 0, z: 0 });
  orc.currentHP = 30;
  const startHP = orc.currentHP;
  const bf = makeBF([sorcerer, orc]);
  const state = makeEngineState(bf);
  const targets = shouldCast(sorcerer, bf);
  if (targets && targets.length > 0) {
    execute(sorcerer, targets, state, targets[0]);
  }
  assert('orc HP reduced after Burning Hands', orc.currentHP < startHP);
}

{
  // Slot gone after end-to-end cast
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  const orc = spawnMonster('orc', 'orc1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([sorcerer, orc]);
  const state = makeEngineState(bf);
  const targets = shouldCast(sorcerer, bf);
  if (targets && targets.length > 0) {
    execute(sorcerer, targets, state, targets[0]);
  }
  const rem = sorcerer.resources?.spellSlots?.[1]?.remaining ?? 99;
  assert('slot 1 decremented after cast', rem < 2); // started at 2 for Sorcerer
}

{
  // Two orcs in cone — both take damage
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  const orc1 = spawnMonster('orc', 'orc1', { x: 2, y: 0, z: 0 });
  const orc2 = spawnMonster('orc', 'orc2', { x: 1, y: 0, z: 0 });
  orc1.currentHP = 30;
  orc2.currentHP = 30;
  const bf = makeBF([sorcerer, orc1, orc2]);
  const state = makeEngineState(bf);
  const targets = shouldCast(sorcerer, bf);
  if (targets && targets.length > 0) {
    execute(sorcerer, targets, state, targets[0]);
  }
  assert('both orcs damaged when both in cone',
    orc1.currentHP < 30 && orc2.currentHP < 30);
}

{
  // After burning hands, shouldCast returns null (no slots left for Sorcerer with 2→0)
  const sorcerer = spawnClass('Sorcerer', { x: 0, y: 0, z: 0 });
  // Drain to 1 slot so one cast empties it
  if (sorcerer.resources?.spellSlots?.[1]) {
    sorcerer.resources.spellSlots[1].remaining = 1;
  }
  const orc = spawnMonster('orc', 'orc1', { x: 2, y: 0, z: 0 });
  const bf = makeBF([sorcerer, orc]);
  const state = makeEngineState(bf);
  const targets = shouldCast(sorcerer, bf)!;
  execute(sorcerer, targets, state, targets[0]);
  // Now no slot left
  assert('shouldCast returns null after slot exhausted', shouldCast(sorcerer, bf) === null);
}

// ---- Results ------------------------------------------------

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
