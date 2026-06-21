// mage_armor.test.ts — PHB p.256
// 1. shouldCast gates (5 tests)
// 2. execute — AC boost, slot consumed, effect applied (7 tests)
// 3. Planner — Wizard casts on turn 1, doesn't re-cast (5 tests)
// 4. Engine integration — AC appears in combat (4 tests)

import * as fs from 'fs';
import { shouldCast, execute } from '../spells/mage_armor';
import { getActiveAcBonus } from '../engine/spell_effects';
import { planTurn } from '../ai/planner';
import { spawnPC, loadPCStatBlocks } from '../parser/pc';
import { runCombat, makeFlatBattlefield, EngineState } from '../engine/combat';
import { Combatant, Battlefield, Vec3 } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeBase(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'c1', name: 'c1', isPlayer: true, faction: 'party',
    maxHP: 30, currentHP: 30, ac: 13, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 8, dex: 16, con: 13, int: 16, wis: 12, cha: 10, cr: 0,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(), aiProfile: 'aggressive' as any,
    perception: { targets: new Map() } as any,
    concentration: null, deathSaves: null, tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    resources: { spellSlots: { 1: { max: 2, remaining: 2 } } },
    ...overrides,
  };
}

function makeBF(cs: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  cs.forEach(c => map.set(c.id, c));
  return { combatants: map, round: 1, initiativeOrder: cs.map(c => c.id),
    obstacles: [], width: 10, height: 10, depth: 1, cells: [] } as unknown as Battlefield;
}

function makeState(bf: Battlefield): EngineState {
  return { battlefield: bf, log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(), damageThisRound: new Map(),
    noDamageRounds: new Map(), rageDamagedSinceLastTurn: new Set() };
}

const rawPCs = JSON.parse(fs.readFileSync('pc_stat_blocks_lv1.json', 'utf8'));
const pcMap  = loadPCStatBlocks(rawPCs);
function spawn(cls: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnPC(pcMap, cls, pos);
  if (!c) throw new Error(`Unknown: ${cls}`);
  return c;
}

// ---- 1. shouldCast gates ------------------------------------
console.log('\n1. shouldCast');

{
  const c = makeBase();
  assert('1a. cast when unarmored + slot + gain', shouldCast(c, makeBF([c])));
}
{
  const c = makeBase({ wearingArmor: true });
  assert('1b. block when wearing armor', !shouldCast(c, makeBF([c])));
}
{
  const c = makeBase({ resources: { spellSlots: { 1: { max: 2, remaining: 0 } } } });
  assert('1c. block when 0 slots', !shouldCast(c, makeBF([c])));
}
{
  // Sorcerer Draconic Resilience: 13+DEX already → no gain
  const c = makeBase({ ac: 16, dex: 16 }); // 13+3=16 = current AC
  assert('1d. block when no AC gain (Sorcerer)', !shouldCast(c, makeBF([c])));
}
{
  // Already under Mage Armor
  const c = makeBase();
  c.activeEffects.push({ id: 'e1', casterId: c.id, spellName: 'Mage Armor',
    effectType: 'ac_bonus', payload: { acBonus: 3 }, sourceIsConcentration: false });
  assert('1e. block when already active', !shouldCast(c, makeBF([c])));
}

// ---- 2. execute —AC, slot, effect ---------------------------
console.log('\n2. execute');

{
  const c = makeBase(); // DEX 16 (+3), AC 13 → Mage Armor = 16 (+3)
  const bf = makeBF([c]);
  const state = makeState(bf);
  execute(c, state);

  eq('2a. slot consumed', c.resources!.spellSlots![1].remaining, 1);
  const bonus = getActiveAcBonus(c);
  eq('2b. ac_bonus = +3', bonus, 3);
  assert('2c. effect spellName = Mage Armor',
    c.activeEffects.some(e => e.spellName === 'Mage Armor'));
  assert('2d. sourceIsConcentration = false',
    c.activeEffects.every(e => e.spellName !== 'Mage Armor' || !e.sourceIsConcentration));
  assert('2e. log event emitted', state.log.events.some(e => e.description.includes('Mage Armor')));
}
{
  // DEX 14 (+2), AC 10 unarmored → bonus = (13+2)-10 = +5
  const c = makeBase({ dex: 14, ac: 10 });
  const state = makeState(makeBF([c]));
  execute(c, state);
  eq('2f. ac_bonus = +5 for DEX 14, AC 10', getActiveAcBonus(c), 5);
}
{
  // Concentration NOT set
  const c = makeBase();
  execute(c, makeState(makeBF([c])));
  assert('2g. concentration not set', c.concentration === null);
}

// ---- 3. Planner ---------------------------------------------
console.log('\n3. Planner');

{
  // 3a. Wizard plans mageArmor when no higher-priority spell is available
  const wiz = spawn('Wizard', { x: 0, y: 0, z: 0 });
  // Remove offensive spells so Mage Armor is the best available action
  wiz.actions = wiz.actions.filter(a => !['Sleep', 'Thunderwave', 'Magic Missile'].includes(a.name));
  const orc = makeBase({ id: 'orc', faction: 'enemy', pos: { x: 2, y: 0, z: 0 } });
  const plan = planTurn(wiz, makeBF([wiz, orc]));
  assert('3a. Wizard action = mageArmor (no offensive spells)', plan.action?.type === 'mageArmor');
}
{
  // 3b. After Mage Armor active, doesn't recast
  const wiz = spawn('Wizard', { x: 0, y: 0, z: 0 });
  wiz.activeEffects.push({ id: 'e1', casterId: wiz.id, spellName: 'Mage Armor',
    effectType: 'ac_bonus', payload: { acBonus: 3 }, sourceIsConcentration: false });
  const orc = makeBase({ id: 'orc', faction: 'enemy', pos: { x: 2, y: 0, z: 0 } });
  const plan = planTurn(wiz, makeBF([wiz, orc]));
  assert('3b. no recast when already active', plan.action?.type !== 'mageArmor');
}
{
  // 3c. Fighter (wearing armor) never casts Mage Armor
  const fi = spawn('Fighter', { x: 0, y: 0, z: 0 });
  const orc = makeBase({ id: 'orc', faction: 'enemy', pos: { x: 2, y: 0, z: 0 } });
  const plan = planTurn(fi, makeBF([fi, orc]));
  assert('3c. Fighter never plans mageArmor', plan.action?.type !== 'mageArmor');
}
{
  // 3d. Sorcerer (Draconic Resilience, no gain) skips
  const sor = spawn('Sorcerer', { x: 0, y: 0, z: 0 });
  const orc = makeBase({ id: 'orc', faction: 'enemy', pos: { x: 2, y: 0, z: 0 } });
  const plan = planTurn(sor, makeBF([sor, orc]));
  assert('3d. Sorcerer skips mageArmor (no gain)', plan.action?.type !== 'mageArmor');
}
{
  // 3e. No slot → no mageArmor
  const wiz = spawn('Wizard', { x: 0, y: 0, z: 0 });
  wiz.resources!.spellSlots![1].remaining = 0;
  const orc = makeBase({ id: 'orc', faction: 'enemy', pos: { x: 2, y: 0, z: 0 } });
  const plan = planTurn(wiz, makeBF([wiz, orc]));
  assert('3e. no mageArmor without slot', plan.action?.type !== 'mageArmor');
}

// ---- 4. Engine integration ----------------------------------
console.log('\n4. Engine integration');

{
  // 4a. Mage Armor event appears in combat log (filter offensive spells so MA fires)
  const wiz = spawn('Wizard', { x: 0, y: 0, z: 0 });
  wiz.actions = wiz.actions.filter(a => !['Sleep','Thunderwave','Magic Missile'].includes(a.name));
  const orc = makeBase({ id: 'orc', name: 'Orc', faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 }, ac: 13, maxHP: 15, currentHP: 15 });
  const bf = makeFlatBattlefield(10, 10, [wiz, orc]);
  const log = runCombat(bf, [wiz.id, orc.id]);
  assert('4a. Mage Armor event in log', log.events.some(e => e.description?.includes('Mage Armor')));
}
{
  // 4b. Only 1 Mage Armor cast per combat (no spamming)
  const wiz = spawn('Wizard', { x: 0, y: 0, z: 0 });
  const orc = makeBase({ id: 'orc', name: 'Orc', faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 }, ac: 13, maxHP: 15, currentHP: 15 });
  const bf = makeFlatBattlefield(10, 10, [wiz, orc]);
  const log = runCombat(bf, [wiz.id, orc.id]);
  const casts = log.events.filter(e => e.description.includes('Mage Armor')).length;
  assert('4b. cast at most once', casts <= 1);
}
{
  // 4c. wearingArmor correctly false for Wizard, true for Fighter
  const wiz = spawn('Wizard');
  const fi  = spawn('Fighter');
  assert('4c. Wizard.wearingArmor = false', wiz.wearingArmor === false);
  assert('4c. Fighter.wearingArmor = true',  fi.wearingArmor === true);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
