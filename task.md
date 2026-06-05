<!-- FRESH SESSION BOOTSTRAP -->
<!-- Repo: https://github.com/mcabel/dnd-combat-sim -->
<!-- Start every session with:
     git clone https://github.com/mcabel/dnd-combat-sim.git && cd dnd-combat-sim && npm install
     then run: for f in src/test/*.test.ts; do echo -n "$(basename $f): "; npx ts-node $f 2>&1 | grep "Results:"; done
-->

# D&D 5e Combat Sim — Task Tracker
<!-- Updated: 2026-05-01 | Session 5 -->
<!-- HOW TO USE: Check off items as done. At session end, move completed items to the
     relevant summary-[date].md and update the "Last completed" pointer below. -->

**Last completed:** Session 20 — ST-3 mount modes + defender/improvised/no-damage rules (966 tests)
**Prev last completed:** Session 20 — Phase 7.7 Familiar Help action (900 tests)
**Next session starts at:** HANDOVER-SESSION-21.md — shove/grapple mechanics + hasHands comprehensive parser
**Test total:** 966 passing, 0 failed across 15 suites

---

## Phase 1 — Foundation ✅ COMPLETE

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1.1 | Core type system | `src/types/core.ts` | ✅ |
| 1.2 | 5etools parser | `src/parser/fivetools.ts` | ✅ |
| 1.3 | Parser index barrel | `src/parser/index.ts` | ✅ |
| 1.4 | Parser tests (101 assertions) | `src/test/parser.test.ts` | ✅ |
| 1.5 | `tsconfig.json` + `package.json` | root | ✅ |

**Depends on:** nothing  
**Unlocks:** Phase 2

---

## Phase 2 — Engine + AI ✅ SUBSTANTIALLY COMPLETE

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 2.1 | Chebyshev movement subsystem | `src/engine/movement.ts` | ✅ |
| 2.2 | Dice / damage / budget utils | `src/engine/utils.ts` | ✅ |
| 2.3 | Engine tests (71 assertions) | `src/test/engine.test.ts` | ✅ |
| 2.4 | AI targeting (3 profiles) | `src/ai/targeting.ts` | ✅ |
| 2.5 | AI action selection | `src/ai/actions.ts` | ✅ |
| 2.6 | AI turn planner + state machine | `src/ai/planner.ts` | ✅ |
| 2.7 | AI tests (26 assertions) | `src/test/ai.test.ts` | ✅ |
| 2.8 | Combat engine loop | `src/engine/combat.ts` | ✅ |
| 2.9 | Combat tests (47+ assertions) | `src/test/combat.test.ts` | ✅ |
| 2.10 | Bestiary dir loader + summon-type filter | `src/data/loader.ts` | ✅ |
| 2.11 | PC stat block parser | `src/parser/pc.ts` | ✅ |
| 2.12 | PC parser tests (248 assertions) | `src/test/pc.test.ts` | ✅ |
| 2.13 | Integration tests — PC vs monsters | `src/test/integration.test.ts` | ✅ |
| 2.14 | Battlefield bounds enforcement | `src/engine/combat.ts` | ✅ |
| 2.15 | `'defend'` AI profile | `src/ai/planner.ts`, `core.ts` | ✅ |
| 2.16 | Unarmed strike + improvised attack fallback | `src/engine/utils.ts`, `src/ai/actions.ts` | ✅ |

**Known design decisions recorded:**
- INT score does NOT gate behavior — `attackNearest` T-Rex, `defend` Giant Fly
- Summon-type creatures (no numeric CR) excluded from `loadBestiaryDir()`
- `monsterToCombatant()` accepts `hpOverride` for "special" HP monsters
- Multiattack never usable for Opportunity Attacks (SAC v2.7)
- All diagonals = 5ft (Chebyshev, DMG optional rule NOT used)

**Depends on:** Phase 1  
**Unlocks:** Phase 3

---

## Phase 3 — Scenario Runner ✅ COMPLETE

| # | Task | File(s) | Status | Depends on |
|---|------|---------|--------|-----------|
| 3.1 ✅ | Encounter builder API | `src/scenarios/encounter.ts` | ✅ | 2.x complete |
| 3.2 ✅ | Standard encounter presets | `src/scenarios/presets.ts` | ✅ | 3.1 |
| 3.3 ✅ | Statistics runner (N simulations) | `src/scenarios/simulate.ts` | ✅ | 3.1 |
| 3.4 ✅ | Results reporter (win rates, avg rounds, DPR) | `src/scenarios/report.ts` | ✅ | 3.3 |
| 3.5 ✅ | Scenario tests | `src/test/scenario.test.ts` | ✅ | 3.1–3.4 |
| 3.6 ✅ | CLI entry point (`npm start`) | `src/index.ts` | ✅ | 3.1–3.4 |

**Goal:** Run `npx ts-node src/index.ts` and simulate a full encounter, printing results.

**Depends on:** Phase 2  
**Unlocks:** Phase 4

---

## Phase 4 — Rules Completeness ⬜ FUTURE

| # | Task | Description | Status | Depends on |
|---|------|-------------|--------|-----------|
| 4.1 ✅ | Concentration tracking | Track caster concentrating; damage triggers CON save | ⬜ | 2.8 |
| 4.2 ✅ | Sneak Attack conditions | Ally adjacent OR advantage; once per turn; OA eligible | ⬜ | 2.8 |
| 4.3 ✅ | Divine Smite decision | Post-hit slot expenditure; smart smite on crit/bloodied | ⬜ | 2.11 |
| 4.4 ✅ | Bardic Inspiration | Bonus action grant; d6 to ally attack/save | ⬜ | 2.11 |
| 4.5 ✅ | Rage resource | Bonus action activate; resistance; +2 dmg; end condition | ⬜ | 2.11 |
| 4.6 ✅ | Second Wind | Fighter bonus action heal; short rest recovery | ⬜ | 2.11 |
| 4.7 ✅ | Lay on Hands | Paladin action heal; pool tracking | ⬜ | 2.11 |
| 4.8 ✅ | Pack Tactics | Advantage when ally adjacent to target | ⬜ | 2.8 |
| 4.9 ✅ | Death saving throws | PC at 0 HP; 3 fails = dead; 3 successes = stable | ✅ | 2.8 |
| 4.10 ✅ | Short rest resource recovery | Warlock slots, Fighter Second Wind, etc. | ⬜ | 4.5–4.7 |
| 4.11 ✅ | Ammo tracking | Ranger/Rogue arrows; fallback to melee | ⬜ | 2.11 |
| 4.12 ✅ | Commanded creatures | Minion `aiProfile` override on commander's turn | ⬜ | 2.6 |
| 4.13 ✅ | Prone condition attack modifiers | Melee adv, ranged disadv; stand cost | ⬜ | 2.8 |
| 4.14 ✅ | Grapple/Shove improvised actions | STR(Athletics) contest; prone/grappled conditions | ⬜ | 2.5 |

**Depends on:** Phase 3 (can be done in parallel for mechanics that don't need the runner)

---

## Phase 5 — Summon-Type / Companion Tab ⬜ FUTURE

| # | Task | Description | Status | Depends on |
|---|------|-------------|--------|-----------|
| 5.1 ✅ | Summon-type registry | Separate map; estimated CR + HP range | ⬜ | 2.10 |
| 5.2 ✅ | Spawn-with-override API | `spawnSummon(name, casterLevel, pos)` | ⬜ | 5.1 |
| 5.3 ✅ | Test tab for summons | Isolated tests with slot-level scaling | ⬜ | 5.2 |
| 5.4 ✅ | Giant Fly as mount | Rider/mount action economy rules | ⬜ | 5.1 |

**Note:** Creatures flagged as summon-type are stored separately from the main bestiary.
Giant Fly (INT 2, `'defend'` profile, mount per magic item) is the first test case.

---

## Phase 6 — HTML / Web Output ✅ COMPLETE

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 6.1 ✅ | HTML report generator | `src/scenarios/html_report.ts` | ✅ |
| 6.2 ✅ | `--output file.html` CLI flag | `src/index.ts` | ✅ |
| 6.3 ✅ | HTML report tests (36 assertions) | `src/test/html_report.test.ts` | ✅ |
| 6.4 ✅ | DayResult multi-encounter day section | `src/scenarios/html_report.ts` | ✅ |

**What was built:**
- `generateHTMLReport(result, opts)` → standalone self-contained HTML string (zero deps)
- `saveHTMLReport(result, path, opts)` → writes file, creates dirs, returns resolved path
- Charts: SVG win-rate bar chart + SVG round distribution histogram
- Per-combatant table with party/enemy badges + survival colour coding (green/amber/red)
- Optional adventuring day section when `DayResult` supplied
- XSS-safe (all user strings escaped)
- CLI: `npx ts-node src/index.ts <preset> --output report.html`

**Depends on:** Phase 5
**Unlocks:** Phase 7

---

## Phase 7 — Next Options ⬜ FUTURE

| # | Option | Description | Priority |
|---|--------|-------------|----------|
| 7.1 | Interactive HTML report | Add JS-driven filter/sort on combatant table; toggle between encounters in day view | Medium |
| 7.2 | Concentration AI improvements | Casters prefer non-concentration when already concentrating; try to break enemy concentration | High |
| 7.3 | Level scaling (PC lv 2–5) | Extend `pc_stat_blocks_lv1.json` schema; parser already handles it | High |
| 7.4 | More encounter presets | Add 5+ presets once more bestiary files loaded | Low |
| 7.5 | CI / GitHub Actions | Run `for f in src/test/*.test.ts` on push; fail build on any failure | Medium |
| 7.6 | Phase 4 rules completeness | Concentration, Sneak Attack, Divine Smite, etc. (see Phase 4 table above) | High |

**Recommended next:** 7.6 (Phase 4 rules) or 7.2 (concentration AI) — both are high-value gameplay improvements.

| Task | When | Notes |
|------|------|-------|
| Update `INSTALL_INSTRUCTIONS.txt` | Each session new files added | Include all new file→directory mappings |
| Generate `summary-[date].md` | End of each session | See `/summaries/` folder |
| Run full test suite | Before any session commit | `for f in src/test/*.test.ts; do npx ts-node $f; done` |
| Add `bestiaryData/` files | As you acquire 5etools JSONs | Drop in folder; loader picks up automatically |

---

## Open Design Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | Partial movement (move halfway then stop) | Deferred — simplified to full-dest or skip |
| Q2 | Step-by-step OA checking along path | Deferred — checked at dest only |
| Q3 | Multiple concentration spells (impossible, but track correctly) | Phase 4.1 |
| Q4 | Initiative tiebreaker (monsters last within same score?) | Soft rule — random for now |
| Q5 | Readied action trigger resolution | Phase 4.x |
| Q6 | AoE save half-damage vs no-damage on success | Implemented (half on save) |
| Q7 | Default bestiary profile per creature type | Consider: beasts=attackNearest, humanoids=smart |

---

## Test Suite Health

| Suite | Assertions | Stable |
|-------|-----------|--------|
| parser.test.ts | 101 | ✅ deterministic |
| engine.test.ts | 71 | ✅ deterministic |
| ai.test.ts | 26 | ✅ deterministic |
| combat.test.ts | 44–59 (probabilistic loops) | ✅ 0 failures in 15 runs |
| pc.test.ts | 248 | ✅ deterministic |
| integration.test.ts | 26 | ✅ 0 failures in 20 runs |
| **Total** | **~520+** | ✅ |
