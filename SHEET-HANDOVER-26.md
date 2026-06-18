# SHEET-HANDOVER-26
# Character Sheet & Party System — Session 26 Start

## Prompt Instructions (carry forward every session)
- Break down large tasks, ask for input when needed
- Commit to GitHub after each meaningful chunk of work
- Stop and flag for Sonnet when architecturally complex; Haiku for incremental
- When fresh chat is optimal: commit, write this handover, stop
- Future handovers must be self-contained and seamless
- PAT: provided verbally at session start — do not paste in files
- Scope: PHB 2014 / MM 2014 / SAC v2.7 + pre-2024 errata and Sage Advice (cumulative)
- Username: mcabel
- **This handover tracks ONLY the Character Sheet workstream.**
  The combat engine agent uses HANDOVER-SESSION-*.md separately.
  Do not touch combat engine internals without reading their current handover.

---

## Current State

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `61e9d84`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 173
  - character_improvements: 51
  - server.test: 138 (+12 from this session)
  - All 0 failures across all suites

---

## What Was Done in Session 25

### Stat Optimizer (`src/characters/stat_optimizer.ts`) (COMPLETE)
- `CLASS_STAT_PRIORITY`: LUT of all 12 PHB 2014 classes → `[rank1…rank6]` ability keys
- `STANDARD_ARRAY`: readonly `[15,14,13,12,10,8]`
- `computeStatRecommendation(className, raceEntry)` → `StatOptimizerResult`:
  - `baseScores`: standard array assigned by priority (rearrangement inequality)
  - `suggestedAsiAssignment`: for flexible-ASI races, allotment placed on top-priority stats
  - `racialASI`: effective ASI (defaultASI or suggestedAsiAssignment)
  - `finalScores`: base + racial, capped at 30
  - `isFlexibleASI`: true when race has no defaultASI

### `GET /api/stat-optimizer?race=X&class=Y` (COMPLETE)
- Returns `StatOptimizerResult`
- 400 on missing/invalid race or class
- 12 new tests in server.test.ts covering happy path, edge cases (flexible ASI races, specific class priority verification)

### Creation Wizard UI (`docs/characters.html`) (COMPLETE)
- `✦ Guide` button in Characters panel header opens the wizard
- 5-step flow: **Race → Background → Class → Stats → Identity**
- Step dots with clickable back-navigation, live step title
- Step 1 (Race): dropdown populated from `/api/races`; trait info panel; ASI hint
- Step 2 (Background): dropdown from `/api/backgrounds`; skills/tools/gold info
- Step 3 (Class): dropdown; hit die + saving throws info
- Step 4 (Stats): 6 stat dropdowns (standard array, prevents duplicate picks); `✦ Auto-assign` fills from optimizer; flexible-ASI races get additional ASI point allocation inputs with remaining counter; live final score preview (base + racial)
- Step 5 (Identity): name, alignment select, HP mode (average/max), review summary
- Submit: `POST /api/characters/create-level0` → `POST /api/:id/levelup` → redirects to character detail, shows success banner

---

## Architecture

```
New files:
  src/characters/stat_optimizer.ts   ← CLASS_STAT_PRIORITY LUT + computeStatRecommendation()

New API route (in character_router.ts):
  GET /api/stat-optimizer?race=X&class=Y → StatOptimizerResult

New UI (in docs/characters.html):
  #char-wizard-card  ← 5-step wizard card
  openWizard()       ← entry point, fetches races+backgrounds, shows wizard
  wizState           ← state object (step, race, bg, className, baseScores, asiPoints, …)
  wizSubmit()        ← creates level0 then levels up to 1
```

---

## API Endpoints (all live)

All previous endpoints unchanged. New this session:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stat-optimizer` | Recommended standard-array assignment for race+class |

---

## NOT YET DONE — Priorities for Session 26

- **Spell slot consumption UI controls** — use/restore individual slots from character detail view
- **HP tracker in character detail view** — dedicated current HP display with +/- buttons (already partially done via existing panels; may just need cleanup)
- **Fallback path for legacy characters without `levelHistory` attempting level-down** — graceful error instead of crash

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 26 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 173 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | 138 |

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  timeout 35 npx ts-node "$f" 2>&1 | grep "Results:"
done
```

## Git Workflow
```bash
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git fetch https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git main:remote-main
git rebase remote-main
git add -A
git commit -m "Sheet-26: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
