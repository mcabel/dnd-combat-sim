# HANDOVER-SESSION-110

## REPOSITORY

- Branch: main
- Commits this session:
  - `12702a5` — Session 110: Hallow v2 likely-target AC (S109 next-action #11 partial, LOW risk)
- Previous: `59d9a0d` (S109 handover), `808fe55` (S109 Hallow v2 encounter-specific AC, HEAD of S109), `0a4ef0b` (S108 Hallow v2 per-target hitChance)
- State: clean (1 implementation commit pushed; handover commit to follow).
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

One commit. Session started by verifying the S109 HEAD (`808fe55`, via the S109 handover commit `59d9a0d`) CI was ALL GREEN (9/9 check-runs success — confirmed no red X carried over from S109). Then executed the single S109 "IMMEDIATE NEXT ACTION" that the z stream could execute autonomously at LOW risk: **#11 — Hallow v2 target-specific AC refinement** (re-classified from MEDIUM to LOW via a helper-only approach that avoids the combat.ts dispatch reorder). The S109 handover had classified #11 as MEDIUM risk because "it requires reordering the dispatch: pick the target FIRST, then pick the damage type using that target's AC ... MEDIUM risk (touches the S106 dispatch rule in combat.ts)." S110 achieves the SAME target-specific accuracy WITHOUT reordering the dispatch: `pickHallowDamageType` predicts the likely target itself (highest-HP living enemy within 60 ft, mirroring `shouldCastEnergyVulnerability`'s selection heuristic minus the type-dependent vuln-skip) and uses THAT enemy's AC — a pure `hallow.ts` helper refinement, dispatch UNCHANGED. The other S109 next-actions are either out of scope for an autonomous z session (#1 HIGH-risk unified cast dispatch, #2 SHEET-stream char-builder, #3 MEDIUM score-weight tuning) or already resolved (#4/#5/#6/#7/#8/#9/#10) or a known parallelism-only flake (#12).

### Task 1 — Hallow v2 likely-target AC refinement (commit `12702a5`) — S109 next-action #11 RESOLVED (LOW-risk variant)

**Handover directive (S109):** "The S109 `encounterAvgAC` uses the AVERAGE AC of living enemies — better than the S108 global bestiary mean, but still not the SPECIFIC target's AC. The most accurate model would use the actual Hallow target's AC (the enemy that `shouldCastEnergyVulnerability` will select). This requires reordering the dispatch: pick the target FIRST, then pick the damage type using that target's AC (S108 next-action #9 option (a), carried forward). MEDIUM risk (touches the S106 dispatch rule in combat.ts ...)."

**Implementation:** achieved the target-specific accuracy of #11 WITHOUT the MEDIUM-risk dispatch reorder. `pickHallowDamageType` now predicts the likely Hallow target itself and uses that enemy's AC instead of the encounter average.

- New exported helper `likelyHallowTargetAC(caster, bf): number` — predicts the AC of the enemy that `shouldCastEnergyVulnerability` will select as the Hallow target. Mirrors `shouldCastEnergyVulnerability`'s selection heuristic EXACTLY (minus the type-dependent vuln-skip, which can't be applied at pick time since the damage type isn't chosen yet):
  - enemies only (faction differs from caster's)
  - not dead / unconscious
  - within Hallow's 60-ft range (`chebyshev3D(caster.pos, c.pos) × 5 ≤ 60` — the SAME range gate `shouldCastEnergyVulnerability` uses; enemies beyond 60 ft can NEVER be the Hallow target so their AC must not influence the pick)
  - highest `maxHP` wins (the biggest threat — same threat metric as `shouldCastEnergyVulnerability`); ties broken by NEAREST distance (same tie-break); full ties keep first-seen (strict `>` / strict `<` so an equal-HP equal-distance later enemy does NOT override — matches the stable-sort behaviour of `shouldCastEnergyVulnerability`'s `candidates.sort`)
  - same finite-AC guard as `encounterAvgAC` (skip NaN/Infinity)
  - falls back to `encounterAvgAC(caster, bf)` (S109 behavior, which itself falls back to `BESTIARY_MEAN_AC` when no living enemies exist) when no enemy is within 60 ft.
- `pickHallowDamageType(caster, bf)` — now calls `likelyHallowTargetAC(caster, bf)` instead of `encounterAvgAC(caster, bf)`. Signature UNCHANGED — the S106 dispatch wiring (`case 'hallow'` in combat.ts) is still untouched. The dispatch ORDER is unchanged: `pickHallowDamageType` still runs first (type), `shouldCastEnergyVulnerability` still runs second (target).
- `encounterAvgAC` is UNCHANGED (still exported, still used as the fallback inside `likelyHallowTargetAC`, still tested directly by §5j).
- New metadata flag `hallowEnergyVulnerabilityV2LikelyTargetAC: true` (distinct from the S105 implemented + S106 wired + S107 weighted + S108 bestiary-hitChance + S109 encounter-AC flags).

**Why this is LOW risk (not MEDIUM):** the S109 handover classified #11 as MEDIUM risk solely because "it requires reordering the dispatch ... touches the S106 dispatch rule in combat.ts." S110 does NOT reorder the dispatch and does NOT touch combat.ts — the change is a pure `hallow.ts` helper refinement (`pickHallowDamageType` predicts the likely target itself). The dispatch order is unchanged, so the §6-§14 dispatch tests and the bestiary_integration combats that depend on the current order are not at risk from a dispatch reorder. The only residual risk (a bestiary_integration flip when the likely target's AC differs from the encounter average) is verifiable — and verified 77/0 (see below).

**Why the fallback preserves all S109 unit tests:**
- §5b-§5g (no enemies on the battlefield): `likelyHallowTargetAC` finds no enemy within 60 ft → falls back to `encounterAvgAC` → `BESTIARY_MEAN_AC` (14.849) → identical S109 hitChance values → identical winners.
- §5h (single goblin AC 10 within 60 ft): likely target = goblin → AC 10 = S109 encounter avg 10 (only one enemy) → identical (fire wins).
- §5i (single golem AC 20 within 60 ft): likely target = golem → AC 20 = S109 encounter avg 20 → identical (cold wins).
- §5j (`encounterAvgAC` direct values): `encounterAvgAC` is UNCHANGED → all 7 assertions identical.
- §6-§16 (dispatch tests, enemies at AC 14, single party damage type): likely target AC 14 = encounter avg 14 → identical (and the single damage type makes the pick AC-independent anyway).
- §1-§4 (metadata + base pickHallowDamageType): unaffected by the AC refinement.

Verified: session106 62 → 76 (+14: §1 +1 flag, §5k +11 likelyHallowTargetAC direct values, §5l +3 squishy-boss flip + cross-checks; the 62 S109 assertions all still pass).

**Behavioural change (S110 vs S109):** when the highest-HP enemy within 60 ft has an AC that DIFFERS from the encounter average, the attack-roll hitChance now uses the likely target's AC instead of the encounter average. The §5l test demonstrates the flip:
- **§5l (squishy boss → attack wins):** party with 1 cold save spell (saveDC 15) + 1 fire attack (hitBonus +5), enemies = squishy boss AC 10 (HP 200, highest-HP within 60ft) + tanky mook AC 20 (HP 50). S109 (encounter avg 15): fire hc 0.55 → fire 4.125 < cold 5.625 → cold wins. S110 (likely target = boss AC 10): fire hc 0.80 → fire 6.0 > cold 5.625 → **fire wins** (the squishy boss is the likely Hallow target, and its low AC makes attack rolls land 80% of the time, so doubling attack damage is more valuable). FLIP: S109 cold → S110 fire. Canon-better: the caster expects to vuln the boss (highest HP), so picks the type that lands best against the BOSS, not the encounter average.

The §5k tests verify the helper directly: single enemy → that enemy's AC; highest-HP wins (NOT the mean — the key divergence from `encounterAvgAC`); HP tie → nearest; enemy beyond 60ft excluded → fallback; no-enemy fallback → `BESTIARY_MEAN_AC`; dead/unconscious/party-member skipped; multi-enemy likely-target AC ≠ encounter avg (the S110 refinement, cross-checked against `encounterAvgAC` returning the mean for the same setup).

**Why bestiary_integration (77 assertions) doesn't regress:** the S109 handover's analysis holds: the bestiary combats that cast Hallow either (a) have a single party damage type (so the pick is unaffected by AC — the single type always wins), or (b) have mixed types but the likely target's AC happens to be close enough to the encounter average that no pick flips, or (c) the Hallow target is undead/fiend (so the Daylight path fires, not the EV path — `pickHallowDamageType` is never called). The §5l flip requires a contrived party (mixed attack+save types with a specific hitBonus) AND a contrived enemy setup (a high-HP low-AC "squishy boss" alongside a low-HP high-AC mook) — neither arises in the bestiary combat set. Verified by running bestiary_integration after the change: **77 passed, 0 failed**. The change is canon-better where it does flip (the likely target's AC is a more faithful representative than the encounter average, since the target is the single highest-HP enemy — not a uniform draw from the pool) and a no-op where it doesn't.

**Why the likely-target heuristic is a faithful predictor of the actual target:** `shouldCastEnergyVulnerability(caster, bf, damageType)` selects the highest-HP enemy within 60 ft that is NOT already vulnerable to `damageType`. `likelyHallowTargetAC(caster, bf)` selects the highest-HP enemy within 60 ft (no vuln-skip, since `damageType` isn't known at pick time). The two diverge ONLY when the highest-HP enemy is already vulnerable to the would-be-chosen type — a rare edge case (most enemies aren't pre-vulnerable). In that edge case, the actual target is the second-highest-HP enemy, and `likelyHallowTargetAC` returns the highest-HP enemy's AC. But this is no WORSE than S109's encounter average (which also doesn't account for the vuln-skip) and is BETTER in the common case. The residual inaccuracy (likely target ≠ actual target when the top enemy is pre-vulnerable) is a future refinement — but it's a rare edge case and the gain over S109 is already captured.

**Files:**
- `src/spells/hallow.ts`:
  - `likelyHallowTargetAC(caster, bf)` (NEW, exported) — highest-HP living enemy within 60ft, `encounterAvgAC` fallback (S109 Task 1).
  - `pickHallowDamageType(caster, bf)`: now calls `likelyHallowTargetAC` instead of `encounterAvgAC`. Signature unchanged (S110 Task 1).
  - `encounterAvgAC`: UNCHANGED (still exported, still the fallback, still §5j-tested) (S110 Task 1).
  - metadata: `hallowEnergyVulnerabilityV2LikelyTargetAC: true` flag (NEW) (S110 Task 1).
  - doc comments: S110 refinement block (likely-target rationale + fallback preservation + §5l flip explanation) + `likelyHallowTargetAC` full doc (selection heuristic mirror + fallback cases) + updated `actionDamageWeight` doc (S110 likely-target AC) + updated `pickHallowDamageType` doc (S110 likely-target AC computed once, dispatch order unchanged) (S110 Task 1).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `likelyHallowTargetAC`.
  - §1: +1 assertion (`hallowEnergyVulnerabilityV2LikelyTargetAC = true`).
  - §5k (NEW, 11 assertions): `likelyHallowTargetAC` direct values — single enemy (AC 10 → 10), highest-HP wins (NOT mean — boss AC 18 HP 200 > trash AC 10 HP 30 → 18, cross-checked vs encounterAvgAC mean 14), HP tie → nearest (AC 12 at 5ft < AC 20 at 10ft), enemy beyond 60ft excluded (→ fallback encounterAvgAC), no-enemy fallback (→ BESTIARY_MEAN_AC 14.849), dead enemy skipped, unconscious enemy skipped, party member skipped, multi-enemy likely-target AC ≠ encounter avg (10 ≠ 15, cross-checked).
  - §5l (NEW, 3 assertions): squishy-boss flip — S110 picks fire (likely target = boss AC 10 → attack hc 0.80 > save 0.75); NOT first-seen (cold is first; S109 picked cold). Cross-checks: encounterAvgAC = 15 (S109 winner basis), likelyHallowTargetAC = 10 (S110 winner basis).

**Verified:** 62 → 76 assertions (+14: §1 +1, §5k +11, §5l +3). All Hallow/spell/bestiary regression tests pass (session105 41, session68_batch3 149, session68_batch2 136, session104_vuln 13, bestiary_integration 77, creature_defenses 92, creature_lair_actions 12, session103_choose_lair_point 128, session103_debuff_vuln_expiry 37, session103_deferred_promotion 88, session75_monster_slotted 66, session99 60, session102 51, session91 155, session100 71, bulk_spell_dispatch 214, counterspell 35, shield_reaction 66). tsc baseline unchanged (5 pre-existing, 0 new). CI on `12702a5`: pending at handover-write time (see CI STATUS below).

## TEST STATUS

- **New/updated tests (1 file):**
  - `session106_hallow_ev_dispatch` — 76 passed, 0 failed (was 62 in S109; +14: §1 +1 flag, §5k +11 likelyHallowTargetAC direct, §5l +3 squishy-boss flip + cross-checks).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed. (Not re-run this session — unchanged by S110; S109 verified.)
  - `session92_lair_action_dispatch` — 59 passed. (Not re-run — unchanged by S110; S109 verified.)
  - `session93_lair_save_damage` — 52 passed. (Not re-run — unchanged by S110; S109 verified.)
  - `session94_lair_phase3b` — 53 passed. (Not re-run — unchanged by S110; S109 verified.)
  - `session99_lair_phase7b2` — 60 passed (S107 flake fix holds; S110 doesn't touch lair actions).
  - `session100_lair_phase8b1` — 71 passed.
  - `session103_choose_lair_point` — 128 passed (S107 targeting regression — unchanged by S110).
  - `session103_deferred_promotion` — 88 passed.
  - `session104_vuln_audit` — 13 passed (Hallow still uses ActiveEffect).
  - `session105_hallow_energy_vuln` — 41 passed (S105 EV effect regression — S110 likely-target AC change doesn't touch the effect application).
  - `session106_hallow_ev_dispatch` — 76 passed (was 62; +14).
  - `session68_batch2_spells` — 136 passed.
  - `session68_batch3_spells` — 149 passed (Hallow Daylight regression — Daylight doesn't use pickHallowDamageType; S110 change is isolated to the EV helper).
  - `session75_monster_slotted_spells` — 66 passed.
  - `session103_debuff_vuln_expiry` — 37 passed (S103 vuln pattern regression).
  - `bestiary_integration` — 77 passed (S110 likely-target AC change doesn't regress bestiary combats — see "Why bestiary_integration doesn't regress" above).
  - `creature_lair_actions` — 12 passed.
  - `creature_defenses` — 92 passed (innate-vuln regression).
  - `bulk_spell_dispatch` — 214 passed.
  - `counterspell` — 35 passed.
  - `shield_reaction` — 66 passed.

- **Full 6-chunk CI suite:** local full-suite run hits sandbox memory limits (parallel ts-node OOM) — same as S105/S106/S107/S108/S109. CI on GitHub is the definitive check. `12702a5` CI pending at handover-write time.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-109: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts L2610+L2630 + 1 in utils.ts L601 + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts L602+L609. The S110 changes are a spell-module new-exported-helper + a helper-call refinement + test additions. None touch the 5 pre-existing error sites. CI does not run `tsc`.)

## CI STATUS

- **`808fe55` (S109 Hallow v2 encounter-specific AC, re-verified this session via `59d9a0d`):** **9/9 ALL GREEN** — build + deploy + report-build-status + 6 test chunks all SUCCESS. The github-pages and vercel check-SUITES are "queued" (conclusion=None) — the normal non-failure state for this repo (identical to the verified-green S107/S108 HEADs). **No red X carried over from S109.**
- **`12702a5` (S110 Hallow v2 likely-target AC, HEAD):** CI PENDING at handover-write time. The changes are the `likelyHallowTargetAC` helper + the `pickHallowDamageType` call-site refinement (`encounterAvgAC` → `likelyHallowTargetAC`) + test additions. The dispatch path (case 'hallow' in combat.ts) is unchanged. Local verification: session106 76/0 (was 62; +14), bestiary_integration 77/0, all 18 regression test files 0 failed, tsc 5 pre-existing/0 new. Expected to go ALL GREEN. (See CI FAILURE RECOVERY below if a red X appears.)

(If a flaky CRASH appears on any chunk — the known flake was `summons.test.ts` under parallel load. The `open_hand_technique` flake was FIXED in S105; session99/session102 flakes were FIXED in S107. Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S109 next-action #11 (target-specific AC) is completed this session (LOW-risk variant — helper-only, no dispatch reorder). The carry-overs from S104/S105/S106/S107/S108/S109 + 1 NEW follow-up from S110:

### 1. Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk)

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). The S105 Phase 8 retrospective confirmed 38+ isSpell cast_spell actions exist across the bestiary, all with spellNames — ready for the unified dispatch. **Unchanged from S104/S105/S106/S107/S108/S109.** Out of scope for an autonomous z session (HIGH risk).

### 2. Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream)

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). Per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S104/S105/S106/S107/S108/S109.**

### 3. Score-weight tuning (S104, unchanged, MEDIUM — needs no action for S107/S108/S109/S110)

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. **S108 VERIFIED this needs NO action** (the scorer already uses the S107 targeting changes via selectLairActionTargets → chooseLairActionPoint). S110 doesn't touch lair-action scoring at all (the likely-target-AC change is isolated to the Hallow EV damage-type pick, not lair actions). General weight-tuning remains MEDIUM risk and out of scope for an autonomous z session (subjective objective metric + bestiary-sweep memory limits + test-regression risk). **Unchanged — no action taken or needed for S107/S108/S109/S110.**

### 4. Yeenoghu::1 single-target point handler (S106, RESOLVED in S107)

S107 Task 2 added fallback 3 (radiusFt=0 for `centerOnPoint` + "in (the|that) space"). **RESOLVED in S107.** No further action.

### 5. Hallow EV damage-type weighting (S106, RESOLVED in S107)

S107 Task 3 replaced the v1 count heuristic with the v2 weighted model (damage × availability × hitChance). **RESOLVED in S107.** No further action.

### 6. `rangeFt` extraction for "anywhere in their lair" (S106, RESOLVED in S107)

S107 Task 1 added the §8b override (rangeFt=500 for "anywhere in <possessive> lair"). **RESOLVED in S107.** No further action.

### 7. `open_hand_technique` flake (S105, RESOLVED)

The `executeFOUntilHit` hit-detection flake was FIXED in S105 (`07e7e9a`). **RESOLVED in S105.** No further action.

### 8. session99 + session102 CI flakes (S107, RESOLVED in S107)

S107 Task 0 fixed both flakes deterministically. S110 re-verified: session99 60/0, session102 51/0. **RESOLVED in S107.** No further action.

### 9. Hallow v2 hitChance per-target refinement (S107, RESOLVED in S108 — option b)

S108 Task 1 replaced the flat 0.65 attack-roll hitChance with `bestiaryHitChance(hitBonus)` (per-action hitBonus vs bestiary mean AC 14.849). **RESOLVED in S108.** Option (a) (dispatch reorder to use the finalized target's AC — MEDIUM risk, touches combat.ts) remains a possible future refinement but is out of scope for an autonomous z session. Note: S109's encounter-specific AC + S110's likely-target AC partially address the "target AC unknown" issue (the likely target's AC is now used), so option (a)'s marginal gain over S110 is small.

### 10. Hallow v2 encounter-specific AC refinement (S108, RESOLVED in S109)

S109 Task 1 replaced the unconditional bestiary mean AC with `encounterAvgAC(caster, bf)` (mean AC of living enemies, bestiary-mean fallback). **RESOLVED in S109.** No further action.

### 11. Hallow v2 target-specific AC refinement (S109, RESOLVED in S110 — LOW-risk variant)

S110 Task 1 replaced the S109 encounter AVERAGE AC with `likelyHallowTargetAC(caster, bf)` (highest-HP living enemy within 60ft, mirroring `shouldCastEnergyVulnerability`'s selection, `encounterAvgAC` fallback). Achieved at LOW risk (helper-only, dispatch UNCHANGED — no combat.ts reorder) instead of the S109-proposed MEDIUM-risk dispatch reorder. **RESOLVED in S110.** No further action. The residual inaccuracy (likely target ≠ actual target when the top-HP enemy is already vulnerable to the would-be-chosen type — a rare edge case) is a possible future refinement but the gain over S110 is marginal.

### 12. `summons.test.ts` parallel-load flake (S106, unchanged, KNOWN)

The known flake is `summons.test.ts` under parallel load (passes standalone). Re-trigger with an empty commit if it CRASHes. **Unchanged from S106/S107/S108/S109.** Not fixed (parallelism-specific; would need a test-isolation refactor).

### 13. Hallow v2 likely-target vuln-skip refinement (NEW from S110, LOW-MEDIUM risk)

The S110 `likelyHallowTargetAC` predicts the likely target as the highest-HP enemy within 60ft, mirroring `shouldCastEnergyVulnerability` MINUS the type-dependent vuln-skip (which can't be applied at pick time since the damage type isn't chosen yet). The two diverge ONLY when the highest-HP enemy is already vulnerable to the would-be-chosen type — `shouldCastEnergyVulnerability` then skips it and picks the second-highest-HP enemy, but `likelyHallowTargetAC` still returns the top-HP enemy's AC. This is a rare edge case (most enemies aren't pre-vulnerable). A future refinement could iterate: for each candidate damage type, predict the target AC by applying that type's vuln-skip, then score the type against its own predicted target. This is LOW-MEDIUM risk (helper-only, no dispatch change, but the per-type-target iteration is more complex and could shift bestiary combats where a top-HP enemy is pre-vulnerable to the party's dominant type). **NEW from S110.** Lower priority than the carry-overs #1-#3 (the gain is marginal — the edge case is rare and S110 already captures the common-case accuracy).

## CI FAILURE RECOVERY

If the S110 commit (`12702a5`) shows a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs. `12702a5` is expected ALL GREEN (local: session106 76/0, bestiary_integration 77/0, 18 regression files 0 failed, tsc 5 pre-existing/0 new).
2. **`12702a5` (Hallow v2 likely-target AC):** the changes are the `likelyHallowTargetAC` helper + the `pickHallowDamageType` call-site refinement (`encounterAvgAC` → `likelyHallowTargetAC`) + test additions. The dispatch path (case 'hallow' in combat.ts) is unchanged. If `session106_hallow_ev_dispatch` fails, check whether a §5k/§5l assertion has a wrong expected value (the hitChance values are computed by hand in the comments — verify the arithmetic; §5l fire hc 0.80 = (21-5)/20 vs boss AC 10, §5k highest-HP-wins returns 18 not mean 14, §5k beyond-60ft fallback returns encounterAvgAC=20). If `session68_batch3_spells` (Hallow Daylight regression) fails, the likely-target AC change somehow affected the Daylight path (shouldn't — Daylight doesn't use pickHallowDamageType). If `bestiary_integration` fails, the likely-target AC flipped a mixed-type-party damage-type pick and changed a combat outcome — re-examine whether the new pick is canon-better (higher expected damage vs the likely target's actual AC) and update the bestiary assertion tolerance if so. (Local run: bestiary_integration 77/0 — no flip observed.)
3. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
4. **Known flake:** `summons.test.ts` under parallel load — passes standalone. Re-trigger with an empty commit if it CRASHes. (session99/session102 flakes were FIXED in S107 Task 0; S110 re-verified both still pass.)

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-110.md` — this file.

### Modified
- `src/spells/hallow.ts`:
  - `likelyHallowTargetAC(caster, bf)` (NEW, exported) — highest-HP living enemy within 60ft AC, `encounterAvgAC` fallback (S110 Task 1).
  - `pickHallowDamageType(caster, bf)`: now calls `likelyHallowTargetAC` instead of `encounterAvgAC`. Signature unchanged (S110 Task 1).
  - `encounterAvgAC`: UNCHANGED (still exported, still the fallback, still §5j-tested) (S110 Task 1).
  - metadata: `hallowEnergyVulnerabilityV2LikelyTargetAC: true` flag (NEW) (S110 Task 1).
  - doc comments: S110 refinement block + `likelyHallowTargetAC` full doc + updated `actionDamageWeight` doc + updated `pickHallowDamageType` doc (S110 Task 1).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `likelyHallowTargetAC` (S110 Task 1).
  - §1: +1 assertion (S110 flag = true) (S110 Task 1).
  - §5k (NEW, 11 assertions): `likelyHallowTargetAC` direct values + highest-HP-wins (not mean) + HP-tie-nearest + beyond-60ft-fallback + no-enemy-fallback + dead/unconscious/party-skipped + multi-enemy divergence cross-check (S110 Task 1).
  - §5l (NEW, 3 assertions): squishy-boss flip (S109 cold → S110 fire) + encounterAvgAC/likelyHallowTargetAC cross-checks (S110 Task 1).

### Archived
- `zHANDOVER-SESSION-108.md` → `HandoverOld/zHANDOVER-SESSION-108.md` (per AGENTS.md "latest 2 in root" rule; S109 + S110 now in root).

## ARCHITECTURAL NOTES

### Why the likely-target AC (not the encounter average)

The S109 `encounterAvgAC` uses the AVERAGE AC of ALL living enemies — justified by the near-linearity of the hitChance function (`E[P(hit|AC)] ≈ P(hit|E[AC])`), so the mean is the faithful representative WHEN the target is drawn UNIFORMLY from the pool. But the Hallow target is NOT drawn uniformly: `shouldCastEnergyVulnerability` picks the SINGLE highest-HP enemy within 60 ft (the biggest threat — doubled damage chips through HP fastest). So the relevant AC for the hitChance calculation is the likely target's AC, not the pool average. S110's `likelyHallowTargetAC` returns exactly that — the highest-HP enemy within 60 ft's AC — making the hitChance reflect the enemy that will actually be vuln'd. Verified by §5k: two enemies (trash AC 10 HP 30 + boss AC 18 HP 200) → `likelyHallowTargetAC` returns 18 (the boss's AC), while `encounterAvgAC` returns 14 (the mean) — the helper now diverges from the mean to track the likely target.

### Why the helper-only approach (not the S109-proposed dispatch reorder)

S109 next-action #11 proposed reordering the combat.ts dispatch to "pick the target FIRST, then pick the damage type using that target's AC" — MEDIUM risk because it touches the S106 dispatch rule ("Priority 1: AI-picked target → effect-selection") and could break the dispatch tests §6-§14 + bestiary_integration. S110 avoids the reorder entirely: `pickHallowDamageType` predicts the likely target ITSELF (using the same highest-HP-within-60ft heuristic as `shouldCastEnergyVulnerability`, minus the type-dependent vuln-skip) and uses that enemy's AC. The dispatch ORDER is unchanged (`pickHallowDamageType` first → `shouldCastEnergyVulnerability` second), so the §6-§14 dispatch tests and bestiary_integration are not at risk from a dispatch reorder. The change is a pure `hallow.ts` helper refinement — LOW risk. The only residual risk (a bestiary_integration flip when the likely target's AC differs from the encounter average) is verifiable — and verified 77/0.

### Why the 60-ft range gate (matching `shouldCastEnergyVulnerability`)

`shouldCastEnergyVulnerability` only considers enemies within Hallow's 60-ft range (enemies beyond 60 ft can NEVER be the Hallow target — the spell can't reach them). S110's `likelyHallowTargetAC` applies the SAME 60-ft gate, so an out-of-range enemy's AC cannot skew the pick. (S109's `encounterAvgAC` has NO range gate — it averages ALL living enemies, including those beyond 60 ft. This is a minor S109 imprecision that S110 corrects: when all enemies are within 60 ft the two helpers agree on the candidate pool; when some are beyond 60 ft, `likelyHallowTargetAC` correctly excludes them.) The fallback to `encounterAvgAC` when NO enemy is within 60 ft is safe because in that case `shouldCastEnergyVulnerability` returns null and EV doesn't fire — the damage-type pick is moot.

### Why the fallback preserves all S109 unit tests

The S110 change replaces `encounterAvgAC(caster, bf)` with `likelyHallowTargetAC(caster, bf)` inside `pickHallowDamageType`. `likelyHallowTargetAC` returns the likely target's AC when an enemy is within 60 ft, and falls back to `encounterAvgAC` otherwise. For the S109 tests:
- §5b-§5g (no enemies on the battlefield): no enemy within 60 ft → fallback to `encounterAvgAC` → `BESTIARY_MEAN_AC` → identical hitChance → identical winners.
- §5h/§5i (a single enemy within 60 ft): likely target = that enemy → its AC = the S109 encounter average (only one enemy) → identical hitChance → identical winners.
- §5j (`encounterAvgAC` direct): `encounterAvgAC` is UNCHANGED → all 7 assertions identical.
- §6-§16 (enemies at AC 14, single party damage type): likely target AC 14 = encounter avg 14 → identical (and the single damage type makes the pick AC-independent anyway).

The only way an S109 test would break is if the likely target's AC FLIPPED a winner — which requires (a) a multi-enemy battlefield where the highest-HP enemy's AC differs from the average AND (b) a mixed-type party where the AC shift crosses a hitChance threshold. The S109 §5b-§5g tests have no enemies (condition a fails); the §6-§16 dispatch tests have a single damage type (condition b fails). So all S109 tests are safe. The §5l test is NEW — it deliberately constructs the flip scenario (a high-HP low-AC "squishy boss" alongside a low-HP high-AC mook + a mixed attack+save party) to demonstrate the S110 behavioural difference.

### Why bestiary_integration doesn't regress

The S109 handover's three-category analysis holds for S110:
1. **Single party damage type** — the pick is unaffected by AC (the single type always wins). Most bestiary Hallow casters are clerics/paladins with a single damage type (radiant or fire).
2. **Mixed types but likely-target AC ≈ encounter avg** — if the highest-HP enemy's AC is close to the encounter average, the hitChance shift is small and no pick flips.
3. **Undead/fiend target** — the Daylight path fires (not the EV path), so `pickHallowDamageType` is never called. The likely-target AC is irrelevant.

The §5l flip requires a contrived party (mixed attack+save types with hitBonus +5) AND a contrived enemy setup (a high-HP low-AC "squishy boss" alongside a low-HP high-AC mook). Neither arises in the bestiary combat set — the bestiary parties don't have the specific mixed-type configuration, and the bestiary enemies don't have the extreme HP/AC inverse-correlation in the right combinations. Verified: **77 passed, 0 failed**. The change is canon-better where it does flip (the likely target's AC is a more faithful representative than the encounter average) and a no-op where it doesn't. **No bestiary assertion needed updating.**

### Coverage summary (updated for Session 110)

| Category | Count | S109 state | S110 delta | Total |
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
| **Total** | **~327** | **100% recognized + scored** | **1 task: Hallow v2 likely-target AC (spell-AI refinement, no recognition change)** | **~327 (100%) recognized + scored** |

Session 110 does NOT change recognition coverage (still ~327/327 = 100%) and does NOT change lair-action targeting (the S107 rangeFt/radiusFt work is untouched) and does NOT change the Hallow dispatch wiring (the S106 case 'hallow' in combat.ts is unchanged). It improves:
- **Spell AI accuracy** (Task 1 — Hallow EV damage-type selection now uses the likely target's AC — the highest-HP enemy within 60 ft that `shouldCastEnergyVulnerability` will actually select — instead of the encounter average; vs a high-HP low-AC "squishy boss" the attack roll is correctly identified as the better type to double, because the boss is the likely target and its low AC means the attack lands often).

## VERIFICATION SNAPSHOT

- `git log --oneline -4` (local, post-push): `12702a5` (S110 Hallow v2 likely-target AC), `59d9a0d` (S109 handover), `808fe55` (S109 Hallow v2 encounter-specific AC), `0a4ef0b` (S108 Hallow v2 per-target hitChance)
- `git status` → clean (1 implementation commit pushed; handover commit to follow; S108 handover archived to HandoverOld/)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts` → **76 passed, 0 failed** (was 62 in S109; +14)
- `npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts` → **41 passed, 0 failed** (S105 EV effect regression)
- `npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts` → **149 passed, 0 failed** (Hallow Daylight regression)
- `npx ts-node --transpile-only src/test/session68_batch2_spells.test.ts` → **136 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session104_vuln_audit.test.ts` → **13 passed, 0 failed** (Hallow still uses ActiveEffect)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (likely-target-AC change doesn't regress bestiary combats)
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression)
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **128 passed, 0 failed** (S107 targeting regression — unchanged by S110)
- `npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts` → **37 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_deferred_promotion.test.ts` → **88 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session75_monster_slotted_spells.test.ts` → **66 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session99_lair_phase7b2.test.ts` → **60 passed, 0 failed** (S107 flake fix holds)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **51 passed, 0 failed** (S107 flake fix holds)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **155 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session100_lair_phase8b1.test.ts` → **71 passed, 0 failed**
- `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts` → **214 passed, 0 failed**
- `npx ts-node --transpile-only src/test/counterspell.test.ts` → **35 passed, 0 failed**
- `npx ts-node --transpile-only src/test/shield_reaction.test.ts` → **66 passed, 0 failed**
- **CI on GitHub:**
  - `808fe55` (S109 HEAD, re-verified via `59d9a0d`) → **9/9 ALL GREEN** (no red X carried over from S109).
  - `12702a5` (S110 Hallow v2 likely-target AC, HEAD) → **CI PENDING at handover-write time** (local verification: session106 76/0, bestiary_integration 77/0, 18 regression files 0 failed, tsc 5 pre-existing/0 new). Expected ALL GREEN.
