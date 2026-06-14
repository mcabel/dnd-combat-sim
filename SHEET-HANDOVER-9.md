# SHEET-HANDOVER-9
# Character Sheet & Party System — Session 9 Start

## Prompt Instructions (carry forward every session)
- Break down large tasks, ask for input when needed
- Commit to GitHub after each meaningful chunk of work
- Stop and flag for Sonnet when architecturally complex; Haiku for incremental
- When fresh chat is optimal: commit, write this handover, stop
- Future handovers must be self-contained and seamless
- PAT: provided verbally at session start — do not paste in files
- Scope: PHB 2014 / MM 2014 / SAC v2.7. No post-2024 content yet.
- Username: mcabel
- **This handover tracks ONLY the Character Sheet workstream.**
  The combat engine agent uses HANDOVER-SESSION-*.md separately.
  Do not touch combat engine internals without reading their current handover.

---

## Current State

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `5387668`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: **161** (was 124 — 37 new popLevel tests)
  - character_improvements: 51
  - server.test: **51** (was 46 — 5 new leveldown/setlevel-down tests)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 8

### LevelRecord Stack Architecture (NEW — CORE DESIGN)

**Design question answered:** Levels were NOT stack-based before. Now they are.

- `LevelRecord` interface added to `src/characters/types.ts`
  - Captures per-level delta: `hpGained`, `featuresAdded`, `wasNewClass`, `resourcesBefore`,
    `spellSlotsBefore`, `spellSlotsUsedBefore`, `pactSlotsBefore`, `hadSpellcastingBefore`,
    `statsBefore`, `pendingASIBefore`, `pendingASIHalfBefore`, `subclassPrompted`
- `CharacterSheet.levelHistory?: LevelRecord[]` — optional for backward compat; `[]` = no history
- `applyLevelUp()` now pushes a `LevelRecord` onto `levelHistory` before returning
- `popLevel(sheet)` — new export from `leveler.ts`:
  - Reads top `LevelRecord`, reverses ALL changes atomically
  - Reverts: classLevels, hitDice, maxHP/currentHP, resources, spellcasting slots & pact slots,
    allFeatures (first-occurrence match removal), stats (ASI reversal), pendingASI counters
  - Throws if history is empty

### Endpoints Added/Updated

| Method | Path | Change |
|--------|------|--------|
| POST | `/api/characters/:id/leveldown` | NEW — pops top level; 400 if level 1 or no history |
| POST | `/api/characters/:id/setlevel` | UPGRADED — now supports DOWN via popLevel() loop |

`setlevel` response now includes `levelsLost` (0 when going up, n when going down).

### UI (docs/characters.html)
- `⬇ Pop Level` button added next to `Set Level` in the DM Tools section
- `doLevelDown()` JS function calls `/leveldown` endpoint
- `doSetLevel()` banner now correctly shows gained vs lost

### Data Files Patched
- All existing `characters/*.json` and `characters/test-chars/*.json` patched to include `"levelHistory": []`
- `resetPaladin()` in server.test.ts now also resets `levelHistory: []`

### Known Design Limits
- `subclassChoices` is NOT reversed by `popLevel()` — subclass selection is a separate action
  (improvements.ts) and its reversal is out of scope for now
- Characters created before this session have `levelHistory: []` — `leveldown` returns 400
  with a clear error message directing user to recreate via builder

---

## Architecture (updated)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /leveldown, /setlevel (up+down), /longrest, etc.

levelHistory = [...LevelRecord]  ← oldest first, top = last element
```

### Key Conventions (unchanged + new)
- `levelHistory?: LevelRecord[]` — always initialize to `[]` in new test factories
- `popLevel()` throws on empty history — caller should check before calling
- `setlevel` down requires populated `levelHistory` — returns 400 with helpful message otherwise
- `resetPaladin()` in server.test.ts resets `levelHistory: []`
- All test factories in all 5 test files now include `levelHistory: []`

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | Update |
| DELETE | `/api/characters/:id` | Delete |
| POST | `/api/characters/import` | Import JSON |
| GET | `/api/characters/:id/export` | Download JSON |
| POST | `/api/:id/levelup` | Level up (no `/characters/` prefix) |
| POST | `/api/characters/:id/applyasi` | Apply ASI |
| POST | `/api/characters/:id/choosesubclass` | Set subclass |
| POST | `/api/characters/:id/longrest` | Long rest |
| POST | `/api/characters/:id/shortrest` | **NOT YET DONE** |
| POST | `/api/characters/:id/setlevel` | DM: set level (up or down) |
| POST | `/api/characters/:id/leveldown` | Pop last level (stack) |
| GET | `/api/parties` | List parties |
| POST | `/api/parties` | Create (201) |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update |
| DELETE | `/api/parties/:id` | Delete |
| GET | `/api/parties/:id/members` | Full sheets |
| POST | `/api/parties/:id/awardxp` | Award XP |
| POST | `/api/simulate/custom` | Run sim with saved chars |

---

## NOT YET DONE — Priorities for Session 9

### 1. Short Rest endpoint (MEDIUM) ← NEXT
- `POST /api/characters/:id/shortrest`
- Body: `{ hitDiceToSpend?: number }`
- Spend hit dice: each HD = roll die + CON mod → add to currentHP (cap at maxHP)
- Recharge: Channel Divinity (Cleric), Warlock pact slots, Bard Font of Inspiration (lv5+)
- Fighter Second Wind does NOT recharge on short rest (it recharges on short or long rest — actually yes it does)
- Returns: `{ character, hpRegained, hdSpent }`

### 2. Slot consumption UI (LOW)
- Character detail spellcasting section: `Use Slot` / `Restore Slot` controls per level
- Calls `PUT /api/characters/:id` with updated `spellcasting.slotsUsed`

### 3. Character detail: HP tracker (LOW)
- Click HP to take damage / heal
- `PUT /api/characters/:id` with updated `currentHP`

### 4. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 9 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | **161** |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **51** |

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
git commit -m "Sheet-9: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
