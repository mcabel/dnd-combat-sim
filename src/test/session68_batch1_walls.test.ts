// ============================================================
// Test: Session 68 — Batch 1 monster spell modules
//
// Wall of Force   (PHB p.285): L5, 120 ft, NO save, conc — restrained
// Maze            (PHB p.261): L8, 60 ft,  NO save, NO conc — removed for encounter
// Wall of Ice     (PHB p.285): L6, 120 ft, DEX save 10d6 cold + conc damage_zone
// Wall of Stone   (PHB p.287): L5, 120 ft, DEX save 10d6 bludgeoning, conc
// Magic Circle    (PHB p.256): L3, 10 ft,  NO save, conc — advantage_vs (vs chosen type)
//
// Run: npx ts-node --transpile-only src/test/session68_batch1_walls.test.ts
// ============================================================

import {
  execute as executeWallOfForce, shouldCast as shouldCastWallOfForce, metadata as wofMeta,
} from '../spells/wall_of_force';
import {
  execute as executeMaze, shouldCast as shouldCastMaze, metadata as mazeMeta,
} from '../spells/maze';
import {
  execute as executeWallOfIce, shouldCast as shouldCastWallOfIce, metadata as woiMeta,
} from '../spells/wall_of_ice';
import {
  execute as executeWallOfStone, shouldCast as shouldCastWallOfStone, metadata as wosMeta,
} from '../spells/wall_of_stone';
import {
  execute as executeMagicCircle, shouldCast as shouldCastMagicCircle, metadata as mcMeta,
} from '../spells/magic_circle';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Action, PlayerResources, Condition, Vec3 } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos: { x: 1, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
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

function makeCaster(id: string, spellName: string, slotLevel: number, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    faction: 'party',
    actions: [{
      name: spellName, isMultiattack: false, attackType: 'save' as const,
      reach: 0, range: { normal: 120, long: 120 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 20, saveAbility: 'dex' as const,
      isAoE: false, isControl: true, requiresConcentration: true,
      slotLevel, costType: 'action' as const, legendaryCost: 0, description: spellName,
    }],
    resources: { spellSlots: { [slotLevel]: { max: 2, remaining: 2 } } } as any,
    ...overrides,
  });
}

function makeBF(combatants: Combatant[]): Battlefield {
  return {
    width: 20, height: 20, depth: 1, cells: [],
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1, initiativeOrder: combatants.map(c => c.id),
  } as any;
}
function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(), damageThisRound: new Map(),
    noDamageRounds: new Map(), rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ============================================================
console.log('\n=== Wall of Force — Metadata ===');
eq('name', wofMeta.name, 'Wall of Force');
eq('level 5', wofMeta.level, 5);
eq('concentration', wofMeta.concentration, true);
eq('school evocation', wofMeta.school, 'evocation');
eq('range 120', wofMeta.rangeFt, 120);
assert('no save flag', (wofMeta as any).wallOfForceNoSave === true);

console.log('\n=== Wall of Force — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Wall of Force', 5);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const farFoe = makeCombatant('far', { pos: { x: 30, y: 0, z: 0 } });
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const dead = makeCombatant('dead', { isDead: true, pos: { x: 1, y: 0, z: 0 } });
  const restrained = makeCombatant('r', { conditions: new Set<Condition>(['restrained']), pos: { x: 1, y: 0, z: 0 } });
  assert('picks nearby foe', shouldCastWallOfForce(caster, makeBF([caster, foe]))?.id === 'orc');
  assert('null when no slot', shouldCastWallOfForce({ ...caster, resources: { spellSlots: { 5: { max: 2, remaining: 0 } } } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when concentrating', shouldCastWallOfForce({ ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when no spell action', shouldCastWallOfForce({ ...caster, actions: [] } as Combatant, makeBF([caster, foe])) === null);
  assert('null when foe too far', shouldCastWallOfForce(caster, makeBF([caster, farFoe])) === null);
  assert('null when only ally', shouldCastWallOfForce(caster, makeBF([caster, ally])) === null);
  assert('null when only dead', shouldCastWallOfForce(caster, makeBF([caster, dead])) === null);
  assert('null when foe already restrained', shouldCastWallOfForce(caster, makeBF([caster, restrained])) === null);
  // picks highest-threat foe
  const big = makeCombatant('big', { maxHP: 500, currentHP: 500, pos: { x: 2, y: 0, z: 0 } });
  const small = makeCombatant('small', { maxHP: 5, currentHP: 5, pos: { x: 1, y: 0, z: 0 } });
  assert('picks higher HP threat', shouldCastWallOfForce(caster, makeBF([caster, big, small]))?.id === 'big');
}

console.log('\n=== Wall of Force — execute applies restrained ===');
{
  const caster = makeCaster('wiz', 'Wall of Force', 5);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeWallOfForce(caster, foe, state);
  assert('slot consumed', (caster.resources as any).spellSlots[5].remaining === 1);
  assert('caster concentrating on Wall of Force', caster.concentration?.spellName === 'Wall of Force');
  assert('foe restrained condition set', foe.conditions.has('restrained'));
  assert('foe has Wall of Force activeEffect', foe.activeEffects.some(e => e.spellName === 'Wall of Force' && e.effectType === 'condition_apply'));
  assert('effect is concentration-sourced', foe.activeEffects.some(e => e.spellName === 'Wall of Force' && e.sourceIsConcentration === true));
  assert('events logged (action + condition_add)', state.log.events.length >= 2);
}

console.log('\n=== Wall of Force — execute skips dead target ===');
{
  const caster = makeCaster('wiz', 'Wall of Force', 5);
  const dead = makeCombatant('dead', { isDead: true, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);
  executeWallOfForce(caster, dead, state);
  assert('no effect applied to dead', dead.activeEffects.length === 0);
  assert('slot still consumed', (caster.resources as any).spellSlots[5].remaining === 1);
}

// ============================================================
console.log('\n=== Maze — Metadata ===');
eq('name', mazeMeta.name, 'Maze');
eq('level 8', mazeMeta.level, 8);
eq('NO concentration', mazeMeta.concentration, false);
eq('school conjuration', mazeMeta.school, 'conjuration');
eq('range 60', mazeMeta.rangeFt, 60);

console.log('\n=== Maze — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Maze', 8);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const farFoe = makeCombatant('far', { pos: { x: 30, y: 0, z: 0 } });
  const dumbFoe = makeCombatant('beast', { int: 1, pos: { x: 1, y: 0, z: 0 } });
  const veryDumbFoe = makeCombatant('ooze', { int: 0, pos: { x: 1, y: 0, z: 0 } });
  assert('picks nearby foe', shouldCastMaze(caster, makeBF([caster, foe]))?.id === 'orc');
  assert('null when no slot', shouldCastMaze({ ...caster, resources: { spellSlots: { 8: { max: 2, remaining: 0 } } } as any } as Combatant, makeBF([caster, foe])) === null);
  // Maze is NOT concentration — should NOT be gated by active concentration
  const concCaster = { ...caster, concentration: { active: true, spellName: 'Other' } as any } as Combatant;
  assert('NOT gated by concentration', shouldCastMaze(concCaster, makeBF([concCaster, foe]))?.id === 'orc');
  assert('null when foe too far (> 60 ft)', shouldCastMaze(caster, makeBF([caster, farFoe])) === null);
  assert('null when Int ≤ 1 (immune)', shouldCastMaze(caster, makeBF([caster, dumbFoe])) === null);
  assert('null when Int 0 (immune)', shouldCastMaze(caster, makeBF([caster, veryDumbFoe])) === null);
}

console.log('\n=== Maze — execute removes target from combat ===');
{
  const caster = makeCaster('wiz', 'Maze', 8);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeMaze(caster, foe, state);
  assert('slot consumed', (caster.resources as any).spellSlots[8].remaining === 1);
  assert('NO concentration started (Maze is not conc)', caster.concentration === null);
  assert('target isDead (removed from combat)', foe.isDead === true);
  eq('target HP 0', foe.currentHP, 0);
  assert('events logged', state.log.events.length >= 2);
  assert('death event logged', state.log.events.some(e => e.type === 'death'));
}

console.log('\n=== Maze — execute skips Int ≤ 1 (safety) ===');
{
  const caster = makeCaster('wiz', 'Maze', 8);
  const dumb = makeCombatant('beast', { int: 1, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, dumb]);
  const state = makeState(bf);
  executeMaze(caster, dumb, state);
  assert('target NOT removed (immune)', dumb.isDead === false);
  assert('slot still consumed', (caster.resources as any).spellSlots[8].remaining === 1);
  assert('log notes immunity', state.log.events.some(e => e.description.includes('Int ≤ 1')));
}

// ============================================================
console.log('\n=== Wall of Ice — Metadata ===');
eq('name', woiMeta.name, 'Wall of Ice');
eq('level 6', woiMeta.level, 6);
eq('concentration', woiMeta.concentration, true);
eq('save dex', woiMeta.saveAbility, 'dex');
eq('range 120', woiMeta.rangeFt, 120);

console.log('\n=== Wall of Ice — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Wall of Ice', 6);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const farFoe = makeCombatant('far', { pos: { x: 30, y: 0, z: 0 } });
  assert('picks nearby foe', shouldCastWallOfIce(caster, makeBF([caster, foe]))?.id === 'orc');
  assert('null when no slot', shouldCastWallOfIce({ ...caster, resources: { spellSlots: { 6: { max: 2, remaining: 0 } } } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when concentrating', shouldCastWallOfIce({ ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when foe too far', shouldCastWallOfIce(caster, makeBF([caster, farFoe])) === null);
}

console.log('\n=== Wall of Ice — execute deals damage + ongoing zone ===');
{
  const caster = makeCaster('wiz', 'Wall of Ice', 6);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 }, dex: 1 });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeWallOfIce(caster, foe, state);
  assert('slot consumed', (caster.resources as any).spellSlots[6].remaining === 1);
  assert('caster concentrating on Wall of Ice', caster.concentration?.spellName === 'Wall of Ice');
  assert('foe took damage', foe.currentHP < 100);
  assert('foe has damage_zone effect', foe.activeEffects.some(e => e.spellName === 'Wall of Ice' && e.effectType === 'damage_zone'));
  const zone = foe.activeEffects.find(e => e.spellName === 'Wall of Ice' && e.effectType === 'damage_zone');
  assert('zone payload: 5d6 cold', zone?.payload.dieCount === 5 && zone?.payload.dieSides === 6 && zone?.payload.damageType === 'cold');
  assert('zone payload: save DC + dex', zone?.payload.saveDC === 20 && zone?.payload.saveAbility === 'dex');
  assert('zone is concentration-sourced', zone?.sourceIsConcentration === true);
}

// ============================================================
console.log('\n=== Wall of Stone — Metadata ===');
eq('name', wosMeta.name, 'Wall of Stone');
eq('level 5', wosMeta.level, 5);
eq('concentration', wosMeta.concentration, true);
eq('save dex', wosMeta.saveAbility, 'dex');
eq('range 120', wosMeta.rangeFt, 120);

console.log('\n=== Wall of Stone — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Wall of Stone', 5);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const farFoe = makeCombatant('far', { pos: { x: 30, y: 0, z: 0 } });
  assert('picks nearby foe', shouldCastWallOfStone(caster, makeBF([caster, foe]))?.id === 'orc');
  assert('null when no slot', shouldCastWallOfStone({ ...caster, resources: { spellSlots: { 5: { max: 2, remaining: 0 } } } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when concentrating', shouldCastWallOfStone({ ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when foe too far', shouldCastWallOfStone(caster, makeBF([caster, farFoe])) === null);
}

console.log('\n=== Wall of Stone — execute deals bludgeoning damage ===');
{
  const caster = makeCaster('wiz', 'Wall of Stone', 5);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 }, dex: 1 });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeWallOfStone(caster, foe, state);
  assert('slot consumed', (caster.resources as any).spellSlots[5].remaining === 1);
  assert('caster concentrating on Wall of Stone', caster.concentration?.spellName === 'Wall of Stone');
  assert('foe took damage (bludgeoning)', foe.currentHP < 100);
  // Wall of Stone v1: instantaneous damage — no persistent effect
  assert('NO persistent effect', !foe.activeEffects.some(e => e.spellName === 'Wall of Stone'));
}

// ============================================================
console.log('\n=== Magic Circle — Metadata ===');
eq('name', mcMeta.name, 'Magic Circle');
eq('level 3', mcMeta.level, 3);
eq('concentration', mcMeta.concentration, true);
eq('school abjuration', mcMeta.school, 'abjuration');
eq('range 10', mcMeta.rangeFt, 10);

console.log('\n=== Magic Circle — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Magic Circle', 3);
  const fiend = makeCombatant('imp', { creatureType: 'fiend', pos: { x: 1, y: 0, z: 0 } });
  const fey = makeCombatant('pixie', { creatureType: 'fey', pos: { x: 1, y: 0, z: 0 } });
  const undead = makeCombatant('zombie', { creatureType: 'undead', pos: { x: 1, y: 0, z: 0 } });
  const humanoid = makeCombatant('guard', { creatureType: 'humanoid', pos: { x: 1, y: 0, z: 0 } });
  const farFiend = makeCombatant('farimp', { creatureType: 'fiend', pos: { x: 5, y: 0, z: 0 } });
  assert('picks nearby fiend', shouldCastMagicCircle(caster, makeBF([caster, fiend]))?.id === 'imp');
  assert('picks nearby fey', shouldCastMagicCircle(caster, makeBF([caster, fey]))?.id === 'pixie');
  assert('picks nearby undead', shouldCastMagicCircle(caster, makeBF([caster, undead]))?.id === 'zombie');
  assert('null vs humanoid (not an affected type)', shouldCastMagicCircle(caster, makeBF([caster, humanoid])) === null);
  assert('null when no affected-type enemy in range', shouldCastMagicCircle(caster, makeBF([caster, farFiend])) === null);
  assert('null when no slot', shouldCastMagicCircle({ ...caster, resources: { spellSlots: { 3: { max: 2, remaining: 0 } } } as any } as Combatant, makeBF([caster, fiend])) === null);
  assert('null when concentrating', shouldCastMagicCircle({ ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant, makeBF([caster, fiend])) === null);
}

console.log('\n=== Magic Circle — execute applies advantage_vs ===');
{
  const caster = makeCaster('wiz', 'Magic Circle', 3);
  const fiend = makeCombatant('imp', { creatureType: 'fiend', pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, fiend]);
  const state = makeState(bf);
  executeMagicCircle(caster, fiend, state);
  assert('slot consumed', (caster.resources as any).spellSlots[3].remaining === 1);
  assert('caster concentrating on Magic Circle', caster.concentration?.spellName === 'Magic Circle');
  assert('fiend has advantage_vs effect', fiend.activeEffects.some(e => e.spellName === 'Magic Circle' && e.effectType === 'advantage_vs'));
  const eff = fiend.activeEffects.find(e => e.spellName === 'Magic Circle');
  assert('advType=advantage', eff?.payload.advType === 'advantage');
  assert('effect is concentration-sourced', eff?.sourceIsConcentration === true);
}

console.log('\n=== Magic Circle — execute skips dead target ===');
{
  const caster = makeCaster('wiz', 'Magic Circle', 3);
  const deadFiend = makeCombatant('dimp', { creatureType: 'fiend', isDead: true, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, deadFiend]);
  const state = makeState(bf);
  executeMagicCircle(caster, deadFiend, state);
  assert('no effect applied to dead', deadFiend.activeEffects.length === 0);
  assert('slot still consumed', (caster.resources as any).spellSlots[3].remaining === 1);
}

// ============================================================
console.log(`\n==================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nsession68_batch1_walls.test.ts: ${failed} TESTS FAILED ❌`);
  process.exit(1);
}
console.log(`\nsession68_batch1_walls.test.ts: all tests passed ✅`);
