# zHANDOVER — Session 38

**Date:** 2026-06-22
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement the #1 deferred priority from Session 32 — Repelling Blast Eldritch Invocation (PHB p.111). This establishes the Warlock invocations subsystem (a new registry + hook pattern) that future invocations (Agonizing Blast, Grasp of Hadar, Lance of Lethargy, etc.) can extend.

---

## Session Summary

Session 37 closed Shield Magic Missile blocking (v1 simplification #7 from Session 33). Session 38 closes the #1 deferred priority: Repelling Blast, which was deferred from Session 32 because it "needs Warlock invocations subsystem." This session builds that subsystem from scratch.

| Component | Status | Lines |
|-----------|--------|-------|
| `src/spells/_invocations.ts` (NEW) — Invocations registry + Repelling Blast + helpers | ✅ Done | ~110 lines |
| `src/types/core.ts` — Added `eldritchInvocations?: string[]` field to Combatant | ✅ Done | +8 lines |
| `src/engine/combat.ts` — Wired invocation hook in resolveAttack + import | ✅ Done | ~12 lines |
| `src/spells/eldritch_blast.ts` — Added `repellingBlastV1Implemented: true` metadata flag | ✅ Done | +7 lines |
| `src/test/repelling_blast.test.ts` (NEW) — 36 assertions, 12 sections | ✅ Done | ~310 lines |

**Total:** ~450 lines of new/modified code, 36 new test assertions.

---

## Architecture

### Invocations subsystem (new)

The invocations registry (`src/spells/_invocations.ts`) follows the same pattern as the reaction registry (`_reaction_registry.ts`): a `Record<string, EldritchInvocation>` map where each entry has a name, description, and optional hooks.

```typescript
export interface EldritchInvocation {
  name: string;
  description: string;
  onEldritchBlastHit?: (attacker, target, state) => void;
}
```

The `onEldritchBlastHit` hook is the first invocation trigger point. It fires in `resolveAttack` after damage is dealt, before `checkDeath`, when `action.name === 'Eldritch Blast'`. The hook internally checks the attacker's `eldritchInvocations` list — it's a no-op if the attacker doesn't have the invocation.

**Extensibility:** Future invocations can add new hooks (e.g. `onPactMagicCast`, `onShortRest`) by:
1. Adding the hook to the `EldritchInvocation` interface
2. Wiring a new trigger point in combat.ts
3. Adding the invocation to the `ELDRITCH_INVOCATIONS` map

### Repelling Blast implementation

PHB p.111: "When you hit a creature with Eldritch Blast, you can push the creature up to 10 feet away from you in a straight line."

- **Push distance:** Always 10 ft (2 squares). The "up to" is the warlock's choice; the AI always pushes max. No size restriction (PHB has none for Repelling Blast, unlike Grasp of Hadar).
- **Push direction:** Straight line from caster through target (Chebyshev distance), via the existing `pushAway(target, attacker.pos, 10)` in movement.ts.
- **Timing:** After damage is dealt, before `checkDeath`. This means even a target about to drop to 0 HP gets pushed (PHB: "when you hit" — the push triggers on hit, not on kill). Dead targets aren't pushed because `pushAway` guards `isDead`.
- **Logging:** Only logs a `move` event if the target actually moved. `pushAway` returns early for dead/unconscious/same-position targets — in those cases, no log event is emitted (avoids misleading "pushed" logs for targets that didn't move).

### Combatant field

New optional field `eldritchInvocations?: string[]` on Combatant. Populated by the parser/leveler for Warlock PCs (future work — the leveler doesn't populate this yet). Undefined or empty for non-Warlocks. The engine checks this list via `hasInvocation(combatant, name)` or directly via `fireEldritchBlastHitInvocations` (which iterates the list).

### Engine wiring

In `resolveAttack`'s standard attack damage branch, right after `applyCantripEffect` (cantrip post-hit riders) and before `applyWardingBondRedirect` + `checkDeath`:

```typescript
if (action.name === 'Eldritch Blast') {
  fireEldritchBlastHitInvocations(attacker, target, state);
}
```

This is the same structural position as other post-hit effects (cantrip riders, Hex damage, Sneak Attack, Absorb Elements rider). The `action.name` check ensures the hook only fires for Eldritch Blast, not for other cantrips that happen to deal force damage.

---

## Files Changed

### New files (2)
- `src/spells/_invocations.ts` — Warlock Eldritch Invocations registry. Contains the `EldritchInvocation` interface, `ELDRITCH_INVOCATIONS` map (with Repelling Blast as the first entry), `hasInvocation` helper, and `fireEldritchBlastHitInvocations` dispatcher. Extensively commented with the PHB reference + future-invocation roadmap.

- `src/test/repelling_blast.test.ts` — 36 assertions across 12 sections covering the registry shape, helper functions, the invocation hook (unit + end-to-end), push direction, push logging, and edge cases (dead target, miss, non-EB cantrip, no invocation).

### Modified files (3)
- `src/types/core.ts` — Added `eldritchInvocations?: string[]` field to the Combatant interface (after `resources`, with documentation).

- `src/engine/combat.ts` — Two changes:
  1. Added import: `import { fireEldritchBlastHitInvocations } from '../spells/_invocations';`
  2. In `resolveAttack`'s standard attack damage branch, after `applyCantripEffect` and before `applyWardingBondRedirect` + `checkDeath`: added the `if (action.name === 'Eldritch Blast') { fireEldritchBlastHitInvocations(...); }` hook.

- `src/spells/eldritch_blast.ts` — Added `repellingBlastV1Implemented: true` to the metadata object (with documentation comment referencing the invocation registry).

---

## Test Coverage (36 assertions, 12 sections)

| Section | Description |
|---------|-------------|
| 1 | Invocation registry shape (ELDRITCH_INVOCATIONS has Repelling Blast with name + description + hook) |
| 2 | `hasInvocation` helper (true for known, false for unknown/undefined/empty) |
| 3 | Eldritch Blast metadata flag (`repellingBlastV1Implemented: true`) |
| 4 | `fireEldritchBlastHitInvocations` — no-op without invocations (no push, no log) |
| 5 | `fireEldritchBlastHitInvocations` — pushes 10 ft when Repelling Blast present |
| 6 | **End-to-end**: EB hit + Repelling Blast → target pushed 10 ft + damage dealt + push logged |
| 7 | **End-to-end**: EB hit WITHOUT Repelling Blast → no push (damage still dealt) |
| 8 | **End-to-end**: Fire Bolt + Repelling Blast → no push (only EB triggers the invocation) |
| 9 | **End-to-end**: EB MISS + Repelling Blast → no push (hit-only, per PHB "when you hit") |
| 10 | Push direction: diagonal — target at (7,7) pushed to (9,9) away from caster at (5,5) |
| 11 | Push event log shape (type=move, old/new positions, "10 ft", actorId, targetId) |
| 12 | Dead target NOT pushed (`pushAway` guards `isDead`; no log event emitted) |

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `repelling_blast.test.ts` (36 assertions) | ✅ All pass (3 stable runs) |
| Baseline tests (eldritch_blast 53, combat 51, engine 71, magic_missile 25, shield_reaction 66, reaction_registry 74, mechanics 57, scenario 94, ai 26, bulk_spell_dispatch 214, protection_from_energy 117, concentration_enforcement 34, invisibility 81, silvery_barbs 22, counterspell 35, thunderous_smite 28, booming_blade 218, green_flame_blade 209, dispel_magic 47) | ✅ All pass — no regressions |

---

## Next Session Priorities

(Updated from Session 37 — item 1 now closed by Session 38.)

1. **~~Repelling Blast invocation~~** ✅ DONE (Session 38) — invocations subsystem built; Repelling Blast pushes 10 ft on EB hit.

2. **More innate spellcasting for summons** (continuation of Session 32 Task #6) — Couatl: add innate spellcasting (bless, cure wounds, lesser restoration, protection from poison, etc.) as Action objects. Requires summon AI integration with existing spell modules + 3/day resource tracking. The Couatl stat block is in `src/spells/conjure_celestial.ts`.

3. **Bestiary integration** (deferred from Session 31) — Wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the Conjure spell upcast paths.

4. **~~Conjure Volley / Conjure Barrage re-categorization~~** ✅ DONE (Session 36).

5. **~~Invisibility upcast~~** ✅ DONE (Session 35).

6. **~~Concentration enforcement~~** ✅ DONE (Session 34) — TG-002 closed.

7. **~~Shield Magic Missile blocking~~** ✅ DONE (Session 37).

8. **Silvery Barbs save-success trigger** (v1 simplification from Session 33) — **Investigated Session 37, DEFERRED with migration plan.** Requires creating `rollSaveReactable` wrapper in combat.ts + migrating 110 spell modules that call `rollSave`. The circular dependency (utils.ts ↔ combat.ts) prevents firing reactions inside `rollSave` itself. See Session 37 handover §"Architecture Note" for the full plan. Recommend a dedicated session. **Alternative approach identified:** a callback-registration pattern (utils.ts exposes a `registerSaveSuccessReactor` hook; combat.ts registers the callback at module load) could avoid the circular dependency AND allow `rollSave` to stay in utils.ts. The 110-module migration would then be just adding two optional args (`state, caster`) to each `rollSave` call.

9. **~~Protection from Energy~~** ✅ DONE (Session 34) — TG-008 fully closed.

10. **~~Protection from Energy upcast~~** ✅ DONE (Session 36).

11. **~~Protection from Energy innate-resistance edge case~~** ✅ DONE (Session 36).

12. **Greater Invisibility upcast** — Greater Invisibility (L4) has NO upcast entry in PHB (it's self-only, single-target). No action needed; documented for completeness.

13. **More Eldritch Invocations** (NEW — natural follow-up to Session 38) — The invocations subsystem is built. Easy next invocations:
    - **Agonizing Blast** (PHB p.110): +CHA mod to Eldritch Blast damage. Would need a `onEldritchBlastDamage` hook (or fold into the existing hit hook).
    - **Grasp of Hadar** (PHB p.111): pull 10 ft toward you on EB hit. Mirror of Repelling Blast but using `pullToward`.
    - **Lance of Lethargy** (XGE p.157): reduce speed by 10 ft on EB hit. Would need a speed-reduction scratch field.
    - The parser/leveler also needs to populate `combatant.eldritchInvocations` from character data (currently no test populates it — tests set it manually).

---

## Commit Log (Session 38)

```
Session 38: Repelling Blast Eldritch Invocation + invocations subsystem

Implements the #1 deferred priority from Session 32: Repelling Blast
(PHB p.111). "When you hit a creature with Eldritch Blast, you can push
the creature up to 10 feet away from you in a straight line."

New invocations subsystem (src/spells/_invocations.ts):
  - EldritchInvocation interface with optional onEldritchBlastHit hook
  - ELDRITCH_INVOCATIONS registry (Repelling Blast as the first entry)
  - hasInvocation(combatant, name) helper
  - fireEldritchBlastHitInvocations(attacker, target, state) dispatcher
  - Extensible for future invocations (Agonizing Blast, Grasp of Hadar,
    Lance of Lethargy, etc.) — just add to the registry + wire hooks

Combatant type (src/types/core.ts):
  - New optional field: eldritchInvocations?: string[]
  - Populated by parser/leveler for Warlock PCs; undefined for others
  - Checked by the engine at invocation trigger points

Engine wiring (src/engine/combat.ts):
  - Import fireEldritchBlastHitInvocations from _invocations
  - In resolveAttack's standard attack damage branch, AFTER
    applyCantripEffect + BEFORE checkDeath: if action.name ===
    'Eldritch Blast', fire invocation hooks. The hook checks the
    attacker's eldritchInvocations list; no-op if Repelling Blast
    isn't known.
  - Push fires AFTER damage, BEFORE death check (PHB: "when you hit" —
    the push triggers on hit, not on kill. Dead targets aren't pushed
    because pushAway guards isDead.)

Eldritch Blast metadata (src/spells/eldritch_blast.ts):
  - New flag: repellingBlastV1Implemented: true

Repelling Blast implementation:
  - Pushes target 10 ft (2 squares) away from caster via pushAway()
  - Direction: straight line from caster through target (Chebyshev)
  - Only logs a move event if the target actually moved (pushAway
    returns early for dead/unconscious/same-position targets)
  - v1 simplification: always pushes max 10 ft (the "up to" is the
    warlock's choice; AI always pushes max). No size restriction
    (PHB has none for Repelling Blast).

Tests (src/test/repelling_blast.test.ts — 36 assertions, 12 sections):
  1. Invocation registry shape
  2. hasInvocation helper
  3. Eldritch Blast metadata flag
  4. fireEldritchBlastHitInvocations — no-op without invocations
  5. fireEldritchBlastHitInvocations — pushes 10 ft when present
  6. End-to-end: EB hit + Repelling Blast → pushed 10 ft
  7. End-to-end: EB hit WITHOUT Repelling Blast → no push
  8. End-to-end: Fire Bolt + Repelling Blast → no push (EB-only)
  9. End-to-end: EB MISS + Repelling Blast → no push (hit-only)
  10. Push direction: diagonal away from caster
  11. Push event log shape (old/new positions, 10 ft, actor/target IDs)
  12. Dead target NOT pushed (pushAway guards isDead)

All baseline tests pass (no regressions): repelling_blast (36),
eldritch_blast (53), combat (51), engine (71), magic_missile (25),
shield_reaction (66), reaction_registry (74), mechanics (57),
scenario (94), ai (26), bulk_spell_dispatch (214),
protection_from_energy (117), concentration_enforcement (34),
invisibility (81), silvery_barbs (22), counterspell (35),
thunderous_smite (28), booming_blade (218), green_flame_blade (209),
dispel_magic (47).

tsc --noEmit: 0 errors.
```

---

## Generic Registry Count

- Unchanged from Session 37: 130 spells in `_generic_registry.ts`.
- The `_reaction_registry.ts` has 6 reaction spells (unchanged).
- The new `_invocations.ts` has 1 Eldritch Invocation (Repelling Blast). Future invocations will be added to this registry.

---

## CI Status

- **Before this session:** Latest commit (bc106a1, Session 37 handover CI update) was green (Test Suite `success`).
- **Session 38 commit (1dc7128):** Test Suite `success` ✅. The work is purely additive (new file + new optional Combatant field + 1 new trigger point in resolveAttack + metadata flag). All 36 repelling_blast assertions pass locally (3 stable runs), and 19 baseline test files pass (no regressions). The only engine path modified is the `if (action.name === 'Eldritch Blast')` block in resolveAttack — a no-op for non-EB attacks.
- **Handover commit (4a878a2 — this file):** Test Suite `success` ✅. No code changes (markdown-only), so the green result from 1dc7128 carries forward.
- **Final state:** All green on the latest commit (4a878a2). No red X.
