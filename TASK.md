# TASK.md

> Per AGENTS.md: when an agent has an uploaded handover, that handover supersedes
> this file for that agent. TASK.md is the default for agents without a handover
> AND the cross-workstream priority list. Each workstream section below lists
> that workstream's own next priorities.

---

## Core Engine Workstream (HANDOVER-SESSION-XX)

### Active Objective

**TG-005: Witch Bolt** — implement Witch Bolt (PHB p.289) as a concentration
spell that deals 1d12 lightning damage on hit, then 1d12 per turn if the caster
uses their action to maintain it and the target stays in range (≤30 ft). Both
initial hit and subsequent ticks use `applySpellEffect` / `activeEffects`;
concentration broken by caster taking damage. Cantrip-z owns spell module;
Core Engine owns planner branch and concentration-break hook.

### Current Phase

Not started.

### Acceptance Criteria

- `witch_bolt.ts` spell module with `shouldCast / execute / metadata`
- On-hit: applies `damage_zone`-style tick rider as a `concentration` effect
- Per-turn action cost: planner consumes action slot when maintaining
- Range check (30 ft): if caster or target moves out of range, effect ends
- Concentration broken on caster damage (already wired in `applyDamageWithTempHP`)
- Passing tests covering hit, miss, maintain, break on move, break on damage

### Immediate Priority

1. Check TEAMGOALS.md for Cantrip-z Witch Bolt status (TG-005)
2. Post RFC if touching `runCombat` loop
3. Implement planner branch in `planner.ts`

### Notes

**GFB lingering fire discrepancy** (documented Session 48):
TASK.md previously claimed Green-Flame Blade has a "lingering fire" persistent
rider. This is incorrect — GFB's fire splash is INSTANT (applied on hit,
TCE p.107). No cross-round persistence is needed or implemented. The TASK.md
description was erroneous. TG-001 closure covers only Booming Blade thunder
rider migration; GFB requires no change.

**TG-001 closure** (Session 48):
`_boomingBladePendingDamageDice` / `_boomingBladeCasterId` scratch fields on
`Combatant` replaced by a typed `'movement_rider'` entry in `activeEffects`.
RFC-001 in TEAMGOALS.md. All 4 affected test files updated. Zero regressions.

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
