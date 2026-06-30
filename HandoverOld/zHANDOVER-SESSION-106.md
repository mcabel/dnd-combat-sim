# HANDOVER-SESSION-106

## REPOSITORY

- Branch: main
- Commits this session:
  - `4a4fc3a` — Session 106: Hallow Energy Vulnerability AI dispatch wiring (S105 next-action #6)
  - `82db159` — Session 106: radiusFt extraction extension (S105 next-action #5b)
  - `92a3e64` — Session 106: BORDERLINE centerOnPoint cases (S105 next-action #5a)
- Previous: `7681d12` (S105 handover), `f816681` (S105 retrospective), `1a14258` (S105 Hallow), `cec7b39` (S105 centerOnPoint), `07e7e9a` (S105 flake fix)
- State: clean (3 commits pushed; CI on `4a4fc3a` pending at handover-write time — build + deploy + report-build-status = SUCCESS, 6 test chunks in progress, 0 failures so far. `92a3e64` + `82db159` have 0 check-runs because GitHub Actions only runs on the HEAD commit of a push.)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Three tasks completed this session, each as a separate commit. All 3 are S105 "IMMEDIATE NEXT ACTIONS" that the z stream could execute (the other S105 next-actions are either SHEET-stream territory or HIGH-risk). Session started by confirming the S105 handover commit (`7681d12`) was ALL GREEN on CI (9/9 success) — no red X to fix.

### Task A — BORDERLINE `centerOnPoint` cases (commit `92a3e64`) — S105 next-action #5a RESOLVED

**Handover directive (S105):** "The 4 BORDERLINE cases (Imix::1, Ogrémoch::0/::1, Olhydra::2) use 'a N-foot-radius sphere/area within N feet of [creature]' — mechanically point-selection (the AoE is placed within range, NOT centered on self) but the text omits the 'chooses/can see' qualifier. S105 left these on v1 (conservative). A future session can revisit with more context — flipping them requires confidence that 'within N feet of [creature]' means 'placed within range' (point-selection) not 'extends N feet from [creature]' (self-centered)."

**Audit (S106):** The 4 BORDERLINE cases all have TWO distinct distances (radius N + range M, N < M):
- Imix::1 — "40-foot-radius sphere within 120 feet of Imix" (radius=40, range=120)
- Ogrémoch::0 — "10-foot-radius area of rocky or earthy ground within 60 feet of Ogrémoch" (radius=10, range=60)
- Ogrémoch::1 — "20-foot-radius area within 60 feet of Ogrémoch" (radius=20, range=60)
- Olhydra::2 — "40-foot-radius sphere within 120 feet of Olhydra" (radius=40, range=120)

The S106 audit confirmed these are unambiguous point-selection: the N-foot-radius AoE is PLACED at a point within M feet of the creature (the creature chooses where). The distinction from centered-on-self: centered-on-self has ONE distance ("N-foot-radius around [creature]" / "within N feet of [creature]" with no separate radius). The 4 BORDERLINE cases have BOTH a radius AND a separate "within M feet of" range — two distances = point-placement.

**Regex broadened:** `centerOnPoint` now matches (3rd alternation, S106 NEW):
`/(?:\d+[- ]?(?:foot|feet)[- ]?radius)[^.]*?\bwithin\s+\d+\s+feet\s+of\b/i`
This catches "N-foot-radius ... within M feet of" (same sentence, no period between). The `[^.]*?` ensures the radius and range are in the same sentence (avoids matching actions where the radius is in one sentence and "within M feet" in a different context).

**Verified 0 false-positives:** scanned all 10 remaining `radiusFt && !centerOnPoint` actions — 5 centered-on-self ("around [creature]") + 1 ambiguous (Gar Shatterkeel::1) all LACK the "within M feet of" range clause. None match the new alternation. Post-S106: 26 `centerOnPoint=true` actions (12 "centered on a point" + 10 "a point ... chooses/can see" + 4 BORDERLINE).

**Behavioural change (2 executed cases):**
- Ogrémoch::0 (save_condition, radiusFt=10, rangeFt=60) — now uses `chooseLairActionPoint`. For spread enemies beyond 10ft of any chosen centre, hits FEWER targets than v1 (canon-accurate — the 10ft-radius AoE can't reach both spread enemies).
- Ogrémoch::1 (damage_no_save, radiusFt=20, rangeFt=60) — same, now uses point-selection.
- Imix::1 + Olhydra::2 are `category=deferred` (logged, not executed) — the flag is semantically correct but has no behavioural impact (not executed). Future-proofs for when deferred actions get mechanical handlers.

**Files:**
- `src/parser/fivetools.ts` — `centerOnPoint`: added the 3rd BORDERLINE alternation. Updated the doc comment (S106 audit findings, the 4 cases, the 2-distances rationale, 0 false-positives, new count: 26).
- `src/test/session103_choose_lair_point.test.ts` — §1: +12 assertions (4 BORDERLINE × 3 fields: centerOnPoint, radiusFt, rangeFt). §16 (NEW): +8 assertions behavioural test on real Ogrémoch::0 (spread → 1 target; clustered → 2 targets).

**Verified:** 65 → 85 assertions (+20). All 20 lair/bestiary tests pass (1148 assertions, 0 failed). tsc baseline unchanged (5 pre-existing, 0 new). CI on `92a3e64`: 0 check-runs (GitHub Actions only runs on HEAD commit `4a4fc3a`).

### Task B — `radiusFt` extraction extension (commit `82db159`) — S105 next-action #5b RESOLVED

**Handover directive (S105):** "6 actions now have `centerOnPoint=true` but `radiusFt=undefined` (Drow Matron Mother::1, Geryon::0/::1, Hythonia::1, Yeenoghu::0/::1) — they use 'within N feet of that point' / 'cube N feet on a side' instead of 'N-foot-radius'. The point-selection BRANCH in `selectLairActionTargets` requires `radiusFt !== undefined`, so these stay on v1 despite the flag. Extending `radiusFt` extraction to catch these phrasings would activate point-selection for them."

**Audit (S106):** The S105 handover's count of 6 was INACCURATE. Scanning the bestiary (MPMM source, which `spawnMonster` picks), the actual `centerOnPoint=true && radiusFt=undefined` actions are 5 unique:
- Drow Matron Mother::1 — "within 60 feet of that point" → radiusFt should be 60 (save_condition)
- Hythonia::1 — "within 20 feet of that point" → radiusFt should be 20 (cast_spell)
- **Storm Giant Quintessent::0** — "within 20 feet of that point" → radiusFt should be 20 (save_condition) [S105 audit MISS — same pattern as Drow/Hythonia; included in S106]
- Geryon::1 — "cube, 10 feet on each side, centered on that point" → radiusFt should be 5 (save_damage, half-side)
- Yeenoghu::1 — "in the space where the spike emerges" → NO radius number in text (save_damage, single-target point) — CANNOT be extracted by a number-based regex

The S105 handover's "Geryon::0/::1, Yeenoghu::0/::1" referred to the MTF source variants (where ::0 is the cold blast / iron spike), but `spawnMonster` picks the MPMM source (where ::0 is banishment / buff_ally — no `centerOnPoint`). The S106 audit uses the MPMM source (the canonical one the tests use).

**Regex extended:** `radiusFt` extraction now has 2 fallback patterns (only run when the primary "N-foot-radius" match fails — 0 regression risk):
- Fallback 1: `/within\s+(\d+)\s*feet\s+of\s+that\s+point/i` → radiusFt = N (Euclidean "within N feet" → Chebyshev N, same approximation as "N-foot-radius sphere"). Covers Drow Matron Mother::1, Hythonia::1, Storm Giant Quintessent::0.
- Fallback 2: `/cube,?\s+(\d+)\s+feet\s+on\s+(?:a|each)\s+side/i` → radiusFt = floor(N/2) (half-side; Chebyshev radius from centre to cube faces). Covers Geryon::1 (10ft cube → 5ft).

**Yeenoghu::1 deferred:** uses "in the space where the spike emerges" — single-target point effect with no radius number in text. Cannot be extracted by a number-based regex. Left on v1 (`radiusFt=undefined`). A future session could add a "single-target point" handler (`radiusFt=0` — `chooseLairActionPoint` with radiusFt=0 hits only the target at the chosen point). Tracked in IMMEDIATE NEXT ACTIONS #4.

**Behavioural change (4 actions):** these now have `radiusFt` extracted → the point-selection branch in `selectLairActionTargets` activates (`centerOnPoint && radiusFt !== undefined`). For spread enemies, point-selection hits FEWER targets than v1 (canon-accurate — the AoE can't reach all spread enemies). For clustered enemies, both models hit all (no change).

**Files:**
- `src/parser/fivetools.ts` — `radiusFt`: changed `const` to `let`; added 2 fallback patterns with detailed doc comment (the 4 actions covered, the Yeenoghu::1 deferral, 0 false-positives).
- `src/test/session103_choose_lair_point.test.ts` — §17 (NEW): +13 assertions (4 target actions radiusFt + Yeenoghu::1 undefined regression). §18 (NEW): +6 assertions behavioural test on real Geryon::1 cube (spread → 1 target; clustered → 2 targets).

**Verified:** 85 → 104 assertions (+19). All 20 lair/bestiary tests pass (1167 assertions, 0 failed). tsc baseline unchanged (5 pre-existing, 0 new). CI on `82db159`: 0 check-runs (not HEAD).

### Task C — Hallow Energy Vulnerability AI dispatch wiring (commit `4a4fc3a`) — S105 next-action #6 RESOLVED

**Handover directive (S105):** "The effect is implemented + tested (Task #6). **Remaining:** wire it into the AI dispatch. `case 'hallow'` in combat.ts still uses the Daylight effect. AI effect-selection (Daylight vs Energy Vulnerability) needs a decision rule — e.g., choose Energy Vulnerability when the party deals a known damage type, else Daylight vs undead/fiends. LOW-MEDIUM risk (combat.ts dispatch addition; the ActiveEffect infrastructure is tested)."

**Implementation:** New helper `pickHallowDamageType(caster, bf)` in `src/spells/hallow.ts`: scans ALL party members' actions for `damageType` (only actions that deal damage — `a.damage && a.damageType`), counts occurrences, returns the most common (the party's strongest damage profile). Ties broken by first-seen (deterministic). Returns `null` if no party member has a damage-dealing action (EV can't fire — no type to exploit).

**v1 heuristic:** counts ACTION TYPES, not action AVAILABILITY or damage MAGNITUDE. A cantrip (1 action) counts the same as a multiattack (1 action, 3 attacks). A 1d6 fire action counts the same as a 12d6 fire action. A more sophisticated model would weight by expected damage per round (tracked in IMMEDIATE NEXT ACTIONS #5). The v1 heuristic (most common type) is a reasonable proxy — the party's "signature" damage type is usually the one they deal most often.

**Effect-selection rule (S106), wired into `case 'hallow'` in combat.ts:**
1. **Priority 1: AI-picked target (`plan.targetId`).** If the target is undead/fiend → Daylight (canon-accurate; the PHB-intended use — undead/fiends have disadv on attacks in daylight). Else (not undead/fiend) + party has a damage type + target not already vulnerable → Energy Vulnerability with the party's damage type. If EV not applicable (no party damage type, or target already vulnerable) → fall through to Priority 2.
2. **Priority 2: no AI target (or AI target unsuitable for EV) → `shouldCastHallow`** (find undead/fiend) → Daylight.
3. **Priority 3: no undead/fiend → `shouldCastEnergyVulnerability`** (find highest-HP enemy not already vulnerable) → EV with the party's damage type.

**Behavioural change:** Hallow now has TWO uses: vs undead/fiends (Daylight, canon) AND vs other enemies (Energy Vulnerability, general-purpose offensive debuff). This expands Hallow's combat value beyond just undead/fiends. The AI's pre-selected target is preferred when valid (respects AI intent); the effect is chosen based on the target's creature type.

**Metadata flag:** `hallowEnergyVulnerabilityV1Wired: true` (distinct from S105's `hallowEnergyVulnerabilityV1Implemented: true`).

**Files:**
- `src/spells/hallow.ts` — added `pickHallowDamageType` + the metadata flag + updated the S105 comment (removed "NOT wired into the AI dispatch"). Existing Daylight `shouldCast`/`execute`/`cleanup` + S105 EV functions unchanged.
- `src/engine/combat.ts` — added imports (`shouldCastEnergyVulnerability`, `executeEnergyVulnerability`, `pickHallowDamageType`); rewrote `case 'hallow'` with the 3-priority selection rule + detailed comment.
- `src/test/session106_hallow_ev_dispatch.test.ts` — **NEW file, 38 assertions, 16 sections**:
  1. Metadata flag (3 assertions: wired flag, implemented flag, Daylight flag).
  2-5. `pickHallowDamageType` (single type, most common, ties first-seen, null).
  6-7. Dispatch: undead/fiend target → Daylight (advantage_vs).
  8-9. Dispatch: humanoid target + party fire/radiant → EV (damage_vulnerability).
  10. Dispatch: humanoid target + no party damage type → no cast (slot preserved).
  11. Dispatch: humanoid target already vulnerable → no EV (slot preserved).
  12-14. Dispatch: no AI target fallbacks (Daylight, EV, no cast).
  15. Regression: direct `executeHallow` Daylight still works.
  16. Integration: EV vuln doubles fire damage via `applyDamageWithTempHP`.

**Verified:** 38/0 new test. All existing Hallow tests pass unchanged (session68_batch3_spells 149, session105_hallow_energy_vuln 41, session104_vuln_audit 13, session103_debuff_vuln_expiry 37). Broad spell dispatch sample (13 files, 1556 assertions) all pass. tsc baseline unchanged (5 pre-existing, 0 new). CI on `4a4fc3a` (HEAD): pending at handover-write time — build + deploy + report-build-status = SUCCESS, 6 test chunks in progress, 0 failures so far.

## TEST STATUS

- **New tests (1 file, 38 assertions):**
  - `src/test/session106_hallow_ev_dispatch.test.ts` — **38 passed, 0 failed** (16 sections).
- **Updated tests (1 file):**
  - `src/test/session103_choose_lair_point.test.ts` — **104 passed, 0 failed** (was 65 in S105; +12 §1 BORDERLINE parser, +8 §16 Ogrémoch behavioural, +13 §17 radiusFt parser, +6 §18 Geryon cube behavioural = +39).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed.
  - `session92_lair_action_dispatch` — 59 passed.
  - `session93_lair_save_damage` — 52 passed.
  - `session94_lair_phase3b` — 53 passed.
  - `session95_lair_phase4` — 39 passed.
  - `session96_lair_phase5` — 53 passed.
  - `session97_lair_phase6` — 35 passed.
  - `session98_lair_phase7` — 36 passed.
  - `session99_lair_phase7b2` — 60 passed.
  - `session100_lair_phase8b1` — 71 passed.
  - `session101_lair_phase8b2` — 51 passed.
  - `session102_lair_phase8b3` — 51 passed.
  - `session103_choose_lair_point` — 104 passed (was 65; +39).
  - `session103_deferred_promotion` — 88 passed.
  - `session104_vuln_audit` — 13 passed.
  - `session105_hallow_energy_vuln` — 41 passed (S105 EV effect regression).
  - `session105_phase8_retrospective` — 25 passed.
  - `session106_hallow_ev_dispatch` — 38 passed (NEW).
  - `session68_batch3_spells` — 149 passed (Hallow Daylight regression).
  - `session103_debuff_vuln_expiry` — 37 passed (S103 vuln pattern regression).
  - `bestiary_integration` — 77 passed.
  - `creature_lair_actions` — 12 passed.
  - `creature_defenses` — 92 passed (innate-vuln regression).
  - `open_hand_technique` — 27 passed (S105 flake fix regression).
  - Broad spell dispatch sample (session68_batch2 136, session69_batch5 202, session69_batch6 102, session69_batch7 242, session75_monster_slotted_spells 66, session80_goi_radius 37, session81_goi_caster_inside 39, session82_charm_24hr_duration 25, session85_eldritch_blast_multitarget 30, bulk_spell_dispatch 214, counterspell 35, shield_reaction 66) — all pass (combat.ts dispatch change doesn't regress other spells).

- **Full 6-chunk CI suite:** local full-suite run hit sandbox memory limits (parallel ts-node OOM). CI on GitHub is the definitive check — `4a4fc3a` (HEAD) CI pending at handover-write time (build + deploy + report-build-status = SUCCESS, 6 test chunks in progress, 0 failures so far).

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-105: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts + 1 in utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts. The S106 changes are a parser regex extension + a parser `let` change + a spell-module addition + a combat.ts dispatch rewrite + 1 new test file with no type issues. CI does not run `tsc`.)

## CI STATUS

- **`92a3e64` (BORDERLINE centerOnPoint):** 0 check-runs — GitHub Actions only runs on the HEAD commit of a push (`4a4fc3a`). The code IS covered by `4a4fc3a`'s CI run (same tree, cumulative commits).
- **`82db159` (radiusFt extraction):** 0 check-runs — same (not HEAD).
- **`4a4fc3a` (Hallow EV dispatch, HEAD):** PENDING at handover-write time — build SUCCESS, deploy SUCCESS, report-build-status SUCCESS, 6 test chunks in progress, 0 failures so far. Expected all green (the new `session106_hallow_ev_dispatch.test.ts` is a standalone test; the parser changes are regex extensions with 0 false-positives verified; the combat.ts dispatch change preserves existing behaviour for undead/fiend targets and only adds the EV path for non-undead targets).

(If a flaky CRASH appears on any chunk — the known flake is `summons.test.ts` under parallel load, which passes standalone — re-trigger with an empty commit, mirroring the S100/S102/S104 flake-re-trigger pattern. The `open_hand_technique` flake was FIXED in S105 (`07e7e9a`) — no longer a flake source.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The 3 S105 next-actions completed this session (#5a, #5b, #6 remaining), plus the carry-overs from S104/S105 + 3 NEW follow-ups from S106:

### 1. Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk)

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). The S105 Phase 8 retrospective confirmed 38+ isSpell cast_spell actions exist across the bestiary, all with spellNames — ready for the unified dispatch. **Unchanged from S104/S105.**

### 2. Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream)

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). Per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S104/S105.**

### 3. Score-weight tuning (S104, updated for S106)

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. **S106 update:** the BORDERLINE centerOnPoint (Task A, +4 actions) + radiusFt extraction (Task B, +4 actions) mean 8 MORE actions now use point-selection. For spread-enemy combats, point-selection hits FEWER targets than v1 (canon-accurate) — so the scorer sees a lower target COUNT for these 8 actions. The scorer may need re-tuning to reflect the more-accurate (but lower-count) targeting. The S104 grid-sweep enhancement (catches midpoint clusters) partially offsets this for `centerOnPoint` actions, but the net effect on `LAIR_ACTION_SCORE_WEIGHTS` should be measured. **Updated for S106.**

### 4. Yeenoghu::1 single-target point handler (NEW from S106)

Yeenoghu::1 ("in the space where the spike emerges") uses neither "within N feet of that point" nor "cube N feet on a side" — it's a single-target point effect with no radius number in the text. S106 Task B left it on v1 (`radiusFt=undefined`) because the number-based fallback regexes can't extract a radius. A future session could add a "single-target point" handler: if `centerOnPoint=true` and text matches `/in (?:the|that) space/i` (or similar single-target point phrasing), set `radiusFt=0`. With `radiusFt=0`, `chooseLairActionPoint` hits only the target at the chosen point (Chebyshev=0) — canon-accurate for "any creature in the space where the spike emerges". LOW-MEDIUM risk (parser regex extension + test). **NEW from S106.**

### 5. Hallow EV damage-type weighting (NEW from S106)

The S106 `pickHallowDamageType` helper (Task C) uses a v1 heuristic: counts ACTION TYPES (each action = 1 vote), not damage MAGNITUDE or action AVAILABILITY. A cantrip counts the same as a multiattack; a 1d6 action counts the same as a 12d6 action. A more sophisticated model would weight by expected damage per round (damage dice × action availability × hit chance). LOW-MEDIUM risk (helper refinement; the dispatch wiring is unchanged). The v1 heuristic is a reasonable proxy — the party's "signature" type is usually the most common — but a weighted model would pick the type that benefits MOST from being doubled. **NEW from S106.**

### 6. `rangeFt` extraction limitation for "anywhere in their lair" (NEW from S106)

The S106 radiusFt extraction (Task B) activated point-selection for Storm Giant Quintessent::0 ("centered on a point anywhere in their lair. Each creature within 20 feet of that point..."). The `rangeFt` extraction (`/within\s+(\d+)\s*feet/i`, first match) grabbed "within 20 feet" as `rangeFt=20` — but canon says "anywhere in their lair" (unbounded range). The 20ft is the RADIUS, not the RANGE. This is a pre-existing parser limitation (rangeFt grabs the first "within N feet" regardless of context), but it now has behavioural impact: the point-selection grid-sweep is bounded to 20ft around the lair creature (rangeFt=20), when canon allows placement anywhere. A future session could detect "anywhere in their lair" / "anywhere" phrasing and set `rangeFt` to a large value (e.g., the battlefield diagonal) or undefined (unbounded grid — but that's expensive). LOW risk (parser refinement). **NEW from S106.**

### 7. `open_hand_technique` flake (S105, RESOLVED)

The `executeFOUntilHit` hit-detection flake was FIXED in S105 (`07e7e9a`). **RESOLVED in S105.** No further action.

## CI FAILURE RECOVERY

If any S106 commit has a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs (only `4a4fc3a` has check-runs; `92a3e64` + `82db159` are covered by `4a4fc3a`'s run since they're in the same push).
2. **`92a3e64` (BORDERLINE centerOnPoint):** the only code change is the 3rd `centerOnPoint` regex alternation in `fivetools.ts` + test assertions in `session103_choose_lair_point.test.ts`. The regex was verified to match exactly the 4 BORDERLINE cases and 0 false-positives. If a lair test fails, a parser change regressed an invariant — check which action's `centerOnPoint` flipped unexpectedly.
3. **`82db159` (radiusFt extraction):** the only code change is the `let radiusFt` + 2 fallback regexes in `fivetools.ts` + test assertions. The fallbacks only run when the primary "N-foot-radius" match fails (0 regression risk for existing actions). If a lair test fails, check whether a fallback regex matched an unintended action.
4. **`4a4fc3a` (Hallow EV dispatch):** the code changes are `pickHallowDamageType` in `hallow.ts` + the `case 'hallow'` rewrite in `combat.ts` + the new test file. The dispatch rewrite preserves existing behaviour for undead/fiend targets (Daylight) and only adds the EV path for non-undead targets. If `session68_batch3_spells` (Hallow Daylight regression) fails, the dispatch rewrite broke the Daylight path — check Priority 1/2 (undead/fiend → Daylight). If `session106_hallow_ev_dispatch` fails, check the specific assertion (most likely a payload field mismatch or a `pickHallowDamageType` tie-break issue).
5. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
6. **Known flake:** `summons.test.ts` under parallel load — passes standalone. Re-trigger with an empty commit if it CRASHes.

## KEY FILES THIS SESSION

### New
- `src/test/session106_hallow_ev_dispatch.test.ts` — Task C Hallow EV dispatch test (38 assertions, 16 sections).
- `zHANDOVER-SESSION-106.md` — this file.

### Modified
- `src/parser/fivetools.ts`:
  - `centerOnPoint`: added the 3rd BORDERLINE alternation `N-foot-radius ... within M feet of` (S106 Task A). Updated the doc comment (S106 audit findings, 2-distances rationale, 0 false-positives, new count: 26).
  - `radiusFt`: changed `const` to `let`; added 2 fallback patterns — "within N feet of that point" → N, "cube N feet on a side" → floor(N/2) (S106 Task B). Updated the doc comment (4 actions covered, Yeenoghu::1 deferral, 0 false-positives).
- `src/spells/hallow.ts`:
  - Added `pickHallowDamageType` helper (scans party actions for most common damageType). Added the `hallowEnergyVulnerabilityV1Wired` metadata flag. Updated the S105 comment (removed "NOT wired into the AI dispatch"). Existing Daylight + S105 EV functions unchanged.
- `src/engine/combat.ts`:
  - Added imports (`shouldCastEnergyVulnerability`, `executeEnergyVulnerability`, `pickHallowDamageType`).
  - Rewrote `case 'hallow'` with the 3-priority effect-selection rule (S106 Task C). Detailed comment documenting the rule + the AI-target-preference logic.
- `src/test/session103_choose_lair_point.test.ts`:
  - §1: +12 assertions (4 BORDERLINE × 3 fields: centerOnPoint, radiusFt, rangeFt).
  - §16 (NEW): +8 assertions behavioural test on real Ogrémoch::0 (spread → 1 target; clustered → 2 targets).
  - §17 (NEW): +13 assertions (4 target actions radiusFt + Yeenoghu::1 undefined regression).
  - §18 (NEW): +6 assertions behavioural test on real Geryon::1 cube (spread → 1 target; clustered → 2 targets).

### Archived
- `zHANDOVER-SESSION-103.md` → `HandoverOld/zHANDOVER-SESSION-103.md` (per AGENTS.md "latest 2 in root" rule; S105 + S106 now in root).
- `zHANDOVER-SESSION-104.md` → `HandoverOld/zHANDOVER-SESSION-104.md` (same).

## ARCHITECTURAL NOTES

### Why the BORDERLINE regex requires "within M feet of" (not just "N-foot-radius")

The 4 BORDERLINE cases have TWO distances: a radius (N) and a range (M). The radius defines the AoE size; the range defines the placement distance. This is mechanically point-selection: the N-foot-radius AoE is PLACED at a point within M feet of the creature. Centered-on-self actions have only ONE distance ("N-foot-radius around [creature]" — the radius IS the range, centered on self). The S106 regex `N-foot-radius ... within M feet of` requires BOTH, so it matches only point-placement. The 5 centered-on-self + 1 ambiguous actions all lack the "within M feet of" range clause — 0 false-positives.

### Why the radiusFt fallbacks use "of that point" (not just "within N feet")

The primary `rangeFt` extraction already grabs the first "within N feet" (usually the range from the lair creature). A fallback `radiusFt` regex matching bare "within N feet" would conflict (grab the same number as rangeFt). The S106 fallback requires "within N feet OF THAT POINT" — the "of that point" qualifier distinguishes the radius (distance from the chosen point) from the range (distance from the lair creature). This matches exactly the 3 actions that use this phrasing (Drow Matron Mother::1, Hythonia::1, Storm Giant Quintessent::0) and 0 others. The cube fallback ("cube N feet on a side") is even more specific (requires "cube" + "on a/each side") — matches only Geryon::1.

### Why the Hallow EV dispatch prioritizes the AI's target

The `case 'hallow'` rewrite preserves the existing pattern: if the AI picked a target (`plan.targetId`), use it. The S106 addition is the effect-SELECTION on that target: undead/fiend → Daylight, else → EV (if the party has a damage type and the target isn't already vulnerable). This respects the AI's targeting intent while choosing the canon-appropriate effect. If the AI didn't pick a target (or the target is unsuitable for EV), the dispatch falls back to `shouldCastHallow` (find undead/fiend) then `shouldCastEnergyVulnerability` (find highest-HP enemy). This 3-priority structure ensures: (a) the AI's target is preferred, (b) Daylight is used for undead/fiends (canon), (c) EV is used for other enemies when the party can exploit a damage type, (d) no cast when neither effect applies (slot preserved).

### Why pickHallowDamageType uses action count (not damage magnitude)

The v1 heuristic counts each damage-dealing action as 1 vote for its damageType. This is a proxy for "the party's signature damage type" — the type they deal most often. A more sophisticated model would weight by expected damage per round (dice × availability × hit chance), but that requires modelling action cooldowns, resource costs, and hit probabilities — significant complexity. The v1 heuristic is reasonable because: (a) parties usually have a "signature" type (fire sorcerer, radiant cleric, slashing fighter), (b) the most common type is usually the most available (cantrips repeat every turn), (c) doubling the most common type maximizes the number of doubled hits (even if each individual hit is small). A weighted model (next-action #5) would refine this, but the v1 heuristic is a safe default that never picks a type the party can't deal.

### Coverage summary (updated for Session 106)

| Category | Count | S105 state | S106 delta | Total |
|---|---|---|---|---|
| `save_damage` | 99 | ✅ | — | 99 |
| `save_condition` | 55 | ✅ 30 point-selection | +2 point-selection (Ogrémoch::0, Drow::1, SGQ::0) | 55 (33 point-selection) |
| `save_only` | 42 | ✅ 42/42 | — | 42/42 (100%) |
| `cast_spell` | 42 | ✅ | — | 42 |
| `bespoke` | 29 | ✅ 29/29 recognized | — | 29/29 (100%) recognized |
| `summon` | 23 | ✅ | — | 23 |
| `buff_ally` | 7 | ✅ | — | 7 |
| `debuff_enemy` | 7 | ✅ | — | 7 |
| `movement` | 7 | ✅ | — | 7 |
| `damage_no_save` | 5 | ✅ | +1 point-selection (Ogrémoch::1, Geryon::1) | 5 |
| `spell_slot_regen` | 2 | ✅ | — | 2 |
| `visibility` | ~3 | ✅ | — | ~3 |
| `deferred` | 16 | ✅ 0 auto remain | +2 centerOnPoint flag (Imix::1, Olhydra::2 — semantically correct, not executed) | 0 auto (4 stable) |
| `flavor` | 6 | logged | — | 0 (logged) |
| **Total** | **~327** | **100% recognized + scored** | **3 tasks: BORDERLINE centerOnPoint + radiusFt extraction + Hallow EV dispatch** | **~327 (100%) recognized + scored** |

Session 106 does NOT change recognition coverage (still ~327/327 = 100%). It improves:
- **Targeting accuracy** for 4 more `centerOnPoint` actions (Task A — BORDERLINE cases now use point-selection per the rules; 2 executed, 2 deferred flag-only).
- **Targeting accuracy** for 4 more `radiusFt`-extracted actions (Task B — Drow Matron Mother::1, Hythonia::1, Storm Giant Quintessent::0, Geryon::1 now activate point-selection).
- **Spell coverage** (Task C — Hallow Energy Vulnerability is now WIRED into the AI dispatch; Hallow has 2 uses: Daylight vs undead/fiends, EV vs other enemies with the party's damage type).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (local, post-push): `4a4fc3a` (Hallow EV dispatch), `82db159` (radiusFt extraction), `92a3e64` (BORDERLINE centerOnPoint), `7681d12` (S105 handover), `f816681` (S105 retrospective)
- `git status` → clean (3 commits pushed; S103 + S104 handovers archived to HandoverOld/)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **104 passed, 0 failed** (was 65 in S105; +39)
- `npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts` → **38 passed, 0 failed** (NEW)
- `npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts` → **41 passed, 0 failed** (S105 EV effect regression)
- `npx ts-node --transpile-only src/test/session105_phase8_retrospective.test.ts` → **25 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts` → **149 passed, 0 failed** (Hallow Daylight regression)
- `npx ts-node --transpile-only src/test/session104_vuln_audit.test.ts` → **13 passed, 0 failed** (Hallow still uses ActiveEffect)
- `npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts` → **37 passed, 0 failed** (S103 vuln pattern regression)
- `npx ts-node --transpile-only src/test/session93_lair_save_damage.test.ts` → **52 passed, 0 failed**
- `npx ts-node --transpile-only src/test/open_hand_technique.test.ts` → **27 passed, 0 failed** (S105 flake fix regression)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed**
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression)
- **CI on GitHub:**
  - `7681d12` (S105 handover) → **ALL GREEN** (9/9 success) — confirmed at S106 session start
  - `92a3e64` (BORDERLINE) → **0 check-runs** (not HEAD; covered by `4a4fc3a`'s run)
  - `82db159` (radiusFt) → **0 check-runs** (not HEAD; covered by `4a4fc3a`'s run)
  - `4a4fc3a` (Hallow EV dispatch, HEAD) → **pending** (build + deploy + report-build-status = SUCCESS, 6 test chunks in progress, 0 failures so far)
