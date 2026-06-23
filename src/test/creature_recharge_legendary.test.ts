// ============================================================
// Test: Creature Megabatch Batch 3 — recharge + Legendary Resistance
// Run: npx ts-node --transpile-only src/test/creature_recharge_legendary.test.ts
//
// Session 52 Creature Megabatch Batch 3a + 3b.
// Verifies:
//   3a. Recharge:
//     - parseAction strips {@recharge N} from name + sets Action.recharge
//     - {@recharge} (bare) → min:6; {@recharge 5} → min:5
//     - recharged=true on spawn (available first turn)
//     - rollRecharge() rolls 1d6 per recharge action; recharged = roll >= min
//     - resetBudget() calls rollRecharge (start-of-turn hook)
//     - combat.ts marks recharged=false on dispatch (simulated via direct call)
//     - isActionAvailable() returns false when recharge && !recharged
//     - Real creatures: Adult Red Dragon Fire Breath (recharge 5),
//       Abominable Yeti Cold Breath (recharge 6), Blink Dog Teleport (recharge 6)
//   3b. Legendary Resistance:
//     - parseLegendaryResistance extracts N from "Legendary Resistance (N/Day)"
//     - monsterToCombatant sets Combatant.legendaryResistance {max, remaining}
//     - rollSave: failed save + remaining>0 → forced success + decrement
//     - After max uses, no more forced successes
//     - Non-legendary creatures have legendaryResistance undefined (no effect)
//     - Real creatures: Adult Brass Dragon (3/Day), Tarrasque (3/Day), Lich (3/Day)
//
// Tests use direct function calls (no full-combat RNG loops) to stay fast +
// deterministic. rollSave tests use a forced-low-DC + forced-high-DC pattern
// to make the fail/succeed outcome deterministic regardless of the d20 roll.
// ============================================================

import {
  mergeBestiaries,
  spawnMonster,
  monsterToCombatant,
  parseAction,
  type Raw5etoolsMonster,
} from '../parser/fivetools';

// RawAction is not exported from fivetools; define a minimal local shape for test fixtures.
type RawAction = { name: string; entries: (string | object)[] };
import { rollSave, resetBudget, rollRecharge } from '../engine/utils';
import { isActionAvailable } from '../ai/actions';
import type { Combatant, Action } from '../types/core';

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean | undefined | null, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected;
  assert(label, ok, ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Load real bestiary once --------------------------------
const fs = require('fs');
const path = require('path');
const dataDir = path.join(__dirname, '../../bestiaryData');
const dataFiles = fs.readdirSync(dataDir).filter((f: string) => f.endsWith('.json'));
const loadedFiles = dataFiles.map((f: string) =>
  JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'))
);
const bestiary = mergeBestiaries(...loadedFiles);

function spawn(name: string): Combatant {
  const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 });
  if (!c) throw new Error(`Creature not found: ${name}`);
  return c;
}

// Synthetic raw action factory
function mkAction(name: string, entries: string[] = ['{@atk mw} {@hit 5} to hit, reach 5 ft. {@damage 1d8+3} slashing.']): RawAction {
  return { name, entries };
}

// ============================================================
console.log('\n=== 3a.1 — parseAction strips {@recharge} + sets Action.recharge ===\n');
{
  // {@recharge 5} → min:5
  const a5 = parseAction(mkAction('Fire Breath {@recharge 5}', ['{@dc 17} DEX. 12d6 fire damage.']));
  eq('Recharge 5 name stripped', a5.name, 'Fire Breath');
  eq('Recharge 5 min = 5', a5.recharge?.min, 5);
  eq('Recharge 5 recharged = true (available on spawn)', a5.recharge?.recharged, true);

  // Bare {@recharge} → min:6 (default)
  const a6 = parseAction(mkAction('Cold Breath {@recharge}', ['{@dc 15} CON. 4d8 cold.']));
  eq('Bare recharge name stripped', a6.name, 'Cold Breath');
  eq('Bare recharge min = 6 (default)', a6.recharge?.min, 6);
  eq('Bare recharge recharged = true', a6.recharge?.recharged, true);

  // No recharge tag → recharge undefined
  const aNone = parseAction(mkAction('Bite', ['{@atk mw} {@hit 7} reach 5 ft. {@damage 1d10+4} piercing.']));
  assert('No-recharge action has recharge undefined', aNone.recharge === undefined);
  eq('No-recharge name unchanged', aNone.name, 'Bite');
}

// ============================================================
console.log('\n=== 3a.2 — isActionAvailable respects recharge state ===\n');
{
  const a = parseAction(mkAction('Breath {@recharge 5}', ['{@dc 17} 12d6 fire.']));
  // recharged=true on spawn
  assert('Available when recharged=true', isActionAvailable(a));
  // Simulate combat.ts dispatch: set recharged=false
  a.recharge!.recharged = false;
  assert('NOT available when recharged=false', !isActionAvailable(a));
  // Simulate start-of-turn recharge roll that meets threshold
  a.recharge!.recharged = true;
  assert('Available again after recharged reset to true', isActionAvailable(a));

  // Action without recharge: always available
  const b = parseAction(mkAction('Bite'));
  assert('No-recharge action always available', isActionAvailable(b));
}

// ============================================================
console.log('\n=== 3a.3 — rollRecharge rolls 1d6 per recharge action ===\n');
{
  // Synthetic combatant with 3 recharge actions + 1 normal
  const c = spawn('Goblin');  // no recharge actions by default
  const breath5 = parseAction(mkAction('Fire Breath {@recharge 5}'));
  const breath6 = parseAction(mkAction('Cold Breath {@recharge}'));
  const claw = parseAction(mkAction('Claw'));
  c.actions = [breath5, breath6, claw];

  // Set all recharge actions to unavailable, then rollRecharge
  breath5.recharge!.recharged = false;
  breath6.recharge!.recharged = false;

  // Run rollRecharge many times; for min:5, P(recharge) = 2/6 = 33%;
  // for min:6, P(recharge) = 1/6 = 17%. Over 100 rolls, both should
  // recharge at least once (P(0 recharges) ≈ 0.67^100 ≈ 10^-18 / 0.83^100 ≈ 10^-8).
  let breath5Recharged = 0, breath6Recharged = 0;
  for (let i = 0; i < 100; i++) {
    rollRecharge(c);
    if (breath5.recharge!.recharged) breath5Recharged++;
    if (breath6.recharge!.recharged) breath6Recharged++;
    // Reset for next iteration
    breath5.recharge!.recharged = false;
    breath6.recharge!.recharged = false;
  }
  assert('Recharge-5 action recharged at least once in 100 rolls', breath5Recharged > 0);
  assert('Recharge-6 action recharged at least once in 100 rolls', breath6Recharged > 0);
  // min:5 recharges more often than min:6 (statistically — allow margin)
  assert('Recharge-5 recharges ≥ as often as Recharge-6', breath5Recharged >= breath6Recharged - 5,
    `5:${breath5Recharged} 6:${breath6Recharged}`);
  // The non-recharge action is untouched by rollRecharge
  assert('Non-recharge action untouched', claw.recharge === undefined);
}

// ============================================================
console.log('\n=== 3a.4 — resetBudget calls rollRecharge (start-of-turn hook) ===\n');
{
  const c = spawn('Goblin');
  const breath = parseAction(mkAction('Fire Breath {@recharge 5}'));
  breath.recharge!.recharged = false;  // spent last turn
  c.actions = [breath];

  // Before resetBudget: recharged=false
  assert('Before resetBudget: recharged=false', !breath.recharge!.recharged);

  // resetBudget fires rollRecharge → recharged becomes true or false based on d6
  resetBudget(c);
  // Can't assert exact value (RNG), but the roll happened (field is boolean)
  assert('After resetBudget: recharged is boolean', typeof breath.recharge!.recharged === 'boolean');

  // Run 50 resetBudgets; at least one should recharge (P(50 fails) ≈ 0.67^50 ≈ 10^-9)
  let rechargedCount = 0;
  for (let i = 0; i < 50; i++) {
    breath.recharge!.recharged = false;
    resetBudget(c);
    if (breath.recharge!.recharged) rechargedCount++;
  }
  assert('resetBudget recharges Recharge-5 action at least once in 50 turns', rechargedCount > 0);
}

// ============================================================
console.log('\n=== 3a.5 — Real creatures with recharge actions ===\n');
{
  // Adult Red Dragon: Fire Breath {@recharge 5}
  const ard = spawn('Adult Red Dragon');
  const fireBreath = ard.actions.find(a => a.name === 'Fire Breath');
  assert('Adult Red Dragon has Fire Breath action', !!fireBreath);
  eq('Adult Red Dragon Fire Breath recharge min = 5', fireBreath?.recharge?.min, 5);
  eq('Adult Red Dragon Fire Breath recharged = true on spawn', fireBreath?.recharge?.recharged, true);

  // Abominable Yeti: Cold Breath {@recharge} (bare → min 6)
  const ay = spawn('Abominable Yeti');
  const coldBreath = ay.actions.find(a => a.name === 'Cold Breath');
  assert('Abominable Yeti has Cold Breath action', !!coldBreath);
  eq('Abominable Yeti Cold Breath recharge min = 6 (bare)', coldBreath?.recharge?.min, 6);

  // Blink Dog: Teleport {@recharge 4}
  const bd = spawn('Blink Dog');
  const teleport = bd.actions.find(a => a.name === 'Teleport');
  assert('Blink Dog has Teleport action', !!teleport);
  eq('Blink Dog Teleport recharge min = 4', teleport?.recharge?.min, 4);

  // A creature with NO recharge actions (Goblin)
  const gob = spawn('Goblin');
  const gobRecharge = gob.actions.filter(a => a.recharge);
  eq('Goblin has 0 recharge actions', gobRecharge.length, 0);
}

// ============================================================
console.log('\n=== 3a.6 — AI skips unrecharged actions (bestAttackAction etc.) ===\n');
{
  // Synthetic: a creature whose only attack is a recharging breath weapon
  const c = spawn('Goblin');
  const breath = parseAction(mkAction('Breath {@recharge 5}', ['{@atk mw} {@hit 5} reach 30 ft. {@damage 6d6} fire.']));
  breath.attackType = 'spell';
  breath.recharge!.recharged = false;  // spent
  c.actions = [breath];

  // bestAttackAction should return null (no available attack) — but Goblin
  // also has a default Scimitar action from the bestiary. To isolate, replace
  // actions entirely with just the recharging breath.
  // Import bestAttackAction dynamically to avoid circular-import issues.
  const { bestAttackAction } = require('../ai/actions');
  // Make a fake target within reach
  const target = spawn('Goblin');
  target.pos = { x: 1, y: 0, z: 0 };
  // When recharged=false: breath unavailable → bestAttackAction falls back to
  // other actions or null. With ONLY the breath in actions, returns null.
  const resultSpent = bestAttackAction(c, target, true);
  assert('bestAttackAction returns null when only action is unrecharged breath', resultSpent === null);

  // When recharged=true: breath available → returned
  breath.recharge!.recharged = true;
  const resultAvail = bestAttackAction(c, target, true);
  assert('bestAttackAction returns breath when recharged=true', resultAvail?.name === 'Breath');
}

// ============================================================
console.log('\n=== 3b.1 — parseLegendaryResistance extracts N from trait name ===\n');
{
  // Adult Brass Dragon: "Legendary Resistance (3/Day)" → {max:3, remaining:3}
  const abd = spawn('Adult Brass Dragon');
  assert('Adult Brass Dragon has legendaryResistance', !!abd.legendaryResistance);
  eq('Adult Brass Dragon LR max = 3', abd.legendaryResistance?.max, 3);
  eq('Adult Brass Dragon LR remaining = 3 (full on spawn)', abd.legendaryResistance?.remaining, 3);

  // Tarrasque: 3/Day
  const tar = spawn('Tarrasque');
  eq('Tarrasque LR max = 3', tar.legendaryResistance?.max, 3);
  eq('Tarrasque LR remaining = 3', tar.legendaryResistance?.remaining, 3);

  // Lich: 3/Day
  const lich = spawn('Lich');
  eq('Lich LR max = 3', lich.legendaryResistance?.max, 3);

  // A non-legendary creature: undefined
  const gob = spawn('Goblin');
  assert('Goblin has no legendaryResistance', gob.legendaryResistance === undefined);
}

// ============================================================
console.log('\n=== 3b.2 — rollSave forces success on fail + decrements ===\n');
{
  // Use a creature with LR + a save it's bad at. Tarrasque has LR 3/Day.
  // Tarrasque DEX is 11 (mod 0), no DEX save prof → derived DEX save = 0.
  // DC 25 DEX save: Tarrasque rolls d20 + 0; max total = 20 < 25 → always fails.
  // With LR: the first 3 failed saves become successes; after that, real fails.
  const tar = spawn('Tarrasque');

  // Save 1: fails (max 20 < 25), LR kicks in → success, remaining 3→2
  const r1 = rollSave(tar, 'dex', 25);
  assert('Tarrasque DEX save vs DC 25: LR forces success (1st use)', r1.success);
  eq('Tarrasque LR remaining = 2 after 1st use', tar.legendaryResistance?.remaining, 2);

  // Save 2: LR again → success, remaining 2→1
  const r2 = rollSave(tar, 'dex', 25);
  assert('Tarrasque DEX save vs DC 25: LR forces success (2nd use)', r2.success);
  eq('Tarrasque LR remaining = 1 after 2nd use', tar.legendaryResistance?.remaining, 1);

  // Save 3: LR again → success, remaining 1→0
  const r3 = rollSave(tar, 'dex', 25);
  assert('Tarrasque DEX save vs DC 25: LR forces success (3rd use)', r3.success);
  eq('Tarrasque LR remaining = 0 after 3rd use', tar.legendaryResistance?.remaining, 0);

  // Save 4: LR exhausted → real fail (max 20 < 25)
  let success4 = 0;
  for (let i = 0; i < 10; i++) {
    if (rollSave(tar, 'dex', 25).success) success4++;
  }
  eq('Tarrasque DEX save vs DC 25: 0 successes after LR exhausted (10 rolls)', success4, 0);
  eq('Tarrasque LR remaining still 0 (no negative)', tar.legendaryResistance?.remaining, 0);
}

// ============================================================
console.log('\n=== 3b.3 — rollSave does NOT use LR on a SUCCESSFUL save ===\n');
{
  // Tarrasque fresh, DC 1 DEX (trivially succeeds: d20+0 ≥ 1 always true —
  // nat 1 is NOT an auto-fail on saves per PHB p.179, only on attacks).
  // LR should NOT be consumed since the save never fails.
  const tar = spawn('Tarrasque');
  let successes = 0;
  for (let i = 0; i < 20; i++) {
    if (rollSave(tar, 'dex', 1).success) successes++;
  }
  eq('Tarrasque DEX vs DC 1: 20/20 succeed (nat 1 not auto-fail on saves)', successes, 20);
  eq('Tarrasque LR remaining = 3 (not consumed on successes)', tar.legendaryResistance?.remaining, 3);
}

// ============================================================
console.log('\n=== 3b.4 — Non-legendary creature: no LR effect ===\n');
{
  // Goblin: no legendaryResistance. A failed save stays failed.
  const gob = spawn('Goblin');
  // Goblin DEX 14 (mod +2), no DEX save. DC 25 → max total 22 < 25 → always fails.
  let successes = 0;
  for (let i = 0; i < 10; i++) {
    if (rollSave(gob, 'dex', 25).success) successes++;
  }
  eq('Goblin DEX vs DC 25: 0 successes (no LR to force success)', successes, 0);
  assert('Goblin has no legendaryResistance field', gob.legendaryResistance === undefined);
}

// ============================================================
console.log('\n=== 3b.5 — LR works with listed save bonus (Batch 2 integration) ===\n');
{
  // Adult Red Dragon: CON save +13 (listed), LR 3/Day.
  // DC 30 CON save: dragon rolls d20 + 13; max total = 33. So it CAN succeed
  // naturally on an 17+ (17+13=30). To guarantee a FAIL for the LR test,
  // use DC 40 (max total 33 < 40 → always fails → LR always kicks in).
  const ard = spawn('Adult Red Dragon');
  eq('Adult Red Dragon CON save prof = 13 (Batch 2)', ard.saveProficiencies?.con, 13);
  eq('Adult Red Dragon LR max = 3', ard.legendaryResistance?.max, 3);

  const r1 = rollSave(ard, 'con', 40);  // impossible to make naturally
  assert('Adult Red Dragon CON vs DC 40: LR forces success (uses listed save, still fails, LR kicks in)', r1.success);
  eq('Adult Red Dragon LR remaining = 2', ard.legendaryResistance?.remaining, 2);
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
