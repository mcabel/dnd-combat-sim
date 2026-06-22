// ============================================================
// conjure_celestial.test.ts — Conjure Celestial (PHB p.225)
// 7th-level conjuration, action, range 90 ft, concentration 1 hr.
// Effect: Spawns 1 Couatl combatant (v1: hardcoded default).
//         Unlike TCE Summon Celestial (L5, hardcoded scaling stat block),
//         PHB Conjure Celestial (L7) summons a real celestial from the MM
//         by CR. The CR progression is: L7 → CR 4, L8 → CR 5, L9 → CR 6.
//         v1 always spawns the Couatl stat block (CR 4 — the only CR 4
//         celestial in MM, valid for any L7+ slot).
//         The celestial disappears on concentration break or 0 HP.
//
// IMPORTANT: This test is for the PHB L7 spell, NOT the TCE L5 spell.
// The TCE Summon Celestial test lives in summon_celestial.test.ts.
//
// Tests cover: metadata, shouldCast gates, execute combatant creation,
// summon tags, battlefield addition, initiative insertion, concentration
// break despawn, couatl stats (both Bite + Constrict), upcast behaviour,
// and CR picker option table.
// ============================================================

import { shouldCast, execute, metadata, createCouatl } from '../spells/conjure_celestial';
import {
  CONJURE_CELESTIAL_OPTIONS,
  DEFAULT_CC_OPTION,
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

function withSlots7(remaining = 1): PlayerResources {
  return { spellSlots: { 7: { max: 1, remaining } } };
}

function withSlots7And8(remaining7 = 1, remaining8 = 1): PlayerResources {
  return { spellSlots: {
    7: { max: 1, remaining: remaining7 },
    8: { max: 1, remaining: remaining8 },
  } };
}

const CC_ACTION: Action = {
  name: 'Conjure Celestial',
  isMultiattack: false,
  attackType: 'save',
  reach: 90,
  range: { normal: 90, long: 90 },
  hitBonus: null,
  damage: null,
  damageType: null,
  saveDC: 17,
  saveAbility: 'wis',
  isAoE: false,
  isControl: true,
  requiresConcentration: true,
  slotLevel: 7,
  costType: 'action',
  legendaryCost: 0,
  description: 'Conjure Celestial (concentration 1 hr)',
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

/** Caster with Conjure Celestial action + 7th-level slots */
function makeCaster(id: string = 'caster1', pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  return makeCombatant(id, {
    name: 'Cleric',
    pos,
    actions: [CC_ACTION],
    resources: withSlots7(1),
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

eq('name is Conjure Celestial', metadata.name, 'Conjure Celestial');
eq('level is 7', metadata.level, 7);
eq('school is conjuration', metadata.school, 'conjuration');
eq('range is 90 ft', metadata.rangeFt, 90);
eq('is concentration', metadata.concentration, true);
eq('casting time is action', metadata.castingTime, 'action');
assert('conjureCelestialV1Implemented is true', metadata.conjureCelestialV1Implemented === true);
eq('v1DefaultCreature is Couatl', (metadata as any).v1DefaultCreature, 'Couatl');
assert('v1DefaultOption mentions L7', (metadata as any).v1DefaultOption.includes('L7'));
assert('conjureCelestialUpcastV1Implemented is true', (metadata as any).conjureCelestialUpcastV1Implemented === true);

// ============================================================
// 2. shouldCast — precondition gates
// ============================================================

console.log('\n=== 2. shouldCast — precondition gates ===\n');

{
  // 2a. Caster lacks 'Conjure Celestial' action
  const caster = makeCaster();
  caster.actions = [];
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster has no Conjure Celestial action', shouldCast(caster, bf) === false);
}

{
  // 2b. No 7th-level slots remaining
  const caster = makeCaster();
  caster.resources = withSlots7(0);
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when no 7th-level slots', shouldCast(caster, bf) === false);
}

{
  // 2c. Caster is already concentrating
  const caster = makeCaster();
  caster.concentration = { active: true, spellName: 'Etherealness', dcIfHit: 10 };
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns false when caster is already concentrating', shouldCast(caster, bf) === false);
}

{
  // 2d. Caster already has a Conjure Celestial active (cap at 1)
  const caster = makeCaster();
  const enemy = makeEnemy();
  const existingSummon = makeCombatant('existing_couatl', {
    name: `Couatl (${caster.name})`,
    faction: 'party',
    isSummon: true,
    summonerId: caster.id,
    summonSpellName: 'Conjure Celestial',
  });
  const bf = makeBF([caster, enemy, existingSummon]);
  assert('Returns false when caster already has a Conjure Celestial active', shouldCast(caster, bf) === false);
}

{
  // 2e. All conditions met
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  assert('Returns true when all conditions are met', shouldCast(caster, bf) === true);
}

// ============================================================
// 3. createCouatl — combatant creation
// ============================================================

console.log('\n=== 3. createCouatl — combatant creation ===\n');

{
  const caster = makeCaster();
  const couatl = createCouatl(caster, 7);

  eq('Couatl isSummon is true', couatl.isSummon, true);
  eq('Couatl summonerId matches caster', couatl.summonerId, 'caster1');
  eq('Couatl summonSpellName is Conjure Celestial', couatl.summonSpellName, 'Conjure Celestial');
  eq('Couatl faction matches caster', couatl.faction, 'party');
  assert('Couatl name includes Couatl', couatl.name.includes('Couatl'));
  assert('Couatl name includes caster name', couatl.name.includes('Cleric'));
  eq('Couatl HP is 97', couatl.maxHP, 97);
  eq('Couatl currentHP equals maxHP', couatl.currentHP, couatl.maxHP);
  eq('Couatl AC is 19', couatl.ac, 19);
  // Session 41 Task #2: aiProfile switched from 'attackNearest' to 'smart'
  // so the AI planner can invoke shouldCastBless / shouldCastCureWounds
  // via the innate spellcasting pipeline.
  eq('Couatl aiProfile is smart (Session 41 innate spellcasting)', couatl.aiProfile, 'smart');
  eq('Couatl speed is 30', couatl.speed, 30);
  eq('Couatl flySpeed is 90', couatl.flySpeed, 90);
  eq('Couatl STR is 16', couatl.str, 16);
  eq('Couatl DEX is 20', couatl.dex, 20);
  eq('Couatl CON is 17', couatl.con, 17);
  eq('Couatl INT is 18', couatl.int, 18);
  eq('Couatl WIS is 20', couatl.wis, 20);
  eq('Couatl CHA is 18', couatl.cha, 18);
  eq('Couatl CR is 4', couatl.cr, 4);

  // Attack + Innate Spell Actions (Session 41 Task #2):
  //   - Bite (poison/unconscious)
  //   - Constrict (grapple/restrain)
  //   - Bless (innate 3/day, concentration buff)
  //   - Cure Wounds (innate 3/day, heal)
  //   - Sanctuary (innate 3/day, bonus-action ward)
  eq('Couatl has 5 actions (2 attacks + 3 innate spells)', couatl.actions.length, 5);
  eq('Couatl first action is Bite (primary)', couatl.actions[0].name, 'Bite');
  eq('Couatl second action is Constrict', couatl.actions[1].name, 'Constrict');
  eq('Couatl third action is Bless (innate)', couatl.actions[2].name, 'Bless');
  eq('Couatl fourth action is Cure Wounds (innate)', couatl.actions[3].name, 'Cure Wounds');
  eq('Couatl fifth action is Sanctuary (innate)', couatl.actions[4].name, 'Sanctuary');

  // Bite (primary, melee)
  const bite = couatl.actions[0];
  eq('Bite attackType is melee', bite.attackType, 'melee');
  eq('Bite reach is 5', bite.reach, 5);
  eq('Bite hitBonus is +8', bite.hitBonus, 8);
  assert('Bite damage 1d6+5', bite.damage!.count === 1 && bite.damage!.sides === 6 && bite.damage!.bonus === 5);
  eq('Bite damageType piercing', bite.damageType, 'piercing');
  eq('Bite saveDC 13 (poisoned/unconscious)', bite.saveDC, 13);
  eq('Bite saveAbility con', bite.saveAbility, 'con');

  // Constrict (secondary, melee)
  const constrict = couatl.actions[1];
  eq('Constrict attackType is melee', constrict.attackType, 'melee');
  eq('Constrict reach is 10', constrict.reach, 10);
  eq('Constrict hitBonus is +6', constrict.hitBonus, 6);
  assert('Constrict damage 2d6+3', constrict.damage!.count === 2 && constrict.damage!.sides === 6 && constrict.damage!.bonus === 3);
  eq('Constrict damageType bludgeoning', constrict.damageType, 'bludgeoning');
  eq('Constrict saveDC 15 (grappled+restrained)', constrict.saveDC, 15);
  eq('Constrict saveAbility str', constrict.saveAbility, 'str');
  eq('Constrict isControl true', constrict.isControl, true);

  // Traits (Magic Weapons, Shielded Mind, Innate Spellcasting, Change Shape, Truesight, Immunities)
  eq('Couatl has 7 traits', couatl.traits.length, 7);
  assert('Has Magic Weapons trait', couatl.traits.includes('Magic Weapons'));
  assert('Has Shielded Mind trait', couatl.traits.includes('Shielded Mind'));
  assert('Has Change Shape trait', couatl.traits.includes('Change Shape'));
  assert('Has Truesight trait', couatl.traits.includes('Truesight 120 ft'));
  assert('Has radiant/psychic immunity trait', couatl.traits.some((t: string) => t.includes('radiant')));
  assert('Has charmed/frightened immunity trait', couatl.traits.some((t: string) => t.includes('charmed')));

  // Position: adjacent to caster (1 square away)
  eq('Couatl pos.x is caster.pos.x + 1', couatl.pos.x, 1);
  eq('Couatl pos.y is caster.pos.y', couatl.pos.y, 0);

  // hasHands false (Couatl is a winged serpent — no hands)
  eq('Couatl hasHands is false', couatl.hasHands, false);

  // wearingArmor false (natural armor, not worn)
  eq('Couatl wearingArmor is false (natural armor)', couatl.wearingArmor, false);

  // ID is unique
  const couatl2 = createCouatl(caster, 7);
  assert('Couatl IDs are unique', couatl.id !== couatl2.id);
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

  // Find the Couatl in the battlefield
  const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Celestial');
  eq('1 Couatl added to battlefield', summons.length, 1);

  if (summons.length === 1) {
    const couatl = summons[0];
    eq('Couatl isSummon is true', couatl.isSummon, true);
    eq('Couatl summonerId is caster', couatl.summonerId, 'caster1');
    eq('Couatl summonSpellName is Conjure Celestial', couatl.summonSpellName, 'Conjure Celestial');
    eq('Couatl faction matches caster', couatl.faction, 'party');
    eq('Couatl HP is 97', couatl.maxHP, 97);
    eq('Couatl AC is 19', couatl.ac, 19);
    eq('Couatl CR is 4', couatl.cr, 4);
  }

  // Caster is concentrating on Conjure Celestial
  eq('Caster concentrating on Conjure Celestial', caster.concentration?.spellName, 'Conjure Celestial');
  eq('Caster concentration is active', caster.concentration?.active, true);

  // Slot consumed
  eq('Slot consumed (0 remaining)', caster.resources!.spellSlots![7]!.remaining, 0);
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

      const summons = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Celestial');
      if (summons.length === 1) {
        eq('insert 0 combatantId is the Couatl', bf.pendingInitiativeInserts[0].combatantId, summons[0].id);
      }
    }
  }
}

// ============================================================
// 6. Concentration break despawns the celestial
// ============================================================

console.log('\n=== 6. Concentration break despawns the celestial ===\n');

{
  const caster = makeCaster();
  const enemy = makeEnemy();
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  execute(caster, caster, state);

  // Verify celestial exists
  const summonsBefore = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Celestial');
  eq('1 Couatl exists before concentration break', summonsBefore.length, 1);

  // Break concentration
  removeEffectsFromCaster(caster.id, bf);

  // Verify celestial is removed
  const summonsAfter = [...bf.combatants.values()].filter(c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Celestial');
  eq('Couatl removed after concentration break', summonsAfter.length, 0);
}

// ============================================================
// 7. Couatl stats correctness (comprehensive)
// ============================================================

console.log('\n=== 7. Couatl stats correctness (comprehensive) ===\n');

{
  const caster = makeCaster('cleric1', { x: 3, y: 3, z: 0 });
  const couatl = createCouatl(caster, 7);

  // Core stats
  eq('AC 19', couatl.ac, 19);
  eq('HP 97', couatl.maxHP, 97);
  eq('currentHP = maxHP', couatl.currentHP, couatl.maxHP);
  eq('Speed 30', couatl.speed, 30);
  eq('Fly speed 90', couatl.flySpeed, 90);
  eq('No swim speed', couatl.swimSpeed, null);
  eq('No burrow speed', couatl.burrowSpeed, null);

  // Ability scores (MM p.43)
  eq('STR 16', couatl.str, 16);
  eq('DEX 20', couatl.dex, 20);
  eq('CON 17', couatl.con, 17);
  eq('INT 18', couatl.int, 18);
  eq('WIS 20', couatl.wis, 20);
  eq('CHA 18', couatl.cha, 18);

  // CR
  eq('CR 4', couatl.cr, 4);

  // Bite attack details (primary)
  const bite = couatl.actions[0];
  eq('Bite attackType is melee', bite.attackType, 'melee');
  eq('Bite reach is 5', bite.reach, 5);
  eq('Bite hitBonus +8', bite.hitBonus, 8);
  assert('Bite damage 1d6+5', bite.damage!.count === 1 && bite.damage!.sides === 6 && bite.damage!.bonus === 5);
  eq('Bite average damage is 8', bite.damage!.average, 8);
  eq('Bite damageType piercing', bite.damageType, 'piercing');
  eq('Bite saveDC 13 (poisoned)', bite.saveDC, 13);
  eq('Bite saveAbility con', bite.saveAbility, 'con');
  eq('Bite costType action', bite.costType, 'action');

  // Constrict attack details (secondary, grapple)
  const constrict = couatl.actions[1];
  eq('Constrict attackType is melee', constrict.attackType, 'melee');
  eq('Constrict reach is 10', constrict.reach, 10);
  eq('Constrict hitBonus +6', constrict.hitBonus, 6);
  assert('Constrict damage 2d6+3', constrict.damage!.count === 2 && constrict.damage!.sides === 6 && constrict.damage!.bonus === 3);
  eq('Constrict average damage is 10', constrict.damage!.average, 10);
  eq('Constrict damageType bludgeoning', constrict.damageType, 'bludgeoning');
  eq('Constrict saveDC 15 (grapple)', constrict.saveDC, 15);
  eq('Constrict saveAbility str', constrict.saveAbility, 'str');
  eq('Constrict isControl true', constrict.isControl, true);

  // Summon fields
  eq('isSummon true', couatl.isSummon, true);
  eq('summonerId is cleric1', couatl.summonerId, 'cleric1');
  eq('summonSpellName is Conjure Celestial', couatl.summonSpellName, 'Conjure Celestial');

  // Position adjacent to caster
  eq('Position x = caster.x + 1', couatl.pos.x, 4);
  eq('Position y = caster.y', couatl.pos.y, 3);
  assert('Couatl positioned adjacent to caster',
    Math.abs(couatl.pos.x - caster.pos.x) + Math.abs(couatl.pos.y - caster.pos.y) <= 2
  );

  // hasHands false (Couatl is a winged serpent — no hands)
  eq('hasHands false', couatl.hasHands, false);
  // wearingArmor false (natural armor, not worn)
  eq('wearingArmor false (natural armor)', couatl.wearingArmor, false);
}

// ============================================================
// 8. Upcast — slot level scales but stat block stays the same in v1
// ============================================================

console.log('\n=== 8. Upcast — slot level scales but stat block stays the same in v1 ===\n');

{
  // v1 always spawns the Couatl stat block (CR 4) regardless of slot level.
  // The slot level is consumed correctly; the CR 4 stat block is valid for any L7+ slot.

  // L7 cast (default)
  const caster7 = makeCaster('c7');
  caster7.resources = withSlots7And8(1, 1);
  const bf7 = makeBF([caster7, makeEnemy('e7')]);
  const state7 = makeState(bf7);
  execute(caster7, caster7, state7);
  const couatl7 = [...bf7.combatants.values()].find(c => c.isSummon && c.summonerId === caster7.id);
  assert('L7 cast: Couatl spawned', !!couatl7);
  if (couatl7) {
    eq('L7 cast: HP is 97 (Couatl)', couatl7.maxHP, 97);
    eq('L7 cast: AC is 19', couatl7.ac, 19);
    eq('L7 cast: CR is 4', couatl7.cr, 4);
  }
  eq('L7 cast: 7th-level slot consumed', caster7.resources!.spellSlots![7]!.remaining, 0);
  eq('L7 cast: 8th-level slot untouched', caster7.resources!.spellSlots![8]!.remaining, 1);

  // Cast log mentions slot level
  const events7 = state7.log.events as any[];
  const actionEvents7 = events7.filter((e: any) => e.type === 'action');
  assert('L7 cast log mentions slot L7', actionEvents7.length > 0 && actionEvents7[0].description.includes('L7'));

  // L8 upcast: Session 41 Task #3 bestiary integration — now picks
  // Unicorn (CR 5 celestial, MM p.294) when bestiary is loaded.
  // Falls back to Couatl (CR 4) if bestiary is not available.
  // The Unicorn stat block: AC 12, HP 67 (9d10+18), CR 5.
  const caster8 = makeCaster('c8');
  caster8.resources = withSlots7And8(0, 1); // L7 exhausted, L8 available
  const bf8 = makeBF([caster8, makeEnemy('e8')]);
  const state8 = makeState(bf8);
  execute(caster8, caster8, state8);
  const summon8 = [...bf8.combatants.values()].find(c => c.isSummon && c.summonerId === caster8.id);
  assert('L8 upcast: summon spawned', !!summon8);
  if (summon8) {
    // Bestiary is loaded from ./bestiaryData in the test environment → Unicorn.
    // If bestiary is missing (e.g. CI without bestiaryData/), falls back to Couatl.
    // Both are valid v1.5 outcomes — verify it's one of the two.
    const isUnicorn = summon8.name.includes('Unicorn');
    const isCouatl = summon8.name.includes('Couatl');
    assert('L8 upcast: summon is Unicorn or Couatl (fallback)', isUnicorn || isCouatl);
    if (isUnicorn) {
      eq('L8 upcast: Unicorn HP is 67 (MM p.294)', summon8.maxHP, 67);
      eq('L8 upcast: Unicorn CR is 5', summon8.cr, 5);
    } else {
      // Fallback: Couatl (HP 97, CR 4)
      eq('L8 fallback: Couatl HP is 97', summon8.maxHP, 97);
      eq('L8 fallback: Couatl CR is 4', summon8.cr, 4);
    }
  }
  eq('L8 upcast: 8th-level slot consumed', caster8.resources!.spellSlots![8]!.remaining, 0);

  // L8 cast log mentions slot L8
  const events8 = state8.log.events as any[];
  const actionEvents8 = events8.filter((e: any) => e.type === 'action');
  assert('L8 upcast log mentions slot L8', actionEvents8.length > 0 && actionEvents8[0].description.includes('L8'));
}

// ============================================================
// 9. CR Picker — Conjure Celestial options table
// ============================================================

console.log('\n=== 9. CR Picker — Conjure Celestial options table ===\n');

eq('3 options defined (L7-L9)', CONJURE_CELESTIAL_OPTIONS.length, 3);
eq('Option 0: L7, CR 4', CONJURE_CELESTIAL_OPTIONS[0].slotLevel, 7);
eq('Option 0: maxCR 4', CONJURE_CELESTIAL_OPTIONS[0].maxCR, 4);
eq('Option 1: L8, CR 5', CONJURE_CELESTIAL_OPTIONS[1].slotLevel, 8);
eq('Option 1: maxCR 5', CONJURE_CELESTIAL_OPTIONS[1].maxCR, 5);
eq('Option 2: L9, CR 6', CONJURE_CELESTIAL_OPTIONS[2].slotLevel, 9);
eq('Option 2: maxCR 6', CONJURE_CELESTIAL_OPTIONS[2].maxCR, 6);
eq('Default option is L7 (CR 4)', DEFAULT_CC_OPTION.slotLevel, 7);
eq('Default option maxCR 4', DEFAULT_CC_OPTION.maxCR, 4);

// Verify maxCR = 4 + (slotLevel - 7) progression (per PHB p.225)
// This is DIFFERENT from Conjure Fey/Elemental where maxCR = slotLevel.
// Conjure Celestial starts at CR 4 for L7 and adds 1 per slot level above 7th.
for (let i = 0; i < CONJURE_CELESTIAL_OPTIONS.length; i++) {
  const opt = CONJURE_CELESTIAL_OPTIONS[i];
  eq(`Option ${i}: maxCR equals 4 + (slotLevel - 7)`, opt.maxCR, 4 + (opt.slotLevel - 7));
}

// ============================================================
// 10. Distinct from TCE Summon Celestial
// ============================================================

console.log('\n=== 10. Distinct from TCE Summon Celestial ===\n');

{
  // This test verifies that the PHB L7 Conjure Celestial is distinct from the
  // TCE L5 Summon Celestial. Both should coexist as separate spell modules.
  // The PHB spell uses the Couatl stat block; the TCE spell uses the
  // Celestial Spirit stat block.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tceModule = require('../spells/summon_celestial');
  const tceMetadata = tceModule.metadata;
  eq('TCE Summon Celestial level is 5 (different from PHB L7)', tceMetadata.level, 5);
  eq('PHB Conjure Celestial level is 7', metadata.level, 7);
  assert('Names are different', metadata.name !== tceMetadata.name);
  assert('PHB is "Conjure Celestial"', metadata.name === 'Conjure Celestial');
  assert('TCE is "Summon Celestial"', tceMetadata.name === 'Summon Celestial');
}

// ============================================================
// 11. execute — logging
// ============================================================

console.log('\n=== 11. execute — logging ===\n');

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
    assert('Action event mentions "Conjure Celestial"', actionEvents[0].description.includes('Conjure Celestial'));
    assert('Action event mentions "Couatl"', actionEvents[0].description.includes('Couatl'));
    assert('Action event mentions HP', actionEvents[0].description.includes('HP'));
    assert('Action event mentions AC', actionEvents[0].description.includes('AC'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
