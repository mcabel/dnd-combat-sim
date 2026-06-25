# zHANDOVER — Session 67

**Date:** 2026-06-25
**Agent:** Z.ai (autonomous — continued from Session 66 context)
**Focus:** Build the Monster Spell Coverage tracker (handover item #3 — LOW risk, HIGH value), refresh the spell cache to reflect all modules added since Session 50, and produce a prioritized backlog of unbuilt monster spells.

---

## Session Summary

This session knocked out handover item **#3: "Track + Prioritize Unbuilt Monster Spells"** (LOW risk, HIGH value). Built a new scanner (`scripts/scan_monster_spells.ts`) that walks every monster in `bestiaryData/` and cross-references each `monsterSpellcasting` spell name against the spell cache + the monster-only combat cantrip templates. Output is a markdown report (`docs/MONSTER-SPELL-COVERAGE.md`) ranking the 171 unbuilt spells by the number of distinct creatures that know them — gives future agents a data-driven priority list for which spell module to implement next.

As a side effect, running `npm run spell-cache:build` refreshed `spell-cache/INDEX.md` + `level-{0..9}.json` to reflect all spell modules added since Session 50 (the cache had been stale: 420 implemented vs the real 456). The refreshed cache is now the source of truth for "what's left to build" across both PC spell work and monster spellcasting Phase 2.

### What was done

1. **Added `listCantripTemplateNames()` export** to `src/ai/monster_spellcasting.ts`. The 17 combat cantrip templates live in `CANTRIP_TEMPLATES` (a private const) — the scanner needs the canonical names to mark those cantrips as implemented even when they aren't in the spell cache (the cache only tracks `src/spells/*.ts` modules).

2. **Wrote `scripts/scan_monster_spells.ts`** — the scanner:
   - Loads all 98 bestiary JSONs via `loadBestiaryDir('bestiaryData')`
   - Iterates every monster's 5etools `spellcasting` block (the raw `will` / `daily` / `spells` fields, NOT the parsed `monsterSpellcasting` struct — this is intentional because the parser already strips some annotations we want to count)
   - Strips `@spell` tags and parentheticals like `(self only)` / `(as an action)` so names match the cache
   - Builds a frequency map keyed by lowercased spell name
   - Marks a spell "implemented" if EITHER:
     - It appears in `spell-cache/level-*.json` with `implemented: true`, OR
     - It appears in `listCantripTemplateNames()` (the monster-only combat cantrips handled directly in `monster_spellcasting.ts`)
   - Sorts unbuilt spells by creature-count desc, then total-refs desc, then name
   - Writes a markdown report to `docs/MONSTER-SPELL-COVERAGE.md`
   - Also prints a console summary table

3. **Added `scan:monster-spells` npm script** to `package.json` so future agents can re-run the scanner with `npm run scan:monster-spells` (after implementing a new spell, regenerate the cache + scan to see the new coverage).

4. **Added 5 new tests** to `src/test/monster_spellcasting.test.ts` (1ae–1ai) verifying the new `listCantripTemplateNames()` export:
   - Returns exactly 17 names
   - Includes Fire Bolt and Lightning Lure
   - Excludes Mage Hand (utility cantrip)
   - Every listed name round-trips through `lookupCantripTemplate()`

5. **Refreshed the spell cache** by running `npm run spell-cache:build`. Updated files:
   - `spell-cache/INDEX.md` — header counts: 420 → 456 implemented, 124 → 88 remaining in-scope
   - `spell-cache/level-{0..9}.json` — `implemented`/`implementedModule` flags refreshed for ~36 newly-detected modules (Absorb Elements, Banishment, Conjure Animals, Conjure Elemental, Conjure Fey, Conjure Celestial, etc. — added in Sessions 51–65 but never cache-refreshed)

6. **All 113 monster_spellcasting tests pass** (was 108; +5 new).
7. **All other key test files pass unchanged** (vision_audio, combining_effects, pattern_bias, phase4, cantrip_planner, guiding_bolt, invisibility, sleep, creature_spellcasting_metadata, bestiary_integration, ai, concentration_enforcement, spell_effects, combat — 0 failures).

---

## Key Findings from the Coverage Report

The scan revealed much richer monster-spell data than the prior session-66 estimate of "945 monsters":

| Metric | Value |
|--------|-------|
| Total creatures in bestiary | **2,401** (was believed to be 945) |
| Creatures with `monsterSpellcasting` | **775** (32.3% of all creatures) |
| Total spell references (incl. duplicates) | 6,136 |
| Unique spells referenced | 454 |
| ├─ Already implemented | 283 (62.3%) |
| └─ NOT yet implemented | **171** (37.7%) |

### Top 20 Unbuilt Spells (priority targets for Monster Spellcasting Phase 2)

| Rank | Spell | # Creatures | Level | School |
|------|-------|-------------|-------|--------|
| 1 | Detect Magic | 179 | 1 | Divination |
| 2 | Plane Shift | 80 | 7 | Conjuration |
| 3 | Sending | 41 | 3 | Evocation |
| 4 | Teleport | 37 | 7 | Conjuration |
| 5 | Tongues | 36 | 3 | Divination |
| 6 | Detect Evil and Good | 34 | 1 | Divination |
| 7 | Protection from Evil and Good | 27 | 1 | Abjuration |
| 8 | Animate Dead | 24 | 3 | Necromancy |
| 9 | Revivify | 24 | 3 | Necromancy |
| 10 | Comprehend Languages | 23 | 1 | Divination |
| 11 | True Seeing | 20 | 6 | Divination |
| 12 | Wall of Force | 20 | 5 | Evocation |
| 13 | Divination | 19 | 4 | Divination |
| 14 | Clairvoyance | 18 | 3 | Divination |
| 15 | Dispel Evil and Good | 15 | 5 | Abjuration |
| 16 | Locate Object | 15 | 2 | Divination |
| 17 | Arcane Eye | 13 | 4 | Divination |
| 18 | Identify | 13 | 1 | Divination |
| 19 | Augury | 11 | 2 | Divination |
| 20 | Locate Creature | 11 | 4 | Divination |

**Observation:** The top ~20 unbuilt spells are dominated by **utility divinations** (Detect Magic, Detect Evil and Good, Identify, Clairvoyance, Arcane Eye, Augury, Divination, Locate Object/Creature, Tongues, Comprehend Languages, True Seeing, Sending). Most have no combat effect, so the monster-spellcasting AI would skip them under Doubt #1 (utility cantrip skipped). The most impactful combat-relevant unbuilt spells are:
- **Wall of Force** (L5, 20 creatures) — battlefield control
- **Animate Dead** (L3, 24 creatures) — summoning
- **Revivify** (L3, 24 creatures) — healing (only useful outside combat)
- **Plane Shift / Teleport** (L7, 80+37 creatures) — escape/repositioning

Full ranked list of all 171 unbuilt spells is in `docs/MONSTER-SPELL-COVERAGE.md`.

---

## Commits this session (1, pushed):

1. `TBD` — Session 67: monster spell coverage tracker + spell cache refresh

---

## Current State of Major RFCs

### RFC-COMBINING-EFFECTS — Phase 1-4 ALL DONE ✅ (unchanged from Session 66)

### RFC-VISION-AUDIO — Phase 1-3 ALL DONE ✅, Phase 4 DEFERRED (unchanged)

### RFC-PATTERN-BIAS-AI — Phase 1 DONE ✅, Phase 2 NOT STARTED (unchanged)

### RFC-MONSTER-SPELLCASTING — Phase 1 DONE, Phase 2 NOT STARTED

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: At-will + cantrip dispatch (17 cantrips) | ✅ DONE | Session 63; +5 listCantripTemplateNames tests this session |
| Phase 2: Slot-based spells (levels 1-9) | ⬜ NOT STARTED | Coverage report now provides prioritized backlog |
| Phase 3: Daily-use abilities (Recharge, Lair Actions) | ⬜ NOT STARTED | |

---

## Build Status

| Check | Status |
|-------|--------|
| All 113 monster_spellcasting tests | ✅ All pass (was 108; +5 new) |
| All 122 vision_audio tests | ✅ All pass |
| All 114 combining_effects tests | ✅ All pass |
| All 54 phase4 tests | ✅ All pass |
| All 51 guiding_bolt tests | ✅ All pass |
| All 81 invisibility tests | ✅ All pass |
| All 46 cantrip_planner tests | ✅ All pass |
| All 46 pattern_bias tests | ✅ All pass |
| All 35 sleep tests | ✅ All pass |
| All 16 creature_spellcasting_metadata tests | ✅ All pass |
| All 77 bestiary_integration tests | ✅ All pass |
| All 26 ai tests | ✅ All pass |
| All 34 concentration_enforcement tests | ✅ All pass |
| All 23 spell_effects tests | ✅ All pass |
| All 47 combat tests | ✅ All pass |
| `npm run scan:monster-spells` | ✅ Runs clean, produces `docs/MONSTER-SPELL-COVERAGE.md` |

---

## Key Architectural Decisions This Session

### Scanner reads RAW 5etools data, not the parsed `monsterSpellcasting` struct

The scanner deliberately iterates `raw.spellcasting[0].will` / `.daily` / `.spells` directly rather than walking the parsed `Combatant.monsterSpellcasting` field. Two reasons:
1. The parser already strips some annotations (like `(self only)` parentheticals) that we want to count as the same spell.
2. Spawning 2,401 Combatants just to read 3 string arrays would be ~10× slower and would couple the scanner to the parser's quirks. Reading the raw JSON is fast (one pass, ~2 seconds) and decoupled.

### "Implemented" determination

A spell is treated as implemented if EITHER:
- The spell cache marks it implemented (it has a `src/spells/<name>.ts` module registered in `_generic_registry.ts` OR has a dedicated `case '<camelCase>':` branch in `combat.ts`), OR
- It is one of the 17 monster-only combat cantrip templates in `CANTRIP_TEMPLATES` (these are handled directly by `monster_spellcasting.ts`'s `buildCantripAction()` and don't have their own `src/spells/` module).

The second case is necessary because the spell cache only tracks PHB/XGE/TCE/etc. spell modules, not the monster-only cantrip templates that the monster-spellcasting engine handles inline.

### Spell cache refresh is now part of the workflow

The committed `spell-cache/` files were 5 sessions stale (last regenerated Session 50). Going forward, any agent that adds a new spell module should run `npm run spell-cache:build` to refresh the cache, then `npm run scan:monster-spells` to update the coverage report. This keeps both views of "what's left to build" in sync with reality.

---

## Remaining Work (Priority Order)

### 1. Ready Action Implementation (MEDIUM-HIGH risk) — unchanged from Session 66
- **Currently a STUB** in `combat.ts` — the `case 'ready':` falls through to bardicInspiration.
- **User-specified behavior**: when no valid targets exist for a spell, the engine should pick a different action; fizzling ONLY occurs in ready-action edge cases (invisible trigger creature, end-of-round no-trigger, reaction consumed before trigger).
- **AI must weigh** whether it's worth using a reaction for something else when a ready action is already queued.
- **Components needed**: ready-action storage on Combatant (trigger + planned action), trigger resolution in combat loop, reaction conflict detection, fizzle handling.

### 2. Monster Spellcasting Phase 2 (MEDIUM-HIGH risk) — now informed by coverage report
- Wire `initMonsterSpellSlots()` at combat start
- Extend `selectMonsterSpell()` to iterate slots 1-9 + dispatch via GENERIC_SPELL_LIST
- Use `docs/MONSTER-SPELL-COVERAGE.md` to prioritize which leveled spells to wire first. Top combat-relevant targets:
  - **Wall of Force** (L5, 20 creatures) — battlefield control
  - **Animate Dead** (L3, 24 creatures) — summoning
  - **Plane Shift / Teleport** (L7, 80+37 creatures) — escape/repositioning
  - The 179-creature "Detect Magic" is a utility divination and would be skipped under Doubt #1 — low combat value.
- Pair with pattern-bias system for intelligent spell selection.

### 3. ✅ DONE this session — Track + Prioritize Unbuilt Monster Spells
- `scripts/scan_monster_spells.ts` + `docs/MONSTER-SPELL-COVERAGE.md` + `npm run scan:monster-spells`.

### 4. RFC-COMBINING-EFFECTS Phase 2 Remaining (MEDIUM risk) — unchanged
- Some non-concentration spell modules still need `sourceTurnExpires` populated
- Blindness/Deafness (1 min / 10 rounds), Hex (1 hr / 600 rounds), etc.

### 5. More Spells (Wall of Fire, etc.) — unchanged
- Per `docs/SPELL-DELEGATION-SPEC.md`
- Session 50 stubs exist for Fog Cloud, Darkness (spell version), Scrying
- Use the refreshed `spell-cache/INDEX.md` "Next 5 unimplemented" lists per level to pick the next batch.

### 6. RFC-VISION-AUDIO Phase 4 (DEFERRED — HIGH risk) — unchanged
- Per-cell light sources (torches, light spell, magical darkness)
- Fog cloud / Darkness spell as mobile obscurement zones
- Line-of-effect check for blindsight (penetrate fog walls)
- Defer until Phase 1-3 stable (they are now stable).

### 7. Creature Megabatch Batches 4d/4e (Creature workstream) — unchanged
- See TASK.md for full breakdown.

---

## Key Files for Next Agent

### New this session
- **`scripts/scan_monster_spells.ts`** — the coverage scanner. Run with `npm run scan:monster-spells`. Reads `bestiaryData/` + `spell-cache/` + `listCantripTemplateNames()` and writes `docs/MONSTER-SPELL-COVERAGE.md`.
- **`docs/MONSTER-SPELL-COVERAGE.md`** — the prioritized backlog of 171 unbuilt monster spells, ranked by creature count. **Read this first when starting Monster Spellcasting Phase 2.**

### Refreshed this session
- **`spell-cache/INDEX.md`** + **`spell-cache/level-{0..9}.json`** — now reflects all 456 implemented spells (was stale at 420 since Session 50). Per-level "Next 5 unimplemented" lists are now accurate.

### Modified this session
- **`src/ai/monster_spellcasting.ts`** — added `listCantripTemplateNames()` export (1 new function, ~12 lines)
- **`src/test/monster_spellcasting.test.ts`** — added 5 tests (1ae–1ai) for `listCantripTemplateNames()`
- **`package.json`** — added `scan:monster-spells` npm script

### Core Engine (unchanged from Session 66 — listed for reference)
- **`src/engine/perception.ts`** — perception subsystem; `SPELLS_REQUIRING_VISIBLE_TARGET`, `requiresVisibleTarget()`, `canTargetWithSpell()`, `countVisiblyDetectedEnemies()`
- **`src/engine/effect_pipeline.ts`** — `_rederiveConditions()` with source-tracked condition map
- **`src/engine/spell_effects.ts`** — `_addConditionSource()` / `_removeConditionSource()` helpers
- **`src/engine/utils.ts`** — `attackAdvantageState(bf?)` uses detection map; `addCondition()` / `removeCondition()` with source tracking; `_concentrationAutoBroken` flag
- **`src/engine/combat.ts`** — `checkDeath()` handles concentration auto-break; ready action STUB at `case 'ready':`
- **`src/ai/planner.ts`** — Q5 filtering: skips visible-target spells when no visible enemy
- **`src/ai/monster_spellcasting.ts`** — `findBestCantripTarget(requiresVisible)` with legacy fallback; `listCantripTemplateNames()` new this session

### RFCs (unchanged)
- **`docs/RFC-VISION-AUDIO.md`** — Phase 1-3 done; Phase 4 deferred
- **`docs/RFC-COMBINING-EFFECTS.md`** — Phase 1-4 done
- **`docs/RFC-PATTERN-BIAS-AI.md`** — Phase 1 done; Phase 2 not started
- **`docs/RFC-MONSTER-SPELLCASTING.md`** — Phase 1 done; Phase 2-3 not started

---

## Uncommitted Changes

None — all substantive work is committed and pushed. (No cosmetic file-mode artifacts this session — the working tree is clean.)
