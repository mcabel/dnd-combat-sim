# SHEET-HANDOVER-3
# Character Sheet & Party System — Session 3 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `a04776f`)
- **Tests:** ~1,826 passing (character_storage: 74, character_builder: 82), 0 failed (37 suites)
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

---

## Architecture

```
CharacterSheet (JSON)          Party (JSON)
     ↓ builder.ts                   ↓ storage.ts
  RawPCEntry                   party management
     ↓ pcToCombatant()              ↓
   Combatant ──────────────→ simulate()
  (existing engine)
```

### Key Conventions
- `CharacterSheet.spellcasting.slots` keys: `"1"`.."9"` (integers as strings)
  - `builder.ts` converts to `"1st"` format before handing to `pcToCombatant`
  - `buildResources()` in pc.ts uses `parseInt()` so both formats work
- `firstClass` drives `class` in `RawPCEntry` (determines saving throws, HD used for resources)
- Unequipped weapons are excluded from combat actions
- `buildCombatant()` patches `name` and `id` after `pcToCombatant()` call

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
| GET | `/api/parties` | List all |
| POST | `/api/parties` | Create |
| GET | `/api/parties/:id` | Get party |
| PUT | `/api/parties/:id` | Update |
| DELETE | `/api/parties/:id` | Delete |
| GET | `/api/parties/:id/members` | Full sheets for all members |
| **POST** | **`/api/simulate/custom`** | **Run simulation with saved characters** |

### simulate/custom request shape
```json
{
  "partyCharacterIds": ["uuid1", "uuid2"],
  "enemies": [{ "name": "Goblin", "count": 3, "aiProfile": "attackNearest" }],
  "trials": 100
}
```

---

## NOT YET DONE — Priorities for Session 3

### 1. Level-Up Logic (HIGH — needed for non-level-1 play)
**File:** `src/characters/leveler.ts`

```typescript
export interface LevelUpResult {
  sheet:       CharacterSheet;     // updated sheet (copy, not mutated)
  hpGained:   number;
  newFeatures: CharacterFeature[];
  subclassPrompt?: string;         // set if this level triggers subclass selection
  abilityScoreImprovement?: true;  // set if ASI is available
}

export function applyLevelUp(
  sheet:     CharacterSheet,
  className: string,               // may equal an existing class (standard) or new one (multiclass)
  hpRollMethod?: 'average' | 'max' // default: 'average'
): LevelUpResult
```

**Level-1 HP** (firstClass only): `hitDie + CON mod` (max roll, not average)
**Level 2+ HP**: `floor(hitDie/2) + 1 + CON mod` for 'average'; or `hitDie + CON mod` for 'max'
**Updates:** `classLevels`, `hitDice.total+remaining`, `maxHP+currentHP`,
            `allFeatures`, `resources`, `spellcasting.slots`

**Spell slot progression (standard casters):** Use PHB multiclass table p.165
**Subclass trigger levels:**

| Class | Subclass level |
|-------|---------------|
| Cleric, Sorcerer, Warlock | 1 |
| Druid, Wizard | 2 |
| Bard, Barbarian, Fighter, Monk, Paladin, Ranger, Rogue | 3 |

**Prerequisite check:** reuse `MULTICLASS_PREREQS` from `types.ts` via `validateCharacterSheet`

### 2. Simulate/Custom Integration with Level-Up (MEDIUM)
Once leveler is implemented, add `POST /api/characters/:id/levelup` endpoint:
```
Body: { className: string; hpRollMethod?: 'average' | 'max' }
Response: { character: CharacterSheet; hpGained: number; newFeatures: CharacterFeature[] }
```

### 3. Web UI for Character Management (LOWER — flag for Sonnet)
This is a significant undertaking. A new page (`docs/characters.html`) with:
- Character list with create/edit/delete
- Class/race/stat picker
- Party builder (drag members in/out)
- "Simulate with this party" button (calls /api/simulate/custom)

**Do NOT start this in Session 3 without explicit user instruction.**
Flag for Sonnet-level planning session first.

### 4. XP Awarding Post-Combat (LOWER — coordination needed)
After `/api/simulate/custom`, optionally award XP to party members:
XP = sum of CR-based XP for defeated monsters ÷ party size.
Requires reading the combat agent's HANDOVER to understand the `SimulateResult` shape.
The combat agent's handover (`HANDOVER-SESSION-38.md`) shows the result already includes
`combatantStats` — enough to determine outcome. Monster XP values are in bestiary JSON.

---

## Combat Agent Coordination Notes (from HANDOVER-SESSION-38.md)

- Session 38 focus: Hex verification, Color Spray/Burning Hands for Sorcerer, or Sleep ≥2 threshold
- The `Combatant` type has NOT changed since Session 37 — no factory updates needed in builder
- `pcToCombatant()` now deduplicates spell/weapon actions (Chromatic Orb fix) — builder benefits automatically
- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid touching unless adding optional field only (check combat handover first)

---

## Test Baseline (Sheet Session 3 start)

| Suite | Count |
|-------|-------|
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
| phase4.test.ts | 54 |
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
git commit -m "Sheet-3: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
# Verify: check output for "HEAD -> main" not "[rejected]"
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
