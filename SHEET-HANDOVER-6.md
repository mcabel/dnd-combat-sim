# SHEET-HANDOVER-6
# Character Sheet & Party System — Session 6 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `067fc65`)
- **Tests:** ~2,001 passing (character_storage: 74, character_builder: 82, character_leveler: 124, character_improvements: 51), 0 failed (40 suites)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)
- **Push discipline:** always show full `git push` output (no `| tail`); rebase on remote-main if rejected

---

## What Was Done

### Sheet Session 1–4 (see SHEET-HANDOVER-5.md for details)
- Full backend: types.ts, validator.ts, storage.ts, builder.ts, leveler.ts, improvements.ts
- 331 tests passing across 4 character test suites
- API routes: CRUD chars/parties, levelup, applyasi, choosesubclass, simulate/custom

### Sheet Session 5 (commit `067fc65`)
- `docs/characters.html` — single-page character management UI:
  - **Characters tab**: list grid, create/edit form, full character detail view
  - **Level-up flow**: class selector + HP method → POST /api/:id/levelup → hpGained toast
  - **ASI flow**: auto-prompts when `pendingAbilityScoreImprovements > 0` → POST /api/characters/:id/applyasi
  - **Subclass flow**: auto-prompts when `S.pendingSubclass` set after levelup → POST /api/characters/:id/choosesubclass
  - **Parties tab**: party list, party editor (add/remove members), save/delete
  - **Simulate**: enemy builder (name+count+AI per row), trials selector, runs POST /api/simulate/custom, shows win bar + ctable
  - Design: matches dark/gold D&D aesthetic of simulator.html (same CSS vars, fonts, card layout)
  - Server URL configurable (same as simulator.html)
  - Nav links: ⚔ Simulator | ⌂ Home

**Key implementation notes:**
- Levelup route is `POST /api/:id/levelup` (NOT `/api/characters/:id/levelup`) — mounted as `router.post('/:id/levelup')` on the `/api` prefix
- applyasi: `POST /api/characters/:id/applyasi` ✓
- choosesubclass: `POST /api/characters/:id/choosesubclass` ✓
- JS syntax validated clean (node --check on extracted script block)
- All 11 URLs in HTML verified against actual router routes

---

## Architecture

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
- `CharacterSheet.spellcasting.slots` keys: `"1"`.."9"` (integers as strings)
  - `builder.ts` converts to `"1st"` format before handing to `pcToCombatant`
  - `leveler.ts` uses the `"1".."9"` format throughout (consistent with CharacterSheet)
- `firstClass` drives `class` in `RawPCEntry` (determines saving throws, HD used for resources)
- `applyLevelUp` does NOT apply the ASI — it sets `pendingAbilityScoreImprovements += 1`
- `applyLevelUp` does NOT set `subclassChoices[className]` — caller must call `chooseSubclass`
- `pendingASIHalfPoints`: 0 or 1; 2 half-points = 1 full pending consumed

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all (summary) |
| POST | `/api/characters` | Create |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | Update |
| DELETE | `/api/characters/:id` | Delete (also removes from parties) |
| POST | `/api/characters/import` | Import from `{ json: "..." }` |
| GET | `/api/characters/:id/export` | Download as JSON |
| POST | `/api/:id/levelup` | Level up by one level (**NOTE: no `/characters/` prefix**) |
| POST | `/api/characters/:id/applyasi` | Apply ASI (+1 or +2 to one ability) |
| POST | `/api/characters/:id/choosesubclass` | Set subclass for a class |
| GET | `/api/parties` | List all |
| POST | `/api/parties` | Create |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update |
| DELETE | `/api/parties/:id` | Delete |
| GET | `/api/parties/:id/members` | Full sheets for all members |
| POST | `/api/simulate/custom` | Run simulation with saved characters |

---

## NOT YET DONE — Priorities for Session 6

### 1. XP Awarding Post-Combat (MEDIUM priority)
After `/api/simulate/custom`, optionally award XP to party members:
- XP = sum of CR-based XP for defeated monsters ÷ party size
- Requires reading combat agent's current HANDOVER to understand `SimulateResult` shape
- Monster XP values are in bestiary JSON (check `bestiaryData/bestiary-mm-2014.json`, field `xp` in each entry)
- New endpoint: `POST /api/parties/:id/awardxp` body: `{ monsterNames: string[], enemyCount: Record<string, number> }`
- UI: "Award XP" button after simulate results in characters.html

### 2. `characters.html` UX Improvements (LOW — polish)
- Export character JSON button in detail view
- Import JSON button (POST /api/characters/import)
- Spellcasting display in character detail (if `sheet.spellcasting` exists)
- HP/Resource display in party member rows

### 3. `server.test.ts` Coverage for Character Routes (LOW)
- No HTTP-level tests currently cover levelup/applyasi/choosesubclass routes
- Should add basic happy-path tests using the existing test server setup

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid touching unless adding optional field only (check combat handover first)
- `src/characters/*`: Sheet workstream owns this directory entirely
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 6 start)

| Suite | Count |
|-------|-------|
| **character_improvements.test.ts** | **51** |
| **character_leveler.test.ts** | **124** |
| **character_builder.test.ts** | **82** |
| **character_storage.test.ts** | **74** |
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| arms_of_hadar.test.ts | 33 |
| bardic_inspiration.test.ts | 27 |
| bless.test.ts | 37 |
| combat.test.ts | ~49 (variance expected) |
| concentration_ai.test.ts | 34 |
| cunning_action.test.ts | 53 |
| day.test.ts | 54 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| entangle.test.ts | 30 |
| faerie_fire.test.ts | 29 |
| healing.test.ts | 34 |
| healing_spells.test.ts | 36 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| los.test.ts | 54 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 270 |
| phase4.test.ts | 54 (occasional -1 variance) |
| rage.test.ts | 40 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | 32 |
| shield_of_faith.test.ts | 27 |
| sleep.test.ts | 35 |
| sneak_attack.test.ts | 23 |
| spell_actions.test.ts | 52 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| thunderwave.test.ts | 25 |
| warding_bond.test.ts | 41 |

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
git rebase remote-main   # if local diverged
git add -A
git commit -m "Sheet-6: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
# Verify: check output for "HEAD -> main" not "[rejected]"
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
