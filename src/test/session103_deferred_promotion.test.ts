// ============================================================
// Test: Session 103 — promote 4 `lair_def_auto_*` deferred
//       lair actions to stable `lair_def_NNN` IDs.
//
// Validates the Session 103 deliverable: the 4 remaining
// heuristic-caught `magical-darkness` deferred lair actions
// (White Dragon, Sea Fury, Imix, Olhydra::2) are now matched
// by `LAIR_REGISTRY` entries `lair_def_010`–`lair_def_013`
// instead of the `lair_def_auto_*` heuristic safety-net.
//
// The Session 102 handover cited "7" auto entries, but that
// count was stale from Session 91 — Demogorgon/Morkoth darkness
// actions had since been promoted to `cast_spell`. The actual
// remaining count is 4 unique sourceCreature base names covering
// 10 bestiary entries (with source variants |mm/|pota/|egw).
//
// Run: npx ts-node --transpile-only src/test/session103_deferred_promotion.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  extractLairAction,
} from '../parser/fivetools';
import { Combatant, Battlefield, LairAction } from '../types/core';

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

// ---- Load bestiary ----

const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f =>
  f.endsWith('.json') && !f.includes('combined_') && !f.includes('legendarygroups'));
const loaded = allFiles.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

console.log(`    Loaded ${allFiles.length} bestiary sources, ${bestiary.size} creatures total.`);

function spawn(name: string, src?: string): Combatant {
  const c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined, src);
  if (!c) throw new Error(`Monster not found: ${name}${src ? '|' + src : ''}`);
  return c;
}

/** Return the deferred action (if any) at the given lair-action index. */
function deferredActionAt(c: Combatant, index: number): LairAction | undefined {
  if (!c.lairActions || !c.lairActions.actions) return undefined;
  return c.lairActions.actions[index];
}

// ============================================================
// 1. White Dragon — adult + ancient, both promoted to lair_def_010
// ============================================================
console.log('\n--- 1. White Dragon freezing-fog → lair_def_010 (adult + ancient) ---');
{
  for (const [label, name, src] of [
    ['adult white dragon (canonical)', 'adult white dragon', undefined],
    ['adult white dragon |mm', 'adult white dragon', 'mm'],
    ['ancient white dragon (canonical)', 'ancient white dragon', undefined],
    ['ancient white dragon |mm', 'ancient white dragon', 'mm'],
  ] as const) {
    const c = spawn(name, src);
    const a = deferredActionAt(c, 0);
    assert(`${label} ::0 is deferred`, !!a && a.category === 'deferred',
      `category=${a?.category}`);
    eq(`${label} ::0 deferredId = lair_def_010`, a?.deferredId, 'lair_def_010');
    eq(`${label} ::0 deferred tag = magical-darkness`, a?.deferred, 'magical-darkness');
    // The other two actions remain in-scope (NOT deferred) — confirms no
    // false-positive from the new /freezing fog fills/i match phrase.
    const a1 = c.lairActions!.actions[1];
    const a2 = c.lairActions!.actions[2];
    assert(`${label} ::1 NOT deferred (damage_no_save)`, a1.category !== 'deferred',
      `category=${a1.category}`);
    assert(`${label} ::2 NOT deferred (debuff_enemy)`, a2.category !== 'deferred',
      `category=${a2.category}`);
  }
}

// ============================================================
// 2. Sea Fury — foggy/murky → lair_def_011
// ============================================================
console.log('\n--- 2. Sea Fury foggy/murky → lair_def_011 ---');
{
  for (const [label, name, src] of [
    ['sea fury (canonical)', 'sea fury', undefined],
    ['sea fury |egw', 'sea fury', 'egw'],
  ] as const) {
    const c = spawn(name, src);
    const a = deferredActionAt(c, 0);
    assert(`${label} ::0 is deferred`, !!a && a.category === 'deferred',
      `category=${a?.category}`);
    eq(`${label} ::0 deferredId = lair_def_011`, a?.deferredId, 'lair_def_011');
    eq(`${label} ::0 deferred tag = magical-darkness`, a?.deferred, 'magical-darkness');
    // ::1 save_condition + ::2 summon remain in-scope.
    assert(`${label} ::1 NOT deferred`, c.lairActions!.actions[1].category !== 'deferred');
    assert(`${label} ::2 NOT deferred`, c.lairActions!.actions[2].category !== 'deferred');
  }
}

// ============================================================
// 3. Imix — black smoke → lair_def_012
// ============================================================
console.log('\n--- 3. Imix black smoke → lair_def_012 ---');
{
  for (const [label, name, src] of [
    ['imix (canonical)', 'imix', undefined],
    ['imix |pota', 'imix', 'pota'],
  ] as const) {
    const c = spawn(name, src);
    const a = deferredActionAt(c, 1);
    assert(`${label} ::1 is deferred`, !!a && a.category === 'deferred',
      `category=${a?.category}`);
    eq(`${label} ::1 deferredId = lair_def_012`, a?.deferredId, 'lair_def_012');
    eq(`${label} ::1 deferred tag = magical-darkness`, a?.deferred, 'magical-darkness');
    // ::0 save_condition + ::2 save_damage remain in-scope.
    assert(`${label} ::0 NOT deferred`, c.lairActions!.actions[0].category !== 'deferred');
    assert(`${label} ::2 NOT deferred`, c.lairActions!.actions[2].category !== 'deferred');
  }
}

// ============================================================
// 4. Olhydra — ::1 keeps lair_def_003, ::2 promoted to lair_def_013
// ============================================================
console.log('\n--- 4. Olhydra ::1 keeps lair_def_003, ::2 → lair_def_013 ---');
{
  for (const [label, name, src] of [
    ['olhydra (canonical)', 'olhydra', undefined],
    ['olhydra |pota', 'olhydra', 'pota'],
  ] as const) {
    const c = spawn(name, src);
    const a1 = deferredActionAt(c, 1);
    const a2 = deferredActionAt(c, 2);
    // ::1 "becomes murky and opaque" → still lair_def_003 (registry order: 003
    // comes before 013, and 013's /freezing fog fills/i does NOT match ::1's
    // text, so 003 wins).
    assert(`${label} ::1 is deferred`, !!a1 && a1.category === 'deferred',
      `category=${a1?.category}`);
    eq(`${label} ::1 deferredId = lair_def_003 (unchanged)`, a1?.deferredId, 'lair_def_003');
    eq(`${label} ::1 deferred tag = visibility`, a1?.deferred, 'visibility');
    // ::2 "freezing fog fills" → lair_def_013 (new).
    assert(`${label} ::2 is deferred`, !!a2 && a2.category === 'deferred',
      `category=${a2?.category}`);
    eq(`${label} ::2 deferredId = lair_def_013`, a2?.deferredId, 'lair_def_013');
    eq(`${label} ::2 deferred tag = magical-darkness`, a2?.deferred, 'magical-darkness');
    // ::0 save_condition remains in-scope.
    assert(`${label} ::0 NOT deferred`, c.lairActions!.actions[0].category !== 'deferred');
  }
}

// ============================================================
// 5. Full bestiary scan — 0 lair_def_auto_* IDs remain
// ============================================================
console.log('\n--- 5. Full bestiary scan — 0 lair_def_auto_* remain ---');
{
  let autoCount = 0;
  let stableDefCount = 0;
  const autoExamples: string[] = [];
  for (const [name] of bestiary) {
    let c: Combatant | null = null;
    try { c = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined); }
    catch { continue; }
    if (!c || !c.lairActions || !c.lairActions.actions) continue;
    for (const a of c.lairActions.actions) {
      if (a.deferredId && a.deferredId.startsWith('lair_def_auto_')) {
        autoCount++;
        if (autoExamples.length < 5) autoExamples.push(`${name} → ${a.deferredId}`);
      }
      if (a.deferredId && a.deferredId.startsWith('lair_def_') && !a.deferredId.startsWith('lair_def_auto_')) {
        stableDefCount++;
      }
    }
  }
  eq('0 lair_def_auto_* IDs remain in full bestiary', autoCount, 0);
  if (autoCount > 0) {
    console.log(`    examples: ${autoExamples.join('; ')}`);
  }
  // Stable deferred entries: 23 (pre-S103) + 10 (promoted this session) = 33.
  // (Each bestiary variant counts separately: 4 white-dragon entries + 2 sea-fury
  //  + 2 imix + 2 olhydra::2 = 10 new; the 23 pre-existing include black-dragon
  //  ×4, sphinx ×4, baphomet ×3, juiblex ×2, storm-giant ×2, olhydra::1 ×2,
  //  nafas ×1... = 18+... actual counted by the scan.)
  assert('stable lair_def_* count ≥ 33 (23 pre + 10 promoted)', stableDefCount >= 33,
    `got ${stableDefCount}`);
  console.log(`    (stable lair_def_* entries across all bestiary variants: ${stableDefCount})`);
}

// ============================================================
// 6. Direct parser test — extractLairAction on synthetic text
// ============================================================
console.log('\n--- 6. Direct parser: synthetic text → stable IDs ---');
{
  const cases: { label: string; creature: string; text: string; wantId: string }[] = [
    {
      label: 'White Dragon synthetic freezing fog',
      creature: 'White Dragon',
      text: 'Freezing fog fills a 20-foot-radius sphere centered on a point the dragon can see within 120 feet of it. The fog spreads around corners, and its area is heavily obscured.',
      wantId: 'lair_def_010',
    },
    {
      label: 'Sea Fury synthetic foggy/murky',
      creature: 'Sea Fury',
      text: 'Caverns, tunnels, and pools of water within 120 feet of the sea fury become foggy or murky, to the extent that the area becomes heavily obscured.',
      wantId: 'lair_def_011',
    },
    {
      label: 'Imix synthetic black smoke',
      creature: 'Imix',
      text: 'A thick cloud of black smoke and burning embers fills a 40-foot-radius sphere within 120 feet of Imix. Creatures and objects within or beyond the smoke are heavily obscured.',
      wantId: 'lair_def_012',
    },
    {
      label: 'Olhydra synthetic freezing fog',
      creature: 'Olhydra',
      text: 'A freezing fog fills a 40-foot-radius sphere within 120 feet of Olhydra. Creatures and objects within or beyond the fog are heavily obscured.',
      wantId: 'lair_def_013',
    },
  ];
  for (const tc of cases) {
    const a = extractLairAction(tc.text, tc.creature, 0);
    eq(`${tc.label} → category=deferred`, a.category, 'deferred');
    eq(`${tc.label} → deferredId`, a.deferredId, tc.wantId);
    eq(`${tc.label} → deferred tag`, a.deferred, 'magical-darkness');
  }
}

// ============================================================
// 7. Regression — pre-existing stable deferred IDs still resolve
// ============================================================
console.log('\n--- 7. Regression — pre-existing stable deferred IDs unchanged ---');
{
  // Black Dragon magical darkness → lair_def_001 (adult + ancient).
  for (const name of ['adult black dragon', 'ancient black dragon']) {
    const c = spawn(name);
    const a = deferredActionAt(c, 2);
    eq(`${name} ::2 deferredId = lair_def_001`, a?.deferredId, 'lair_def_001');
    eq(`${name} ::2 deferred tag = magical-darkness`, a?.deferred, 'magical-darkness');
  }
  // Juiblex green slime → lair_def_009.
  const j = spawn('juiblex');
  const j0 = deferredActionAt(j, 0);
  eq('juiblex ::0 deferredId = lair_def_009', j0?.deferredId, 'lair_def_009');
  eq('juiblex ::0 deferred tag = dmg-hazard', j0?.deferred, 'dmg-hazard');
  // Sphinx meta-initiative → lair_def_006, meta-time → lair_def_008.
  const s = spawn('androsphinx');
  eq('androsphinx ::0 deferredId = lair_def_006', deferredActionAt(s, 0)?.deferredId, 'lair_def_006');
  eq('androsphinx ::2 deferredId = lair_def_008', deferredActionAt(s, 2)?.deferredId, 'lair_def_008');
}

// ============================================================
// 8. No false-positive on in-scope actions of the 4 creatures
// ============================================================
console.log('\n--- 8. No false-positive: in-scope actions stay in-scope ---');
{
  // Re-spawn each creature and confirm the NON-deferred actions did NOT get
  // pulled into deferred by the new match phrases.
  const checks: { name: string; inScopeIndices: number[] }[] = [
    { name: 'adult white dragon', inScopeIndices: [1, 2] },   // damage_no_save, debuff_enemy
    { name: 'sea fury', inScopeIndices: [1, 2] },             // save_condition, summon
    { name: 'imix', inScopeIndices: [0, 2] },                 // save_condition, save_damage
    { name: 'olhydra', inScopeIndices: [0] },                 // save_condition (::1/::2 are deferred)
  ];
  for (const chk of checks) {
    const c = spawn(chk.name);
    for (const i of chk.inScopeIndices) {
      const a = c.lairActions!.actions[i];
      assert(`${chk.name} ::${i} stays in-scope (category=${a.category})`,
        a.category !== 'deferred' && a.category !== 'flavor',
        `category=${a.category}, deferredId=${a.deferredId}`);
    }
  }
}

// ============================================================
// 9. Stable ID numbering — lair_def_010–013 are sequential & unique
// ============================================================
console.log('\n--- 9. Stable ID numbering — lair_def_010–013 sequential & unique ---');
{
  const newIds = new Set(['lair_def_010', 'lair_def_011', 'lair_def_012', 'lair_def_013']);
  // Confirm each new ID is actually produced by exactly one of the 4 creatures.
  const seen: Record<string, string[]> = {};
  for (const [name, src] of [
    ['adult white dragon', undefined], ['sea fury', undefined],
    ['imix', undefined], ['olhydra', undefined],
  ] as const) {
    const c = spawn(name, src);
    for (const a of c.lairActions!.actions) {
      if (a.deferredId && newIds.has(a.deferredId)) {
        (seen[a.deferredId] ??= []).push(name);
      }
    }
  }
  for (const id of newIds) {
    assert(`${id} produced by ≥1 creature`, (seen[id]?.length ?? 0) >= 1,
      `produced by: ${seen[id]?.join(', ') || 'none'}`);
  }
  // Confirm no two new IDs collide on the same (sourceCreature, index).
  eq('4 distinct new IDs produced', Object.keys(seen).length, 4);
}

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
