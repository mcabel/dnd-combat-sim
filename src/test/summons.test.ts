// ============================================================
// Test: Summon-type Creatures (Phase 5.1–5.3)
// Run: ts-node src/test/summons.test.ts
// ============================================================

import { getSummonEntry, listSummons, getSummonsBySource, SUMMON_REGISTRY } from '../summons/registry';
import { spawnSummon, resolveSummonHP, issueVerbalCommand }                  from '../summons/spawner';
import { loadBestiaryJson }                                                   from '../parser/fivetools';
import { runCombat, makeFlatBattlefield }                                     from '../engine/combat';
import { loadPCStatBlocks, spawnPC, RawPCEntry }                              from '../parser/pc';
import * as fs   from 'fs';
import * as path from 'path';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Load data ----------------------------------------------

const bestiaryPath = [
  path.join(__dirname, '../../bestiaryData/bestiary-dmg.json'),
  '/mnt/project/bestiary-dmg.json',
].find(p => fs.existsSync(p))!;

const pcPath = [
  path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
  '/mnt/project/pc_stat_blocks_lv1.json',
].find(p => fs.existsSync(p))!;

const rawBestiary = JSON.parse(fs.readFileSync(bestiaryPath, 'utf-8'));
// loadBestiaryJson loads ALL monsters including summon-types (no filter)
const fullBestiaryMap = loadBestiaryJson(rawBestiary);

const pcData: RawPCEntry[] = JSON.parse(fs.readFileSync(pcPath, 'utf-8'));
const pcMap = loadPCStatBlocks(pcData);

// ============================================================
// 1. Registry structure
// ============================================================
console.log('\n=== 1. Registry ===\n');

assert('Registry is non-empty', SUMMON_REGISTRY.length > 0);
assert('Giant Fly is registered', getSummonEntry('Giant Fly') !== null);
assert('Avatar of Death is registered', getSummonEntry('Avatar of Death') !== null);
assert('Case-insensitive lookup', getSummonEntry('giant fly') !== null);
assert('Unknown name returns null', getSummonEntry('Tarrasque') === null);

const flyEntry = getSummonEntry('Giant Fly')!;
eq('Giant Fly estimatedCR = 0', flyEntry.estimatedCR, 0);
eq('Giant Fly defaultProfile = defend', flyEntry.defaultProfile, 'defend');
eq('Giant Fly obeysVerbalCommands = true', flyEntry.obeysVerbalCommands, true);
eq('Giant Fly commandedProfile = attackNearest', flyEntry.commandedProfile, 'attackNearest');
eq('Giant Fly source = magic_item', flyEntry.source, 'magic_item');

const avatarEntry = getSummonEntry('Avatar of Death')!;
eq('Avatar defaultProfile = smart', avatarEntry.defaultProfile, 'smart');
eq('Avatar source = other', avatarEntry.source, 'other');

// listSummons
const names = listSummons();
assert('listSummons contains Giant Fly', names.includes('Giant Fly'));
assert('listSummons contains Avatar of Death', names.includes('Avatar of Death'));

// getSummonsBySource
const magicItems = getSummonsBySource('magic_item');
assert('At least 1 magic_item summon', magicItems.length >= 1);
assert('Giant Fly in magic_item list', magicItems.some(e => e.name === 'Giant Fly'));

// ============================================================
// 2. HP resolution
// ============================================================
console.log('\n=== 2. HP Resolution ===\n');

// Fixed HP (Giant Fly)
const flyHP = resolveSummonHP(flyEntry, 50, 1);
eq('Giant Fly: fixed HP = 19', flyHP, 19);
// Fixed HP ignores summoner HP and level
const flyHP2 = resolveSummonHP(flyEntry, 100, 5);
eq('Giant Fly: fixed HP unchanged at higher levels', flyHP2, 19);

// Fraction HP (Avatar of Death)
const avatarHP30 = resolveSummonHP(avatarEntry, 30, 1);
eq('Avatar of Death: HP = floor(30 * 0.5) = 15', avatarHP30, 15);
const avatarHP17 = resolveSummonHP(avatarEntry, 17, 1);
eq('Avatar of Death: HP = floor(17 * 0.5) = 8', avatarHP17, 8);

// byLevel table (hypothetical — test the logic with a mock entry)
const mockEntry = {
  ...flyEntry,
  hp: { type: 'byLevel' as const, table: { 1: 10, 3: 20, 5: 30 } },
};
eq('byLevel: level 1 → 10', resolveSummonHP(mockEntry, 50, 1), 10);
eq('byLevel: level 2 → 10 (use ≤2 entry)', resolveSummonHP(mockEntry, 50, 2), 10);
eq('byLevel: level 3 → 20', resolveSummonHP(mockEntry, 50, 3), 20);
eq('byLevel: level 9 → 30 (highest table)', resolveSummonHP(mockEntry, 50, 9), 30);

// ============================================================
// 3. spawnSummon — Giant Fly
// ============================================================
console.log('\n=== 3. spawnSummon — Giant Fly ===\n');

const fly = spawnSummon(fullBestiaryMap, 'Giant Fly', { pos: { x: 0, y: 0, z: 0 } });
assert('Giant Fly spawned', fly !== null);
if (fly) {
  eq('HP = 19 (fixed)', fly.maxHP, 19);
  eq('currentHP = 19', fly.currentHP, 19);
  eq('Profile = defend', fly.aiProfile, 'defend');
  eq('Faction = enemy (default)', fly.faction, 'enemy');
  eq('AC = 11', fly.ac, 11);
  eq('Fly speed = 60', fly.flySpeed, 60);
  eq('Ground speed = 30', fly.speed, 30);
  assert('Tagged as summon', fly.isSummon === true);
  assert('summonerId undefined when not provided', fly.summonerId === undefined);
  assert('summonSpellName undefined when not provided', fly.summonSpellName === undefined);
}

// Party faction + profile override
const flyAlly = spawnSummon(fullBestiaryMap, 'Giant Fly', {
  pos: { x: 2, y: 0, z: 0 },
  faction: 'party',
  profileOverride: 'attackNearest',
});
assert('Faction override works', flyAlly?.faction === 'party');
assert('Profile override works', flyAlly?.aiProfile === 'attackNearest');

// ============================================================
// 4. spawnSummon — Avatar of Death (HP fraction)
// ============================================================
console.log('\n=== 4. spawnSummon — Avatar of Death ===\n');

const avatar = spawnSummon(fullBestiaryMap, 'Avatar of Death', {
  summonerMaxHP: 40,
  pos: { x: 5, y: 5, z: 0 },
  faction: 'enemy',
});
assert('Avatar spawned', avatar !== null);
if (avatar) {
  eq('Avatar HP = floor(40 * 0.5) = 20', avatar.maxHP, 20);
  eq('Avatar AC = 20', avatar.ac, 20);
  eq('Avatar profile = smart', avatar.aiProfile, 'smart');
  eq('Avatar fly speed = 60', avatar.flySpeed, 60);
}

// Different summoner HP
const avatar2 = spawnSummon(fullBestiaryMap, 'Avatar of Death', {
  summonerMaxHP: 14,
  pos: { x: 5, y: 5, z: 0 },
});
eq('Avatar HP scales: floor(14 * 0.5) = 7', avatar2?.maxHP, 7);

// ============================================================
// 5. Unknown name / missing from bestiary
// ============================================================
console.log('\n=== 5. Error handling ===\n');

const missing1 = spawnSummon(fullBestiaryMap, 'Unicorn', {});
assert('Unregistered name returns null', missing1 === null);

// Registered but not in provided bestiary map (empty map)
const emptyMap = new Map<string, any>();
const missing2 = spawnSummon(emptyMap, 'Giant Fly', {});
assert('Not in bestiary map returns null', missing2 === null);

// ============================================================
// 6. Verbal command via issueVerbalCommand
// ============================================================
console.log('\n=== 6. Verbal Command ===\n');

{
  const defender = spawnSummon(fullBestiaryMap, 'Giant Fly', {
    pos: { x: 0, y: 0, z: 0 },
    faction: 'enemy',
  })!;

  const fighter = spawnPC(pcMap, 'Fighter', { x: 0, y: 8, z: 0 })!;
  fighter.faction = 'party';

  const bf = makeFlatBattlefield(15, 15, [defender, fighter]);

  // Issue command before combat starts
  issueVerbalCommand(bf, defender.id, 'attackNearest');
  assert('pendingCommands set', bf.pendingCommands?.has(defender.id) === true);
  eq('Command value = attackNearest', bf.pendingCommands!.get(defender.id), 'attackNearest');

  // Run 3 rounds — command should activate on round 1 turn start
  const log = runCombat(bf, [defender.id, fighter.id], { maxRounds: 3 });

  // Profile should have been overridden
  eq('Profile changed to attackNearest', defender.aiProfile, 'attackNearest');
  assert('pendingCommands cleared', !bf.pendingCommands?.has(defender.id));

  // Defender should have moved (attackNearest pursues)
  const moves = log.events.filter(e => e.type === 'move' && e.actorId === defender.id);
  assert('Defender moved after command', moves.length > 0,
    `move events: ${moves.length}`);
}

// ============================================================
// 7. Defend profile: stand still without command
// ============================================================
console.log('\n=== 7. Defend profile: no pursuit ===\n');

{
  const flyPassive = spawnSummon(fullBestiaryMap, 'Giant Fly', {
    pos: { x: 0, y: 0, z: 0 },
    faction: 'enemy',
  })!; // defend profile, no command

  const ranger = spawnPC(pcMap, 'Ranger', { x: 6, y: 0, z: 0 })!;
  ranger.faction = 'party';

  const bf2 = makeFlatBattlefield(15, 10, [flyPassive, ranger]);
  const log2 = runCombat(bf2, [flyPassive.id, ranger.id], { maxRounds: 4 });

  // Fly has defend profile and no command → should NOT move toward distant enemy
  const flyMoves = log2.events.filter(
    e => e.type === 'move' && e.actorId === flyPassive.id
  );
  assert('Defend-profile fly: no movement toward distant enemy',
    flyMoves.length === 0, `fly moves: ${flyMoves.length}`);

  // Ranger still attacks (from range)
  const rangerAttacks = log2.events.filter(
    e => (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit')
      && e.actorId === ranger.id
  );
  assert('Ranger attacks despite fly being passive', rangerAttacks.length > 0);
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
