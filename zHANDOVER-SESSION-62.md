# zHANDOVER — Session 62

**Date:** 2026-06-24
**Agent:** Z.ai (autonomous — resumed from Session 61 timeout; Core + Sheet offline)
**Focus:** (1) Implement Vision/Audio Phase 1 (prev agent timed out on this); (2) Write Monster Spellcasting Engine Integration RFC; (3) Implement Fog Cloud (first spell using the new vision subsystem); (4) Final verification.

---

## Session Summary

This session resumed from a timeout. The previous agent (Session 61) had completed Dimension Door + Shapechanger Phase 1 but timed out while researching the Vision/Audio Phase 1 infrastructure. I picked up where they left off and completed 3 major workstreams:

### Workstream 1: Vision/Audio Phase 1 (commit `b3e3580`)
- **New module `src/engine/perception.ts`** (460 lines): full perception + detection subsystem.
  - `isAudiblyDetected()`: sound detection per user's formula `passivePerception × 5ft` (Chebyshev). Suppressed by `hidden` condition.
  - `isVisuallyDetected()`: LOS + not invisible/hidden (Phase 1 simplification — darkvision/blindsight/truesight/tremorsense deferred to Phase 2).
  - `getDetectionState()`: 4-state classifier (`visible` / `hidden` / `position-known` / `unknown`).
  - `updateDetectionStates()`: refreshes `PerceptionMemory.detection` for all observers at the start of each combatant's turn (lazy-init, backward-compatible).
  - `canTakeHideAction()`: obscurement/cover/invisible requirement check per user answer #2.
  - `tryHide()`: generalized Hide action (any creature, not just Rogues). Preserves "Hides!"/"Detected!" log messages for Cunning Action Hide tests.
  - `breaksStealthOnCast()` + `revealOnCast()`: verbal component check — hidden casters revealed when casting verbal spells. Silent spells (Counterspell, Message) don't break stealth.
  - `tryActivePerception()`: Search action — contests hidden enemies' Stealth rolls (per user answer #6).
  - Planner helpers: `countHiddenEnemies`, `countTargetableEnemies`, `nearestHiddenEnemy`.
- **Type changes** (`src/types/core.ts`):
  - `DetectionState` type: `'visible' | 'hidden' | 'position-known' | 'unknown'`
  - `PerceptionMemory.detection?: Map<string, DetectionState>` (optional, backward-compat)
  - `Combatant._stealthRoll?: number` (scratch field for active Perception contests)
  - `PlannedAction.type`: added `'perceive'` (Search action)
- **Engine wiring** (`src/engine/combat.ts`):
  - Refactored `case 'hide':` to call `tryHide()` (preserves Cunning Action Hide tests)
  - Added `case 'perceive':` for active Perception
  - Added `revealOnCast()` hook after Counterspell check
  - Added `updateDetectionStates(bf)` call at turn start (after `resetBudget`)
  - Added `'perceive'` to `NON_SPELL_PLAN_TYPES`
- **Planner wiring** (`src/ai/planner.ts`):
  - Active Perception branch: when all enemies hidden (no targetable), plan `'perceive'` (BEFORE `selectTarget`)
  - Generalized Hide-as-action branch: non-Rogues at low HP (<30%) with obscurement → plan `'hide'` (BEFORE self-preserve, with downed-ally guard)
- **Tests** (`src/test/vision_audio.test.ts`): 71 assertions across 15 sections. All pass.

### Workstream 2: Monster Spellcasting Engine Integration RFC (commit `7c4fc24`)
- **`docs/RFC-MONSTER-SPELLCASTING.md`** (333 lines): full RFC for wiring the 945 spellcasting monsters into the engine.
  - Weighted action selection system per user directive: tags (`damage`/`cc`/`healing`/`defending`/`buff`/`utility`) × situational scoring matrix.
  - Slot + daily use tracking (`monsterSpellSlots`, `monsterDailyUses` new fields).
  - Spell tag derivation (auto from metadata + manual override map + bespoke metadata extension).
  - 3-phase implementation plan (Phase 1: at-will, Phase 2: slots, Phase 3: daily + concentration).
  - **6 doubts flagged for user** (spell coverage, openers, cantrip vs slot, conc breaking, daily priority, unimplemented handling).

### Workstream 3: Fog Cloud spell (commit `3bb6413`)
- **New spell `src/spells/fog_cloud.ts`**: PHB p.243, L1 conjuration, 20-ft sphere heavy obscurement, concentration. Needed by 46 monsters.
  - First spell to directly use the Vision/Audio Phase 1 subsystem: adds a vision-blocking `Obstacle` to `bf.obstacles`.
  - Blocks LOS → enables generalized Hide action + imposes disadvantage on attacks through fog.
- **New effectType `'battlefield_obstacle'`** in `SpellEffectType` union + `removeBattlefieldObstacle()` helper in `spell_effects.ts`. Sets up the pattern for future obscurement spells (Darkness, Stinking Cloud, etc.).
- **Tests** (`src/test/fog_cloud.test.ts`): 43 assertions. All pass.

---

## User's Vision/Audio Answers (IMPLEMENTED this session)

All 6 answers from zHANDOVER-SESSION-60.md are now implemented in Phase 1:
1. **Sound formula**: `passivePerception × 5ft` (Chebyshev) ✅ `isAudiblyDetected()`
2. **Hide requirements**: obscurement/cover/invisible ✅ `canTakeHideAction()`
3. **Hidden persistence**: until noisy activity (cast/attack) ✅ `revealOnCast()` + existing attack-reveal
4. **Detection states**: 4-state model ✅ `DetectionState` type + `getDetectionState()`
5. **Light level**: existing `lightLevel` field ✅ `canTakeHideAction()` checks `'dim'`
6. **Active perception**: spends action ✅ `tryActivePerception()` + `case 'perceive':`

---

## Current State

### Build Status
| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| All 71 vision_audio tests | ✅ All pass |
| All 43 fog_cloud tests | ✅ All pass |
| combat / ai / scenario / bestiary_integration | ✅ All pass |
| cunning_action / invisible_effect / darkvision | ✅ All pass |
| 15 spell tests (bless, entangle, sleep, etc.) | ✅ All pass |
| creature tests (shapechanger, ambusher, lair, death_burst, spellcasting) | ✅ All pass |

### Commits this session (4 total, all pushed):
1. `b3e3580` — Session 62: Implement Vision/Audio Phase 1 (RFC-VISION-AUDIO)
2. `7c4fc24` — docs: RFC for monster spellcasting engine integration (Batch 5b step 2)
3. `3bb6413` — Session 62: Implement Fog Cloud (PHB p.243) — vision-blocking obscurement

### Total new code this session:
- `src/engine/perception.ts` — 460 lines (new module)
- `src/spells/fog_cloud.ts` — 260 lines (new spell)
- `src/test/vision_audio.test.ts` — 640 lines, 71 assertions (new tests)
- `src/test/fog_cloud.test.ts` — 320 lines, 43 assertions (new tests)
- `docs/RFC-MONSTER-SPELLCASTING.md` — 333 lines (new RFC)
- Type changes in `core.ts`, wiring in `combat.ts` + `planner.ts` + `spell_effects.ts`

---

## Remaining work (all need user direction):

### 1. Vision/Audio Phase 2 (MEDIUM risk — RFC written, Phase 1 done)
- Vision modes: darkvision/blindsight/truesight/tremorsense consumption (parsed but unused).
- Darkness/dim-light effect on sight (disadvantage on sight-Perception; darkness = can't see without darkvision).
- "Creature you can see" spell targeting enforcement.
- Opportunity-attack visibility gating.
- Files: `src/engine/perception.ts` (extend `isVisuallyDetected`), `src/engine/combat.ts` (OA gating), `src/ai/planner.ts` (target filtering).

### 2. Monster Spellcasting Engine Integration (HIGH risk — RFC written, 6 doubts for user)
- Phase 1 (at-will + cantrips): ~200 creatures. LOW-MEDIUM risk. Can start once user confirms doubt #1 (spell coverage: skip vs stub).
- Phase 2 (slot-based): ~600 creatures. Needs `monsterSpellSlots` tracking + weighted scoring.
- Phase 3 (daily + concentration): ~145 creatures. Needs `monsterDailyUses` tracking.
- Files: `src/ai/monster_spellcasting.ts` (NEW), `src/types/core.ts`, `src/engine/combat.ts`, `src/ai/planner.ts`.
- **6 doubts in `docs/RFC-MONSTER-SPELLCASTING.md` §9 need user answers before implementation.**

### 3. More spells (per SPELL-DELEGATION-SPEC)
- **Darkness** (L2, 81 monsters): now feasible — uses the same `battlefield_obstacle` effectType as Fog Cloud. Blocks darkvision (Phase 2 vision needed for full effect).
- **Wall of Fire** (L4, 29 monsters): complex — needs line/ring zone subsystem.
- **243 more spells** per the delegation spec (delegated to Core + Sheet agents).

### 4. Tier-C Core tasks
- TG-007 (Wall spells), TG-011 (complex spells) — some covered by the Fog Cloud `battlefield_obstacle` pattern.
- TG-006 Phase 4 (summons) — deferred.

---

## Next Agent Priorities

1. **Get user answers to the 6 doubts in `docs/RFC-MONSTER-SPELLCASTING.md` §9** — these gate Phase 1 implementation.
2. **Implement Monster Spellcasting Phase 1** (at-will + cantrips) — LOW-MEDIUM risk, ~200 creatures. Start with `src/ai/monster_spellcasting.ts` (new file) + the `selectMonsterSpell()` function.
3. **Implement Vision/Audio Phase 2** (vision modes) — MEDIUM risk. Extend `isVisuallyDetected()` in `src/engine/perception.ts` to consume `senses.darkvision/blindsight/truesight/tremorsense`.
4. **Implement Darkness spell** (L2, 81 monsters) — follows the Fog Cloud pattern exactly; just blocks darkvision too (Phase 2 vision needed for the darkvision-blocking effect).
5. **Implement more spells** per `docs/SPELL-DELEGATION-SPEC.md`.

---

## Key Files for Next Agent to Read

- **`docs/RFC-VISION-AUDIO.md`** — vision/audio subsystem design (Phase 1 done, Phase 2-4 pending)
- **`docs/RFC-MONSTER-SPELLCASTING.md`** — monster spellcasting design (6 doubts for user)
- **`docs/SPELL-DELEGATION-SPEC.md`** — spell implementation tasks + pattern
- **`src/engine/perception.ts`** — the new perception subsystem (start here for Phase 2)
- **`src/spells/fog_cloud.ts`** — canonical example of a spell using `battlefield_obstacle` (pattern for Darkness)
- **`src/test/vision_audio.test.ts`** — test patterns for perception
- **`src/test/fog_cloud.test.ts`** — test patterns for battlefield_obstacle spells
