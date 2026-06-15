# SHEET-HANDOVER-13
# Character Sheet & Party System — Session 13 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `8e3d210`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **77** (was 74 — +3 notes tests this session)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 12

### Equipment Display (COMPLETE — UI only)
- New `<!-- Equipment -->` section in `docs/characters.html` (between Features and Conditions)
- `renderEquipment(c)`: called from `renderCharDetail()`
  - Equipped weapon/armor/shield shown as badges (⚔ weapon in gold, 🛡 armor, 🔰 shield)
  - Gold amount always shown (💰 N gp)
  - "All Gear (N) ▸" collapsible table: name, qty, category, equipped ✓/—
  - Item `notes` field shown as ⓘ tooltip on hover
  - Graceful empty state: "No equipment recorded."
- `toggleEquipList(id)`: toggles gear list visibility + ▸/▾ arrow
- No new server tests needed (pure read from existing data)

### Notes Field UI (COMPLETE)
- New `<!-- Notes -->` section in `docs/characters.html` (after Conditions, collapsible)
- Header row onclick `toggleNotes()` — ▸/▾ arrow indicator
- `<textarea id="char-notes-input">` auto-populated in `renderCharDetail()` from `c.notes`
- `onblur="saveNotes()"`: saves only if value changed; PUTs `{ notes }`, shows "Notes saved" banner
- `toggleNotes()`: show/hide textarea, auto-focuses on open
- `saveNotes()`: early return if no change (avoids unnecessary PUT)
- 3 new server tests: set notes, persist across GET, clear to empty string

---

## Architecture (updated)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, etc.
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
- **Equipment**: `equipment: EquipmentItem[]` and `gold: number` — read-only display (no toggle-equipped endpoint yet)
- **Notes textarea**: `saveNotes()` skips PUT if `value === (c.notes || '')` — no unnecessary requests

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
| POST | `/api/characters/:id/shortrest` | Short rest (hit dice + recharge) |
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

## NOT YET DONE — Priorities for Session 13

### 1. Equipment toggle equipped/unequipped (NEW — LOW)
- `PUT /api/characters/:id` with updated `equipment` array (swap `equipped` field)
- UI: clicking item row or a ✓ badge toggles equipped, re-renders
- Alternatively: dedicated `POST /api/characters/:id/equip` endpoint with `{ itemIndex, equipped }`
- Current display is read-only; creation only via character creation form

### 2. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

### 3. Short rest HD: random vs average (NOTE)
- Currently uses deterministic average `floor(d/2)+1` for testability
- Future: expose `{ hitDiceToSpend, rollMode: 'average'|'random' }` body param

### 4. Equipment editing in character form (FUTURE)
- Character creation form has a hardcoded equipment array
- Could add dynamic add/remove rows in the form

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 13 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **77** |

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
git commit -m "Sheet-13: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
