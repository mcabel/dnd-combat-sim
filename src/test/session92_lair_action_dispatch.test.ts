// ============================================================
// Test: Session 92 — RFC-LAIRACTIONS Phase 2
//       Engine dispatch infrastructure (initiative-count-20 boundary,
//       isInLair flag, per-creature 2-entry history, OOS/deferred
//       logging, multi-creature CR ordering, stub category handlers)
//
// Validates the Phase 2 engine-layer deliverable (RFC-LAIRACTIONS §8 Phase 2):
//   1. `Combatant.isInLair` flag ([DD-1]) — parser default `true` when
//      `lairActions` defined; `false` skips the creature entirely.
//   2. `Combatant.initiativeScore` ([DD-2]) — numeric score; the round loop
//      inserts a lair-action checkpoint at the boundary between creatures
//      with `initiativeScore ≥ 20` (act BEFORE lair actions) and those with
//      `< 20` (act AFTER). Edge case: all ≥ 20 → lair actions fire at the
//      END of the round. No scores (legacy) → fires at round start (the
//      original Session 60 stub behavior — backward compat).
//   3. `Combatant._lairActionHistory` ([DD-5]) — last 2 chosen action IDs;
//      selector excludes any action in the history. If ALL available
//      actions are in history (≤2 options), the creature SKIPS its lair
//      action that round (PHB: "can't use the same effect two rounds in a
//      row" — no legal option).
//   4. Multiple lair creatures in one combat ([DD-3]) — sorted by descending
//      CR (tie-break: alphabetical name) so the highest-CR creature's lair
//      action fires first.
//   5. Out-of-scope / deferred actions are LOGGED with their stable IDs
//      (`lair_oos_*` / `lair_def_*`) but NOT executed mechanically (RFC §4,
//      [DD-7]). Real MM deferred creatures: Androsphinx (lair_def_006 +
//      lair_def_008), Adult/Ancient Black Dragon (lair_def_001).
//   6. In-scope actions route through `executeLairAction` — Phase 2 STUB
//      that logs the chosen action + category + (spell tag if isSpell) +
//      "Phase 2 stub — not yet implemented". NO mechanical effect yet
//      (Phase 3 wires real handlers per category).
//   7. Dead / unconscious lair creatures do NOT fire lair actions.
//
// Run: npx ts-node --transpile-only src/test/session92_lair_action_dispatch.test.ts
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

/** Find all lair-action log entries in a CombatLog. */
function lairLogs(log: any): any[] {
  return log.events.filter((e: any) =>
    e.type === 'action' && e.description.includes('lair action'));
}

/** Tank up a creature so it survives N rounds of stub combat. */
function tankUp(c: Combatant): void {
  c.maxHP = 100_000;
  c.currentHP = 100_000;
}

// ============================================================
// 1. Parser default: isInLair === true when lairActions defined
// ============================================================
console.log('\n--- 1. Parser default: isInLair === true when lairActions defined ---');
{
  const dragon = spawn('Adult Red Dragon');
  assert('1a. Adult Red Dragon isInLair === true (parser default)',
    dragon.isInLair === true,
    `got ${dragon.isInLair}`);

  const aboleth = spawn('Aboleth');
  assert('1b. Aboleth isInLair === true (parser default)',
    aboleth.isInLair === true,
    `got ${aboleth.isInLair}`);

  const goblin = spawn('Goblin');
  // Goblin has no lairActions → isInLair should be undefined (not true).
  assert('1c. Goblin isInLair === undefined (no lairActions)',
    goblin.isInLair === undefined,
    `got ${goblin.isInLair}`);
}

// ============================================================
// 2. isInLair === false → no lair action fires ([DD-1])
// ============================================================
console.log('\n--- 2. isInLair === false suppresses lair actions ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  dragon.isInLair = false;   // dragon ambushed in a field — RFC [DD-1]
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  // No initiativeScore → fires at round start (legacy compat path)
  const log1 = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 2, verbose: false } as any);
  const ll = lairLogs(log1);

  assert('2a. zero lair-action logs when isInLair=false', ll.length === 0,
    `got ${ll.length} lair-action log(s)`);
  if (ll.length > 0) {
    console.log(`    unexpected: ${ll[0].description.substring(0, 120)}...`);
  }
}

// ============================================================
// 3. isInLair === true → lair action fires ([DD-1])
// ============================================================
console.log('\n--- 3. isInLair === true fires lair actions ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  // isInLair is already true from the parser
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const log1 = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 2, verbose: false } as any);
  const ll = lairLogs(log1);

  assert('3a. lair-action logs fire when isInLair=true', ll.length >= 2,
    `got ${ll.length}`);
  assert('3b. log mentions dragon name',
    ll.some((e: any) => e.description.includes('Adult Red Dragon')));
}

// ============================================================
// 4. Phase 3 dispatcher: in-scope action log format
//    (Phase 3a implements save_damage — the Red Dragon's first action is
//     save_damage, so it now fires real mechanical events instead of the
//     "Phase 2 stub" log. This test verifies the header log format.)
// ============================================================
console.log('\n--- 4. Phase 3 dispatcher: header log format ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const log1 = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
  const ll = lairLogs(log1);

  assert('4a. at least one lair log', ll.length >= 1);
  if (ll.length > 0) {
    const desc = ll[0].description;
    // The category should appear in square brackets, e.g. "[save_damage]"
    assert('4b. log includes [category] tag', /\[[a-z_]+\]/.test(desc),
      `no [category] tag in: ${desc.substring(0, 120)}`);
    assert('4c. log includes "initiative count 20"', desc.includes('initiative count 20'));
    // Phase 3a: save_damage is now implemented — the header does NOT say
    // "Phase 2 stub" for save_damage actions. (It DOES still say "not yet
    // implemented" for unimplemented categories like bespoke/buff_ally.)
    assert('4d. header does NOT mention "Phase 2 stub" (save_damage implemented)',
      !desc.includes('Phase 2 stub'),
      `unexpected stub marker: ${desc.substring(0, 120)}`);
    console.log(`    Example: ${desc.substring(0, 140)}...`);
  }
}

// ============================================================
// 5. History: "can't repeat same effect 2 rounds in a row" ([DD-5])
//    Adult Red Dragon has 4 actions. Run 3 rounds; verify each round's
//    chosen action ID differs from the previous round's.
// ============================================================
console.log('\n--- 5. History: never repeats same effect 2 rounds in a row ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);

  // Pre-compute action ID → rawText prefix mapping (first 80 chars) so we can
  // identify which action fired each round from the log description.
  const actions = dragon.lairActions!.actions;
  const idToPrefix: Record<string, string> = {};
  for (const a of actions) {
    idToPrefix[a.id] = a.rawText.substring(0, 80);
  }

  // Run 3 rounds, one round at a time, capturing the lair-action ID each round.
  const firedIds: string[] = [];
  for (let r = 1; r <= 3; r++) {
    const rlog = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
    const ll = lairLogs(rlog).filter((e: any) => e.actorId === dragon.id);
    assert(`5.${r}. round ${r} fired exactly 1 lair action`, ll.length === 1,
      `got ${ll.length}`);
    if (ll.length === 1) {
      const desc = ll[0].description;
      // Match the description's text prefix to one of the action IDs.
      const matched = actions.find(a => desc.includes(a.rawText.substring(0, 50)));
      assert(`5.${r}. round ${r} log matches a known action`, matched !== undefined,
        `no match in: ${desc.substring(0, 120)}`);
      if (matched) firedIds.push(matched.id);
    }
  }

  console.log(`    Fired action IDs by round: ${JSON.stringify(firedIds)}`);
  // With the Phase 4 max-score selector (RFC §7) + 2-entry history:
  //   round 1 → Red Dragon::0 (save_damage 6d6 fire, highest expected damage)
  //   round 2 → Red Dragon::2 (poisoned+incapacitated save_condition, next-best EV)
  //   round 3 → Red Dragon::1 (prone save_condition, last in-scope option left)
  // (Red Dragon::3 is a summon flattening artifact — scored -1000 by the
  //  scorer, never picked unless sole candidate.)
  //
  // Scoring rationale (Goblin target, dex 14 (+2 mod), con 10 (+0 mod)):
  //   - ::0: P(fail DC 15 DEX) ≈ 0.6, avgDmg=21 → EV ≈ 0.6×21 + 0.4×10.5 = 16.8
  //   - ::1: P(fail DC 15 DEX) ≈ 0.6, prone weight=10 → EV ≈ 6
  //   - ::2: P(fail DC 13 CON) ≈ 0.6, poisoned(15)+incapacitated(12)=27 → EV ≈ 16.2
  //   - ::3: flattening artifact → -1000
  // Round 1: max(16.8, 6, 16.2, -1000) = ::0
  // Round 2 (history=[::0]): max(6, 16.2, -1000) = ::2
  // Round 3 (history=[::0, ::2]): max(6, -1000) = ::1
  eq('5d. round 1 picked Red Dragon::0', firedIds[0], 'Red Dragon::0');
  eq('5e. round 2 picked Red Dragon::2', firedIds[1], 'Red Dragon::2');
  eq('5f. round 3 picked Red Dragon::1', firedIds[2], 'Red Dragon::1');
  // Verify the 2-entry history is correctly maintained after 3 rounds.
  assert('5g. _lairActionHistory has length 2 after 3 rounds',
    dragon._lairActionHistory?.length === 2,
    `got ${JSON.stringify(dragon._lairActionHistory)}`);
  eq('5h. history[0] is Red Dragon::2 (oldest of last 2)',
    dragon._lairActionHistory?.[0], 'Red Dragon::2');
  eq('5i. history[1] is Red Dragon::1 (most recent)',
    dragon._lairActionHistory?.[1], 'Red Dragon::1');
}

// ============================================================
// 6. History edge case: 2-action creature skips on round 3 ([DD-5])
//    Truncate Adult Red Dragon to 2 actions; run 3 rounds; round 3
//    should log the "no available lair actions" skip message.
// ============================================================
console.log('\n--- 6. History edge case: 2 actions → skip on round 3 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  // Truncate to 2 actions (forces the ≤2-options edge case).
  dragon.lairActions!.actions = dragon.lairActions!.actions.slice(0, 2);
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);

  // Round 1: history=[], pick Red Dragon::0
  const r1 = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
  const r1Lair = lairLogs(r1).filter((e: any) => e.actorId === dragon.id && !e.description.includes('no available'));
  assert('6a. round 1 fires a lair action', r1Lair.length === 1, `got ${r1Lair.length}`);

  // Round 2: history=[::0], pick Red Dragon::1
  const r2 = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
  const r2Lair = lairLogs(r2).filter((e: any) => e.actorId === dragon.id && !e.description.includes('no available'));
  assert('6b. round 2 fires a lair action', r2Lair.length === 1, `got ${r2Lair.length}`);

  // Round 3: history=[::0, ::1], candidates={}. Should log "no available".
  const r3 = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
  const r3Skip = lairLogs(r3).filter((e: any) =>
    e.actorId === dragon.id && e.description.includes('no available'));
  assert('6c. round 3 logs "no available lair actions" (skip)',
    r3Skip.length === 1, `got ${r3Skip.length}`);
  if (r3Skip.length === 1) {
    console.log(`    Skip msg: ${r3Skip[0].description.substring(0, 120)}...`);
  }
}

// ============================================================
// 7. Deferred action logging ([DD-7]) — Androsphinx
//    Androsphinx has 4 actions, 2 of which are deferred:
//      - lair_def_006 (meta-initiative): reroll initiative
//      - lair_def_008 (meta-time): time moves 10 years
//    In-scope actions fire rounds 1-2; round 3 falls back to deferred.
// ============================================================
console.log('\n--- 7. Deferred action logging (Androsphinx) ---');
{
  const sphinx = spawn('Androsphinx', { x: 0, y: 0, z: 0 });
  sphinx.faction = 'party';
  tankUp(sphinx);

  // Verify the parser tagged the deferred actions correctly.
  const actions = sphinx.lairActions!.actions;
  const defActions = actions.filter(a => a.deferred);
  assert('7a. Androsphinx has 2 deferred actions', defActions.length === 2,
    `got ${defActions.length}`);
  assert('7b. lair_def_006 present',
    defActions.some(a => a.deferredId === 'lair_def_006'));
  assert('7c. lair_def_008 present',
    defActions.some(a => a.deferredId === 'lair_def_008'));

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([sphinx, goblin]);

  // Run 4 rounds: rounds 1-2 fire in-scope actions, round 3 fires deferred,
  // round 4 either in-scope (one of them rotated out of history) or deferred.
  let deferredLogSeen = false;
  for (let r = 1; r <= 4; r++) {
    const rlog = runCombat(bf, [sphinx.id, goblin.id], { maxRounds: 1, verbose: false } as any);
    const ll = lairLogs(rlog).filter((e: any) => e.actorId === sphinx.id);
    if (ll.some((e: any) => e.description.includes('deferred'))) {
      deferredLogSeen = true;
      const dl = ll.find((e: any) => e.description.includes('deferred'))!;
      console.log(`    Round ${r} deferred: ${dl.description.substring(0, 130)}...`);
      assert(`7d. round ${r} deferred log mentions "deferred:"`,
        dl.description.includes('deferred:'));
      assert(`7e. round ${r} deferred log mentions "logged, not executed"`,
        dl.description.includes('logged, not executed'));
      // The deferred ID (lair_def_006 or lair_def_008) should appear in the log.
      const hasId = dl.description.includes('lair_def_006') ||
                    dl.description.includes('lair_def_008');
      assert(`7f. round ${r} deferred log mentions a lair_def_* ID`, hasId,
        `no lair_def_* ID in: ${dl.description.substring(0, 120)}`);
    }
  }
  assert('7g. at least one deferred log fired across 4 rounds',
    deferredLogSeen, 'no deferred log was emitted');
}

// ============================================================
// 8. Out-of-scope action logging ([DD-7]) — synthetic
//    No MM creature has out-of-scope actions (all OOS creatures are in
//    MTF/VRGR). Construct a synthetic Combatant with an OOS-tagged
//    LairAction and verify the log format.
// ============================================================
console.log('\n--- 8. Out-of-scope action logging (synthetic) ---');
{
  // Build a synthetic lair creature with one OOS action.
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  // Replace actions with a single synthetic OOS-tagged action.
  const syntheticOOS: LairAction = {
    id: 'Synthetic::0',
    sourceCreature: 'Synthetic',
    rawText: 'The lair reshapes itself in a permanent, purely-narrative way with no combat mechanical effect.',
    outOfScope: true,
    outOfScopeId: 'lair_oos_test_001',
    isMagical: true,
    isSpell: false,
    targetsEnemies: false,
    category: 'flavor',
  };
  dragon.lairActions!.actions = [syntheticOOS];
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const rlog = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
  const ll = lairLogs(rlog).filter((e: any) => e.actorId === dragon.id);

  assert('8a. exactly 1 lair-action log fired', ll.length === 1, `got ${ll.length}`);
  if (ll.length === 1) {
    const desc = ll[0].description;
    console.log(`    OOS log: ${desc.substring(0, 140)}...`);
    assert('8b. log mentions "out of scope"', desc.includes('out of scope'));
    assert('8c. log mentions "logged, not executed"', desc.includes('logged, not executed'));
    assert('8d. log mentions lair_oos_test_001 ID', desc.includes('lair_oos_test_001'));
    assert('8e. log does NOT mention "Phase 2 stub"',
      !desc.includes('Phase 2 stub'),
      `should not have stub marker for OOS action`);
  }
}

// ============================================================
// 9. Multi-creature CR ordering ([DD-3])
//    Adult Red Dragon (CR 17) + Aboleth (CR 10). Both are lair creatures.
//    Resolve order should be: dragon first (higher CR), then aboleth.
//    We verify by checking the actor IDs of consecutive lair-action logs.
// ============================================================
console.log('\n--- 9. Multi-creature CR ordering (descending CR) ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  tankUp(dragon);

  const aboleth = spawn('Aboleth', { x: 5, y: 0, z: 0 });
  aboleth.faction = 'party';  // same faction so both survive
  tankUp(aboleth);

  const goblin = spawn('Goblin', { x: 10, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, aboleth, goblin]);
  const rlog = runCombat(bf, [dragon.id, aboleth.id, goblin.id], {
    maxRounds: 1, verbose: false
  } as any);
  const ll = lairLogs(rlog);

  // Both creatures should fire a lair action this round.
  const dragonLogs = ll.filter((e: any) => e.actorId === dragon.id && !e.description.includes('no available'));
  const abolethLogs = ll.filter((e: any) => e.actorId === aboleth.id && !e.description.includes('no available'));
  assert('9a. dragon fired a lair action', dragonLogs.length >= 1, `got ${dragonLogs.length}`);
  assert('9b. aboleth fired a lair action', abolethLogs.length >= 1, `got ${abolethLogs.length}`);

  // The dragon's lair action should appear BEFORE the aboleth's in the event list.
  if (dragonLogs.length > 0 && abolethLogs.length > 0) {
    const dragonIdx = ll.indexOf(dragonLogs[0]);
    const abolethIdx = ll.indexOf(abolethLogs[0]);
    assert('9c. dragon fires before aboleth (descending CR)',
      dragonIdx < abolethIdx,
      `dragon at ${dragonIdx}, aboleth at ${abolethIdx}`);
  }
}

// ============================================================
// 10. Initiative-count-20 boundary ([DD-2])
//     PC at init 25 (acts BEFORE lair action) + dragon lair creature at
//     init 15 (acts AFTER lair action). Verify: PC's turn, then lair
//     action, then dragon's turn — in that order in the event log.
// ============================================================
console.log('\n--- 10. Init-20 boundary: PC@25 → lair action → dragon@15 ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  dragon.initiativeScore = 15;   // below 20 — acts AFTER lair action
  tankUp(dragon);

  const pc = spawn('Goblin', { x: 5, y: 0, z: 0 });   // use Goblin as a stand-in "PC"
  pc.faction = 'enemy';
  pc.name = 'FastPc';   // rename so we can identify it in logs
  pc.initiativeScore = 25;   // above 20 — acts BEFORE lair action
  tankUp(pc);

  const bf = makeBF([pc, dragon]);
  // initiative array in descending order of initiativeScore
  const rlog = runCombat(bf, [pc.id, dragon.id], { maxRounds: 1, verbose: false } as any);

  // Find indices: PC's first action, lair action, dragon's first turn event.
  // The dragon's TURN produces events of types: action / dash / disengage /
  // dodge / move / attack_* / damage / heal / condition_* / save_*.
  // But the dragon's LEGENDARY ACTION window (fires after the PC's turn, on
  // the PC's iter) ALSO produces attack_*/damage/save_* events with
  // actorId=dragon. To distinguish, we look ONLY at the "turn-starting"
  // event types — action / dash / disengage / dodge / move — which a
  // legendary action never emits (legendary_action is its own type, and the
  // save/damage aftereffects come AFTER the legendary_action log).
  const TURN_START_TYPES = new Set(['action', 'dash', 'disengage', 'dodge', 'move']);
  const events = rlog.events;
  const pcIdx = events.findIndex((e: any) => e.actorId === pc.id &&
    TURN_START_TYPES.has(e.type) &&
    !(e.type === 'action' && e.description.includes('lair action')));
  const lairIdx = events.findIndex((e: any) =>
    e.type === 'action' && e.description.includes('lair action') &&
    e.actorId === dragon.id);
  const dragonTurnIdx = events.findIndex((e: any) =>
    e.actorId === dragon.id &&
    TURN_START_TYPES.has(e.type) &&
    !(e.type === 'action' && e.description.includes('lair action')));

  assert('10a. PC has an action log', pcIdx !== -1);
  assert('10b. dragon has a lair-action log', lairIdx !== -1);
  assert('10c. dragon has a non-lair action log (its turn)', dragonTurnIdx !== -1);

  if (pcIdx !== -1 && lairIdx !== -1 && dragonTurnIdx !== -1) {
    console.log(`    PC@${pcIdx}  lair@${lairIdx}  dragonTurn@${dragonTurnIdx}`);
    assert('10d. PC acts BEFORE lair action', pcIdx < lairIdx,
      `pc@${pcIdx} >= lair@${lairIdx}`);
    assert('10e. lair action fires BEFORE dragon turn', lairIdx < dragonTurnIdx,
      `lair@${lairIdx} >= dragonTurn@${dragonTurnIdx}`);
  }
}

// ============================================================
// 11. Init-20 boundary: lair creature at init 22 (≥ 20) fires AFTER its own turn
//     Dragon@22 → Dragon's turn → PC@15 → lair action fires BEFORE PC's turn
// ============================================================
console.log('\n--- 11. Init-20 boundary: dragon@22 → lair action after dragon turn ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  dragon.initiativeScore = 22;   // ≥ 20 — dragon acts BEFORE lair action
  tankUp(dragon);

  const pc = spawn('Goblin', { x: 5, y: 0, z: 0 });
  pc.faction = 'enemy';
  pc.name = 'SlowPc';
  pc.initiativeScore = 15;   // < 20 — PC's turn triggers the lair checkpoint
  tankUp(pc);

  const bf = makeBF([dragon, pc]);
  const rlog = runCombat(bf, [dragon.id, pc.id], { maxRounds: 1, verbose: false } as any);

  const events = rlog.events;
  // (See test 10 for why we restrict to TURN_START_TYPES — legendary action
  // aftereffects would otherwise be misidentified as the dragon's turn.)
  const TURN_START_TYPES = new Set(['action', 'dash', 'disengage', 'dodge', 'move']);
  const dragonTurnIdx = events.findIndex((e: any) =>
    e.actorId === dragon.id &&
    TURN_START_TYPES.has(e.type) &&
    !(e.type === 'action' && e.description.includes('lair action')));
  const lairIdx = events.findIndex((e: any) =>
    e.type === 'action' && e.description.includes('lair action') &&
    e.actorId === dragon.id);
  const pcIdx = events.findIndex((e: any) =>
    e.actorId === pc.id &&
    TURN_START_TYPES.has(e.type) &&
    !(e.type === 'action' && e.description.includes('lair action')));

  assert('11a. dragon has a turn log', dragonTurnIdx !== -1);
  assert('11b. dragon has a lair-action log', lairIdx !== -1);

  if (dragonTurnIdx !== -1 && lairIdx !== -1) {
    console.log(`    dragonTurn@${dragonTurnIdx}  lair@${lairIdx}  pc@${pcIdx}`);
    assert('11c. dragon turn BEFORE lair action (init ≥ 20)',
      dragonTurnIdx < lairIdx,
      `dragonTurn@${dragonTurnIdx} >= lair@${lairIdx}`);
    if (pcIdx !== -1) {
      assert('11d. lair action BEFORE PC turn (init < 20)',
        lairIdx < pcIdx,
        `lair@${lairIdx} >= pc@${pcIdx}`);
    }
  }
}

// ============================================================
// 12. Legacy compat: no initiativeScore → fires at round start
//     (Preserves the original Session 60 stub behavior for scenarios
//      that pass only `initiative: string[]` without numeric scores.)
// ============================================================
console.log('\n--- 12. Legacy compat: no initiativeScore → fires at round start ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  // Do NOT set initiativeScore — simulates a legacy scenario.
  assert('12a. dragon initiativeScore is undefined (legacy)',
    dragon.initiativeScore === undefined);
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const rlog = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);

  // Lair action should fire BEFORE any actor's turn (round-start fallback).
  const events = rlog.events;
  const lairIdx = events.findIndex((e: any) =>
    e.type === 'action' && e.description.includes('lair action') &&
    e.actorId === dragon.id);
  const firstTurnIdx = events.findIndex((e: any) =>
    e.type === 'action' && !e.description.includes('lair action') &&
    !e.description.includes('Combat'));

  assert('12b. a lair action fired', lairIdx !== -1);
  if (lairIdx !== -1 && firstTurnIdx !== -1) {
    console.log(`    lair@${lairIdx}  firstTurn@${firstTurnIdx}`);
    assert('12c. lair action fires before any actor turn',
      lairIdx < firstTurnIdx,
      `lair@${lairIdx} >= firstTurn@${firstTurnIdx}`);
  }
}

// ============================================================
// 13. Dead creature does NOT fire lair actions
// ============================================================
console.log('\n--- 13. Dead creature does NOT fire lair actions ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  dragon.isDead = true;
  dragon.currentHP = 0;
  tankUp(dragon);   // (no-op since isDead short-circuits, but defensive)

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const rlog = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
  const ll = lairLogs(rlog).filter((e: any) => e.actorId === dragon.id);

  assert('13a. dead dragon fires ZERO lair-action logs',
    ll.length === 0, `got ${ll.length}`);
}

// ============================================================
// 14. Unconscious creature does NOT fire lair actions
// ============================================================
console.log('\n--- 14. Unconscious creature does NOT fire lair actions ---');
{
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  dragon.faction = 'party';
  dragon.isUnconscious = true;
  dragon.currentHP = 0;
  tankUp(dragon);

  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  goblin.faction = 'enemy';
  tankUp(goblin);

  const bf = makeBF([dragon, goblin]);
  const rlog = runCombat(bf, [dragon.id, goblin.id], { maxRounds: 1, verbose: false } as any);
  const ll = lairLogs(rlog).filter((e: any) => e.actorId === dragon.id);

  assert('14a. unconscious dragon fires ZERO lair-action logs',
    ll.length === 0, `got ${ll.length}`);
}

// ============================================================
// 15. rollInitiative stores initiativeScore on combatants ([DD-2])
// ============================================================
console.log('\n--- 15. rollInitiative stores initiativeScore on combatants ---');
{
  const { rollInitiative } = require('../engine/utils');
  const dragon = spawn('Adult Red Dragon', { x: 0, y: 0, z: 0 });
  const goblin = spawn('Goblin', { x: 5, y: 0, z: 0 });
  const bf = makeBF([dragon, goblin]);
  const order = rollInitiative(bf);

  assert('15a. rollInitiative returns 2 IDs', order.length === 2);
  assert('15b. dragon initiativeScore is set (number)',
    typeof dragon.initiativeScore === 'number',
    `got ${typeof dragon.initiativeScore}`);
  assert('15c. goblin initiativeScore is set (number)',
    typeof goblin.initiativeScore === 'number',
    `got ${typeof goblin.initiativeScore}`);
  // Sanity: initiative scores are in a reasonable d20 + DEX mod range (1-30).
  assert('15d. dragon initiativeScore in 1..30 range',
    (dragon.initiativeScore ?? 0) >= 1 && (dragon.initiativeScore ?? 0) <= 30,
    `got ${dragon.initiativeScore}`);
  // The order should be descending by score.
  const dragonIdx = order.indexOf(dragon.id);
  const goblinIdx = order.indexOf(goblin.id);
  if (dragon.initiativeScore! > goblin.initiativeScore!) {
    assert('15e. higher-init creature goes first in order', dragonIdx < goblinIdx);
  } else if (goblin.initiativeScore! > dragon.initiativeScore!) {
    assert('15e. higher-init creature goes first in order', goblinIdx < dragonIdx);
  } else {
    // tie — skip this assertion (tie-breaker is random)
    console.log('  ⚠️  15e skipped — initiative tie');
  }
}

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
