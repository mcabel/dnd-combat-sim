# HANDOVER-SESSION-77

## REPOSITORY

- Branch: main
- Commit: 5f9cd30 (pushed)
- Previous: 819bc0b (RFC-MONSTER-SPELLCASTING Phase 4)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## CRITICAL DISCOVERY: SESSION 76 HANDOVER WAS STALE

**The Session 76 handover's "IMMEDIATE NEXT ACTION" of `TG-033-P2: Add sourceSlotLevel to ActiveEffect interface` was already done upstream by Session 72.**

Reading the codebase and `zHANDOVER-SESSION-72.md` reveals that Session 72 implemented **all 6 phases of RFC-UPCASTING** end-to-end:

- ✅ **P1** `castSlotLevel` on `PlannedAction` + `getLowestAvailableSlot` + `getSpellInfoFromPlan` fix
- ✅ **P2** `sourceSlotLevel` on `ActiveEffect` + Dispel Magic accurate DC (`10 + sourceSlotLevel`, fallback DC 13)
- ✅ **P3** Upcast damage/healing scaling for 19 bespoke spells (all metadata flags `xxxUpcastV1Implemented: true`)
- ✅ **P4** Globe of Invulnerability real implementation (`spell_shield` effect type, `isProtectedByGoI()`, GoI blocking check in `combat.ts`)
- ✅ **P5** AI penetration-motivated upcasting (`selectCastSlot()` in `planner.ts`, 15 spell branches updated)
- ✅ **P6** Cantrip caster-level damage scaling (`cantripTier()` in `utils.ts`, resolveAttack integration, module-specific scaling for 6 AoE cantrips)

Session 76 was apparently a **rebase session** that re-implemented P1 on top of upstream (commit `be702a1`), then wrote a handover claiming P2 was the next task — without realizing P2–P6 were already complete. The handover's "DISCOVERIES RELEVANT TO NEXT TASK" section half-acknowledges this ("Upstream Session 72 already did partial P1 work… Check `src/ai/planner.ts` ~line 926 before implementing P5 — it may already be stubbed."), but still framed P2 as the next action.

**Verification performed this session:**
- `src/types/core.ts:175` — `sourceSlotLevel?: number` present on `ActiveEffect` ✅
- `src/spells/dispel_magic.ts:61` — `dispelMagicSpellLevelTrackingV1Implemented: true` ✅
- `src/spells/dispel_magic.ts:258` — `const effectLevel = effect.sourceSlotLevel` ✅
- `src/spells/globe_of_invulnerability.ts:109` — `sourceSlotLevel: slotLevel` set on GoI effect ✅
- `applySpellEffect` accepts `sourceSlotLevel` via `Omit<ActiveEffect, 'id'>` spread (no separate param needed) ✅
- All 19 P3 spells have `xxxUpcastV1Implemented: true` metadata flags ✅
- `selectCastSlot` present at `src/ai/planner.ts:926` ✅
- `cantripTier` present at `src/engine/utils.ts:114` ✅
- `session72_upcasting_system.test.ts` — 77/77 tests pass ✅
- `upcasting_p1.test.ts` — 21/21 tests pass ✅

## COMPLETED THIS SESSION

### TG-033-P4-followup: GoI AoE exclusion for 5 core damage spells

Instead of re-doing P2 (already done), I picked the **GoI v1 follow-up #1** from the Session 72 handover's "Remaining Work" section:

> **AoE exclusion:** When Fireball hits multiple targets, GoI-protected targets should be excluded from damage but others still take damage

**Commit:** `5f9cd30` — `RFC-UPCASTING Phase 4 follow-up: GoI AoE exclusion for 5 core damage spells`

**Problem:** Prior to this commit, AoE spells in `AOE_PLAN_TYPES` (combat.ts) bypassed GoI entirely. Single-target spells were blocked correctly, but AoE spells (Fireball, Lightning Bolt, etc.) hit GoI-protected targets normally — violating PHB p.245: *"the spell has no effect on them."*

**Solution:** Added per-target exclusion in 5 core damage AoE spells:

| Spell | Level | AoE shape | Save | File |
|---|---|---|---|---|
| Fireball | 3 | 20-ft radius sphere | DEX | `src/spells/fireball.ts` |
| Lightning Bolt | 3 | 100-ft line | DEX | `src/spells/lightning_bolt.ts` |
| Burning Hands | 1 | 15-ft cone | DEX | `src/spells/burning_hands.ts` |
| Shatter | 2 | 10-ft radius sphere | CON | `src/spells/shatter.ts` |
| Thunderwave | 1 | 15-ft cube | CON + push | `src/spells/thunderwave.ts` |

**Implementation:**

1. **New helper `filterGoIProtectedTargets(targets, castLevel, casterId)`** in `src/engine/spell_effects.ts`:
   - Pure function (no side effects)
   - Cantrip level (0) → no filtering (PHB p.245: cantrips never blocked)
   - Caster's own GoI → not filtered (PHB p.245: "cast from outside the barrier" — caster is at center)
   - Penetrating cast level (> blockThreshold) → not filtered
   - Uses existing `isProtectedByGoI()` for the actual block check
2. **Each of the 5 spells** calls the helper after `consumeSpellSlot()` (which gives the actual `slotLevel`), then iterates `effectiveTargets` instead of `targets`.
3. **Cast log** includes `"(N excluded by Globe of Invulnerability)"` when any target was excluded.
4. **Spell still fires** (slot consumed, action used, log emitted); only protected targets are skipped — matching PHB p.245.
5. **Thunderwave push** is also blocked (target isn't in the loop, so no push either) — matching PHB p.245: *"the spell has no effect on them."*

**Metadata:**
- `globeOfInvulnerabilityAoEV1Simplified` remains `true` (only 5 of ~30 AoE spells covered)
- New flag `globeOfInvulnerabilityAoEPartialV1Implemented: true` documents the partial coverage state

### Tests

**New file:** `src/test/session77_goi_aoe_exclusion.test.ts` — **48 assertions, 0 failures**

- Phase 1 (9 tests): `filterGoIProtectedTargets` unit tests — no GoI / 1 GoI / all GoI / caster self / cantrip / penetrating / empty / non-GoI shield / upcast GoI
- Phase 2 (3 tests): Fireball integration — exclusion, L6 penetration, no-regression
- Phase 3 (1 test): Lightning Bolt exclusion
- Phase 4 (1 test): Shatter exclusion
- Phase 5 (1 test + push verification): Thunderwave exclusion (damage + push blocked)
- Phase 6 (1 test): Burning Hands exclusion
- Phase 7 (1 test): Cantrip AoE not blocked by GoI
- Phase 8 (3 tests): Edge cases — self-GoI, multi-GoI, metadata flag regression

### No regressions

All 11 affected test files pass:
- fireball: 34/34 ✅
- lightning_bolt: 38/38 ✅
- shatter: 108/108 ✅
- thunderwave: 25/25 ✅
- burning_hands: 33/33 ✅
- session72_upcasting_system: 77/77 ✅
- upcasting_p1: 21/21 ✅
- combat: 49/49 ✅
- dispel_magic: 47/47 ✅
- counterspell: 35/35 ✅
- session77_goi_aoe_exclusion: 48/48 ✅ (new)

**Total: 515 assertions, 0 failures.**

## TEST STATUS

- `session77_goi_aoe_exclusion.test.ts`: 48/48 ✅ (NEW)
- `upcasting_p1.test.ts`: 21/21 ✅
- `session72_upcasting_system.test.ts`: 77/77 ✅
- `combat.test.ts`: 49/49 ✅
- `fireball.test.ts`: 34/34 ✅
- `lightning_bolt.test.ts`: 38/38 ✅
- `shatter.test.ts`: 108/108 ✅
- `thunderwave.test.ts`: 25/25 ✅
- `burning_hands.test.ts`: 33/33 ✅
- `dispel_magic.test.ts`: 47/47 ✅
- `counterspell.test.ts`: 35/35 ✅

## TSC STATUS

`bunx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this commit.**

The 5 pre-existing errors are:
- `src/engine/combat.ts(2579,23)` and `(2599,13)` — `Record<string, unknown>` cast on Combatant (pre-existing, documented in Session 72 handover)
- `src/engine/utils.ts(601,6)` — same pattern
- `src/test/monster_spellcasting.test.ts(602,48)` and `(609,51)` — `lich.monsterSpellSlots` possibly undefined (test file; test runner uses `--transpile-only` so these don't fail tests)

## CI STATUS

- Pushed commit `5f9cd30` to `origin/main` at 16:57 UTC
- 7 check-runs started (6-chunk CI matrix + 1 aggregate)
- Status at handover write time: **in progress** (just pushed)
- See "Verify CI green" section below — agent should re-check before considering work complete

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. Verify CI green on `5f9cd30`

Check https://github.com/mcabel/dnd-combat-sim/commit/5f9cd30 — all 7 check-runs should reach `conclusion: success`. If any check fails, see "CI failure recovery" below.

### 2. Extend GoI AoE exclusion to remaining damage AoE spells (LOW risk)

The 5 spells covered this session are the most common, but ~10 more damage AoE spells still bypass GoI:

- `arms_of_hadar.ts` (L1)
- `hunger_of_hadar.ts` (L3) — persistent damage zone
- `call_lightning.ts` (L3) — persistent damage zone
- `cloud_of_daggers.ts` (L2) — persistent damage zone
- `flaming_sphere.ts` (L2) — persistent damage zone
- `ice_knife.ts` (L1) — initial + shatter
- `spirit_guardians.ts` (L3) — persistent aura
- `guardian_of_faith.ts` (4) — persistent aura
- `dawn.ts` (5) — persistent damage zone
- `sunburst.ts` (8)
- `tidal_wave.ts` (3)
- `stinking_cloud.ts` (3) — non-damage but conditions apply

Pattern to apply: same `filterGoIProtectedTargets(inCone/targets, slotLevel, caster.id)` after `consumeSpellSlot()` call. For persistent damage zones (`damage_zone` effect type), the GoI check should run on each per-tick damage application (in `combat.ts` runCombat start-of-tick loop), not just on the initial cast.

Once all are covered, flip `globeOfInvulnerabilityAoEV1Simplified: false` and remove `globeOfInvulnerabilityAoEPartialV1Implemented`.

### 3. GoI v1 follow-up #2: 10-ft radius (MEDIUM risk)

Currently GoI only protects the caster. PHB p.245: 10-ft radius around the caster. Requires spatial query (chebyshev3D ≤ 2 cells). Apply the same `isProtectedByGoI()` check but for any ally within 10 ft of the GoI caster. Needs a helper `isProtectedByGoIRadius(target, bf, castLevel)` that scans for nearby GoI casters.

### 4. GoI v1 follow-up #3: Eldritch Blast multi-beam (MEDIUM-HIGH risk)

Eldritch Blast currently scales as single-beam damage dice (via `cantripTier`). Per PHB p.237, it should fire 1/2/3/4 beams at levels 1/5/11/17, each an independent attack roll. Requires multi-attack dispatch in `combat.ts`. Already deferred via `eldritchBlastMultiBeamV1Deferred: true`.

### 5. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged from Session 72

Daily-use abilities: Recharge (Dragon Breath 5-6), Lair Actions (initiative 20), Legendary Actions (partially implemented). Phase 4 (bespoke dispatch for ~267 spells) was just completed in commit `819bc0b` (Session 75-76).

### 6. Ready Action implementation (MEDIUM-HIGH risk) — unchanged

Currently a STUB in `combat.ts` — the `case 'ready':` falls through.

### 7. RFC-COMBINING-EFFECTS Phase 2 remaining (MEDIUM risk) — unchanged

Some non-concentration spell modules still need `sourceTurnExpires` populated.

## CI FAILURE RECOVERY

If `5f9cd30` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API:
   ```
   curl -H "Authorization: token $PAT" \
     "https://api.github.com/repos/mcabel/dnd-combat-sim/commits/5f9cd30/check-runs" \
     | jq '.check_runs[] | select(.conclusion != "success") | {name, conclusion, html_url}'
   ```
2. **Most likely failure mode:** a test file that wasn't in my regression sweep sets up an AoE spell hitting a GoI-protected target and expects the target to take damage. The fix would be to update that test to reflect the new PHB-correct behavior (or, if the test was checking something else entirely, ensure my filter is properly gated).
3. **Second likely failure:** a tsc error from one of my 5 edited spell files (e.g. import path issue). Verify with `bunx tsc --noEmit 2>&1 | grep -E '(fireball|lightning_bolt|burning_hands|shatter|thunderwave|spell_effects)'` — should be empty.
4. **Fix forward** on a new commit; do NOT amend `5f9cd30` (preserves CI history).

## KEY FILES THIS SESSION

### Modified

- `src/engine/spell_effects.ts` — added `filterGoIProtectedTargets()` helper (~38 lines, after `isProtectedByGoI`)
- `src/spells/fireball.ts` — added import + 5-line filter block in `execute()`
- `src/spells/lightning_bolt.ts` — same pattern
- `src/spells/burning_hands.ts` — same pattern (filters `inCone` post-cone-filter)
- `src/spells/shatter.ts` — same pattern
- `src/spells/thunderwave.ts` — same pattern (also blocks push because target isn't in loop)
- `src/spells/globe_of_invulnerability.ts` — added `globeOfInvulnerabilityAoEPartialV1Implemented: true` flag; updated v1-simplification comment block

### New

- `src/test/session77_goi_aoe_exclusion.test.ts` — 48 assertions across 8 phases (helper unit tests + 5 spell integration tests + cantrip + edge cases)

## ARCHITECTURAL NOTES

### `filterGoIProtectedTargets` API design

The helper is **pure** (no side effects, no logging) by design. Each spell module owns its own logging. This makes the helper trivially testable and avoids coupling to `EngineState` (which `spell_effects.ts` doesn't import — keeps the dependency graph clean).

```typescript
export function filterGoIProtectedTargets(
  targets: Combatant[],
  castLevel: number,
  casterId: string,
): Combatant[]
```

The `casterId` parameter is critical: PHB p.245 says "cast from outside the barrier" — the GoI caster is at the center, so their own spells (even AoE that catches themselves, e.g. a friendly-fire Fireball) are NOT blocked. The `t.id === casterId` short-circuit handles this.

### Why `globeOfInvulnerabilityAoEV1Simplified` remains `true`

Honesty about partial state. Only 5 of ~30 AoE spells have exclusion. The new `globeOfInvulnerabilityAoEPartialV1Implemented: true` flag lets consumers detect "partial coverage" distinctly from "no coverage." Flip both flags when full coverage lands.

### Thunderwave push interaction

Thunderwave's `execute()` does damage AND push in the same loop iteration. By filtering the target out of the list BEFORE the loop, both effects are skipped — matching PHB p.245: *"the spell has no effect on them."* No special push-blocking code is needed.

### Burning Hands cone re-filter

Burning Hands already re-filters `targets` to `inCone` (cone shape check). The GoI filter applies AFTER the cone filter, so it operates only on targets actually in the cone. This is correct.

## VERIFICATION SNAPSHOT

- `git log --oneline -3`: `5f9cd30`, `819bc0b`, `1373baa`
- `git status` → clean working tree (after push)
- `bunx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- 11 affected test files all pass locally (515 assertions, 0 failures)
- CI status on `5f9cd30` at write time: **in progress** (just pushed)
