// ============================================================
// Test: Session 68 — Batch 4 monster spell modules
//
// Plane Shift   (PHB p.266): L7, 5ft, CHA save, NO conc — banish (removed for encounter)
// Teleport      (PHB p.281): L7, self, NO save, NO conc — self-escape (mirrors Dimension Door)
// Animate Dead  (PHB p.213): L3, 10ft, NO save, NO conc — spawn skeleton
//
// Run: npx ts-node --transpile-only src/test/session68_batch4_spells.test.ts
// ============================================================

import {
  execute as executePlaneShift, shouldCast as shouldCastPlaneShift, metadata as psMeta,
} from '../spells/plane_shift';
import {
  execute as executeTeleport, shouldCast as shouldCastTeleport, metadata as tpMeta,
} from '../spells/teleport';
import {
  execute as executeAnimateDead, shouldCast as shouldCastAnimateDead, metadata as adMeta,
  createSkeleton,
} from '../spells/animate_dead';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Action, Condition } from '../types/core';

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
      damage: null, damageType: null, saveDC: 20, saveAbility: 'cha' as const,
      isAoE: false, isControl: true, requiresConcentration: false,
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
// === PLANE SHIFT ===
// ============================================================
console.log('\n=== Plane Shift — Metadata ===');
eq('name', psMeta.name, 'Plane Shift');
eq('level 7', psMeta.level, 7);
eq('NO concentration', psMeta.concentration, false);
eq('school conjuration', psMeta.school, 'conjuration');
eq('range 5 (touch)', psMeta.rangeFt, 5);
eq('save cha', psMeta.saveAbility, 'cha');
assert('travel mode NOT implemented flag', (psMeta as any).planeShiftTravelModeV1Implemented === false);
assert('melee spell attack simplified flag', (psMeta as any).planeShiftMeleeSpellAttackV1Simplified === true);
assert('permanent removal v1 flag', (psMeta as any).planeShiftPermanentRemovalV1Implemented === true);

console.log('\n=== Plane Shift — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Plane Shift', 7, { pos: { x: 5, y: 5, z: 0 } });
  const foeAdjacent = makeCombatant('orc', { pos: { x: 5, y: 6, z: 0 } });    // 5 ft away (adjacent)
  const foeFar = makeCombatant('far', { pos: { x: 10, y: 10, z: 0 } });        // >5 ft away
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 5, y: 6, z: 0 } });
  const deadFoe = makeCombatant('dead', { isDead: true, pos: { x: 5, y: 6, z: 0 } });

  // Picks adjacent foe
  assert('picks adjacent foe', shouldCastPlaneShift(caster, makeBF([caster, foeAdjacent]))?.id === 'orc');
  // null when no foe in 5 ft (only far foe)
  assert('null when foe too far (> 5 ft)', shouldCastPlaneShift(caster, makeBF([caster, foeFar])) === null);
  // null when only ally in 5 ft
  assert('null when only ally in 5 ft', shouldCastPlaneShift(caster, makeBF([caster, ally])) === null);
  // null when only dead foe
  assert('null when only dead foe', shouldCastPlaneShift(caster, makeBF([caster, deadFoe])) === null);
  // null when no slot
  const noSlot = { ...caster, resources: { spellSlots: { 7: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastPlaneShift(noSlot, makeBF([noSlot, foeAdjacent])) === null);
  // null when no spell action
  const noAction = { ...caster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastPlaneShift(noAction, makeBF([noAction, foeAdjacent])) === null);
  // NOT concentration-gated (Plane Shift is instantaneous)
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('NOT gated by concentration', shouldCastPlaneShift(concCaster, makeBF([concCaster, foeAdjacent]))?.id === 'orc');
  // picks highest-threat foe (highest maxHP)
  const big = makeCombatant('big', { maxHP: 500, currentHP: 500, pos: { x: 5, y: 6, z: 0 } });
  const small = makeCombatant('small', { maxHP: 5, currentHP: 5, pos: { x: 6, y: 5, z: 0 } });
  assert('picks higher HP threat', shouldCastPlaneShift(caster, makeBF([caster, big, small]))?.id === 'big');
}

console.log('\n=== Plane Shift — shouldCast skips foes already banished by this caster ===');
{
  const caster = makeCaster('wiz', 'Plane Shift', 7, { pos: { x: 5, y: 5, z: 0 } });
  const alreadyBanished = makeCombatant('ban', { pos: { x: 5, y: 6, z: 0 },
    activeEffects: [{ id: 'x', casterId: 'wiz', spellName: 'Plane Shift', effectType: 'condition_apply',
      payload: {}, sourceIsConcentration: false } as any] });
  const fresh = makeCombatant('fresh', { pos: { x: 6, y: 5, z: 0 } });
  // Should skip the already-banished foe and pick the fresh one
  assert('skips already-banished foe', shouldCastPlaneShift(caster, makeBF([caster, alreadyBanished, fresh]))?.id === 'fresh');
}

console.log('\n=== Plane Shift — execute with guaranteed fail (DC 30 vs CHA 1) ===');
{
  const caster = makeCaster('wiz', 'Plane Shift', 7, {
    pos: { x: 5, y: 5, z: 0 },
    actions: [{
      name: 'Plane Shift', isMultiattack: false, attackType: 'save' as const,
      reach: 0, range: { normal: 5, long: 5 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 30, saveAbility: 'cha' as const,
      isAoE: false, isControl: true, requiresConcentration: false,
      slotLevel: 7, costType: 'action' as const, legendaryCost: 0, description: 'Plane Shift',
    }],
  });
  const foe = makeCombatant('orc', { pos: { x: 5, y: 6, z: 0 }, cha: 1 });   // CHA 1 → -5 mod, max total 15 < DC 30
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executePlaneShift(caster, foe, state);
  assert('slot consumed', (caster.resources as any).spellSlots[7].remaining === 1);
  assert('NOT concentrating (Plane Shift is instantaneous)', caster.concentration === null);
  assert('save failed (DC 30 vs CHA 1)', state.log.events.some(e => e.type === 'save_fail'));
  assert('foe isDead = true (banished)', foe.isDead === true);
  eq('foe currentHP 0', foe.currentHP, 0);
  assert('death event logged', state.log.events.some(e => e.type === 'death' && e.actorId === 'orc'));
  assert('log mentions banished', state.log.events.some(e => e.description.includes('BANISHED')));
  assert('log mentions NO concentration', state.log.events.some(e => e.description.includes('NO concentration')));
}

console.log('\n=== Plane Shift — execute with guaranteed success (DC 1 vs CHA 20) ===');
{
  const caster = makeCaster('wiz', 'Plane Shift', 7, {
    pos: { x: 5, y: 5, z: 0 },
    actions: [{
      name: 'Plane Shift', isMultiattack: false, attackType: 'save' as const,
      reach: 0, range: { normal: 5, long: 5 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 1, saveAbility: 'cha' as const,
      isAoE: false, isControl: true, requiresConcentration: false,
      slotLevel: 7, costType: 'action' as const, legendaryCost: 0, description: 'Plane Shift',
    }],
  });
  const foe = makeCombatant('orc', { pos: { x: 5, y: 6, z: 0 }, cha: 20 });  // CHA 20 → +5 mod, min total 6 > DC 1
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executePlaneShift(caster, foe, state);
  assert('slot consumed', (caster.resources as any).spellSlots[7].remaining === 1);
  assert('save succeeded (DC 1 vs CHA 20)', state.log.events.some(e => e.type === 'save_success'));
  assert('foe NOT dead (resisted)', foe.isDead === false);
  eq('foe currentHP unchanged', foe.currentHP, 100);
  assert('log mentions resists', state.log.events.some(e => e.description.includes('resists')));
}

console.log('\n=== Plane Shift — execute handles random save (both branches) ===');
{
  // Standard DC 20 vs CHA 10 (mod 0) — 50/50 outcome
  const caster = makeCaster('wiz', 'Plane Shift', 7, { pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 5, y: 6, z: 0 }, cha: 10 });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executePlaneShift(caster, foe, state);
  const hasFail = state.log.events.some(e => e.type === 'save_fail');
  const hasSuccess = state.log.events.some(e => e.type === 'save_success');
  assert('save rolled (fail or success logged)', hasFail || hasSuccess);
  if (hasFail) {
    assert('foe isDead on fail', foe.isDead === true);
  } else {
    assert('foe alive on success', foe.isDead === false);
  }
  assert('slot consumed regardless of save outcome', (caster.resources as any).spellSlots[7].remaining === 1);
}

console.log('\n=== Plane Shift — execute skips dead/unconscious target ===');
{
  const caster = makeCaster('wiz', 'Plane Shift', 7, { pos: { x: 5, y: 5, z: 0 } });
  const dead = makeCombatant('dead', { isDead: true, pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);
  executePlaneShift(caster, dead, state);
  assert('no save rolled for dead target', !state.log.events.some(e => e.type === 'save_fail' || e.type === 'save_success'));
  assert('slot still consumed', (caster.resources as any).spellSlots[7].remaining === 1);
}

console.log('\n=== Plane Shift — cleanup is a no-op ===');
{
  const caster = makeCaster('wiz', 'Plane Shift', 7);
  // cleanup should not throw and should not mutate the combatant
  const before = JSON.stringify({ conc: caster.concentration, hp: caster.currentHP });
  // Import cleanup dynamically to avoid unused import lint
  const { cleanup } = require('../spells/plane_shift');
  cleanup(caster);
  const after = JSON.stringify({ conc: caster.concentration, hp: caster.currentHP });
  assert('cleanup did not mutate caster', before === after);
}

// ============================================================
// === TELEPORT ===
// ============================================================
console.log('\n=== Teleport — Metadata ===');
eq('name', tpMeta.name, 'Teleport');
eq('level 7', tpMeta.level, 7);
eq('NO concentration', tpMeta.concentration, false);
eq('school conjuration', tpMeta.school, 'conjuration');
eq('range 10', tpMeta.rangeFt, 10);
assert('ally carry NOT implemented flag', (tpMeta as any).teleportAllyCarryV1Implemented === false);
assert('mishap table NOT implemented flag', (tpMeta as any).teleportMishapTableV1Implemented === false);

console.log('\n=== Teleport — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Teleport', 7, { pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const foeAdjacent = makeCombatant('adj1', { pos: { x: 5, y: 6, z: 0 } });
  const foeAdjacent2 = makeCombatant('adj2', { pos: { x: 6, y: 5, z: 0 } });

  // Full HP + not surrounded → false
  assert('false when full HP + not surrounded', shouldCastTeleport(caster, makeBF([caster, foe])) === false);
  // Bloodied → true
  const bloodied = { ...caster, currentHP: Math.floor(caster.maxHP / 2) } as Combatant;
  assert('true when bloodied (HP ≤ 50%)', shouldCastTeleport(bloodied, makeBF([bloodied, foe])) === true);
  // Surrounded (≥ 2 adjacent enemies) → true
  assert('true when surrounded (2 adjacent)', shouldCastTeleport(caster, makeBF([caster, foeAdjacent, foeAdjacent2])) === true);
  // null when no slot
  const noSlot = { ...caster, resources: { spellSlots: { 7: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('false when no slot', shouldCastTeleport(noSlot, makeBF([noSlot, foeAdjacent, foeAdjacent2])) === false);
  // false when no spell action
  const noAction = { ...caster, actions: [] } as Combatant;
  assert('false when no spell action', shouldCastTeleport(noAction, makeBF([noAction, foeAdjacent, foeAdjacent2])) === false);
  // false when action already used
  const usedAction = { ...caster, budget: { ...caster.budget, actionUsed: true } } as Combatant;
  assert('false when action already used', shouldCastTeleport(usedAction, makeBF([usedAction, foeAdjacent, foeAdjacent2])) === false);
  // NOT concentration-gated
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('true when bloodied + concentrating (NOT gated)', shouldCastTeleport({ ...concCaster, currentHP: 10 } as Combatant, makeBF([{ ...concCaster, currentHP: 10 } as Combatant, foe])) === true);
}

console.log('\n=== Teleport — execute moves caster to escape cell ===');
{
  const caster = makeCaster('wiz', 'Teleport', 7, {
    pos: { x: 5, y: 5, z: 0 }, currentHP: 10,  // bloodied
  });
  const foe1 = makeCombatant('e1', { pos: { x: 5, y: 6, z: 0 } });
  const foe2 = makeCombatant('e2', { pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, foe1, foe2]);
  const state = makeState(bf);
  const before = { ...caster.pos };
  executeTeleport(caster, state);
  assert('slot consumed', (caster.resources as any).spellSlots[7].remaining === 1);
  assert('action used flag set', caster.budget.actionUsed === true);
  assert('caster moved', caster.pos.x !== before.x || caster.pos.y !== before.y);
  assert('NOT concentrating (Teleport is instantaneous)', caster.concentration === null);
  // New position should be unoccupied
  const occupied = [...bf.combatants.values()].some(c =>
    c.id !== caster.id && !c.isDead && !c.isUnconscious && c.pos.x === caster.pos.x && c.pos.y === caster.pos.y
  );
  assert('new cell is unoccupied', !occupied);
  // New position should maximize distance from enemies (escape)
  const newMinDist = Math.min(
    Math.max(Math.abs(caster.pos.x - foe1.pos.x), Math.abs(caster.pos.y - foe1.pos.y)),
    Math.max(Math.abs(caster.pos.x - foe2.pos.x), Math.abs(caster.pos.y - foe2.pos.y))
  );
  const oldMinDist = Math.max(Math.abs(before.x - foe1.pos.x), Math.abs(before.y - foe1.pos.y));
  assert('new position has greater min-distance from enemies', newMinDist >= oldMinDist);
  assert('events logged', state.log.events.length >= 1);
  assert('log mentions Teleport', state.log.events.some(e => e.description.includes('Teleport')));
  assert('log mentions escape', state.log.events.some(e => e.description.includes('escape')));
}

console.log('\n=== Teleport — execute with no enemies stays put ===');
{
  const caster = makeCaster('wiz', 'Teleport', 7, {
    pos: { x: 5, y: 5, z: 0 }, currentHP: 10,  // bloodied
  });
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 10, y: 10, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  const before = { ...caster.pos };
  executeTeleport(caster, state);
  // With no enemies, findEscapeCell returns caster.pos (no escape needed)
  assert('caster stays put with no enemies', caster.pos.x === before.x && caster.pos.y === before.y);
  assert('slot still consumed', (caster.resources as any).spellSlots[7].remaining === 1);
}

// ============================================================
// === ANIMATE DEAD ===
// ============================================================
console.log('\n=== Animate Dead — Metadata ===');
eq('name', adMeta.name, 'Animate Dead');
eq('level 3', adMeta.level, 3);
eq('NO concentration', adMeta.concentration, false);
eq('school necromancy', adMeta.school, 'necromancy');
eq('range 10', adMeta.rangeFt, 10);
assert('corpse req simplified flag', (adMeta as any).animateDeadCorpseRequirementV1Simplified === true);
assert('zombie variant NOT implemented flag', (adMeta as any).animateDeadZombieVariantV1Implemented === false);
assert('upcast reassert NOT implemented flag', (adMeta as any).animateDeadUpcastReassertV1Implemented === false);

console.log('\n=== Animate Dead — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Animate Dead', 3);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  // Returns the CASTER (self) when there's an enemy + slot
  assert('returns caster when enemy present', shouldCastAnimateDead(caster, makeBF([caster, foe]))?.id === 'wiz');
  // null when no enemy
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  assert('null when no enemy', shouldCastAnimateDead(caster, makeBF([caster, ally])) === null);
  // null when only dead enemy
  const deadFoe = makeCombatant('deadfoe', { isDead: true, pos: { x: 1, y: 0, z: 0 } });
  assert('null when only dead enemy', shouldCastAnimateDead(caster, makeBF([caster, deadFoe])) === null);
  // null when no slot
  const noSlot = { ...caster, resources: { spellSlots: { 3: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastAnimateDead(noSlot, makeBF([noSlot, foe])) === null);
  // null when no spell action
  const noAction = { ...caster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastAnimateDead(noAction, makeBF([noAction, foe])) === null);
  // NOT concentration-gated
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('NOT gated by concentration', shouldCastAnimateDead(concCaster, makeBF([concCaster, foe]))?.id === 'wiz');
  // null when at spawn cap (4 existing skeletons)
  const existing = Array.from({ length: 4 }, (_, i) => createSkeleton(caster, i));
  assert('null when at spawn cap (4 skeletons)', shouldCastAnimateDead(caster, makeBF([caster, foe, ...existing])) === null);
  // OK when 3 existing skeletons (one below cap)
  const threeExisting = existing.slice(0, 3);
  assert('OK when below spawn cap (3 skeletons)', shouldCastAnimateDead(caster, makeBF([caster, foe, ...threeExisting]))?.id === 'wiz');
}

console.log('\n=== Animate Dead — execute spawns a skeleton combatant ===');
{
  const caster = makeCaster('wiz', 'Animate Dead', 3, { pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  const beforeCount = bf.combatants.size;
  executeAnimateDead(caster, caster, state);
  assert('slot consumed', (caster.resources as any).spellSlots[3].remaining === 1);
  assert('NOT concentrating (Animate Dead has no conc)', caster.concentration === null);
  assert('combatant added to bf.combatants', bf.combatants.size === beforeCount + 1);
  // Find the new skeleton
  const skeletons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === 'wiz' && c.summonSpellName === 'Animate Dead');
  assert('exactly 1 new skeleton summoned', skeletons.length === 1);
  const s = skeletons[0];
  eq('skeleton AC 13', s.ac, 13);
  eq('skeleton HP 13', s.maxHP, 13);
  eq('skeleton currentHP 13', s.currentHP, 13);
  eq('skeleton faction = caster faction', s.faction, caster.faction);
  eq('skeleton creatureType undead', s.creatureType, 'undead');
  eq('skeleton cr 0.25', s.cr, 0.25);
  eq('skeleton speed 30', s.speed, 30);
  eq('skeleton str 10', s.str, 10);
  eq('skeleton dex 14', s.dex, 14);
  eq('skeleton con 15', s.con, 15);
  assert('skeleton has Shortsword action', s.actions.some(a => a.name === 'Shortsword'));
  const sword = s.actions.find(a => a.name === 'Shortsword')!;
  eq('Shortsword hit bonus +4', sword.hitBonus, 4);
  eq('Shortsword damage 1d6+2', `${sword.damage?.count}d${sword.damage?.sides}+${sword.damage?.bonus}`, '1d6+2');
  eq('Shortsword damageType piercing', sword.damageType, 'piercing');
  eq('Shortsword attackType melee', sword.attackType, 'melee');
  eq('Shortsword reach 5', sword.reach, 5);
  assert('skeleton positioned adjacent to caster', Math.abs(s.pos.x - caster.pos.x) + Math.abs(s.pos.y - caster.pos.y) === 1);
  assert('pendingInitiativeInserts registered', (bf.pendingInitiativeInserts ?? []).some(p => p.combatantId === s.id && p.insertAfterId === caster.id));
  assert('events logged', state.log.events.length >= 1);
  assert('log mentions Animate Dead', state.log.events.some(e => e.description.includes('Animate Dead')));
  assert('log mentions Skeleton', state.log.events.some(e => e.description.includes('Skeleton')));
  assert('isSummon flag set', s.isSummon === true);
  eq('summonerId = caster.id', s.summonerId, 'wiz');
  eq('summonSpellName Animate Dead', s.summonSpellName, 'Animate Dead');
}

console.log('\n=== Animate Dead — execute spawns multiple skeletons on repeated casts (up to cap) ===');
{
  const caster = makeCaster('wiz', 'Animate Dead', 3, {
    resources: { spellSlots: { 3: { max: 10, remaining: 10 } } } as any,
  });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  for (let i = 0; i < 4; i++) executeAnimateDead(caster, caster, state);
  const skeletons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === 'wiz');
  assert('4 skeletons after 4 casts', skeletons.length === 4);
  // Each skeleton should have a unique position (adjacent offsets)
  const positions = new Set(skeletons.map(s => `${s.pos.x},${s.pos.y}`));
  assert('all 4 skeletons have unique positions', positions.size === 4);
  // 5th cast should be blocked by spawn cap (shouldCast returns null)
  const sc5 = shouldCastAnimateDead(caster, bf);
  assert('5th cast blocked (shouldCast returns null)', sc5 === null);
}

console.log('\n=== Animate Dead — skeleton stat block matches MM p.305 ===');
{
  const caster = makeCaster('wiz', 'Animate Dead', 3, { pos: { x: 0, y: 0, z: 0 } });
  const s = createSkeleton(caster, 0);
  // MM p.305 Skeleton: AC 13, HP 13, Speed 30, STR 10, DEX 14, CON 15, INT 6, WIS 8, CHA 5
  eq('AC 13', s.ac, 13);
  eq('HP 13', s.maxHP, 13);
  eq('Speed 30', s.speed, 30);
  eq('STR 10', s.str, 10);
  eq('DEX 14', s.dex, 14);
  eq('CON 15', s.con, 15);
  eq('INT 6', s.int, 6);
  eq('WIS 8', s.wis, 8);
  eq('CHA 5', s.cha, 5);
  // Shortsword: +4 to hit (DEX +2 + prof +2), 1d6+2 piercing (DEX +2)
  const sword = s.actions.find(a => a.name === 'Shortsword')!;
  eq('Shortsword +4', sword.hitBonus, 4);
  eq('Shortsword 1d6+2 piercing', `${sword.damage?.count}d${sword.damage?.sides}+${sword.damage?.bonus}`, '1d6+2');
  eq('damageType piercing', sword.damageType, 'piercing');
}

console.log('\n=== Animate Dead — skeleton differentiates from Create Undead zombie ===');
{
  const caster = makeCaster('wiz', 'Animate Dead', 3, { pos: { x: 0, y: 0, z: 0 } });
  const skel = createSkeleton(caster, 0);
  // Create Undead's zombie (MM p.316): AC 8, HP 22, Slam +3 1d6+1
  // Animate Dead's skeleton (MM p.305): AC 13, HP 13, Shortsword +4 1d6+2
  // Skeleton is squishier (HP 13 vs 22) but more accurate (+4 vs +3) + higher AC (13 vs 8)
  assert('skeleton AC 13 ≠ zombie AC 8', skel.ac === 13);
  assert('skeleton HP 13 ≠ zombie HP 22', skel.maxHP === 13);
  assert('skeleton Shortsword +4 ≠ zombie Slam +3', skel.actions[0].hitBonus === 4);
  eq('skeleton action name Shortsword (≠ Slam)', skel.actions[0].name, 'Shortsword');
}

// ============================================================
console.log(`\n==================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nsession68_batch4_spells.test.ts: ${failed} TESTS FAILED ❌`);
  process.exit(1);
}
console.log(`\nsession68_batch4_spells.test.ts: all tests passed ✅`);
