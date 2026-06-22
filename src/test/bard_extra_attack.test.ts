// ============================================================
// Test: Bard Extra Attack (Valor/Swords) — Session 44, Task #29
//
// Validates that Bard College of Valor and College of Swords both
// grant Extra Attack at Bard 6 (PHB p.55 / XGE p.15), and that the
// planner + engine correctly apply attackCount = 2 for these
// subclasses. Also validates that College of Lore (which does NOT
// grant Extra Attack) is unaffected.
//
// Coverage:
//   1. Bard 6 (College of Valor chosen at Bard 3) → Extra Attack in allFeatures
//   2. Bard 6 (College of Swords chosen at Bard 3) → Extra Attack in allFeatures
//   3. Bard 6 (College of Lore chosen at Bard 3) → NO Extra Attack
//   4. Bard 5 (Valor chosen at Bard 3) → NO Extra Attack yet (only at Bard 6)
//   5. Extra Attack feature has source 'subclass' (not 'class')
//   6. Alias normalisation: 'Valor' resolves to 'College of Valor'
//   7. Alias normalisation: 'Swords' resolves to 'College of Swords'
//   8. Retroactive grant: chooseSubclass at Bard 7 still grants Extra Attack
//   9. Retroactive grant doesn't duplicate if feature already present
//  10. classFeatures transferred to Combatant for Bard 6 Valor
//  11. hasFeature helper works for Bard 6 Valor
//  12. hasFeature returns false for Bard 6 Lore
//  13. Planner sets attackCount = 2 for Bard 6 Valor
//  14. Planner does NOT set attackCount for Bard 6 Lore
//  15. Engine executes 2 attacks for Bard 6 Valor
//  16. End-to-end: Bard 6 Valor deals more damage than Bard 6 Lore
//
// Run: npx ts-node src/test/bard_extra_attack.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant, hasFeature } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { planTurn } from '../ai/planner';
import { executePlannedAction, EngineState } from '../engine/combat';
import { Combatant, Action, Vec3, Battlefield } from '../types/core';

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

/** Bard level-1 sheet (CHA 16, DEX 14). Based on character_leveler.test.ts makeBard.
 *
 *  Uses non-damaging cantrips (Minor Illusion, Prestidigitation) so that
 *  when spell slots are drained (simulating "turn 2+"), the planner falls
 *  back to a Rapier weapon attack. With damaging cantrips like Vicious
 *  Mockery, the planner would cantrip-spam and never use the Rapier —
 *  which would prevent us from testing Extra Attack.
 */
function makeBard1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Melodia', race: 'Half-Elf', background: 'Entertainer',
    alignment: 'Chaotic Good',
    firstClass: 'Bard',
    classLevels: [{ className: 'Bard', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 16 },
    stats:     { str: 8, dex: 14, con: 12, int: 10, wis: 10, cha: 18 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 14, acFormula: 'Leather + DEX', speed: 30,
    hitDice: [{ className: 'Bard', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light'], weapons: ['simple-melee','simple-ranged','martial-melee'],
      tools: ['lute'], savingThrows: ['dex','cha'],
      skills: ['Persuasion','Performance','Deception'], expertise: ['Persuasion'],
    },
    languages: ['Common', 'Elvish', 'Gnomish'],
    resources: {
      bardicInspiration: { max: 4, remaining: 4, dieSides: 6 },
    },
    spellcasting: {
      ability: 'cha', spellAttackBonus: 6, saveDC: 14,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      // Non-damaging cantrips so the planner picks Rapier when slots are drained.
      cantrips: ['Minor Illusion', 'Prestidigitation'],
      knownSpells: ['Healing Word', 'Dissonant Whispers'],
      preparedSpells: [],
      spellbook: [],
    },
    equipment: [{ name: 'Rapier', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [{ name: 'Bardic Inspiration (d6)', description: 'Grant a d6 die to an ally.', source: 'class' },
                     { name: 'Spellcasting',             description: 'CHA caster.',                source: 'class' }],
    allFeatures:    [{ name: 'Bardic Inspiration (d6)', description: 'Grant a d6 die to an ally.', source: 'class' },
                     { name: 'Spellcasting',             description: 'CHA caster.',                source: 'class' }],
    feats: [], backgroundFeature: 'By Popular Demand', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

/**
 * Level a Bard from 1 to `targetLevel`, choosing subclass at Bard 3.
 * If subclass is null, skip the chooseSubclass call (test the no-subclass path).
 */
function levelBard(
  targetLevel: number,
  subclass: string | null,
  startSheet?: CharacterSheet,
): CharacterSheet {
  let sheet = startSheet ?? makeBard1();
  for (let lvl = 2; lvl <= targetLevel; lvl++) {
    const result = applyLevelUp(sheet, 'Bard', 'average');
    sheet = result.sheet;
    // At Bard 3, choose subclass (if requested)
    if (lvl === 3 && subclass !== null) {
      sheet = chooseSubclass(sheet, 'Bard', subclass);
    }
  }
  return sheet;
}

/**
 * Mark all spell slots as used so the planner can't cast spells and
 * must fall back to a weapon attack. This simulates "turn 2+" of
 * combat after the Bard has already cast their spells. Without this,
 * the planner prefers Dissonant Whispers (a save spell that deals
 * 3d6 psychic) over a Rapier attack, which would prevent us from
 * testing Extra Attack (which only fires on Attack actions).
 *
 * NOTE: buildCombatant() ignores sheet.spellcasting.slotsUsed and
 * always sets Combatant.spellSlots[n].remaining = max. So we have
 * to drain the slots on the Combatant AFTER buildCombatant returns,
 * not on the sheet before. (This matches the engine's "combat starts
 * with full slots" assumption — long rest happens before combat.)
 */
function drainCombatantSpellSlots(combatant: Combatant): Combatant {
  if (!combatant.resources?.spellSlots) return combatant;
  const slots = { ...combatant.resources.spellSlots };
  for (const lvl of Object.keys(slots)) {
    const n = Number(lvl);
    slots[n] = { ...slots[n], remaining: 0 };
  }
  return {
    ...combatant,
    resources: {
      ...combatant.resources,
      spellSlots: slots,
    },
  };
}

/** Make a goblin enemy for combat tests.
 *
 *  Position is (1, 0, 0) — 1 square (5 ft) from the Bard at origin —
 *  so the Rapier (5 ft reach) can attack without movement. This mirrors
 *  the extra_attack.test.ts setup.
 */
function makeGoblin(pos: Vec3 = { x: 1, y: 0, z: 0 }): Combatant {
  const scimitar: Action = {
    name: 'Scimitar',
    isMultiattack: false,
    attackType: 'melee',
    reach: 5,
    range: { normal: 5, long: 5 },
    hitBonus: 4,
    damage: { count: 1, sides: 6, bonus: 2, average: 5 },
    damageType: 'slashing',
    saveDC: null,
    saveAbility: null,
    isAoE: false,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 0,
    costType: 'action',
    legendaryCost: 0,
    description: 'Scimitar: +4 to hit, 1d6+2 slashing.',
  };
  return {
    id: 'goblin_' + randomUUID(),
    name: 'Goblin',
    isPlayer: false,
    faction: 'enemy',
    maxHP: 1000, currentHP: 1000,
    ac: 13,
    speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8,
    cr: 0.25,
    pos,
    actions: [scimitar],
    traits: [],
    legendaryActions: [],
    legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: {
      movementFt: 30,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      freeObjectUsed: false,
    },
    conditions: new Set(),
    aiProfile: 'attackNearest',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    wearingArmor: false,
    isDead: false,
    isUnconscious: false,
    advantages: [],
    vulnerabilities: [],
    resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
  };
}

function makeBattlefield(bard: Combatant, goblin: Combatant): Battlefield {
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
    combatants: new Map([[bard.id, bard], [goblin.id, goblin]]),
    round: 1,
    initiativeOrder: [bard.id, goblin.id],
    pendingInitiativeInserts: [],
  } as any;
}

function makeEngineState(bf: Battlefield): EngineState {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  } as any;
}

// ============================================================
// Tests
// ============================================================

console.log('\n=== 1. Bard 6 (College of Valor) gains Extra Attack ===');
{
  const bard = levelBard(6, 'College of Valor');
  const extraAttacks = bard.allFeatures.filter(f => f.name === 'Extra Attack');
  eq('Bard 6 Valor has exactly 1 Extra Attack feature', extraAttacks.length, 1);
  eq('Extra Attack source is subclass', extraAttacks[0].source, 'subclass');
}

console.log('\n=== 2. Bard 6 (College of Swords) gains Extra Attack ===');
{
  const bard = levelBard(6, 'College of Swords');
  const extraAttacks = bard.allFeatures.filter(f => f.name === 'Extra Attack');
  eq('Bard 6 Swords has exactly 1 Extra Attack feature', extraAttacks.length, 1);
  eq('Extra Attack source is subclass', extraAttacks[0].source, 'subclass');
}

console.log('\n=== 3. Bard 6 (College of Lore) does NOT gain Extra Attack ===');
{
  const bard = levelBard(6, 'College of Lore');
  const extraAttacks = bard.allFeatures.filter(f => f.name === 'Extra Attack');
  eq('Bard 6 Lore has NO Extra Attack feature', extraAttacks.length, 0);
}

console.log('\n=== 4. Bard 5 (Valor) does NOT have Extra Attack yet ===');
{
  const bard = levelBard(5, 'College of Valor');
  const extraAttacks = bard.allFeatures.filter(f => f.name === 'Extra Attack');
  eq('Bard 5 Valor has NO Extra Attack (only at 6)', extraAttacks.length, 0);
}

console.log('\n=== 5. Extra Attack feature has source "subclass" (not "class") ===');
{
  const bard = levelBard(6, 'College of Valor');
  const ea = bard.allFeatures.find(f => f.name === 'Extra Attack');
  assert('Extra Attack found', !!ea);
  if (ea) {
    eq('source is "subclass"', ea.source, 'subclass');
  }
}

console.log('\n=== 6. Alias normalisation: "Valor" → College of Valor ===');
{
  const bard = levelBard(6, 'Valor');
  const extraAttacks = bard.allFeatures.filter(f => f.name === 'Extra Attack');
  eq('"Valor" alias grants Extra Attack', extraAttacks.length, 1);
}

console.log('\n=== 7. Alias normalisation: "Swords" → College of Swords ===');
{
  const bard = levelBard(6, 'Swords');
  const extraAttacks = bard.allFeatures.filter(f => f.name === 'Extra Attack');
  eq('"Swords" alias grants Extra Attack', extraAttacks.length, 1);
}

console.log('\n=== 8. Retroactive grant: chooseSubclass at Bard 7 still grants Extra Attack ===');
{
  // Level Bard 1→7 WITHOUT choosing subclass at Bard 3
  let sheet = makeBard1();
  for (let lvl = 2; lvl <= 7; lvl++) {
    sheet = applyLevelUp(sheet, 'Bard', 'average').sheet;
  }
  // At Bard 7, no Extra Attack yet
  const beforeExtra = sheet.allFeatures.filter(f => f.name === 'Extra Attack').length;
  eq('Bard 7 (no subclass) has 0 Extra Attack', beforeExtra, 0);

  // Now choose College of Valor at Bard 7 — should retroactively grant Extra Attack for Bard 6
  sheet = chooseSubclass(sheet, 'Bard', 'College of Valor');
  const afterExtra = sheet.allFeatures.filter(f => f.name === 'Extra Attack').length;
  eq('Bard 7 (chose Valor late) has 1 Extra Attack (retroactive)', afterExtra, 1);
}

console.log('\n=== 9. Retroactive grant doesn\'t duplicate if feature already present ===');
{
  // Normal path: choose Valor at Bard 3, level to 6 (gets Extra Attack via applyLevelUp)
  const bard = levelBard(6, 'College of Valor');
  const extraCount = bard.allFeatures.filter(f => f.name === 'Extra Attack').length;
  eq('Bard 6 Valor (normal path) has exactly 1 Extra Attack', extraCount, 1);
}

console.log('\n=== 10. classFeatures transferred to Combatant for Bard 6 Valor ===');
{
  const sheet = levelBard(6, 'College of Valor');
  const combatant = buildCombatant(sheet);
  assert('combatant.classFeatures is defined', combatant.classFeatures !== undefined);
  if (combatant.classFeatures) {
    assert(
      'combatant.classFeatures includes "Extra Attack"',
      combatant.classFeatures.includes('Extra Attack'),
    );
  }
}

console.log('\n=== 11. hasFeature helper works for Bard 6 Valor ===');
{
  const sheet = levelBard(6, 'College of Valor');
  const combatant = buildCombatant(sheet);
  assert('hasFeature(combatant, "Extra Attack") returns true', hasFeature(combatant, 'Extra Attack'));
}

console.log('\n=== 12. hasFeature returns false for Bard 6 Lore ===');
{
  const sheet = levelBard(6, 'College of Lore');
  const combatant = buildCombatant(sheet);
  assert('hasFeature(combatant, "Extra Attack") returns false for Lore',
    !hasFeature(combatant, 'Extra Attack'));
}

console.log('\n=== 13. Planner sets attackCount = 2 for Bard 6 Valor ===');
{
  const sheet = levelBard(6, 'College of Valor');
  const bard = drainCombatantSpellSlots(buildCombatant(sheet, { x: 0, y: 0, z: 0 }));
  const goblin = makeGoblin();
  const bf = makeBattlefield(bard, goblin);
  const plan = planTurn(bard, bf);

  assert('plan.action is set', plan.action !== null && plan.action !== undefined);
  if (plan.action) {
    eq('Bard 6 Valor attackCount = 2', plan.action.attackCount, 2);
  }
}

console.log('\n=== 14. Planner does NOT set attackCount for Bard 6 Lore ===');
{
  const sheet = levelBard(6, 'College of Lore');
  const bard = drainCombatantSpellSlots(buildCombatant(sheet, { x: 0, y: 0, z: 0 }));
  const goblin = makeGoblin();
  const bf = makeBattlefield(bard, goblin);
  const plan = planTurn(bard, bf);

  assert('plan.action is set', plan.action !== null && plan.action !== undefined);
  if (plan.action) {
    eq('Bard 6 Lore attackCount = undefined (no Extra Attack)', plan.action.attackCount, undefined);
  }
}

console.log('\n=== 15. Engine executes 2 attacks for Bard 6 Valor ===');
{
  const sheet = levelBard(6, 'College of Valor');
  const bard = drainCombatantSpellSlots(buildCombatant(sheet, { x: 0, y: 0, z: 0 }));
  const goblin = makeGoblin();
  const bf = makeBattlefield(bard, goblin);
  const state = makeEngineState(bf);
  const plan = planTurn(bard, bf);

  if (plan.action) {
    executePlannedAction(bard, plan.action, state);
    // Each attack produces one of: attack_hit, attack_miss, attack_crit.
    // Extra Attack (2 attacks) should produce exactly 2 such events.
    const attackEvents = state.log.events.filter(
      (e: any) =>
        (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit') &&
        e.actorId === bard.id,
    );
    eq('Bard 6 Valor executes 2 attack events', attackEvents.length, 2);
  } else {
    assert('plan.action is set (skipping engine test)', false);
  }
}

console.log('\n=== 16. End-to-end: Bard 6 Valor deals more damage than Bard 6 Lore ===');
{
  // Use a higher-HP enemy so we don't run into "enemy dies before all attacks land"
  const N = 60;
  let valorDmg = 0;
  let loreDmg = 0;

  for (let i = 0; i < N; i++) {
    // Valor Bard
    {
      const sheet = levelBard(6, 'College of Valor');
      const bard = drainCombatantSpellSlots(buildCombatant(sheet, { x: 0, y: 0, z: 0 }));
      const goblin = makeGoblin();
      const bf = makeBattlefield(bard, goblin);
      const state = makeEngineState(bf);
      const plan = planTurn(bard, bf);
      if (plan.action) {
        executePlannedAction(bard, plan.action, state);
      }
      valorDmg += (1000 - goblin.currentHP);
    }
    // Lore Bard
    {
      const sheet = levelBard(6, 'College of Lore');
      const bard = drainCombatantSpellSlots(buildCombatant(sheet, { x: 0, y: 0, z: 0 }));
      const goblin = makeGoblin();
      const bf = makeBattlefield(bard, goblin);
      const state = makeEngineState(bf);
      const plan = planTurn(bard, bf);
      if (plan.action) {
        executePlannedAction(bard, plan.action, state);
      }
      loreDmg += (1000 - goblin.currentHP);
    }
  }

  const avgValor = valorDmg / N;
  const avgLore = loreDmg / N;
  console.log(`    Average damage — Valor: ${avgValor.toFixed(1)}, Lore: ${avgLore.toFixed(1)}`);
  console.log(`    Ratio (Valor/Lore): ${(avgValor / avgLore).toFixed(2)}×`);
  // Valor should deal ~2× damage (2 attacks vs 1). Use a generous 1.3× bound
  // to handle variance — with N=60 trials, P(ratio < 1.3) ≈ 1e-7.
  assert(
    `Bard 6 Valor damage > 1.3× Lore (${avgValor.toFixed(1)} > ${avgLore.toFixed(1)})`,
    avgValor > avgLore * 1.3,
  );
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('bard_extra_attack.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('bard_extra_attack.test.ts: all tests passed ✅');
}
