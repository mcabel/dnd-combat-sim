// ============================================================
// conjure_elemental.test.ts — Conjure Elemental (PHB p.225)
// 5th-level conjuration, action, range 90 ft, concentration 1 hr.
// Effect: Spawns 1 Fire Elemental combatant (v1: hardcoded default).
//         Unlike the L4 Conjure spells, Conjure Elemental summons a
//         single elemental whose CR scales with slot level (CR 5 at L5,
//         CR 6 at L6, ..., CR 9 at L9). v1 always spawns the Fire
//         Elemental stat block (CR 5, valid for any L5+ slot).
//         The elemental disappears on concentration break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, fire elemental stats, multiattack, upcast behaviour,
// and CR picker option table.
// ============================================================

import { shouldCast, execute, metadata, createFireElemental } from '../spells/conjure_elemental';
import {
  CONJURE_ELEMENTAL_OPTIONS,
  DEFAULT_CE_OPTION,
} from '../summons/cr_picker';
import { removeEffectsFromCaster } from '../engine/spell_effects';
import { Combatant, Action, PlayerResources, Vec3 } from '../types/core';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function withSlots5(remaining = 1): PlayerResources {
  return { spellSlots: { 5: { max: 1, remaining } } };
}

function withSlots5And6(remaining5 = 1, remaining6 = 1): PlayerResources {
  return { spellSlots: {
    5: { max: 1, remaining: remaining5 },
    6: { max: 1, remaining: remaining6 },
  } };
}

const CE_ACTION: Action = {
  name: 'Conjure Elemental',
  isMultiattack: false,
  attackType: 'save',
  reach: 90,
  range: { normal: 90, long: 90 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 15,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 5,
  costType: 'action',
  legendaryCost: 0,
  description: 'Conjure Elemental (concentration 1 hr)',
};

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 100, currentHP: 100, ac: 14, speed: 30,
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

function makeBF(combatants: Combatant[]) {
  return {
    width: 20, height: 20, depth: 1,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Caster with Conjure Elemental action + 5th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Druid',
    pos,
    actions: [CE_ACTION],
    resources: withSlots5(1),
  });
}

/** Enemy for battlefield context */
function makeEnemy(id: string = 'enemy1', pos: Vec3 = { x: 5, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: id,
    faction: 'enemy',
    pos,
  });
}

// ============================================================
// 1. Metadata
// ============================================================

console.log('\n=== 1. Metadata ===\n');

eq('name is Conjure Elemental', metadata.name, 'Conjure Elemental');
eq('level is 5', metadata.level, 5);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 90 ft', metadata.rangeFt, 90);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
assert('conjureElementalV1Implemented is true', metadata.conjureElementalV1Implemented === true);
eq('v1DefaultCreature is Fire Elemental', (metadata as any).v1DefaultCreature, 'Fire Elemental');
assert('v1DefaultOption mentions L5', (metadata as any).v1DefaultOption.includes('L5'));
assert('conjureElementalUpcastV1Implemented is true', (metadata as any).conjureElementalUpcastV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Conjure Elemental' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Conjure Elemental action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 5th-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots5(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 5th-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. Caster is already concentrating
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Wall of Fire', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster already has a Conjure Elemental active (cap at 1)
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummon = makeCombatant('existing_fe', {
    name: `Fire Elemental (${caster.name})`,
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Conjure Elemental',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Conjure Elemental active', shouldCast(caster, bf) === false);
}

{
  // 2e. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createFireElemental — combatant creation
// ============================================================

console.log('\n=== 3. createFireElemental — combatant creation ===\n');

{
  const caster = makeCaster();
  const fe = createFireElemental(caster, 5);

  eq('Fire Elemental isSummon is true', fe.isSummon, true);
  eq('Fire Elemental summonerId matches caster', fe.summonerId, 'caster1');
  eq('Fire Elemental summonSpellName is Conjure Elemental', fe.summonSpellName, 'Conjure Elemental');
  eq('Fire Elemental faction matches caster', fe.faction, 'party');
  assert('Fire Elemental name includes Fire Elemental', fe.name.includes('Fire Elemental'));
  assert('Fire Elemental name includes caster name', fe.name.includes('Druid'));
  eq('Fire Elemental HP is 102', fe.maxHP, 102);
  eq('Fire Elemental currentHP equals maxHP', fe.currentHP, fe.maxHP);
  eq('Fire Elemental AC is 13', fe.ac, 13);
  eq('Fire Elemental aiProfile is attackNearest', fe.aiProfile, 'attackNearest');
  eq('Fire Elemental speed is 50', fe.speed, 50);
  eq('Fire Elemental STR is 10', fe.str, 10);
  eq('Fire Elemental DEX is 17', fe.dex, 17);
  eq('Fire Elemental CON is 16', fe.con, 16);
  eq('Fire Elemental INT is 6', fe.int, 6);
  eq('Fire Elemental WIS is 10', fe.wis, 10);
  eq('Fire Elemental CHA is 7', fe.cha, 7);
  eq('Fire Elemental CR is 5', fe.cr, 5);

  // Multiattack: 2 Touch attacks
  eq('Fire Elemental has 2 attack actions (Multiattack)', fe.actions.length, 2);
  eq('Action 0 name is Touch (1/2)', fe.actions[0].name, 'Touch (1/2)');
  eq('Action 1 name is Touch (2/2)', fe.actions[1].name, 'Touch (2/2)');

  // Touch attack details
  const touch = fe.actions[0];
  eq('Touch attackType is melee', touch.attackType, 'melee');
  eq('Touch reach is 5', touch.reach, 5);
  eq('Touch hitBonus is +6', touch.hitBonus, 6);
  assert('Touch damage 2d6+3', touch.damage!.count === 2 && touch.damage!.sides === 6 && touch.damage!.bonus === 3);
  eq('Touch damageType is fire', touch.damageType, 'fire');
  eq('Touch isMultiattack is true', touch.isMultiattack, true);

  // Traits (Fire Form, Ignite, Water Susceptibility — documented even if not modelled)
  eq('Fire Elemental has 3 traits', fe.traits.length, 3);
  assert('Has Fire Form trait', fe.traits.includes('Fire Form'));
  assert('Has Ignite trait', fe.traits.includes('Ignite'));
  assert('Has Water Susceptibility trait', fe.traits.includes('Water Susceptibility (half speed in water)'));

  // Position: adjacent to caster (1 square away)
  eq('Fire Elemental pos.x is caster.pos.x + 1', fe.pos.x, 1);
  eq('Fire Elemental pos.y is caster.pos.y', fe.pos.y, 0);

  // hasHands false (Fire Elemental is a bodyless elemental)
  eq('Fire Elemental hasHands is false', fe.hasHands, false);

  // ID is unique
  const fe2 = createFireElemental(caster, 5);
  assert('Fire Elemental IDs are unique', fe.id !== fe2.id);
}

// ============================================================
// 4. execute — creates summon and adds to battlefield
// ============================================================

console.log('\n=== 4. execute — creates summon and adds to battlefield ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Find the Fire Elemental in the battlefield
  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Elemental');
  eq('1 Fire Elemental added to battlefield', summons.length, 1);

  if (summons.length === 1) {
    const fe = summons[0];
    eq('Fire Elemental isSummon is true', fe.isSummon, true);
    eq('Fire Elemental summonerId is caster', fe.summonerId, 'caster1');
    eq('Fire Elemental summonSpellName is Conjure Elemental', fe.summonSpellName, 'Conjure Elemental');
    eq('Fire Elemental faction matches caster', fe.faction, 'party');
    eq('Fire Elemental HP is 102', fe.maxHP, 102);
    eq('Fire Elemental AC is 13', fe.ac, 13);
    eq('Fire Elemental CR is 5', fe.cr, 5);
  }

  // Caster is concentrating on Conjure Elemental
  eq('Caster concentrating on Conjure Elemental', caster.concentration?.spellName, 'Conjure Elemental');
  eq('Caster concentration is active', caster.concentration?.active, true);

  // Slot consumed
  eq('Slot consumed (0 remaining)', caster.resources!.spellSlots![5]!.remaining, 0);
}

// ============================================================
// 5. execute — pendingInitiativeInserts
// ============================================================

console.log('\n=== 5. execute — pendingInitiativeInserts ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  assert('pendingInitiativeInserts exists', Array.isArray(bf.pendingInitiativeInserts));
  if (Array.isArray(bf.pendingInitiativeInserts)) {
    eq('1 pending insert', bf.pendingInitiativeInserts.length, 1);
    if (bf.pendingInitiativeInserts.length >= 1) {
      eq('insert 0 insertAfterId is caster id', bf.pendingInitiativeInserts[0].insertAfterId, 'caster1');

      const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Elemental');
      if (summons.length === 1) {
        eq('insert 0 combatantId is the Fire Elemental', bf.pendingInitiativeInserts[0].combatantId, summons[0].id);
      }
    }
  }
}

// ============================================================
// 6. Concentration break despawns the elemental
// ============================================================

console.log('\n=== 6. Concentration break despawns the elemental ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify elemental exists
  const summonsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Elemental');
  eq('1 Fire Elemental exists before concentration break', summonsBefore.length, 1);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify elemental is removed
  const summonsAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Elemental');
  eq('Fire Elemental removed after concentration break', summonsAfter.length, 0);
}

// ============================================================
// 7. Fire Elemental stats correctness (comprehensive)
// ============================================================

console.log('\n=== 7. Fire Elemental stats correctness (comprehensive) ===\n');

{
  const caster = makeCaster('druid1', { x: 3, y: 3, z: 0 });
  const fe = createFireElemental(caster, 5);

  // Core stats
  eq('AC 13', fe.ac, 13);
  eq('HP 102', fe.maxHP, 102);
  eq('currentHP = maxHP', fe.currentHP, fe.maxHP);
  eq('Speed 50', fe.speed, 50);
  eq('No fly speed', fe.flySpeed, null);
  eq('No swim speed', fe.swimSpeed, null);
  eq('No burrow speed', fe.burrowSpeed, null);

  // Ability scores (MM p.125)
  eq('STR 10', fe.str, 10);
  eq('DEX 17', fe.dex, 17);
  eq('CON 16', fe.con, 16);
  eq('INT 6', fe.int, 6);
  eq('WIS 10', fe.wis, 10);
  eq('CHA 7', fe.cha, 7);

  // CR
  eq('CR 5', fe.cr, 5);

  // Touch attack details (both attacks should have identical stats)
  for (let i = 0; i < 2; i++) {
    const touch = fe.actions[i];
    eq(`Touch ${i} attackType is melee`, touch.attackType, 'melee');
    eq(`Touch ${i} reach is 5`, touch.reach, 5);
    eq(`Touch ${i} hitBonus +6`, touch.hitBonus, 6);
    assert(`Touch ${i} damage 2d6+3`, touch.damage!.count === 2 && touch.damage!.sides === 6 && touch.damage!.bonus === 3);
    eq(`Touch ${i} average damage is 10`, touch.damage!.average, 10);
    eq(`Touch ${i} damageType fire`, touch.damageType, 'fire');
    eq(`Touch ${i} costType action`, touch.costType, 'action');
    eq(`Touch ${i} isMultiattack true`, touch.isMultiattack, true);
  }

  // Summon fields
  eq('isSummon true', fe.isSummon, true);
  eq('summonerId is druid1', fe.summonerId, 'druid1');
  eq('summonSpellName is Conjure Elemental', fe.summonSpellName, 'Conjure Elemental');

  // Position adjacent to caster
  eq('Position x = caster.x + 1', fe.pos.x, 4);
  eq('Position y = caster.y', fe.pos.y, 3);
  assert('Fire Elemental positioned adjacent to caster',
    Math.abs(fe.pos.x - caster.pos.x) + Math.abs(fe.pos.y - caster.pos.y) <= 2
  );

  // hasHands false (Fire Elemental is a bodyless elemental)
  eq('hasHands false', fe.hasHands, false);
}

// ============================================================
// 8. Upcast — slot level scales but stat block stays the same in v1
// ============================================================

console.log('\n=== 8. Upcast — slot level scales but stat block stays the same in v1 ===\n');

{
  // v1 always spawns the Fire Elemental stat block (CR 5) regardless of slot level.
  // The slot level is consumed correctly; the CR 5 stat block is valid for any L5+ slot.

  // L5 cast (default)
  const caster5 = makeCaster('c5');
  caster5.resources = withSlots5And6(1, 1);
  const bf5 = makeBF([caster5, makeEnemy('e5')]);
  const state5 = makeState(bf5);
  execute(caster5, caster5, state5);
  const fe5 = [...bf5.combatants.values()].find(c => c.isSummon && c.summonerId === caster5.id);
  assert('L5 cast: Fire Elemental spawned', !!fe5);
  if (fe5) {
    eq('L5 cast: HP is 102 (Fire Elemental)', fe5.maxHP, 102);
    eq('L5 cast: AC is 13', fe5.ac, 13);
    eq('L5 cast: CR is 5', fe5.cr, 5);
  }
  eq('L5 cast: 5th-level slot consumed', caster5.resources!.spellSlots![5]!.remaining, 0);
  eq('L5 cast: 6th-level slot untouched', caster5.resources!.spellSlots![6]!.remaining, 1);

  // Cast log mentions slot level
  const events5 = state5.log.events as any[];
  const actionEvents5 = events5.filter((e: any) => e.type === 'action');
  assert('L5 cast log mentions slot L5', actionEvents5.length > 0 && actionEvents5[0].description.includes('L5'));

  // L6 upcast: still spawns Fire Elemental (v1 simplification), but consumes L5 first
  // because consumeSpellSlot() finds the lowest available L5+ slot.
  const caster6 = makeCaster('c6');
  caster6.resources = withSlots5And6(0, 1); // L5 exhausted, L6 available
  const bf6 = makeBF([caster6, makeEnemy('e6')]);
  const state6 = makeState(bf6);
  execute(caster6, caster6, state6);
  const fe6 = [...bf6.combatants.values()].find(c => c.isSummon && c.summonerId === caster6.id);
  assert('L6 upcast: Fire Elemental spawned', !!fe6);
  if (fe6) {
    eq('L6 upcast: HP is still 102 (v1 simplification)', fe6.maxHP, 102);
    eq('L6 upcast: CR is still 5 (v1 simplification)', fe6.cr, 5);
  }
  eq('L6 upcast: 6th-level slot consumed', caster6.resources!.spellSlots![6]!.remaining, 0);

  // L6 cast log mentions slot L6
  const events6 = state6.log.events as any[];
  const actionEvents6 = events6.filter((e: any) => e.type === 'action');
  assert('L6 upcast log mentions slot L6', actionEvents6.length > 0 && actionEvents6[0].description.includes('L6'));
}

// ============================================================
// 9. CR Picker — Conjure Elemental options table
// ============================================================

console.log('\n=== 9. CR Picker — Conjure Elemental options table ===\n');

eq('5 options defined (L5-L9)', CONJURE_ELEMENTAL_OPTIONS.length, 5);
eq('Option 0: L5, CR 5', CONJURE_ELEMENTAL_OPTIONS[0].slotLevel, 5);
eq('Option 0: maxCR 5', CONJURE_ELEMENTAL_OPTIONS[0].maxCR, 5);
eq('Option 1: L6, CR 6', CONJURE_ELEMENTAL_OPTIONS[1].slotLevel, 6);
eq('Option 1: maxCR 6', CONJURE_ELEMENTAL_OPTIONS[1].maxCR, 6);
eq('Option 2: L7, CR 7', CONJURE_ELEMENTAL_OPTIONS[2].slotLevel, 7);
eq('Option 2: maxCR 7', CONJURE_ELEMENTAL_OPTIONS[2].maxCR, 7);
eq('Option 3: L8, CR 8', CONJURE_ELEMENTAL_OPTIONS[3].slotLevel, 8);
eq('Option 3: maxCR 8', CONJURE_ELEMENTAL_OPTIONS[3].maxCR, 8);
eq('Option 4: L9, CR 9', CONJURE_ELEMENTAL_OPTIONS[4].slotLevel, 9);
eq('Option 4: maxCR 9', CONJURE_ELEMENTAL_OPTIONS[4].maxCR, 9);
eq('Default option is L5 (CR 5)', DEFAULT_CE_OPTION.slotLevel, 5);
eq('Default option maxCR 5', DEFAULT_CE_OPTION.maxCR, 5);

// Verify maxCR = slotLevel invariant (per PHB p.225)
for (let i = 0; i < CONJURE_ELEMENTAL_OPTIONS.length; i++) {
  const opt = CONJURE_ELEMENTAL_OPTIONS[i];
  eq(`Option ${i}: maxCR equals slotLevel`, opt.maxCR, opt.slotLevel);
}

// ============================================================
// 10. execute — logging
// ============================================================

console.log('\n=== 10. execute — logging ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  const events = state.log.events as any[];
  const actionEvents = events.filter((e: any) => e.type === 'action');

  assert('At least 1 action event (cast log)', actionEvents.length >= 1);
  if (actionEvents.length >= 1) {
    assert('Action event mentions "Conjure Elemental"', actionEvents[0].description.includes('Conjure Elemental'));
    assert('Action event mentions "Fire Elemental"', actionEvents[0].description.includes('Fire Elemental'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
    assert('Action event mentions AC', actionEvents[0].description.includes('AC'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
