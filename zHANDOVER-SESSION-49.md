# zHANDOVER — Session 49

**Date:** 2026-06-23
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement 3 subclass feature-wiring tasks from Session 48's next-session priorities — wire Elemental Affinity in 4 more bespoke spells (Task #29-follow-up-5c-2), wire Draconic Sorcerer Dragon Wings + Draconic Presence (Task #29-follow-up-5d), and wire Land Druid Natural Recovery + Nature's Sanctuary (Task #29-follow-up-3c). All 3 tasks completed.

---

## Session Summary

Session 49 closed 3 more subclass feature-wiring items from Session 48's priority list. Elemental Affinity (Draconic Sorcerer 6) was extended from Fireball/Lightning Bolt/Cone of Cold/Burning Hands to 4 more bespoke spells: Ice Knife (cold AoE only — piercing does NOT qualify), Chromatic Orb (variable damage type — EA matches the dynamically-picked type), Scorching Ray (fire — each ray gets EA independently), and Chain Lightning (lightning — auto-hit so no save halving). The Session 48 handover's "future" list mentioned Shatter and Catapult, but those deal thunder and bludgeoning damage respectively — neither is a draconic ancestry type, so EA never applies to them. This is documented in the new test file.

Dragon Wings (Draconic Sorcerer 14) now grants fly speed equal to walking speed — wired in `buildCombatant` by setting `combatant.flySpeed = combatant.speed` when the feature is present. The higher of racial fly speed vs wings speed wins. Draconic Presence (Draconic Sorcerer 18) now channels a frighten aura — wired as a new `'draconicPresence'` action type in `combat.ts` that forces each enemy within 60 ft to make a WIS save vs the sorcerer's spell save DC; on fail, the enemy is frightened via `applySpellEffect`. The planner fires it when 2+ enemies are within 60 ft and HP > 30%. v1 simplification: 1/combat (sorcery points are not yet transferred to the Combatant — deferred to a future session).

Natural Recovery (Land Druid 2) now recovers spell slots on a short rest — wired in `shortRest()` (`engine/utils.ts`) to auto-recover the lowest-level expended slots up to a budget of `ceil(druidLevel / 2)`, max 5th level. The resource (`naturalRecovery = { usesRemaining: 1 }`) is consumed on use and reset by `longRest()`. Nature's Sanctuary (Land Druid 14) now forces beasts and plants to WIS save before attacking the druid — wired in `resolveAttack()` (`engine/combat.ts`) before the attack roll; on fail, the attack is canceled (no damage, no resource consumed). Humanoids and other creature types are unaffected.

| Component | Status | Lines |
|-----------|--------|-------|
| **Task #29-follow-up-5c-2: Elemental Affinity in 4 more bespoke spells** | | |
| `src/spells/ice_knife.ts` — import + EA bonus on cold AoE (piercing NOT boosted) | ✅ Done | +5 lines |
| `src/spells/chromatic_orb.ts` — import + EA bonus matching dynamically-picked type | ✅ Done | +7 lines |
| `src/spells/scorching_ray.ts` — import + EA bonus per ray | ✅ Done | +6 lines |
| `src/spells/chain_lightning.ts` — import + EA bonus per target (auto-hit) | ✅ Done | +6 lines |
| `src/test/elemental_affinity_more_bespoke.test.ts` (NEW) — 15 assertions, 12 sections | ✅ Done | ~610 lines |
| **Task #29-follow-up-5d: Draconic Sorcerer Dragon Wings + Draconic Presence** | | |
| `src/types/core.ts` — `draconicPresence` resource + `'draconicPresence'` action type | ✅ Done | +9 lines |
| `src/characters/builder.ts` — Dragon Wings flySpeed + Draconic Presence resource | ✅ Done | +33 lines |
| `src/engine/combat.ts` — `draconicPresence` case (WIS save, frightened aura) | ✅ Done | +80 lines |
| `src/ai/planner.ts` — Draconic Presence planner hook (2+ enemies, HP > 30%) | ✅ Done | +37 lines |
| `src/test/draconic_wings_presence.test.ts` (NEW) — 22 assertions, 15 sections | ✅ Done | ~490 lines |
| **Task #29-follow-up-3c: Land Druid Natural Recovery + Nature's Sanctuary** | | |
| `src/types/core.ts` — `naturalRecovery` resource | ✅ Done | +6 lines |
| `src/characters/builder.ts` — Natural Recovery resource setup | ✅ Done | +11 lines |
| `src/engine/utils.ts` — Natural Recovery in shortRest() + reset in longRest() | ✅ Done | +30 lines |
| `src/engine/combat.ts` — Nature's Sanctuary WIS save in resolveAttack() | ✅ Done | +35 lines |
| `src/test/natural_recovery_natures_sanctuary.test.ts` (NEW) — 30 assertions, 15 sections | ✅ Done | ~550 lines |

**Total:** ~1900 lines of new/modified code, 67 new test assertions across 3 new test files.

---

## Architecture

### Task #29-follow-up-5c-2: Elemental Affinity in 4 more bespoke spells

**Problem:** Session 48 wired Elemental Affinity in Fireball, Lightning Bolt, Cone of Cold, Burning Hands + the generic 'cast' case. The handover's "future" list mentioned Shatter, Ice Knife, and Catapult, but only Ice Knife (cold portion) actually qualifies — Shatter deals thunder and Catapult deals bludgeoning, neither of which is a draconic ancestry type.

**Solution:**
1. Imported `elementalAffinityBonus` in `ice_knife.ts`, `chromatic_orb.ts`, `scorching_ray.ts`, `chain_lightning.ts`.
2. Added `const eaBonus = elementalAffinityBonus(caster, damageType)` before the damage roll in each execute function.
3. Added `eaBonus` to the damage roll before save halving (the bonus IS halved on save success — consistent with v1's model where the bonus is part of the total damage roll). Chain Lightning is auto-hit, so no halving.
4. **Ice Knife special case:** EA applies ONLY to the cold AoE (2d6 cold), NOT to the piercing attack (1d10 piercing). Piercing is not a draconic ancestry type.
5. **Chromatic Orb special case:** EA matches the dynamically-picked damage type via `pickDamageType(target)`. If the picker chooses 'thunder' (which isn't a draconic ancestry type), EA never fires. If it chooses 'fire' and the sorcerer has fire ancestry, EA fires.
6. **Scorching Ray special case:** EA applies to EACH ray independently (each ray is a separate damage roll). All 3 rays that hit get the +CHA mod bonus.
7. **Chain Lightning special case:** EA applies to EACH target (auto-hit, no save). All targets in the arc get the +CHA mod bonus.

**End-to-end test result:** Draconic Sorcerer 6 with cold ancestry deals +3 cold on Ice Knife's AoE (piercing unaffected). Acid ancestry gets +3 on Chromatic Orb (picker picks acid). Fire ancestry gets +3 per ray on Scorching Ray (3 rays). Lightning ancestry gets +3 per target on Chain Lightning. Non-matching ancestry gets no bonus. Non-Sorcerer gets no bonus. Thunder ancestry never matches any picked type.

### Task #29-follow-up-5d: Draconic Sorcerer Dragon Wings + Draconic Presence

**Problem:** Session 45 added Dragon Wings (14) and Draconic Presence (18) to SUBCLASS_FEATURES but didn't wire them. Both were flag-only.

**Solution — Dragon Wings:**
1. In `buildCombatant` (`characters/builder.ts`): when `combatant.classFeatures` includes 'Dragon Wings', set `combatant.flySpeed = combatant.speed`.
2. If the character already has a racial fly speed (e.g. Aarakocra), keep the higher of the two.
3. Permanent passive (PHB p.102: "You can create these wings at will"). No resource cost.

**Solution — Draconic Presence:**
1. Added `'draconicPresence'` to the `PlannedAction.type` union in `types/core.ts`.
2. Added `draconicPresence?: { max: number; remaining: number }` to `PlayerResources` in `types/core.ts`.
3. In `buildCombatant`: when the feature is present, set `resources.draconicPresence = { max: 1, remaining: 1 }`.
4. Added `case 'draconicPresence':` in `executePlannedAction` (`engine/combat.ts`):
   - Consumes one resource use (remaining 1 → 0).
   - Computes WIS save DC from the sorcerer's spell action saveDC, falling back to `8 + prof + CHA mod`.
   - Collects all living enemies within 60 ft (Chebyshev distance × 5).
   - For each enemy: rolls WIS save via `rollSaveReactable`. On fail, applies frightened via `applySpellEffect({ effectType: 'condition_apply', payload: { condition: 'frightened' } })`. On success, no effect.
   - Skips enemies already frightened.
5. Added planner hook in `planTurn` (`ai/planner.ts`): fires when `resources.draconicPresence.remaining > 0` AND `hasFeature(self, 'Draconic Presence')` AND HP > 30% AND 2+ enemies within 60 ft. Placed AFTER Wholeness of Body (self-heal more urgent) but BEFORE self-preserve.

**v1 simplification:** Canon Draconic Presence costs 5 sorcery points. Sorcery points are tracked on `CharacterResources` (sheet.resources.sorceryPoints) but NOT transferred to the Combatant (buildRawResources + buildResources skip them). Wiring sorcery-point transfer is a moderate refactor affecting many systems — deferred to a future session. For v1, Draconic Presence is 1/combat (like Wholeness of Body). The frightened-aura effect is canon.

**End-to-end test result:** Draconic Sorcerer 14 has flySpeed = 30 (= walking speed). Draconic Sorcerer 6 (too low) has flySpeed = null. Draconic Sorcerer 18 has the draconicPresence resource. Planner fires Draconic Presence when 2+ enemies within 60 ft and HP > 30%. Engine frightens enemies who fail WIS save; those who succeed are unaffected. Resource consumed after use. Already-frightened enemies are skipped. Enemies outside 60 ft are unaffected.

### Task #29-follow-up-3c: Land Druid Natural Recovery + Nature's Sanctuary

**Problem:** Session 45 added Natural Recovery (2) and Nature's Sanctuary (14) to SUBCLASS_FEATURES but didn't wire them. Both were flag-only. (Land's Stride + Nature's Ward were wired in Sessions 47/48.)

**Solution — Natural Recovery:**
1. Added `naturalRecovery?: { usesRemaining: number }` to `PlayerResources` in `types/core.ts`.
2. In `buildCombatant`: when the feature is present, set `resources.naturalRecovery = { usesRemaining: 1 }`.
3. In `shortRest()` (`engine/utils.ts`): when `naturalRecovery.usesRemaining > 0` AND `classFeatures` includes 'Natural Recovery' AND `spellSlots` exist:
   - Compute budget = `ceil(druidLevel / 2)` (PHB p.68: rounded up). Druid level from `classLevels['Druid']`, falling back to total level.
   - Iterate slots from 1st to 5th level (PHB p.68: max 5th level). For each slot, while `remaining < max` AND `budget >= lvl`: increment remaining, decrement budget by lvl.
   - This auto-recovers the lowest-level expended slots first, maximizing the number of slots regained.
   - Consume the use: `usesRemaining = 0`.
4. In `longRest()` (`engine/utils.ts`): reset `naturalRecovery.usesRemaining = 1`.

**Solution — Nature's Sanctuary:**
1. In `resolveAttack()` (`engine/combat.ts`): right after the LOS/cover check, before the attack roll:
   - If `target.classFeatures` includes "Nature's Sanctuary" AND `attacker.creatureType` is 'beast' or 'plant' AND attacker is alive:
     - Compute sanctuary DC from the target's spell action saveDC, falling back to `8 + prof + WIS mod` (druid casting, PHB p.66).
     - Roll the attacker's WIS save via `rollSaveReactable`.
     - On success: log "attack proceeds", continue to the attack roll.
     - On fail: log "loses attack", `return` early (attack canceled — no damage, no resource consumed).
2. This fires PER ATTACK — each time a beast/plant targets the Land Druid 14+ with an attack, the save is rolled. Canon (PHB p.68: "When a beast or plant creature attacks you, that creature must make a Wisdom saving throw").
3. Humanoid, undead, fiend, etc. attackers are NOT affected — only beasts and plants.
4. Non-Land-Druid-14 targets are NOT protected.

**End-to-end test result:** Land Druid 2 has Natural Recovery; vanilla Druid 2 does not. shortRest() recovers 3 × 1st-level slots for a Land Druid 6 with budget 3 (ceil(6/2)). shortRest() does NOT recover 6th-level slots (canon forbids). longRest() resets the use. Land Druid 14 has Nature's Sanctuary. Beast attacker with WIS 1 fails save → attack canceled (no damage). Beast attacker with WIS 30 succeeds save → attack proceeds. Plant attacker treated same as beast. Humanoid attacker unaffected. Vanilla Druid 14 (no subclass) not protected. Save DC = 16 (8 + prof 5 + WIS 3) for a level-14 druid with WIS 16.

---

## Files Changed

### New files (3)
- `src/test/elemental_affinity_more_bespoke.test.ts` — 15 assertions across 12 sections
- `src/test/draconic_wings_presence.test.ts` — 22 assertions across 15 sections
- `src/test/natural_recovery_natures_sanctuary.test.ts` — 30 assertions across 15 sections

### Modified files (7)
- `src/spells/ice_knife.ts` — Elemental Affinity bonus on cold AoE (piercing NOT boosted)
- `src/spells/chromatic_orb.ts` — Elemental Affinity bonus matching dynamically-picked type
- `src/spells/scorching_ray.ts` — Elemental Affinity bonus per ray
- `src/spells/chain_lightning.ts` — Elemental Affinity bonus per target (auto-hit)
- `src/types/core.ts` — `draconicPresence` + `naturalRecovery` resources; `'draconicPresence'` action type
- `src/characters/builder.ts` — Dragon Wings flySpeed + Draconic Presence + Natural Recovery resource setup
- `src/engine/combat.ts` — `draconicPresence` case + Nature's Sanctuary WIS save in resolveAttack()
- `src/engine/utils.ts` — Natural Recovery in shortRest() + reset in longRest()
- `src/ai/planner.ts` — Draconic Presence planner hook

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `elemental_affinity_more_bespoke.test.ts` (15 assertions) | ✅ All pass |
| `draconic_wings_presence.test.ts` (22 assertions) | ✅ All pass |
| `natural_recovery_natures_sanctuary.test.ts` (30 assertions) | ✅ All pass |
| `elemental_affinity.test.ts` (16 assertions) | ✅ All pass |
| `elemental_affinity_bespoke.test.ts` (12 assertions) | ✅ All pass |
| `subclass_features.test.ts` (37 assertions) | ✅ All pass |
| `combat.test.ts` (48 assertions) | ✅ All pass |
| `scenario.test.ts` (94 assertions) | ✅ All pass |
| `ai.test.ts` (26 assertions) | ✅ All pass |
| `day.test.ts` (54 assertions) | ✅ All pass |
| `phase4.test.ts` (54 assertions) | ✅ All pass |
| `wholeness_of_body.test.ts` (22 assertions) | ✅ All pass |
| `diamond_soul.test.ts` (15 assertions) | ✅ All pass (1 flaky run, 3/3 on re-run) |
| `lands_stride.test.ts` (15 assertions) | ✅ All pass |
| `natures_ward.test.ts` (14 assertions) | ✅ All pass |
| `character_leveler.test.ts` (256 assertions) | ✅ All pass |
| `pc.test.ts` (270 assertions) | ✅ All pass |
| `ice_knife.test.ts` (57 assertions) | ✅ All pass |
| `chromatic_orb.test.ts` (41 assertions) | ✅ All pass |
| `scorching_ray.test.ts` (109 assertions) | ✅ All pass |
| `chain_lightning.test.ts` (55 assertions) | ✅ All pass |
| `shatter.test.ts` (108 assertions) | ✅ All pass |
| `catapult.test.ts` (33 assertions) | ✅ All pass |
| `fireball.test.ts` (34 assertions) | ✅ All pass |
| `lightning_bolt.test.ts` (38 assertions) | ✅ All pass |
| `cone_of_cold.test.ts` (37 assertions) | ✅ All pass |
| `burning_hands.test.ts` (33 assertions) | ✅ All pass |

---

## CI Status

- **Task #29-follow-up-5c-2 commit (d122c5a):** pending verification after push
- **Task #29-follow-up-5d commit (e080bea):** pending verification after push
- **Task #29-follow-up-3c commit (37da343):** pending verification after push
- **Pre-session baseline (d30e9d7):** success ✅ (Session 48 de-flake commit)

---

## Next Session Priorities

Session 49 closed 3 more subclass feature-wiring items. The following items remain:

22. **Devil's Sight invocation** (continuation of Task #16) — Still deferred. Requires LOS engine changes for magical darkness.

29-follow-up-4c. **Wire Open Hand Monk remaining features** — Open Hand Technique (Flurry of Blows rider effects: prone/push/no reaction), Quivering Palm (touch-attack instakill). Diamond Soul + Wholeness of Body are now wired. Flurry of Blows + Quivering Palm need ki tracking (ki field not yet in buildRawResources).

29-follow-up-6. **Wire Additional Fighting Style (Champion 10)** — character-build choice needing leveler/UI changes.

20-follow-up-2. **Model diseases for Lesser Restoration** — diseases not tracked in v1.

27-follow-up-3. **Additional surge options** — Surge for different spells when main was Attack.

29-follow-up-5c-3. **Wire Elemental Affinity in remaining bespoke spells** — Session 49 wired 4 more (Ice Knife, Chromatic Orb, Scorching Ray, Chain Lightning). Remaining qualifying bespoke spells with their own execute functions: Cloudkill (poison), Melf's Acid Arrow (acid), Vitriolic Sphere (acid), Witch Bolt (lightning), Call Lightning (lightning), Frost Fingers (cold), Ice Storm (cold), Fire Storm (fire), Flame Strike (fire portion), Flaming Sphere (fire), Flame Blade (fire), Heat Metal (fire), Immolation (fire), Incendiary Cloud (fire), Lightning Arrow (lightning), Create Bonfire (fire), Elemental Bane (acid default), Elemental Weapon (fire), Searing Smite (fire), Spellfire Flare/Storm (fire), Ray of Sickness (poison). Future sessions can pick a few more from this list.

29-follow-up-5e. **Transfer sorcery points to Combatant** — Prerequisite for properly costing Draconic Presence (5 SP) and Flexible Casting. Currently sorcery points are tracked on `CharacterResources` but NOT transferred to the Combatant via `buildRawResources`/`buildResources`. Wiring this enables the canon 5-SP cost for Draconic Presence (replacing the v1 1/combat simplification) and unlocks Metamagic options.

29-follow-up-3d. **Wire Land Druid fey/elemental charm/frighten immunity** — PHB p.68 Nature's Ward: "you can't be charmed or frightened by elementals or fey". Currently only the poison immunity is wired (Session 47). The fey/elemental charm/frighten immunity requires source-creature-type tracking on conditions (which spell/feature applied the condition + what creature type was the source). Natural Recovery + Nature's Sanctuary are now wired.

---

## Commit Log (Session 49)

```
Session 49 Task #29-follow-up-5c-2: wire Elemental Affinity in 4 more bespoke spells
  - Ice Knife: +CHA mod on cold AoE only (piercing does NOT qualify)
  - Chromatic Orb: +CHA mod when picked type matches ancestry (acid/cold/fire/lightning/poison; thunder never matches)
  - Scorching Ray: +CHA mod per ray (each ray is a separate damage roll)
  - Chain Lightning: +CHA mod per target (auto-hit, no save halving)
  - Bonus added before save halving (halved on save success) where applicable
  - Note: Shatter (thunder) and Catapult (bludgeoning) from Session 48 handover
    do NOT qualify — neither is a draconic ancestry type
  - 15 test assertions across 12 sections

Session 49 Task #29-follow-up-5d: wire Draconic Sorcerer Dragon Wings + Draconic Presence
  - Dragon Wings (14): flySpeed = speed in buildCombatant (permanent passive)
  - Draconic Presence (18): new 'draconicPresence' action type in combat.ts
    - WIS save vs spell DC for each enemy within 60 ft
    - On fail: frightened via applySpellEffect
    - Planner fires when 2+ enemies in range AND HP > 30%
    - v1 simplification: 1/combat (sorcery points not yet on Combatant)
  - 22 test assertions across 15 sections

Session 49 Task #29-follow-up-3c: wire Land Druid Natural Recovery + Nature's Sanctuary
  - Natural Recovery (2): short-rest slot recovery in shortRest()
    - Budget = ceil(druid level / 2), max 5th level
    - Auto-recovers lowest-level expended slots first
    - Resource consumed on use, reset on long rest
  - Nature's Sanctuary (14): beast/plant attack save in resolveAttack()
    - Before attack roll: beast/plant attacker must WIS save vs druid spell DC
    - On fail: attack canceled (no damage, no resource consumed)
    - Humanoids and other creature types unaffected
  - 30 test assertions across 15 sections
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged).
- `SUBCLASS_FEATURES`: 5 subclasses across 4 classes — mechanically wired feature count:
  - Bard: College of Valor, College of Swords (Extra Attack wired)
  - Fighter: Champion (4/5 wired: Improved Critical, Superior Critical, Remarkable Athlete, Survivor; Additional Fighting Style deferred)
  - Druid: Circle of the Land (4/5 wired: Natural Recovery, Land's Stride, Nature's Ward poison immunity, Nature's Sanctuary; fey/elemental charm/frighten immunity deferred)
  - Monk: Way of the Open Hand (2/5 wired: Wholeness of Body, Diamond Soul; Open Hand Technique, Tranquility, Quivering Palm deferred — need ki tracking)
  - Sorcerer: Draconic Bloodline (3/3 wired: Elemental Affinity, Dragon Wings, Draconic Presence) ✅ COMPLETE
- `elementalAffinityBonus()` helper: wired in 8 bespoke spells (Fireball, Lightning Bolt, Cone of Cold, Burning Hands, Ice Knife, Chromatic Orb, Scorching Ray, Chain Lightning) + 3 generic 'cast' paths (save, auto-hit, spell attack).
- `combatantProfBonus()` helper: used by rollSave (Diamond Soul) + rollInitiative (Remarkable Athlete).
- `draconicPresence` action type: new in Session 49 — 1/combat frighten aura.
- `naturalRecovery` resource: new in Session 49 — short-rest slot recovery.
- `Nature's Sanctuary` hook: new in Session 49 — beast/plant attack save in resolveAttack.
