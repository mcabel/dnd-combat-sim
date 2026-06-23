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

  // CR 4 cap: Couatl (CR 4) is the highest CR ≤ 4 celestial in MM. With the
  // expanded bestiary (Session 53: 99 sourcebooks loaded), some non-MM sources
  // also have CR ≤ 4 celestials, but Couatl remains the alphabetically-first
  // CR 4 celestial — so it's still the pick.
  const pick4 = pickSummonByCR(bestiary, 4, 'celestial');
  assert('4a. CR ≤ 4 celestial pick exists', pick4 !== null);
  eq('4b. CR ≤ 4 celestial is Couatl', pick4?.name, 'Couatl');
  eq('4c. CR ≤ 4 celestial CR = 4', pick4?.cr, 4);

  // CR 5 cap: Session 53 — with the expanded bestiary, Battleforce Angel
  // (GGR, CR 5) is alphabetically before Unicorn, so it wins the tiebreak.
  // Both are CR 5 celestials; we assert CR + type but don't pin the name
  // (it varies by which sourcebooks are loaded).
  const pick5 = pickSummonByCR(bestiary, 5, 'celestial');
  assert('4d. CR ≤ 5 celestial pick exists', pick5 !== null);
  eq('4f. CR ≤ 5 celestial CR = 5', pick5?.cr, 5);

  // CR 6 cap: Equinal Guardinal (MPP, CR 6) is the highest CR ≤ 6 celestial
  // in the expanded bestiary. Assert CR = 6.
  const pick6 = pickSummonByCR(bestiary, 6, 'celestial');
  assert('4g. CR ≤ 6 celestial pick exists', pick6 !== null);
  eq('4i. CR ≤ 6 celestial CR = 6', pick6?.cr, 6);
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

  // CR 6 cap: Session 53 — with the expanded bestiary, Animated Breath
  // (FTD, CR 6) is alphabetically before Galeb Duhr, so it wins. We assert
  // CR = 6 but don't pin the name (varies by which sourcebooks are loaded).
  const pick6 = pickSummonByCR(bestiary, 6, 'elemental');
  assert('5d. CR ≤ 6 elemental pick exists', pick6 !== null);
  eq('5e. CR ≤ 6 elemental CR = 6', pick6?.cr, 6);
}

// ============================================================
// 6. pickSummonByCR — fey
// ============================================================
console.log('\n--- 6. pickSummonByCR — fey ---');
{
  const bestiary = getBestiary();

  // CR 6 cap: Session 53 — with the expanded bestiary, Annis Hag (MPMM, CR 6)
  // is the highest CR ≤ 6 fey. We assert CR = 6 but don't pin the name
  // (varies by which sourcebooks are loaded).
  const pick6 = pickSummonByCR(bestiary, 6, 'fey');
  assert('6a. CR ≤ 6 fey pick exists', pick6 !== null);
  eq('6c. CR ≤ 6 fey CR = 6', pick6?.cr, 6);
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

  // L8 → CR 5 celestial (Session 53: expanded bestiary has CR 5 celestials
  // from GGR/FTD/etc.; the alphabetically-first CR 5 celestial is picked).
  // We assert CR = 5 but don't pin the name.
  const pick8 = pickConjureCelestialSummon(8);
  assert('7d. L8 pick exists', pick8 !== null);
  eq('7f. L8 pick CR = 5', pick8?.cr, 5);

  // L9 → CR 6 celestial (Session 53: expanded bestiary has CR 6 celestials
  // from MPP/etc.).
  const pick9 = pickConjureCelestialSummon(9);
  assert('7g. L9 pick exists', pick9 !== null);
  eq('7i. L9 pick CR = 6', pick9?.cr, 6);
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

  // L6 → CR 6 elemental (Session 53: expanded bestiary has CR 6 elementals
  // from FTD/etc.; alphabetically-first is picked). Assert CR = 6.
  const pick6 = pickConjureElementalSummon(6);
  assert('8c. L6 pick exists', pick6 !== null);
  eq('8d. L6 pick CR = 6', pick6?.cr, 6);

  // L7-L9 → CR 7+ elemental (Session 53: expanded bestiary has CR 7+
  // elementals from non-MM sources). Assert the pick exists + CR ≥ 6.
  const pick9 = pickConjureElementalSummon(9);
  assert('8f. L9 pick exists', pick9 !== null);
  assert('8g. L9 pick CR ≥ 6 (expanded bestiary)', (pick9?.cr ?? 0) >= 6);
}

// ============================================================
// 9. pickConjureFeySummon — slot-level progression
// ============================================================
console.log('\n--- 9. pickConjureFeySummon — slot progression ---');
{
  // L6 → CR 6 fey (Session 53: expanded bestiary has CR 6 fey from MPMM/etc.;
  // alphabetically-first is picked). Assert CR = 6.
  const pick6 = pickConjureFeySummon(6);
  assert('9a. L6 pick exists', pick6 !== null);
  eq('9c. L6 pick CR = 6', pick6?.cr, 6);

  // L9 → CR 7+ fey (Session 53: expanded bestiary has higher-CR fey).
  const pick9 = pickConjureFeySummon(9);
  assert('9d. L9 pick exists', pick9 !== null);
  assert('9e. L9 pick CR ≥ 6 (expanded bestiary)', (pick9?.cr ?? 0) >= 6);
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
    // Session 53: with the expanded bestiary, the L8 celestial pick is the
    // alphabetically-first CR 5 celestial (Battleforce Angel from GGR).
    // Assert CR = 5 + the summon has the right Combatant shape; don't pin
    // the name (varies by which sourcebooks are loaded).
    eq('11d. summon CR = 5', summon.cr, 5);
    assert('11e. summon AC ≥ 1', summon.ac >= 1);
    assert('11f. summon maxHP ≥ 1', summon.maxHP >= 1);
  }

  // L8 slot consumed
  eq('11g. L8 slot consumed', caster.resources!.spellSlots![8]!.remaining, 0);

  // Log mentions the summon name
  const log = state.log.events.find((e: any) =>
    e.type === 'action' && summon && e.description.includes(summon.name.split(' ')[0]));
  assert('11h. log mentions summon name', log !== undefined);
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
