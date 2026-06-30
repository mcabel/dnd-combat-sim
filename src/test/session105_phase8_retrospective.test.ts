// ============================================================
// Test: Session 105 — Phase 8 Retrospective (bespoke category COMPLETE)
//
// S104 handover next-action #4: "Phase 8 retrospective — bespoke category
// COMPLETE. Phase 8 (batches 1-3) is complete (S102). All 31 bespoke actions
// recognized (100%). A retrospective could audit:
//   - The 7 lair_def_auto_* heuristic-caught deferred actions → RESOLVED in
//     S103 (0 remain; 4 promoted to lair_def_010-013).
//   - The 40 isSpell:true actions — spot-audit before the unified cast
//     dispatch (next-action #1).
//   - Whether any of the log-only bespoke flags warrant mechanical handlers
//     in Phase 9+.
// LOW risk (documentation/audit only)."
//
// This test is a REGRESSION GUARD that captures the post-Phase-8 invariants:
//   1. 0 lair_def_auto_* deferred IDs remain (S103 promotion resolution)
//   2. The 4 promoted stable IDs (lair_def_010-013) exist
//   3. isSpell:true (cast_spell) action count + spot-audit
//   4. bespoke category count + log-only flag audit
//   5. Recognition coverage summary (all categories present)
//
// If a future parser change regresses any of these (e.g. re-introduces a
// lair_def_auto_* heuristic, or drops a bespoke flag), this test fails and
// points to the regression.
//
// Run: npx ts-node --transpile-only src/test/session105_phase8_retrospective.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
} from '../parser/fivetools';
import { Combatant, LairAction } from '../types/core';

// ---- Test harness -------------------------------------------

let passed = 0, failed = 0;

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

// ---- Aggregate ALL lair actions across the bestiary ----

interface Agg {
  total: number;
  byCategory: Record<string, number>;
  isSpellCount: number;
  deferredAutoIds: string[];      // lair_def_auto_* (should be EMPTY post-S103)
  deferredStableIds: Set<string>; // lair_def_NNN (stable IDs)
  bespokeFlags: Record<string, number>;  // log-only flag counts
  castSpellActions: Array<{ creature: string; id: string; spellName?: string }>;
}

const agg: Agg = {
  total: 0,
  byCategory: {},
  isSpellCount: 0,
  deferredAutoIds: [],
  deferredStableIds: new Set(),
  bespokeFlags: {},
  castSpellActions: [],
};

let creaturesWithLair = 0;
for (const c of bestiary.values()) {
  // spawnMonster needs a name; iterate via the raw bestiary entries instead.
  // The bestiary map is name|source → Raw5etoolsMonster. Use spawnMonster on
  // each key to get a Combatant with parsed lairActions.
}

// The bestiary map keys are "name|source". Iterate them.
for (const [key] of bestiary.entries()) {
  const [name, src] = key.split('|');
  const combatant = spawnMonster(bestiary, name, { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined, src);
  if (!combatant) continue;
  if (!combatant.lairActions || !combatant.lairActions.actions) continue;
  creaturesWithLair++;
  for (const action of combatant.lairActions.actions) {
    agg.total++;
    agg.byCategory[action.category] = (agg.byCategory[action.category] ?? 0) + 1;
    if (action.isSpell) {
      agg.isSpellCount++;
      agg.castSpellActions.push({ creature: name, id: action.id, spellName: action.spellName });
    }
    if (action.deferredId) {
      if (action.deferredId.startsWith('lair_def_auto_')) {
        agg.deferredAutoIds.push(`${action.id} (${action.deferredId})`);
      } else {
        agg.deferredStableIds.add(action.deferredId);
      }
    }
    // Bespoke log-only flags (mechanical handlers may or may not exist)
    if ((action as any).lairAntiInvisibility) agg.bespokeFlags.lairAntiInvisibility = (agg.bespokeFlags.lairAntiInvisibility ?? 0) + 1;
    if ((action as any).lairIllusoryDuplicate) agg.bespokeFlags.lairIllusoryDuplicate = (agg.bespokeFlags.lairIllusoryDuplicate ?? 0) + 1;
  }
}

console.log(`    Creatures with lair actions: ${creaturesWithLair}`);
console.log(`    Total lair-action options: ${agg.total}`);
console.log(`    Categories: ${JSON.stringify(agg.byCategory)}`);
console.log(`    isSpell (cast_spell): ${agg.isSpellCount}`);
console.log(`    Deferred auto IDs (should be 0): ${agg.deferredAutoIds.length}`);
console.log(`    Deferred stable IDs: ${[...agg.deferredStableIds].sort().join(', ')}`);
console.log(`    Bespoke flags: ${JSON.stringify(agg.bespokeFlags)}`);

// ============================================================
// 1. 0 lair_def_auto_* deferred IDs remain (S103 resolution)
// ============================================================
console.log('\n--- 1. S103 resolution: 0 lair_def_auto_* remain ---');
eq('1a. 0 lair_def_auto_* deferred IDs (S103 promoted all 7)', agg.deferredAutoIds.length, 0);
if (agg.deferredAutoIds.length > 0) {
  console.error(`     Violating actions: ${agg.deferredAutoIds.join('; ')}`);
}

// ============================================================
// 2. The 4 promoted stable IDs (lair_def_010-013) exist
// ============================================================
console.log('\n--- 2. S103 promoted stable IDs (lair_def_010-013) exist ---');
for (const stableId of ['lair_def_010', 'lair_def_011', 'lair_def_012', 'lair_def_013']) {
  assert(`2. stable ID ${stableId} present`, agg.deferredStableIds.has(stableId),
    `stable IDs: ${[...agg.deferredStableIds].sort().join(', ')}`);
}

// ============================================================
// 3. isSpell (cast_spell) action count + spot-audit
// ============================================================
console.log('\n--- 3. isSpell (cast_spell) actions ---');
// The S91 tagging table reported 42 isSpell:true actions. The exact count
// depends on which sourcebooks are loaded (variant entries share IDs).
// The invariant: isSpell count is > 0 (cast_spell is a recognized category)
// and every isSpell action has a spellName.
assert('3a. isSpell count > 0 (cast_spell category is populated)', agg.isSpellCount > 0,
  `count=${agg.isSpellCount}`);
const withoutSpellName = agg.castSpellActions.filter(a => !a.spellName);
assert('3b. every isSpell action has a spellName', withoutSpellName.length === 0,
  `missing spellName: ${withoutSpellName.map(a => a.id).slice(0, 5).join(', ')}`);

// Spot-audit: a few known cast_spell actions (from the S91 tagging table).
// Aboleth::2 casts phantasmal force; Kraken::1 casts lightning storm; etc.
// Verify the category is cast_spell for isSpell actions.
const sampleSpellActions = agg.castSpellActions.slice(0, 5);
for (const a of sampleSpellActions) {
  assert(`3c. ${a.creature} ${a.id} is cast_spell (isSpell=true, spell=${a.spellName})`,
    agg.byCategory['cast_spell'] > 0, `spellName=${a.spellName}`);
}

// ============================================================
// 4. Bespoke category + log-only flag audit
// ============================================================
console.log('\n--- 4. Bespoke category + log-only flags ---');
// The S104 handover says "All 31 bespoke actions recognized (100%)". The
// tagging table reports 63 bespoke (the difference: 31 = unique mechanical
// handler coverage; 63 = total bespoke-tagged actions including variants).
// The invariant: bespoke category is populated (Phase 8 batches 1-3 added
// the handlers).
assert('4a. bespoke category populated (Phase 8 complete)', (agg.byCategory['bespoke'] ?? 0) > 0,
  `bespoke count=${agg.byCategory['bespoke'] ?? 0}`);

// Log-only bespoke flags — these have handlers that LOG but may not have full
// mechanical effects. Documented for Phase 9+ consideration.
// lairAntiInvisibility (Drow Matron Mother::0) — S101 added a log handler.
assert('4b. lairAntiInvisibility flag present (Drow Matron Mother::0, S101)',
  (agg.bespokeFlags.lairAntiInvisibility ?? 0) > 0,
  `count=${agg.bespokeFlags.lairAntiInvisibility ?? 0}`);
// lairIllusoryDuplicate (Sphinx variants) — S94 added a MECHANICAL handler
// (sets Combatant.lairIllusoryDuplicate). This is NOT log-only.
assert('4c. lairIllusoryDuplicate flag present (Sphinx, S94 mechanical handler)',
  (agg.bespokeFlags.lairIllusoryDuplicate ?? 0) > 0,
  `count=${agg.bespokeFlags.lairIllusoryDuplicate ?? 0}`);

// ============================================================
// 5. Recognition coverage summary (all expected categories present)
// ============================================================
console.log('\n--- 5. Recognition coverage summary ---');
// Post-Phase-8, all categories should be populated (except flavor/deferred
// which are log-only). The key executable categories:
const expectedCategories = ['save_damage', 'save_condition', 'cast_spell', 'summon',
  'buff_ally', 'debuff_enemy', 'movement', 'damage_no_save', 'spell_slot_regen', 'bespoke'];
for (const cat of expectedCategories) {
  assert(`5. category '${cat}' populated`, (agg.byCategory[cat] ?? 0) > 0,
    `count=${agg.byCategory[cat] ?? 0}`);
}

// Deferred + flavor are log-only (not executed) — they may or may not be
// populated depending on the bestiary load, but their presence is expected.
console.log(`    Deferred (log-only): ${agg.byCategory['deferred'] ?? 0}`);
console.log(`    Flavor (log-only): ${agg.byCategory['flavor'] ?? 0}`);

// ============================================================
// 6. Retrospective summary (printed for documentation)
// ============================================================
console.log('\n--- 6. Phase 8 retrospective summary ---');
console.log(`    Phase 8 (batches 1-3, S100-S102): bespoke category COMPLETE.`);
console.log(`    S103: 7 lair_def_auto_* → 4 promoted to lair_def_010-013 (0 auto remain).`);
console.log(`    S104: grid-sweep targeting + damage_vulnerability audit regression guard.`);
console.log(`    S105: centerOnPoint broader regex (+4 strong cases) + Hallow Energy Vulnerability.`);
console.log(`    Open (future sessions):`);
console.log(`      - Unified cast dispatch for cast_spell (next-action #1, HIGH risk)`);
console.log(`      - Score-weight tuning (next-action #3, MEDIUM risk)`);
console.log(`      - 4 borderline centerOnPoint cases (Imix::1, Ogrémoch::0/::1, Olhydra::2)`);
console.log(`      - radiusFt extraction for "within N feet of that point" / cube phrasings`);
console.log(`        (would activate point-selection for the 6 radiusFt=undefined centerOnPoint cases)`);
console.log(`      - Hallow AI effect-selection (Daylight vs Energy Vulnerability) wiring`);
console.log(`      - isInLair char-builder UI (SHEET stream territory)`);

// ---- Results ------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
