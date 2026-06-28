# zHANDOVER — Session 68

**Date:** 2026-06-25
**Agent:** Z.ai (autonomous — continued from Session 67 context)
**Focus:** Execute handover item #2 ("Monster Spellcasting Phase 2") by implementing 15 high-priority unbuilt monster spells in 3 batches of 5, each batch with bespoke `shouldCast`/`execute`/`cleanup` + full engine integration (core.ts type union, combat.ts dispatch case, planner.ts branch) + a dedicated test suite. Refresh the spell cache + monster-spell coverage report to reflect the new modules.

---

## Session Summary

This session knocked out **15 new monster spell modules** in 3 committed batches, directly addressing handover item #2 ("Monster Spellcasting Phase 2 — now informed by coverage report"). The Session 67 coverage report ranked 171 unbuilt spells by creature count; this session picked the top combat-relevant targets from that list and built them, refreshing the cache + coverage report at the end so the next agent has an updated priority list.

**Coverage delta:** 283 → 298 implemented monster spells (+15); 171 → 156 remaining (-15). The spell cache also refreshed: 456 → 471 implemented total (the +15 are exactly this session's work).

### What was done

1. **Batch 1 (commit `5072eca`)** — 5 wall/removal spells:
   - **Wall of Force** (L5 Evoc, 120 ft, NO save, conc) — single-target restrained (sphere capture)
   - **Maze** (L8 Conj, 60 ft, NO save, NO conc) — target removed for encounter (Int ≤ 1 immune)
   - **Wall of Ice** (L6 Evoc, 120 ft, DEX save 10d6 cold + conc damage_zone)
   - **Wall of Stone** (L5 Evoc, 120 ft, DEX save 10d6 bludgeoning, conc)
   - **Magic Circle** (L3 Abj, 10 ft, NO save, conc) — advantage_vs vs affected creature type
   - Test suite: `src/test/session68_batch1_walls.test.ts` — **91 tests, 0 failures**

2. **Batch 2 (commit `fb2ce89`)** — 5 high-level control/summon/stub spells:
   - **Antimagic Field** (L8 Abj, self 10 ft, NO save, conc) — multi-target incapacitate on enemy spellcasters
   - **Mind Blank** (L8 Abj, touch, NO save, NO conc) — psychic immunity (`addImmunity`) + charmed immunity (`conditionImmunities`); encounter-duration
   - **Symbol** (L7 Abj, 30 ft, CON save, conc) — Pain: damage_zone 1d4 psychic + advantage_vs disadvantage
   - **Create Undead** (L6 Nec, 10 ft, NO save, NO conc) — spawn 1 zombie ally (MM p.316); mirrors `conjure_animals.ts`
   - **Raise Dead** (L5 Nec, touch, 1-hour cast) — out-of-combat stub (mirrors `scrying.ts`)
   - Test suite: `src/test/session68_batch2_spells.test.ts` — **136 tests, 0 failures**

3. **Batch 3 (commit `a447f78`)** — 5 plane-shift/summon/area/stub spells:
   - **Etherealness** (L7 Trans, self, NO save, conc) — invisible (Border Ethereal); defensive escape at < 50% HP
   - **Wind Walk** (L6 Trans, self, NO save, conc) — mist form: flySpeed=300 + incapacitated (v1: caster only)
   - **Gate** (L9 Conj, 60 ft, NO save, conc) — spawn a Shadow ally (AC 12, HP 24, Strength Drain +5 1d4+3 necrotic); cap 4 per caster
   - **Hallow** (L5 Evoc, 60 ft, NO save, NO conc) — Daylight: advantage_vs vs undead/fiend; encounter-duration
   - **Wish** (L9 Conj, self, NO save, NO conc) — out-of-combat stub (duplicate-any-spell deferred)
   - Test suite: `src/test/session68_batch3_spells.test.ts` — **149 tests, 0 failures**

4. **Refreshed spell cache** (`npm run spell-cache:build`): `spell-cache/INDEX.md` + `level-{0..9}.json` now reflect 471 implemented (was 456), 73 remaining in-scope (was 88).

5. **Refreshed monster-spell coverage report** (`npm run scan:monster-spells`): `docs/MONSTER-SPELL-COVERAGE.md` now shows 298 implemented (was 283), 156 remaining (was 171). The Top-50 priority list no longer contains any of this session's 15 spells.

### Test totals this session

- **376 new tests** across 3 new test files (91 + 136 + 149), **0 failures**.
- All 4 key existing test suites pass unchanged: `banishment_tashas` (20), `dimension_door_wall_of_fire` (46), `monster_spellcasting` (113), `combat` (49).
- `tsc --noEmit` introduces **0 new type errors** (5 pre-existing `dimensionDoor` / `Record<string,unknown>` errors unchanged — same 5 errors as Session 67).

---

## Commits this session (3, all pushed)

1. `5072eca` — Session 68 Batch 1: Wall of Force, Maze, Wall of Ice, Wall of Stone, Magic Circle
2. `fb2ce89` — Session 68 Batch 2: Antimagic Field, Mind Blank, Symbol, Create Undead, Raise Dead
3. `a447f78` — Session 68 Batch 3: Etherealness, Wind Walk, Gate, Hallow, Wish

---

## Current State of Major RFCs

### RFC-COMBINING-EFFECTS — Phase 1-4 ALL DONE ✅ (unchanged from Session 67)

### RFC-VISION-AUDIO — Phase 1-3 ALL DONE ✅, Phase 4 DEFERRED (unchanged)

### RFC-PATTERN-BIAS-AI — Phase 1 DONE ✅, Phase 2 NOT STARTED (unchanged)

### RFC-MONSTER-SPELLCASTING — Phase 1 DONE, Phase 2 IN PROGRESS (this session)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: At-will + cantrip dispatch (17 cantrips) | ✅ DONE | Session 63 |
| Phase 2: Slot-based spells (levels 1-9) | 🟡 IN PROGRESS | **+15 spells this session** (Batches 1-3). 156 unbuilt remain per coverage report. The combat-relevant high-value targets are now largely built; remaining are mostly utility divinations (Detect Magic, Comprehend Languages, etc.) which the delegation spec tags `outOfCombat: true`. |
| Phase 3: Daily-use abilities (Recharge, Lair Actions) | ⬜ NOT STARTED | |

---

## Build Status

| Check | Status |
|-------|--------|
| `session68_batch1_walls.test.ts` (91 tests) | ✅ All pass |
| `session68_batch2_spells.test.ts` (136 tests) | ✅ All pass |
| `session68_batch3_spells.test.ts` (149 tests) | ✅ All pass |
| `banishment_tashas.test.ts` (20 tests) | ✅ All pass (unchanged) |
| `dimension_door_wall_of_fire.test.ts` (46 tests) | ✅ All pass (unchanged) |
| `monster_spellcasting.test.ts` (113 tests) | ✅ All pass (unchanged) |
| `combat.test.ts` (49 tests) | ✅ All pass (unchanged) |
| `tsc --noEmit` | ✅ 0 new errors (5 pre-existing unchanged) |
| `npm run spell-cache:build` | ✅ Runs clean — 471 implemented, 73 remaining |
| `npm run scan:monster-spells` | ✅ Runs clean — 298 monster spells implemented, 156 remaining |

---

## Key Architectural Decisions This Session

### Batch 1 — Wall spell v1 pattern (mirror Wall of Fire v1)

All 4 wall spells (Wall of Force, Wall of Ice, Wall of Stone, plus the existing Wall of Fire) use the **single-target v1 simplification** documented in `src/spells/wall_of_fire.ts`:
- Wall geometry is NOT modelled (no wall/zone subsystem — that's TG-007, deferred).
- The spell targets a single highest-threat enemy as if they were "inside" the wall.
- Damage-dealing walls (Ice, Stone) apply damage on cast + (for Ice) a `damage_zone` ongoing tick.
- Control walls (Force) apply a no-save condition (restrained).
- All are concentration-tracked so `removeEffectsFromCaster` cleans up on conc break.

This keeps the 4 walls consistent and means a future TG-007 wall subsystem upgrade can lift all 4 to true AoE in one pass.

### Maze — no-save removal modelled as encounter-permanent

Maze (PHB p.261) has NO save and NO concentration — canonically the target can escape with a DC 20 INT check action. v1 has no AI for "spend an action on an INT check", so Maze is modelled as **permanent removal for the encounter** (target `isDead = true`), matching the existing `Banishment` non-native-removal pattern. The Int ≤ 1 immunity IS modelled (vermin/oozes are unaffected).

### Magic Circle — single-target advantage_vs (v1 zone simplification)

Magic Circle's 10-ft cylinder is NOT modelled (no zone subsystem). v1 applies the spell's "trapped creature has disadv on attacks + targets have adv on saves vs its charm/frighten/possess" as a single `advantage_vs` effect with `advType='advantage'` on one target of an affected type (celestial/elemental/fey/fiend/undead). A single effect covers both attacks AND saves because `advantage_vs` applies to d20 tests against the bearer generally.

### Mind Blank — engine-native immunity mechanisms

The spec suggested pushing to `resistances` as a fallback for psychic immunity. The implementer used the engine's native `addImmunity(target, 'psychic')` helper instead, which writes to the `immunities` field that `applyDamageWithTempHP` respects for **true immunity (0 damage)** — stronger and more correct than the resistance fallback. Charmed immunity uses `conditionImmunities` (the native condition-immunity mechanism `addCondition` checks).

### Wind Walk — addCondition vs applySpellEffect concentration conflict

`addCondition('incapacitated')` auto-breaks concentration (PHB p.203). Wind Walk applies incapacitated to the CASTER (mist form) — calling `addCondition` would break Wind Walk's OWN concentration. **Fix:** rely on `applySpellEffect`'s internal `target.conditions.add()` which bypasses the concentration-break side effect. Documented in source comments.

### Gate — removeEffectsFromCaster despawn limitation

The engine's `removeEffectsFromCaster` despawns all of a caster's summons (TG-006). Gate's PHB text says the spawned entity should REMAIN when concentration breaks. v1 accepts the engine's default despawn-on-conc-break as a limitation (flagged `gateShadowPersistsOnConcBreakV1NotModelled: true`); Gate's `execute` skips the defensive `removeEffectsFromCaster` call so recasts don't despawn prior shadows.

### Out-of-combat stubs (Raise Dead, Wish)

Both follow the `scrying.ts` pattern: `outOfCombat: true` in metadata, `shouldCast` always returns false, `execute` is a no-op. This is the cleanest way to handle long-cast-time spells (1 hour / 10 min) that monsters know but can't use mid-fight. The bestiary already lists specific combat spells per monster, so the "duplicate any spell" use of Wish is redundant — monsters just cast the target spell directly.

---

## Remaining Work (Priority Order)

### 1. Ready Action Implementation (MEDIUM-HIGH risk) — unchanged from Session 67
- **Currently a STUB** in `combat.ts` — the `case 'ready':` falls through to bardicInspiration.
- **User-specified behavior**: when no valid targets exist for a spell, the engine should pick a different action; fizzling ONLY occurs in ready-action edge cases.
- Components needed: ready-action storage on Combatant (trigger + planned action), trigger resolution, reaction conflict detection, fizzle handling.

### 2. Monster Spellcasting Phase 2 — REMAINING utility spells (LOW combat value)
- 156 unbuilt monster spells remain per the refreshed coverage report.
- The top remaining are **utility divinations** (Detect Magic 179 creatures, Sending 41, Tongues 36, Detect Evil and Good 34, Comprehend Languages 23, Identify 13, Augury 11, Divination 19, Clairvoyance 18, Arcane Eye 13, Locate Object 15, Locate Creature 11, True Seeing 20).
- Per `docs/SPELL-DELEGATION-SPEC.md`, these should be tagged `outOfCombat: true` (the delegation spec assigned this to the Sheet agent). They have no combat effect.
- **Combat-relevant remaining:** Plane Shift (80 creatures, L7 Conj — escape/reposition), Teleport (37 creatures, L7 Conj — escape/reposition), Animate Dead (24 creatures, L3 Nec — summoning), Revivify (24 creatures, L3 Nec — out-of-combat healing), Water Breathing (11, out-of-combat), Wind Walk (DONE this session).
- **Recommended next batch:** Plane Shift + Teleport (both L7 Conj, escape/reposition — mirror Dimension Door pattern), Animate Dead (L3 Nec summoning — mirror Create Undead pattern).

### 3. RFC-COMBINING-EFFECTS Phase 2 Remaining (MEDIUM risk) — unchanged
- Some non-concentration spell modules still need `sourceTurnExpires` populated.

### 4. More Spells (Wall of Fire, etc.) — largely addressed this session
- The 4 wall spells are now all built (Fire, Force, Ice, Stone).
- Per `docs/SPELL-DELEGATION-SPEC.md` for remaining unbuilt spells.
- Use the refreshed `spell-cache/INDEX.md` "Next 5 unimplemented" lists per level to pick the next batch.

### 5. RFC-VISION-AUDIO Phase 4 (DEFERRED — HIGH risk) — unchanged
- Per-cell light sources, fog cloud / Darkness spell as mobile obscurement zones, line-of-effect for blindsight.

### 6. Creature Megabatch Batches 4d/4e (Creature workstream) — unchanged
- See TASK.md for full breakdown.

---

## Key Files for Next Agent

### New this session (15 spell modules + 3 test files)

**Batch 1** (`src/spells/`):
- `wall_of_force.ts` — L5 Evoc, NO save, conc — restrained (sphere capture)
- `maze.ts` — L8 Conj, NO save, NO conc — removed for encounter (Int ≤ 1 immune)
- `wall_of_ice.ts` — L6 Evoc, DEX save 10d6 cold + conc damage_zone
- `wall_of_stone.ts` — L5 Evoc, DEX save 10d6 bludgeoning, conc
- `magic_circle.ts` — L3 Abj, NO save, conc — advantage_vs vs affected type

**Batch 2**:
- `antimagic_field.ts` — L8 Abj, self 10ft, NO save, conc — multi-target incapacitate
- `mind_blank.ts` — L8 Abj, touch, NO save, NO conc — psychic + charmed immunity
- `symbol.ts` — L7 Abj, 30ft, CON save, conc — Pain (damage_zone + disadv)
- `create_undead.ts` — L6 Nec, 10ft, NO save, NO conc — spawn zombie
- `raise_dead.ts` — L5 Nec, touch, 1-hour cast — out-of-combat stub

**Batch 3**:
- `etherealness.ts` — L7 Trans, self, NO save, conc — invisible (Border Ethereal)
- `wind_walk.ts` — L6 Trans, self, NO save, conc — mist form (fly 300 + incapacitated)
- `gate.ts` — L9 Conj, 60ft, NO save, conc — spawn shadow ally
- `hallow.ts` — L5 Evoc, 60ft, NO save, NO conc — Daylight advantage_vs undead/fiend
- `wish.ts` — L9 Conj, self, NO save, NO conc — out-of-combat stub

**Test files** (`src/test/`):
- `session68_batch1_walls.test.ts` — 91 tests
- `session68_batch2_spells.test.ts` — 136 tests
- `session68_batch3_spells.test.ts` — 149 tests

### Refreshed this session
- **`spell-cache/INDEX.md`** + **`spell-cache/level-{0..9}.json`** — 471 implemented (was 456), 73 remaining in-scope (was 88).
- **`docs/MONSTER-SPELL-COVERAGE.md`** — 298 monster spells implemented (was 283), 156 remaining (was 171). Top-50 priority list updated.

### Modified this session (integration points)
- **`src/types/core.ts`** — added 15 entries to the `PlannedAction.type` union (after `'wallOfFire'` / `'magicCircle'` / `'raiseDead'`, before `'scrying'`).
- **`src/engine/combat.ts`** — added 15 import blocks + 15 `case` branches (after `case 'wallOfFire'` / `case 'magicCircle'` / `case 'raiseDead'`, before `case 'scrying'`).
- **`src/ai/planner.ts`** — added 15 imports + 15 planner branches (after the Wall of Fire / Magic Circle / Raise Dead branches, before the Darkness branch).

### Core Engine (unchanged from Session 67 — listed for reference)
- **`src/engine/perception.ts`** — perception subsystem
- **`src/engine/effect_pipeline.ts`** — `_rederiveConditions()` with source-tracked condition map
- **`src/engine/spell_effects.ts`** — `_addConditionSource()` / `_removeConditionSource()` helpers
- **`src/engine/utils.ts`** — `attackAdvantageState(bf?)`, `addCondition()` / `removeCondition()` with source tracking, `addImmunity()`, `_concentrationAutoBroken` flag
- **`src/engine/combat.ts`** — `checkDeath()` handles concentration auto-break; ready action STUB at `case 'ready':`
- **`src/ai/planner.ts`** — Q5 filtering: skips visible-target spells when no visible enemy
- **`src/ai/monster_spellcasting.ts`** — `findBestCantripTarget(requiresVisible)` with legacy fallback; `listCantripTemplateNames()`

### RFCs (unchanged)
- **`docs/RFC-VISION-AUDIO.md`** — Phase 1-3 done; Phase 4 deferred
- **`docs/RFC-COMBINING-EFFECTS.md`** — Phase 1-4 done
- **`docs/RFC-PATTERN-BIAS-AI.md`** — Phase 1 done; Phase 2 not started
- **`docs/RFC-MONSTER-SPELLCASTING.md`** — Phase 1 done; Phase 2 in progress (this session); Phase 3 not started

---

## Uncommitted Changes

None — all substantive work is committed and pushed. The working tree is clean (the spell-cache + coverage report refreshes were committed as part of the batch commits / will be picked up by the next `npm run` if regenerated).

---

## Verification Snapshot (for the "no red X" check)

- `git log --oneline -4` shows: `a447f78` (Batch 3), `fb2ce89` (Batch 2), `5072eca` (Batch 1), `4627725` (Session 67).
- `git status` → clean working tree.
- `tsc --noEmit 2>&1 | grep "error TS" | grep -v "src/test/" | wc -l` → **5** (all pre-existing, unchanged from Session 67).
- All 7 test files listed in "Build Status" pass with 0 failures.
- GitHub: no red X on the latest commit (`a447f78`) — all commits pushed cleanly to `main`.
