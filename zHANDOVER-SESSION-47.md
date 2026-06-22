# zHANDOVER — Session 47

**Date:** 2026-06-23
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement 3 subclass feature-wiring tasks from Session 46's next-session priorities — Land Druid Nature's Ward poison immunity (Task #29-follow-up-3), Open Hand Monk Wholeness of Body self-heal (Task #29-follow-up-4), and Draconic Sorcerer Elemental Affinity spell damage bonus (Task #29-follow-up-5). All 3 tasks completed.

---

## Session Summary

Session 47 closed 3 subclass feature-wiring items from Session 46's priority list. Nature's Ward (Land Druid 10) now grants blanket immunity to the 'poisoned' condition — wired in both `addCondition()` and `applySpellEffect`'s `condition_apply` case. Wholeness of Body (Open Hand Monk 6) is now a fully functional self-heal action: the planner fires it when HP < 50% (before the self-preserve retreat check), the engine heals 3 × monk level HP, and the resource is consumed (once per combat). Elemental Affinity (Draconic Sorcerer 6) now adds the CHA modifier to spell damage when the damage type matches the sorcerer's draconic ancestry — wired in all 3 generic 'cast' damage paths (save spells, auto-hit spells, spell attacks) plus Fireball's bespoke execute function.

| Component | Status | Lines |
|-----------|--------|-------|
| **Task #29-follow-up-3: Land Druid Nature's Ward** | | |
| `src/engine/utils.ts` — addCondition() blocks 'poisoned' when target has Nature's Ward | ✅ Done | +12 lines |
| `src/engine/spell_effects.ts` — condition_apply case blocks 'poisoned' for NW targets | ✅ Done | +8 lines |
| `src/test/natures_ward.test.ts` (NEW) — 14 assertions, 13 sections | ✅ Done | ~310 lines |
| **Task #29-follow-up-4: Open Hand Monk Wholeness of Body** | | |
| `src/types/core.ts` — PlayerResources.wholenessOfBody + Combatant.classLevels + PlannedAction type | ✅ Done | +15 lines |
| `src/characters/builder.ts` — sets classLevels + wholenessOfBody resource | ✅ Done | +25 lines |
| `src/ai/planner.ts` — planner branch BEFORE self-preserve check | ✅ Done | +30 lines |
| `src/engine/combat.ts` — case 'wholenessOfBody' heals 3 × monk level | ✅ Done | +30 lines |
| `src/test/wholeness_of_body.test.ts` (NEW) — 22 assertions, 14 sections | ✅ Done | ~490 lines |
| **Task #29-follow-up-5: Draconic Sorcerer Elemental Affinity** | | |
| `src/types/core.ts` — Combatant.draconicAncestry field | ✅ Done | +7 lines |
| `src/engine/utils.ts` — elementalAffinityBonus() helper | ✅ Done | +30 lines |
| `src/engine/combat.ts` — wired in 3 generic 'cast' damage paths | ✅ Done | +20 lines |
| `src/spells/fireball.ts` — wired in bespoke execute function | ✅ Done | +8 lines |
| `src/test/elemental_affinity.test.ts` (NEW) — 16 assertions, 13 sections | ✅ Done | ~440 lines |

**Total:** ~1050 lines of new/modified code, 52 new test assertions across 3 new test files.

---

## Architecture

### Task #29-follow-up-3: Land Druid Nature's Ward (poison immunity)

**Problem:** Session 45 added Nature's Ward to the SUBCLASS_FEATURES table but didn't wire it mechanically. Land Druids could still be poisoned.

**Solution:**
1. `addCondition()` in `utils.ts`: if the target has 'Nature's Ward' in classFeatures and the condition is 'poisoned', return early (immune — do not apply). Covers all engine code that uses `addCondition` (grappled, prone, hidden, poisoned, etc.).
2. `applySpellEffect()` in `spell_effects.ts`: the `condition_apply` case now checks for Nature's Ward + 'poisoned' and skips the `conditions.add` if immune. Covers spell-sourced condition applications (Poison Spray, etc.).
3. **v1 simplifications documented:**
   - Fey/elemental charm/frighten immunity: NOT wired (requires source-creature-type tracking — `addCondition` doesn't know who applied the condition). Deferred to future session.
   - Disease immunity: no-op (diseases not tracked in v1 — same as Lesser Restoration).
   - Poison DAMAGE immunity: NOT wired (Nature's Ward grants condition immunity, not damage resistance — would need a separate check in `applyDamageWithTempHP`).

**End-to-end test result:** Land Druid 10 is immune to the poisoned condition via both `addCondition()` and `applySpellEffect`. Vanilla Druid 10 can still be poisoned. Other conditions (grappled, prone, frightened) are NOT blocked.

### Task #29-follow-up-4: Open Hand Monk Wholeness of Body

**Problem:** Session 45 added Wholeness of Body to SUBCLASS_FEATURES but didn't wire it. The feature was flag-only (no mechanical effect).

**Solution:**
1. **New `Combatant.classLevels` field** (`types/core.ts`): maps class name → level (e.g. `{ Monk: 6, Fighter: 2 }`). Populated by `buildCombatant` from the sheet's `classLevels` array. Used for monk-level-based heal amount (3 × monk level, not 3 × total level).
2. **New `PlayerResources.wholenessOfBody` field**: `{ max: 1, remaining: 1 }` — tracks once-per-long-rest usage. Set by `buildCombatant` when the combatant has the 'Wholeness of Body' classFeature.
3. **New PlannedAction type `'wholenessOfBody'`**: added to the type union.
4. **Planner branch** (`planner.ts`): placed BEFORE the self-preserve check (retreat/dodge). When HP < 50% + resource remaining > 0 + hasFeature → plan `wholenessOfBody` action targeting self. This ensures the monk uses the free self-heal before retreating.
5. **Engine case** (`combat.ts`): `case 'wholenessOfBody'` — heals 3 × monkLevel HP via `applyHeal`, consumes the resource (remaining 1 → 0). Uses `classLevels['Monk']` for the monk level (falls back to `combatant.level` for legacy combatants).

**End-to-end test result:** Open Hand Monk 6 at 10% HP uses Wholeness of Body (18 HP heal = 3 × 6). Resource consumed (1 → 0). Does NOT re-fire after consumption. Multiclass Monk 6 / Fighter 2 correctly uses monk level 6 (heals 18, not 24).

### Task #29-follow-up-5: Draconic Sorcerer Elemental Affinity

**Problem:** Session 45 added Elemental Affinity to SUBCLASS_FEATURES but didn't wire it. The feature was flag-only.

**Solution:**
1. **New `Combatant.draconicAncestry` field** (`types/core.ts`): optional string storing the damage type (e.g. 'fire', 'cold', 'lightning', 'acid', 'poison'). Set manually in tests or by the character builder (future: UI for choosing ancestry at creation).
2. **New `elementalAffinityBonus(caster, damageType)` helper** (`utils.ts`): returns CHA mod (≥ 0) when caster has 'Elemental Affinity' feature + `draconicAncestry` matches `damageType`. Returns 0 otherwise (non-Sorcerer, non-matching type, ancestry not set, CHA mod ≤ 0).
3. **Engine wiring — 3 generic 'cast' damage paths** (`combat.ts`):
   - Save-based spells: bonus added to damage roll before save halving
   - Auto-hit spells (Magic Missile): bonus added to damage roll
   - Spell attack hits: bonus added after base roll, before other riders (Agonizing Blast, Divine Smite, Sneak Attack). Logged as a separate 'action' event.
4. **Bespoke spell wiring — Fireball** (`fireball.ts`): bonus added to per-target damage roll. v1 rolls per target (each target gets its own `rollDamage()`), so the bonus is added per roll — consistent with v1's model.

**End-to-end test result:** Draconic Sorcerer 6 with fire ancestry deals +3 fire damage (CHA 17 → +3) on Fire Bolt spell attacks, Burning Hands save spells, and Fireball AoE. Cold spells get no bonus. Non-Sorcerers get no bonus.

---

## Files Changed

### New files (3)
- `src/test/natures_ward.test.ts` — 14 assertions across 13 sections
- `src/test/wholeness_of_body.test.ts` — 22 assertions across 14 sections
- `src/test/elemental_affinity.test.ts` — 16 assertions across 13 sections

### Modified files (7)
- `src/engine/utils.ts` — Nature's Ward guard in addCondition() + elementalAffinityBonus() helper
- `src/engine/spell_effects.ts` — Nature's Ward guard in condition_apply case
- `src/engine/combat.ts` — wholenessOfBody case + Elemental Affinity in 3 cast paths + import
- `src/ai/planner.ts` — Wholeness of Body planner branch (before self-preserve)
- `src/types/core.ts` — wholenessOfBody resource + classLevels + draconicAncestry + PlannedAction type
- `src/characters/builder.ts` — classLevels + wholenessOfBody resource population
- `src/spells/fireball.ts` — Elemental Affinity bonus in execute()

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `natures_ward.test.ts` (14 assertions) | ✅ All pass |
| `wholeness_of_body.test.ts` (22 assertions) | ✅ All pass |
| `elemental_affinity.test.ts` (16 assertions) | ✅ All pass |
| `subclass_features.test.ts` (37 assertions) | ✅ All pass |
| `engine.test.ts` (71 assertions) | ✅ All pass |
| `combat.test.ts` (42-53 assertions, probabilistic) | ✅ All pass |
| `scenario.test.ts` (94 assertions) | ✅ All pass |
| `ai.test.ts` (26 assertions) | ✅ All pass |
| `character_leveler.test.ts` (256 assertions) | ✅ All pass |
| `character_builder.test.ts` (93 assertions) | ✅ All pass |
| `fireball.test.ts` (34 assertions) | ✅ All pass |
| `burning_hands.test.ts` (33 assertions) | ✅ All pass |
| `action_surge*.test.ts` (105 assertions across 4 files) | ✅ All pass |
| `champion_remarkable_athlete_survivor.test.ts` (31 assertions) | ✅ All pass |

---

## CI Status

- **Task #29-follow-up-3 commit (23d53db):** pending verification after push
- **Task #29-follow-up-4 commit (192f094):** pending verification after push
- **Task #29-follow-up-5 commit (ab8f860):** pending verification after push
- **Pre-session baseline (cbaed5b):** success ✅ (Session 46 final commit)

---

## Next Session Priorities

Session 47 closed 3 subclass feature-wiring items. The following items remain:

22. **Devil's Sight invocation** (continuation of Task #16) — Still deferred. Requires LOS engine changes for magical darkness.

29-follow-up-3b. **Wire Land Druid remaining features** — Natural Recovery (short-rest slot recovery), Land's Stride (ignore nonmagical difficult terrain), Nature's Sanctuary (beasts/plants must WIS save or lose target). Nature's Ward poison immunity is now wired; the fey/elemental charm/frighten immunity needs source-creature-type tracking (deferred).

29-follow-up-4b. **Wire Open Hand Monk remaining features** — Open Hand Technique (Flurry of Blows rider effects: prone/push/no reaction), Diamond Soul (proficiency in all saves + ki reroll), Quivering Palm (touch-attack instakill). Wholeness of Body is now wired. Flurry of Blows needs ki tracking (ki field not yet in buildRawResources).

29-follow-up-5b. **Wire Draconic Sorcerer remaining features** — Dragon Wings (fly speed at 14), Draconic Presence (frighten aura at 18). Elemental Affinity is now wired. Dragon Wings needs speed/fly-speed modification. Draconic Presence needs an active-aura system.

29-follow-up-5c. **Wire Elemental Affinity in more bespoke spells** — Currently wired in the generic 'cast' case + Fireball. Future: wire in Lightning Bolt, Cone of Cold, Burning Hands, and other bespoke spell execute functions. Each has its own damage roll.

29-follow-up-6. **Wire Additional Fighting Style (Champion 10)** — character-build choice needing leveler/UI changes.

20-follow-up-2. **Model diseases for Lesser Restoration** — diseases not tracked in v1.

27-follow-up-3. **Additional surge options** — Surge for different spells when main was Attack.

---

## Commit Log (Session 47)

```
Session 47 Task #29-follow-up-3: wire Land Druid Nature's Ward poison immunity
  - addCondition() blocks 'poisoned' when target has Nature's Ward
  - applySpellEffect condition_apply case also blocks 'poisoned'
  - Fey/elemental charm/frighten + disease immunity deferred (v1 simplification)
  - 14 test assertions across 13 sections

Session 47 Task #29-follow-up-4: wire Open Hand Monk Wholeness of Body
  - Self-heal action: 3 × monk level HP, once per long rest
  - New Combatant.classLevels field for per-class level tracking
  - Planner fires before self-preserve (retreat/dodge) when HP < 50%
  - Engine heals + consumes resource
  - 22 test assertions across 14 sections

Session 47 Task #29-follow-up-5: wire Draconic Sorcerer Elemental Affinity
  - Adds CHA mod to spell damage matching draconic ancestry type
  - New Combatant.draconicAncestry field + elementalAffinityBonus() helper
  - Wired in 3 generic 'cast' damage paths + Fireball bespoke execute
  - 16 test assertions across 13 sections
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged).
- `SUBCLASS_FEATURES`: 5 subclasses across 4 classes (unchanged from Session 45/46):
  - Bard: College of Valor, College of Swords
  - Fighter: Champion (5 features — 4 mechanically wired: Improved Critical, Superior Critical, Remarkable Athlete, Survivor)
  - Druid: Circle of the Land (5 features — 1 mechanically wired: Nature's Ward poison immunity)
  - Monk: Way of the Open Hand (5 features — 1 mechanically wired: Wholeness of Body)
  - Sorcerer: Draconic Bloodline (3 features — 1 mechanically wired: Elemental Affinity)
- `planExtraAction()` helper: 6 surge options (unchanged from Session 46).
- `combatantProfBonus()` helper: level-based proficiency for PCs (Session 46).
- `elementalAffinityBonus()` helper: NEW — CHA mod bonus for matching draconic ancestry.
- `Combatant.classLevels`: NEW — per-class level map for PCs.
- `Combatant.draconicAncestry`: NEW — draconic ancestry damage type for Sorcerers.
- `PlayerResources.wholenessOfBody`: NEW — once-per-rest self-heal resource.
