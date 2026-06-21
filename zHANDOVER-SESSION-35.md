# zHANDOVER — Session 35

**Date:** 2026-06-21
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Invisibility upcast (item #5 from Session 34's next-session priorities). Implement +1 target per slot level above 2nd (PHB p.254 "At Higher Levels"). Closes the last v1 simplification on Invisibility.

---

## Session Summary

Session 34 closed TG-002 (concentration enforcement) and TG-008 (Protection from Energy). Session 35 continues closing v1 simplifications by implementing the Invisibility upcast mechanic.

| Component | Status | Lines |
|-----------|--------|-------|
| `invisibility.ts` — refactored shouldCast/execute to multi-target + backwards-compat single-target | ✅ Done | ~250 lines (rewrite) |
| `invisibility.test.ts` — updated existing tests to use shouldCastSingle/executeSingle + added 37 new upcast assertions | ✅ Done | +200 lines (section 8) |
| `invisibility_break_on_attack.test.ts` — updated execute calls to executeSingle | ✅ Done | 4 lines changed |
| `invisible_effect.test.ts` — updated execute call to executeSingle | ✅ Done | 1 line changed |
| `combat.ts` — updated `case 'invisibility':` dispatch for multi-target | ✅ Done | ~10 lines |
| `planner.ts` — updated Invisibility branch for Combatant[] return | ✅ Done | ~10 lines |
| `invisibilityUpcastV1Implemented` flag flipped false → true | ✅ Done | 1 line in metadata |

**Total:** ~470 lines of new/modified code, 37 new test assertions (81 total in invisibility.test.ts, up from 44).

---

## Architecture

### Multi-target refactor (Prayer of Healing pattern)

Session 34's Protection from Energy used the single-target pattern. Session 35's Invisibility upcast required multi-target, so I followed the **Prayer of Healing** pattern (`shouldCast` returns `Combatant[] | null`, `execute` takes `targets: Combatant[]`).

**Key design decisions:**

1. **`shouldCast` returns `Combatant[] | null`** — 1 to N targets based on highest available slot level. The AI picks the slot level that matches the candidate count (no waste).

2. **`execute` derives slot level from target count** — `desiredSlotLevel = min(9, 2 + (targets.length - 1))`. 1 target → L2, 2 → L3, 3 → L4, etc. This matches PHB p.254: "When you cast this spell using a spell slot of 3rd level or higher, you can target one additional creature for each slot level above 2nd."

3. **Backwards compat: `shouldCastSingle` / `executeSingle`** — retained for external callers (tests, legacy dispatch paths) that expect single-target semantics. `shouldCastSingle` returns the first target from `shouldCast`; `executeSingle` wraps `execute` with a single-element array.

4. **Candidate collection extracted to `collectCandidates`** — shared helper that sorts by (self first, lowest HP%, closest). Both `shouldCast` and the multi-target path use it.

5. **AI heuristic for slot selection** — "greedy on allies":
   - If only 1 candidate in range: use L2 (no benefit from upcasting).
   - If 2+ candidates and an L3+ slot is available: use the highest available slot, but cap target count at the number of candidates (no waste).
   - The actual slot consumed is decided in `execute` based on the target count returned.

### Per-target breaksOnAttackOrCast

Each target gets its own `invisible` ActiveEffect with `breaksOnAttackOrCast: true`. This means:
- If target A attacks, only target A's invisibility ends (per-target flag, not per-caster).
- Target B remains invisible until they attack/cast or concentration breaks.
- This matches PHB p.254: "The spell ends for a target that attacks or casts a spell." (per-target, not spell-wide)

The existing `breakInvisibilityOnAction` hook in combat.ts already filters by `target.id === attacker.id`, so no engine changes were needed — the multi-target case works correctly out of the box.

### Concentration linkage

All N targets' effects are sourced from the same caster with `sourceIsConcentration: true`. When concentration breaks (damage, voluntary end, dispel), `removeEffectsFromCaster` removes ALL N effects in one sweep — the caster's concentration covers the entire spell, not per-target.

---

## Files Changed

### Modified files (6)
- `src/spells/invisibility.ts` — Refactored to multi-target:
  - `shouldCast(caster, bf): Combatant[] | null` (was `Combatant | null`)
  - `execute(caster, targets, state)` (was `execute(caster, target, state)`)
  - Added `shouldCastSingle` / `executeSingle` (backwards compat)
  - Extracted `collectCandidates` helper
  - Flipped `invisibilityUpcastV1Implemented: false` → `true`
  - Updated module header comments

- `src/test/invisibility.test.ts` — Updated existing tests + added upcast section:
  - All existing `shouldCast` calls → `shouldCastSingle` (where single-target expected)
  - All existing `execute` calls → `executeSingle` (where single-target expected)
  - Flipped metadata assertion: `'upcast NOT implemented (v1)'` → `'upcast NOW implemented (Session 35)'`
  - Added section 8 "Upcast — multi-target selection" with 37 new assertions (8a-8m)
  - Added `withSlotsMulti` helper for multi-level slot fixtures

- `src/test/invisibility_break_on_attack.test.ts` — 4 `executeInvis` calls → `executeInvisSingle`

- `src/test/invisible_effect.test.ts` — 1 `execute` call → `executeSingle`

- `src/engine/combat.ts` — Updated `case 'invisibility':` dispatch:
  - Now calls `shouldCastInvisibility(actor, bf)` which returns `Combatant[]`
  - Passes the array to `executeInvisibility(actor, invTargets, state)`
  - Removed the stale `plan.targetId` lookup (re-queries live battlefield)

- `src/ai/planner.ts` — Updated Invisibility branch (11Q):
  - `shouldCastInvisibility` now returns `Combatant[] | null`
  - `plan.targetId` set to `invTargets[0].id` (primary target)
  - `plan.description` lists all target names

---

## Test Coverage (37 new assertions in section 8)

| Test | Description |
|------|-------------|
| 8a | L2 slot only → 1 target (no upcast) |
| 8b | L3 slot + 2 allies → 2 targets (upcast by 1) |
| 8c | L4 slot + 3 allies → 3 targets |
| 8d | L4 slot but only 2 allies → 2 targets (capped at candidates, no waste) |
| 8e | L3 slot but only 1 ally in range → 1 target (capped at candidates) |
| 8f | execute with 2 targets consumes L3 slot (not L2) |
| 8g | execute with 3 targets consumes L4 slot (not L2/L3) |
| 8h | execute with 1 target consumes L2 slot (no upcast) |
| 8i | Multi-target priority: lowest-HP% allies picked first |
| 8j | Log message includes all target names + "2 creatures" |
| 8k | Each target gets its own invisible effect with breaksOnAttackOrCast: true |
| 8l | shouldCastSingle returns first target (backwards compat) |
| 8m | executeSingle applies to 1 target only (backwards compat) |

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `invisibility.test.ts` (81 assertions: 44 original + 37 new upcast) | ✅ All pass (3 stable runs) |
| `invisibility_break_on_attack.test.ts` (36 assertions) | ✅ All pass (3 stable runs) |
| `invisible_effect.test.ts` (21 assertions) | ✅ All pass (3 stable runs) |
| Baseline tests (concentration_enforcement 34, protection_from_energy 52, reaction_registry 74, concentration_ai 34, mechanics 57, engine 71, combat 47, dispel_magic 47, bulk_spell_dispatch 214, see_invisibility 34, scenario 94, ai 26) | ✅ All pass |

---

## How to Add a Multi-Target Upcast Spell (Template)

1. **`shouldCast` returns `Combatant[] | null`** (multi-target):
   ```typescript
   export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null {
     // ... preconditions ...
     const candidates = collectCandidates(caster, bf);
     if (candidates.length === 0) return null;
     const highestSlot = findHighestSlot(caster);
     const maxTargets = 1 + Math.max(0, highestSlot - baseLevel);
     const targetCount = Math.min(candidates.length, maxTargets);
     return candidates.slice(0, targetCount).map(e => e.c);
   }
   ```

2. **`execute` derives slot level from target count**:
   ```typescript
   export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void {
     const desiredSlotLevel = Math.min(9, baseLevel + (targets.length - 1));
     consumeSpellSlot(caster, desiredSlotLevel);
     // ... apply effect to each target ...
   }
   ```

3. **Backwards compat** (optional, for legacy callers):
   ```typescript
   export function shouldCastSingle(caster, bf): Combatant | null {
     const targets = shouldCast(caster, bf);
     return targets && targets.length > 0 ? targets[0] : null;
   }
   export function executeSingle(caster, target, state): void {
     execute(caster, [target], state);
   }
   ```

4. **Update planner + combat.ts dispatch** to use the multi-target signature.

5. **Flip the metadata flag** `xxxUpcastV1Implemented: false` → `true`.

---

## Next Session Priorities

(Updated from Session 34 — items 5 and 9 now closed by Session 35.)

1. **Repelling Blast invocation** (deferred from Session 32) — needs Warlock invocations subsystem. The `pushAway()` infrastructure already exists.

2. **More innate spellcasting for summons** (continuation of Session 32 Task #6) — Couatl: add innate spellcasting (bless, cure wounds, lesser restoration, protection from poison, etc.) as Action objects.

3. **Bestiary integration** (deferred from Session 31) — Wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the Conjure spell upcast paths.

4. **Conjure Volley / Conjure Barrage re-categorization** (minor documentation cleanup from Session 31).

5. **~~Invisibility upcast~~** ✅ DONE (Session 35) — +1 target/slot level above 2nd now modelled.

6. **~~Concentration enforcement~~** ✅ DONE (Session 34) — TG-002 closed.

7. **Shield Magic Missile blocking** (v1 simplification from Session 33) — currently Shield only fires on attack hits, not on Magic Missile auto-hits. Would require adding a separate "targeted by Magic Missile" trigger or reworking the auto-hit branch.

8. **Silvery Barbs save-success trigger** (v1 simplification from Session 33) — currently only triggers on attack hits. The save-success and ability-check-success triggers would need new trigger points in `rollSave` and ability-check resolution.

9. **~~Protection from Energy~~** ✅ DONE (Session 34) — TG-008 fully closed.

10. **Protection from Energy upcast** (Session 34 v1 simplification) — +1 target per slot level above 3rd. Requires multi-target `executeWithTarget` signature change (mirror Session 35's Invisibility upcast pattern).

11. **Protection from Energy innate-resistance edge case** (Session 34 v1 simplification) — if target has innate resistance to the same type the spell grants, the spell's idempotent push means the sentinel's cleanup would remove the innate entry. Fix: track "was this entry added by the spell?" state separately.

12. **Greater Invisibility upcast** — Greater Invisibility (L4) has NO upcast entry in PHB (it's self-only, single-target). No action needed; documented for completeness.

---

## Commit Log (Session 35)

```
Session 35: Invisibility upcast — +1 target per slot level above 2nd (PHB p.254)

Refactored Invisibility to multi-target (Prayer of Healing pattern):
  - shouldCast now returns Combatant[] | null (was Combatant | null)
  - execute now takes targets: Combatant[] (was single target)
  - Added shouldCastSingle / executeSingle for backwards compat
  - Extracted collectCandidates helper (shared sort logic)

Upcast mechanic (PHB p.254 "At Higher Levels"):
  - L2 slot → 1 target (no upcast)
  - L3 slot → 2 targets (+1)
  - L4 slot → 3 targets (+2)
  - Formula: targetCount = 1 + max(0, slotLevel - 2)
  - AI heuristic: greedy on allies — uses highest available slot
    when multiple candidates are in range, capped at candidate count
    (no waste). Single-target when only 1 ally in range.

Per-target breaksOnAttackOrCast:
  - Each target gets its own invisible effect with the flag set
  - If target A attacks, only A's invisibility ends (per-target)
  - Target B remains invisible until they attack/cast or
    concentration breaks
  - No engine changes needed — existing breakInvisibilityOnAction
    hook already filters by target.id

Concentration linkage:
  - All N targets' effects sourced from same caster
  - removeEffectsFromCaster removes ALL N effects on concentration
    break (one sweep)

Updated callers:
  - combat.ts case 'invisibility': now uses Combatant[] return
  - planner.ts 11Q branch: now handles Combatant[] return
  - invisibility_break_on_attack.test.ts: 4 executeInvis → executeInvisSingle
  - invisible_effect.test.ts: 1 execute → executeSingle

Metadata flag flipped:
  - invisibilityUpcastV1Implemented: false → true

New tests (37 assertions in section 8):
  - 8a-8e: target count by slot level + candidate cap
  - 8f-8h: slot consumption (L2 for 1, L3 for 2, L4 for 3)
  - 8i: multi-target priority (lowest-HP% first)
  - 8j: log message includes all target names
  - 8k: per-target breaksOnAttackOrCast flag
  - 8l-8m: backwards compat (shouldCastSingle / executeSingle)

All baseline tests still pass (81 in invisibility, 36 in
invisibility_break_on_attack, 21 in invisible_effect, plus
concentration_enforcement, protection_from_energy, reaction_registry,
concentration_ai, mechanics, engine, combat, dispel_magic,
bulk_spell_dispatch, see_invisibility, scenario, ai).
```

---

## Generic Registry Count

- Unchanged from Session 34: 130 spells in `_generic_registry.ts`.
- The `_reaction_registry.ts` has 6 reaction spells (unchanged from Session 33).

---

## CI Status

- **Before this session:** Latest commit (cb21943, Session 34 + flaky test fixes) was all green (build, test, deploy, report-build-status all `success`).
- **After this session:** To be verified post-commit. The work is a refactor of an existing spell module + 3 test files + 2 engine files. All 81 invisibility assertions pass locally (3 stable runs), and 12 baseline test files pass. No engine paths were modified except the `case 'invisibility':` dispatch (now uses the multi-target return).
