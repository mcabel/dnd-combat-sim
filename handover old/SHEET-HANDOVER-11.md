# SHEET-HANDOVER-11
# Character Sheet & Party System — Session 11 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `1b504e0`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: **67** (was 61 — 6 new HP/slot tests)
  - All other combat/engine suites unchanged, 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 10

### HP Tracker (COMPLETE)
- Stats row now shows `currentHP/maxHP` instead of just `maxHP`
- Two inline buttons in the HP stat box: `− Dmg` (danger style) and `+ Heal` (secondary)
- `takeDamage()`: prompts for amount, floors at 0, PUTs `{ currentHP }`, banner shows UNCONSCIOUS if 0
- `healChar()`: prompts for amount, caps at maxHP, PUTs `{ currentHP }`, shows new HP in banner
- 3 new server tests: damage, heal, 0 HP (unconscious)

### Slot Consumption UI (COMPLETE)
- **Bug fixed:** previous code read `lvlSlots.available` / `lvlSlots.max` — wrong, `slots` is `Record<string, number>`. Now correctly computes `max = slots[key]` and `avail = max - (slotsUsed[key] || 0)`
- Spellcasting section now shows: DC/attack/ability line, cantrip count, per-level pip indicators (gold=available, grey=used), `avail/max` count (red when 0), `Use` button (disabled when 0 avail), `↩` restore button (disabled when 0 used)
- Pact slots (Warlock) rendered separately below standard slots with pip indicators
- `useSlot(level)`: increments `slotsUsed[level]`, PUTs full spellcasting block
- `restoreSlot(level)`: decrements `slotsUsed[level]`, PUTs full spellcasting block
- 3 new server tests: use slot, restore slot, persists across GET
- `request()` helper in server.test.ts extended to accept `'PUT' | 'DELETE'` method types

---

## Architecture (updated)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, etc.
  ↕ PUT /api/characters/:id    → currentHP, spellcasting.slotsUsed (shallow merge)

Short rest resources: secondWind, pactSlots, channelDivinity, ki, bardicInspiration (lv5+ only)
Long rest resources:  all of the above + rage, arcaneRecovery, layOnHands, wardingBond, HP, spellSlots
```

### Key Conventions (unchanged + new)
- `channelDivinity` and `ki` are optional fields — old characters with `{}` resources still valid
- `slots: Record<string, number>` is MAX slots per level; `slotsUsed: Record<string, number>` is used
- `avail = slots[key] - (slotsUsed[key] || 0)` — always compute availability this way
- Spell slot PUT sends full `spellcasting` object (shallow merge on server); only `slotsUsed` changes
- HP PUT sends just `{ currentHP }` — server merges, maxHP unchanged
- `request()` helper in server.test.ts now accepts GET/POST/PUT/DELETE
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
| PUT | `/api/characters/:id` | **Update (HP, slots, any field)** |
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

## NOT YET DONE — Priorities for Session 11

### 1. Set Level (down) for legacy chars (LOW)
- Currently 400 if no levelHistory. Could offer "rebuild from scratch + setlevel up" as alternative
- Approach: new endpoint or setlevel fallback — complex, deferred

### 2. Short rest HD: random vs average (NOTE)
- Currently uses deterministic average `floor(d/2)+1` for testability
- Future: could expose `{ hitDiceToSpend, rollMode: 'average'|'random' }` body param

### 3. Cantrip / spell list display (LOW)
- Spellcasting section shows cantrip COUNT but not cantrip NAMES
- Could expand to list known/prepared spell names with a toggle

### 4. Conditions tracker (MEDIUM — new idea)
- Track conditions on a character (Blinded, Charmed, Frightened, Grappled, etc.)
- `conditions?: string[]` field on CharacterSheet
- UI: checkboxes in detail view; PUT to persist

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 11 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | **67** |

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
git commit -m "Sheet-11: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
