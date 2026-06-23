# zHANDOVER — Session 32

**Date:** 2026-06-21
**Agent:** Core Engine (Z.ai) — z/Cantrip workstream
**Focus:** Session 31 next-steps execution — 5 tasks completed, 1 task partially completed, 1 task deferred (blocker)

---

## Session Summary

This session worked through the Session 31 next-steps list, completing 5 of the 7 tasks. The remaining task (Reaction spell subsystem TG-008) was identified as a substantial blocker requiring new infrastructure — a reactive trigger hook in `resolveAttack` and the spell-casting path — that warrants a dedicated session.

| # | Task | Status | Commit |
|---|------|--------|--------|
| 5 | TG-013/014 housekeeping (rollDiceString move + BB/GFB label fix) | ✅ Done | (this session) |
| 4 | Damage immunities field | ✅ Done | (this session) |
| 1 | Forced movement — Thunderous Smite push 10ft rider | ✅ Done | (this session) |
| 1b | Forced movement — Repelling Blast (Eldritch Blast invocation) | ⏸ Deferred | Needs invocation system |
| 2 | True Invisibility — Greater Invisibility + ends-on-attack/cast hook | ✅ Done | (this session) |
| 6 | At-will innate spellcasting — Green Hag Vicious Mockery | ✅ Done | (this session) |
| 3 | Reaction spell subsystem TG-008 (Shield/Counterspell/Absorb Elements) | ⏸ Deferred (BLOCKER) | Needs reactive trigger infrastructure |

---

## Task #5: TG-013/014 Housekeeping ✅

**Files changed:**
- `src/engine/utils.ts` — Added canonical `rollDiceString(expr)` function (moved from `booming_blade.ts`)
- `src/spells/booming_blade.ts` — Replaced local implementation with `export { rollDiceString } from '../engine/utils'` re-export for backwards compatibility
- `src/engine/combat.ts` — Updated import: now pulls `rollDiceString as rollBoomingBladeDice` from `./utils` instead of `../spells/booming_blade`
- `src/spells/booming_blade.ts` comment fix: "melee spell attack" → "melee weapon attack" (TCE p.107 says weapon attack)
- `src/spells/green_flame_blade.ts` comment fix: same correction

**Rationale:** The engine shouldn't depend on a specific cantrip module for a generic dice-rolling helper. The re-export keeps any external callers (and the existing booming_blade.test.ts) working without changes.

---

## Task #4: Damage Immunities Field ✅

**Files changed:**
- `src/types/core.ts` — Added `immunities?: DamageType[]` field to `Combatant` (optional for backwards compat with existing factories)
- `src/engine/utils.ts` — Updated `applyDamageWithTempHP` to short-circuit on immunity (returns 0); added `addImmunity()` / `removeImmunity()` helpers
- `src/spells/conjure_elemental.ts` — Fire Elemental now sets `immunities: ['fire']`
- `src/spells/conjure_celestial.ts` — Couatl now sets `immunities: ['radiant', 'psychic']`
- `src/spells/conjure_minor_elementals.ts` — Mud Mephit now sets `immunities: ['acid', 'poison']`
- `src/test/damage_immunities.test.ts` (new, 56 assertions) — Tests helpers, integration, all 3 summons, immunity-overrides-resistance, temp HP not consumed, backwards compat

**Key design decisions:**
- `immunities` is OPTIONAL on the Combatant type (undefined = no immunities). This avoids breaking 295+ existing Combatant factories across the test suite that pre-date the field.
- Immunity check happens FIRST in `applyDamageWithTempHP`, before resistance, temp HP, or any other mitigation (PHB p.197: immunity overrides everything).
- The previous "documented in traits but not enforced" comments on Fire Elemental / Couatl / Mud Mephit have been removed — they now actively enforce the immunities.

---

## Task #1: Forced Movement — Thunderous Smite Push ✅

**Files changed:**
- `src/types/core.ts` — Added optional `pushFt?: number` field to `_nextHitRider`
- `src/engine/combat.ts` — Added pushAway() call in resolveAttack's damage branch when rider.pushFt is set; added pushAway to the movement imports
- `src/spells/thunderous_smite.ts` — Now sets `pushFt: 10` on the rider; updated metadata flag `thunderousSmiteRidersV1Simplified: false`; updated v1 simplification comments
- `src/test/thunderous_smite.test.ts` — Updated existing assertions for the new pushFt field and flipped flag
- `src/test/thunderous_smite_push.test.ts` (new, 24 assertions) — Tests push triggers on hit, push direction follows displacement vector, Searing Smite (no pushFt) doesn't push, push doesn't trigger on miss

**Key design decisions:**
- The `pushFt` field is OPTIONAL on `_nextHitRider` — only Thunderous Smite sets it. Other smites (Searing, Blinding, etc.) are unaffected.
- The "Large or smaller" size restriction from PHB p.282 is NOT enforced in v1 — any target on hit is pushed. This is documented as a v1 simplification.
- The push uses the existing `pushAway()` helper from `movement.ts` (same one Thunderwave uses).

**Repelling Blast (Eldritch Blast invocation) — Deferred:**
- Repelling Blast is an Eldritch Invocation (PHB p.110), not a spell. It would require a new "invocation" subsystem on the Warlock class to mark the invocation as active, then a hook in the Eldritch Blast cantrip to push on hit.
- The existing `pushAway()` infrastructure is ready, but the invocation system doesn't exist yet.
- Deferred to a future session that builds the Warlock invocations subsystem.

---

## Task #2: True Invisibility ✅

**Files changed:**
- `src/types/core.ts` — Added optional `breaksOnAttackOrCast?: boolean` field to `ActiveEffect`; added `'greaterInvisibility'` to the `PlannedAction.type` union
- `src/spells/invisibility.ts` — Now sets `breaksOnAttackOrCast: true` on the ActiveEffect; metadata flag `invisibilityEndsOnAttackV1Implemented: true`; updated v1 simplification comments
- `src/spells/greater_invisibility.ts` (new) — Full Greater Invisibility spell module (L4, self, concentration 1 min). Does NOT set `breaksOnAttackOrCast` — the caster stays invisible for the full duration per PHB p.254.
- `src/engine/combat.ts` — Added `breakInvisibilityOnAction(actor, state)` helper; calls it from resolveAttack (for melee/ranged/spell attacks) and from executePlannedAction (for any non-movement action). Added Greater Invisibility import + dispatch case.
- `src/ai/planner.ts` — Added Greater Invisibility import + planner branch (priority: above L2 Invisibility since L4 > L2 and Greater Invisibility is strictly better)
- `src/test/invisibility.test.ts` — Updated existing assertion for the flipped ends-on-attack flag
- `src/test/invisibility_break_on_attack.test.ts` (new, 36 assertions) — Tests Invisibility ends on attack, ends on spell cast, Greater Invisibility persists through attacks/spells, concentration break ends both, shouldCast gates

**Key design decisions:**
- The `breaksOnAttackOrCast` field is on `ActiveEffect`, NOT on `Combatant` — it's a property of the specific spell effect, not the creature. This allows future spells with similar mechanics (e.g. a hypothetical "Greater Invisibility that does end on attack" variant) to set the flag independently.
- The break check happens AFTER the attack/spell resolves — so an invisible attacker still gets invisible-advantage on their attack, but the invisibility ends immediately after.
- The spell-cast trigger uses a deny-list of non-spell action types (attack, dash, dodge, etc.) — anything not in the list triggers the break. This is more maintainable than enumerating every spell-cast type.
- Greater Invisibility is DISTINCT from Invisibility:
  - Invisibility (L2): touch range, ends on attack/cast, 1 hr concentration
  - Greater Invisibility (L4): self only, NO ends-on-attack, 1 min concentration
  - The test suite has an explicit section verifying the two spells coexist with different metadata.

---

## Task #6: At-will Innate Spellcasting for Summons ✅

**Files changed:**
- `src/spells/conjure_fey.ts` — Added Vicious Mockery (innate, DC 12 WIS, 60 ft, 1d4 psychic + disadv on next attack) as a second action on the Green Hag. The Hag's `actions` array now has both Claws (melee) and Vicious Mockery (ranged save).
- `src/test/conjure_fey.test.ts` — Updated assertions: Green Hag now has 2 actions, added Vicious Mockery stat checks

**Key design decisions:**
- The Green Hag is the first summon with at-will innate spellcasting (Session 32).
- The implementation is lightweight: just add the cantrip as an `Action` object to the summon's `actions` array. The existing AI planner (`selectAction` in `src/ai/actions.ts`) already considers spell/save actions and will choose Vicious Mockery when it's the best option (e.g. target out of melee reach, or when the disadv rider is tactically valuable).
- No new planner infrastructure was needed — the existing `bestRangedAction` logic in selectAction handles the choice between Claws (melee) and Vicious Mockery (ranged) based on reach and expected damage.
- The Hag's spell DC is 12 (per MM p.177 — Green Hag innate spellcasting uses Charisma, DC 12).
- Other summons with innate spellcasting (Couatl, future drake/djinni summons) can follow the same pattern: add the cantrip/spell as an Action object to the `actions` array.

---

## Task #3: Reaction Spell Subsystem (TG-008) — BLOCKER ⏸

**Status:** Deferred to a future session. Identified as a substantial blocker requiring new infrastructure.

**Current state:**
- `src/spells/shield.ts` EXISTS (78 lines) — implements the Shield spell with `shouldCast` + `execute` + `cleanup`
- `src/engine/combat.ts` imports `shouldCastShield` and `executeShield`, has a `case 'shield':` dispatch — BUT `shouldCastShield` is NEVER CALLED anywhere in the codebase. The dispatch path exists but no planner code ever emits a `type: 'shield'` PlannedAction.
- `src/spells/counterspell.ts` — does NOT exist
- `src/spells/absorb_elements.ts` — does NOT exist

**What's needed to complete TG-008:**
1. **Reactive trigger hook in resolveAttack**: When an attack hits a combatant, check if that combatant wants to react with Shield (heuristic: cast when incoming damage > threshold and slot available). The reaction must happen BEFORE damage is applied so the +5 AC can affect the triggering attack.
2. **Spell-cast trigger hook**: When a spell is cast, check if any enemy with Counterspell wants to react. This needs a new "spell-about-to-be-cast" event in the engine.
3. **Reaction planner**: A new planner function that decides whether to cast Shield/Counterspell/Absorb Elements based on the trigger context. This is different from the normal `planTurn` flow because reactions happen on OTHER creatures' turns, not the reactor's own turn.
4. **Three new spell modules**: Shield is mostly done (needs the reactive trigger wired). Counterspell and Absorb Elements need to be created from scratch.
5. **Reaction spell registry**: A way to register which spells are reactions and what triggers them (Shield → "hit by attack" / "targeted by Magic Missile"; Counterspell → "creature casts a spell within 60 ft"; Absorb Elements → "hit by acid/cold/fire/lightning/poison/thunder damage").

**Estimated scope:** ~500+ lines of new code (3 spell modules + reactive trigger hooks + reaction planner + registry) plus ~300+ lines of tests. This is a dedicated session's worth of work.

**Recommendation:** Treat TG-008 as a standalone session goal. The reactive trigger infrastructure is the key missing piece — once it exists, adding new reaction spells becomes straightforward (same pattern as regular spell modules).

---

## Files Changed (Summary)

### Source files (new)
- `src/spells/greater_invisibility.ts` — L4 illusion, self, concentration 1 min, no ends-on-attack
- `src/test/damage_immunities.test.ts` — 56 assertions
- `src/test/thunderous_smite_push.test.ts` — 24 assertions
- `src/test/invisibility_break_on_attack.test.ts` — 36 assertions

### Source files (modified)
- `src/types/core.ts` — Added `immunities?: DamageType[]` on Combatant, `breaksOnAttackOrCast?: boolean` on ActiveEffect, `pushFt?: number` on `_nextHitRider`, `'greaterInvisibility'` in PlannedAction.type union
- `src/engine/utils.ts` — Moved `rollDiceString` here (canonical location); added immunity check in `applyDamageWithTempHP`; added `addImmunity` / `removeImmunity` helpers
- `src/engine/combat.ts` — Updated imports (rollDiceString from utils, Greater Invisibility, pushAway); added `breakInvisibilityOnAction` helper + calls in resolveAttack and executePlannedAction; added Greater Invisibility dispatch case; added pushAway call in rider damage branch
- `src/ai/planner.ts` — Added Greater Invisibility import + planner branch
- `src/spells/booming_blade.ts` — Re-exported rollDiceString from utils (backwards compat); fixed "melee spell attack" → "melee weapon attack" comment
- `src/spells/green_flame_blade.ts` — Fixed "melee spell attack" → "melee weapon attack" comment
- `src/spells/invisibility.ts` — Now sets `breaksOnAttackOrCast: true`; metadata flag flipped to true; updated comments
- `src/spells/thunderous_smite.ts` — Now sets `pushFt: 10` on rider; metadata flag flipped to false; updated comments
- `src/spells/conjure_elemental.ts` — Fire Elemental now sets `immunities: ['fire']`
- `src/spells/conjure_celestial.ts` — Couatl now sets `immunities: ['radiant', 'psychic']`
- `src/spells/conjure_minor_elementals.ts` — Mud Mephit now sets `immunities: ['acid', 'poison']`
- `src/spells/conjure_fey.ts` — Green Hag now has Vicious Mockery (innate) as second action

### Test files (modified)
- `src/test/invisibility.test.ts` — Updated ends-on-attack flag assertion (false → true)
- `src/test/thunderous_smite.test.ts` — Updated riders-simplified flag assertion (true → false); added pushFt assertion; updated `_nextHitRider` factories
- `src/test/conjure_fey.test.ts` — Updated action count assertion (1 → 2); added Vicious Mockery stat checks

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| All summon-related tests (19 files) | ✅ All pass |
| Core tests (ai, cantrip_planner, combat, concentration_ai, engine, spell_effects) | ✅ All pass |
| New tests (damage_immunities, invisibility_break_on_attack, thunderous_smite_push) | ✅ All pass |
| Existing BB/GFB tests (booming_blade 218, green_flame_blade 209) | ✅ All pass (rollDiceString move verified) |
| Forced movement tests (32) + Thunderwave (25) | ✅ All pass |
| Source compilation | ✅ Clean |

**Test assertion totals (Session 32 new tests):**
- damage_immunities.test.ts: 56
- thunderous_smite_push.test.ts: 24
- invisibility_break_on_attack.test.ts: 36
- **Total new: 116 assertions**

---

## Updated Spell Inventory

The engine now has **22 summon spells** (21 from Sessions 29-31 + 0 new summons in Session 32, but the Green Hag gained innate spellcasting). Plus 1 new non-summon spell:

| Spell | Level | Type | Source | Session |
|-------|-------|------|--------|---------|
| (21 summon spells from Sessions 29-31) | L1-L7 | Various | PHB/TCE/XGE/FTD | 29-31 |
| **Greater Invisibility** | **L4** | **Conc 1min** | **PHB p.254** | **32** |

---

## Next Session Priorities

1. **TG-008 Reaction spell subsystem** (BLOCKER — needs dedicated session)
   - Build reactive trigger hook in resolveAttack (for Shield/Absorb Elements)
   - Build spell-cast trigger hook (for Counterspell)
   - Build reaction planner (separate from planTurn — reactions happen on other creatures' turns)
   - Wire the existing Shield spell to actually trigger reactively
   - Create Counterspell (L3 abjuration) — counter a spell cast within 60 ft, ability check at L4+ or auto-success at L3
   - Create Absorb Elements (L1 abjuration) — reaction to acid/cold/fire/lightning/poison/thunder damage, gain resistance to that type for the round + extra 1d6 on next melee attack

2. **Repelling Blast invocation** (deferred from Task #1)
   - Needs Warlock invocations subsystem — a way to mark invocations as active on a Warlock
   - Then add a pushAway() call in the Eldritch Blast cantrip effect when the invocation is active
   - The pushAway infrastructure already exists

3. **More innate spellcasting for summons** (continuation of Task #6)
   - Couatl: add innate spellcasting (bless, cure wounds, lesser restoration, protection from poison, etc.) as Action objects
   - Future summons with at-will cantrips should follow the same pattern

4. **Bestiary integration** (deferred from Session 31)
   - Wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the Conjure spell upcast paths

5. **Conjure Volley / Conjure Barrage re-categorization** (minor documentation cleanup from Session 31)

6. **Invisibility upcast** (Invisibility +1 target/slot level above 2nd — currently NOT modelled)

7. **Concentration enforcement** (TG-002 — Invisibility and Greater Invisibility both have `concentrationEnforcementV1Implemented: false`; concentration is started but not actively checked on damage)

---

## Commit Log (Session 32)

```
Session 32: 5 tasks done, 1 deferred (TG-008 blocker)

Task #5 (TG-013/014 housekeeping):
  - Move rollDiceString from booming_blade.ts to utils.ts (canonical location)
  - Fix "melee spell attack" → "melee weapon attack" comments in BB + GFB

Task #4 (Damage immunities field):
  - Add immunities?: DamageType[] to Combatant (optional for backwards compat)
  - Integrate with applyDamageWithTempHP (immunity overrides resistance)
  - Add addImmunity / removeImmunity helpers
  - Apply real immunities to Fire Elemental (fire), Couatl (radiant, psychic),
    Mud Mephit (acid, poison)

Task #1 (Forced movement — Thunderous Smite push):
  - Add pushFt?: number field to _nextHitRider
  - Wire pushAway() call in resolveAttack when rider.pushFt is set
  - Update Thunderous Smite to set pushFt: 10 (PHB p.282)
  - Repelling Blast DEFERRED (needs Warlock invocations subsystem)

Task #2 (True Invisibility):
  - Add breaksOnAttackOrCast?: boolean to ActiveEffect
  - Invisibility now sets breaksOnAttackOrCast: true (PHB p.254 ends-on-attack)
  - Wire breakInvisibilityOnAction helper in resolveAttack + executePlannedAction
  - Create Greater Invisibility spell module (L4, self, no ends-on-attack)
  - Wire Greater Invisibility into combat.ts dispatch + planner.ts branches

Task #6 (At-will innate spellcasting for summons):
  - Add Vicious Mockery (innate, DC 12, 60 ft, 1d4 psychic + disadv) to Green Hag
  - First summon with innate spellcasting — pattern reusable for Couatl etc.

Task #3 (Reaction spell subsystem TG-008) — DEFERRED (BLOCKER):
  - Shield exists but shouldCastShield is never called (no reactive trigger)
  - Counterspell and Absorb Elements don't exist
  - Needs reactive trigger infrastructure: ~500+ lines new code + tests
  - Recommended for a dedicated future session
```

---

## Generic Registry Count
- Unchanged from Sessions 29-31: 129 spells in `_generic_registry.ts` (Greater Invisibility was NOT in the generic registry — it was in class_spell_lists.ts only, with no module file until Session 32)
