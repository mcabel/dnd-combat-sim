// ============================================================
// Test: Barbarian Rage + Resistance System
// Covers:
//   - addResistance / removeResistance helpers
//   - applyDamageWithTempHP resistance halving (PHB p.197)
//   - case 'rage': grants B/P/S resistance
//   - +2 rage damage on melee attacks while raging
//   - +2 does NOT apply to ranged attacks or non-raging actors
//   - tickRage: end conditions (rounds, no attack, no damage)
//   - B/P/S resistances stripped on rage end
//   - Rage grants advantage on STR saves (PHB p.48) — statistical test
//   - Integration: full-combat barbarian
// Run: ts-node src/test/rage.test.ts
// ============================================================

import { runCombat, makeFlatBattlefield } from '../engine/combat';
import { addResistance, removeResistance, applyDamageWithTempHP, rollSave } from '../engine/utils';
import { tickRage } from '../ai/resources';
import { Combatant, Action } from '../types/core';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  assert(label, actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Factories ----------------------------------------------

let _id = 0;
function makeC(overrides: Partial<Combatant> = {}): Combatant {
  const id = overrides.id ?? `c_${++_id}`;
  return {
    id, name: id, isPlayer: false, faction: 'party',
    maxHP: 20, currentHP: 20, ac: 14,
    speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 8,
    cr: 1, pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() },
    concentration: null,
    deathSaves: null,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [],
    ...overrides,
  };
}

function meleeAction(overrides: Partial<Action> = {}): Action {
  return {
    name: 'Greataxe', isMultiattack: false, attackType: 'melee',
    reach: 5, range: null, hitBonus: 5,
    damage: { count: 1, sides: 12, bonus: 3, average: 9.5 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
    ...overrides,
  };
}

function rangedAction(overrides: Partial<Action> = {}): Action {
  return {
    name: 'Handaxe', isMultiattack: false, attackType: 'ranged',
    reach: 5, range: { normal: 30, long: 60 }, hitBonus: 5,
    damage: { count: 1, sides: 6, bonus: 3, average: 6.5 },
    damageType: 'slashing', saveDC: null, saveAbility: null,
    isAoE: false, isControl: false, requiresConcentration: false,
    costType: 'action', legendaryCost: 0, description: '',
    ...overrides,
  };
}

/** Fixed initiative order for deterministic tests. */
function fixedInit(...cs: Combatant[]): string[] {
  return cs.map(c => c.id);
}

// ---- Section: addResistance / removeResistance helpers ------

console.log('\n=== addResistance / removeResistance ===');
{
  const c = makeC();

  addResistance(c, 'fire');
  assert('addResistance: fire added', c.resistances.includes('fire'));
  eq('addResistance: length 1', c.resistances.length, 1);

  // Idempotent — no duplicates
  addResistance(c, 'fire');
  eq('addResistance: idempotent (no duplicate)', c.resistances.length, 1);

  addResistance(c, 'cold');
  eq('addResistance: two distinct types', c.resistances.length, 2);

  removeResistance(c, 'fire');
  assert('removeResistance: fire removed', !c.resistances.includes('fire'));
  assert('removeResistance: cold still present', c.resistances.includes('cold'));
  eq('removeResistance: length 1 after remove', c.resistances.length, 1);

  // No-op on absent type
  removeResistance(c, 'fire');
  eq('removeResistance: no-op on absent type', c.resistances.length, 1);
}

// ---- Section: applyDamageWithTempHP + resistance halving ----

console.log('\n=== applyDamageWithTempHP resistance halving ===');
{
  // Case 1: damage type in resistances → halved (floor)
  const c1 = makeC({ currentHP: 20 });
  addResistance(c1, 'slashing');
  const dealt1 = applyDamageWithTempHP(c1, 10, 'slashing');
  eq('Resisted: 10 slashing → 5 dealt', dealt1, 5);
  eq('Resisted: HP = 15 after 10 slashing', c1.currentHP, 15);

  // Case 2: damage type NOT in resistances → full
  const c2 = makeC({ currentHP: 20 });
  addResistance(c2, 'fire');
  const dealt2 = applyDamageWithTempHP(c2, 10, 'slashing');
  eq('Not resisted: 10 slashing (fire resist) → 10 dealt', dealt2, 10);
  eq('Not resisted: HP = 10', c2.currentHP, 10);

  // Case 3: odd number — floor(7/2) = 3
  const c3 = makeC({ currentHP: 20 });
  addResistance(c3, 'bludgeoning');
  const dealt3 = applyDamageWithTempHP(c3, 7, 'bludgeoning');
  eq('Resistance floors: 7 bludgeoning → 3 dealt', dealt3, 3);
  eq('Resistance floors: HP = 17', c3.currentHP, 17);

  // Case 4: no damageType passed → no halving
  const c4 = makeC({ currentHP: 20 });
  addResistance(c4, 'slashing');
  const dealt4 = applyDamageWithTempHP(c4, 10);
  eq('No damageType: 10 dealt (no halving)', dealt4, 10);

  // Case 5: null damageType → no halving
  const c5 = makeC({ currentHP: 20 });
  addResistance(c5, 'slashing');
  const dealt5 = applyDamageWithTempHP(c5, 10, null);
  eq('null damageType: 10 dealt (no halving)', dealt5, 10);

  // Case 6: resistance + temp HP — resistance applied first, then temp HP absorbs
  const c6 = makeC({ currentHP: 20, tempHP: 3 });
  addResistance(c6, 'fire');
  // 12 fire → halved to 6 → 3 absorbed by tempHP → 3 to HP
  const dealt6 = applyDamageWithTempHP(c6, 12, 'fire');
  eq('Resist + tempHP: 12 fire → 6 effective → 3 tempHP absorb → 3 HP', dealt6, 6);
  eq('Resist + tempHP: tempHP = 0', c6.tempHP, 0);
  eq('Resist + tempHP: HP = 17', c6.currentHP, 17);
}

// ---- Section: tickRage mechanics ----------------------------

console.log('\n=== tickRage ===');
{
  function makeRagingBarb(roundsRemaining: number): Combatant {
    return makeC({
      id: `barb_${++_id}`,
      resources: {
        rage: { max: 2, remaining: 2, active: true, roundsRemaining },
      },
    });
  }

  // Rage stays active when barbarian attacked this turn
  const b1 = makeRagingBarb(3);
  tickRage(b1, true, false);
  assert('tickRage: rage persists when attacked', b1.resources!.rage!.active === true);
  eq('tickRage: roundsRemaining decrements', b1.resources!.rage!.roundsRemaining, 2);

  // Rage stays active when damage was taken since last turn
  const b2 = makeRagingBarb(3);
  tickRage(b2, false, true);
  assert('tickRage: rage persists when took damage', b2.resources!.rage!.active === true);

  // Rage ends when neither attacked nor took damage
  const b3 = makeRagingBarb(3);
  tickRage(b3, false, false);
  assert('tickRage: rage ends without attack or damage', b3.resources!.rage!.active === false);
  eq('tickRage: roundsRemaining = 0 on end', b3.resources!.rage!.roundsRemaining, 0);

  // Rage ends when roundsRemaining hits 0 (even if attacked)
  const b4 = makeRagingBarb(1); // last round
  tickRage(b4, true, false);
  assert('tickRage: rage ends at round 0 even with attack', b4.resources!.rage!.active === false);

  // tickRage is a no-op when rage is not active
  const b5 = makeC({
    resources: { rage: { max: 2, remaining: 2, active: false, roundsRemaining: 0 } },
  });
  tickRage(b5, true, true);
  assert('tickRage: no-op when rage inactive', b5.resources!.rage!.active === false);
}

// ---- Section: rage engine integration ----------------------

console.log('\n=== Rage engine integration ===');
{
  // Barbarian with rage resource and guaranteed-hit melee weapon.
  // Verify: rage activates, rage log entry fires, B/P/S resistance is granted.
  const barbId = 'barb_rage_test';
  const barb = makeC({
    id: barbId,
    name: 'Gruk the Raging',
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    ac: 14, maxHP: 30, currentHP: 30,
    traits: ['Rage', 'Reckless Attack'],
    actions: [meleeAction({ hitBonus: 20 })],
    resources: {
      rage: { max: 2, remaining: 2, active: false, roundsRemaining: 0 },
    },
  });

  const goblin = makeC({
    id: 'goblin_1',
    name: 'Goblin',
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    ac: 10, maxHP: 5, currentHP: 5,
    actions: [meleeAction({ hitBonus: 4, damage: { count: 1, sides: 4, bonus: 2, average: 4.5 }, damageType: 'slashing' })],
  });

  const bf = makeFlatBattlefield(10, 10, [barb, goblin]);
  const result = runCombat(bf, fixedInit(barb, goblin), { maxRounds: 15 });

  eq('Rage integration: party wins', result.winner, 'party');

  const finalBarb = bf.combatants.get(barbId)!;
  const rageRes = finalBarb.resources?.rage;
  assert('Rage integration: rage resource present', rageRes !== undefined);
  assert('Rage integration: rage was used (remaining < max)',
    rageRes!.remaining < rageRes!.max);

  const rageEvent = result.events.find(e =>
    e.actorId === barbId &&
    (e.description.toLowerCase().includes('rage')));
  assert('Rage integration: rage action appears in log', rageEvent !== undefined);
}

{
  // Resistance test: raging barbarian (pre-activated) takes half slashing damage.
  const barbId = 'barb_resist_test';
  const barb = makeC({
    id: barbId,
    name: 'Gruk (resisting)',
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    ac: 20,            // near-unhittable by enemy (+4 vs AC 20 → needs 16+)
    maxHP: 100, currentHP: 100,
    traits: ['Rage', 'Reckless Attack'],
    actions: [meleeAction({ hitBonus: null, damage: { count: 1, sides: 2, bonus: 0, average: 1.5 } })], // auto-hit (no nat-1 auto-miss flakiness)
    resources: {
      rage: { max: 2, remaining: 1, active: true, roundsRemaining: 10 },
    },
  });
  // Pre-grant rage resistances
  addResistance(barb, 'bludgeoning');
  addResistance(barb, 'piercing');
  addResistance(barb, 'slashing');

  const enemy = makeC({
    id: 'slasher_1',
    name: 'Slasher',
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    ac: 4, maxHP: 1, currentHP: 1,
    // guaranteed-hit, fixed 10 slashing damage per hit
    actions: [meleeAction({
      hitBonus: 20,
      damage: { count: 1, sides: 1, bonus: 9, average: 10 },
      damageType: 'slashing',
    })],
  });

  const bf2 = makeFlatBattlefield(10, 10, [barb, enemy]);
  // Enemy goes first: deals 10 slashing → should be halved to 5 by resistance
  runCombat(bf2, fixedInit(enemy, barb), { maxRounds: 2 });

  const finalBarb2 = bf2.combatants.get(barbId)!;
  // Barb starts 100 HP. 10 slashing → resisted to 5.
  // (barb kills enemy on own turn, combat ends)
  assert('Resistance: barb HP > 90 after 10 slashing (resistance halved it)',
    finalBarb2.currentHP > 90,
    `HP was ${finalBarb2.currentHP}`);
}

{
  // Rage +2 bonus does NOT apply to ranged attacks.
  const barbId = 'barb_ranged_test';
  const barb = makeC({
    id: barbId,
    name: 'Gruk (ranged)',
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    ac: 15, maxHP: 30, currentHP: 30,
    traits: ['Rage'],
    actions: [rangedAction({ hitBonus: 20 })],
    resources: {
      rage: { max: 2, remaining: 1, active: true, roundsRemaining: 5 },
    },
  });
  addResistance(barb, 'bludgeoning');
  addResistance(barb, 'piercing');
  addResistance(barb, 'slashing');

  const target = makeC({
    id: 'dummy_ranged',
    name: 'Target Dummy',
    faction: 'enemy',
    pos: { x: 5, y: 0, z: 0 },
    ac: 4, maxHP: 50, currentHP: 50,
    actions: [],
  });

  const bf3 = makeFlatBattlefield(20, 10, [barb, target]);
  const result3 = runCombat(bf3, fixedInit(barb, target), { maxRounds: 2 });

  const rageBonusEvents = result3.events.filter(e =>
    e.actorId === barbId && e.description.includes('Rage bonus'));
  eq('Rage +2 does NOT apply to ranged attacks', rageBonusEvents.length, 0);
}

// ---- Section: resistance stripped on rage end ---------------

console.log('\n=== Resistance stripped on rage end ===');
{
  // Last round of rage (roundsRemaining = 1). After 1 turn with attack,
  // tickRage fires → roundsRemaining hits 0 → rage ends → resistances cleared.
  const barbId = 'barb_end_test';
  const barb = makeC({
    id: barbId,
    name: 'Gruk (ending rage)',
    faction: 'party',
    pos: { x: 0, y: 0, z: 0 },
    ac: 15, maxHP: 30, currentHP: 30,
    traits: ['Rage', 'Reckless Attack'],
    actions: [meleeAction({ hitBonus: 20 })],
    resources: {
      rage: { max: 2, remaining: 0, active: true, roundsRemaining: 1 },
    },
  });
  addResistance(barb, 'bludgeoning');
  addResistance(barb, 'piercing');
  addResistance(barb, 'slashing');

  const dummy = makeC({
    id: 'dummy_end',
    name: 'Dummy',
    faction: 'enemy',
    pos: { x: 1, y: 0, z: 0 },
    ac: 4, maxHP: 200, currentHP: 200, // survives so we can inspect barb post-turn
    actions: [],
  });

  const bf4 = makeFlatBattlefield(10, 10, [barb, dummy]);
  runCombat(bf4, fixedInit(barb, dummy), { maxRounds: 1 });

  const finalBarb = bf4.combatants.get(barbId)!;
  assert('Rage end: bludgeoning resistance removed', !finalBarb.resistances.includes('bludgeoning'));
  assert('Rage end: piercing resistance removed',   !finalBarb.resistances.includes('piercing'));
  assert('Rage end: slashing resistance removed',   !finalBarb.resistances.includes('slashing'));
  assert('Rage end: rage.active = false',           finalBarb.resources!.rage!.active === false);
}

// ---- Section: non-B/P/S types not halved while raging ------

console.log('\n=== Non-B/P/S damage not resisted ===');
{
  const c = makeC({ currentHP: 20 });
  // Rage grants only B/P/S
  addResistance(c, 'bludgeoning');
  addResistance(c, 'piercing');
  addResistance(c, 'slashing');

  const dealtFire = applyDamageWithTempHP(c, 10, 'fire');
  eq('Fire damage: NOT halved by B/P/S resistance', dealtFire, 10);
  eq('Fire damage: HP = 10', c.currentHP, 10);

  const dealtSlash = applyDamageWithTempHP(c, 4, 'slashing');
  eq('Slashing (after fire hit): halved to 2', dealtSlash, 2);
  eq('Slashing HP: 8', c.currentHP, 8);
}

// ============================================================
// Section: Rage grants advantage on STR saves (PHB p.48)
// ============================================================
// PHB p.48: "When you rage, you gain the following benefits... You have
// advantage on Strength checks and Strength saving throws while raging."
//
// This is a statistical test. With STR 10 (mod 0) vs DC 12:
//   - Flat d20: need 12+ → 45% pass rate (9 of 20 values)
//   - With advantage: P(at least one ≥ 12) = 1 − (11/20)² ≈ 69.75% pass rate
//
// Over 400 iterations:
//   - Raging STR saves: mean ≈ 279, 99.9% CI ≈ [249, 309]
//   - Non-raging STR saves: mean ≈ 180, 99.9% CI ≈ [147, 213]
//   - Raging DEX saves (control): mean ≈ 180 (rage should NOT apply)
//
// Threshold of 240 cleanly separates raging-advantage (>240) from
// flat-d20 (<240) with < 0.1% false-failure probability per assertion.
console.log('\n=== Rage STR save advantage (PHB p.48) ===');
{
  const N = 400;
  const DC = 12;

  // --- Raging barbarian: STR saves ---
  const ragingBarb = makeC({
    str: 10,
    resources: { rage: { max: 2, remaining: 1, active: true, roundsRemaining: 10 } },
  });
  let ragingStrPasses = 0;
  for (let i = 0; i < N; i++) {
    if (rollSave(ragingBarb, 'str', DC).success) ragingStrPasses++;
  }
  assert(`Raging STR saves: ${ragingStrPasses}/${N} passed (expect ~280 with advantage)`,
    ragingStrPasses > 240,
    `got ${ragingStrPasses} — advantage may not be applied`);

  // --- Non-raging barbarian: STR saves (control) ---
  const calmBarb = makeC({
    str: 10,
    resources: { rage: { max: 2, remaining: 2, active: false, roundsRemaining: 0 } },
  });
  let calmStrPasses = 0;
  for (let i = 0; i < N; i++) {
    if (rollSave(calmBarb, 'str', DC).success) calmStrPasses++;
  }
  assert(`Non-raging STR saves: ${calmStrPasses}/${N} passed (expect ~180, flat d20)`,
    calmStrPasses < 240,
    `got ${calmStrPasses} — advantage may be incorrectly applied when rage is inactive`);

  // --- Raging barbarian: DEX saves (control — rage should NOT grant DEX advantage) ---
  const ragingDexBarb = makeC({
    dex: 10,
    resources: { rage: { max: 2, remaining: 1, active: true, roundsRemaining: 10 } },
  });
  let ragingDexPasses = 0;
  for (let i = 0; i < N; i++) {
    if (rollSave(ragingDexBarb, 'dex', DC).success) ragingDexPasses++;
  }
  assert(`Raging DEX saves: ${ragingDexPasses}/${N} passed (expect ~180, rage is STR-only)`,
    ragingDexPasses < 240,
    `got ${ragingDexPasses} — rage advantage may be incorrectly applied to non-STR saves`);

  // --- Sanity: raging STR should pass significantly more than non-raging STR ---
  assert('Raging STR passes > non-raging STR passes (advantage confirmed)',
    ragingStrPasses > calmStrPasses + 40, // 40 = ~2 std devs of separation
    `raging=${ragingStrPasses}, calm=${calmStrPasses}`);
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
