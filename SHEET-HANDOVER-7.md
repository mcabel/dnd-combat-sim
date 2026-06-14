# SHEET-HANDOVER-7
# Character Sheet & Party System — Session 7 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `41d3bc0`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 124
  - character_improvements: 51
  - server.test: **39** (was 32 — 7 new character/party/xp tests added)
  - All others unchanged, 0 failed across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 6

### XP Awarding System (MEDIUM priority — DONE)
- Added `CR_XP_TABLE` and `crToXP()` to `src/characters/types.ts`
- New endpoint: `POST /api/parties/:id/awardxp`
  - Body: `{ enemies: { name: string; count?: number }[] }`
  - Looks up CR in bestiary, divides XP evenly among party members
  - Returns: `{ totalXP, xpEach, awarded: [{ id, name, xpAwarded, totalXP, prevLevel, readyToLevel }] }`
- Fixed `getBestiary()` in `character_router.ts`: was calling `loadBestiaryDir(dir)` directly but `loadBestiaryDir` returns `LoadResult { bestiary: Map }` — now correctly extracts `.bestiary`
- UI: "🎖 Award XP to Party" button appears after simulate results; shows per-member table with ⬆ ready-to-level badge

### UX Improvements (LOW priority — DONE)
- **Export button** (`📥 Export`) in character detail card header → downloads character as `.json`
- **Import button** (`📤 Import`) in characters panel header → file picker → `POST /api/characters/import`
- **Spellcasting display** in character detail (new `#char-spellcasting` section): shows slot counts per level and cantrip count; shows `—` if no spellcasting

### Server Test Coverage (LOW priority — DONE)
- 7 new HTTP-level tests in `server.test.ts`:
  - `GET /api/characters includes Paladin`
  - `POST /api/:id/levelup levels Paladin to 2`
  - `POST /api/characters/:id/choosesubclass sets Oath of Devotion`
  - `POST /api/:id/levelup triggers ASI at Paladin level 4`
  - `POST /api/characters/:id/applyasi applies +2 CHA`
  - `POST /api/parties creates party with Paladin`
  - `POST /api/parties/:id/awardxp awards XP (4 Goblins = 200 XP)`

### Example Characters (NEW)
Three UUID-named example character files created (required for `loadCharacter()` to find them by ID):
- `characters/00000000-0000-0000-0000-000000000001.json` — Gareth Stonebrow (Fighter)
- `characters/00000000-0000-0000-0000-000000000002.json` — Aelindra Swiftarrow (High Elf Wizard)
- `characters/00000000-0000-0000-0000-000000000003.json` — **Selariel Dawnblade** (High Elf Paladin, NEW)
  - STR 15, DEX 10, CON 13, INT 11, WIS 12, CHA 14
  - AC 18 (Chain Mail + Shield), HP 11, Speed 30
  - Level 1 Paladin: Divine Sense, Lay on Hands (5 pool), 2× L1 spell slots
  - Spells: Bless, Cure Wounds | Cantrip: Light (High Elf racial)
  - Background: Noble

**Root cause fixed:** `example-fighter.json` had UUID `000...001` but `loadCharacter()` looks for `{id}.json`. The old name mismatch caused 404 on all character endpoint tests. Now fixed by creating UUID-named copies; original `example-*.json` files retained for `character_storage.test.ts` and `character_builder.test.ts`.

### `listCharacters()` deduplication
Added ID-based dedup in `src/characters/storage.ts` — prefers UUID-named files over `example-*.json` when IDs collide, preventing duplicates in the list.

### Test isolation
`server.test.ts` now:
- Resets Selariel to level 1 before character tests (`resetPaladin()`)
- Deletes test-created party file on teardown
- Resets Paladin to pristine after mutations

---

## Architecture (unchanged)

```
CharacterSheet (JSON)          Party (JSON)
     ↓ builder.ts                   ↓ storage.ts
  RawPCEntry                   party management
     ↓ pcToCombatant()              ↓
   Combatant ──────────────→ simulate()
  (existing engine)

CharacterSheet
  ↕ leveler.ts (applyLevelUp)       → sets pendingAbilityScoreImprovements
  ↕ improvements.ts (applyASI)      → consumes pending, raises stat
  ↕ improvements.ts (chooseSubclass)→ sets subclassChoices[className]
CharacterSheet (updated)
  → storage.ts (saveCharacter)
  → character_router.ts (endpoints)
  → characters.html (Web UI)
```

### Key Conventions
- `choosesubclass` route body field: `subclassName` (NOT `subclass`)
- `levelup` route path: `POST /api/:id/levelup` (no `/characters/` prefix)
- `applyasi` route path: `POST /api/characters/:id/applyasi`
- `getBestiary()` returns `Map<string, Raw5etoolsMonster>` via `loadBestiaryDir(dir).bestiary`
- Party creation returns **201** (not 200)
- `CR_XP_TABLE` / `crToXP()` now exported from `src/characters/types.ts`

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all (summary, deduped by ID) |
| POST | `/api/characters` | Create (returns 201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | Update |
| DELETE | `/api/characters/:id` | Delete (also removes from parties) |
| POST | `/api/characters/import` | Import from `{ json: "..." }` |
| GET | `/api/characters/:id/export` | Download as JSON |
| POST | `/api/:id/levelup` | Level up (**no `/characters/` prefix**) |
| POST | `/api/characters/:id/applyasi` | Apply ASI |
| POST | `/api/characters/:id/choosesubclass` | Set subclass (body: `{ className, subclassName }`) |
| GET | `/api/parties` | List all |
| POST | `/api/parties` | Create (returns 201) |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update |
| DELETE | `/api/parties/:id` | Delete |
| GET | `/api/parties/:id/members` | Full sheets for all members |
| POST | `/api/parties/:id/awardxp` | Award XP from combat |
| POST | `/api/simulate/custom` | Run simulation with saved characters |

---

## NOT YET DONE — Priorities for Session 7

### 1. characters.html: Award XP state preservation (LOW)
After awarding XP, the "Award XP" button stays disabled. If user clicks another character and returns to simulate, the button should re-enable. Currently `S.lastSimEnemies` persists across party/sim changes (minor UX quirk).

### 2. Party member HP/Resource display (LOW)
Party member rows in the party editor don't show HP or resource pool counts. Could add a compact `maxHP | resources` column.

### 3. Spellcasting slot restoration UI (LOW)
Currently slots display is read-only. Could add "Long Rest" button that resets all slot counters.

### 4. `server.test.ts` cleanup
Created parties should also have error-case coverage (e.g. `awardxp` 400 on unknown monster, 404 on missing party).

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless adding optional field only (check combat handover first)
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 7 start)

| Suite | Count |
|-------|-------|
| **character_improvements.test.ts** | **51** |
| **character_leveler.test.ts** | **124** |
| **character_builder.test.ts** | **82** |
| **character_storage.test.ts** | **74** |
| **server.test.ts** | **39** |
| All other combat/engine suites | unchanged |

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
git commit -m "Sheet-7: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
