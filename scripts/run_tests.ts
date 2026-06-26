#!/usr/bin/env npx ts-node
// ============================================================
// scripts/run_tests.ts — Parallel test runner
//
// Runs src/test/*.test.ts files in parallel with deterministic
// chunking. Designed for three use cases:
//
//   1. LOCAL pre-push validation (full run, all files):
//        npx ts-node --transpile-only scripts/run_tests.ts
//
//   2. CI matrix (one chunk per matrix job):
//        npx ts-node --transpile-only scripts/run_tests.ts --chunk 1 --total 6
//
//   3. SUBAGENT / failure diagnosis (machine-readable JSON):
//        npx ts-node --transpile-only scripts/run_tests.ts --json --chunk 3 --total 6
//
// Flags:
//   --chunk N        Run only chunk N of --total (1-indexed). Default: 1.
//   --total M        Divide files into M chunks (deterministic: i % M === N-1). Default: 1.
//   --parallel K     Max concurrent worker processes. Default: min(os.cpus(), 6).
//   --pattern GLOB   Only run files matching GLOB (e.g. "src/test/fire*"). Default: src/test/*.test.ts
//   --timeout S      Per-file timeout in seconds. Default: 60.
//   --json           Emit machine-readable JSON summary (no progress dots).
//   --quiet          Suppress per-file output (only final summary).
//   --help           Show this help.
//
// Design decisions (see docs/PARALLEL-TESTING.md for full rationale):
//
//   - ONE FILE PER PROCESS: each test file runs in its own `ts-node`
//     child process. This prevents global-state leakage between test
//     files (some tests mutate module-level Maps, bestiary caches,
//     _id counters, etc.). The cost is ~1-4s ts-node startup per file,
//     but parallelism compensates.
//
//   - DETERMINISTIC CHUNKING: files are sorted alphabetically, then
//     assigned via `i % total === chunk - 1`. This guarantees local
//     chunk 3 == CI chunk 3 for the same commit — enabling exact
//     reproduction of CI failures locally.
//
//   - WORKER POOL: a simple async pool with configurable concurrency.
//     Each worker pulls the next file from the chunk's queue, spawns
//     ts-node, captures output, enforces timeout, and records results.
//
//   - SIGNAL HANDLING: SIGINT/SIGTERM kills all in-flight child
//     processes to prevent zombies.
//
//   - OUTPUT PARSING: greps for "Results: N passed, M failed" in
//     stdout. If missing (crash/timeout), marks as failed with the
//     captured output for diagnosis.
//
// Exit code: 0 if all files pass, 1 if any fail.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';

// ---- Types --------------------------------------------------

interface TestResult {
  file: string;           // relative path (e.g. src/test/fireball.test.ts)
  basename: string;       // fireball.test.ts
  passed: number;         // test assertions passed (-1 if unknown/crash)
  failed: number;         // test assertions failed (-1 if unknown/crash)
  durationMs: number;
  exitCode: number | null;// null = timeout/killed
  timedOut: boolean;
  output: string;         // full stdout+stderr (truncated to last 5000 chars on failure)
  summaryLine: string;    // the "Results: ..." line, or '' if not found
}

interface ChunkSummary {
  chunk: number;
  total: number;
  filesTotal: number;
  filesPassed: number;    // files with 0 failed assertions + clean exit
  filesFailed: number;
  testsPassed: number;    // aggregate assertion count
  testsFailed: number;
  durationMs: number;
  parallelism: number;
  files: string[];        // list of files in this chunk (for reproducibility)
  failures: TestResult[]; // details for each failed file
  passes: { file: string; passed: number; failed: number; durationMs: number }[];
}

// ---- Config -------------------------------------------------

interface Config {
  chunk: number;
  total: number;
  parallel: number;
  pattern: string;
  timeoutSec: number;
  json: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Config {
  const cfg: Config = {
    chunk: 1,
    total: 1,
    parallel: Math.min(os.cpus().length, 6),
    pattern: 'src/test/*.test.ts',
    timeoutSec: 120,
    json: false,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--chunk':    cfg.chunk = parseInt(argv[++i], 10); break;
      case '--total':    cfg.total = parseInt(argv[++i], 10); break;
      case '--parallel': cfg.parallel = parseInt(argv[++i], 10); break;
      case '--pattern':  cfg.pattern = argv[++i]; break;
      case '--timeout':  cfg.timeoutSec = parseInt(argv[++i], 10); break;
      case '--json':     cfg.json = true; break;
      case '--quiet':    cfg.quiet = true; break;
      case '--help':
        console.log(fs.readFileSync(__filename, 'utf8').split('// =====')[1].split('// =====')[0]);
        process.exit(0);
      default:
        console.error(`Unknown flag: ${arg}`);
        process.exit(2);
    }
  }
  if (cfg.chunk < 1 || cfg.chunk > cfg.total) {
    console.error(`Invalid --chunk ${cfg.chunk} for --total ${cfg.total} (must be 1..${cfg.total})`);
    process.exit(2);
  }
  if (cfg.parallel < 1) cfg.parallel = 1;
  return cfg;
}

// ---- File Discovery -----------------------------------------

/**
 * Discover test files matching the pattern. Uses a simple glob
 * expansion (no dependency on glob package). Supports:
 *   - literal paths: src/test/foo.test.ts
 *   - * wildcard in basename: src/test/*.test.ts
 *   - * wildcard in directory: src/test/fire*
 *
 * Returns sorted alphabetically for deterministic chunking.
 */
function discoverFiles(pattern: string): string[] {
  const repoRoot = path.resolve(__dirname, '..');

  // Handle the common case: src/test/*.test.ts
  if (pattern.includes('*')) {
    const dir = path.dirname(pattern);
    const glob = path.basename(pattern);
    const dirAbs = path.resolve(repoRoot, dir);
    if (!fs.existsSync(dirAbs)) return [];
    const regex = new RegExp('^' + glob.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    const files = fs.readdirSync(dirAbs)
      .filter(f => regex.test(f))
      .map(f => path.join(dir, f).replace(/\\/g, '/'));
    return files.sort();
  }

  // Literal path
  const abs = path.resolve(repoRoot, pattern);
  return fs.existsSync(abs) ? [pattern] : [];
}

// ---- Chunking -----------------------------------------------

/**
 * Deterministic chunking: file at index i goes to chunk (i % total) + 1.
 * This guarantees local chunk N == CI chunk N for the same commit.
 */
function chunkFiles(files: string[], chunk: number, total: number): string[] {
  return files.filter((_, i) => i % total === chunk - 1);
}

// ---- Test Execution -----------------------------------------

const TS_NODE_ENV = {
  ...process.env,
  // Match the CI workflow's TS_NODE_COMPILER_OPTIONS exactly.
  // These are required for test files that use DOM types (Map, Set, etc.)
  // and Node types (process, fs, etc.).
  TS_NODE_COMPILER_OPTIONS: JSON.stringify({
    lib: ['ES2020', 'DOM'],
    types: ['node'],
  }),
};

/**
 * Resolve the ts-node binary path. Prefers the local node_modules
 * installation (avoids `npx` overhead — npx itself spawns a process).
 */
function resolveTsNodeBin(): string {
  const repoRoot = path.resolve(__dirname, '..');
  const candidates = [
    path.join(repoRoot, 'node_modules', '.bin', 'ts-node'),
    path.join(repoRoot, 'node_modules', 'ts-node', 'dist', 'bin.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fallback: assume global ts-node
  return 'ts-node';
}

const TS_NODE_BIN = resolveTsNodeBin();

/**
 * Run a single test file in a child process.
 *
 * - Spawns: ts-node --transpile-only <file>
 * - Captures stdout + stderr
 * - Enforces per-file timeout (kills process on expiry)
 * - Parses "Results: N passed, M failed" from output
 *
 * Returns a TestResult regardless of outcome (never throws).
 */
function runOne(file: string, timeoutSec: number): Promise<TestResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const repoRoot = path.resolve(__dirname, '..');
    const absFile = path.resolve(repoRoot, file);

    let output = '';
    let child: ChildProcess;
    let timedOut = false;
    let killed = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      killed = true;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
    }, timeoutSec * 1000);

    try {
      child = spawn(TS_NODE_BIN, ['--transpile-only', absFile], {
        env: TS_NODE_ENV,
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      resolve({
        file, basename: path.basename(file),
        passed: -1, failed: -1,
        durationMs: Date.now() - start,
        exitCode: null, timedOut: false,
        output: `Failed to spawn ts-node: ${err}`,
        summaryLine: '',
      });
      return;
    }

    child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { output += data.toString(); });

    child.on('close', (exitCode) => {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - start;

      // Parse "Results: N passed, M failed" from output
      // Handle both "Results: 113 passed, 0 failed" and
      // "=== Results: 113 passed, 0 failed ===" variants
      const match = output.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
      let passed = -1, failed = -1;
      let summaryLine = '';
      if (match) {
        passed = parseInt(match[1], 10);
        failed = parseInt(match[2], 10);
        // Extract the full summary line for reporting
        const lineMatch = output.match(/.*Results:\s*\d+\s*passed,\s*\d+\s*failed.*/);
        summaryLine = lineMatch ? lineMatch[0].trim() : `Results: ${passed} passed, ${failed} failed`;
      }

      // Truncate output for failed files (keep last 5000 chars — most useful
      // for diagnosis). Passes get empty output to keep summary concise.
      const truncOutput = (failed !== 0 || exitCode !== 0 || timedOut)
        ? output.slice(-5000)
        : '';

      resolve({
        file,
        basename: path.basename(file),
        passed, failed,
        durationMs,
        exitCode: killed ? null : exitCode,
        timedOut,
        output: truncOutput,
        summaryLine,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - start;
      resolve({
        file, basename: path.basename(file),
        passed: -1, failed: -1,
        durationMs,
        exitCode: null, timedOut: false,
        output: `Process error: ${err.message}`,
        summaryLine: '',
      });
    });
  });
}

// ---- Worker Pool --------------------------------------------

/**
 * Simple async worker pool. Each worker pulls the next file from
 * `files` and runs it. Returns results in completion order (NOT
 * input order — for ordered output, sort after).
 */
async function runPool(
  files: string[],
  parallel: number,
  timeoutSec: number,
  onProgress: (done: number, total: number, file: string, result: TestResult) => void,
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let index = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (index < files.length) {
      const file = files[index++];
      const result = await runOne(file, timeoutSec);
      results.push(result);
      done++;
      onProgress(done, files.length, file, result);
    }
  }

  // Spawn `parallel` workers. Promise.all waits for all to complete.
  const workers = Array.from({ length: Math.min(parallel, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---- Signal Handling ----------------------------------------

const activeChildren: ChildProcess[] = [];
let killedBySignal = false;

function killAllChildren(): void {
  for (const c of activeChildren) {
    try { c.kill('SIGKILL'); } catch { /* already dead */ }
  }
}

process.on('SIGINT', () => {
  killedBySignal = true;
  console.error('\n[SIGINT] Killing all child processes...');
  killAllChildren();
  process.exit(130);
});
process.on('SIGTERM', () => {
  killedBySignal = true;
  console.error('\n[SIGTERM] Killing all child processes...');
  killAllChildren();
  process.exit(143);
});

// ---- Main ---------------------------------------------------

async function main(): Promise<number> {
  const cfg = parseArgs(process.argv);

  // Discover + chunk
  const allFiles = discoverFiles(cfg.pattern);
  if (allFiles.length === 0) {
    console.error(`No test files found matching pattern: ${cfg.pattern}`);
    return 1;
  }
  const chunkFilesList = chunkFiles(allFiles, cfg.chunk, cfg.total);

  if (!cfg.json) {
    console.log(`Test Runner: chunk ${cfg.chunk}/${cfg.total}, ${chunkFilesList.length} files, parallel=${cfg.parallel}, timeout=${cfg.timeoutSec}s`);
    console.log(`  (total files in suite: ${allFiles.length})`);
  }

  const startAll = Date.now();

  // Progress callback (human mode only)
  const onProgress = cfg.json || cfg.quiet
    ? () => {}
    : (done: number, total: number, file: string, result: TestResult) => {
        const status = result.timedOut ? '⏱ TIMEOUT'
          : result.failed > 0 ? `❌ ${result.failed} fail`
          : result.passed >= 0 ? `✅ ${result.passed} pass`
          : '💥 CRASH';
        const pct = Math.round(done / total * 100);
        process.stdout.write(`  [${pct.toString().padStart(3)}%] ${done}/${total} ${status.padEnd(12)} ${path.basename(file)}\n`);
      };

  const results = await runPool(chunkFilesList, cfg.parallel, cfg.timeoutSec, onProgress);
  const durationMs = Date.now() - startAll;

  // Sort results alphabetically for stable output
  results.sort((a, b) => a.file.localeCompare(b.file));

  // Aggregate
  let filesPassed = 0, filesFailed = 0;
  let testsPassed = 0, testsFailed = 0;
  const failures: TestResult[] = [];
  const passes: { file: string; passed: number; failed: number; durationMs: number }[] = [];

  for (const r of results) {
    const isPass = !r.timedOut && r.failed === 0 && r.passed >= 0 && (r.exitCode === 0 || r.exitCode === null);
    if (isPass) {
      filesPassed++;
      if (r.passed > 0) testsPassed += r.passed;
      passes.push({ file: r.file, passed: r.passed, failed: r.failed, durationMs: r.durationMs });
    } else {
      filesFailed++;
      if (r.passed > 0) testsPassed += r.passed;
      if (r.failed > 0) testsFailed += r.failed;
      failures.push(r);
    }
  }

  const summary: ChunkSummary = {
    chunk: cfg.chunk,
    total: cfg.total,
    filesTotal: chunkFilesList.length,
    filesPassed,
    filesFailed,
    testsPassed,
    testsFailed,
    durationMs,
    parallelism: cfg.parallel,
    files: chunkFilesList,
    failures,
    passes,
  };

  // Output
  if (cfg.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`  Chunk ${cfg.chunk}/${cfg.total}: ${filesPassed}/${chunkFilesList.length} files passed, ${filesFailed} failed`);
    console.log(`  Assertions: ${testsPassed} passed, ${testsFailed} failed`);
    console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s (parallelism: ${cfg.parallel})`);
    console.log('════════════════════════════════════════════════════════════');

    if (failures.length > 0) {
      console.log('');
      console.log('─── FAILURES ───');
      for (const f of failures) {
        const reason = f.timedOut ? `TIMEOUT (>${cfg.timeoutSec}s)`
          : f.passed < 0 ? 'CRASH (no Results: line)'
          : `${f.failed} assertion(s) failed`;
        console.log('');
        console.log(`  ❌ ${f.basename} — ${reason} — ${f.durationMs}ms`);
        if (f.summaryLine) {
          console.log(`     ${f.summaryLine}`);
        }
        if (f.output) {
          // Print last ~30 lines of output for diagnosis
          const lines = f.output.split('\n').filter(l => l.trim());
          const tail = lines.slice(-30);
          console.log('     ── output (last 30 lines) ──');
          for (const line of tail) {
            console.log(`     ${line}`);
          }
        }
      }
    }
  }

  return filesFailed > 0 ? 1 : 0;
}

main().then((exitCode) => {
  if (killedBySignal) process.exit(130);
  process.exit(exitCode);
}).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
