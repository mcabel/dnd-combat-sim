// ============================================================
// Test: Elemental Affinity in Phase-4 bespoke spells (Session 51,
// Task #29-follow-up-5c-4)
//
// Validates that Elemental Affinity (Draconic Sorcerer 6, PHB p.102) is
// wired into the bespoke execute() functions of 6 additional spells,
// implemented in REVERSE PUBLISHED ORDER (newest pre-2024 source first):
//
//   XGE (2017) — 3 spells:
//   - Elemental Bane (acid, WIS save, single-target)
//   - Create Bonfire (fire, DEX save, cantrip, on-cast + damage_zone)
//       EA on the on-cast save only; damage_zone tick has no caster
//       context (v1 simplification, documented).
//   - Immolation (fire, DEX save, single-target)
//
//   PHB (2014) — 3 spells:
//   - Incendiary Cloud (fire, DEX save, AoE)
//   - Flaming Sphere (fire, DEX save, on-cast + damage_zone)
//       EA on the on-cast save only; damage_zone tick has no caster
//       context (v1 simplification, documented).
//   - Heat Metal (fire, no save on damage, on-cast + damage_zone)
//       EA on the on-cast damage; damage_zone tick has no caster
//       context (v1 simplification, documented). Heat Metal's on-cast
//       damage has no save → no halving → full EA bonus applies.
//
// Pattern (consistent with Sessions 47-50):
//   - The +CHA mod bonus is added once to the total damage roll BEFORE
//     save halving (so the bonus IS halved on save success).
//   - Auto-hit spells / no-save spells (Heat Metal) get the full bonus
//     with no halving.
//   - Multi-target spells (Incendiary Cloud) apply EA to each target's
//     damage independently (each target is its own roll).
//   - Damage_zone ticks (Create Bonfire, Flaming Sphere, Heat Metal)
//     do NOT get EA — the tick handler in combat.ts has no caster context.
//     Documented as a v1 simplification.
//
// Coverage (12 assertions across 12 sections):
//   1.  Elemental Bane + acid ancestry → +CHA mod
//   2.  Elemental Bane + fire ancestry → no bonus
//   3.  Create Bonfire + fire ancestry → +CHA mod on on-cast damage
//   4.  Create Bonfire + cold ancestry → no bonus
//   5.  Immolation + fire ancestry → +CHA mod
//   6.  Immolation + cold ancestry → no bonus
//   7.  Incendiary Cloud + fire ancestry → +CHA mod on each target
//   8.  Incendiary Cloud + cold ancestry → no bonus
//   9.  Flaming Sphere + fire ancestry → +CHA mod on on-cast damage
//  10.  Flaming Sphere + cold ancestry → no bonus
//  11.  Heat Metal + fire ancestry → +CHA mod (full, no halving)
//  12.  Heat Metal + cold ancestry → no bonus
//
// Run: npx ts-node --transpile-only src/test/elemental_affinity_phase4.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { execute as executeElementalBane } from '../spells/elemental_bane';
import { execute as executeCreateBonfire } from '../spells/create_bonfire';
import { execute as executeImmolation } from '../spells/immolation';
import { execute as executeIncendiaryCloud } from '../spells/incendiary_cloud';
import { execute as executeFlamingSphere } from '../spells/flaming_sphere';
import { execute as executeHeatMetal } from '../spells/heat_metal';
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
    str: 10, dex: 1, con: 1, int: 10, wis: 10, cha: 10,  // dex/con/wis 1 = guaranteed-fail saves
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

// ---- CHA mod at Sorc 6 with base CHA 17 = +3 ----------------
// All EA bonuses are +3 (CHA 17 → mod +3).

// ============================================================
// 1. Elemental Bane + acid ancestry → +CHA mod
//    XGE p.154 (2017) — WIS save, 2d6 acid (v1 default), single-target.
// ============================================================
console.log('\n--- 1. Elemental Bane + acid ancestry → EA ---');
{
  const sorc = makeSorc('acid', { 4: 1 });
  const EB_ACTION: Action = {
    name: 'Elemental Bane', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 4, costType: 'action', legendaryCost: 0,
    description: 'Elemental Bane',
  };
  sorc.actions = [EB_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { wis: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeElementalBane(sorc, enemy, state);

  // 2d6 acid + 3 EA. Min = 2 + 3 = 5. (WIS 1 → guaranteed save fail → full dmg.)
  const dmg = firstDmgValue(state);
  assert('1. damage includes EA (≥ 5)', dmg !== undefined && dmg >= 5, `got ${dmg}`);
  console.log(`    Elemental Bane damage (acid + EA): ${dmg}`);
}

// ============================================================
// 2. Elemental Bane + fire ancestry → no bonus
// ============================================================
console.log('\n--- 2. Elemental Bane + fire ancestry → no EA ---');
{
  const sorc = makeSorc('fire', { 4: 1 });  // fire ancestry, NOT acid
  const EB_ACTION: Action = {
    name: 'Elemental Bane', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 4, costType: 'action', legendaryCost: 0,
    description: 'Elemental Bane',
  };
  sorc.actions = [EB_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { wis: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeElementalBane(sorc, enemy, state);

  // 2d6 acid, max = 12. No +3 (fire ancestry, acid spell).
  const dmg = firstDmgValue(state);
  assert('2. damage ≤ 12 (no EA)', dmg !== undefined && dmg <= 12, `got ${dmg}`);
  console.log(`    Elemental Bane damage (no EA): ${dmg}`);
}

// ============================================================
// 3. Create Bonfire + fire ancestry → +CHA mod on on-cast damage
//    XGE p.152 (2017) — DEX save cantrip, 1d8 fire, on-cast + damage_zone.
// ============================================================
console.log('\n--- 3. Create Bonfire + fire ancestry → EA on on-cast ---');
{
  const sorc = makeSorc('fire', {});  // cantrip — no slot needed
  const CB_ACTION: Action = {
    name: 'Create Bonfire', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 0, costType: 'action', legendaryCost: 0,
    description: 'Create Bonfire',
  };
  sorc.actions = [CB_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeCreateBonfire(sorc, enemy, state);

  // 1d8 fire + 3 EA. Min = 1 + 3 = 4. (DEX 1 → guaranteed fail → full dmg.)
  const dmg = firstDmgValue(state);
  assert('3. damage includes EA (≥ 4)', dmg !== undefined && dmg >= 4, `got ${dmg}`);
  console.log(`    Create Bonfire damage (fire + EA): ${dmg}`);
}

// ============================================================
// 4. Create Bonfire + cold ancestry → no bonus
// ============================================================
console.log('\n--- 4. Create Bonfire + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', {});  // cold ancestry, NOT fire
  const CB_ACTION: Action = {
    name: 'Create Bonfire', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 0, costType: 'action', legendaryCost: 0,
    description: 'Create Bonfire',
  };
  sorc.actions = [CB_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeCreateBonfire(sorc, enemy, state);

  // Create Bonfire is a cantrip (slotLevel 0). At Sorcerer 6, cantrip scaling
  // (RFC-UPCASTING Phase 6) gives 2d8 (tier 1, levels 5-10). Max = 16.
  // No +3 EA (cold ancestry, fire spell). Threshold ≤ 16 (was ≤ 8 pre-Session 72).
  const dmg = firstDmgValue(state);
  assert('4. damage ≤ 16 (no EA, 2d8 cantrip scaling at level 6)', dmg !== undefined && dmg <= 16, `got ${dmg}`);
  console.log(`    Create Bonfire damage (no EA): ${dmg}`);
}

// ============================================================
// 5. Immolation + fire ancestry → +CHA mod
//    XGE p.157 (2017) — DEX save, 8d6 fire, single-target.
// ============================================================
console.log('\n--- 5. Immolation + fire ancestry → EA ---');
{
  const sorc = makeSorc('fire', { 5: 1 });
  const IMM_ACTION: Action = {
    name: 'Immolation', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Immolation',
  };
  sorc.actions = [IMM_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeImmolation(sorc, enemy, state);

  // 8d6 fire + 3 EA. Min = 8 + 3 = 11. (DEX 1 → guaranteed fail → full dmg.)
  const dmg = firstDmgValue(state);
  assert('5. damage includes EA (≥ 11)', dmg !== undefined && dmg >= 11, `got ${dmg}`);
  console.log(`    Immolation damage (fire + EA): ${dmg}`);
}

// ============================================================
// 6. Immolation + cold ancestry → no bonus
// ============================================================
console.log('\n--- 6. Immolation + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', { 5: 1 });  // cold ancestry, NOT fire
  const IMM_ACTION: Action = {
    name: 'Immolation', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 90, long: 90 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Immolation',
  };
  sorc.actions = [IMM_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeImmolation(sorc, enemy, state);

  // 8d6 fire, max = 48. No +3 (cold ancestry, fire spell).
  const dmg = firstDmgValue(state);
  assert('6. damage ≤ 48 (no EA)', dmg !== undefined && dmg <= 48, `got ${dmg}`);
  console.log(`    Immolation damage (no EA): ${dmg}`);
}

// ============================================================
// 7. Incendiary Cloud + fire ancestry → +CHA mod on each target
//    PHB p.253 (2014) — DEX save, 10d8 fire, AoE.
// ============================================================
console.log('\n--- 7. Incendiary Cloud + fire ancestry → EA on each target ---');
{
  const sorc = makeSorc('fire', { 8: 1 });
  const IC_ACTION: Action = {
    name: 'Incendiary Cloud', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 150, long: 150 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 8, costType: 'action', legendaryCost: 0,
    description: 'Incendiary Cloud',
  };
  sorc.actions = [IC_ACTION];

  const e1 = makeEnemy('e1', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const e2 = makeEnemy('e2', { x: 10, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, e1, e2]);
  const state = makeState(bf);

  executeIncendiaryCloud(sorc, [e1, e2], state);

  // 10d8 fire + 3 EA per target. Min = 10 + 3 = 13. (DEX 1 → guaranteed fail.)
  const dmgValues = allDmgValues(state);
  assert('7a. 2 target damage events', dmgValues.length === 2, `got ${dmgValues.length}`);
  if (dmgValues.length === 2) {
    const allHaveEA = dmgValues.every(d => d >= 13);
    assert('7b. ALL targets include EA (each ≥ 13)', allHaveEA, `got ${JSON.stringify(dmgValues)}`);
    console.log(`    Incendiary Cloud per-target damage (10d8 + 3 EA): ${JSON.stringify(dmgValues)}`);
  }
}

// ============================================================
// 8. Incendiary Cloud + cold ancestry → no bonus
// ============================================================
console.log('\n--- 8. Incendiary Cloud + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', { 8: 1 });  // cold ancestry, NOT fire
  const IC_ACTION: Action = {
    name: 'Incendiary Cloud', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 150, long: 150 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 8, costType: 'action', legendaryCost: 0,
    description: 'Incendiary Cloud',
  };
  sorc.actions = [IC_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeIncendiaryCloud(sorc, [enemy], state);

  // 10d8 fire, max = 80. No +3 (cold ancestry, fire spell).
  const dmg = firstDmgValue(state);
  assert('8. damage ≤ 80 (no EA)', dmg !== undefined && dmg <= 80, `got ${dmg}`);
  console.log(`    Incendiary Cloud damage (no EA): ${dmg}`);
}

// ============================================================
// 9. Flaming Sphere + fire ancestry → +CHA mod on on-cast damage
//    PHB p.242 (2014) — DEX save, 2d6 fire, on-cast + damage_zone.
// ============================================================
console.log('\n--- 9. Flaming Sphere + fire ancestry → EA on on-cast ---');
{
  const sorc = makeSorc('fire', { 2: 1 });
  const FS_ACTION: Action = {
    name: 'Flaming Sphere', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 2, costType: 'action', legendaryCost: 0,
    description: 'Flaming Sphere',
  };
  sorc.actions = [FS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeFlamingSphere(sorc, enemy, state);

  // 2d6 fire + 3 EA. Min = 2 + 3 = 5. (DEX 1 → guaranteed fail → full dmg.)
  // NOTE: only the on-cast damage has EA — the damage_zone tick does NOT.
  // This test asserts the on-cast event (first damage event).
  const dmg = firstDmgValue(state);
  assert('9. on-cast damage includes EA (≥ 5)', dmg !== undefined && dmg >= 5, `got ${dmg}`);
  console.log(`    Flaming Sphere on-cast damage (fire + EA): ${dmg}`);
}

// ============================================================
// 10. Flaming Sphere + cold ancestry → no bonus
// ============================================================
console.log('\n--- 10. Flaming Sphere + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', { 2: 1 });  // cold ancestry, NOT fire
  const FS_ACTION: Action = {
    name: 'Flaming Sphere', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 2, costType: 'action', legendaryCost: 0,
    description: 'Flaming Sphere',
  };
  sorc.actions = [FS_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeFlamingSphere(sorc, enemy, state);

  // 2d6 fire, max = 12. No +3 (cold ancestry, fire spell).
  const dmg = firstDmgValue(state);
  assert('10. on-cast damage ≤ 12 (no EA)', dmg !== undefined && dmg <= 12, `got ${dmg}`);
  console.log(`    Flaming Sphere on-cast damage (no EA): ${dmg}`);
}

// ============================================================
// 11. Heat Metal + fire ancestry → +CHA mod (FULL, no halving)
//     PHB p.250 (2014) — no save on damage, 2d8 fire, on-cast + damage_zone.
// ============================================================
console.log('\n--- 11. Heat Metal + fire ancestry → EA (full, no halving) ---');
{
  const sorc = makeSorc('fire', { 2: 1 });
  const HM_ACTION: Action = {
    name: 'Heat Metal', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 2, costType: 'action', legendaryCost: 0,
    description: 'Heat Metal',
  };
  sorc.actions = [HM_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeHeatMetal(sorc, enemy, state);

  // 2d8 fire + 3 EA. Min = 2 + 3 = 5. Heat Metal on-cast damage has NO save
  // → no halving → full EA bonus applies (not floor((2d8+3)/2)).
  // (The CON save is for "drop the object" only — v1 doesn't model that;
  // damage is automatic per PHB p.250.)
  const dmg = firstDmgValue(state);
  assert('11. on-cast damage includes EA (≥ 5)', dmg !== undefined && dmg >= 5, `got ${dmg}`);
  console.log(`    Heat Metal on-cast damage (fire + EA): ${dmg}`);
}

// ============================================================
// 12. Heat Metal + cold ancestry → no bonus
// ============================================================
console.log('\n--- 12. Heat Metal + cold ancestry → no EA ---');
{
  const sorc = makeSorc('cold', { 2: 1 });  // cold ancestry, NOT fire
  const HM_ACTION: Action = {
    name: 'Heat Metal', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 60, long: 60 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: false, isControl: false,
    requiresConcentration: true, slotLevel: 2, costType: 'action', legendaryCost: 0,
    description: 'Heat Metal',
  };
  sorc.actions = [HM_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 10000, currentHP: 10000, ac: 5 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeHeatMetal(sorc, enemy, state);

  // 2d8 fire, max = 16. No +3 (cold ancestry, fire spell).
  const dmg = firstDmgValue(state);
  assert('12. on-cast damage ≤ 16 (no EA)', dmg !== undefined && dmg <= 16, `got ${dmg}`);
  console.log(`    Heat Metal on-cast damage (no EA): ${dmg}`);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('elemental_affinity_phase4.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('elemental_affinity_phase4.test.ts: all tests passed ✅');
}
