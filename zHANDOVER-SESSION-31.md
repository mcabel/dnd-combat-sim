# zHANDOVER — Session 31

**Date:** 2026-06-21
**Agent:** Core Engine (Z.ai) — z/Cantrip workstream
**Focus:** TG-006 Phase 4 (final) — Last 2 PHB Conjure spells: Conjure Fey (L6) + Conjure Celestial (L7)

---

## Session Summary

This session finished the **PHB Conjure spell family** by implementing the last two spells from the Session 30 next-steps list. Together with Session 29 (16 TCE/Find spells) and Session 30 (3 PHB Conjure spells), the TG-006 Summon/Conjure subsystem now covers **21 summon spells** total — the entire PHB Conjure family plus all Tasha's-style Summon X spells and the Find Familiar/Steed/Greater Steed trio.

| # | Spell | Level | v1 Default | Commit |
|---|-------|-------|------------|--------|
| 1 | Conjure Fey | L6 | 1 Green Hag (CR 3) — AC 17, HP 82, Claws +6 2d8+4 slashing | (this session) |
| 2 | Conjure Celestial | L7 | 1 Couatl (CR 4) — AC 19, HP 97, Bite +8 1d6+5 + DC 13 CON or poisoned, Constrict +6 2d6+3 + DC 15 STR or grappled | (this session) |

---

## Architecture Decisions

### 1. v1 default creature picks (with MM bestiary constraints)

For Conjure Fey (L6, maxCR 6):
- The Monster Manual 2014 contains NO fey of CR 4-6. The highest-CR MM fey is the **Green Hag (CR 3)**.
- v1 picks the Green Hag as the strongest MM fey within the L6 cap. The CR 3 stat block is valid for any L6+ slot per the spell's CR-scaling rule.
- A future v2 should pull from a wider bestiary (Yeth Hound CR 4 from MTF, Korred CR 4 from VGM, Bard CR 4 from VGM, etc.) to make the L6 slot feel more impactful.

For Conjure Celestial (L7, maxCR 4):
- The Monster Manual 2014 has only ONE CR 4 celestial: the **Couatl (CR 4)**. Other MM celestials are: Pegasus (CR 2, under cap), Unicorn (CR 5, over cap), Deva (CR 10, way over cap).
- v1 picks the Couatl as the canonical L7 default. The CR 4 stat block is valid for any L7+ slot per the spell's CR-scaling rule.
- For L8/L9 upcast, the maxCR increases to 5/6 but no MM celestials fit those ranges — v1 keeps the Couatl stat block for all L7+ slots. A future v2 would need VGM/MTF/etc. for CR 5-6 celestials.

### 2. Conjure Celestial is DISTINCT from TCE Summon Celestial

This is a common point of confusion. Two different spells share the "celestial" theme:

| Spell | Source | Level | Stat Block | Module File |
|-------|--------|-------|------------|-------------|
| Summon Celestial | TCE p.111 | L5 | Celestial Spirit (hardcoded, scales with slot) | `summon_celestial.ts` |
| Conjure Celestial | PHB p.225 | L7 | Couatl (from MM by CR) | `conjure_celestial.ts` |

The test file `conjure_celestial.test.ts` includes a section (test #10) that explicitly verifies the two spells coexist as separate modules with different names and levels.

### 3. Conjure Celestial CR progression differs from Conjure Fey/Elemental

All three "single large creature" PHB Conjure spells scale CR with slot level, but the formulas differ:

| Spell | Base Slot | Base CR | CR Progression |
|-------|-----------|---------|----------------|
| Conjure Elemental | L5 | 5 | maxCR = slotLevel (L5→5, L6→6, ..., L9→9) |
| Conjure Fey | L6 | 6 | maxCR = slotLevel (L6→6, L7→7, ..., L9→9) |
| Conjure Celestial | L7 | 4 | maxCR = 4 + (slotLevel - 7) (L7→4, L8→5, L9→6) |

Conjure Celestial starts at CR 4 (not CR 7) because it's a L7 spell but the celestial CR cap is lower — a CR 7 celestial would be game-breaking at L7. The `CONJURE_CELESTIAL_OPTIONS` table in `cr_picker.ts` documents this progression and the test suite verifies the `maxCR = 4 + (slotLevel - 7)` invariant.

### 4. Upcast handling (consistent with Session 30 Conjure Elemental pattern)

Both new spells document their upcast behaviour in `cr_picker.ts` option tables but the v1 stat block stays the same regardless of slot level:
- `metadata.conjureFeyUpcastV1Implemented = true`
- `metadata.conjureCelestialUpcastV1Implemented = true`

The slot level IS consumed correctly (lowest available L6+ or L7+ slot is used) and the cast log mentions the slot level. The stat block just doesn't change because v1 only has one hardcoded stat block per spell. A future v2 should pick higher-CR creatures from a wider bestiary based on the slot level.

### 5. v1 simplifications for non-modelled mechanics

For the **Green Hag**:
- Innate Spellcasting (at-will dancing lights, minor illusion, vicious mockery): NOT modelled — would require AI planner integration for at-will cantrips
- Illusory Appearance ( disguise as humanoid): NOT modelled — utility, not combat-relevant
- Invisible Passage (turn invisible until attack/cast/concentration): NOT modelled — would interfere with combat targeting
- Mimicry (mimic animal sounds and humanoid voices): NOT modelled — utility
- Amphibious (breathe water): modelled via `swimSpeed = 30`

For the **Couatl**:
- Innate Spellcasting (DC 16): NOT modelled — would require AI planner integration for spell-like abilities
- Change Shape (polymorph): NOT modelled — utility
- Truesight 120 ft: NOT modelled — perception system uses a simpler model; couatl's high WIS already gives strong passive perception
- Shielded Mind (immune to scrying): NOT modelled — no scrying mechanic in combat sim
- Magic Weapons: NOT modelled — engine doesn't distinguish magic vs non-magic weapon attacks for damage resistance
- Bite poison (unconscious while poisoned): modelled as a DC 13 CON save on hit via the action's `saveDC`/`saveAbility` fields. The poisoned condition is applied via the standard engine condition system; the "unconscious while poisoned" rider is NOT modelled (no conditional unconsciousness mechanic).
- Constrict grapple: modelled as a DC 15 STR save on hit. The engine's grapple/restrain mechanic integration is partial — the save DC is recorded on the action for future integration.
- Radiant/psychic damage immunity: documented in `traits` but not enforced (Combatant type lacks a dedicated `immunities` field).
- Charmed/frightened condition immunity: documented in `traits` but not enforced (same reason).

### 6. Planner priority order (updated for Session 31)

With the two new spells, the PHB Conjure family planner priority is now fully sorted by slot level (higher-slot single creatures are typically more impactful than lower-slot packs):

1. Conjure Celestial (L7, 1 Couatl CR 4)
2. Conjure Fey (L6, 1 Green Hag CR 3)
3. Conjure Elemental (L5, 1 Fire Elemental CR 5)
4. Conjure Woodland Beings (L4, 4 Sprites)
5. Conjure Minor Elementals (L4, 4 Mud Mephits)
6. Conjure Animals (L3, 2 Wolves) — pre-existing from Session 29

All six PHB Conjure spells share the same TCE-style initiative insertion pattern (shares caster's initiative, acts immediately after caster).

---

## Files Changed

### Source files (new)
- `src/spells/conjure_fey.ts` — 1 Green Hag, AC 17, HP 82, Claws +6 2d8+4 slashing, Amphibious + 4 utility traits documented
- `src/spells/conjure_celestial.ts` — 1 Couatl, AC 19, HP 97, Bite +8 1d6+5 + DC 13 CON poison + Constrict +6 2d6+3 + DC 15 STR grapple, 7 traits documented (Magic Weapons, Shielded Mind, Innate Spellcasting, Change Shape, Truesight, 2 immunity traits)

### Source files (modified)
- `src/summons/cr_picker.ts` — Added `CONJURE_FEY_OPTIONS`, `DEFAULT_CF_OPTION`, `CONJURE_CELESTIAL_OPTIONS`, `DEFAULT_CC_OPTION`
- `src/engine/combat.ts` — Added imports + 2 dispatch entries for the new spells in the `case 'summonSpell':` chain
- `src/ai/planner.ts` — Added imports + 2 planner branches at the TOP of the PHB Conjure family priority list (Conjure Celestial > Conjure Fey > Conjure Elemental > ...)

### Test files (new)
- `src/test/conjure_fey.test.ts` — 128 assertions
- `src/test/conjure_celestial.test.ts` — 155 assertions (includes explicit "distinct from TCE Summon Celestial" verification section)

---

## Test Coverage

| Test file | Assertions |
|-----------|------------|
| conjure_fey.test.ts | 128 |
| conjure_celestial.test.ts | 155 |
| **Total new** | **283 assertions** |

All 2 new test files use the standard CI-expected `"Results: X passed, 0 failed"` summary line.

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `ts-node --transpile-only` per-file (CI-style) | ✅ All 19 summon-related test files pass (17 from Sessions 29-30 + 2 new) |
| Core combat/planner/ai tests | ✅ ai.test (26), cantrip_planner (46), combat (46), concentration_ai (34), engine (71), spell_effects (23) — all pass |
| Source compilation | ✅ Clean |

---

## Full Spell Inventory — Updated (Final)

Sessions 29-31 together added 21 summon spells to the engine:

| # | Spell | Level | Type | Source | v1 Default |
|---|-------|-------|------|--------|------------|
| 1 | Find Familiar | L1 | Instant | PHB p.240 | Owl (Tiny, Help action) |
| 2 | Summon Beast | L2 | Conc 1hr | TCE p.111 | Land (Bestial Spirit) |
| 3 | Find Steed | L2 | Instant | PHB p.240 | Warhorse (combat_mount) |
| 4 | Summon Fey | L3 | Conc 1hr | TCE p.112 | Fey Spirit |
| 5 | Summon Undead | L3 | Conc 1hr | TCE p.113 | Putrid (Undead Spirit) |
| 6 | Summon Shadowspawn | L3 | Conc 1hr | TCE p.113 | Shadow Spirit |
| 7 | Summon Lesser Demons | L3 | Conc 1min | XGE p.167 | 2 Dretches |
| 8 | Conjure Animals | L3 | Conc 1hr | PHB p.225 | 2 Wolves |
| 9 | Summon Aberration | L4 | Conc 1hr | TCE p.110 | Slaad (Aberrant Spirit) |
| 10 | Summon Construct | L4 | Conc 1hr | TCE p.111 | Construct Spirit |
| 11 | Summon Elemental | L4 | Conc 1hr | TCE p.112 | Fire (Elemental Spirit) |
| 12 | Summon Greater Demon | L4 | Conc 1min | XGE p.166 | Barlgura |
| 13 | Find Greater Steed | L4 | Instant | XGE p.156 | Griffon (combat_mount) |
| 14 | Conjure Woodland Beings | L4 | Conc 1hr | PHB p.228 | 4 Sprites |
| 15 | Conjure Minor Elementals | L4 | Conc 1hr | PHB p.226 | 4 Mud Mephits |
| 16 | Summon Celestial | L5 | Conc 1hr | TCE p.111 | Defender (Celestial Spirit) |
| 17 | Summon Draconic Spirit | L5 | Conc 1hr | FTD p.21 | Red dragon |
| 18 | Conjure Elemental | L5 | Conc 1hr | PHB p.225 | 1 Fire Elemental (CR 5) |
| 19 | Summon Fiend | L6 | Conc 1hr | TCE p.112 | Devil (Fiendish Spirit) |
| 20 | **Conjure Fey** | **L6** | **Conc 1hr** | **PHB p.226** | **1 Green Hag (CR 3)** |
| 21 | **Conjure Celestial** | **L7** | **Conc 1hr** | **PHB p.225** | **1 Couatl (CR 4)** |

**Total: 21 summon spells** (was 19 after Session 30, was 16 after Session 29).

**PHB Conjure family: COMPLETE.** All six PHB Conjure spells (Animals, Woodland Beings, Minor Elementals, Elemental, Fey, Celestial) are now implemented as bespoke modules.

---

## Remaining TG-006 Work

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

### Re-categorization (minor)
- Conjure Volley/Barrage: re-categorize as damage spells (not summons) — these are actually already in the generic registry as damage spells, so this is just a documentation cleanup

---

## Next Session Priorities (Updated)

1. **Forced movement subsystem** — Thunderwave push, Eldritch Blast push (Repelling Blast invocation), Thunderous Smite, since the Couatl's Constrict grapple and the Fire Elemental's "occupy hostile space" mechanic both want this infrastructure
2. **True Invisibility** — Invisibility spell, Greater Invisibility; relevant because the Green Hag's Invisible Passage and the Sprite's Invisibility trait are both currently NOT modelled
3. **Reaction spell subsystem** (TG-008) — Shield, Counterspell, Absorb Elements
4. **Damage immunities field** — add a dedicated `immunities: DamageType[]` field to `Combatant` so the Couatl's radiant/psychic immunity, the Fire Elemental's fire immunity, and the Mud Mephit's acid/poison immunity can be enforced rather than just documented in traits
5. **TG-013/TG-014 housekeeping** — Move `rollDiceString` to utils, fix BB/GFB labels
6. **At-will innate spellcasting** — give summoned creatures (Green Hag, Couatl) access to their at-will cantrips via the AI planner; this would make the L6/L7 summons more impactful
7. **Bestiary integration** — wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the upcast paths

---

## Commit Log (Session 31)

```
Phase 4 final: Conjure Fey + Conjure Celestial (TG-006 — PHB Conjure family complete)
  - src/spells/conjure_fey.ts         (1 Green Hag, AC 17, HP 82, Claws +6 2d8+4 slashing)
  - src/spells/conjure_celestial.ts   (1 Couatl, AC 19, HP 97, Bite +8 + DC 13 CON poison +
                                       Constrict +6 + DC 15 STR grapple; distinct from TCE L5
                                       Summon Celestial)
  - src/summons/cr_picker.ts          (+2 option tables, +2 default constants)
  - src/engine/combat.ts              (imports + 2 dispatch entries)
  - src/ai/planner.ts                 (imports + 2 planner branches at top of PHB Conjure priority)
  - src/test/conjure_fey.test.ts          (128 assertions, includes upcast L6/L7)
  - src/test/conjure_celestial.test.ts    (155 assertions, includes upcast L7/L8 +
                                            "distinct from TCE Summon Celestial" verification)
```

---

## Generic Registry Count
- Unchanged from Sessions 29-30: 129 spells in `_generic_registry.ts` (none of the 2 new spells were in the generic registry — they were completely absent, not bulk-implemented)
