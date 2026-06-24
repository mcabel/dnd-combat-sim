# HANDOVER-SESSION-47

## REPOSITORY

- Branch: main
- Commit: 335e4a5
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided verbally at session start

## COMPLETED THIS SESSION

- Full 321-test sweep: found two failures introduced by Cantrip-z concurrent pushes
  - `bulk_spell_dispatch`: GENERIC_SPELL_LIST sort order broken by Protection from Energy appended out-of-level order → added explicit `.sort()` in `_generic_registry.ts`
  - `thorn_whip`: test expected `attackType: 'ranged'` but all spell attacks use `'spell'`; test expectation was wrong → corrected to `'spell'` with PHB note
- TG-003 completed: planner branches 13J–13N added to `src/ai/planner.ts`
  - 13J Green-Flame Blade (prefer 2+ adjacent enemies for splash)
  - 13K Lightning Lure (prefer 6-15 ft targets to pull into melee)
  - 13L Sapping Sting (prefer melee enemies not already prone)
  - 13M Infestation (any in-range non-poison-immune target)
  - 13N Gust (push only when protecting a critically wounded ally)
- Fixed CreatureSize capitalisation bug ('Small'/'Medium' vs 'small'/'medium')
- TEAMGOALS.md: TG-003 → DONE, TG-004 → DONE
- TASK.md updated: next objective is TG-001 (persistent-buff subsystem)

## DISCOVERIES RELEVANT TO NEXT TASK

- `activeEffects` already exists on `Combatant` — audit whether it can carry ongoing per-turn riders before designing a new collection.
- Cantrip-z sessions 47-49 landed during this session (zHANDOVER-SESSION-47/48/49.md committed by them). Check their handovers for new files/conflicts before touching combat.ts.
- The sort bug in `_generic_registry.ts` will recur every time a spell is appended out of level-order. The `.sort()` fix is now in place and is permanent.

## OPEN BLOCKERS

None. TG-001 requires an RFC comment in TEAMGOALS.md before modifying `combat.ts` (per TG-006 coordination protocol that extends to any engine-loop change).

## IMMEDIATE NEXT ACTION

Read `src/types/core.ts` (activeEffects field) and ROADMAP.md subsystem section to determine whether TG-001 extends `activeEffects` or introduces a new `ongoingEffects` typed collection. Post RFC to TEAMGOALS.md, then implement.

## TEST STATUS

- ai: 26/26
- cantrip_planner: 46/46
- engine: 71/71
- combat: 50/50
- scenario: 94/94
- resources: 72/72
- bulk_spell_dispatch: 214/214 (was 213/214 before fix)
- thorn_whip: 11/11 (was 10/11 before fix)
- All 321 test files scanned: 0 failures
