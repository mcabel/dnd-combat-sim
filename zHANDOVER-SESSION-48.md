# zHANDOVER — Session 48

**Date:** 2026-06-23
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement 3 subclass feature-wiring tasks from Session 47's next-session priorities — wire Elemental Affinity in 3 more bespoke spells (Task #29-follow-up-5c), wire Open Hand Monk Diamond Soul proficiency in all saves (Task #29-follow-up-4b), and wire Land Druid Land's Stride difficult terrain immunity (Task #29-follow-up-3b). All 3 tasks completed.

---

## Session Summary

Session 48 closed 3 more subclass feature-wiring items from Session 47's priority list. Elemental Affinity (Draconic Sorcerer 6) was extended from Fireball + the generic 'cast' case to 3 more bespoke spell execute functions: Lightning Bolt (lightning), Cone of Cold (cold), and Burning Hands (fire). Diamond Soul (Open Hand Monk 13) now grants proficiency in ALL saving throws — wired in `rollSave()` using the `combatantProfBonus()` helper from Session 46 (which correctly returns the level-based proficiency for PCs, unlike the old `profBonusByCR(cr=null)` which always returned +2). Land's Stride (Land Druid 6) now lets the druid ignore difficult terrain movement penalties — wired in `executeMove()` by wrapping the terrainFn to convert 'difficult' → 'normal' when the mover has the feature.

| Component | Status | Lines |
|-----------|--------|-------|
| **Task #29-follow-up-5c: Elemental Affinity in 3 more bespoke spells** | | |
| `src/spells/lightning_bolt.ts` — import + EA bonus in execute() | ✅ Done | +4 lines |
| `src/spells/cone_of_cold.ts` — import + EA bonus in execute() | ✅ Done | +4 lines |
| `src/spells/burning_hands.ts` — import + EA bonus in execute() | ✅ Done | +4 lines |
| `src/test/elemental_affinity_bespoke.test.ts` (NEW) — 12 assertions, 8 sections | ✅ Done | ~380 lines |
| **Task #29-follow-up-4b: Open Hand Monk Diamond Soul** | | |
| `src/engine/utils.ts` — rollSave() forces proficiency when Diamond Soul active | ✅ Done | +12 lines |
| `src/test/diamond_soul.test.ts` (NEW) — 15 assertions, 13 sections | ✅ Done | ~280 lines |
| **Task #29-follow-up-3b: Land Druid Land's Stride** | | |
| `src/engine/combat.ts` — executeMove() wraps terrainFn for Land's Stride | ✅ Done | +15 lines |
| `src/test/lands_stride.test.ts` (NEW) — 15 assertions, 8 sections | ✅ Done | ~310 lines |

**Total:** ~1020 lines of new/modified code, 42 new test assertions across 3 new test files.

---

## Architecture

### Task #29-follow-up-5c: Elemental Affinity in 3 more bespoke spells

**Problem:** Session 47 wired Elemental Affinity in Fireball + the generic 'cast' case, but 3 other bespoke spells with their own execute functions (Lightning Bolt, Cone of Cold, Burning Hands) were not wired.

**Solution:**
1. Imported `elementalAffinityBonus` in `lightning_bolt.ts`, `cone_of_cold.ts`, `burning_hands.ts`.
2. Added `const eaBonus = elementalAffinityBonus(caster, damageType)` before the damage roll in each execute function.
3. Added `eaBonus` to the damage roll before save halving (the bonus IS halved on save success — consistent with v1's model where the bonus is part of the total damage roll).
4. Burning Hands uses inline `rollDie(6)` calls (no `rollDamage()` helper) — the EA bonus is added to the inline sum.

**End-to-end test result:** Draconic Sorcerer 6 with lightning ancestry deals +3 lightning damage on Lightning Bolt. Cold ancestry deals +3 cold on Cone of Cold. Fire ancestry deals +3 fire on Burning Hands. Non-matching ancestry gets no bonus. Non-Sorcerer gets no bonus.

### Task #29-follow-up-4b: Open Hand Monk Diamond Soul

**Problem:** Session 45 added Diamond Soul to SUBCLASS_FEATURES but didn't wire it. The feature was flag-only.

**Solution:**
1. Modified `rollSave()` in `utils.ts`: when `combatant.classFeatures` includes 'Diamond Soul', force `isProficient = true` for all abilities (STR, DEX, CON, INT, WIS, CHA).
2. Uses `combatantProfBonus(combatant)` (Session 46 helper) instead of `profBonusByCR(combatant.cr)` — the latter returns +2 for all PCs (cr=null), which is wrong for level 5+ monks. `combatantProfBonus` correctly returns the level-based proficiency (+5 at level 13, +6 at level 17).
3. **Not doubled:** when a Monk already has STR/DEX save proficiency from the class, Diamond Soul does NOT add the bonus twice. The `effectiveProficient` flag uses OR logic (`isProficient || diamondSoulActive`), so the bonus is added exactly once.
4. **Ki reroll NOT wired:** the ki-reroll feature (spend 1 ki to reroll a failed save) requires ki tracking in `buildRawResources` — deferred to a future session. The proficiency-in-all-saves is the primary benefit.

**End-to-end test result:** Diamond Soul monk at level 13 succeeds 65% on DC 15 CON save vs 41% for vanilla monk (+24% from proficiency bonus +5). All 6 abilities get the proficiency bonus.

### Task #29-follow-up-3b: Land Druid Land's Stride

**Problem:** Session 45 added Land's Stride to SUBCLASS_FEATURES but didn't wire it. Land Druids were still slowed by difficult terrain.

**Solution:**
1. Modified `executeMove()` in `combat.ts`: when the mover has 'Land's Stride' in classFeatures, wraps the terrainFn to convert 'difficult' → 'normal' (no extra movement cost).
2. 'water' terrain is NOT affected — Land's Stride is about difficult terrain and plants, not swimming.
3. v1 simplification: all difficult terrain is treated as nonmagical (no magical-difficult-terrain tracking in v1).
4. The AI pathfinding in `movement.ts` calls `estimateMoveCostFt` WITHOUT a terrainFn (always treats terrain as 'normal') — so the AI doesn't plan around difficult terrain. Only the actual move execution (`executeMove` in `combat.ts`) charges the difficult terrain cost. This means Land's Stride only needs to be wired in `executeMove`.

**End-to-end test result:** Land Druid 6 moves 6 squares through difficult terrain on 30 ft budget (6 × 5 = 30, fits). Vanilla Druid 6 cannot (6 × 10 = 60, exceeds 30). Land Druid reaches (4,0) with 10 ft to spare; vanilla stays at origin.

---

## Files Changed

### New files (3)
- `src/test/elemental_affinity_bespoke.test.ts` — 12 assertions across 8 sections
- `src/test/diamond_soul.test.ts` — 15 assertions across 13 sections
- `src/test/lands_stride.test.ts` — 15 assertions across 8 sections

### Modified files (5)
- `src/spells/lightning_bolt.ts` — Elemental Affinity bonus in execute()
- `src/spells/cone_of_cold.ts` — Elemental Affinity bonus in execute()
- `src/spells/burning_hands.ts` — Elemental Affinity bonus in execute()
- `src/engine/utils.ts` — Diamond Soul proficiency in rollSave()
- `src/engine/combat.ts` — Land's Stride terrainFn wrapper in executeMove()

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `elemental_affinity_bespoke.test.ts` (12 assertions) | ✅ All pass |
| `diamond_soul.test.ts` (15 assertions) | ✅ All pass |
| `lands_stride.test.ts` (15 assertions) | ✅ All pass |
| `elemental_affinity.test.ts` (16 assertions) | ✅ All pass |
| `fireball.test.ts` (34 assertions) | ✅ All pass |
| `lightning_bolt.test.ts` (38 assertions) | ✅ All pass |
| `cone_of_cold.test.ts` (37 assertions) | ✅ All pass |
| `burning_hands.test.ts` (33 assertions) | ✅ All pass |
| `subclass_features.test.ts` (37 assertions) | ✅ All pass |
| `engine.test.ts` (71 assertions) | ✅ All pass |
| `combat.test.ts` (51 assertions) | ✅ All pass |
| `scenario.test.ts` (94 assertions) | ✅ All pass |
| `ai.test.ts` (26 assertions) | ✅ All pass |
| `natures_ward.test.ts` (14 assertions) | ✅ All pass |
| `wholeness_of_body.test.ts` (22 assertions) | ✅ All pass |

---

## CI Status

- **Task #29-follow-up-5c commit (d0ab332):** pending verification after push
- **Task #29-follow-up-4b commit (bdca72e):** pending verification after push
- **Task #29-follow-up-3b commit (945e8b9):** pending verification after push
- **Pre-session baseline (2fcaf8f):** success ✅ (Session 47 final commit)

---

## Next Session Priorities

Session 48 closed 3 more subclass feature-wiring items. The following items remain:

22. **Devil's Sight invocation** (continuation of Task #16) — Still deferred. Requires LOS engine changes for magical darkness.

29-follow-up-3c. **Wire Land Druid remaining features** — Natural Recovery (short-rest slot recovery), Nature's Sanctuary (beasts/plants must WIS save or lose target). Land's Stride + Nature's Ward are now wired.

29-follow-up-4c. **Wire Open Hand Monk remaining features** — Open Hand Technique (Flurry of Blows rider effects: prone/push/no reaction), Quivering Palm (touch-attack instakill). Diamond Soul + Wholeness of Body are now wired. Flurry of Blows + Quivering Palm need ki tracking (ki field not yet in buildRawResources).

29-follow-up-5c-2. **Wire Elemental Affinity in remaining bespoke spells** — Currently wired in Fireball, Lightning Bolt, Cone of Cold, Burning Hands + generic 'cast'. Future: wire in Shatter, Ice Knife, Catapult, and other bespoke spell execute functions.

29-follow-up-5d. **Wire Draconic Sorcerer remaining features** — Dragon Wings (fly speed at 14), Draconic Presence (frighten aura at 18). Elemental Affinity is now wired.

29-follow-up-6. **Wire Additional Fighting Style (Champion 10)** — character-build choice needing leveler/UI changes.

20-follow-up-2. **Model diseases for Lesser Restoration** — diseases not tracked in v1.

27-follow-up-3. **Additional surge options** — Surge for different spells when main was Attack.

---

## Commit Log (Session 48)

```
Session 48 Task #29-follow-up-5c: wire Elemental Affinity in 3 more bespoke spells
  - Lightning Bolt: +CHA mod when ancestry = lightning
  - Cone of Cold: +CHA mod when ancestry = cold
  - Burning Hands: +CHA mod when ancestry = fire
  - Bonus added before save halving (halved on save success)
  - 12 test assertions across 8 sections

Session 48 Task #29-follow-up-4b: wire Open Hand Monk Diamond Soul
  - Proficiency in ALL saving throws (STR, DEX, CON, INT, WIS, CHA)
  - Uses combatantProfBonus() for correct level-based proficiency
  - Not doubled when Monk already has class save proficiency
  - Ki reroll deferred (needs ki tracking)
  - 15 test assertions across 13 sections

Session 48 Task #29-follow-up-3b: wire Land Druid Land's Stride
  - Ignore nonmagical difficult terrain (cost 5 ft instead of 10 ft)
  - Water terrain NOT affected
  - executeMove wraps terrainFn to convert 'difficult' → 'normal'
  - 15 test assertions across 8 sections
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged).
- `SUBCLASS_FEATURES`: 5 subclasses across 4 classes — mechanically wired feature count:
  - Bard: College of Valor, College of Swords (Extra Attack wired)
  - Fighter: Champion (4/5 wired: Improved Critical, Superior Critical, Remarkable Athlete, Survivor; Additional Fighting Style deferred)
  - Druid: Circle of the Land (2/5 wired: Nature's Ward poison immunity, Land's Stride; Natural Recovery, Nature's Sanctuary deferred; fey/elemental charm/frighten immunity deferred)
  - Monk: Way of the Open Hand (2/5 wired: Wholeness of Body, Diamond Soul; Open Hand Technique, Tranquility, Quivering Palm deferred — need ki tracking)
  - Sorcerer: Draconic Bloodline (1/3 wired: Elemental Affinity; Dragon Wings, Draconic Presence deferred)
- `elementalAffinityBonus()` helper: wired in 4 bespoke spells (Fireball, Lightning Bolt, Cone of Cold, Burning Hands) + 3 generic 'cast' paths (save, auto-hit, spell attack).
- `combatantProfBonus()` helper: used by rollSave (Diamond Soul) + rollInitiative (Remarkable Athlete).
