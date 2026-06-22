// ============================================================
// Test: Cantrip Pipeline in buildCombatant (Session 41, Task #15)
//
// Validates that cantrips from CharacterSheet.spellcasting.cantrips
// are now converted to Action objects by pcToCombatant (parser/pc.ts)
// — previously this only worked for cantrips duplicated in the
// weapons array (as pc_stat_blocks_lv1.json does for level-1 PCs).
//
// Coverage:
//   1. SPELL_DB has all 20 v1 combat cantrip entries
//   2. lookupSpell finds each cantrip
//   3. buildCombatant for Warlock (with Eldritch Blast in cantrips) → Action present
//   4. buildCombatant for Wizard (with Fire Bolt in cantrips) → Action present
//   5. buildCombatant for Cleric (with Sacred Flame in cantrips) → Action present
//   6. Cantrip Action has correct slotLevel = 0 (never consumes a slot)
//   7. Cantrip Action has correct hitBonus (spell attack bonus)
//   8. Cantrip Action has correct saveDC / saveAbility for save-based cantrips
//   9. Cantrip Action has correct damage dice
//  10. Cantrip Action has correct range
//  11. Deduplication: weapons-array cantrip + cantrip-list cantrip → single Action
//  12. Multiple cantrips all become Actions
//  13. Utility cantrips (not in SPELL_DB) are silently dropped
//  14. End-to-end: Warlock with Eldritch Blast + Agonizing Blast invocation
//      fires the engine hook via a cantrip-list-sourced Action
//  15. End-to-end: Cleric's Sacred Flame does damage via save (not attack roll)
//
// Run: npx ts-node src/test/cantrip_pipeline.test.ts
// ============================================================

import { randomUUID } from 'crypto';
import { lookupSpell, SPELL_DB } from '../data/spells';
import { buildCombatant } from '../characters/builder';
import { applyLevelUp, getMaxInvocationSlots } from '../characters/leveler';
import { chooseEldritchInvocations } from '../characters/improvements';
import { CharacterSheet } from '../characters/types';
import { resolveAttack, CombatEvent } from '../engine/combat';
import { Combatant, Action, Vec3 } from '../types/core';

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

function makeWarlock(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Vesper', race: 'Tiefling', background: 'Charlatan',
    alignment: 'Chaotic Neutral',
    firstClass: 'Warlock',
    classLevels: [{ className: 'Warlock', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    stats:     { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 18 },
    maxHP: 9, currentHP: 9, temporaryHP: 0,
    armorClass: 12, acFormula: 'Leather + DEX', speed: 30,
    hitDice: [{ className: 'Warlock', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light'], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['wis','cha'],
      skills: ['Deception','Arcana'], expertise: [],
    },
    languages: ['Common', 'Infernal', 'Abyssal'],
    resources: {},
    spellcasting: {
      ability: 'cha', spellAttackBonus: 6, saveDC: 14,
      slots: {}, slotsUsed: {},
      pactSlots: { slotLevel: 1, total: 1, used: 0 },
      cantrips: ['Eldritch Blast', 'Chill Touch'],
      knownSpells: ['Hex'],
      preparedSpells: [],
      spellbook: [],
    },
    equipment: [{ name: 'Light Crossbow', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [
      { name: 'Otherworldly Patron', description: 'Gain your patron feature.', source: 'subclass' },
      { name: 'Pact Magic',           description: 'CHA Pact Magic caster.',   source: 'class' },
    ],
    allFeatures: [
      { name: 'Otherworldly Patron', description: 'Gain your patron feature.', source: 'subclass' },
      { name: 'Pact Magic',           description: 'CHA Pact Magic caster.',   source: 'class' },
    ],
    feats: [], backgroundFeature: 'False Identity', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function makeWizard(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Aelindra', race: 'High Elf', background: 'Sage',
    alignment: 'Chaotic Good',
    firstClass: 'Wizard',
    classLevels: [{ className: 'Wizard', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 8, dex: 15, con: 13, int: 15, wis: 12, cha: 10 },
    stats:     { str: 8, dex: 16, con: 13, int: 16, wis: 12, cha: 10 },
    maxHP: 7, currentHP: 7, temporaryHP: 0,
    armorClass: 13, acFormula: 'DEX Unarmored', speed: 30,
    hitDice: [{ className: 'Wizard', dieSides: 6, total: 1, remaining: 1 }],
    proficiencies: {
      armor: [], weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['int','wis'],
      skills: ['Arcana','History'], expertise: [],
    },
    languages: ['Common', 'Elvish'],
    resources: { arcaneRecovery: { usesRemaining: 1 } },
    spellcasting: {
      ability: 'int', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Fire Bolt', 'Minor Illusion', 'Light'],
      knownSpells: [],
      preparedSpells: ['Magic Missile', 'Sleep'],
      spellbook: ['Magic Missile', 'Sleep', 'Shield'],
    },
    equipment: [{ name: 'Quarterstaff', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 10,
    level1Features: [
      { name: 'Arcane Recovery', description: 'Regain slots on short rest.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Arcane Recovery', description: 'Regain slots on short rest.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Researcher', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

function makeCleric(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Liora', race: 'Human', background: 'Acolyte',
    alignment: 'Lawful Good',
    firstClass: 'Cleric',
    classLevels: [{ className: 'Cleric', level: 1 }],
    subclassChoices: {},
    experiencePoints: 0,
    baseStats: { str: 12, dex: 10, con: 14, int: 11, wis: 16, cha: 13 },
    stats:     { str: 12, dex: 10, con: 14, int: 11, wis: 16, cha: 13 },
    maxHP: 10, currentHP: 10, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail', speed: 25,
    hitDice: [{ className: 'Cleric', dieSides: 8, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','shield'],
      weapons: ['simple-melee','simple-ranged'],
      tools: [], savingThrows: ['wis','cha'],
      skills: ['Insight','Religion'], expertise: [],
    },
    languages: ['Common'],
    resources: {},
    spellcasting: {
      ability: 'wis', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Sacred Flame', 'Guidance', 'Light'],
      knownSpells: [],
      preparedSpells: ['Bless', 'Cure Wounds'],
      spellbook: [],
    },
    equipment: [{ name: 'Mace', quantity: 1, equipped: true, category: 'weapon' }],
    gold: 15,
    level1Features: [
      { name: 'Divine Spellcasting', description: 'WIS caster.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Divine Spellcasting', description: 'WIS caster.', source: 'class' },
    ],
    feats: [], backgroundFeature: 'Shelter of the Faithful', exhaustionLevel: 0, levelHistory: [],
  };
  return { ...base, ...overrides };
}

// ---- Combat helpers -----------------------------------------

function makeGoblin(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 100, currentHP: 100, ac: 10, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 8, dex: 14, con: 10, int: 8, wis: 8, cha: 8,
    cr: 0.25,
    pos: { x: 5, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    aiProfile: 'smart',
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

// ============================================================
// 1. SPELL_DB has 20 v1 combat cantrip entries
// ============================================================
console.log('\n--- 1. SPELL_DB cantrip entries ---');
{
  const cantripNames = [
    'fire bolt', 'eldritch blast', 'ray of frost', 'sacred flame',
    'vicious mockery', 'poison spray', 'chill touch', 'toll the dead',
    'produce flame', 'thorn whip', 'acid splash', 'thunderclap',
    'sword burst', 'lightning lure', 'infestation', 'mind sliver',
    'primal savagery', 'shocking grasp', 'sapping sting', 'create bonfire',
  ];
  for (const name of cantripNames) {
    assert(`1. SPELL_DB has "${name}"`, !!SPELL_DB[name], `missing ${name}`);
  }
  eq('1z. 20 cantrip entries present',
    cantripNames.filter(n => !!SPELL_DB[n]).length, 20);
}

// ============================================================
// 2. lookupSpell finds each cantrip
// ============================================================
console.log('\n--- 2. lookupSpell() returns cantrip templates ---');
{
  // Both lowercase and proper-case should work (case-insensitive)
  assert('2a. lookupSpell("Fire Bolt") returns template', !!lookupSpell('Fire Bolt'));
  assert('2b. lookupSpell("fire bolt") returns template', !!lookupSpell('fire bolt'));
  assert('2c. lookupSpell("Eldritch Blast") returns template', !!lookupSpell('Eldritch Blast'));
  assert('2d. lookupSpell("Sacred Flame") returns template', !!lookupSpell('Sacred Flame'));
  // Verify slotLevel = 0
  eq('2e. Fire Bolt slotLevel = 0', lookupSpell('Fire Bolt')?.slotLevel, 0);
  eq('2f. Eldritch Blast slotLevel = 0', lookupSpell('Eldritch Blast')?.slotLevel, 0);
  // Non-cantrip still works
  eq('2g. Magic Missile slotLevel = 1 (unchanged)', lookupSpell('Magic Missile')?.slotLevel, 1);
}

// ============================================================
// 3. Warlock (Eldritch Blast in cantrips) → Action present
// ============================================================
console.log('\n--- 3. Warlock cantrip → Action ---');
{
  const warlock = makeWarlock();
  const combatant = buildCombatant(warlock);
  const ebAction = combatant.actions.find(a => a.name === 'Eldritch Blast');
  assert('3a. Eldritch Blast Action present in combatant.actions', ebAction !== undefined);
  assert('3b. Eldritch Blast has attackType = spell', ebAction?.attackType === 'spell');
  eq('3c. Eldritch Blast slotLevel = 0', ebAction?.slotLevel, 0);
  // Chill Touch should also be present
  const chillAction = combatant.actions.find(a => a.name === 'Chill Touch');
  assert('3d. Chill Touch Action present', chillAction !== undefined);
}

// ============================================================
// 4. Wizard (Fire Bolt in cantrips) → Action present
// ============================================================
console.log('\n--- 4. Wizard cantrip → Action ---');
{
  const wizard = makeWizard();
  const combatant = buildCombatant(wizard);
  const fbAction = combatant.actions.find(a => a.name === 'Fire Bolt');
  assert('4a. Fire Bolt Action present in combatant.actions', fbAction !== undefined);
  eq('4b. Fire Bolt slotLevel = 0', fbAction?.slotLevel, 0);
  // Minor Illusion (utility cantrip, not in SPELL_DB) should be dropped
  const miAction = combatant.actions.find(a => a.name === 'Minor Illusion');
  assert('4c. Minor Illusion NOT present (utility, not in SPELL_DB)', miAction === undefined);
  // Light (utility cantrip) should also be dropped
  const lightAction = combatant.actions.find(a => a.name === 'Light');
  assert('4d. Light NOT present (utility, not in SPELL_DB)', lightAction === undefined);
}

// ============================================================
// 5. Cleric (Sacred Flame in cantrips) → Action present
// ============================================================
console.log('\n--- 5. Cleric cantrip → Action ---');
{
  const cleric = makeCleric();
  const combatant = buildCombatant(cleric);
  const sfAction = combatant.actions.find(a => a.name === 'Sacred Flame');
  assert('5a. Sacred Flame Action present', sfAction !== undefined);
  assert('5b. Sacred Flame has attackType = save', sfAction?.attackType === 'save');
  eq('5c. Sacred Flame slotLevel = 0', sfAction?.slotLevel, 0);
  eq('5d. Sacred Flame saveAbility = dex', sfAction?.saveAbility, 'dex');
  // Guidance (utility cantrip) should be dropped
  const guidanceAction = combatant.actions.find(a => a.name === 'Guidance');
  assert('5e. Guidance NOT present (utility)', guidanceAction === undefined);
}

// ============================================================
// 6. Cantrip Action slotLevel = 0 (never consumes a slot)
// ============================================================
console.log('\n--- 6. Cantrip slotLevel = 0 ---');
{
  const wizard = makeWizard();
  const combatant = buildCombatant(wizard);
  const cantripActions = combatant.actions.filter(a =>
    ['Fire Bolt', 'Eldritch Blast', 'Sacred Flame', 'Ray of Frost', 'Chill Touch'].includes(a.name));
  for (const a of cantripActions) {
    eq(`6. ${a.name} slotLevel = 0`, a.slotLevel, 0);
  }
}

// ============================================================
// 7. Cantrip Action has correct hitBonus (spell attack bonus)
// ============================================================
console.log('\n--- 7. Cantrip hitBonus = spellAttackBonus ---');
{
  // Wizard with spellAttackBonus = 5
  const wizard = makeWizard();
  const combatant = buildCombatant(wizard);
  const fbAction = combatant.actions.find(a => a.name === 'Fire Bolt');
  eq('7a. Fire Bolt hitBonus = 5 (wizard spellAttackBonus)', fbAction?.hitBonus, 5);
}

// ============================================================
// 8. Cantrip Action has correct saveDC / saveAbility
// ============================================================
console.log('\n--- 8. Cantrip saveDC + saveAbility ---');
{
  // Cleric with saveDC = 13
  const cleric = makeCleric();
  const combatant = buildCombatant(cleric);
  const sfAction = combatant.actions.find(a => a.name === 'Sacred Flame');
  eq('8a. Sacred Flame saveDC = 13', sfAction?.saveDC, 13);
  eq('8b. Sacred Flame saveAbility = dex', sfAction?.saveAbility, 'dex');
}

// ============================================================
// 9. Cantrip Action has correct damage dice
// ============================================================
console.log('\n--- 9. Cantrip damage dice ---');
{
  const wizard = makeWizard();
  const combatant = buildCombatant(wizard);
  const fbAction = combatant.actions.find(a => a.name === 'Fire Bolt');
  assert('9a. Fire Bolt damage exists', fbAction?.damage !== null);
  eq('9b. Fire Bolt damage count = 1', fbAction?.damage?.count, 1);
  eq('9c. Fire Bolt damage sides = 10', fbAction?.damage?.sides, 10);
}

// ============================================================
// 10. Cantrip Action has correct range
// ============================================================
console.log('\n--- 10. Cantrip range ---');
{
  const wizard = makeWizard();
  const combatant = buildCombatant(wizard);
  const fbAction = combatant.actions.find(a => a.name === 'Fire Bolt');
  eq('10a. Fire Bolt reach = 120', fbAction?.reach, 120);
  assert('10b. Fire Bolt range set', fbAction?.range !== null);
  eq('10c. Fire Bolt range.normal = 120', fbAction?.range?.normal, 120);
}

// ============================================================
// 11. Deduplication: weapons-array cantrip + cantrip-list cantrip
//     → single Action (no duplicates)
// ============================================================
console.log('\n--- 11. Deduplication ---');
{
  // A Warlock sheet with Eldritch Blast in BOTH cantrips AND weapons array
  // (this is what pc_stat_blocks_lv1.json does for level-1 PCs).
  const warlock = makeWarlock();
  // Simulate the pc_stat_blocks_lv1.json pattern: add EB to equipment as a weapon
  warlock.equipment = [
    { name: 'Eldritch Blast', quantity: 1, equipped: true, category: 'weapon', notes: 'cantrip' },
    { name: 'Light Crossbow', quantity: 1, equipped: true, category: 'weapon' },
  ];
  // The builder's WEAPON_DB doesn't know 'Eldritch Blast' as a weapon name → uses
  // fallback club stats. But the deduplication should still merge them by name.
  const combatant = buildCombatant(warlock);
  const ebActions = combatant.actions.filter(a => a.name === 'Eldritch Blast');
  eq('11a. exactly one Eldritch Blast Action (no duplicates)', ebActions.length, 1);
  // The SPELL_DB version should win (has slotLevel = 0)
  eq('11b. deduplicated EB has slotLevel = 0 (SPELL_DB version)', ebActions[0]?.slotLevel, 0);
}

// ============================================================
// 12. Multiple cantrips all become Actions
// ============================================================
console.log('\n--- 12. Multiple cantrips ---');
{
  const warlock = makeWarlock({
    spellcasting: {
      ability: 'cha', spellAttackBonus: 6, saveDC: 14,
      slots: {}, slotsUsed: {},
      pactSlots: { slotLevel: 1, total: 1, used: 0 },
      cantrips: ['Eldritch Blast', 'Chill Touch', 'Poison Spray'],
      knownSpells: [], preparedSpells: [], spellbook: [],
    },
  });
  const combatant = buildCombatant(warlock);
  assert('12a. Eldritch Blast present', combatant.actions.some(a => a.name === 'Eldritch Blast'));
  assert('12b. Chill Touch present', combatant.actions.some(a => a.name === 'Chill Touch'));
  assert('12c. Poison Spray present', combatant.actions.some(a => a.name === 'Poison Spray'));
}

// ============================================================
// 13. Utility cantrips silently dropped
// ============================================================
console.log('\n--- 13. Utility cantrip drop ---');
{
  const wizard = makeWizard({
    spellcasting: {
      ability: 'int', spellAttackBonus: 5, saveDC: 13,
      slots: { '1': 2 }, slotsUsed: { '1': 0 },
      cantrips: ['Fire Bolt', 'Mage Hand', 'Prestidigitation', 'Minor Illusion'],
      knownSpells: [], preparedSpells: [], spellbook: [],
    },
  });
  const combatant = buildCombatant(wizard);
  // Only Fire Bolt should be in actions (others are utility, not in SPELL_DB)
  const cantripActions = combatant.actions.filter(a => a.slotLevel === 0);
  eq('13a. only 1 cantrip Action (Fire Bolt) — utilities dropped', cantripActions.length, 1);
  eq('13b. cantrip Action name = Fire Bolt', cantripActions[0]?.name, 'Fire Bolt');
}

// ============================================================
// 14. End-to-end: Warlock with Agonizing Blast via cantrip-list
// ============================================================
console.log('\n--- 14. End-to-end Agonizing Blast via cantrip pipeline ---');
{
  // Build a Warlock 2 with Eldritch Blast in cantrips + Agonizing Blast invocation
  let sheet = makeWarlock();
  // Level up to 2 (applyLevelUp adds level 2 features)
  sheet = applyLevelUp(sheet, 'Warlock').sheet;
  sheet = chooseEldritchInvocations(sheet, ['Agonizing Blast', 'Repelling Blast']);

  const warlock = buildCombatant(sheet, { x: 0, y: 0, z: 0 });

  // Verify EB is in actions (the Session 40 limitation is now fixed!)
  const ebAction = warlock.actions.find(a => a.name === 'Eldritch Blast');
  assert('14a. Eldritch Blast present in combatant.actions (via cantrip pipeline)',
    ebAction !== undefined);
  eq('14b. EB slotLevel = 0', ebAction?.slotLevel, 0);

  // Use the cantrip-sourced Action in resolveAttack
  const goblin = makeGoblin('goblin', { pos: { x: 2, y: 0, z: 0 } });
  const bf = makeBF([warlock, goblin]);
  const state = makeState(bf);

  resolveAttack(warlock, goblin, ebAction!, state, true /* force crit */);

  // EB base crit: 2d10 = 2..20, Agonizing Blast +4 (CHA 18, not doubled) = 6..24
  const dmgDealt = 100 - goblin.currentHP;
  assert('14c. damage in 6..24 range (2d10 crit + 4 CHA mod)',
    dmgDealt >= 6 && dmgDealt <= 24, `got ${dmgDealt}`);

  // Agonizing Blast log entry
  const agonizingLog = state.log.events.find((e: CombatEvent) =>
    e.type === 'action' && e.description.includes('Agonizing Blast'));
  assert('14d. Agonizing Blast log entry present', agonizingLog !== undefined);

  // Repelling Blast also fired (goblin pushed from (2,0) to (4,0))
  eq('14e. goblin pushed from x=2 to x=4 by Repelling Blast', goblin.pos.x, 4);
}

// ============================================================
// 15. End-to-end: Cleric's Sacred Flame does damage via save
// ============================================================
console.log('\n--- 15. End-to-end Sacred Flame via cantrip pipeline ---');
{
  const cleric = makeCleric();
  const combatant = buildCombatant(cleric, { x: 0, y: 0, z: 0 });
  const sfAction = combatant.actions.find(a => a.name === 'Sacred Flame');
  assert('15a. Sacred Flame present in combatant.actions', sfAction !== undefined);
  assert('15b. Sacred Flame attackType = save', sfAction?.attackType === 'save');
  eq('15c. Sacred Flame saveDC = 13', sfAction?.saveDC, 13);

  const goblin = makeGoblin('goblin', { pos: { x: 5, y: 0, z: 0 }, dex: 8 });
  const bf = makeBF([combatant, goblin]);
  const state = makeState(bf);

  // Force a failed save (true = crit for attack rolls; for saves, this is
  // passed to rollSave which interprets it as "force fail" via the same
  // isCritOverride parameter — verified by checking damage is dealt)
  resolveAttack(combatant, goblin, sfAction!, state, true);

  // Sacred Flame: 1d8 radiant on failed save. If save failed, damage 1..8.
  // If save succeeded, damage 0 (no half-damage cantrip in v1 model).
  // With isCritOverride=true forcing fail, damage should be 1..8.
  const dmgDealt = 100 - goblin.currentHP;
  assert('15d. Sacred Flame dealt damage (1..8) on failed save',
    dmgDealt >= 1 && dmgDealt <= 8, `got ${dmgDealt}`);
}

// ============================================================
// Final summary
// ============================================================
console.log('\n==================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('==================================================');
if (failed > 0) {
  console.error('cantrip_pipeline.test.ts: TESTS FAILED ❌');
  process.exit(1);
} else {
  console.log('cantrip_pipeline.test.ts: all tests passed ✅');
}
