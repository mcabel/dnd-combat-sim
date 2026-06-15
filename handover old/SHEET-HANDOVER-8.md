# SHEET-HANDOVER-8
# Character Sheet & Party System — Session 8 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `8b92319`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 124
  - character_improvements: 51
  - server.test: **46** (was 39 — 7 new tests added this session)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 7

### Test Characters Folder (NEW)
- `characters/test-chars/` created — NOT loaded by `listCharacters()` (subdirectory excluded)
- Used as reference/template storage; copy to `characters/` when needed for server-level tests

| File | ID | Name | Class | Level |
|------|----|------|-------|-------|
| `rogue-lv5.json` | `test0000-0000-rogue-0000-000000000001` | Kira Shadowstep | Rogue 5 | 5 |
| `barbarian-lv5.json` | `test0000-0000-barb0-0000-000000000002` | Grog Ironfist | Barbarian 5 | 5 |
| `cleric-lv5.json` | `test0000-0000-clrc0-0000-000000000003` | Mirela Dawnborne | Cleric 5 | 5 |
| `ranger-lv5.json` | `test0000-0000-rang0-0000-000000000004` | Sylvara Windfoot | Ranger 5 | 5 |
| `wizard-lv3.json` | `test0000-0000-wiz00-0000-000000000005` | Aldric Voss | Wizard 3 | 3 |

### Long Rest Endpoint (NEW)
- `POST /api/characters/:id/longrest`
- Resets: `currentHP → maxHP`, spell slots (`slotsUsed → 0`), pact slots, `secondWind`, `rage`, `bardicInspiration`, `arcaneRecovery`, `layOnHands`, `wardingBond`
- Restores hit dice (recover half, min 1)
- Reduces exhaustion by 1
- Response: `{ character, restored: string[] }`
- UI: `🌙 Long Rest` button in char detail header CT-right area

### Set Level Endpoint (NEW, DM Tool)
- `POST /api/characters/:id/setlevel`
- Body: `{ level: number; className?: string }`
- Levels UP only (1–20). Loops `applyLevelUp()`. Sets XP to `XP_THRESHOLDS[target-1]`.
- Returns 400 if target ≤ current level or invalid range
- UI: "Set Level (DM)" section in char detail, below Level Up, select 2–20 + button

### awardxp Fix (BUGFIX)
- Previously: all-unknown monsters returned 200 with 0 XP
- Now: if **every** supplied enemy is unrecognized → 400 with descriptive error
- Mixed (some known, some unknown): still awards XP for known enemies (partial award)

### Award XP Button State Fix (UX)
- After awarding XP, btn showed "✓ XP Awarded" (disabled) even on revisit
- Fix: `renderSimResults()` now resets `btn.disabled = false` + `btn.textContent = '🎖 Award XP to Party'` each time sim results are displayed

### Party Member HP/Resource Display (UX)
- `renderMemberList()` now shows compact info in member rows:
  `HP 33/33 · Rage 3/3 · Slots 6/6` (resources shown only if present)
- Reads from `S.chars` (full CharacterSheet, already loaded)

### server.test.ts (7 new tests → 46 total)
- `POST /api/parties/:id/awardxp 404 on missing party`
- `POST /api/parties/:id/awardxp 400 on unknown monster`
- `POST /api/characters/:id/longrest restores HP and resources`
- `POST /api/characters/:id/longrest 404 on missing character`
- `POST /api/characters/:id/setlevel levels up to target`
- `POST /api/characters/:id/setlevel 400 on level <= current`
- `POST /api/characters/:id/setlevel 400 on invalid level`

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
  ↕ character_router.ts (longrest)  → resets resources/slots/HP
  ↕ character_router.ts (setlevel)  → loops applyLevelUp, sets XP
CharacterSheet (updated)
  → storage.ts (saveCharacter)
  → character_router.ts (endpoints)
  → characters.html (Web UI)
```

### Key Conventions
- `choosesubclass` route body field: `subclassName` (NOT `subclass`)
- `levelup` route path: `POST /api/:id/levelup` (no `/characters/` prefix)
- `applyasi` route path: `POST /api/characters/:id/applyasi`
- `longrest` route path: `POST /api/characters/:id/longrest`
- `setlevel` route path: `POST /api/characters/:id/setlevel`
- `getBestiary()` returns `Map<string, Raw5etoolsMonster>` via `loadBestiaryDir(dir).bestiary`
- Party creation returns **201** (not 200)
- `CR_XP_TABLE` / `crToXP()` exported from `src/characters/types.ts`
- `awardxp` returns 400 if ALL enemies unrecognized; partial award if some known

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
| POST | `/api/characters/:id/longrest` | Long rest — restore HP/slots/resources |
| POST | `/api/characters/:id/setlevel` | DM: force level up to target (body: `{ level }`) |
| GET | `/api/parties` | List all |
| POST | `/api/parties` | Create (returns 201) |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update |
| DELETE | `/api/parties/:id` | Delete |
| GET | `/api/parties/:id/members` | Full sheets for all members |
| POST | `/api/parties/:id/awardxp` | Award XP from combat |
| POST | `/api/simulate/custom` | Run simulation with saved characters |

---

## NOT YET DONE — Priorities for Session 8

### 1. Short Rest endpoint (MEDIUM)
- `POST /api/characters/:id/shortrest`
- Body: `{ hitDiceToSpend?: number }` (optional)
- Restores: `secondWind` (Fighter only), `bardicInspiration` (Bard — actually long rest), Warlock pact slots (short rest recovery), `arcaneRecovery` use (via short rest, not long rest — should move check)
- Spends hit dice: each HD spend = roll die + CON mod → add to currentHP (cap at maxHP)
- Channel Divinity recharges on short rest
- Returns: `{ character, hpRegained, hdSpent }`

### 2. Warlock Pact Slots short-rest recovery (MEDIUM)
- Currently `longrest` resets pact slots; they should also reset on short rest
- Move pact slot reset from longrest-only to also trigger on shortrest

### 3. Set Level (down) (LOW)
- Currently `setlevel` is level-up only; level-down requires rebuild from scratch
- Approach: rebuild character from firstClass level 1, then apply setlevel up to target
- Complex — needs full feature regeneration from leveler

### 4. Slot consumption UI (LOW)
- Character detail spellcasting section: add `Use Slot` / `Restore Slot` controls per level
- Calls `PUT /api/characters/:id` with updated `spellcasting.slotsUsed`

### 5. Character detail: HP tracker (LOW)
- Click HP value to take damage / heal
- Calls `PUT /api/characters/:id` with updated `currentHP`

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless adding optional field only (check combat handover first)
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 8 start)

| Suite | Count |
|-------|-------|
| **character_improvements.test.ts** | **51** |
| **character_leveler.test.ts** | **124** |
| **character_builder.test.ts** | **82** |
| **character_storage.test.ts** | **74** |
| **server.test.ts** | **46** |
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
git commit -m "Sheet-8: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
