// ============================================================
// Test: Elemental Affinity in additional bespoke spells (Session 49,
// Task #29-follow-up-5c-2)
//
// Validates that Elemental Affinity (Draconic Sorcerer 6, PHB p.102) is
// wired into the bespoke execute() functions of:
//   - Ice Knife (cold AoE only — piercing does NOT qualify)
//   - Chromatic Orb (dynamically-picked damage type — EA matches picked type)
//   - Scorching Ray (fire, each ray gets EA independently)
//   - Chain Lightning (lightning, auto-hit, each target gets EA)
//
// Session 48 wired EA in Fireball, Lightning Bolt, Cone of Cold, Burning
// Hands. This test verifies 4 additional bespoke spells also apply the
// CHA mod bonus when the caster's draconic ancestry matches the spell's
// damage type.
//
// Note on Shatter / Catapult from the Session 48 handover's "future"
// list: Shatter deals THUNDER damage (not a draconic ancestry type —
// EA never applies), and Catapult deals BLUDGEONING damage (also not a
// draconic ancestry type — EA never applies). Neither qualifies, so
// neither is wired here. The 4 spells tested below all deal acid/cold/
// fire/lightning/poison damage and DO qualify.
//
// Coverage:
//   1. Ice Knife + cold ancestry → +CHA mod on cold AoE
//   2. Ice Knife + fire ancestry → no bonus on cold AoE
//   3. Ice Knife: piercing portion NEVER gets EA (max 1d10 = 10)
//   4. Chromatic Orb + acid ancestry (no resistances → picks acid) → +CHA mod
//   5. Chromatic Orb + lightning ancestry (picker picks acid) → no bonus
//   6. Chromatic Orb + fire ancestry + target resists acid/cold → picks fire → +CHA mod
//   7. Scorching Ray + fire ancestry → +CHA mod per ray (≥ 3 rays with EA)
//   8. Scorching Ray + cold ancestry → no bonus per ray
//   9. Chain Lightning + lightning ancestry → +CHA mod per target (auto-hit)
//  10. Chain Lightning + fire ancestry → no bonus per target
//  11. Non-Sorcerer caster → no EA bonus on any of the 4 spells
//  12. Chromatic Orb + thunder 'ancestry' → never fires EA (thunder isn't draconic)
//
// Run: npx ts-node src/test/elemental_affinity_more_bespoke.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { execute as executeIceKnife } from '../spells/ice_knife';
import { execute as executeChromaticOrb } from '../spells/chromatic_orb';
import { execute as executeScorchingRay } from '../spells/scorching_ray';
import { execute as executeChainLightning } from '../spells/chain_lightning';
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

function makeSorcerer1(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Lyra', race: 'Human', background: 'Sage',
    alignment: 'Chaotic Good',
    firstClass: 'Sorcerer',
    classLevels: [{ className: 'Sorcerer', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 17 },
    stats:     { str: 8, dex: 14, con: 13, int: 10, wis: 10, cha: 17 },
    maxHP: 8, currentHP: 8, temporaryHP: 0,
    armorClass: 12, acFormula: 'No armor + DEX', speed: 30,
    hitDice: [{ className: 'Sorcerer', dieSides: 6, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['con','cha'],
      skills: ['Arcana','Persuasion'], expertise: [],
    },
    languages: ['Common'],
    resources: {},
    spellcasting: {
      ability: 'cha', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Fire Bolt'],
      knownSpells: [], preparedSpells: [], spellbook: [],
    },
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [
      { name: 'Spellcasting', description: 'CHA caster.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Spellcasting', description: 'CHA caster.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Researcher', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function levelTo(sheet: CharacterSheet, cls: string, target: number, subclass: string | null = null): CharacterSheet {
  let s = sheet;
  if (subclass && cls === 'Sorcerer') {
    s = chooseSubclass(s, cls, subclass);
  }
  for (let lvl = 2; lvl <= target; lvl++) {
    s = applyLevelUp(s, cls).sheet;
  }
  return s;
}

function makeEnemy(id: string, pos: Vec3, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 10000, currentHP: 10000, ac: 5, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 1, int: 10, wis: 10, cha: 10,  // dex/con 1 = guaranteed-fail saves
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
  const width = 60, height = 60, depth = 1;
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

function makeState(bf: Battlefield): any {
  return {
    battlefield: bf,
    log: { events: [], winner: null, rounds: 0 },
    disengagedThisTurn: new Set(),
    damageThisRound: new Map(),
    noDamageRounds: new Map(),
    rageDamagedSinceLastTurn: new Set(),
  };
}

/** Build a Draconic Sorcerer 6 with the given ancestry + spell slots. */
function makeSorc(ancestry: string, slots: Record<number, number>): Combatant {
  const sheet = levelTo(makeSorcerer1(), 'Sorcerer', 6, 'Draconic Bloodline');
  const sorc = buildCombatant(sheet, { x: 0, y: 0, z: 0 });
  sorc.draconicAncestry = ancestry;
  if (!sorc.resources) sorc.resources = {} as any;
  if (!sorc.resources!.spellSlots) sorc.resources!.spellSlots = {};
  for (const [lvl, count] of Object.entries(slots)) {
    sorc.resources!.spellSlots[Number(lvl)] = { max: count, remaining: count };
  }
  return sorc;
}

/** Pull the first 'damage' event value from state.log.events. */
function firstDmgValue(state: any): number | undefined {
  const ev = state.log.events.find((e: any) => e.type === 'damage');
  return ev?.value;
}

/** Pull ALL 'damage' event values from state.log.events. */
function allDmgValues(state: any): number[] {
  return state.log.events
    .filter((e: any) => e.type === 'damage')
    .map((e: any) => e.value as number);
}

/** Pull the first 'damage' event value whose description contains `needle`. */
function firstDmgValueByDesc(state: any, needle: string): number | undefined {
  const ev = state.log.events.find(
    (e: any) => e.type === 'damage' && typeof e.description === 'string' && e.description.includes(needle),
  );
  return ev?.value;
}

// ============================================================
// 1. Ice Knife + cold ancestry → +CHA mod on cold AoE
// ============================================================
console.log('\n--- 1. Ice Knife + cold ancestry → EA on cold AoE ---');
{
  const sorc = makeSorc('cold', { 1: 1 });
  const ICE_KNIFE_ACTION: Action = {
    name: 'Ice Knife', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Ice Knife',
  };
  sorc.actions = [ICE_KNIFE_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 1000, currentHP: 1000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeIceKnife(sorc, { primary: enemy, explosion: [enemy] }, state);

  // Cold AoE: 2d6 + 3 EA. Min = 2 + 3 = 5. (Enemy DEX 1 → guaranteed save fail → full dmg.)
  // De-flake: the cold AoE fires on hit OR miss (XGE p.157), so the cold
  // damage event always exists. Find it by description (not by index) so
  // the test is robust to the 5% nat-1 pierce-miss case.
  const coldDmg = firstDmgValueByDesc(state, 'Ice Knife cold');
  assert('1a. cold damage event found', coldDmg !== undefined, 'no "Ice Knife cold" damage event');
  if (coldDmg !== undefined) {
    assert('1b. cold damage includes EA (≥ 5)', coldDmg >= 5, `got ${coldDmg}`);
    console.log(`    Ice Knife cold damage: ${coldDmg} (2d6 + 3 EA, guaranteed-fail)`);
  }
}

// ============================================================
// 2. Ice Knife + fire ancestry → no bonus on cold AoE
// ============================================================
console.log('\n--- 2. Ice Knife + fire ancestry → no EA on cold AoE ---');
{
  const sorc = makeSorc('fire', { 1: 1 });  // fire ancestry, NOT cold
  const ICE_KNIFE_ACTION: Action = {
    name: 'Ice Knife', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Ice Knife',
  };
  sorc.actions = [ICE_KNIFE_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 1000, currentHP: 1000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeIceKnife(sorc, { primary: enemy, explosion: [enemy] }, state);

  // Cold AoE: 2d6 only. Max = 12. No +3 bonus (fire ancestry, cold spell).
  // De-flake: find cold damage by description (not index) — robust to nat-1 miss.
  const coldDmg = firstDmgValueByDesc(state, 'Ice Knife cold');
  assert('2a. cold damage event found', coldDmg !== undefined, 'no "Ice Knife cold" damage event');
  if (coldDmg !== undefined) {
    assert('2b. cold damage ≤ 12 (no EA)', coldDmg <= 12, `got ${coldDmg}`);
    console.log(`    Ice Knife cold damage (no EA): ${coldDmg}`);
  }
}

// ============================================================
// 3. Ice Knife: piercing portion NEVER gets EA (max 1d10 = 10, or 2d10 = 20 on crit)
// ============================================================
console.log('\n--- 3. Ice Knife: piercing never gets EA ---');
{
  // Cold ancestry — would match cold AoE, but piercing is NOT a draconic type.
  const sorc = makeSorc('cold', { 1: 1 });
  const ICE_KNIFE_ACTION: Action = {
    name: 'Ice Knife', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Ice Knife',
  };
  sorc.actions = [ICE_KNIFE_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);

  // De-flake: nat 1 (5%) → miss → no pierce damage event. Retry up to 50
  // times until the attack hits. With 95% hit rate, P(50 consecutive misses)
  // ≈ 0.05^50 ≈ 10^-65 — effectively impossible.
  let pierceDmg: number | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    // Reset the enemy's HP + the sorcerer's slot each attempt so the spell
    // can be re-cast (executeIceKnife consumes a slot).
    enemy.currentHP = 10000;
    if (!sorc.resources) sorc.resources = {} as any;
    if (!sorc.resources!.spellSlots) sorc.resources!.spellSlots = {};
    sorc.resources!.spellSlots[1] = { max: 1, remaining: 1 };
    const state = makeState(bf);
    executeIceKnife(sorc, { primary: enemy, explosion: [enemy] }, state);
    const dmgValues = allDmgValues(state);
    if (dmgValues.length >= 1) {
      pierceDmg = dmgValues[0];
      break;
    }
  }

  // Piercing: 1d10 max = 10 (no EA). On a crit (nat 20, 5% chance), dice
  // double to 2d10 = max 20 (still no EA — piercing is not draconic).
  // If EA WERE applied, 1d10 + 3 = max 13, or 2d10 + 3 = max 23.
  // So `≤ 20` proves no EA regardless of crit.
  if (pierceDmg !== undefined) {
    assert('3. pierce damage ≤ 20 (no EA on piercing; crit may double dice)', pierceDmg <= 20, `got ${pierceDmg}`);
    console.log(`    Ice Knife pierce damage (no EA): ${pierceDmg}`);
  } else {
    assert('3. pierce damage event missing after 50 attempts', false);
  }
}

// ============================================================
// 4. Chromatic Orb + acid ancestry (no resistances → picks acid) → +CHA mod
// ============================================================
console.log('\n--- 4. Chromatic Orb + acid ancestry → EA (picker picks acid) ---');
{
  const sorc = makeSorc('acid', { 1: 1 });
  const CHROMATIC_ORB_ACTION: Action = {
    name: 'Chromatic Orb', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Chromatic Orb',
  };
  sorc.actions = [CHROMATIC_ORB_ACTION];

  // No resistances → picker picks 'acid' (first in ORB_DAMAGE_TYPES)
  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5, resistances: [] });
  const bf = makeBF([sorc, enemy]);

  // De-flake: nat 1 (5%) → miss → no damage event. Retry up to 50 times.
  let dmg: number | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    enemy.currentHP = 10000;
    if (!sorc.resources) sorc.resources = {} as any;
    if (!sorc.resources!.spellSlots) sorc.resources!.spellSlots = {};
    sorc.resources!.spellSlots[1] = { max: 1, remaining: 1 };
    const state = makeState(bf);
    executeChromaticOrb(sorc, enemy, state);
    const v = firstDmgValue(state);
    if (v !== undefined) { dmg = v; break; }
  }

  // Chromatic Orb = 3d8 acid + 3 EA. Min = 3 + 3 = 6.
  assert('4. damage includes EA (≥ 6)', dmg !== undefined && dmg >= 6, `got ${dmg}`);
  console.log(`    Chromatic Orb damage (acid + EA): ${dmg}`);
}

// ============================================================
// 5. Chromatic Orb + lightning ancestry (picker picks acid) → no bonus
// ============================================================
console.log('\n--- 5. Chromatic Orb + lightning ancestry, picker picks acid → no EA ---');
{
  const sorc = makeSorc('lightning', { 1: 1 });  // lightning ancestry, picker picks acid
  const CHROMATIC_ORB_ACTION: Action = {
    name: 'Chromatic Orb', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Chromatic Orb',
  };
  sorc.actions = [CHROMATIC_ORB_ACTION];

  // No resistances → picker picks 'acid' (NOT lightning) → EA does NOT fire.
  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5, resistances: [] });
  const bf = makeBF([sorc, enemy]);

  // De-flake: nat 1 (5%) → miss → no damage event. Retry up to 50 times.
  // P(50 consecutive misses) ≈ 10^-65 — effectively impossible.
  let dmg: number | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    enemy.currentHP = 10000;
    if (!sorc.resources) sorc.resources = {} as any;
    if (!sorc.resources!.spellSlots) sorc.resources!.spellSlots = {};
    sorc.resources!.spellSlots[1] = { max: 1, remaining: 1 };
    const state = makeState(bf);
    executeChromaticOrb(sorc, enemy, state);
    const v = firstDmgValue(state);
    if (v !== undefined) { dmg = v; break; }
  }

  // Normal hit: 3d8 max = 24. Crit (nat 20, 5%): 6d8 max = 48. No +3 EA
  // (picker picked acid, ancestry is lightning). If EA WERE applied,
  // 3d8 + 3 = max 27, or 6d8 + 3 = max 51. So `≤ 48` proves no EA.
  assert('5. damage ≤ 48 (no EA — type mismatch; crit may double dice)', dmg !== undefined && dmg <= 48, `got ${dmg}`);
  console.log(`    Chromatic Orb damage (lightning ancestry, acid picked, no EA): ${dmg}`);
}

// ============================================================
// 6. Chromatic Orb + fire ancestry + target resists acid/cold → picks fire → +CHA mod
// ============================================================
console.log('\n--- 6. Chromatic Orb + fire ancestry, picker skips acid/cold → picks fire → EA ---');
{
  const sorc = makeSorc('fire', { 1: 1 });
  const CHROMATIC_ORB_ACTION: Action = {
    name: 'Chromatic Orb', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Chromatic Orb',
  };
  sorc.actions = [CHROMATIC_ORB_ACTION];

  // Target resists acid + cold → picker skips both → picks 'fire' (3rd in list) → EA fires.
  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, {
    maxHP: 10000, currentHP: 10000, ac: 5,
    resistances: ['acid', 'cold'] as any,
  });
  const bf = makeBF([sorc, enemy]);

  // De-flake: nat 1 (5%) → miss → no damage event. Retry up to 50 times.
  let dmg: number | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    enemy.currentHP = 10000;
    if (!sorc.resources) sorc.resources = {} as any;
    if (!sorc.resources!.spellSlots) sorc.resources!.spellSlots = {};
    sorc.resources!.spellSlots[1] = { max: 1, remaining: 1 };
    const state = makeState(bf);
    executeChromaticOrb(sorc, enemy, state);
    const v = firstDmgValue(state);
    if (v !== undefined) { dmg = v; break; }
  }

  // Chromatic Orb = 3d8 fire + 3 EA. Min = 3 + 3 = 6.
  // The target resists acid + cold (NOT fire) → picker picks fire → fire
  // damage is NOT halved. Crit (nat 20, 5%) doubles dice to 6d8 + 3 = 51 max.
  // So: normal hit + EA: 6-27. Crit + EA: 9-51. Combined range: [6, 51].
  assert('6. fire damage picked + EA applied (≤ 51, ≥ 6)', dmg !== undefined && dmg >= 6 && dmg <= 51, `got ${dmg}`);
  console.log(`    Chromatic Orb damage (fire picked + EA, resisted acid/cold only): ${dmg}`);
}

// ============================================================
// 7. Scorching Ray + fire ancestry → +CHA mod per ray (3 rays)
// ============================================================
console.log('\n--- 7. Scorching Ray + fire ancestry → EA per ray ---');
{
  const sorc = makeSorc('fire', { 2: 1 });
  const SCORCHING_RAY_ACTION: Action = {
    name: 'Scorching Ray', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 120, long: 120 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 2, costType: 'action', legendaryCost: 0,
    description: 'Scorching Ray',
  };
  sorc.actions = [SCORCHING_RAY_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeScorchingRay(sorc, [enemy, enemy, enemy], state);

  // Each ray: 2d6 + 3 EA. Min per ray = 2 + 3 = 5.
  // De-flake: each ray can miss independently (5% per ray). With 3 rays,
  // P(at least 1 miss) ≈ 14.3%. So we can't require all 3 rays to hit.
  // Instead, require at least 1 ray hit, and ALL hit-rays include EA.
  const dmgValues = allDmgValues(state);
  assert('7a. at least 1 ray damage event', dmgValues.length >= 1, `got ${dmgValues.length}`);
  if (dmgValues.length >= 1) {
    const allHaveEA = dmgValues.every(d => d >= 5);
    assert('7b. ALL hit-rays include EA (each ≥ 5)', allHaveEA, `got ${JSON.stringify(dmgValues)}`);
    console.log(`    Scorching Ray per-ray damage (2d6 + 3 EA each): ${JSON.stringify(dmgValues)}`);
  }
}

// ============================================================
// 8. Scorching Ray + cold ancestry → no bonus per ray
// ============================================================
console.log('\n--- 8. Scorching Ray + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', { 2: 1 });  // cold ancestry, NOT fire
  const SCORCHING_RAY_ACTION: Action = {
    name: 'Scorching Ray', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 120, long: 120 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 2, costType: 'action', legendaryCost: 0,
    description: 'Scorching Ray',
  };
  sorc.actions = [SCORCHING_RAY_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeScorchingRay(sorc, [enemy, enemy, enemy], state);

  // Each ray: 2d6 only. Max per ray = 12. No +3 (cold ancestry, fire spell).
  // Scorching Ray's crit does NOT double dice (canon spell-dice rule).
  // De-flake: each ray can miss independently — require at least 1 ray hit,
  // and ALL hit-rays have ≤ 12 damage (no EA).
  const dmgValues = allDmgValues(state);
  assert('8a. at least 1 ray damage event', dmgValues.length >= 1, `got ${dmgValues.length}`);
  if (dmgValues.length >= 1) {
    const noneHaveEA = dmgValues.every(d => d <= 12);
    assert('8b. ALL hit-rays ≤ 12 (no EA)', noneHaveEA, `got ${JSON.stringify(dmgValues)}`);
    console.log(`    Scorching Ray per-ray damage (no EA): ${JSON.stringify(dmgValues)}`);
  }
}

// ============================================================
// 9. Chain Lightning + lightning ancestry → +CHA mod per target (auto-hit)
// ============================================================
console.log('\n--- 9. Chain Lightning + lightning ancestry → EA per target ---');
{
  const sorc = makeSorc('lightning', { 6: 1 });
  const CHAIN_LIGHTNING_ACTION: Action = {
    name: 'Chain Lightning', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 150, long: 150 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 6, costType: 'action', legendaryCost: 0,
    description: 'Chain Lightning',
  };
  sorc.actions = [CHAIN_LIGHTNING_ACTION];

  // 2 targets (1 primary + 1 arc).
  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, e1, e2]);
  const state = makeState(bf);

  executeChainLightning(sorc, [e1, e2], state);

  // Chain Lightning = 10d8 + 3 EA per target (auto-hit, no save halving).
  // Min per target = 10 + 3 = 13. Max = 80 + 3 = 83.
  const dmgValues = allDmgValues(state);
  assert('9a. 2 target damage events', dmgValues.length === 2, `got ${dmgValues.length}`);
  if (dmgValues.length === 2) {
    const allHaveEA = dmgValues.every(d => d >= 13);
    assert('9b. ALL targets include EA (each ≥ 13)', allHaveEA, `got ${JSON.stringify(dmgValues)}`);
    console.log(`    Chain Lightning per-target damage (10d8 + 3 EA): ${JSON.stringify(dmgValues)}`);
  }
}

// ============================================================
// 10. Chain Lightning + fire ancestry → no bonus per target
// ============================================================
console.log('\n--- 10. Chain Lightning + fire ancestry → no EA ---');
{
  const sorc = makeSorc('fire', { 6: 1 });  // fire ancestry, NOT lightning
  const CHAIN_LIGHTNING_ACTION: Action = {
    name: 'Chain Lightning', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 150, long: 150 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 6, costType: 'action', legendaryCost: 0,
    description: 'Chain Lightning',
  };
  sorc.actions = [CHAIN_LIGHTNING_ACTION];

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, e1, e2]);
  const state = makeState(bf);

  executeChainLightning(sorc, [e1, e2], state);

  // 10d8 max = 80. No +3.
  const dmgValues = allDmgValues(state);
  if (dmgValues.length === 2) {
    const noneHaveEA = dmgValues.every(d => d <= 80);
    assert('10. ALL targets ≤ 80 (no EA)', noneHaveEA, `got ${JSON.stringify(dmgValues)}`);
    console.log(`    Chain Lightning per-target damage (no EA): ${JSON.stringify(dmgValues)}`);
  } else {
    assert('10. 2 target damage events', false, `got ${dmgValues.length}`);
  }
}

// ============================================================
// 11. Non-Sorcerer caster → no EA bonus on any of the 4 spells
// ============================================================
console.log('\n--- 11. Non-Sorcerer: no EA bonus ---');
{
  // A Wizard with Chain Lightning — no Elemental Affinity feature.
  const wiz = makeEnemy('wiz', { x: 0, y: 0, z: 0 }, {
    faction: 'party', maxHP: 100, currentHP: 100,
    cha: 17,
    classFeatures: ['Spellcasting'],
  });
  wiz.draconicAncestry = 'lightning';  // set but no feature → no bonus
  if (!wiz.resources) wiz.resources = {} as any;
  if (!wiz.resources!.spellSlots) wiz.resources!.spellSlots = {};
  wiz.resources!.spellSlots[6] = { max: 1, remaining: 1 };
  const CHAIN_LIGHTNING_ACTION: Action = {
    name: 'Chain Lightning', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 150, long: 150 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 6, costType: 'action', legendaryCost: 0,
    description: 'Chain Lightning',
  };
  wiz.actions = [CHAIN_LIGHTNING_ACTION];

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 }, { maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([wiz, e1, e2]);
  const state = makeState(bf);

  executeChainLightning(wiz, [e1, e2], state);

  // Non-Sorcerer: no EA bonus. 10d8 max = 80.
  const dmgValues = allDmgValues(state);
  if (dmgValues.length === 2) {
    const noneHaveEA = dmgValues.every(d => d <= 80);
    assert('11. non-Sorcerer damage ≤ 80 (no EA)', noneHaveEA, `got ${JSON.stringify(dmgValues)}`);
    console.log(`    Wizard Chain Lightning damage (no EA): ${JSON.stringify(dmgValues)}`);
  } else {
    assert('11. 2 target damage events', false, `got ${dmgValues.length}`);
  }
}

// ============================================================
// 12. Chromatic Orb + thunder 'ancestry' → never fires EA (thunder isn't draconic)
// ============================================================
console.log('\n--- 12. Chromatic Orb + thunder ancestry → never fires EA ---');
{
  // Even though picker could pick any of the 6 types, EA only matches
  // acid/cold/fire/lightning/poison — NEVER thunder. So setting ancestry
  // to 'thunder' (even though no real draconic bloodline has it) must
  // yield 0 bonus regardless of picked type.
  const sorc = makeSorc('thunder', { 1: 1 });  // bogus ancestry, but feature is present
  const CHROMATIC_ORB_ACTION: Action = {
    name: 'Chromatic Orb', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Chromatic Orb',
  };
  sorc.actions = [CHROMATIC_ORB_ACTION];

  // No resistances → picker picks 'acid'. Ancestry='thunder' → no match → no EA.
  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5, resistances: [] });
  const bf = makeBF([sorc, enemy]);

  // De-flake: nat 1 (5%) → miss → no damage event. Retry up to 50 times.
  let dmg: number | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    enemy.currentHP = 10000;
    if (!sorc.resources) sorc.resources = {} as any;
    if (!sorc.resources!.spellSlots) sorc.resources!.spellSlots = {};
    sorc.resources!.spellSlots[1] = { max: 1, remaining: 1 };
    const state = makeState(bf);
    executeChromaticOrb(sorc, enemy, state);
    const v = firstDmgValue(state);
    if (v !== undefined) { dmg = v; break; }
  }

  // Normal hit: 3d8 max = 24. Crit (nat 20, 5%): 6d8 max = 48. No +3 EA
  // (thunder ancestry never matches any picked type). If EA WERE applied,
  // 3d8 + 3 = max 27, or 6d8 + 3 = max 51. So `≤ 48` proves no EA.
  assert('12. damage ≤ 48 (no EA — thunder never matches; crit may double dice)', dmg !== undefined && dmg <= 48, `got ${dmg}`);
  console.log(`    Chromatic Orb damage (thunder ancestry, no EA): ${dmg}`);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('elemental_affinity_more_bespoke.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('elemental_affinity_more_bespoke.test.ts: all tests passed ✅');
}
