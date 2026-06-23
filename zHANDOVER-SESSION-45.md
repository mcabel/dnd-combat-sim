# zHANDOVER — Session 45

**Date:** 2026-06-23
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement all 5 follow-up items from Session 44's next-session priorities — maxAttackCount() helper (Task #30-follow-up), expanded subclass features + Champion crit range (Task #29-follow-up), Dash + Disengage surge options (Task #27-follow-up), Couatl Lesser Restoration + Protection from Poison (Task #20-follow-up), and raise MAX_SUMMONS_PER_CAST to 16 (Task #28-follow-up). All 5 tasks completed.

---

## Session Summary

Session 45 closed all 5 follow-up items from Session 44's priority list. The maxAttackCount() helper fixes a known v1 simplification where a Warlock 5 / Fighter 11 multiclass only got 2 attacks (Thirsting Blade won) instead of the correct RAW 3 attacks (Extra Attack (2) supersedes per SAC v2.7). The SUBCLASS_FEATURES table was expanded with 4 new subclasses (Fighter Champion, Druid Circle of the Land, Monk Way of the Open Hand, Sorcerer Draconic Bloodline), and the Champion's Improved Critical / Superior Critical features are now mechanically wired into the engine's attack roll (crit range 19-20 / 18-20 for weapon attacks). Action Surge now evaluates 2 new surge options: Dash (close distance when no enemy in reach) and Disengage (retreat when surrounded and low HP). The Couatl summon can now actually cast Lesser Restoration and Protection from Poison via its innate spellcasting (3/day each). And the Conjure spell spawn cap was raised from 8 to 16, allowing L5-6 upcasts to produce the full PHB-accurate 16 creatures.

| Component | Status | Lines |
|-----------|--------|-------|
| **Task #30-follow-up: maxAttackCount() helper** | | |
| `src/ai/planner.ts` — maxAttackCount() helper + replaced 2 inline guard blocks | ✅ Done | +60 lines, -85 lines |
| `src/test/max_attack_count.test.ts` (NEW) — 22 assertions, 14 sections | ✅ Done | ~470 lines |
| **Task #29-follow-up: Expanded subclass features + Champion crit range** | | |
| `src/characters/leveler.ts` — SUBCLASS_FEATURES expanded with 4 subclasses (18 new feature entries) + alias normalisation | ✅ Done | +180 lines |
| `src/engine/utils.ts` — rollAttack() accepts optional critRange parameter | ✅ Done | +15 lines |
| `src/engine/combat.ts` — weapon-attack path computes critRange from Champion features; crit always hits | ✅ Done | +20 lines |
| `src/test/subclass_features.test.ts` (NEW) — 37 assertions, 24 sections | ✅ Done | ~580 lines |
| **Task #27-follow-up: Dash + Disengage surge options** | | |
| `src/ai/planner.ts` — planExtraAction() Option 2 (Dash) + Option 3 (Disengage) + redundant-Disengage guard | ✅ Done | +95 lines |
| `src/test/action_surge_dash_disengage.test.ts` (NEW) — 18 assertions, 14 sections | ✅ Done | ~510 lines |
| **Task #20-follow-up: Couatl Lesser Restoration + Protection from Poison** | | |
| `src/spells/lesser_restoration.ts` — shouldCast accepts innate uses; execute consumes innate fallback | ✅ Done | +15 lines |
| `src/spells/protection_from_poison.ts` — same innate-aware updates | ✅ Done | +15 lines |
| `src/spells/conjure_celestial.ts` — 2 new Action objects on Couatl (8 actions total, was 6) | ✅ Done | +60 lines |
| `src/test/couatl_condition_spells.test.ts` (NEW) — 39 assertions, 22 sections | ✅ Done | ~430 lines |
| `src/test/conjure_celestial.test.ts` — updated action count 6→8 | ✅ Done | +4 lines |
| `src/test/couatl_shield_reaction.test.ts` — updated 2 assertions (NO Action → HAS Action) | ✅ Done | +10 lines |
| **Task #28-follow-up: Raise MAX_SUMMONS_PER_CAST to 16** | | |
| `src/summons/summon_picker.ts` — MAX_SUMMONS_PER_CAST 8 → 16 | ✅ Done | +12 lines |
| `src/spells/conjure_animals.ts` — expanded spawn offsets 8 → 16 | ✅ Done | +4 lines |
| `src/spells/conjure_woodland_beings.ts` — same offsets expansion | ✅ Done | +4 lines |
| `src/spells/conjure_minor_elementals.ts` — same offsets expansion | ✅ Done | +4 lines |
| `src/test/conjure_multi.test.ts` — updated L5/L7/L9 assertions 8 → 16 | ✅ Done | +10 lines |

**Total:** ~1100 lines of new/modified code, 116 new test assertions across 4 new test files, plus 3 existing test files updated.

---

## Architecture

### Task #30-follow-up: maxAttackCount() helper

**Problem:** Session 44 Task #30 documented a known v1 simplification: the order-dependent guard chain (Thirsting Blade check runs first → sets attackCount=2 → Extra Attack check sees attackCount already set → skips) meant a Warlock 5 / Fighter 11 multiclass with both Thirsting Blade (=2) and Extra Attack (2) (=3) only got 2 attacks instead of the correct RAW 3 attacks.

**Solution:**
1. Added a `maxAttackCount(self, action)` helper in `planner.ts` that returns the highest applicable attackCount from any source: Thirsting Blade (=2, melee only), Extra Attack (=2), Extra Attack (2) (=3), Extra Attack (3) (=4). Returns undefined if no source applies.
2. Replaced the 2 inline guard blocks (plan.action path + Action Surge path) with calls to `maxAttackCount()`.
3. The helper respects Thirsting Blade's melee-only restriction (action.action.attackType === 'melee') while Extra Attack applies to any Attack action (melee OR ranged).
4. RAW non-stacking (SAC v2.7) is enforced via `Math.max()` aggregation — only the highest source wins.

**End-to-end test result:** Warlock 5 / Fighter 11 multiclass now correctly gets attackCount=3 (was 2 pre-Session-45). The engine actually resolves 3 attacks (section 11b). The surge action also correctly gets attackCount=3 (section 12c).

### Task #29-follow-up: Expanded subclass features + Champion crit range

**Problem:** Session 44 Task #29 only modelled Bard Valor/Swords Extra Attack in the SUBCLASS_FEATURES table. Other subclass features (Fighter Champion, Druid Land, Monk Open Hand, Sorcerer Draconic) were not modelled. The Champion's Improved Critical / Superior Critical features — the most mechanically significant subclass features for combat — were not wired into the engine.

**Solution:**
1. Expanded the `SUBCLASS_FEATURES` table in `leveler.ts` with 4 new subclasses (18 new feature entries):
   - **Fighter Champion**: Improved Critical (3), Remarkable Athlete (7), Additional Fighting Style (10), Superior Critical (15), Survivor (18)
   - **Druid Circle of the Land**: Bonus Cantrip + Natural Recovery (2), Land's Stride (6), Nature's Ward (10), Nature's Sanctuary (14)
   - **Monk Way of the Open Hand**: Open Hand Technique (3), Wholeness of Body (6), Tranquility (11), Diamond Soul (13), Quivering Palm (17)
   - **Sorcerer Draconic Bloodline**: Elemental Affinity (6), Dragon Wings (14), Draconic Presence (18)
2. Extended `resolveSubclassFeatures()` alias normalisation to handle shorthand forms (Champion, Land, Open Hand, Draconic).
3. Added optional `critRange` parameter to `rollAttack()` in `utils.ts` (default 20). `isCrit` is now `roll >= critRange` instead of `roll === 20`.
4. Updated `combat.ts` weapon-attack path to compute critRange from `hasFeature(attacker, 'Superior Critical') ? 18 : hasFeature(attacker, 'Improved Critical') ? 19 : 20`. Spell attacks skip this gating (Improved Critical specifies "weapon attacks" only).
5. **Bug fix:** A critical hit now ALWAYS hits. Previously `attackHits()` only treated nat 20 as auto-hit, so a nat 19 (Champion crit) vs high AC would miss — RAW-incorrect (a crit is by definition a hit). Fixed via `result.isCrit || attackHits(...)` short-circuit.

**End-to-end test result:** Champion 3 crit rate ~10% (vs vanilla ~5%); Champion 15 crit rate ~15%. Both pass the threshold tests. Champion crits ~2× as often as vanilla Fighter.

### Task #27-follow-up: Dash + Disengage surge options

**Problem:** Session 44 Task #27 added the heal-self surge option but the future-extension list (Dash, Disengage, defensive spells) was not implemented. A Fighter with no enemy in reach would waste the surge (no extra attack possible); a low-HP Fighter surrounded by enemies would surge to attack instead of retreating.

**Solution:**
1. Added Option 2 (Dash surge) to `planExtraAction()`: when main action was NOT an Attack AND no living enemy is within 5 ft, surge to Dash (close distance). PHB p.192 + p.72.
2. Added Option 3 (Disengage surge): when main action was neither Attack nor already Disengage AND HP < 50% AND ≥2 adjacent enemies, surge to Disengage (retreat without provoking OAs). PHB p.192 + p.72.
3. Added guard: don't surge to Disengage if main action was already Disengage (redundant — the OA protection is already active).
4. Updated function signature to use `battlefield` instead of `_battlefield` (now consumed for enemy/reach checks).

**Priority order (first match wins):**
1. Heal-self (HP < 50% + Cure Wounds + slot) — Session 44
2. Dash (main != Attack + no enemy in reach) — Session 45 NEW
3. Disengage (main != Attack + main != Disengage + HP < 50% + ≥2 adj) — Session 45 NEW
4. Default extra Attack (main was Attack + target alive) — Session 43

**End-to-end test result:** Dash surge adds +25 ft movement budget (fighter speed). Disengage surge sets `disengagedThisTurn` + `usedDisengage` flag (prevents OAs).

### Task #20-follow-up: Couatl Lesser Restoration + Protection from Poison

**Problem:** Session 44 Task #20 added the Couatl's Shield innate spell but left Lesser Restoration and Protection from Poison as "tracked but not yet cast" — the innate counters were in `resources.innateSpellcasting` but no Action objects existed, and the spell modules' shouldCast/execute only checked spell slots (which the Couatl doesn't have).

**Solution:**
1. Added Action objects for Lesser Restoration and Protection from Poison to the Couatl in `conjure_celestial.ts` (costType=action, reach=5, slotLevel=0). Couatl now has 8 actions (was 6).
2. Updated `shouldCast()` in `lesser_restoration.ts` to accept innate uses as alternative to spell slots: `!hasSpellSlot(caster, 2) && !hasInnateSpellUse(caster, 'Lesser Restoration') → null`.
3. Updated `execute()` to consume an innate use when no slot is available: `if (consumeSpellSlot(caster, 2) === null) { consumeInnateSpellUse(caster, 'Lesser Restoration'); }`. Mirrors the cure_wounds.ts / shield.ts pattern.
4. Same innate-aware updates applied to `protection_from_poison.ts`.
5. Updated `conjure_celestial.test.ts` action count 6→8. Updated `couatl_shield_reaction.test.ts` 2 assertions (NO Action → HAS Action).

**End-to-end test result:** The Couatl now reactively casts Lesser Restoration on allies afflicted by blinded/deafened/paralyzed/poisoned (removes ALL conditions — v1 simplification). The Couatl prioritizes self when self is afflicted. Innate uses decrement 3→2→1→0. At 0 uses, the spells no longer fire.

### Task #28-follow-up: Raise MAX_SUMMONS_PER_CAST to 16

**Problem:** Session 44 Task #28 capped MAX_SUMMONS_PER_CAST at 8 to avoid battlefield bloat. The PHB "At Higher Levels" multiplier produces 8 (L3-4), 16 (L5-6), or 24 (L7+) creatures for the "8 at CR 1/4" option. The cap at 8 meant L5-6 upcasts only spawned 8 creatures (PHB-inaccurate — should be 16).

**Solution:**
1. Raised `MAX_SUMMONS_PER_CAST` from 8 to 16 in `summon_picker.ts`. L5-6 upcasts now spawn the full 16 creatures (PHB-accurate). L7+ upcasts (24 per PHB) remain capped at 16 as a documented v1.6 simplification.
2. Expanded the spawn offsets array from 8 to 16 in all 3 Conjure spell files (conjure_animals, conjure_woodland_beings, conjure_minor_elementals). Added 8 distance-2 offsets to avoid position overlaps when 16 creatures spawn.
3. Updated `conjure_multi.test.ts` L5/L7/L9 assertions from 8 to 16 picks. Updated L5 execute assertion from 8 to 16 summons spawned.

**End-to-end test result:** L5 Conjure Animals with a populated bestiary spawns exactly 16 Wolves (was 8 pre-Session-45). L7 spawns 16 (capped from 24). L3 still spawns 8 (base count, multiplier 1×).

---

## Files Changed

### New files (4)
- `src/test/max_attack_count.test.ts` — 22 assertions across 14 sections
- `src/test/subclass_features.test.ts` — 37 assertions across 24 sections
- `src/test/action_surge_dash_disengage.test.ts` — 18 assertions across 14 sections
- `src/test/couatl_condition_spells.test.ts` — 39 assertions across 22 sections

### Modified files (10)
- `src/ai/planner.ts` — maxAttackCount() helper (Task #30); Dash + Disengage surge options (Task #27)
- `src/characters/leveler.ts` — SUBCLASS_FEATURES expanded with 4 subclasses + alias normalisation (Task #29)
- `src/engine/utils.ts` — rollAttack() critRange parameter (Task #29)
- `src/engine/combat.ts` — Champion crit range wiring + crit-always-hits fix (Task #29)
- `src/summons/summon_picker.ts` — MAX_SUMMONS_PER_CAST 8 → 16 (Task #28)
- `src/spells/conjure_animals.ts` — expanded spawn offsets 8 → 16 (Task #28)
- `src/spells/conjure_woodland_beings.ts` — expanded spawn offsets 8 → 16 (Task #28)
- `src/spells/conjure_minor_elementals.ts` — expanded spawn offsets 8 → 16 (Task #28)
- `src/spells/conjure_celestial.ts` — 2 new Action objects on Couatl (Task #20)
- `src/spells/lesser_restoration.ts` — innate-aware shouldCast/execute (Task #20)
- `src/spells/protection_from_poison.ts` — innate-aware shouldCast/execute (Task #20)
- `src/test/conjure_celestial.test.ts` — action count 6→8 (Task #20)
- `src/test/couatl_shield_reaction.test.ts` — 2 assertions updated (Task #20)
- `src/test/conjure_multi.test.ts` — L5/L7/L9 assertions 8→16 (Task #28)

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `max_attack_count.test.ts` (22 assertions) | ✅ All pass |
| `subclass_features.test.ts` (37 assertions) | ✅ All pass |
| `action_surge_dash_disengage.test.ts` (18 assertions) | ✅ All pass |
| `couatl_condition_spells.test.ts` (39 assertions) | ✅ All pass |
| `thirsting_blade.test.ts` | ✅ All pass |
| `extra_attack.test.ts` | ✅ All pass |
| `bard_extra_attack.test.ts` | ✅ All pass |
| `action_surge.test.ts` | ✅ All pass |
| `action_surge_heal.test.ts` | ✅ All pass |
| `conjure_celestial.test.ts` (162 assertions) | ✅ All pass |
| `couatl_shield_reaction.test.ts` (37 assertions) | ✅ All pass |
| `couatl_innate_spellcasting.test.ts` | ✅ All pass |
| `lesser_restoration.test.ts` | ✅ All pass |
| `protection_from_poison.test.ts` | ✅ All pass |
| `conjure_multi.test.ts` (55 assertions) | ✅ All pass |
| `conjure_animals.test.ts` (135 assertions) | ✅ All pass |
| `conjure_woodland_beings.test.ts` (149 assertions) | ✅ All pass |
| `conjure_minor_elementals.test.ts` (135 assertions) | ✅ All pass |
| `summons.test.ts` | ✅ All pass |
| `character_leveler.test.ts` (256 assertions) | ✅ All pass |
| `character_improvements.test.ts` (108 assertions) | ✅ All pass |
| `character_builder.test.ts` (93 assertions) | ✅ All pass |
| `engine.test.ts` (71 assertions) | ✅ All pass |
| `combat.test.ts` (47-52 assertions) | ✅ All pass |
| `ai.test.ts` (26 assertions) | ✅ All pass |
| `scenario.test.ts` (94 assertions) | ✅ All pass |

---

## CI Status

- **Task #30-follow-up commit (e69fb63):** test `success` ✅
- **Task #29-follow-up commit (feab915):** build `success` ✅ / test `in_progress` (last checked)
- **Task #27-follow-up commit (be436c2):** build `success` ✅ / test `in_progress` (last checked)
- **Task #20-follow-up commit (9683d06):** build `success` ✅ / test `in_progress` (last checked)
- **Task #28-follow-up commit (8c3251a):** build `in_progress` / test `in_progress` (last checked)
- **Final state:** All Session 45 commits verified green or pending (no red X's observed). Will confirm final status after CI completes.

---

## Next Session Priorities

All 5 follow-up items from Session 44 are now closed. The following NEW follow-up items were surfaced by Session 45:

22. **Devil's Sight invocation** (continuation of Task #16) — Still deferred. See in magical darkness 120 ft. Requires LOS engine changes for magical darkness (out of v1 scope; deferred until LOS system supports it).

29-follow-up-2. **Wire more Champion features into the engine** (NEW — surfaced by Session 45 Task #29) — Currently only Improved Critical + Superior Critical are mechanically wired. Future: Remarkable Athlete (half-proficency on STR/DEX/CON ability checks), Survivor (regen 5 + CON mod HP at start of turn if below half HP), Additional Fighting Style (second Fighting Style choice).

29-follow-up-3. **Wire Land Druid features into the engine** (NEW — surfaced by Session 45 Task #29) — Natural Recovery (short-rest slot recovery), Land's Stride (ignore nonmagical difficult terrain), Nature's Ward (immune to poison/disease + fey/elemental charm/frighten), Nature's Sanctuary (beasts/plants must WIS save or lose target).

29-follow-up-4. **Wire Open Hand Monk features into the engine** (NEW — surfaced by Session 45 Task #29) — Open Hand Technique (Flurry of Blows rider effects), Wholeness of Body (self-heal action), Tranquility (post-short-rest Sanctuary), Diamond Soul (proficiency in all saves + ki reroll), Quivering Palm (touch-attack instakill).

29-follow-up-5. **Wire Draconic Sorcerer features into the engine** (NEW — surfaced by Session 45 Task #29) — Elemental Affinity (add CHA mod to damage of spells matching draconic ancestry), Dragon Wings (fly speed), Draconic Presence (frighten aura).

27-follow-up-2. **Add more surge options** (NEW — surfaced by Session 45 Task #27) — Surge to cast a defensive spell (Shield of Faith, Mirror Image). Surge for a different spell (e.g. Fireball) when main action was Attack.

28-follow-up-2. **Raise MAX_SUMMONS_PER_CAST to 24** (NEW — surfaced by Session 45 Task #28) — PHB allows 24 creatures at L7+ but v1.6 caps at 16. Raise to 24 once the engine's per-turn resolution is optimized for large creature counts.

20-follow-up-2. **Model diseases for Lesser Restoration** (NEW — surfaced by Session 45 Task #20) — Lesser Restoration can end "one disease or one condition" (PHB p.255). v1 only models the condition removal; diseases are not tracked. Future: add a disease-tracking subsystem.

---

## Commit Log (Session 45)

```
Session 45 Task #30-follow-up: maxAttackCount() helper replaces order-dependent guards
  - maxAttackCount(self, action) returns max of {TB=2, EA=2, EA(2)=3, EA(3)=4}
  - Replaced 2 inline guard blocks (plan.action + Action Surge paths)
  - Bug fix: Warlock 5 / Fighter 11 now correctly gets 3 attacks (was 2)
  - 22 test assertions across 14 sections

Session 45 Task #29-follow-up: expand SUBCLASS_FEATURES + Champion crit range
  - 4 new subclasses (18 feature entries): Champion, Land, Open Hand, Draconic
  - Alias normalisation extended to Fighter/Druid/Monk/Sorcerer
  - rollAttack() accepts optional critRange parameter
  - combat.ts: weapon attacks use critRange 19 (Improved Critical) / 18 (Superior Critical)
  - Bug fix: critical hits now ALWAYS hit (was only nat 20)
  - 37 test assertions across 24 sections

Session 45 Task #27-follow-up: Dash + Disengage surge options
  - Option 2: Dash surge (main != Attack + no enemy in reach)
  - Option 3: Disengage surge (main != Attack + main != Disengage + HP < 50% + ≥2 adj)
  - Redundant-Disengage guard (don't surge to Disengage if main was Disengage)
  - 18 test assertions across 14 sections

Session 45 Task #20-follow-up: Couatl casts Lesser Restoration + Protection from Poison
  - 2 new Action objects on Couatl (8 actions total, was 6)
  - shouldCast accepts innate uses as alternative to spell slots
  - execute consumes innate use when no slot is available
  - 39 test assertions across 22 sections

Session 45 Task #28-follow-up: raise MAX_SUMMONS_PER_CAST from 8 to 16
  - L5-6 upcasts now spawn full 16 creatures (PHB-accurate)
  - L7+ capped at 16 (was 8; PHB allows 24)
  - Expanded spawn offsets 8 → 16 in all 3 Conjure spells
  - 55 test assertions (existing, updated for new cap)
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged).
- `_reaction_registry.ts`: 6 reaction spells (unchanged; Shield now works for innate casters like the Couatl via the `hasInnateSpellUse` fallback in `triggerReactions`).
- `_invocations.ts`: 7 Eldritch Invocations (unchanged).
- `WARLOCK_INVOCATION_SLOTS`: 21 entries (unchanged).
- `summon_picker.ts`: 10 picker functions + `MAX_SUMMONS_PER_CAST` constant (now 16, was 8).
- `SUBCLASS_FEATURES`: 5 subclasses across 4 classes (was 1 subclass in 1 class):
  - Bard: College of Valor, College of Swords (Session 44)
  - Fighter: Champion (Session 45 — 5 feature entries)
  - Druid: Circle of the Land (Session 45 — 5 feature entries)
  - Monk: Way of the Open Hand (Session 45 — 5 feature entries)
  - Sorcerer: Draconic Bloodline (Session 45 — 3 feature entries)
- `maxAttackCount()` helper: replaces 2 inline guard blocks, returns max of 4 sources.
