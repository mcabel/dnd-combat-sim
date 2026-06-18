# SHEET-HANDOVER-16
# Character Sheet & Party System — Session 16 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `cab43a3`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **93** (was 91 — +2 this session: qty edit + notes field)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 15

### Equipment Quantity Inline Editing (COMPLETE)
- Gear table qty column: replaced static text with `<input type="number">` (same pattern as gold input)
- New `async function saveEquipQty(charId, idx, rawVal)`: validates qty ≥ 1, maps over `c.equipment` to update single item by index, PUTs full array; no full re-render (input already shows correct value)
- Handlers: `onchange`, `onblur`, `onkeydown Enter→blur`

### Item Notes Field (COMPLETE)
- **EquipmentItem.notes?: string** was already in type — now exposed in all UI surfaces:
- **Gear table**: notes displayed as a dimmed subtitle `<div>` below item name (was tooltip ⓘ icon)
- **Add Item inline form** (detail view): new full-width notes input row below main grid; label "NOTES (optional)"; placeholder "e.g. +1 magical, attuned…"; reset on successful add
- **`confirmAddEquipItem()`**: reads `add-equip-notes-${charId}` input, spreads `...(notes ? { notes } : {})` into new item object
- **`addEquipFormRow(item?)`**: refactored — outer div now uses `flex-direction:column` with border/background card style; inner grid unchanged; added `<input name="xnotes">` row below; remove button selector updated to `this.closest('div[style*=flex-direction]')`
- **`getExtraEquipRows()`**: extracts `xnotes` value, spreads into result object if non-empty

### Conditions UI Polish (COMPLETE)
- **Before**: all 15 PHB conditions shown as toggle-buttons all the time (cluttered)
- **After**: two-zone layout:
  - **Active zone**: active conditions shown as red chips with `✕` remove button; empty state text if none active
  - **Add zone**: dashed "＋ Add Condition" button; expands (`toggleCondPicker`) inline flex row of inactive condition buttons to pick from; collapses after picker hidden
- New `toggleCondPicker(charId)`: toggles `display: flex/none` on `#cond-picker-${charId}`
- `renderConditions(c)`: fully rewritten to produce new two-zone layout; `null`-guards `el`
- `toggleCondition(name)`: unchanged — still calls `renderConditions(S.charDetail)` after PUT

### Server Tests (COMPLETE)
- 2 new tests in `server.test.ts`:
  - `PUT /api/characters/:id updates item quantity`
  - `PUT /api/characters/:id preserves item notes field` (also verifies persistence via GET)

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
  - UI: qty is inline-editable number input per row; notes shown as subtitle; each row has ✕ remove; "＋ Add Item" inline form includes notes field
  - `addEquipFormRow`: outer wrapper div uses `flex-direction:column` style — remove button uses `this.closest('div[style*=flex-direction]')` selector
- **Short rest rollMode**: body param `rollMode: 'average' | 'random'`; UI: append `r` suffix to die count
- **UUID test IDs**: server tests that create temp files must use UUID-format IDs (e.g. `00000000-0000-0000-0000-000000000010`) — validator enforces UUID regex
- **Test file cleanup**: always `fs.unlinkSync(...)` in test body (not finally) to avoid committing stray files; confirm cleanup in `characters/` dir before commit
- **Conditions UI**: `renderConditions` uses two-zone layout (active chips + collapsed picker); `toggleCondPicker(charId)` toggles picker visibility; `PHB_CONDITIONS` array is source of truth for all 15 conditions

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

## NOT YET DONE — Priorities for Session 16

### 1. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

### 2. Item notes inline edit in gear table (LOW)
- Notes currently display as read-only subtitle in gear table
- Could make them inline-editable (click subtitle → input, blur → PUT), same pattern as qty

### 3. Exhaustion effects display (LOW/FUTURE)
- PHB p.291 table: each level has mechanical effects (speed halved at 2, disadv on ability checks at 1, etc.)
- Could show current exhaustion effects as tooltip or small list below the exhaustion counter

### 4. Spell slot display enhancements (FUTURE)
- Currently shows used/max per slot level; no visual pips or progress bars
- Could add pip-style visual (filled/empty circles) for quick glance

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 16 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **93** |

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
git commit -m "Sheet-16: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
