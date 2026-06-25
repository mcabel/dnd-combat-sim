# zHANDOVER — Session 66

**Date:** 2026-06-25
**Agent:** Z.ai (autonomous — continued from Session 64/65 context)
**Focus:** Complete RFC-VISION-AUDIO Phase 3 Q5 planner filtering + commit + handover.

---

## Session Summary

This session finished the **RFC-VISION-AUDIO Phase 3 Q5** planner filtering feature that was left uncommitted from the previous session. The core issue was that `findBestCantripTarget` in `monster_spellcasting.ts` would skip ALL enemies when the new `requiresVisible` parameter was true but combatants lacked a `perception.detection` map (legacy test factories). Fixed with a condition-based fallback, committed, and pushed.

### What was done

1. **Diagnosed the 2 test failures** in `monster_spellcasting.test.ts` (tests 10a and 17b):
   - Root cause: `findBestCantripTarget(self, bf, range, requiresVisible=true)` skipped enemies whose `detection` was `undefined` (legacy combatants without perception maps). The condition `detection !== 'visible'` evaluated true when `detection` was `undefined`, filtering out every enemy.
   - This meant the Mage couldn't find a target for Fire Bolt (which requires a visible target per `SPELLS_REQUIRING_VISIBLE_TARGET`).

2. **Fixed with legacy fallback** in `findBestCantripTarget` (`src/ai/monster_spellcasting.ts`):
   ```typescript
   if (requiresVisible) {
     if (detection === undefined) {
       // Legacy combatant — fall back to condition check
       if (c.conditions.has('hidden') || c.conditions.has('invisible')) continue;
     } else if (detection !== 'visible') {
       continue;
     }
   }
   ```
   - Matches the same pattern used in `countVisiblyDetectedEnemies()` in `perception.ts`.

3. **All 108 monster_spellcasting tests pass** (was 101 passed, 2 failed).
4. **All 122 vision_audio tests pass** (unchanged).
5. **Committed and pushed** as `0af4b8d`.

---

## Commits this session (1, pushed):

1. `0af4b8d` — RFC-VISION-AUDIO Phase 3 Q5: planner visible-target filtering

---

## Current State of Major RFCs

### RFC-COMBINING-EFFECTS — Phase 1-4 ALL DONE ✅

| Phase | Status | Commit |
|-------|--------|--------|
| Phase 1: Priority-activation pipeline | ✅ DONE | `deb5462` (Session 64) |
| Phase 2: sourceTurnExpires expiry | ✅ DONE | `aae63a1` (Session 65) |
| Phase 3: Takeover-on-expiry tests | ✅ DONE | `aae63a1` (Session 65) |
| Phase 4: Source-tracked condition map | ✅ DONE | `5a99a53` (Session 65) |

### RFC-VISION-AUDIO — Phase 1-3 ALL DONE ✅

| Phase | Status | Key commit(s) |
|-------|--------|---------------|
| Phase 1: Detection model (4-state) + Hide + sound + active Perception | ✅ DONE | Sessions 60-62 |
| Phase 2: Vision modes (darkvision/blindsight/truesight/tremorsense) | ✅ DONE | Session 63 |
| Phase 3 Q1-Q3: OA visibility gating, See Invisibility, Devil's Sight | ✅ DONE | `2087842` |
| Phase 3 Q4: Detection-map advantage (attackAdvantageState uses bf) | ✅ DONE | `2087842` |
| Phase 3 Q5: "Creature you can see" spell enforcement + planner filtering | ✅ DONE | `0af4b8d` |
| Phase 4: Terrain + obscurement integration | ⬜ DEFERRED | — |

### RFC-PATTERN-BIAS-AI — Phase 1 DONE ✅

| Phase | Status | Commit |
|-------|--------|--------|
| Phase 1: 8 pattern detectors + composition formula | ✅ DONE | `b9a9d69` (Session 65) |
| Phase 2: Monster Spellcasting Phase 2 integration | ⬜ NOT STARTED | — |

### RFC-MONSTER-SPELLCASTING — Phase 1 DONE, Phase 2 NOT STARTED

| Phase | Status | Commit |
|-------|--------|--------|
| Phase 1: At-will + cantrip dispatch (17 cantrips) | ✅ DONE | Session 63 |
| Phase 2: Slot-based spells (levels 1-9) | ⬜ NOT STARTED | — |
| Phase 3: Daily-use abilities (Recharge, Lair Actions) | ⬜ NOT STARTED | — |

---

## Build Status

| Check | Status |
|-------|--------|
| All 108 monster_spellcasting tests | ✅ All pass |
| All 122 vision_audio tests | ✅ All pass |
| All 114 combining_effects tests | ✅ All pass |
| All 54 phase4 tests | ✅ All pass |
| All 51 guiding_bolt tests | ✅ All pass |
| All 81 invisibility tests | ✅ All pass |
| All 46 cantrip_planner tests | ✅ All pass |
| All 46 pattern_bias tests | ✅ All pass |
| All 35 sleep tests | ✅ All pass |
| combat / spell_effects / concentration_enforcement | ✅ All pass |
| Broader suite (12 key test files, ~750+ assertions) | ✅ 0 failures |

---

## Key Architectural Decisions This Session

### Legacy fallback for visible-target gating

When `findBestCantripTarget` is called with `requiresVisible=true` and a combatant has no `perception.detection` map (legacy test factory or old codepath), the function now falls back to checking `!c.conditions.has('hidden') && !c.conditions.has('invisible')`. This mirrors the same fallback pattern in `countVisiblyDetectedEnemies()`. Without this fallback, ALL enemies would be filtered out for legacy combatants, breaking backward compatibility.

---

## Remaining Work (Priority Order)

### 1. Ready Action Implementation (MEDIUM-HIGH risk)
- **Currently a STUB** in `combat.ts` — the `case 'ready':` falls through to bardicInspiration.
- **User-specified behavior**:
  - When no valid targets exist for a spell, the engine should pick a different action (different spell, attack, dash, dodge, disengage, ready). Spells should NOT fizzle just because targets are invalid — the planner should not select them.
  - Fizzling ONLY occurs in ready-action edge cases:
    1. Ready action to cast a spell with "a creature you can see", but the creature that triggers is invisible → spell fizzles.
    2. End of round if trigger never occurs → ready action is wasted.
    3. Reaction consumed before trigger (opportunity attack, Shield, etc.) → ready action fizzles.
  - **AI must weigh** whether it's worth using a reaction for something else when a ready action is already queued.
- **Components needed**:
  - Ready-action storage on Combatant (trigger condition + planned action)
  - Trigger resolution in the combat loop
  - Reaction conflict detection (ready action vs opportunity attack vs Shield)
  - Fizzle handling (invisible target, no trigger, reaction consumed)

### 2. Monster Spellcasting Phase 2 (MEDIUM-HIGH risk)
- Wire `initMonsterSpellSlots()` at combat start
- Extend `selectMonsterSpell()` to iterate slots 1-9 + dispatch via GENERIC_SPELL_LIST
- ~600 creatures need their spell slots populated
- Pair with pattern-bias system for intelligent spell selection

### 3. Track + Prioritize Unbuilt Monster Spells (LOW risk, HIGH value)
- Build a script that scans all 945 monsters' `monsterSpellcasting`
- Report unbuilt spell names sorted by frequency
- Guides which spell modules to implement next

### 4. RFC-COMBINING-EFFECTS Phase 2 Remaining (MEDIUM risk)
- Some non-concentration spell modules still need `sourceTurnExpires` populated
- Blindness/Deafness (1 min / 10 rounds), Hex (1 hr / 600 rounds), etc.

### 5. More Spells (Wall of Fire, etc.)
- Per `docs/SPELL-DELEGATION-SPEC.md`
- Session 50 stubs exist for Fog Cloud, Darkness (spell version), Scrying

### 6. RFC-VISION-AUDIO Phase 4 (DEFERRED — HIGH risk)
- Per-cell light sources (torches, light spell, magical darkness)
- Fog cloud / Darkness spell as mobile obscurement zones
- Line-of-effect check for blindsight (penetrate fog walls)
- **Defer until Phase 1-3 stable** (they are now stable)

### 7. Creature Megabatch Batches 4d/4e (Creature workstream)
- See TASK.md for full breakdown

---

## Key Files for Next Agent

### Core Engine (recently changed)
- **`src/engine/perception.ts`** — perception subsystem; `SPELLS_REQUIRING_VISIBLE_TARGET` (70+ spells), `requiresVisibleTarget()`, `canTargetWithSpell()`, `countVisiblyDetectedEnemies()`
- **`src/engine/effect_pipeline.ts`** — `_rederiveConditions()` with source-tracked condition map
- **`src/engine/spell_effects.ts`** — `_addConditionSource()` / `_removeConditionSource()` helpers
- **`src/engine/utils.ts`** — `attackAdvantageState(bf?)` uses detection map; `addCondition()` / `removeCondition()` with source tracking; `_concentrationAutoBroken` flag
- **`src/engine/combat.ts`** — `checkDeath()` handles concentration auto-break; ready action STUB at `case 'ready':`
- **`src/ai/planner.ts`** — Q5 filtering: skips visible-target spells when no visible enemy
- **`src/ai/monster_spellcasting.ts`** — `findBestCantripTarget(requiresVisible)` with legacy fallback

### Type System
- **`src/types/core.ts`** — `_conditionSources: Map<Condition, Set<sourceId>>` (replaced `_nonspecllConditions`)

### Test Files (all passing)
- **`src/test/vision_audio.test.ts`** — 122 tests covering Phase 1-3
- **`src/test/monster_spellcasting.test.ts`** — 108 tests covering Phase 1 cantrip dispatch
- **`src/test/combining_effects.test.ts`** — 114 tests covering priority activation
- **`src/test/phase4.test.ts`** — 54 tests covering source-tracked conditions

### RFCs
- **`docs/RFC-VISION-AUDIO.md`** — Phase 1-3 done; Phase 4 deferred
- **`docs/RFC-COMBINING-EFFECTS.md`** — Phase 1-4 done
- **`docs/RFC-PATTERN-BIAS-AI.md`** — Phase 1 done; Phase 2 not started
- **`docs/RFC-MONSTER-SPELLCASTING.md`** — Phase 1 done; Phase 2-3 not started

---

## Uncommitted Changes (cosmetic only)

There are file-mode changes (644 → 755) across many files in the working tree. These are cosmetic artifacts from the container filesystem and have no functional impact. The substantive Q5 code changes are committed and pushed.
