# SHEET-HANDOVER-2
# Character Sheet & Party System — Session 2 Start

## Prompt Instructions (carry forward every session)
- Break down large tasks, ask for input when needed
- Commit to GitHub after each meaningful chunk of work
- Stop and flag for Sonnet when architecturally complex; flag for Haiku when simple/incremental
- When fresh chat is optimal: commit, write this handover, stop
- Future handovers must be self-contained and seamless
- PAT: provided verbally at session start — do not paste in files
- Scope: PHB 2014 / MM 2014 / SAC v2.7. No post-2024 content yet.
- Username: mcabel
- **This handover tracks ONLY the Character Sheet workstream.** The combat engine agent uses HANDOVER-SESSION-*.md files separately. Do not touch combat engine internals without reading the current combat handover first.

---

## Current State

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `62db63b`)
- **Tests:** ~1,744 passing (new `character_storage.test.ts` adds 74), 0 failed (36 suites)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done — Sheet Session 1

### Files Created (all new, no existing files modified except server.ts)

| File | Description |
|------|-------------|
| `src/characters/types.ts` | CharacterSheet, Party, all supporting types; utility fns: `totalLevel`, `proficiencyBonus`, `deriveStats`, `levelFromXP`, `abilityModifier` |
| `src/characters/validator.ts` | `validateCharacterSheet` + `validateParty`; `ValidationError` class; checks multiclass prereqs, hit dice, exhaustion, UUID format, ability scores, HP bounds |
| `src/characters/storage.ts` | CRUD for CharacterSheet + Party (`characters/*.json`, `parties/*.json`); `importCharacter`/`exportCharacter`; cascade-delete from parties on character delete; path-traversal guard |
| `src/characters/index.ts` | Re-exports all public APIs |
| `src/character_router.ts` | Express router (`/api/characters`, `/api/parties`); GET/POST/PUT/DELETE + export + members endpoints |
| `characters/example-fighter.json` | Gareth Stonebrow — Fighter 1, Mountain Dwarf, Soldier |
| `characters/example-wizard.json` | Aelindra Swiftarrow — Wizard 1, High Elf, Sage |
| `parties/example-party.json` | The Ashen Shield — Fighter + Wizard party |
| `src/test/character_storage.test.ts` | 74 tests covering util fns, validator (valid + 12 invalid cases), CRUD, import/export, path-traversal guard, example file validation |

### Minimal server.ts Changes (safe for the combat agent to merge around)
- Added `import characterRouter from './character_router';`
- Added `app.use('/api', characterRouter);` after static serving
- Widened CORS `Allow-Methods` to include `PUT, DELETE`

---

## Architecture

```
CharacterSheet (JSON file)        Party (JSON file)
     ↓ (Session 2)                     ↓
  builder.ts                      party management
     ↓
 RawPCEntry  ──────→  pcToCombatant()  ──→  Combatant
 (existing parser)   (existing engine)    (combat engine)
```

### Data Layer
- **`characters/<id>.json`** — one file per CharacterSheet (UUID filename)
- **`parties/<id>.json`** — one file per Party (UUID filename)
- Both directories must exist at project root; `storage.ts` creates them if absent

### Key Design Decisions
- `CharacterSheet` is the *author-time* model; `Combatant` is the *runtime* model — they are SEPARATE
- The bridge (`builder.ts`, not yet implemented) converts `CharacterSheet → RawPCEntry → Combatant`
- `subclassChoices` is `Record<string, string>` (plain object for JSON compatibility), not Map
- `spellcasting.slots` keys are `"1"`.."9"` (string), NOT the existing `"1st"` format — the builder will adapt
- `classLevels` is an array (ordered); `firstClass` identifies which class was taken at level 1 (affects max HP at level 1)

### What Does NOT Yet Exist
- `builder.ts` — converts CharacterSheet → Combatant (next priority)
- `leveler.ts` — applies a level-up to a CharacterSheet
- Web UI for character creation/editing
- Integration with the simulate API (currently the combat agent's `spawnPC()` only reads from `pc_stat_blocks_lv1.json`)

---

## API Endpoints (implemented, live in character_router.ts)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all characters (summary only) |
| POST | `/api/characters` | Create new character sheet |
| GET | `/api/characters/:id` | Get full character sheet |
| PUT | `/api/characters/:id` | Update character sheet |
| DELETE | `/api/characters/:id` | Delete character sheet |
| POST | `/api/characters/import` | Import from JSON string `{ json: "..." }` |
| GET | `/api/characters/:id/export` | Export as JSON download |
| GET | `/api/parties` | List all parties |
| POST | `/api/parties` | Create new party |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update party |
| DELETE | `/api/parties/:id` | Delete party |
| GET | `/api/parties/:id/members` | Get full sheets for all party members |

---

## NOT YET DONE — Priorities for Sheet Session 2

### 1. Builder: CharacterSheet → Combatant (HIGH)
**File:** `src/characters/builder.ts`
**Goal:** Convert a saved `CharacterSheet` into a `Combatant` that the existing combat engine accepts.

**Key function:**
```typescript
export function buildCombatant(
  sheet: CharacterSheet,
  pos: Vec3,
  profile: AIProfile = 'smart'
): Combatant
```

**Strategy:** Convert `CharacterSheet` → `RawPCEntry` format (matching `pc.ts` parser expectations), then call existing `pcToCombatant(raw, pos, profile)`. This reuses all existing resource/spell/weapon parsing logic.

**Field mapping notes:**
- `sheet.spellcasting.slots["1"]` → `raw.spellcasting.slots["1st"]` (key format differs)
- `sheet.stats` → `raw.ability_scores` + `raw.modifiers` (compute mods on the fly)
- `sheet.resources` → `raw.resources` (nearly 1:1)
- `sheet.equipment` → `raw.weapons` (filter equipped weapons, parse into `RawWeapon` format)
- `sheet.level1Features + sheet.allFeatures` → `raw.level1Features + raw.racialTraits`

**Watch out:** `pcToCombatant` is in `src/parser/pc.ts`. Import from there, do NOT modify it.

### 2. Simulate API Integration (HIGH — needed to use custom characters in combat)
**File:** `src/character_router.ts` (add one endpoint) and/or `src/server.ts`

Add `POST /api/simulate/custom` that accepts a `partyCharacterIds: string[]` instead of `party: { cls, aiProfile }[]`. Load sheets, call builder, run simulation.

**Do NOT modify** existing `POST /api/simulate` — the combat agent owns that.

### 3. Level-Up Logic (MEDIUM)
**File:** `src/characters/leveler.ts`

```typescript
export function applyLevelUp(
  sheet: CharacterSheet,
  newClassName: string        // can equal an existing class OR a new one (multiclass)
): CharacterSheet
```

- Validates multiclass prerequisites (already in validator.ts)
- Computes HP increase: `floor(hitDie/2) + 1 + CON mod` (NOT max HP, except level 1)
- Updates `classLevels`, `hitDice`, `resources`, `spellcasting.slots`
- Triggers subclass selection at the right level (Fighter 3, Wizard 2, Cleric 1, etc.)
- Returns modified copy — does NOT mutate input

**Subclass trigger levels by class:**

| Class | Level for subclass |
|-------|--------------------|
| Cleric | 1 |
| Druid | 2 |
| Paladin | 3 |
| Fighter | 3 |
| Ranger | 3 |
| Bard | 3 |
| Barbarian | 3 |
| Rogue | 3 |
| Monk | 3 |
| Sorcerer | 1 |
| Warlock | 1 |
| Wizard | 2 |

**Spell slot progression:** Use PHB p.165 multiclass table — precompute as a constant table keyed by effective caster level.

### 4. Web UI: Character Sheet Form (LOWER — depends on Sessions 2+3)
Character creation/editing form in the existing web UI (`docs/simulator.html` or a new page).
This is a larger task — flag for Sonnet planning when ready.

### 5. XP Awarding After Combat (LOWER — coordination needed with combat agent)
After a simulation run, award XP to party members: sum CR XP of defeated monsters ÷ party size.
Requires a hook in `simulate.ts` (combat agent's file) — coordinate via that handover.

---

## Co-existence Rules with the Combat Agent

- **DO NOT modify** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/server.ts`: minimal additions only; comment `// CHARACTER SHEET AGENT` on each change
- `src/types/core.ts`: may add `characterSheetId?: string` to `Combatant` if needed — but ONLY as optional, never required (would break all existing factories)
- `pc_stat_blocks_lv1.json`: read-only reference — do NOT modify
- If the combat agent adds a field to `Combatant` or `PlayerResources`, re-check `builder.ts` maps correctly

---

## Test Baseline (Sheet Session 2 start)

| Suite | Count | Notes |
|-------|-------|-------|
| **character_storage.test.ts** | **74** | New — Sheet Session 1 |
| adv_system.test.ts | 48 | |
| ai.test.ts | 26 | |
| arms_of_hadar.test.ts | 33 | |
| bardic_inspiration.test.ts | 27 | |
| bless.test.ts | 37 | |
| combat.test.ts | ~49 | variance expected |
| concentration_ai.test.ts | 34 | |
| cunning_action.test.ts | 53 | |
| day.test.ts | 54 | |
| death_saves.test.ts | 57 | |
| engine.test.ts | 71 | |
| entangle.test.ts | 30 | |
| faerie_fire.test.ts | 29 | |
| healing.test.ts | 34 | |
| healing_spells.test.ts | 36 | |
| html_report.test.ts | 36 | |
| integration.test.ts | 26 | |
| los.test.ts | 54 | |
| mechanics.test.ts | 57 | |
| mount.test.ts | 43 | |
| mount_redirect.test.ts | 21 | |
| parser.test.ts | 101 | |
| pc.test.ts | 266 | |
| phase4.test.ts | 54 | |
| rage.test.ts | 40 | |
| resources.test.ts | 72 | |
| scenario.test.ts | 94 | |
| server.test.ts | 32 | |
| shield_of_faith.test.ts | 27 | |
| sneak_attack.test.ts | 23 | |
| spell_actions.test.ts | 52 | |
| spell_effects.test.ts | 23 | |
| summons.test.ts | 51 | |
| thunderwave.test.ts | 25 | |
| warding_bond.test.ts | 41 | |

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
git add -A
git commit -m "Sheet-2: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```
