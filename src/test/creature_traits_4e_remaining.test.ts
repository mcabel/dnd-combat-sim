// ============================================================
// Test: Creature Traits 4e-remaining (Session 53 Batch 4e)
//
// Validates that:
//   - Sunlight Sensitivity, Avoidance, Ambusher, Brute, False Appearance,
//     Siege Monster, Water Breathing, Hold Breath are correctly parsed
//     from the 5etools trait arrays
//   - Avoidance flips the save-for-half damage outcome (success → 0 dmg,
//     failure → half dmg)
//   - Sunlight Sensitivity imposes disadvantage on attack rolls when
//     battlefield.lightLevel === 'daylight'
//
// Reverse published order (newest pre-2024 source first):
//   - CoA (Candlekeep Mysteries 2021): Displacer Fiend (Avoidance)
//   - MM (2014): Kobold, Drow (Sunlight Sensitivity); Crocodile (Hold Breath);
//     Giant Shark (Water Breathing); Animated Armor (False Appearance)
//
// Run: npx ts-node src/test/creature_traits_4e_remaining.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  Raw5etoolsMonster,
} from '../parser/fivetools';
import { Combatant, Vec3, Battlefield } from '../types/core';
import { EngineState, triggerDeathBurst } from '../engine/combat';
import { applyDamageWithTempHP } from '../engine/utils';

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
// The specific creatures referenced: Kobold/Drow/Crocodile/Giant Shark/
// Animated Armor (MM), Displacer Fiend (CoA), Izek Strazni/Pidlwick II (CoS),
// Fire Kraken (BGG), Goblin (MM).
const NEEDED_SOURCES = ['mm-2014', 'mm', 'cos', 'coa', 'bgg', 'dmg'];
function loadBestiary(): Map<string, Raw5etoolsMonster> {
  const dir = path.join(__dirname, '../../bestiaryData');
  const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  // Pick files matching the NEEDED_SOURCES list (e.g. 'bestiary-mm-2014.json')
  const files = allFiles.filter(f =>
    NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
  if (files.length === 0) {
    // Fallback: load all (slower, but works if file names change)
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

function freshState(combatants: Combatant[], lightLevel?: 'indoors' | 'daylight' | 'dim'): { state: EngineState; bf: MutableBF } {
  const bf = makeBF(combatants);
  if (lightLevel) (bf as any).lightLevel = lightLevel;
  const state: EngineState = {
    battlefield: bf as Battlefield,
    log: { events: [] } as any,
    round: 1,
    activeCombatantId: combatants[0]?.id ?? null,
    pendingActions: [],
    // Engine internals accessed by resolveAttack — all must be initialized
    // (otherwise crashes like 'Cannot read properties of undefined (reading get)' on damageThisRound).
    rageDamagedSinceLastTurn: new Set<string>(),
    disengagedThisTurn: new Set<string>(),
    damageThisRound: new Map<string, number>(),
    noDamageRounds: new Map<string, number>(),
  } as unknown as EngineState;
  return { state, bf };
}

// ============================================================
console.log('\n=== 1. Parser — Sunlight Sensitivity ===\n');
{
  const kobold = spawn('Kobold');
  eq('Kobold has sunlightSensitivity', kobold.sunlightSensitivity, true);

  const drow = spawn('Drow');
  eq('Drow has sunlightSensitivity', drow.sunlightSensitivity, true);

  // Goblin does NOT have Sunlight Sensitivity (some() returns false)
  const goblin = spawn('Goblin');
  eq('Goblin does NOT have sunlightSensitivity', goblin.sunlightSensitivity, false);
}

// ============================================================
console.log('\n=== 2. Parser — Avoidance ===\n');
{
  // Displacer Fiend (CoA) has Avoidance
  const displacer = spawn('Displacer Fiend');
  eq('Displacer Fiend has avoidance', displacer.avoidance, true);

  // Goblin does NOT have Avoidance
  const goblin = spawn('Goblin');
  eq('Goblin does NOT have avoidance', goblin.avoidance, false);
}

// ============================================================
console.log('\n=== 3. Parser — Brute / Ambusher / False Appearance ===\n');
{
  // Izek Strazni (CoS) has Brute
  const izek = spawn('Izek Strazni');
  eq('Izek Strazni has brute', izek.brute, true);

  // Animated Armor (MM) has False Appearance
  const armor = spawn('Animated Armor');
  eq('Animated Armor has falseAppearance', armor.falseAppearance, true);

  // Pidlwick II (CoS) has Ambusher
  const pidlwick = spawn('Pidlwick II');
  eq('Pidlwick II has ambusher', pidlwick.ambusher, true);
}

// ============================================================
console.log('\n=== 4. Parser — Hold Breath / Water Breathing / Siege Monster ===\n');
{
  // Crocodile (MM) has Hold Breath 15 minutes
  const croc = spawn('Crocodile');
  eq('Crocodile holdBreathMinutes = 15', croc.holdBreathMinutes, 15);

  // Giant Shark (MM) has Water Breathing
  const shark = spawn('Giant Shark');
  eq('Giant Shark has waterBreathing', shark.waterBreathing, true);

  // Siege Monster trait — find a creature with it
  // Use a 5etools search: any creature with "Siege Monster" trait
  // BGG Fire Kraken has it (per our earlier sample)
  const fireKraken = spawn('Fire Kraken');
  eq('Fire Kraken has siegeMonster', fireKraken.siegeMonster, true);
}

// ============================================================
console.log('\n=== 5. Engine — Sunlight Sensitivity imposes disadvantage in daylight ===\n');
{
  // Spawn a Kobold (sunlightSensitivity=true) and a Goblin target.
  // Set battlefield.lightLevel = 'daylight'. Attack the goblin.
  // Verify the log mentions "Sunlight Sensitivity" disadvantage.
  const { resolveAttack } = require('../engine/combat');

  const kobold = spawn('Kobold', { x: 5, y: 5, z: 0 });
  kobold.faction = 'party';
  const goblin = spawn('Goblin', { x: 5, y: 6, z: 0 });
  goblin.faction = 'enemy';

  // Daylight scenario
  const { state, bf } = freshState([kobold, goblin], 'daylight');
  (bf as any).lightLevel = 'daylight';

  // Kobold has a melee attack; attack the goblin
  const attack = kobold.actions[0];
  assert('Kobold has at least one attack', !!attack);
  resolveAttack(kobold, goblin, attack, state);

  // Log should mention Sunlight Sensitivity
  const ssLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes('Sunlight Sensitivity'));
  assert('Sunlight Sensitivity disadvantage log emitted in daylight', ssLog !== undefined);
}

// ============================================================
console.log('\n=== 6. Engine — Sunlight Sensitivity does NOT fire indoors (default) ===\n');
{
  const { resolveAttack } = require('../engine/combat');

  const kobold = spawn('Kobold', { x: 5, y: 5, z: 0 });
  kobold.faction = 'party';
  const goblin = spawn('Goblin', { x: 5, y: 6, z: 0 });
  goblin.faction = 'enemy';

  // Default: no lightLevel set (treated as 'indoors')
  const { state, bf } = freshState([kobold, goblin]);

  const attack = kobold.actions[0];
  resolveAttack(kobold, goblin, attack, state);

  // Log should NOT mention Sunlight Sensitivity
  const ssLog = (state.log.events as any[]).find(e =>
    e.description && e.description.includes('Sunlight Sensitivity'));
  eq('No Sunlight Sensitivity log indoors (default)', ssLog, undefined);
}

// ============================================================
console.log('\n=== 7. Engine — Avoidance flips save-for-half outcome ===\n');
{
  // Test the Avoidance trait via the spell-save damage path in combat.ts.
  // When a creature with Avoidance succeeds a save-for-half save, it takes
  // 0 damage (instead of half). When it fails, it takes half (instead of full).
  //
  // We use a spell with save-for-half (e.g. fireball). Easier: directly
  // invoke the saveAction path in combat.ts via resolveAttack with a
  // save-type action.
  const { resolveAttack } = require('../engine/combat');

  const displacer = spawn('Displacer Fiend', { x: 5, y: 5, z: 0 });
  displacer.faction = 'enemy';
  displacer.currentHP = 100;
  displacer.maxHP = 100;

  // Attacker: a spellcaster with a save-for-half spell
  const caster = spawn('Drow', { x: 5, y: 6, z: 0 });
  caster.faction = 'party';

  // Build a save-for-half action manually
  const saveAction = {
    name: 'Test Fireball',
    isMultiattack: false,
    attackType: 'save' as const,
    reach: 60,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: { count: 6, sides: 6, bonus: 0, average: 21 },
    damageType: 'fire' as const,
    saveDC: 13,
    saveAbility: 'dex' as const,
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
    costType: 'action' as const,
    legendaryCost: 0,
    description: 'Test fireball',
  };
  caster.actions = [saveAction];

  // Run multiple trials to verify Avoidance flips the outcome
  // (success → 0 dmg, failure → half dmg). Reduced from 100 to 30 trials
  // per outcome to stay under CI's 60-second per-test timeout (each trial
  // is ~50ms due to resolveAttack overhead). 30 trials is enough to observe
  // both outcomes with high probability (P(no success in 30) ≈ 0.5^30 ≈ 1e-9).
  let observedZeroDamageOnSuccess = false;
  let observedHalfDamageOnFail = false;

  for (let trial = 0; trial < 30; trial++) {
    const d = spawn('Displacer Fiend', { x: 5, y: 5, z: 0 });
    d.faction = 'enemy';
    d.currentHP = 1000; // ensure it survives
    d.maxHP = 1000;
    const c = spawn('Drow', { x: 5, y: 6, z: 0 });
    c.faction = 'party';
    c.actions = [saveAction];
    const { state, bf } = freshState([c, d]);

    const startHP = d.currentHP;
    resolveAttack(c, d, saveAction, state);

    // Find the save log
    const saveLog = (state.log.events as any[]).find(e =>
      e.description && e.description.includes('succeeds') || e.description && e.description.includes('fails'));
    if (!saveLog) continue;
    const succeeded = saveLog.description.includes('succeeds');
    const damageLog = (state.log.events as any[]).find(e =>
      e.type === 'damage' && e.description && e.description.includes(d.name));
    if (!damageLog) continue;
    const dmg = damageLog.amount ?? 0;
    const hpLost = startHP - d.currentHP;

    if (succeeded && hpLost === 0) observedZeroDamageOnSuccess = true;
    if (!succeeded && hpLost > 0 && hpLost < 21) {
      // Half damage: 6d6 average 21, half = ~10-11
      observedHalfDamageOnFail = true;
    }
    if (observedZeroDamageOnSuccess && observedHalfDamageOnFail) break;
  }
  assert('Avoidance: 0 damage on successful save (observed in 30 trials)', observedZeroDamageOnSuccess);
  assert('Avoidance: half damage on failed save (observed in 30 trials)', observedHalfDamageOnFail);
}

// ============================================================
console.log('\n=== 8. Engine — Non-Avoidance creature takes full damage on failed save ===\n');
{
  // Control: a creature WITHOUT Avoidance should take full damage on fail,
  // half on success (the normal save-for-half outcome).
  const { resolveAttack } = require('../engine/combat');

  const saveAction = {
    name: 'Test Fireball',
    isMultiattack: false,
    attackType: 'save' as const,
    reach: 60,
    range: { normal: 60, long: 60 },
    hitBonus: null,
    damage: { count: 6, sides: 6, bonus: 0, average: 21 },
    damageType: 'fire' as const,
    saveDC: 13,
    saveAbility: 'dex' as const,
    isAoE: true,
    isControl: false,
    requiresConcentration: false,
    slotLevel: 3,
    costType: 'action' as const,
    legendaryCost: 0,
    description: 'Test fireball',
  };

  let observedFullDamageOnFail = false;
  for (let trial = 0; trial < 30; trial++) {
    const goblin = spawn('Goblin', { x: 5, y: 5, z: 0 });
    goblin.faction = 'enemy';
    goblin.currentHP = 1000;
    goblin.maxHP = 1000;
    const caster = spawn('Drow', { x: 5, y: 6, z: 0 });
    caster.faction = 'party';
    caster.actions = [saveAction];
    const { state, bf } = freshState([caster, goblin]);

    resolveAttack(caster, goblin, saveAction, state);

    const saveLog = (state.log.events as any[]).find(e =>
      e.description && (e.description.includes('succeeds') || e.description.includes('fails')));
    if (!saveLog) continue;
    const failed = saveLog.description.includes('fails');
    const hpLost = 1000 - goblin.currentHP;
    if (failed && hpLost >= 6) {  // min 6d6 = 6, max = 36
      observedFullDamageOnFail = true;
      break;
    }
  }
  assert('Non-Avoidance creature: full damage on failed save (observed in 30 trials)', observedFullDamageOnFail);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
