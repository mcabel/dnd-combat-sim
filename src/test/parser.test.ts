// ============================================================
// Test: parse bestiary-dmg.json → verify Combatant output
// Run: ts-node src/test/parser.test.ts
// ============================================================

import { loadBestiaryJson, spawnMonster } from '../parser/fivetools';
import { parseDice } from '../parser/fivetools';
import { listMonsters } from '../parser/fivetools';
import * as fs from 'fs';
import * as path from 'path';

// ---- Mini test harness --------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function eq<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected;
  assert(
    label,
    ok,
    ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
  );
}

// ---- Locate bestiary-dmg.json --------------------------------

// Check next to this file (project root) or in /mnt/project
const candidates = [
  path.join(__dirname, '../../bestiaryData/bestiary-dmg.json'),
  path.join(__dirname, '../../bestiary-dmg.json'),
  '/mnt/project/bestiary-dmg.json',
];
let dataPath = candidates.find(p => fs.existsSync(p));
if (!dataPath) {
  console.error('\nERROR: bestiary-dmg.json not found in:\n' + candidates.join('\n'));
  process.exit(1);
}

// Copy to project root if only found in /mnt
const rootPath = path.join(__dirname, '../../bestiary-dmg.json');
if (dataPath !== rootPath) {
  fs.copyFileSync(dataPath, rootPath);
  console.log(`Copied bestiary-dmg.json from ${dataPath}`);
  dataPath = rootPath;
}

const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
const bestiary = loadBestiaryJson(raw);

// ============================================================
// 1. Dice parser unit tests
// ============================================================
console.log('\n=== 1. parseDice ===\n');

const d1 = parseDice('1d8 + 3');
assert('1d8+3 parsed', d1 !== null);
if (d1) {
  eq('count=1', d1.count, 1);
  eq('sides=8', d1.sides, 8);
  eq('bonus=3', d1.bonus, 3);
  eq('average=7', d1.average, 7);      // floor(1*9/2)+3 = 4+3 = 7
}

const d2 = parseDice('{@damage 1d4 - 1}');
assert('1d4-1 (tag) parsed', d2 !== null);
if (d2) {
  eq('count=1', d2.count, 1);
  eq('sides=4', d2.sides, 4);
  eq('bonus=-1', d2.bonus, -1);
  eq('average=1', d2.average, 1);      // floor(1*5/2)-1 = 2-1 = 1
}

const d3 = parseDice('2d6 + 5');
assert('2d6+5 parsed', d3 !== null);
if (d3) {
  eq('count=2', d3.count, 2);
  eq('sides=6', d3.sides, 6);
  eq('bonus=5', d3.bonus, 5);
  eq('average=12', d3.average, 12);    // floor(2*7/2)+5 = 7+5 = 12
}

const d4 = parseDice('no dice here');
assert('returns null for no dice', d4 === null);

// ============================================================
// 2. Bestiary loading
// ============================================================
console.log('\n=== 2. Bestiary loading ===\n');

assert('Map not empty', bestiary.size > 0);
assert('Avatar of Death present', bestiary.has('avatar of death'));
assert('Giant Fly present', bestiary.has('giant fly'));
assert('Larva present', bestiary.has('larva'));
// Session 52 Batch 0: bestiary is dual-keyed (bare name + name|source), so
// bestiary.size counts 6 keys for 3 monsters. listMonsters() returns the
// 3 unique bare names. Assert via listMonsters for the correct unique count.
eq('Exactly 3 unique monsters', listMonsters(bestiary).length, 3);

// ============================================================
// 3. Avatar of Death
// ============================================================
console.log('\n=== 3. Avatar of Death ===\n');

const avatar = spawnMonster(bestiary, 'Avatar of Death', { x: 0, y: 0, z: 0 }, 'smart');
assert('Spawned', avatar !== null);

if (avatar) {
  eq('AC = 20', avatar.ac, 20);
  eq('Ground speed = 60', avatar.speed, 60);
  eq('Fly speed = 60', avatar.flySpeed, 60);
  eq('STR = 16', avatar.str, 16);
  eq('DEX = 16', avatar.dex, 16);
  eq('CON = 16', avatar.con, 16);
  eq('INT = 16', avatar.int, 16);
  eq('WIS = 16', avatar.wis, 16);
  eq('CHA = 16', avatar.cha, 16);

  // HP is "special" → 50 placeholder
  eq('HP placeholder = 50', avatar.maxHP, 50);
  eq('currentHP = maxHP', avatar.currentHP, avatar.maxHP);

  // hpOverride
  const avatarCustomHP = spawnMonster(
    bestiary, 'Avatar of Death', { x: 0, y: 0, z: 0 }, 'smart', 'enemy', 66
  );
  assert('hpOverride works', avatarCustomHP?.maxHP === 66);

  // Faction / player flag
  assert('Not a player', !avatar.isPlayer);
  eq('Faction = enemy', avatar.faction, 'enemy');
  eq('AI profile = smart', avatar.aiProfile, 'smart');

  // Traits
  assert('Has Incorporeal Movement', avatar.traits.includes('Incorporeal Movement'));
  assert('Has Turn Immunity', avatar.traits.includes('Turn Immunity'));

  // No legendary actions
  eq('No legendary actions', avatar.legendaryActions.length, 0);
  eq('Legendary pool = 0', avatar.legendaryActionPoolMax, 0);

  // Action: Reaping Scythe
  const scythe = avatar.actions.find(a => a.name === 'Reaping Scythe');
  assert('Has Reaping Scythe', scythe !== undefined);
  if (scythe) {
    eq('Attack type = melee', scythe.attackType, 'melee');
    eq('Reach = 5', scythe.reach, 5);
    // Reaping Scythe has no {@hit} tag in 5etools — no attack roll listed
    assert('Hit bonus is null (no attack roll in entry)', scythe.hitBonus === null);
    assert('Has primary damage', scythe.damage !== null);
    if (scythe.damage) {
      // "1d8 + 3" slashing is the primary {@damage}
      eq('Primary damage count = 1', scythe.damage.count, 1);
      eq('Primary damage sides = 8', scythe.damage.sides, 8);
      eq('Primary damage bonus = 3', scythe.damage.bonus, 3);
    }
    eq('Damage type = slashing', scythe.damageType, 'slashing');
    assert('Not AoE', !scythe.isAoE);
    assert('Not control', !scythe.isControl);
    assert('Not Multiattack', !scythe.isMultiattack);
    eq('Cost = action', scythe.costType, 'action');
    eq('Legendary cost = 0', scythe.legendaryCost, 0);
  }

  // Budget
  eq('Budget movementFt = 60', avatar.budget.movementFt, 60);
  assert('Action not used', !avatar.budget.actionUsed);
  assert('Bonus action not used', !avatar.budget.bonusActionUsed);
  assert('Reaction not used', !avatar.budget.reactionUsed);

  // Initial state
  assert('No conditions', avatar.conditions.size === 0);
  assert('Not dead', !avatar.isDead);
  assert('Not unconscious', !avatar.isUnconscious);
  assert('Perception empty', avatar.perception.targets.size === 0);
}

// ============================================================
// 4. Giant Fly
// ============================================================
console.log('\n=== 4. Giant Fly ===\n');

const fly = spawnMonster(bestiary, 'Giant Fly', { x: 5, y: 5, z: 0 }, 'attackNearest');
assert('Spawned', fly !== null);
if (fly) {
  eq('AC = 11', fly.ac, 11);
  eq('HP = 19', fly.maxHP, 19);
  eq('Ground speed = 30', fly.speed, 30);
  eq('Fly speed = 60', fly.flySpeed, 60);
  eq('Swim speed = null', fly.swimSpeed, null);
  eq('STR = 14', fly.str, 14);
  eq('DEX = 13', fly.dex, 13);
  eq('INT = 2', fly.int, 2);
  eq('CHA = 3', fly.cha, 3);
  // Giant Fly has no actions in the DMG bestiary entry
  eq('No actions', fly.actions.length, 0);
  eq('No legendary actions', fly.legendaryActions.length, 0);
  eq('No traits', fly.traits.length, 0);
  eq('AI = attackNearest', fly.aiProfile, 'attackNearest');
  eq('Budget movementFt = 30', fly.budget.movementFt, 30);

  // CR is not listed for Giant Fly in bestiary-dmg.json
  assert('CR is null', fly.cr === null);
}

// ============================================================
// 5. Larva
// ============================================================
console.log('\n=== 5. Larva ===\n');

const larva = spawnMonster(bestiary, 'Larva', { x: 2, y: 3, z: 0 }, 'attackNearest');
assert('Spawned', larva !== null);
if (larva) {
  eq('AC = 9', larva.ac, 9);
  eq('HP = 9', larva.maxHP, 9);
  eq('Ground speed = 20', larva.speed, 20);
  eq('Fly speed = null', larva.flySpeed, null);
  eq('CR = 0', larva.cr, 0);

  const bite = larva.actions.find(a => a.name === 'Bite');
  assert('Has Bite', bite !== undefined);
  if (bite) {
    eq('Attack type = melee', bite.attackType, 'melee');
    eq('Hit bonus = 1', bite.hitBonus, 1);
    assert('Has damage', bite.damage !== null);
    if (bite.damage) {
      eq('Dice count = 1', bite.damage.count, 1);
      eq('Dice sides = 4', bite.damage.sides, 4);
      eq('Dice bonus = -1', bite.damage.bonus, -1);
      // average: floor(1*5/2) + (-1) = 2 - 1 = 1
      eq('Average damage = 1', bite.damage.average, 1);
    }
    eq('Damage type = piercing', bite.damageType, 'piercing');
    assert('Not AoE', !bite.isAoE);
    assert('Not control', !bite.isControl);
    assert('Not Multiattack', !bite.isMultiattack);
  }

  eq('Budget movementFt = 20', larva.budget.movementFt, 20);
  assert('No conditions', larva.conditions.size === 0);
}

// ============================================================
// 6. Error handling
// ============================================================
console.log('\n=== 6. Error handling ===\n');

const missing = spawnMonster(bestiary, 'Tarrasque', { x: 0, y: 0, z: 0 });
assert('Returns null for unknown monster', missing === null);

const caseInsensitive = spawnMonster(bestiary, 'LARVA', { x: 0, y: 0, z: 0 });
assert('Case-insensitive lookup works', caseInsensitive !== null);

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailed tests above ↑');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✅');
}
