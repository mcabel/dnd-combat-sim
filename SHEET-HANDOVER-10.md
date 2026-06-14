# SHEET-HANDOVER-10
# Character Sheet & Party System — Session 10 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `95a5c2c`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **61** (was 51 — 10 new shortrest tests)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 9

### Short Rest Endpoint (COMPLETE)

- `POST /api/characters/:id/shortrest`
- Body: `{ hitDiceToSpend?: number }` (default 0)
- Mechanic: each HD spent = floor(dieSides/2)+1 + CON mod (deterministic average roll), capped at maxHP
- Resources recharged on short rest:
  - **Second Wind** (Fighter) — always
  - **Pact slots** (Warlock `spellcasting.pactSlots`) — always
  - **Bardic Inspiration** (Bard) — ONLY if `allFeatures` contains `'Font of Inspiration'` (lv5+)
  - **Channel Divinity** (Cleric) — always
  - **Ki points** (Monk) — always
- Response: `{ character, hpRegained, hdSpent, restored: string[] }`

### New Types Added

- `CharacterResources.channelDivinity?: { max: number; remaining: number }` — added to `src/characters/types.ts`
- `CharacterResources.ki?: { max: number; remaining: number }` — added to `src/characters/types.ts`

### Leveler Updated

- `updateResources()` in `leveler.ts` now handles:
  - `case 'Cleric'`: sets `channelDivinity` (1/rest lv1–5, 2/rest lv6–17, 3/rest lv18+)
  - `case 'Monk'`: sets `ki` (= monk level)

### Long Rest Updated

- `longrest` endpoint also restores `channelDivinity` and `ki` (long rest subsumes short rest for these)

### UI Updated

- `☀ Short Rest` button added next to `🌙 Long Rest` in character detail header
- `doShortRest()` JS: prompts user for HD count (0–available), calls endpoint, shows banner

---

## Architecture (updated)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, etc.

Short rest resources: secondWind, pactSlots, channelDivinity, ki, bardicInspiration (lv5+ only)
Long rest resources:  all of the above + rage, arcaneRecovery, layOnHands, wardingBond, HP, spellSlots
```

### Key Conventions (unchanged + new)
- `channelDivinity` and `ki` are optional fields — old characters with `{}` resources still valid
- Bardic Inspiration short rest check: feature lookup via `allFeatures.some(f => f.name === 'Font of Inspiration')`
- Hit dice average roll: `floor(dieSides/2) + 1` (not random — deterministic for testing)
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
| PUT | `/api/characters/:id` | Update |
| DELETE | `/api/characters/:id` | Delete |
| POST | `/api/characters/import` | Import JSON |
| GET | `/api/characters/:id/export` | Download JSON |
| POST | `/api/:id/levelup` | Level up (no `/characters/` prefix) |
| POST | `/api/characters/:id/applyasi` | Apply ASI |
| POST | `/api/characters/:id/choosesubclass` | Set subclass |
| POST | `/api/characters/:id/longrest` | Long rest |
| POST | `/api/characters/:id/shortrest` | **NEW** — Short rest (hit dice + recharge) |
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

## NOT YET DONE — Priorities for Session 10

### 1. Slot consumption UI (LOW)
- Character detail spellcasting section: `Use Slot` / `Restore Slot` controls per level
- Calls `PUT /api/characters/:id` with updated `spellcasting.slotsUsed`

### 2. Character detail: HP tracker (LOW)
- Click HP to take damage / heal
- `PUT /api/characters/:id` with updated `currentHP`

### 3. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

### 4. Short rest HD: random vs average (NOTE)
- Currently uses deterministic average `floor(d/2)+1` for testability
- Future: could expose `{ hitDiceToSpend, rollMode: 'average'|'random' }` body param

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 10 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **61** |

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
git commit -m "Sheet-10: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
