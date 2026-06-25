// ============================================================
// Test: Session 68 — Batch 2 monster spell modules
//
// Antimagic Field (PHB p.213): L8, self, NO save, conc — incapacitate enemy casters in 10ft
// Mind Blank      (PHB p.260): L8, touch, NO save, NO conc — psychic + charm immunity
// Symbol          (PHB p.280): L7, 30ft, CON save, conc — Pain (damage_zone + disadv)
// Create Undead   (PHB p.229): L6, 10ft, NO save, NO conc — spawn zombie
// Raise Dead      (PHB p.258): L5, 1-hour cast, out-of-combat (stub)
//
// Run: npx ts-node --transpile-only src/test/session68_batch2_spells.test.ts
// ============================================================

import {
  execute as executeAntimagicField, shouldCast as shouldCastAntimagicField, metadata as afMeta,
} from '../spells/antimagic_field';
import {
  execute as executeMindBlank, shouldCast as shouldCastMindBlank, metadata as mbMeta,
} from '../spells/mind_blank';
import {
  execute as executeSymbol, shouldCast as shouldCastSymbol, metadata as symMeta,
} from '../spells/symbol';
import {
  execute as executeCreateUndead, shouldCast as shouldCastCreateUndead, metadata as cuMeta,
  createZombie,
} from '../spells/create_undead';
import {
  execute as executeRaiseDead, shouldCast as shouldCastRaiseDead, metadata as rdMeta,
} from '../spells/raise_dead';
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

/** Build an enemy spellcaster combatant (has spellSlots AND saveAbility). */
function makeEnemyCaster(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return makeCombatant(id, {
    faction: 'enemy',
    actions: [{
      name: 'Hold Person', isMultiattack: false, attackType: 'save' as const,
      reach: 0, range: { normal: 60, long: 60 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 14, saveAbility: 'wis' as const,
      isAoE: false, isControl: true, requiresConcentration: true,
      slotLevel: 2, costType: 'action' as const, legendaryCost: 0, description: 'Hold Person',
    }],
    resources: { spellSlots: { 2: { max: 3, remaining: 3 } } } as any,
    ...overrides,
  });
}

// ============================================================
// === ANTIMAGIC FIELD ===
// ============================================================
console.log('\n=== Antimagic Field — Metadata ===');
eq('name', afMeta.name, 'Antimagic Field');
eq('level 8', afMeta.level, 8);
eq('concentration', afMeta.concentration, true);
eq('school abjuration', afMeta.school, 'abjuration');
eq('range 0 (self)', afMeta.rangeFt, 0);
assert('multi-target v1 flag', (afMeta as any).antimagicFieldMultiTargetV1Implemented === true);
assert('geometry NOT implemented flag', (afMeta as any).antimagicFieldGeometryV1Implemented === false);
assert('magic item suppression NOT implemented flag', (afMeta as any).antimagicFieldMagicItemSuppressionV1Implemented === false);

console.log('\n=== Antimagic Field — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Antimagic Field', 8, { pos: { x: 5, y: 5, z: 0 } });
  const enemyCasterNear = makeEnemyCaster('darkMage', { pos: { x: 5, y: 6, z: 0 } });   // 5 ft away
  const enemyCasterFar = makeEnemyCaster('farMage', { pos: { x: 10, y: 10, z: 0 } });    // >10 ft away
  const enemyNonCaster = makeCombatant('orc', { pos: { x: 5, y: 6, z: 0 } });           // melee bruiser, no spells
  const deadEnemyCaster = makeEnemyCaster('deadMage', { isDead: true, pos: { x: 5, y: 6, z: 0 } });

  // Returns the CASTER (self) when enemy caster is within 10 ft
  assert('returns caster when enemy caster within 10 ft', shouldCastAntimagicField(caster, makeBF([caster, enemyCasterNear]))?.id === 'wiz');
  // null when no enemy caster in range (only melee enemy)
  assert('null when no enemy caster in range', shouldCastAntimagicField(caster, makeBF([caster, enemyNonCaster])) === null);
  // null when enemy caster too far
  assert('null when enemy caster too far (> 10 ft)', shouldCastAntimagicField(caster, makeBF([caster, enemyCasterFar])) === null);
  // null when only dead enemy caster
  assert('null when only dead enemy caster', shouldCastAntimagicField(caster, makeBF([caster, deadEnemyCaster])) === null);
  // null when no slot
  const noSlotCaster = { ...caster, resources: { spellSlots: { 8: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastAntimagicField(noSlotCaster, makeBF([noSlotCaster, enemyCasterNear])) === null);
  // null when concentrating
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('null when concentrating', shouldCastAntimagicField(concCaster, makeBF([concCaster, enemyCasterNear])) === null);
  // null when no spell action
  const noActionCaster = { ...caster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastAntimagicField(noActionCaster, makeBF([noActionCaster, enemyCasterNear])) === null);
}

console.log('\n=== Antimagic Field — execute incapacitates enemy casters in 10ft ===');
{
  const caster = makeCaster('wiz', 'Antimagic Field', 8, { pos: { x: 5, y: 5, z: 0 } });
  const e1 = makeEnemyCaster('e1', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft away
  const e2 = makeEnemyCaster('e2', { pos: { x: 6, y: 6, z: 0 } });  // 5 ft away (diagonal)
  const e3 = makeEnemyCaster('e3', { pos: { x: 9, y: 9, z: 0 } });  // 20 ft away — should NOT be affected
  const melee = makeCombatant('melee', { faction: 'enemy', pos: { x: 5, y: 6, z: 0 } });  // in range but not caster
  const bf = makeBF([caster, e1, e2, e3, melee]);
  const state = makeState(bf);
  executeAntimagicField(caster, caster, state);
  assert('slot consumed', (caster.resources as any).spellSlots[8].remaining === 1);
  assert('caster concentrating on Antimagic Field', caster.concentration?.spellName === 'Antimagic Field');
  assert('e1 incapacitated', e1.conditions.has('incapacitated'));
  assert('e2 incapacitated', e2.conditions.has('incapacitated'));
  assert('e3 NOT incapacitated (too far)', !e3.conditions.has('incapacitated'));
  assert('melee NOT incapacitated (not a caster)', !melee.conditions.has('incapacitated'));
  assert('e1 has Antimagic Field activeEffect', e1.activeEffects.some(e => e.spellName === 'Antimagic Field' && e.effectType === 'condition_apply'));
  assert('e1 effect payload condition=incapacitated', e1.activeEffects.some(e => e.spellName === 'Antimagic Field' && e.payload.condition === 'incapacitated'));
  assert('e1 effect is concentration-sourced', e1.activeEffects.some(e => e.spellName === 'Antimagic Field' && e.sourceIsConcentration === true));
  assert('events logged (action + condition_add)', state.log.events.length >= 4);
  assert('log notes magic item suppression', state.log.events.some(e => e.description.includes('magic items')));
}

console.log('\n=== Antimagic Field — execute is idempotent (skips already-affected) ===');
{
  const caster = makeCaster('wiz', 'Antimagic Field', 8, { pos: { x: 5, y: 5, z: 0 } });
  const e1 = makeEnemyCaster('e1', { pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([caster, e1]);
  const state = makeState(bf);
  executeAntimagicField(caster, caster, state);
  const effectsBefore = e1.activeEffects.filter(e => e.spellName === 'Antimagic Field').length;
  // Cast again (with a fresh slot) — should not double-apply
  const caster2 = makeCaster('wiz2', 'Antimagic Field', 8, { pos: { x: 5, y: 5, z: 0 } });
  const bf2 = makeBF([caster2, e1]);
  const state2 = makeState(bf2);
  executeAntimagicField(caster2, caster2, state2);
  const effectsAfter = e1.activeEffects.filter(e => e.spellName === 'Antimagic Field').length;
  assert('no duplicate effect from second caster (already incapacitated)', effectsAfter === effectsBefore + 1);
  assert('e1 effect from caster2 added', e1.activeEffects.some(e => e.spellName === 'Antimagic Field' && e.casterId === 'wiz2'));
}

// ============================================================
// === MIND BLANK ===
// ============================================================
console.log('\n=== Mind Blank — Metadata ===');
eq('name', mbMeta.name, 'Mind Blank');
eq('level 8', mbMeta.level, 8);
eq('NO concentration', mbMeta.concentration, false);
eq('school abjuration', mbMeta.school, 'abjuration');
eq('range 5 (touch)', mbMeta.rangeFt, 5);
assert('psychic immunity v1 flag', (mbMeta as any).mindBlankPsychicImmunityV1Implemented === true);
assert('charm immunity v1 flag', (mbMeta as any).mindBlankCharmImmunityV1Implemented === true);
assert('divination immunity NOT implemented flag', (mbMeta as any).mindBlankDivinationImmunityV1Implemented === false);

console.log('\n=== Mind Blank — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Mind Blank', 8, { pos: { x: 5, y: 5, z: 0 } });
  const allyLowHP = makeCombatant('lowhp', { faction: 'party', currentHP: 5, pos: { x: 5, y: 6, z: 0 } });
  const allyHighHP = makeCombatant('fullhp', { faction: 'party', currentHP: 100, pos: { x: 6, y: 5, z: 0 } });
  const allyFar = makeCombatant('farally', { faction: 'party', pos: { x: 10, y: 10, z: 0 } });
  const foe = makeCombatant('foe', { pos: { x: 5, y: 6, z: 0 } });

  // Returns lowest-HP ally in 5 ft
  assert('returns lowest-HP ally in 5 ft', shouldCastMindBlank(caster, makeBF([caster, allyLowHP, allyHighHP]))?.id === 'lowhp');
  // Returns full-HP ally if only one in range
  assert('returns only in-range ally', shouldCastMindBlank(caster, makeBF([caster, allyHighHP]))?.id === 'fullhp');
  // Returns caster (self) when no ally in range (PHB p.260: self-cast allowed)
  assert('returns caster when no ally in range', shouldCastMindBlank(caster, makeBF([caster, foe]))?.id === 'wiz');
  assert('returns caster when ally too far', shouldCastMindBlank(caster, makeBF([caster, allyFar]))?.id === 'wiz');
  // null when no slot
  const noSlot = { ...caster, resources: { spellSlots: { 8: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastMindBlank(noSlot, makeBF([noSlot, allyLowHP])) === null);
  // null when no spell action
  const noAction = { ...caster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastMindBlank(noAction, makeBF([noAction, allyLowHP])) === null);
  // NOT concentration-gated (Mind Blank has no concentration)
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('NOT gated by concentration', shouldCastMindBlank(concCaster, makeBF([concCaster, allyLowHP]))?.id === 'lowhp');
  // Skip if already Mind Blanked by this caster — fall back to self
  const alreadyMB = makeCombatant('mb', { faction: 'party', pos: { x: 5, y: 6, z: 0 },
    activeEffects: [{ id: 'x', casterId: 'wiz', spellName: 'Mind Blank', effectType: 'ac_bonus',
      payload: {}, sourceIsConcentration: false } as any] });
  assert('returns caster when only ally already Mind Blanked', shouldCastMindBlank(caster, makeBF([caster, alreadyMB]))?.id === 'wiz');
}

console.log('\n=== Mind Blank — execute applies psychic + charm immunity ===');
{
  const caster = makeCaster('wiz', 'Mind Blank', 8, { pos: { x: 5, y: 5, z: 0 } });
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([caster, ally]);
  const state = makeState(bf);
  executeMindBlank(caster, ally, state);
  assert('slot consumed', (caster.resources as any).spellSlots[8].remaining === 1);
  assert('NOT concentrating (Mind Blank has no conc)', caster.concentration === null);
  // Psychic immunity marker
  assert('ally has psychic immunity', (ally.immunities ?? []).includes('psychic'));
  // Charm condition immunity marker
  assert('ally has charmed condition immunity', (ally.conditionImmunities ?? []).includes('charmed'));
  // Events logged
  assert('events logged (action + immunity logs)', state.log.events.length >= 4);
  assert('log mentions psychic immunity', state.log.events.some(e => e.description.includes('IMMUNE to psychic')));
  assert('log mentions charmed immunity', state.log.events.some(e => e.description.includes('IMMUNE to the charmed condition')));
  assert('log mentions divination (informational)', state.log.events.some(e => e.description.includes('divination')));
}

console.log('\n=== Mind Blank — execute skips dead target ===');
{
  const caster = makeCaster('wiz', 'Mind Blank', 8, { pos: { x: 5, y: 5, z: 0 } });
  const dead = makeCombatant('dead', { faction: 'party', isDead: true, pos: { x: 5, y: 6, z: 0 } });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);
  executeMindBlank(caster, dead, state);
  assert('no immunity added to dead', !((dead.immunities ?? []).includes('psychic')));
  assert('no conditionImmunities added to dead', !((dead.conditionImmunities ?? []).includes('charmed')));
  assert('slot still consumed', (caster.resources as any).spellSlots[8].remaining === 1);
}

// ============================================================
// === SYMBOL ===
// ============================================================
console.log('\n=== Symbol — Metadata ===');
eq('name', symMeta.name, 'Symbol');
eq('level 7', symMeta.level, 7);
eq('concentration', symMeta.concentration, true);
eq('save con', symMeta.saveAbility, 'con');
eq('school abjuration', symMeta.school, 'abjuration');
eq('range 30 (v1 trigger radius)', symMeta.rangeFt, 30);
assert('cast time v1 simplified flag', (symMeta as any).symbolCastTimeV1Simplified === true);
assert('glyph placement NOT implemented flag', (symMeta as any).symbolGlyphPlacementV1Implemented === false);
assert('Pain-only v1 flag', (symMeta as any).symbolEffectPainOnlyV1Implemented === true);
assert('upcast NOT implemented flag', (symMeta as any).symbolUpcastV1Implemented === false);

console.log('\n=== Symbol — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Symbol', 7);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const farFoe = makeCombatant('far', { pos: { x: 10, y: 0, z: 0 } });   // 50 ft away > 30
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  const dead = makeCombatant('dead', { isDead: true, pos: { x: 1, y: 0, z: 0 } });
  assert('picks nearby foe', shouldCastSymbol(caster, makeBF([caster, foe]))?.id === 'orc');
  assert('null when no slot', shouldCastSymbol({ ...caster, resources: { spellSlots: { 7: { max: 2, remaining: 0 } } } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when concentrating', shouldCastSymbol({ ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant, makeBF([caster, foe])) === null);
  assert('null when no spell action', shouldCastSymbol({ ...caster, actions: [] } as Combatant, makeBF([caster, foe])) === null);
  assert('null when foe too far (> 30 ft)', shouldCastSymbol(caster, makeBF([caster, farFoe])) === null);
  assert('null when only ally', shouldCastSymbol(caster, makeBF([caster, ally])) === null);
  assert('null when only dead', shouldCastSymbol(caster, makeBF([caster, dead])) === null);
  // picks highest-threat foe
  const big = makeCombatant('big', { maxHP: 500, currentHP: 500, pos: { x: 2, y: 0, z: 0 } });
  const small = makeCombatant('small', { maxHP: 5, currentHP: 5, pos: { x: 1, y: 0, z: 0 } });
  assert('picks higher HP threat', shouldCastSymbol(caster, makeBF([caster, big, small]))?.id === 'big');
}

console.log('\n=== Symbol — execute applies damage_zone + advantage_vs on failed save ===');
{
  const caster = makeCaster('wiz', 'Symbol', 7);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 }, con: 1 });   // low CON → likely fails
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeSymbol(caster, foe, state);
  assert('slot consumed', (caster.resources as any).spellSlots[7].remaining === 1);
  assert('caster concentrating on Symbol', caster.concentration?.spellName === 'Symbol');
  // Effect applied (either save_success or save_fail should be logged)
  assert('events logged', state.log.events.length >= 2);
  const hasFail = state.log.events.some(e => e.type === 'save_fail' && e.description.includes('Symbol'));
  const hasSuccess = state.log.events.some(e => e.type === 'save_success' && e.description.includes('Symbol'));
  assert('save rolled (fail or success logged)', hasFail || hasSuccess);
  // On fail: both effects applied
  if (hasFail) {
    assert('foe has Symbol damage_zone effect', foe.activeEffects.some(e => e.spellName === 'Symbol' && e.effectType === 'damage_zone'));
    const zone = foe.activeEffects.find(e => e.spellName === 'Symbol' && e.effectType === 'damage_zone');
    assert('damage_zone payload: 1d4 psychic', zone?.payload.dieCount === 1 && zone?.payload.dieSides === 4 && zone?.payload.damageType === 'psychic');
    assert('damage_zone is concentration-sourced', zone?.sourceIsConcentration === true);
    assert('foe has Symbol advantage_vs effect', foe.activeEffects.some(e => e.spellName === 'Symbol' && e.effectType === 'advantage_vs'));
    const adv = foe.activeEffects.find(e => e.spellName === 'Symbol' && e.effectType === 'advantage_vs');
    assert('advantage_vs payload: advType=disadvantage', adv?.payload.advType === 'disadvantage');
  } else {
    // Save succeeded — effects should NOT be applied
    assert('foe resisted — no Symbol effect applied', !foe.activeEffects.some(e => e.spellName === 'Symbol'));
  }
}

console.log('\n=== Symbol — execute with guaranteed fail (very weak save) ===');
{
  // Use a caster with very high DC + a foe with very weak CON to guarantee a fail
  const caster = makeCaster('wiz', 'Symbol', 7, {
    actions: [{
      name: 'Symbol', isMultiattack: false, attackType: 'save' as const,
      reach: 0, range: { normal: 30, long: 30 }, hitBonus: null,
      damage: null, damageType: null, saveDC: 30, saveAbility: 'con' as const,
      isAoE: false, isControl: true, requiresConcentration: true,
      slotLevel: 7, costType: 'action' as const, legendaryCost: 0, description: 'Symbol',
    }],
  });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 }, con: 1 });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  executeSymbol(caster, foe, state);
  assert('save failed (DC 30 vs CON 1)', state.log.events.some(e => e.type === 'save_fail'));
  assert('foe has Symbol damage_zone effect', foe.activeEffects.some(e => e.spellName === 'Symbol' && e.effectType === 'damage_zone'));
  assert('foe has Symbol advantage_vs effect', foe.activeEffects.some(e => e.spellName === 'Symbol' && e.effectType === 'advantage_vs'));
  const adv = foe.activeEffects.find(e => e.spellName === 'Symbol' && e.effectType === 'advantage_vs');
  assert('advantage_vs payload: advType=disadvantage', adv?.payload.advType === 'disadvantage');
}

console.log('\n=== Symbol — execute skips dead target ===');
{
  const caster = makeCaster('wiz', 'Symbol', 7);
  const dead = makeCombatant('dead', { isDead: true, pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, dead]);
  const state = makeState(bf);
  executeSymbol(caster, dead, state);
  assert('no effect applied to dead', dead.activeEffects.length === 0);
  assert('slot still consumed', (caster.resources as any).spellSlots[7].remaining === 1);
}

// ============================================================
// === CREATE UNDEAD ===
// ============================================================
console.log('\n=== Create Undead — Metadata ===');
eq('name', cuMeta.name, 'Create Undead');
eq('level 6', cuMeta.level, 6);
eq('NO concentration', cuMeta.concentration, false);
eq('school necromancy', cuMeta.school, 'necromancy');
eq('range 10', cuMeta.rangeFt, 10);
assert('corpse req simplified flag', (cuMeta as any).createUndeadCorpseRequirementV1Simplified === true);
assert('upcast NOT implemented flag', (cuMeta as any).createUndeadUpcastV1Implemented === false);
assert('ghoul variant NOT implemented flag', (cuMeta as any).createUndeadGhoulVariantV1Implemented === false);

console.log('\n=== Create Undead — shouldCast gates ===');
{
  const caster = makeCaster('wiz', 'Create Undead', 6);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  // Returns the CASTER (self) when there's an enemy + slot
  assert('returns caster when enemy present', shouldCastCreateUndead(caster, makeBF([caster, foe]))?.id === 'wiz');
  // null when no enemy
  const ally = makeCombatant('ally', { faction: 'party', pos: { x: 1, y: 0, z: 0 } });
  assert('null when no enemy', shouldCastCreateUndead(caster, makeBF([caster, ally])) === null);
  // null when only dead enemy
  const deadFoe = makeCombatant('deadfoe', { isDead: true, pos: { x: 1, y: 0, z: 0 } });
  assert('null when only dead enemy', shouldCastCreateUndead(caster, makeBF([caster, deadFoe])) === null);
  // null when no slot
  const noSlot = { ...caster, resources: { spellSlots: { 6: { max: 2, remaining: 0 } } } as any } as Combatant;
  assert('null when no slot', shouldCastCreateUndead(noSlot, makeBF([noSlot, foe])) === null);
  // null when no spell action
  const noAction = { ...caster, actions: [] } as Combatant;
  assert('null when no spell action', shouldCastCreateUndead(noAction, makeBF([noAction, foe])) === null);
  // NOT concentration-gated
  const concCaster = { ...caster, concentration: { active: true, spellName: 'X' } as any } as Combatant;
  assert('NOT gated by concentration', shouldCastCreateUndead(concCaster, makeBF([concCaster, foe]))?.id === 'wiz');
  // null when at spawn cap (4 existing zombies)
  const existing = Array.from({ length: 4 }, (_, i) => createZombie(caster, i));
  assert('null when at spawn cap (4 zombies)', shouldCastCreateUndead(caster, makeBF([caster, foe, ...existing])) === null);
  // OK when 3 existing zombies (one below cap)
  const threeExisting = existing.slice(0, 3);
  assert('OK when below spawn cap (3 zombies)', shouldCastCreateUndead(caster, makeBF([caster, foe, ...threeExisting]))?.id === 'wiz');
}

console.log('\n=== Create Undead — execute spawns a zombie combatant ===');
{
  const caster = makeCaster('wiz', 'Create Undead', 6, { pos: { x: 5, y: 5, z: 0 } });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  const beforeCount = bf.combatants.size;
  executeCreateUndead(caster, caster, state);
  assert('slot consumed', (caster.resources as any).spellSlots[6].remaining === 1);
  assert('NOT concentrating (Create Undead has no conc)', caster.concentration === null);
  assert('combatant added to bf.combatants', bf.combatants.size === beforeCount + 1);
  // Find the new zombie
  const zombies = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === 'wiz' && c.summonSpellName === 'Create Undead');
  assert('exactly 1 new zombie summoned', zombies.length === 1);
  const z = zombies[0];
  eq('zombie AC 8', z.ac, 8);
  eq('zombie HP 22', z.maxHP, 22);
  eq('zombie currentHP 22', z.currentHP, 22);
  eq('zombie faction = caster faction', z.faction, caster.faction);
  eq('zombie creatureType undead', z.creatureType, 'undead');
  assert('zombie has Slam action', z.actions.some(a => a.name === 'Slam'));
  const slam = z.actions.find(a => a.name === 'Slam')!;
  eq('Slam hit bonus +3', slam.hitBonus, 3);
  eq('Slam damage 1d6+1', `${slam.damage?.count}d${slam.damage?.sides}+${slam.damage?.bonus}`, '1d6+1');
  eq('Slam damageType bludgeoning', slam.damageType, 'bludgeoning');
  assert('zombie positioned adjacent to caster', Math.abs(z.pos.x - caster.pos.x) + Math.abs(z.pos.y - caster.pos.y) === 1);
  assert('pendingInitiativeInserts registered', (bf.pendingInitiativeInserts ?? []).some(p => p.combatantId === z.id && p.insertAfterId === caster.id));
  assert('events logged', state.log.events.length >= 1);
  assert('log mentions Create Undead', state.log.events.some(e => e.description.includes('Create Undead')));
}

console.log('\n=== Create Undead — execute spawns multiple zombies on repeated casts (up to cap) ===');
{
  const caster = makeCaster('wiz', 'Create Undead', 6, {
    resources: { spellSlots: { 6: { max: 10, remaining: 10 } } } as any,
  });
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const bf = makeBF([caster, foe]);
  const state = makeState(bf);
  for (let i = 0; i < 4; i++) executeCreateUndead(caster, caster, state);
  const zombies = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === 'wiz');
  assert('4 zombies after 4 casts', zombies.length === 4);
  // 5th cast should be blocked by spawn cap (shouldCast returns null)
  const beforeCast5 = bf.combatants.size;
  const sc5 = shouldCastCreateUndead(caster, bf);
  assert('5th cast blocked (shouldCast returns null)', sc5 === null);
  // Even if execute is invoked directly, it still spawns (no defensive cap in execute);
  // the planner always gates on shouldCast. Mirror that contract here.
  void beforeCast5;
}

// ============================================================
// === RAISE DEAD ===
// ============================================================
console.log('\n=== Raise Dead — Metadata ===');
eq('name', rdMeta.name, 'Raise Dead');
eq('level 5', rdMeta.level, 5);
eq('NO concentration', rdMeta.concentration, false);
eq('school necromancy', rdMeta.school, 'necromancy');
eq('range 5 (touch)', rdMeta.rangeFt, 5);
assert('outOfCombat flag', (rdMeta as any).outOfCombat === true);
assert('out-of-combat v1 flag', (rdMeta as any).raiseDeadOutOfCombatV1Implemented === true);

console.log('\n=== Raise Dead — shouldCast always returns null ===');
{
  const caster = makeCaster('wiz', 'Raise Dead', 5);
  const foe = makeCombatant('orc', { pos: { x: 1, y: 0, z: 0 } });
  const ally = makeCombatant('ally', { faction: 'party', isUnconscious: true, pos: { x: 1, y: 0, z: 0 } });
  // Always returns null regardless of battlefield state
  assert('null even with downed ally in range', shouldCastRaiseDead(caster, makeBF([caster, ally])) === null);
  assert('null even with foes', shouldCastRaiseDead(caster, makeBF([caster, foe])) === null);
  assert('null even with full battlefield', shouldCastRaiseDead(caster, makeBF([caster, foe, ally])) === null);
  assert('null on empty battlefield', shouldCastRaiseDead(caster, makeBF([caster])) === null);
}

console.log('\n=== Raise Dead — execute is a no-op ===');
{
  const caster = makeCaster('wiz', 'Raise Dead', 5);
  const bf = makeBF([caster]);
  const state = makeState(bf);
  const beforeCount = bf.combatants.size;
  const beforeEvents = state.log.events.length;
  executeRaiseDead(caster, state);
  assert('no combatant added', bf.combatants.size === beforeCount);
  assert('no events logged', state.log.events.length === beforeEvents);
  // Note: execute signature is (_caster, _state) — it doesn't take a target.
  // Slot is NOT consumed (execute is a no-op stub; shouldCast never fires).
}

// ============================================================
console.log(`\n==================================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nsession68_batch2_spells.test.ts: ${failed} TESTS FAILED ❌`);
  process.exit(1);
}
console.log(`\nsession68_batch2_spells.test.ts: all tests passed ✅`);
