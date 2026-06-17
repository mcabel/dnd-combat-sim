# SHEET-HANDOVER-24
# Character Sheet & Party System — Session 24 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `62fa5b3`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 173 (+12 bootstrap tests)
  - character_improvements: 51
  - server.test: 110 (+2 legacy leveldown tests)
  - All 0 failures across all suites

---

## What Was Done in Session 23

### Rules Scope Clarification (adopted)
- **Flexible ASI assignment** is accepted as pre-2024 canon (Tasha's 2020 overrides PHB 2014 fixed racial bonuses)
- Each race still has a defined ALLOTMENT (amounts), but the player freely assigns those amounts to any distinct stats
- Tasha's Custom Lineage is treated as a first-class race with allotment [+2] to one stat of choice
- Monster reprints: both versions coexist as variants
- General rule: assume cumulative pre-2024 by publication/errata date

### Level0Record Type (COMPLETE)
Added to `src/characters/types.ts`:
```typescript
export interface Level0Record {
  race: string;
  racialASIAllotment: number[];         // amounts only, e.g. [2,1] or [2,2] for Mountain Dwarf
  appliedRacialASI: Partial<CharacterAbilityScores>; // how bonuses were distributed
  baseScores: CharacterAbilityScores;   // scores BEFORE racial bonus
  background: string;
  backgroundSkills: string[];
  backgroundTools: string[];
  backgroundLanguages: string[];
  backgroundGold: number;
  backgroundFeature: string;
}
```
Also added `level0Record?: Level0Record` to `CharacterSheet` (after `levelHistory`).

Design intent:
- Immutable stack bottom: represents the character before any class levels
- Cannot be popped (enforced at router level; popLevel itself is unchanged)
- Default Level 0 for future builder: Normal Human + Acolyte background
- Racial allotment uses Tasha's flexible assignment (amounts fixed per race, placement free)
- `level0Record` is optional for backward compat with legacy characters

### bootstrapLevelHistory (COMPLETE)
Exported from `src/characters/leveler.ts`.

**Purpose:** Legacy characters (no `levelHistory`) can now level down via automatic bootstrap.

**Algorithm:**
1. Guard: throw if history already present / character is multiclassed / level 1
2. Build a ghost at level 1 with same stats/firstClass but minimal structure
3. Run `applyLevelUp` N-1 times on ghost → produces N-1 LevelRecords
4. Patch ALL records: `statsBefore = current stats` (freeze), `pendingASIBefore/Half = current values`
5. Return real sheet with the patched `levelHistory` attached

**Key approximation:** HP gains in bootstrapped records use average rolls. Popping
levels will subtract average-roll amounts from maxHP, which may differ slightly from
the original roll method. Acceptable for a DM tool.

**Throws:**
- Character already has levelHistory
- Multiclassed (order cannot be inferred)
- Level 1 (returns unchanged with `levelHistory: []`)

### Router wiring (COMPLETE)
Both `POST /api/characters/:id/setlevel` (level-down path) and
`POST /api/characters/:id/leveldown` now call `bootstrapLevelHistory` automatically
when `levelHistory` is absent. On bootstrap failure they return HTTP 400 with the
bootstrap error message instead of the old "recreate from level 1" error.

---

## Architecture (unchanged except new fields)

```
CharacterSheet (JSON)
  level0Record?: Level0Record     ← NEW (stack bottom, optional for compat)
  levelHistory?: LevelRecord[]    ← stack, oldest-first
  ↕ leveler.ts (applyLevelUp)   → pushes LevelRecord
  ↕ leveler.ts (popLevel)       → pops top LevelRecord
  ↕ leveler.ts (bootstrapLevelHistory) → NEW: builds history for legacy chars
  ↕ improvements.ts (applyASI)  → consumes pendingASI; updates stats
  ↕ character_router.ts         → /shortrest, /longrest, /leveldown, /setlevel, etc.
```

### Key Conventions (updated)
- `Level0Record.racialASIAllotment`: amounts only, e.g. [2,1] for most races, [2,2] for Mountain Dwarf, [1,1,1,1,1,1] for Normal Human, [1,1] for Human Variant, [2] for Custom Lineage
- `Level0Record.appliedRacialASI`: partial map of stat→bonus; sum of values = sum of allotment
- `bootstrapLevelHistory` is safe to call on any single-class legacy character; throws for multiclass
- After bootstrap, `popLevel` works normally — the frozen `statsBefore` means ASIs are NOT reverted (correct behaviour for legacy chars)
- `level0Record` is not yet used to guard `popLevel` (that UI-driven restoration is future scope)

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | Update (HP, THP, exhaustion, conditions, slots, pactSlots, notes, gold, equipment, deathSaves, inspiration, concentrating, resources, any field) |
| DELETE | `/api/characters/:id` | Delete |
| POST | `/api/characters/import` | Import JSON |
| GET | `/api/characters/:id/export` | Download JSON |
| POST | `/api/:id/levelup` | Level up (no `/characters/` prefix) |
| POST | `/api/characters/:id/applyasi` | Apply ASI |
| POST | `/api/characters/:id/choosesubclass` | Set subclass |
| POST | `/api/characters/:id/longrest` | Long rest |
| POST | `/api/characters/:id/shortrest` | Short rest; body: `{ hitDiceToSpend?, rollMode? }` |
| POST | `/api/characters/:id/equip` | Toggle item equipped; body: `{ itemIndex, equipped }` |
| POST | `/api/characters/:id/setlevel` | DM: set level (up or down; auto-bootstraps legacy) |
| POST | `/api/characters/:id/leveldown` | Pop last level (auto-bootstraps legacy) |
| GET | `/api/parties` | List parties |
| POST | `/api/parties` | Create (201) |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update |
| DELETE | `/api/parties/:id` | Delete |
| GET | `/api/parties/:id/members` | Full sheets |
| POST | `/api/parties/:id/awardxp` | Award XP — body: `{ enemies }` OR `{ xpOverride: number }` |
| POST | `/api/simulate/custom` | Run sim with saved chars |

---

## NOT YET DONE — Priorities for Session 24

### Scope A remainder (next session)
The `level0Record` is defined and on `CharacterSheet`, but nothing populates it yet for new or existing characters. Session 24 should handle:

1. **`POST /api/characters` creation path** — accept `level0Record` in body and persist it (no validation needed beyond type-checking; caller is responsible for correctness)
2. **Race data table** — a `RACE_DATA` constant (TypeScript, not JSON) mapping race names to:
   - `allotment: number[]` — the racial ASI amounts
   - `defaultASI?: Partial<CharacterAbilityScores>` — PHB 2014 fixed assignment (used when flexible not desired)
   - `speed: number` — base speed (ft)
   - `size: string` — "Medium" | "Small"
   - Any notable features relevant to sheet display (darkvision, etc. as strings)
   Include all PHB 2014 races + subraces + Custom Lineage
3. **`GET /api/races`** — returns RACE_DATA as a list for frontend consumption
4. **`GET /api/backgrounds`** — returns BACKGROUND_DATA list (backgrounds with skills, tools, languages, gold, feature)
5. **Background data table** — all PHB 2014 backgrounds (Acolyte, Charlatan, Criminal, Entertainer, Folk Hero, Guild Artisan, Hermit, Noble, Outlander, Sage, Sailor, Soldier, Urchin) with their grants
6. **`POST /api/characters/create-level0`** — new endpoint: create a Level 0 character given `{ race, background, baseScores, asiAssignment?, name? }`. Validate allotment, compute `stats` (baseScores + appliedRacialASI), return a CharacterSheet with `level0Record` set but NO class levels yet (or level-1 of the default "Normal Human + Acolyte" if no params given)

### Stat optimizer (Scope B — future)
- LUT mapping class → priority stat order (e.g. Fighter: [str, con, dex, ...])
- Standard array [15,14,13,12,10,8] assignment algorithm
- `GET /api/stat-optimizer?race=X&class=Y` endpoint returning recommended assignment

### Full creation wizard UI (Scope C — future)
- Wizard flow in characters.html: choose race → assign ASI → choose background → choose class → confirm → Level 1 created
- Stat optimizer recommendation panel with override capability

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 24 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 173 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | 110 |

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
git commit -m "Sheet-24: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
