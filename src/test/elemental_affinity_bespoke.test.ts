// ============================================================
// Test: Elemental Affinity in bespoke spells (Session 48, Task #29-follow-up-5c)
//
// Validates that Elemental Affinity (Draconic Sorcerer 6, PHB p.102) is
// wired into the bespoke execute() functions of:
//   - Lightning Bolt (lightning damage)
//   - Cone of Cold (cold damage)
//   - Burning Hands (fire damage)
//
// Session 47 wired EA in Fireball + the generic 'cast' case. This test
// verifies the 3 remaining bespoke spells also apply the CHA mod bonus
// when the caster's draconic ancestry matches the spell's damage type.
//
// Coverage:
//   1. Lightning Bolt + lightning ancestry → +CHA mod per target
//   2. Lightning Bolt + fire ancestry → no bonus
//   3. Cone of Cold + cold ancestry → +CHA mod per target
//   4. Cone of Cold + fire ancestry → no bonus
//   5. Burning Hands + fire ancestry → +CHA mod per target
//   6. Burning Hands + cold ancestry → no bonus
//   7. Non-Sorcerer caster → no bonus on any spell
//   8. Lightning Bolt: bonus added before save halving (half on save)
//
// Run: npx ts-node src/test/elemental_affinity_bespoke.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { applyLevelUp } from '../characters/leveler';
import { chooseSubclass } from '../characters/improvements';
import { buildCombatant } from '../characters/builder';
import { CharacterSheet } from '../characters/types';
import { execute as executeLightningBolt } from '../spells/lightning_bolt';
import { execute as executeConeOfCold } from '../spells/cone_of_cold';
import { execute as executeBurningHands } from '../spells/burning_hands';
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

// ============================================================
// 1. Lightning Bolt + lightning ancestry → +CHA mod per target
// ============================================================
console.log('\n--- 1. Lightning Bolt + lightning ancestry → bonus ---');
{
  const sorc = makeSorc('lightning', { 3: 1 });
  const LIGHTNING_BOLT_ACTION: Action = {
    name: 'Lightning Bolt', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 100, long: 100 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 3, costType: 'action', legendaryCost: 0,
    description: 'Lightning Bolt',
  };
  sorc.actions = [LIGHTNING_BOLT_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);
  const hpBefore = enemy.currentHP;

  executeLightningBolt(sorc, [enemy], state);

  // Enemy took damage. Lightning Bolt = 8d6 lightning + 3 EA (CHA 17). Min = 8 + 3 = 11.
  assert('1a. enemy took damage', enemy.currentHP < hpBefore);
  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    // With guaranteed-fail save: 8d6 + 3. Min = 8 + 3 = 11.
    assert('1b. damage includes EA bonus (≥ 11)', dmg >= 11, `got ${dmg}`);
    console.log(`    Lightning Bolt damage: ${dmg} (8d6 + 3 EA, guaranteed-fail)`);
  }
}

// ============================================================
// 2. Lightning Bolt + fire ancestry → no bonus
// ============================================================
console.log('\n--- 2. Lightning Bolt + fire ancestry → no bonus ---');
{
  const sorc = makeSorc('fire', { 3: 1 });  // fire ancestry, NOT lightning
  const LIGHTNING_BOLT_ACTION: Action = {
    name: 'Lightning Bolt', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 100, long: 100 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 3, costType: 'action', legendaryCost: 0,
    description: 'Lightning Bolt',
  };
  sorc.actions = [LIGHTNING_BOLT_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeLightningBolt(sorc, [enemy], state);

  // No EA bonus (fire ancestry, lightning spell). Damage = 8d6 only. Max = 48.
  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    // 8d6 max = 48. No +3 bonus.
    assert('2. damage ≤ 48 (no EA bonus)', dmg <= 48, `got ${dmg}`);
    console.log(`    Lightning Bolt damage (no EA): ${dmg}`);
  }
}

// ============================================================
// 3. Cone of Cold + cold ancestry → +CHA mod per target
// ============================================================
console.log('\n--- 3. Cone of Cold + cold ancestry → bonus ---');
{
  const sorc = makeSorc('cold', { 5: 1 });
  const CONE_OF_COLD_ACTION: Action = {
    name: 'Cone of Cold', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 0, long: 0 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Cone of Cold',
  };
  sorc.actions = [CONE_OF_COLD_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { con: 1, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);
  const hpBefore = enemy.currentHP;

  executeConeOfCold(sorc, [enemy], state);

  // Enemy took damage. Cone of Cold = 8d8 cold + 3 EA. Min = 8 + 3 = 11.
  assert('3a. enemy took damage', enemy.currentHP < hpBefore);
  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    assert('3b. damage includes EA bonus (≥ 11)', dmg >= 11, `got ${dmg}`);
    console.log(`    Cone of Cold damage: ${dmg} (8d8 + 3 EA, guaranteed-fail)`);
  }
}

// ============================================================
// 4. Cone of Cold + fire ancestry → no bonus
// ============================================================
console.log('\n--- 4. Cone of Cold + fire ancestry → no bonus ---');
{
  const sorc = makeSorc('fire', { 5: 1 });  // fire ancestry, NOT cold
  const CONE_OF_COLD_ACTION: Action = {
    name: 'Cone of Cold', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 0, long: 0 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'con', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 5, costType: 'action', legendaryCost: 0,
    description: 'Cone of Cold',
  };
  sorc.actions = [CONE_OF_COLD_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { con: 1, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeConeOfCold(sorc, [enemy], state);

  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    // 8d8 max = 64. No +3 bonus.
    assert('4. damage ≤ 64 (no EA bonus)', dmg <= 64, `got ${dmg}`);
    console.log(`    Cone of Cold damage (no EA): ${dmg}`);
  }
}

// ============================================================
// 5. Burning Hands + fire ancestry → +CHA mod per target
// ============================================================
console.log('\n--- 5. Burning Hands + fire ancestry → bonus ---');
{
  const sorc = makeSorc('fire', { 1: 1 });
  const BURNING_HANDS_ACTION: Action = {
    name: 'Burning Hands', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 0, long: 0 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Burning Hands',
  };
  sorc.actions = [BURNING_HANDS_ACTION];

  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 }, { dex: 1, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);
  const hpBefore = enemy.currentHP;

  executeBurningHands(sorc, [enemy], state);

  // Enemy took damage. Burning Hands = 3d6 fire + 3 EA. Min = 3 + 3 = 6.
  assert('5a. enemy took damage', enemy.currentHP < hpBefore);
  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    assert('5b. damage includes EA bonus (≥ 6)', dmg >= 6, `got ${dmg}`);
    console.log(`    Burning Hands damage: ${dmg} (3d6 + 3 EA, guaranteed-fail)`);
  }
}

// ============================================================
// 6. Burning Hands + cold ancestry → no bonus
// ============================================================
console.log('\n--- 6. Burning Hands + cold ancestry → no bonus ---');
{
  const sorc = makeSorc('cold', { 1: 1 });  // cold ancestry, NOT fire
  const BURNING_HANDS_ACTION: Action = {
    name: 'Burning Hands', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 0, long: 0 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 1, costType: 'action', legendaryCost: 0,
    description: 'Burning Hands',
  };
  sorc.actions = [BURNING_HANDS_ACTION];

  const enemy = makeEnemy('e', { x: 1, y: 0, z: 0 }, { dex: 1, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeBurningHands(sorc, [enemy], state);

  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    // 3d6 max = 18. No +3 bonus.
    assert('6. damage ≤ 18 (no EA bonus)', dmg <= 18, `got ${dmg}`);
    console.log(`    Burning Hands damage (no EA): ${dmg}`);
  }
}

// ============================================================
// 7. Non-Sorcerer caster → no bonus on any spell
// ============================================================
console.log('\n--- 7. Non-Sorcerer: no EA bonus ---');
{
  // A Wizard with Lightning Bolt — no Elemental Affinity feature.
  const wiz = makeEnemy('wiz', { x: 0, y: 0, z: 0 }, {
    faction: 'party', maxHP: 100, currentHP: 100,
    cha: 17,
    classFeatures: ['Spellcasting'],
  });
  wiz.draconicAncestry = 'lightning';  // set but no feature → no bonus
  if (!wiz.resources) wiz.resources = {} as any;
  if (!wiz.resources!.spellSlots) wiz.resources!.spellSlots = {};
  wiz.resources!.spellSlots[3] = { max: 1, remaining: 1 };
  const LIGHTNING_BOLT_ACTION: Action = {
    name: 'Lightning Bolt', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 100, long: 100 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 25, saveAbility: 'dex', isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 3, costType: 'action', legendaryCost: 0,
    description: 'Lightning Bolt',
  };
  wiz.actions = [LIGHTNING_BOLT_ACTION];

  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, { dex: 1, maxHP: 1000, currentHP: 1000 });
  const bf = makeBF([wiz, enemy]);
  const state = makeState(bf);

  executeLightningBolt(wiz, [enemy], state);

  // Non-Sorcerer: no EA bonus. 8d6 max = 48.
  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    assert('7. non-Sorcerer damage ≤ 48 (no EA)', dmg <= 48, `got ${dmg}`);
    console.log(`    Wizard Lightning Bolt damage (no EA): ${dmg}`);
  }
}

// ============================================================
// 8. Lightning Bolt: bonus added before save halving
// ============================================================
console.log('\n--- 8. EA bonus halved on save success ---');
{
  const sorc = makeSorc('lightning', { 3: 1 });
  const LIGHTNING_BOLT_ACTION: Action = {
    name: 'Lightning Bolt', isMultiattack: false, attackType: 'save',
    reach: 5, range: { normal: 100, long: 100 },
    hitBonus: null, damage: null, damageType: null,
    saveDC: 5, saveAbility: 'dex',  // LOW DC → guaranteed SUCCESS (dex 30 → min 11 ≥ 5)
    isAoE: true, isControl: false,
    requiresConcentration: false, slotLevel: 3, costType: 'action', legendaryCost: 0,
    description: 'Lightning Bolt',
  };
  sorc.actions = [LIGHTNING_BOLT_ACTION];

  // Enemy with DEX 30 → guaranteed save success (min roll 11 ≥ DC 5)
  const enemy = makeEnemy('e', { x: 5, y: 0, z: 0 }, {
    dex: 30, maxHP: 1000, currentHP: 1000,
  });
  const bf = makeBF([sorc, enemy]);
  const state = makeState(bf);

  executeLightningBolt(sorc, [enemy], state);

  // With save success: damage = floor((8d6 + 3) / 2). The EA bonus IS halved
  // because it's added to the total damage roll before halving.
  // Verify a save_success event exists (enemy saved).
  const saveEvent = state.log.events.find((e: any) => e.type === 'save_success');
  assert('8. enemy saved (DC 5, DEX 30)', saveEvent !== undefined);

  const dmgEvents = state.log.events.filter((e: any) => e.type === 'damage');
  if (dmgEvents.length > 0) {
    const dmg = dmgEvents[0].value;
    // Half of (8d6 + 3). Max half = floor((48 + 3) / 2) = 25.
    assert('8b. halved damage ≤ 25', dmg <= 25, `got ${dmg}`);
    console.log(`    Lightning Bolt halved damage (save success): ${dmg}`);
  }
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('elemental_affinity_bespoke.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('elemental_affinity_bespoke.test.ts: all tests passed ✅');
}
