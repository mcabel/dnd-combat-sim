# SHEET-HANDOVER-14
# Character Sheet & Party System — Session 14 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `81c0193`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **86** (was 77 — +9 this session: 6 /equip + 3 rollMode)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 13

### Equipment Toggle Equipped (COMPLETE)
- New `POST /api/characters/:id/equip` endpoint in `src/character_router.ts`
  - Body: `{ itemIndex: number, equipped: boolean }`
  - Validates: `itemIndex` must be integer, in range; `equipped` must be boolean
  - Returns: `{ character: CharacterSheet }`
  - 6 new server tests: unequip, equip, persists across GET, 400 bad index, 400 missing equipped, 404 unknown char
- UI: `renderEquipment(c)` — equipped column now renders clickable `<button>` instead of static span
  - `onclick="toggleEquip(c.id, i, !e.equipped)"` — passes new state directly
  - `async function toggleEquip(charId, itemIndex, equipped)`: calls `/equip`, updates `S.charDetail`, re-renders equipment section only (preserves gear list open state)

### Short Rest rollMode (COMPLETE)
- `POST /api/characters/:id/shortrest` now accepts optional `rollMode: 'average' | 'random'` in body
  - Default (no param or any other value): `'average'` — deterministic `floor(d/2)+1`
  - `'random'`: `Math.floor(Math.random() * dieSides) + 1`
  - 3 new server tests: average is deterministic, random is in valid range, default is average
- UI `doShortRest()`: prompt updated — user can append `r` to number (e.g. `"2r"`) for random rolls
  - Banner shows `+N HP (rolled)` when rollMode=random
  - rollMode extracted from prompt input: `.endsWith('r')` check on trimmed/lowercased value

---

## Architecture (updated)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, /equip, etc.
  ↕ PUT /api/characters/:id    → currentHP, temporaryHP, exhaustionLevel, conditions,
                                   spellcasting.slotsUsed, notes (shallow merge)

Short rest resources: secondWind, pactSlots, channelDivinity, ki, bardicInspiration (lv5+ only)
Long rest resources:  all of the above + rage, arcaneRecovery, layOnHands, wardingBond, HP, spellSlots
```

### Key Conventions (unchanged + new)
- `channelDivinity` and `ki` are optional fields — old characters with `{}` resources still valid
- `slots: Record<string, number>` is MAX slots per level; `slotsUsed: Record<string, number>` is used
- `avail = slots[key] - (slotsUsed[key] || 0)` — always compute availability this way
- Spell slot PUT sends full `spellcasting` object (shallow merge on server); only `slotsUsed` changes
- HP PUT sends just `{ currentHP }` — server merges, maxHP unchanged
- `conditions?: string[]` — optional, backward compat; PUT sends full array
- `temporaryHP`: THP doesn't stack — always `Math.max(current, new)` in UI; server just stores value
- `exhaustionLevel`: 0–6; UI clamps before PUT
- `notes?: string` — optional, backward compat; PUT sends `{ notes: '' }` to clear
- `showBanner(msg, type)` supports `'ok'` (green) and `'error'` (red) only — NOT `'info'`
- `request()` helper in server.test.ts accepts GET/POST/PUT/DELETE
- `levelHistory?: LevelRecord[]` — always initialize to `[]` in new test factories
- `popLevel()` throws on empty history — caller should check before calling
- `resetPaladin()` in server.test.ts resets `levelHistory: []`
- **Equipment**: `equipment: EquipmentItem[]` and `gold: number`
  - `POST /api/characters/:id/equip` toggles equipped per item index
  - UI: equipped column is clickable button; `toggleEquip()` calls API, re-renders equipment section
- **Notes textarea**: `saveNotes()` skips PUT if `value === (c.notes || '')` — no unnecessary requests
- **Short rest rollMode**: body param `rollMode: 'average' | 'random'`; UI: append `r` suffix to die count

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | **Update (HP, THP, exhaustion, conditions, slots, notes, any field)** |
| DELETE | `/api/characters/:id` | Delete |
| POST | `/api/characters/import` | Import JSON |
| GET | `/api/characters/:id/export` | Download JSON |
| POST | `/api/:id/levelup` | Level up (no `/characters/` prefix) |
| POST | `/api/characters/:id/applyasi` | Apply ASI |
| POST | `/api/characters/:id/choosesubclass` | Set subclass |
| POST | `/api/characters/:id/longrest` | Long rest |
| POST | `/api/characters/:id/shortrest` | Short rest (hit dice + recharge); body: `{ hitDiceToSpend?, rollMode? }` |
| POST | `/api/characters/:id/equip` | Toggle item equipped; body: `{ itemIndex, equipped }` |
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

## NOT YET DONE — Priorities for Session 14

### 1. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

### 2. Equipment editing in character form (FUTURE)
- Character creation form has a hardcoded equipment array
- Could add dynamic add/remove rows in the form
- `/api/characters/:id` PUT already accepts full `equipment` array — server side ready
- UI: dynamic form rows with add/remove buttons, category select, name input, quantity spinbox

### 3. Gold editing (FUTURE)
- `gold: number` stored on sheet; no PUT endpoint exposes it yet
- Could be a simple `PUT /api/characters/:id` with `{ gold: N }` (already works via generic PUT)
- UI: editable gold field in Equipment section

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 14 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **86** |

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
git commit -m "Sheet-14: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
