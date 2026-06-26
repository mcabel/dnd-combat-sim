# Parallel Testing Practice

**Status:** Default practice as of Session 74 (2026-06-26)
**Applies to:** All agents (Z.ai, Sheet, any future) working on `dnd-combat-sim`

---

## TL;DR — What to do before every push

```bash
# Run the full test suite locally (parallel, ~5 min):
npx ts-node --transpile-only scripts/run_tests.ts

# Or via npm:
npm test
```

**Only push if the local run is green.** This catches ~90% of failures before the CI wait.

If a CI chunk fails, reproduce locally with:
```bash
npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6
```

---

## Architecture

Three layers compose into a single coherent system:

```
                    ┌─────────────────────────────┐
                    │  scripts/run_tests.ts        │
                    │  (single source of truth)    │
                    │                              │
                    │  Flags:                      │
                    │   --chunk N --total M        │
                    │   --parallel K               │
                    │   --pattern "src/test/a*"    │
                    │   --json                     │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────────┐
              ▼                ▼                     ▼
     ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
     │ LOCAL (pre-push)│  │ CI (matrix)     │  │ SUBAGENTS        │
     │                 │  │                 │  │ (failure analysis)│
     │ npm test        │  │ matrix.chunk:   │  │                  │
     │ (full run,      │  │  [1,2,3,4,5,6]  │  │ Each subagent    │
     │  parallel=4,    │  │ each runs:      │  │ runs one chunk   │
     │  ~5 min)        │  │  run_tests.ts   │  │ via --json and   │
     │                 │  │  --chunk N      │  │ investigates     │
     │                 │  │  --total 6      │  │ failures         │
     └─────────────────┘  └─────────────────┘  └──────────────────┘
```

### Layer 1: `scripts/run_tests.ts` (the hub)

A ~300-line TypeScript script that:
- Discovers all `src/test/*.test.ts` files (sorted alphabetically)
- Assigns to chunks via **deterministic chunking**: `file[i] → chunk (i % total) + 1`
- Runs each file in its own `ts-node` child process (isolation)
- Uses a **worker pool** with configurable concurrency (`--parallel K`)
- Enforces per-file timeout (60s default, matching CI)
- Parses `Results: N passed, M failed` from stdout
- Captures output for failed files (last 5000 chars) for diagnosis
- Emits human-readable summary (default) or machine-readable JSON (`--json`)

### Layer 2: CI matrix (`.github/workflows/test.yml`)

Uses GitHub Actions `strategy.matrix` to run 6 chunks in parallel:
- Each matrix job runs one chunk: `--chunk N --total 6`
- `fail-fast: false` — ALL chunks run even if one fails (see every failure in one cycle)
- CI time: ~21 min → ~4 min (6× parallelism)

### Layer 3: Subagent parallel diagnosis

When a failure occurs, launch parallel subagents (via Task tool):
- Each subagent runs one chunk via `--json` mode
- Parses the JSON summary to identify failed files
- Reads the failed test + source file to propose a fix
- All subagents work simultaneously, then the orchestrator aggregates fixes

---

## Usage Reference

### Full local run (pre-push default)
```bash
npx ts-node --transpile-only scripts/run_tests.ts
# or:
npm test
```
- Runs all 396 test files with `parallel=min(cpus, 6)` (default 4 on this machine)
- Duration: ~5 min
- Exit code: 0 if all pass, 1 if any fail

### Reproduce a CI chunk failure
```bash
npx ts-node --transpile-only scripts/run_tests.ts --chunk 3 --total 6
```
- Runs only the 66 files assigned to chunk 3
- Same chunking as CI (deterministic: `i % 6 === 2`)
- Duration: ~1-2 min

### Run a subset by pattern
```bash
npx ts-node --transpile-only scripts/run_tests.ts --pattern "src/test/fire*"
```
- Useful for iterating on a specific spell/feature

### Machine-readable JSON (for subagents/scripts)
```bash
npx ts-node --transpile-only scripts/run_tests.ts --json --chunk 3 --total 6
```
- Emits a JSON summary object (no progress dots)
- Includes per-file results, failure details, file lists

### All flags
```
--chunk N        Run only chunk N of --total (1-indexed). Default: 1.
--total M        Divide files into M chunks (deterministic: i % M === N-1). Default: 1.
--parallel K     Max concurrent worker processes. Default: min(os.cpus(), 6).
--pattern GLOB   Only run files matching GLOB (e.g. "src/test/fire*"). Default: src/test/*.test.ts
--timeout S      Per-file timeout in seconds. Default: 60.
--json           Emit machine-readable JSON summary (no progress dots).
--quiet          Suppress per-file output (only final summary).
--help           Show help.
```

---

## Design Decisions & Caveats Handled

### 1. One file per process (isolation)
**Problem:** Some test files mutate global state (module-level Maps, bestiary caches, `_id` counters). Running multiple files in the same process would cause cross-file interference.

**Solution:** Each test file runs in its own `ts-node` child process. The cost is ~1-4s ts-node startup per file, but parallelism compensates. With 396 files × ~2.5s avg / 4 parallel = ~250s = ~4 min.

**Trade-off:** Higher overhead than in-process batching, but zero isolation risk. If speed becomes critical later, a `--batch` mode could be added for known-isolated test groups.

### 2. Deterministic chunking (reproducibility)
**Problem:** If chunk assignments differ between local and CI, you can't reproduce a CI failure locally.

**Solution:** Files are sorted alphabetically, then assigned via `i % total === chunk - 1`. This guarantees: local chunk 3 == CI chunk 3 for the same commit. The JSON output includes the full file list per chunk for verification.

**Trade-off:** Adding/removing test files shifts chunk boundaries across commits. This is fine for same-commit reproducibility (the common case).

### 3. Worker pool concurrency
**Problem:** Running all 66 files in a chunk simultaneously would spawn 66 ts-node processes (~13GB RAM). Running them serially wastes time.

**Solution:** Configurable worker pool (`--parallel K`, default `min(cpus, 6)`). Each worker pulls the next file from the queue. On a 4-core machine, `parallel=4` gives ~4× speedup with ~800MB peak memory.

**Caveat:** Do NOT run 6 chunks in parallel locally (6 × 4 = 24 concurrent processes overloads a 4-core machine, causing node crashes via `trap int3`). Locally, run ONE chunk at a time (the default). The 6-chunk parallelism is for CI matrix (separate runners).

### 4. Per-file timeout (hang protection)
**Problem:** A hanging test could block the entire suite indefinitely.

**Solution:** 60s per-file timeout (matching the previous CI behavior). On timeout, the process is killed with SIGKILL and marked as `timedOut: true` in the results.

### 5. Signal handling (zombie prevention)
**Problem:** If the script is killed (Ctrl+C), child processes might linger.

**Solution:** SIGINT/SIGTERM handlers kill all active child processes before exiting. The script tracks all spawned processes in `activeChildren[]`.

### 6. Output capture (failure diagnosis)
**Problem:** When a test fails, you need to see WHY without re-running.

**Solution:** For each failed file, the script captures the full stdout+stderr (truncated to last 5000 chars). The human-readable output prints the last 30 lines for each failure. The JSON output includes the full captured output.

### 7. Output parsing (Results: line)
**Problem:** Test files use a script-style format (`console.log` assertions, no test framework). The summary line format varies slightly: `Results: N passed, M failed` or `=== Results: N passed, M failed ===`.

**Solution:** Regex `Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed` matches both variants. If no match (crash/timeout), the file is marked as failed with `passed: -1, failed: -1`.

---

## Weaknesses & Mitigations

### Weakness 1: ts-node startup overhead (~1-4s per file)
**Impact:** 396 files × ~2.5s avg = ~990s pure overhead (mitigated by parallelism to ~250s).
**Mitigation:** Parallelism (4× on local, 6× in CI). If this becomes a bottleneck, a `--batch` mode could import multiple files in-process (with careful isolation testing).
**Status:** Acceptable. 5-min local runs are fast enough for pre-push validation.

### Weakness 2: Flaky tests (RNG-dependent)
**Impact:** Some tests use random dice rolls with thresholds that occasionally fail (e.g., `elemental_affinity_phase4.test.ts` test 4 had a ≤8 threshold for 2d8 damage, passing only ~44% of the time).
**Mitigation:** The script's output capture makes flaky tests easy to identify (the failure shows the actual damage value). Fix flaky tests by adjusting thresholds to match the actual damage range.
**Status:** One flaky test fixed in Session 74 (Create Bonfire threshold ≤8 → ≤16). Others may exist — the parallel runner makes them surface faster.

### Weakness 3: Machine overload when running 6 chunks locally
**Impact:** Running 6 chunks × 4 parallel = 24 concurrent ts-node processes on a 4-core machine causes node crashes (`trap int3`).
**Mitigation:** Documented: locally, run ONE chunk at a time (default behavior). The 6-chunk parallelism is for CI matrix (separate 2-core runners).
**Status:** Mitigated by documentation + sensible defaults.

### Weakness 4: Hidden test files outside `src/test/*.test.ts`
**Impact:** Tests in other directories (e.g., `src/spells/foo.test.ts`) won't be discovered.
**Mitigation:** The `--pattern` flag allows custom globs. The default covers the existing convention (all 396 tests are in `src/test/`).
**Status:** Acceptable. If tests move to other directories, update the default pattern.

### Weakness 5: CI matrix uses 6× the CI minutes
**Impact:** 6 jobs × ~4 min = 24 CI-minutes per push (vs 21 min for single job).
**Mitigation:** The repo is public (unlimited CI minutes for public repos). For private repos, consider 4 chunks or only running matrix on PRs.
**Status:** No concern (public repo).

---

## Default Practice for Agents

### Before every push:
1. Run `npm test` (or `npx ts-node --transpile-only scripts/run_tests.ts`)
2. If green → push
3. If red → fix the failing tests, re-run, then push

### When CI fails on a specific chunk:
1. Note the chunk number from the CI UI
2. Reproduce locally: `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6`
3. Read the failure output (last 30 lines per failed file)
4. Fix + re-run that chunk
5. Once green, push

### For parallel failure diagnosis (advanced):
1. Launch 6 subagents (via Task tool), one per chunk
2. Each subagent runs: `npx ts-node --transpile-only scripts/run_tests.ts --json --chunk N --total 6`
3. Each subagent parses the JSON, reads failed test files, proposes fixes
4. Orchestrator aggregates fixes and commits once

---

## File Locations

| File | Purpose |
|------|---------|
| `scripts/run_tests.ts` | The parallel test runner script |
| `.github/workflows/test.yml` | CI workflow (6-chunk matrix) |
| `docs/PARALLEL-TESTING.md` | This document |
| `package.json` | npm script entries (`test`, `test:chunk`, `test:json`) |

---

## Change Log

- **Session 74 (2026-06-26):** Initial implementation. Script + CI matrix + this doc. Fixed pre-existing flaky test (`elemental_affinity_phase4.test.ts` test 4: Create Bonfire threshold ≤8 → ≤16 for 2d8 cantrip scaling at level 6).
