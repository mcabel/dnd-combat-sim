# SHEET-HANDOVER-15
# Character Sheet & Party System — Session 15 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `f580d74`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **91** (was 86 — +5 this session: 2 gold PUT + 3 equipment PUT)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 14

### Gold Editing in Detail View (COMPLETE)
- `renderEquipment()`: replaced static `💰 ${gold} gp` with editable `<input type="number" id="gold-input-${c.id}">` with `onchange`/`onblur`/`Enter` key handlers
- New `async function saveGold(charId, rawVal)`: validates, PUT `{ gold }`, updates `S.charDetail`, syncs input value from server response
- Empty state (`!weapon && !armor && !shield`): now appends text below gold input instead of overriding the whole section

### Equipment Add/Remove in Detail View (COMPLETE)
- **Remove button**: `renderEquipment()` gear table now has an extra `<th>` column (blank header, 28px) and a `✕` `<button>` per row calling `removeEquipItem(charId, idx)`
- New `async function removeEquipItem(charId, idx)`: filters `S.charDetail.equipment`, PUTs full array, re-renders, shows banner
- **Add Item form**: appended after gear table/empty state — hidden by default; "＋ Add Item" button shows it; inputs: name (text), category (select), qty (number), equipped (checkbox); "Add" calls `confirmAddEquipItem(charId)`; "Cancel" calls `hideAddEquipForm(charId)`
- New `async function confirmAddEquipItem(charId)`: validates name/qty, appends item, PUTs, re-renders, resets form fields; form stays visible after cancel button
- `showAddEquipForm(charId)` / `hideAddEquipForm(charId)`: toggle form visibility; `showAddEquipForm` focuses name input

### Additional Equipment Rows in Creation/Edit Form (COMPLETE)
- HTML: new `<div id="cf-extra-equip">` container + "＋ Add Item" dashed button below Armor/Shield fields, above Notes
- `addEquipFormRow(item?)`: creates a row div with name/category/qty/equipped fields; `item` param pre-populates for edit mode
- `getExtraEquipRows()`: reads all rows from `#cf-extra-equip`, returns array of `EquipmentItem`-shaped objects (skips blank names)
- `saveCharForm()`: `equipment` array now includes `...getExtraEquipRows()` after weapon + armor
- `editChar()`: populates extra rows from `c.equipment` excluding the primary weapon and armor items
- `newChar()` / `cancelForm()`: clears `#cf-extra-equip` innerHTML on open/cancel

### Server Tests (COMPLETE)
- 5 new tests in `server.test.ts`:
  - `PUT /api/characters/:id updates gold field`
  - `PUT /api/characters/:id gold persists across GET`
  - `PUT /api/characters/:id replaces equipment array`
  - `PUT /api/characters/:id appends equipment item (array persists)`
  - `PUT /api/characters/:id removes equipment item (filtered array)`
- All use proper UUID test IDs (`00000000-0000-0000-0000-000000000010` / `...11`) to pass validator

---

## Architecture (updated)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, /equip, etc.
  ↕ PUT /api/characters/:id    → currentHP, temporaryHP, exhaustionLevel, conditions,
                                   spellcasting.slotsUsed, notes, gold, equipment (shallow merge)
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
  - `PUT /api/characters/:id` with `{ equipment: [...] }` replaces full array
  - `PUT /api/characters/:id` with `{ gold: N }` updates gold
  - UI: equipped column = clickable toggle; each row has ✕ remove button; "＋ Add Item" inline form
- **Short rest rollMode**: body param `rollMode: 'average' | 'random'`; UI: append `r` suffix to die count
- **UUID test IDs**: server tests that create temp files must use UUID-format IDs (e.g. `00000000-0000-0000-0000-000000000010`) — validator enforces UUID regex
- **Test file cleanup**: always `fs.unlinkSync(...)` in test body (not finally) to avoid committing stray files; confirm cleanup in `characters/` dir before commit

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | **Update (HP, THP, exhaustion, conditions, slots, notes, gold, equipment, any field)** |
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

## NOT YET DONE — Priorities for Session 15

### 1. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

### 2. Item notes field (LOW/FUTURE)
- `EquipmentItem.notes?: string` is in the type but not exposed anywhere in UI
- Could add a notes input to the add-item form and show it as a subtitle row in the gear table

### 3. Equipment quantity editing in detail view (LOW)
- Currently qty is shown in the gear table but read-only
- Could make it inline-editable (same pattern as gold input)

### 4. Conditions / Status UI polish (FUTURE)
- Conditions list could be more user-friendly (e.g. click-to-remove chips instead of text edit)

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 15 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **91** |

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
git commit -m "Sheet-15: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
