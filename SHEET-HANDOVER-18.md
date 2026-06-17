# SHEET-HANDOVER-18
# Character Sheet & Party System — Session 18 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `4aef40f`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **104** (was 98 start of session — +6 this session)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 17

### Initiative Display (COMPLETE)
- Added `initMod`/`initSign` computed from `c.stats.dex` before stats row render
- Added Initiative box as 3rd box in stat row (HP → AC → Initiative → Speed → THP → Exhaustion)
- Changed `.stats-5` CSS grid from `repeat(5, 1fr)` to `repeat(auto-fit, minmax(70px, 1fr))` to accommodate 6 boxes

### Inspiration Toggle (COMPLETE)
- `inspiration?: boolean` added to `CharacterSheet` in `src/characters/types.ts`
- Toggle button added inline in class-info line (★ Inspiration button, styled active=accent/faded when false)
- `toggleInspiration()`: PUTs `{ inspiration: !current }`, re-renders, shows banner
- 3 new server tests: set true, clear to false, persists across GET

### Concentration Tracker (COMPLETE)
- `concentrating?: string | null` added to `CharacterSheet` in `src/characters/types.ts`
- Badge shown in spellcasting DC header row when concentrating (◎ SpellName + ✕ to end)
- "◎ Concentrate" button shown when not concentrating (only when spellcasting section visible)
- `setConcentration()`: prompts for spell name, PUTs `{ concentrating: name|null }`, re-renders
- `clearConcentration()`: PUTs `{ concentrating: null }`, re-renders
- **Auto-clear on long rest**: `doLongRest()` checks `S.charDetail.concentrating` after rest response, fires separate PUT `{ concentrating: null }` if set
- 3 new server tests: set name, persists across GET, clear to null

---

## Architecture (updated)

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
  - Gear table: qty = inline number input; notes = inline text input (transparent border until focused); each row has ✕ remove
- **Short rest rollMode**: body param `rollMode: 'average' | 'random'`; UI: append `r` suffix to die count
- **UUID test IDs**: must match UUID regex — use `00000000-0000-0000-0000-00000000000N` or similar
- **Test file cleanup**: `fs.unlinkSync(...)` in test body (not finally); confirm no stray files before commit
- **Conditions UI**: `renderConditions` uses two-zone layout (active chips + collapsed picker); `toggleCondPicker(charId)` toggles visibility; `PHB_CONDITIONS` is source of truth
- **Saves & Skills**: `SKILL_ABILITY` map inside render function; `profBonus` declared in saves/skills block (scoped to same function, still accessible by class-info block below)
- **Death Saves**: `deathSaves?: { successes: number; failures: number }` in `CharacterSheet`; auto-clear on heal-above-0 or long rest; `char-death-saves` div hidden when `currentHP > 0`
- **EXHAUSTION_EFFECTS**: global const array (6 entries); indexed by `exh-1` when `exh > 0`
- **Initiative**: computed as `Math.floor(((c.stats.dex||10)-10)/2)` at render time; displayed as 3rd stat box
- **Inspiration**: `inspiration?: boolean`; toggled via `toggleInspiration()`; button in class-info line
- **Concentration**: `concentrating?: string | null`; badge in spellcasting header when set; auto-clear on long rest

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

## NOT YET DONE — Priorities for Session 18

### 1. Set Level (down) for legacy chars (LOW/DEFERRED)
- Currently returns 400 if no `levelHistory`
- Complex: rebuild HP/features from scratch by fast-forwarding applyLevelUp N times
- Approach deferred — skip unless explicitly requested

### 2. HP Tracker in character detail view (SMALL/MEDIUM)
- Currently HP is shown in stat row with damage/heal buttons using `prompt()`
- Consider inline number input or increment/decrement with text field instead of prompt
- Could show max HP editable or current HP as direct input

### 3. Spell slot consumption controls in UI (SMALL)
- Use/Restore buttons already present
- Consider adding a "Reset all slots" button for quick DM use

### 4. Short rest endpoint refinements (if needed)
- `POST /api/characters/:id/shortrest` is live
- Warlock pact slot recovery and Channel Divinity recharge on short rest may need testing

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 18 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **104** |

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
git commit -m "Sheet-18: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
