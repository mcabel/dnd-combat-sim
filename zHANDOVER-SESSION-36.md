# zHANDOVER — Session 36

**Date:** 2026-06-21
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Close the two remaining Protection from Energy v1 simplifications from Session 34: (1) upcast +1 target per slot level above 3rd (PHB p.266 "At Higher Levels"), and (2) the innate-resistance edge case where the sentinel's cleanup would wrongly remove an innate resistance entry. Plus a minor TEAMGOALS.md doc cleanup for Conjure Barrage/Volley.

---

## Session Summary

Session 35 closed the Invisibility upcast (the last v1 simplification on Invisibility). Session 36 continues closing v1 simplifications by implementing the Protection from Energy upcast AND fixing the innate-resistance edge case that Session 34 had documented as a known simplification. A minor doc cleanup for Conjure Barrage/Volley (deferred from Session 31) is also included.

| Component | Status | Lines |
|-----------|--------|-------|
| `protection_from_energy.ts` — refactored execute to multi-target upcast + innate-resistance fix; added collectCandidates / executeWithTargets / findHighestSlot helpers; kept pickTarget + executeWithTarget as backwards-compat | ✅ Done | ~370 lines (rewrite, was ~280) |
| `protection_from_energy.test.ts` — updated test 12 (innate resistance now PRESERVED), added section 14 (upcast, 15 sub-tests) + section 15 (innate-resistance fix, 4 sub-tests) | ✅ Done | +430 lines (117 assertions, was 52) |
| `types/core.ts` — added optional `payload.addedResistance?: boolean` field | ✅ Done | +12 lines |
| `spell_effects.ts` — `_undoEffect` 'Protection from Energy' case now checks `addedResistance !== false` (default true for legacy sentinels) | ✅ Done | ~10 lines (comment + 1-line guard) |
| `TEAMGOALS.md` — Conjure Barrage/Volley doc clarification (AoE damage spells, NOT summons, NOT blocked by TG-006) | ✅ Done | 4 lines changed |
| Metadata flag flips: `protectionFromEnergyUpcastV1Implemented` false→true; new `protectionFromEnergyInnateResistanceFixV1Implemented: true` | ✅ Done | 2 lines |

**Total:** ~860 lines of new/modified code, 65 new test assertions (117 total in protection_from_energy.test.ts, up from 52).

---

## Architecture

### Design decision: keep the generic-registry shape

Session 35's Invisibility upcast changed `shouldCast` to return `Combatant[] | null` and `execute` to take `targets: Combatant[]`, because Invisibility has its own bespoke `case 'invisibility':` dispatch in `combat.ts` (it is NOT in the generic registry).

Protection from Energy, by contrast, IS dispatched via `case 'genericSpell':` in `combat.ts`, which expects:
```typescript
if (desc.shouldCast(actor, bf)) {   // boolean
  desc.execute(actor, state);        // (caster, state) — re-queries
}
```

**Decision:** Keep the generic-registry shape (`shouldCast → boolean`, `execute(caster, state) → void`). Multi-target selection lives entirely inside `execute`, which re-queries the live battlefield for the candidate list + highest slot. This avoids touching `combat.ts`, `planner.ts`, and the `_generic_registry.ts` entry signature — a much smaller blast radius than the Invisibility refactor.

This is the **Protection from Energy pattern** (generic-registry multi-target upcast), distinct from the **Prayer of Healing / Invisibility pattern** (bespoke multi-target dispatch). Future spells already in the generic registry that need upcast should prefer this approach.

### Multi-target upcast mechanic (PHB p.266 "At Higher Levels")

**Key design decisions:**

1. **`execute` derives slot level from target count** — `desiredSlotLevel = min(9, 3 + (targets.length - 1))`. 1 target → L3, 2 → L4, 3 → L5, etc. This matches PHB p.266: "When you cast this spell using a spell slot of 4th level or higher, you can target one additional creature for each slot level above 3rd."

2. **AI heuristic for slot selection** — "greedy on allies, no waste":
   - `findHighestSlot(caster)` returns the highest available L3+ slot (checks standard slots L3-L9, then pact slots).
   - `maxTargetsFromSlot = 1 + max(0, highestSlot - 3)` (L3→1, L4→2, L5→3, ...).
   - `targetCount = min(candidates.length, maxTargetsFromSlot)` (capped at candidates — no waste).
   - The actual slot consumed is decided in `executeWithTargets` based on the target count returned (`3 + (targets.length - 1)`), so if only 2 candidates are in range with an L5 slot available, the caster consumes L4 (not L5).

3. **Self excluded from multi-target list when allies present** — `collectCandidates` always includes self (sorted last, matching `pickTarget`'s "self as fallback" design). But `execute` filters self OUT when allies are available, so the AI targets N allies (not self) when upcasting. Self is only targeted when the caster is alone (fallback). Rationale: allies (especially tanks) benefit more from resistance; self-targeting via upcast would waste a slot that an ally could use.

4. **All N targets share the SAME damage type** — PHB p.266: "one damage type of your choice" (singular). `pickDamageType` is called ONCE in `execute`, and the result is passed to `executeWithTargets` which applies it to all targets.

5. **Per-target sentinels** — Each target gets its own `damage_zone` sentinel (dieCount=0) sourced from the caster with `sourceIsConcentration: true`. When concentration breaks, `removeEffectsFromCaster` removes ALL N sentinels in one sweep. Each sentinel's `_undoEffect` case independently checks its own `addedResistance` flag (see innate-resistance fix below).

### Innate-resistance edge case fix (Session 34 v1 simplification)

**The bug (Session 34 documented simplification):** If a target has INNATE resistance to the same type the spell grants (e.g. a fire-resistant race + Protection from Energy: fire), the spell's idempotent push (`if (!target.resistances.includes(damageType)) push`) is a no-op — no new entry is added. But the sentinel's cleanup (`_undoEffect`'s 'Protection from Energy' case) would unconditionally splice the FIRST matching entry from `target.resistances`, which was the INNATE entry — wrongly removing the innate resistance on concentration break.

**The fix (Session 36):** Track whether the spell actually added the resistance entry, via a new `addedResistance` flag on the sentinel's payload:

- In `executeWithTargets`, for each target:
  - If `!target.resistances.includes(damageType)` → push it, set `addedResistance: true`.
  - If already present (innate) → don't push (idempotent), set `addedResistance: false`.

- In `_undoEffect`'s 'Protection from Energy' case:
  - `const added = effect.payload.addedResistance !== false;` (default true for legacy sentinels).
  - Only splice if `added === true`.

**Backwards compat:** Legacy sentinels (pre-Session 36, from saved game states) have `addedResistance === undefined`, which the guard treats as `true` (the original Session 34 behavior — unconditional splice). This preserves the old behavior for existing saves while fixing the edge case for new casts.

### Backwards-compat wrappers retained

- **`pickTarget(caster, bf) → Combatant | null`** — unchanged signature. Returns the first candidate from `collectCandidates` (lowest-HP% ally, or self as fallback). Used by tests 2-5 and any legacy callers.
- **`executeWithTarget(caster, target, state, damageType) → void`** — backwards-compat wrapper around `executeWithTargets(caster, [target], state, damageType)`. Used by tests 9-13 and any legacy callers expecting single-target semantics (1 target → L3, no upcast).
- **`shouldCast(caster, bf) → boolean`** — unchanged signature (generic-registry shape). Internally checks `collectCandidates(caster, bf).length > 0`.

---

## Files Changed

### Modified files (6)
- `src/spells/protection_from_energy.ts` — Refactored to multi-target upcast:
  - `execute(caster, state)` now: finds highest slot, collects candidates (excludes self when allies present), picks target count, picks damage type once, calls `executeWithTargets`
  - Added `executeWithTargets(caster, targets, state, damageType)` — multi-target impl, derives slot level from target count, applies resistance + sentinel per target with `addedResistance` flag
  - Added `collectCandidates(caster, bf)` — shared helper (extracted from `pickTarget`), sorts by (allies first, lowest HP%, closest, self LAST)
  - Added `findHighestSlot(caster)` — returns highest available L3+ slot (standard + pact)
  - Kept `pickTarget` (returns first candidate) + `executeWithTarget` (wraps `executeWithTargets([target])`) as backwards-compat
  - Flipped `protectionFromEnergyUpcastV1Implemented: false → true`
  - Added `protectionFromEnergyInnateResistanceFixV1Implemented: true`
  - Updated module header comments

- `src/test/protection_from_energy.test.ts` — Updated tests + added upcast + innate-resistance sections:
  - Flipped metadata assertions: `'upcast NOT implemented (v1)'` → `'upcast NOW implemented (Session 36)'`; added innate-resistance-fix flag assertion
  - Rewrote section 12 (innate resistance): was a "documented v1 simplification" (innate MAY be removed); now verifies the FIX (innate PRESERVED, sentinel `addedResistance === false`, fire damage still halved after break)
  - Added section 14 "Upcast — multi-target selection" with 15 sub-tests (14a-14o)
  - Added section 15 "Innate-resistance fix — addedResistance flag" with 4 sub-tests (15a-15d)
  - Added `withSlotsMulti` helper + `countProtected` helper

- `src/types/core.ts` — Added optional `payload.addedResistance?: boolean` field to `ActiveEffect` (documented with the 3-state semantics: true/false/undefined)

- `src/engine/spell_effects.ts` — Updated `_undoEffect` 'Protection from Energy' case:
  - Now reads `effect.payload.addedResistance`; only splices the resistance if `addedResistance !== false` (default true for legacy sentinels)
  - Updated comment block to document the Session 36 fix + backwards-compat behavior

- `src/test/shillelagh.test.ts` — Flaky-test fix (surfaced by CI on Session 36 commit):
  - Test 13c (`dmgWithBuff > dmgNoBuff`) compared two independent crit rolls (buffed 2d6+2d8 ∈ [4,28] vs unbuffed 2d6 ∈ [2,12]); failed ~5-10% of runs when unbuffed rolled high (12) and buffed rolled low (4)
  - Replaced with a deterministic bludgeoning-component check: `dmgWithBuff - radiantBonus` ∈ [2,12] (same range as unbuffed crit), proving radiant was ADDED on top, not replacing bludgeoning
  - Moved `shillelaghBonusLog` lookup before 13c so the radiant bonus amount is available
  - This is a PRE-EXISTING flaky test (Session 36 changes don't touch shillelagh); matches the repo's established flaky-fix pattern (6c07edb mechanics, cb21943 mount/reverse_gravity)
  - Verified: 0 failures in 30 local runs (was ~10% failure rate)

- `TEAMGOALS.md` — Conjure Barrage/Volley doc clarification:
  - Re-categorization note (line 200): clarified that these are AoE damage spells, NOT summons, NOT blocked by TG-006, and have NO spell module yet (the earlier "should be moved to generic registry immediately" note was premature)
  - Phase 2 note (line 205): removed the stale "re-categorize as damage" parenthetical
  - Blocked spells L3 list: removed Conjure Barrage (was "[re-categorize as damage]"), count 8→7
  - Blocked spells L5 list: removed Conjure Volley (was "[re-categorize as damage]")

---

## Test Coverage (65 new assertions)

### Section 14 — Upcast multi-target selection (15 sub-tests, ~40 assertions)

| Test | Description |
|------|-------------|
| 14a | L3 slot only + 2 allies → 1 target (no upcast); L3 consumed |
| 14b | L4 slot + 2 allies → 2 targets (upcast by 1); L4 consumed |
| 14c | L5 slot + 3 allies → 3 targets; L5 consumed |
| 14d | L5 slot but only 2 allies in range → 2 targets (capped at candidates, no waste); far ally NOT protected |
| 14e | L4 slot but only 1 ally → 1 target (capped); L4 consumed (fallback from L3) |
| 14f | executeWithTargets 2 targets → L4 consumed, L3 NOT consumed |
| 14g | executeWithTargets 3 targets → L5 consumed, L3/L4 NOT consumed |
| 14h | executeWithTargets 1 target → L3 consumed (no upcast), L4 NOT consumed |
| 14i | Multi-target priority: lowest-HP% ally (wounded at 20%) picked first |
| 14j | Log message includes all target names (Alice, Bob) + "2 creatures" |
| 14k | Each target gets its own sentinel with correct damageType, sourceIsConcentration, casterId |
| 14l | executeWithTarget (singular) applies to 1 target only (backwards compat); L3 consumed |
| 14m | All targets share the SAME damage type (cold picked from enemy, not fire default) |
| 14n | Self-fallback: caster alone + L5 slot → targets self, consumes L3 (no waste on single target) |
| 14o | Self excluded when allies present: caster + 1 ally + L4 → ally protected, caster NOT protected |

### Section 15 — Innate-resistance fix (4 sub-tests, ~12 assertions)

| Test | Description |
|------|-------------|
| 15a | Target WITHOUT innate resistance → `addedResistance === true`; entry REMOVED on break |
| 15b | Target WITH innate resistance → `addedResistance === false`; innate PRESERVED on break |
| 15c | Multi-target mix (innate + fresh): both sentinels correct; cleanup preserves innate on one, removes granted on the other |
| 15d | Backwards compat: legacy sentinel with `addedResistance === undefined` still splices (original Session 34 behavior) |

### Updated section 12 (innate resistance — was v1 simplification, now verified fix)

Test 12 was rewritten from a "documented v1 simplification" (innate MAY be removed, not asserted) to a verified fix:
- 12a: resistances array still has 1 fire entry (idempotent)
- 12b: sentinel effect attached
- 12c: sentinel `payload.addedResistance === false` (innate, no push)
- 12d: sentinel removed after break
- 12e: innate fire resistance PRESERVED after break (Session 36 fix)
- 12f: resistances array still has exactly 1 fire entry
- 12g: fire damage STILL halved after break (innate resistance intact, 40 → 20)

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `protection_from_energy.test.ts` (117 assertions: 52 original + 65 new) | ✅ All pass (3 stable runs) |
| Baseline tests (concentration_enforcement 34, invisibility 81, invisibility_break_on_attack 36, invisible_effect 21, dispel_magic 47, mechanics 57, combat 47, engine 71, cloud_of_daggers 97, flaming_sphere 104, moonbeam 107, spike_growth 103, spirit_guardians 75, reaction_registry 74, shield_reaction 39, absorb_elements 61, hellish_rebuke 26, counterspell 35, feather_fall 28, silvery_barbs 22, bless 37, hex 27, witch_bolt 53, summon_beast 78, conjure_animals 135, scenario 94, ai 26, bulk_spell_dispatch 214, see_invisibility 34, reverse_gravity 57, watery_sphere 36, shillelagh 60 [flaky 13c fixed, 0/30 stable]) | ✅ All pass — no regressions |

---

## How to Add a Generic-Registry Multi-Target Upcast Spell (Template)

This is the **Protection from Energy pattern** (distinct from the Invisibility/Prayer of Healing bespoke-dispatch pattern). Use this when the spell is ALREADY in `_generic_registry.ts` and dispatched via `case 'genericSpell':`.

1. **Keep `shouldCast(caster, bf): boolean`** (generic-registry shape, unchanged):
   ```typescript
   export function shouldCast(caster: Combatant, bf: Battlefield): boolean {
     if (!caster.actions.some(a => a.name === 'My Spell')) return false;
     if (!hasSpellSlot(caster, baseLevel)) return false;
     if (caster.concentration?.active) return false;
     return collectCandidates(caster, bf).length > 0;
   }
   ```

2. **`execute(caster, state)` does the multi-target selection** (re-queries live battlefield):
   ```typescript
   export function execute(caster: Combatant, state: EngineState): void {
     const allCandidates = collectCandidates(caster, state.battlefield);
     if (allCandidates.length === 0) return;
     const highestSlot = findHighestSlot(caster);
     if (highestSlot === 0) return;
     // Optional: exclude self when allies present (allies-first design)
     const allies = allCandidates.filter(e => e.c.id !== caster.id);
     const candidates = allies.length > 0 ? allies : allCandidates;
     const maxTargets = 1 + Math.max(0, highestSlot - baseLevel);
     const targetCount = Math.min(candidates.length, maxTargets);
     const targets = candidates.slice(0, targetCount).map(e => e.c);
     executeWithTargets(caster, targets, state, /* picked options */);
   }
   ```

3. **`executeWithTargets` derives slot level from target count**:
   ```typescript
   export function executeWithTargets(caster, targets, state, ...opts): void {
     if (targets.length === 0) return;
     const desiredSlotLevel = Math.min(9, baseLevel + (targets.length - 1));
     consumeSpellSlot(caster, desiredSlotLevel);
     // ... start concentration, apply effect to each target ...
   }
   ```

4. **Backwards compat** (optional, for legacy callers):
   ```typescript
   export function executeWithTarget(caster, target, state, ...opts): void {
     executeWithTargets(caster, [target], state, ...opts);
   }
   ```

5. **No changes to `combat.ts` / `planner.ts` / `_generic_registry.ts`** — the `case 'genericSpell':` dispatch already calls `shouldCast` (boolean) + `execute(caster, state)`.

6. **Flip the metadata flag** `xxxUpcastV1Implemented: false → true`.

---

## Next Session Priorities

(Updated from Session 35 — items 10 and 11 now closed by Session 36.)

1. **Repelling Blast invocation** (deferred from Session 32) — needs Warlock invocations subsystem. The `pushAway()` infrastructure already exists.

2. **More innate spellcasting for summons** (continuation of Session 32 Task #6) — Couatl: add innate spellcasting (bless, cure wounds, lesser restoration, protection from poison, etc.) as Action objects.

3. **Bestiary integration** (deferred from Session 31) — Wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the Conjure spell upcast paths.

4. **~~Conjure Volley / Conjure Barrage re-categorization~~** ✅ DONE (Session 36) — TEAMGOALS.md clarified; they are AoE damage spells, NOT summons, NOT blocked by TG-006.

5. **~~Invisibility upcast~~** ✅ DONE (Session 35).

6. **~~Concentration enforcement~~** ✅ DONE (Session 34) — TG-002 closed.

7. **Shield Magic Missile blocking** (v1 simplification from Session 33) — currently Shield only fires on attack hits, not on Magic Missile auto-hits. Would require adding a separate "targeted by Magic Missile" trigger or reworking the auto-hit branch.

8. **Silvery Barbs save-success trigger** (v1 simplification from Session 33) — currently only triggers on attack hits. The save-success and ability-check-success triggers would need new trigger points in `rollSave` and ability-check resolution.

9. **~~Protection from Energy~~** ✅ DONE (Session 34) — TG-008 fully closed.

10. **~~Protection from Energy upcast~~** ✅ DONE (Session 36) — +1 target per slot level above 3rd now modelled (generic-registry multi-target pattern).

11. **~~Protection from Energy innate-resistance edge case~~** ✅ DONE (Session 36) — `addedResistance` flag on sentinel payload; `_undoEffect` guards the splice; innate resistance PRESERVED on concentration break.

12. **Greater Invisibility upcast** — Greater Invisibility (L4) has NO upcast entry in PHB (it's self-only, single-target). No action needed; documented for completeness.

---

## Commit Log (Session 36)

```
Session 36: Protection from Energy upcast + innate-resistance fix

Upcast (PHB p.266 "At Higher Levels"):
  - +1 target per slot level above 3rd now modelled
  - L3 slot -> 1 target, L4 -> 2, L5 -> 3, etc.
  - Formula: targetCount = 1 + max(0, slotLevel - 3)
  - AI heuristic: greedy on allies -- uses highest available slot
    when multiple candidates are in touch range, capped at candidate
    count (no waste). Self excluded from multi-target list when allies
    are present (self is fallback only, matching pickTarget design).
  - Generic-registry shape preserved (shouldCast -> boolean,
    execute(caster, state)) -- no changes to combat.ts / planner.ts /
    _generic_registry.ts dispatch. Multi-target selection lives
    entirely inside execute, which re-queries the live battlefield.
  - Slot consumed derived from target count in executeWithTargets:
    desiredSlotLevel = 3 + (targets.length - 1).
  - All N targets share the SAME damage type (PHB: "one damage type
    of your choice" -- singular), picked once via pickDamageType.
  - Each target gets its own damage_zone sentinel (dieCount=0)
    sourced from the caster; removeEffectsFromCaster removes all N
    in one sweep on concentration break.

Innate-resistance edge case fix (v1 simplification from Session 34):
  - If target has INNATE resistance to the same type the spell grants,
    the spell's idempotent push is a no-op AND the sentinel now records
    addedResistance: false in its payload.
  - _undoEffect's 'Protection from Energy' case checks this flag and
    does NOT splice the innate entry on concentration break.
  - Pre-Session 36 behavior (unconditional splice) preserved for
    legacy sentinels with addedResistance === undefined (backwards
    compat for saved game states).
  - New metadata flag: protectionFromEnergyInnateResistanceFixV1Implemented

Added backwards-compat wrappers:
  - executeWithTarget (singular) -> wraps executeWithTargets([target])
  - pickTarget (unchanged) -> returns first candidate from collectCandidates
  - collectCandidates (new internal helper, shared sort logic)

Files changed:
  - src/types/core.ts: added optional payload.addedResistance?: boolean
  - src/engine/spell_effects.ts: _undoEffect PfE case checks
    addedResistance !== false (default true for legacy sentinels)
  - src/spells/protection_from_energy.ts: multi-target refactor +
    innate-resistance fix + metadata flag flips
  - src/test/protection_from_energy.test.ts: updated test 12
    (innate resistance now PRESERVED, was v1 simplification) +
    new section 14 (upcast, 15 sub-tests 14a-14o) + new section 15
    (innate-resistance fix, 4 sub-tests 15a-15d)
  - TEAMGOALS.md: Conjure Barrage/Volley doc clarification
    (they are AoE damage spells, NOT summons, NOT blocked by TG-006;
    the stale "should be moved to generic registry" note is corrected)

Metadata flag flipped:
  - protectionFromEnergyUpcastV1Implemented: false -> true
  - protectionFromEnergyInnateResistanceFixV1Implemented: true (new)

New tests (65 new assertions, 117 total -- up from 52):
  - 14a-14o: upcast target count by slot level, candidate cap,
    slot consumption (L3 for 1, L4 for 2, L5 for 3), multi-target
    priority (lowest-HP% first), log message, per-target sentinels,
    backwards compat (executeWithTarget), shared damage type,
    self-fallback when alone, self-excluded when allies present
  - 15a-15d: addedResistance flag (true for spell-granted, false for
    innate), multi-target mix (one innate + one fresh), legacy
    sentinel (addedResistance undefined) backwards compat

All baseline tests still pass (no regressions): protection_from_energy
(117, was 52), concentration_enforcement (34), invisibility (81),
invisibility_break_on_attack (36), invisible_effect (21), dispel_magic
(47), mechanics (57), combat (47), engine (71), cloud_of_daggers (97),
flaming_sphere (104), moonbeam (107), spike_growth (103),
spirit_guardians (75), reaction_registry (74), shield_reaction (39),
absorb_elements (61), hellish_rebuke (26), counterspell (35),
feather_fall (28), silvery_barbs (22), bless (37), hex (27),
witch_bolt (53), summon_beast (78), conjure_animals (135), scenario
(94), ai (26), bulk_spell_dispatch (214), see_invisibility (34),
reverse_gravity (57), watery_sphere (36).

tsc --noEmit: 0 errors.
```

---

## Generic Registry Count

- Unchanged from Session 35: 130 spells in `_generic_registry.ts`.
- The `_reaction_registry.ts` has 6 reaction spells (unchanged from Session 33).
- No new spell modules added this session (Protection from Energy was already registered in Session 34).

---

## CI Status

- **Before this session:** Latest commit (6c07edb, Session 35 + flaky grapple fix) was green (Test Suite `success`, pages build `success`).
- **Session 36 commit (b2cfb65):** Test Suite `failure` ❌ — a PRE-EXISTING flaky test (`shillelagh.test.ts` test 13c) surfaced. Session 36's changes do NOT touch shillelagh; the flake is a statistical comparison (`dmgWithBuff > dmgNoBuff` between two independent crit rolls, ~5-10% failure rate). The prior green run on 6c07edb got lucky.
- **Flaky-test fix commit (f283ad5):** Replaced the flaky 13c with a deterministic bludgeoning-component check. Verified 0 failures in 30 local runs (was ~10%). Test Suite `success` ✅, pages build `success` ✅.
- **Handover commit (f7f3352 — this file):** Test Suite `success` ✅. No code changes (markdown-only), so the green result from f283ad5 carries forward.
- **Final state:** All green on the latest commit (f7f3352). The red X on b2cfb65 was a pre-existing flaky test, not a regression from Session 36's changes; it is fixed by f283ad5 and verified green on both f283ad5 and f7f3352.
