# zHANDOVER — Session 44

**Date:** 2026-06-22
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement items #29, #30, #28, #27, #20 from Session 43's next-session priorities — Bard Extra Attack (Valor/Swords), Thirsting Blade + Extra Attack non-stacking documentation, Multi-creature Conjure spell options, Smarter Action Surge heal-self tactic, and Couatl Shield via reaction_registry. All 5 tasks completed.

---

## Session Summary

Session 44 closed 5 more items from Session 43's priority list. Bard College of Valor/Swords now grants Extra Attack at Bard 6 (via a new SUBCLASS_FEATURES table in the leveler). Thirsting Blade + Extra Attack non-stacking is now documented (SAC v2.7 ruling + known v1 simplification). All 3 multi-target Conjure spells (Animals, Woodland Beings, Minor Elementals) now support the "8 creatures at CR 1/4" PHB option when the bestiary is loaded, capped at 8 per cast. Action Surge now evaluates a heal-self option (surge to cast Cure Wounds when HP < 50%) before falling back to the default extra Attack. The Couatl summon can now cast Shield as a reaction via innate spellcasting (3/day), enabled by extending triggerReactions to accept innate spell uses as an alternative to spell slots.

| Component | Status | Lines |
|-----------|--------|-------|
| **Task #29: Bard Extra Attack (Valor/Swords)** | | |
| `src/characters/leveler.ts` — SUBCLASS_FEATURES table + resolveSubclassFeatures() + getSubclassFeaturesForLevels() | ✅ Done | +82 lines |
| `src/characters/improvements.ts` — chooseSubclass retroactively grants subclass features | ✅ Done | +47 lines |
| `src/test/bard_extra_attack.test.ts` (NEW) — 23 assertions, 16 sections | ✅ Done | ~470 lines |
| **Task #30: Document Thirsting Blade + Extra Attack non-stacking** | | |
| `src/ai/planner.ts` — expanded planner comment with SAC v2.7 ruling + v1 simplification note | ✅ Done | +35 lines (comments only) |
| **Task #28: Multi-creature Conjure spell options** | | |
| `src/summons/summon_picker.ts` — MAX_SUMMONS_PER_CAST, conjureSlotMultiplier(), pickSummonPack(), 3 multi-pickers | ✅ Done | +160 lines |
| `src/spells/conjure_animals.ts` — wire pickConjureAnimalsSummonMulti | ✅ Done | ~50 lines refactored |
| `src/spells/conjure_woodland_beings.ts` — wire pickConjureWoodlandBeingsSummonMulti | ✅ Done | ~50 lines refactored |
| `src/spells/conjure_minor_elementals.ts` — wire pickConjureMinorElementalsSummonMulti | ✅ Done | ~50 lines refactored |
| `src/test/conjure_multi.test.ts` (NEW) — 55 assertions, 20 sections | ✅ Done | ~420 lines |
| **Task #27: Smarter Action Surge tactics (heal-self)** | | |
| `src/ai/planner.ts` — planExtraAction() helper with heal-self + default-attack options | ✅ Done | ~95 lines |
| `src/test/action_surge_heal.test.ts` (NEW) — 26 assertions, 15 sections | ✅ Done | ~530 lines |
| **Task #20: Couatl Shield via reaction_registry** | | |
| `src/spells/conjure_celestial.ts` — Shield action + innate tracking (Shield, Lesser Restoration, Protection from Poison) | ✅ Done | +60 lines |
| `src/engine/combat.ts` — triggerReactions accepts innate spell uses; imported hasInnateSpellUse | ✅ Done | +7 lines |
| `src/spells/shield.ts` — executeReaction consumes innate use as fallback; imported consumeInnateSpellUse | ✅ Done | +8 lines |
| `src/test/couatl_shield_reaction.test.ts` (NEW) — 33 assertions, 15 sections | ✅ Done | ~390 lines |
| `src/test/conjure_celestial.test.ts` — updated action count (5→6) for new Shield action | ✅ Done | +2 lines |

**Total:** ~1200 lines of new/modified code, 137 new test assertions across 3 new test files, plus 1 existing test file updated.

---

## Architecture

### Task #29: Bard Extra Attack (Valor/Swords)

**Problem:** Bard College of Valor (PHB p.55) and College of Swords (XGE p.15) grant Extra Attack at Bard 6, but the leveler only modelled base-class features. `chooseSubclass()` picked a subclass name without granting any subclass features, so `hasFeature(self, 'Extra Attack')` in the planner never matched for Bard subclasses.

**Solution:**
1. Added a `SUBCLASS_FEATURES` table in `leveler.ts`, keyed by `[className][subclassName][level]` → array of feature names. Initial entries: `Bard['College of Valor'][6] = ['Extra Attack']` and `Bard['College of Swords'][6] = ['Extra Attack']`.
2. `resolveSubclassFeatures(className, subclassName, fromLevel, toLevel)` returns the union of features granted in the level range, with alias normalisation: bare "Valor"/"Swords" → "College of Valor"/"College of Swords".
3. Exported `getSubclassFeaturesForLevels()` as the public helper used by both `applyLevelUp` (when subclass is already chosen) and `chooseSubclass` (for retroactive grants).
4. `applyLevelUp` now appends subclass features to `classFeatures` when crossing a threshold level.
5. `chooseSubclass` in `improvements.ts` retroactively grants features for levels the character has already attained — handles the late-subclass-pick case (e.g. a Bard who hit level 7 before picking Valor at level 3).

**End-to-end test result:** Bard 6 Valor deals 2.17× damage vs Bard 6 Lore (Extra Attack working end-to-end through the planner and engine).

### Task #30: Document Thirsting Blade + Extra Attack non-stacking

**Problem:** A Warlock 5 / Fighter 5 multiclass has both Thirsting Blade (sets `attackCount = 2`) and Extra Attack (also sets `attackCount = 2`). The planner's order-dependent check means whichever fires first wins; in current code Thirsting Blade runs first, so the Extra Attack branch skips. RAW they don't stack (SAC v2.7), so the result is correct — but the rationale was undocumented and a future reader could mistakenly think this is a bug.

**Solution:** Pure documentation. Expanded the existing Session 43 Task #24 planner comment block to explain:
- SAC v2.7 ruling: Thirsting Blade and Extra Attack both set the same "attack twice" property; they do NOT add together.
- Known v1 simplification: a Warlock 5 / Fighter 11 gets 2 attacks (Thirsting Blade wins) instead of RAW 3 (Extra Attack (2) should supersede), because the Thirsting Blade check runs first and sets `attackCount = 2`, then the Extra Attack (2) branch sees `attackCount` already set and skips.
- Future improvement: replace the order-dependent guards with a single `maxAttackCount()` helper that returns the highest applicable `attackCount` from any source (Thirsting Blade = 2, Extra Attack = 2, Extra Attack (2) = 3, Extra Attack (3) = 4).

### Task #28: Multi-creature Conjure spell options

**Problem:** Session 43 Task #21 wired bestiary pickers to all 5 Conjure spells but only modelled the "1 creature at max CR" option from the PHB table. The 2/4/8-creature options (e.g. 8 Wolves at CR 1/4 for L3 Conjure Animals) were explicitly out of v1 scope.

**Solution:**
1. Added `MAX_SUMMONS_PER_CAST = 8` constant — a v1.5 simplification. PHB allows up to 16 (L5) and 24 (L7) creatures per cast, but capping at 8 avoids battlefield bloat and keeps the engine tractable.
2. Added `conjureSlotMultiplier(slotLevel)` returning the PHB "At Higher Levels" multiplier: L3-4 → 1×, L5-6 → 2×, L7-9 → 3×.
3. Added `pickSummonPack(maxCR, creatureType, count)` — returns `count` identical `SummonPick` objects (all the same creature species). Used for the "N identical creatures" option.
4. Added 3 multi-creature pickers:
   - `pickConjureAnimalsSummonMulti(slotLevel)` — 8 beasts at CR 1/4
   - `pickConjureWoodlandBeingsSummonMulti(slotLevel)` — 8 fey at CR 1/4
   - `pickConjureMinorElementalsSummonMulti(slotLevel)` — 8 elementals at CR 1/4
5. Updated the 3 Conjure spell execute functions to prefer the multi-picker → single-picker → v1 hardcoded fallback. Spawned creatures are placed in 8 offsets around the caster and named with a `#1..#N` suffix.

**End-to-end test result:** L3 Conjure Animals with a populated bestiary spawns exactly 8 Wolves; L5 Conjure Animals would spawn 16 Wolves but is capped at 8. The single-picker fallback path still works when the bestiary is empty.

### Task #27: Smarter Action Surge tactics (heal-self)

**Problem:** Session 43 Task #23 added Action Surge support but the v1 surge logic always cloned the main Attack action. A low-HP Fighter would surge to attack instead of surging to heal — tactically suboptimal.

**Solution:**
1. Added `planExtraAction(self, plan, target, battlefield)` helper in `planner.ts`. Evaluates surge options in priority order (first match wins):
   - **Option 1 (heal-self):** `self.currentHP < 50% of maxHP` AND `self.actions` has `'Cure Wounds'` AND `hasSpellSlot(self, 1)` → return a Cure Wounds surge action targeting self.
   - **Option 2 (default extra Attack):** `plan.action.type === 'attack'` AND target alive → clone the main Attack action (original v1 behaviour).
2. Refactored the inline surge logic in `planTurn` to call `planExtraAction()`.
3. Important ordering: the heal-self check runs AFTER `planBonusAction`, so if Second Wind already healed the fighter above 50% during the bonus-action phase, the surge-to-heal correctly does NOT fire. This is the intended RAW-correct behaviour.
4. Documented future extension points: surge to Dash when no enemy in reach, surge to cast a defensive spell (Shield of Faith), surge to Disengage when surrounded, surge for a different spell when the main action was Attack.

**End-to-end test result:** A Fighter/Cleric 5 at 49% HP with a Cure Wounds action and a L1 slot surges to cast Cure Wounds on self (HP rises above 50%); a healthy Fighter still surges for an extra Attack.

### Task #20: Couatl Shield via reaction_registry

**Problem:** Session 41 Task #2 added the Couatl summon with innate spellcasting tracked, but only 1 of its 3 innate spells (Shield) was missing an Action object — and even Shield couldn't actually fire because `triggerReactions` checked for spell slots, not innate uses. The Couatl had `innateSpellcasting.Shield = { max: 3, remaining: 3 }` but the reaction pipeline ignored it.

**Solution:**
1. Added a Shield `Action` object to the Couatl in `conjure_celestial.ts`: `costType: 'reaction'`, `slotLevel: 0` (innate), self-buff granting +5 AC until start of next turn. Tracks the 3/day limit via the existing `innateSpellcasting` resource.
2. Added `'Shield'`, `'Lesser Restoration'`, and `'Protection from Poison'` to the Couatl's `resources.innateSpellcasting` (3/day each per MM p.43). Lesser Restoration and Protection from Poison are tracked but have NO Action object — they need condition tracking for blinded/deafened/paralyzed/poisoned, which is out of v1 scope.
3. Updated `triggerReactions` in `combat.ts` to accept innate spell uses as an alternative to spell slots. New gate: `!hasSpellSlot(reactor, spell.level) && !hasInnateSpellUse(reactor, spell.name) → continue`. Imported `hasInnateSpellUse`.
4. Updated `shield.ts` `executeReaction` to consume the innate use when no spell slot is available — mirrors the `cure_wounds.ts` pattern: `if (consumeSpellSlot(caster, 1) === null) { consumeInnateSpellUse(caster, 'Shield'); }`. Imported `consumeInnateSpellUse`.

**End-to-end test result:** A Couatl hit by an attack with an unused reaction and Shield uses remaining casts Shield (AC +5), the attack is negated, and the use counter decrements 3 → 2 → 1 → 0. After all 3 uses are spent, the Couatl no longer casts Shield.

---

## Files Changed

### New files (4)
- `src/test/bard_extra_attack.test.ts` — 23 assertions across 16 sections
- `src/test/conjure_multi.test.ts` — 55 assertions across 20 sections
- `src/test/action_surge_heal.test.ts` — 26 assertions across 15 sections
- `src/test/couatl_shield_reaction.test.ts` — 33 assertions across 15 sections

### Modified files (11)
- `src/characters/leveler.ts` — SUBCLASS_FEATURES table, resolveSubclassFeatures(), getSubclassFeaturesForLevels(), applyLevelUp consults subclass features
- `src/characters/improvements.ts` — chooseSubclass retroactively grants subclass features
- `src/ai/planner.ts` — Task #30 expanded comment, planExtraAction() helper for Task #27
- `src/summons/summon_picker.ts` — MAX_SUMMONS_PER_CAST, conjureSlotMultiplier(), pickSummonPack(), 3 multi-pickers
- `src/spells/conjure_animals.ts` — wire pickConjureAnimalsSummonMulti
- `src/spells/conjure_woodland_beings.ts` — wire pickConjureWoodlandBeingsSummonMulti
- `src/spells/conjure_minor_elementals.ts` — wire pickConjureMinorElementalsSummonMulti
- `src/spells/conjure_celestial.ts` — Shield Action + innate tracking for Couatl
- `src/engine/combat.ts` — triggerReactions accepts innate spell uses; imported hasInnateSpellUse
- `src/spells/shield.ts` — executeReaction consumes innate use as fallback; imported consumeInnateSpellUse
- `src/test/conjure_celestial.test.ts` — updated action count (5→6) for new Shield action

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `couatl_innate_spellcasting.test.ts` | ✅ All pass |
| `couatl_shield_reaction.test.ts` (33 assertions) | ✅ All pass |
| `shield_reaction.test.ts` | ✅ All pass |
| `reaction_registry.test.ts` | ✅ All pass |
| `shield_simple.test.ts` | ✅ All pass |
| `conjure_celestial.test.ts` | ✅ All pass |
| `bestiary_integration.test.ts` | ✅ All pass |
| `silvery_barbs.test.ts` | ✅ All pass |
| `silvery_barbs_ability_check.test.ts` | ✅ All pass |
| `silvery_barbs_save_success.test.ts` | ✅ All pass |
| `silvery_barbs_counterspell_dispel.test.ts` | ✅ All pass |
| `counterspell.test.ts` | ✅ All pass |
| `absorb_elements.test.ts` | ✅ All pass |
| `combat.test.ts` | ✅ All pass |
| `engine.test.ts` | ✅ All pass |
| `action_surge.test.ts` | ✅ All pass |
| `action_surge_heal.test.ts` (26 assertions) | ✅ All pass |
| `bard_extra_attack.test.ts` (23 assertions) | ✅ All pass |
| `conjure_multi.test.ts` (55 assertions) | ✅ All pass |
| `extra_attack.test.ts` | ✅ All pass |
| `thirsting_blade.test.ts` | ✅ All pass |
| Baseline tests (ai, integration, mechanics, parser, pc, resources, scenario, character_improvements, character_leveler, character_builder, character_storage, cantrip_pipeline, cantrip_planner, concentration_enforcement, protection_from_energy, dispel_magic, conjure_animals, conjure_elemental, conjure_fey, conjure_minor_elementals, conjure_woodland_beings, summons) | ✅ All pass — no regressions |

---

## CI Status

- **Task #29 commit (dff87f2):** deploy `success` ✅ / report-build-status `success` ✅ / build `success` ✅ / test `success` ✅
- **Task #30 commit (ac64d58):** deploy `success` ✅ / report-build-status `success` ✅ / build `success` ✅ / test `success` ✅
- **Task #28 commit (e64914a):** deploy `success` ✅ / report-build-status `success` ✅ / build `success` ✅ / test `success` ✅
- **Task #27 commit (4397884):** deploy `success` ✅ / report-build-status `success` ✅ / build `success` ✅ / test `success` ✅
- **Task #20 commit (6289306):** deploy `success` ✅ / report-build-status `success` ✅ / build `success` ✅ / test `success` ✅
- **Handover commit (2d557e1):** test `success` ✅ (all 333 test files pass)
- **Final state:** ALL GREEN ✅ on latest commit (2d557e1) — no red X's across any Session 44 commit. Verified via GitHub Actions API: all 6 commits (dff87f2, ac64d58, e64914a, 4397884, 6289306, 2d557e1) have `test=success` with zero failures.

---

## Next Session Priorities

(Updated from Session 43 — items 29, 30, 28, 27, 20 now closed by Session 44.)

22. **Devil's Sight invocation** (continuation of Task #16) — Still deferred. See in magical darkness 120 ft. Requires LOS engine changes for magical darkness (out of v1 scope; deferred until LOS system supports it).

27-follow-up. **Extend planExtraAction with more surge options** (NEW — surfaced by Session 44 Task #27) — Current implementation handles 2 options (heal-self + default Attack). Future: surge to Dash when no enemy in reach, surge to cast defensive spell like Shield of Faith, surge to Disengage when surrounded, surge for a different spell when main action was Attack.

28-follow-up. **Raise MAX_SUMMONS_PER_CAST above 8** (NEW — surfaced by Session 44 Task #28) — PHB allows 16/24 creatures at L5/L7 but v1.5 caps at 8 to avoid battlefield bloat. Raise the cap once the engine supports batched summon turn-resolution.

29-follow-up. **Add more subclass features to SUBCLASS_FEATURES table** (NEW — surfaced by Session 44 Task #29) — Only Bard Valor/Swords Extra Attack is currently in the table. Future: Battle Master maneuvers (Fighter 3), Land Circle ritual casting (Druid 2), Monk tradition features (Way of Open Hand, etc.).

20-follow-up. **Add condition tracking for Lesser Restoration + Protection from Poison** (NEW — surfaced by Session 44 Task #20) — The Couatl now tracks these innate uses but has no Action to cast them. Needs blinded/deafened/paralyzed/poisoned conditions modelled in the engine so the Couatl can reactively remove them from allies.

30-follow-up. **Replace order-dependent Thirsting Blade + Extra Attack guards with maxAttackCount() helper** (NEW — surfaced by Session 44 Task #30) — Currently Thirsting Blade check runs first and sets `attackCount = 2`, then Extra Attack (2) skips because `attackCount` is set. Future: a `maxAttackCount()` helper that returns the highest applicable `attackCount` from any source (so a Warlock 5 / Fighter 11 correctly gets 3 attacks).

---

## Commit Log (Session 44)

```
Session 44 Task #29: Bard Extra Attack (Valor/Swords)
  - SUBCLASS_FEATURES table in leveler.ts (Bard College of Valor/Swords)
  - resolveSubclassFeatures() with alias normalisation (Valor/Swords)
  - getSubclassFeaturesForLevels() exported helper
  - applyLevelUp now adds subclass features when subclass is chosen
  - chooseSubclass retroactively grants features for already-attained levels
  - 23 test assertions across 16 sections

Session 44 Task #30: Document Thirsting Blade + Extra Attack non-stacking
  - Expanded planner comment with SAC v2.7 ruling
  - Documented known v1 simplification (Warlock 5/Fighter 11)
  - Noted future maxAttackCount() helper
  - Pure documentation change

Session 44 Task #28: Multi-creature Conjure spell options
  - MAX_SUMMONS_PER_CAST = 8 cap (v1.5 simplification)
  - conjureSlotMultiplier() — PHB At Higher Levels multiplier (1×/2×/3×)
  - pickSummonPack() helper returns N identical SummonPick
  - 3 multi-creature pickers (Animals, Woodland Beings, Minor Elementals)
  - All 3 Conjure spells prefer multi-picker → single-picker → v1 fallback
  - 55 test assertions across 20 sections

Session 44 Task #27: Smarter Action Surge tactics (heal-self)
  - planExtraAction() helper evaluates multiple surge options
  - Option 1: heal-self (HP < 50% + has Cure Wounds + slot available)
  - Option 2: default extra Attack (original v1 behaviour)
  - 26 test assertions across 15 sections

Session 44 Task #20: Couatl innate spells — Shield via reaction_registry
  - Shield action added to Couatl (innate 3/day, reaction, +5 AC)
  - Lesser Restoration + Protection from Poison tracked (no Action yet)
  - triggerReactions accepts innate spell uses as alternative to slots
  - shield.ts executeReaction consumes innate use as fallback
  - 33 test assertions across 15 sections
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged).
- `_reaction_registry.ts`: 6 reaction spells (unchanged; Shield now works for innate casters like the Couatl via the `hasInnateSpellUse` fallback in `triggerReactions`).
- `_invocations.ts`: 7 Eldritch Invocations (unchanged).
- `WARLOCK_INVOCATION_SLOTS`: 21 entries (unchanged).
- `summon_picker.ts`: 10 picker functions (was 6 — added `pickSummonPack`, `conjureSlotMultiplier`, `pickConjureAnimalsSummonMulti`, `pickConjureWoodlandBeingsSummonMulti`, `pickConjureMinorElementalsSummonMulti`; plus the `MAX_SUMMONS_PER_CAST` constant).
