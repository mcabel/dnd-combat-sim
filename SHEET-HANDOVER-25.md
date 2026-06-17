# SHEET-HANDOVER-25
# Character Sheet & Party System — Session 25 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `54ba4ff`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 173
  - character_improvements: 51
  - server.test: 126 (+16 from this session)
  - All 0 failures across all suites

---

## What Was Done in Session 24

### Level 0 Validator Support (COMPLETE)
`src/characters/validator.ts` updated:
- A "Level 0" character is identified by `classLevels.length === 0`
- When Level 0: `firstClass` check skipped, all class/level/multiclass checks skipped
- `maxHP` allowed to be 0 (was `< 1`, now `< 0`) for Level 0 characters
- All existing levelled character validation unchanged

### Race Data (`src/characters/race_data.ts`) (COMPLETE)
- `RaceEntry` interface: `name`, `allotment`, `defaultASI?`, `speed`, `size`, `darkvision?`, `skillProficiencies?`, `traits`
- `RACE_DATA`: all 16 playable PHB 2014 races/subraces + Custom Lineage (Tasha's)
- `RACE_NAMES`: sorted array of all names
- Key allotments (from handover design): Mountain Dwarf `[2,2]`, Human `[1,1,1,1,1,1]`, Human Variant `[1,1]`, Half-Elf `[2,1,1]`, Custom Lineage `[2]`
- `defaultASI` absent for: Human Variant, Half-Elf, Custom Lineage — these require `asiAssignment` at create-level0 time

### Background Data (`src/characters/background_data.ts`) (COMPLETE)
- `BackgroundEntry` interface: `name`, `skills` (2), `tools`, `languageChoices`, `gold`, `feature`, `featureDesc`, `variants?`
- `BACKGROUND_DATA`: all 13 PHB 2014 backgrounds (Acolyte through Urchin)
- `BACKGROUND_NAMES`: sorted array

### `GET /api/races` (COMPLETE)
Returns `{ races: RaceEntry[] }` sorted alphabetically.

### `GET /api/backgrounds` (COMPLETE)
Returns `{ backgrounds: BackgroundEntry[] }` sorted alphabetically.

### `POST /api/characters/create-level0` (COMPLETE)
Body: `{ race, background, baseScores, asiAssignment?, name?, alignment?, languages? }`

- Validates race exists in RACE_DATA
- Validates background exists in BACKGROUND_DATA
- Validates baseScores: all 6 abilities 1–30
- Resolves ASI: uses `asiAssignment` if provided (validates sum = allotment total), else falls back to `defaultASI`, else 400
- Computes `stats = baseScores + appliedRacialASI`
- Builds `Level0Record` (race, allotment, appliedRacialASI, baseScores, background grants)
- Saves a full `CharacterSheet` with `classLevels: []`, `maxHP: 0`, `firstClass: ''`, speed from RACE_DATA, gold/skills/tools/feature from BACKGROUND_DATA
- Returns 201 `{ character }`

---

## Architecture

```
CharacterSheet (JSON)
  level0Record?: Level0Record     ← immutable stack bottom
  levelHistory?: LevelRecord[]    ← stack, oldest-first
  classLevels: ClassLevel[]       ← [] for Level 0 characters

New data files:
  src/characters/race_data.ts       ← RACE_DATA, RaceEntry, RACE_NAMES
  src/characters/background_data.ts ← BACKGROUND_DATA, BackgroundEntry, BACKGROUND_NAMES

Validator rule: isLevel0 = (classLevels.length === 0)
  → skips firstClass, class loop, level range, multiclass prereq checks
  → allows maxHP = 0
```

---

## API Endpoints (all live)

All previous endpoints unchanged. New this session:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/races` | All PHB 2014 races + Custom Lineage |
| GET | `/api/backgrounds` | All 13 PHB 2014 backgrounds |
| POST | `/api/characters/create-level0` | Create Level 0 character (race+bg+scores, no class) |

---

## NOT YET DONE — Priorities for Session 25

### Scope A remainder
All Scope A items from Session 23 are now complete. Level 0 creation is fully working.

### Stat optimizer (Scope B)
- LUT mapping class → priority stat order (e.g. Fighter: [str, con, dex, ...])
- Standard array [15,14,13,12,10,8] assignment algorithm
- `GET /api/stat-optimizer?race=X&class=Y` endpoint returning recommended assignment

### Full creation wizard UI (Scope C)
- Wizard flow in characters.html: choose race → assign ASI → choose background → choose class → confirm → Level 1 created
- Stat optimizer recommendation panel with override capability

### Short rest endpoint improvements (on hold, already complete from Session 22)
No further work needed here.

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 25 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 173 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | 126 |

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
git commit -m "Sheet-25: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
