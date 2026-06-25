# Monster Spell Coverage Report

Generated: `2026-06-25T19:33:40.178Z`
Source: 2401 bestiary entries from `bestiaryData/`, scanned via `scripts/scan_monster_spells.ts`.

> **Purpose:** This report guides which spell modules to build next for the
> Monster Spellcasting engine (`src/ai/monster_spellcasting.ts`). Spells used by
> many creatures but not yet implemented are the highest-value targets — each
> new module unlocks AI behavior for every creature that knows it.
>
> **Regenerate** after implementing new spells: `npx ts-node --transpile-only scripts/scan_monster_spells.ts`

## Summary

| Metric | Value |
|--------|-------|
| Total creatures in bestiary | 2401 |
| Creatures with `monsterSpellcasting` | 775 (32.3%) |
| Total spell references (incl. duplicates) | 6136 |
| Unique spells referenced | 364 |
| ├─ Already implemented | 355 (97.5%) |
| └─ NOT yet implemented | 9 (2.5%) |

## Top 50 Unbuilt Spells (by creature frequency)

Priority for future spell-module work. Each row lists the spell name, the number
of distinct creatures that know it, total references (a creature may list the same
spell at multiple slot levels — counted separately), and a few example creatures.

| Rank | Spell | # Creatures | Total Refs | Example Creatures | Notes |
|------|-------|-------------|------------|-------------------|-------|
| 1 | Protection from Evil and Good | 27 | 27 | Heralds of Dust Exorcist, Hollyphant, Skull Lasher of Myrkul | `PHB` · Abjuration · levels: atWill/daily,L1 |
| 2 | Dispel Evil and Good | 15 | 15 | Heralds of Dust Exorcist, Omin Dran, Kostchtchie | `PHB` · Abjuration · levels: atWill/daily,L5 |
| 3 | [object Object] | 5 | 8 | Zodar, Lichen Lich, Master Sage | levels: atWill/daily |
| 4 | Wind Wall | 3 | 3 | Frost Druid, Triton Master of Waves, Asharra | `PHB` · Evocation · levels: atWill/daily,L3 |
| 5 | Prismatic Wall | 2 | 2 | Ekengarik, Niv-Mizzet | `PHB` · Abjuration · levels: atWill/daily,L9 |
| 6 | Wall of Thorns | 2 | 2 | Conclave Dryad, Druid of the Old Ways | `PHB` · Conjuration · levels: atWill/daily,L6 |
| 7 | Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage) | 1 | 1 | Cryonax | levels: atWill/daily |
| 8 | Shapechange | 1 | 1 | Hollyphant | `PHB` · Transmutation · levels: atWill/daily |
| 9 | Thunder Step | 1 | 1 | Malivar | `XGE` · Conjuration · levels: L3 |

## Full Unbuilt Spells List (all)

| Rank | Spell | # Creatures | Total Refs |
|------|-------|-------------|------------|
| 1 | Protection from Evil and Good | 27 | 27 |
| 2 | Dispel Evil and Good | 15 | 15 |
| 3 | [object Object] | 5 | 8 |
| 4 | Wind Wall | 3 | 3 |
| 5 | Prismatic Wall | 2 | 2 |
| 6 | Wall of Thorns | 2 | 2 |
| 7 | Otiluke's Freezing Sphere (45 ({@damage 13d6}) Damage) | 1 | 1 |
| 8 | Shapechange | 1 | 1 |
| 9 | Thunder Step | 1 | 1 |

## Implemented Spells (already built — summary)

| Level | Implemented count |
|-------|-------------------|
| unknown | 43 |
| 0 | 34 |
| 1 | 59 |
| 2 | 62 |
| 3 | 47 |
| 4 | 33 |
| 5 | 29 |
| 6 | 20 |
| 7 | 14 |
| 8 | 9 |
| 9 | 5 |

## Methodology

1. **Bestiary scan**: iterates every JSON in `bestiaryData/`, parses each
   creature's 5etools `spellcasting` block, and collects spell names from the
   `will` (at-will), `daily`, and `spells` (slot-based, levels 0–9) fields.
   `@spell` tags are stripped, parentheticals like `(self only)` are removed.

2. **Implementation check**: a spell is "implemented" if EITHER:
   - it appears in `spell-cache/level-*.json` with `implemented: true` (i.e. has
     a module in `src/spells/<name>.ts` registered via `_generic_registry.ts` or a
     dedicated `case` in `combat.ts`), OR
   - it appears in `CANTRIP_TEMPLATES` in `src/ai/monster_spellcasting.ts` (the
     monster-only combat cantrip templates handled directly by the monster
     spellcasting engine — these are not in the spell cache).

3. **Frequency**: creature count is the number of distinct creatures that list
   the spell in any field. Total refs includes duplicates when a creature lists
   the same spell at multiple slot levels.
