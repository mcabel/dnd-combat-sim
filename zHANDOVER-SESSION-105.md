# HANDOVER-SESSION-105

## REPOSITORY

- Branch: main
- Commits this session:
  - `07e7e9a` — Session 105: fix open_hand_technique flake (S104 c8c109f red X)
  - `cec7b39` — Session 105: centerOnPoint extraction audit + broader regex (S104 next-action #5)
  - `1a14258` — Session 105: Hallow Energy Vulnerability effect (S104 next-action #6)
  - `f816681` — Session 105: Phase 8 retrospective regression guard (S104 next-action #4)
- Previous: `513ccd3` (S104 CI re-trigger), `35689b0` (S104 handover), `c8c109f` (S104 vuln audit), `f1c1223` (S104 grid-sweep)
- State: clean (4 commits pushed; CI green on `07e7e9a` + `cec7b39`; `1a14258` + `f816681` CI pending at handover-write time — see CI STATUS)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Four tasks completed this session, each as a separate commit. The session started by fixing a CI red X from the S104 handover (open_hand_technique flake), then completed 3 of the 6 "IMMEDIATE NEXT ACTIONS" from the S104 handover (#5 centerOnPoint, #6 Hallow, #4 Phase 8 retrospective). The remaining 3 are deferred (see IMMEDIATE NEXT ACTIONS below).

### Task #0 — `open_hand_technique` flake fix (commit `07e7e9a`) — CI RED X RESOLVED

**Trigger:** The S104 handover wrote "CI on GitHub: pending — expected all green (no red X)". On session start, CI on `c8c109f` (the S104 final commit) showed `test (4) = failure`: `open_hand_technique.test.ts` §19 "save log found" failed (1 assertion). This was NOT the known `summons.test.ts` flake — it was a real (if low-probability) flake in the test helper.

**Root cause:** `executeFOUntilHit`'s hit-detection checked `monk.resources.ki.remaining < monk.resources.ki.max` to decide whether to return the state. But ki is ALWAYS spent when Flurry of Blows executes (regardless of whether the attacks hit) — so the 50-attempt retry loop returned after attempt 0 every time. ~0.25% of runs (P = (1/20)² = both attacks roll nat-1), no attack hit → no Open Hand Technique rider → no save log → §19 "save log found" failed. The retry loop never actually retried.

**Fix:** Detect an actual hit via `target.currentHP < target.maxHP` (damage dealt). Unarmed strikes always deal >0 dmg (min 1d4+ability ≥ 2) and test enemies have no resistances, so `currentHP < maxHP` is a reliable hit signal. The retry loop now retries until a hit, matching the function name (`executeFOUntilHit`) + comment ("retrying until at least 1 attack hits").

**Files:**
- `src/test/open_hand_technique.test.ts` — `executeFOUntilHit`: replaced the ki-consumption check with a damage-dealt check. Updated the comment to document the flake root cause + fix rationale.

**Verified:** 20/20 local runs pass (was flaking ~1/400). CI on `07e7e9a`: all 6 test chunks + build + deploy + report-build-status = SUCCESS (no red X).

### Task #5 — `centerOnPoint` extraction audit + broader regex (commit `cec7b39`)

**Handover directive (S104):** "The S103 `centerOnPoint` flag is extracted only from `/centered on a point/i`. The remaining 47 `radiusFt` actions use 'within N feet of the [creature]' / 'at a point' phrasing and stay on v1 (no point-selection). A follow-up could audit their text for point-selection semantics and extend `centerOnPoint` extraction if warranted. LOW risk (parser regex extension + re-scan). Note: some 'at a point' actions (e.g. Red Dragon::0 magma) describe point-selection but use a different phrasing — they'd need a broader regex or manual flagging."

**Audit:** Scanned all 261 lair-action options across 115 legendary groups. Found 14 actions with `radiusFt` but WITHOUT the S103 `centered on a point` flag. Classified each by phrasing:

| Class | Count | Examples | centerOnPoint? |
|---|---|---|---|
| STRONG (explicit "a point ... chooses/can see") | 4 | Black Dragon::2, Bronze Dragon::1, Copper Dragon::0, Red Dragon::0 | **NOW TRUE** (S105) |
| BORDERLINE ("radius sphere/area within N feet of [creature]") | 4 | Imix::1, Ogrémoch::0/::1, Olhydra::2 | false (conservative — text omits "chooses/can see") |
| CENTERED-ON-SELF ("around [creature]" / "centered on him") | 5 | Baalzebul::1, Cryonax::2, Imix::2, Ogrémoch::2, Red Dragon::1 | false |
| AMBIGUOUS | 1 | Gar Shatterkeel::1 | false |

**Regex broadened:** `centerOnPoint` now matches `/centered on a point/i` (S103) OR `/a point\b[^.]*?\b(?:chooses|can see)\b/i` (S105 NEW). The new alternation catches the 4 STRONG cases (all use "a point the [creature] chooses/can see" + a radiusFt). It also catches 6 `radiusFt=undefined` actions with the same phrasing (Drow Matron Mother::1, Geryon::0/::1, Hythonia::1, Yeenoghu::0/::1) — these get the flag but stay on v1 because `selectLairActionTargets` requires `radiusFt !== undefined` to activate the point-selection branch. The flag is semantically correct and future-proofs for when `radiusFt` extraction is extended to "within N feet of that point" / "cube N feet on a side" phrasings.

**Verified:** the new regex does NOT match any of the 5 centered-on-self cases, the 4 borderline cases, or the 1 ambiguous case (none contain "a point ... chooses/can see"). Post-S105: 22 actions have `centerOnPoint=true` (12 S103 "centered on a point" + 10 S105 "a point ... chooses/can see").

**Behavioural change (4 STRONG cases):** these now use `chooseLairActionPoint` (S103 + S104 grid-sweep) instead of the v1 over-approximation. For a SINGLE target within range, both models hit it (point-selection centres on the target) — score unchanged. For MULTIPLE spread targets, point-selection hits only those within `radiusFt` of the chosen centre (fewer than v1's "all in range") — more canon-accurate but lower target count.

**Test updates (the S103 tests encoded the OLD regex specificity — updating them IS the task, not collateral):**
- `session103_choose_lair_point` §1: +4 new `centerOnPoint=true` assertions (Black/Bronze/Copper/Red Dragon). +8 assertions (57 → 65).
- `session103_choose_lair_point` §2: Red Dragon::0 (now true) → replaced with Red Dragon::1 ("around the dragon", centered-on-self) as the false example.
- `session103_choose_lair_point` §10: Red Dragon::0 (now point-selection) → replaced with a synthetic non-centerOnPoint save_damage action for the v1 over-approximation regression.
- `session103_choose_lair_point` §11: synthetic "at a point the dragon chooses" text now → `true` (was `false` under S103 regex specificity). Updated comment.
- `session93_lair_save_damage` §1: Red Dragon::0 (now point-selection, `radiusFt=5`) — moved `t2` adjacent to `t1` (1 sq apart) so a 5-ft-radius centre catches BOTH, preserving the "2 save events" assertion.
- `session93_lair_save_damage` §10: Red Dragon::0 — moved ally adjacent to dragon (1 sq) so point-selection catches both dragon+ally (self-damage prevention then excludes dragon, ally takes damage).

**Files:**
- `src/parser/fivetools.ts` — `centerOnPoint`: added the `a point ... (chooses|can see)` alternation. Updated the doc comment (S105 audit findings + the 4 STRONG cases + the 6 radiusFt=undefined cases + the borderline/self-centered classification).
- `src/test/session103_choose_lair_point.test.ts` — §1/§2/§10/§11 updated (above). 57 → 65 assertions.
- `src/test/session93_lair_save_damage.test.ts` — §1/§10 target repositioning (above). 50 → 52 assertions.

**Verified:** all 18 lair/bestiary tests pass (session91-104 + bestiary_integration + creature_lair_actions + creature_defenses). CI on `cec7b39`: all 6 test chunks + build + deploy = SUCCESS (no red X). tsc baseline unchanged (5 pre-existing, 0 new).

### Task #6 — Hallow "Energy Vulnerability" effect (commit `1a14258`)

**Handover directive (S104):** "The S104 vuln audit (Task #6) confirmed that `src/spells/hallow.ts` documents but does NOT implement the 'Energy Vulnerability' effect (v1 only implements 'Daylight'). Implementing it would use the S103 `damage_vulnerability` ActiveEffect pattern (now the canonical, regression-guarded pattern). LOW-MEDIUM risk (spell-module addition; the ActiveEffect infrastructure is already in place + tested by `session103_debuff_vuln_expiry`). Note: Hallow's 24-hour duration (no concentration) maps to `durationRounds: Infinity` or encounter-duration — the S103 `sourceTurnExpires` pattern handles finite durations; `Infinity` would need a separate 'encounter-duration' flag (mirrors the existing `hallowDurationV1EncounterOnly` flag)."

**Implementation:** Two new exports in `src/spells/hallow.ts`:
- `shouldCastEnergyVulnerability(caster, bf, damageType)`: targets the highest-HP enemy within 60 ft (ANY type — you'd vuln whatever your party can exploit, unlike Daylight which targets undead/fiends). Skips enemies already vulnerable to the chosen type (no wasted slot). NOT concentration-gated (Hallow has no concentration).
- `executeEnergyVulnerability(caster, target, state, damageType)`: applies a `damage_vulnerability` ActiveEffect — mirrors the chosen `damageType` into `target.damageVulnerabilities` (so `applyDamageWithTempHP` doubles incoming damage of that type, PHB p.197). Encounter-duration: NO concentration, NO `sourceTurnExpires` (mirrors the existing Daylight effect; canon 24-hr duration is its own duration, v1 bounds to encounter). The `addedVulnerability` flag = `!alreadyPresent` (undo-safe: if the target has innate vuln to the same type, `undoEffect` won't splice the innate entry — mirrors the S36 Protection-from-Energy + S103 lair-debuff-vuln pattern).

**Metadata flag:** `hallowEnergyVulnerabilityV1Implemented: true`.

**NOT wired into the AI dispatch** (`case 'hallow'` in combat.ts still uses the Daylight effect). AI effect-selection (Daylight vs Energy Vulnerability) is a future session — these functions are tested directly. The S104 vuln audit regression guard (`session104_vuln_audit.test.ts`) confirms Hallow still uses the ActiveEffect pattern (no direct `damageVulnerabilities.push`).

**Files:**
- `src/spells/hallow.ts` — added `shouldCastEnergyVulnerability` + `executeEnergyVulnerability` + the metadata flag + imports (`DamageType`, `ActiveEffect`). Existing Daylight `shouldCast`/`execute`/`cleanup` unchanged.
- `src/test/session105_hallow_energy_vuln.test.ts` — **NEW file, 41 assertions, 10 sections**:
  1. Metadata flag.
  2-9. `shouldCast` gates (any type, no slot, no action, range, not conc-gated, skips already-vulnerable, highest-HP, all-vulnerable → null).
  10-18. `execute` (slot consumed, not concentrating, ActiveEffect applied, payload.damageType + addedVulnerability, no sourceTurnExpires, damageVulnerabilities includes type, logs fire).
  19-20. INTEGRATION: `applyDamageWithTempHP` doubles vuln-type damage; non-vuln type NOT doubled.
  21. `addedVulnerability=false` + undo preserves innate vuln (undo-safe).
  22. dead target → effect not applied (slot still consumed).
  23. Regression: existing Daylight execute still works.
  24. S104 audit regression: Hallow uses ActiveEffect (no direct push) + undo removes the granted vuln (effect-tracked).

**Verified:** `session104_vuln_audit` (13), `session68_batch3_spells` (149, existing Hallow Daylight tests), `session103_debuff_vuln_expiry` (37) all pass unchanged. tsc baseline unchanged (5 pre-existing, 0 new). CI on `1a14258`: pending at handover-write time (3/9 completed, 0 failures).

### Task #4 — Phase 8 retrospective regression guard (commit `f816681`)

**Handover directive (S104):** "Phase 8 retrospective — bespoke category COMPLETE. Phase 8 (batches 1-3) is complete (S102). All 31 bespoke actions recognized (100%). A retrospective could audit: the 7 lair_def_auto_* (RESOLVED in S103), the 40 isSpell:true actions (spot-audit before unified cast dispatch), whether any log-only bespoke flags warrant mechanical handlers in Phase 9+. LOW risk (documentation/audit only)."

**Deliverable:** A regression-guard test that aggregates ALL lair actions across the full bestiary (115 legendary groups, ~261 options) via the actual parser and captures the post-Phase-8 invariants. If a future parser change regresses any invariant (re-introduces a `lair_def_auto_*` heuristic, drops a bespoke flag, or empties a category), the test fails.

**Invariants verified:**
1. S103 resolution: 0 `lair_def_auto_*` deferred IDs remain (all 7 promoted to stable `lair_def_010`-`013`).
2. The 4 promoted stable IDs (`lair_def_010`-`013`) exist.
3. `isSpell` (cast_spell) actions: count > 0, every isSpell action has a spellName, spot-audit (Aboleth phantasmal force, Kyrilla moonbeam/cloud of daggers).
4. Bespoke category populated (Phase 8 batches 1-3 complete); log-only flags present (`lairAntiInvisibility` Drow Matron Mother::0 S101; `lairIllusoryDuplicate` Sphinx S94 mechanical handler).
5. All 10 executable categories populated (save_damage, save_condition, cast_spell, summon, buff_ally, debuff_enemy, movement, damage_no_save, spell_slot_regen, bespoke). Deferred (33) + flavor (11) are log-only.
6. Retrospective summary printed (Phase 8 complete; open items for future sessions listed).

**Files:**
- `src/test/session105_phase8_retrospective.test.ts` — **NEW file, 25 assertions, 6 sections**.

**Verified:** passes locally (25/0). tsc baseline unchanged. CI on `f816681`: pending at handover-write time.

## TEST STATUS

- **New tests (2 files, 66 assertions):**
  - `src/test/session105_hallow_energy_vuln.test.ts` — **41 passed, 0 failed** (10 sections).
  - `src/test/session105_phase8_retrospective.test.ts` — **25 passed, 0 failed** (6 sections).
- **Updated tests (2 files):**
  - `src/test/session103_choose_lair_point.test.ts` — **65 passed, 0 failed** (was 57 in S104; +8 from the 4 new centerOnPoint=true assertions in §1).
  - `src/test/session93_lair_save_damage.test.ts` — **52 passed, 0 failed** (was 50; target repositioning in §1/§10, no count change).
- **Flake fix (1 file):**
  - `src/test/open_hand_technique.test.ts` — **27 passed, 0 failed** (count unchanged; `executeFOUntilHit` hit-detection fixed). 20/20 stress-test runs pass.
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
  - `session103_deferred_promotion` — 88 passed.
  - `session103_debuff_vuln_expiry` — 37 passed.
  - `session104_vuln_audit` — 13 passed.
  - `creature_lair_actions` — 12 passed.
  - `bestiary_integration` — 77 passed.
  - `creature_defenses` — 92 passed (innate-vuln regression).
  - `session68_batch3_spells` — 149 passed (existing Hallow Daylight regression).
  - Non-lair bestiary-spawning sample (`creature_recharge_legendary` 52, `vision_audio` 122, `monster_spellcasting` 121, `session69_batch6_outofcombat` 102, `session75_monster_slotted_spells` 66, `session80_goi_radius` 37) — all pass (parser change doesn't crash non-lair parsing).

- **Full 6-chunk CI suite:** local full-suite run hit sandbox memory limits (parallel ts-node OOM). CI on GitHub is the definitive check — `07e7e9a` + `cec7b39` are ALL GREEN (9/9 check-runs success each). `1a14258` + `f816681` CI pending at handover-write time.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-104: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts + 1 in utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts. The S105 changes are a parser regex extension + a spell-module addition + 3 test files with no type issues. CI does not run `tsc`.)

## CI STATUS

- **`07e7e9a` (flake fix):** ALL GREEN — 6/6 test chunks + build + deploy + report-build-status = SUCCESS. (Resolved the S104 `c8c109f` red X on `test (4)`.)
- **`cec7b39` (centerOnPoint):** ALL GREEN — 6/6 test chunks + build + deploy + report-build-status = SUCCESS.
- **`1a14258` (Hallow):** PENDING at handover-write time — build SUCCESS, 2 test chunks completed (0 failures), 4 in progress. Expected all green (the new `session105_hallow_energy_vuln.test.ts` is a standalone test with no combat-dispatch wiring; the existing `session68_batch3_spells` Hallow tests pass unchanged locally).
- **`f816681` (retrospective):** PENDING at handover-write time — the new `session105_phase8_retrospective.test.ts` is a bestiary-aggregation audit (no combat simulation); cannot CRASH under parallel load. Expected all green.

(If a flaky CRASH appears on any chunk — the known flake is `summons.test.ts` under parallel load, which passes standalone — re-trigger with an empty commit, mirroring the S100/S102/S104 flake-re-trigger pattern. The `open_hand_technique` flake is now FIXED (`07e7e9a`) — no longer a flake source.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The 3 remaining S104 next-actions not completed this session, plus 4 NEW follow-ups from S105:

### 1. Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk)

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). The S105 Phase 8 retrospective (Task #4) confirmed 38+ isSpell cast_spell actions exist across the bestiary, all with spellNames — ready for the unified dispatch. **Unchanged from S104.**

### 2. Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream)

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). Per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S104.**

### 3. Score-weight tuning (S104, updated for S105)

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. **S105 update:** the centerOnPoint broader regex (Task #5) moves 4 more actions to point-selection. For spread-enemy combats, point-selection hits FEWER targets than v1 (only those within `radiusFt` of the chosen centre) — so the scorer now sees a lower target COUNT for these 4 actions. The scorer may need re-tuning to reflect the more-accurate (but lower-count) targeting. The S104 grid-sweep enhancement (catches midpoint clusters) partially offsets this for `centerOnPoint` actions, but the net effect on `LAIR_ACTION_SCORE_WEIGHTS` should be measured. **Updated for S105.**

### 4. Phase 8 retrospective — DONE (S105, this session)

The retrospective is now a regression-guard test (`session105_phase8_retrospective.test.ts`). The open sub-items (unified cast dispatch = next-action #1; log-only bespoke flag mechanical handlers) are tracked separately. **RESOLVED in S105.**

### 5. `centerOnPoint` extraction — DONE (S105, this session)

The S103 regex is broadened (Task #5). The 4 STRONG cases now opt into point-selection. **RESOLVED in S105.** Two follow-ups remain (NEW from S105):

#### 5a. The 4 BORDERLINE centerOnPoint cases (NEW from S105)

Imix::1, Ogrémoch::0/::1, Olhydra::2 use "a N-foot-radius sphere/area within N feet of [creature]" — mechanically point-selection (the AoE is placed within range, NOT centered on self) but the text omits the "chooses/can see" qualifier. S105 left these on v1 (conservative). A future session can revisit with more context — flipping them requires confidence that "within N feet of [creature]" means "placed within range" (point-selection) not "extends N feet from [creature]" (self-centered). LOW-MEDIUM risk (parser regex extension + test updates for any multi-target assertions on these 4 actions).

#### 5b. `radiusFt` extraction extension for non-"N-foot-radius" phrasings (NEW from S105)

6 actions now have `centerOnPoint=true` but `radiusFt=undefined` (Drow Matron Mother::1, Geryon::0/::1, Hythonia::1, Yeenoghu::0/::1) — they use "within N feet of that point" / "cube N feet on a side" instead of "N-foot-radius". The point-selection BRANCH in `selectLairActionTargets` requires `radiusFt !== undefined`, so these stay on v1 despite the flag. Extending `radiusFt` extraction to catch these phrasings would activate point-selection for them. LOW-MEDIUM risk (parser regex extension + re-scan + test updates).

### 6. Hallow "Energy Vulnerability" effect — PARTIALLY DONE (S105, this session)

The effect is implemented + tested (Task #6). **Remaining:** wire it into the AI dispatch. `case 'hallow'` in combat.ts still uses the Daylight effect. AI effect-selection (Daylight vs Energy Vulnerability) needs a decision rule — e.g., choose Energy Vulnerability when the party deals a known damage type, else Daylight vs undead/fiends. LOW-MEDIUM risk (combat.ts dispatch addition; the ActiveEffect infrastructure is tested). **Updated for S105.**

### 7. `open_hand_technique` flake — DONE (S105, this session)

The `executeFOUntilHit` hit-detection flake is FIXED (Task #0). **RESOLVED in S105.** No further action.

## CI FAILURE RECOVERY

If any S105 commit has a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs.
2. **`07e7e9a` (flake fix) is ALL GREEN** — no recovery needed.
3. **`cec7b39` (centerOnPoint) is ALL GREEN** — no recovery needed.
4. **`1a14258` (Hallow):** the only new code is `src/spells/hallow.ts` (2 new functions, no dispatch wiring) + `src/test/session105_hallow_energy_vuln.test.ts` (standalone test). The new test sorts into one of the 6 chunks. If it fails, check the failure detail — most likely a payload field mismatch or an `applyDamageWithTempHP` integration issue. The existing `session68_batch3_spells` Hallow tests pass locally (149/0), so the hallow.ts changes don't regress Daylight.
5. **`f816681` (retrospective):** the only new code is `src/test/session105_phase8_retrospective.test.ts` (bestiary-aggregation audit, no combat simulation). If it fails, a parser change regressed an invariant — check which assertion failed (1 = lair_def_auto_* regressed; 2 = a stable ID dropped; 3 = isSpell mis-tagged; 4 = a bespoke flag dropped; 5 = a category emptied).
6. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
7. **Known flake:** `summons.test.ts` under parallel load — passes standalone. Re-trigger with an empty commit if it CRASHes.

## KEY FILES THIS SESSION

### New
- `src/test/session105_hallow_energy_vuln.test.ts` — Task #6 Hallow Energy Vulnerability test (41 assertions, 10 sections).
- `src/test/session105_phase8_retrospective.test.ts` — Task #4 Phase 8 retrospective regression guard (25 assertions, 6 sections).
- `zHANDOVER-SESSION-105.md` — this file.

### Modified
- `src/parser/fivetools.ts`:
  - `centerOnPoint`: added the `a point ... (chooses|can see)` alternation (S105 Task #5). Updated the doc comment (audit findings + the 4 STRONG cases + the 6 radiusFt=undefined cases + the borderline/self-centered classification).
- `src/spells/hallow.ts`:
  - Added `shouldCastEnergyVulnerability` + `executeEnergyVulnerability` + the `hallowEnergyVulnerabilityV1Implemented` metadata flag + imports (`DamageType`, `ActiveEffect`). Existing Daylight `shouldCast`/`execute`/`cleanup` unchanged.
- `src/test/open_hand_technique.test.ts`:
  - `executeFOUntilHit`: replaced the ki-consumption hit-detection with a damage-dealt check (S105 Task #0 flake fix). Updated the comment.
- `src/test/session103_choose_lair_point.test.ts`:
  - §1: +4 new centerOnPoint=true assertions (Black/Bronze/Copper/Red Dragon).
  - §2: Red Dragon::0 → Red Dragon::1 (centered-on-self example).
  - §10: Red Dragon::0 → synthetic non-centerOnPoint save_damage action (v1 regression).
  - §11: synthetic "at a point the dragon chooses" → true (S105 broadened regex).
- `src/test/session93_lair_save_damage.test.ts`:
  - §1: t2 repositioned adjacent to t1 (within radiusFt=5).
  - §10: ally repositioned adjacent to dragon (within radiusFt=5).

## ARCHITECTURAL NOTES

### Why the centerOnPoint broader regex is "STRONG-only" (not BORDERLINE)

The 4 BORDERLINE cases (Imix::1, Ogrémoch::0/::1, Olhydra::2) use "a N-foot-radius sphere/area within N feet of [creature]" — grammatically, the sphere is PLACED within range (point-selection), but the text omits "chooses/can see". The S105 regex requires the explicit "a point ... chooses/can see" clause to avoid false-positives: "within N feet of [creature]" alone could be read as "extends N feet from [creature]" (self-centered) in some phrasings. The conservative STRONG-only approach flips only actions where the text UNAMBIGUOUSLY describes point-selection (the creature chooses/sees a point). The BORDERLINE cases stay on v1 until a future session (next-action #5a) confirms the placement semantics with more context. This minimises behavioural change: only 4 actions flip, and they're the ones the rules clearly describe as point-selection.

### Why the 6 radiusFt=undefined cases get the flag but no behavioural change

The S105 regex catches "a point ... chooses/can see" regardless of whether a `radiusFt` is present. 6 actions (Drow Matron Mother::1, Geryon::0/::1, Hythonia::1, Yeenoghu::0/::1) match the phrasing but use "within N feet of that point" / "cube N feet on a side" instead of "N-foot-radius" — so `radiusFt` is not extracted. The point-selection BRANCH in `selectLairActionTargets` requires `action.centerOnPoint && action.radiusFt !== undefined`, so these 6 fall through to v1 (all candidates in rangeFt hit). The flag is still semantically correct (the text describes point-selection) and future-proofs: when `radiusFt` extraction is extended (next-action #5b), these 6 will automatically get point-selection. Setting the flag now (rather than gating on radiusFt) keeps the regex pure (matches the text's semantics) and avoids coupling two concerns.

### Why Hallow Energy Vulnerability is NOT wired into the AI dispatch

`case 'hallow'` in combat.ts calls `shouldCastHallow`/`executeHallow` (the Daylight effect). Adding Energy Vulnerability to the dispatch requires an effect-SELECTION rule: when does the AI choose Daylight (vs undead/fiends) vs Energy Vulnerability (vs any enemy, chosen damage type)? The selection depends on party composition (what damage types the party deals) — information the v1 AI doesn't track. Wiring it in without a selection rule would either (a) always pick Daylight (Energy Vulnerability never fires) or (b) always pick Energy Vulnerability (Daylight never fires vs undead/fiends). The S105 deliverable is the EFFECT implementation + test (the ActiveEffect infrastructure is the hard part); the AI selection rule is a separate, lower-risk task (next-action #6) that can build on the tested functions.

### Why the open_hand_technique flake was a real bug (not just bad luck)

The `executeFOUntilHit` function's NAME and COMMENT said "retrying until at least 1 attack hits", but the CODE checked ki consumption — which is always true after attempt 0 (ki is spent when Flurry executes, regardless of hits). So the 50-attempt retry loop never looped. The function worked ~99.75% of the time (the monk hits on attempt 0 with high probability), but the ~0.25% failure case (both attacks nat-1) produced a state with no rider → no save log → §19 failed. This is a real bug (the retry loop was dead code), not just bad luck — the fix (check damage dealt) makes the loop actually retry until a hit, as intended. The 20/20 stress-test confirms the fix.

### Coverage summary (updated for Session 105)

| Category | Count | S104 state | S105 delta | Total |
|---|---|---|---|---|
| `save_damage` | 99 | ✅ | — | 99 |
| `save_condition` | 55 | ✅ 26 point-selection | +4 point-selection (Black/Bronze/Copper/Red Dragon) | 55 (30 point-selection) |
| `save_only` | 42 | ✅ 42/42 | — | 42/42 (100%) |
| `cast_spell` | 42 | ✅ | retrospective regression guard (Task #4) | 42 |
| `bespoke` | 29 | ✅ 29/29 recognized | retrospective regression guard (Task #4) | 29/29 (100%) recognized |
| `summon` | 23 | ✅ | — | 23 |
| `buff_ally` | 7 | ✅ | — | 7 |
| `debuff_enemy` | 7 | ✅ vulnerability per-source-expiry | — | 7 |
| `movement` | 7 | ✅ | — | 7 |
| `damage_no_save` | 5 | ✅ | — | 5 |
| `spell_slot_regen` | 2 | ✅ | — | 2 |
| `visibility` | ~3 | ✅ | — | ~3 |
| `deferred` | 16 | ✅ 0 auto remain | retrospective guard confirms 0 auto (Task #4) | 0 auto (4 stable) |
| `flavor` | 6 | logged | — | 0 (logged) |
| **Total** | **~327** | **100% recognized + scored** | **4 tasks: flake fix + centerOnPoint + Hallow + retrospective** | **~327 (100%) recognized + scored** |

Session 105 does NOT change recognition coverage (still ~327/327 = 100%). It improves:
- **Test reliability** (Task #0 — open_hand_technique flake eliminated; 20/20 stress-test).
- **Targeting accuracy** for 4 more `centerOnPoint` actions (Task #5 — Black/Bronze/Copper/Red Dragon now use point-selection per the rules).
- **Spell coverage** (Task #6 — Hallow Energy Vulnerability effect implemented + tested, ready for AI wiring).
- **Regression safety** (Task #4 — Phase 8 retrospective guard; the post-Phase-8 invariants are now test-enforced).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (local, post-push): `f816681` (retrospective), `1a14258` (Hallow), `cec7b39` (centerOnPoint), `07e7e9a` (flake fix), `513ccd3` (S104 CI re-trigger)
- `git status` → clean (4 commits pushed; the `characters/*.json` test-artifact timestamp change was reverted — SHEET stream territory)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/open_hand_technique.test.ts` → **27 passed, 0 failed** (flake fixed; 20/20 stress-test)
- `npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts` → **41 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session105_phase8_retrospective.test.ts` → **25 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **65 passed, 0 failed** (was 57; +8)
- `npx ts-node --transpile-only src/test/session93_lair_save_damage.test.ts` → **52 passed, 0 failed** (target repositioning)
- `npx ts-node --transpile-only src/test/session104_vuln_audit.test.ts` → **13 passed, 0 failed** (Hallow still uses ActiveEffect)
- `npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts` → **149 passed, 0 failed** (Hallow Daylight regression)
- `npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts` → **37 passed, 0 failed** (S103 vuln pattern regression)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed**
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression)
- **CI on GitHub:**
  - `07e7e9a` (flake fix) → **ALL GREEN** (9/9 success)
  - `cec7b39` (centerOnPoint) → **ALL GREEN** (9/9 success)
  - `1a14258` (Hallow) → **pending** (build success, 0 failures so far)
  - `f816681` (retrospective) → **pending** (expected all green)
