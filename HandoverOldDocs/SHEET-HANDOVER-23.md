# SHEET-HANDOVER-23
# Character Sheet & Party System — Session 23 Start

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

- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `0a51e74`)
- **Tests:**
  - character_storage: 74
  - character_builder: 82
  - character_leveler: 161
  - character_improvements: 51
  - server.test: 108  ← +2 (PUT pact slot use/restore tests)
  - All 0 failures across all suites
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 22

### Observation: HP Tracker Already Complete
- Task #5 from prior handover was already fully implemented:
  - `#hp-cur-input` direct editable field (blur → `setHPDirect`)
  - `#hp-amt` stepper with `−Dmg` / `+Heal` buttons (`applyHPAmt('dmg'|'heal')`)
  - No work needed

### Clickable Pact Slot Pips (COMPLETE)
- Pact slot pips now use same interactive pattern as regular spell slot pips
- Filled pip (available) → `usePactSlot()` on click; empty pip (used) → `restorePactSlot()` on click
- Non-actionable pips: `cursor:default`, no onclick (avail=0 for filled, used=0 for empty)
- Pip size bumped 8px → 10px to match regular slots
- `Use` and `↩` buttons added to pact row (mirroring regular slot rows)
- `usePactSlot()`: PUTs `spellcasting: { ...spl, pactSlots: { ...ps, used: ps.used + 1 } }`
- `restorePactSlot()`: PUTs `spellcasting: { ...spl, pactSlots: { ...ps, used: ps.used - 1 } }`
- 2 new server tests added: PUT use pact slot, PUT restore pact slot

---

## Architecture (unchanged)

```
CharacterSheet (JSON)
  ↕ leveler.ts (applyLevelUp)  → pushes LevelRecord to levelHistory[]
  ↕ leveler.ts (popLevel)      → pops top LevelRecord, reverses all deltas
  ↕ improvements.ts (applyASI) → consumes pendingASI; updates stats
  ↕ character_router.ts        → /shortrest, /longrest, /leveldown, /setlevel, /equip, etc.
  ↕ PUT /api/characters/:id    → currentHP, temporaryHP, exhaustionLevel, conditions,
                                   spellcasting.slotsUsed, notes, gold, equipment,
                                   deathSaves, inspiration, concentrating, resources (shallow merge)
```

### Key Conventions
- `channelDivinity` and `ki` are optional fields — old characters with `{}` resources still valid
- `slots: Record<string, number>` is MAX slots per level; `slotsUsed: Record<string, number>` is used
- `avail = slots[key] - (slotsUsed[key] || 0)` — always compute availability this way
- Spell slot PUT sends full `spellcasting` object (shallow merge on server); only `slotsUsed` changes
- **Pact slot PUT** sends `spellcasting: { ...spl, pactSlots: { ...ps, used: N } }` — full spellcasting obj
- **Resource PUT sends full `resources` object** — shallow merge replaces top-level key; always spread `...res, [key]: { ...entry, [field]: next }`
- HP PUT sends just `{ currentHP }` — server merges, maxHP unchanged
- `conditions?: string[]` — optional, backward compat; PUT sends full array; custom strings allowed
- `temporaryHP`: THP doesn't stack — always `Math.max(current, new)` in UI; server just stores value
- `exhaustionLevel`: 0–6; UI clamps before PUT
- `notes?: string` — optional, backward compat; PUT sends `{ notes: '' }` to clear
- `showBanner(msg, type)` supports `'ok'` (green) and `'error'` (red) only — NOT `'info'`
- `request()` helper in server.test.ts accepts GET/POST/PUT/DELETE
- `levelHistory?: LevelRecord[]` — always initialize to `[]` in new test factories
- `popLevel()` throws on empty history — caller should check before calling
- `resetPaladin()` in server.test.ts resets `levelHistory: []`
- **Equipment**: `equipment: EquipmentItem[]` and `gold: number`
- **Short rest rollMode**: `'average' | 'random'`; UI state in `_srMode` var
- **UUID test IDs**: must match UUID regex — use `00000000-0000-0000-0000-00000000000N`
- **Test file cleanup**: `fs.unlinkSync(...)` in test body (not finally)
- **`renderDetail()` is NOT a function** — always use `renderCharDetail()`
- **`prompt()` is gone** — zero calls in characters.html; all input is inline UI
- **HP color**: dynamic per `hpPct`; re-applied on every `renderCharDetail()` call
- **`buildResourceLines` returns HTML** — do NOT wrap in extra div; caller uses `(resLines ? resLines : '')`
- **Custom conditions**: `toggleCondition(name)` handles any string; `addCustomCondition(charId)` reads text input
- **Party member list**: includes `↗` view button, concentration/condition badges, party HP summary bar
- **xpOverride**: `POST /api/parties/:id/awardxp` accepts `{ xpOverride: number }` for direct XP award
- **pactSlots**: `{ slotLevel, total, used }` on `spellcasting`; PUT full spellcasting obj with updated `pactSlots`

---

## API Endpoints (all live)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/characters` | List all |
| POST | `/api/characters` | Create (201) |
| GET | `/api/characters/:id` | Get full sheet |
| PUT | `/api/characters/:id` | **Update (HP, THP, exhaustion, conditions, slots, pactSlots, notes, gold, equipment, deathSaves, inspiration, concentrating, resources, any field)** |
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
| POST | `/api/parties/:id/awardxp` | Award XP — body: `{ enemies }` OR `{ xpOverride: number }` |
| POST | `/api/simulate/custom` | Run sim with saved chars |

---

## NOT YET DONE — Priorities for Session 23

### 1. Set Level (down) for legacy chars (LOW/DEFERRED)
- Currently returns 400 if no `levelHistory`
- Complex: rebuild HP/features from scratch by fast-forwarding applyLevelUp N times
- Deferred — skip unless explicitly requested

### 2. Any new features requested by user

---

## Combat Agent Coordination Notes

- **Do NOT modify:** `src/engine/*`, `src/ai/*`, `src/spells/*`, `src/parser/*`, `src/data/*`
- `src/types/core.ts`: avoid unless optional field only
- `src/characters/*`: Sheet workstream owns this directory
- `src/character_router.ts`: Sheet workstream owns this file

---

## Test Baseline (Sheet Session 23 start)

| Suite | Count |
|-------|-------|
| character_improvements.test.ts | 51 |
| character_leveler.test.ts | 161 |
| character_builder.test.ts | 82 |
| character_storage.test.ts | 74 |
| server.test.ts | 108 |

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
git commit -m "Sheet-23: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main 2>&1
git ls-remote https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD
```
