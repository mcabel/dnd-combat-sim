// ============================================================
// Test: Multi-creature Conjure Spell Options (Session 44, Task #28)
//
// Validates that the multi-creature PHB options for Conjure Animals,
// Conjure Woodland Beings, and Conjure Minor Elementals work correctly
// when the bestiary is loaded.
//
// Coverage:
//   1. conjureSlotMultiplier() returns correct PHB multiplier
//   2. pickConjureAnimalsSummonMulti(L3) returns 8 picks (1× multiplier)
//   3. pickConjureAnimalsSummonMulti(L5) returns 8 picks (capped from 16)
//   4. pickConjureAnimalsSummonMulti(L7) returns 8 picks (capped from 24)
//   5. pickConjureAnimalsSummonMulti(L9) returns 8 picks (capped)
//   6. All picks in a pack are the same creature (same name)
//   7. Picks are CR 1/4 beasts (within the "8 CR 1/4" option cap)
//   8. pickConjureAnimalsSummonMulti returns [] when bestiary is empty
//   9. pickConjureWoodlandBeingsSummonMulti(L4) returns 8 fey picks
//  10. pickConjureWoodlandBeingsSummonMulti returns [] when bestiary empty
//  11. pickConjureMinorElementalsSummonMulti(L4) returns 8 elemental picks
//  12. pickConjureMinorElementalsSummonMulti returns [] when bestiary empty
//  13. conjure_animals.execute spawns 8 creatures when bestiary loaded (L3)
//  14. conjure_animals.execute spawns 8 creatures when bestiary loaded (L5)
//  15. conjure_animals.execute falls back to 2 Wolves when bestiary empty
//  16. conjure_woodland_beings.execute spawns 8 creatures when bestiary loaded
//  17. conjure_minor_elementals.execute spawns 8 creatures when bestiary loaded
//  18. Each spawned creature has isSummon=true and summonerId set
//  19. Spawned creatures are inserted into initiative after the caster
//  20. Log entry mentions the count and creature name
//
// Run: npx ts-node src/test/conjure_multi.test.ts
// ============================================================

import {
  setBestiaryForTesting,
  getBestiary,
  pickConjureAnimalsSummonMulti,
  pickConjureWoodlandBeingsSummonMulti,
  pickConjureMinorElementalsSummonMulti,
  conjureSlotMultiplier,
  MAX_SUMMONS_PER_CAST,
} from '../summons/summon_picker';
import { execute as executeCA } from '../spells/conjure_animals';
import { execute as executeCWB } from '../spells/conjure_woodland_beings';
import { execute as executeCME } from '../spells/conjure_minor_elementals';
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

function makeCaster(id: string, slots: Record<number, number>, overrides: Partial<Combatant> = {}): Combatant {
  const spellSlots: Record<number, { max: number; remaining: number }> = {};
  for (const [lvl, count] of Object.entries(slots)) {
    const n = Number(lvl);
    spellSlots[n] = { max: count as number, remaining: count as number };
  }
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
    resources: { spellSlots } as any,
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

function makeBF(combatants: Combatant[]): any {
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
    pendingInitiativeInserts: [],
  };
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

// ============================================================
// Tests
// ============================================================

console.log('\n=== 1. conjureSlotMultiplier returns correct PHB multiplier ===');
{
  eq('L3 multiplier = 1', conjureSlotMultiplier(3), 1);
  eq('L4 multiplier = 1', conjureSlotMultiplier(4), 1);
  eq('L5 multiplier = 2', conjureSlotMultiplier(5), 2);
  eq('L6 multiplier = 2', conjureSlotMultiplier(6), 2);
  eq('L7 multiplier = 3', conjureSlotMultiplier(7), 3);
  eq('L8 multiplier = 3', conjureSlotMultiplier(8), 3);
  eq('L9 multiplier = 3', conjureSlotMultiplier(9), 3);
}

console.log('\n=== 2. pickConjureAnimalsSummonMulti(L3) returns 8 picks ===');
{
  // Load the real bestiary
  setBestiaryForTesting(null);
  const bestiary = getBestiary();
  assert('bestiary loaded', bestiary.size > 0);

  const picks = pickConjureAnimalsSummonMulti(3);
  eq('L3 returns 8 picks', picks.length, 8);
  if (picks.length > 0) {
    console.log(`    Picked creature: ${picks[0].name} (CR ${picks[0].cr})`);
  }
}

console.log('\n=== 3. pickConjureAnimalsSummonMulti(L5) returns 16 picks (cap raised Session 45) ===');
{
  setBestiaryForTesting(null);
  const picks = pickConjureAnimalsSummonMulti(5);
  // PHB multiplier 2× yields 16. Session 45 Task #28-follow-up raised the
  // cap from 8 to 16, so L5 now returns the full 16 (PHB-accurate).
  eq('L5 returns 16 picks (cap raised)', picks.length, MAX_SUMMONS_PER_CAST);
}

console.log('\n=== 4. pickConjureAnimalsSummonMulti(L7) returns 16 picks (capped from 24) ===');
{
  setBestiaryForTesting(null);
  const picks = pickConjureAnimalsSummonMulti(7);
  // PHB multiplier 3× would yield 24, but MAX_SUMMONS_PER_CAST caps at 16
  eq('L7 returns 16 picks (capped from 24)', picks.length, MAX_SUMMONS_PER_CAST);
}

console.log('\n=== 5. pickConjureAnimalsSummonMulti(L9) returns 16 picks (capped) ===');
{
  setBestiaryForTesting(null);
  const picks = pickConjureAnimalsSummonMulti(9);
  eq('L9 returns 16 picks (capped)', picks.length, MAX_SUMMONS_PER_CAST);
}

console.log('\n=== 6. All picks in a pack are the same creature ===');
{
  setBestiaryForTesting(null);
  const picks = pickConjureAnimalsSummonMulti(3);
  if (picks.length > 0) {
    const allSameName = picks.every(p => p.name === picks[0].name);
    assert('all picks have same name', allSameName);
    const allSameCR = picks.every(p => p.cr === picks[0].cr);
    assert('all picks have same CR', allSameCR);
  } else {
    assert('picks not empty', false);
  }
}

console.log('\n=== 7. Picks are CR 1/4 beasts (within "8 CR 1/4" option) ===');
{
  setBestiaryForTesting(null);
  const picks = pickConjureAnimalsSummonMulti(3);
  if (picks.length > 0) {
    // The "8 beasts of CR 1/4" option caps CR at 0.25. The picker uses
    // pickSummonByCR which returns the HIGHEST CR within the cap. With
    // cap = 0.25, the highest CR is 0.25 (e.g. Wolf).
    assert('CR ≤ 0.25', picks[0].cr <= 0.25);
  } else {
    assert('picks not empty', false);
  }
}

console.log('\n=== 8. pickConjureAnimalsSummonMulti returns [] when bestiary empty ===');
{
  setBestiaryForTesting(new Map());
  const picks = pickConjureAnimalsSummonMulti(3);
  eq('empty bestiary returns []', picks.length, 0);
}

console.log('\n=== 9. pickConjureWoodlandBeingsSummonMulti(L4) returns 8 fey picks ===');
{
  setBestiaryForTesting(null);
  const picks = pickConjureWoodlandBeingsSummonMulti(4);
  if (picks.length > 0) {
    console.log(`    Picked fey: ${picks[0].name} (CR ${picks[0].cr})`);
  }
  // L4 base count = 8, multiplier = 1, cap 16 → 8
  eq('L4 returns 8 picks', picks.length, 8);
}

console.log('\n=== 10. pickConjureWoodlandBeingsSummonMulti returns [] when bestiary empty ===');
{
  setBestiaryForTesting(new Map());
  const picks = pickConjureWoodlandBeingsSummonMulti(4);
  eq('empty bestiary returns []', picks.length, 0);
}

console.log('\n=== 11. pickConjureMinorElementalsSummonMulti(L4) returns 8 elemental picks ===');
{
  setBestiaryForTesting(null);
  const picks = pickConjureMinorElementalsSummonMulti(4);
  if (picks.length > 0) {
    console.log(`    Picked elemental: ${picks[0].name} (CR ${picks[0].cr})`);
  }
  // L4 base count = 8, multiplier = 1, cap 16 → 8
  eq('L4 returns 8 picks', picks.length, 8);
}

console.log('\n=== 12. pickConjureMinorElementalsSummonMulti returns [] when bestiary empty ===');
{
  setBestiaryForTesting(new Map());
  const picks = pickConjureMinorElementalsSummonMulti(4);
  eq('empty bestiary returns []', picks.length, 0);
}

console.log('\n=== 13. conjure_animals.execute spawns 8 creatures when bestiary loaded (L3) ===');
{
  setBestiaryForTesting(null);
  const caster = makeCaster('caster', { 3: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCA(caster, caster, state);

  // Count summons spawned by this cast
  const summons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals',
  );
  eq('8 summons spawned at L3', summons.length, 8);

  // L3 slot consumed
  eq('L3 slot consumed', caster.resources!.spellSlots![3]!.remaining, 0);
}

console.log('\n=== 14. conjure_animals.execute spawns 16 creatures when bestiary loaded (L5) ===');
{
  setBestiaryForTesting(null);
  // L5 slot — uses the upcast multiplier (2×). Session 45 Task #28-follow-up
  // raised the cap from 8 to 16, so L5 now spawns the full 16 (PHB-accurate).
  const caster = makeCaster('caster', { 3: 0, 4: 0, 5: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCA(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals',
  );
  // L5 has 2× multiplier = 16, cap now 16 → 16 (was 8 pre-Session-45)
  eq('16 summons spawned at L5 (cap raised)', summons.length, 16);

  // L5 slot consumed
  eq('L5 slot consumed', caster.resources!.spellSlots![5]!.remaining, 0);
}

console.log('\n=== 15. conjure_animals.execute falls back to 2 Wolves when bestiary empty ===');
{
  setBestiaryForTesting(new Map());
  const caster = makeCaster('caster', { 3: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCA(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Animals',
  );
  // v1 fallback: 2 Wolves
  eq('2 Wolves spawned (v1 fallback)', summons.length, 2);
  if (summons.length > 0) {
    assert('Wolf has Pack Tactics trait', summons[0].traits.includes('Pack Tactics'));
  }
}

console.log('\n=== 16. conjure_woodland_beings.execute spawns 8 creatures when bestiary loaded ===');
{
  setBestiaryForTesting(null);
  const caster = makeCaster('caster', { 4: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCWB(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Woodland Beings',
  );
  eq('8 summons spawned at L4', summons.length, 8);
}

console.log('\n=== 17. conjure_minor_elementals.execute spawns 8 creatures when bestiary loaded ===');
{
  setBestiaryForTesting(null);
  const caster = makeCaster('caster', { 4: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCME(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(
    c => c.isSummon && c.summonerId === caster.id && c.summonSpellName === 'Conjure Minor Elementals',
  );
  eq('8 summons spawned at L4', summons.length, 8);
}

console.log('\n=== 18. Each spawned creature has isSummon=true and summonerId set ===');
{
  setBestiaryForTesting(null);
  const caster = makeCaster('caster', { 3: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCA(caster, caster, state);

  const summons = [...bf.combatants.values()].filter(c => c.isSummon);
  for (let i = 0; i < summons.length; i++) {
    assert(`summon ${i}: isSummon=true`, summons[i].isSummon === true);
    assert(`summon ${i}: summonerId=caster`, summons[i].summonerId === 'caster');
    assert(`summon ${i}: summonSpellName set`, summons[i].summonSpellName === 'Conjure Animals');
  }
}

console.log('\n=== 19. Spawned creatures are inserted into initiative after the caster ===');
{
  setBestiaryForTesting(null);
  const caster = makeCaster('caster', { 3: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCA(caster, caster, state);

  // All 8 summons should be in pendingInitiativeInserts with insertAfterId = caster.id
  const inserts = bf.pendingInitiativeInserts.filter(
    (ins: any) => ins.insertAfterId === caster.id,
  );
  eq('8 initiative inserts', inserts.length, 8);
}

console.log('\n=== 20. Log entry mentions the count and creature name ===');
{
  setBestiaryForTesting(null);
  const caster = makeCaster('caster', { 3: 1 });
  const enemy = makeCaster('enemy', {}, { faction: 'enemy', pos: { x: 5, y: 0, z: 0 } });
  const bf = makeBF([caster, enemy]);
  const state = makeState(bf);

  executeCA(caster, caster, state);

  // Find the cast log
  const castLog = state.log.events.find(
    (e: any) => e.type === 'action' && e.description.includes('casts Conjure Animals'),
  );
  assert('cast log entry exists', castLog !== undefined);
  if (castLog) {
    // Should mention "8" (count) somewhere
    assert('log mentions count "8"', castLog.description.includes('8'));
    console.log(`    Log: ${castLog.description}`);
  }
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('conjure_multi.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('conjure_multi.test.ts: all tests passed ✅');
}
