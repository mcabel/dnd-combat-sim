# TASK.md

## Active Objective

**TG-001: Persistent-buff subsystem** — concentration-tracked per-turn riders
(Green-Flame Blade lingering fire, Booming Blade thunder rider, Sapping Sting
prone-on-move, etc.) currently fire via one-shot logic in individual spell
modules. A unified `applyOngoingEffect` hook called from `resetBudget` /
`beginTurn` is needed so these riders persist correctly across rounds.

## Current Phase

Not started. Prerequisite groundwork is complete:
- Concentration enforcement (TG-002) ✅
- Parser fields incl. `isUndead`/`isConstruct`/`hasMetalArmor` (TG-004) ✅
- Cantrip planner branches 13A-13N (TG-003) ✅
- Reaction registry / TG-008 partial (Shield, Hellish Rebuke, Absorb Elements,
  Feather Fall, Silvery Barbs, Counterspell, Dispel Magic, Prot. from Energy) ✅

## Acceptance Criteria

- `Combatant` has a typed `ongoingEffects` collection (or reuses `activeEffects`)
- At least Booming Blade thunder rider and GFB lingering fire use it
- Per-turn damage triggers correctly on move / start-of-turn
- Existing tests do not regress

## Immediate Priority

1. Read ROADMAP.md for subsystem boundary guidance
2. Audit `activeEffects` on `Combatant` — determine if it can be extended or
   a new `ongoingEffects` array is needed
3. Design minimal hook; RFC to TEAMGOALS.md before touching `combat.ts`

## Notes

- Sheet agent owns `leveler.ts` / `builder.ts` — do not touch
- Cantrip-z's summon Phase 1 is live; RFC required before Phase 2 (`combat.ts`)
