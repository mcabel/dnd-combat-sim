# zHANDOVER — Session 37

**Date:** 2026-06-21
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Close v1 simplification #7 from Session 33 — Shield Magic Missile blocking (PHB p.275: "When you are hit by an attack or targeted by Magic Missile"). The "targeted by Magic Missile" half was not modelled in Session 33 because Magic Missile auto-hits (no attack roll), bypassing the `incoming_attack_hit` trigger point. Session 37 adds a dedicated `targeted_by_magic_missile` trigger kind and wires it into the `case 'magicMissile':` dispatch.

Also investigated #8 (Silvery Barbs save-success trigger) and documented why it's deferred (requires migrating 110 spell modules + circular-dependency fix).

---

## Session Summary

Session 36 closed the Protection from Energy v1 simplifications (upcast + innate-resistance fix). Session 37 continues closing v1 simplifications by implementing Shield's Magic Missile blocking — the last gap in Shield's PHB p.275 trigger coverage.

| Component | Status | Lines |
|-----------|--------|-------|
| `types/core.ts` — added `targeted_by_magic_missile` trigger kind to ReactionTrigger union | ✅ Done | +25 lines (trigger + doc comment) |
| `engine/combat.ts` — wired trigger in `case 'magicMissile':` dispatch + self-trigger guard + exported `executePlannedAction` | ✅ Done | ~35 lines (trigger fire + negated skip + export) |
| `spells/shield.ts` — `shouldCastReaction` + `executeReaction` now handle both trigger kinds; metadata flag | ✅ Done | ~60 lines (rewrite of both functions + comments) |
| `spells/_reaction_registry.ts` — added `targeted_by_magic_missile` to Shield's triggerKinds | ✅ Done | 1 line + comment |
| `test/shield_reaction.test.ts` — added section 8 (10 sub-tests, 27 new assertions) | ✅ Done | +180 lines |
| Metadata flag: `shieldMagicMissileBlockingV1Implemented: true` (new) | ✅ Done | 1 line |

**Total:** ~300 lines of new/modified code, 27 new test assertions (66 total in shield_reaction.test.ts, up from 39).

---

## Architecture

### New trigger kind: `targeted_by_magic_missile`

Session 33's `incoming_attack_hit` trigger fires inside `resolveAttack` AFTER the hit decision (`let hits = ...`). Magic Missile (PHB p.257) has no attack roll — it auto-hits via `action.hitBonus === null` and, in the bespoke dispatch, via `executeMagicMissile` which calls `applyDamage` directly per dart. This means Magic Missile completely bypasses the `incoming_attack_hit` trigger point.

**Design decision:** Add a dedicated `targeted_by_magic_missile` trigger kind (rather than reworking the auto-hit branch or making Magic Missile go through `resolveAttack`). This is:
- **PHB-faithful:** Shield's PHB p.275 text literally says "targeted by Magic Missile" — the trigger name matches the rules text.
- **Minimal blast radius:** Only 1 dispatch site changes (`case 'magicMissile':`). The 110 spell modules that call `rollSave` are untouched. The auto-hit branch in `resolveAttack` (for Reaping Scythe etc.) is untouched.
- **Extensible:** If future auto-hit targeting spells are added, they can fire this trigger (or add their own specific trigger).

### Trigger firing point

In `executePlannedAction`'s `case 'magicMissile':` dispatch (combat.ts):
```typescript
const mmOutcome = triggerReactions(state, mmTarget, {
  kind: 'targeted_by_magic_missile',
  caster: actor,
  target: mmTarget,
  dartCount: 3,
});
if (mmOutcome && mmOutcome.kind === 'negated') {
  consumeSpellSlot(actor, 1);       // MM slot consumed (spell was cast)
  actor.budget.actionUsed = true;
  log(state, 'action', actor.id,
    `${actor.name}'s Magic Missile was BLOCKED by ${mmTarget.name}'s Shield! ...`);
  break;                             // skip executeMagicMissile
}
executeMagicMissile(actor, mmTarget, state);
```

The trigger fires BEFORE `executeMagicMissile`. If Shield negates, the dispatch:
1. Consumes the MM caster's L1 slot (the spell was cast — PHB p.228 resource rule)
2. Marks the caster's action as used
3. Logs the block
4. Skips `executeMagicMissile` entirely (no damage loop)

### Shield's dual-trigger shouldCastReaction

Shield now accepts two trigger kinds with different tactical gating:

| Trigger | shouldCastReaction gate | Rationale |
|---------|------------------------|-----------|
| `incoming_attack_hit` | Only cast if `attackTotal < effectiveAC + 5` (the +5 AC flips the hit to a miss) | Avoids wasting a slot when Shield wouldn't help. A human might cast for the round-long +5, but the AI is stricter. |
| `targeted_by_magic_missile` | **Always cast** (subject to: slot available, reaction unused, not already active, not self-targeted) | Shield blocks ALL MM damage unconditionally (PHB p.275: "acts as a shield against Magic Missile"). Blocking ~10.5 avg force damage + gaining round-long +5 AC is always worth a L1 slot. |

Common guards (both triggers): don't cast if already under Shield (no benefit to recasting), don't cast against self.

### Shield's dual-trigger executeReaction

Both trigger paths apply the same `ac_bonus` ActiveEffect (+5 AC, `sourceIsConcentration: false`), consume the L1 slot, mark `reactionUsed = true`, and return `{ kind: 'negated' }`. The difference is the log message and the engine's negation handling:

| Trigger | Engine's negation handling |
|---------|---------------------------|
| `incoming_attack_hit` | Engine re-evaluates `hits` with the new +5 AC; if the attack now misses, skips damage. |
| `targeted_by_magic_missile` | Engine skips `executeMagicMissile` entirely (no damage loop). MM slot is consumed by the dispatch site (not by `executeReaction`). |

### Engine export: `executePlannedAction`

`executePlannedAction` was a private function in combat.ts (called only by `runCombat`'s main loop). Session 37 exports it so tests can drive a SPECIFIC dispatch path (e.g. `case 'magicMissile':` with a Shield reaction) without setting up a full multi-round `runCombat` scenario. The function is otherwise unchanged.

This enables the 8h/8i/8j end-to-end tests in shield_reaction.test.ts, which verify the full dispatch → trigger → negation → skip pipeline.

### v1 simplification (documented)

MM currently targets a single creature (all darts at one target per the AI heuristic in `magic_missile.ts`). Shield blocks the entire volley. If MM ever supports multi-target darts (per-dart targeting), Shield would only block darts aimed at the Shield-caster — this would require per-dart trigger firing inside `executeMagicMissile`'s dart loop (future enhancement).

---

## Files Changed

### Modified files (5)
- `src/types/core.ts` — Added `targeted_by_magic_missile` variant to the `ReactionTrigger` discriminated union. Carries `caster`, `target`, `dartCount`. Documented with the PHB p.275 reference + the v1 single-target simplification.

- `src/engine/combat.ts` — Three changes:
  1. Added self-trigger guard in `triggerReactions`: `if (trigger.kind === 'targeted_by_magic_missile' && trigger.caster.id === reactor.id) return null;` (don't Shield against your own MM).
  2. Wired the trigger in `case 'magicMissile':` dispatch — fires `triggerReactions` for `mmTarget` before calling `executeMagicMissile`; if negated, consumes the MM slot + skips damage.
  3. Exported `executePlannedAction` (was private) for dispatch-level testing.

- `src/spells/shield.ts` — Refactored `shouldCastReaction` + `executeReaction` to handle both trigger kinds (was attack-hit only). Added `shieldMagicMissileBlockingV1Implemented: true` metadata flag. Updated header comments to document the Session 37 change. Legacy `shouldCast`/`execute`/`cleanup` unchanged.

- `src/spells/_reaction_registry.ts` — Shield's `triggerKinds`: `['incoming_attack_hit']` → `['incoming_attack_hit', 'targeted_by_magic_missile']`.

- `src/test/shield_reaction.test.ts` — Added section 8 "Magic Missile blocking (Session 37)" with 10 sub-tests (8a-8j), 27 new assertions. Updated header comment + added metadata flag assertion in section 1.

---

## Test Coverage (27 new assertions in section 8)

| Test | Description |
|------|-------------|
| 8a | `shouldCastReaction` true for `targeted_by_magic_missile` (always cast — blocks all MM) |
| 8b | `shouldCastReaction` false if caster targets self with MM (don't Shield own MM) |
| 8c | `shouldCastReaction` false if Shield already active (no benefit to recasting) |
| 8d | `shouldCastReaction` false for other trigger kinds (falling — Shield only responds to attack-hit + MM) |
| 8e | `executeReaction` mechanics: slot consumed, reaction used, +5 AC applied, returns `negated`, log mentions Shield + MM + dart count |
| 8f | Shield effect shape: `ac_bonus` type, `acBonus=5`, `sourceIsConcentration=false`, `casterId=self` |
| 8g | `cleanup` removes the Shield effect (same as attack-hit path) |
| 8h | **End-to-end dispatch**: MM blocked by Shield — no damage to target, MM slot consumed, Shield slot consumed, reaction used, +5 AC active, block logged |
| 8i | **Control**: MM without Shield — damage applies normally (6..18 force), no Shield effect |
| 8j | **Reaction-budget gating**: MM after reaction already used — Shield can't fire, damage applies |

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `shield_reaction.test.ts` (66 assertions: 39 original + 27 new) | ✅ All pass (3 stable runs) |
| Baseline tests (magic_missile 25, reaction_registry 74, silvery_barbs 22, absorb_elements 61, hellish_rebuke 26, counterspell 35, feather_fall 28, combat 50, engine 71, scenario 94, ai 26, mechanics 57, bulk_spell_dispatch 214, concentration_enforcement 34, protection_from_energy 117, invisibility 81, invisibility_break_on_attack 36, dispel_magic 47, shillelagh 60, bless 37, hex 27, fireball 34, burning_hands 33, shield_simple 12) | ✅ All pass — no regressions |

---

## Architecture Note: Silvery Barbs Save-Success Trigger (#8 — Deferred)

Session 36's handover listed "#8 Silvery Barbs save-success trigger" as a candidate. Session 37 investigated and found it requires a fundamentally larger refactor than #7:

**The problem:** `rollSave` is a pure function in `utils.ts` (takes a combatant + DC, returns `{roll, total, success}`). It's called by **110 spell modules** (charm_person, grease, fireball, lightning_bolt, hold_person, etc.) for their save resolution. Silvery Barbs' save-success trigger needs to fire AFTER a successful save, but:

1. **`rollSave` can't fire reactions** — it's in `utils.ts`, which cannot import `triggerReactions` from `combat.ts` (circular dependency: `combat.ts` already imports from `utils.ts`).
2. **Migrating 110 spell modules** to a reaction-aware `rollSaveReactable(state, caster, saver, ability, dc)` wrapper in `combat.ts` is the clean path, but is a multi-session effort with regression risk across the entire spell catalog.
3. **The 6 `rollSave` call sites in `combat.ts`** (save-based attacks, terrain zones, save-fail trackers, Eyebite) cover only engine-level saves — the bulk of spell saves happen inside the 110 spell modules' `execute` functions.

**Proposed approach for a future session:**
1. Create `rollSaveReactable(state, caster, saver, ability, dc, isProficient?)` in `combat.ts` that wraps `rollSave` + fires `incoming_save_success` trigger (reactor = spell caster) if the save succeeds. If Silvery Barbs negates (reroll flips to fail), update the save result to fail.
2. Add `incoming_save_success` to the `ReactionTrigger` union (carries `saver`, `caster`, `ability`, `dc`, `roll`, `total`).
3. Migrate the 110 spell modules from `rollSave(target, ...)` to `rollSaveReactable(state, caster, target, ...)`. This is mechanical but touches every save-based spell.
4. Update Silvery Barbs' `shouldCastReaction` + `executeReaction` to handle `incoming_save_success` (reroll the d20, use lower, re-evaluate success).
5. The ability-check-success trigger (for grapple/shove contests) is a separate, smaller effort (`rollAbilityCheck` has fewer call sites).

**Recommendation:** Dedicate a full session to #8 alone, with the 110-module migration as the primary deliverable. Do NOT attempt it alongside other engine changes.

---

## Next Session Priorities

(Updated from Session 36 — item 7 now closed by Session 37. Item 8 investigated + deferred with a concrete migration plan.)

1. **Repelling Blast invocation** (deferred from Session 32) — needs Warlock invocations subsystem. The `pushAway()` infrastructure already exists.

2. **More innate spellcasting for summons** (continuation of Session 32 Task #6) — Couatl: add innate spellcasting (bless, cure wounds, lesser restoration, protection from poison, etc.) as Action objects. Requires summon AI integration with existing spell modules + 3/day resource tracking.

3. **Bestiary integration** (deferred from Session 31) — Wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the Conjure spell upcast paths.

4. **~~Conjure Volley / Conjure Barrage re-categorization~~** ✅ DONE (Session 36).

5. **~~Invisibility upcast~~** ✅ DONE (Session 35).

6. **~~Concentration enforcement~~** ✅ DONE (Session 34) — TG-002 closed.

7. **~~Shield Magic Missile blocking~~** ✅ DONE (Session 37) — `targeted_by_magic_missile` trigger kind; Shield blocks all MM darts; MM slot still consumed.

8. **Silvery Barbs save-success trigger** (v1 simplification from Session 33) — **Investigated Session 37, DEFERRED with migration plan.** Requires creating `rollSaveReactable` wrapper in combat.ts + migrating 110 spell modules that call `rollSave`. The circular dependency (utils.ts ↔ combat.ts) prevents firing reactions inside `rollSave` itself. See "Architecture Note" above for the full plan. Recommend a dedicated session.

9. **~~Protection from Energy~~** ✅ DONE (Session 34) — TG-008 fully closed.

10. **~~Protection from Energy upcast~~** ✅ DONE (Session 36).

11. **~~Protection from Energy innate-resistance edge case~~** ✅ DONE (Session 36).

12. **Greater Invisibility upcast** — Greater Invisibility (L4) has NO upcast entry in PHB (it's self-only, single-target). No action needed; documented for completeness.

---

## Commit Log (Session 37)

```
Session 37: Shield Magic Missile blocking (PHB p.275 "targeted by Magic Missile")

Closes the v1 simplification from Session 33: Shield now blocks Magic
Missile damage in addition to its attack-hit reaction.

New trigger kind: `targeted_by_magic_missile`
  - Added to ReactionTrigger union in core.ts
  - Carries: caster (MM caster), target (MM target), dartCount (informational)
  - Fires in `case 'magicMissile':` dispatch in combat.ts, BEFORE
    executeMagicMissile. If Shield negates, the dispatch skips the damage
    loop entirely. The MM slot is still consumed (the spell was cast —
    PHB p.228 resource rule), but no damage is dealt to the Shield-caster.
  - Self-trigger guard added to triggerReactions: don't Shield against
    your own MM.

Shield module updates (shield.ts):
  - shouldCastReaction now accepts BOTH trigger kinds:
    * incoming_attack_hit: tactical gate (only if +5 AC flips hit to miss)
    * targeted_by_magic_missile: ALWAYS cast (blocks ALL MM damage
      unconditionally per PHB p.275 "acts as a shield against Magic
      Missile"). Blocking ~10.5 avg force damage + gaining round-long
      +5 AC is always worth a L1 slot.
  - executeReaction handles both triggers:
    * incoming_attack_hit: applies +5 AC, returns negated (engine re-evals hit)
    * targeted_by_magic_missile: applies +5 AC, returns negated (engine
      skips MM damage loop)
  - New metadata flag: shieldMagicMissileBlockingV1Implemented: true
  - Header comments updated to document the Session 37 change

Reaction registry (_reaction_registry.ts):
  - Shield's triggerKinds: ['incoming_attack_hit'] →
    ['incoming_attack_hit', 'targeted_by_magic_missile']

Engine export (combat.ts):
  - executePlannedAction is now exported (was private). Enables
    dispatch-level testing of specific case branches (e.g. case
    'magicMissile': with a Shield reaction) without setting up a full
    multi-round runCombat scenario. The function is otherwise unchanged.

Tests (shield_reaction.test.ts):
  - 27 new assertions in section 8 (10 sub-tests, 8a-8j):
    * 8a-8d: shouldCastReaction gating (true for MM, false for self,
      false if already active, false for other trigger kinds)
    * 8e: executeReaction mechanics (slot, reaction, +5 AC, negated, log)
    * 8f: Shield effect shape (ac_bonus, acBonus=5, sourceIsConcentration=false)
    * 8g: cleanup removes the effect
    * 8h: end-to-end dispatch — MM blocked by Shield (no damage, both
      slots consumed, reaction used, +5 AC active, block logged)
    * 8i: control — MM without Shield (damage applies normally)
    * 8j: reaction-budget gating — MM after reaction already used
      (Shield can't fire, damage applies)
  - Total: 66 assertions (was 39)

v1 simplification (documented): MM currently targets a single creature
(all darts at one target per the AI heuristic). Shield blocks the entire
volley. Multi-target MM + per-dart Shield blocking is a future enhancement.

Architecture note on Silvery Barbs save-success trigger (deferred):
  Investigated this session. Requires migrating 110 spell modules that
  call rollSave (in utils.ts) to a reaction-aware wrapper. rollSave is a
  pure function in utils.ts and cannot call triggerReactions (in combat.ts)
  due to circular dependency. A rollSaveReactable(state, caster, target,
  ...) wrapper in combat.ts + migration of the 110 spell modules is the
  clean path, but is a multi-session effort. Deferred to a future
  dedicated session. See handover §"Architecture Note" for the full plan.

All baseline tests pass (no regressions): shield_reaction (66, was 39),
magic_missile (25), reaction_registry (74), silvery_barbs (22),
absorb_elements (61), hellish_rebuke (26), counterspell (35),
feather_fall (28), combat (50), engine (71), scenario (94), ai (26),
mechanics (57), bulk_spell_dispatch (214), concentration_enforcement (34),
protection_from_energy (117), invisibility (81), invisibility_break_on_attack
(36), dispel_magic (47), shillelagh (60), bless (37), hex (27), fireball
(34), burning_hands (33), shield_simple (12).

tsc --noEmit: 0 errors.
```

---

## Generic Registry Count

- Unchanged from Session 36: 130 spells in `_generic_registry.ts`.
- The `_reaction_registry.ts` has 6 reaction spells (unchanged from Session 33 — Shield was already registered; Session 37 only added a trigger kind to its existing entry).
- No new spell modules added this session.

---

## CI Status

- **Before this session:** Latest commit (b8ef169, Session 36 handover CI update) was green (Test Suite `success`).
- **Session 37 commit (9247345):** To be verified post-commit. The work is additive (new trigger kind + new trigger path in 1 dispatch site + Shield module dual-trigger). All 66 shield_reaction assertions pass locally (3 stable runs), and 24 baseline test files pass (no regressions). The only engine dispatch path modified is `case 'magicMissile':` (now fires the Shield trigger before executeMagicMissile); `executePlannedAction` is exported but otherwise unchanged.
