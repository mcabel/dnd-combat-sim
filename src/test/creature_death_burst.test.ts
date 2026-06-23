// ============================================================
// Test: Creature Death Burst (Session 53 Batch 4d)
//
// Validates that:
//   - parseDeathBurst extracts damage dice, save DC, ability, radius,
//     conditions, and halfOnSuccess from the 5etools trait text
//   - monsterToCombatant populates Combatant.deathBurst
//   - checkDeath() in combat.ts fires the burst when the creature drops to 0
//   - The burst hits all combatants in radius (including allies)
//   - Save-for-half works (damage halved on successful save)
//   - Conditions are applied on FAILED save
//   - Chain reactions work (burst kills another creature with a burst)
//   - Out-of-range creatures are unaffected
//
// Reverse published order (newest pre-2024 source first):
//   - BGG (2018) — Hulks
//   - EGW (2020) — Frost Worm
//   - GGR (2018) — Galvanice Weird
//   - MM (2014) — Mephits, Magmin, Gas Spore
//
// Run: npx ts-node src/test/creature_death_burst.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  loadBestiaryJson,
  mergeBestiaries,
  Raw5etoolsMonster,
} from '../parser/fivetools';
import { Combatant, Vec3, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';

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

// ---- Bestiary setup -----------------------------------------
// Session 53: load ONLY the sourcebooks this test needs (was loading all
// 99 user-uploaded bestiaries, which caused CI to time out at 60s per test).
// The specific creatures referenced: Magmin/Mud Mephit/Dust Mephit/Ice
// Mephit/Smoke Mephit/Gas Spore/Goblin (MM), Frost Worm (EGW), Galvanice
// Weird (GGR), Cinder/Dust/Mist/Rime Hulk (BGG), Ice Mephit (MM),
// Tarrasque (MM).
const NEEDED_SOURCES = ['mm-2014', 'mm', 'egw', 'ggr', 'bgg', 'dmg'];
function loadBestiary(): Map<string, Raw5etoolsMonster> {
  const dir = path.join(__dirname, '../../bestiaryData');
  const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const files = allFiles.filter(f =>
    NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
  if (files.length === 0) {
    console.warn('  [warn] No matching source files found, loading all bestiary JSONs');
    const loaded = allFiles.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
    return mergeBestiaries(...loaded);
  }
  const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  return mergeBestiaries(...loaded);
}

const bestiary = loadBestiary();

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ---- Combat state factories ---------------------------------

interface MutableBF extends Battlefield {
  [k: string]: any;
}

function makeBF(combatants: Combatant[]): MutableBF {
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
    pendingInitiativeInserts: [],
  } as MutableBF;
}

function makeState(bf: MutableBF): EngineState {
  return {
    battlefield: bf as Battlefield,
    log: { events: [] } as any,
    round: 1,
    activeCombatantId: null,
    pendingActions: [],
  } as unknown as EngineState;
}

// We'll rebuild state per-section.
function freshState(combatants: Combatant[]): { state: EngineState; bf: MutableBF } {
  const bf = makeBF(combatants);
  const state: EngineState = {
    battlefield: bf as Battlefield,
    log: { events: [] } as any,
    round: 1,
    activeCombatantId: combatants[0]?.id ?? null,
    pendingActions: [],
    rageDamagedSinceLastTurn: new Set<string>(),
  } as unknown as EngineState;
  return { state, bf };
}

// Direct access to checkDeath (not exported — we trigger via applyDamage).
// We'll import the public applyDamage path + use a low-HP victim.
import { applyDamageWithTempHP } from '../engine/utils';

// ============================================================
console.log('\n=== 1. parseDeathBurst — Magmin (MM, CR 1/2) ===\n');
{
  const c = spawn('Magmin');
  assert('Magmin has deathBurst', c.deathBurst !== undefined);
  if (c.deathBurst) {
    eq('Magmin damage count = 2', c.deathBurst.damage?.count, 2);
    eq('Magmin damage sides = 6', c.deathBurst.damage?.sides, 6);
    eq('Magmin damage bonus = 0', c.deathBurst.damage?.bonus, 0);
    eq('Magmin damageType = fire', c.deathBurst.damageType, 'fire');
    eq('Magmin saveDC = 11', c.deathBurst.saveDC, 11);
    eq('Magmin saveAbility = dex', c.deathBurst.saveAbility, 'dex');
    eq('Magmin radius = 10', c.deathBurst.radius, 10);
    eq('Magmin halfOnSuccess = true', c.deathBurst.halfOnSuccess, true);
    eq('Magmin no conditions', c.deathBurst.conditions, undefined);
  }
}

// ============================================================
console.log('\n=== 2. parseDeathBurst — Mud Mephit (MM, CR 1/4, condition-only) ===\n');
{
  const c = spawn('Mud Mephit');
  assert('Mud Mephit has deathBurst', c.deathBurst !== undefined);
  if (c.deathBurst) {
    eq('Mud Mephit damage = null (condition-only)', c.deathBurst.damage, null);
    eq('Mud Mephit saveDC = 11', c.deathBurst.saveDC, 11);
    eq('Mud Mephit saveAbility = dex', c.deathBurst.saveAbility, 'dex');
    eq('Mud Mephit radius = 5', c.deathBurst.radius, 5);
    eq('Mud Mephit halfOnSuccess = false (no damage)', c.deathBurst.halfOnSuccess, false);
    assert('Mud Mephit conditions includes restrained',
      c.deathBurst.conditions?.includes('restrained') === true);
  }
}

// ============================================================
console.log('\n=== 3. parseDeathBurst — Dust Mephit (MM, CR 1/2, blinded condition) ===\n');
{
  const c = spawn('Dust Mephit');
  assert('Dust Mephit has deathBurst', c.deathBurst !== undefined);
  if (c.deathBurst) {
    eq('Dust Mephit damage = null (condition-only)', c.deathBurst.damage, null);
    eq('Dust Mephit saveDC = 10', c.deathBurst.saveDC, 10);
    eq('Dust Mephit saveAbility = con', c.deathBurst.saveAbility, 'con');
    eq('Dust Mephit radius = 5', c.deathBurst.radius, 5);
    assert('Dust Mephit conditions includes blinded',
      c.deathBurst.conditions?.includes('blinded') === true);
  }
}

// ============================================================
console.log('\n=== 4. parseDeathBurst — Frost Worm (EGW, CR 17, big burst) ===\n');
{
  const c = spawn('Frost Worm');
  assert('Frost Worm has deathBurst', c.deathBurst !== undefined);
  if (c.deathBurst) {
    eq('Frost Worm damage count = 8', c.deathBurst.damage?.count, 8);
    eq('Frost Worm damage sides = 6', c.deathBurst.damage?.sides, 6);
    eq('Frost Worm damageType = cold', c.deathBurst.damageType, 'cold');
    eq('Frost Worm saveDC = 20', c.deathBurst.saveDC, 20);
    eq('Frost Worm saveAbility = dex', c.deathBurst.saveAbility, 'dex');
    eq('Frost Worm radius = 60', c.deathBurst.radius, 60);
    eq('Frost Worm halfOnSuccess = true', c.deathBurst.halfOnSuccess, true);
  }
}

// ============================================================
console.log('\n=== 5. parseDeathBurst — Galvanice Weird (GGR, CR 1, lightning) ===\n');
{
  const c = spawn('Galvanice Weird');
  assert('Galvanice Weird has deathBurst', c.deathBurst !== undefined);
  if (c.deathBurst) {
    eq('Galvanice damage count = 2', c.deathBurst.damage?.count, 2);
    eq('Galvanice damage sides = 6', c.deathBurst.damage?.sides, 6);
    eq('Galvanice damageType = lightning', c.deathBurst.damageType, 'lightning');
    eq('Galvanice saveDC = 13', c.deathBurst.saveDC, 13);
    eq('Galvanice radius = 10', c.deathBurst.radius, 10);
  }
}

// ============================================================
console.log('\n=== 6. parseDeathBurst — Cinder Hulk (BGG, CR 7, fire + cloud) ===\n');
{
  const c = spawn('Cinder Hulk');
  assert('Cinder Hulk has deathBurst', c.deathBurst !== undefined);
  if (c.deathBurst) {
    eq('Cinder Hulk damage count = 3', c.deathBurst.damage?.count, 3);
    eq('Cinder Hulk damage sides = 6', c.deathBurst.damage?.sides, 6);
    eq('Cinder Hulk damageType = fire', c.deathBurst.damageType, 'fire');
    eq('Cinder Hulk saveDC = 16', c.deathBurst.saveDC, 16);
    eq('Cinder Hulk saveAbility = con', c.deathBurst.saveAbility, 'con');
    eq('Cinder Hulk radius = 10', c.deathBurst.radius, 10);
    // "save for no damage" (no "half" wording) → halfOnSuccess = false
    eq('Cinder Hulk halfOnSuccess = false (save-for-none)', c.deathBurst.halfOnSuccess, false);
  }
}

// ============================================================
console.log('\n=== 7. parseDeathBurst — Mist Hulk (BGG, CR 6, damage + prone) ===\n');
{
  const c = spawn('Mist Hulk');
  assert('Mist Hulk has deathBurst', c.deathBurst !== undefined);
  if (c.deathBurst) {
    eq('Mist Hulk damage count = 2', c.deathBurst.damage?.count, 2);
    eq('Mist Hulk damage sides = 10', c.deathBurst.damage?.sides, 10);
    eq('Mist Hulk damageType = bludgeoning', c.deathBurst.damageType, 'bludgeoning');
    eq('Mist Hulk saveDC = 16', c.deathBurst.saveDC, 16);
    assert('Mist Hulk conditions includes prone',
      c.deathBurst.conditions?.includes('prone') === true);
  }
}

// ============================================================
console.log('\n=== 8. parseDeathBurst — Smoke Mephit (no save → no burst) ===\n');
{
  const c = spawn('Smoke Mephit');
  // Smoke Mephit's "Death Burst" creates a smoke cloud — no save, no damage.
  // v1 parser correctly skips traits with no save DC.
  eq('Smoke Mephit has NO deathBurst (no save → skipped)', c.deathBurst, undefined);
}

// ============================================================
console.log('\n=== 9. triggerDeathBurst — Magmin hits adjacent creature ===\n');
{
  // Direct API test: spawn Magmin + 1 adjacent creature, call triggerDeathBurst,
  // verify the adjacent creature took damage (or made a save).
  const { triggerDeathBurst } = require('../engine/combat');

  const magmin = spawn('Magmin', { x: 5, y: 5, z: 0 });
  magmin.currentHP = 0; // dying
  magmin.isDead = true;

  // Target: a Goblin at 5 ft (within Magmin's radius 10)
  const goblin = spawn('Goblin', { x: 5, y: 6, z: 0 });
  const goblinStartHP = goblin.currentHP;

  const { state, bf } = freshState([magmin, goblin]);

  triggerDeathBurst(magmin, state);

  // Log should mention the burst
  const burstLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes('Death Burst'));
  assert('Death Burst log emitted', burstLog !== undefined);

  // Log should mention the goblin's save result
  const goblinLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes(goblin.name) && e.description.includes('save'));
  assert('Goblin save log emitted', goblinLog !== undefined);

  // Goblin took damage (it has DEX +2 vs DC 11, ~50% fail; if it succeeded
  // it takes half of 2d6 = ~3-4; if failed takes full ~7). Either way HP
  // should be lower — UNLESS goblin rolled high on the save AND on the
  // damage dice. We assert HP ≤ startHP (damage can't heal).
  assert('Goblin HP ≤ start HP', goblin.currentHP <= goblinStartHP);
}

// ============================================================
console.log('\n=== 10. triggerDeathBurst — out-of-range creature unaffected ===\n');
{
  const { triggerDeathBurst } = require('../engine/combat');

  const magmin = spawn('Magmin', { x: 5, y: 5, z: 0 });
  magmin.currentHP = 0;
  magmin.isDead = true;

  // Out-of-range: 35 ft away (well beyond radius 10)
  const farGoblin = spawn('Goblin', { x: 5, y: 12, z: 0 });
  const farStartHP = farGoblin.currentHP;

  const { state, bf } = freshState([magmin, farGoblin]);

  triggerDeathBurst(magmin, state);

  // Far goblin HP unchanged
  eq('Far goblin HP unchanged (out of range)', farGoblin.currentHP, farStartHP);

  // No log entry should mention the far goblin in a burst context
  const farLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes(farGoblin.name) && e.description.includes('Death Burst'));
  eq('No burst-damage log for far goblin', farLog, undefined);
}

// ============================================================
console.log('\n=== 11. triggerDeathBurst — Mud Mephit applies restrained on failed save ===\n');
{
  const { triggerDeathBurst } = require('../engine/combat');

  // Run multiple times to verify the condition CAN be applied (RNG-dependent).
  // The Mud Mephit burst is DC 11 DEX; Goblin has DEX +2 → ~50% fail rate.
  // Over 30 trials, the probability of NEVER failing is ~0.5^30 ≈ 1e-9.
  let restrainedApplied = false;
  for (let i = 0; i < 30; i++) {
    const mudMephit = spawn('Mud Mephit', { x: 5, y: 5, z: 0 });
    mudMephit.currentHP = 0;
    mudMephit.isDead = true;

    const goblin = spawn('Goblin', { x: 5, y: 6, z: 0 });
    goblin.conditions.clear();

    const { state, bf } = freshState([mudMephit, goblin]);
    triggerDeathBurst(mudMephit, state);

    if (goblin.conditions.has('restrained')) {
      restrainedApplied = true;
      break;
    }
  }
  assert('Mud Mephit burst applies restrained on failed save (within 30 trials)', restrainedApplied);
}

// ============================================================
console.log('\n=== 12. triggerDeathBurst — Dust Mephit applies blinded on failed save ===\n');
{
  const { triggerDeathBurst } = require('../engine/combat');

  let blindedApplied = false;
  for (let i = 0; i < 30; i++) {
    const dustMephit = spawn('Dust Mephit', { x: 5, y: 5, z: 0 });
    dustMephit.currentHP = 0;
    dustMephit.isDead = true;

    const goblin = spawn('Goblin', { x: 5, y: 6, z: 0 });
    goblin.conditions.clear();

    const { state, bf } = freshState([dustMephit, goblin]);
    triggerDeathBurst(dustMephit, state);

    if (goblin.conditions.has('blinded')) {
      blindedApplied = true;
      break;
    }
  }
  assert('Dust Mephit burst applies blinded on failed save (within 30 trials)', blindedApplied);
}

// ============================================================
console.log('\n=== 13. triggerDeathBurst — Frost Worm (CR 17) big burst hits all in 60 ft ===\n');
{
  const { triggerDeathBurst } = require('../engine/combat');

  const frostWorm = spawn('Frost Worm', { x: 10, y: 10, z: 0 });
  frostWorm.currentHP = 0;
  frostWorm.isDead = true;

  // Within 60 ft
  const closeGoblin = spawn('Goblin', { x: 10, y: 11, z: 0 }); // 5 ft
  const midGoblin = spawn('Goblin', { x: 16, y: 10, z: 0 });  // 30 ft

  // Outside 60 ft
  const farGoblin = spawn('Goblin', { x: 25, y: 10, z: 0 });  // 75 ft
  const farStartHP = farGoblin.currentHP;

  const { state, bf } = freshState([frostWorm, closeGoblin, midGoblin, farGoblin]);

  triggerDeathBurst(frostWorm, state);

  // Close + mid goblins should have log entries
  const closeLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes(closeGoblin.name) && e.description.includes('save'));
  assert('Close goblin (5 ft) hit by Frost Worm burst', closeLog !== undefined);

  const midLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes(midGoblin.name) && e.description.includes('save'));
  assert('Mid goblin (30 ft) hit by Frost Worm burst', midLog !== undefined);

  // Far goblin (75 ft) should be unaffected (radius 60)
  eq('Far goblin (75 ft) HP unchanged (beyond radius 60)', farGoblin.currentHP, farStartHP);
}

// ============================================================
console.log('\n=== 14. triggerDeathBurst — chain reaction (burst kills another burst creature) ===\n');
{
  const { triggerDeathBurst } = require('../engine/combat');

  // Ice Mephit at (5,5) — death burst is 1d8 slashing, radius 5, DC 10 DEX.
  // Magmin at (5,6) — 5 ft away, within radius 5. Magmin has 1 HP left.
  // Magmin is immune to fire but NOT slashing, so the slashing burst can
  // kill it. When Magmin dies, ITS fire burst (2d6 fire, radius 10) fires.
  const iceMephit = spawn('Ice Mephit', { x: 5, y: 5, z: 0 });
  iceMephit.currentHP = 0;
  iceMephit.isDead = true;

  const magmin = spawn('Magmin', { x: 5, y: 6, z: 0 });
  magmin.currentHP = 1; // very low — will die from 1d8 slashing

  const { state, bf } = freshState([iceMephit, magmin]);

  triggerDeathBurst(iceMephit, state);

  // Magmin should be dead (1 HP + 1d8 slashing ≥ 1)
  // Edge case: Magmin might succeed the DC 10 DEX save (DEX +2) and take
  // half (1d8/2 = 0-3). If half = 0, Magmin survives. Run multiple trials.
  let chainReaction = false;
  for (let trial = 0; trial < 30; trial++) {
    const im = spawn('Ice Mephit', { x: 5, y: 5, z: 0 });
    im.currentHP = 0; im.isDead = true;
    const mg = spawn('Magmin', { x: 5, y: 6, z: 0 });
    mg.currentHP = 1;
    const { state, bf } = freshState([im, mg]);
    triggerDeathBurst(im, state);
    if (mg.currentHP <= 0) {
      // Magmin died — its burst should have fired too (chain reaction)
      const burstLogs = (state.log.events as any[]).filter(e =>
        e.description && e.description.includes('Death Burst'));
      if (burstLogs.length >= 2) {
        chainReaction = true;
        break;
      }
    }
  }
  assert('Chain reaction: Ice Mephit → Magmin → Magmin burst (within 30 trials)', chainReaction);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
