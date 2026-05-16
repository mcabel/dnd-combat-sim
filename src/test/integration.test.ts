// ============================================================
// Integration Test: PC Party vs Bestiary Monsters
// The first real end-to-end scenario using all layers together.
// Run: ts-node src/test/integration.test.ts
// ============================================================

import { runCombat, makeFlatBattlefield, CombatLog } from '../engine/combat';
import { loadBestiaryDir, printLoadSummary }         from '../data/loader';
import { spawnMonster }                               from '../parser/fivetools';
import { spawnPC, loadPCStatBlocks, RawPCEntry }      from '../parser/pc';
import { rollInitiative }                             from '../engine/utils';
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

// ---- Locate data files --------------------------------------

const bestiaryDir = path.join(__dirname, '../../bestiaryData');
const pcPath = [
  path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
  '/mnt/project/pc_stat_blocks_lv1.json',
].find(p => fs.existsSync(p));

if (!fs.existsSync(bestiaryDir)) {
  console.error('ERROR: bestiaryData/ directory not found');
  process.exit(1);
}
if (!pcPath) {
  console.error('ERROR: pc_stat_blocks_lv1.json not found');
  process.exit(1);
}

const bestiaryResult = loadBestiaryDir(bestiaryDir);
const pcData: RawPCEntry[] = JSON.parse(fs.readFileSync(pcPath, 'utf-8'));
const pcMap = loadPCStatBlocks(pcData);

console.log('\n=== Setup ===\n');
printLoadSummary(bestiaryResult);
assert('Bestiary loaded at least 1 monster', bestiaryResult.monsterCount >= 1);
assert('PC map has 12 classes', pcMap.size === 12);

// ---- Helper: log summary ------------------------------------

function summarise(log: CombatLog, label: string): void {
  const hits   = log.events.filter(e => e.type === 'attack_hit' || e.type === 'attack_crit').length;
  const misses = log.events.filter(e => e.type === 'attack_miss').length;
  const dmgEvt = log.events.filter(e => e.type === 'damage');
  const total  = dmgEvt.reduce((s, e) => s + (e.value ?? 0), 0);
  console.log(`  ${label}: winner=${log.winner} rounds=${log.rounds} hits=${hits} misses=${misses} totalDmg=${total}`);
}

// ============================================================
// 1. Fighter vs Larva  (1v1, melee, party expected to win)
// ============================================================
console.log('\n=== 1. Fighter vs Larva (1v1) ===\n');

{
  const larvaRaw = bestiaryResult.bestiary.get('larva');
  assert('Larva found in bestiary', larvaRaw !== undefined);

  if (larvaRaw) {
    const wins: Record<string, number> = { party: 0, enemy: 0, draw: 0 };

    // Run 10 times — fighter (AC 16, 13 HP, +5/2d6+3) vs Larva (AC 9, 9 HP, +1/1d4-1)
    // Fighter should win the vast majority; Larva Bite avg 1 dmg means many rounds
    for (let i = 0; i < 10; i++) {
      // Use 'attackNearest' so fighter never enters self-preserve/retreat mode
      const fighter = spawnPC(pcMap, 'Fighter', { x: 0, y: 0, z: 0 }, 'attackNearest')!;
      // Larva is a simple fiend — attackNearest, no self-preserve fleeing
      const larva   = spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 1, y: 0, z: 0 }, 'attackNearest');
      if (!larva) break;

      const bf  = makeFlatBattlefield(10, 10, [fighter, larva]);
      const log = runCombat(bf, rollInitiative(bf), { maxRounds: 30 });
      wins[log.winner ?? 'draw']++;
    }

    console.log(`  Fighter vs Larva (10 runs): party=${wins.party} enemy=${wins.enemy} draw=${wins.draw}`);
    assert('Fighter wins majority vs Larva (≥7/10)', wins.party >= 7,
      `only ${wins.party}/10 party wins`);
    assert('No draws — both use attackNearest, fight always resolves', wins.draw === 0,
      `${wins.draw}/10 draws — unexpected with bounds-clamped battlefield`);
  }
}

// ============================================================
// 2. Party of 4 vs 3 Larva  (multi-combatant)
// ============================================================
console.log('\n=== 2. Party of 4 vs 3 Larva ===\n');

{
  const larvaRaw = bestiaryResult.bestiary.get('larva');
  if (larvaRaw) {
    const wins: Record<string, number> = { party: 0, enemy: 0, draw: 0 };

    for (let i = 0; i < 5; i++) {
      const fighter  = spawnPC(pcMap, 'Fighter',  { x: 0, y: 0, z: 0 })!;
      const barbarian= spawnPC(pcMap, 'Barbarian',{ x: 1, y: 0, z: 0 })!;
      const cleric   = spawnPC(pcMap, 'Cleric',   { x: 2, y: 0, z: 0 })!;
      const rogue    = spawnPC(pcMap, 'Rogue',    { x: 3, y: 0, z: 0 })!;

      const l1 = spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 5, y: 0, z: 0 }, 'attackNearest')!;
      const l2 = spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 6, y: 0, z: 0 }, 'attackNearest')!;
      const l3 = spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 7, y: 0, z: 0 }, 'attackNearest')!;

      const bf  = makeFlatBattlefield(15, 10, [fighter, barbarian, cleric, rogue, l1, l2, l3]);
      const log = runCombat(bf, rollInitiative(bf), { maxRounds: 30 });
      wins[log.winner ?? 'draw']++;
    }

    console.log(`  4 PCs vs 3 Larva (5 runs): party=${wins.party} enemy=${wins.enemy} draw=${wins.draw}`);
    assert('Party wins majority (≥3/5)', wins.party >= 3);
  } else {
    console.log('  ⚠️  Larva not in bestiary — skipping');
  }
}

// ============================================================
// 3. Ranged PC vs distant enemy  (positioning check)
// ============================================================
console.log('\n=== 3. Ranger vs Larva (ranged positioning) ===\n');

{
  const larvaRaw = bestiaryResult.bestiary.get('larva');
  if (larvaRaw) {
    let moveEvents = 0, rangedAttacks = 0;

    for (let i = 0; i < 5; i++) {
      // Place them 8 squares apart (40ft) — within longbow range (150/600ft)
      const ranger = spawnPC(pcMap, 'Ranger', { x: 0, y: 0, z: 0 })!;
      const larva  = spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 8, y: 0, z: 0 }, 'attackNearest')!;

      const bf  = makeFlatBattlefield(20, 10, [ranger, larva]);
      const log = runCombat(bf, rollInitiative(bf), { maxRounds: 30 });

      moveEvents    += log.events.filter(e => e.type === 'move').length;
      rangedAttacks += log.events.filter(e =>
        (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit') &&
        e.actorId === ranger.id
      ).length;
    }

    console.log(`  Ranger vs Larva (5 runs): moves=${moveEvents} rangedAttacks=${rangedAttacks}`);
    // Ranger should use ranged attacks rather than running in to melee
    assert('Ranger made ranged attacks', rangedAttacks > 0);
  } else {
    console.log('  ⚠️  Larva not in bestiary — skipping');
  }
}

// ============================================================
// 4. Event log integrity across a real fight
// ============================================================
console.log('\n=== 4. Event log integrity ===\n');

{
  const larvaRaw = bestiaryResult.bestiary.get('larva');
  if (larvaRaw) {
    // Force Fighter first, high hit bonus vs low AC — near-certain kill round 1
    const fighter = spawnPC(pcMap, 'Fighter', { x: 0, y: 0, z: 0 }, 'attackNearest')!;
    const larva   = spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 1, y: 0, z: 0 }, 'attackNearest')!;
    // Override Greatsword hit bonus to +10 for determinism (still uses 2d6+3 damage)
    const gs = fighter.actions.find(a => a.name === 'Greatsword');
    if (gs) gs.hitBonus = 10;
    const bf  = makeFlatBattlefield(10, 10, [fighter, larva]);
    // Fighter goes first — guaranteed
    const log = runCombat(bf, [fighter.id, larva.id], { maxRounds: 30 });

    summarise(log, 'Fighter vs Larva (deterministic)');

    // Structural integrity
    assert('Has combat_start', log.events.some(e => e.type === 'combat_start'));
    assert('Has combat_end',   log.events.some(e => e.type === 'combat_end'));
    assert('All events round >= 1', log.events.every(e => e.round >= 1));
    assert('All events have actorId', log.events.every(e => e.actorId.length > 0));
    assert('Winner is set', log.winner !== null);
    assert('Rounds > 0', log.rounds > 0);

    // Fighter goes first with +10 hit vs AC 9 — only nat-1 misses (5%)
    // 2d6+3 min=5, Larva HP=9: one hit always kills
    eq('Party wins (deterministic)', log.winner, 'party');
    // nat-1 is always a miss; two consecutive nat-1s (0.25%) = 3 rounds
    assert('Finishes quickly (≤3 rounds)', log.rounds <= 3, `took ${log.rounds} rounds`);

    // Damage events have positive values
    const dmgEvents = log.events.filter(e => e.type === 'damage');
    assert('Damage events exist', dmgEvents.length > 0);
    // damage events with value=0 only happen if overkill against already-dead target (race)
    assert('Damage events have value >= 0', dmgEvents.every(e => (e.value ?? 0) >= 0));

    // Death event for Larva (monster, not PC)
    const deathEvents = log.events.filter(e => e.type === 'death');
    assert('Larva death event logged', deathEvents.length > 0);
    assert('Death event has targetId', deathEvents.some(e => e.actorId === larva.id));

    // combat_end is last event
    const endIdx = log.events.findIndex(e => e.type === 'combat_end');
    assert('combat_end is last event', endIdx === log.events.length - 1);
  }
}

// ============================================================
// 5. Defend-profile creature (Giant Fly stand-in)
// ============================================================
console.log('\n=== 5. Defend-profile creature behaviour ===\n');

{
  // Simulate a defend-profile creature: only attacks if adjacent
  // Using Larva data but overriding its aiProfile
  const larvaRaw = bestiaryResult.bestiary.get('larva');
  if (larvaRaw) {
    const defender = spawnMonster(
      bestiaryResult.bestiary, 'Larva', { x: 0, y: 0, z: 0 }, 'defend'
    )!;  // defend: only attacks if adjacent, never pursues
    // Place enemy FAR away (6 squares = 30ft) — defend creature should not pursue
    // Ranger is 'party' (default), Larva is 'enemy' (default) — no faction override needed
    const aggressor = spawnPC(pcMap, 'Ranger', { x: 6, y: 0, z: 0 })!;

    const bf  = makeFlatBattlefield(15, 10, [defender, aggressor]);
    const log = runCombat(bf, [defender.id, aggressor.id], { maxRounds: 5 });

    // Defender should not move (no pursuit)
    const defenderMoves = log.events.filter(
      e => e.type === 'move' && e.actorId === defender.id
    );
    assert('Defend-profile: no movement toward distant enemy', defenderMoves.length === 0,
      `made ${defenderMoves.length} moves`);

    // Aggressor (Ranger) should still act
    const aggressorActions = log.events.filter(
      e => (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit')
        && e.actorId === aggressor.id
    );
    assert('Aggressor still attacks', aggressorActions.length > 0);
  }
}

// ============================================================
// 6. Summon-type filter: Giant Fly not in loaded bestiary
// ============================================================
console.log('\n=== 6. Summon-type filtering ===\n');

{
  assert('Giant Fly excluded from bestiary',
    !bestiaryResult.bestiary.has('giant fly'));
  assert('Avatar of Death excluded from bestiary',
    !bestiaryResult.bestiary.has('avatar of death'));
  assert('Larva included (CR 0 is valid)',
    bestiaryResult.bestiary.has('larva'));

  // Summon-type list is reported
  assert('summonTypeSkipped is populated',
    bestiaryResult.summonTypeSkipped.length > 0);
  console.log(`  Skipped: ${bestiaryResult.summonTypeSkipped.join(', ')}`);
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
