# zHANDOVER — Session 46

**Date:** 2026-06-23
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement 3 follow-up items from Session 45's next-session priorities — raise MAX_SUMMONS_PER_CAST to 24 (Task #28-follow-up-2), Mirror Image + Fireball surge options (Task #27-follow-up-2), and wire Champion Remarkable Athlete + Survivor (Task #29-follow-up-2). All 3 tasks completed. Also confirmed the red X (flaky crit-rate tests) was already fixed by the Session 45 agent in commit 3b21f81.

---

## Session Summary

Session 46 closed 3 follow-up items from Session 45's priority list. The MAX_SUMMONS_PER_CAST cap was raised from 16 to 24, allowing L7+ upcasts of Conjure Animals / Woodland Beings / Minor Elementals to produce the full PHB-accurate 24 creatures (was capped at 16). Two new Action Surge options were added to `planExtraAction()`: Mirror Image defensive surge (HP < 50% + knows MI + L2 slot → surge to cast Mirror Image for 3 illusory duplicates) and Fireball offensive surge (main was Attack + knows FB + L3 slot + ≥2 clustered → surge to Fireball for 8d6 AoE). Two more Champion features were mechanically wired into the engine: Remarkable Athlete (Champion 7) now adds half proficiency bonus to initiative, and Survivor (Champion 18) now regenerates 5 + CON mod HP at the start of each turn when below half HP.

| Component | Status | Lines |
|-----------|--------|-------|
| **Task #28-follow-up-2: Raise MAX_SUMMONS_PER_CAST to 24** | | |
| `src/summons/summon_picker.ts` — MAX_SUMMONS_PER_CAST 16 → 24 + JSDoc updates | ✅ Done | +15 lines |
| `src/spells/conjure_animals.ts` — expanded spawn offsets 16 → 24 (8 at distance 3) | ✅ Done | +4 lines |
| `src/spells/conjure_woodland_beings.ts` — same offsets expansion | ✅ Done | +4 lines |
| `src/spells/conjure_minor_elementals.ts` — same offsets expansion | ✅ Done | +4 lines |
| `src/test/conjure_multi.test.ts` — L7/L9 assertions 16 → 24 | ✅ Done | +12 lines |
| **Task #27-follow-up-2: Mirror Image + Fireball surge options** | | |
| `src/ai/planner.ts` — Option 4 (Mirror Image) + Option 5 (Fireball) in planExtraAction() | ✅ Done | +95 lines |
| `src/ai/planner.ts` — main-action coordination (skip MI/FB when surge would fire) | ✅ Done | +55 lines |
| `src/ai/planner.ts` — selectAction() Fireball interception | ✅ Done | +25 lines |
| `src/test/action_surge_defensive_offensive.test.ts` (NEW) — 33 assertions, 20 sections | ✅ Done | ~560 lines |
| **Task #29-follow-up-2: Wire Champion Remarkable Athlete + Survivor** | | |
| `src/types/core.ts` — Combatant.level field (optional, for PCs) | ✅ Done | +7 lines |
| `src/characters/builder.ts` — sets combatant.level from sheet classLevels | ✅ Done | +10 lines |
| `src/engine/utils.ts` — combatantProfBonus() helper + rollInitiative() RA bonus | ✅ Done | +45 lines |
| `src/engine/combat.ts` — Survivor regen at turn start | ✅ Done | +28 lines |
| `src/test/champion_remarkable_athlete_survivor.test.ts` (NEW) — 31 assertions, 24 sections | ✅ Done | ~520 lines |

**Total:** ~950 lines of new/modified code, 64 new test assertions across 2 new test files, plus 1 existing test file updated.

---

## Architecture

### Task #28-follow-up-2: Raise MAX_SUMMONS_PER_CAST to 24

**Problem:** Session 45 Task #28-follow-up raised the cap from 8 to 16, allowing L5-6 upcasts to produce the full 16 creatures (PHB-accurate). But L7+ upcasts (PHB 3× multiplier = 24 creatures) were still capped at 16 — a documented v1.6 simplification.

**Solution:**
1. Raised `MAX_SUMMONS_PER_CAST` from 16 to 24 in `summon_picker.ts`.
2. Expanded the spawn offsets array from 16 to 24 in all 3 Conjure spell files (conjure_animals, conjure_woodland_beings, conjure_minor_elementals). Added 8 distance-3 offsets to avoid position overlaps when 24 creatures spawn.
3. Updated `conjure_multi.test.ts` L7/L9 assertions from 16 to 24.

**End-to-end test result:** L7 Conjure Animals with a populated bestiary spawns exactly 24 Wolves (was 16 pre-Session-46). L3 still spawns 8 (base count, 1× multiplier). L5 still spawns 16 (2× multiplier, under cap).

### Task #27-follow-up-2: Mirror Image + Fireball surge options

**Problem:** Session 45 Task #27-follow-up added Dash + Disengage surge options but the future-extension list (defensive spells, offensive spells) was not implemented. A Fighter with low HP would surge to attack instead of casting Mirror Image defensively; a Fighter with 2+ clustered enemies would surge for a single extra attack instead of Fireball AoE.

**Solution:**
1. Added Option 4 (Mirror Image defensive surge) to `planExtraAction()`: when HP < 50% AND combatant knows Mirror Image AND has L2 slot AND not already active, surge to cast Mirror Image (3 illusory duplicates, PHB p.260). RAW-valid: casting time = 1 action.
2. Added Option 5 (Fireball offensive surge): when main action was Attack AND knows Fireball AND has L3 slot AND shouldCastFireball returns ≥2 clustered targets, surge to cast Fireball (8d6 fire AoE, PHB p.241). RAW-valid: casting time = 1 action.
3. **Note on Shield of Faith:** The handover mentioned "Shield of Faith, Mirror Image" as defensive surge candidates, but Shield of Faith is a BONUS ACTION spell (PHB p.275) and CANNOT be cast via Action Surge (which grants an extra ACTION, not bonus action — PHB p.72 + p.202). Excluded by RAW. Only action-time defensive spells are valid surge candidates.
4. **Main-action coordination:** To enable the surges to fire, the planner's main-action selection was updated:
   - Mirror Image main-action block: skip when Action Surge available AND HP < 50% (save MI for the surge).
   - Fireball main-action block: skip when Action Surge available AND ≥2 clustered (save FB for the surge).
   - `selectAction()` Fireball interception: if selectAction picks Fireball via its own AoE cluster logic AND the FB surge would fire, replace with the best weapon attack.
   - Only affects Fighters with Action Surge; pure Wizards unchanged.

**Priority order (first match wins):**
1. Heal-self (HP < 50% + Cure Wounds + slot) — Session 44
2. Dash (main != Attack + no enemy in reach) — Session 45
3. Disengage (main != Attack + HP < 50% + ≥2 adj) — Session 45
4. **Mirror Image defensive (HP < 50% + knows MI + L2 slot)** — Session 46 NEW
5. **Fireball offensive (main == Attack + knows FB + L3 slot + ≥2 clustered)** — Session 46 NEW
6. Default extra Attack (main was Attack + target alive) — Session 43

**End-to-end test result:** Mirror Image surge sets `_mirrorImageDuplicates = 3` and consumes the L2 slot. Fireball surge deals damage to 2+ enemies and consumes the L3 slot + Action Surge use.

### Task #29-follow-up-2: Wire Champion Remarkable Athlete + Survivor

**Problem:** Session 45 Task #29 wired Improved Critical + Superior Critical into the engine but left Remarkable Athlete, Survivor, and Additional Fighting Style as "tracked but not mechanically wired".

**Solution:**
1. **Remarkable Athlete (Champion 7, PHB p.72):** `rollInitiative()` in `utils.ts` now adds `ceil(prof/2)` to the DEX initiative roll when the combatant has 'Remarkable Athlete'. At level 7 (prof +3): +2. At level 17 (prof +6): +3.
2. **Survivor (Champion 18, PHB p.73):** Added turn-start regen in `combat.ts` — right after `resetBudget`, before damage-zone ticks. When HP > 0 AND HP < floor(maxHP/2) AND has 'Survivor' feature: regain 5 + CON mod HP (capped at maxHP). Logs a 'heal' event.
3. **New `combatantProfBonus()` helper** in `utils.ts`: computes proficiency bonus for PCs (level-based: 1-4→+2, 5-8→+3, 9-12→+4, 13-16→+5, 17-20→+6) and monsters (CR-based). Needed because the existing `proficiencyBonus(cr)` returns +2 for all PCs (cr=null).
4. **New `Combatant.level` field** (optional, `types/core.ts`): set by `buildCombatant` from the sheet's total class level. Enables level-based proficiency for PCs.
5. **Additional Fighting Style (Champion 10):** NOT mechanically wired — this is a character-build choice (player picks a second Fighting Style at level-up). The feature is tracked in SUBCLASS_FEATURES but the mechanical effect depends on the chosen style. Deferred to a future session (requires leveler/UI changes).

**End-to-end test result:** Champion 7 average initiative is +2 higher than vanilla Fighter 7 (14.50 vs 12.50). Champion 18 regains 8 HP (5 + CON 3) at the start of each turn when below half HP. Regen does NOT fire when HP ≥ half, HP = 0, or non-Champion.

---

## Red X Investigation (Pre-Session-46)

The user reported a "red X" (CI failure) in the repo. Investigation of GitHub Actions API revealed:
- Commit `3b21f81` (latest, "fix: de-flake subclass_features crit rate tests") → **success ✅**
- Commit `ad82cb9` (Add zHANDOVER-SESSION-45.md) → **failure ❌** (was the red X)
- Commit `8c3251a` (Task #28-follow-up) → **failure ❌**
- Commit `be436c2` (Task #27-follow-up) → **failure ❌**

**Root cause:** Flaky statistical assertions in `subclass_features.test.ts` sections 19b and 20b (Champion crit-rate tests, N=200, P(fail) ≈ 2-3%). The Session 45 agent already fixed this in commit `3b21f81` by raising N from 200 to 600 and lowering thresholds. The latest CI is green. No further red-X fix was needed from Session 46.

---

## Files Changed

### New files (2)
- `src/test/action_surge_defensive_offensive.test.ts` — 33 assertions across 20 sections
- `src/test/champion_remarkable_athlete_survivor.test.ts` — 31 assertions across 24 sections

### Modified files (8)
- `src/summons/summon_picker.ts` — MAX_SUMMONS_PER_CAST 16 → 24 + JSDoc (Task #28)
- `src/spells/conjure_animals.ts` — expanded spawn offsets 16 → 24 (Task #28)
- `src/spells/conjure_woodland_beings.ts` — expanded spawn offsets 16 → 24 (Task #28)
- `src/spells/conjure_minor_elementals.ts` — expanded spawn offsets 16 → 24 (Task #28)
- `src/test/conjure_multi.test.ts` — L7/L9 assertions 16 → 24 (Task #28)
- `src/ai/planner.ts` — Mirror Image + Fireball surge options + main-action coordination (Task #27)
- `src/types/core.ts` — Combatant.level field (Task #29)
- `src/characters/builder.ts` — sets combatant.level (Task #29)
- `src/engine/utils.ts` — combatantProfBonus() + rollInitiative() RA bonus (Task #29)
- `src/engine/combat.ts` — Survivor regen at turn start (Task #29)

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `conjure_multi.test.ts` (55 assertions) | ✅ All pass |
| `conjure_animals.test.ts` (135 assertions) | ✅ All pass |
| `conjure_woodland_beings.test.ts` (149 assertions) | ✅ All pass |
| `conjure_minor_elementals.test.ts` (135 assertions) | ✅ All pass |
| `summons.test.ts` (52 assertions) | ✅ All pass |
| `action_surge.test.ts` (28 assertions) | ✅ All pass |
| `action_surge_dash_disengage.test.ts` (18 assertions) | ✅ All pass |
| `action_surge_heal.test.ts` (26 assertions) | ✅ All pass |
| `action_surge_defensive_offensive.test.ts` (33 assertions) | ✅ All pass |
| `champion_remarkable_athlete_survivor.test.ts` (31 assertions) | ✅ All pass |
| `subclass_features.test.ts` (37 assertions) | ✅ All pass |
| `max_attack_count.test.ts` (22 assertions) | ✅ All pass |
| `mirror_image.test.ts` (55 assertions) | ✅ All pass |
| `fireball.test.ts` (34 assertions) | ✅ All pass |
| `engine.test.ts` (71 assertions) | ✅ All pass |
| `combat.test.ts` (48-54 assertions, probabilistic) | ✅ All pass |
| `scenario.test.ts` (94 assertions) | ✅ All pass |
| `ai.test.ts` (26 assertions) | ✅ All pass |
| `character_leveler.test.ts` (256 assertions) | ✅ All pass |
| `character_builder.test.ts` (93 assertions) | ✅ All pass |
| `character_improvements.test.ts` (108 assertions) | ✅ All pass |

---

## CI Status

- **Task #28-follow-up-2 commit (353439b):** pending verification after push
- **Task #27-follow-up-2 commit (8dbbdd1):** pending verification after push
- **Task #29-follow-up-2 commit (e5abc4e):** pending verification after push
- **Pre-session baseline (3b21f81):** success ✅ (red X already fixed by Session 45 agent)

---

## Next Session Priorities

All 3 follow-up items from Session 45 that were tackled in Session 46 are now closed. The following items remain from Session 45's next-session list:

22. **Devil's Sight invocation** (continuation of Task #16) — Still deferred. Requires LOS engine changes for magical darkness (out of v1 scope; deferred until LOS system supports it).

29-follow-up-3. **Wire Land Druid features into the engine** — Natural Recovery (short-rest slot recovery), Land's Stride (ignore nonmagical difficult terrain), Nature's Ward (immune to poison/disease + fey/elemental charm/frighten), Nature's Sanctuary (beasts/plants must WIS save or lose target).

29-follow-up-4. **Wire Open Hand Monk features into the engine** — Open Hand Technique (Flurry of Blows rider effects), Wholeness of Body (self-heal action), Tranquility (post-short-rest Sanctuary), Diamond Soul (proficiency in all saves + ki reroll), Quivering Palm (touch-attack instakill).

29-follow-up-5. **Wire Draconic Sorcerer features into the engine** — Elemental Affinity (add CHA mod to damage of spells matching draconic ancestry), Dragon Wings (fly speed), Draconic Presence (frighten aura).

27-follow-up-3. **Additional surge options** — Surge for a different spell when main action was Attack (e.g. Cone of Cold, Lightning Bolt). Surge to cast a defensive concentration spell (Blur, Barkskin) when HP < 50%.

29-follow-up-6. **Wire Additional Fighting Style (Champion 10)** — NEW, surfaced by Session 46. The feature is tracked in SUBCLASS_FEATURES but not mechanically wired. Requires leveler/UI changes to let the player pick a second Fighting Style at level 10, and builder changes to apply the second style's mechanical effect (e.g. Defense = +1 AC, Dueling = +2 damage).

20-follow-up-2. **Model diseases for Lesser Restoration** — Lesser Restoration can end "one disease or one condition" (PHB p.255). v1 only models the condition removal; diseases are not tracked. Future: add a disease-tracking subsystem.

---

## Commit Log (Session 46)

```
Session 46 Task #28-follow-up-2: raise MAX_SUMMONS_PER_CAST from 16 to 24
  - L7+ upcasts now spawn full 24 creatures (PHB-accurate)
  - Expanded spawn offsets 16 → 24 in all 3 Conjure spells
  - 55 test assertions (existing, updated for new cap)

Session 46 Task #27-follow-up-2: Mirror Image + Fireball surge options
  - Option 4: Mirror Image defensive (HP < 50% + knows MI + L2 slot)
  - Option 5: Fireball offensive (main == Attack + knows FB + L3 slot + ≥2 clustered)
  - Main-action coordination: skip MI/FB as main when surge would fire
  - Note: Shield of Faith excluded (bonus action, not valid for Action Surge)
  - 33 test assertions across 20 sections

Session 46 Task #29-follow-up-2: wire Champion Remarkable Athlete + Survivor
  - Remarkable Athlete (Champion 7): +ceil(prof/2) to initiative
  - Survivor (Champion 18): 5 + CON mod HP regen at turn start when below half
  - New Combatant.level field + combatantProfBonus() helper
  - Additional Fighting Style deferred (character-build choice)
  - 31 test assertions across 24 sections
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged).
- `_reaction_registry.ts`: 6 reaction spells (unchanged).
- `_invocations.ts`: 7 Eldritch Invocations (unchanged).
- `WARLOCK_INVOCATION_SLOTS`: 21 entries (unchanged).
- `summon_picker.ts`: 10 picker functions + `MAX_SUMMONS_PER_CAST` constant (now 24, was 16).
- `SUBCLASS_FEATURES`: 5 subclasses across 4 classes (unchanged from Session 45):
  - Bard: College of Valor, College of Swords
  - Fighter: Champion (5 feature entries — 3 now mechanically wired: Improved Critical, Superior Critical, Remarkable Athlete, Survivor; Additional Fighting Style deferred)
  - Druid: Circle of the Land (5 feature entries — 0 mechanically wired)
  - Monk: Way of the Open Hand (5 feature entries — 0 mechanically wired)
  - Sorcerer: Draconic Bloodline (3 feature entries — 0 mechanically wired)
- `planExtraAction()` helper: 6 surge options (was 4 in Session 45, 2 in Session 44):
  1. Heal-self (Session 44)
  2. Dash (Session 45)
  3. Disengage (Session 45)
  4. Mirror Image defensive (Session 46)
  5. Fireball offensive (Session 46)
  6. Default extra Attack (Session 43)
- `combatantProfBonus()` helper: NEW — level-based proficiency for PCs, CR-based for monsters.
- `Combatant.level` field: NEW — optional, set by buildCombatant for PCs.
