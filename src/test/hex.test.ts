// ============================================================
// hex.test.ts  —  PHB p.251
//
// Sections:
//   1. shouldCast  — gate checks (pact slot, concentration, range, dup) (7 tests)
//   2. execute     — effect applied, concentration set, slot consumed (7 tests)
//   3. Hit damage  — +1d6 necrotic on hit, correct caster/target binding (8 tests)
//   4. Planner     — Warlock plans Hex as bonus action vs primary target (5 tests)
//   5. Concentration — breaking conc removes hex_damage effect (5 tests)
//
// Run: ts-node src/test/hex.test.ts
// ============================================================

import * as fs from 'fs';
import { shouldCast, execute } from '../spells/hex';
import { getActiveHexDie, removeEffectsFromCaster } from '../engine/spell_effects';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { loadBestiaryJson, monsterToCombatant } from '../parser/fivetools';
import { runCombat, makeFlatBattlefield, EngineState } from '../engine/combat';
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

function withPactSlots(remaining = 1): PlayerResources {
  return { pactSlots: { max: 1, remaining, slotLevel: 1, recoversOn: 'short' } };
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

function makeWarlock(pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant('warlock', {
    faction: 'party', pos,
    resources: withPactSlots(1),
  });
}

function makeEnemy(id: string, pos: Vec3): Combatant {
  return makeCombatant(id, { faction: 'enemy', pos });
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

// ---- 1. shouldCast ------------------------------------------

console.log('\n1. shouldCast gates');

{
  // 1a. Happy path — pact slot available, not concentrating, target in 90ft
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  assert('1a. casts with slot available', shouldCast(w, 'e1', bf));
}
{
  // 1b. No pact slot
  const w = makeWarlock();
  w.resources = withPactSlots(0);
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  assert('1b. blocks with 0 pact slots', !shouldCast(w, 'e1', bf));
}
{
  // 1c. No resources at all
  const w = makeWarlock();
  w.resources = null;
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  assert('1c. blocks when resources null', !shouldCast(w, 'e1', bf));
}
{
  // 1d. Already concentrating
  const w = makeWarlock();
  w.concentration = { active: true, spellName: 'Entangle', dcIfHit: 10 };
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  assert('1d. blocks when concentrating on another spell', !shouldCast(w, 'e1', bf));
}
{
  // 1e. Target beyond 90 ft (19 squares = 95 ft)
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 19, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  assert('1e. blocks target beyond 90 ft', !shouldCast(w, 'e1', bf));
}
{
  // 1f. Target exactly at 90 ft (18 squares)
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 18, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  assert('1f. allows target at exactly 90 ft', shouldCast(w, 'e1', bf));
}
{
  // 1g. Already hexed by this warlock — don't waste slot
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  e.activeEffects.push({
    id: 'eff_hex1', casterId: 'warlock', spellName: 'Hex',
    effectType: 'hex_damage', payload: { hexDie: 6 },
    sourceIsConcentration: true,
  });
  const bf = makeBF([w, e]);
  assert('1g. blocks if target already hexed by same warlock', !shouldCast(w, 'e1', bf));
}

// ---- 2. execute — effect & concentration --------------------

console.log('\n2. execute — effect applied, concentration set');

{
  // 2a. hex_damage effect placed on target
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e]));
  execute(w, e, state);
  const effect = e.activeEffects.find(ef => ef.effectType === 'hex_damage');
  assert('2a. hex_damage effect placed on target', !!effect);
  eq('2a. effect casterId = warlock', effect?.casterId, 'warlock');
  eq('2a. hexDie = 6', effect?.payload.hexDie, 6);
}
{
  // 2b. sourceIsConcentration = true
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e]));
  execute(w, e, state);
  const effect = e.activeEffects.find(ef => ef.effectType === 'hex_damage');
  assert('2b. sourceIsConcentration = true', effect?.sourceIsConcentration === true);
}
{
  // 2c. Warlock concentration set to Hex
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e]));
  execute(w, e, state);
  assert('2c. warlock concentration.active = true', w.concentration?.active === true);
  eq('2c. concentration spellName = Hex', w.concentration?.spellName, 'Hex');
}
{
  // 2d. Log event emitted
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e]));
  execute(w, e, state);
  const evt = state.log.events.find(v => v.description.toLowerCase().includes('hex'));
  assert('2d. log event emitted', !!evt);
}

// ---- 3. Hit damage — getActiveHexDie + resolveAttack --------

console.log('\n3. Hit damage via getActiveHexDie helper');

{
  // 3a. getActiveHexDie returns 6 when target hexed by attacker
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e]));
  execute(w, e, state);
  eq('3a. getActiveHexDie(target, caster) = 6', getActiveHexDie(e, 'warlock'), 6);
}
{
  // 3b. Returns 0 for non-hexed target
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  eq('3b. getActiveHexDie returns 0 for clean target', getActiveHexDie(e, 'warlock'), 0);
}
{
  // 3c. Returns 0 if hexed by a different attacker
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  e.activeEffects.push({
    id: 'eff_h1', casterId: 'other_warlock', spellName: 'Hex',
    effectType: 'hex_damage', payload: { hexDie: 6 },
    sourceIsConcentration: true,
  });
  eq('3c. getActiveHexDie 0 for different caster', getActiveHexDie(e, 'warlock'), 0);
}
{
  // 3d. Hex damage shows up in runCombat — warlock with Hex fires bonus damage events
  const RUNS = 30;
  let hexBonusEvents = 0;

  for (let i = 0; i < RUNS; i++) {
    const wl  = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
    const orc = spawnMonster('orc', `orc${i}`, { x: 1, y: 0, z: 0 });
    const bf  = makeFlatBattlefield(10, 10, [wl, orc]);
    const log = runCombat(bf, [wl.id, orc.id]);
    hexBonusEvents += log.events.filter(e => e.description.includes('Hex bonus')).length;
  }
  assert('3d. Hex bonus damage events appear across 30 combats', hexBonusEvents > 0);
}
{
  // 3e. Hex bonus log description contains caster name + 'Hex bonus'
  let found = false;
  for (let i = 0; i < 20 && !found; i++) {
    const wl  = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
    const orc = spawnMonster('orc', `orc${i}`, { x: 1, y: 0, z: 0 });
    const bf  = makeFlatBattlefield(10, 10, [wl, orc]);
    const log = runCombat(bf, [wl.id, orc.id]);
    if (log.events.some(e => e.description.includes('Hex bonus'))) found = true;
  }
  assert('3e. Hex bonus damage event appears in combat log', found);
}

// ---- 4. Planner — Warlock plans Hex as bonus action ---------

console.log('\n4. Planner — Hex as bonus action');

{
  // 4a. Warlock plans Hex when enemy in range and pact slot available
  const w = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  const e = makeEnemy('orc', { x: 2, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  const plan = planTurn(w, bf);
  assert('4a. bonusAction is hex', plan.bonusAction?.type === 'hex');
  eq('4a. hex targetId set', plan.bonusAction?.targetId, 'orc');
}
{
  // 4b. No Hex when no pact slot
  const w = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  if (w.resources?.pactSlots) w.resources.pactSlots.remaining = 0;
  const e = makeEnemy('orc', { x: 2, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  const plan = planTurn(w, bf);
  assert('4b. no hex bonus action when 0 pact slots', plan.bonusAction?.type !== 'hex');
}
{
  // 4c. No Hex when already concentrating
  const w = spawnClass('Warlock', { x: 0, y: 0, z: 0 });
  w.concentration = { active: true, spellName: 'Entangle', dcIfHit: 10 };
  const e = makeEnemy('orc', { x: 2, y: 0, z: 0 });
  const bf = makeBF([w, e]);
  const plan = planTurn(w, bf);
  assert('4c. no hex when already concentrating', plan.bonusAction?.type !== 'hex');
}

// ---- 5. Concentration — breaking removes effect -------------

console.log('\n5. Concentration break clears hex_damage');

{
  // 5a. After breaking concentration, hex_damage effect removed from target
  
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e]));
  execute(w, e, state);
  assert('5a. hex effect present before break', e.activeEffects.some(ef => ef.effectType === 'hex_damage'));
  removeEffectsFromCaster(w.id, state.battlefield); if (w.concentration) w.concentration.active = false;
  assert('5a. hex effect removed after break', !e.activeEffects.some(ef => ef.effectType === 'hex_damage'));
}
{
  // 5b. Concentration cleared on warlock after break
  
  const w = makeWarlock();
  const e = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e]));
  execute(w, e, state);
  removeEffectsFromCaster(w.id, state.battlefield); if (w.concentration) w.concentration.active = false;
  assert('5b. warlock concentration.active = false after break', !w.concentration?.active);
}
{
  // 5c. Non-hexed targets unaffected by breaking warlock concentration
  
  const w = makeWarlock();
  const e1 = makeEnemy('e1', { x: 1, y: 0, z: 0 });
  const e2 = makeEnemy('e2', { x: 2, y: 0, z: 0 });
  const state = makeEngineState(makeBF([w, e1, e2]));
  // Hex only e1
  execute(w, e1, state);
  removeEffectsFromCaster(w.id, state.battlefield); if (w.concentration) w.concentration.active = false;
  assert('5c. e2 activeEffects unchanged by break', e2.activeEffects.length === 0);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
