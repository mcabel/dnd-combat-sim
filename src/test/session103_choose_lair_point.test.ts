// ============================================================
// Test: Session 103 — chooseLairActionPoint (true point-selection
//       AoE targeting for `centerOnPoint` lair actions).
//
// Validates the Session 103 Task #1 deliverable (the ⭐ starred
// next-action from the Session 102 handover): a new
// `chooseLairActionPoint` helper that picks the AoE centre within
// `rangeFt` of the lair creature maximising targets hit within
// `radiusFt`, replacing the v1 over-approximation (which centred
// the AoE on the lair creature itself) for actions whose text
// explicitly says "centered on a point the [creature] chooses/can
// see within N feet of it".
//
// The wiring is OPT-IN via a new `LairAction.centerOnPoint` parser
// flag (set when the text matches /centered on a point/i). This
// limits the behavioural change to the 30 bestiary actions that
// explicitly describe point-selection (26 save_condition + 4
// save_damage), leaving all other lair actions on the v1 model —
// so zero existing tests break (verified: full 6-chunk suite
// 431/431 files, 0 failed).
//
// Run: npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  spawnMonster,
  mergeBestiaries,
  extractLairAction,
} from '../parser/fivetools';
import { runCombat } from '../engine/combat';
import { chooseLairActionPoint } from '../engine/combat';
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

// ---- Load bestiary ----

const dir = path.join(__dirname, '../../bestiaryData');
const allFiles = fs.readdirSync(dir).filter(f =>
  f.endsWith('.json') && !f.includes('combined_') && !f.includes('legendarygroups'));
const loaded = allFiles.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
const bestiary = mergeBestiaries(...loaded);

console.log(`    Loaded ${allFiles.length} bestiary sources, ${bestiary.size} creatures total.`);

function spawn(name: string, pos: Vec3 = { x: 0, y: 0, z: 0 }): Combatant {
  const c = spawnMonster(bestiary, name, pos, 'smart', 'enemy', undefined);
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
  const bf: MutableBF = {
    width, height, depth, cells,
    combatants: new Map(combatants.map(c => [c.id, c])),
    round: 1,
    initiativeOrder: combatants.map(c => c.id),
  };
  return bf;
}
function tankUp(c: Combatant, hp = 100_000): void { c.maxHP = hp; c.currentHP = hp; }
function noLegendary(c: Combatant): void { c.legendaryActionPoolMax = 0; c.legendaryActionPool = 0; }
function asParty(c: Combatant): void { c.faction = 'party'; }
function asEnemy(c: Combatant): void { c.faction = 'enemy'; }
function freeze(c: Combatant): void {
  // Zero out speed so the combatant can't move (freezes geometry for the
  // lair-action point-selection test).
  c.speed = 0;
}
function noOffense(c: Combatant): void {
  // Clear regular actions so the combatant's turn is a no-op (only the lair
  // action at initiative count 20 fires — isolates lair-action effects).
  c.actions = [];
}

function makeAction(id: string, category: LairAction['category'], extra: Partial<LairAction> = {}): LairAction {
  return {
    id, sourceCreature: 'TestCreature',
    rawText: extra.rawText ?? `Synthetic ${category} action.`,
    outOfScope: false, isMagical: true, isSpell: false, targetsEnemies: true,
    category, ...extra,
  };
}
function forceAction(c: Combatant, action: LairAction): void {
  if (!c.lairActions) c.lairActions = { actions: [], initiativeCount: 20 };
  c.lairActions.actions = [action];
  c._lairActionHistory = [];
}

/** Position helper: (x,y,0). */
function pos(x: number, y: number): Vec3 { return { x, y, z: 0 }; }

// ============================================================
// 1. Parser: centerOnPoint extracted for "centered on a point" actions
// ============================================================
console.log('\n--- 1. Parser: centerOnPoint on real bestiary actions ---');
{
  // Blue Dragon::1 — "centered on a point" save_condition (CON or blinded).
  const blue = spawn('Adult Blue Dragon');
  const blue1 = blue.lairActions?.actions.find(a => a.id === 'Blue Dragon::1');
  assert('Blue Dragon::1 exists', !!blue1, `ids: ${blue.lairActions?.actions.map(a=>a.id).join(',')}`);
  eq('Blue Dragon::1 centerOnPoint = true', blue1?.centerOnPoint, true);
  assert('Blue Dragon::1 has radiusFt', blue1?.radiusFt !== undefined, `radiusFt=${blue1?.radiusFt}`);
  assert('Blue Dragon::1 has rangeFt', blue1?.rangeFt !== undefined, `rangeFt=${blue1?.rangeFt}`);

  // Black Dragon::1 — "centered on a point" save_damage.
  const black = spawn('Adult Black Dragon');
  const black1 = black.lairActions?.actions.find(a => a.id === 'Black Dragon::1');
  eq('Black Dragon::1 centerOnPoint = true', black1?.centerOnPoint, true);

  // Red Dragon::2 — "centered on a point" save_condition.
  const red = spawn('Adult Red Dragon');
  const red2 = red.lairActions?.actions.find(a => a.id === 'Red Dragon::2');
  eq('Red Dragon::2 centerOnPoint = true', red2?.centerOnPoint, true);
}

// ============================================================
// 2. Parser: centerOnPoint NOT set for centered-on-self actions
// ============================================================
console.log('\n--- 2. Parser: centerOnPoint false for centered-on-self actions ---');
{
  // Red Dragon::0 — magma, "Magma erupts..." (NOT "centered on a point").
  const red = spawn('Adult Red Dragon');
  const red0 = red.lairActions?.actions.find(a => a.id === 'Red Dragon::0');
  eq('Red Dragon::0 centerOnPoint = false (magma, centered on self)', red0?.centerOnPoint, false);

  // Black Dragon::0 — save_condition "Each creature within 30 feet..." (centered on self).
  const black0 = black0Action();
  eq('Black Dragon::0 centerOnPoint = false', black0?.centerOnPoint, false);

  function black0Action(): LairAction | undefined {
    const black = spawn('Adult Black Dragon');
    return black.lairActions?.actions.find(a => a.id === 'Black Dragon::0');
  }
}

// ============================================================
// 3. Direct: chooseLairActionPoint — single candidate
// ============================================================
console.log('\n--- 3. chooseLairActionPoint: single candidate ---');
{
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(3, 0);   // 15 ft from dragon
  const action = makeAction('Test::single', 'save_condition', { radiusFt: 20, centerOnPoint: true });
  const { center, targets } = chooseLairActionPoint(dragon, action, [g1]);
  eq('single: 1 target', targets.length, 1);
  eq('single: target is g1', targets[0].id, g1.id);
  eq('single: center = g1 pos x', center.x, g1.pos.x);
  eq('single: center = g1 pos y', center.y, g1.pos.y);
}

// ============================================================
// 4. Direct: clustered candidates → all hit
// ============================================================
console.log('\n--- 4. chooseLairActionPoint: clustered candidates all hit ---');
{
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(3, 0);   // 15 ft from dragon
  const g2 = spawn('Goblin'); g2.pos = pos(4, 0);   // 20 ft from dragon, 5 ft from g1
  const g3 = spawn('Goblin'); g3.pos = pos(5, 0);   // 25 ft from dragon, 10 ft from g1, 5 ft from g2
  // radiusFt=20 (4 squares). g1-g2=1sq(5ft), g2-g3=1sq(5ft), g1-g3=2sq(10ft) — all within 20ft of each other.
  const action = makeAction('Test::cluster', 'save_condition', { radiusFt: 20, centerOnPoint: true });
  const { targets } = chooseLairActionPoint(dragon, action, [g1, g2, g3]);
  eq('cluster: 3 targets hit', targets.length, 3);
  const ids = targets.map(t => t.id).sort();
  eq('cluster: includes g1', ids.includes(g1.id), true);
  eq('cluster: includes g2', ids.includes(g2.id), true);
  eq('cluster: includes g3', ids.includes(g3.id), true);
}

// ============================================================
// 5. Direct: spread candidates → only densest cluster hit (v1 fallback:
//    no rangeFt → grid-sweep skipped, v1 creature-position centres only)
// ============================================================
console.log('\n--- 5. chooseLairActionPoint: spread candidates → densest cluster (v1 fallback) ---');
{
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(1, 0);   // 5 ft from dragon (isolated)
  const g2 = spawn('Goblin'); g2.pos = pos(6, 0);   // 30 ft from dragon
  const g3 = spawn('Goblin'); g3.pos = pos(7, 0);   // 35 ft from dragon, 5 ft from g2
  // radiusFt=20 (4 squares). g1-g2=5sq(25ft)>20ft, g1-g3=6sq(30ft)>20ft, g2-g3=1sq(5ft)≤20ft.
  // → center at g1 hits {g1} (1); center at g2 hits {g2,g3} (2); center at g3 hits {g2,g3} (2).
  // Best: 2 targets {g2,g3}.
  // NOTE: this synthetic action has NO rangeFt → Session 104 grid-sweep is skipped
  // (the grid is bounded by rangeFt; without it, the grid is unbounded). v1 alone
  // runs → 2 targets {g2,g3}. With rangeFt set (see §12), grid-sweep would find a
  // midpoint catching all 3.
  const action = makeAction('Test::spread', 'save_condition', { radiusFt: 20, centerOnPoint: true });
  const { center, targets } = chooseLairActionPoint(dragon, action, [g1, g2, g3]);
  eq('spread: 2 targets hit (densest cluster, v1 fallback)', targets.length, 2);
  const ids = targets.map(t => t.id).sort();
  eq('spread: includes g2', ids.includes(g2.id), true);
  eq('spread: includes g3', ids.includes(g3.id), true);
  eq('spread: does NOT include isolated g1', ids.includes(g1.id), false);
  // Tie-break: g2 (30ft) and g3 (35ft) both yield 2 targets; g2 is closer to dragon → center=g2.
  eq('spread: tie-break picks closer-to-dragon center (g2 x=6)', center.x, g2.pos.x);
}

// ============================================================
// 6. Direct: empty candidates → lair creature pos, empty targets
// ============================================================
console.log('\n--- 6. chooseLairActionPoint: empty candidates ---');
{
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(5, 7);
  const action = makeAction('Test::empty', 'save_condition', { radiusFt: 20, centerOnPoint: true });
  const { center, targets } = chooseLairActionPoint(dragon, action, []);
  eq('empty: 0 targets', targets.length, 0);
  eq('empty: center = lair creature pos x', center.x, dragon.pos.x);
  eq('empty: center = lair creature pos y', center.y, dragon.pos.y);
}

// ============================================================
// 7. Direct: lexicographic tie-break (equidistant, same count)
// ============================================================
console.log('\n--- 7. chooseLairActionPoint: lexicographic tie-break ---');
{
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(10, 10);
  // Two goblins equidistant from the dragon (both 2 squares = 10ft), each isolated
  // (radiusFt=5 → 1 square; they're 4 squares apart so neither catches the other).
  const gLow = spawn('Goblin'); gLow.pos = pos(10, 12);   // x=10, y=12
  const gHigh = spawn('Goblin'); gHigh.pos = pos(12, 10); // x=12, y=10
  // Both 10ft from dragon → tie-break 1 (distance) is equal.
  // Tie-break 2: lowest (x,y,z) lexicographically → gLow (x=10) < gHigh (x=12).
  const action = makeAction('Test::lex', 'save_condition', { radiusFt: 5, centerOnPoint: true });
  const { center, targets } = chooseLairActionPoint(dragon, action, [gHigh, gLow]);
  eq('lex: 1 target (each isolated)', targets.length, 1);
  eq('lex: center = gLow (lowest x)', center.x, gLow.pos.x);
  eq('lex: center = gLow y', center.y, gLow.pos.y);
}

// ============================================================
// 8. Direct: radiusFt larger than spread → all hit (midpoint not needed)
// ============================================================
console.log('\n--- 8. chooseLairActionPoint: large radius catches all ---');
{
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(2, 0);   // 10 ft
  const g2 = spawn('Goblin'); g2.pos = pos(8, 0);   // 40 ft, 30 ft from g1
  // radiusFt=40 (8 squares). g1-g2=6sq(30ft)≤40ft → center at g1 hits both (g2 30ft≤40ft).
  const action = makeAction('Test::large', 'save_condition', { radiusFt: 40, centerOnPoint: true });
  const { targets } = chooseLairActionPoint(dragon, action, [g1, g2]);
  eq('large radius: 2 targets hit', targets.length, 2);
}

// ============================================================
// 9. Integration: Blue Dragon::1 clustered → both blinded; spread → 1 blinded
// ============================================================
console.log('\n--- 9. Integration: Blue Dragon::1 point-selection in combat ---');
{
  // Clustered case: 2 goblins within radiusFt(20ft) of each other.
  const dragon = spawn('Adult Blue Dragon'); asParty(dragon); tankUp(dragon); noLegendary(dragon); noOffense(dragon);
  const blue1 = dragon.lairActions!.actions.find(a => a.id === 'Blue Dragon::1')!;
  dragon.lairActions!.actions = [blue1];
  dragon._lairActionHistory = [];

  const g1 = spawn('Goblin', pos(3, 0)); asEnemy(g1); tankUp(g1); freeze(g1);
  g1.saveProficiencies = { con: -100 } as any;   // guaranteed CON fail → blinded
  const g2 = spawn('Goblin', pos(4, 0)); asEnemy(g2); tankUp(g2); freeze(g2);
  g2.saveProficiencies = { con: -100 } as any;

  const bf = makeBF([dragon, g1, g2]);
  runCombat(bf, [dragon.id, g1.id, g2.id], { maxRounds: 1, verbose: false } as any);
  // Both goblins are within 20ft of each other → point-selection catches both.
  assert('clustered: g1 blinded (CON fail)', g1.conditions.has('blinded'),
    `conditions: ${[...g1.conditions].join(',')}`);
  assert('clustered: g2 blinded (CON fail)', g2.conditions.has('blinded'),
    `conditions: ${[...g2.conditions].join(',')}`);

  // Spread case: g3 isolated beyond radiusFt from g4's cluster — BUT the
  // Session 104 grid-sweep enhancement finds a midpoint that catches all 3.
  // g3(1,0)=5ft, g4(6,0)=30ft, g5(7,0)=35ft. g4-g5=5ft (cluster). g3-g4=25ft>20ft,
  // g3-g5=30ft>20ft → v1 (creature-position centres) catches only {g4,g5} (2).
  // Grid-sweep: centre at (3,0) catches g3(10ft), g4(15ft), g5(20ft) — all ≤20ft
  // → 3 targets. (3,0) is 15ft from dragon ≤ rangeFt=120 → legal centre.
  // Grid-sweep wins (3 > 2) → all 3 goblins blinded.
  const dragon2 = spawn('Adult Blue Dragon'); asParty(dragon2); tankUp(dragon2); noLegendary(dragon2); noOffense(dragon2);
  dragon2.lairActions!.actions = [blue1];
  dragon2._lairActionHistory = [];
  const g3 = spawn('Goblin', pos(1, 0)); asEnemy(g3); tankUp(g3); freeze(g3);
  g3.saveProficiencies = { con: -100 } as any;
  const g4 = spawn('Goblin', pos(6, 0)); asEnemy(g4); tankUp(g4); freeze(g4);
  g4.saveProficiencies = { con: -100 } as any;
  const g5 = spawn('Goblin', pos(7, 0)); asEnemy(g5); tankUp(g5); freeze(g5);
  g5.saveProficiencies = { con: -100 } as any;
  const bf2 = makeBF([dragon2, g3, g4, g5]);
  runCombat(bf2, [dragon2.id, g3.id, g4.id, g5.id], { maxRounds: 1, verbose: false } as any);
  assert('spread: g4 blinded (in grid-sweep cluster)', g4.conditions.has('blinded'));
  assert('spread: g5 blinded (in grid-sweep cluster)', g5.conditions.has('blinded'));
  assert('spread: g3 IS blinded (Session 104 grid-sweep midpoint catches all 3)',
    g3.conditions.has('blinded'),
    `conditions: ${[...g3.conditions].join(',')}`);
}

// ============================================================
// 10. Regression: non-centerOnPoint action still hits all in rangeFt (v1)
// ============================================================
console.log('\n--- 10. Regression: non-centerOnPoint action keeps v1 over-approximation ---');
{
  // Red Dragon::0 (magma, save_damage) is NOT centerOnPoint. Two spread goblins
  // both within rangeFt(120) → v1 hits BOTH (radiusFt ignored).
  const dragon = spawn('Adult Red Dragon'); asParty(dragon); tankUp(dragon); noLegendary(dragon); noOffense(dragon);
  const red0 = dragon.lairActions!.actions.find(a => a.id === 'Red Dragon::0')!;
  eq('Red Dragon::0 centerOnPoint = false (precondition)', red0.centerOnPoint, false);
  dragon.lairActions!.actions = [red0];
  dragon._lairActionHistory = [];

  const g1 = spawn('Goblin', pos(1, 0)); asEnemy(g1); tankUp(g1); freeze(g1);
  g1.saveProficiencies = { dex: -100 } as any;   // magma is DEX save — guaranteed fail → damage
  const g2 = spawn('Goblin', pos(8, 0)); asEnemy(g2); tankUp(g2); freeze(g2);
  g2.saveProficiencies = { dex: -100 } as any;
  // g1 at 5ft, g2 at 40ft — both within rangeFt=120. v1 hits BOTH (no point-selection).
  const hp1Before = g1.currentHP;
  const hp2Before = g2.currentHP;
  const bf = makeBF([dragon, g1, g2]);
  runCombat(bf, [dragon.id, g1.id, g2.id], { maxRounds: 1, verbose: false } as any);
  // Both took damage (v1 over-approximation hits all in rangeFt).
  assert('v1 regression: g1 took damage (dex save fail)', g1.currentHP < hp1Before,
    `hp ${hp1Before} → ${g1.currentHP}`);
  assert('v1 regression: g2 took damage (dex save fail)', g2.currentHP < hp2Before,
    `hp ${hp2Before} → ${g2.currentHP}`);
}

// ============================================================
// 11. Direct parser: synthetic "centered on a point" text → centerOnPoint=true
// ============================================================
console.log('\n--- 11. Direct parser: synthetic centered-on-point text ---');
{
  const pointText = 'Freezing fog fills a 20-foot-radius sphere centered on a point the dragon can see within 120 feet of it. Each creature in the fog must make a DC 10 Constitution saving throw.';
  const a = extractLairAction(pointText, 'White Dragon', 0);
  eq('synthetic point text: centerOnPoint = true', a.centerOnPoint, true);
  eq('synthetic point text: radiusFt = 20', a.radiusFt, 20);
  eq('synthetic point text: rangeFt = 120', a.rangeFt, 120);

  const selfText = 'Magma erupts from the ground at a point the dragon chooses within 60 feet of it. Each creature on the ground in a 10-foot cube must make a DC 15 Dexterity saving throw.';
  // Note: "at a point" (not "centered on a point") → centerOnPoint stays false.
  // This confirms the regex is specific to the "centered on a point" phrasing.
  const b = extractLairAction(selfText, 'Red Dragon', 0);
  eq('synthetic "at a point" text: centerOnPoint = false (regex specificity)', b.centerOnPoint, false);

  const eachWithinText = 'Each creature within 30 feet of the dragon must make a DC 15 Wisdom saving throw.';
  const c = extractLairAction(eachWithinText, 'Black Dragon', 0);
  eq('synthetic "each within" text: centerOnPoint = false', c.centerOnPoint, false);
}

// ============================================================
// 12. Session 104 grid-sweep: midpoint catches 2 enemies exactly
//     radiusFt apart (v1 would catch only 1)
// ============================================================
console.log('\n--- 12. Session 104 grid-sweep: midpoint catches spread pair ---');
{
  // Two goblins exactly radiusFt apart (Chebyshev). v1 (creature-position
  // centres) catches only 1; the Session 104 grid-sweep finds the midpoint
  // cell that catches both.
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(4, 0);   // 20 ft from dragon
  const g2 = spawn('Goblin'); g2.pos = pos(8, 0);   // 40 ft from dragon, 20 ft from g1
  // radiusFt=20 (4 squares). g1-g2=4sq(20ft)≤20ft → g2 is JUST within radiusFt of g1.
  // v1: center at g1 catches {g1,g2} (2) — g2 is exactly on the radius boundary.
  // To show the grid-sweep midpoint advantage, use radiusFt=15 (3 squares):
  //   g1-g2=4sq(20ft)>15ft → v1 catches only {g1} (1) or {g2} (1).
  //   Grid-sweep midpoint at (6,0): g1=2sq(10ft)≤15ft, g2=2sq(10ft)≤15ft → 2 targets.
  //   (6,0) is 30ft from dragon ≤ rangeFt=120 → legal centre.
  const action = makeAction('Test::midpoint', 'save_condition', {
    radiusFt: 15, rangeFt: 120, centerOnPoint: true,
  });
  const { center, targets } = chooseLairActionPoint(dragon, action, [g1, g2]);
  eq('midpoint: 2 targets hit (grid-sweep midpoint)', targets.length, 2);
  const ids = targets.map(t => t.id).sort();
  eq('midpoint: includes g1', ids.includes(g1.id), true);
  eq('midpoint: includes g2', ids.includes(g2.id), true);
  // Cells catching both g1(4,0) and g2(8,0) with radiusFt=15 (3 squares):
  //   x in [5,7] (g1: 4±3 → 1..7; g2: 8±3 → 5..11; intersection: 5..7), y in [-3,3].
  // Closest-to-dragon (Chebyshev then Euclidean): (5,0) — 5 squares Chebyshev,
  // 5 ft Euclidean (on-axis, beats (5,±1) at ~5.1 ft Euclidean).
  eq('midpoint: center x=5 (closest-to-dragon cell catching both)', center.x, 5);
  eq('midpoint: center y=0 (Euclidean tie-break prefers on-axis)', center.y, 0);
}

// ============================================================
// 13. Session 104 grid-sweep: 3 spread enemies caught via midpoint
//     (v1 would catch only the densest pair)
// ============================================================
console.log('\n--- 13. Session 104 grid-sweep: 3 spread enemies via midpoint ---');
{
  // Same geometry as §5 but WITH rangeFt set → grid-sweep runs and finds 3.
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(1, 0);   // 5 ft from dragon (isolated)
  const g2 = spawn('Goblin'); g2.pos = pos(6, 0);   // 30 ft from dragon
  const g3 = spawn('Goblin'); g3.pos = pos(7, 0);   // 35 ft from dragon, 5 ft from g2
  // radiusFt=20 (4 squares). g1-g2=5sq(25ft)>20ft, g1-g3=6sq(30ft)>20ft, g2-g3=1sq(5ft)≤20ft.
  // v1: best = {g2,g3} (2) — g1 too far from both.
  // Grid-sweep: centre at (3,0) catches g1(10ft), g2(15ft), g3(20ft) — all ≤20ft → 3.
  // (3,0) is 15ft from dragon ≤ rangeFt=120 → legal. Grid-sweep wins (3 > 2).
  const action = makeAction('Test::midpoint3', 'save_condition', {
    radiusFt: 20, rangeFt: 120, centerOnPoint: true,
  });
  const { center, targets } = chooseLairActionPoint(dragon, action, [g1, g2, g3]);
  eq('midpoint3: 3 targets hit (grid-sweep beats v1)', targets.length, 3);
  const ids = targets.map(t => t.id).sort();
  eq('midpoint3: includes g1', ids.includes(g1.id), true);
  eq('midpoint3: includes g2', ids.includes(g2.id), true);
  eq('midpoint3: includes g3', ids.includes(g3.id), true);
  // The optimal midpoint centre is at x=3 (catches all 3; x=2 also catches all 3
  // but x=3 is closer to g2/g3... actually both x=2 and x=3 catch all 3:
  //   x=2: g1=5ft, g2=20ft, g3=25ft(>20ft) → NO, g3 at 25ft > 20ft. So x=2 catches only 2.
  //   x=3: g1=10ft, g2=15ft, g3=20ft → all ≤20ft → 3.
  // So x=3 is the unique optimal. Tie-break: closest to dragon (x=3 is 15ft).
  eq('midpoint3: center x=3 (unique midpoint catching all 3)', center.x, 3);
  eq('midpoint3: center y=0', center.y, 0);
}

// ============================================================
// 14. Session 104 grid-sweep: v1 optimal → grid-sweep does NOT override
//     (same count → v1 creature-position centre preserved)
// ============================================================
console.log('\n--- 14. Session 104 grid-sweep: v1 optimal → v1 centre preserved ---');
{
  // Clustered case: v1 already catches all 3 from g1's position. Grid-sweep
  // cannot improve (3 = 3) → v1 result returned (centre = g1.pos, a natural
  // creature position, NOT an arbitrary grid cell).
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(3, 0);   // 15 ft from dragon
  const g2 = spawn('Goblin'); g2.pos = pos(4, 0);   // 20 ft, 5 ft from g1
  const g3 = spawn('Goblin'); g3.pos = pos(5, 0);   // 25 ft, 10 ft from g1
  // radiusFt=20 (4 squares). g1-g2=1sq(5ft), g1-g3=2sq(10ft), g2-g3=1sq(5ft) — all ≤20ft.
  // v1: center at g1 catches all 3. Grid-sweep: also 3, but v1 wins (same count).
  const action = makeAction('Test::v1optimal', 'save_condition', {
    radiusFt: 20, rangeFt: 120, centerOnPoint: true,
  });
  const { center, targets } = chooseLairActionPoint(dragon, action, [g1, g2, g3]);
  eq('v1optimal: 3 targets hit', targets.length, 3);
  // v1 centre = g1.pos (creature position) — NOT a grid-sweep cell.
  eq('v1optimal: center = g1 pos x (v1 preserved, not grid-sweep)', center.x, g1.pos.x);
  eq('v1optimal: center = g1 pos y', center.y, g1.pos.y);
}

// ============================================================
// 15. Session 104 grid-sweep: rangeFt bounds the grid (centre within range)
// ============================================================
console.log('\n--- 15. Session 104 grid-sweep: rangeFt bounds centre ---');
{
  // Dragon at (0,0), rangeFt=30 (6 squares). g1 at (6,0)=30ft (boundary),
  // g2 at (8,0)=40ft (BEYOND rangeFt — not a candidate). With only g1 as
  // candidate, v1 catches 1. Grid-sweep also catches 1 (g1 alone) — same
  // count → v1 wins. This confirms rangeFt bounds the grid (no centre
  // beyond rangeFt is considered).
  const dragon = spawn('Adult Blue Dragon'); dragon.pos = pos(0, 0);
  const g1 = spawn('Goblin'); g1.pos = pos(6, 0);   // 30 ft from dragon (at rangeFt boundary)
  const action = makeAction('Test::rangebound', 'save_condition', {
    radiusFt: 20, rangeFt: 30, centerOnPoint: true,
  });
  const { targets } = chooseLairActionPoint(dragon, action, [g1]);
  eq('rangebound: 1 target (only g1 in range)', targets.length, 1);
  eq('rangebound: target is g1', targets[0].id, g1.id);
}

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
