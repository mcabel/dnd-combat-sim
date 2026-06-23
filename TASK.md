# TASK.md

> Per AGENTS.md: when an agent has an uploaded handover, that handover supersedes
> this file for that agent. TASK.md is the default for agents without a handover
> AND the cross-workstream priority list. Each workstream section below lists
> that workstream's own next priorities.

---

## Core Engine Workstream (HANDOVER-SESSION-XX)

### Active Objective

**TG-001: Persistent-buff subsystem** — concentration-tracked per-turn riders
(Green-Flame Blade lingering fire, Booming Blade thunder rider, Sapping Sting
prone-on-move, etc.) currently fire via one-shot logic in individual spell
modules. A unified `applyOngoingEffect` hook called from `resetBudget` /
`beginTurn` is needed so these riders persist correctly across rounds.

### Current Phase

Not started. Prerequisite groundwork is complete:
- Concentration enforcement (TG-002) ✅
- Parser fields incl. `isUndead`/`isConstruct`/`hasMetalArmor` (TG-004) ✅
- Cantrip planner branches 13A-13N (TG-003) ✅
- Reaction registry / TG-008 partial (Shield, Hellish Rebuke, Absorb Elements,
  Feather Fall, Silvery Barbs, Counterspell, Dispel Magic, Prot. from Energy) ✅

### Acceptance Criteria

- `Combatant` has a typed `ongoingEffects` collection (or reuses `activeEffects`)
- At least Booming Blade thunder rider and GFB lingering fire use it
- Per-turn damage triggers correctly on move / start-of-turn
- Existing tests do not regress

### Immediate Priority

1. Read ROADMAP.md for subsystem boundary guidance
2. Audit `activeEffects` on `Combatant` — determine if it can be extended or
   a new `ongoingEffects` array is needed
3. Design minimal hook; RFC to TEAMGOALS.md before touching `combat.ts`

### Notes

- Sheet agent owns `leveler.ts` / `builder.ts` — do not touch
- Cantrip-z's summon Phase 1 is live; RFC required before Phase 2 (`combat.ts`)

---

## Cantrip-z Workstream (zHANDOVER-SESSION-XX)

### Active Objective (Session 51)

**Task #29-follow-up-5c-4: Wire Elemental Affinity in remaining bespoke spells.**
Session 50 closed #29-follow-up-5c-3 (10 more spells). The pattern is
well-established (import `elementalAffinityBonus`, add `+ eaBonus` before
save halving, document v1 simplifications for DoT/concentration riders).

### Current Phase

In progress (this session). Reverse published order (newest pre-2024 source
first): XGE 2017 → PHB 2014.

### In-Scope Spells (6 — non-weapon-rider, spell-module-owned damage roll)

| # | Spell | Source | Year | Damage | Save | Pattern |
|---|-------|--------|------|--------|------|---------|
| 1 | Elemental Bane | XGE p.154 | 2017 | acid (v1 default) | WIS | single-target save, half-on-success |
| 2 | Create Bonfire | XGE p.152 | 2017 | fire (cantrip) | DEX | on-cast save + damage_zone tick |
| 3 | Immolation | XGE p.157 | 2017 | fire | DEX | single-target save, half-on-success |
| 4 | Incendiary Cloud | PHB p.253 | 2014 | fire | DEX | AoE save, half-on-success |
| 5 | Flaming Sphere | PHB p.242 | 2014 | fire | DEX | on-cast save + damage_zone tick (tick NOT boosted — v1 simplification) |
| 6 | Heat Metal | PHB p.250 | 2014 | fire | none | on-cast + damage_zone tick (tick NOT boosted — v1 simplification) |

### Out-of-Scope (Core Engine cross-workstream — see TEAMGOALS TG-015)

- Flame Blade, Lightning Arrow, Elemental Weapon, Searing Smite — weapon-rider
  bonus damage is applied in `combat.ts` (Core Engine territory); EA on those
  riders requires engine changes. Documented in TG-015.

### Acceptance Criteria

- `elementalAffinityBonus` is imported and called in each of the 6 spell modules
- New test file `elemental_affinity_phase4.test.ts` covers all 6 spells with
  matching + non-matching ancestry cases (≥ 12 assertions)
- All existing tests still pass (no regression)
- `tsc --noEmit` is clean

### Immediate Priority

1. Wire EA in 6 spells (incrementally — commit after all 6 + tests pass)
2. Run new EA test file + de-flake any nat-1/nat-20 edge cases (mirror Session 50
   de-flake approach: retry-until-hit loops, widened thresholds)
3. Write `zHANDOVER-SESSION-51.md`, commit, verify CI green

### Notes

- Pattern is identical to Sessions 47-50: see `src/spells/cloudkill.ts` etc.
- Reverse published order: XGE (2017) spells first, then PHB (2014) spells
- Do NOT touch `combat.ts` — weapon-rider EA is a Core Engine task (TG-015)
