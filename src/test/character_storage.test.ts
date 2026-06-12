// ============================================================
// Test: Character Sheet Storage & Validation
// Run: ts-node src/test/character_storage.test.ts
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { randomUUID } from 'crypto';

import {
  saveCharacter, loadCharacter, listCharacters,
  deleteCharacter, importCharacter, exportCharacter,
  saveParty, loadParty, listParties, deleteParty, loadPartyMembers,
} from '../characters/storage';

import { validateCharacterSheet, validateParty, ValidationError } from '../characters/validator';
import {
  CharacterSheet, Party, totalLevel, deriveStats,
  abilityModifier, levelFromXP, proficiencyBonus,
} from '../characters/types';

// ---- Test Harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Isolated tmp directory (so tests don't pollute real characters/) --------

let tmpDir: string;
const origCwd = process.cwd();

function setupTmpDir(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-test-'));
  fs.mkdirSync(path.join(tmpDir, 'characters'));
  fs.mkdirSync(path.join(tmpDir, 'parties'));
  process.chdir(tmpDir);
}

function teardownTmpDir(): void {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---- Factories ----------------------------------------------

function makeSheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  const base: CharacterSheet = {
    id:        randomUUID(),
    version:   1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    name:       'Test Fighter',
    race:       'Human',
    background: 'Soldier',
    alignment:  'Lawful Good',

    firstClass:       'Fighter',
    classLevels:      [{ className: 'Fighter', level: 1 }],
    subclassChoices:  { Fighter: 'Champion' },
    experiencePoints: 0,

    baseStats: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    stats:     { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },

    maxHP:       11,
    currentHP:   11,
    temporaryHP: 0,
    armorClass:  14,
    acFormula:   'Chain Shirt',
    speed:       30,

    hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 1 }],

    proficiencies: {
      armor:        ['light', 'medium', 'heavy', 'shield'],
      weapons:      ['simple-melee', 'simple-ranged', 'martial-melee', 'martial-ranged'],
      tools:        [],
      savingThrows: ['str', 'con'],
      skills:       ['Athletics', 'Perception'],
      expertise:    [],
    },
    languages: ['Common'],

    resources:  { secondWind: { max: 1, remaining: 1 } },
    equipment:  [],
    gold:       10,

    level1Features: [
      { name: 'Second Wind', description: 'Regain HP as a bonus action.', source: 'class' },
    ],
    allFeatures: [
      { name: 'Second Wind', description: 'Regain HP as a bonus action.', source: 'class' },
    ],
    feats:             [],
    backgroundFeature: 'Military Rank',
    exhaustionLevel:   0,
  };
  return { ...base, ...overrides };
}

function makeParty(overrides: Partial<Party> = {}): Party {
  const base: Party = {
    id:           randomUUID(),
    name:         'Test Party',
    characterIds: [],
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

// =============================================================
// 1. Pure Utility Functions
// =============================================================

console.log('\n=== 1. Pure Utility Functions ===\n');

// totalLevel
eq('totalLevel: single class level 1', totalLevel(makeSheet()), 1);
eq('totalLevel: multiclass 3+2', totalLevel(makeSheet({
  classLevels: [{ className: 'Fighter', level: 3 }, { className: 'Wizard', level: 2 }],
})), 5);

// abilityModifier
eq('abilityModifier(10) = 0', abilityModifier(10), 0);
eq('abilityModifier(8) = -1', abilityModifier(8), -1);
eq('abilityModifier(16) = 3', abilityModifier(16), 3);
eq('abilityModifier(20) = 5', abilityModifier(20), 5);
eq('abilityModifier(1) = -5', abilityModifier(1), -5);

// proficiencyBonus
const lvl1sheet = makeSheet();
eq('profBonus lvl 1 = 2', proficiencyBonus(lvl1sheet), 2);
const lvl5sheet = makeSheet({ classLevels: [{ className: 'Fighter', level: 5 }] });
eq('profBonus lvl 5 = 3', proficiencyBonus(lvl5sheet), 3);
const lvl9sheet = makeSheet({ classLevels: [{ className: 'Fighter', level: 9 }] });
eq('profBonus lvl 9 = 4', proficiencyBonus(lvl9sheet), 4);

// levelFromXP
eq('levelFromXP(0) = 1', levelFromXP(0), 1);
eq('levelFromXP(300) = 2', levelFromXP(300), 2);
eq('levelFromXP(299) = 1 (just below threshold)', levelFromXP(299), 1);
eq('levelFromXP(6500) = 5', levelFromXP(6500), 5);
eq('levelFromXP(999999) = 20 (capped)', levelFromXP(999999), 20);

// deriveStats
const derived = deriveStats(makeSheet());
eq('deriveStats: totalLevel 1', derived.totalLevel, 1);
eq('deriveStats: profBonus 2', derived.proficiencyBonus, 2);
eq('deriveStats: STR mod 2 (score 15)', derived.abilityModifiers.str, 2);
eq('deriveStats: WIS mod 1 (score 12)', derived.abilityModifiers.wis, 1);
eq('deriveStats: passivePerception = 10+1+2 (prof Perception)', derived.passivePerception, 13);

// deriveStats: no Perception proficiency
const nopercSheet = makeSheet({ proficiencies: {
  armor: ['light', 'medium', 'heavy', 'shield'],
  weapons: ['simple-melee', 'simple-ranged', 'martial-melee', 'martial-ranged'],
  tools: [], savingThrows: ['str', 'con'],
  skills: ['Athletics'], expertise: [],
}});
const derivedNoPerc = deriveStats(nopercSheet);
eq('deriveStats: passivePerception without prof = 10+1', derivedNoPerc.passivePerception, 11);

// =============================================================
// 2. Validator — Valid Sheets
// =============================================================

console.log('\n=== 2. Validator — Valid Sheets ===\n');

const validErrors = validateCharacterSheet(makeSheet());
eq('valid sheet has 0 errors', validErrors.length, 0);

// Wizard spellcaster
const wizardSheet = makeSheet({
  name:       'Elven Wizard',
  race:       'High Elf',
  firstClass: 'Wizard',
  classLevels: [{ className: 'Wizard', level: 1 }],
  subclassChoices: { Wizard: 'School of Evocation' },
  stats:     { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
  baseStats: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
  maxHP: 7, currentHP: 7,
  hitDice: [{ className: 'Wizard', dieSides: 6, total: 1, remaining: 1 }],
  proficiencies: {
    armor: [], weapons: ['simple-melee', 'simple-ranged'],
    tools: [], savingThrows: ['int', 'wis'],
    skills: ['Arcana', 'Perception'], expertise: [],
  },
  resources: { arcaneRecovery: { usesRemaining: 1 } },
  spellcasting: {
    ability: 'int', spellAttackBonus: 5, saveDC: 13,
    slots: { '1': 2 }, slotsUsed: { '1': 0 },
    cantrips: ['Fire Bolt'], knownSpells: [],
    preparedSpells: ['Magic Missile', 'Sleep'],
    spellbook: ['Magic Missile', 'Sleep', 'Mage Armor'],
  },
});
const wizardErrors = validateCharacterSheet(wizardSheet);
eq('valid wizard sheet has 0 errors', wizardErrors.length, 0);

// =============================================================
// 3. Validator — Invalid Sheets
// =============================================================

console.log('\n=== 3. Validator — Invalid Sheets ===\n');

// Missing name
const noName = validateCharacterSheet(makeSheet({ name: '' }));
assert('empty name produces error', noName.some(e => e.includes('name')));

// Bad UUID
const badId = validateCharacterSheet(makeSheet({ id: 'not-a-uuid' }));
assert('bad UUID produces error', badId.some(e => e.includes('UUID')));

// HP overflow
const hpOverflow = validateCharacterSheet(makeSheet({ currentHP: 99, maxHP: 10 }));
assert('currentHP > maxHP produces error', hpOverflow.some(e => e.includes('currentHP')));

// Bad ability score
const badScore = validateCharacterSheet(makeSheet({
  stats: { str: 0, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
}));
assert('score 0 produces error', badScore.some(e => e.includes('str')));

// Unknown class
const badClass = validateCharacterSheet(makeSheet({ firstClass: 'Beholder' }));
assert('unknown firstClass produces error', badClass.some(e => e.includes('firstClass')));

// classLevels total 0 edge case
const zeroLevel = validateCharacterSheet(makeSheet({
  classLevels: [{ className: 'Fighter', level: 0 }],
}));
assert('level 0 in classLevels produces error', zeroLevel.some(e => e.includes('level')));

// firstClass not in classLevels
const missingFirst = validateCharacterSheet(makeSheet({
  firstClass: 'Wizard',
  classLevels: [{ className: 'Fighter', level: 1 }],
}));
assert('firstClass not in classLevels produces error', missingFirst.some(e => e.includes('firstClass')));

// Bad hit die size for class
const badHitDie = validateCharacterSheet(makeSheet({
  hitDice: [{ className: 'Fighter', dieSides: 6, total: 1, remaining: 1 }],
}));
assert('wrong dieSides for Fighter produces error', badHitDie.some(e => e.includes('dieSides')));

// Remaining > total hit dice
const hdOverflow = validateCharacterSheet(makeSheet({
  hitDice: [{ className: 'Fighter', dieSides: 10, total: 1, remaining: 5 }],
}));
assert('remaining > total hit dice produces error', hdOverflow.some(e => e.includes('remaining')));

// Exhaustion out of range
const badExhaust = validateCharacterSheet(makeSheet({ exhaustionLevel: 7 }));
assert('exhaustionLevel 7 produces error', badExhaust.some(e => e.includes('exhaustion')));

// Negative XP
const negXP = validateCharacterSheet(makeSheet({ experiencePoints: -1 }));
assert('negative XP produces error', negXP.some(e => e.includes('experiencePoints')));

// Multiclass prereq failure
const badMulticlass = validateCharacterSheet(makeSheet({
  stats: { str: 8, dex: 8, con: 10, int: 8, wis: 10, cha: 10 },
  baseStats: { str: 8, dex: 8, con: 10, int: 8, wis: 10, cha: 10 },
  classLevels: [
    { className: 'Fighter', level: 1 },
    { className: 'Wizard', level: 1 },
  ],
  firstClass: 'Fighter',
  hitDice: [
    { className: 'Fighter', dieSides: 10, total: 1, remaining: 1 },
    { className: 'Wizard',  dieSides: 6,  total: 1, remaining: 1 },
  ],
}));
assert('multiclass Wizard without INT 13 produces error',
  badMulticlass.some(e => e.includes('Wizard') && e.includes('int')));

// =============================================================
// 4. Validator — Party
// =============================================================

console.log('\n=== 4. Validator — Party ===\n');

const validParty = validateParty(makeParty());
eq('valid party has 0 errors', validParty.length, 0);

const noPartyName = validateParty(makeParty({ name: '' }));
assert('empty party name produces error', noPartyName.some(e => e.includes('name')));

const tooLarge = validateParty(makeParty({
  characterIds: Array.from({ length: 9 }, () => randomUUID()),
}));
assert('party with 9 members produces error', tooLarge.some(e => e.includes('8')));

const dupId = randomUUID();
const dupParty = validateParty(makeParty({ characterIds: [dupId, dupId] }));
assert('duplicate characterId produces error', dupParty.some(e => e.includes('duplicate')));

const badMemberId = validateParty(makeParty({ characterIds: ['not-a-uuid'] }));
assert('bad UUID in characterIds produces error', badMemberId.some(e => e.includes('UUID')));

// =============================================================
// 5. Storage — Character CRUD
// =============================================================

console.log('\n=== 5. Storage — Character CRUD ===\n');

setupTmpDir();

try {
  // Save
  const sheet1 = makeSheet({ name: 'Storage Test Fighter' });
  const saved = saveCharacter(sheet1);
  assert('saveCharacter returns object with id', typeof saved.id === 'string' && saved.id.length > 0);
  assert('saveCharacter sets updatedAt', typeof saved.updatedAt === 'string');

  // Load
  const loaded = loadCharacter(saved.id);
  assert('loadCharacter finds saved sheet', loaded !== null);
  eq('loadCharacter: name matches', loaded?.name ?? '', 'Storage Test Fighter');
  eq('loadCharacter: firstClass matches', loaded?.firstClass ?? '', 'Fighter');

  // Load missing → null
  const missing = loadCharacter(randomUUID());
  assert('loadCharacter returns null for missing id', missing === null);

  // List
  const sheet2 = makeSheet({ name: 'Storage Test Rogue', firstClass: 'Rogue',
    classLevels: [{ className: 'Rogue', level: 1 }],
    subclassChoices: { Rogue: 'Thief' },
    proficiencies: { armor: ['light'], weapons: ['simple-melee', 'simple-ranged', 'martial-melee', 'martial-ranged'],
      tools: ["Thieves' Tools"], savingThrows: ['dex', 'int'],
      skills: ['Stealth', 'Perception'], expertise: ['Stealth'] },
    hitDice: [{ className: 'Rogue', dieSides: 8, total: 1, remaining: 1 }],
    resources: { sneakAttackDice: '1d6', cunningAction: false },
  });
  saveCharacter(sheet2);
  const allSheets = listCharacters();
  assert('listCharacters returns 2 sheets', allSheets.length === 2);

  // Delete
  const deleted = deleteCharacter(saved.id);
  assert('deleteCharacter returns true', deleted);
  const afterDelete = loadCharacter(saved.id);
  assert('deleted character is gone', afterDelete === null);

  // Delete missing → false
  const delMissing = deleteCharacter(randomUUID());
  assert('deleteCharacter returns false for missing id', delMissing === false);

  // List after delete
  const remaining = listCharacters();
  eq('listCharacters returns 1 after deletion', remaining.length, 1);

  // ---- Import / Export ----
  const toExport = saveCharacter(makeSheet({ name: 'Export Target' }));
  const json = exportCharacter(toExport.id);
  assert('exportCharacter returns JSON string', typeof json === 'string');
  assert('exportCharacter JSON contains name', json.includes('Export Target'));

  const imported = importCharacter(json);
  assert('importCharacter creates new entry', imported.id !== toExport.id);
  eq('importCharacter: name preserved', imported.name, 'Export Target');

  // Import invalid JSON
  let threw = false;
  try { importCharacter('not json'); } catch { threw = true; }
  assert('importCharacter throws on invalid JSON', threw);

} finally {
  teardownTmpDir();
}

// =============================================================
// 6. Storage — Party CRUD
// =============================================================

console.log('\n=== 6. Storage — Party CRUD ===\n');

setupTmpDir();

try {
  // Create characters first
  const c1 = saveCharacter(makeSheet({ name: 'Party Member A' }));
  const c2 = saveCharacter(makeSheet({ name: 'Party Member B', firstClass: 'Wizard',
    classLevels: [{ className: 'Wizard', level: 1 }],
    subclassChoices: { Wizard: 'School of Abjuration' },
    stats: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    baseStats: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    maxHP: 7, currentHP: 7,
    hitDice: [{ className: 'Wizard', dieSides: 6, total: 1, remaining: 1 }],
    proficiencies: { armor: [], weapons: ['simple-melee', 'simple-ranged'],
      tools: [], savingThrows: ['int', 'wis'], skills: ['Arcana'], expertise: [] },
    resources: { arcaneRecovery: { usesRemaining: 1 } },
  }));

  const party = makeParty({ name: 'The Test Companions', characterIds: [c1.id, c2.id] });
  const savedParty = saveParty(party);
  assert('saveParty returns object with id', typeof savedParty.id === 'string');

  // Load
  const loadedParty = loadParty(savedParty.id);
  assert('loadParty finds saved party', loadedParty !== null);
  eq('loadParty: name matches', loadedParty?.name ?? '', 'The Test Companions');
  eq('loadParty: member count', loadedParty?.characterIds.length ?? 0, 2);

  // List
  const allParties = listParties();
  eq('listParties returns 1 party', allParties.length, 1);

  // loadPartyMembers
  const members = loadPartyMembers(savedParty.id);
  eq('loadPartyMembers returns 2 members', members.length, 2);
  const memberNames = members.map(m => m.name).sort();
  assert('member A present', memberNames.includes('Party Member A'));
  assert('member B present', memberNames.includes('Party Member B'));

  // Delete
  const delParty = deleteParty(savedParty.id);
  assert('deleteParty returns true', delParty);
  assert('party is gone after delete', loadParty(savedParty.id) === null);

  // Delete character removes from parties
  const p2 = saveParty(makeParty({ name: 'Cascade Party', characterIds: [c1.id, c2.id] }));
  deleteCharacter(c1.id);
  const p2Loaded = loadParty(p2.id);
  assert('deleting character removes them from party', !p2Loaded?.characterIds.includes(c1.id));
  assert('other party member retained', p2Loaded?.characterIds.includes(c2.id) ?? false);

} finally {
  teardownTmpDir();
}

// =============================================================
// 7. Storage — Validation Enforcement
// =============================================================

console.log('\n=== 7. Storage — Validation Enforcement ===\n');

setupTmpDir();

try {
  // Invalid sheet should throw ValidationError
  let threw = false;
  try {
    saveCharacter(makeSheet({ name: '', maxHP: 0 }));
  } catch (e) {
    threw = e instanceof ValidationError;
  }
  assert('saveCharacter throws ValidationError on invalid sheet', threw);

  // Invalid party should throw ValidationError
  let threwParty = false;
  try {
    saveParty(makeParty({ name: '' }));
  } catch (e) {
    threwParty = e instanceof ValidationError;
  }
  assert('saveParty throws ValidationError on invalid party', threwParty);

  // Invalid ID in path (path traversal guard)
  let threwBadId = false;
  try {
    loadCharacter('../etc/passwd');
  } catch (e) {
    threwBadId = true;
  }
  assert('loadCharacter rejects path-traversal id', threwBadId);

} finally {
  teardownTmpDir();
}

// =============================================================
// 8. Example JSON Files
// =============================================================

console.log('\n=== 8. Example JSON Files (from repo) ===\n');

// Load example files from the repo
const repoRoot = path.join(__dirname, '..', '..');

const exFighterPath = path.join(repoRoot, 'characters', 'example-fighter.json');
const exWizardPath  = path.join(repoRoot, 'characters', 'example-wizard.json');
const exPartyPath   = path.join(repoRoot, 'parties',    'example-party.json');

function loadAndValidate(filePath: string, label: string): void {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const obj = JSON.parse(raw);
    const errors = 'characterIds' in obj
      ? validateParty(obj)
      : validateCharacterSheet(obj);
    if (errors.length === 0) {
      console.log(`  ✅ ${label}: valid`); passed++;
    } else {
      console.error(`  ❌ ${label}: ${errors.join('; ')}`); failed++;
    }
  } catch (e) {
    console.error(`  ❌ ${label}: file error — ${(e as Error).message}`); failed++;
  }
}

loadAndValidate(exFighterPath, 'example-fighter.json');
loadAndValidate(exWizardPath,  'example-wizard.json');
loadAndValidate(exPartyPath,   'example-party.json');

// =============================================================
// Results
// =============================================================

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
