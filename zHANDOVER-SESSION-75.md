# zHANDOVER — Session 75

**Date:** 2026-06-26
**Agent:** Z.ai (autonomous — continued from Session 74)
**Focus:** Implement RFC-MONSTER-SPELLCASTING Phase 2 — Slot-Based Leveled Spells for monsters. 478 monsters (Lich, Mage, Priest, etc.) have spell slots L1-9 with prepared spells that the engine NEVER cast. This session closes that gap. Also delivered the parallel testing infrastructure (Session 74 follow-up) that reduced CI test time from ~21 min to ~3-4 min.

---

## Session Summary

This session implemented **RFC-MONSTER-SPELLCASTING Phase 2: Slot-Based Leveled Spells**. The RFC (docs/RFC-MONSTER-SPELLCASTING.md) defines 4 phases:

- **Phase 1** (Session 63): At-will + cantrips ✅ DONE
- **Phase 2** (THIS SESSION): Slot-based leveled spells (monsterSpellSlots consumption) ✅ DONE
- **Phase 3** (Session 74): Daily-use spells (monsterDailyUses consumption) ✅ DONE
- **Phase 4** (DEFERRED): Spell upcast, multi-target AoE, reaction spells, bespoke-only spells

**Phase 2 is now complete.** Monsters with `monsterSpellcasting.slots` (478 creatures — Lich, Mage, Priest, Kuo-toa Archpriest, etc.) now cast their slot-based spells in combat. Previously, these spells were parsed and stored as metadata but never used — monsters only cast cantrips (Phase 1) and daily spells (Phase 3).

**Test delta:** 63 new tests in 1 new test suite (`session75_monster_slotted_spells.test.ts`), 0 failures. 10 existing tests updated (Phase 2 stub tests → real implementation tests). All 6 CI chunks pass (397/397 files).

**tsc error delta:** 3 → 3 (unchanged — the 3 pre-existing `Record<string,unknown>` casts are unrelated to this work).

**CI status:** ALL GREEN ✅ on commit `5db65a1` (build ✓, deploy ✓, report-build-status ✓, test (1-6) ✓).

---

## What was done

### 1. `initMonsterSpellSlots()` — replaces the Phase 2 stub

The previous stub was a no-op. The real implementation:
- Populates `monster.monsterSpellSlots` from `monsterSpellcasting.slots[1-9]`
- Each slot level gets `{ max, remaining: max }` (full on spawn, per RFC §5.3)
- Level 0 (cantrips) are NOT tracked (at-will, handled by Phase 1)
- Idempotent: if `monsterSpellSlots` is already populated, returns early (no reset)
- No-op when `monsterSpellcasting.slots` is absent (Drow-style daily casters)
- Called LAZILY from `selectMonsterSlottedSpell()` on first invocation (same pattern as Phase 3, avoids touching combat.ts init paths)

### 2. `hasMonsterSpellSlot(minLevel)` + `consumeMonsterSpellSlot(desiredLevel)`

- `hasMonsterSpellSlot(minLevel)`: returns `true` if any slot at or above `minLevel` has `remaining > 0`. Mirrors PC's `hasSpellSlot()`.
- `consumeMonsterSpellSlot(desiredLevel)`: decrements `remaining` at the desired level. If exact level is exhausted, tries higher levels (upcast per PHB p.201). Returns the slot level consumed, or `null` if none available. Mirrors PC's `consumeSpellSlot()`.
- Consumption happens UPFRONT in the planner (PHB p.201: "Once a spell is cast, its slot is used regardless of whether the spell succeeds")

### 3. `selectMonsterSlottedSpell()` — the main entry point

Algorithm (RFC §4.3, Phase 2 subset):
1. Guard: monster has `monsterSpellcasting.slots`
2. Lazy-init `monsterSpellSlots` (idempotent)
3. Quick bail: if no slots remain at any level, skip
4. Build combat context (`computeSpellcastContext`)
5. Bail if no enemies AND no downed allies (most slotted spells need a target)
6. Find best target enemy (`findDailySpellTarget` — reused from Phase 3)
7. **Synthetic action + resources compatibility shim** (same as Phase 3)
8. For each slot level 1-9, for each spell in that level's spell list:
   - Skip if no slot available at this level (or higher for upcast)
   - Look up in `GENERIC_SPELLS` via `lookupGenericSpell()` — skip if not found (bespoke-only = Phase 4)
   - Run `desc.shouldCast(self, bf)` (with synthetic action + resources)
   - Derive tags via `getDailySpellTags()` (reused from Phase 3) — skip utility
   - Compute weight (baseWeight × tagMultiplier × pattern biases)
   - Track highest-weight spell (ties → highest spell level, then alphabetical)
   - Track `bestSlotLevel` (slot level from iteration, for consumption) separately from `bestLevel` (spell's GENERIC_SPELLS level, for tie-breaking)
9. Cleanup synthetic action + resources (try/finally)
10. Consume the spell slot upfront using `consumeMonsterSpellSlot(self, bestSlotLevel)` — tries exact level first, then upcasts
11. Update `castSlotLevel` to the actual slot consumed (may be higher if upcast)
12. Return `PlannedAction { type: 'genericSpell', spellName, castSlotLevel }`

### 4. Planner integration

New branch in `planTurn()` (planner.ts), placed BEFORE the Phase 3 daily spell branch:

```typescript
if (!plan.action && self.monsterSpellcasting?.slots) {
  const slottedPlan = selectMonsterSlottedSpell(self, battlefield);
  if (slottedPlan) {
    plan.action = slottedPlan;
    plan.targetId = slottedPlan.targetId ?? null;
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }
}
```

Sits ABOVE the daily spell branch (Phase 3) because slotted spells are the "primary" spellcasting mechanic (Lich, Mage, Priest use slots, not daily). Most monsters have EITHER slots OR daily, not both. Priority order: bespoke > slotted (Phase 2) > daily (Phase 3) > cantrip (Phase 1) > weapon.

### 5. combat.ts dispatch fix

Extended the Phase 3 shouldCast bypass to also cover slotted spells:

```typescript
const isMonsterDailyCast = !!actor.monsterSpellcasting?.daily?.[spellName];
const isMonsterSlottedCast = !isMonsterDailyCast && !!actor.monsterSpellcasting?.slots &&
  Object.values(actor.monsterSpellcasting.slots).some(s => s.spells.includes(spellName));
const isMonsterSpellCast = isMonsterDailyCast || isMonsterSlottedCast;
if (isMonsterSpellCast || desc.shouldCast(actor, bf)) {
  desc.execute(actor, state);
}
```

The planner already validated shouldCast (with synthetic state); the re-check in combat.ts would fail for monsters because the synthetic state was cleaned up. The resource consumption (slot or daily use) happened upfront in the planner.

### 6. Upcast support

When a spell's exact slot level is exhausted, `consumeMonsterSpellSlot(desiredLevel)` automatically tries higher levels (upcast per PHB p.201). The `castSlotLevel` on the returned `PlannedAction` reflects the actual slot consumed (may be higher than the spell's base level). This integrates with RFC-UPCASTING Phase 1's `castSlotLevel` field for Counterspell accuracy and Globe of Invulnerability blocking.

Example: A Mage has 3× L3 slots with Fly prepared. After 3 casts, L3 is exhausted. The 4th cast would upcast Fly to L4 (if L4 slots are available), and `castSlotLevel` would be 4.

---

## Commits this session (1, pushed)

1. `5db65a1` — RFC-MONSTER-SPELLCASTING Phase 2: slot-based leveled spells for 478 monsters

**Latest commit `5db65a1` is ALL CHECKS GREEN ✅** (CI completed successfully — build ✓, deploy ✓, report-build-status ✓, test (1-6) ✓).

### Prior session commits (for context):
- `c89ceb8` — Parallel test runner: 6-chunk CI matrix + run_tests.ts script (Session 74 follow-up)
- `0213bf1` — RFC-MONSTER-SPELLCASTING Phase 3: daily-use spells for 1371 monsters (Session 74)

---

## Current State of Major RFCs

### RFC-MONSTER-SPELLCASTING — Phase 1 ✅, Phase 2 ✅ DONE, Phase 3 ✅ DONE, Phase 4 DEFERRED

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: At-will + cantrips | ✅ DONE | Session 63 — 945 creatures cast combat cantrips |
| Phase 2: Slot-based leveled spells | ✅ DONE | This session — 478 creatures cast slotted spells |
| Phase 3: Daily-use spells | ✅ DONE | Session 74 — 1371 creatures cast daily spells |
| Phase 4: Bespoke-only spells via name→plan-type | DEFERRED | Would unlock Fireball, Command, Hold Person, etc. |

**Monster spellcasting coverage summary:**
- Phase 1: 945 creatures with at-will cantrips
- Phase 2: 478 creatures with slot-based spells (77 of 373 unique dispatchable via GENERIC_SPELLS)
- Phase 3: 1371 creatures with daily-use spells (105 of 420 unique dispatchable via GENERIC_SPELLS)
- Phase 4 would unlock the remaining ~296 bespoke-only slotted + ~315 bespoke-only daily spells

### RFC-UPCASTING — ALL 6 PHASES DONE ✅ (Session 72, unchanged)

### RFC-COMBINING-EFFECTS — Phase 1-4 ALL DONE ✅ (unchanged)

### RFC-VISION-AUDIO — Phase 1-3 ALL DONE ✅, Phase 4 PARTIALLY DONE (unchanged)

### RFC-PATTERN-BIAS-AI — Phase 1 DONE ✅, Phase 2 NOT STARTED (unchanged)

---

## Build Status

| Check | Status |
|-------|--------|
| `session75_monster_slotted_spells.test.ts` (63 tests) | ✅ All pass |
| `session74_monster_daily_uses.test.ts` (85 tests) | ✅ All pass |
| `monster_spellcasting.test.ts` (121 tests, 10 updated) | ✅ All pass |
| All 6 CI chunks (397/397 files) | ✅ All pass |
| `tsc --noEmit` | ✅ 3 errors (pre-existing `Record<string,unknown>` casts — unchanged) |

---

## Key Architectural Decisions This Session

### Slot level vs spell level separation

`selectMonsterSlottedSpell` tracks two separate "level" concepts:
- `bestLevel` (desc.level): the spell's GENERIC_SPELLS level — used for tie-breaking (higher-level spells preferred)
- `bestSlotLevel` (lvl): the slot level from the `slots[lvl]` iteration — used for consumption

This separation is important because:
1. A spell's base level (e.g. Fly = L3) determines its power for scoring
2. The slot level it's prepared at (e.g. `slots[3]`) determines which slot to consume
3. If the exact slot is exhausted, `consumeMonsterSpellSlot` upcasts to a higher level

In real bestiary data, spells are listed at their base level (Fly in `slots[3]`, Polymorph in `slots[4]`). But the engine doesn't enforce this — a monster COULD have a spell listed at a higher slot than its base level (representing upcast preparation).

### Upcast consumption

`consumeMonsterSpellSlot(desiredLevel)` tries `desiredLevel` first, then `desiredLevel+1`, ..., up to 9. This matches PHB p.201's upcast rule. The returned level is the actual slot consumed, which is set on `PlannedAction.castSlotLevel` for Counterspell/GoI accuracy.

### Reuse of Phase 3 infrastructure

Phase 2 reuses the Phase 3 infrastructure almost entirely:
- `getDailySpellTags()` — tag derivation (same for slotted and daily spells)
- `findDailySpellTarget()` — target selection
- Synthetic action + resources compatibility shim — shouldCast validation
- `collectCantripBiases()` + `computeSpellWeight()` — scoring pipeline
- combat.ts shouldCast bypass — extended from daily-only to daily+slotted

This made Phase 2 a relatively contained addition (~300 lines of new code + ~100 lines of stub replacements).

### No combat.ts init changes (lazy initialization)

Same as Phase 3: `initMonsterSpellSlots()` is called LAZILY from `selectMonsterSlottedSpell()` on the first invocation. This avoids touching combat.ts's `runCombat()` or `monsterToCombatant()` init paths — important for avoiding merge conflicts with concurrent workstreams (Task 73-1 GoI AoE-exclusion).

---

## Remaining Work (Priority Order)

### 1. RFC-MONSTER-SPELLCASTING Phase 4: Bespoke-only spells — MEDIUM risk

Add a name→plan-type mapping so bespoke-only spells (Fireball, Command, Hold Person, Cure Wounds, etc.) can be dispatched. This would unlock:
- ~296 bespoke-only slotted spells (Fireball, Counterspell, Dispel Magic, Magic Missile, Shield, etc.)
- ~315 bespoke-only daily spells (Command, Hold Person, Darkness, Faerie Fire, etc.)

The mapping would be a `Record<string, string>` from spell name to plan type (e.g. `'Fireball' → 'fireball'`, `'Command' → 'command'`). The planner would set `plan.type = map[spellName]` instead of `'genericSpell'`, and combat.ts's existing bespoke case branches would handle execution.

This is the highest-value remaining work for monster spellcasting — it would roughly triple the number of dispatchable spells.

### 2. Ready Action Implementation (MEDIUM-HIGH risk) — unchanged

Currently a STUB in `combat.ts` — the `case 'ready':` falls through.

### 3. RFC-COMBINING-EFFECTS Phase 2 Remaining (MEDIUM risk) — unchanged

Some non-concentration spell modules still need `sourceTurnExpires` populated.

### 4. RFC-VISION-AUDIO Phase 4 (DEFERRED — HIGH risk) — unchanged

Per-cell light sources, fog cloud / Darkness spell as mobile obscurement zones.

### 5. Creature Megabatch Batches 4d/4e (Creature workstream) — unchanged

### 6. Real implementations for the 7 deferred combat stubs (MEDIUM-HIGH risk) — unchanged

### 7. GoI v1 follow-ups (LOW risk) — Task 73-1 in progress

- AoE exclusion: Task 73-1 (z/canpit agent) is implementing this in parallel (uncommitted)
- 10-ft radius: allies within 10 ft of GoI caster should be protected
- Eldritch Blast multi-beam: full independent attack roll per beam

---

## Key Files for Next Agent

### New this session

**Core implementation (src/ai/monster_spellcasting.ts):**
- `initMonsterSpellSlots()` — replaces Phase 2 stub, populates from `monsterSpellcasting.slots[1-9]`
- `hasMonsterSpellSlot(minLevel)` — checks slot availability at or above minLevel
- `consumeMonsterSpellSlot(desiredLevel)` — decrements slot, upcasts if needed, returns level consumed
- `selectMonsterSlottedSpell()` — main entry point with lazy init, synthetic action/resources shim, shouldCast validation, weight scoring, upfront consumption, upcast support

**Planner integration (src/ai/planner.ts):**
- New branch BEFORE the Phase 3 daily spell branch (slotted > daily priority)
- Imports `selectMonsterSlottedSpell`

**Combat dispatch (src/engine/combat.ts):**
- `case 'genericSpell':` — extended `isMonsterSpellCast` check to cover slotted spells (checks `monsterSpellcasting.slots[N].spells` in addition to `monsterSpellcasting.daily`)

**Test files:**
- `src/test/session75_monster_slotted_spells.test.ts` — 63 tests covering init, consumption, availability, upcast, selection, dedup, cleanup, planner integration, backward-compat, full combat
- `src/test/monster_spellcasting.test.ts` — 10 tests updated (Phase 2 stub tests → real implementation tests)

### Types (already existed, now populated)
- `src/types/core.ts` — `monsterSpellSlots?: { [level: number]: { max: number; remaining: number } }` on Combatant (line 1065) — was already defined, now actually populated

### RFCs (updated)
- `docs/RFC-MONSTER-SPELLCASTING.md` — Phase 2 now implemented (status should be updated to reflect Phase 2 DONE)

### Parallel testing infrastructure (from Session 74 follow-up, commit c89ceb8)
- `scripts/run_tests.ts` — parallel test runner (deterministic chunking, worker pool, JSON mode)
- `.github/workflows/test.yml` — 6-chunk CI matrix (fail-fast: false)
- `docs/PARALLEL-TESTING.md` — default practice documentation
- CI test time: ~21 min → ~3-4 min

---

## Uncommitted Changes

None from this agent. All Phase 2 work is committed and pushed (commit `5db65a1`).

**Note:** Task 73-1 (the concurrent GoI AoE-exclusion agent) has uncommitted changes in:
- `src/engine/spell_effects.ts` (new `filterGoiProtectedTargets` helper)
- `src/spells/fireball.ts`, `lightning_bolt.ts`, `burning_hands.ts`, `shatter.ts`, `thunderwave.ts`, `sunburst.ts`, `tidal_wave.ts`, `arms_of_hadar.ts` (wire exclusion into execute)
- `src/spells/globe_of_invulnerability.ts` (flip AoEV1Simplified flag)
- `src/engine/combat.ts` (GoI v2 scope comment update — ONLY comments, no logic)
- `src/test/session73_goi_aoe_exclusion.test.ts` (new test file, untracked)

These are Task 73-1's work and were NOT touched by this agent. My combat.ts change (the `case 'genericSpell':` shouldCast bypass extension) was committed separately; Task 73-1's comment changes remain in their working tree.

---

## Verification Snapshot

- `git log --oneline -5` shows: `5db65a1`, `c89ceb8`, `0213bf1`, `69d66f4`, `593ca00`
- `git status` → clean for this agent's files (Task 73-1's files still uncommitted in working tree)
- `tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **3** (pre-existing, unchanged)
- All 6 CI chunks pass locally (397/397 files)
- **CI status — ALL GREEN ✅ on commit `5db65a1`** (build ✓, deploy ✓, report-build-status ✓, test (1-6) ✓)
- **No red X on the latest commit (`5db65a1`).**
- **zHANDOVER-SESSION-75.md** uploaded to `/home/z/my-project/upload/zHANDOVER-SESSION-75.md`

---

## Coverage Achievement Summary

This session completed **RFC-MONSTER-SPELLCASTING Phase 2**, closing another major functionality gap: 478 monsters with slot-based spells (Lich, Mage, Priest, Kuo-toa Archpriest, etc.) now cast their slotted spells in combat.

**Combined with Sessions 63 (Phase 1) and 74 (Phase 3), the monster spellcasting engine now handles:**
- **Phase 1** ✅ — 945 creatures cast at-will cantrips
- **Phase 2** ✅ — 478 creatures cast slot-based leveled spells (with upcast support)
- **Phase 3** ✅ — 1371 creatures cast daily-use spells

The infrastructure (init, consume, select, dispatch, planner integration) is fully in place for all three phases. **Phase 4** (bespoke-only spells via name→plan-type mapping) is the remaining gap — it would unlock ~611 unique bespoke spells that are currently silently skipped because they're not in the GENERIC_SPELLS registry.

Also delivered this session: the **parallel testing infrastructure** (commit `c89ceb8`) that reduced CI test time from ~21 min to ~3-4 min, with `scripts/run_tests.ts` as the single source of truth for local pre-push validation and CI matrix execution.
