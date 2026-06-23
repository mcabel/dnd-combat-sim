# TASK.md

## Active Objective

**TG-005: Witch Bolt** — implement Witch Bolt (PHB p.289) as a concentration
spell that deals 1d12 lightning damage on hit, then 1d12 per turn if the caster
uses their action to maintain it and the target stays in range (≤30 ft). Both
initial hit and subsequent ticks use `applySpellEffect` / `activeEffects`;
concentration broken by caster taking damage. Cantrip-z owns spell module;
Core Engine owns planner branch and concentration-break hook.

## Current Phase

Not started.

## Acceptance Criteria

- `witch_bolt.ts` spell module with `shouldCast / execute / metadata`
- On-hit: applies `damage_zone`-style tick rider as a `concentration` effect
- Per-turn action cost: planner consumes action slot when maintaining
- Range check (30 ft): if caster or target moves out of range, effect ends
- Concentration broken on caster damage (already wired in `applyDamageWithTempHP`)
- Passing tests covering hit, miss, maintain, break on move, break on damage

## Immediate Priority

1. Check TEAMGOALS.md for Cantrip-z Witch Bolt status (TG-005)
2. Post RFC if touching `runCombat` loop
3. Implement planner branch in `planner.ts`

## Notes

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
