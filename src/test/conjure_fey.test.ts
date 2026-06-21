// ============================================================
// conjure_fey.test.ts — Conjure Fey (PHB p.226)
// 6th-level conjuration, action, range 90 ft, concentration 1 hr.
// Effect: Spawns 1 Green Hag combatant (v1: hardcoded default).
//         Unlike the L4 Conjure spells, Conjure Fey summons a single
//         fey whose CR scales with slot level (CR 6 at L6, CR 7 at L7,
//         ..., CR 9 at L9). v1 always spawns the Green Hag stat block
//         (CR 3 — the highest-CR fey in MM, valid for any L6+ slot).
//         The fey disappears on concentration break or 0 HP.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, green hag stats, upcast behaviour, and CR picker
// option table.
// ============================================================

import { shouldCast, execute, metadata, createGreenHag } from '../spells/conjure_fey';
import {
  CONJURE_FEY_OPTIONS,
  DEFAULT_CF_OPTION,
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

function withSlots6(remaining = 1): PlayerResources {
  return { spellSlots: { 6: { max: 1, remaining } } };
}

function withSlots6And7(remaining6 = 1, remaining7 = 1): PlayerResources {
  return { spellSlots: {
    6: { max: 1, remaining: remaining6 },
    7: { max: 1, remaining: remaining7 },
  } };
}

const CF_ACTION: Action = {
  name: 'Conjure Fey',
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
  slotLevel: 6,
  costType: 'action',
  legendaryCost: 0,
  description: 'Conjure Fey (concentration 1 hr)',
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

/** Caster with Conjure Fey action + 6th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Druid',
    pos,
    actions: [CF_ACTION],
    resources: withSlots6(1),
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

eq('name is Conjure Fey', metadata.name, 'Conjure Fey');
eq('level is 6', metadata.level, 6);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 90 ft', metadata.rangeFt, 90);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
assert('conjureFeyV1Implemented is true', metadata.conjureFeyV1Implemented === true);
eq('v1DefaultCreature is Green Hag', (metadata as any).v1DefaultCreature, 'Green Hag');
assert('v1DefaultOption mentions L6', (metadata as any).v1DefaultOption.includes('L6'));
assert('conjureFeyUpcastV1Implemented is true', (metadata as any).conjureFeyUpcastV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Conjure Fey' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Conjure Fey action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 6th-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots6(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 6th-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. Caster is already concentrating
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Heroes Feast', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster already has a Conjure Fey active (cap at 1)
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummon = makeCombatant('existing_hag', {
    name: `Green Hag (${caster.name})`,
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Conjure Fey',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Conjure Fey active', shouldCast(caster, bf) === false);
}

{
  // 2e. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createGreenHag — combatant creation
// ============================================================

console.log('\n=== 3. createGreenHag — combatant creation ===\n');

{
  const caster = makeCaster();
  const hag = createGreenHag(caster, 6);

  eq('Green Hag isSummon is true', hag.isSummon, true);
  eq('Green Hag summonerId matches caster', hag.summonerId, 'caster1');
  eq('Green Hag summonSpellName is Conjure Fey', hag.summonSpellName, 'Conjure Fey');
  eq('Green Hag faction matches caster', hag.faction, 'party');
  assert('Green Hag name includes Green Hag', hag.name.includes('Green Hag'));
  assert('Green Hag name includes caster name', hag.name.includes('Druid'));
  eq('Green Hag HP is 82', hag.maxHP, 82);
  eq('Green Hag currentHP equals maxHP', hag.currentHP, hag.maxHP);
  eq('Green Hag AC is 17', hag.ac, 17);
  eq('Green Hag aiProfile is attackNearest', hag.aiProfile, 'attackNearest');
  eq('Green Hag speed is 30', hag.speed, 30);
  eq('Green Hag swimSpeed is 30 (Amphibious)', hag.swimSpeed, 30);
  eq('Green Hag STR is 18', hag.str, 18);
  eq('Green Hag DEX is 12', hag.dex, 12);
  eq('Green Hag CON is 16', hag.con, 16);
  eq('Green Hag INT is 13', hag.int, 13);
  eq('Green Hag WIS is 14', hag.wis, 14);
  eq('Green Hag CHA is 14', hag.cha, 14);
  eq('Green Hag CR is 3', hag.cr, 3);

  // Attack actions (Session 32: Hag now has 2 — Claws + innate Vicious Mockery)
  eq('Green Hag has 2 attack actions (Claws + Vicious Mockery)', hag.actions.length, 2);
  eq('Green Hag attack 0 is Claws', hag.actions[0].name, 'Claws');
  eq('Green Hag attack 1 is Vicious Mockery (innate)', hag.actions[1].name, 'Vicious Mockery');
  eq('Vicious Mockery saveDC 12 (Hag innate DC)', hag.actions[1].saveDC, 12);
  eq('Vicious Mockery saveAbility wis', hag.actions[1].saveAbility, 'wis');
  eq('Vicious Mockery damageType psychic', hag.actions[1].damageType, 'psychic');
  eq('Vicious Mockery range 60 ft', hag.actions[1].range!.normal, 60);
  eq('Green Hag attack hitBonus is +6', hag.actions[0].hitBonus, 6);
  assert('Green Hag attack damage 2d8+4', hag.actions[0].damage!.count === 2 && hag.actions[0].damage!.sides === 8 && hag.actions[0].damage!.bonus === 4);
  eq('Green Hag attack damageType is slashing', hag.actions[0].damageType, 'slashing');

  // Traits (Amphibious, Mimicry, Illusory Appearance, Invisible Passage, Innate Spellcasting)
  eq('Green Hag has 5 traits', hag.traits.length, 5);
  assert('Has Amphibious trait', hag.traits.includes('Amphibious'));
  assert('Has Mimicry trait', hag.traits.includes('Mimicry'));
  assert('Has Illusory Appearance trait', hag.traits.includes('Illusory Appearance'));
  assert('Has Invisible Passage trait', hag.traits.includes('Invisible Passage'));
  assert('Has Innate Spellcasting trait', hag.traits.some((t: string) => t.startsWith('Innate Spellcasting')));

  // Position: adjacent to caster (1 square away)
  eq('Green Hag pos.x is caster.pos.x + 1', hag.pos.x, 1);
  eq('Green Hag pos.y is caster.pos.y', hag.pos.y, 0);

  // hasHands true (Hag has claws)
  eq('Green Hag hasHands is true', hag.hasHands, true);

  // wearingArmor false (natural armor, not worn)
  eq('Green Hag wearingArmor is false (natural armor)', hag.wearingArmor, false);

  // ID is unique
  const hag2 = createGreenHag(caster, 6);
  assert('Green Hag IDs are unique', hag.id !== hag2.id);
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

  // Find the Green Hag in the battlefield
  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Fey');
  eq('1 Green Hag added to battlefield', summons.length, 1);

  if (summons.length === 1) {
    const hag = summons[0];
    eq('Green Hag isSummon is true', hag.isSummon, true);
    eq('Green Hag summonerId is caster', hag.summonerId, 'caster1');
    eq('Green Hag summonSpellName is Conjure Fey', hag.summonSpellName, 'Conjure Fey');
    eq('Green Hag faction matches caster', hag.faction, 'party');
    eq('Green Hag HP is 82', hag.maxHP, 82);
    eq('Green Hag AC is 17', hag.ac, 17);
    eq('Green Hag CR is 3', hag.cr, 3);
  }

  // Caster is concentrating on Conjure Fey
  eq('Caster concentrating on Conjure Fey', caster.concentration?.spellName, 'Conjure Fey');
  eq('Caster concentration is active', caster.concentration?.active, true);

  // Slot consumed
  eq('Slot consumed (0 remaining)', caster.resources!.spellSlots![6]!.remaining, 0);
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

      const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Fey');
      if (summons.length === 1) {
        eq('insert 0 combatantId is the Green Hag', bf.pendingInitiativeInserts[0].combatantId, summons[0].id);
      }
    }
  }
}

// ============================================================
// 6. Concentration break despawns the fey
// ============================================================

console.log('\n=== 6. Concentration break despawns the fey ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify fey exists
  const summonsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Fey');
  eq('1 Green Hag exists before concentration break', summonsBefore.length, 1);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify fey is removed
  const summonsAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Fey');
  eq('Green Hag removed after concentration break', summonsAfter.length, 0);
}

// ============================================================
// 7. Green Hag stats correctness (comprehensive)
// ============================================================

console.log('\n=== 7. Green Hag stats correctness (comprehensive) ===\n');

{
  const caster = makeCaster('druid1', { x: 3, y: 3, z: 0 });
  const hag = createGreenHag(caster, 6);

  // Core stats
  eq('AC 17', hag.ac, 17);
  eq('HP 82', hag.maxHP, 82);
  eq('currentHP = maxHP', hag.currentHP, hag.maxHP);
  eq('Speed 30', hag.speed, 30);
  eq('No fly speed', hag.flySpeed, null);
  eq('Swim speed 30 (Amphibious)', hag.swimSpeed, 30);
  eq('No burrow speed', hag.burrowSpeed, null);

  // Ability scores (MM p.177)
  eq('STR 18', hag.str, 18);
  eq('DEX 12', hag.dex, 12);
  eq('CON 16', hag.con, 16);
  eq('INT 13', hag.int, 13);
  eq('WIS 14', hag.wis, 14);
  eq('CHA 14', hag.cha, 14);

  // CR
  eq('CR 3', hag.cr, 3);

  // Claws attack details
  const claws = hag.actions[0];
  eq('Claws attackType is melee', claws.attackType, 'melee');
  eq('Claws reach is 5', claws.reach, 5);
  eq('Claws hitBonus +6', claws.hitBonus, 6);
  assert('Claws damage 2d8+4', claws.damage!.count === 2 && claws.damage!.sides === 8 && claws.damage!.bonus === 4);
  eq('Claws average damage is 13', claws.damage!.average, 13);
  eq('Claws damageType slashing', claws.damageType, 'slashing');
  eq('Claws costType action', claws.costType, 'action');

  // Summon fields
  eq('isSummon true', hag.isSummon, true);
  eq('summonerId is druid1', hag.summonerId, 'druid1');
  eq('summonSpellName is Conjure Fey', hag.summonSpellName, 'Conjure Fey');

  // Position adjacent to caster
  eq('Position x = caster.x + 1', hag.pos.x, 4);
  eq('Position y = caster.y', hag.pos.y, 3);
  assert('Green Hag positioned adjacent to caster',
    Math.abs(hag.pos.x - caster.pos.x) + Math.abs(hag.pos.y - caster.pos.y) <= 2
  );

  // hasHands true (Hag has claws)
  eq('hasHands true', hag.hasHands, true);
  // wearingArmor false (natural armor, not worn)
  eq('wearingArmor false (natural armor)', hag.wearingArmor, false);
}

// ============================================================
// 8. Upcast — slot level scales but stat block stays the same in v1
// ============================================================

console.log('\n=== 8. Upcast — slot level scales but stat block stays the same in v1 ===\n');

{
  // v1 always spawns the Green Hag stat block (CR 3) regardless of slot level.
  // The slot level is consumed correctly; the CR 3 stat block is valid for any L6+ slot.

  // L6 cast (default)
  const caster6 = makeCaster('c6');
  caster6.resources = withSlots6And7(1, 1);
  const bf6 = makeBF([caster6, makeEnemy('e6')]);
  const state6 = makeState(bf6);
  execute(caster6, caster6, state6);
  const hag6 = [...bf6.combatants.values()].find(c => c.isSummon && c.summonerId === caster6.id);
  assert('L6 cast: Green Hag spawned', !!hag6);
  if (hag6) {
    eq('L6 cast: HP is 82 (Green Hag)', hag6.maxHP, 82);
    eq('L6 cast: AC is 17', hag6.ac, 17);
    eq('L6 cast: CR is 3', hag6.cr, 3);
  }
  eq('L6 cast: 6th-level slot consumed', caster6.resources!.spellSlots![6]!.remaining, 0);
  eq('L6 cast: 7th-level slot untouched', caster6.resources!.spellSlots![7]!.remaining, 1);

  // Cast log mentions slot level
  const events6 = state6.log.events as any[];
  const actionEvents6 = events6.filter((e: any) => e.type === 'action');
  assert('L6 cast log mentions slot L6', actionEvents6.length > 0 && actionEvents6[0].description.includes('L6'));

  // L7 upcast: still spawns Green Hag (v1 simplification), but consumes L6 first
  // because consumeSpellSlot() finds the lowest available L6+ slot.
  const caster7 = makeCaster('c7');
  caster7.resources = withSlots6And7(0, 1); // L6 exhausted, L7 available
  const bf7 = makeBF([caster7, makeEnemy('e7')]);
  const state7 = makeState(bf7);
  execute(caster7, caster7, state7);
  const hag7 = [...bf7.combatants.values()].find(c => c.isSummon && c.summonerId === caster7.id);
  assert('L7 upcast: Green Hag spawned', !!hag7);
  if (hag7) {
    eq('L7 upcast: HP is still 82 (v1 simplification)', hag7.maxHP, 82);
    eq('L7 upcast: CR is still 3 (v1 simplification)', hag7.cr, 3);
  }
  eq('L7 upcast: 7th-level slot consumed', caster7.resources!.spellSlots![7]!.remaining, 0);

  // L7 cast log mentions slot L7
  const events7 = state7.log.events as any[];
  const actionEvents7 = events7.filter((e: any) => e.type === 'action');
  assert('L7 upcast log mentions slot L7', actionEvents7.length > 0 && actionEvents7[0].description.includes('L7'));
}

// ============================================================
// 9. CR Picker — Conjure Fey options table
// ============================================================

console.log('\n=== 9. CR Picker — Conjure Fey options table ===\n');

eq('4 options defined (L6-L9)', CONJURE_FEY_OPTIONS.length, 4);
eq('Option 0: L6, CR 6', CONJURE_FEY_OPTIONS[0].slotLevel, 6);
eq('Option 0: maxCR 6', CONJURE_FEY_OPTIONS[0].maxCR, 6);
eq('Option 1: L7, CR 7', CONJURE_FEY_OPTIONS[1].slotLevel, 7);
eq('Option 1: maxCR 7', CONJURE_FEY_OPTIONS[1].maxCR, 7);
eq('Option 2: L8, CR 8', CONJURE_FEY_OPTIONS[2].slotLevel, 8);
eq('Option 2: maxCR 8', CONJURE_FEY_OPTIONS[2].maxCR, 8);
eq('Option 3: L9, CR 9', CONJURE_FEY_OPTIONS[3].slotLevel, 9);
eq('Option 3: maxCR 9', CONJURE_FEY_OPTIONS[3].maxCR, 9);
eq('Default option is L6 (CR 6)', DEFAULT_CF_OPTION.slotLevel, 6);
eq('Default option maxCR 6', DEFAULT_CF_OPTION.maxCR, 6);

// Verify maxCR = slotLevel invariant (per PHB p.226)
for (let i = 0; i < CONJURE_FEY_OPTIONS.length; i++) {
  const opt = CONJURE_FEY_OPTIONS[i];
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
    assert('Action event mentions "Conjure Fey"', actionEvents[0].description.includes('Conjure Fey'));
    assert('Action event mentions "Green Hag"', actionEvents[0].description.includes('Green Hag'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
    assert('Action event mentions AC', actionEvents[0].description.includes('AC'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
