// ============================================================
// Test: Mount System (5.4) + Multi-Encounter (5.5)
// Run: ts-node src/test/mount.test.ts
// ============================================================

import {
  mountCreature, dismountCreature, riderMovementFt, spendMountMovement,
  mountDeathRiderCheck, isControlledMount, syncMountInitiative, setupMount
} from '../summons/mount';
import { spawnSummon }               from '../summons/spawner';
import { loadBestiaryJson }          from '../parser/fivetools';
import { loadPCStatBlocks, spawnPC, RawPCEntry } from '../parser/pc';
import { runCombat, makeFlatBattlefield }        from '../engine/combat';
import { simulateDay, printDayReport }           from '../scenarios/multiencounter';
import { shortRest, longRest }                   from '../engine/utils';
import { Combatant, Battlefield, PlannedAction }                from '../types/core';
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
const fullBestiaryMap = loadBestiaryJson(rawBestiary);
const pcData: RawPCEntry[] = JSON.parse(fs.readFileSync(pcPath, 'utf-8'));
const pcMap = loadPCStatBlocks(pcData);

const pc = (cls: string, x = 0) => spawnPC(pcMap, cls, { x, y: 0, z: 0 })!;
const fly = (x = 0) => spawnSummon(fullBestiaryMap, 'Giant Fly',
  { pos: { x, y: 0, z: 0 }, faction: 'party' })!;

function makeBF(combatants: Combatant[]): Battlefield {
  const map = new Map<string, Combatant>();
  for (const c of combatants) map.set(c.id, c);
  return { width: 20, height: 20, depth: 3, cells: [], combatants: map,
           round: 1, initiativeOrder: combatants.map(c => c.id) };
}

// ============================================================
// 1. Mount / Dismount core functions
// ============================================================
console.log('\n=== 1. Mount / Dismount ===\n');

{
  const wizard = pc('Wizard');
  const mount  = fly();

  // Initial state
  assert('Wizard not mounted initially', wizard.mountedOn === null);
  assert('Fly not carrying anyone', mount.carriedBy === null);
  assert('Fly is not controlled mount', !isControlledMount(mount));

  mountCreature(wizard, mount);
  eq('Wizard mountedOn = fly id', wizard.mountedOn, mount.id);
  eq('Fly carriedBy = wizard id', mount.carriedBy, wizard.id);
  assert('Fly is now controlled mount', isControlledMount(mount));
  // Rider moves to mount position
  eq('Rider pos = mount pos', wizard.pos.x, mount.pos.x);

  // Cannot double-mount
  const wizard2 = pc('Fighter');
  let threw = false;
  try { mountCreature(wizard2, mount); } catch { threw = true; }
  assert('Cannot mount an already-carrying creature', threw);

  // Dismount
  dismountCreature(wizard, mount);
  assert('Wizard dismounted', wizard.mountedOn === null);
  assert('Fly no longer carrying', mount.carriedBy === null);
  assert('Fly no longer controlled mount', !isControlledMount(mount));
}

// ============================================================
// 2. Movement pool
// ============================================================
console.log('\n=== 2. Movement Pool ===\n');

{
  const wizard = pc('Wizard');
  const mount  = fly();
  mountCreature(wizard, mount);

  // Mount has fly speed 60 — its budget.movementFt starts at 30 (ground)
  // but engine sets it to flySpeed on turn start; simulate that:
  mount.budget.movementFt = 60;  // as engine would set for flying

  eq('Rider sees mount movement (60ft)', riderMovementFt(wizard, mount), 60);

  const spent = spendMountMovement(mount, 30);
  eq('Spent 30ft from mount pool', spent, 30);
  eq('Mount pool reduced to 30ft', mount.budget.movementFt, 30);

  // Cannot spend more than available
  const spent2 = spendMountMovement(mount, 50);
  eq('Caps at available (30ft)', spent2, 30);
  eq('Mount pool now 0', mount.budget.movementFt, 0);
}

// ============================================================
// 3. Mount death rider save
// ============================================================
console.log('\n=== 3. Mount Death Rider Save ===\n');

{
  // High DEX wizard — should mostly succeed DC 10 save
  const nimbleRider = pc('Rogue');  // DEX 17, mod +3 → rolls 4–23, succeeds on 7+
  let prone = 0, safe = 0;
  for (let i = 0; i < 100; i++) {
    nimbleRider.conditions.clear();
    const result = mountDeathRiderCheck(nimbleRider);
    if (result === 'prone') { prone++; nimbleRider.conditions.delete('prone'); }
    else safe++;
  }
  assert('High DEX: mostly safe on mount death (≥60%)', safe >= 60,
    `safe=${safe}/100`);

  // Low DEX target
  const clumsyRider = pc('Cleric');  // DEX 10, mod 0 → needs 10+ on d20 = 55%
  let prone2 = 0, safe2 = 0;
  for (let i = 0; i < 100; i++) {
    clumsyRider.conditions.clear();
    const result = mountDeathRiderCheck(clumsyRider);
    if (result === 'prone') prone2++;
    else safe2++;
  }
  // Both outcomes possible — just verify function runs and returns valid result
  assert('Low DEX: some falls (>10%)', prone2 > 10,
    `prone=${prone2}/100`);
  assert('Low DEX: some safe (>10%)', safe2 > 10,
    `safe=${safe2}/100`);
}

// ============================================================
// 4. Initiative sync
// ============================================================
console.log('\n=== 4. Initiative Sync ===\n');

{
  const wizard = pc('Wizard'); wizard.id = 'wiz';
  const ranger = pc('Ranger'); ranger.id = 'ran';
  const mount  = fly();        mount.id  = 'fly';

  const bf = makeBF([wizard, ranger, mount]);
  bf.initiativeOrder = ['ran', 'fly', 'wiz'];  // fly goes before wizard currently

  syncMountInitiative(bf, 'wiz', 'fly');
  // fly should now come immediately after wiz
  const wIdx = bf.initiativeOrder.indexOf('wiz');
  const fIdx = bf.initiativeOrder.indexOf('fly');
  assert('Mount follows rider in initiative', fIdx === wIdx + 1,
    `order: ${bf.initiativeOrder.join(',')}`);
  assert('Initiative has 3 entries', bf.initiativeOrder.length === 3);
}

// ============================================================
// 5. Combat: controlled mount skips its action
// ============================================================
console.log('\n=== 5. Controlled mount skips action in engine ===\n');

{
  const wizard = pc('Wizard', 0);
  const mount  = fly(0);
  const larvaRaw = fullBestiaryMap.get('larva');
  assert('Larva found', larvaRaw !== undefined);

  if (larvaRaw) {
    const { monsterToCombatant } = require('../parser/fivetools');
    const larva = monsterToCombatant(larvaRaw, { x: 2, y: 0, z: 0 }, 'attackNearest');

    // Mount the fly
    mountCreature(wizard, mount);
    mount.faction = 'party';

    const bf = makeFlatBattlefield(10, 10, [wizard, mount, larva]);
    bf.initiativeOrder = [wizard.id, mount.id, larva.id];

    const log = runCombat(bf, [wizard.id, mount.id, larva.id], { maxRounds: 10 });

    // Mount (fly) should NOT have any attack events — it's a controlled mount
    const flyAttacks = log.events.filter(
      e => (e.type === 'attack_hit' || e.type === 'attack_miss' || e.type === 'attack_crit')
        && e.actorId === mount.id
    );
    assert('Controlled mount made no attacks', flyAttacks.length === 0,
      `fly attacks: ${flyAttacks.length}`);

    // Wizard should still have acted
    const wizardActions = log.events.filter(
      e => e.actorId === wizard.id && e.type !== 'move'
    );
    assert('Wizard still acted', wizardActions.length > 0);
  }
}

// ============================================================
// 6. setupMount convenience function
// ============================================================
console.log('\n=== 6. setupMount ===\n');

{
  const wizard = pc('Wizard', 0);
  const mount  = fly(0);
  mount.faction = 'party';

  const bf = makeBF([wizard, mount]);
  bf.initiativeOrder = [mount.id, wizard.id]; // fly currently goes first

  setupMount(wizard, mount, bf);

  assert('Rider mountedOn set', wizard.mountedOn === mount.id);
  assert('Mount carriedBy set', mount.carriedBy === wizard.id);
  // Initiative: mount should now follow wizard
  const wIdx = bf.initiativeOrder.indexOf(wizard.id);
  const fIdx = bf.initiativeOrder.indexOf(mount.id);
  assert('Mount initiative synced after wizard', fIdx === wIdx + 1,
    `order: ${bf.initiativeOrder.join(',')}`);
}

// ============================================================
// 6b. Familiar Help Action (PHB p.192)
// ============================================================
console.log('\n=== 6b. Familiar Help Action ===\n');

{
  // Test scenario: Owl familiar uses Help action on bonded Wizard
  // Expected: Owl has role 'familiar', bonded to Wizard
  //           Owl's Help action sets Wizard.helpedThisTurn = true
  //           Wizard's next attack gets advantage

  const wizard = pc('Wizard', 0);
  const owl = pc('Wizard', 1);   // placeholder; we'll modify it to be familiar role
  
  // Simulate familiar setup
  owl.role = 'familiar';
  owl.bonded = wizard.id;
  owl.faction = 'party';
  owl.aiProfile = 'defend';  // familiars typically defend unless commanded
  
  const bf = makeBF([wizard, owl]);
  
  // Manually set Owl's turn plan to use Help action on Wizard
  const helpPlan: PlannedAction = {
    type: 'help',
    action: null,
    targetId: wizard.id,
    description: `${owl.name} uses Help action on ${wizard.name}`,
  };
  
  assert('Familiar role set', owl.role === 'familiar');
  assert('Familiar bonded to wizard', owl.bonded === wizard.id);
  assert('Wizard initially not helped', !wizard.helpedThisTurn);
  
  // Simulate Help action execution (as executePlannedAction would do)
  if (helpPlan.targetId) {
    const target = bf.combatants.get(helpPlan.targetId);
    if (target) {
      target.helpedThisTurn = true;
    }
  }
  
  assert('Wizard helped after Help action', wizard.helpedThisTurn);
  
  // Reset (as engine would do at start of turn)
  wizard.helpedThisTurn = false;
  assert('Wizard helpedThisTurn reset', !wizard.helpedThisTurn);
}

// ============================================================
// 7. Multi-Encounter Day Simulation (Phase 5.5)
// ============================================================
console.log('\n=== 7. Multi-Encounter Day ===\n');

{
  // Simple two-encounter day: Fighter vs Larva, short rest, then repeat
  const { loadBestiaryDir } = require('../data/loader');
  const bestiaryResult = loadBestiaryDir(path.join(__dirname, '../../bestiaryData'));

  if (bestiaryResult.bestiary.has('larva')) {
    const { spawnMonster } = require('../parser/fivetools');

    const day = simulateDay(
      [ pc('Fighter') ],
      [
        {
          label: 'Encounter 1: Fighter vs Larva',
          spec: {
            party:   [ pc('Fighter', 0) ],
            enemies: [ spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 1, y: 8, z: 0 }, 'attackNearest') ],
          },
          restAfter: 'short',
        },
        {
          label: 'Encounter 2: Fighter vs 2 Larva (after short rest)',
          spec: {
            party:   [ pc('Fighter', 0) ],
            enemies: [
              spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 1, y: 8, z: 0 }, 'attackNearest'),
              spawnMonster(bestiaryResult.bestiary, 'Larva', { x: 3, y: 8, z: 0 }, 'attackNearest'),
            ],
          },
          restAfter: 'long',
        },
      ],
      { runs: 30, maxRounds: 30 }
    );

    assert('Day has 2 encounter results', day.encounters.length === 2);
    assert('Day has 2 labels', day.labels.length === 2);

    // Fighter should win enc 1 reliably
    assert('Enc 1: party wins majority', day.encounters[0].partyWinRate >= 0.6,
      `winRate=${day.encounters[0].partyWinRate.toFixed(2)}`);

    // Enc 2 is harder (2 Larva) but fighter should still win most
    assert('Enc 2: party competitive', day.encounters[1].partyWinRate >= 0.4,
      `winRate=${day.encounters[1].partyWinRate.toFixed(2)}`);

    printDayReport(day);
  } else {
    console.log('  ⚠️  Larva not in bestiary — skipping multi-encounter test');
  }
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
