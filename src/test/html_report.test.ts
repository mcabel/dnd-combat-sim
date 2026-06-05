// ============================================================
// HTML Report Tests (Phase 6)
// Validates generateHTMLReport and saveHTMLReport output.
// All tests are deterministic — no RNG.
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { generateHTMLReport, saveHTMLReport } from '../scenarios/html_report';
import { SimulationResult, CombatantStats }   from '../scenarios/simulate';

// ---- Helpers ------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function contains(html: string, snippet: string, label: string): void {
  assert(html.includes(snippet), label);
}

function notContains(html: string, snippet: string, label: string): void {
  assert(!html.includes(snippet), label);
}

// ---- Fixture ------------------------------------------------

function makeStats(id: string, name: string, side: 'party'|'enemy' = 'party'): CombatantStats {
  return {
    id, name, side,
    survivalRate:   0.8,
    avgDamageDealt: 32.5,
    avgHpRemaining: 12.1,
    avgRoundsAlive: 4.2,
  };
}

function makeResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    runs:         100,
    partyWinRate: 0.72,
    enemyWinRate: 0.24,
    drawRate:     0.04,
    avgRounds:    4.85,
    minRounds:    2,
    maxRounds:    12,
    combatantStats: [
      makeStats('fighter-1', 'Fighter', 'party'),
      makeStats('zombie-1',  'Zombie',  'enemy'),
    ],
    roundDistribution: { 2:10, 3:25, 4:30, 5:20, 6:10, 7:5 },
    runResults: Array.from({ length: 100 }, (_, i) => ({
      winner:      (i < 72 ? 'party' : i < 96 ? 'enemy' : 'draw') as 'party' | 'enemy' | 'draw',
      rounds:      2 + (i % 11),
      damageDealt: new Map([['fighter-1', 30], ['zombie-1', 10]]),
      survived:    new Map([['fighter-1', i < 72], ['zombie-1', i >= 72]]),
      hpRemaining: new Map([['fighter-1', 12], ['zombie-1', 0]]),
      log:         { winner: 'party', rounds: 5, events: [] } as any,
    })),
    ...overrides,
  };
}

// ---- Tests --------------------------------------------------

console.log('\n=== html_report.test.ts ===\n');

// 1. Valid HTML skeleton
{
  const html = generateHTMLReport(makeResult());
  contains(html, '<!DOCTYPE html>', 'has DOCTYPE');
  contains(html, '<html lang="en">', 'has html tag');
  contains(html, '</html>', 'closes html');
  contains(html, '<title>', 'has title tag');
  contains(html, '</body>', 'closes body');
}

// 2. Title injection
{
  const html = generateHTMLReport(makeResult(), { title: 'Fighter vs Zombie Horde' });
  contains(html, 'Fighter vs Zombie Horde', 'custom title appears');
}

// 3. Default title fallback
{
  const html = generateHTMLReport(makeResult());
  contains(html, 'D&amp;D 5e Combat Simulation', 'default title present');
}

// 4. Win rates rendered
{
  const html = generateHTMLReport(makeResult());
  contains(html, '72.0%', 'party win rate 72%');
  contains(html, '24.0%', 'enemy win rate 24%');
  contains(html, '4.0%',  'draw rate 4%');
}

// 5. Draw section omitted when drawRate = 0
{
  const html = generateHTMLReport(makeResult({ drawRate: 0, partyWinRate: 0.75, enemyWinRate: 0.25 }));
  notContains(html, 'Draw rate', 'no draw section when drawRate=0');
}

// 6. Combatant names appear
{
  const html = generateHTMLReport(makeResult());
  contains(html, 'Fighter', 'fighter name in table');
  contains(html, 'Zombie',  'zombie name in table');
}

// 7. Party/enemy badges
{
  const html = generateHTMLReport(makeResult(), { partyIds: ['fighter-1'] });
  contains(html, 'badge party', 'party badge present');
  contains(html, 'badge enemy', 'enemy badge present');
}

// 8. No badges when partyIds omitted — both get enemy badge by default
{
  const html = generateHTMLReport(makeResult());
  // Without partyIds, partySet is empty so all get enemy badge
  const partyCount = (html.match(/badge party/g) ?? []).length;
  assert(partyCount === 0, 'no party badges when partyIds omitted');
}

// 9. Avg rounds rendered
{
  const html = generateHTMLReport(makeResult());
  contains(html, '4.85', 'avg rounds shown');
}

// 10. Round range rendered
{
  const html = generateHTMLReport(makeResult());
  contains(html, '2–12', 'round range shown');
}

// 11. Histogram SVG present when runResults non-empty
{
  const html = generateHTMLReport(makeResult());
  // Histogram wraps in <svg with viewBox
  const svgCount = (html.match(/<svg/g) ?? []).length;
  assert(svgCount >= 2, 'at least 2 SVG elements (bars + histogram)');
}

// 12. Histogram omitted message when runResults empty
{
  const html = generateHTMLReport(makeResult({ runResults: [] }));
  contains(html, 'No per-run data available', 'fallback text when runResults empty');
}

// 13. XSS escaping in title
{
  const html = generateHTMLReport(makeResult(), { title: '<script>alert(1)</script>' });
  notContains(html, '<script>alert', 'script tag escaped in title');
  contains(html, '&lt;script&gt;', 'title properly HTML-escaped');
}

// 14. XSS escaping in combatant name
{
  const result = makeResult();
  result.combatantStats[0].name = '<img src=x onerror=alert(1)>';
  const html = generateHTMLReport(result);
  notContains(html, '<img src=x', 'img tag escaped in combatant name');
}

// 15. Survival rate color coding — high survival
{
  const result = makeResult();
  result.combatantStats[0].survivalRate = 0.9;
  const html = generateHTMLReport(result);
  contains(html, '#0F6E56', 'green color for high survival');
}

// 16. Survival rate color coding — low survival
{
  const result = makeResult();
  result.combatantStats[0].survivalRate = 0.2;
  const html = generateHTMLReport(result);
  contains(html, '#993C1D', 'red color for low survival');
}

// 17. GitHub repo link
{
  const html = generateHTMLReport(makeResult());
  contains(html, 'github.com/mcabel/dnd-combat-sim', 'repo link present');
}

// 18. saveHTMLReport writes a file
{
  const tmpDir  = os.tmpdir();
  const outPath = path.join(tmpDir, `dnd-report-test-${Date.now()}.html`);
  const saved   = saveHTMLReport(makeResult(), outPath, { title: 'Save Test' });
  assert(fs.existsSync(saved), 'saveHTMLReport creates file');
  const content = fs.readFileSync(saved, 'utf-8');
  contains(content, 'Save Test', 'saved file contains custom title');
  fs.unlinkSync(saved);
}

// 19. saveHTMLReport creates intermediate directories
{
  const tmpDir  = os.tmpdir();
  const nested  = path.join(tmpDir, `dnd-nested-${Date.now()}`, 'sub', 'report.html');
  const saved   = saveHTMLReport(makeResult(), nested);
  assert(fs.existsSync(saved), 'saveHTMLReport creates nested directories');
  fs.rmSync(path.dirname(path.dirname(saved)), { recursive: true, force: true });
}

// 20. saveHTMLReport returns resolved path
{
  const tmpDir  = os.tmpdir();
  const relOut  = path.join(tmpDir, `dnd-abs-${Date.now()}.html`);
  const saved   = saveHTMLReport(makeResult(), relOut);
  assert(path.isAbsolute(saved), 'saveHTMLReport returns absolute path');
  if (fs.existsSync(saved)) fs.unlinkSync(saved);
}

// ---- Day section tests --------------------------------------

function makeDayResult() {
  const r = makeResult();
  return {
    encounters: [r, { ...r, partyWinRate: 0.45, enemyWinRate: 0.50, drawRate: 0.05 }],
    labels: ['Forest ambush', 'Dungeon boss'],
    resourceSnapshots: [],
  };
}

// 21. Day section renders when provided
{
  const html = generateHTMLReport(makeResult(), { day: makeDayResult() });
  contains(html, 'Adventuring day', 'day section heading present');
  contains(html, 'Forest ambush',   'first encounter label');
  contains(html, 'Dungeon boss',    'second encounter label');
}

// 22. Day section absent when not provided
{
  const html = generateHTMLReport(makeResult());
  notContains(html, 'Adventuring day', 'no day section without DayResult');
}

// 23. Self-contained — no external stylesheet or script src
{
  const html = generateHTMLReport(makeResult());
  notContains(html, '<link rel="stylesheet"', 'no external stylesheet');
  notContains(html, 'src="http',              'no external scripts');
}

// ---- Results ------------------------------------------------

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
