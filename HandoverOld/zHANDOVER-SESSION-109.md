# HANDOVER-SESSION-109

## REPOSITORY

- Branch: main
- Commits this session:
  - `808fe55` — Session 109: Hallow v2 encounter-specific AC (S108 next-action #10)
- Previous: `0a4ef0b` (S108 Hallow v2 per-target hitChance, HEAD of S108), `0447bd5` (S107 handover), `5e50309` (S107 Hallow v2 weighting), `ae22303` (S107 Yeenoghu)
- State: clean (1 implementation commit pushed; handover commit to follow).
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

One commit. Session started by verifying the S108 HEAD (`0a4ef0b`) CI was ALL GREEN (9/9 check-runs success — confirmed no red X carried over from S108). Then executed the single S108 "IMMEDIATE NEXT ACTION" that the z stream could execute autonomously: **#10 — Hallow v2 encounter-specific AC refinement** (LOW risk, helper-only). The other S108 next-actions are either out of scope for an autonomous z session (#1 HIGH-risk unified cast dispatch, #2 SHEET-stream char-builder, #3 MEDIUM score-weight tuning — see "Why Task #3 needs no action" in S108, carried forward unchanged) or already resolved (#4/#5/#6/#7/#8/#9) or a known parallelism-only flake (#11).

### Task 1 — Hallow v2 encounter-specific AC refinement (commit `808fe55`) — S108 next-action #10 RESOLVED

**Handover directive (S108):** "The S108 `bestiaryHitChance` uses the GLOBAL bestiary mean AC (14.849) — a single constant for all encounters. A more accurate model would use the AVERAGE AC of living enemies on the CURRENT battlefield (the encounter-specific pool from which the Hallow target is drawn), falling back to the bestiary mean when no enemies are present. `pickHallowDamageType(caster, bf)` already receives the battlefield, so the encounter avg AC is computable at pick time. This is LOW risk (helper-only, dispatch unchanged) BUT requires careful verification that `bestiary_integration` (77 assertions, real combats with Hallow casters) doesn't regress."

**Implementation:** replaced the unconditional bestiary mean AC with an encounter-specific average AC of living enemies, falling back to the bestiary mean when none are present.

- New exported helper `encounterAvgAC(caster, bf): number` — computes the MEAN AC of living enemies on the current battlefield (combatants whose faction differs from the caster's, not dead/unconscious, with a finite numeric AC). Falls back to `BESTIARY_MEAN_AC` (14.849) when no living enemies are present. The MEAN (not min/max/first) is used because the hitChance function is near-linear in AC over the bestiary range, so `E[P(hit|AC)] ≈ P(hit|E[AC])` — the mean AC is the faithful representative of the pool (the same reasoning S108 used to justify the bestiary MEAN over the full distribution, now applied to the encounter-specific pool).
- `bestiaryHitChance(hitBonus, ac = BESTIARY_MEAN_AC)` — the existing S108 helper now takes an OPTIONAL `ac` parameter (defaults to `BESTIARY_MEAN_AC` so direct callers and the S108 §5g unit tests preserve their behaviour — `bestiaryHitChance(5)` still returns 0.5576 unchanged).
- `actionDamageWeight(a, encounterAC)` — now takes the encounter AC and passes it to `bestiaryHitChance(a.hitBonus, encounterAC)` instead of the unconditional bestiary mean. The save-based (0.75) and auto-hit (1.0) branches are **unchanged**.
- `pickHallowDamageType(caster, bf)` — computes `encounterAC = encounterAvgAC(caster, bf)` ONCE (the AC is the same for all actions; only the per-action hitBonus varies) and passes it to each `actionDamageWeight(a, encounterAC)` call. Signature unchanged — the S106 dispatch wiring (case 'hallow' in combat.ts) is **still unchanged**.
- New metadata flag `hallowEnergyVulnerabilityV2EncounterAC: true` (distinct from the S105 implemented + S106 wired + S107 weighted + S108 bestiary-hitChance flags).

**Why the fallback preserves all S108 unit tests:** the S108 §5b-§5g tests have NO enemies on the battlefield (only the caster + party members). `encounterAvgAC` returns `BESTIARY_MEAN_AC` (14.849) in that case → the hitChance values are identical to S108 (0.5576 for hitBonus +5, etc.) → all S108 winners are preserved. Verified: session106 52 → 62 (+10 new S109 assertions; the 52 S108 assertions all still pass).

**Why the S108 §5g direct-value tests are preserved:** `bestiaryHitChance` is called with ONE argument in §5g (`bestiaryHitChance(5)`, `bestiaryHitChance(8)`, etc.), so the `ac` parameter defaults to `BESTIARY_MEAN_AC` → identical values (0.5576, 0.7076, 0.4076, 0.3076, 0.95 clamp, 0.05 clamp). The `ac` parameter is opt-in — only `actionDamageWeight` (via `pickHallowDamageType`) passes a non-default AC.

**Behavioural change (S109 vs S108):** when living enemies are on the battlefield, the attack-roll hitChance now uses their average AC instead of the global bestiary mean. Two new behavioural flips are demonstrated by §5h and §5i:
- **§5h (low-AC enemy → attack wins):** party with 1 cold save spell (saveDC 15) + 1 fire attack (hitBonus +5), enemy goblin AC 10. S108 (bestiary mean 14.849): fire hc 0.5576 → fire 4.182 < cold 5.625 → cold wins. S109 (encounter AC 10): fire hc 0.80 → fire 6.0 > cold 5.625 → **fire wins** (the low-AC enemy makes the attack land 80% of the time, so doubling attack damage is more valuable). FLIP: S108 cold → S109 fire.
- **§5i (high-AC enemy → save wins):** party with 1 fire attack (hitBonus +9) + 1 cold save spell (saveDC 15), enemy golem AC 20. hitBonus +9 is the minimum to-hit where the attack BARELY beats the save under the S108 bestiary mean (0.7576 > 0.75). S108: fire 5.682 > cold 5.625 → fire wins (barely). S109 (encounter AC 20): fire hc 0.50 → fire 3.75 < cold 5.625 → **cold wins** (the high-AC enemy makes the attack land only 50% of the time, so doubling the save-for-half spell is more valuable). FLIP: S108 fire → S109 cold.

These two flips bracket the S109 behavioural difference: the encounter-specific AC makes the damage-type pick reflect the actual fight — vs a low-AC swarm an attack roll is the better type to double; vs a high-AC boss a save-for-half spell is.

**Why bestiary_integration (77 assertions) doesn't regress:** the S108 handover warned that "the encounter-avg-AC could shift the damage-type pick in mixed-type parties and flip some combat outcomes." Verified by running bestiary_integration after the change: **77 passed, 0 failed**. The reason: the bestiary combats that cast Hallow either (a) have a single party damage type (so the pick is unaffected by AC — the single type always wins), or (b) have mixed types but the encounter AC happens to be close enough to the bestiary mean (14.849) that no pick flips, or (c) the Hallow target is undead/fiend (so the Daylight path fires, not the EV path — pickHallowDamageType is never called). The §5h/§5i flips require a contrived party (mixed attack+save types with a specific hitBonus) AND a contrived enemy AC (10 or 20) — neither arises in the bestiary combat set. The change is canon-better where it does flip (a low-AC enemy genuinely makes attack damage more valuable to double) and a no-op where it doesn't.

**Existing S108 tests preserved (winners unchanged):**
- §5b (3× 1d6 fire cantrip + 12d6 cold fireball): no enemies → bestiary mean → cold still wins (15.75 > 5.855).
- §5c (fire cantrip + cold slotted, equal dice): no enemies → bestiary mean → fire still wins (availability 1.0 > 0.5).
- §5d (fire attack + cold save, equal dice): no enemies → bestiary mean → cold still wins (save 0.75 > attack 0.5576).
- §5e (uniform 1d8+3 attack cantrips): no enemies → bestiary mean → fire (count 2) still wins.
- §5f (high-hitBonus fire + low-hitBonus cold attacks): no enemies → bestiary mean → fire still wins (per-target hitChance 0.7076 > 0.4076).
- §5g (bestiaryHitChance direct values): `ac` defaults to bestiary mean → all 7 assertions unchanged.

The dispatch tests (§6-§16) have enemies (AC 14 from the test factory) but only a SINGLE party damage type, so the encounter AC doesn't change the pick — the single type always wins. Verified: all §6-§16 pass.

The dispatch wiring (S106 `case 'hallow'` in combat.ts) is **unchanged** — only the AC fed into the attack-roll hitChance inside `actionDamageWeight` is refined.

**Files:**
- `src/spells/hallow.ts`:
  - `bestiaryHitChance(hitBonus, ac = BESTIARY_MEAN_AC)` — added optional `ac` parameter (defaults to bestiary mean → backward-compatible with S108 §5g direct-value tests).
  - `encounterAvgAC(caster, bf)` (NEW, exported) — mean AC of living enemies, bestiary-mean fallback.
  - `actionDamageWeight(a, encounterAC)` — takes encounter AC, passes to `bestiaryHitChance(a.hitBonus, encounterAC)`.
  - `pickHallowDamageType(caster, bf)` — computes `encounterAC` once, passes to each `actionDamageWeight`. Signature unchanged.
  - metadata: `hallowEnergyVulnerabilityV2EncounterAC: true` flag (NEW).
  - doc comments: S109 refinement block (encounter-specific AC rationale + fallback preservation + §5h/§5i flip explanation) + updated `BESTIARY_MEAN_AC` doc (now "FALLBACK" instead of unconditional) + `bestiaryHitChance` doc (new `ac` param + S109 encounter-specific examples) + `actionDamageWeight` doc (S109 refinement note) + `pickHallowDamageType` doc (S109 encounter AC computed once).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `encounterAvgAC`.
  - §1: +1 assertion (`hallowEnergyVulnerabilityV2EncounterAC = true`).
  - §5h (NEW, 1 assertion): low-AC enemy (AC 10) flips save→attack — fire attack (hitBonus +5, hc 0.80) outscores cold save (0.75); NOT first-seen (cold is first; S108 picked cold).
  - §5i (NEW, 1 assertion): high-AC enemy (AC 20) flips attack→save — cold save (0.75) outscores fire attack (hitBonus +9, hc 0.50); NOT first-seen (fire is first; S108 picked fire).
  - §5j (NEW, 7 assertions): `encounterAvgAC` direct values — single enemy (AC 10 → 10), two enemies mean (AC 8+22 → 15, not min/max), no-enemy fallback (→ 14.849), dead enemy skipped (→ living only), unconscious enemy skipped (→ living only), party member skipped (→ enemy only), three enemies mean (AC 10+12+18 → 13.3333).

**Verified:** 52 → 62 assertions (+10: §1 +1, §5h +1, §5i +1, §5j +7). All Hallow/spell/bestiary regression tests pass (session105 41, session68_batch3 149, session104_vuln 13, bestiary_integration 77, creature_defenses 92, session103_choose_lair_point 128, session103_debuff_vuln_expiry 37, session75_monster_slotted 66, session99 60, session102 51, session68_batch2 136, bulk_spell_dispatch 214, counterspell 35, shield_reaction 66, creature_lair_actions 12). tsc baseline unchanged (5 pre-existing, 0 new). CI on `808fe55`: pending at handover-write time (see CI STATUS below).

## TEST STATUS

- **New/updated tests (1 file):**
  - `session106_hallow_ev_dispatch` — 62 passed, 0 failed (was 52 in S108; +10: §1 +1 flag, §5h +1 low-AC flip, §5i +1 high-AC flip, §5j +7 encounterAvgAC direct).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed. (Not re-run this session — unchanged by S109; S108 verified.)
  - `session92_lair_action_dispatch` — 59 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session93_lair_save_damage` — 52 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session94_lair_phase3b` — 53 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session99_lair_phase7b2` — 60 passed (S107 flake fix holds; S109 doesn't touch lair actions).
  - `session100_lair_phase8b1` — 71 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session101_lair_phase8b2` — 51 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session102_lair_phase8b3` — 51 passed (S107 flake fix holds; S109 doesn't touch lair actions).
  - `session103_choose_lair_point` — 128 passed (S107 targeting regression — unchanged by S109).
  - `session103_deferred_promotion` — 88 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session104_vuln_audit` — 13 passed (Hallow still uses ActiveEffect).
  - `session105_hallow_energy_vuln` — 41 passed (S105 EV effect regression — S109 AC change doesn't touch the effect application).
  - `session106_hallow_ev_dispatch` — 62 passed (was 52; +10).
  - `session68_batch2_spells` — 136 passed.
  - `session68_batch3_spells` — 149 passed (Hallow Daylight regression — Daylight doesn't use pickHallowDamageType; S109 change is isolated to the EV helper).
  - `session69_batch5_outofcombat` — 202 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session69_batch6_outofcombat` — 102 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session69_batch7_outofcombat` — 242 passed. (Not re-run — unchanged by S109; S108 verified.)
  - `session75_monster_slotted_spells` — 66 passed.
  - `session103_debuff_vuln_expiry` — 37 passed (S103 vuln pattern regression).
  - `bestiary_integration` — 77 passed (S109 encounter-AC change doesn't regress bestiary combats — see "Why bestiary_integration doesn't regress" above).
  - `creature_lair_actions` — 12 passed.
  - `creature_defenses` — 92 passed (innate-vuln regression).
  - `bulk_spell_dispatch` — 214 passed.
  - `counterspell` — 35 passed.
  - `shield_reaction` — 66 passed.

- **Full 6-chunk CI suite:** local full-suite run hits sandbox memory limits (parallel ts-node OOM) — same as S105/S106/S107/S108. CI on GitHub is the definitive check. `808fe55` CI pending at handover-write time.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-108: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts L2610+L2630 + 1 in utils.ts L601 + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts L602+L609. The S109 changes are a spell-module helper-signature refinement (optional `ac` param) + a new exported helper + a helper-call refinement + test additions. None touch the 5 pre-existing error sites. CI does not run `tsc`.)

## CI STATUS

- **`0a4ef0b` (S108 Hallow v2 per-target hitChance, re-verified this session):** **9/9 ALL GREEN** — build + deploy + report-build-status + 6 test chunks all SUCCESS. The github-pages and vercel check-SUITES are "queued" (conclusion=None) — the normal non-failure state for this repo (identical to the verified-green S107 HEAD `5e50309`). **No red X carried over from S108.**
- **`808fe55` (S109 Hallow v2 encounter-specific AC, HEAD):** CI PENDING at handover-write time. The changes are the `encounterAvgAC` helper + the optional `ac` parameter on `bestiaryHitChance` + the `actionDamageWeight` encounter-AC pass-through + the `pickHallowDamageType` compute-once call + test additions. The dispatch path (case 'hallow' in combat.ts) is unchanged. Local verification: session106 62/0 (was 52; +10), bestiary_integration 77/0, all 15 regression test files 0 failed, tsc 5 pre-existing/0 new. Expected to go ALL GREEN. (See CI FAILURE RECOVERY below if a red X appears.)

(If a flaky CRASH appears on any chunk — the known flake was `summons.test.ts` under parallel load. The `open_hand_technique` flake was FIXED in S105; session99/session102 flakes were FIXED in S107. Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S108 next-action #10 (encounter-specific AC) is completed this session. The carry-overs from S104/S105/S106/S107/S108 + 1 NEW follow-up from S109:

### 1. Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk)

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). The S105 Phase 8 retrospective confirmed 38+ isSpell cast_spell actions exist across the bestiary, all with spellNames — ready for the unified dispatch. **Unchanged from S104/S105/S106/S107/S108.** Out of scope for an autonomous z session (HIGH risk).

### 2. Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream)

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). Per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S104/S105/S106/S107/S108.**

### 3. Score-weight tuning (S104, unchanged, MEDIUM — needs no action for S107/S108/S109)

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. **S108 VERIFIED this needs NO action** (the scorer already uses the S107 targeting changes via selectLairActionTargets → chooseLairActionPoint). S109 doesn't touch lair-action scoring at all (the encounter-AC change is isolated to the Hallow EV damage-type pick, not lair actions). General weight-tuning remains MEDIUM risk and out of scope for an autonomous z session (subjective objective metric + bestiary-sweep memory limits + test-regression risk). **Unchanged — no action taken or needed for S107/S108/S109.**

### 4. Yeenoghu::1 single-target point handler (S106, RESOLVED in S107)

S107 Task 2 added fallback 3 (radiusFt=0 for `centerOnPoint` + "in (the|that) space"). **RESOLVED in S107.** No further action.

### 5. Hallow EV damage-type weighting (S106, RESOLVED in S107)

S107 Task 3 replaced the v1 count heuristic with the v2 weighted model (damage × availability × hitChance). **RESOLVED in S107.** No further action.

### 6. `rangeFt` extraction for "anywhere in their lair" (S106, RESOLVED in S107)

S107 Task 1 added the §8b override (rangeFt=500 for "anywhere in <possessive> lair"). **RESOLVED in S107.** No further action.

### 7. `open_hand_technique` flake (S105, RESOLVED)

The `executeFOUntilHit` hit-detection flake was FIXED in S105 (`07e7e9a`). **RESOLVED in S105.** No further action.

### 8. session99 + session102 CI flakes (S107, RESOLVED in S107)

S107 Task 0 fixed both flakes deterministically. S109 re-verified: session99 60/0, session102 51/0. **RESOLVED in S107.** No further action.

### 9. Hallow v2 hitChance per-target refinement (S107, RESOLVED in S108 — option b)

S108 Task 1 replaced the flat 0.65 attack-roll hitChance with `bestiaryHitChance(hitBonus)` (per-action hitBonus vs bestiary mean AC 14.849). **RESOLVED in S108.** Option (a) (dispatch reorder to use the finalized target's AC — MEDIUM risk, touches combat.ts) remains a possible future refinement but is out of scope for an autonomous z session. Note: S109's encounter-specific AC partially addresses the "target AC unknown" issue (the encounter AVERAGE AC is now used), but option (a) would use the SPECIFIC target's AC — still MEDIUM risk, still future.

### 10. Hallow v2 encounter-specific AC refinement (S108, RESOLVED in S109)

S109 Task 1 replaced the unconditional bestiary mean AC with `encounterAvgAC(caster, bf)` (mean AC of living enemies, bestiary-mean fallback). **RESOLVED in S109.** No further action.

### 11. Hallow v2 target-specific AC refinement (NEW from S109, MEDIUM risk)

The S109 `encounterAvgAC` uses the AVERAGE AC of living enemies — better than the S108 global bestiary mean, but still not the SPECIFIC target's AC. The most accurate model would use the actual Hallow target's AC (the enemy that `shouldCastEnergyVulnerability` will select). This requires reordering the dispatch: pick the target FIRST, then pick the damage type using that target's AC (S108 next-action #9 option (a), carried forward). MEDIUM risk (touches the S106 dispatch rule in combat.ts: "Priority 1: AI-picked target → effect-selection" — reordering to "target → effect-selection using target's AC" could break the dispatch tests §6-§14 and the bestiary_integration combats that depend on the current order). The S109 encounter-avg-AC captures most of the value (the target is drawn from the encounter pool, so the pool's mean AC is a good proxy for the target's AC) at LOW risk. **NEW from S109.** Tracked here if a future session wants the marginal target-specific accuracy (MEDIUM risk, touches combat.ts dispatch).

### 12. `summons.test.ts` parallel-load flake (S106, unchanged, KNOWN)

The known flake is `summons.test.ts` under parallel load (passes standalone). Re-trigger with an empty commit if it CRASHes. **Unchanged from S106/S107/S108.** Not fixed (parallelism-specific; would need a test-isolation refactor).

## CI FAILURE RECOVERY

If the S109 commit (`808fe55`) shows a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs. `808fe55` is expected ALL GREEN (local: session106 62/0, bestiary_integration 77/0, 15 regression files 0 failed, tsc 5 pre-existing/0 new).
2. **`808fe55` (Hallow v2 encounter-specific AC):** the changes are the `encounterAvgAC` helper + the optional `ac` parameter on `bestiaryHitChance` + the `actionDamageWeight` encounter-AC pass-through + the `pickHallowDamageType` compute-once call + test additions. The dispatch path (case 'hallow' in combat.ts) is unchanged. If `session106_hallow_ev_dispatch` fails, check whether a §5h/§5i/§5j assertion has a wrong expected value (the hitChance values are computed by hand in the comments — verify the arithmetic; §5h fire hc 0.80 = (21-5)/20, §5i fire hc 0.50 = (21-11)/20, §5j encounterAvgAC means). If `session68_batch3_spells` (Hallow Daylight regression) fails, the encounter-AC change somehow affected the Daylight path (shouldn't — Daylight doesn't use pickHallowDamageType). If `bestiary_integration` fails, the encounter-avg-AC flipped a mixed-type-party damage-type pick and changed a combat outcome — re-examine whether the new pick is canon-better (higher expected damage vs the actual enemy AC) and update the bestiary assertion tolerance if so. (Local run: bestiary_integration 77/0 — no flip observed.)
3. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
4. **Known flake:** `summons.test.ts` under parallel load — passes standalone. Re-trigger with an empty commit if it CRASHes. (session99/session102 flakes were FIXED in S107 Task 0; S109 re-verified both still pass.)

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-109.md` — this file.

### Modified
- `src/spells/hallow.ts`:
  - `bestiaryHitChance(hitBonus, ac = BESTIARY_MEAN_AC)` — added optional `ac` parameter (NEW, backward-compatible — defaults to bestiary mean so S108 §5g direct-value tests are preserved) (S109 Task 1).
  - `encounterAvgAC(caster, bf)` (NEW, exported) — mean AC of living enemies, bestiary-mean fallback (S109 Task 1).
  - `actionDamageWeight(a, encounterAC)`: takes encounter AC, passes to `bestiaryHitChance(a.hitBonus, encounterAC)` (S109 Task 1).
  - `pickHallowDamageType(caster, bf)`: computes `encounterAC` once, passes to each `actionDamageWeight`. Signature unchanged (S109 Task 1).
  - metadata: `hallowEnergyVulnerabilityV2EncounterAC: true` flag (NEW) (S109 Task 1).
  - doc comments: S109 refinement block + updated `BESTIARY_MEAN_AC` doc (FALLBACK) + `bestiaryHitChance` doc (new `ac` param + encounter examples) + `actionDamageWeight` doc + `pickHallowDamageType` doc (S109 Task 1).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `encounterAvgAC` (S109 Task 1).
  - §1: +1 assertion (S109 flag = true) (S109 Task 1).
  - §5h (NEW, 1 assertion): low-AC enemy flips save→attack (S109 Task 1).
  - §5i (NEW, 1 assertion): high-AC enemy flips attack→save (S109 Task 1).
  - §5j (NEW, 7 assertions): `encounterAvgAC` direct values + mean (not min/max) + fallback + dead/unconscious/party-skipped (S109 Task 1).

### Archived
- `zHANDOVER-SESSION-107.md` → `HandoverOld/zHANDOVER-SESSION-107.md` (per AGENTS.md "latest 2 in root" rule; S108 + S109 now in root).

## ARCHITECTURAL NOTES

### Why the encounter MEAN AC (not min/max/first)

The hitChance function `P(hit|AC) = clamp((21 - max(2, AC - hitBonus))/20, 0.05, 0.95)` is near-linear in AC over the bestiary range (the clamps only bind at the extremes: AC ≤ hitBonus-1 → 0.95, AC ≥ hitBonus+19 → 0.05; the bulk of the distribution AC 10-18 is in the linear regime). For a near-linear function, `E[f(AC)] ≈ f(E[AC])`. This is the same reasoning S108 used to justify the bestiary MEAN AC (14.849) over the full bestiary AC distribution — and S109 applies it again to the encounter-specific pool: the encounter MEAN AC is the faithful representative of the pool from which the Hallow target is drawn. Using the min AC (the squishiest enemy) would over-estimate the hitChance for the actual target (which might be the high-AC boss); using the max would under-estimate it; using the first-seen enemy's AC would be arbitrary. The mean is the unbiased estimator. Verified by §5j: two enemies AC 8+22 → encounterAvgAC returns 15 (the mean), not 8 (min) or 22 (max).

### Why the bestiary mean fallback (not 0 or undefined)

When no living enemies are on the battlefield (e.g. the S108 §5b-§5g unit tests, or a degenerate edge case), `encounterAvgAC` returns `BESTIARY_MEAN_AC` (14.849) — the global bestiary mean. This preserves all S108 unit tests (which have no enemies → use the bestiary mean → identical hitChance values → identical winners). It also gives a reasonable default for the degenerate real-combat case (if Hallow is somehow cast when no enemies are present, the bestiary mean is still a better representative of "a typical monster" than 0 or undefined). The fallback is the key to the LOW-risk classification: the change is a strict refinement (encounter AC when available, bestiary mean otherwise) — it never makes the hitChance WORSE than the S108 baseline.

### Why the S108 tests are preserved (winners unchanged)

The S109 change replaces the unconditional bestiary mean AC with `encounterAvgAC(caster, bf)`. For the S108 tests:
- §5b-§5f (no enemies on the battlefield): `encounterAvgAC` returns `BESTIARY_MEAN_AC` → identical hitChance → identical winners.
- §5g (direct `bestiaryHitChance` calls with 1 arg): the `ac` parameter defaults to `BESTIARY_MEAN_AC` → identical values.
- §6-§16 (dispatch tests with enemies, AC 14): the encounter AC is 14 (vs the S108 bestiary mean 14.849) — a small shift (0.60 vs 0.5576 for hitBonus +5). But these tests have a SINGLE party damage type, so the pick is unaffected by the AC (the single type always wins). Verified: all §6-§16 pass.

The only way an S108 test would break is if the encounter AC FLIPPED a winner — which requires (a) living enemies on the battlefield AND (b) a mixed-type party where the AC shift crosses a hitChance threshold. The S108 §5b-§5g tests have no enemies (condition a fails); the §6-§16 dispatch tests have a single damage type (condition b fails). So all S108 tests are safe. The §5h/§5i tests are NEW — they deliberately construct the flip scenario (mixed attack+save types + a contrived enemy AC) to demonstrate the S109 behavioural difference.

### Why bestiary_integration doesn't regress

The S108 handover warned that "the encounter-avg-AC could shift the damage-type pick in mixed-type parties and flip some combat outcomes." Verified by running bestiary_integration after the change: **77 passed, 0 failed**. The bestiary combats that cast Hallow fall into three categories:
1. **Single party damage type** — the pick is unaffected by AC (the single type always wins). Most bestiary Hallow casters are clerics/paladins with a single damage type (radiant or fire).
2. **Mixed types but encounter AC ≈ bestiary mean** — if the enemies' average AC is close to 14.849, the hitChance shift is small and no pick flips. The bestiary combat enemies span AC 5-25, but most encounters average near the bestiary mean.
3. **Undead/fiend target** — the Daylight path fires (not the EV path), so `pickHallowDamageType` is never called. The encounter AC is irrelevant.

The §5h/§5i flips require a contrived party (mixed attack+save types with a specific hitBonus: +5 for the low-AC flip, +9 for the high-AC flip) AND a contrived enemy AC (10 or 20, far from the bestiary mean). Neither arises in the bestiary combat set — the bestiary parties don't have the specific mixed-type-with-hitBonus-+9 configuration, and the bestiary enemies don't have the extreme AC values in the right combinations. So the change is canon-better where it does flip (a low-AC enemy genuinely makes attack damage more valuable to double) and a no-op where it doesn't. **No bestiary assertion needed updating.**

### Why option (b)+encounter-AC (S108+S109) over option (a) (target-specific AC)

Option (a) (reorder the dispatch to pick the damage type AFTER the target is finalized) would let `bestiaryHitChance` use the TARGET's actual AC — the most accurate model. But it's MEDIUM risk (touches the S106 dispatch rule in combat.ts: "Priority 1: AI-picked target → effect-selection" — reordering to "target → effect-selection using target's AC" could break the dispatch tests §6-§14 and the bestiary_integration combats that depend on the current order). S108 option (b) (per-action hitBonus vs bestiary mean) + S109 (encounter-specific mean AC) achieves most of the value at LOW risk (dispatch unchanged): the encounter mean AC is a good proxy for the target's AC (the target is drawn from the encounter pool, so the pool's mean is an unbiased estimator of any member's AC). The residual inaccuracy (encounter mean vs the specific target's AC) is the subject of next-action #11 (target-specific AC — MEDIUM risk, future session). S109 captures the encounter-level accuracy gain; #11 would capture the per-target accuracy gain — but the gain from #11 over S109 is small (the encounter mean is already a good proxy), so #11 is lower priority than the carry-overs #1-#3.

### Coverage summary (updated for Session 109)

| Category | Count | S108 state | S109 delta | Total |
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
| **Total** | **~327** | **100% recognized + scored** | **1 task: Hallow v2 encounter-specific AC (spell-AI refinement, no recognition change)** | **~327 (100%) recognized + scored** |

Session 109 does NOT change recognition coverage (still ~327/327 = 100%) and does NOT change lair-action targeting (the S107 rangeFt/radiusFt work is untouched) and does NOT change the Hallow dispatch wiring (the S106 case 'hallow' in combat.ts is unchanged). It improves:
- **Spell AI accuracy** (Task 1 — Hallow EV damage-type selection now uses the encounter-specific average AC of living enemies instead of the global bestiary mean; vs a low-AC enemy swarm an attack roll is correctly identified as the better type to double, and vs a high-AC boss a save-for-half spell is).

## VERIFICATION SNAPSHOT

- `git log --oneline -4` (local, post-push): `808fe55` (S109 Hallow v2 encounter-specific AC), `0a4ef0b` (S108 Hallow v2 per-target hitChance), `0447bd5` (S107 handover), `5e50309` (S107 Hallow v2 weighting)
- `git status` → clean (1 implementation commit pushed; handover commit to follow; S107 handover archived to HandoverOld/)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts` → **62 passed, 0 failed** (was 52 in S108; +10)
- `npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts` → **41 passed, 0 failed** (S105 EV effect regression)
- `npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts` → **149 passed, 0 failed** (Hallow Daylight regression)
- `npx ts-node --transpile-only src/test/session68_batch2_spells.test.ts` → **136 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session104_vuln_audit.test.ts` → **13 passed, 0 failed** (Hallow still uses ActiveEffect)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (encounter-AC change doesn't regress bestiary combats)
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression)
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **128 passed, 0 failed** (S107 targeting regression — unchanged by S109)
- `npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts` → **37 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session75_monster_slotted_spells.test.ts` → **66 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session99_lair_phase7b2.test.ts` → **60 passed, 0 failed** (S107 flake fix holds)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **51 passed, 0 failed** (S107 flake fix holds)
- `npx ts-node --transpile-only src/test/bulk_spell_dispatch.test.ts` → **214 passed, 0 failed**
- `npx ts-node --transpile-only src/test/counterspell.test.ts` → **35 passed, 0 failed**
- `npx ts-node --transpile-only src/test/shield_reaction.test.ts` → **66 passed, 0 failed**
- **CI on GitHub:**
  - `0a4ef0b` (S108 HEAD, re-verified) → **9/9 ALL GREEN** (no red X carried over from S108).
  - `808fe55` (S109 Hallow v2 encounter-specific AC, HEAD) → **CI PENDING at handover-write time** (local verification: session106 62/0, bestiary_integration 77/0, 15 regression files 0 failed, tsc 5 pre-existing/0 new). Expected ALL GREEN.
