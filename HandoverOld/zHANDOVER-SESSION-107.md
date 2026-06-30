# HANDOVER-SESSION-107

## REPOSITORY

- Branch: main
- Commits this session:
  - `5e50309` — Session 107: Hallow EV damage-type weighting v2 (S106 next-action #5)
  - `ae22303` — Session 107: Yeenoghu::1 single-target point handler (S106 next-action #4)
  - `ae9e33a` — Session 107: rangeFt "anywhere in their lair" override (S106 next-action #6)
  - `881dcc3` — Session 107: fix session99 + session102 CI flakes on 4a4fc3a (red X)
- Previous: `4a4fc3a` (S106 Hallow EV dispatch, HEAD of S106), `82db159` (S106 radiusFt), `92a3e64` (S106 BORDERLINE centerOnPoint), `7681d12` (S105 handover)
- State: clean (4 commits pushed; CI on `881dcc3`/`ae9e33a`/`ae22303` = 9/9 ALL GREEN; CI on `5e50309` (HEAD) pending at handover-write time — build + deploy + report-build-status = SUCCESS expected, 6 test chunks expected all green per local verification).
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Four commits. Session started by checking the S106 HEAD commit (`4a4fc3a`) CI — found a RED X (test chunk 6 failed: session99 §12b/§13b warding-bond tether flake + session102 §8a illusory-duplicate-redirect flake). Fixed both flakes deterministically (commit 1), then executed all 3 S106 "IMMEDIATE NEXT ACTIONS" that the z stream could execute (#4, #5, #6 — the LOW/MEDIUM-risk parser/helper refinements). The other S106 next-actions (#1 unified cast dispatch HIGH-risk, #2 char-builder SHEET-stream, #3 score-weight tuning MEDIUM) are out of scope for an autonomous z session.

### Task 0 — CI flake fixes (commit `881dcc3`) — S106 red X RESOLVED

**S106 HEAD `4a4fc3a` CI chunk 6 had 2 failures, both flakes (NOT S106 regressions):**

1. **session99_lair_phase7b2 §12b/§13b** (warding-bond tether redirect/save log): the Kobold had ONE tether lair action → round 2 lair action is skipped (2-round history: the single id is in the 2-entry history) → round-1 tether expires at round-2 init-20 → round-2 damage finds no active tether → no redirect/save log → 12b/13b fail whenever the Goblin nat-1s in round 1 (~5%) then hits in round 2 (~95%). Reproduced locally ~1/3 failure rate.
   - **FIX:** give the Kobold TWO distinct tether actions (different IDs: `TestKobold::tether` + `TestKobold::tether-b` for §12; `TestKobold::tether1` + `TestKobold::tether1b` for §13). With 2 actions, round 2 picks the second action (first is in history) → tether re-established (expires round 3) → round-2 damage finds an active tether. The only remaining non-determinism is the Goblin nat-1ing in BOTH rounds (~0.25%), which skips 12b-12e (skip, not fail). Verified 20/20 local runs pass (was ~1/3 failure rate).

2. **session102_lair_phase8b3 §8a** (illusory duplicate redirect consumed after first attack): expects exactly 1 redirect log. When BOTH goblins nat-1 all attacks, Demogorgon is never hit → 0 redirect logs → 8a fails (got 0, want 1). Reproduced locally ~1/40.
   - **FIX:** skip 8a when no redirect fires (Demogorgon not hit) — the "consumed after first attack" behaviour can't be verified when no attack landed. When redirects DO fire, still assert exactly 1 (consumed). When 2+ fire, that's a real bug (not consumed) → fail. Verified 15/15 local runs pass.

**Files:** `src/test/session99_lair_phase7b2.test.ts` (§12 + §13: 2nd tether action each), `src/test/session102_lair_phase8b3.test.ts` (§8a skip-on-no-hit). No source/engine changes — test-only flake fixes.

**Verified:** session99 60/0 (was 56/1), session102 51/0 (was 50/1). tsc baseline unchanged (5 pre-existing, 0 new). CI on `881dcc3`: **9/9 ALL GREEN** — chunk 6 fixed.

### Task 1 — `rangeFt` "anywhere in their lair" override (commit `ae9e33a`) — S106 next-action #6 RESOLVED

**Handover directive (S106):** "SGQ::0 ('centered on a point anywhere in their lair. Each creature within 20 feet of that point...') had rangeFt=20 — but that 20ft is the RADIUS (distance from the chosen point), NOT the range (distance from the lair creature). Canon says placement can be ANYWHERE in the lair (unbounded range). The §8 rangeFt extraction grabbed the first 'within N feet' regardless of context, mis-assigning the radius as the range. This bounded chooseLairActionPoint's grid-sweep to ±4 squares around the lair creature (rangeFt=20), when canon allows placement anywhere."

**Implementation:** new §8b override in `fivetools.ts`. When the text matches `/anywhere\s+in\s+(?:their|its|his|her|the)\s+lair/i`, `rangeFt` is set to `LAIR_ANYWHERE_RANGE_FT = 500` (covers any reasonable battlefield diagonal — a 50×50-cell battlefield is ~354ft diagonal). The `radiusFt` + `centerOnPoint` extractions are unchanged. The `const rangeFt` → `let rangeFt` (override requires reassignment).

**Affected actions (bestiary scan, MPMM source `spawnMonster` picks):**
- Storm Giant Quintessent::0 (save_condition) — rangeFt 20→500, radiusFt=20, centerOnPoint=true. Point-selection now activates with unbounded placement.
- Storm Giant Quintessent::1 (deferred) — rangeFt 20→500, radiusFt=20, centerOnPoint=true. Flag-only (deferred, not executed).
- Storm Giant Quintessent::2 (save_only line) — rangeFt undefined→500, radiusFt=undefined (line, no radius), centerOnPoint=false (not "centered on a point"). Point-selection does NOT activate (requires both flags), but `selectLairActionTargets` now considers all enemies within 500ft as candidates (canon: the line can originate anywhere in the lair).

(Storm Giant regular + Nafas use the same phrasing in `legendarygroups.json` but `spawnMonster` doesn't load their lair actions from MPMM — no effect.)

**Regex verified:** 0 false-positives. The 10 grep hits in `legendarygroups.json` are these 4 actions + source duplicates. No other lair action uses "anywhere in <possessive> lair" phrasing.

**Cost:** rangeFt=500 → grid-sweep ±100 cells (201×201 = 40,401 cells). For ≤10 candidates that's ~400k ops per lair-action invocation — negligible (lair actions fire once per round). 500ft exceeds any reasonable battlefield diagonal so the grid covers the whole battlefield.

**Files:**
- `src/parser/fivetools.ts` — §8 `const rangeFt` → `let rangeFt`; added §8b override block (regex + `LAIR_ANYWHERE_RANGE_FT=500` constant + detailed doc comment listing the 4 affected actions + 0 false-positives + cost analysis).
- `src/test/session103_choose_lair_point.test.ts` — §19 (NEW, 10 assertions): SGQ::0/::1/::2 rangeFt=500 + radiusFt/centerOnPoint unchanged. §20 (NEW, 4 assertions): behavioural — SGQ::0 reaches a far enemy at 100ft (20sq, beyond old rangeFt=20) with rangeFt=500.

**Verified:** 104 → 118 assertions (+14). All 14 lair/bestiary tests pass (842 assertions, 0 failed). tsc baseline unchanged. CI on `ae9e33a`: **9/9 ALL GREEN**.

### Task 2 — Yeenoghu::1 single-target point handler (commit `ae22303`) — S106 next-action #4 RESOLVED

**Handover directive (S106):** "Yeenoghu::1 ('Any creature in the space where the spike emerges') is a single-target point effect with no radius number in the text. S106 Task B left it on v1 (radiusFt=undefined) because the number-based fallback regexes can't extract a radius. With radiusFt=undefined, point-selection did NOT activate → the v1 save_damage handler hit ALL enemies within rangeFt=100 (over-approximation — the spike is single-target, but v1 hits everyone in range). A future session could add a 'single-target point' handler: if centerOnPoint=true and text matches /in (the|that) space/i, set radiusFt=0. With radiusFt=0, chooseLairActionPoint hits only the target at the chosen point (Chebyshev=0) — canon-accurate."

**Implementation:** new fallback 3 in the radiusFt extraction (`fivetools.ts` §9). When the primary "N-foot-radius" match fails AND fallbacks 1+2 fail AND `centerOnPoint=true` AND the text matches `/in (?:the|that) space/i`, set `radiusFt=0`. With `radiusFt=0`, `chooseLairActionPoint` hits only the target AT the chosen point (Chebyshev=0) — canon-accurate for "any creature in the space where the spike emerges".

**Gating on `centerOnPoint` is CRITICAL:** 12 non-point-selection actions also use "in the/that space" phrasing (Alyxian::2, Adult/Ancient Gold Dragon::1, etc.) but they have `centerOnPoint=false`, so fallback 3 does NOT apply to them (verified 0 false-positives via bestiary scan — all 12 keep `radiusFt=undefined`).

**Reorder:** `centerOnPoint` (const) moved from §9b to a new §9pre (before the radiusFt block) so fallback 3 can gate on it. The §9b comment block is retained as documentation (regex evolution history); the declaration is now in §9pre. No behavioral change from the reorder (`centerOnPoint` is a pure regex test on `cleaned`, independent of radiusFt/rangeFt).

**Behavioural change (1 action):** Yeenoghu::1 (save_damage, rangeFt=100) now uses point-selection. For spread enemies within 100ft, point-selection hits 1 target (the closest, canon-accurate) vs. v1's "all within 100ft". For stacked enemies (same cell), both are hit (both "in the space"). For the bestiary integration sweep, Yeenoghu combats now show canon-accurate single-target spike damage (no regression — bestiary_integration 77/77 pass).

**Files:**
- `src/parser/fivetools.ts` — §9pre (NEW): `centerOnPoint` moved here (before radiusFt). §9: added fallback 3 (`radiusFt=0` for `centerOnPoint` + "in (the|that) space"), updated §9 comment (3 fallbacks, 5 unique actions, Yeenoghu::1 no longer deferred). §9b: removed the const declaration (now in §9pre), kept the comment + added a "computed above in §9pre" note.
- `src/test/session103_choose_lair_point.test.ts` — §17: updated Yeenoghu::1 assertion (radiusFt undefined→0, S106→S107 transition). §21 (NEW, 10 assertions): Yeenoghu::1 parser fields + spread (1 target) + stacked (2 targets same cell) + Gold Dragon::1 false-positive guard.

**Verified:** 118 → 128 assertions (+10 net: +11 in §21, -1 outdated §17 assertion updated). All 13 lair/bestiary/spell tests pass (757 assertions, 0 failed). tsc baseline unchanged. CI on `ae22303`: **9/9 ALL GREEN**.

### Task 3 — Hallow EV damage-type weighting v2 (commit `5e50309`) — S106 next-action #5 RESOLVED

**Handover directive (S106):** "The S106 pickHallowDamageType helper (Task C) uses a v1 heuristic: counts ACTION TYPES (each action = 1 vote), not damage MAGNITUDE or action AVAILABILITY. A cantrip (1d6) counts the same as a fireball (12d6). A more sophisticated model would weight by expected damage per round (damage dice × action availability × hit chance). LOW-MEDIUM risk (helper refinement; the dispatch wiring is unchanged)."

**Implementation:** v2 replaces the count with a WEIGHTED model:

```
weight = expectedDamage × availability × hitChance
```

where:
- **expectedDamage** = the action's per-hit average (`DiceExpression.average`, computed as `count×(sides+1)/2+bonus` if `average` is missing — some test factories omit it).
- **availability** = how often the action is used per round:
  - cantrip/weapon (`slotLevel` 0 or undefined): 1.0 (repeatable every turn)
  - slotted spell (`slotLevel` >= 1): 0.5 (limited slots — conservative; a caster might cast it 1-2x then fall back to cantrips; over a 5-round combat ~0.5 avg/round)
  - recharge action: × `(7-min)/6` recharge probability (Recharge 5-6 → 2/6 ≈ 0.33; Recharge 6 → 1/6 ≈ 0.17)
- **hitChance** = probability the damage is dealt:
  - attack roll (`hitBonus` !== null, `saveDC` === null): 0.65 (typical vs reasonable AC; target AC unknown at pick time, so use the 5e default ~65% hit rate)
  - saving throw (`saveDC` !== null): 0.75 (save-for-half expected value: 50% fail → full, 50% succeed → half → 0.5×1.0 + 0.5×0.5 = 0.75)
  - neither (auto-hit / damage_no_save): 1.0

The type with the highest total weight wins (the type that benefits MOST from being doubled). Ties broken by first-seen order (deterministic — same as v1, preserved so existing S106 tests that use uniform-damage actions still pass: when all actions have the same dice, v2 weight ∝ count, so the v1 winner is preserved).

**v2 vs v1 behavioural difference (example):** party with three 1d6 fire cantrips + one 12d6 cold fireball (slotted, save-based). v1 picks fire (count 3); v2 picks cold (weight 12×3.5×0.5×0.75 = 15.75 vs fire 3×3.5×1.0×0.65 = 6.83). v2 is canon-better — doubling the 12d6 fireball (save-for-half, ~42 avg) benefits more than tripling 1d6 cantrip hits (~3.5 each).

The dispatch wiring (S106 `case 'hallow'` in `combat.ts`) is **UNCHANGED** — only the type-selection heuristic is refined. New metadata flag: `hallowEnergyVulnerabilityV2Weighted: true` (distinct from S105 implemented + S106 wired flags).

**Files:**
- `src/spells/hallow.ts`:
  - Import: added `Action`, `DiceExpression` (for `actionDamageWeight` typing).
  - Metadata: added `hallowEnergyVulnerabilityV2Weighted: true` flag.
  - `pickHallowDamageType`: rewrote to sum `actionDamageWeight` per type (was count-based). Tie-break preserved (first-seen, strict `>`).
  - `actionDamageWeight` (NEW helper): `expectedDamage × availability × hitChance` per the model above. Handles missing `average` field.
  - Doc comment: full v2 model explanation + v1→v2 behavioural difference.
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `AbilityScore` (for `saveAbility` typing in v2 helper).
  - `makeDamageActionV2` (NEW factory): flexible damage action with overrides for dice/slotLevel/hitBonus/saveDC/recharge (used by v2 tests).
  - §1: +1 assertion (v2 weighted flag = true).
  - §5b (NEW, 1 assertion): v2 picks 12d6 cold fireball over 3× 1d6 fire cantrips (higher damage outscores more common).
  - §5c (NEW, 1 assertion): v2 picks cantrip (1.0 availability) over slotted spell (0.5) with equal dice — NOT first-seen (cold was first-seen).
  - §5d (NEW, 1 assertion): v2 picks save-based (0.75 hitChance) over attack (0.65) with equal dice — NOT first-seen (fire was first-seen).
  - §5e (NEW, 1 assertion): v2 regression guard — uniform damage → v2 ∝ count → v1 winner preserved.

**Verified:** 38 → 43 assertions (+5). All 10 lair/bestiary/Hallow/spell tests pass (1054 assertions, 0 failed). tsc baseline unchanged. CI on `5e50309` (HEAD): pending at handover-write time — expected all green (the v2 change is a helper refinement; the dispatch path is unchanged; all S106 tests pass with uniform-damage actions reducing v2 to count).

## TEST STATUS

- **Flake-fix tests (2 files, 0 new assertions — flake determinism only):**
  - `session99_lair_phase7b2` — 60 passed, 0 failed (was 56/1; flake fixed via 2nd tether action).
  - `session102_lair_phase8b3` — 51 passed, 0 failed (was 50/1; flake fixed via skip-on-no-hit).
- **New/updated tests (2 files):**
  - `session103_choose_lair_point` — 128 passed, 0 failed (was 104 in S106; +14 §19/§20 rangeFt override, +10 §21 Yeenoghu, -1 §17 updated = +23 net... actually +24: §19 +10, §20 +4, §21 +10 = +24; §17 was 1 assertion updated in-place, net 0. 104+24=128 ✓).
  - `session106_hallow_ev_dispatch` — 43 passed, 0 failed (was 38 in S106; +5: §1 +1 flag, §5b/5c/5d/5e +4).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed.
  - `session92_lair_action_dispatch` — 59 passed.
  - `session93_lair_save_damage` — 52 passed.
  - `session94_lair_phase3b` — 53 passed.
  - `session99_lair_phase7b2` — 60 passed (flake fixed).
  - `session100_lair_phase8b1` — 71 passed.
  - `session101_lair_phase8b2` — 51 passed.
  - `session102_lair_phase8b3` — 51 passed (flake fixed).
  - `session103_choose_lair_point` — 128 passed (was 104; +24).
  - `session103_deferred_promotion` — 88 passed.
  - `session104_vuln_audit` — 13 passed (Hallow still uses ActiveEffect).
  - `session105_hallow_energy_vuln` — 41 passed (S105 EV effect regression).
  - `session105_phase8_retrospective` — 25 passed.
  - `session106_hallow_ev_dispatch` — 43 passed (was 38; +5).
  - `session68_batch2_spells` — 136 passed.
  - `session68_batch3_spells` — 149 passed (Hallow Daylight regression).
  - `session69_batch5_outofcombat` — 202 passed.
  - `session69_batch6_outofcombat` — 102 passed.
  - `session69_batch7_outofcombat` — 242 passed.
  - `session75_monster_slotted_spells` — 66 passed.
  - `session103_debuff_vuln_expiry` — 37 passed (S103 vuln pattern regression).
  - `bestiary_integration` — 77 passed.
  - `creature_lair_actions` — 12 passed.
  - `creature_defenses` — 92 passed (innate-vuln regression).
  - `bulk_spell_dispatch` — 214 passed.
  - `counterspell` — 35 passed.
  - `shield_reaction` — 66 passed.

- **Full 6-chunk CI suite:** local full-suite run hits sandbox memory limits (parallel ts-node OOM) — same as S105/S106. CI on GitHub is the definitive check. `881dcc3`/`ae9e33a`/`ae22303` = 9/9 ALL GREEN. `5e50309` (HEAD) pending at handover-write time (expected all green).

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-106: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts + 1 in utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts. The S107 changes are a parser regex extension + a parser `let` change + a parser reorder + a spell-module helper rewrite + test additions. CI does not run `tsc`.)

## CI STATUS

- **`881dcc3` (flake fix):** **9/9 ALL GREEN** — build + deploy + report-build-status + 6 test chunks all SUCCESS. Chunk 6 fixed (session99 + session102 flakes resolved).
- **`ae9e33a` (rangeFt override):** **9/9 ALL GREEN** — all chunks SUCCESS. The parser change (rangeFt 20→500 for SGQ) doesn't regress any lair/bestiary test.
- **`ae22303` (Yeenoghu::1):** **9/9 ALL GREEN** — all chunks SUCCESS. The parser change (radiusFt=0 for Yeenoghu::1) doesn't regress bestiary_integration (77/77).
- **`5e50309` (Hallow v2, HEAD):** PENDING at handover-write time — build + deploy + report-build-status expected SUCCESS, 6 test chunks expected all green. The v2 change is a helper refinement (pickHallowDamageType); the dispatch path (case 'hallow' in combat.ts) is unchanged; all S106 dispatch tests pass with uniform-damage actions reducing v2 to count. Expected all green.

(If a flaky CRASH appears on any chunk — the known flake was `summons.test.ts` under parallel load, now supplemented by the S107 flake fixes for session99/session102. The `open_hand_technique` flake was FIXED in S105. Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The 3 S106 next-actions completed this session (#4, #5, #6), plus the carry-overs from S104/S105/S106 + 1 NEW follow-up from S107:

### 1. Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk)

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). The S105 Phase 8 retrospective confirmed 38+ isSpell cast_spell actions exist across the bestiary, all with spellNames — ready for the unified dispatch. **Unchanged from S104/S105/S106.** Out of scope for an autonomous z session (HIGH risk).

### 2. Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream)

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). Per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S104/S105/S106.**

### 3. Score-weight tuning (S104, updated for S107)

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. **S107 update:** the S107 changes (rangeFt override for SGQ + radiusFt=0 for Yeenoghu::1) mean 2 MORE actions now use canon-accurate targeting. For SGQ::0, point-selection now reaches enemies across the whole battlefield (was bounded to 20ft). For Yeenoghu::1, point-selection now hits 1 target (was all within 100ft). The scorer may need re-tuning to reflect these more-accurate targeting models. **Updated for S107.**

### 4. Yeenoghu::1 single-target point handler (S106, RESOLVED in S107)

S107 Task 2 added fallback 3 (radiusFt=0 for `centerOnPoint` + "in (the|that) space"). **RESOLVED in S107.** No further action.

### 5. Hallow EV damage-type weighting (S106, RESOLVED in S107)

S107 Task 3 replaced the v1 count heuristic with the v2 weighted model (damage × availability × hitChance). **RESOLVED in S107.** A future refinement could model hit chance per-target (using the actual target's AC vs the attacker's hitBonus) instead of the flat 0.65, but that requires knowing the target at pick time (currently `pickHallowDamageType` is called before the target is finalized). LOW risk (helper refinement). Tracked here if a future session wants to refine further.

### 6. `rangeFt` extraction for "anywhere in their lair" (S106, RESOLVED in S107)

S107 Task 1 added the §8b override (rangeFt=500 for "anywhere in <possessive> lair"). **RESOLVED in S107.** No further action.

### 7. `open_hand_technique` flake (S105, RESOLVED)

The `executeFOUntilHit` hit-detection flake was FIXED in S105 (`07e7e9a`). **RESOLVED in S105.** No further action.

### 8. session99 + session102 CI flakes (S107, RESOLVED in S107)

S107 Task 0 fixed both flakes deterministically (session99: 2nd tether action; session102: skip-on-no-hit). **RESOLVED in S107.** No further action.

### 9. Hallow v2 hitChance per-target refinement (NEW from S107)

The S107 v2 `actionDamageWeight` uses a flat 0.65 hitChance for attack rolls (the 5e default ~65% hit rate) because the target's AC is unknown at `pickHallowDamageType` call time (the target is finalized AFTER the damage type is chosen — see the S106 dispatch rule Priority 1: AI-picked target → effect-selection). A more sophisticated model would either: (a) pick the damage type AFTER the target is finalized (reorder the dispatch), or (b) use the average party hitBonus vs an average enemy AC (the bestiary mean). Option (a) is a dispatch reorder (MEDIUM risk — touches combat.ts). Option (b) is a helper refinement (LOW risk). The flat 0.65 is a reasonable v1-within-v2 default; the per-target refinement is tracked here. **NEW from S107.**

### 10. `summons.test.ts` parallel-load flake (S106, unchanged, KNOWN)

The known flake is `summons.test.ts` under parallel load (passes standalone). Re-trigger with an empty commit if it CRASHes. **Unchanged from S106.** Not fixed (parallelism-specific; would need a test-isolation refactor).

## CI FAILURE RECOVERY

If any S107 commit has a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs. `881dcc3`/`ae9e33a`/`ae22303` are 9/9 ALL GREEN. `5e50309` (HEAD) is the only one that could fail (pending at handover-write time).
2. **`881dcc3` (flake fix):** the changes are test-only (2nd tether action in session99 §12/§13; skip-on-no-hit in session102 §8a). If a flake recurs, the fix was insufficient — but 20/20 + 15/15 local runs pass, so recurrence is unlikely.
3. **`ae9e33a` (rangeFt override):** the only code change is the §8b override in `fivetools.ts` (rangeFt=500 for "anywhere in lair") + test assertions. The override is gated on a specific regex (0 false-positives verified). If a lair test fails, check whether SGQ::0/::1/::2's rangeFt=500 caused a grid-sweep cost issue (timeout) or an unexpected targeting change.
4. **`ae22303` (Yeenoghu::1):** the changes are the §9pre centerOnPoint reorder + fallback 3 (radiusFt=0) + test assertions. The reorder is a pure declaration move (no behavioral change). The fallback 3 is gated on `centerOnPoint` (0 false-positives verified). If a lair test fails, check whether Yeenoghu::1's radiusFt=0 caused an unexpected targeting change in bestiary_integration.
5. **`5e50309` (Hallow v2):** the changes are the `pickHallowDamageType` rewrite (count→weighted) + `actionDamageWeight` helper + test additions. The dispatch path is unchanged. If `session106_hallow_ev_dispatch` fails, check whether a v2 weighting test (§5b/5c/5d) has a wrong expected value (the weights are computed by hand in the comments — verify the arithmetic). If `session68_batch3_spells` (Hallow Daylight regression) fails, the v2 change somehow affected the Daylight path (shouldn't — Daylight doesn't use pickHallowDamageType).
6. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
7. **Known flake:** `summons.test.ts` under parallel load — passes standalone. Re-trigger with an empty commit if it CRASHes. (session99/session102 flakes were FIXED in S107 Task 0.)

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-107.md` — this file.

### Modified
- `src/parser/fivetools.ts`:
  - §8 `const rangeFt` → `let rangeFt` (S107 Task 1).
  - §8b (NEW): "anywhere in their lair" override → rangeFt=500 (S107 Task 1). Detailed doc comment (4 affected actions, 0 false-positives, cost analysis).
  - §9pre (NEW): `centerOnPoint` moved here from §9b (before radiusFt) so fallback 3 can gate on it (S107 Task 2).
  - §9: added fallback 3 (`radiusFt=0` for `centerOnPoint` + "in (the|that) space"), updated §9 comment (3 fallbacks, 5 unique actions, Yeenoghu::1 no longer deferred) (S107 Task 2).
  - §9b: removed the `const centerOnPoint` declaration (now in §9pre), kept the comment + added a "computed above in §9pre" note (S107 Task 2).
- `src/spells/hallow.ts`:
  - Import: added `Action`, `DiceExpression` (S107 Task 3).
  - Metadata: added `hallowEnergyVulnerabilityV2Weighted: true` flag (S107 Task 3).
  - `pickHallowDamageType`: rewrote to sum `actionDamageWeight` per type (was count-based). Tie-break preserved (first-seen, strict `>`) (S107 Task 3).
  - `actionDamageWeight` (NEW helper): `expectedDamage × availability × hitChance` (S107 Task 3).
  - Doc comment: full v2 model explanation + v1→v2 behavioural difference (S107 Task 3).
- `src/test/session99_lair_phase7b2.test.ts`:
  - §12: 2nd tether action (`TestKobold::tether-b`) so the tether is re-established in round 2 (S107 Task 0 flake fix).
  - §13: 2nd tether action (`TestKobold::tether1b`) same (S107 Task 0 flake fix).
- `src/test/session102_lair_phase8b3.test.ts`:
  - §8a: skip-on-no-hit (when both attackers nat-1, skip instead of fail) (S107 Task 0 flake fix).
- `src/test/session103_choose_lair_point.test.ts`:
  - §17: updated Yeenoghu::1 assertion (radiusFt undefined→0, S106→S107 transition) (S107 Task 2).
  - §19 (NEW, 10 assertions): SGQ::0/::1/::2 rangeFt=500 + radiusFt/centerOnPoint unchanged (S107 Task 1).
  - §20 (NEW, 4 assertions): behavioural — SGQ::0 reaches far enemy at 100ft (S107 Task 1).
  - §21 (NEW, 10 assertions): Yeenoghu::1 parser + spread + stacked + Gold Dragon::1 false-positive guard (S107 Task 2).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `AbilityScore` (S107 Task 3).
  - `makeDamageActionV2` (NEW factory): flexible damage action with overrides (S107 Task 3).
  - §1: +1 assertion (v2 weighted flag = true) (S107 Task 3).
  - §5b (NEW, 1 assertion): v2 higher damage outscores more common (S107 Task 3).
  - §5c (NEW, 1 assertion): v2 cantrip availability outscores slotted (S107 Task 3).
  - §5d (NEW, 1 assertion): v2 save-based hitChance outscores attack (S107 Task 3).
  - §5e (NEW, 1 assertion): v2 regression guard — uniform damage → v2 ∝ count (S107 Task 3).

### Archived
- `zHANDOVER-SESSION-105.md` → `HandoverOld/zHANDOVER-SESSION-105.md` (per AGENTS.md "latest 2 in root" rule; S106 + S107 now in root).

## ARCHITECTURAL NOTES

### Why the "anywhere in their lair" override uses a fixed 500ft constant

The parser is a pure text→fields extractor; it doesn't know the battlefield size. Setting rangeFt to `undefined` (unbounded) would skip the grid-sweep entirely (the `chooseLairActionPoint` grid-sweep requires `rangeFt !== undefined` to bound the grid). So a finite constant is required. 500ft = 100 squares → grid-sweep ±100 cells (201×201 = 40,401 cells). For ≤10 candidates that's ~400k ops per lair-action invocation — negligible (lair actions fire once per round). 500ft exceeds any reasonable battlefield diagonal (a 50×50-cell battlefield is 250ft × √2 ≈ 354ft diagonal), so the grid covers the whole battlefield. The candidates filter (`chebyshev3D(cellPos, t.pos) * 5 <= radiusFt`) still bounds the effective AoE to `radiusFt` around each candidate, so off-battlefield cells don't match — the cost is O(gridCells × candidates), bounded by the grid, not unbounded.

### Why fallback 3 (radiusFt=0) is gated on centerOnPoint

12 non-point-selection actions use "in the/that space" phrasing (Alyxian::2 "create a watery form in the space of one creature", Adult/Ancient Gold Dragon::1 "banished to a dream plane ... in the space", etc.). These have `centerOnPoint=false` (no "centered on a point" / "a point ... chooses/can see" clause). Without the gate, fallback 3 would set `radiusFt=0` for all 12 — activating point-selection for non-point-selection actions (wrong). The gate (`centerOnPoint && /in (the|that) space/i`) matches ONLY Yeenoghu::1 (the single `centerOnPoint=true` + "in the space" action) and 0 others. Verified via bestiary scan: 0 false-positives.

### Why the v2 weighting preserves the v1 winner for uniform-damage parties

When all party actions have identical damage dice + availability + hitChance, the v2 weight per action is a constant C. The total weight per type = C × (action count for that type). So the type with the highest count has the highest weight — same as v1. The v1 winner is preserved. This is why all S106 tests (which use `makeDamageAction` = 1d8+3 attack cantrip for all actions) still pass: v2 reduces to count. The v2 difference only manifests when actions have DIFFERENT dice/availability/hitChance (the new §5b/5c/5d tests).

### Why the v2 tie-break is first-seen (not highest-weight-then-first-seen)

The v2 loop uses strict `>` (`if (w > bestWeight)`), so the first type with the max weight stays (subsequent ties don't override). `Object.keys(weights)` iterates in insertion order = first-seen order. So first-seen wins ties — same as v1. This preserves the S106 §4 tie-break test (radiant vs piercing, both 1 action → tie → first-seen radiant). A degenerate 0-weight edge case (all actions have 0-damage dice) returns the first-seen type (0 > -1 initial bestWeight), matching v1's behavior of returning the first damage type.

### Coverage summary (updated for Session 107)

| Category | Count | S106 state | S107 delta | Total |
|---|---|---|---|---|
| `save_damage` | 99 | ✅ | +1 point-selection (Yeenoghu::1 radiusFt=0) | 99 |
| `save_condition` | 55 | ✅ 33 point-selection | +1 unbounded-range (SGQ::0 rangeFt=500) | 55 (33 point-selection, 1 unbounded) |
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
| `deferred` | 16 | ✅ 0 auto remain | +1 unbounded-range flag (SGQ::1 rangeFt=500, semantically correct, not executed) | 0 auto (4 stable) |
| `flavor` | 6 | logged | — | 0 (logged) |
| **Total** | **~327** | **100% recognized + scored** | **3 tasks: rangeFt override + Yeenoghu radiusFt=0 + Hallow v2 weighting** | **~327 (100%) recognized + scored** |

Session 107 does NOT change recognition coverage (still ~327/327 = 100%). It improves:
- **Placement accuracy** for SGQ::0/::1 (Task 1 — rangeFt=500 → grid-sweep covers the whole battlefield; was bounded to 20ft).
- **Targeting accuracy** for Yeenoghu::1 (Task 2 — radiusFt=0 → point-selection hits 1 target at the chosen point; was all within 100ft).
- **Spell AI** (Task 3 — Hallow EV damage-type selection now uses a weighted model; picks the type that benefits most from being doubled, not the most common type).

## VERIFICATION SNAPSHOT

- `git log --oneline -6` (local, post-push): `5e50309` (Hallow v2), `ae22303` (Yeenoghu), `ae9e33a` (rangeFt override), `881dcc3` (flake fix), `4a4fc3a` (S106 Hallow EV dispatch), `82db159` (S106 radiusFt)
- `git status` → clean (4 commits pushed; S105 handover archived to HandoverOld/)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **128 passed, 0 failed** (was 104 in S106; +24)
- `npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts` → **43 passed, 0 failed** (was 38 in S106; +5)
- `npx ts-node --transpile-only src/test/session99_lair_phase7b2.test.ts` → **60 passed, 0 failed** (flake fixed; 20/20 runs)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **51 passed, 0 failed** (flake fixed; 15/15 runs)
- `npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts` → **41 passed, 0 failed** (S105 EV effect regression)
- `npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts` → **149 passed, 0 failed** (Hallow Daylight regression)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed**
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression)
- **CI on GitHub:**
  - `4a4fc3a` (S106 HEAD) → **RED X** (chunk 6: session99 + session102 flakes) — the red X this session started with.
  - `881dcc3` (S107 flake fix) → **9/9 ALL GREEN** — chunk 6 fixed.
  - `ae9e33a` (S107 rangeFt override) → **9/9 ALL GREEN**.
  - `ae22303` (S107 Yeenoghu) → **9/9 ALL GREEN**.
  - `5e50309` (S107 Hallow v2, HEAD) → **pending** (expected all green — helper refinement, dispatch unchanged).
