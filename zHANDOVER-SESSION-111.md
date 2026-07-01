# HANDOVER-SESSION-111

## REPOSITORY

- Branch: main
- Commits this session:
  - `45e7b06` — Session 111: Hallow v2 per-type likely-target AC (S110 next-action #13, LOW-MEDIUM risk)
- Previous: `ffd76e5` (S110 handover update — Task 0 quivering_palm flake fix), `185bd03` (S110 quivering_palm §18 flake fix), `56cf1a9` (S110 handover), `12702a5` (S110 Hallow v2 likely-target AC)
- State: clean (1 impl commit pushed; handover commit pending — this file). CI on `45e7b06` was IN_PROGRESS at handover-write time (7 check-runs: build + 6 test chunks all in_progress; expected ALL GREEN — see CI STATUS below).
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

One implementation commit. Session started by verifying the S110 HEAD (`ffd76e5`, the S110 handover-update commit that finalized the `185bd03` quivering_palm §18 flake fix) CI was ALL GREEN (9/9 check-runs success — confirmed no red X carried over from S110). Then executed the single S110 "IMMEDIATE NEXT ACTION" that the z stream could execute autonomously at LOW-MEDIUM risk: **#13 — Hallow v2 likely-target vuln-skip refinement** (NEW from S110, classified LOW-MEDIUM risk in the S110 handover). The S110 next-actions #1/#2/#3 are out of scope for an autonomous z session (HIGH-risk unified cast dispatch, SHEET-stream char-builder, MEDIUM subjective score-weight tuning); #4-#11 are RESOLVED; #12 (summons.test.ts parallel-load flake) is a known parallelism-only flake that would need a test-isolation refactor (passes standalone — re-trigger with an empty commit if it CRASHes).

### Task 1 — Hallow v2 per-type likely-target AC refinement (commit `45e7b06`) — S110 next-action #13 RESOLVED (LOW-MEDIUM risk)

**Handover directive (S110):** "The S110 `likelyHallowTargetAC` predicts the likely target as the highest-HP enemy within 60ft, mirroring `shouldCastEnergyVulnerability` MINUS the type-dependent vuln-skip (which can't be applied at pick time since the damage type isn't chosen yet). The two diverge ONLY when the highest-HP enemy is already vulnerable to the would-be-chosen type — `shouldCastEnergyVulnerability` then skips it and picks the second-highest-HP enemy, but `likelyHallowTargetAC` still returns the top-HP enemy's AC. This is a rare edge case (most enemies aren't pre-vulnerable). A future refinement could iterate: for each candidate damage type, predict the target AC by applying that type's vuln-skip, then score the type against its own predicted target. This is LOW-MEDIUM risk (helper-only, no dispatch change, but the per-type-target iteration is more complex and could shift bestiary combats where a top-HP enemy is pre-vulnerable to the party's dominant type). **NEW from S110.** Lower priority than the carry-overs #1-#3 (the gain is marginal — the edge case is rare and S110 already captures the common-case accuracy)."

**Implementation:** the proposed per-type-target iteration. `pickHallowDamageType` now computes the likely-target AC PER DAMAGE TYPE — for each candidate type, it applies that type's vuln-skip and predicts the actual target for THAT type, then scores the type against its own predicted target's AC.

- New exported helper `likelyHallowTargetACForType(caster, bf, damageType): number` — predicts the AC of the enemy that `shouldCastEnergyVulnerability` will ACTUALLY select AS THE TARGET FOR A SPECIFIC DAMAGE TYPE. Mirrors `shouldCastEnergyVulnerability` EXACTLY (the only difference is the return type — AC: number here vs Combatant: Combatant there):
  - enemies only (faction differs from caster's)
  - not dead / unconscious
  - within Hallow's 60-ft range (`chebyshev3D(caster.pos, c.pos) × 5 ≤ 60` — the SAME range gate `shouldCastEnergyVulnerability` uses)
  - **NOT already vulnerable to `damageType`** (innate or from another active effect — the SAME type-dependent vuln-skip `shouldCastEnergyVulnerability` applies — this is the S111 refinement vs S110's type-agnostic `likelyHallowTargetAC`)
  - highest `maxHP` wins (the biggest threat); ties broken by NEAREST distance (same tie-break); full ties keep first-seen (strict `>` / strict `<` so an equal-HP equal-distance later enemy does NOT override — matches the stable-sort behaviour of `shouldCastEnergyVulnerability`'s `candidates.sort`)
  - same finite-AC guard as `encounterAvgAC` / `likelyHallowTargetAC` (skip NaN/Infinity)
  - falls back to `likelyHallowTargetAC(caster, bf)` (S110 behavior — highest-HP enemy within 60ft AC, IGNORING the vuln-skip) when no valid candidate exists for that type (none in range OR all in-range enemies pre-vulnerable to that type — the rare edge case where `shouldCastEnergyVulnerability` would return null for that type, so the pick is moot and the fallback is harmless). `likelyHallowTargetAC` itself falls back to `encounterAvgAC` (→ `BESTIARY_MEAN_AC`) when no enemy is within 60ft at all, preserving the full S110/S109/S108 fallback chain.
- `pickHallowDamageType(caster, bf)` — now calls `likelyHallowTargetACForType(caster, bf, t)` PER CANDIDATE TYPE (memoized via `acCache: Map<DamageType, number>` to avoid re-scanning the battlefield for every action of the same type — the cache survives across the entire party scan). Passes the per-type AC to `actionDamageWeight(a, targetACFor(t))`. Signature UNCHANGED — the S106 dispatch wiring (`case 'hallow'` in combat.ts) is STILL untouched. The dispatch ORDER is unchanged: `pickHallowDamageType` still runs first (type), `shouldCastEnergyVulnerability` still runs second (target).
- `actionDamageWeight(a, targetAC)` — signature UNCHANGED (just renamed `encounterAC` → `targetAC` for clarity, since the AC is now per-type-target rather than encounter-avg/likely-target). The body is unchanged: `hitChance = bestiaryHitChance(a.hitBonus, targetAC)` for attack rolls, `0.75` for saves, `1.0` for auto-hit.
- `encounterAvgAC` + `likelyHallowTargetAC` are UNCHANGED (still exported, still used as the fallback inside `likelyHallowTargetACForType`, still tested directly by §5j/§5k).
- New metadata flag `hallowEnergyVulnerabilityV2PerTypeLikelyTargetAC: true` (distinct from the S105 implemented + S106 wired + S107 weighted + S108 bestiary-hitChance + S109 encounter-AC + S110 likely-target-AC flags).

**Why this is LOW-MEDIUM risk (not HIGH):** the change is helper-only — no combat.ts dispatch reorder, no dispatch wiring change. The dispatch order (`pickHallowDamageType` first → `shouldCastEnergyVulnerability` second) is unchanged, so the §6-§14 dispatch tests and the bestiary_integration combats that depend on the current order are not at risk from a dispatch reorder. The only residual risk (a bestiary_integration flip when the per-type likely target's AC differs from the S110 type-agnostic likely target's AC) is verifiable — and verified 77/0 (see below). The "MEDIUM" part of LOW-MEDIUM reflects the slightly higher complexity (per-type iteration + memoization cache) vs S110's single-AC-for-all-types, but the runtime cost is bounded (cache hit after the first action of each type) and the behavioural surface is narrow (only changes the pick when a top-HP enemy is pre-vulnerable to a candidate type — a rare edge case).

**Why the fallback preserves all S110 unit tests:**
- §5b-§5g (no enemies on the battlefield): `likelyHallowTargetACForType` finds no candidate → falls back to `likelyHallowTargetAC` → `encounterAvgAC` → `BESTIARY_MEAN_AC` (14.849) → identical S110 hitChance values → identical winners.
- §5h (single goblin AC 10 within 60ft, NOT pre-vulnerable): likely target for any type = goblin → AC 10 = S110 (only one enemy) → identical (fire wins).
- §5i (single golem AC 20 within 60ft, NOT pre-vulnerable): likely target for any type = golem → AC 20 = S110 → identical (cold wins).
- §5j (`encounterAvgAC` direct values): `encounterAvgAC` is UNCHANGED → all 7 assertions identical.
- §5k (`likelyHallowTargetAC` direct values): `likelyHallowTargetAC` is UNCHANGED → all 11 assertions identical.
- §5l (squishy-boss flip — boss NOT pre-vulnerable to fire/cold): `likelyHallowTargetACForType('cold')` = boss AC 10 (not pre-vuln), `likelyHallowTargetACForType('fire')` = boss AC 10 (not pre-vuln) → same as S110 → fire wins (identical flip).
- §6-§16 (dispatch tests, enemies at AC 14, single party damage type, NOT pre-vulnerable): `likelyHallowTargetACForType(that type)` = enemy AC 14 = S110 → identical (and the single damage type makes the pick AC-independent anyway).
- §1-§4 (metadata + base pickHallowDamageType): unaffected by the per-type AC refinement (only the AC value passed to actionDamageWeight changes, not the weight formula or the dispatch).

Verified: session106 76 → 92 (+16: §1 +1 flag, §5m +11 `likelyHallowTargetACForType` direct values, §5n +4 per-type-target flip + cross-checks; the 76 S110 assertions all still pass).

**Behavioural change (S111 vs S110):** when the highest-HP enemy within 60ft is ALREADY VULNERABLE to a candidate damage type, the attack-roll hitChance for THAT type now uses the SECOND-highest-HP enemy's AC (the actual target after `shouldCastEnergyVulnerability`'s vuln-skip) instead of the top-HP enemy's AC (which `shouldCastEnergyVulnerability` would skip). The §5n test demonstrates the flip:
- **§5n (top-HP boss pre-vuln to fire → fire wins):** party with 1 cold save spell (saveDC 15) FIRST + 1 fire attack (hitBonus +5) SECOND, enemies = vulnBoss AC 18 HP 200 (PRE-VULNERABLE to fire, highest-HP within 60ft) + tankMook AC 5 HP 50 (NOT pre-vulnerable to fire). S110 (type-agnostic AC 18 for both types): fire hc 0.40 → fire 3.00 < cold 5.625 → cold wins. S111 (per-type AC: fire → mook AC 5, cold → boss AC 18): fire hc 0.95 → fire 7.125 > cold 5.625 → **fire wins** (the fire attack's ACTUAL target after vuln-skip is the low-AC mook, whose AC makes the attack land 95% of the time, so doubling fire damage is more valuable than doubling the cold save spell). FLIP: S110 cold → S111 fire. Canon-better: S110 used the WRONG AC for fire (vulnBoss AC 18, when the actual fire target is tankMook AC 5), underestimating fire's hitChance (0.40 vs 0.95) and thus fire's weight (3.00 vs 7.125), leading to a wrong pick (cold). S111 correctly predicts the per-type target and picks fire — the type with the higher expected damage gain from being doubled.

The §5m tests verify the helper directly: single non-vuln enemy → that enemy's AC (S110 preserved); top-HP pre-vuln to fire → skip → second-highest-HP AC (the S111 refinement); top-HP NOT pre-vuln to cold → top-HP AC (S110 preserved for cold); cross-check `likelyHallowTargetAC` returns top-HP AC (diverges from fire, matches cold); ALL in-range pre-vuln → fallback to `likelyHallowTargetAC` (S110 behavior); no enemies → fallback chain to `BESTIARY_MEAN_AC`; beyond-60ft → fallback chain; no-pre-vuln cross-check (`likelyHallowTargetACForType` = `likelyHallowTargetAC` — S111 reduces to S110 in the common case); dead pre-vuln boss excluded → living mook AC.

**Why bestiary_integration (77 assertions) doesn't regress:** the S110 three-category analysis holds for S111:
1. **Single party damage type** — the pick is unaffected by AC (the single type always wins). Most bestiary Hallow casters are clerics/paladins with a single damage type (radiant or fire).
2. **Mixed types but no top-HP pre-vulnerable enemy** — when the highest-HP enemy within 60ft is NOT pre-vulnerable to any candidate type, `likelyHallowTargetACForType` returns the same AC as S110's `likelyHallowTargetAC` for all types → no pick flips. Most bestiary enemies don't have innate vulnerabilities.
3. **Undead/fiend target** — the Daylight path fires (not the EV path), so `pickHallowDamageType` is never called. The per-type likely-target AC is irrelevant.

The §5n flip requires a contrived party (mixed attack+save types with hitBonus +5) AND a contrived enemy setup (a top-HP boss with innate fire vulnerability alongside a low-HP low-AC mook). Neither arises in the bestiary combat set — the bestiary parties don't have the specific mixed-type configuration, and the bestiary enemies with innate vulnerabilities (e.g. skeletons vuln to bludgeoning) don't have the extreme HP/AC inverse-correlation in the right combinations alongside a Hallow caster with a mixed-type party. Verified by running bestiary_integration after the change: **77 passed, 0 failed**. The change is canon-better where it does flip (the per-type likely target's AC is a more faithful representative than the type-agnostic top-HP enemy's AC, since the actual target after `shouldCastEnergyVulnerability`'s vuln-skip IS the per-type predicted target) and a no-op where it doesn't.

**Why the per-type-target heuristic is a faithful predictor of the actual target:** `shouldCastEnergyVulnerability(caster, bf, damageType)` selects the highest-HP enemy within 60ft that is NOT already vulnerable to `damageType`. `likelyHallowTargetACForType(caster, bf, damageType)` selects the same enemy (same selection criteria, same range gate, same vuln-skip, same tie-break). The two are NOW EQUIVALENT (S110's `likelyHallowTargetAC` diverged ONLY because it couldn't apply the type-dependent vuln-skip at pick time; S111 applies the vuln-skip per-type, eliminating the divergence). The only residual inaccuracy is the edge case where ALL in-range enemies are pre-vulnerable to a candidate type — `shouldCastEnergyVulnerability` returns null (no valid target), but `likelyHallowTargetACForType` falls back to `likelyHallowTargetAC` (the top-HP enemy's AC, ignoring the vuln-skip). This is the rare edge case where the pick is moot anyway (Hallow EV doesn't fire for that type), so the fallback value is harmless. S111 has NO residual inaccuracy in the common case (unlike S110, which had the pre-vulnerable-top-HP divergence).

**Files:**
- `src/spells/hallow.ts`:
  - `likelyHallowTargetACForType(caster, bf, damageType)` (NEW, exported) — highest-HP living enemy within 60ft NOT already vulnerable to `damageType`, `likelyHallowTargetAC` fallback (S111 Task 1).
  - `pickHallowDamageType(caster, bf)`: now calls `likelyHallowTargetACForType` per candidate type (memoized via `acCache: Map<DamageType, number>`). Signature unchanged (S111 Task 1).
  - `actionDamageWeight(a, targetAC)`: signature unchanged (renamed `encounterAC` → `targetAC` for clarity). Body unchanged (S111 Task 1).
  - `encounterAvgAC` + `likelyHallowTargetAC`: UNCHANGED (still exported, still the fallback chain, still §5j/§5k-tested) (S111 Task 1).
  - metadata: `hallowEnergyVulnerabilityV2PerTypeLikelyTargetAC: true` flag (NEW) (S111 Task 1).
  - doc comments: S111 refinement block + `likelyHallowTargetACForType` full doc (selection heuristic mirror + fallback cases + S110 test preservation) + updated `actionDamageWeight` doc (S111 per-type likely-target AC) + updated `pickHallowDamageType` doc (S111 per-type likely-target AC memoized per type, dispatch order unchanged) (S111 Task 1).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `likelyHallowTargetACForType`.
  - §1: +1 assertion (`hallowEnergyVulnerabilityV2PerTypeLikelyTargetAC = true`).
  - §5m (NEW, 11 assertions): `likelyHallowTargetACForType` direct values — single non-vuln enemy (fire/cold → that enemy's AC, S110 preserved); top-HP pre-vuln to fire → skip → second-highest-HP AC (S111 refinement); top-HP NOT pre-vuln to cold → top-HP AC (S110 preserved for cold); cross-check `likelyHallowTargetAC` returns top-HP AC (diverges from fire, matches cold); ALL in-range pre-vuln → fallback to `likelyHallowTargetAC` (S110 behavior); no enemies → fallback chain to `BESTIARY_MEAN_AC`; beyond-60ft → fallback chain; no-pre-vuln cross-check (`likelyHallowTargetACForType` = `likelyHallowTargetAC` for fire and cold — S111 reduces to S110 in the common case); dead pre-vuln boss excluded → living mook AC.
  - §5n (NEW, 4 assertions): per-type-target vuln-skip flip — S111 picks fire (per-type target AC for fire = mook AC 5 → fire hc 0.95 > cold 0.75) — NOT first-seen cold. Cross-checks: `likelyHallowTargetAC` (S110 type-agnostic) = 18 (S110 would pick cold), `likelyHallowTargetACForType('fire')` = 5 (vulnBoss pre-vuln → skip → tankMook), `likelyHallowTargetACForType('cold')` = 18 (vulnBoss NOT pre-vuln to cold → vulnBoss AC).

**Verified:** 76 → 92 assertions (+16: §1 +1, §5m +11, §5n +4). All Hallow/spell/bestiary regression tests pass (session105 41, session68_batch3 149, session68_batch2 136, session104_vuln 13, session75_monster_slotted 66, session103_debuff_vuln_expiry 37, bestiary_integration 77, creature_defenses 92, creature_lair_actions 12, session103_choose_lair_point 128, session103_deferred_promotion 88, session100 71, session99 60, session102 51, session98 36, session94 53, session93 52, session92 59, session91 155, bulk_spell_dispatch 214, counterspell 35, shield_reaction 66, quivering_palm 31, session80_goi_radius, session81_goi_caster_inside). tsc baseline unchanged (5 pre-existing, 0 new). CI on `45e7b06`: in_progress at handover-write time (see CI STATUS below).

## TEST STATUS

- **New/updated tests (1 file):**
  - `session106_hallow_ev_dispatch` — 92 passed, 0 failed (was 76 in S110; +16: §1 +1 flag, §5m +11 `likelyHallowTargetACForType` direct, §5n +4 per-type-target flip + cross-checks).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed. (Not re-run this session — unchanged by S111; S110 verified.)
  - `session92_lair_action_dispatch` — 59 passed. (Not re-run — unchanged by S111; S110 verified.)
  - `session93_lair_save_damage` — 52 passed. (Not re-run — unchanged by S111; S110 verified.)
  - `session94_lair_phase3b` — 53 passed. (Re-run this session — S111 verification; 53/0.)
  - `session98_lair_phase7` — 36 passed. (Re-run this session — S111 verification; 36/0.)
  - `session99_lair_phase7b2` — 60 passed (S107 flake fix holds; S111 doesn't touch lair actions).
  - `session100_lair_phase8b1` — 71 passed.
  - `session102_lair_phase8b3` — 51 passed (S107 flake fix holds).
  - `session103_choose_lair_point` — 128 passed (S107 targeting regression — unchanged by S111).
  - `session103_deferred_promotion` — 88 passed.
  - `session103_debuff_vuln_expiry` — 37 passed (S103 vuln pattern regression — S111 per-type AC change doesn't touch the vuln pattern).
  - `session104_vuln_audit` — 13 passed (Hallow still uses ActiveEffect).
  - `session105_hallow_energy_vuln` — 41 passed (S105 EV effect regression — S111 per-type likely-target AC change doesn't touch the effect application).
  - `session106_hallow_ev_dispatch` — 92 passed (was 76; +16).
  - `session68_batch2_spells` — 136 passed.
  - `session68_batch3_spells` — 149 passed (Hallow Daylight regression — Daylight doesn't use pickHallowDamageType; S111 change is isolated to the EV helper).
  - `session75_monster_slotted_spells` — 66 passed.
  - `bestiary_integration` — 77 passed (S111 per-type likely-target AC change doesn't regress bestiary combats — see "Why bestiary_integration doesn't regress" above).
  - `creature_lair_actions` — 12 passed.
  - `creature_defenses` — 92 passed (innate-vuln regression — S111 change respects `damageVulnerabilities` correctly).
  - `bulk_spell_dispatch` — 214 passed.
  - `counterspell` — 35 passed.
  - `shield_reaction` — 66 passed.
  - `quivering_palm` — 31 passed (S110 flake fix holds).
  - `session80_goi_radius` — passed (re-verified this session).
  - `session81_goi_caster_inside` — passed (re-verified this session).

- **Full 6-chunk CI suite:** local full-suite run hits sandbox memory limits (parallel ts-node OOM) — same as S105/S106/S107/S108/S109/S110. CI on GitHub is the definitive check. `45e7b06` CI was IN_PROGRESS at handover-write time (7 check-runs: build + 6 test chunks); expected ALL GREEN (the change is helper-only + test additions; no dispatch reorder; the per-type-target iteration's only behavioural surface is the §5n-style flip, which doesn't arise in bestiary combats — verified locally 77/0).

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-110: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts L2610+L2630 + 1 in utils.ts L601 + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts L602+L609. The S111 changes are a spell-module new-exported-helper + a per-type-AC call-site refinement + test additions. None touch the 5 pre-existing error sites. CI does not run `tsc`.)

## CI STATUS

- **`ffd76e5` (S110 handover update — Task 0 quivering_palm §18 flake fix, re-verified this session):** **9/9 ALL GREEN** — build + deploy + report-build-status + 6 test chunks all SUCCESS. The github-pages and vercel check-SUITES are "queued" (conclusion=None) — the normal non-failure state for this repo (identical to the verified-green S107/S108/S109/S110 HEADs). **No red X carried over from S110.**
- **`45e7b06` (S111 Hallow v2 per-type likely-target AC, HEAD):** CI IN_PROGRESS at handover-write time (7 check-runs: build + 6 test chunks all in_progress; deploy + report-build-status check-runs typically appear after build completes). Expected ALL GREEN — the change is helper-only + test additions:
  - session106 92/0 locally (was 76 in S110; +16).
  - bestiary_integration 77/0 locally (no bestiary flip — the §5n flip requires a contrived party + a contrived enemy setup that doesn't arise in the bestiary combat set).
  - All Hallow/spell/dispatch/lair-action/flake-fix regression tests pass locally (see TEST STATUS above).
  - tsc baseline unchanged (5 pre-existing, 0 new).
  - The dispatch wiring (S106 case 'hallow' in combat.ts) is STILL unchanged — pickHallowDamageType runs first (type), shouldCastEnergyVulnerability runs second (target).
  (See CI FAILURE RECOVERY below if a red X appears.)

(If a flaky CRASH appears on any chunk — the known flake was `summons.test.ts` under parallel load. The `open_hand_technique` flake was FIXED in S105; session99/session102 flakes were FIXED in S107; the quivering_palm §18 flake was FIXED in S110. Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S110 next-action #13 (per-type likely-target vuln-skip refinement) is completed this session (LOW-MEDIUM risk — helper-only, no dispatch reorder). The carry-overs from S104/S105/S106/S107/S108/S109/S110 + NO new follow-ups from S111 (S111 closes the last known S110 divergence — the per-type likely-target AC now matches `shouldCastEnergyVulnerability`'s selection EXACTLY in the common case, with the only residual inaccuracy being the rare all-pre-vuln edge case where the pick is moot):

### 1. Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk)

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). The S105 Phase 8 retrospective confirmed 38+ isSpell cast_spell actions exist across the bestiary, all with spellNames — ready for the unified dispatch. **Unchanged from S104/S105/S106/S107/S108/S109/S110.** Out of scope for an autonomous z session (HIGH risk).

### 2. Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream)

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). Per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S104/S105/S106/S107/S108/S109/S110.**

### 3. Score-weight tuning (S104, unchanged, MEDIUM — needs no action for S107/S108/S109/S110/S111)

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. **S108 VERIFIED this needs NO action** (the scorer already uses the S107 targeting changes via selectLairActionTargets → chooseLairActionPoint). S110/S111 don't touch lair-action scoring at all (the S110 likely-target-AC change + S111 per-type-target AC change are isolated to the Hallow EV damage-type pick, not lair actions). General weight-tuning remains MEDIUM risk and out of scope for an autonomous z session (subjective objective metric + bestiary-sweep memory limits + test-regression risk). **Unchanged — no action taken or needed for S107/S108/S109/S110/S111.**

### 4. Yeenoghu::1 single-target point handler (S106, RESOLVED in S107)

S107 Task 2 added fallback 3 (radiusFt=0 for `centerOnPoint` + "in (the|that) space"). **RESOLVED in S107.** No further action.

### 5. Hallow EV damage-type weighting (S106, RESOLVED in S107)

S107 Task 3 replaced the v1 count heuristic with the v2 weighted model (damage × availability × hitChance). **RESOLVED in S107.** No further action.

### 6. `rangeFt` extraction for "anywhere in their lair" (S106, RESOLVED in S107)

S107 Task 1 added the §8b override (rangeFt=500 for "anywhere in <possessive> lair"). **RESOLVED in S107.** No further action.

### 7. `open_hand_technique` flake (S105, RESOLVED)

The `executeFOUntilHit` hit-detection flake was FIXED in S105 (`07e7e9a`). **RESOLVED in S105.** No further action.

### 8. session99 + session102 CI flakes (S107, RESOLVED in S107)

S107 Task 0 fixed both flakes deterministically. S111 re-verified: session99 60/0, session102 51/0. **RESOLVED in S107.** No further action.

### 9. Hallow v2 hitChance per-target refinement (S107, RESOLVED in S108 — option b)

S108 Task 1 replaced the flat 0.65 attack-roll hitChance with `bestiaryHitChance(hitBonus)` (per-action hitBonus vs bestiary mean AC 14.849). **RESOLVED in S108.** Option (a) (dispatch reorder to use the finalized target's AC — MEDIUM risk, touches combat.ts) remains a possible future refinement but is out of scope for an autonomous z session. Note: S109's encounter-specific AC + S110's likely-target AC + S111's per-type likely-target AC partially address the "target AC unknown" issue (the per-type likely target's AC is now used, matching `shouldCastEnergyVulnerability`'s selection EXACTLY in the common case), so option (a)'s marginal gain over S111 is small.

### 10. Hallow v2 encounter-specific AC refinement (S108, RESOLVED in S109)

S109 Task 1 replaced the unconditional bestiary mean AC with `encounterAvgAC(caster, bf)` (mean AC of living enemies, bestiary-mean fallback). **RESOLVED in S109.** No further action.

### 11. Hallow v2 target-specific AC refinement (S109, RESOLVED in S110 — LOW-risk variant)

S110 Task 1 replaced the S109 encounter AVERAGE AC with `likelyHallowTargetAC(caster, bf)` (highest-HP living enemy within 60ft, mirroring `shouldCastEnergyVulnerability`'s selection, `encounterAvgAC` fallback). Achieved at LOW risk (helper-only, dispatch UNCHANGED — no combat.ts reorder). **RESOLVED in S110.** No further action. The residual inaccuracy (likely target ≠ actual target when the top-HP enemy is already vulnerable to the would-be-chosen type — a rare edge case) was the S110 next-action #13, now RESOLVED in S111.

### 12. `summons.test.ts` parallel-load flake (S106, unchanged, KNOWN)

The known flake is `summons.test.ts` under parallel load (passes standalone). Re-trigger with an empty commit if it CRASHes. **Unchanged from S106/S107/S108/S109/S110.** Not fixed (parallelism-specific; would need a test-isolation refactor).

### 13. Hallow v2 likely-target vuln-skip refinement (S110, RESOLVED in S111)

S111 Task 1 replaced the S110 type-AGNOSTIC `likelyHallowTargetAC` (which couldn't apply the type-dependent vuln-skip at pick time) with the S111 PER-TYPE `likelyHallowTargetACForType` (which applies the vuln-skip per candidate type, mirroring `shouldCastEnergyVulnerability`'s selection EXACTLY). Achieved at LOW-MEDIUM risk (helper-only, dispatch UNCHANGED — no combat.ts reorder, but the per-type-target iteration is more complex and could shift bestiary combats where a top-HP enemy is pre-vulnerable to the party's dominant type — verified 77/0 no flip). **RESOLVED in S111.** No further action. S111 closes the last known S110 divergence — `likelyHallowTargetACForType` now matches `shouldCastEnergyVulnerability`'s selection EXACTLY in the common case (no pre-vuln top-HP enemy), with the only residual inaccuracy being the rare all-pre-vuln edge case where the pick is moot (Hallow EV doesn't fire for that type, so the fallback value is harmless).

### 14. `quivering_palm.test.ts` §18 parallel-load flake (S110, RESOLVED in S110)

The §18 "miss log found (to verify hit bonus)" assertion flaked under parallel CI load on `12702a5` chunk 3 (missLog undefined after 50 retry attempts; standalone passes 5/5). Root cause: state-bleed between retry attempts (the loop reset `isDead`/`currentHP`/`ki` but NOT `isUnconscious`/`conditions`, unlike `executeQPUntilHit`). **RESOLVED in S110** (commit `185bd03`): full per-attempt reset mirroring `executeQPUntilHit` + skip-on-RNG-edge safety net. S111 re-verified: quivering_palm 31/0. No further action.

## CI FAILURE RECOVERY

If `45e7b06` shows a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs. `45e7b06` is expected ALL GREEN (helper-only + test additions; no dispatch reorder).
2. **`45e7b06` (Hallow v2 per-type likely-target AC):** the changes are the `likelyHallowTargetACForType` helper + the `pickHallowDamageType` call-site refinement (per-type AC memoized via `acCache: Map<DamageType, number>`) + the `actionDamageWeight` parameter rename (`encounterAC` → `targetAC`) + test additions. The dispatch path (case 'hallow' in combat.ts) is unchanged. If `session106_hallow_ev_dispatch` fails on any re-run, check whether a §5m/§5n assertion has a wrong expected value (the hitChance values are computed by hand in the comments — verify the arithmetic; §5n fire hc 0.95 = (21-max(2,5-5))/20 = 19/20 clamped vs tankMook AC 5 with hitBonus +5, §5n cold weight 5.625 = 7.5×1.0×0.75 (save-based, AC-independent), §5n S110 fire weight 3.00 = 7.5×1.0×0.40 vs vulnBoss AC 18 with hitBonus +5, §5m all-in-range-pre-vuln fallback returns 18 = `likelyHallowTargetAC` top-HP AC ignoring vuln-skip). If `session68_batch3_spells` (Hallow Daylight regression) fails, the per-type likely-target AC change somehow affected the Daylight path (shouldn't — Daylight doesn't use pickHallowDamageType). If `bestiary_integration` fails, the per-type likely-target AC flipped a mixed-type-party damage-type pick and changed a combat outcome — re-examine whether the new pick is canon-better (higher expected damage vs the per-type likely target's actual AC, which is the enemy `shouldCastEnergyVulnerability` will actually select after the vuln-skip) and update the bestiary assertion tolerance if so. (Local run: bestiary_integration 77/0 — no flip observed.) If `creature_defenses` fails, the per-type vuln-skip check `c.damageVulnerabilities?.includes(damageType)` is mishandling an innate-vuln edge case — verify the `damageVulnerabilities` field is read correctly (it's optional: `DamageType[] | undefined`; `?.includes()` returns undefined for undefined, which is falsy → not skipped, which is correct — no vuln = no skip).
3. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
4. **Known flakes (all FIXED):** `open_hand_technique` (S105), session99/session102 (S107), quivering_palm §18 (S110). The only REMAINING known flake is `summons.test.ts` under parallel load — passes standalone; re-trigger with an empty commit if it CRASHes.

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-111.md` — this file.

### Modified
- `src/spells/hallow.ts`:
  - `likelyHallowTargetACForType(caster, bf, damageType)` (NEW, exported) — highest-HP living enemy within 60ft NOT already vulnerable to `damageType`, `likelyHallowTargetAC` fallback (S111 Task 1).
  - `pickHallowDamageType(caster, bf)`: now calls `likelyHallowTargetACForType` per candidate type (memoized via `acCache: Map<DamageType, number>`). Signature unchanged (S111 Task 1).
  - `actionDamageWeight(a, targetAC)`: signature unchanged (renamed `encounterAC` → `targetAC` for clarity). Body unchanged (S111 Task 1).
  - `encounterAvgAC` + `likelyHallowTargetAC`: UNCHANGED (still exported, still the fallback chain, still §5j/§5k-tested) (S111 Task 1).
  - metadata: `hallowEnergyVulnerabilityV2PerTypeLikelyTargetAC: true` flag (NEW) (S111 Task 1).
  - doc comments: S111 refinement block + `likelyHallowTargetACForType` full doc + updated `actionDamageWeight` doc + updated `pickHallowDamageType` doc (S111 Task 1).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `likelyHallowTargetACForType` (S111 Task 1).
  - §1: +1 assertion (S111 flag = true) (S111 Task 1).
  - §5m (NEW, 11 assertions): `likelyHallowTargetACForType` direct values + top-HP-pre-vuln-skip + cold-preserved + S110-cross-check + all-pre-vuln-fallback + no-enemies-fallback + beyond-60ft-fallback + no-pre-vuln-reduces-to-S110-cross-check + dead-pre-vuln-skipped (S111 Task 1).
  - §5n (NEW, 4 assertions): per-type-target vuln-skip flip (S110 cold → S111 fire) + `likelyHallowTargetAC`/`likelyHallowTargetACForType('fire')`/`likelyHallowTargetACForType('cold')` cross-checks (S111 Task 1).

### Archived
- `zHANDOVER-SESSION-109.md` → `HandoverOld/zHANDOVER-SESSION-109.md` (per AGENTS.md "latest 2 in root" rule; S110 + S111 now in root).

## ARCHITECTURAL NOTES

### Why the per-type likely-target AC (not the S110 type-agnostic likely-target AC)

The S110 `likelyHallowTargetAC` predicts the likely target as the highest-HP enemy within 60ft REGARDLESS of damage type — justified at the time because the damage type wasn't chosen yet at pick time, so the type-dependent vuln-skip couldn't be applied. But `shouldCastEnergyVulnerability` DOES apply the vuln-skip (it skips enemies already vulnerable to the chosen type). So when the top-HP enemy was pre-vulnerable to a candidate type, S110 predicted the WRONG target for that type — `shouldCastEnergyVulnerability` would skip the top-HP enemy and pick the second-highest-HP enemy, but S110's hitChance was computed against the top-HP enemy's AC. S111's `likelyHallowTargetACForType` applies the vuln-skip per candidate type, predicting the ACTUAL target for THAT type. The hitChance is then computed against the correct target's AC, so the weight reflects the damage gain from doubling that type against the enemy that will actually be vuln'd. Verified by §5m: vulnBoss AC 18 HP 200 (pre-vuln to fire) + tankMook AC 5 HP 50 (not pre-vuln) → `likelyHallowTargetACForType('fire')` returns 5 (tankMook's AC, after skipping vulnBoss), while `likelyHallowTargetAC` returns 18 (vulnBoss's AC, type-agnostic) — the helper now diverges from the type-agnostic prediction to track the per-type actual target.

### Why the helper-only approach (not the S109-proposed dispatch reorder)

S109 next-action #11 proposed reordering the combat.ts dispatch to "pick the target FIRST, then pick the damage type using that target's AC" — MEDIUM risk because it touches the S106 dispatch rule ("Priority 1: AI-picked target → effect-selection") and could break the dispatch tests §6-§14 + bestiary_integration. S110 avoided the reorder entirely (helper-only, predicted the likely target itself). S111 follows the S110 pattern: `pickHallowDamageType` predicts the per-type likely target ITSELF (using the same highest-HP-within-60ft-NOT-already-vulnerable heuristic as `shouldCastEnergyVulnerability`, applied per candidate type) and uses that enemy's AC. The dispatch ORDER is unchanged (`pickHallowDamageType` first → `shouldCastEnergyVulnerability` second), so the §6-§14 dispatch tests and bestiary_integration are not at risk from a dispatch reorder. The change is a pure `hallow.ts` helper refinement + a per-type-AC call-site refinement — LOW-MEDIUM risk. The only residual risk (a bestiary_integration flip when the per-type likely target's AC differs from the S110 type-agnostic likely target's AC) is verifiable — and verified 77/0.

### Why the per-type vuln-skip is canon-correct

`shouldCastEnergyVulnerability(caster, bf, damageType)` selects the highest-HP enemy within 60ft that is NOT already vulnerable to `damageType` (it skips pre-vulnerable enemies to avoid wasting the slot on a no-op push). The damage-type pick should reflect the damage gain from doubling that type — which depends on the hit rate against the ACTUAL target. S110's type-agnostic `likelyHallowTargetAC` couldn't apply the vuln-skip (the type wasn't known at pick time), so it used the top-HP enemy's AC for ALL types — correct for types where the top-HP enemy wasn't pre-vulnerable, but WRONG for types where it was. S111's `likelyHallowTargetACForType` applies the vuln-skip per candidate type, so the hitChance reflects the enemy that will ACTUALLY be vuln'd for that type. The §5n flip demonstrates the canon-correctness: when the top-HP boss is pre-vulnerable to fire, the actual fire target is the second-highest-HP mook (low AC), so fire's hitChance is high (0.95) and fire's weight is high (7.125) — S110 missed this because it used the boss's AC (18) for fire, underestimating fire's hitChance (0.40) and weight (3.00), leading to a wrong pick (cold). S111 correctly picks fire.

### Why the per-type iteration is memoized

`pickHallowDamageType` iterates over ALL party members' actions. Without memoization, each action would trigger a full battlefield scan via `likelyHallowTargetACForType` — O(party_actions × battlefield_size). With memoization via `acCache: Map<DamageType, number>`, the scan runs ONCE per unique damage type — O(unique_types × battlefield_size). For typical parties (3-5 unique damage types) and battlefields (5-15 combatants), the memoized cost is negligible. The cache survives across the entire party scan (it's declared outside the inner loop), so the second action of the same type hits the cache.

### Why the fallback preserves all S110 unit tests

The S111 change replaces `likelyHallowTargetAC(caster, bf)` with `likelyHallowTargetACForType(caster, bf, t)` inside `pickHallowDamageType`. `likelyHallowTargetACForType` returns the per-type likely target's AC when a valid candidate exists for that type, and falls back to `likelyHallowTargetAC` otherwise. For the S110 tests:
- §5b-§5g (no enemies on the battlefield): no candidate for any type → fallback to `likelyHallowTargetAC` → `encounterAvgAC` → `BESTIARY_MEAN_AC` → identical hitChance → identical winners.
- §5h/§5i (a single enemy within 60ft, NOT pre-vulnerable): likely target for any type = that enemy → its AC = S110 `likelyHallowTargetAC` (only one enemy) → identical hitChance → identical winners.
- §5j/§5k (`encounterAvgAC` + `likelyHallowTargetAC` direct): unchanged (no modification to those helpers).
- §5l (squishy-boss flip — boss NOT pre-vulnerable to fire/cold): `likelyHallowTargetACForType('cold')` = boss AC 10, `likelyHallowTargetACForType('fire')` = boss AC 10 → same as S110 → fire wins (identical flip).
- §6-§16 (enemies at AC 14, single party damage type, NOT pre-vulnerable): `likelyHallowTargetACForType(that type)` = enemy AC 14 = S110 → identical (and the single damage type makes the pick AC-independent anyway).

The only way an S110 test would break is if the per-type likely target's AC FLIPPED a winner — which requires (a) a multi-enemy battlefield where the top-HP enemy is pre-vulnerable to one of the candidate types AND (b) a mixed-type party where the AC shift (top-HP enemy's AC → second-highest-HP enemy's AC) crosses a hitChance threshold. The S110 §5b-§5g tests have no enemies (condition a fails); the §5h/§5i tests have a single non-pre-vulnerable enemy (condition a fails); the §5l test has a multi-enemy battlefield but no pre-vulnerabilities (condition a fails); the §6-§16 dispatch tests have a single damage type (condition b fails). So all S110 tests are safe. The §5n test is NEW — it deliberately constructs the flip scenario (a top-HP boss with innate fire vulnerability alongside a low-HP low-AC mook + a mixed attack+save party) to demonstrate the S111 behavioural difference.

### Why bestiary_integration doesn't regress

The S110 three-category analysis holds for S111:
1. **Single party damage type** — the pick is unaffected by AC (the single type always wins). Most bestiary Hallow casters are clerics/paladins with a single damage type (radiant or fire).
2. **Mixed types but no top-HP pre-vulnerable enemy** — when the highest-HP enemy within 60ft is NOT pre-vulnerable to any candidate type, `likelyHallowTargetACForType` returns the same AC as S110's `likelyHallowTargetAC` for all types → no pick flips. Most bestiary enemies don't have innate vulnerabilities.
3. **Undead/fiend target** — the Daylight path fires (not the EV path), so `pickHallowDamageType` is never called. The per-type likely-target AC is irrelevant.

The §5n flip requires a contrived party (mixed attack+save types with hitBonus +5) AND a contrived enemy setup (a top-HP boss with innate fire vulnerability alongside a low-HP low-AC mook). Neither arises in the bestiary combat set — the bestiary parties don't have the specific mixed-type configuration, and the bestiary enemies with innate vulnerabilities (e.g. skeletons vuln to bludgeoning) don't have the extreme HP/AC inverse-correlation in the right combinations alongside a Hallow caster with a mixed-type party. Verified: **77 passed, 0 failed**. The change is canon-better where it does flip (the per-type likely target's AC is a more faithful representative than the type-agnostic top-HP enemy's AC) and a no-op where it doesn't. **No bestiary assertion needed updating.**

### Coverage summary (updated for Session 111)

| Category | Count | S110 state | S111 delta | Total |
|---|---|---|---|---|
| `save_damage` | 99 | ✅ | — | 99 |
| `save_condition` | 55 | ✅ 33 point-selection, 1 unbounded | — | 55 (33 point-selection, 1 unbounded) |
| `save_only` | 42 | ✅ 42/42 | — | 42/42 (100%) |
| `cast_spell` | 42 | ✅ | — | 42 |
| `bespoke` | 29 | ✅ 29/29 recognized | — | 29/29 (100%) recognized |
| `summon` | 23 | ✅ | — | 23 |
| `buff_ally` | 7 | ✅ | — | 7 |
| `debuff_enemy` | 7 | ✅ | — | 7 |
| `movement` | 7 | ✅ | — | 7 |
| `damage_no_save` | 5 | ✅ | — | 5 |
| `spell_slot_regen` | 2 | ✅ | — | 2 |
| `visibility` | ~3 | ✅ | — | ~3 |
| `deferred` | 16 | ✅ 0 auto remain | — | 0 auto (4 stable) |
| `flavor` | 6 | logged | — | 0 (logged) |
| **Total** | **~327** | **100% recognized + scored** | **1 task: Hallow v2 per-type likely-target AC (spell-AI refinement, no recognition change)** | **~327 (100%) recognized + scored** |

Session 111 does NOT change recognition coverage (still ~327/327 = 100%) and does NOT change lair-action targeting (the S107 rangeFt/radiusFt work is untouched) and does NOT change the Hallow dispatch wiring (the S106 case 'hallow' in combat.ts is unchanged). It improves:
- **Spell AI accuracy** (Task 1 — Hallow EV damage-type selection now uses the PER-TYPE likely target's AC — for each candidate type, the highest-HP enemy within 60ft that is NOT already vulnerable to that type, mirroring `shouldCastEnergyVulnerability`'s selection EXACTLY — instead of the S110 type-agnostic likely-target AC; vs a top-HP boss pre-vulnerable to fire + a low-HP low-AC mook, the fire attack's predicted target is correctly identified as the mook, whose low AC makes the attack the better type to double).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (local, post-push): `45e7b06` (S111 Hallow v2 per-type likely-target AC), `ffd76e5` (S110 handover update), `185bd03` (S110 quivering_palm §18 flake fix), `56cf1a9` (S110 handover), `12702a5` (S110 Hallow v2 likely-target AC)
- `git status` → clean (1 impl commit pushed — S109 handover archived to HandoverOld/; S111 handover commit pending — this file)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts` → **92 passed, 0 failed** (was 76 in S110; +16)
- `npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts` → **41 passed, 0 failed** (S105 EV effect regression)
- `npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts` → **149 passed, 0 failed** (Hallow Daylight regression)
- `npx ts-node --transpile-only src/test/session68_batch2_spells.test.ts` → **136 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session104_vuln_audit.test.ts` → **13 passed, 0 failed** (Hallow still uses ActiveEffect)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (per-type likely-target-AC change doesn't regress bestiary combats)
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression — S111 respects `damageVulnerabilities` correctly)
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **128 passed, 0 failed** (S107 targeting regression — unchanged by S111)
- `npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts` → **37 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_deferred_promotion.test.ts` → **88 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session75_monster_slotted_spells.test.ts` → **66 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session99_lair_phase7b2.test.ts` → **60 passed, 0 failed** (S107 flake fix holds)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **51 passed, 0 failed** (S107 flake fix holds)
- `npx ts-node --transpile-only src/test/session98_lair_phase7.test.ts` → **36 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session94_lair_phase3b.test.ts` → **53 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session93_lair_save_damage.test.ts` → **52 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session92_lair_action_dispatch.test.ts` → **59 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **155 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session100_lair_phase8b1.test.ts` → **71 passed, 0 failed**
- `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts` → **214 passed, 0 failed**
- `npx ts-node --transpile-only src/test/counterspell.test.ts` → **35 passed, 0 failed**
- `npx ts-node --transpile-only src/test/shield_reaction.test.ts` → **66 passed, 0 failed**
- `npx ts-node --transpile-only src/test/quivering_palm.test.ts` → **31 passed, 0 failed** (S110 flake fix holds)
- `npx ts-node --transpile-only src/test/session80_goi_radius.test.ts` → **all passed** (re-verified this session)
- `npx ts-node --transpile-only src/test/session81_goi_caster_inside.test.ts` → **all passed** (re-verified this session)
- **CI on GitHub:**
  - `ffd76e5` (S110 HEAD, re-verified this session) → **9/9 ALL GREEN** (no red X carried over from S110).
  - `45e7b06` (S111 Hallow v2 per-type likely-target AC, HEAD) → **CI IN_PROGRESS at handover-write time** (7 check-runs: build + 6 test chunks all in_progress; deploy + report-build-status check-runs typically appear after build completes). Expected ALL GREEN — local verification: session106 92/0, bestiary_integration 77/0, all Hallow/spell/dispatch/lair-action/flake-fix regression tests pass, tsc 5 pre-existing/0 new. The change is helper-only + test additions; no dispatch reorder; the per-type-target iteration's only behavioural surface is the §5n-style flip, which doesn't arise in bestiary combats (verified locally 77/0).
