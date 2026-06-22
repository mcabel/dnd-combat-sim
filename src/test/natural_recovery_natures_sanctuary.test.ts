// ============================================================
// Test: Land Druid Natural Recovery + Nature's Sanctuary
// (Session 49, Task #29-follow-up-3c)
//
// Validates that two Circle of the Land (Druid) features are mechanically
// wired into the engine:
//
//   Natural Recovery (Land Druid 2, PHB p.68):
//     "Starting at 2nd level, you can recover some of your expended spell
//      slots after a short rest. The total spell slots you recover equals
//      half your druid level (rounded up). The slots must be 5th level or
//      lower. Once you use this feature, you must finish a long rest before
//      you can use it again."
//     - Wired in shortRest() (engine/utils.ts): auto-recovers lowest-level
//       expended slots up to the budget. Resource consumed on use; reset on
//       long rest.
//
//   Nature's Sanctuary (Land Druid 14, PHB p.68):
//     "At 14th level, creatures of the natural world sense your connection
//      to nature and become hesitant to attack you. When a beast or plant
//      creature attacks you, that creature must make a Wisdom saving throw
//      against your druid spell save DC. On a failed save, the creature
//      must choose a different target or lose the attack."
//     - Wired in resolveAttack() (engine/combat.ts): before the attack roll,
//       a beast/plant attacker must WIS save. On fail, the attack is canceled.
//
// Coverage:
//   1. Land Druid 2 has "Natural Recovery" feature
//   2. resources.naturalRecovery is set (usesRemaining = 1)
//   3. Vanilla Druid 2 does NOT have "Natural Recovery"
//   4. shortRest() recovers expended spell slots (Land Druid 6, budget = 3)
//   5. shortRest() consumes the use (usesRemaining → 0)
//   6. shortRest() does NOT recover slots when no use remaining
//   7. longRest() resets the use (usesRemaining → 1)
//   8. Natural Recovery does NOT recover 6th+ level slots
//   9. Land Druid 14 has "Nature's Sanctuary" feature
//  10. Beast attacker fails WIS save → attack canceled (no damage)
//  11. Beast attacker succeeds WIS save → attack proceeds (damage dealt)
//  12. Plant attacker must WIS save (same as beast)
//  13. Humanoid attacker is NOT affected (no save, attack proceeds)
//  14. Non-Land-Druid-14 target is NOT protected (beast attacks normally)
//  15. Nature's Sanctuary save DC = druid spell save DC (8 + prof + WIS)
//
// Run: npx ts-node src/test/natural_recovery_natures_sanctuary.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant, hasFeature } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { shortRest, longRest } from '../engine/utils';
import { resolveAttack, EngineState } from '../engine/combat';
import { Combatant, Action, Battlefield, Vec3 } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Factories ----------------------------------------------

function makeDruid1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Sylvana', race: 'Wood Elf', background: 'Outlander',
    alignment: 'Neutral Good',
    firstClass: 'Druid',
    classLevels: [{ className: 'Druid', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 10, dex: 14, con: 13, int: 10, wis: 16, cha: 10 },
    stats:     { str: 10, dex: 14, con: 13, int: 10, wis: 16, cha: 10 },
    maxHP: 8, currentHP: 8, temporaryHP: 0,
    armorClass: 13, acFormula: 'Leather + DEX', speed: 30,
    hitDice: [{ className: 'Druid', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'], weapons: ['simple-melee','simple-ranged'],
      tools: ['herbalism kit'], savingThrows: ['wis','int'],
      skills: ['Arcana','Nature'], expertise: [],
    },
    languages: ['Common','Elvish','Druidic'],
    resources: {},
    spellcasting: {
      ability: 'wis', spellAttackBonus: 5, saveDC: 14,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Druidcraft'],
      knownSpells: [], preparedSpells: [], spellbook: [],
    },
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [
      { name: 'Druidic', description: 'Secret language.', source: 'class' },
      { name: 'Spellcasting', description: 'WIS caster.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Druidic', description: 'Secret language.', source: 'class' },
      { name: 'Spellcasting', description: 'WIS caster.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Wanderer', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function levelTo(sheet: CharacterSheet, cls: string, target: number, subclass: string | null = null): CharacterSheet {
  let s = sheet;
  // Druid picks subclass at level 2.
  const subclassLevel = cls === 'Druid' ? 2 : 2;
  for (let lvl = 2; lvl <= target; lvl++) {
    s = applyLevelUp(s, cls).sheet;
    if (subclass && lvl === subclassLevel) {
      s = chooseSubclass(s, cls, subclass);
    }
  }
  return s;
}

function makeEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 10000, currentHP: 10000, ac: 5, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    cr: 1,
    pos,
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
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
  } as Combatant;
}

function makeBF(combatants: Combatant[]): Battlefield {
  const width = 20, height = 20, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [];
      for (let z = 0; z < depth; z++) {
        cells[x][y][z] = { terrain: 'flat', elevation: 0 };
      }
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

/** Build a Land Druid at `level` with the given spell slots. */
function makeLandDruid(level: number, slots: Record<number, number> = {}): Combatant {
  const sheet = levelTo(makeDruid1(), 'Druid', level, 'Circle of the Land');
  const druid = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  if (!druid.resources) druid.resources = {} as any;
  if (!druid.resources!.spellSlots) druid.resources!.spellSlots = {};
  for (const [lvl, count] of Object.entries(slots)) {
    druid.resources!.spellSlots[Number(lvl)] = { max: count, remaining: count };
  }
  return druid;
}

const BEAST_ATTACK: Action = {
  name: 'Bite', isMultiattack: false, attackType: 'melee',
  reach: 5, range: { normal: 5, long: 5 },
  hitBonus: 20,  // high to guarantee hit (low AC target)
  damage: { count: 1, sides: 6, bonus: 0, average: 4 },
  damageType: 'piercing',
  saveDC: null, saveAbility: null, isAoE: false, isControl: false,
  requiresConcentration: false, costType: 'action', legendaryCost: 0,
  description: 'Bite',
};

// ============================================================
// 1. Land Druid 2 has "Natural Recovery" feature
// ============================================================
console.log('\n--- 1. Land Druid 2 has Natural Recovery ---');
{
  const druid = makeLandDruid(2);
  assert('1. has Natural Recovery', hasFeature(druid, 'Natural Recovery'));
}

// ============================================================
// 2. resources.naturalRecovery is set (usesRemaining = 1)
// ============================================================
console.log('\n--- 2. naturalRecovery resource set ---');
{
  const druid = makeLandDruid(2);
  assert('2a. naturalRecovery resource exists', !!druid.resources?.naturalRecovery);
  eq('2b. usesRemaining = 1', druid.resources?.naturalRecovery?.usesRemaining, 1);
}

// ============================================================
// 3. Vanilla Druid 2 does NOT have "Natural Recovery"
// ============================================================
console.log('\n--- 3. Vanilla Druid 2 does NOT have Natural Recovery ---');
{
  const sheet = levelTo(makeDruid1(), 'Druid', 2);  // no subclass
  const druid = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  assert('3. does NOT have Natural Recovery', !hasFeature(druid, 'Natural Recovery'));
}

// ============================================================
// 4. shortRest() recovers expended spell slots (Land Druid 6, budget = 3)
// ============================================================
console.log('\n--- 4. shortRest recovers spell slots ---');
{
  const druid = makeLandDruid(6, { 1: 4, 2: 2, 3: 2 });
  // Expended: all 1st-level slots (4), one 2nd (1), one 3rd (1).
  // Budget = ceil(6/2) = 3. Recover 1st-level slots first (3 × 1 = 3 budget).
  if (druid.resources?.spellSlots) {
    druid.resources.spellSlots[1].remaining = 0;  // all 4 spent
    druid.resources.spellSlots[2].remaining = 1;  // 1 of 2 spent
    druid.resources.spellSlots[3].remaining = 1;  // 1 of 2 spent
  }
  eq('4a. before: 1st remaining = 0', druid.resources?.spellSlots?.[1]?.remaining, 0);
  eq('4b. before: 2nd remaining = 1', druid.resources?.spellSlots?.[2]?.remaining, 1);

  shortRest(druid);

  // Budget 3 → recover 3 × 1st-level slots. 1st: 0 → 3 (capped by max 4). 2nd: unchanged.
  eq('4c. after: 1st remaining = 3 (3 recovered)', druid.resources?.spellSlots?.[1]?.remaining, 3);
  eq('4d. after: 2nd remaining = 1 (unchanged)', druid.resources?.spellSlots?.[2]?.remaining, 1);
  console.log(`    Land Druid 6 short-rest: 1st ${0}→${druid.resources?.spellSlots?.[1]?.remaining}, 2nd ${1}→${druid.resources?.spellSlots?.[2]?.remaining}`);
}

// ============================================================
// 5. shortRest() consumes the use (usesRemaining → 0)
// ============================================================
console.log('\n--- 5. shortRest consumes the use ---');
{
  const druid = makeLandDruid(6, { 1: 4 });
  if (druid.resources?.spellSlots) druid.resources.spellSlots[1].remaining = 0;
  eq('5a. before: usesRemaining = 1', druid.resources?.naturalRecovery?.usesRemaining, 1);

  shortRest(druid);

  eq('5b. after: usesRemaining = 0 (consumed)', druid.resources?.naturalRecovery?.usesRemaining, 0);
}

// ============================================================
// 6. shortRest() does NOT recover slots when no use remaining
// ============================================================
console.log('\n--- 6. shortRest does NOT recover when no use remaining ---');
{
  const druid = makeLandDruid(6, { 1: 4 });
  if (druid.resources?.spellSlots) druid.resources.spellSlots[1].remaining = 0;
  // Exhaust the use.
  if (druid.resources?.naturalRecovery) druid.resources.naturalRecovery.usesRemaining = 0;
  eq('6a. before: 1st remaining = 0', druid.resources?.spellSlots?.[1]?.remaining, 0);

  shortRest(druid);

  // No use remaining → no recovery.
  eq('6b. after: 1st remaining = 0 (no recovery)', druid.resources?.spellSlots?.[1]?.remaining, 0);
}

// ============================================================
// 7. longRest() resets the use (usesRemaining → 1)
// ============================================================
console.log('\n--- 7. longRest resets the use ---');
{
  const druid = makeLandDruid(6, { 1: 4 });
  if (druid.resources?.naturalRecovery) druid.resources.naturalRecovery.usesRemaining = 0;
  eq('7a. before: usesRemaining = 0', druid.resources?.naturalRecovery?.usesRemaining, 0);

  longRest(druid);

  eq('7b. after: usesRemaining = 1 (reset)', druid.resources?.naturalRecovery?.usesRemaining, 1);
}

// ============================================================
// 8. Natural Recovery does NOT recover 6th+ level slots
// ============================================================
console.log('\n--- 8. Natural Recovery skips 6th+ level slots ---');
{
  const druid = makeLandDruid(12, { 1: 4, 6: 1 });
  // Expended all 1st (4) + the 6th-level slot (1).
  if (druid.resources?.spellSlots) {
    druid.resources.spellSlots[1].remaining = 0;
    druid.resources.spellSlots[6].remaining = 0;
  }
  // Budget = ceil(12/2) = 6. Could afford 1 × 6th-level slot, but canon forbids it.
  // So the 6th-level slot should NOT be recovered. The 1st-level slots (4) should
  // all be recovered (cost 4), and the remaining budget (2) is wasted.
  eq('8a. before: 1st remaining = 0', druid.resources?.spellSlots?.[1]?.remaining, 0);
  eq('8b. before: 6th remaining = 0', druid.resources?.spellSlots?.[6]?.remaining, 0);

  shortRest(druid);

  eq('8c. after: 1st remaining = 4 (all recovered)', druid.resources?.spellSlots?.[1]?.remaining, 4);
  eq('8d. after: 6th remaining = 0 (NOT recovered — too high level)', druid.resources?.spellSlots?.[6]?.remaining, 0);
  console.log(`    Land Druid 12 short-rest: 1st 0→${druid.resources?.spellSlots?.[1]?.remaining}, 6th 0→${druid.resources?.spellSlots?.[6]?.remaining} (skipped)`);
}

// ============================================================
// 9. Land Druid 14 has "Nature's Sanctuary" feature
// ============================================================
console.log('\n--- 9. Land Druid 14 has Nature\'s Sanctuary ---');
{
  const druid = makeLandDruid(14);
  assert('9. has Nature\'s Sanctuary', hasFeature(druid, "Nature's Sanctuary"));
}

// ============================================================
// 10. Beast attacker fails WIS save → attack canceled (no damage)
// ============================================================
console.log('\n--- 10. Beast fails WIS save → attack canceled ---');
{
  const druid = makeLandDruid(14);
  druid.currentHP = druid.maxHP;
  druid.ac = 5;  // low AC so attacks would hit if they proceed

  // Beast with WIS 1 → guaranteed WIS save fail vs the druid's spell DC.
  const beast = makeEnemy('beast', { x: 1, y: 0, z: 0 }, {
    wis: 1, creatureType: 'beast', ac: 30,
  });
  beast.actions = [BEAST_ATTACK];
  beast.budget = { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const bf = makeBF([druid, beast]);
  const state = makeState(bf);
  const hpBefore = druid.currentHP;

  resolveAttack(beast, druid, BEAST_ATTACK, state);

  // Attack canceled → no damage to druid.
  eq('10a. druid HP unchanged (attack canceled)', druid.currentHP, hpBefore);
  const failEvents = state.log.events.filter((e: any) => e.type === 'save_fail');
  assert('10b. save_fail event logged for beast', failEvents.length > 0);
  if (failEvents.length > 0) {
    console.log(`    ${failEvents[0].description}`);
  }
}

// ============================================================
// 11. Beast attacker succeeds WIS save → attack proceeds (damage dealt)
// ============================================================
console.log('\n--- 11. Beast succeeds WIS save → attack proceeds ---');
{
  const druid = makeLandDruid(14);
  // Lower the druid's WIS so the save DC drops (8 + prof + WIS mod = 8 + 5 + (-5) = 8).
  // With WIS 30 (+10), beast min save = 11 ≥ 8 → guaranteed success.
  druid.wis = 1;
  druid.currentHP = druid.maxHP;
  druid.ac = 5;  // low AC so the attack hits

  const beast = makeEnemy('beast', { x: 1, y: 0, z: 0 }, {
    wis: 30, creatureType: 'beast', ac: 30,
  });
  beast.actions = [BEAST_ATTACK];
  beast.budget = { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const bf = makeBF([druid, beast]);
  const state = makeState(bf);
  const hpBefore = druid.currentHP;

  resolveAttack(beast, druid, BEAST_ATTACK, state);

  // Beast saved → attack proceeds → druid takes damage.
  assert('11a. druid took damage (attack proceeded)', druid.currentHP < hpBefore,
    `HP ${hpBefore} → ${druid.currentHP}`);
  const successEvents = state.log.events.filter((e: any) => e.type === 'save_success');
  assert('11b. save_success event logged for beast', successEvents.length > 0);
  if (successEvents.length > 0) {
    console.log(`    ${successEvents[0].description}`);
  }
}

// ============================================================
// 12. Plant attacker must WIS save (same as beast)
// ============================================================
console.log('\n--- 12. Plant attacker must WIS save ---');
{
  const druid = makeLandDruid(14);
  druid.currentHP = druid.maxHP;
  druid.ac = 5;

  // Plant creature (e.g. Shambling Mound, Myconid).
  const plant = makeEnemy('plant', { x: 1, y: 0, z: 0 }, {
    wis: 1, creatureType: 'plant', ac: 30,
  });
  plant.actions = [BEAST_ATTACK];
  plant.budget = { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const bf = makeBF([druid, plant]);
  const state = makeState(bf);
  const hpBefore = druid.currentHP;

  resolveAttack(plant, druid, BEAST_ATTACK, state);

  // Plant failed WIS save → attack canceled.
  eq('12. druid HP unchanged (plant attack canceled)', druid.currentHP, hpBefore);
}

// ============================================================
// 13. Humanoid attacker is NOT affected (no save, attack proceeds)
// ============================================================
console.log('\n--- 13. Humanoid attacker NOT affected ---');
{
  const druid = makeLandDruid(14);
  druid.currentHP = druid.maxHP;
  druid.ac = 5;

  // Humanoid creature (e.g. Bandit).
  const humanoid = makeEnemy('bandit', { x: 1, y: 0, z: 0 }, {
    wis: 1, creatureType: 'humanoid', ac: 30,
  });
  humanoid.actions = [BEAST_ATTACK];
  humanoid.budget = { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const bf = makeBF([druid, humanoid]);
  const state = makeState(bf);
  const hpBefore = druid.currentHP;

  resolveAttack(humanoid, druid, BEAST_ATTACK, state);

  // Humanoid is NOT a beast/plant → Nature's Sanctuary does NOT fire.
  // Attack proceeds → druid takes damage.
  assert('13. druid took damage (humanoid not affected by Nature\'s Sanctuary)',
    druid.currentHP < hpBefore,
    `HP ${hpBefore} → ${druid.currentHP}`);
  // No save events should be logged for Nature's Sanctuary.
  const saveEvents = state.log.events.filter((e: any) =>
    (e.type === 'save_success' || e.type === 'save_fail')
    && typeof e.description === 'string'
    && e.description.includes("Nature's Sanctuary"));
  assert('13b. no Nature\'s Sanctuary save logged for humanoid', saveEvents.length === 0);
}

// ============================================================
// 14. Non-Land-Druid-14 target is NOT protected (beast attacks normally)
// ============================================================
console.log('\n--- 14. Non-Land-Druid-14 target NOT protected ---');
{
  // Vanilla Druid 14 (no subclass) — no Nature's Sanctuary.
  const sheet = levelTo(makeDruid1(), 'Druid', 14);
  const druid = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  druid.currentHP = druid.maxHP;
  druid.ac = 5;
  assert('14a. vanilla druid does NOT have Nature\'s Sanctuary', !hasFeature(druid, "Nature's Sanctuary"));

  const beast = makeEnemy('beast', { x: 1, y: 0, z: 0 }, {
    wis: 1, creatureType: 'beast', ac: 30,
  });
  beast.actions = [BEAST_ATTACK];
  beast.budget = { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const bf = makeBF([druid, beast]);
  const state = makeState(bf);
  const hpBefore = druid.currentHP;

  resolveAttack(beast, druid, BEAST_ATTACK, state);

  // No Nature's Sanctuary → beast attacks normally → druid takes damage.
  assert('14b. vanilla druid took damage (no Nature\'s Sanctuary protection)',
    druid.currentHP < hpBefore,
    `HP ${hpBefore} → ${druid.currentHP}`);
}

// ============================================================
// 15. Nature's Sanctuary save DC = druid spell save DC (8 + prof + WIS)
// ============================================================
console.log('\n--- 15. Nature\'s Sanctuary save DC = druid spell DC ---');
{
  const druid = makeLandDruid(14);
  // WIS 16 → abilityMod = +3. Level 14 → prof +5. saveDC = 8 + 5 + 3 = 16.
  // (buildCombatant sets wis from the sheet; we override here for the test.)
  druid.wis = 16;
  druid.currentHP = druid.maxHP;
  druid.ac = 5;

  // Beast with WIS exactly 14 (+2). Save roll range 3-22. Needs ≥ 16 to save.
  // We can't force a specific roll, but we can verify the save DC in the log.
  const beast = makeEnemy('beast', { x: 1, y: 0, z: 0 }, {
    wis: 14, creatureType: 'beast', ac: 30,
  });
  beast.actions = [BEAST_ATTACK];
  beast.budget = { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false };

  const bf = makeBF([druid, beast]);
  const state = makeState(bf);

  resolveAttack(beast, druid, BEAST_ATTACK, state);

  // The save_fail or save_success event description includes "DC 16".
  const saveEvents = state.log.events.filter((e: any) =>
    (e.type === 'save_success' || e.type === 'save_fail')
    && typeof e.description === 'string'
    && e.description.includes("Nature's Sanctuary"));
  assert('15a. Nature\'s Sanctuary save event logged', saveEvents.length > 0);
  if (saveEvents.length > 0) {
    const desc = saveEvents[0].description;
    assert('15b. save DC = 16 (8 + prof 5 + WIS 3)', desc.includes('DC 16'),
      `got: ${desc}`);
    console.log(`    ${desc}`);
  }
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('natural_recovery_natures_sanctuary.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('natural_recovery_natures_sanctuary.test.ts: all tests passed ✅');
}
