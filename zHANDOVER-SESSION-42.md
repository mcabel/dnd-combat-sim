# zHANDOVER — Session 42

**Date:** 2026-06-22
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement items #17, #18, #19 from Session 41's next-session priorities — migrate 102 spell modules to rollSaveReactable, Thirsting Blade engine integration, and Silvery Barbs ability-check-success trigger. All 3 tasks completed.

---

## Session Summary

Session 42 closed 3 more items from Session 41's priority list. The rollSaveReactable migration is now complete across all 102 spell modules (Silvery Barbs can fire on ANY save success from ANY spell). Thirsting Blade is fully wired (Warlock with Pact of the Blade + Thirsting Blade makes two melee attacks per Attack action). Silvery Barbs now handles all three PHB trigger types: attack hits, save successes, AND ability-check successes (grapple/shove/escape contests).

| Component | Status | Lines |
|-----------|--------|-------|
| **Task #17: rollSaveReactable migration** | | |
| 102 spell modules — `rollSave(target, ...)` → `rollSaveReactable(state, caster, target, ...)` | ✅ Done | 102 files, ~300 line changes |
| `scripts/migrate_rollsave.py` — migration script | ✅ Done | ~80 lines |
| **Task #18: Thirsting Blade** | | |
| `src/types/core.ts` — `pactBoon?` on Combatant + `attackCount?` on PlannedAction | ✅ Done | +15 lines |
| `src/characters/types.ts` — `pactBoon?` on CharacterSheet | ✅ Done | +8 lines |
| `src/characters/improvements.ts` — `choosePactBoon()` function | ✅ Done | +62 lines |
| `src/characters/builder.ts` — transfer `pactBoon` to Combatant | ✅ Done | +7 lines |
| `src/ai/planner.ts` — set `attackCount = 2` for Thirsting Blade | ✅ Done | +14 lines |
| `src/engine/combat.ts` — loop `resolveAttack` `attackCount` times | ✅ Done | +15 lines |
| `src/spells/_invocations.ts` — updated Thirsting Blade descriptor | ✅ Done | updated |
| `src/spells/eldritch_blast.ts` — `thirstingBladeV1Implemented = true` | ✅ Done | updated |
| `src/test/thirsting_blade.test.ts` (NEW) — 24 assertions, 10 sections | ✅ Done | ~400 lines |
| `src/test/more_eldritch_invocations.test.ts` — updated flag name | ✅ Done | 2 edits |
| **Task #19: Silvery Barbs ability-check-success** | | |
| `src/types/core.ts` — `incoming_ability_check_success` trigger kind | ✅ Done | +28 lines |
| `src/engine/combat.ts` — `rollGrappleContestReactable()` + 3 call-site migrations | ✅ Done | +85 lines |
| `src/spells/silvery_barbs.ts` — handle 3 trigger kinds + `executeAbilityCheckSuccessReroll` | ✅ Done | +55 lines |
| `src/spells/_reaction_registry.ts` — added trigger kind | ✅ Done | +3 lines |
| `src/test/silvery_barbs_ability_check.test.ts` (NEW) — 26 assertions, 14 sections | ✅ Done | ~400 lines |

**Total:** ~1100 lines of new/modified code, 50 new test assertions across 2 new test files.

---

## Architecture

### Task #17: rollSaveReactable Migration (102 spell modules)

**Problem:** Session 41 Task #8 created `rollSaveReactable` and migrated only 3 modules (resolveAttack save branch, fireball, burning_hands). The remaining 102 spell modules still called `rollSave` directly, meaning Silvery Barbs could only fire on save successes from those 3 modules.

**Solution:** Mechanical migration via `scripts/migrate_rollsave.py`:
1. For each of 102 spell modules, the script:
   - Removed `rollSave` from the `../engine/utils` import
   - Added `rollSaveReactable` to the `../engine/combat` import
   - Replaced `rollSave(target,` with `rollSaveReactable(state, caster, target,`
2. TypeScript compiled with 0 errors after migration — all `state` and `caster` variables were in scope at every call site (the standard `execute(caster, target, state)` signature covers all cases).

**Result:** Silvery Barbs can now fire on ANY save success from ANY spell in the engine. This completes the Session 41 Task #8 migration plan.

### Task #18: Thirsting Blade Engine Integration

**Problem:** Session 41 Task #16 registered Thirsting Blade as metadata-only (descriptor + flag). The engine integration (two attacks with pact weapon) was future work.

**Architecture:**
- Added `pactBoon?: 'chain' | 'blade' | 'tome'` to both `CharacterSheet` and `Combatant`. Set at Warlock level 3 via `choosePactBoon(sheet, boon)` in `improvements.ts`.
- Added `attackCount?: number` to `PlannedAction`. Default 1 (single attack). The planner sets it to 2 for Thirsting Blade.
- **Builder transfer:** `buildCombatant()` transfers `sheet.pactBoon` → `combatant.pactBoon`.
- **Planner logic:** After `plan.action` is finalized, the planner checks:
  - `plan.action.type === 'attack'`
  - `plan.action.action.attackType === 'melee'`
  - `hasInvocation(self, 'Thirsting Blade')`
  - `self.pactBoon === 'blade'`
  
  If all true, sets `plan.action.attackCount = 2`.
- **Engine execution:** In `executePlannedAction` case `'attack'` branch, loops `resolveAttack` `attackCount` times. Each attack is independent (separate attack roll, damage roll, death check). Skips subsequent attacks if the target dies mid-loop. Logs "attack 2/2 (Extra Attack / Thirsting Blade)" between attacks.

**v1 simplification:** Assumes ANY melee attack from a Thirsting Blade Warlock is a pact weapon attack (no `isPactWeapon` Action flag needed). Future: add the flag for stricter RAW compliance.

**End-to-end test result:** Warlock 5 with Thirsting Blade dealt 11.8 avg damage vs 3.9 without (2.99× ratio — confirms two attacks).

### Task #19: Silvery Barbs Ability-Check-Success Trigger

**Problem:** Session 41 Task #8 added the save-success trigger. The third Silvery Barbs trigger ("succeeds on an ability check") was not yet implemented. The primary ability checks in combat are grapple/shove/escape contests (3 call sites in `combat.ts`).

**Architecture:**
- Added `incoming_ability_check_success` to the `ReactionTrigger` union. Carries: `checker` (attacker), `opponent` (defender/reactor), `ability`, `roll`, `total`, `contestType`.
- Created `rollGrappleContestReactable(state, attacker, defender, contestType)` in `combat.ts`. Calls `rollGrappleContest`; if attacker wins, fires the trigger with the defender as the reactor. If the reaction negates, returns false (attacker did NOT win).
- Migrated 3 call sites:
  - `case 'grapple'`: `rollGrappleContestReactable(state, actor, target, 'grapple')`
  - `case 'shove'`: `rollGrappleContestReactable(state, actor, target, 'shove')`
  - `case 'escapeGrapple'`: `rollGrappleContestReactable(state, actor, grappler, 'escape grapple')`
- Updated `shouldCastReaction` to accept 3 trigger kinds (attack_hit, save_success, ability_check_success). The triggering creature is the `checker` (attacker) for the new trigger.
- Added `executeAbilityCheckSuccessReroll` in `silvery_barbs.ts`: re-rolls the contest by calling `rollGrappleContest` again. If the reroll flips the contest (defender now wins), returns `'negated'`.

**v1 simplification:** The reroll re-rolls the entire contest (calls `rollGrappleContest` again) rather than reconstructing individual d20 rolls. This is because `rollGrappleContest` doesn't expose the raw d20 values. PHB/SCC says "reroll the d20 and use the lower roll" — the v1 approach approximates this by re-rolling the whole contest. Future: refactor `rollGrappleContest` to return roll details, then use the lower-of-two-d20s approach.

**Future work:** Extend to Counterspell and Dispel Magic ability checks. These currently bypass the canonical `rollAbilityCheck` choke point in `utils.ts` — they'd need to be refactored first to use `rollAbilityCheck` before the reactable wrapper can wrap them.

---

## Files Changed

### New files (3)
- `scripts/migrate_rollsave.py` — mechanical migration script for rollSave → rollSaveReactable
- `src/test/thirsting_blade.test.ts` — 24 assertions across 10 sections
- `src/test/silvery_barbs_ability_check.test.ts` — 26 assertions across 14 sections

### Modified files (102+9 = 111)
- **102 spell modules** — migrated `rollSave` → `rollSaveReactable` (import change + call-site change)
- `src/types/core.ts` — `pactBoon?` on Combatant, `attackCount?` on PlannedAction, `incoming_ability_check_success` trigger kind
- `src/characters/types.ts` — `pactBoon?` on CharacterSheet
- `src/characters/improvements.ts` — `choosePactBoon()` function
- `src/characters/builder.ts` — transfer `pactBoon` to Combatant
- `src/ai/planner.ts` — import `hasInvocation`, set `attackCount = 2` for Thirsting Blade
- `src/engine/combat.ts` — `rollGrappleContestReactable()`, 3 call-site migrations, `attackCount` loop in case `'attack'`
- `src/spells/silvery_barbs.ts` — handle 3 trigger kinds, `executeAbilityCheckSuccessReroll`
- `src/spells/_reaction_registry.ts` — added `incoming_ability_check_success` to triggerKinds
- `src/spells/_invocations.ts` — updated Thirsting Blade descriptor
- `src/spells/eldritch_blast.ts` — `thirstingBladeV1Implemented = true` (was `V1Registered`)
- `src/test/more_eldritch_invocations.test.ts` — updated 2 assertions for renamed flag

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `thirsting_blade.test.ts` (24 assertions) | ✅ All pass |
| `silvery_barbs_ability_check.test.ts` (26 assertions) | ✅ All pass |
| Baseline tests (silvery_barbs, silvery_barbs_save_success, mechanics, combat, engine, shield_reaction, reaction_registry, more_eldritch_invocations, eldritch_invocations, eldritch_invocations_integration, cantrip_pipeline, character_builder 93, character_improvements 100, character_leveler 256, ai, scenario, fireball 34, burning_hands 33, sacred_flame 51, hold_person 42, moonbeam 107, hold_monster 19, charm_person 25, entangle 30, grease 44, faerie_fire 29, sleep 35, color_spray 57, web 59, stinking_cloud 41, cloudkill 46, ice_storm 50, cone_of_cold 37, chain_lightning 55, lightning_bolt 38, acid_splash, animal_friendship, bane, blight, blindness_deafness, catapult, cause_fear, charm_monster, circle_of_death, command, compelled_duel, create_bonfire, crown_of_madness, dark_star, dawn, disintegrate, dominate_beast, dominate_person, earthen_grasp, earthquake, elemental_bane, evards_black_tentacles, fear, feeblemind, fire_storm, frost_fingers, geas, gravity_sinkhole, harm, heat_metal, holy_aura, incendiary_cloud, infestation, mind_spike, polymorph, ray_of_sickness, scrying, sleet_storm, sunburst, tidal_wave, vicious_mockery, word_of_radiance) | ✅ All pass — no regressions |

---

## CI Status

- **Task #17 commit (08b2c37):** Test Suite `success` ✅
- **Task #18 commit (ed36df5):** Test Suite `success` ✅
- **Task #19 commit (bc2a7ea):** Test Suite `in_progress` (handover being written)
- **Final state:** (pending CI verification)

---

## Next Session Priorities

(Updated from Session 41 — items 17, 18, 19 now closed by Session 42.)

20. **More Couatl innate spells** (continuation of Task #2) — Add Lesser Restoration, Protection from Poison (situational — need condition tracking), Shield (needs reaction_registry integration for the Couatl).

21. **More summon bestiary integration** (continuation of Task #3) — Wire `pickConjureElementalSummon` + `pickConjureFeySummon` into their respective spell modules' execute functions (currently only Conjure Celestial is wired). Also wire Conjure Animals / Conjure Woodland Beings / Conjure Minor Elementals to use the bestiary for their CR-based picks.

22. **Devil's Sight invocation** (continuation of Task #16) — See in magical darkness 120 ft. Requires LOS engine changes (out of v1 scope; deferred until LOS system supports magical darkness).

23. **Action Surge engine integration** (NEW — surfaced by Session 42 Task #18 research) — Fighter 2+ Action Surge (`resources.actionSurge`) is tracked on the sheet but never consumed. Requires adding an `extraAction?: PlannedAction | null` field to `TurnPlan` (or generalizing to `actions: PlannedAction[]`) and modifying `executeTurnPlan` to call `executePlannedAction` again for the surge action. The `attackCount` approach used for Thirsting Blade doesn't work for Action Surge because it's a full extra ACTION (any type), not just an extra attack.

24. **Extra Attack for martial classes** (NEW — surfaced by Session 42 Task #18 research) — Fighter 5+, Paladin 5+, Ranger 5+, Barbarian 5+, Monk 5+, Bard 6+ all get Extra Attack (two attacks per Attack action). The leveler already grants the feature at the right levels, but the planner doesn't set `attackCount = 2` for these classes. The fix is straightforward: extend the Thirsting Blade planner check to also check for the "Extra Attack" feature in `sheet.allFeatures` (or check class level >= 5 for martial classes).

25. **Refactor rollGrappleContest for stricter Silvery Barbs RAW compliance** (NEW — surfaced by Session 42 Task #19) — Currently `executeAbilityCheckSuccessReroll` re-rolls the entire contest. PHB/SCC says "reroll the d20 and use the lower roll" — the v1 approach approximates this. Refactoring `rollGrappleContest` to return roll details (attacker roll, defender roll, totals) would allow the lower-of-two-d20s approach for stricter RAW compliance.

26. **Extend ability-check trigger to Counterspell and Dispel Magic** (NEW — continuation of Task #19) — These spells currently bypass the canonical `rollAbilityCheck` choke point in `utils.ts`. They'd need to be refactored to use `rollAbilityCheck` first, then wrapped with a reactable wrapper. Counterspell: INT check vs DC 10+spell_level. Dispel Magic: flat DC 13 check.

---

## Commit Log (Session 42)

```
Session 42 Task #17: Migrate 102 spell modules to rollSaveReactable
  - Mechanical migration via scripts/migrate_rollsave.py
  - All 102 spell modules now use rollSaveReactable instead of rollSave
  - Silvery Barbs can now fire on ANY save success from ANY spell
  - tsc --noEmit: 0 errors (all state/caster vars in scope)

Session 42 Task #18: Thirsting Blade engine integration
  - pactBoon field on CharacterSheet + Combatant
  - choosePactBoon() in improvements.ts
  - attackCount field on PlannedAction
  - Planner sets attackCount = 2 for Thirsting Blade + Pact of the Blade
  - Engine loops resolveAttack attackCount times
  - End-to-end: 2.99× damage ratio (11.8 vs 3.9 avg)

Session 42 Task #19: Silvery Barbs ability-check-success trigger
  - incoming_ability_check_success trigger kind
  - rollGrappleContestReactable wrapper + 3 call-site migrations
  - executeAbilityCheckSuccessReroll: re-rolls contest, negates if flipped
  - Silvery Barbs now handles all 3 PHB trigger types
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged from Session 41).
- `_reaction_registry.ts`: 6 reaction spells (unchanged). Silvery Barbs now handles 3 trigger kinds.
- `_invocations.ts`: 7 Eldritch Invocations (unchanged from Session 41). Thirsting Blade is now fully implemented (was metadata-only).
- `WARLOCK_INVOCATION_SLOTS`: 21 entries (unchanged from Session 40).
