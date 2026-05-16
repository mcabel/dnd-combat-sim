// ============================================================
// Test: PC stat block parser — all 12 level-1 classes
// Run: ts-node src/test/pc.test.ts
// ============================================================

import { pcToCombatant, loadPCStatBlocks, spawnPC, RawPCEntry } from '../parser/pc';
import * as fs from 'fs';
import * as path from 'path';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  assert(label, actual === expected,
    `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function gte(label: string, actual: number, min: number): void {
  assert(label, actual >= min, `got ${actual}, want >= ${min}`);
}

// ---- Load data ----------------------------------------------

const candidates = [
  path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
  '/mnt/project/pc_stat_blocks_lv1.json',
];
const dataPath = candidates.find(p => fs.existsSync(p));
if (!dataPath) {
  console.error('ERROR: pc_stat_blocks_lv1.json not found at:\n' + candidates.join('\n'));
  process.exit(1);
}

const raw: RawPCEntry[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const pcMap = loadPCStatBlocks(raw);

// ============================================================
// 1. loadPCStatBlocks
// ============================================================
console.log('\n=== 1. loadPCStatBlocks ===\n');

eq('12 classes loaded', pcMap.size, 12);
const expectedClasses = [
  'barbarian','bard','cleric','druid','fighter',
  'monk','paladin','ranger','rogue','sorcerer','warlock','wizard'
];
for (const cls of expectedClasses) {
  assert(`Has ${cls}`, pcMap.has(cls));
}

// ============================================================
// 2. spawnPC — unknown class
// ============================================================
console.log('\n=== 2. spawnPC error handling ===\n');

assert('Unknown class → null', spawnPC(pcMap, 'Artificer', {x:0,y:0,z:0}) === null);

// ============================================================
// 3. Barbarian (Half-Orc, Path of Berserker)
// ============================================================
console.log('\n=== 3. Barbarian ===\n');

const barb = spawnPC(pcMap, 'Barbarian', {x:0,y:0,z:0});
assert('Spawned', barb !== null);
if (barb) {
  eq('HP = 14', barb.maxHP, 14);
  eq('AC = 13', barb.ac, 13);
  eq('Speed = 30', barb.speed, 30);
  eq('STR = 17', barb.str, 17);
  eq('CON = 15', barb.con, 15);
  eq('Is player', barb.isPlayer, true);
  eq('Faction = party', barb.faction, 'party');
  eq('CR = null (PC)', barb.cr, null);
  eq('AI profile = smart', barb.aiProfile, 'smart');

  // Weapons: Greataxe, Handaxe, Javelin (no +SA duplicates)
  gte('Has ≥ 2 actions', barb.actions.length, 2);
  const axe = barb.actions.find(a => a.name === 'Greataxe');
  assert('Has Greataxe', axe !== undefined);
  if (axe) {
    eq('Greataxe hit bonus = 5', axe.hitBonus, 5);
    assert('Greataxe has damage', axe.damage !== null);
    if (axe.damage) {
      eq('Greataxe 1d12', axe.damage.sides, 12);
      eq('Greataxe +3 bonus', axe.damage.bonus, 3);
    }
    eq('Greataxe melee', axe.attackType, 'melee');
    eq('Greataxe reach 5', axe.reach, 5);
    eq('Greataxe cost = action', axe.costType, 'action');
  }

  // Traits include level 1 features
  assert('Has Rage trait', barb.traits.includes('Rage'));
  assert('Has Reckless Attack trait', barb.traits.includes('Reckless Attack'));
  assert('Has Relentless Endurance (racial)', barb.traits.includes('Relentless Endurance'));

  // Budget
  eq('Budget movement = 30', barb.budget.movementFt, 30);
  assert('Action not used', !barb.budget.actionUsed);

  // Initial state
  assert('No conditions', barb.conditions.size === 0);
  assert('Not dead', !barb.isDead);
}

// ============================================================
// 4. Bard (Half-Elf, College of Lore)
// ============================================================
console.log('\n=== 4. Bard ===\n');

const bard = spawnPC(pcMap, 'Bard', {x:2,y:0,z:0});
assert('Spawned', bard !== null);
if (bard) {
  eq('HP = 10', bard.maxHP, 10);
  eq('AC = 13', bard.ac, 13);
  eq('CHA = 17', bard.cha, 17);

  const rapier = bard.actions.find(a => a.name === 'Rapier');
  assert('Has Rapier', rapier !== undefined);
  if (rapier) {
    eq('Rapier +4 to hit', rapier.hitBonus, 4);
    assert('Rapier has 1d8 damage', rapier.damage?.sides === 8);
  }

  assert('Has Bardic Inspiration trait', bard.traits.includes('Bardic Inspiration'));
}

// ============================================================
// 5. Cleric (Hill Dwarf, Life Domain)
// ============================================================
console.log('\n=== 5. Cleric ===\n');

const cleric = spawnPC(pcMap, 'Cleric', {x:3,y:0,z:0});
assert('Spawned', cleric !== null);
if (cleric) {
  eq('HP = 11', cleric.maxHP, 11);
  eq('AC = 18', cleric.ac, 18);  // Chain Mail + Shield
  eq('Speed = 25', cleric.speed, 25);  // Hill Dwarf
  eq('WIS = 16', cleric.wis, 16);

  const mace = cleric.actions.find(a => a.name === 'Mace');
  assert('Has Mace', mace !== undefined);

  // Sacred Flame is a save-based cantrip
  const flame = cleric.actions.find(a => a.name === 'Sacred Flame');
  assert('Has Sacred Flame', flame !== undefined);
  if (flame) {
    eq('Sacred Flame is save-based', flame.attackType, 'save');
    eq('Sacred Flame DC = 13', flame.saveDC, 13);
    eq('Sacred Flame no attack roll', flame.hitBonus, null);
  }

  assert('Has Disciple of Life trait', cleric.traits.includes('Disciple of Life (Life Domain)'));
}

// ============================================================
// 6. Fighter (Mountain Dwarf, Champion)
// ============================================================
console.log('\n=== 6. Fighter ===\n');

const fighter = spawnPC(pcMap, 'Fighter', {x:4,y:0,z:0});
assert('Spawned', fighter !== null);
if (fighter) {
  eq('HP = 13', fighter.maxHP, 13);
  eq('AC = 16', fighter.ac, 16);
  eq('STR = 17', fighter.str, 17);
  eq('CON = 16', fighter.con, 16);

  const gs = fighter.actions.find(a => a.name === 'Greatsword');
  assert('Has Greatsword', gs !== undefined);
  if (gs) {
    eq('Greatsword +5 to hit', gs.hitBonus, 5);
    assert('Greatsword 2d6', gs.damage?.count === 2 && gs.damage?.sides === 6);
  }

  assert('Has Second Wind trait', fighter.traits.includes('Second Wind'));
}

// ============================================================
// 7. Monk (Wood Elf, Way of the Open Hand)
// ============================================================
console.log('\n=== 7. Monk ===\n');

const monk = spawnPC(pcMap, 'Monk', {x:5,y:0,z:0});
assert('Spawned', monk !== null);
if (monk) {
  eq('HP = 9', monk.maxHP, 9);
  eq('AC = 15', monk.ac, 15);  // Unarmored Defense
  eq('Speed = 35', monk.speed, 35);  // Wood Elf

  const ss = monk.actions.find(a => a.name === 'Shortsword');
  assert('Has Shortsword', ss !== undefined);

  // Unarmed bonus attack is a bonus action
  const unarmed = monk.actions.find(a => a.name === 'Unarmed Bonus Attack');
  assert('Has Unarmed Bonus Attack', unarmed !== undefined);
  if (unarmed) {
    eq('Bonus attack cost = bonusAction', unarmed.costType, 'bonusAction');
  }

  assert('Has Martial Arts trait', monk.traits.includes('Martial Arts'));
}

// ============================================================
// 8. Rogue (Lightfoot Halfling, Thief)
// ============================================================
console.log('\n=== 8. Rogue ===\n');

const rogue = spawnPC(pcMap, 'Rogue', {x:6,y:0,z:0});
assert('Spawned', rogue !== null);
if (rogue) {
  eq('HP = 10', rogue.maxHP, 10);
  eq('AC = 14', rogue.ac, 14);
  eq('DEX = 17', rogue.dex, 17);

  // Only non-+SA weapons should be loaded
  const ssRogue = rogue.actions.find(a => a.name === 'Shortsword');
  assert('Has Shortsword (no +SA duplicate)', ssRogue !== undefined);
  assert('No +SA action', !rogue.actions.some(a => a.name.includes('+SA')));

  const shortbow = rogue.actions.find(a => a.name === 'Shortbow');
  assert('Has Shortbow', shortbow !== undefined);
  if (shortbow) {
    assert('Shortbow is ranged', shortbow.attackType === 'ranged');
    assert('Shortbow has range', shortbow.range !== null);
  }

  assert('Has Sneak Attack trait', rogue.traits.includes('Sneak Attack'));
}

// ============================================================
// 9. Wizard (High Elf, School of Evocation)
// ============================================================
console.log('\n=== 9. Wizard ===\n');

const wizard = spawnPC(pcMap, 'Wizard', {x:7,y:0,z:0});
assert('Spawned', wizard !== null);
if (wizard) {
  eq('HP = 7', wizard.maxHP, 7);
  eq('AC = 13', wizard.ac, 13);
  eq('INT = 16', wizard.int, 16);
  eq('Speed = 30', wizard.speed, 30);

  const fb = wizard.actions.find(a => a.name === 'Fire Bolt');
  assert('Has Fire Bolt', fb !== undefined);
  if (fb) {
    eq('Fire Bolt +5 to hit', fb.hitBonus, 5);
    assert('Fire Bolt 1d10', fb.damage?.sides === 10);
  }

  assert('Has Arcane Recovery trait', wizard.traits.includes('Arcane Recovery'));
  assert('Has Ritual Casting trait', wizard.traits.includes('Ritual Casting'));
}

// ============================================================
// 10. Paladin (Dragonborn, Oath of Devotion)
// ============================================================
console.log('\n=== 10. Paladin ===\n');

const paladin = spawnPC(pcMap, 'Paladin', {x:8,y:0,z:0});
assert('Spawned', paladin !== null);
if (paladin) {
  eq('HP = 12', paladin.maxHP, 12);
  eq('AC = 18', paladin.ac, 18);
  eq('STR = 17', paladin.str, 17);

  const ls = paladin.actions.find(a => a.name === 'Longsword');
  assert('Has Longsword (no +Smite duplicate)', ls !== undefined);
  assert('No +Smite action', !paladin.actions.some(a => a.name.includes('+Smite')));

  assert('Has Divine Sense trait', paladin.traits.includes('Divine Sense'));
  assert('Has Lay on Hands trait', paladin.traits.includes('Lay on Hands'));
}

// ============================================================
// 11. Common rules for all PCs
// ============================================================
console.log('\n=== 11. Universal rules for all 12 PCs ===\n');

for (const [cls, rawEntry] of pcMap) {
  const pc = pcToCombatant(rawEntry, {x:0,y:0,z:0});
  assert(`${cls}: isPlayer = true`,      pc.isPlayer);
  assert(`${cls}: faction = party`,      pc.faction === 'party');
  assert(`${cls}: cr = null`,            pc.cr === null);
  assert(`${cls}: HP > 0`,              pc.maxHP > 0);
  assert(`${cls}: AC > 0`,              pc.ac > 0);
  assert(`${cls}: speed > 0`,           pc.speed > 0);
  assert(`${cls}: has ≥1 action`,       pc.actions.length >= 1);
  assert(`${cls}: no legendary actions`, pc.legendaryActions.length === 0);
  assert(`${cls}: conditions empty`,    pc.conditions.size === 0);
  assert(`${cls}: not dead`,            !pc.isDead);
  assert(`${cls}: no +SA actions`,      !pc.actions.some(a => a.name.includes('+SA')));
  assert(`${cls}: no +Smite actions`,   !pc.actions.some(a => a.name.includes('+Smite')));
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
