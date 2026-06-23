// ============================================================
// Test: Creature Megabatch Batch 0 — reprint-safe loader + subname disambiguation
// Run: npx ts-node --transpile-only src/test/creature_reprint_loader.test.ts
//
// Session 52 Creature Megabatch Batch 0.
// Verifies:
//   1. Single-source bestiary: no subname suffix (backward compat).
//   2. Multi-source with a genuine reprint (same name, different source):
//      both entries retrievable, BOTH get "(SOURCE)" subname suffix.
//   3. Multi-source with NO collision: no suffix.
//   4. spawnMonster with sourceOverride picks the specific source.
//   5. Combatant.source is always populated.
//   6. listMonsters returns bare names; listMonstersDetailed returns source+reprint flag.
//   7. Same-source duplicate (duplicate file) is NOT a reprint (first-wins, no suffix).
// ============================================================

import {
  loadBestiaryJson,
  mergeBestiaries,
  spawnMonster,
  listMonsters,
  listMonstersDetailed,
  type Raw5etoolsMonster,
} from '../parser/fivetools';

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected;
  assert(label, ok, ok ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// ---- Synthetic raw monsters --------------------------------
function mkRaw(name: string, source: string, cr = '1'): Raw5etoolsMonster {
  return {
    name, source, cr,
    ac: [10], hp: { average: 10, formula: '1d8+2' },
    speed: { walk: 30 },
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    type: 'humanoid', size: ['M'],
    action: [{ name: 'Club', entries: ['{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@damage 1d6 + 2} bludgeoning damage.'] }],
  };
}

// ============================================================
console.log('\n=== 1. Single-source bestiary — no suffix (backward compat) ===\n');
{
  const mm = loadBestiaryJson({
    monster: [mkRaw('Goblin', 'MM'), mkRaw('Orc', 'MM'), mkRaw('Larva', 'DMG')],
  });
  eq('3 unique monsters', listMonsters(mm).length, 3);
  eq('reprintNames empty (no collisions)', mm.reprintNames.size, 0);
  const goblin = spawnMonster(mm, 'Goblin', { x: 0, y: 0, z: 0 })!;
  eq('Goblin name has NO suffix', goblin.name, 'Goblin');
  eq('Goblin.source is MM', goblin.source, 'MM');
  const larva = spawnMonster(mm, 'Larva', { x: 0, y: 0, z: 0 })!;
  eq('Larva name has NO suffix (different source, no collision)', larva.name, 'Larva');
  eq('Larva.source is DMG', larva.source, 'DMG');
}

// ============================================================
console.log('\n=== 2. Genuine reprint — same name, 2 sources, both suffixed ===\n');
{
  // Goblin exists in MM and VGM (genuine reprint)
  const mmFile = { monster: [mkRaw('Goblin', 'MM'), mkRaw('Orc', 'MM')] };
  const vgmFile = { monster: [mkRaw('Goblin', 'VGM'), mkRaw('Kobold', 'VGM')] };
  const merged = mergeBestiaries(mmFile, vgmFile);

  eq('reprintNames has 1 entry (Goblin)', merged.reprintNames.size, 1);
  assert('Goblin flagged as reprint', merged.reprintNames.has('goblin'));
  assert('Orc NOT flagged as reprint', !merged.reprintNames.has('orc'));

  // Bare-name lookup returns the FIRST (MM) — backward compat
  const goblinMM = spawnMonster(merged, 'Goblin', { x: 0, y: 0, z: 0 })!;
  eq('Bare-name Goblin gets MM (first-wins) + suffix', goblinMM.name, 'Goblin (MM)');
  eq('Bare-name Goblin.source = MM', goblinMM.source, 'MM');

  // SourceOverride picks VGM
  const goblinVGM = spawnMonster(merged, 'Goblin', { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined, 'VGM')!;
  eq('sourceOverride=VGM Goblin gets VGM suffix', goblinVGM.name, 'Goblin (VGM)');
  eq('sourceOverride=VGM Goblin.source = VGM', goblinVGM.source, 'VGM');

  // Non-reprint creature in the same merged bestiary: no suffix
  const orc = spawnMonster(merged, 'Orc', { x: 0, y: 0, z: 0 })!;
  eq('Orc name has NO suffix (unique)', orc.name, 'Orc');
  eq('Orc.source = MM', orc.source, 'MM');

  // Direct map.get with bare name still works (backward compat for presets.ts callers)
  assert('merged.has("goblin") bare key', merged.has('goblin'));
  assert('merged.has("goblin|mm") composite key', merged.has('goblin|mm'));
  assert('merged.has("goblin|vgm") composite key', merged.has('goblin|vgm'));
}

// ============================================================
console.log('\n=== 3. listMonsters vs listMonstersDetailed ===\n');
{
  const mmFile = { monster: [mkRaw('Goblin', 'MM'), mkRaw('Orc', 'MM')] };
  const vgmFile = { monster: [mkRaw('Goblin', 'VGM')] };
  const merged = mergeBestiaries(mmFile, vgmFile);

  // listMonsters: bare names only, deduped → Goblin appears ONCE
  const bare = listMonsters(merged);
  eq('listMonsters returns 2 bare names', bare.length, 2);
  eq('listMonsters sorted', bare.join(','), 'goblin,orc');

  // listMonstersDetailed: one entry per (name, source) → Goblin appears TWICE
  const detailed = listMonstersDetailed(merged);
  eq('listMonstersDetailed returns 3 entries', detailed.length, 3);
  const goblinEntries = detailed.filter(d => d.name === 'Goblin');
  eq('Goblin has 2 detailed entries (MM + VGM)', goblinEntries.length, 2);
  assert('Goblin MM marked isReprint', goblinEntries.some(g => g.source === 'MM' && g.isReprint));
  assert('Goblin VGM marked isReprint', goblinEntries.some(g => g.source === 'VGM' && g.isReprint));
  const orcEntries = detailed.filter(d => d.name === 'Orc');
  eq('Orc has 1 detailed entry', orcEntries.length, 1);
  assert('Orc NOT marked isReprint', !orcEntries[0].isReprint);
}

// ============================================================
console.log('\n=== 4. Same-source duplicate (duplicate file) — NOT a reprint ===\n');
{
  // Two files both source "MM" both containing Goblin — this is the
  // bestiary-mm.json vs bestiary-mm-2014.json byte-identical-duplicate case.
  const mm1File = { monster: [mkRaw('Goblin', 'MM'), mkRaw('Orc', 'MM')] };
  const mm2File = { monster: [mkRaw('Goblin', 'MM'), mkRaw('Orc', 'MM')] };
  const merged = mergeBestiaries(mm1File, mm2File);

  eq('Same-source duplicate NOT flagged as reprint', merged.reprintNames.size, 0);
  const goblin = spawnMonster(merged, 'Goblin', { x: 0, y: 0, z: 0 })!;
  eq('Same-source dup Goblin has NO suffix', goblin.name, 'Goblin');
  eq('2 unique monsters (dupes collapsed)', listMonsters(merged).length, 2);
}

// ============================================================
console.log('\n=== 5. Real bestiaryData smoke test ===\n');
{
  // Load the actual bestiaryData/ dir via mergeBestiaries on every real file.
  // Session 53: the user uploaded ~99 bestiary sourcebooks (was 2 in Session 52).
  // The loader's same-source dedup (first-wins) and cross-source reprint suffix
  // logic should both fire correctly on the expanded dataset.
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '../../bestiaryData');
  const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.json'));
  const loadedFiles = files.map((f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
  const merged = mergeBestiaries(...loadedFiles);
  const uniqueNames = listMonsters(merged);
  console.log(`  Loaded ${files.length} files → ${uniqueNames.length} unique creatures, ${merged.reprintNames.size} reprints`);
  assert('At least 450 unique MM creatures', uniqueNames.length >= 450);
  // Session 53: with multi-sourcebook data loaded, genuine reprints are
  // EXPECTED (e.g. "Goblin" appears in MM, VGM, and many adventure modules).
  // Asserting > 0 verifies the reprint detection fires; we don't pin the
  // exact count because it varies with how many sourcebooks are present.
  assert('Multi-source reprints detected (≥1 expected with multi-source data)', merged.reprintNames.size >= 1);
  // Spawn a known creature — Goblin is in MM only (VGM doesn't reprint it).
  const goblin = spawnMonster(merged, 'Goblin', { x: 0, y: 0, z: 0 })!;
  eq('Real Goblin.source = MM', goblin.source, 'MM');
  // A DMG creature — Larva is DMG-only, no reprint suffix
  const larva = spawnMonster(merged, 'Larva', { x: 0, y: 0, z: 0 })!;
  eq('Real Larva.source = DMG', larva.source, 'DMG');
  // A genuine pre-2024 reprint: Derro appears in MTF (2018) and OotA (2015).
  // Full arg list: (bestiary, name, pos, profile, faction, hpOverride, sourceOverride)
  const derroMtf = spawnMonster(merged, 'Derro', { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined, 'MTF')!;
  eq('Derro (MTF) gets source-suffix when override given', derroMtf.name, 'Derro (MTF)');
  eq('Derro (MTF).source = MTF', derroMtf.source, 'MTF');
  const derroOotA = spawnMonster(merged, 'Derro', { x: 0, y: 0, z: 0 }, 'smart', 'enemy', undefined, 'OotA')!;
  eq('Derro (OotA) gets source-suffix when override given', derroOotA.name, 'Derro (OotA)');
  eq('Derro (OotA).source = OotA', derroOotA.source, 'OotA');
}

// ============================================================
console.log('\n─────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFailed tests above ↑'); process.exit(1); }
console.log('\nAll tests passed ✅');
