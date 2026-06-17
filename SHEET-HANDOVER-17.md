# SHEET-HANDOVER-17
# Character Sheet & Party System — Session 17 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `ec81331`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **98** (was 93 start of session — +5 this session)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 16

### Notes Inline Edit in Gear Table (COMPLETE)
- Notes subtitle (was read-only `<div>`) → always-visible `<input type="text">`
- Transparent border until focused (matches qty input pattern)
- `async function saveEquipNotes(charId, idx, rawVal)`: trims, skips no-change, deletes `notes` key when cleared, maps full equipment array, PUTs; no full re-render needed
- 2 new tests: update notes inline, clear notes (remove key)

### Exhaustion Effects Display (COMPLETE)
- `EXHAUSTION_EFFECTS: string[]` constant (6 entries, PHB p.291)
- Shown as 9px red text below exhaustion +/− buttons when `exh > 0`
- No new API — pure render-time computed from `exhaustionLevel`

### Saves & Skills Panel (COMPLETE)
- New `char-saves-skills` section between Ability Scores and Class & Resources
- **Left column**: 6 saving throws — ●/○ proficiency dot, signed modifier, ability abbrev; clamps danger color when negative
- **Right column**: 18 skills — ★ expertise / ● proficient / ○ none, signed modifier, ability abbrev in muted text
- **Passive Perception**: shown below saves column; accounts for expertise double-prof
- `SKILL_ABILITY` map (local to render function) maps all 18 PHB skills to their ability
- `profBonus` computed once (moved from class-info block into saves block; still in scope for class-info)
- No new API — computed from `c.stats`, `c.proficiencies`, `computeProf(c)`

### Death Saves Tracker (COMPLETE)
- New optional field `deathSaves?: { successes: number; failures: number }` added to `CharacterSheet` in `src/characters/types.ts`
- New `char-death-saves` div below stats-5 row — hidden when `currentHP > 0`, shown as flex row when `currentHP <= 0`
- `renderDeathSaves(c)`: 3 success dots (●=var(--accent)) + 3 failure dots (●=var(--danger)); click success/failure labels to mark
- `markDeathSave(success: boolean)`: PUTs `deathSaves`, re-renders, shows banner at 3 successes ("stabilizes") or 3 failures ("dies")
- `clearDeathSaves()`: PUTs `{ successes: 0, failures: 0 }`, re-renders
- **Auto-clear on heal above 0**: `healChar()` detects `wasDown = currentHP <= 0` before heal; sends `deathSaves: {0,0}` in same PUT
- **Auto-clear on long rest**: `doLongRest()` checks if saves non-zero after rest, fires a separate PUT to clear
- 3 new server tests: set deathSaves, persist across GET, clear on heal

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
                                   deathSaves (shallow merge)
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
  - `saveEquipQty(charId, idx, rawVal)`: validates ≥1, maps array, PUTs
  - `saveEquipNotes(charId, idx, rawVal)`: trims, no-change guard, deletes key if empty, maps array, PUTs
  - `addEquipFormRow`: outer wrapper uses `flex-direction:column`; remove button = `this.closest('div[style*=flex-direction]')`
- **Short rest rollMode**: body param `rollMode: 'average' | 'random'`; UI: append `r` suffix to die count
- **UUID test IDs**: must match UUID regex — use `00000000-0000-0000-0000-00000000000N` or similar
- **Test file cleanup**: `fs.unlinkSync(...)` in test body (not finally); confirm no stray files before commit
- **Conditions UI**: `renderConditions` uses two-zone layout (active chips + collapsed picker); `toggleCondPicker(charId)` toggles visibility; `PHB_CONDITIONS` is source of truth
- **Saves & Skills**: `SKILL_ABILITY` map inside render function; `profBonus` declared in saves/skills block (scoped to same function, still accessible by class-info block below)
- **Death Saves**: `deathSaves?: { successes: number; failures: number }` in `CharacterSheet`; auto-clear on heal-above-0 or long rest; `char-death-saves` div hidden when `currentHP > 0`
- **EXHAUSTION_EFFECTS**: global const array (6 entries); indexed by `exh-1` when `exh > 0`

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | **Update (HP, THP, exhaustion, conditions, slots, notes, gold, equipment, deathSaves, any field)** |
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

## NOT YET DONE — Priorities for Session 17

### 1. Set Level (down) for legacy chars (LOW/DEFERRED)
- Currently returns 400 if no `levelHistory`
- Complex: would need to rebuild HP/features from scratch by fast-forwarding applyLevelUp N times
- Approach deferred — skip unless explicitly requested

### 2. Initiative display in stat row (SMALL)
- Add Initiative (DEX mod) to the 5-box stat row, or make it a derived label somewhere
- Currently not shown anywhere in character detail
- Could replace one of the 5 boxes or add a 6th by changing `.stats-5` to `repeat(auto-fit, minmax(70px, 1fr))`

### 3. Concentration tracker (MEDIUM)
- Track whether character is concentrating on a spell; show spell name
- `concentrating?: string` field on CharacterSheet (name of concentration spell, null = not concentrating)
- UI: small badge/chip in spellcasting section; clear on long rest or damage
- No engine changes needed — sheet-only tracking

### 4. Inspiration toggle (SMALL)
- `inspiration?: boolean` field on CharacterSheet
- UI: toggle button in stats row or class info line
- PUT `{ inspiration: true/false }`

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 17 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **98** |

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
git commit -m "Sheet-17: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
