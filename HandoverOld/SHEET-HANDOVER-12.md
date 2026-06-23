# SHEET-HANDOVER-12
# Character Sheet & Party System — Session 12 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `eee4a5b`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **74** (was 67 — +7 new tests this session)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 11

### Conditions Tracker (COMPLETE)
- Added `conditions?: string[]` to `CharacterSheet` in `src/characters/types.ts`
- UI: 15 PHB condition pills in detail view — colored red when active, muted when inactive
- `toggleCondition(name)`: toggles in Set, PUTs `{ conditions: [...] }`, re-renders
- `renderConditions(c)`: standalone function, called from end of `renderDetail()`
- 3 new server tests: set conditions, clear one condition, GET persists

### Cantrip / Spell List Display (COMPLETE)
- Cantrip names now shown inline: `Cantrips (3) fire bolt, light, prestidigitation`
- Known/Prepared/Spellbook spells shown as collapsible section below slots
- `toggleSpellList(id)`: toggles `display:none` and arrow `▸`/`▾`
- Priority: `preparedSpells` → `knownSpells` → `spellbook` (label updates accordingly)
- No new server tests needed (pure UI read from existing data)

### Temporary HP UI (COMPLETE)
- Stats row expanded from 3 to 5 columns (`stats-3` → `stats-5` CSS class added)
- THP stat box: gold/muted value, `+ Add` prompt (takes higher of current vs new — no stacking), `✕ Clear`
- `addTempHP()`: prompts, takes `Math.max(current, amount)`, PUTs `{ temporaryHP }`
- `clearTempHP()`: PUTs `{ temporaryHP: 0 }`
- 2 new server tests: set THP, clear THP

### Exhaustion UI (COMPLETE)
- Exhaustion stat box: value in red when >0, `+`/`−` buttons (clamped 0–6)
- `changeExhaustion(delta)`: clamps, PUTs `{ exhaustionLevel }`, shows warning banner at 5–6
- Death at 6 flagged in banner
- 2 new server tests: set level, persists across GET

---

## Architecture (updated)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, etc.
  ↕ PUT /api/characters/:id    → currentHP, temporaryHP, exhaustionLevel, conditions,
                                   spellcasting.slotsUsed (shallow merge)

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
- `showBanner(msg, type)` supports `'ok'` (green) and `'error'` (red) only — NOT `'info'`
- `request()` helper in server.test.ts accepts GET/POST/PUT/DELETE
- `levelHistory?: LevelRecord[]` — always initialize to `[]` in new test factories
- `popLevel()` throws on empty history — caller should check before calling
- `resetPaladin()` in server.test.ts resets `levelHistory: []`

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | **Update (HP, THP, exhaustion, conditions, slots, any field)** |
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

## NOT YET DONE — Priorities for Session 12

### 1. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

### 2. Short rest HD: random vs average (NOTE)
- Currently uses deterministic average `floor(d/2)+1` for testability
- Future: expose `{ hitDiceToSpend, rollMode: 'average'|'random' }` body param

### 3. Notes field UI (NEW — MEDIUM)
- `notes?: string` exists on CharacterSheet but has no UI
- Simple: collapsible textarea below Features, auto-saves on blur via PUT `{ notes }`
- No new endpoint needed; PUT shallow merge handles it

### 4. Equipment display (NEW — MEDIUM)
- `equipment: EquipmentItem[]` and `gold: number` exist on sheet but not displayed
- Could show equipped items (weapon/armor/shield at top), then gold, then gear list
- Toggle equipped/unequipped via PUT

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 12 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **74** |

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
git commit -m "Sheet-12: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
