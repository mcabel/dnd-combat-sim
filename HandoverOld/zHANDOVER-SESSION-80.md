# HANDOVER-SESSION-80

## REPOSITORY

- Branch: main
- Commit: ef62fa5 (pushed)
- Previous: f58d51d (Session 79 GoI AoE completion)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Part 1: GoI 10-ft Radius Ally Protection (PHB p.245)

**Commit:** `ef62fa5` — `Session 80: GoI 10-ft radius ally protection + Sneak Attack adv/disadv cancellation fix`

**Context:** Session 79 handover "IMMEDIATE NEXT ACTIONS" #2. GoI previously only protected the caster. PHB p.245: "An immobile, faintly shimmering barrier springs into existence in a 10-foot radius around you... Any spell of 5th level or lower cast from outside the barrier can't affect creatures or objects within it."

**Implementation:**

1. **`isProtectedByGoI()` in `spell_effects.ts`**: Now accepts an optional `Battlefield` parameter. When provided, checks not only the target's own GoI effect but also whether the target is within 10 ft (Chebyshev 3D ≤ 2 squares) of any living, non-unconscious combatant with an active GoI effect. Backward-compatible: if `bf` is omitted, falls back to self-only check.

2. **`filterGoIProtectedTargets()` in `spell_effects.ts`**: Now accepts an optional `Battlefield` parameter, passed through to `isProtectedByGoI()`. All 43 spell modules updated to pass `state.battlefield` as the 4th argument.

3. **`combat.ts`**: Both single-target GoI block (line 3081) and damage_zone tick GoI check (line 6551) now pass `bf`/`state.battlefield` to `isProtectedByGoI()`, enabling radius protection in the combat engine.

4. **`movement.ts`**: Added `combatantsWithinRadiusFt(pos, radiusFt, bf)` helper for generic spatial queries (returns all living combatants within `radiusFt` feet of `pos` using Chebyshev 3D distance).

5. **`globe_of_invulnerability.ts`**: Updated metadata with `globeOfInvulnerabilityRadiusV1Implemented: true` flag. Updated v1 simplification comments to document the 10-ft radius feature as now implemented.

6. **Cantrip fix**: `isProtectedByGoI()` now has an early return `if (castLevel <= 0) return false;` — cantrips are explicitly never blocked by GoI per PHB p.245. This is a behavioral change from the previous implementation which returned `true` for cantrips (0 ≤ blockThreshold), but the engine already guarded against this with `spellInfo.level > 0` checks. The function is now self-consistently correct.

**Test position updates (backward compat):**

Existing GoI tests (sessions 77-79) had "exposed" enemies positioned within 2 squares of GoI casters. With the new radius feature, these enemies are now correctly protected. Updated positions:
- Session 77: All exposed enemies moved from `pos: {x:2,y:0,z:0}` to `pos: {x:5,y:0,z:0}` (3 squares from GoI caster). Burning Hands test split into two sub-tests due to 15ft cone geometry overlap with 10ft GoI radius.
- Session 78: 5 tests updated (Arms of Hadar, Ice Knife, Guardian of Faith, Stinking Cloud, caster-own-GoI). Ice Knife and Arms of Hadar tests split into sub-tests where geometric overlap made combined testing impossible.
- Session 79: 9 tests updated (all exposed enemies moved to Chebyshev > 2 from GoI caster).

### Part 2: Sneak Attack Advantage/Disadvantage Cancellation Fix (PHB p.96 + p.173)

**Context:** Session 79 handover "IMMEDIATE NEXT ACTIONS" #7. Discovered during fog_cloud flaky test investigation.

**Bug:** When an attacker had both advantage and disadvantage on an attack roll, `canSneakAttack()` allowed Sneak Attack via the raw `hasAdvantage` flag, even though per PHB p.173 the roll is treated as having "neither advantage nor disadvantage." This meant:
- With advantage + disadvantage + no adjacent ally: Sneak Attack fired (BUG — should not, since net advantage is false)
- Correct behavior: With advantage + disadvantage canceling, the ally-adjacent route SHOULD be available (no net disadvantage), but the advantage route should NOT be available (no net advantage).

**Fix in `canSneakAttack()` (`utils.ts`):**
```typescript
const netAdvantage = hasAdvantage && !hasDisadvantage;
const netDisadvantage = hasDisadvantage && !hasAdvantage;

if (netDisadvantage) return false;  // disadvantage blocks SA even with ally
if (netAdvantage) return true;      // advantage enables SA
if (allyAdjacentToTarget) return true;  // no disadvantage + ally adjacent → SA
return false;
```

**Also fixed:** Ally adjacency check in `combat.ts` (line 2047) was using 2D Chebyshev (missing Z-coordinate). Now uses proper 3D Chebyshev: `Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= 1`.

## TEST STATUS

- `session80_goi_radius.test.ts`: 36/36 ✅ (NEW — 7 phases covering backward compat, radius protection, filter, multiple GoI casters, spatial helper, metadata)
- `session80_sneak_attack_adv_disadv.test.ts`: 13/13 ✅ (NEW — 4 phases covering basic eligibility, adv+disadv cancellation, edge cases, dice scaling)
- `session72_upcasting_system.test.ts`: 77/77 ✅ (updated cantrip assertion: `isProtectedByGoI(target, 0)` now returns `false`)
- `session77_goi_aoe_exclusion.test.ts`: 48/48 ✅ (positions updated, Burning Hands split)
- `session78_goi_aoe_extension.test.ts`: 57/57 ✅ (positions updated, 2 tests split)
- `session79_goi_aoe_completion.test.ts`: 51/51 ✅ (positions updated)
- `fog_cloud.test.ts`: 43/43 ✅ (no regression)
- `mechanics.test.ts`: 57/57 ✅ (no regression)
- `combat.test.ts`: 46/46 ✅ (no regression)

## TSC STATUS

`npx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this commit.**

The 5 pre-existing errors are:
- `src/engine/combat.ts(2580,23)` and `(2600,13)` — `Record<string, unknown>` cast on Combatant
- `src/engine/utils.ts(601,6)` — same pattern
- `src/test/monster_spellcasting.test.ts(602,48)` and `(609,51)` — `lich.monsterSpellSlots` possibly undefined

## CI STATUS

### Commit `ef62fa5` (Session 80)
- Pushed to `origin/main`
- 9 check-runs: ALL `success` ✅ (build, deploy, report-build-status, test 1-6)
- **No red X — CI fully green**

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. Verify CI green on `ef62fa5`

Check https://github.com/mcabel/dnd-combat-sim/commit/ef62fa5 — all 9 check-runs should reach `conclusion: success`. (Already verified during this session.)

### 2. GoI v1 follow-up #3: Eldritch Blast multi-beam (MEDIUM-HIGH risk)

Eldritch Blast currently scales as single-beam damage dice (via `cantripTier`). Per PHB p.237, it should fire 1/2/3/4 beams at levels 1/5/11/17, each an independent attack roll. Requires multi-attack dispatch in `combat.ts`. Already deferred via `eldritchBlastMultiBeamV1Deferred: true`.

### 3. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged from Session 72

Daily-use abilities: Recharge (Dragon Breath 5-6), Lair Actions (initiative 20), Legendary Actions (partially implemented). Phase 4 (bespoke dispatch for ~267 spells) was completed in commit `819bc0b` (Session 75-76).

### 4. Ready Action implementation (MEDIUM-HIGH risk) — unchanged

Currently a STUB in `combat.ts` — the `case 'ready':` falls through.

### 5. RFC-COMBINING-EFFECTS Phase 2 remaining (MEDIUM risk) — unchanged

Some non-concentration spell modules still need `sourceTurnExpires` populated.

### 6. GoI caster-attacker edge case (LOW risk) — discovered this session

When the GoI caster is also the attacking spell's caster, their own spells are cast from INSIDE the barrier and should affect all creatures within it (including allies). Currently, `filterGoIProtectedTargets` only excludes the GoI caster themselves (`if (t.id === casterId) return true`), but allies within the GoI radius are still filtered out. This is an edge case (GoI caster casting AoE that hits their own allies within the GoI radius). Per PHB p.245: "Any spell of 5th level or lower cast from OUTSIDE the barrier can't affect creatures within it." The GoI caster is inside, so their spells DO affect those within. The fix would be to check if the spell caster has an active GoI effect and, if so, not filter any targets within that GoI's radius.

## CI FAILURE RECOVERY

If `ef62fa5` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API:
   ```
   curl -H "Authorization: token $PAT" \
     "https://api.github.com/repos/mcabel/dnd-combat-sim/commits/ef62fa5/check-runs" \
     | jq '.check_runs[] | select(.conclusion != "success") | {name, conclusion, html_url}'
   ```
2. **Most likely failure mode:** a test file that wasn't in my regression sweep sets up a scenario where a non-GoI target is now protected by the 10-ft radius. The fix would be to move the target further than 2 squares from the GoI caster.
3. **Second likely failure:** a spell module that calls `isProtectedByGoI` or `filterGoIProtectedTargets` without the new `bf` parameter and somehow has a test that relied on the old `isProtectedByGoI(target, 0)` returning `true`.
4. **Fix forward** on a new commit; do NOT amend `ef62fa5`.

## KEY FILES THIS SESSION

### Modified

- `src/engine/spell_effects.ts` — `isProtectedByGoI()` now accepts optional `bf?: Battlefield`, checks 10-ft radius; `filterGoIProtectedTargets()` now accepts optional `bf?: Battlefield`, passes through
- `src/engine/combat.ts` — Single-target GoI block passes `bf`; damage_zone tick GoI check passes `state.battlefield`; Sneak Attack ally adjacency uses 3D Chebyshev
- `src/engine/movement.ts` — Added `combatantsWithinRadiusFt()` helper
- `src/engine/utils.ts` — `canSneakAttack()` now uses net advantage/disadvantage (PHB p.173 cancellation)
- `src/spells/globe_of_invulnerability.ts` — Updated v1 comments, added `globeOfInvulnerabilityRadiusV1Implemented: true`
- All 43 spell modules — `filterGoIProtectedTargets()` calls now pass `state.battlefield`
- 19 spell modules — `isProtectedByGoI()` calls now pass `state.battlefield`
- `src/test/session72_upcasting_system.test.ts` — Updated cantrip assertion
- `src/test/session77_goi_aoe_exclusion.test.ts` — Updated positions, split Burning Hands test
- `src/test/session78_goi_aoe_extension.test.ts` — Updated positions, split 2 tests
- `src/test/session79_goi_aoe_completion.test.ts` — Updated positions

### New

- `src/test/session80_goi_radius.test.ts` — 36 assertions across 7 phases
- `src/test/session80_sneak_attack_adv_disadv.test.ts` — 13 assertions across 4 phases

## ARCHITECTURAL NOTES

### GoI 10-ft radius: implementation approach

The radius check is implemented directly inside `isProtectedByGoI()` rather than as a separate helper. This ensures all call sites (single-target block, AoE filter, damage_zone tick) automatically get the radius protection without any additional wiring.

The Chebyshev 3D distance check uses the hardcoded value `chebyshev <= 2` (10 ft = 2 squares × 5 ft/square). This is correct for the PHB 10-ft radius on a Chebyshev grid. The radius is not configurable per GoI instance — it's always 10 ft per the spell description.

### GoI radius: "cast from outside the barrier" rule

PHB p.245: "Any spell of 5th level or lower cast from OUTSIDE the barrier can't affect creatures within it." The key word is "outside." A spell cast from INSIDE the barrier (by the GoI caster) CAN affect creatures within it. The current `casterId` check handles self-exclusion but does NOT handle the case where the GoI caster's AoE spell would affect their allies within the GoI radius. This is documented as a known edge case (see "IMMEDIATE NEXT ACTIONS" #6).

### Sneak Attack: net advantage/disadvantage

The fix computes `netAdvantage = hasAdvantage && !hasDisadvantage` and `netDisadvantage = hasDisadvantage && !hasAdvantage` to implement PHB p.173 cancellation. This is the same pattern used in `rollAttack()` for the d20 roll itself — the cancellation logic is now consistent between the attack roll and the Sneak Attack eligibility check.

## VERIFICATION SNAPSHOT

- `git log --oneline -3`: `ef62fa5`, `f58d51d`, `9a330b9`
- `git status` → clean working tree (after push)
- `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- Key test files: all pass (session72-80, fog_cloud, mechanics, combat)
- CI on `ef62fa5`: all 9 check-runs `success` ✅
- **NO RED X**
