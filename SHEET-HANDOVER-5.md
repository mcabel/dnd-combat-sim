# SHEET-HANDOVER-5
# Character Sheet & Party System — Session 5 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `8afb400`)
- **Tests:** ~2,001 passing (character_storage: 74, character_builder: 82, character_leveler: 124, character_improvements: 51), 0 failed (40 suites)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)
- **Push discipline:** always show full `git push` output (no `| tail`); rebase on remote-main if rejected

---

## What Was Done

### Sheet Session 1 (commit `96d6dff`)
- `src/characters/types.ts` — CharacterSheet, Party, DerivedStats; utility fns
- `src/characters/validator.ts` — validateCharacterSheet + validateParty; ValidationError
- `src/characters/storage.ts` — CRUD (characters/*.json, parties/*.json); import/export
- `src/characters/index.ts` — re-exports
- `src/character_router.ts` — Express router at /api/characters + /api/parties
- `characters/example-fighter.json` — Gareth Stonebrow, Fighter 1
- `characters/example-wizard.json` — Aelindra Swiftarrow, Wizard 1
- `parties/example-party.json` — The Ashen Shield
- `src/test/character_storage.test.ts` — 74 tests

### Sheet Session 2 (commit `a04776f`)
- `src/characters/builder.ts` — CharacterSheet → RawPCEntry → Combatant via pcToCombatant();
  36-weapon PHB DB; finesse DEX/STR selection; slot key normalisation ("1"→"1st");
  buildWarnings() for bad weapons / 0-HP / empty spell list; name+id patched post-build
- `src/character_router.ts` — POST /api/simulate/custom: load sheets by ID → buildCombatant()
  → simulate(); same response shape as /api/simulate; difficultyLabel inlined to avoid
  circular server.ts import
- `src/test/character_builder.test.ts` — 82 tests

### Sheet Session 3 (commit `9283ab0`)
- `src/characters/leveler.ts` — `applyLevelUp(sheet, className, hpRollMethod)`:
  - Returns new CharacterSheet (pure function, no mutation)
  - HP: average (floor(d/2)+1+CON) or max (d+CON), minimum 1
  - Updates classLevels, hitDice (total+remaining), maxHP, currentHP
  - Resources scaled per class/level: rage, bardicInspiration (die upgrade at 5/10/15),
    secondWind, layOnHands, divineSmite, sneakAttackDice, cunningAction, arcaneRecovery
  - Standard spell slots via FULL_CASTER_SLOTS (PHB p.165) and HALF_CASTER_SLOTS tables
    (single-class Paladin/Ranger → dedicated table; multiclass → combined caster level)
  - Warlock Pact Magic (WARLOCK_PACT_SLOTS table) updated independently
  - Proficiency bonus tier change propagates to spellAttackBonus / saveDC
  - Spellcasting block auto-initialised when first slots are gained (Paladin 2, Ranger 2)
  - subclassPrompt: className string if this level triggers subclass selection
  - abilityScoreImprovement: true flag at PHB ASI levels (Fighter/Rogue extras included)
  - Multiclass prerequisite enforcement (Fighter STR-or-DEX OR rule handled)
  - Level-20 cap throws
  - Exports: `computeStandardSlots`, slot tables for external use/testing
- `src/characters/index.ts` — exports `applyLevelUp`, `LevelUpResult`
- `src/character_router.ts` — `POST /api/characters/:id/levelup`
- `src/test/character_leveler.test.ts` — 124 tests (18 groups)

### Sheet Session 4 (commit `8afb400`)
- `src/characters/types.ts` — Added two optional fields to CharacterSheet:
  - `pendingAbilityScoreImprovements?: number` — full ASIs not yet applied (each = +2 pts)
  - `pendingASIHalfPoints?: number` — 0 or 1; leftover from a +1 split
- `src/characters/leveler.ts` — `updated` changed `const` → `let`;
  ASI branch now increments `pendingAbilityScoreImprovements` in the new sheet
- `src/characters/improvements.ts` (new) — two pure functions:
  - `applyASI(sheet, ability, amount)`: applies +1 or +2 to one ability score
    - Validates ability key, amount (1|2), score cap (≤20), pending availability
    - Consumes half-points: amount=2 uses 1 full pending; amount=1 uses half
    - Both `stats` and `baseStats` are incremented (racial bonus stays fixed)
  - `chooseSubclass(sheet, className, subclassName)`: records subclass choice
    - Validates className in classLevels, no duplicate, non-empty subclassName
    - Trims whitespace from subclassName
- `src/characters/index.ts` — exports `applyASI`, `chooseSubclass`
- `src/character_router.ts` — two new routes (appended after `export default router;`):
  - `POST /api/characters/:id/applyasi`
  - `POST /api/characters/:id/choosesubclass`
- `src/test/character_improvements.test.ts` — 51 tests (15 groups)

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
| POST | `/api/characters/:id/levelup` | Level up by one level |
| **POST** | **`/api/characters/:id/applyasi`** | **Apply ASI (+1 or +2 to one ability)** |
| **POST** | **`/api/characters/:id/choosesubclass`** | **Set subclass for a class** |
| GET | `/api/parties` | List all |
| POST | `/api/parties` | Create |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update |
| DELETE | `/api/parties/:id` | Delete |
| GET | `/api/parties/:id/members` | Full sheets for all members |
| POST | `/api/simulate/custom` | Run simulation with saved characters |

### applyasi request/response shape
```json
// POST /api/characters/:id/applyasi
// Request:
{ "ability": "str", "amount": 2 }   // amount: 1 or 2

// Response:
{
  "character": { /* full updated CharacterSheet */ },
  "ability": "str",
  "oldScore": 17,
  "newScore": 19,
  "pendingAbilityScoreImprovements": 0,
  "pendingASIHalfPoints": 0
}
```

### choosesubclass request/response shape
```json
// POST /api/characters/:id/choosesubclass
// Request:
{ "className": "Fighter", "subclassName": "Champion" }

// Response:
{
  "character": { /* full updated CharacterSheet */ },
  "className": "Fighter",
  "subclassName": "Champion"
}
```

---

## NOT YET DONE — Priorities for Session 5

### 1. Web UI for Character Management (HIGH — flag for Sonnet, needs user instruction)
A new page (`docs/characters.html`) with:
- Character list with create/edit/delete
- Class/race/stat picker
- Level-up button → POST /api/characters/:id/levelup
- ASI prompt (when `pendingAbilityScoreImprovements > 0`) → POST /api/characters/:id/applyasi
- Subclass prompt (when `subclassPrompt` returned) → POST /api/characters/:id/choosesubclass
- Party builder (drag members in/out)
- "Simulate with this party" button → POST /api/simulate/custom

**Flag for Sonnet-level planning session. Do NOT start without explicit user instruction.**

### 2. XP Awarding Post-Combat (LOWER — coordination needed)
After `/api/simulate/custom`, optionally award XP to party members:
XP = sum of CR-based XP for defeated monsters ÷ party size.
Requires reading the combat agent's current HANDOVER to understand `SimulateResult` shape.
Monster XP values are in bestiary JSON.

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid touching unless adding optional field only (check combat handover first)
- `src/characters/*`: Sheet workstream owns this directory entirely
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 5 start)

| Suite | Count |
|-------|-------|
| **character_improvements.test.ts** | **51 (Sheet Session 4)** |
| **character_leveler.test.ts** | **124 (Sheet Session 3)** |
| **character_builder.test.ts** | **82 (Sheet Session 2)** |
| **character_storage.test.ts** | **74 (Sheet Session 1)** |
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
| phase4.test.ts | 54 (occasional -1 variance, not a regression) |
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
git commit -m "Sheet-5: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
# Verify: check output for "HEAD -> main" not "[rejected]"
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
