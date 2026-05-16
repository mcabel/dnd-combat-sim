// ============================================================
// Benchmark Runner (Phase 7.4)
// Runs every registered preset with a configurable sample size
// and prints a ranked comparison table.
//
// Usage:
//   npx ts-node src/scenarios/benchmark.ts           # 50 runs each
//   npx ts-node src/scenarios/benchmark.ts --runs 200
//   npx ts-node src/scenarios/benchmark.ts --runs 20 --fast
// ============================================================

import { PRESETS }           from './presets';
import { simulate }           from './simulate';

// ---- CLI args -----------------------------------------------

const args   = process.argv.slice(2);
const runsArg = args.indexOf('--runs');
const RUNS   = runsArg !== -1 ? parseInt(args[runsArg + 1], 10) : 50;
const FAST   = args.includes('--fast');

// ---- Table helpers ------------------------------------------

function pct(n: number): string { return (n * 100).toFixed(1).padStart(5) + '%'; }
function pad(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(w) : str.padEnd(w);
}
function bar(rate: number, w = 20): string {
  const filled = Math.round(rate * w);
  return '[' + '█'.repeat(filled) + '░'.repeat(w - filled) + ']';
}

// ---- Run all presets ----------------------------------------

export interface BenchmarkRow {
  id:           string;
  name:         string;
  partyWinRate: number;
  enemyWinRate: number;
  drawRate:     number;
  avgRounds:    number;
  runs:         number;
  error?:       string;
}

export async function runBenchmark(runs = RUNS): Promise<BenchmarkRow[]> {
  const rows: BenchmarkRow[] = [];

  for (const preset of PRESETS) {
    process.stdout.write(`  Running: ${preset.id.padEnd(32)}`);
    try {
      const spec   = preset.build();
      const result = simulate(spec, { runs, maxRounds: 40 });
      rows.push({
        id:           preset.id,
        name:         preset.name,
        partyWinRate: result.partyWinRate,
        enemyWinRate: result.enemyWinRate,
        drawRate:     result.drawRate,
        avgRounds:    result.avgRounds,
        runs,
      });
      process.stdout.write(`party ${pct(result.partyWinRate)}  rounds ${result.avgRounds.toFixed(1)}\n`);
    } catch (e) {
      const msg = (e as Error).message;
      rows.push({ id: preset.id, name: preset.name,
        partyWinRate: 0, enemyWinRate: 0, drawRate: 0, avgRounds: 0, runs: 0, error: msg });
      process.stdout.write(`ERROR: ${msg.substring(0, 50)}\n`);
    }
  }

  return rows;
}

export function printBenchmarkTable(rows: BenchmarkRow[]): void {
  const line = '─'.repeat(72);
  console.log(`\n${'═'.repeat(72)}`);
  console.log(' Encounter Benchmark Results');
  console.log(`${'═'.repeat(72)}`);
  console.log(
    `  ${ pad('Encounter', 32) } ${ pad('Party', 7, true) } ${ pad('Enemy', 7, true) }` +
    ` ${ pad('Draw', 7, true) } ${ pad('Rounds', 7, true) }`
  );
  console.log(`  ${line}`);

  const sorted = [...rows].sort((a, b) => b.partyWinRate - a.partyWinRate);
  for (const r of sorted) {
    if (r.error) {
      console.log(`  ${ pad(r.id, 32) } ⚠️  ${r.error.substring(0, 35)}`);
      continue;
    }
    const highlight = r.partyWinRate >= 0.75 ? '\x1b[32m'  // green
                    : r.partyWinRate <= 0.25 ? '\x1b[31m'  // red
                    : '';                                    // default
    const reset = highlight ? '\x1b[0m' : '';
    console.log(
      `${highlight}  ${ pad(r.id, 32) }` +
      ` ${ pct(r.partyWinRate) }` +
      ` ${ pct(r.enemyWinRate) }` +
      ` ${ pct(r.drawRate) }` +
      ` ${ r.avgRounds.toFixed(1).padStart(7) }${reset}`
    );
  }

  console.log(`  ${line}`);
  const valid = rows.filter(r => !r.error);
  if (valid.length > 0) {
    const avgParty  = valid.reduce((s, r) => s + r.partyWinRate, 0) / valid.length;
    const avgRounds = valid.reduce((s, r) => s + r.avgRounds, 0)    / valid.length;
    console.log(
      `  ${ pad('AVERAGE', 32) }` +
      ` ${ pct(avgParty) }` +
      ` ${ pct(1 - avgParty) }` +
      ` ${ pct(0) }` +
      ` ${ avgRounds.toFixed(1).padStart(7) }`
    );
  }
  console.log(`${'═'.repeat(72)}\n`);
  console.log(`  ${rows.length} presets · ${RUNS} runs each · ${valid.length} succeeded\n`);
}

// ---- Main ---------------------------------------------------

if (require.main === module) {
  console.log(`\nD&D 5e Combat Sim — Benchmark (${RUNS} runs per preset)\n`);
  runBenchmark(RUNS).then(rows => printBenchmarkTable(rows));
}
