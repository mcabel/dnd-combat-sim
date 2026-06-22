# zHANDOVER — Session 39

**Date:** 2026-06-22
**Agent:** Cantrip-z workstream (Z.ai)
**Focus:** Implement item #13 from Session 38's next-session priorities — three more Eldritch Blast-augmenting invocations: Agonizing Blast (+CHA mod to damage), Grasp of Hadar (pull 10 ft), and Lance of Lethargy (reduce speed 10 ft). Extends the invocations subsystem built in Session 38.

---

## Session Summary

Session 38 built the invocations subsystem with Repelling Blast as the first entry. Session 39 extends it with 3 more EB-augmenting invocations, adding a new pre-damage hook (`onEldritchBlastDamage`) alongside the existing post-hit hook (`onEldritchBlastHit`).

| Component | Status | Lines |
|-----------|--------|-------|
| `src/spells/_invocations.ts` — added 3 invocations + `onEldritchBlastDamage` hook + `fireEldritchBlastDamageInvocations` dispatcher | ✅ Done | ~230 lines (was ~130) |
| `src/types/core.ts` — added `_lanceOfLethargyOriginalSpeed` + `_hasLanceOfLethargy` scratch fields | ✅ Done | +10 lines |
| `src/engine/combat.ts` — wired pre-damage Agonizing Blast hook + updated import | ✅ Done | ~15 lines |
| `src/engine/utils.ts` — inlined Lance of Lethargy cleanup in `resetBudget` | ✅ Done | ~12 lines |
| `src/spells/eldritch_blast.ts` — added 3 metadata flags | ✅ Done | +10 lines |
| `src/test/eldritch_invocations.test.ts` (NEW) — 50 assertions, 15 sections | ✅ Done | ~370 lines |

**Total:** ~650 lines of new/modified code, 50 new test assertions.

---

## Architecture

### New hook: `onEldritchBlastDamage` (pre-damage)

Session 38's `onEldritchBlastHit` fires AFTER damage is dealt. Agonizing Blast needs to add damage BEFORE `applyDamageWithTempHP`, so a new pre-damage hook was needed.

```typescript
onEldritchBlastDamage?: (attacker: Combatant, target: Combatant) => number;
```

Returns bonus damage to add to the base roll. Wired in `resolveAttack` right after `let dmg = rollDamage(action.damage, isCrit)`, before the other riders (Divine Smite, Sneak Attack, Hex, etc.).

**Key design decisions:**
- **Flat modifier, not dice** — Agonizing Blast adds CHA mod (a flat number), NOT dice. Per PHB p.196, crit doubles "damage dice" — flat modifiers are NOT doubled. The pre-damage hook fires once regardless of crit, so the CHA mod is added once (not doubled).
- **CHA mod computed inline** — `Math.floor((attacker.cha - 10) / 2)` instead of importing `abilityMod` from utils.ts, to avoid a circular dependency (utils.ts → _invocations.ts → utils.ts).
- **Negative CHA mod gate** — the combat.ts hook checks `if (invDmg > 0)` before adding, so a negative CHA mod (CHA < 10) does NOT reduce EB damage. v1 simplification — most Warlocks have CHA 16+.

### Grasp of Hadar (mirror of Repelling Blast)

Uses the existing `onEldritchBlastHit` hook + `pullToward()` from movement.ts. Identical structure to Repelling Blast but with reversed direction. Only logs a move event if the target actually moved (pullToward returns early for dead/same-position targets).

v1 simplification: no "once per turn" limit (PHB p.111: "Once on each of your turns"). With v1's single-beam EB, this limit never matters. Multi-beam EB (future task) would need to track once-per-turn.

### Lance of Lethargy (Ray of Frost pattern)

Uses the existing `onEldritchBlastHit` hook + the Ray of Frost scratch-field pattern:
1. Store original speed in `_lanceOfLethargyOriginalSpeed` (only if not already stored)
2. Reduce `target.speed` by 10 ft (Math.max(0, ...))
3. Set `_hasLanceOfLethargy = true`
4. Cleanup at start of each combatant's turn restores original speed

**Circular dependency avoidance:** The cleanup logic is inlined in `resetBudget` (utils.ts) rather than exported from `_invocations.ts`, because `_invocations.ts` imports from `../engine/combat` (for EngineState type) and `../engine/movement` (for pushAway/pullToward). If utils.ts imported from _invocations.ts, and _invocations.ts imported abilityMod from utils.ts, that would be circular. Inlining the 5-line cleanup in resetBudget avoids this entirely.

### Invocation registry now has 4 entries

| Invocation | Hook | Effect | Source |
|-----------|------|--------|--------|
| Repelling Blast | onEldritchBlastHit | Push 10 ft away | Session 38 |
| Agonizing Blast | onEldritchBlastDamage | +CHA mod damage | Session 39 |
| Grasp of Hadar | onEldritchBlastHit | Pull 10 ft toward | Session 39 |
| Lance of Lethargy | onEldritchBlastHit | Reduce speed 10 ft | Session 39 |

All 4 fire on Eldritch Blast hits only (gated by `action.name === 'Eldritch Blast'` in combat.ts). Multiple invocations stack: a Warlock with all 4 would push/pull (Repelling + Grasp cancel if both present), deal extra damage (Agonizing), and slow (Lance) on every EB hit.

---

## Files Changed

### New files (1)
- `src/test/eldritch_invocations.test.ts` — 50 assertions across 15 sections covering all 3 new invocations (unit + end-to-end), CHA mod computation, crit non-doubling, cleanup, and combinations (Repelling + Agonizing; Repelling + Grasp net-zero).

### Modified files (5)
- `src/spells/_invocations.ts` — Added `onEldritchBlastDamage` to the interface, added 3 new invocation entries (Agonizing Blast, Grasp of Hadar, Lance of Lethargy), added `fireEldritchBlastDamageInvocations` dispatcher, added `pullToward` import, fixed a comment typo in `fireEldritchBlastHitInvocations`.

- `src/types/core.ts` — Added `_lanceOfLethargyOriginalSpeed?: number` and `_hasLanceOfLethargy?: boolean` scratch fields to Combatant (after Ray of Frost's fields, with documentation).

- `src/engine/combat.ts` — Added `fireEldritchBlastDamageInvocations` to the import; wired the pre-damage hook in resolveAttack after `let dmg = rollDamage(...)` and before the rider chain (Divine Smite, Sneak Attack, etc.). The hook checks `if (invDmg > 0)` before adding + logging.

- `src/engine/utils.ts` — Inlined the Lance of Lethargy cleanup in `resetBudget` (after `cleanupAbsorbElements(c)`, before `effectiveSpeed(c)`). Restores `c.speed` from `c._lanceOfLethargyOriginalSpeed` and clears both scratch fields.

- `src/spells/eldritch_blast.ts` — Added 3 metadata flags: `agonizingBlastV1Implemented: true`, `graspOfHadarV1Implemented: true`, `lanceOfLethargyV1Implemented: true`.

---

## Test Coverage (50 assertions, 15 sections)

| Section | Description |
|---------|-------------|
| 1 | Registry shape (all 3 invocations registered with correct hooks) |
| 2 | Agonizing Blast — `fireEldritchBlastDamageInvocations` unit tests (no invocations → 0; CHA 18 → +4; CHA 20 → +5; hasInvocation helper) |
| 3 | Agonizing Blast — end-to-end resolveAttack (+CHA mod damage, crit range 6..24) |
| 4 | Agonizing Blast — no invocation → no extra damage (control) |
| 5 | Agonizing Blast — Fire Bolt does NOT trigger (EB-only gating) |
| 6 | Agonizing Blast — crit does NOT double CHA mod (flat modifier, not dice; range 6..24, not 8..28) |
| 7 | Grasp of Hadar — `fireEldritchBlastHitInvocations` pulls 10 ft toward caster (unit) |
| 8 | Grasp of Hadar — end-to-end resolveAttack (pull toward, damage still dealt) |
| 9 | Grasp of Hadar — diagonal pull direction (7,7 → 5,5 toward caster at 5,5) |
| 10 | Lance of Lethargy — `fireEldritchBlastHitInvocations` reduces speed 10 ft (unit; scratch fields set; log mentions 30ft → 20ft) |
| 11 | Lance of Lethargy — end-to-end + `resetBudget` cleanup restores speed (30 → 20 → 30) |
| 12 | Lance of Lethargy — EB miss → no slow (hit-only gating) |
| 13 | Combinations — Repelling + Agonizing (push + extra damage; both logged) |
| 14 | Combinations — Repelling + Grasp (push 10 ft then pull 10 ft = net zero; both logged) |
| 15 | Eldritch Blast metadata flags (all 4 invocation flags = true) |

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `eldritch_invocations.test.ts` (50 assertions) | ✅ All pass (5 stable runs) |
| Baseline tests (repelling_blast 36, eldritch_blast 53, combat 0-failed, engine 71, magic_missile 25, shield_reaction 66, reaction_registry 74, mechanics 57, scenario 94, ai 26, bulk_spell_dispatch 214, protection_from_energy 117, concentration_enforcement 34, invisibility 81, silvery_barbs 22, counterspell 35, booming_blade 218, green_flame_blade 209, dispel_magic 47, shillelagh 60, bless 37, hex 27, fireball 34, burning_hands 33, shield_simple 12) | ✅ All pass — no regressions |

---

## Next Session Priorities

(Updated from Session 38 — item 13 now closed by Session 39. The 4 EB-augmenting invocations are all implemented.)

1. **~~Repelling Blast invocation~~** ✅ DONE (Session 38).

2. **More innate spellcasting for summons** (continuation of Session 32 Task #6) — Couatl: add innate spellcasting (bless, cure wounds, lesser restoration, protection from poison, etc.) as Action objects. Requires summon AI integration with existing spell modules + 3/day resource tracking. The Couatl stat block is in `src/spells/conjure_celestial.ts`.

3. **Bestiary integration** (deferred from Session 31) — Wire `cr_picker.ts` + `monsterToCombatant` to the actual bestiary JSON so v2 can pick higher-CR creatures based on slot level for the Conjure spell upcast paths.

4. **~~Conjure Volley / Conjure Barrage re-categorization~~** ✅ DONE (Session 36).

5. **~~Invisibility upcast~~** ✅ DONE (Session 35).

6. **~~Concentration enforcement~~** ✅ DONE (Session 34).

7. **~~Shield Magic Missile blocking~~** ✅ DONE (Session 37).

8. **Silvery Barbs save-success trigger** (v1 simplification from Session 33) — **Investigated Session 37, DEFERRED with migration plan.** Requires creating `rollSaveReactable` wrapper in combat.ts + migrating 110 spell modules that call `rollSave`. See Session 37 handover §"Architecture Note" for the full plan.

9. **~~Protection from Energy~~** ✅ DONE (Session 34).

10. **~~Protection from Energy upcast~~** ✅ DONE (Session 36).

11. **~~Protection from Energy innate-resistance edge case~~** ✅ DONE (Session 36).

12. **Greater Invisibility upcast** — No action needed (self-only, no upcast in PHB).

13. **~~More Eldritch Invocations~~** ✅ DONE (Session 39) — Agonizing Blast, Grasp of Hadar, Lance of Lethargy all implemented. The invocations registry now has 4 entries. Future invocations that DON'T augment EB (e.g. Thirsting Blade for Pact Weapon extra attack, Eldritch Spear for EB range 300 ft) would need different hooks or metadata-only changes.

14. **Parser/leveler integration for `eldritchInvocations`** (NEW) — The `Combatant.eldritchInvocations` field is populated manually in tests. The parser/leveler needs to populate it from character data (Warlock PC level 2+ chooses 2 invocations; more at higher levels). Without this, the invocations only work in test scenarios. The `src/characters/leveler.ts` file is the likely integration point.

---

## Commit Log (Session 39)

```
Session 39: Agonizing Blast + Grasp of Hadar + Lance of Lethargy invocations

Extends the invocations subsystem (built Session 38) with 3 more
Eldritch Blast-augmenting invocations. All use the existing
onEldritchBlastHit hook (post-hit) or a new onEldritchBlastDamage hook
(pre-damage) added this session.

Agonizing Blast (PHB p.110):
  - +CHA mod to Eldritch Blast damage on hit
  - New pre-damage hook: onEldritchBlastDamage(attacker, target) => number
  - New dispatcher: fireEldritchBlastDamageInvocations(attacker, target)
  - Wired in resolveAttack AFTER base damage roll, BEFORE other riders
  - CHA mod computed inline to avoid circular dependency
  - Flat modifier (NOT dice) — NOT doubled on crit per PHB p.196

Grasp of Hadar (PHB p.111):
  - Pull 10 ft toward caster on EB hit (mirror of Repelling Blast)
  - Uses existing onEldritchBlastHit hook + pullToward() from movement.ts
  - v1: always pulls full 10 ft; no "once per turn" limit; no size restriction

Lance of Lethargy (XGE p.157):
  - Reduce target speed by 10 ft on EB hit
  - Uses existing onEldritchBlastHit hook + Ray of Frost scratch-field pattern
  - New Combatant fields: _lanceOfLethargyOriginalSpeed, _hasLanceOfLethargy
  - Cleanup inlined in resetBudget (utils.ts) to avoid circular dependency
  - v1: speed restored at start of EACH combatant's turn (same as Ray of Frost)

Eldritch Blast metadata: 3 new flags (agonizing/grasp/lance = true)

Tests (src/test/eldritch_invocations.test.ts — 50 assertions, 15 sections):
  Registry shape, Agonizing Blast (unit + end-to-end + CHA mod + crit
  non-doubling), Grasp of Hadar (unit + end-to-end + diagonal), Lance of
  Lethargy (unit + end-to-end + cleanup + miss), Combinations (Repelling +
  Agonizing; Repelling + Grasp net-zero), metadata flags.

All baseline tests pass (no regressions).
tsc --noEmit: 0 errors.
```

---

## Generic Registry Count

- Unchanged from Session 38: 130 spells in `_generic_registry.ts`.
- The `_reaction_registry.ts` has 6 reaction spells (unchanged).
- The `_invocations.ts` now has 4 Eldritch Invocations (Repelling Blast, Agonizing Blast, Grasp of Hadar, Lance of Lethargy — up from 1 in Session 38).

---

## CI Status

- **Before this session:** Latest commit (74048a5, Session 38 handover CI update) was green (Test Suite `success`).
- **Session 39 commit (126355f):** To be verified post-commit. The work is additive (3 new invocation entries + 1 new hook + 1 new dispatcher + 2 new scratch fields + 1 cleanup inline + 1 pre-damage trigger point). All 50 eldritch_invocations assertions pass locally (5 stable runs), and 14 baseline test files pass (no regressions). The only engine path modified is the `if (action.name === 'Eldritch Blast')` pre-damage block in resolveAttack — a no-op for non-EB attacks.
