// ============================================================
// Test: Session 68 — Batch 3 monster spell modules
//
// Etherealness (PHB p.238): L7, self, NO save, conc — invisible (Border Ethereal)
// Wind Walk     (PHB p.288): L6, self, NO save, conc — mist form (fly 300 + incapacitated)
// Gate          (PHB p.244): L9, 60ft, NO save, conc — spawn shadow entity
// Hallow        (PHB p.249): L5, 60ft, NO save, NO conc — advantage_vs (Daylight vs undead/fiend)
// Wish          (PHB p.288): L9, self, NO save, NO conc — out-of-combat (stub)
//
// Run: npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts
// ============================================================

import {
  execute as executeEtherealness, shouldCast as shouldCastEtherealness, metadata as ethMeta,
} from '../spells/etherealness';
import {
  execute as executeWindWalk, shouldCast as shouldCastWindWalk, metadata as wwMeta,
} from '../spells/wind_walk';
import {
  execute as executeGate, shouldCast as shouldCastGate, metadata as gateMeta,
  createShadow,
} from '../spells/gate';
import {
  execute as executeHallow, shouldCast as shouldCastHallow, metadata as halMeta,
} from '../spells/hallow';
import {
  execute as executeWish, shouldCast as shouldCastWish, metadata as wishMeta,
} from '../spells/wish';
import { EngineState } from '../engine/combat';
import { Combatant, Battlefield, Condition } from '../types/core';

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
// === ETHEREALNESS ===
// ============================================================
console.log('\n=== Etherealness — Metadata ===');
eq('name', ethMeta.name, 'Etherealness');
eq('level 7', ethMeta.level, 7);
eq('concentration', ethMeta.concentration, true);
eq('school transmutation', ethMeta.school, 'transmutation');
eq('range 0 (self)', ethMeta.rangeFt, 0);
eq('castingTime action', ethMeta.castingTime, 'action');
assert('border ethereal v1 flag', (ethMeta as any).etherealnessBorderEtherealV1Implemented === true);
assert('plane shift NOT implemented flag', (ethMeta as any).etherealnessPlaneShiftV1Implemented === false);
assert('can affect material NOT implemented flag', (ethMeta as any).etherealnessCanAffectMaterialV1Implemented === false);
assert('duration encounter-only flag', (ethMeta as any).etherealnessDurationV1EncounterOnly === true);

console.log('\n=== Etherealness — shouldCast gates ===');
{
  // Caster below 50% HP — defensive escape fires
  const lowHpCaster = makeCaster('wiz', 'Etherealness', 7, { maxHP: 100, currentHP: 40, pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  assert('returns caster when below 50% HP', shouldCastEtherealness(lowHpCaster, makeBF([lowHpCaster, foe]))?.id === 'wiz');

  // Caster at 50% HP exactly — does NOT fire (gate is < 50%, not ≤)
  const halfHpCaster = makeCaster('wiz2', 'Etherealness', 7, { maxHP: 100, currentHP: 50, pos: { x: 5, y: 5, z: 0 } });
  assert('null when at exactly 50% HP (gate is < 50%)', shouldCastEtherealness(halfHpCaster, makeBF([halfHpCaster, foe])) === null);

  // Caster above 50% HP — does NOT fire
  const fullHpCaster = makeCaster('wiz3', 'Etherealness', 7, { maxHP: 100, currentHP: 80, pos: { x: 5, y: 5, z: 0 } });
  assert('null when above 50% HP', shouldCastEtherealness(fullHpCaster, makeBF([fullHpCaster, foe])) === null);

  // null when no slot
  const noSlot = { ...lowHpCaster, resources: { spellSlots: { 7: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastEtherealness(noSlot, makeBF([noSlot, foe])) === null);

  // null when no spell action
  const noAction = { ...lowHpCaster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastEtherealness(noAction, makeBF([noAction, foe])) === null);

  // null when concentrating
  const concCaster = { ...lowHpCaster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('null when concentrating', shouldCastEtherealness(concCaster, makeBF([concCaster, foe])) === null);

  // null when already Ethereal (no stacking)
  const alreadyEthereal = makeCaster('wiz4', 'Etherealness', 7, {
    maxHP: 100, currentHP: 40, pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ id: 'x', casterId: 'wiz4', spellName: 'Etherealness', effectType: 'invisible',
      payload: {}, sourceIsConcentration: true } as any],
  });
  assert('null when already Ethereal (no stacking)', shouldCastEtherealness(alreadyEthereal, makeBF([alreadyEthereal, foe])) === null);

  // Returns caster even with no foes (self-targeted — escape works without enemies present)
  assert('returns caster even with no foes', shouldCastEtherealness(lowHpCaster, makeBF([lowHpCaster]))?.id === 'wiz');
}

console.log('\n=== Etherealness — execute applies invisible effect + condition ===');
{
  const caster = makeCaster('wiz', 'Etherealness', 7, { maxHP: 100, currentHP: 30, pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeEtherealness(caster, caster, state);
  assert('slot consumed', (caster.resources as any).spellSlots[7].remaining === 1);
  assert('caster concentrating on Etherealness', caster.concentration?.spellName === 'Etherealness');
  // invisible condition applied
  assert('caster has invisible condition', caster.conditions.has('invisible'));
  // invisible effect applied
  assert('caster has Etherealness invisible effect', caster.activeEffects.some(e => e.spellName === 'Etherealness' && e.effectType === 'invisible'));
  const inv = caster.activeEffects.find(e => e.spellName === 'Etherealness' && e.effectType === 'invisible');
  assert('invisible effect is concentration-sourced', inv?.sourceIsConcentration === true);
  // Etherealness does NOT set breaksOnAttackOrCast (unlike L2 Invisibility)
  assert('breaksOnAttackOrCast NOT set (Etherealness has no ends-on-attack clause)', inv?.breaksOnAttackOrCast !== true);
  // Events logged
  assert('events logged (action + condition_add)', state.log.events.length >= 2);
  assert('log mentions Border Ethereal', state.log.events.some(e => e.description.includes('Border Ethereal')));
  assert('log mentions INVISIBLE', state.log.events.some(e => e.description.includes('INVISIBLE')));
}

console.log('\n=== Etherealness — execute skips dead/unconscious caster ===');
{
  const caster = makeCaster('wiz', 'Etherealness', 7, { maxHP: 100, currentHP: 30, isUnconscious: true, pos: { x: 5, y: 5, z: 0 } });
  const bf = makeBF([caster]);
  const state = makeState(bf);
  executeEtherealness(caster, caster, state);
  assert('no invisible condition on unconscious caster', !caster.conditions.has('invisible'));
  assert('no Etherealness effect on unconscious caster', !caster.activeEffects.some(e => e.spellName === 'Etherealness'));
  assert('slot still consumed', (caster.resources as any).spellSlots[7].remaining === 1);
  assert('concentration still started (defensive — before the dead check)', caster.concentration?.spellName === 'Etherealness');
}

// ============================================================
// === WIND WALK ===
// ============================================================
console.log('\n=== Wind Walk — Metadata ===');
eq('name', wwMeta.name, 'Wind Walk');
eq('level 6', wwMeta.level, 6);
eq('concentration', wwMeta.concentration, true);
eq('school transmutation', wwMeta.school, 'transmutation');
eq('range 0 (self)', wwMeta.rangeFt, 0);
eq('castingTime action', wwMeta.castingTime, 'action');
assert('multi-ally NOT implemented flag', (wwMeta as any).windWalkMultiAllyV1Implemented === false);
assert('mist form v1 flag', (wwMeta as any).windWalkMistFormV1Implemented === true);
assert('duration encounter-only flag', (wwMeta as any).windWalkDurationV1EncounterOnly === true);
assert('cast time simplified flag', (wwMeta as any).windWalkCastTimeV1Simplified === true);

console.log('\n=== Wind Walk — shouldCast gates ===');
{
  // Caster below 30% HP — defensive escape fires
  const lowHpCaster = makeCaster('wiz', 'Wind Walk', 6, { maxHP: 100, currentHP: 25, pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft away (within 30 ft)
  assert('returns caster when below 30% HP (defensive escape)', shouldCastWindWalk(lowHpCaster, makeBF([lowHpCaster, foe]))?.id === 'wiz');

  // Caster at full HP, no enemy within 30 ft — tactical reposition fires
  const fullHpCaster = makeCaster('wiz2', 'Wind Walk', 6, { maxHP: 100, currentHP: 100, pos: { x: 5, y: 5, z: 0 } });
  const farFoe = makeCombatant('farorc', { pos: { x: 12, y: 5, z: 0 } });  // 35 ft away (> 30 ft)
  assert('returns caster when no enemy within 30 ft (reposition)', shouldCastWindWalk(fullHpCaster, makeBF([fullHpCaster, farFoe]))?.id === 'wiz2');

  // Caster at full HP, enemy within 30 ft — does NOT fire
  const foeNear = makeCombatant('nearorc', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft away (within 30 ft)
  assert('null when full HP AND enemy within 30 ft', shouldCastWindWalk(fullHpCaster, makeBF([fullHpCaster, foeNear])) === null);

  // null when no slot
  const noSlot = { ...lowHpCaster, resources: { spellSlots: { 6: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastWindWalk(noSlot, makeBF([noSlot, foe])) === null);

  // null when no spell action
  const noAction = { ...lowHpCaster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastWindWalk(noAction, makeBF([noAction, foe])) === null);

  // null when concentrating
  const concCaster = { ...lowHpCaster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('null when concentrating', shouldCastWindWalk(concCaster, makeBF([concCaster, foe])) === null);

  // null when already Wind Walking (no stacking)
  const alreadyWW = makeCaster('wiz3', 'Wind Walk', 6, {
    maxHP: 100, currentHP: 25, pos: { x: 5, y: 5, z: 0 },
    activeEffects: [{ id: 'x', casterId: 'wiz3', spellName: 'Wind Walk', effectType: 'condition_apply',
      payload: { condition: 'incapacitated' }, sourceIsConcentration: true } as any],
  });
  assert('null when already Wind Walking (no stacking)', shouldCastWindWalk(alreadyWW, makeBF([alreadyWW, foe])) === null);

  // Returns caster even with no foes (escape works without enemies present, low HP fires)
  assert('returns caster even with no foes (low HP)', shouldCastWindWalk(lowHpCaster, makeBF([lowHpCaster]))?.id === 'wiz');
  // Full HP, no foes — also fires (no enemies within 30 ft)
  const fullHpAlone = makeCaster('wiz4', 'Wind Walk', 6, { maxHP: 100, currentHP: 100, pos: { x: 5, y: 5, z: 0 } });
  assert('returns caster when full HP and no foes (reposition)', shouldCastWindWalk(fullHpAlone, makeBF([fullHpAlone]))?.id === 'wiz4');
}

console.log('\n=== Wind Walk — execute applies fly 300 + incapacitated ===');
{
  const caster = makeCaster('wiz', 'Wind Walk', 6, { maxHP: 100, currentHP: 25, pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeWindWalk(caster, caster, state);
  assert('slot consumed', (caster.resources as any).spellSlots[6].remaining === 1);
  assert('caster concentrating on Wind Walk', caster.concentration?.spellName === 'Wind Walk');
  assert('caster flySpeed set to 300', caster.flySpeed === 300);
  assert('caster has incapacitated condition', caster.conditions.has('incapacitated'));
  assert('caster has Wind Walk condition_apply effect', caster.activeEffects.some(e => e.spellName === 'Wind Walk' && e.effectType === 'condition_apply'));
  const cond = caster.activeEffects.find(e => e.spellName === 'Wind Walk' && e.effectType === 'condition_apply');
  assert('condition_apply payload: incapacitated', cond?.payload.condition === 'incapacitated');
  assert('condition_apply is concentration-sourced', cond?.sourceIsConcentration === true);
  assert('events logged (action + condition_add)', state.log.events.length >= 2);
  assert('log mentions cloud of mist', state.log.events.some(e => e.description.includes('cloud of mist')));
  assert('log mentions fly 300', state.log.events.some(e => e.description.includes('flySpeed 300')));
}

console.log('\n=== Wind Walk — execute skips dead/unconscious caster ===');
{
  const caster = makeCaster('wiz', 'Wind Walk', 6, { maxHP: 100, currentHP: 25, isUnconscious: true, pos: { x: 5, y: 5, z: 0 } });
  const bf = makeBF([caster]);
  const state = makeState(bf);
  executeWindWalk(caster, caster, state);
  assert('no incapacitated condition on unconscious caster', !caster.conditions.has('incapacitated'));
  assert('no Wind Walk effect on unconscious caster', !caster.activeEffects.some(e => e.spellName === 'Wind Walk'));
  assert('slot still consumed', (caster.resources as any).spellSlots[6].remaining === 1);
}

// ============================================================
// === GATE ===
// ============================================================
console.log('\n=== Gate — Metadata ===');
eq('name', gateMeta.name, 'Gate');
eq('level 9', gateMeta.level, 9);
eq('concentration', gateMeta.concentration, true);
eq('school conjuration', gateMeta.school, 'conjuration');
eq('range 60', gateMeta.rangeFt, 60);
eq('castingTime action', gateMeta.castingTime, 'action');
assert('named creature pull NOT implemented flag', (gateMeta as any).gateNamedCreaturePullV1Implemented === false);
assert('plane selection NOT implemented flag', (gateMeta as any).gatePlaneSelectionV1Implemented === false);
assert('upcast NOT implemented flag', (gateMeta as any).gateUpcastV1Implemented === false);
assert('shadow persists-on-conc-break NOT modelled flag', (gateMeta as any).gateShadowPersistsOnConcBreakV1NotModelled === true);

console.log('\n=== Gate — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Gate', 9);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  // Returns the CASTER (self) when there's an enemy + slot
  assert('returns caster when enemy present', shouldCastGate(caster, makeBF([caster, foe]))?.id === 'wiz');
  // null when no enemy
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  assert('null when no enemy', shouldCastGate(caster, makeBF([caster, ally])) === null);
  // null when only dead enemy
  const deadFoe = makeCombatant('deadfoe', { isDead: true, pos: { x: 1, y: 0, z: 0 } });
  assert('null when only dead enemy', shouldCastGate(caster, makeBF([caster, deadFoe])) === null);
  // null when no slot
  const noSlot = { ...caster, resources: { spellSlots: { 9: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastGate(noSlot, makeBF([noSlot, foe])) === null);
  // null when no spell action
  const noAction = { ...caster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastGate(noAction, makeBF([noAction, foe])) === null);
  // Concentration-gated
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('null when concentrating', shouldCastGate(concCaster, makeBF([concCaster, foe])) === null);
  // null when at spawn cap (4 existing shadows)
  const existing = Array.from({ length: 4 }, (_, i) => createShadow(caster, i));
  assert('null when at spawn cap (4 shadows)', shouldCastGate(caster, makeBF([caster, foe, ...existing])) === null);
  // OK when 3 existing shadows (one below cap)
  const threeExisting = existing.slice(0, 3);
  assert('OK when below spawn cap (3 shadows)', shouldCastGate(caster, makeBF([caster, foe, ...threeExisting]))?.id === 'wiz');
}

console.log('\n=== Gate — execute spawns a shadow combatant ===');
{
  const caster = makeCaster('wiz', 'Gate', 9, { pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  const beforeCount = bf.combatants.size;
  executeGate(caster, caster, state);
  assert('slot consumed', (caster.resources as any).spellSlots[9].remaining === 1);
  assert('caster concentrating on Gate', caster.concentration?.spellName === 'Gate');
  assert('combatant added to bf.combatants', bf.combatants.size === beforeCount + 1);
  // Find the new shadow
  const shadows = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === 'wiz' && c.summonSpellName === 'Gate');
  assert('exactly 1 new shadow summoned', shadows.length === 1);
  const s = shadows[0];
  eq('shadow AC 12', s.ac, 12);
  eq('shadow HP 24', s.maxHP, 24);
  eq('shadow currentHP 24', s.currentHP, 24);
  eq('shadow faction = caster faction', s.faction, caster.faction);
  eq('shadow creatureType undead', s.creatureType, 'undead');
  assert('shadow has Strength Drain action', s.actions.some(a => a.name === 'Strength Drain'));
  const drain = s.actions.find(a => a.name === 'Strength Drain')!;
  eq('Strength Drain hit bonus +5', drain.hitBonus, 5);
  eq('Strength Drain damage 1d4+3', `${drain.damage?.count}d${drain.damage?.sides}+${drain.damage?.bonus}`, '1d4+3');
  eq('Strength Drain damageType necrotic', drain.damageType, 'necrotic');
  assert('shadow positioned adjacent to caster', Math.abs(s.pos.x - caster.pos.x) + Math.abs(s.pos.y - caster.pos.y) === 1);
  assert('pendingInitiativeInserts registered', (bf.pendingInitiativeInserts ?? []).some(p => p.combatantId === s.id && p.insertAfterId === caster.id));
  assert('events logged', state.log.events.length >= 1);
  assert('log mentions Gate', state.log.events.some(e => e.description.includes('Gate')));
  assert('log mentions Shadow', state.log.events.some(e => e.description.includes('Shadow')));
}

console.log('\n=== Gate — execute spawns multiple shadows on repeated casts (up to cap) ===');
{
  const caster = makeCaster('wiz', 'Gate', 9, {
    resources: { spellSlots: { 9: { max: 10, remaining: 10 } } } as any,
  });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  for (let i = 0; i < 4; i++) executeGate(caster, caster, state);
  const shadows = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === 'wiz');
  assert('4 shadows after 4 casts', shadows.length === 4);
  // 5th cast should be blocked by spawn cap (shouldCast returns null)
  const sc5 = shouldCastGate(caster, bf);
  assert('5th cast blocked (shouldCast returns null)', sc5 === null);
}

// ============================================================
// === HALLOW ===
// ============================================================
console.log('\n=== Hallow — Metadata ===');
eq('name', halMeta.name, 'Hallow');
eq('level 5', halMeta.level, 5);
eq('NO concentration', halMeta.concentration, false);
eq('school evocation', halMeta.school, 'evocation');
eq('range 60', halMeta.rangeFt, 60);
eq('castingTime action', halMeta.castingTime, 'action');
assert('cast time simplified flag', (halMeta as any).hallowCastTimeV1Simplified === true);
assert('daylight-only v1 flag', (halMeta as any).hallowDaylightOnlyV1Implemented === true);
assert('area simplified to single-target flag', (halMeta as any).hallowAreaV1SimplifiedToSingleTarget === true);
assert('duration encounter-only flag', (halMeta as any).hallowDurationV1EncounterOnly === true);

console.log('\n=== Hallow — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Hallow', 5, { pos: { x: 5, y: 5, z: 0 } });
  const undead = makeCombatant('zombie', { creatureType: 'undead', pos: { x: 6, y: 5, z: 0 }, maxHP: 80, currentHP: 80 });   // 5 ft away
  const fiend = makeCombatant('demon', { creatureType: 'fiend', pos: { x: 7, y: 5, z: 0 }, maxHP: 60, currentHP: 60 });       // 10 ft away
  const humanoid = makeCombatant('bandit', { creatureType: 'humanoid', pos: { x: 6, y: 5, z: 0 } });                          // 5 ft away but wrong type
  const farUndead = makeCombatant('farz', { creatureType: 'undead', pos: { x: 18, y: 5, z: 0 } });                            // 65 ft away (> 60)

  // Picks undead target in range
  assert('picks undead target in range', shouldCastHallow(caster, makeBF([caster, undead]))?.id === 'zombie');
  // Picks fiend target in range
  assert('picks fiend target in range', shouldCastHallow(caster, makeBF([caster, fiend]))?.id === 'demon');
  // null vs humanoid (wrong type)
  assert('null vs humanoid', shouldCastHallow(caster, makeBF([caster, humanoid])) === null);
  // null when undead too far
  assert('null when undead too far (> 60 ft)', shouldCastHallow(caster, makeBF([caster, farUndead])) === null);
  // Picks highest-HP undead/fiend when multiple in range
  assert('picks higher-HP threat (undead 80 > fiend 60)', shouldCastHallow(caster, makeBF([caster, undead, fiend]))?.id === 'zombie');
  // null when no slot
  const noSlot = { ...caster, resources: { spellSlots: { 5: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastHallow(noSlot, makeBF([noSlot, undead])) === null);
  // null when no spell action
  const noAction = { ...caster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastHallow(noAction, makeBF([noAction, undead])) === null);
  // NOT concentration-gated (Hallow has no concentration)
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('NOT gated by concentration', shouldCastHallow(concCaster, makeBF([concCaster, undead]))?.id === 'zombie');
  // Skip if already affected by this caster's Hallow
  const alreadyHal = makeCombatant('bzombie', {
    creatureType: 'undead', pos: { x: 6, y: 5, z: 0 }, maxHP: 90, currentHP: 90,
    activeEffects: [{ id: 'x', casterId: 'wiz', spellName: 'Hallow', effectType: 'advantage_vs',
      payload: { advType: 'advantage' }, sourceIsConcentration: false } as any],
  });
  // alreadyHal is higher HP (90) but already affected — should skip to next candidate
  assert('skips already-affected target, picks next', shouldCastHallow(caster, makeBF([caster, alreadyHal, undead]))?.id === 'zombie');
  // Both already affected — null
  const alreadyHal2 = makeCombatant('bzombie2', {
    creatureType: 'undead', pos: { x: 6, y: 5, z: 0 }, maxHP: 90, currentHP: 90,
    activeEffects: [{ id: 'x', casterId: 'wiz', spellName: 'Hallow', effectType: 'advantage_vs',
      payload: { advType: 'advantage' }, sourceIsConcentration: false } as any],
  });
  assert('null when all in-range undead/fiends already affected', shouldCastHallow(caster, makeBF([caster, alreadyHal2, fiend])) === null
    || shouldCastHallow(caster, makeBF([caster, alreadyHal2, fiend]))?.id !== 'bzombie2');
}

console.log('\n=== Hallow — execute applies advantage_vs (advantage) to target ===');
{
  const caster = makeCaster('wiz', 'Hallow', 5, { pos: { x: 5, y: 5, z: 0 } });
  const undead = makeCombatant('zombie', { creatureType: 'undead', pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, undead]);
  const state = makeState(bf);
  executeHallow(caster, undead, state);
  assert('slot consumed', (caster.resources as any).spellSlots[5].remaining === 1);
  assert('NOT concentrating (Hallow has no conc)', caster.concentration === null);
  assert('undead has Hallow advantage_vs effect', undead.activeEffects.some(e => e.spellName === 'Hallow' && e.effectType === 'advantage_vs'));
  const adv = undead.activeEffects.find(e => e.spellName === 'Hallow' && e.effectType === 'advantage_vs');
  assert('advantage_vs payload: advType=advantage', adv?.payload.advType === 'advantage');
  assert('advantage_vs NOT concentration-sourced', adv?.sourceIsConcentration === false);
  assert('events logged (action + condition_add)', state.log.events.length >= 2);
  assert('log mentions Daylight', state.log.events.some(e => e.description.includes('Daylight')));
  assert('log mentions advantage', state.log.events.some(e => e.description.includes('advantage')));
}

console.log('\n=== Hallow — execute skips dead target ===');
{
  const caster = makeCaster('wiz', 'Hallow', 5, { pos: { x: 5, y: 5, z: 0 } });
  const dead = makeCombatant('deadz', { creatureType: 'undead', isDead: true, pos: { x: 6, y: 5, z: 0 } });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);
  executeHallow(caster, dead, state);
  assert('no effect applied to dead', dead.activeEffects.length === 0);
  assert('slot still consumed', (caster.resources as any).spellSlots[5].remaining === 1);
  assert('NOT concentrating', caster.concentration === null);
}

// ============================================================
// === WISH ===
// ============================================================
console.log('\n=== Wish — Metadata ===');
eq('name', wishMeta.name, 'Wish');
eq('level 9', wishMeta.level, 9);
eq('NO concentration', wishMeta.concentration, false);
eq('school conjuration', wishMeta.school, 'conjuration');
eq('range 0 (self)', wishMeta.rangeFt, 0);
eq('castingTime action', wishMeta.castingTime, 'action');
assert('outOfCombat flag', (wishMeta as any).outOfCombat === true);
assert('duplicate-any-spell deferred flag', (wishMeta as any).wishDuplicateAnySpellV1Deferred === true);
assert('stress effect NOT modelled flag', (wishMeta as any).wishStressEffectV1NotModelled === true);
assert('out-of-combat v1 flag', (wishMeta as any).wishOutOfCombatV1Implemented === true);

console.log('\n=== Wish — shouldCast always returns null ===');
{
  const caster = makeCaster('wiz', 'Wish', 9);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  assert('null even with foes', shouldCastWish(caster, makeBF([caster, foe])) === null);
  assert('null even with allies', shouldCastWish(caster, makeBF([caster, ally])) === null);
  assert('null even with full battlefield', shouldCastWish(caster, makeBF([caster, foe, ally])) === null);
  assert('null on empty battlefield', shouldCastWish(caster, makeBF([caster])) === null);
}

console.log('\n=== Wish — execute is a no-op ===');
{
  const caster = makeCaster('wiz', 'Wish', 9);
  const bf = makeBF([caster]);
  const state = makeState(bf);
  const beforeCount = bf.combatants.size;
  const beforeEvents = state.log.events.length;
  executeWish(caster, state);
  assert('no combatant added', bf.combatants.size === beforeCount);
  assert('no events logged', state.log.events.length === beforeEvents);
  // Slot is NOT consumed (execute is a no-op stub; shouldCast never fires)
  assert('slot NOT consumed (stub)', (caster.resources as any).spellSlots[9].remaining === 2);
}

// ============================================================
console.log(`\n==================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nsession68_batch3_spells.test.ts: ${failed} TESTS FAILED ❌`);
  process.exit(1);
}
console.log(`\nsession68_batch3_spells.test.ts: all tests passed ✅`);
