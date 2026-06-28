// ============================================================
// Test: Session 93 — RFC-LAIRACTIONS Phase 3a
//       Damage/save family handlers (save_damage, save_condition,
//       damage_no_save, spell_slot_regen)
//
// Validates the Phase 3a engine-layer deliverable (RFC-LAIRACTIONS §8
// Phase 3, first batch):
//   1. `save_damage` handler — rolls save per target, full damage on fail,
//      half damage on success. Reuses `rollSave` (advantage/etc. apply) and
//      `applyDamageWithTempHP` (immunity/resistance/vulnerability/temp HP).
//   2. `save_condition` handler — rolls save per target, applies all
//      conditions on fail, no effect on success. Reuses `addCondition`
//      (immunity/cascade apply).
//   3. `damage_no_save` handler — full damage to each target (no save).
//      Immunity/resistance/vulnerability still apply.
//   4. `spell_slot_regen` handler — rolls d8, regains a spent spell slot of
//      that level or lower. "Nothing happens" if no spent slot.
//   5. Targeting helper — `selectLairActionTargets` filters by faction
//      (enemies vs allies+self), rangeFt (Chebyshev feet), radiusFt, and
//      targetFilter (creature-type pipe-match).
//   6. Header log + per-target mechanical events (save_success/save_fail,
//      damage, condition_add, heal) appear in the combat log.
//   7. Real bestiary data: Adult Red Dragon (save_damage), Adult Brass
//      Dragon (save_condition — prone), Adult Blue Dragon (save_damage +
//      save_condition — blinded), Adult White Dragon (damage_no_save),
//      Lich (spell_slot_regen), Aboleth (save_damage — psychic).
//   8. Resistance/vulnerability/immunity are honored (Red Dragon fire
//      resistance halves; a fire-vulnerable target doubles).
//   9. Range gating: a target outside rangeFt is NOT hit.
//  10. The lair creature itself is never its own target.
//  11. Damage on successful save is HALF (PHB default).
//
// Run: npx ts-node --transpile-only src/test/session93_lair_save_damage.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { Combatant, Vec3, Battlefield, LairAction } from '../types/core';

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

// ---- Load bestiary (mm-2014 only — covers all test creatures) ------------

const NEEDED_SOURCES = ['mm-2014'];
const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const files = allFiles.filter(f =>
  NEEDED_SOURCES.some(src => f === `bestiary-${src}.json`));
const loaded = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos);
  if (!c) throw new Error(`Monster not found: ${name}`);
  return c;
}

// ---- Combat state factories --------------------------------

interface MutableBF extends Battlefield { [k: string]: any; }

function makeBF(combatants: Combatant[]): MutableBF {
  const width = 30, height = 30, depth = 1;
  const cells: any[][][] = [];
  for (let x = 0; x < width; x++) {
    cells[x] = [];
    for (let y = 0; y < height; y++) {
      cells[x][y] = [{ terrain: 'flat', elevation: 0 }];
    }
  }
  return {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  } as MutableBF;
}

/** Find all lair-action HEADER log entries (start of "takes a lair action"). */
function lairHeaderLogs(log: any): any[] {
  return log.events.filter((e: any) =>
    e.type === 'action' && e.description.includes('takes a lair action'));
}

/** Find all lair-action-related log entries (header + per-target events). */
function lairAllLogs(log: any): any[] {
  return log.events.filter((e: any) =>
    (e.type === 'action' || e.type === 'damage' ||
     e.type === 'save_success' || e.type === 'save_fail' ||
     e.type === 'condition_add' || e.type === 'heal' ||
     e.type === 'death' || e.type === 'unconscious') &&
    (e.description.includes('lair action') ||
     e.description.includes('lair_action') ||
     e.description.includes('::') ||     // action id pattern
     e.description.includes('spell slot regen') ||
     e.description.includes('regains a level-')));
}

/** Force the lair creature to pick `actionId` this round by removing all
 *  other actions from its `lairActions.actions`. History is also cleared. */
function forceLairAction(creature: Combatant, actionId: string): void {
  if (!creature.lairActions) throw new Error(`${creature.name} has no lairActions`);
  const found = creature.lairActions.actions.find(a => a.id === actionId);
  if (!found) {
    throw new Error(`Action ${actionId} not found on ${creature.name}; available: ${
      creature.lairActions.actions.map(a => a.id).join(', ')}`);
  }
  creature.lairActions.actions = [found];
  creature._lairActionHistory = [];
}

/** Tank up a creature so it survives the lair action damage. */
function tankUp(c: Combatant, hp = 100_000): void {
  c.maxHP = hp;
  c.currentHP = hp;
}

/** Disable legendary actions (sets pool to 0) so the lair action is the ONLY
 *  source of save/damage events from this creature in the test round. This
 *  prevents the dragon's Wing Attack (legendary) from polluting the event log
 *  with extra save_fail/damage events that would confuse lair-action assertions. */
function noLegendary(c: Combatant): void {
  c.legendaryActionPoolMax = 0;
  c.legendaryActionPool = 0;
}

/** Set the lair creature as a "party" faction (so the test target is its enemy). */
function asParty(c: Combatant): void { c.faction = 'party'; }
function asEnemy(c: Combatant): void { c.faction = 'enemy'; }

// ============================================================
// 1. save_damage — Adult Red Dragon "Magma erupts" (DC 15 DEX, 6d6 fire)
//    Verify: header log + save_fail/save_success + damage events fire.
// ============================================================
console.log('\n--- 1. save_damage: Adult Red Dragon magma ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  // Force ONLY the magma action (Red Dragon::0 — save_damage).
  forceLairAction(dragon, 'Red Dragon::0');
  tankUp(dragon);
  noLegendary(dragon);   // prevent legendary-action saves from polluting the test

  // Spawn 2 targets within 120 ft (rangeFt).
  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });   // 25 ft away
  asEnemy(t1); tankUp(t1);
  const t2 = spawn('Goblin', { x: 10, y: 0, z: 0 });  // 50 ft away
  asEnemy(t2); tankUp(t2);

  const bf = makeBF([dragon, t1, t2]);
  const rlog = runCombat(bf, [dragon.id, t1.id, t2.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header log fires.
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === dragon.id);
  assert('1a. header log fires for dragon', headers.length === 1,
    `got ${headers.length}`);
  if (headers.length === 1) {
    const h = headers[0].description;
    assert('1b. header mentions [save_damage]', h.includes('[save_damage]'));
    assert('1c. header mentions "initiative count 20"', h.includes('initiative count 20'));
    assert('1d. header does NOT mention "Phase 2 stub"', !h.includes('Phase 2 stub'));
  }

  // Save events fire (one per target).
  const saves = rlog.events.filter((e: any) =>
    (e.type === 'save_success' || e.type === 'save_fail') &&
    e.actorId === dragon.id);
  assert('1e. exactly 2 save events (one per target)', saves.length === 2,
    `got ${saves.length}`);

  // Damage events fire (one per target that took > 0 damage).
  const damages = rlog.events.filter((e: any) =>
    e.type === 'damage' && e.actorId === dragon.id &&
    e.description.includes('Red Dragon::0'));
  assert('1f. at least 1 damage event for Red Dragon::0',
    damages.length >= 1, `got ${damages.length}`);

  // The save event mentions DEX save vs DC 15.
  if (saves.length > 0) {
    assert('1g. save event mentions DEX save',
      saves[0].description.includes('DEX'));
    assert('1h. save event mentions DC 15',
      saves[0].description.includes('DC 15'));
  }

  // Damage event mentions fire damage type.
  if (damages.length > 0) {
    assert('1i. damage event mentions fire type',
      damages.some((d: any) => d.description.includes('fire')));
  }

  // Targets took damage (currentHP < maxHP for at least one).
  const t1Damaged = t1.currentHP < t1.maxHP;
  const t2Damaged = t2.currentHP < t2.maxHP;
  assert('1j. at least one target took damage', t1Damaged || t2Damaged);
  console.log(`    t1 HP: ${t1.currentHP}/${t1.maxHP}, t2 HP: ${t2.currentHP}/${t2.maxHP}`);
}

// ============================================================
// 2. save_damage — half damage on successful save (PHB default)
//    Make the target a high-DEX rogue-like creature that always succeeds
//    on DEX saves (set dex very high + saveProficiency). Run the magma
//    lair action 20 times; in EVERY run, the target should take ≤ half
//    of the rolled damage (i.e., damage is halved).
// ============================================================
console.log('\n--- 2. save_damage: half damage on successful save ---');
{
  let halfDamageObserved = 0;
  let fullDamageObserved = 0;
  let totalRuns = 0;
  for (let i = 0; i < 30; i++) {
    const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
    asParty(dragon);
    forceLairAction(dragon, 'Red Dragon::0');
    tankUp(dragon);

    const target = spawn('Goblin', { x: 5, y: 0, z: 0 });
    asEnemy(target);
    // Make the target always succeed DEX saves: dex=30 (+10 mod) and a listed
    // save bonus of +30 (rollSave uses listedSaveBonus when present).
    target.dex = 30;
    target.saveProficiencies = { dex: 30 };
    tankUp(target);

    const bf = makeBF([dragon, target]);
    const rlog = runCombat(bf, [dragon.id, target.id], {
      maxRounds: 1, verbose: false
    } as any);

    const saveEvt = rlog.events.find((e: any) =>
      e.type === 'save_success' && e.actorId === dragon.id);
    if (!saveEvt) continue;  // (shouldn't happen with +30 save, but defensive)

    totalRuns++;
    // saveEvt.description: "...succeeds DEX save (rolled X vs DC 15) — takes Y fire damage (half of Z)"
    const halfMatch = saveEvt.description.match(/half of (\d+)/);
    if (halfMatch) {
      halfDamageObserved++;
    } else {
      fullDamageObserved++;
    }
  }
  assert('2a. ≥10 runs completed with successful saves', totalRuns >= 10,
    `only ${totalRuns} runs`);
  assert('2b. EVERY successful save shows half damage (not full)',
    halfDamageObserved === totalRuns && fullDamageObserved === 0,
    `${halfDamageObserved}/${totalRuns} half, ${fullDamageObserved} full`);
  console.log(`    half-damage observed in ${halfDamageObserved}/${totalRuns} runs`);
}

// ============================================================
// 3. save_damage — fire immunity → 0 damage; fire resistance → halved
// ============================================================
console.log('\n--- 3. save_damage: immunity / resistance / vulnerability ---');
{
  // 3a. Fire-immune target → takes 0 damage even on failed save.
  const dragon1 = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon1); forceLairAction(dragon1, 'Red Dragon::0'); tankUp(dragon1);
  noLegendary(dragon1);
  const immune = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(immune);
  immune.immunities = ['fire'];
  immune.dex = 1;   // always fail DEX save (low roll + no mod)
  immune.saveProficiencies = { dex: -100 };  // guarantees fail even on nat 20
  tankUp(immune);
  const bf1 = makeBF([dragon1, immune]);
  runCombat(bf1, [dragon1.id, immune.id], { maxRounds: 1, verbose: false } as any);
  eq('3a. fire-immune target took 0 damage', immune.currentHP, immune.maxHP);

  // 3b. Fire-resistant target → damage halved (and half-on-save stacks? No —
  //     PHB: resistance is applied AFTER the half-on-save, so a resistant
  //     target that fails the save takes full/2 = half; one that succeeds
  //     takes (full/2)/2 = quarter. We check the failed-save case: damage
  //     should be ≤ half of the dice roll.
  //     (Hard to assert exact value due to dice — instead assert the target
  //     took ≤ 36 dmg = max 6d6=36, halved once by resistance = 18. Actually
  //     with random rolls, 6d6 maxes at 36; halved = 18. So target took ≤ 18.)
  const dragon2 = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon2); forceLairAction(dragon2, 'Red Dragon::0'); tankUp(dragon2);
  noLegendary(dragon2);
  const resistant = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(resistant);
  resistant.resistances = ['fire'];
  resistant.dex = 1;
  resistant.saveProficiencies = { dex: -100 };  // guarantees fail even on nat 20
  tankUp(resistant);
  const bf2 = makeBF([dragon2, resistant]);
  const rlog2 = runCombat(bf2, [dragon2.id, resistant.id], {
    maxRounds: 1, verbose: false
  } as any);
  // The save should fail (dex=1, no mod). Damage is full dice, halved by
  // resistance. Max possible: 36/2 = 18. So target took ≤ 18.
  const lost = resistant.maxHP - resistant.currentHP;
  assert('3b. fire-resistant target took ≤ 18 (halved from max 6d6=36)',
    lost >= 0 && lost <= 18,
    `lost ${lost} HP`);

  // 3c. Fire-vulnerable target → damage doubled. On failed save, takes
  //     2×dice. Max 6d6=36, doubled = 72.
  const dragon3 = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon3); forceLairAction(dragon3, 'Red Dragon::0'); tankUp(dragon3);
  noLegendary(dragon3);
  const vulnerable = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(vulnerable);
  vulnerable.damageVulnerabilities = ['fire'];
  vulnerable.dex = 1;
  vulnerable.saveProficiencies = { dex: -100 };  // guarantees fail even on nat 20
  tankUp(vulnerable);
  const bf3 = makeBF([dragon3, vulnerable]);
  const rlog3 = runCombat(bf3, [dragon3.id, vulnerable.id], {
    maxRounds: 1, verbose: false
  } as any);
  const lost3 = vulnerable.maxHP - vulnerable.currentHP;
  // The save fails (dex=1). Damage = dice × 2. Min 6d6=6, doubled = 12.
  // So target lost ≥ 12 HP (dice could be higher).
  assert('3c. fire-vulnerable target took ≥ 12 (doubled from min 6d6=6)',
    lost3 >= 12,
    `lost ${lost3} HP`);
}

// ============================================================
// 4. save_condition — Adult Brass Dragon "DC 15 STR or knocked prone"
//    Verify: prone condition applied on FAILED save, not on SUCCESS.
// ============================================================
console.log('\n--- 4. save_condition: Brass Dragon prone ---');
{
  const dragon = spawn('Adult Brass Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  // Brass Dragon::0 is save_condition (STR or prone).
  forceLairAction(dragon, 'Brass Dragon::0');
  tankUp(dragon);

  // Target with low STR → will fail the save.
  // (str=1 gives -5 mod; even a nat 20 = 20-5 = 15 ≥ DC 15 succeeds 5% of
  // the time. To make the test deterministic, set saveProficiencies.str to
  // a large negative bonus so even nat 20 fails.)
  const weakling = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(weakling);
  weakling.str = 1;   // -5 mod
  weakling.saveProficiencies = { str: -100 };  // guarantees fail even on nat 20
  tankUp(weakling);

  const bf = makeBF([dragon, weakling]);
  const rlog = runCombat(bf, [dragon.id, weakling.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [save_condition].
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === dragon.id);
  assert('4a. header log fires', headers.length === 1);
  if (headers.length === 1) {
    assert('4b. header mentions [save_condition]',
      headers[0].description.includes('[save_condition]'));
  }

  // Save fail event fires (low STR → fails).
  const saveEvt = rlog.events.find((e: any) =>
    e.type === 'save_fail' && e.actorId === dragon.id);
  assert('4c. save_fail event fires (low-STR target)', saveEvt !== undefined);

  // Condition_add event fires for prone.
  const condEvt = rlog.events.find((e: any) =>
    e.type === 'condition_add' && e.actorId === dragon.id &&
    e.description.includes('prone'));
  assert('4d. condition_add event for prone fires', condEvt !== undefined);

  // Target now has the prone condition.
  assert('4e. target has prone condition',
    weakling.conditions.has('prone'),
    `conditions: ${[...weakling.conditions].join(',')}`);
}

// ============================================================
// 5. save_condition — successful save → NO condition
//    High-STR target (always succeeds DC 15 STR) → no prone.
// ============================================================
console.log('\n--- 5. save_condition: successful save → no condition ---');
{
  const dragon = spawn('Adult Brass Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  forceLairAction(dragon, 'Brass Dragon::0');
  tankUp(dragon);

  const strongman = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(strongman);
  strongman.str = 30;   // +10 mod
  strongman.saveProficiencies = { str: 30 };  // +30 → always succeeds DC 15
  tankUp(strongman);

  const bf = makeBF([dragon, strongman]);
  const rlog = runCombat(bf, [dragon.id, strongman.id], {
    maxRounds: 1, verbose: false
  } as any);

  const saveEvt = rlog.events.find((e: any) =>
    e.type === 'save_success' && e.actorId === dragon.id);
  assert('5a. save_success event fires', saveEvt !== undefined);

  const condEvt = rlog.events.find((e: any) =>
    e.type === 'condition_add' && e.actorId === dragon.id);
  assert('5b. NO condition_add event fires (save succeeded)',
    condEvt === undefined, `got: ${condEvt?.description}`);

  assert('5c. target does NOT have prone condition',
    !strongman.conditions.has('prone'));
}

// ============================================================
// 6. save_condition — Adult Blue Dragon "DC 15 CON or blinded"
//    (range 120 ft — verifies range gating with a save_condition action)
// ============================================================
console.log('\n--- 6. save_condition: Blue Dragon blinded (range gating) ---');
{
  const dragon = spawn('Adult Blue Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  // Blue Dragon::1 is save_condition (CON or blinded, range 120).
  forceLairAction(dragon, 'Blue Dragon::1');
  tankUp(dragon);

  // Target within 120 ft (range).
  const inRange = spawn('Goblin', { x: 5, y: 0, z: 0 });   // 25 ft away
  asEnemy(inRange);
  inRange.con = 1;   // -5 → fails DC 15 CON save
  inRange.saveProficiencies = { con: -100 };  // guarantees fail even on nat 20
  tankUp(inRange);

  // Target OUTSIDE 120 ft (range).
  const outRange = spawn('Goblin', { x: 25, y: 0, z: 0 });  // 125 ft away
  asEnemy(outRange);
  outRange.con = 1;
  outRange.saveProficiencies = { con: -100 };  // guarantees fail even on nat 20
  tankUp(outRange);

  const bf = makeBF([dragon, inRange, outRange]);
  const rlog = runCombat(bf, [dragon.id, inRange.id, outRange.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Only `inRange` should be hit.
  const condEvents = rlog.events.filter((e: any) =>
    e.type === 'condition_add' && e.actorId === dragon.id);
  const blindedIds = condEvents.filter((e: any) =>
    e.description.includes('blinded')).map((e: any) => e.targetId);
  assert('6a. inRange target gained blinded',
    blindedIds.includes(inRange.id),
    `blinded targets: ${JSON.stringify(blindedIds)}`);
  assert('6b. outRange target did NOT gain blinded',
    !blindedIds.includes(outRange.id),
    `blinded targets: ${JSON.stringify(blindedIds)}`);
}

// ============================================================
// 7. damage_no_save — Adult White Dragon "Jagged ice shards" (3d6 piercing)
//    No save — every target in range takes damage.
// ============================================================
console.log('\n--- 7. damage_no_save: White Dragon ice shards ---');
{
  const dragon = spawn('Adult White Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  // White Dragon::1 is damage_no_save (3d6 piercing, range 120).
  forceLairAction(dragon, 'White Dragon::1');
  tankUp(dragon);

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);
  const t2 = spawn('Goblin', { x: 10, y: 0, z: 0 });
  asEnemy(t2); tankUp(t2);

  const bf = makeBF([dragon, t1, t2]);
  const rlog = runCombat(bf, [dragon.id, t1.id, t2.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [damage_no_save].
  const headers = lairHeaderLogs(rlog).filter((e: any) => e.actorId === dragon.id);
  assert('7a. header fires with [damage_no_save]',
    headers.length === 1 && headers[0].description.includes('[damage_no_save]'));

  // Damage events fire for both targets (no save).
  const damages = rlog.events.filter((e: any) =>
    e.type === 'damage' && e.actorId === dragon.id &&
    e.description.includes('White Dragon::1'));
  assert('7b. ≥2 damage events (one per target, no save)',
    damages.length >= 2, `got ${damages.length}`);

  // Both targets took damage.
  assert('7c. t1 took damage', t1.currentHP < t1.maxHP,
    `t1 HP: ${t1.currentHP}/${t1.maxHP}`);
  assert('7d. t2 took damage', t2.currentHP < t2.maxHP,
    `t2 HP: ${t2.currentHP}/${t2.maxHP}`);

  // Damage event mentions piercing type.
  if (damages.length > 0) {
    assert('7e. damage event mentions piercing type',
      damages.some((d: any) => d.description.includes('piercing')));
  }

  // NO save_success / save_fail events FROM THE LAIR ACTION (damage_no_save).
  // (The dragon may fire legendary-action saves in the same round — filter
  // those out by checking the save event's description doesn't mention the
  // lair action's id.)
  const lairSaveEvents = rlog.events.filter((e: any) =>
    (e.type === 'save_success' || e.type === 'save_fail') &&
    e.actorId === dragon.id &&
    e.description.includes('White Dragon::1'));
  assert('7f. NO lair-action save events (damage_no_save)',
    lairSaveEvents.length === 0,
    `got ${lairSaveEvents.length}: ${lairSaveEvents.map((e:any)=>e.description).join(' | ')}`);
}

// ============================================================
// 8. damage_no_save — range gating
//    Target outside rangeFt (120 ft) is NOT hit.
// ============================================================
console.log('\n--- 8. damage_no_save: range gating ---');
{
  const dragon = spawn('Adult White Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  forceLairAction(dragon, 'White Dragon::1');
  tankUp(dragon);

  // Target at 100 ft (within 120 ft range).
  const inRange = spawn('Goblin', { x: 20, y: 0, z: 0 });   // 100 ft away
  asEnemy(inRange); tankUp(inRange);

  // Target at 150 ft (outside 120 ft range).
  const outRange = spawn('Goblin', { x: 30, y: 0, z: 0 });  // 150 ft away
  asEnemy(outRange); tankUp(outRange);

  const bf = makeBF([dragon, inRange, outRange]);
  const rlog = runCombat(bf, [dragon.id, inRange.id, outRange.id], {
    maxRounds: 1, verbose: false
  } as any);

  // inRange took damage.
  assert('8a. in-range target took damage',
    inRange.currentHP < inRange.maxHP,
    `HP: ${inRange.currentHP}/${inRange.maxHP}`);
  // outRange did NOT take damage.
  assert('8b. out-of-range target took 0 damage',
    outRange.currentHP === outRange.maxHP,
    `HP: ${outRange.currentHP}/${outRange.maxHP}`);
}

// ============================================================
// 9. spell_slot_regen — Lich "rolls d8, regains spell slot"
//    Verify: a spent slot is regained; "nothing happens" if no spent slots.
// ============================================================
console.log('\n--- 9. spell_slot_regen: Lich d8 ---');
{
  // 9a. With a spent slot → regains it.
  const lich1 = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich1);
  forceLairAction(lich1, 'Lich::0');   // spell_slot_regen
  tankUp(lich1);

  // Manually initialize + spend a slot (the planner would do this in a real
  // combat, but we want to deterministically test the regen handler).
  // The Lich's slots: 1:4, 2:3, 3:3, 4:3, 5:3, 6:1, 7:1, 8:1, 9:1 (max per level).
  // We need to trigger initMonsterSpellSlots then spend a slot. We can't
  // import initMonsterSpellSlots here (test should be engine-agnostic), so
  // we directly populate the runtime tracker to simulate a post-cast state.
  lich1.monsterSpellSlots = {
    1: { max: 4, remaining: 4 },   // full
    2: { max: 3, remaining: 3 },   // full
    3: { max: 3, remaining: 3 },   // full
    4: { max: 3, remaining: 2 },   // 1 spent
    5: { max: 3, remaining: 3 },
    6: { max: 1, remaining: 1 },
    7: { max: 1, remaining: 1 },
    8: { max: 1, remaining: 1 },
    9: { max: 1, remaining: 1 },
  };

  // Run 20 rounds — each round the Lich rolls d8 and may regain a slot.
  // With 1 spent level-4 slot, the Lich will regain it on any roll ≥ 4.
  // Track HP doesn't matter here; we just need the lair action to fire.
  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin); tankUp(goblin);

  const bf1 = makeBF([lich1, goblin]);
  const rlog1 = runCombat(bf1, [lich1.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Header fires with [spell_slot_regen].
  const headers1 = lairHeaderLogs(rlog1).filter((e: any) => e.actorId === lich1.id);
  assert('9a. header fires with [spell_slot_regen]',
    headers1.length === 1 &&
    headers1[0].description.includes('[spell_slot_regen]'));

  // Either a heal event (regained a slot) OR an "nothing happens" log.
  const regenLogs = rlog1.events.filter((e: any) =>
    (e.type === 'heal' && e.actorId === lich1.id &&
     e.description.includes('spell slot')) ||
    (e.type === 'action' && e.actorId === lich1.id &&
     e.description.includes('no spent spell slots')));
  assert('9b. either regen or "nothing happens" log fires',
    regenLogs.length >= 1, `got ${regenLogs.length}`);

  // The d8 roll is logged.
  const rollLog = rlog1.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich1.id &&
    e.description.includes('rolls d8'));
  assert('9c. d8 roll is logged', rollLog !== undefined);
  if (rollLog) {
    const m = rollLog.description.match(/d8 for spell slot regen: (\d)/);
    if (m) {
      const rolled = parseInt(m[1], 10);
      assert('9d. d8 roll is in 1..8 range',
        rolled >= 1 && rolled <= 8,
        `rolled ${rolled}`);
    }
  }

  // 9e. After enough rounds, a regen HEAL event fires at least once.
  //     To make this deterministic (not probabilistic), give the lich spent
  //     slots at EVERY level 1-8 → any d8 roll (1-8) will find a spent slot
  //     to regain. The lich only fires its lair action on round 1 (history
  //     blocks rounds 2+ since it has only 1 action), so this is a single-shot
  //     test — but with spent slots at every level, it ALWAYS succeeds
  //     regardless of the d8 roll.
  const lich2 = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich2); forceLairAction(lich2, 'Lich::0'); tankUp(lich2);
  lich2.monsterSpellSlots = {
    1: { max: 4, remaining: 3 },  // 1 spent
    2: { max: 3, remaining: 2 },  // 1 spent
    3: { max: 3, remaining: 2 },  // 1 spent
    4: { max: 3, remaining: 2 },  // 1 spent
    5: { max: 3, remaining: 2 },  // 1 spent
    6: { max: 1, remaining: 0 },  // 1 spent
    7: { max: 1, remaining: 0 },  // 1 spent
    8: { max: 1, remaining: 0 },  // 1 spent
    9: { max: 1, remaining: 1 },  // full (no regain at level 9 — d8 maxes at 8)
  };
  const goblin2 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin2); tankUp(goblin2);
  const bf2 = makeBF([lich2, goblin2]);
  const rlog2 = runCombat(bf2, [lich2.id, goblin2.id], {
    maxRounds: 3, verbose: false
  } as any);

  // At least one HEAL event mentioning "spell slot" should fire.
  // (Deterministic: every d8 roll 1-8 finds a spent slot at that level.)
  const healEvents = rlog2.events.filter((e: any) =>
    e.type === 'heal' && e.actorId === lich2.id &&
    e.description.includes('spell slot'));
  assert('9e. ≥1 spell-slot regen heal event fires (deterministic)',
    healEvents.length >= 1,
    `got ${healEvents.length} heal events`);

  // 9f. "Nothing happens" case: no spent slots → lair action is wasted.
  const lich3 = spawn('Lich', { x: 0, y: 0, z: 0 });
  asParty(lich3); forceLairAction(lich3, 'Lich::0'); tankUp(lich3);
  lich3.monsterSpellSlots = {
    1: { max: 4, remaining: 4 }, 2: { max: 3, remaining: 3 },
    3: { max: 3, remaining: 3 }, 4: { max: 3, remaining: 3 },
    5: { max: 3, remaining: 3 }, 6: { max: 1, remaining: 1 },
    7: { max: 1, remaining: 1 }, 8: { max: 1, remaining: 1 },
    9: { max: 1, remaining: 1 },
  };
  const goblin3 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(goblin3); tankUp(goblin3);
  const bf3 = makeBF([lich3, goblin3]);
  const rlog3 = runCombat(bf3, [lich3.id, goblin3.id], {
    maxRounds: 1, verbose: false
  } as any);
  const nothingLog = rlog3.events.find((e: any) =>
    e.type === 'action' && e.actorId === lich3.id &&
    e.description.includes('no spent spell slots'));
  assert('9f. "no spent spell slots — nothing happens" logged',
    nothingLog !== undefined, 'no "nothing happens" log found');
}

// ============================================================
// 10. Targeting: lair creature is never its own target
//     (Even when targetsEnemies=false, the handler should skip self for
//      damage-dealing actions. The selectLairActionTargets helper DOES
//      include self in the ally list, but handlers filter self out.)
// ============================================================
console.log('\n--- 10. Lair creature never damages itself ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  forceLairAction(dragon, 'Red Dragon::0');   // save_damage
  tankUp(dragon);
  noLegendary(dragon);

  const ally = spawn('Goblin', { x: 5, y: 0, z: 0 });
  ally.faction = 'party';   // same faction as dragon
  tankUp(ally);

  // Force the action to target allies (override targetsEnemies=false).
  // The parsed action has targetsEnemies=true (Red Dragon magma hits
  // enemies). To test self-damage-prevention, we override to false so
  // the dragon's faction (party) becomes targets — including the dragon.
  const action = dragon.lairActions!.actions[0];
  (action as any).targetsEnemies = false;

  const bf = makeBF([dragon, ally]);
  const rlog = runCombat(bf, [dragon.id, ally.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Dragon should NOT have damaged itself.
  const selfDamage = rlog.events.filter((e: any) =>
    e.type === 'damage' && e.actorId === dragon.id &&
    e.targetId === dragon.id);
  assert('10a. dragon did NOT damage itself',
    selfDamage.length === 0,
    `self-damage events: ${selfDamage.length}`);
  // Dragon HP unchanged.
  assert('10b. dragon HP unchanged',
    dragon.currentHP === dragon.maxHP,
    `dragon HP: ${dragon.currentHP}/${dragon.maxHP}`);
  // Ally DID take damage (ally is a valid target).
  assert('10c. ally took damage',
    ally.currentHP < ally.maxHP,
    `ally HP: ${ally.currentHP}/${ally.maxHP}`);
}

// ============================================================
// 11. Targeting: dead/unconscious targets are skipped
// ============================================================
console.log('\n--- 11. Dead/unconscious targets are skipped ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  forceLairAction(dragon, 'Red Dragon::0');
  tankUp(dragon);
  noLegendary(dragon);

  const dead = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(dead);
  dead.isDead = true;
  dead.currentHP = 0;
  tankUp(dead);

  const alive = spawn('Goblin', { x: 6, y: 0, z: 0 });
  asEnemy(alive);
  tankUp(alive);

  const bf = makeBF([dragon, dead, alive]);
  const rlog = runCombat(bf, [dragon.id, dead.id, alive.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Save event fires only for the alive target.
  const saveEvents = rlog.events.filter((e: any) =>
    (e.type === 'save_success' || e.type === 'save_fail') &&
    e.actorId === dragon.id);
  assert('11a. only 1 save event (alive target only)',
    saveEvents.length === 1, `got ${saveEvents.length}`);

  // No save/damage event for the dead target.
  const deadEvents = rlog.events.filter((e: any) =>
    e.targetId === dead.id &&
    (e.type === 'save_success' || e.type === 'save_fail' || e.type === 'damage'));
  assert('11b. NO save/damage events for dead target',
    deadEvents.length === 0, `got ${deadEvents.length}`);
}

// ============================================================
// 12. Combat log: header + mechanical events appear in order
//     Header log line comes BEFORE the per-target save/damage events.
// ============================================================
console.log('\n--- 12. Log ordering: header before per-target events ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  asParty(dragon);
  forceLairAction(dragon, 'Red Dragon::0');
  tankUp(dragon);

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1); tankUp(t1);

  const bf = makeBF([dragon, t1]);
  const rlog = runCombat(bf, [dragon.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  const events = rlog.events;
  const headerIdx = events.findIndex((e: any) =>
    e.type === 'action' && e.actorId === dragon.id &&
    e.description.includes('takes a lair action'));
  const firstMechanicalIdx = events.findIndex((e: any) =>
    (e.type === 'save_success' || e.type === 'save_fail' || e.type === 'damage') &&
    e.actorId === dragon.id);

  assert('12a. header log exists', headerIdx !== -1);
  assert('12b. mechanical event exists', firstMechanicalIdx !== -1);
  if (headerIdx !== -1 && firstMechanicalIdx !== -1) {
    assert('12c. header fires BEFORE mechanical events',
      headerIdx < firstMechanicalIdx,
      `header@${headerIdx} >= mechanical@${firstMechanicalIdx}`);
  }
}

// ============================================================
// 13. Aboleth save_damage (psychic) — different damage type
//     Verifies the handler works for non-fire damage types.
// ============================================================
console.log('\n--- 13. Aboleth save_damage (psychic) ---');
{
  const aboleth = spawn('Aboleth', { x: 0, y: 0, z: 0 });
  asParty(aboleth);
  // Aboleth::2 is save_damage (DC 14 WIS, 2d6 psychic, range 90).
  forceLairAction(aboleth, 'Aboleth::2');
  tankUp(aboleth);
  noLegendary(aboleth);

  const t1 = spawn('Goblin', { x: 5, y: 0, z: 0 });
  asEnemy(t1);
  t1.wis = 1;   // fails WIS save
  t1.saveProficiencies = { wis: -100 };  // guarantees fail even on nat 20
  tankUp(t1);

  const bf = makeBF([aboleth, t1]);
  const rlog = runCombat(bf, [aboleth.id, t1.id], {
    maxRounds: 1, verbose: false
  } as any);

  // Save event mentions WIS save.
  const saveEvt = rlog.events.find((e: any) =>
    (e.type === 'save_success' || e.type === 'save_fail') &&
    e.actorId === aboleth.id);
  assert('13a. save event fires', saveEvt !== undefined);
  if (saveEvt) {
    assert('13b. save event mentions WIS save',
      saveEvt.description.includes('WIS'));
    assert('13c. save event mentions DC 14',
      saveEvt.description.includes('DC 14'));
  }

  // Damage event mentions psychic type.
  const dmgEvt = rlog.events.find((e: any) =>
    e.type === 'damage' && e.actorId === aboleth.id &&
    e.description.includes('Aboleth::2'));
  assert('13d. damage event fires', dmgEvt !== undefined);
  if (dmgEvt) {
    assert('13e. damage event mentions psychic type',
      dmgEvt.description.includes('psychic'));
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
