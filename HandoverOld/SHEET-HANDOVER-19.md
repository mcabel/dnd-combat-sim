# SHEET-HANDOVER-19
# Character Sheet & Party System — Session 19 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `11e9204`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: 104
  - All 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 18

### Inline HP Tracker (COMPLETE — no more prompt())
- Replaced `takeDamage()` / `healChar()` with `setHPDirect(val)` + `applyHPAmt(mode)`
- HP stat box now has: editable `<input type="number">` for currentHP (blur/Enter to save), `/maxHP` label, amount input + `−Dmg` / `+Heal` buttons
- `applyHPAmt('dmg'|'heal')` reads from `id="hp-amt"` input; validates > 0; clears death saves on heal from 0
- `setHPDirect(val)` allows typing a raw HP value directly

### Inline TempHP Controls (COMPLETE — no more prompt())
- Replaced `addTempHP()` with `applyTempHP()` — reads from `id="thp-amt"` input
- THP stat box now has: amount input + `+Set` button + `✕` clear (disabled when THP = 0)
- THP still does not stack: takes `Math.max(current, new)`

### Short Rest Inline Panel (COMPLETE — no more prompt())
- Old: `doShortRest()` used `prompt()` for HD count + "r" suffix for random
- New: clicking Short Rest shows `id="short-rest-panel"` (hidden div above stats row)
  - HD count number input, Avg / Rnd mode toggle buttons (`_srMode` state var)
  - "Rest ☀" confirm → `confirmShortRest()` → `execShortRest(hd, rollMode)`
  - "✕" cancel → `cancelShortRest()` hides panel
  - If no HD available, fires `execShortRest(0, 'average')` immediately (no panel)
- `setSRMode()` toggles visual highlight on Avg/Rnd buttons

### Spell Slot Reset All (COMPLETE)
- `↺ Reset Slots` button added in spellcasting DC/attack header row
- `resetAllSlots()`: PUT `{ spellcasting: { ...spl, slotsUsed: {} } }` → re-render + banner

### Multiclass Inline Input (COMPLETE — no more prompt())
- `lvl-class` select now has `onchange="onLvlClassChange(this.value)"`
- When `__new__` selected: hidden div `id="lvl-newclass-row"` appears with text input + datalist (12 PHB classes)
- `doLevelUp()` reads from `id="lvl-newclass-input"` instead of prompt; shows `showErr()` if empty
- `onLvlClassChange()` toggles row display

### Concentration Inline Panel (COMPLETE — no more prompt())
- `setConcentration()` removed; replaced with `showConcInput()` / `confirmConcentration()` / `cancelConcentration()`
- "◎ Concentrate" button now calls `showConcInput()`
- Hidden `id="conc-input-panel"` div added after `char-spellcasting` div
  - Text input with common concentration spell datalist, Enter/Escape shortcuts
  - "Set" → PUT `{ concentrating: val }`, re-render; "✕" → cancel without save

### Bug Fix: `renderDetail()` → `renderCharDetail()`
- `renderDetail()` was called in `applyTempHP`, `clearTempHP`, `changeExhaustion` but was never defined
- Fixed all three to call `renderCharDetail()` correctly
- Pre-existing bug — would have caused silent failures on THP/Exhaustion updates

### Zero `prompt()` calls
- `docs/characters.html` now has **zero `prompt()` calls**
- All user input now uses inline UI controls

---

## Architecture (unchanged from Session 18)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, /equip, etc.
  ↕ PUT /api/characters/:id    → currentHP, temporaryHP, exhaustionLevel, conditions,
                                   spellcasting.slotsUsed, notes, gold, equipment,
                                   deathSaves, inspiration, concentrating (shallow merge)
```

### Key Conventions
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
- **Short rest rollMode**: `'average' | 'random'`; UI state in `_srMode` var
- **UUID test IDs**: must match UUID regex — use `00000000-0000-0000-0000-00000000000N`
- **Test file cleanup**: `fs.unlinkSync(...)` in test body (not finally)
- **Conditions UI**: `renderConditions` uses two-zone layout; `PHB_CONDITIONS` is source of truth
- **Saves & Skills**: `SKILL_ABILITY` map inside render function; `profBonus` scoped there too
- **Death Saves**: `deathSaves?: { successes: number; failures: number }`; auto-clear on heal-above-0 or long rest
- **EXHAUSTION_EFFECTS**: global const array (6 entries); indexed by `exh-1` when `exh > 0`
- **Initiative**: computed as `Math.floor(((c.stats.dex||10)-10)/2)` at render time; 3rd stat box
- **Inspiration**: `inspiration?: boolean`; toggled via `toggleInspiration()`; button in class-info line
- **Concentration**: `concentrating?: string | null`; inline panel via `showConcInput()`; auto-clear on long rest
- **`renderDetail()` is NOT a function** — always use `renderCharDetail()`
- **`prompt()` is gone** — zero calls in characters.html; all input is inline UI

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | **Update (HP, THP, exhaustion, conditions, slots, notes, gold, equipment, deathSaves, inspiration, concentrating, any field)** |
| DELETE | `/api/characters/:id` | Delete |
| POST | `/api/characters/import` | Import JSON |
| GET | `/api/characters/:id/export` | Download JSON |
| POST | `/api/:id/levelup` | Level up (no `/characters/` prefix) |
| POST | `/api/characters/:id/applyasi` | Apply ASI |
| POST | `/api/characters/:id/choosesubclass` | Set subclass |
| POST | `/api/characters/:id/longrest` | Long rest |
| POST | `/api/characters/:id/shortrest` | Short rest; body: `{ hitDiceToSpend?, rollMode? }` |
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

## NOT YET DONE — Priorities for Session 19

### 1. Set Level (down) for legacy chars (LOW/DEFERRED)
- Currently returns 400 if no `levelHistory`
- Complex: rebuild HP/features from scratch by fast-forwarding applyLevelUp N times
- Deferred — skip unless explicitly requested

### 2. HP color indicator (SMALL)
- HP value could be colored: green ≥ 50%, yellow 25–49%, red < 25%, gray = 0
- Currently always `var(--accent)` gold

### 3. Resource editing UI for DM (MEDIUM)
- Rage, Ki, Bardic Inspiration, Second Wind, Lay on Hands, etc. currently display-only in class info
- Add inline increment/decrement buttons to spend/restore individual resources
- PUT `/api/characters/:id` with `{ resources: { rage: { remaining: N } } }` or similar

### 4. Party view improvements (if needed)
- Party detail view shows member list; could link to individual character sheets inline
- Could show party HP totals / concentration spells / conditions at a glance

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 19 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | 104 |

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
git commit -m "Sheet-19: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
