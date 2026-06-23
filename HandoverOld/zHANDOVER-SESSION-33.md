# zHANDOVER — Session 33

**Date:** 2026-06-21
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** TG-008 Reaction spell subsystem — the BLOCKER deferred from Session 32. Full implementation: trigger infrastructure + 6 reaction spells + 285 test assertions.

---

## Session Summary

Session 32 deferred TG-008 (Reaction spell subsystem) as a blocker requiring ~500+ lines of new infrastructure. Session 33 completed it in full:

| Component | Status | Lines |
|-----------|--------|-------|
| `ReactionTrigger` type + `ReactionOutcome` | ✅ Done | ~75 lines in core.ts |
| `ReactionSpellDescriptor` + `REACTION_SPELLS` registry | ✅ Done | ~130 lines (_reaction_registry.ts) |
| `triggerReactions()` helper + 4 trigger points | ✅ Done | ~150 lines in combat.ts |
| `getSpellInfoFromPlan()` helper (Counterspell) | ✅ Done | ~50 lines in combat.ts |
| Absorb Elements rider consumption | ✅ Done | ~15 lines in combat.ts |
| Cleanup wiring in `resetBudget` | ✅ Done | ~8 lines in utils.ts |
| Shield rework (trigger-aware) | ✅ Done | ~170 lines (shield.ts) |
| Absorb Elements (new) | ✅ Done | ~175 lines (absorb_elements.ts) |
| Hellish Rebuke (new) | ✅ Done | ~140 lines (hellish_rebuke.ts) |
| Counterspell (new) | ✅ Done | ~225 lines (counterspell.ts) |
| Feather Fall (new) | ✅ Done | ~135 lines (feather_fall.ts) |
| Silvery Barbs (new) | ✅ Done | ~175 lines (silvery_barbs.ts) |
| Tests (7 files) | ✅ Done | ~1800 lines, 285 assertions |

**Total:** ~3250 lines of new/modified code (well above the ~800 estimated in Session 32).

---

## Architecture

### Trigger-based design (not preplanned)

Session 32's handover mentioned that `TurnPlan.reaction` was "prepared, fires reactively" but never set. Session 33 pivoted to a **trigger-based** design instead:

- `TurnPlan.reaction` remains `null` (unused — the planner doesn't predict reactions)
- Reactions fire DURING OTHER creatures' turns, at trigger points in the engine
- The `triggerReactions(state, reactor, trigger)` helper iterates the `REACTION_SPELLS` registry and fires the first matching spell

This matches PHB p.190 reaction timing rules and is cleaner than preplanning.

### ReactionTrigger discriminated union

```typescript
export type ReactionTrigger =
  | { kind: 'incoming_attack_hit'; attacker; action; attackRoll; attackTotal; effectiveAC; isCrit }
  | { kind: 'incoming_damage'; attacker; target; amount; damageType; action? }
  | { kind: 'incoming_spell'; caster; spellName; level }
  | { kind: 'falling'; fallerIds; fallHeightFt };
```

### ReactionOutcome

```typescript
export type ReactionOutcome =
  | { kind: 'no_effect' }     // reaction fired, triggering action still resolves (Absorb Elements, Hellish Rebuke)
  | { kind: 'negated'; detail? }  // reaction negated the trigger (Shield, Counterspell, Silvery Barbs, Feather Fall)
  | { kind: 'failed'; detail? };  // reaction fired but failed (Counterspell ability check failed, Silvery Barbs reroll didn't flip)
```

### triggerReactions() helper

Pre-conditions checked centrally:
- Reactor's reaction budget is unused
- Reactor is alive, conscious, not incapacitated
- Trigger is not self-caused
- Reactor has the spell in their actions
- Reactor has a spell slot of the required level

Then the spell module's `shouldCast` is called for tactical gating (e.g., Shield only fires if +5 AC will flip the hit to a miss).

### 4 trigger points

1. **incoming_attack_hit** — in `resolveAttack`, AFTER the hit decision (`let hits = ...`), BEFORE the miss-return. Shield/Silvery Barbs can flip the hit to a miss.
2. **incoming_damage** — in `resolveAttack`, AFTER `applyDamageWithTempHP`, at 3 sites (save-attack, auto-hit, standard attack). Absorb Elements/Hellish Rebuke fire here.
3. **incoming_spell** — at the start of `executePlannedAction`, BEFORE the switch dispatch. Counterspell can negate the spell cast entirely.
4. **falling** — in `processFallDamage`, BEFORE the damage loop. Feather Fall marks fallers to skip damage.

---

## The 6 Reaction Spells

### 1. Shield (PHB p.275) — reworked
- **Trigger:** `incoming_attack_hit`
- **shouldCast:** Only fires if +5 AC WILL flip the hit to a miss (`attackTotal < effectiveAC + 5`). Tactical optimum — never wastes a slot.
- **execute:** Applies `ac_bonus` ActiveEffect (+5 AC), returns `{ kind: 'negated' }`.
- **cleanup:** Removes the effect at start of caster's next turn (unchanged from pre-TG-008).
- **Legacy `shouldCast`/`execute`:** Retained for backwards compat (the unreachable `case 'shield':` dispatch and external callers).
- **v1 simplification:** Magic Missile blocking NOT modelled (auto-hit branch bypasses the hit decision where Shield fires).

### 2. Absorb Elements (XGE p.150) — new
- **Trigger:** `incoming_damage` with type in [acid, cold, fire, lightning, poison, thunder]
- **shouldCast:** Fires on any triggering damage type with amount > 0. Doesn't recast if already resistant to that type.
- **execute:** Grants resistance to the triggering type (added to `resistances`, tracked via `_absorbElementsResistance`). Stores a 1d6 rider of the triggering type via `_absorbElementsRider` (consumed on next melee hit). Returns `{ kind: 'no_effect' }` (damage already applied).
- **cleanup:** Removes the resistance at start of caster's next turn. Rider persists until consumed by a melee hit.
- **Rider consumption:** Wired in `resolveAttack`'s standard attack damage branch — when `attacker._absorbElementsRider` is set and `action.attackType === 'melee'`, calls `consumeRider(attacker)` and adds the extra damage.

### 3. Hellish Rebuke (PHB p.249) — new
- **Trigger:** `incoming_damage` from a creature within 60 ft
- **shouldCast:** Fires on any damage (any type) from an attacker within 60 ft, amount > 0, attacker alive.
- **execute:** 2d10 fire damage to attacker (DEX save half). DC = 8 + CHA mod + 2 (prof bonus assumption). Upcast: +1d10 per slot level above 1st. Returns `{ kind: 'no_effect' }` (reaction deals damage but doesn't negate the triggering action).
- **cleanup:** No-op (instantaneous).

### 4. Silvery Barbs (SCC p.38) — new
- **Trigger:** `incoming_attack_hit` from an enemy within 60 ft
- **shouldCast:** Fires on any enemy attack hit within 60 ft. v1 doesn't gate on reroll value (always casts if eligible).
- **execute:** Rolls a new d20, uses the lower of (original, new), re-evaluates the hit. Returns `{ kind: 'negated' }` if the lower roll misses, `{ kind: 'failed' }` if it still hits. Nat 1 auto-misses, nat 20 auto-hits (per `attackHits`).
- **v1 simplifications:** Only handles attack hits (not save successes or ability check successes). The "advantage on next attack" rider is NOT modelled. Upcast (+1 creature per slot level) NOT modelled.

### 5. Counterspell (PHB p.228) — new
- **Trigger:** `incoming_spell` (leveled spells only — cantrips excluded)
- **shouldCast:** 
  - Auto-success if reactor has a slot of level >= spell's level (always cast)
  - L4-5 spells without auto-success slot: cast if check bonus >= 3
  - L6+ spells without auto-success slot: don't cast (too risky for v1)
  - Range: 60 ft
- **execute:** 
  - Auto-success if `slotLevel >= trigger.level` → returns `{ kind: 'negated' }`
  - Otherwise: ability check (best of INT/WIS/CHA + 2 prof) vs DC 10 + spell level → returns `{ kind: 'negated' }` on success, `{ kind: 'failed' }` on failure
- **Engine integration:** At the start of `executePlannedAction`, `getSpellInfoFromPlan` extracts the spell name + level. If the spell is leveled, iterate enemies within 60 ft; the first one whose `triggerReactions` returns `{ kind: 'negated' }` causes the spell to be aborted (slot consumed, action wasted). Only one enemy attempts Counterspell per spell cast (v1 simplification).
- **v1 simplifications:** 
  - Spell level for bespoke case branches (e.g., `case 'fireball':`) defaults to 1 (auto-success). Future work: add `slotLevel?` to `PlannedAction` for bespoke cases.
  - Proficiency bonus assumed +2 (typical L1-L4). Higher-level characters would have a higher prof bonus.
  - Spellcasting ability assumed best of INT/WIS/CHA (correct for Sorcerer/Warlock/Wizard).

### 6. Feather Fall (PHB p.239) — new
- **Trigger:** `falling` (any faller within 60 ft of the caster)
- **shouldCast:** Fires when at least one faller is within 60 ft and fall height > 0.
- **execute:** Marks up to 5 falling creatures within 60 ft with `_featherFallActive = true`. The engine's `processFallDamage` checks this flag and skips fall damage for marked creatures. Returns `{ kind: 'negated' }`.
- **cleanup:** No-op (the flag is consumed immediately by `processFallDamage`).
- **v1 simplifications:** v1 only models fall damage from Reverse Gravity concentration breaks (the only fall-damage source). The "60 ft per round descent rate" and "land on your feet" (no prone) are not modelled.

---

## Files Changed

### New files (8)
- `src/spells/_reaction_registry.ts` — Registry + `ReactionSpellDescriptor` interface
- `src/spells/absorb_elements.ts` — Absorb Elements spell module
- `src/spells/hellish_rebuke.ts` — Hellish Rebuke spell module
- `src/spells/counterspell.ts` — Counterspell spell module
- `src/spells/feather_fall.ts` — Feather Fall spell module
- `src/spells/silvery_barbs.ts` — Silvery Barbs spell module
- `src/test/reaction_registry.test.ts` — Integration tests (74 assertions)
- `src/test/shield_reaction.test.ts` — Shield unit tests (39 assertions)
- `src/test/absorb_elements.test.ts` — Absorb Elements unit tests (61 assertions)
- `src/test/hellish_rebuke.test.ts` — Hellish Rebuke unit tests (26 assertions)
- `src/test/counterspell.test.ts` — Counterspell unit tests (35 assertions)
- `src/test/feather_fall.test.ts` — Feather Fall unit tests (28 assertions)
- `src/test/silvery_barbs.test.ts` — Silvery Barbs unit tests (22 assertions)

### Modified files (4)
- `src/types/core.ts` — Added `ReactionTrigger` union, `ReactionOutcome` type, `_absorbElementsResistance` + `_absorbElementsRider` scratch fields on Combatant
- `src/engine/combat.ts` — Added `triggerReactions()` helper, `getSpellInfoFromPlan()` helper, `NON_SPELL_PLAN_TYPES` set; wired 4 trigger points (incoming_attack_hit, incoming_damage ×3, incoming_spell, falling); wired Absorb Elements rider consumption; changed `const hits` to `let hits` in resolveAttack
- `src/engine/utils.ts` — Added `cleanupAbsorbElements` import + call in `resetBudget`
- `src/spells/shield.ts` — Reworked to add `shouldCastReaction`/`executeReaction` (trigger-aware); kept legacy `shouldCast`/`execute`/`cleanup` for backwards compat
- `TEAMGOALS.md` — Updated TG-008 status: OPEN → DONE (with resolution notes)

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| reaction_registry.test.ts (74 assertions) | ✅ All pass (30/30 runs stable) |
| shield_reaction.test.ts (39 assertions) | ✅ All pass |
| absorb_elements.test.ts (61 assertions) | ✅ All pass |
| hellish_rebuke.test.ts (26 assertions) | ✅ All pass |
| counterspell.test.ts (35 assertions) | ✅ All pass |
| feather_fall.test.ts (28 assertions) | ✅ All pass |
| silvery_barbs.test.ts (22 assertions) | ✅ All pass |
| **Total new assertions** | **285** |
| Baseline tests (cure_wounds, healing_spells, healing_word, engine, ai, resources, scenario, combat) | ✅ All pass |
| Session 32 tests (invisibility_break_on_attack, thunderous_smite_push, damage_immunities, concentration_ai) | ✅ All pass |
| Broader spell tests (magic_missile, burning_hands, fireball, invisibility, thunderous_smite, booming_blade 218, green_flame_blade 209, conjure_fey 133, dispel_magic, shield_simple, shield_of_faith) | ✅ All pass |

---

## How to Add a New Reaction Spell (Template)

1. Create `src/spells/<snake_name>.ts` with:
   ```typescript
   export const metadata = { name, level, school, rangeFt, concentration: false, castingTime: 'reaction' } as const;
   export function shouldCastReaction(caster, bf, trigger): boolean { ... }
   export function executeReaction(caster, state, trigger): ReactionOutcome { ... }
   export function cleanup(caster): void { ... }  // no-op if instantaneous
   ```

2. Register in `src/spells/_reaction_registry.ts`:
   ```typescript
   import { shouldCastReaction as shouldCastXxx, executeReaction as executeXxx } from './xxx';
   export const REACTION_SPELLS: ReactionSpellDescriptor[] = [
     ...,
     { name: 'Xxx', level: N, triggerKinds: ['incoming_attack_hit'], shouldCast: shouldCastXxx, execute: executeXxx },
   ];
   ```

3. If the spell needs cleanup at start-of-turn, add `import { cleanup as cleanupXxx } from '../spells/xxx';` in `utils.ts` and call `cleanupXxx(c);` in `resetBudget`.

4. If the spell uses a new trigger kind, add it to the `ReactionTrigger` union in `core.ts` and wire a new trigger point in `combat.ts`.

5. Write tests in `src/test/xxx.test.ts` (metadata, shouldCast preconditions, execute effects, integration via resolveAttack/executePlannedAction, cleanup).

---

## Next Session Priorities

1. **Repelling Blast invocation** (deferred from Session 32) — needs Warlock invocations subsystem. The `pushAway()` infrastructure already exists.

2. **More innate spellcasting for summons** (continuation of Session 32 Task #6) — Couatl: add innate spellcasting (bless, cure wounds, lesser restoration, protection from poison, etc.) as Action objects.

3. **Bestiary integration** (deferred from Session 31) — Wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the Conjure spell upcast paths.

4. **Conjure Volley / Conjure Barrage re-categorization** (minor documentation cleanup from Session 31).

5. **Invisibility upcast** (Invisibility +1 target/slot level above 2nd — currently NOT modelled).

6. **Concentration enforcement** (TG-002 — Invisibility and Greater Invisibility both have `concentrationEnforcementV1Implemented: false`; concentration is started but not actively checked on damage).

7. **Shield Magic Missile blocking** (v1 simplification from Session 33) — currently Shield only fires on attack hits, not on Magic Missile auto-hits. Would require adding a separate "targeted by Magic Missile" trigger or reworking the auto-hit branch.

8. **Silvery Barbs save-success trigger** (v1 simplification from Session 33) — currently only triggers on attack hits. The save-success and ability-check-success triggers would need new trigger points in `rollSave` and ability-check resolution.

9. **Protection from Energy** (the 7th TG-008 spell, not implemented in Session 33) — it's a buff spell, not a true reaction. Should be implemented as a regular concentration buff spell (L3 abjuration, touch, 10 min concentration, resistance to one damage type).

---

## Commit Log (Session 33)

```
Session 33: TG-008 Reaction spell subsystem — DONE

Infrastructure:
  - Add ReactionTrigger discriminated union + ReactionOutcome type to core.ts
  - Add _absorbElementsResistance + _absorbElementsRider scratch fields to Combatant
  - Create _reaction_registry.ts with ReactionSpellDescriptor + REACTION_SPELLS array
  - Add triggerReactions() helper in combat.ts (central dispatch)
  - Add getSpellInfoFromPlan() helper (Counterspell spell-cast detection)
  - Wire 4 trigger points:
    * incoming_attack_hit in resolveAttack (Shield, Silvery Barbs)
    * incoming_damage ×3 in resolveAttack (Absorb Elements, Hellish Rebuke)
    * incoming_spell in executePlannedAction (Counterspell)
    * falling in processFallDamage (Feather Fall)
  - Wire Absorb Elements rider consumption in resolveAttack damage branch
  - Wire cleanupAbsorbElements in resetBudget (utils.ts)

Spell modules (6):
  - Shield (reworked): trigger-aware shouldCastReaction/executeReaction,
    legacy shouldCast/execute retained for backwards compat
  - Absorb Elements (new): resistance + 1d6 melee rider, cleanup at start of next turn
  - Hellish Rebuke (new): 2d10 fire DEX save half vs attacker, DC 8+CHA+2
  - Silvery Barbs (new): force reroll, use lower, may flip hit to miss
  - Counterspell (new): auto-success L1-3 with L3 slot, ability check vs DC 10+level for L4+,
    upcast auto-success, range 60 ft, negates spell cast
  - Feather Fall (new): up to 5 fallers within 60 ft take no fall damage

Tests (7 files, 285 assertions):
  - reaction_registry.test.ts (74) — registry shape, trigger dispatch, budget interaction
  - shield_reaction.test.ts (39) — tactical gating, AC re-eval, legacy compat
  - absorb_elements.test.ts (61) — damage type gating, resistance, rider consumption
  - hellish_rebuke.test.ts (26) — DC computation, DEX save, range gating
  - counterspell.test.ts (35) — auto-success, ability check, upcast, L6+ gating
  - feather_fall.test.ts (28) — max 5 fallers, range per-faller
  - silvery_barbs.test.ts (22) — reroll mechanic, lower-roll evaluation

All baseline tests still pass (cure_wounds, healing_spells, healing_word, engine,
ai, resources, scenario, combat, shield_simple, shield_of_faith, invisibility,
thunderous_smite, booming_blade 218, green_flame_blade 209, conjure_fey 133,
dispel_magic, invisibility_break_on_attack, thunderous_smite_push,
damage_immunities, concentration_ai).

TEAMGOALS.md updated: TG-008 status OPEN → DONE.
```

---

## Generic Registry Count
- Unchanged from Sessions 29-32: 129 spells in `_generic_registry.ts`.
- The new `_reaction_registry.ts` has 6 reaction spells (Shield, Absorb Elements, Hellish Rebuke, Silvery Barbs, Counterspell, Feather Fall).
