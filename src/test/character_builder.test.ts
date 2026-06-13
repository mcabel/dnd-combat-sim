// ============================================================
// Test: Character Sheet Builder
// Run: ts-node src/test/character_builder.test.ts
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { randomUUID } from 'crypto';

import { buildCombatant, buildWarnings } from '../characters/builder';
import { CharacterSheet, totalLevel }    from '../characters/types';
import { saveCharacter }                 from '../characters/storage';

// ---- Harness ------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}
function approx(label: string, a: number, e: number, tol = 1): void {
  assert(label, Math.abs(a - e) <= tol, `got ${a}, want ~${e} (±${tol})`);
}

// ---- Tmp dir isolation --------------------------------------

let tmpDir = '';
const origCwd = process.cwd();

function setupTmp(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-builder-'));
  fs.mkdirSync(path.join(tmpDir, 'characters'));
  fs.mkdirSync(path.join(tmpDir, 'parties'));
  process.chdir(tmpDir);
}
function teardownTmp(): void {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---- Factories ----------------------------------------------

function makeFighter(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Gareth Stonebrow',
    race: 'Mountain Dwarf', background: 'Soldier', alignment: 'Lawful Good',
    firstClass: 'Fighter',
    classLevels: [{ className: 'Fighter', level: 1 }],
    subclassChoices: { Fighter: 'Champion' },
    experiencePoints: 0,
    baseStats: { str: 17, dex: 10, con: 16, int: 8, wis: 12, cha: 13 },
    stats:     { str: 17, dex: 10, con: 16, int: 8, wis: 12, cha: 13 },
    maxHP: 13, currentHP: 13, temporaryHP: 0,
    armorClass: 16, acFormula: 'Chain Mail: 16', speed: 25,
    hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 1 }],
    proficiencies: {
      armor: ['light','medium','heavy','shield'],
      weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
      tools: [], savingThrows: ['str','con'],
      skills: ['Athletics','Intimidation'], expertise: [],
    },
    languages: ['Common', 'Dwarvish'],
    resources: { secondWind: { max: 1, remaining: 1 } },
    spellcasting: undefined,
    equipment: [
      { name: 'Greatsword', quantity: 1, equipped: true,  category: 'weapon' },
      { name: 'Javelin',    quantity: 4, equipped: true,  category: 'weapon' },
      { name: 'Flail',      quantity: 1, equipped: false, category: 'weapon' }, // unequipped
      { name: 'Chain Mail', quantity: 1, equipped: true,  category: 'armor'  },
    ],
    gold: 10,
    level1Features: [
      { name: 'Second Wind', description: 'Regain HP.', source: 'class' },
      { name: 'Fighting Style', description: 'Great Weapon Fighting.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Second Wind', description: 'Regain HP.', source: 'class' },
      { name: 'Darkvision', description: '60 ft.', source: 'race' },
    ],
    feats: [], backgroundFeature: 'Military Rank', exhaustionLevel: 0,
  };
  return { ...base, ...overrides };
}

function makeWizard(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id: randomUUID(), version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    name: 'Aelindra Swiftarrow',
    race: 'High Elf', background: 'Sage', alignment: 'Chaotic Good',
    firstClass: 'Wizard',
    classLevels: [{ className: 'Wizard', level: 1 }],
    subclassChoices: { Wizard: 'School of Evocation' },
    experiencePoints: 0,
    baseStats: { str: 8, dex: 15, con: 13, int: 15, wis: 12, cha: 10 },
    stats:     { str: 8, dex: 16, con: 13, int: 16, wis: 12, cha: 10 },
    maxHP: 7, currentHP: 7, temporaryHP: 0,
    armorClass: 13, acFormula: 'DEX 16 (Unarmored)', speed: 30,
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
      cantrips: ['Fire Bolt', 'Minor Illusion'],
      knownSpells: [],
      preparedSpells: ['Magic Missile', 'Sleep', 'Mage Armor'],
      spellbook: ['Magic Missile', 'Sleep', 'Mage Armor', 'Shield', 'Detect Magic'],
    },
    equipment: [
      { name: 'Dagger', quantity: 2, equipped: true, category: 'weapon' },
    ],
    gold: 15,
    level1Features: [
      { name: 'Spellcasting', description: 'Cast spells using INT.', source: 'class' },
      { name: 'Arcane Recovery', description: 'Recover slots on short rest.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Spellcasting', description: 'Cast spells using INT.', source: 'class' },
      { name: 'Arcane Recovery', description: 'Recover slots on short rest.', source: 'class' },
      { name: 'Darkvision', description: '60 ft.', source: 'race' },
      { name: 'Fey Ancestry', description: 'Advantage vs charm.', source: 'race' },
    ],
    feats: [], backgroundFeature: 'Researcher', exhaustionLevel: 0,
  };
  return { ...base, ...overrides };
}

// =============================================================
// 1. Fighter → Combatant
// =============================================================

console.log('\n=== 1. Fighter → Combatant ===\n');

const fighter = makeFighter();
const fc = buildCombatant(fighter, { x: 0, y: 0, z: 0 });

// Identity
eq('name is character name', fc.name, 'Gareth Stonebrow');
assert('id prefixed with sheet_', fc.id.startsWith('sheet_'));
assert('isPlayer = true', fc.isPlayer);
assert('faction = party', fc.faction === 'party');

// Combat stats
eq('maxHP matches sheet', fc.maxHP, 13);
eq('currentHP matches maxHP on creation', fc.currentHP, 13);
eq('AC matches sheet', fc.ac, 16);
eq('speed matches sheet', fc.speed, 25);

// Ability scores
eq('STR matches', fc.str, 17);
eq('DEX matches', fc.dex, 10);
eq('CON matches', fc.con, 16);
eq('INT matches', fc.int, 8);
eq('WIS matches', fc.wis, 12);
eq('CHA matches', fc.cha, 13);

// Position
eq('pos.x set correctly', fc.pos.x, 0);
eq('pos.y set correctly', fc.pos.y, 0);

// Actions: only EQUIPPED weapons (Flail is unequipped → not present)
const actionNames = fc.actions.map(a => a.name);
assert('Greatsword present', actionNames.includes('Greatsword'));
assert('Javelin present', actionNames.includes('Javelin'));
assert('Flail absent (unequipped)', !actionNames.includes('Flail'));

// Greatsword: 2d6 slashing, STR+3, prof+2 → bonus 5
const gs = fc.actions.find(a => a.name === 'Greatsword')!;
assert('Greatsword exists in actions', gs !== undefined);
if (gs) {
  eq('Greatsword hitBonus = prof(2)+STR(3)=5', gs.hitBonus, 5);
  assert('Greatsword damage die = 2d6', gs.damage?.count === 2 && gs.damage?.sides === 6);
  eq('Greatsword is melee', gs.attackType, 'melee');
}

// Javelin: 1d6 piercing, STR+3, prof+2 → bonus 5; range: thrown 30/120
const jav = fc.actions.find(a => a.name === 'Javelin')!;
assert('Javelin exists', jav !== undefined);
if (jav) {
  eq('Javelin hitBonus=5', jav.hitBonus, 5);
  assert('Javelin has range', jav.range !== null);
  eq('Javelin normal range 30', jav.range?.normal, 30);
}

// Resources: secondWind
assert('resources present', fc.resources !== null);
assert('secondWind present', fc.resources?.secondWind !== undefined);
eq('secondWind max=1', fc.resources?.secondWind?.max, 1);
eq('secondWind remaining=1', fc.resources?.secondWind?.remaining, 1);

// No spellcasting
assert('no spell actions for Fighter', fc.actions.every(a => a.slotLevel === undefined || a.slotLevel === null));

// Traits include features
assert('Second Wind in traits', fc.traits.includes('Second Wind'));
assert('Darkvision in traits (racial)', fc.traits.includes('Darkvision'));

// =============================================================
// 2. Wizard → Combatant
// =============================================================

console.log('\n=== 2. Wizard → Combatant ===\n');

const wizard = makeWizard();
const wc = buildCombatant(wizard, { x: 3, y: 0, z: 0 });

eq('Wizard name', wc.name, 'Aelindra Swiftarrow');
eq('Wizard maxHP=7', wc.maxHP, 7);
eq('Wizard AC=13', wc.ac, 13);
eq('Wizard speed=30', wc.speed, 30);
eq('Wizard INT=16', wc.int, 16);
eq('Wizard DEX=16', wc.dex, 16);
eq('Wizard pos.x=3', wc.pos.x, 3);

// Dagger: finesse → max(STR-1, DEX+3)=DEX+3=3; prof+2 → bonus 5
const dagger = wc.actions.find(a => a.name === 'Dagger');
assert('Dagger present', dagger !== undefined);
if (dagger) {
  eq('Dagger hitBonus = prof(2)+DEX(3)=5', dagger.hitBonus, 5);
  assert('Dagger thrown range present', dagger.range !== null);
}

// Spell actions: preparedSpells resolved via SPELL_DB
const wizardActionNames = wc.actions.map(a => a.name);
assert('Magic Missile in actions (SPELL_DB hit)', wizardActionNames.includes('Magic Missile'));
assert('Sleep in actions', wizardActionNames.includes('Sleep'));

// Resources: arcane recovery + spell slots
assert('arcaneRecovery present', wc.resources?.arcaneRecovery !== undefined);
assert('spellSlots present', wc.resources?.spellSlots !== undefined);
eq('1st-level slots = 2', wc.resources?.spellSlots?.[1]?.max, 2);
eq('slot remaining = 2 at start', wc.resources?.spellSlots?.[1]?.remaining, 2);

// =============================================================
// 3. Finesse weapon stat selection
// =============================================================

console.log('\n=== 3. Finesse Weapon Stat Selection ===\n');

// Rogue: DEX > STR → finesse uses DEX
const rogue: CharacterSheet = {
  ...makeFighter(),
  name: 'Sly Rogue', firstClass: 'Rogue',
  classLevels: [{ className: 'Rogue', level: 1 }],
  subclassChoices: { Rogue: 'Thief' },
  stats: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
  baseStats: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
  hitDice: [{ className: 'Rogue', dieSides: 8, total: 1, remaining: 1 }],
  proficiencies: {
    armor: ['light'], weapons: ['simple-melee','simple-ranged','martial-melee','martial-ranged'],
    tools: [], savingThrows: ['dex','int'], skills: ['Stealth'], expertise: ['Stealth'],
  },
  resources: { sneakAttackDice: '1d6' },
  equipment: [
    { name: 'Shortsword', quantity: 1, equipped: true, category: 'weapon' },
    { name: 'Dagger',     quantity: 1, equipped: true, category: 'weapon' },
  ],
};
const rc = buildCombatant(rogue);
const ss = rc.actions.find(a => a.name === 'Shortsword');
assert('Shortsword present for Rogue', ss !== undefined);
if (ss) {
  // DEX+3 + prof+2 = 5
  eq('Shortsword uses DEX (finesse): bonus=5', ss.hitBonus, 5);
}

// Fighter with high STR, low DEX wielding finesse weapon → uses STR
const strFighter = makeFighter({
  stats: { str: 18, dex: 8, con: 16, int: 8, wis: 12, cha: 13 },
  baseStats: { str: 18, dex: 8, con: 16, int: 8, wis: 12, cha: 13 },
  equipment: [
    { name: 'Rapier', quantity: 1, equipped: true, category: 'weapon' },
  ],
});
const sfc = buildCombatant(strFighter);
const rapier = sfc.actions.find(a => a.name === 'Rapier');
assert('Rapier present for STR Fighter', rapier !== undefined);
if (rapier) {
  // STR+4 > DEX-1; prof+2 → bonus 6
  eq('Rapier uses STR (higher): bonus=6', rapier.hitBonus, 6);
}

// =============================================================
// 4. Multiclass CharacterSheet
// =============================================================

console.log('\n=== 4. Multiclass CharacterSheet ===\n');

const multiclassSheet: CharacterSheet = {
  ...makeFighter(),
  name: 'Eldritch Knight',
  classLevels: [
    { className: 'Fighter', level: 3 },
    { className: 'Wizard',  level: 2 },
  ],
  subclassChoices: { Fighter: 'Eldritch Knight', Wizard: 'School of Abjuration' },
  stats: { str: 16, dex: 12, con: 14, int: 14, wis: 10, cha: 8 },
  baseStats: { str: 16, dex: 12, con: 14, int: 14, wis: 10, cha: 8 },
  maxHP: 31, currentHP: 31,
  spellcasting: {
    ability: 'int', spellAttackBonus: 4, saveDC: 12,
    slots: { '1': 3 }, slotsUsed: {},
    cantrips: ['Fire Bolt'], knownSpells: [],
    preparedSpells: ['Magic Missile', 'Shield'],
    spellbook: ['Magic Missile', 'Shield', 'Thunderwave'],
  },
  resources: {
    secondWind: { max: 1, remaining: 1 },
    arcaneRecovery: { usesRemaining: 1 },
  },
  equipment: [
    { name: 'Longsword', quantity: 1, equipped: true, category: 'weapon' },
  ],
  hitDice: [
    { className: 'Fighter', dieSides: 10, total: 3, remaining: 3 },
    { className: 'Wizard',  dieSides: 6,  total: 2, remaining: 2 },
  ],
};

eq('totalLevel of multiclass sheet = 5', totalLevel(multiclassSheet), 5);

const mc = buildCombatant(multiclassSheet);
eq('Multiclass name', mc.name, 'Eldritch Knight');
eq('Multiclass maxHP=31', mc.maxHP, 31);
assert('Longsword present', mc.actions.some(a => a.name === 'Longsword'));
assert('Magic Missile present', mc.actions.some(a => a.name === 'Magic Missile'));
assert('spellSlots present for multiclass', mc.resources?.spellSlots !== undefined);
eq('1st-level slots=3 for multiclass', mc.resources?.spellSlots?.[1]?.max, 3);

// =============================================================
// 5. Unknown weapon fallback
// =============================================================

console.log('\n=== 5. Unknown Weapon Fallback ===\n');

const unknownWeapon = makeFighter({
  equipment: [
    { name: 'Vorpal Banana', quantity: 1, equipped: true, category: 'weapon' },
  ],
});
const warnings = buildWarnings(unknownWeapon);
assert('buildWarnings flags unknown weapon', warnings.some(w => w.includes('Vorpal Banana')));

// Should still produce a combatant (fallback to club stats)
const fallbackC = buildCombatant(unknownWeapon);
assert('Unknown weapon produces a combatant', fallbackC !== null);
assert('Fallback weapon in actions', fallbackC.actions.length > 0);
eq('Fallback weapon name preserved', fallbackC.actions[0].name, 'Vorpal Banana');

// =============================================================
// 6. buildWarnings — edge cases
// =============================================================

console.log('\n=== 6. buildWarnings ===\n');

// No warnings for valid fighter
const noWarn = buildWarnings(makeFighter());
eq('Valid fighter: 0 warnings', noWarn.length, 0);

// Warning for 0 HP character
const deadSheet = makeFighter({ currentHP: 0 });
const deadWarn = buildWarnings(deadSheet);
assert('0 HP triggers warning', deadWarn.some(w => w.includes('HP')));

// Warning for spellcaster with slots but no spells
const emptySpells = makeWizard({
  spellcasting: {
    ability: 'int', spellAttackBonus: 5, saveDC: 13,
    slots: { '1': 2 }, slotsUsed: {},
    cantrips: [], knownSpells: [], preparedSpells: [],
    spellbook: [],
  },
});
const spellWarn = buildWarnings(emptySpells);
assert('Slots-but-no-spells triggers warning', spellWarn.some(w => w.includes('spell')));

// =============================================================
// 7. Example JSON Files → Combatant
// =============================================================

console.log('\n=== 7. Example JSON Files → Combatant ===\n');

const repoRoot = path.join(__dirname, '..', '..');
const exFighterPath = path.join(repoRoot, 'characters', 'example-fighter.json');
const exWizardPath  = path.join(repoRoot, 'characters', 'example-wizard.json');

function loadAndBuild(filePath: string, label: string): void {
  try {
    const sheet = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CharacterSheet;
    const c = buildCombatant(sheet);
    assert(`${label}: buildCombatant succeeds`,    c !== null);
    assert(`${label}: name set`,                   c.name === sheet.name);
    assert(`${label}: id prefixed`,                c.id.startsWith('sheet_'));
    assert(`${label}: maxHP > 0`,                  c.maxHP > 0);
    assert(`${label}: has at least 1 action`,      c.actions.length > 0);
    assert(`${label}: isPlayer = true`,            c.isPlayer);
  } catch (e) {
    console.error(`  ❌ ${label}: ${(e as Error).message}`); failed++;
  }
}

loadAndBuild(exFighterPath, 'example-fighter.json');
loadAndBuild(exWizardPath,  'example-wizard.json');

// =============================================================
// 8. AIProfile passthrough
// =============================================================

console.log('\n=== 8. AIProfile Passthrough ===\n');

const nearestAI = buildCombatant(makeFighter(), { x: 0, y: 0, z: 0 }, 'attackNearest');
eq('aiProfile=attackNearest set', nearestAI.aiProfile, 'attackNearest');

const smart = buildCombatant(makeFighter(), { x: 0, y: 0, z: 0 }, 'smart');
eq('aiProfile=smart set', smart.aiProfile, 'smart');

// =============================================================
// Results
// =============================================================

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
