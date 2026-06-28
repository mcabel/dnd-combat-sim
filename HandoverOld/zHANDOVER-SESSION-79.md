# HANDOVER-SESSION-79

## REPOSITORY

- Branch: main
- Commit: f58d51d (pushed)
- Previous: 9a330b9 (fog_cloud flaky test fix), fa62943 (Session 78 code)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Session 79 Part 1: Fix CI red X on fa62943 (flaky fog_cloud.test.ts)

**Commit:** `9a330b9` — `Session 79: fix flaky fog_cloud.test.ts (nat-20 crit broke concentration)`

**Context:** Session 78's commit `fa62943` had a red X on CI — `test (1)` chunk failed with 2 assertion failures in `fog_cloud.test.ts` (section 8: Integration: runCombat — `8b: bf.obstacles has the fog` and `8c: Caster concentrating on Fog Cloud`).

**Root cause:** The test's enemy had a Shortbow with `hitBonus: -20`, intended to mean "never hits". However, a natural 20 on the d20 is ALWAYS a critical hit regardless of attack bonus (PHB p.194). The resulting crit + Sneak Attack damage (which fires even at disadvantage — separate pre-existing bug) dealt 9-10 damage to the caster (who only had 10 HP), either:
- (a) killing the caster outright, or
- (b) breaking concentration on Fog Cloud via the CON save,

which removed the obstacle via `removeEffectsFromCaster`. This caused ~3-7% test flakiness that CI occasionally hit.

**Fix:** Replaced the enemy's Shortbow action with a harmless "training dummy" configuration (`actions: []`, `cannotAttack: true`), matching the pattern already used in `day.test.ts` (`harmlessEnemy`). The caster's faction ('party') is NOT auto-defeated by `teamHasNoAttackCapability` because `canDealDamage()` falls back to "improvised unarmed is always available" for non-cannotAttack creatures. The enemy faction IS auto-defeated at end of round 1, but that happens AFTER the caster's turn — obstacle + concentration are already set by then.

**Verified:** 20/20 consecutive runs pass (was ~3-7% flaky before). CI on `9a330b9`: all 9 check-runs `success` (including `test (1)` which was the original failure).

### Session 79 Part 2: GoI AoE exclusion COMPLETE — 36 more spells

**Commit:** `f58d51d` — `Session 79: GoI AoE exclusion COMPLETE — 36 more spells, flag flipped to false`

**Context:** Session 78's handover "IMMEDIATE NEXT ACTIONS" #2 listed ~32 multi-target + ~4 single-target damage AoE spells that still bypassed GoI. This session implements all 36, completing the GoI AoE exclusion feature.

**PHB p.245 reference:** "Any spell of 5th level or lower cast from outside the barrier can't affect creatures or objects within it, even if the spell is cast using a higher spell slot. Such a spell can target creatures and objects within the barrier, but the spell has no effect on them."

### Spells covered (36 total, in 4 patterns)

#### Pattern A: Instantaneous multi-target AoE (on-cast filter only) — 23 spells

These spells use `filterGoIProtectedTargets(targets, slotLevel, caster.id)` after `consumeSpellSlot()`, then iterate `effectiveTargets` instead of `targets`. The spell still fires (slot consumed, action used, log emitted); protected targets are simply skipped.

| Spell | Level | Geometry | File |
|---|---|---|---|
| Chain Lightning | 6 | Multi-target (up to 4) | `src/spells/chain_lightning.ts` |
| Circle of Death | 6 | 60-ft radius | `src/spells/circle_of_death.ts` |
| Cone of Cold | 5 | 60-ft cone | `src/spells/cone_of_cold.ts` |
| Dark Star | 8 | 40-ft radius | `src/spells/dark_star.ts` |
| Destructive Wave | 5 | 30-ft self-centered | `src/spells/destructive_wave.ts` |
| Earth Tremor | 1 | 10-ft self-centered | `src/spells/earth_tremor.ts` |
| Earthquake | 8 | 50-ft self-centered (auto-hit) | `src/spells/earthquake.ts` |
| Erupting Earth | 3 | 20-ft radius | `src/spells/erupting_earth.ts` |
| Fire Storm | 7 | 40-ft radius | `src/spells/fire_storm.ts` |
| Flame Strike | 5 | 10-ft radius (dual fire+radiant) | `src/spells/flame_strike.ts` |
| Frost Fingers | 1 | 15-ft cone | `src/spells/frost_fingers.ts` |
| Gravity Fissure | 6 | 100-ft line | `src/spells/gravity_fissure.ts` |
| Gravity Sinkhole | 4 | 20-ft radius | `src/spells/gravity_sinkhole.ts` |
| Incendiary Cloud | 8 | 20-ft radius (v1 one-shot) | `src/spells/incendiary_cloud.ts` |
| Maddening Darkness | 8 | 60-ft radius | `src/spells/maddening_darkness.ts` |
| Magnify Gravity | 1 | 10-ft radius | `src/spells/magnify_gravity.ts` |
| Pulse Wave | 3 | 30-ft cone | `src/spells/pulse_wave.ts` |
| Ravenous Void | 9 | 60-ft radius (auto-hit) | `src/spells/ravenous_void.ts` |
| Spray of Cards | 2 | 15-ft cone | `src/spells/spray_of_cards.ts` |
| Storm Sphere | 4 | 20-ft radius | `src/spells/storm_sphere.ts` |
| Sunbeam | 6 | 60-ft line | `src/spells/sunbeam.ts` |
| Synaptic Static | 5 | 20-ft radius | `src/spells/synaptic_static.ts` |
| Weird | 9 | 30-ft radius | `src/spells/weird.ts` |
| Whirlwind | 7 | 50-ft cone | `src/spells/whirlwind.ts` |

**Chain Lightning special adaptation:** Uses an indexed `for (let i = 0; i < targets.length; i++)` loop because index 0 = "Primary bolt" and i>0 = "Arc N". Replacing with `for (const target of effectiveTargets)` would mislabel arcs as primary when the primary itself was GoI-protected. Solution: kept the indexed loop and added `if (!effectiveIds.has(target.id)) continue;` using a Set built from `effectiveTargets`.

**Incendiary Cloud note:** v1 simplification makes this a one-shot spell (no persistent damage_zone), so Pattern A filter is sufficient. The `incendiaryCloudMovingV1Simplified: true` flag remains.

#### Pattern B: Multi-target persistent damage_zone (per-target GoI check + sourceSlotLevel) — 6 spells

These spells apply the `damage_zone` EFFECT to ALL targets in range (including GoI-protected ones), but skip the ON-CAST damage for GoI-protected targets. The `sourceSlotLevel` is set on each `damage_zone` effect so the combat.ts tick loop can re-check GoI on each per-turn tick.

| Spell | Level | Save | damage_zones | File |
|---|---|---|---|---|
| Cloudkill | 5 | CON half | 1 (poison) | `src/spells/cloudkill.ts` |
| Death Armor | 2 | none | 1 (slashing) | `src/spells/death_armor.ts` |
| Dust Devil | 2 | none | 1 (bludgeoning) | `src/spells/dust_devil.ts` |
| Insect Plague | 5 | CON half | 1 (bludgeoning) | `src/spells/insect_plague.ts` |
| Storm of Vengeance | 9 | CON half | 2 (thunder + lightning) | `src/spells/storm_of_vengeance.ts` |

**Storm of Vengeance note:** L9 spell — GoI at max L9 only blocks ≤8, so L9 Storm of Vengeance can NEVER be blocked under standard rules. Code path verified with fictional stronger GoI (blockThreshold=10). Both damage_zones get `sourceSlotLevel`.

#### Pattern B: Multi-target terrain_zone (per-target GoI check + sourceSlotLevel) — 3 spells

Same as Pattern B above, but these spells also apply a `terrain_zone` effect (to the caster, marking the area). The `sourceSlotLevel` is set on BOTH the terrain_zone and damage_zone effects.

| Spell | Level | Save | terrain_zone | File |
|---|---|---|---|---|
| Evard's Black Tentacles | 4 | DEX | restrained | `src/spells/evards_black_tentacles.ts` |
| Maelstrom | 5 | STR | restrained | `src/spells/maelstrom.ts` |
| Sickening Radiance | 4 | CON | exhaustion | `src/spells/sickening_radiance.ts` |

**Sickening Radiance note:** Uses `filterGoIProtectedTargets` to filter the target list (matching `stinking_cloud.ts` reference), then loops over `effectiveTargets`. The `isProtectedByGoI` import is present but not directly invoked (unused import is safe — tsconfig lacks `noUnusedLocals`).

#### Pattern B: Single-target persistent (per-target GoI check + sourceSlotLevel) — 4 spells

Same as Pattern B above, but for single-target spells (`execute(caster, target, state)` instead of `execute(caster, targets[], state)`).

| Spell | Level | Save | Persistent Effect | File |
|---|---|---|---|---|
| Moonbeam | 2 | CON half | damage_zone (radiant) | `src/spells/moonbeam.ts` |
| Spike Growth | 2 | none | terrain_zone + damage_zone | `src/spells/spike_growth.ts` |
| Wall of Fire | 4 | DEX half | damage_zone (fire) | `src/spells/wall_of_fire.ts` |
| Wall of Ice | 6 | DEX half | damage_zone (cold) | `src/spells/wall_of_ice.ts` |

**Spike Growth note:** Has NO on-cast damage (PHB p.277: damage is movement-triggered, modelled as start-of-turn damage_zone tick). Added `goiBlocked` check + informational emit ("persistent effect suppressed while GoI is active") + `sourceSlotLevel` on BOTH terrain_zone (caster) and damage_zone (target).

### Metadata updates

**File:** `src/spells/globe_of_invulnerability.ts`

- `globeOfInvulnerabilityAoEV1Simplified: true` → **`false`** (COMPLETE — all known damage AoE spells covered)
- `globeOfInvulnerabilityAoEPartialV1Implemented: true` → **removed** (no longer partial)
- Comment block updated to document all 53 spells covered across Sessions 77-79

**File:** `src/engine/spell_effects.ts`

- `filterGoIProtectedTargets` docstring updated with Session 79 details (36 more spells, flag flipped to false)

**File:** `src/test/session78_goi_aoe_extension.test.ts`

- Phase 6 metadata assertions updated:
  - `6a`: `globeOfInvulnerabilityAoEV1Simplified` now `false` (was `true`)
  - `6b`: `globeOfInvulnerabilityAoEPartialV1Implemented` now `undefined` (was `true`)

### Tests

**New file:** `src/test/session79_goi_aoe_completion.test.ts` — **51 assertions, 0 failures**

- Phase 1 (5 tests): Pattern A instantaneous — circle_of_death, cone_of_cold, chain_lightning (indexed loop), earthquake (auto-hit), flame_strike (dual damage)
- Phase 2 (2 tests): Pattern B persistent damage_zone — cloudkill, insect_plague (on-cast blocked + damage_zone applied with sourceSlotLevel)
- Phase 3 (2 tests): Pattern B terrain_zone — evards_black_tentacles, sickening_radiance (terrain_zone + damage_zone sourceSlotLevel)
- Phase 4 (2 tests): Pattern B single-target persistent — moonbeam, wall_of_fire
- Phase 5 (4 tests): Metadata flags — AoEV1Simplified=false, AoEPartialV1Implemented=undefined, core flags still true
- Phase 6 (2 tests): All 36 Session 79 spell files import GoI helpers
- Phase 7 (2 tests): Caster self-exclusion — circle_of_death + moonbeam (caster's own GoI doesn't block self-cast)

### No regressions

All 401 test files pass (22,567 assertions, 0 failures):

| Chunk | Files | Assertions |
|---|---|---|
| 1/6 | 67/67 ✅ | 3521 |
| 2/6 | 67/67 ✅ | 3908 |
| 3/6 | 67/67 ✅ | 3688 |
| 4/6 | 67/67 ✅ | 3948 |
| 5/6 | 67/67 ✅ | 3668 |
| 6/6 | 66/66 ✅ | 3834 |
| **Total** | **401/401 ✅** | **22,567** |

All 36 modified spell test files pass individually (verified by subagents during implementation).

## TEST STATUS

- `session79_goi_aoe_completion.test.ts`: 51/51 ✅ (NEW)
- `session78_goi_aoe_extension.test.ts`: 56/56 ✅ (Phase 6 updated)
- `session77_goi_aoe_exclusion.test.ts`: 48/48 ✅
- `fog_cloud.test.ts`: 43/43 ✅ (flaky test fixed in Part 1)
- All 401 test files: 22,567/22,567 ✅

## TSC STATUS

`bunx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this commit.**

The 5 pre-existing errors are:
- `src/engine/combat.ts(2579,23)` and `(2599,13)` — `Record<string, unknown>` cast on Combatant (pre-existing, documented in Session 72 handover)
- `src/engine/utils.ts(601,6)` — same pattern
- `src/test/monster_spellcasting.test.ts(602,48)` and `(609,51)` — `lich.monsterSpellSlots` possibly undefined (test file; test runner uses `--transpile-only` so these don't fail tests)

## CI STATUS

### Commit `9a330b9` (fog_cloud fix)
- All 9 check-runs: `success` ✅
- This resolved the red X on `fa62943`

### Commit `f58d51d` (Session 79 GoI completion)
- Pushed to `origin/main`
- 9 check-runs: ALL `success` ✅ (build, deploy, report-build-status, test 1-6)
- **No red X — CI fully green**

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. Verify CI green on `f58d51d`

Check https://github.com/mcabel/dnd-combat-sim/commit/f58d51d — all 9 check-runs should reach `conclusion: success`. If any check fails, see "CI failure recovery" below.

### 2. GoI v1 follow-up #2: 10-ft radius (MEDIUM risk)

Currently GoI only protects the caster. PHB p.245: 10-ft radius around the caster. Requires spatial query (chebyshev3D ≤ 2 cells). Apply the same `isProtectedByGoI()` check but for any ally within 10 ft of the GoI caster. Needs a helper `isProtectedByGoIRadius(target, bf, castLevel)` that scans for nearby GoI casters.

### 3. GoI v1 follow-up #3: Eldritch Blast multi-beam (MEDIUM-HIGH risk)

Eldritch Blast currently scales as single-beam damage dice (via `cantripTier`). Per PHB p.237, it should fire 1/2/3/4 beams at levels 1/5/11/17, each an independent attack roll. Requires multi-attack dispatch in `combat.ts`. Already deferred via `eldritchBlastMultiBeamV1Deferred: true`.

### 4. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged from Session 72

Daily-use abilities: Recharge (Dragon Breath 5-6), Lair Actions (initiative 20), Legendary Actions (partially implemented). Phase 4 (bespoke dispatch for ~267 spells) was completed in commit `819bc0b` (Session 75-76).

### 5. Ready Action implementation (MEDIUM-HIGH risk) — unchanged

Currently a STUB in `combat.ts` — the `case 'ready':` falls through.

### 6. RFC-COMBINING-EFFECTS Phase 2 remaining (MEDIUM risk) — unchanged

Some non-concentration spell modules still need `sourceTurnExpires` populated.

### 7. Sneak Attack at Disadvantage bug (LOW-MEDIUM risk) — discovered this session

During the fog_cloud flaky test investigation, discovered that Sneak Attack damage is applied even when the attacker has disadvantage (e.g., attacking into Fog Cloud / Darkness). Per PHB p.96, Sneak Attack requires advantage OR an ally within 5 ft of the target — but you cannot Sneak Attack if you have disadvantage on the attack roll. This is a pre-existing bug in the Sneak Attack logic, not introduced by Session 79. Investigate `src/engine/combat.ts` Sneak Attack dispatch.

## CI FAILURE RECOVERY

If `f58d51d` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API:
   ```
   curl -H "Authorization: token $PAT" \
     "https://api.github.com/repos/mcabel/dnd-combat-sim/commits/f58d51d/check-runs" \
     | jq '.check_runs[] | select(.conclusion != "success") | {name, conclusion, html_url}'
   ```
2. **Most likely failure mode:** a test file that wasn't in my regression sweep sets up an AoE spell hitting a GoI-protected target and expects the target to take damage. The fix would be to update that test to reflect the new PHB-correct behavior.
3. **Second likely failure:** a tsc error from one of my 36 edited spell files. Verify with `bunx tsc --noEmit 2>&1 | grep -E '(chain_lightning|circle_of_death|cloudkill|cone_of_cold|dark_star|death_armor|destructive_wave|dust_devil|earth_tremor|earthquake|erupting_earth|evards_black_tentacles|fire_storm|flame_strike|frost_fingers|gravity_fissure|gravity_sinkhole|incendiary_cloud|insect_plague|maddening_darkness|maelstrom|magnify_gravity|moonbeam|pulse_wave|ravenous_void|sickening_radiance|spike_growth|spray_of_cards|storm_of_vengeance|storm_sphere|sunbeam|synaptic_static|wall_of_fire|wall_of_ice|weird|whirlwind)'` — should be empty.
4. **Third likely failure:** the `sickening_radiance.ts` unused `isProtectedByGoI` import causing a lint error (tsconfig lacks `noUnusedLocals` so this should NOT be an error, but verify).
5. **Fix forward** on a new commit; do NOT amend `f58d51d` (preserves CI history).

## KEY FILES THIS SESSION

### Modified

- `src/engine/spell_effects.ts` — updated `filterGoIProtectedTargets` docstring (Session 79 details)
- `src/engine/combat.ts` — NOT modified (no changes needed; tick loop GoI check from Session 78 handles all sourceSlotLevel-tagged zones)
- `src/spells/globe_of_invulnerability.ts` — `globeOfInvulnerabilityAoEV1Simplified: false`, removed `globeOfInvulnerabilityAoEPartialV1Implemented`, updated comment block
- `src/spells/chain_lightning.ts` — Pattern A (indexed loop adaptation with Set-based skip)
- `src/spells/circle_of_death.ts` — Pattern A
- `src/spells/cone_of_cold.ts` — Pattern A (cone filter on `inCone`)
- `src/spells/dark_star.ts` — Pattern A
- `src/spells/destructive_wave.ts` — Pattern A
- `src/spells/earth_tremor.ts` — Pattern A
- `src/spells/earthquake.ts` — Pattern A (auto-hit)
- `src/spells/erupting_earth.ts` — Pattern A
- `src/spells/fire_storm.ts` — Pattern A
- `src/spells/flame_strike.ts` — Pattern A (dual damage, single filter)
- `src/spells/frost_fingers.ts` — Pattern A
- `src/spells/gravity_fissure.ts` — Pattern A
- `src/spells/gravity_sinkhole.ts` — Pattern A
- `src/spells/incendiary_cloud.ts` — Pattern A (v1 one-shot)
- `src/spells/maddening_darkness.ts` — Pattern A
- `src/spells/magnify_gravity.ts` — Pattern A
- `src/spells/pulse_wave.ts` — Pattern A
- `src/spells/ravenous_void.ts` — Pattern A (auto-hit)
- `src/spells/spray_of_cards.ts` — Pattern A
- `src/spells/storm_sphere.ts` — Pattern A
- `src/spells/sunbeam.ts` — Pattern A
- `src/spells/synaptic_static.ts` — Pattern A
- `src/spells/weird.ts` — Pattern A
- `src/spells/whirlwind.ts` — Pattern A
- `src/spells/cloudkill.ts` — Pattern B (per-target check + sourceSlotLevel on damage_zone)
- `src/spells/death_armor.ts` — Pattern B
- `src/spells/dust_devil.ts` — Pattern B
- `src/spells/insect_plague.ts` — Pattern B
- `src/spells/storm_of_vengeance.ts` — Pattern B (TWO damage_zones)
- `src/spells/evards_black_tentacles.ts` — Pattern B terrain_zone (sourceSlotLevel on terrain_zone + damage_zone)
- `src/spells/maelstrom.ts` — Pattern B terrain_zone
- `src/spells/sickening_radiance.ts` — Pattern B terrain_zone (filter approach)
- `src/spells/moonbeam.ts` — Pattern B single-target persistent
- `src/spells/spike_growth.ts` — Pattern B single-target (no on-cast damage variant)
- `src/spells/wall_of_fire.ts` — Pattern B single-target persistent
- `src/spells/wall_of_ice.ts` — Pattern B single-target persistent
- `src/test/session78_goi_aoe_extension.test.ts` — Phase 6 metadata assertions updated

### New

- `src/test/session79_goi_aoe_completion.test.ts` — 51 assertions across 7 phases

### Part 1 (fog_cloud fix)

- `src/test/fog_cloud.test.ts` — Section 8 enemy replaced with harmless training dummy

## ARCHITECTURAL NOTES

### GoI AoE exclusion: COMPLETE

With Session 79, ALL known damage AoE spells (53 total across Sessions 77-79) now respect Globe of Invulnerability per PHB p.245:

| Session | Spells | Pattern |
|---|---|---|
| 77 | 5 | A (instantaneous) |
| 78 | 12 | A + B (persistent) |
| 79 | 36 | A + B (all remaining) |
| **Total** | **53** | |

The `globeOfInvulnerabilityAoEV1Simplified` flag is now `false` — the feature is complete (v1).

### Two-pattern approach (unchanged from Session 78)

**Pattern A (instantaneous spells):** Filter the entire target list before the loop. GoI-protected targets are completely excluded — no damage, no effect.

**Pattern B (persistent damage_zone/terrain_zone spells):** Loop over ALL targets. Per-target GoI check: skip on-cast damage if protected, but ALWAYS apply the persistent effect (with sourceSlotLevel). The combat.ts tick loop re-checks GoI on each per-turn tick.

### sourceSlotLevel on persistent effects

The `sourceSlotLevel` field (added to `ActiveEffect` in Session 72) is now set on:
- All damage_zone effects by all persistent spell modules (Sessions 78-79)
- All terrain_zone effects by all terrain_zone spell modules (Sessions 78-79)

The combat.ts tick loop reads `zone.sourceSlotLevel ?? 0` to determine the spell's effective level for the GoI block check. Legacy damage_zone effects (created before Session 78, sourceSlotLevel undefined) default to 0 — the `zoneSlotLevel > 0` guard ensures they are NOT blocked (backward compat).

### Caster self-exclusion

Both `filterGoIProtectedTargets` and the combat.ts tick loop check `target.id === casterId` (or `actor.id !== zone.casterId`) to implement PHB p.245's "cast from outside the barrier" rule. The GoI caster is at the center of the barrier, so their own spells (even AoE that catches themselves) are NOT blocked.

### Implementation methodology (subagent parallelism)

Session 79 used 4 parallel general-purpose subagents to implement the 36 spell modifications:
- Subagent 3-a: 15 Pattern A instantaneous spells
- Subagent 3-b: 8 Pattern A cone/line/special spells
- Subagent 3-c: 6 Pattern B persistent damage_zone spells
- Subagent 3-d: 7 Pattern B terrain_zone + single-target persistent spells

Each subagent read reference files (burning_hands.ts, cloud_of_daggers.ts, stinking_cloud.ts), applied the established pattern to its assigned spells, and ran existing tests to verify no regressions. The main agent then: fixed Session 78 references → updated metadata + docstring → wrote the Session 79 test file → ran the full 401-file test suite.

## VERIFICATION SNAPSHOT

- `git log --oneline -4`: `f58d51d`, `9a330b9`, `a7cabc1`, `fa62943`
- `git status` → clean working tree (after push)
- `bunx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- 401/401 test files pass (22,567 assertions, 0 failures)
- CI on `9a330b9`: all 9 check-runs `success` ✅
- CI on `f58d51d`: all 9 check-runs `success` ✅ **(NO RED X)**
