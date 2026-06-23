# zHANDOVER — Session 30

**Date:** 2026-06-21
**Agent:** Core Engine (Z.ai) — z/Cantrip workstream
**Focus:** TG-006 Phase 4 — PHB Conjure spells (3 new spells: Conjure Woodland Beings L4, Conjure Minor Elementals L4, Conjure Elemental L5)

---

## Session Summary

This session continued the **zHANDOVER-SESSION-29 "Next Session Priorities"** list, picking Priority #1: more PHB Conjure spells. The three remaining canonical PHB Conjure spells were implemented, all following the established `conjure_animals.ts` pattern (hardcoded stat blocks + `pendingInitiativeInserts` + concentration-break despawn).

| # | Spell | Level | v1 Default | Commit |
|---|-------|-------|------------|--------|
| 1 | Conjure Woodland Beings | L4 | 4 Sprites (CR 1/4) — AC 15, HP 2, Shortbow +6 1 piercing + DC 10 CON poisoned | (this session) |
| 2 | Conjure Minor Elementals | L4 | 4 Mud Mephits (CR 1/4) — AC 11, HP 27, Fists +3 1d6+1 bludgeoning | (this session) |
| 3 | Conjure Elemental | L5 | 1 Fire Elemental (CR 5) — AC 13, HP 102, Touch +6 2d6+3 fire × 2 Multiattack | (this session) |

---

## Architecture Decisions (carried forward from Session 29)

### 1. v1 simplified spawn count (consistent with Conjure Animals v1)
PHB Conjure spells list up to 8 CR 1/4 creatures for the L4 variants. Conjure Animals v1 spawned only 2 Wolves (not 8) for a manageable battlefield footprint. We follow the same approach: **Conjure Woodland Beings and Conjure Minor Elementals v1 each spawn 4 creatures** (instead of the listed max of 8). Conjure Elemental v1 spawns 1 elemental (the spell only allows 1).

### 2. Stat blocks are manually built (NOT bestiary lookup)
Same as Session 29 — TCE/PHB summon stat blocks are inline in the spell description and the bestiary may not be loaded at runtime. Each spell module builds the Combatant manually via a `create[MonsterName](caster, ...)` helper function.

### 3. Initiative insertion: TCE-style (after caster)
All three new spells use `pendingInitiativeInserts` with `insertAfterId = caster.id`, matching the TCE-style "shares your initiative, acts immediately after yours" pattern used by every TG-006 summon.

### 4. Concentration break despawns all summons
All three new spells are concentration 1 hr. The existing `removeEffectsFromCaster()` despawn hook (added in Session 29 Phase 1a) handles cleanup automatically — no bespoke despawn code needed.

### 5. Conjure Elemental upcast: documented but v1 stat block stays the same
PHB p.225 says: "When you cast this spell using a spell slot of 6th level or higher, the CR of the elemental is increased by 1 for each slot level above 5th."

- v1 always spawns the Fire Elemental stat block (CR 5). The Fire Elemental is valid for any L5+ slot per the spell's CR-scaling rule.
- The `CONJURE_ELEMENTAL_OPTIONS` table in `cr_picker.ts` documents the L5-L9 maxCR progression (maxCR = slotLevel).
- A future v2 should pick higher-CR elementals from the bestiary (e.g. Salamander CR 5, Invisible Stalker CR 6, Dao CR 11, etc.) based on the slot level.
- `metadata.conjureElementalUpcastV1Implemented = true` — flag indicates upcast is "supported" (slot consumed correctly, log mentions slot level) even though the stat block doesn't change.

### 6. v1 simplifications for non-modelled mechanics
- **Sprite Invisibility trait**: NOT modelled (would interfere with combat targeting)
- **Sprite Heart Sight**: NOT modelled (utility, not combat-relevant)
- **Mud Mephit Mud Breath (recharge 6)**: NOT modelled (engine lacks recharge-on-N+ mechanic) — Fists is the only action used in v1
- **Mud Mephit Death Burst (blind on death)**: NOT modelled (no on-death hook yet) — but documented in `traits` array
- **Fire Elemental Ignite-on-hit**: NOT modelled (no ongoing-damage hook yet)
- **Fire Elemental Fire Form**: NOT modelled (no occupy-hostile-space mechanic)
- **Fire Elemental fire immunity**: documented in `traits` array but not enforced (Combatant type lacks a dedicated `immunities` field; future engine work should add one)
- **Conjure Elemental concentration-break hostility**: PHB says the elemental becomes hostile on concentration break; v1 uses the standard "despawn on concentration break" behaviour shared with all TG-006 summons for engine consistency

---

## Files Changed

### Source files (new)
- `src/spells/conjure_woodland_beings.ts` — 4 Sprites, AC 15, HP 2, Shortbow +6 1d4-3 (avg 1) piercing + DC 10 CON poisoned + Longsword +2 1 slashing
- `src/spells/conjure_minor_elementals.ts` — 4 Mud Mephits, AC 11, HP 27, Fists +3 1d6+1 bludgeoning, Death Burst + Mud Breath (recharge 6) traits
- `src/spells/conjure_elemental.ts` — 1 Fire Elemental, AC 13, HP 102, Touch +6 2d6+3 fire × 2 via Multiattack, Fire Form + Ignite + Water Susceptibility traits

### Source files (modified)
- `src/summons/cr_picker.ts` — Added `CONJURE_WOODLAND_BEINGS_OPTIONS`, `DEFAULT_CWB_OPTION`, `CONJURE_MINOR_ELEMENTALS_OPTIONS`, `DEFAULT_CME_OPTION`, `CONJURE_ELEMENTAL_OPTIONS`, `DEFAULT_CE_OPTION`
- `src/engine/combat.ts` — Added imports + dispatch entries for the 3 new spells in the `case 'summonSpell':` chain
- `src/ai/planner.ts` — Added imports + AI planner branches for the 3 new spells (priority: Conjure Elemental > Conjure Woodland Beings > Conjure Minor Elementals, since the L5 single-elemental is the most impactful)

### Test files (new)
- `src/test/conjure_woodland_beings.test.ts` — 149 assertions
- `src/test/conjure_minor_elementals.test.ts` — 135 assertions
- `src/test/conjure_elemental.test.ts` — 139 assertions (includes upcast L5/L6 behaviour tests)

---

## Test Coverage

| Test file | Assertions |
|-----------|------------|
| conjure_woodland_beings.test.ts | 149 |
| conjure_minor_elementals.test.ts | 135 |
| conjure_elemental.test.ts | 139 |
| **Total new** | **423 assertions** |

All 3 new test files use the standard CI-expected `"Results: X passed, 0 failed"` summary line.

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `ts-node --transpile-only` per-file (CI-style) | ✅ All 17 summon-related test files pass |
| Core combat/planner/ai tests | ✅ ai.test (26), cantrip_planner (46), combat (51), concentration_ai (34), engine (71), spell_effects (23) — all pass |
| Source compilation | ✅ Clean |

---

## Full Spell Inventory — Updated

Session 29 added 16 summon spells. Session 30 adds 3 more:

| Spell | Level | Type | Source | v1 Default |
|-------|-------|------|--------|------------|
| Find Familiar | L1 | Instant | PHB p.240 | Owl (Tiny, Help action) |
| Summon Beast | L2 | Conc 1hr | TCE p.111 | Land (Bestial Spirit) |
| Find Steed | L2 | Instant | PHB p.240 | Warhorse (combat_mount) |
| Summon Fey | L3 | Conc 1hr | TCE p.112 | Fey Spirit |
| Summon Undead | L3 | Conc 1hr | TCE p.113 | Putrid (Undead Spirit) |
| Summon Shadowspawn | L3 | Conc 1hr | TCE p.113 | Shadow Spirit |
| Summon Lesser Demons | L3 | Conc 1min | XGE p.167 | 2 Dretches |
| Conjure Animals | L3 | Conc 1hr | PHB p.225 | 2 Wolves |
| Summon Aberration | L4 | Conc 1hr | TCE p.110 | Slaad (Aberrant Spirit) |
| Summon Construct | L4 | Conc 1hr | TCE p.111 | Construct Spirit |
| Summon Elemental | L4 | Conc 1hr | TCE p.112 | Fire (Elemental Spirit) |
| Summon Greater Demon | L4 | Conc 1min | XGE p.166 | Barlgura |
| Find Greater Steed | L4 | Instant | XGE p.156 | Griffon (combat_mount) |
| **Conjure Woodland Beings** | **L4** | **Conc 1hr** | **PHB p.228** | **4 Sprites** |
| **Conjure Minor Elementals** | **L4** | **Conc 1hr** | **PHB p.226** | **4 Mud Mephits** |
| Summon Celestial | L5 | Conc 1hr | TCE p.111 | Defender (Celestial Spirit) |
| Summon Draconic Spirit | L5 | Conc 1hr | FTD p.21 | Red dragon |
| **Conjure Elemental** | **L5** | **Conc 1hr** | **PHB p.225** | **1 Fire Elemental (CR 5)** |
| Summon Fiend | L6 | Conc 1hr | TCE p.112 | Devil (Fiendish Spirit) |

**Total: 19 summon spells** (was 16 after Session 29).

---

## Remaining TG-006 Work (Phase 4 — Still Deferred)

### More PHB Conjure spells (3 spells, MEDIUM complexity)
- Conjure Fey (L6): 1 fey of CR 6 or lower
- Conjure Celestial (L7): 1 celestial of CR 4 or lower
- Conjure Volley/Barrage: re-categorize as damage spells (not summons)

### High-complexity summon spells (19 spells — defer to future sessions)
- Animate Dead (L3): Creates undead from corpses — needs corpse tracking
- Create Undead (L6): Same as Animate Dead but higher level
- Magic Jar (L6): Body possession — bespoke subsystem
- Simulacrum (L7): Creates a copy of a creature — needs stat copying
- Planar Ally (L6): Negotiation subsystem
- Planar Binding (L5): Duration binding without concentration
- Gate (L9): Portal to another plane
- True Polymorph (L9): Full creature transformation
- Shapechange (L9): Self-transformation
- And others (Glyph of Warding, Symbol, Clone, Demiplane, etc.)

---

## Next Session Priorities (from Session 29 list, reordered)

1. **Conjure Fey (L6)** + **Conjure Celestial (L7)** — finish the PHB Conjure family (2 spells)
2. **Forced movement subsystem** — Thunderwave push, Eldritch Blast push, Thunderous Smite
3. **True Invisibility** — Invisibility spell, Greater Invisibility
4. **Reaction spell subsystem** (TG-008) — Shield, Counterspell, Absorb Elements
5. **TG-013/TG-014 housekeeping** — Move `rollDiceString` to utils, fix BB/GFB labels

---

## Commit Log (Session 30)

```
Phase 4: Conjure Woodland Beings + Conjure Minor Elementals + Conjure Elemental (TG-006)
  - src/spells/conjure_woodland_beings.ts    (4 Sprites, AC 15, HP 2, Shortbow + poison rider)
  - src/spells/conjure_minor_elementals.ts   (4 Mud Mephits, AC 11, HP 27, Fists +3 1d6+1)
  - src/spells/conjure_elemental.ts          (1 Fire Elemental, AC 13, HP 102, Multiattack × 2)
  - src/summons/cr_picker.ts                 (+3 option tables, +3 default constants)
  - src/engine/combat.ts                     (imports + 3 dispatch entries)
  - src/ai/planner.ts                        (imports + 3 planner branches)
  - src/test/conjure_woodland_beings.test.ts    (149 assertions)
  - src/test/conjure_minor_elementals.test.ts   (135 assertions)
  - src/test/conjure_elemental.test.ts          (139 assertions, includes upcast L5/L6)
```

---

## Generic Registry Count
- Unchanged from Session 29: 129 spells in `_generic_registry.ts` (none of the 3 new spells were in the generic registry — they were completely absent, not bulk-implemented)
