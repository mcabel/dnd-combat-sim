// ============================================================
// Test: Bestiary Integration (Session 41, Task #3)
//
// Validates that the bestiary loader + summon picker correctly:
//   - Loads bestiaryData/*.json into a Map
//   - Picks the highest-CR creature of the matching type within the cap
//   - Conjure Celestial L7 → Couatl (CR 4)
//   - Conjure Celestial L8 → Unicorn (CR 5) — NEW in Session 41
//   - Conjure Celestial L9 → falls back to Couatl (no CR 6 celestials in MM)
//   - Conjure Elemental L5 → Air/Earth/Fire/Water Elemental or Salamander/Xorn (CR 5)
//   - Conjure Fey L6 → Green Hag (CR 3) — highest fey in MM
//   - buildSummonCombatant produces a valid Combatant with summon fields set
//   - Fallback to createCouatl when bestiary is empty
//
// Run: npx ts-node src/test/bestiary_integration.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  loadBestiary,
  getBestiary,
  setBestiaryForTesting,
  getBestiaryLoadError,
  pickSummonByCR,
  pickSummonByName,
  pickConjureCelestialSummon,
  pickConjureElementalSummon,
  pickConjureFeySummon,
  buildSummonCombatant,
  DEFAULT_BESTIARY_DIR,
} from '../summons/summon_picker';
import { createCouatl, execute as executeCC } from '../spells/conjure_celestial';
import { Combatant } from '../types/core';

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

function makeCaster(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: true, faction: 'party',
    maxHP: 50, currentHP: 50, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 18,
    cr: null,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: { successes: 0, failures: 0 },
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

function makeBF(combatants: Combatant[]) {
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

function makeState(bf: any): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

function withSlots7And8(slots7: number, slots8: number): any {
  return {
    spellSlots: {
      7: { max: slots7, remaining: slots7 },
      8: { max: slots8, remaining: slots8 },
    },
  };
}

// ============================================================
// 1. Bestiary loads from ./bestiaryData
// ============================================================
console.log('\n--- 1. Bestiary loads from ./bestiaryData ---');
{
  // Clear cache to force a fresh load
  setBestiaryForTesting(null);
  const bestiary = loadBestiary();
  assert('1a. bestiary is a Map', bestiary instanceof Map);
  assert('1b. bestiary has > 0 monsters', bestiary.size > 0);
  // MM 2014 has 400+ monsters
  assert('1c. bestiary has at least 100 monsters', bestiary.size >= 100,
    `got ${bestiary.size}`);
  // Couatl should be there
  const couatl = bestiary.get('couatl');
  assert('1d. Couatl is in bestiary', !!couatl);
  // Unicorn should be there
  const unicorn = bestiary.get('unicorn');
  assert('1e. Unicorn is in bestiary', !!unicorn);
  // No load error
  eq('1f. no bestiary load error', getBestiaryLoadError(), null);
}

// ============================================================
// 2. getBestiary returns the cached Map
// ============================================================
console.log('\n--- 2. getBestiary returns cached Map ---');
{
  const b1 = getBestiary();
  const b2 = getBestiary();
  assert('2a. same Map reference returned (cached)', b1 === b2);
}

// ============================================================
// 3. pickSummonByName
// ============================================================
console.log('\n--- 3. pickSummonByName ---');
{
  const bestiary = getBestiary();
  const couatl = pickSummonByName(bestiary, 'Couatl');
  assert('3a. pickSummonByName(Couatl) returns pick', couatl !== null);
  eq('3b. Couatl name', couatl?.name, 'Couatl');
  eq('3c. Couatl CR = 4', couatl?.cr, 4);

  // Case-insensitive
  const unicorn = pickSummonByName(bestiary, 'unicorn');
  assert('3d. pickSummonByName(unicorn) — case-insensitive', unicorn !== null);
  eq('3e. Unicorn name', unicorn?.name, 'Unicorn');
  eq('3f. Unicorn CR = 5', unicorn?.cr, 5);

  // Unknown name returns null
  const unknown = pickSummonByName(bestiary, 'Nonexistent Monster');
  assert('3g. unknown name returns null', unknown === null);
}

// ============================================================
// 4. pickSummonByCR — celestials
// ============================================================
console.log('\n--- 4. pickSummonByCR — celestials ---');
{
  const bestiary = getBestiary();

  // CR 4 cap: should return Couatl (CR 4) — the only CR ≤ 4 celestial worth picking
  // Actually, maxCR=4 → candidates are Couatl (CR 4), Pegasus (CR 2). Highest = Couatl.
  const pick4 = pickSummonByCR(bestiary, 4, 'celestial');
  assert('4a. CR ≤ 4 celestial pick exists', pick4 !== null);
  eq('4b. CR ≤ 4 celestial is Couatl', pick4?.name, 'Couatl');
  eq('4c. CR ≤ 4 celestial CR = 4', pick4?.cr, 4);

  // CR 5 cap: should return Unicorn (CR 5)
  const pick5 = pickSummonByCR(bestiary, 5, 'celestial');
  assert('4d. CR ≤ 5 celestial pick exists', pick5 !== null);
  eq('4e. CR ≤ 5 celestial is Unicorn', pick5?.name, 'Unicorn');
  eq('4f. CR ≤ 5 celestial CR = 5', pick5?.cr, 5);

  // CR 6 cap: still Unicorn (no CR 6 celestials in MM)
  const pick6 = pickSummonByCR(bestiary, 6, 'celestial');
  assert('4g. CR ≤ 6 celestial pick exists', pick6 !== null);
  eq('4h. CR ≤ 6 celestial is still Unicorn (no CR 6 in MM)', pick6?.name, 'Unicorn');
  eq('4i. CR ≤ 6 celestial CR = 5', pick6?.cr, 5);
}

// ============================================================
// 5. pickSummonByCR — elementals
// ============================================================
console.log('\n--- 5. pickSummonByCR — elementals ---');
{
  const bestiary = getBestiary();

  // CR 5 cap: should return one of the CR 5 elementals (Air, Earth, Fire, Water, Salamander, Xorn)
  // All are CR 5 — tie broken alphabetically → Air Elemental
  const pick5 = pickSummonByCR(bestiary, 5, 'elemental');
  assert('5a. CR ≤ 5 elemental pick exists', pick5 !== null);
  eq('5b. CR ≤ 5 elemental CR = 5', pick5?.cr, 5);
  // Air Elemental comes first alphabetically among CR 5 elementals
  eq('5c. CR ≤ 5 elemental is Air Elemental (alphabetical tiebreak)', pick5?.name, 'Air Elemental');

  // CR 6 cap: should return Galeb Duhr or Invisible Stalker (both CR 6)
  // Alphabetical: Galeb Duhr
  const pick6 = pickSummonByCR(bestiary, 6, 'elemental');
  assert('5d. CR ≤ 6 elemental pick exists', pick6 !== null);
  eq('5e. CR ≤ 6 elemental CR = 6', pick6?.cr, 6);
  eq('5f. CR ≤ 6 elemental is Galeb Duhr (alphabetical tiebreak)', pick6?.name, 'Galeb Duhr');
}

// ============================================================
// 6. pickSummonByCR — fey
// ============================================================
console.log('\n--- 6. pickSummonByCR — fey ---');
{
  const bestiary = getBestiary();

  // CR 6 cap: highest fey in MM is Green Hag (CR 3)
  const pick6 = pickSummonByCR(bestiary, 6, 'fey');
  assert('6a. CR ≤ 6 fey pick exists', pick6 !== null);
  eq('6b. CR ≤ 6 fey is Green Hag (highest CR fey in MM)', pick6?.name, 'Green Hag');
  eq('6c. CR ≤ 6 fey CR = 3', pick6?.cr, 3);
}

// ============================================================
// 7. pickConjureCelestialSummon — slot-level progression
// ============================================================
console.log('\n--- 7. pickConjureCelestialSummon — slot progression ---');
{
  // L7 → Couatl (canonical)
  const pick7 = pickConjureCelestialSummon(7);
  assert('7a. L7 pick exists', pick7 !== null);
  eq('7b. L7 pick is Couatl', pick7?.name, 'Couatl');
  eq('7c. L7 pick CR = 4', pick7?.cr, 4);

  // L8 → Unicorn (CR 5) — NEW in Session 41
  const pick8 = pickConjureCelestialSummon(8);
  assert('7d. L8 pick exists', pick8 !== null);
  eq('7e. L8 pick is Unicorn (Session 41 bestiary integration)', pick8?.name, 'Unicorn');
  eq('7f. L8 pick CR = 5', pick8?.cr, 5);

  // L9 → still Unicorn (no CR 6 celestials in MM)
  const pick9 = pickConjureCelestialSummon(9);
  assert('7g. L9 pick exists', pick9 !== null);
  eq('7h. L9 pick is still Unicorn (no CR 6 celestials in MM)', pick9?.name, 'Unicorn');
  eq('7i. L9 pick CR = 5', pick9?.cr, 5);
}

// ============================================================
// 8. pickConjureElementalSummon — slot-level progression
// ============================================================
console.log('\n--- 8. pickConjureElementalSummon — slot progression ---');
{
  // L5 → CR 5 elemental (Air Elemental — alphabetical first)
  const pick5 = pickConjureElementalSummon(5);
  assert('8a. L5 pick exists', pick5 !== null);
  eq('8b. L5 pick CR = 5', pick5?.cr, 5);

  // L6 → CR 6 elemental (Galeb Duhr — alphabetical first)
  const pick6 = pickConjureElementalSummon(6);
  assert('8c. L6 pick exists', pick6 !== null);
  eq('8d. L6 pick CR = 6', pick6?.cr, 6);
  eq('8e. L6 pick is Galeb Duhr', pick6?.name, 'Galeb Duhr');

  // L7-L9 → still Galeb Duhr (no CR 7+ elementals in MM)
  const pick9 = pickConjureElementalSummon(9);
  assert('8f. L9 pick exists', pick9 !== null);
  eq('8g. L9 pick is still Galeb Duhr (no CR 7+ elementals in MM)', pick9?.name, 'Galeb Duhr');
}

// ============================================================
// 9. pickConjureFeySummon — slot-level progression
// ============================================================
console.log('\n--- 9. pickConjureFeySummon — slot progression ---');
{
  // L6 → Green Hag (CR 3 — highest fey in MM)
  const pick6 = pickConjureFeySummon(6);
  assert('9a. L6 pick exists', pick6 !== null);
  eq('9b. L6 pick is Green Hag', pick6?.name, 'Green Hag');
  eq('9c. L6 pick CR = 3', pick6?.cr, 3);

  // L9 → still Green Hag (no CR 7+ fey in MM)
  const pick9 = pickConjureFeySummon(9);
  assert('9d. L9 pick exists', pick9 !== null);
  eq('9e. L9 pick is still Green Hag', pick9?.name, 'Green Hag');
}

// ============================================================
// 10. buildSummonCombatant produces a valid Combatant
// ============================================================
console.log('\n--- 10. buildSummonCombatant ---');
{
  const bestiary = getBestiary();
  const pick = pickSummonByName(bestiary, 'Unicorn');
  assert('10a. Unicorn pick exists', pick !== null);

  const caster = makeCaster('caster');
  const summon = buildSummonCombatant(pick!, caster, 'Conjure Celestial');

  // Summon fields
  assert('10b. isSummon = true', summon.isSummon === true);
  eq('10c. summonerId = caster.id', summon.summonerId, 'caster');
  eq('10d. summonSpellName = Conjure Celestial', summon.summonSpellName, 'Conjure Celestial');
  // Faction inherits from caster
  eq('10e. faction = caster.faction', summon.faction, 'party');
  // Name includes the creature name and caster name
  assert('10f. name includes Unicorn', summon.name.includes('Unicorn'));
  assert('10g. name includes caster name', summon.name.includes('caster'));
  // Position is adjacent to caster (1 square away)
  eq('10h. pos.x = caster.pos.x + 1', summon.pos.x, 1);
  eq('10i. pos.y = caster.pos.y', summon.pos.y, 0);
  // Unicorn stats: AC 12, HP 67, CR 5 (MM p.294)
  eq('10j. Unicorn AC = 12', summon.ac, 12);
  eq('10k. Unicorn maxHP = 67', summon.maxHP, 67);
  eq('10l. Unicorn CR = 5', summon.cr, 5);
}

// ============================================================
// 11. End-to-end: Conjure Celestial L8 → Unicorn
// ============================================================
console.log('\n--- 11. End-to-end Conjure Celestial L8 → Unicorn ---');
{
  const caster = makeCaster('caster', {
    resources: withSlots7And8(0, 1), // L7 exhausted, L8 available
  });
  const enemy = makeCaster('enemy', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCC(caster, caster, state);

  // Find the summon
  const summon = [...bf.combatants.values()].find(c => c.isSummon && c.summonerId === caster.id);
  assert('11a. summon spawned', summon !== undefined);
  if (summon) {
    // Should be a Unicorn (not a Couatl) since bestiary is loaded
    assert('11b. summon is Unicorn (not Couatl)', summon.name.includes('Unicorn'));
    eq('11c. summon maxHP = 67 (Unicorn)', summon.maxHP, 67);
    eq('11d. summon CR = 5', summon.cr, 5);
    eq('11e. summon AC = 12 (Unicorn)', summon.ac, 12);
  }

  // L8 slot consumed
  eq('11f. L8 slot consumed', caster.resources!.spellSlots![8]!.remaining, 0);

  // Log mentions Unicorn
  const log = state.log.events.find((e: any) =>
    e.type === 'action' && e.description.includes('Unicorn'));
  assert('11g. log mentions Unicorn', log !== undefined);
}

// ============================================================
// 12. End-to-end: Conjure Celestial L7 → Couatl (bestiary path)
// ============================================================
console.log('\n--- 12. End-to-end Conjure Celestial L7 → Couatl (bestiary) ---');
{
  const caster = makeCaster('caster', {
    resources: withSlots7And8(1, 1), // L7 available
  });
  const enemy = makeCaster('enemy', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCC(caster, caster, state);

  const summon = [...bf.combatants.values()].find(c => c.isSummon && c.summonerId === caster.id);
  assert('12a. summon spawned', summon !== undefined);
  if (summon) {
    // L7 → Couatl from bestiary
    assert('12b. summon is Couatl', summon.name.includes('Couatl'));
    // Couatl HP and CR come from the bestiary JSON (should match MM p.43)
    // The bestiary Couatl has HP 97, AC 19, CR 4 — same as createCouatl
    eq('12c. summon CR = 4', summon.cr, 4);
  }

  // L7 slot consumed (lowest available)
  eq('12d. L7 slot consumed', caster.resources!.spellSlots![7]!.remaining, 0);
  eq('12e. L8 slot untouched', caster.resources!.spellSlots![8]!.remaining, 1);
}

// ============================================================
// 13. Fallback to createCouatl when bestiary is empty
// ============================================================
console.log('\n--- 13. Fallback when bestiary empty ---');
{
  // Inject an empty bestiary to simulate "bestiary not loaded"
  setBestiaryForTesting(new Map());

  // pickConjureCelestialSummon returns null when bestiary is empty
  const pick = pickConjureCelestialSummon(8);
  assert('13a. picker returns null when bestiary empty', pick === null);

  // execute falls back to createCouatl
  const caster = makeCaster('caster', {
    resources: withSlots7And8(0, 1),
  });
  const enemy = makeCaster('enemy', { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCC(caster, caster, state);

  const summon = [...bf.combatants.values()].find(c => c.isSummon && c.summonerId === caster.id);
  assert('13b. fallback summon spawned', summon !== undefined);
  if (summon) {
    // Falls back to hardcoded Couatl
    assert('13c. fallback summon is Couatl', summon.name.includes('Couatl'));
    eq('13d. fallback Couatl HP = 97 (hardcoded)', summon.maxHP, 97);
    eq('13e. fallback Couatl CR = 4', summon.cr, 4);
  }

  // Restore the real bestiary for subsequent tests
  setBestiaryForTesting(null);
  loadBestiary(); // re-load
}

// ============================================================
// 14. setBestiaryForTesting — clear cache and reload
// ============================================================
console.log('\n--- 14. setBestiaryForTesting ---');
{
  // Inject a fake bestiary
  const fakeBestiary = new Map();
  fakeBestiary.set('fake monster', {
    name: 'Fake Monster',
    source: 'TEST',
    cr: '1',
    type: 'beast',
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    ac: [{ ac: 10 }],
    hp: { average: 10, formula: '2d8+1' },
  } as any);
  setBestiaryForTesting(fakeBestiary);

  const b = getBestiary();
  assert('14a. injected bestiary is used', b === fakeBestiary);
  assert('14b. fake monster is in bestiary', b.has('fake monster'));

  // Restore real bestiary
  setBestiaryForTesting(null);
  const realB = loadBestiary();
  assert('14c. real bestiary reloaded', realB.size > 0);
  assert('14d. fake monster gone after reload', !realB.has('fake monster'));
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('bestiary_integration.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('bestiary_integration.test.ts: all tests passed ✅');
}
