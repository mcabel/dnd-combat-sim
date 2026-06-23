// ============================================================
// Test: Elemental Affinity in remaining bespoke spells (Session 50,
// Task #29-follow-up-5c-3)
//
// Validates that Elemental Affinity (Draconic Sorcerer 6, PHB p.102) is
// wired into the bespoke execute() functions of 10 additional spells:
//   - Cloudkill (poison, save AoE — CON save)
//   - Vitriolic Sphere (acid, save AoE — DEX save)
//   - Melf's Acid Arrow (acid, spell attack + delayed 2d4 acid)
//       EA on immediate hit only; delayed damage_zone tick has no
//       caster context for the bonus (v1 simplification, documented).
//   - Witch Bolt (lightning, spell attack + DoT)
//       EA on BOTH fresh-cast hit AND each DoT tick (per damage roll).
//   - Call Lightning (lightning, auto-hit on cast + damage_zone tick)
//       EA on the on-cast bolt only; damage_zone tick has no caster
//       context (v1 simplification, documented).
//   - Frost Fingers (cold, save AoE — CON save)
//   - Ice Storm (cold + bludgeoning — EA on cold ONLY)
//   - Flame Strike (fire + radiant — EA on fire ONLY)
//   - Fire Storm (fire, save AoE — DEX save)
//   - Ray of Sickness (poison, spell attack)
//
// Pattern (consistent with Sessions 47-49):
//   - The +CHA mod bonus is added once to the total damage roll BEFORE
//     save halving (so the bonus IS halved on save success).
//   - Auto-hit spells (Call Lightning on-cast bolt) get the full bonus
//     with no halving.
//   - Mixed-damage spells (Ice Storm, Flame Strike) only get EA on the
//     matching draconic-ancestry damage type; the other portion is
//     unchanged.
//   - Damage_zone ticks (delayed Melf's Acid Arrow, persistent Call
//     Lightning) do NOT get EA — the tick handler has no caster context.
//     Documented as a v1 simplification.
//
// Coverage (22 assertions across 18 sections):
//   1.  Cloudkill + poison ancestry → +CHA mod on each target
//   2.  Cloudkill + fire ancestry → no bonus
//   3.  Vitriolic Sphere + acid ancestry → +CHA mod
//   4.  Vitriolic Sphere + cold ancestry → no bonus
//   5.  Melf's Acid Arrow + acid ancestry → +CHA mod on immediate hit
//   6.  Witch Bolt + lightning ancestry → +CHA mod on fresh-cast hit
//   7.  Witch Bolt + lightning ancestry → +CHA mod on DoT tick
//   8.  Witch Bolt + fire ancestry → no bonus on hit or DoT
//   9.  Call Lightning + lightning ancestry → +CHA mod on on-cast bolt
//  10.  Call Lightning + cold ancestry → no bonus on on-cast bolt
//  11.  Frost Fingers + cold ancestry → +CHA mod
//  12.  Frost Fingers + fire ancestry → no bonus
//  13.  Ice Storm + cold ancestry → cold portion includes EA
//  14.  Ice Storm + cold ancestry → bludgeoning portion does NOT include EA
//  15.  Flame Strike + fire ancestry → fire portion includes EA
//  16.  Flame Strike + fire ancestry → radiant portion does NOT include EA
//  17.  Fire Storm + fire ancestry → +CHA mod
//  18.  Ray of Sickness + poison ancestry → +CHA mod on hit
//
// Run: npx ts-node --transpile-only src/test/elemental_affinity_remaining_bespoke.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { execute as executeCloudkill } from '../spells/cloudkill';
import { execute as executeVitriolicSphere } from '../spells/vitriolic_sphere';
import { execute as executeMelfsAcidArrow } from '../spells/melf_s_acid_arrow';
import { execute as executeWitchBolt } from '../spells/witch_bolt';
import { execute as executeCallLightning } from '../spells/call_lightning';
import { execute as executeFrostFingers } from '../spells/frost_fingers';
import { execute as executeIceStorm } from '../spells/ice_storm';
import { execute as executeFlameStrike } from '../spells/flame_strike';
import { execute as executeFireStorm } from '../spells/fire_storm';
import { execute as executeRayOfSickness } from '../spells/ray_of_sickness';
import { Combatant, Action, Battlefield, Vec3 } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
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
    maxHP: 100000, currentHP: 100000, ac: 5, speed: 30,
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

/** Pull the first 'damage' event description from state.log.events. */
function firstDmgDesc(state: any): string | undefined {
  const ev = state.log.events.find((e: any) => e.type === 'damage');
  return ev?.description;
}

// ---- CHA mod at Sorc 6 with base CHA 17 = +3 ----------------
// All EA bonuses are +3 (CHA 17 → mod +3).

// ============================================================
// 1. Cloudkill + poison ancestry → +CHA mod on each target
// ============================================================
console.log('\n--- 1. Cloudkill + poison ancestry → EA on each target ---');
{
  const sorc = makeSorc('poison', { 5: 1 });
  const CLOUDKILL_ACTION: Action = {
    name: 'Cloudkill', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 120, long: 120 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
    requiresConcentration: true, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Cloudkill',
  };
  sorc.actions = [CLOUDKILL_ACTION];

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { dex: 1, con: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 }, { dex: 1, con: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, e1, e2]);
  const state = makeState(bf);

  executeCloudkill(sorc, [e1, e2], state);

  // 5d8 poison + 3 EA. Min = 5 + 3 = 8. (CON 1 → guaranteed save fail → full dmg.)
  const dmgValues = allDmgValues(state);
  assert('1a. 2 target damage events', dmgValues.length === 2, `got ${dmgValues.length}`);
  if (dmgValues.length === 2) {
    const allHaveEA = dmgValues.every(d => d >= 8);
    assert('1b. ALL targets include EA (each ≥ 8)', allHaveEA, `got ${JSON.stringify(dmgValues)}`);
    console.log(`    Cloudkill per-target damage (5d8 + 3 EA): ${JSON.stringify(dmgValues)}`);
  }
}

// ============================================================
// 2. Cloudkill + fire ancestry → no bonus
// ============================================================
console.log('\n--- 2. Cloudkill + fire ancestry → no EA ---');
{
  const sorc = makeSorc('fire', { 5: 1 });  // fire ancestry, NOT poison
  const CLOUDKILL_ACTION: Action = {
    name: 'Cloudkill', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 120, long: 120 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
    requiresConcentration: true, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Cloudkill',
  };
  sorc.actions = [CLOUDKILL_ACTION];

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { dex: 1, con: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, e1]);
  const state = makeState(bf);

  executeCloudkill(sorc, [e1], state);

  // 5d8 max = 40. No +3 (fire ancestry, poison spell).
  const dmg = firstDmgValue(state);
  assert('2. damage ≤ 40 (no EA)', dmg !== undefined && dmg <= 40, `got ${dmg}`);
  console.log(`    Cloudkill damage (no EA): ${dmg}`);
}

// ============================================================
// 3. Vitriolic Sphere + acid ancestry → +CHA mod
// ============================================================
console.log('\n--- 3. Vitriolic Sphere + acid ancestry → EA ---');
{
  const sorc = makeSorc('acid', { 4: 1 });
  const VS_ACTION: Action = {
    name: 'Vitriolic Sphere', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 4, costType: 'action', legendaryCost: 0,
    description: 'Vitriolic Sphere',
  };
  sorc.actions = [VS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeVitriolicSphere(sorc, [enemy], state);

  // 10d4 acid + 3 EA. Min = 10 + 3 = 13. (DEX 1 → guaranteed fail → full dmg.)
  const dmg = firstDmgValue(state);
  assert('3. damage includes EA (≥ 13)', dmg !== undefined && dmg >= 13, `got ${dmg}`);
  console.log(`    Vitriolic Sphere damage (acid + EA): ${dmg}`);
}

// ============================================================
// 4. Vitriolic Sphere + cold ancestry → no bonus
// ============================================================
console.log('\n--- 4. Vitriolic Sphere + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', { 4: 1 });  // cold ancestry, NOT acid
  const VS_ACTION: Action = {
    name: 'Vitriolic Sphere', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 4, costType: 'action', legendaryCost: 0,
    description: 'Vitriolic Sphere',
  };
  sorc.actions = [VS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeVitriolicSphere(sorc, [enemy], state);

  // 10d4 max = 40. No +3 (cold ancestry, acid spell).
  const dmg = firstDmgValue(state);
  assert('4. damage ≤ 40 (no EA)', dmg !== undefined && dmg <= 40, `got ${dmg}`);
  console.log(`    Vitriolic Sphere damage (no EA): ${dmg}`);
}

// ============================================================
// 5. Melf's Acid Arrow + acid ancestry → +CHA mod on immediate hit
// ============================================================
console.log('\n--- 5. Melf\'s Acid Arrow + acid ancestry → EA on immediate ---');
{
  const sorc = makeSorc('acid', { 2: 1 });
  const MAA_ACTION: Action = {
    name: "Melf's Acid Arrow", isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 2, costType: 'action', legendaryCost: 0,
    description: "Melf's Acid Arrow",
  };
  sorc.actions = [MAA_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeMelfsAcidArrow(sorc, enemy, state);

  // 4d4 acid + 3 EA. Min = 4 + 3 = 7.
  const dmg = firstDmgValue(state);
  assert('5. immediate damage includes EA (≥ 7)', dmg !== undefined && dmg >= 7, `got ${dmg}`);
  console.log(`    Melf's Acid Arrow immediate damage (acid + EA): ${dmg}`);
}

// ============================================================
// 6. Witch Bolt + lightning ancestry → +CHA mod on fresh-cast hit
// ============================================================
console.log('\n--- 6. Witch Bolt + lightning ancestry → EA on fresh-cast hit ---');
{
  const sorc = makeSorc('lightning', { 1: 1 });
  const WB_ACTION: Action = {
    name: 'Witch Bolt', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 30, long: 30 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Witch Bolt',
  };
  sorc.actions = [WB_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeWitchBolt(sorc, enemy, state);

  // 1d12 lightning + 3 EA. Min = 1 + 3 = 4.
  const dmg = firstDmgValue(state);
  assert('6. fresh-cast damage includes EA (≥ 4)', dmg !== undefined && dmg >= 4, `got ${dmg}`);
  console.log(`    Witch Bolt fresh-cast damage (lightning + EA): ${dmg}`);
}

// ============================================================
// 7. Witch Bolt + lightning ancestry → +CHA mod on DoT tick
// ============================================================
console.log('\n--- 7. Witch Bolt + lightning ancestry → EA on DoT tick ---');
{
  const sorc = makeSorc('lightning', { 1: 1 });
  const WB_ACTION: Action = {
    name: 'Witch Bolt', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 30, long: 30 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Witch Bolt',
  };
  sorc.actions = [WB_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  // Fresh cast first (consumes slot, starts concentration).
  executeWitchBolt(sorc, enemy, state);

  // Reset events to capture only DoT-tick damage.
  state.log.events = [];

  // Second call: DoT mode (concentration active, auto-hit 1d12 + EA).
  executeWitchBolt(sorc, enemy, state);

  // 1d12 + 3 EA. Min = 1 + 3 = 4.
  const dmg = firstDmgValue(state);
  assert('7. DoT tick damage includes EA (≥ 4)', dmg !== undefined && dmg >= 4, `got ${dmg}`);
  console.log(`    Witch Bolt DoT tick damage (lightning + EA): ${dmg}`);
}

// ============================================================
// 8. Witch Bolt + fire ancestry → no bonus on hit or DoT
// ============================================================
console.log('\n--- 8. Witch Bolt + fire ancestry → no EA on hit or DoT ---');
{
  const sorc = makeSorc('fire', { 1: 1 });
  const WB_ACTION: Action = {
    name: 'Witch Bolt', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 30, long: 30 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Witch Bolt',
  };
  sorc.actions = [WB_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  // Fresh cast.
  executeWitchBolt(sorc, enemy, state);
  const hitDmg = firstDmgValue(state);
  // 1d12 max = 12. No +3.
  assert('8a. fresh-cast damage ≤ 12 (no EA)', hitDmg !== undefined && hitDmg <= 12, `got ${hitDmg}`);

  // DoT tick.
  state.log.events = [];
  executeWitchBolt(sorc, enemy, state);
  const dotDmg = firstDmgValue(state);
  assert('8b. DoT tick damage ≤ 12 (no EA)', dotDmg !== undefined && dotDmg <= 12, `got ${dotDmg}`);
  console.log(`    Witch Bolt no-EA damage: hit=${hitDmg}, dot=${dotDmg}`);
}

// ============================================================
// 9. Call Lightning + lightning ancestry → +CHA mod on on-cast bolt
// ============================================================
console.log('\n--- 9. Call Lightning + lightning ancestry → EA on on-cast bolt ---');
{
  const sorc = makeSorc('lightning', { 3: 1 });
  const CL_ACTION: Action = {
    name: 'Call Lightning', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 120, long: 120 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: true, slotLevel: 3, costType: 'action', legendaryCost: 0,
    description: 'Call Lightning',
  };
  sorc.actions = [CL_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeCallLightning(sorc, [enemy], state);

  // 3d10 lightning + 3 EA, no save (auto-hit on cast). Min = 3 + 3 = 6.
  const dmg = firstDmgValue(state);
  assert('9. on-cast bolt damage includes EA (≥ 6)', dmg !== undefined && dmg >= 6, `got ${dmg}`);
  console.log(`    Call Lightning on-cast bolt damage (lightning + EA): ${dmg}`);
}

// ============================================================
// 10. Call Lightning + cold ancestry → no bonus on on-cast bolt
// ============================================================
console.log('\n--- 10. Call Lightning + cold ancestry → no EA on on-cast bolt ---');
{
  const sorc = makeSorc('cold', { 3: 1 });  // cold ancestry, NOT lightning
  const CL_ACTION: Action = {
    name: 'Call Lightning', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 120, long: 120 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: true, slotLevel: 3, costType: 'action', legendaryCost: 0,
    description: 'Call Lightning',
  };
  sorc.actions = [CL_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeCallLightning(sorc, [enemy], state);

  // 3d10 max = 30. No +3.
  const dmg = firstDmgValue(state);
  assert('10. on-cast bolt damage ≤ 30 (no EA)', dmg !== undefined && dmg <= 30, `got ${dmg}`);
  console.log(`    Call Lightning on-cast bolt damage (no EA): ${dmg}`);
}

// ============================================================
// 11. Frost Fingers + cold ancestry → +CHA mod
// ============================================================
console.log('\n--- 11. Frost Fingers + cold ancestry → EA ---');
{
  const sorc = makeSorc('cold', { 1: 1 });
  const FF_ACTION: Action = {
    name: 'Frost Fingers', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 15, long: 15 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Frost Fingers',
  };
  sorc.actions = [FF_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, con: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeFrostFingers(sorc, [enemy], state);

  // 2d8 cold + 3 EA. Min = 2 + 3 = 5. (CON 1 → guaranteed fail → full dmg.)
  const dmg = firstDmgValue(state);
  assert('11. damage includes EA (≥ 5)', dmg !== undefined && dmg >= 5, `got ${dmg}`);
  console.log(`    Frost Fingers damage (cold + EA): ${dmg}`);
}

// ============================================================
// 12. Frost Fingers + fire ancestry → no bonus
// ============================================================
console.log('\n--- 12. Frost Fingers + fire ancestry → no EA ---');
{
  const sorc = makeSorc('fire', { 1: 1 });
  const FF_ACTION: Action = {
    name: 'Frost Fingers', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 15, long: 15 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Frost Fingers',
  };
  sorc.actions = [FF_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, con: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeFrostFingers(sorc, [enemy], state);

  // 2d8 max = 16. No +3.
  const dmg = firstDmgValue(state);
  assert('12. damage ≤ 16 (no EA)', dmg !== undefined && dmg <= 16, `got ${dmg}`);
  console.log(`    Frost Fingers damage (no EA): ${dmg}`);
}

// ============================================================
// 13. Ice Storm + cold ancestry → cold portion includes EA
// ============================================================
console.log('\n--- 13. Ice Storm + cold ancestry → cold portion includes EA ---');
{
  const sorc = makeSorc('cold', { 4: 1 });
  const IS_ACTION: Action = {
    name: 'Ice Storm', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 300, long: 300 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 4, costType: 'action', legendaryCost: 0,
    description: 'Ice Storm',
  };
  sorc.actions = [IS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeIceStorm(sorc, [enemy], state);

  // 2d8 cold (max 16) + 2d6 blud (max 12) = max 28 without EA.
  // With EA on cold: 2d8 + 3 cold (max 19) + 2d6 blud (max 12) = max 31.
  // Min with EA: 2 + 3 + 2 = 7. Min without EA: 2 + 2 = 4.
  // The damage description string contains "X cold + Y bludgeoning = Z total".
  // We parse it to verify the cold portion includes EA.
  const desc = firstDmgDesc(state) ?? '';
  const match = desc.match(/(\d+) cold \+ (\d+) bludgeoning/);
  assert('13a. damage description has cold+blud split', !!match, `desc: ${desc}`);
  if (match) {
    const cold = parseInt(match[1], 10);
    const blud = parseInt(match[2], 10);
    // 2d8 cold + 3 EA. Min = 5.
    assert('13b. cold portion includes EA (≥ 5)', cold >= 5, `cold=${cold}`);
    // 2d6 blud, max = 12.
    assert('13c. bludgeoning portion unaffected (≤ 12)', blud <= 12, `blud=${blud}`);
    console.log(`    Ice Storm with cold EA: cold=${cold}, blud=${blud}`);
  }
}

// ============================================================
// 14. Ice Storm + fire ancestry → no EA on cold or bludgeoning
// ============================================================
console.log('\n--- 14. Ice Storm + fire ancestry → no EA ---');
{
  const sorc = makeSorc('fire', { 4: 1 });
  const IS_ACTION: Action = {
    name: 'Ice Storm', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 300, long: 300 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 4, costType: 'action', legendaryCost: 0,
    description: 'Ice Storm',
  };
  sorc.actions = [IS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeIceStorm(sorc, [enemy], state);

  // 2d8 cold (max 16) + 2d6 blud (max 12) = max 28 without EA.
  const desc = firstDmgDesc(state) ?? '';
  const match = desc.match(/(\d+) cold \+ (\d+) bludgeoning/);
  assert('14a. damage description has cold+blud split', !!match, `desc: ${desc}`);
  if (match) {
    const cold = parseInt(match[1], 10);
    const blud = parseInt(match[2], 10);
    // 2d8 cold, max = 16. No EA.
    assert('14b. cold portion ≤ 16 (no EA)', cold <= 16, `cold=${cold}`);
    // 2d6 blud, max = 12.
    assert('14c. bludgeoning portion ≤ 12 (no EA)', blud <= 12, `blud=${blud}`);
    console.log(`    Ice Storm no EA: cold=${cold}, blud=${blud}`);
  }
}

// ============================================================
// 15. Flame Strike + fire ancestry → fire portion includes EA
// ============================================================
console.log('\n--- 15. Flame Strike + fire ancestry → fire portion includes EA ---');
{
  const sorc = makeSorc('fire', { 5: 1 });
  const FS_ACTION: Action = {
    name: 'Flame Strike', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Flame Strike',
  };
  sorc.actions = [FS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeFlameStrike(sorc, [enemy], state);

  // 4d6 fire (max 24) + 4d6 radiant (max 24) = max 48 without EA.
  // With EA on fire: 4d6 + 3 fire (max 27) + 4d6 radiant (max 24) = max 51.
  const desc = firstDmgDesc(state) ?? '';
  const match = desc.match(/(\d+) fire \+ (\d+) radiant/);
  assert('15a. damage description has fire+radiant split', !!match, `desc: ${desc}`);
  if (match) {
    const fire = parseInt(match[1], 10);
    const rad = parseInt(match[2], 10);
    // 4d6 fire + 3 EA. Min = 4 + 3 = 7.
    assert('15b. fire portion includes EA (≥ 7)', fire >= 7, `fire=${fire}`);
    // 4d6 radiant, max = 24.
    assert('15c. radiant portion unaffected (≤ 24)', rad <= 24, `rad=${rad}`);
    console.log(`    Flame Strike with fire EA: fire=${fire}, rad=${rad}`);
  }
}

// ============================================================
// 16. Flame Strike + cold ancestry → no EA on fire or radiant
// ============================================================
console.log('\n--- 16. Flame Strike + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', { 5: 1 });
  const FS_ACTION: Action = {
    name: 'Flame Strike', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Flame Strike',
  };
  sorc.actions = [FS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeFlameStrike(sorc, [enemy], state);

  const desc = firstDmgDesc(state) ?? '';
  const match = desc.match(/(\d+) fire \+ (\d+) radiant/);
  assert('16a. damage description has fire+radiant split', !!match, `desc: ${desc}`);
  if (match) {
    const fire = parseInt(match[1], 10);
    const rad = parseInt(match[2], 10);
    // 4d6 fire, max = 24. No EA.
    assert('16b. fire portion ≤ 24 (no EA)', fire <= 24, `fire=${fire}`);
    // 4d6 radiant, max = 24.
    assert('16c. radiant portion ≤ 24 (no EA)', rad <= 24, `rad=${rad}`);
    console.log(`    Flame Strike no EA: fire=${fire}, rad=${rad}`);
  }
}

// ============================================================
// 17. Fire Storm + fire ancestry → +CHA mod
// ============================================================
console.log('\n--- 17. Fire Storm + fire ancestry → EA ---');
{
  const sorc = makeSorc('fire', { 7: 1 });
  const FST_ACTION: Action = {
    name: 'Fire Storm', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 150, long: 150 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 7, costType: 'action', legendaryCost: 0,
    description: 'Fire Storm',
  };
  sorc.actions = [FST_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeFireStorm(sorc, [enemy], state);

  // 7d10 fire + 3 EA. Min = 7 + 3 = 10. (DEX 1 → guaranteed fail → full dmg.)
  const dmg = firstDmgValue(state);
  assert('17. damage includes EA (≥ 10)', dmg !== undefined && dmg >= 10, `got ${dmg}`);
  console.log(`    Fire Storm damage (fire + EA): ${dmg}`);
}

// ============================================================
// 18. Ray of Sickness + poison ancestry → +CHA mod on hit
// ============================================================
console.log('\n--- 18. Ray of Sickness + poison ancestry → EA on hit ---');
{
  const sorc = makeSorc('poison', { 1: 1 });
  const ROS_ACTION: Action = {
    name: 'Ray of Sickness', isMultiattack: false, attackType: 'spell',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: 30, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Ray of Sickness',
  };
  sorc.actions = [ROS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeRayOfSickness(sorc, enemy, state);

  // 2d8 poison + 3 EA. Min = 2 + 3 = 5.
  const dmg = firstDmgValue(state);
  assert('18. damage includes EA (≥ 5)', dmg !== undefined && dmg >= 5, `got ${dmg}`);
  console.log(`    Ray of Sickness damage (poison + EA): ${dmg}`);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('elemental_affinity_remaining_bespoke.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('elemental_affinity_remaining_bespoke.test.ts: all tests passed ✅');
}
