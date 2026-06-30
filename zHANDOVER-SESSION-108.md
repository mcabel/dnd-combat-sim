# HANDOVER-SESSION-108

## REPOSITORY

- Branch: main
- Commits this session:
  - `0a4ef0b` — Session 108: Hallow v2 per-target hitChance (S107 next-action #9 option b)
- Previous: `0447bd5` (S107 handover), `5e50309` (S107 Hallow v2 weighting, HEAD of S107), `ae22303` (S107 Yeenoghu), `ae9e33a` (S107 rangeFt override), `881dcc3` (S107 flake fix)
- State: clean (1 commit pushed; CI on `0a4ef0b` = 9/9 ALL GREEN — build + deploy + report-build-status + 6 test chunks all SUCCESS; github-pages/vercel suites "queued" = normal non-failure state for this repo, identical to the verified-green S107 HEAD `5e50309`).
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

One commit. Session started by verifying the S107 HEAD (`5e50309`) CI was ALL GREEN (12/12 check-runs success — confirmed no red X carried over from S107). Then executed the single S107 "IMMEDIATE NEXT ACTION" that the z stream could execute autonomously: **#9 — Hallow v2 hitChance per-target refinement, option (b)** (LOW risk, helper-only). The other S107 next-actions are either out of scope for an autonomous z session (#1 HIGH-risk unified cast dispatch, #2 SHEET-stream char-builder, #3 MEDIUM score-weight tuning — see "Why Task #3 needs no action" below) or already resolved (#4/#5/#6/#7/#8) or a known parallelism-only flake (#10).

### Task 1 — Hallow v2 per-target hitChance, option (b) (commit `0a4ef0b`) — S107 next-action #9 RESOLVED

**Handover directive (S107):** "The S107 v2 `actionDamageWeight` uses a flat 0.65 hitChance for attack rolls (the 5e default ~65% hit rate) because the target's AC is unknown at `pickHallowDamageType` call time. A more sophisticated model would either: (a) pick the damage type AFTER the target is finalized (reorder the dispatch), or (b) use the average party hitBonus vs an average enemy AC (the bestiary mean). Option (a) is a dispatch reorder (MEDIUM risk — touches combat.ts). Option (b) is a helper refinement (LOW risk)."

**Implementation (option b):** replaced the flat 0.65 attack-roll hitChance with a data-driven, per-action value derived from the bestiary AC distribution.

- New constant `BESTIARY_MEAN_AC = 14.849` — the mean Armor Class across all 5904 bestiary monsters with numeric AC in `bestiaryData/*.json` (computed via a one-off scan; AC distribution spans 5–25, roughly symmetric around the mean, modal AC 15 with 773 monsters).
- New exported helper `bestiaryHitChance(hitBonus): number` — computes `P(hit) = clamp((21 - max(2, AC - hitBonus)) / 20, 0.05, 0.95)` using `BESTIARY_MEAN_AC`. A hit requires `d20 + hitBonus >= AC` (nat 1 always misses → min successful roll is `max(2, ...)`; nat 20 always hits → upper clamp 0.95; floor 0.05 covers the degenerate `AC - hitBonus >= 20` case).
- `actionDamageWeight`: the attack-roll branch now calls `bestiaryHitChance(a.hitBonus)` instead of the flat `0.65`. The save-based (0.75) and auto-hit (1.0) branches are **unchanged**.
- New metadata flag `hallowEnergyVulnerabilityV2BestiaryHitChance: true` (distinct from the S105 implemented + S106 wired + S107 weighted flags).

**Per-action (not averaged) hitBonus:** "average party hitBonus" is implemented per-action — each action's `hitBonus` IS a party member's to-hit for that action, and using it per-action preserves the granularity a single averaged hitBonus would erase (a +8 to-hit action correctly outscores a +2 to-hit action). The bestiary mean AC is the key unknown (target AC unknown at pick time) — using it as a constant addresses the core issue.

**Mean-AC approximation is faithful:** the hitChance function is near-linear in AC over the bestiary range, so `E[P(hit|AC)] ≈ P(hit|E[AC])`. Verified: the mean-AC approximation gives 0.5576 for hitBonus +5, while the full-distribution average (averaging `P(hit|AC_i)` over all 5904 monsters) gives 0.5573 — within 0.0003, well below any decision-relevant threshold. So the single-mean-AC constant is both simpler and negligibly different from the full distribution.

**Behavioural change:** a higher-hitBonus attack action now gets a higher weight (it lands more often, so doubling its damage is more valuable). Example: a party with a +8 to-hit fire greatsword + a +2 to-hit cold dagger (identical 1d8+3 dice, both cantrips) — S107 (flat 0.65) ties → first-seen; S108 picks fire (hitChance 0.7076 > 0.4076 → fire weight 5.307 > cold 3.057). This is the S108 behavioural difference from S107: per-action hitChance granularity.

**Existing S107 tests preserved (winners unchanged):**
- §5b (3× 1d6 fire cantrip + 12d6 cold fireball): cold still wins (cold 15.75 > fire 5.855 — the fire hitChance dropped from 0.65 to 0.5576, widening cold's margin).
- §5c (fire cantrip + cold slotted, equal dice): fire still wins (availability 1.0 > 0.5; the equal-hitBonus hitChance factors out).
- §5d (fire attack + cold save, equal dice): cold still wins (save 0.75 > attack 0.5576 — margin wider than S107's 0.75 > 0.65).
- §5e (uniform 1d8+3 attack cantrips): fire (count 2) still wins (all share hitBonus +5 → same hitChance → v2 ∝ count).

The dispatch wiring (S106 `case 'hallow'` in `combat.ts`) is **unchanged** — only the attack-roll hitChance inside the `actionDamageWeight` helper is refined.

**Files:**
- `src/spells/hallow.ts`:
  - `BESTIARY_MEAN_AC = 14.849` constant (NEW) — doc: how computed + 5904 monsters + mean ≈ modal 15.
  - `bestiaryHitChance(hitBonus)` (NEW, exported) — P(hit) formula + clamps + worked examples.
  - `actionDamageWeight`: attack-roll hitChance `0.65` → `bestiaryHitChance(a.hitBonus)`.
  - metadata: `hallowEnergyVulnerabilityV2BestiaryHitChance: true` flag (NEW).
  - doc comments: S108 refinement block (per-target hitChance rationale + mean-AC faithfulness + test-preservation note) + updated weight arithmetic in the v2 example.
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `bestiaryHitChance`.
  - `approx(label, a, b)` (NEW helper): float tolerance 1e-4 for hitChance value assertions (avoids float-rounding pitfalls like `0.4075499...` ≠ `0.4076`).
  - §1: +1 assertion (`hallowEnergyVulnerabilityV2BestiaryHitChance = true`).
  - §5b/5c/5d/5e: weight-comment arithmetic updated (`0.65` → `0.5576` for hitBonus +5; winners unchanged).
  - §5f (NEW, 1 assertion): per-target hitChance — high-hitBonus (+8) fire attack outscores low-hitBonus (+2) cold attack with identical dice — NOT first-seen (S107 flat 0.65 would tie → first-seen cold; S108 picks fire via per-target weight).
  - §5g (NEW, 7 assertions): `bestiaryHitChance` direct values (+5 ≈ 0.5576, +8 ≈ 0.7076, +2 ≈ 0.4076, +0 ≈ 0.3076) + degenerate clamps (+30 → 0.95 nat-1-miss floor, −10 → 0.05 nat-20-hit floor) + monotonicity (higher hitBonus → higher-or-equal hitChance).

**Verified:** 43 → 52 assertions (+9: §1 +1, §5f +1, §5g +7). All Hallow/spell/bestiary regression tests pass (session105 41, session68_batch3 149, session104_vuln 13, bestiary_integration 77, creature_defenses 92, session103_choose_lair_point 128, session103_debuff_vuln_expiry 37, session75_monster_slotted 66, session99 60, session102 51). tsc baseline unchanged (5 pre-existing, 0 new). CI on `0a4ef0b`: **9/9 ALL GREEN**.

## TEST STATUS

- **New/updated tests (1 file):**
  - `session106_hallow_ev_dispatch` — 52 passed, 0 failed (was 43 in S107; +9: §1 +1 flag, §5f +1 per-target, §5g +7 bestiaryHitChance direct).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed.
  - `session92_lair_action_dispatch` — 59 passed.
  - `session93_lair_save_damage` — 52 passed.
  - `session94_lair_phase3b` — 53 passed.
  - `session99_lair_phase7b2` — 60 passed (S107 flake fix holds).
  - `session100_lair_phase8b1` — 71 passed.
  - `session101_lair_phase8b2` — 51 passed.
  - `session102_lair_phase8b3` — 51 passed (S107 flake fix holds).
  - `session103_choose_lair_point` — 128 passed (S107 rangeFt/Yeenoghu targeting regression — unchanged by S108).
  - `session103_deferred_promotion` — 88 passed.
  - `session104_vuln_audit` — 13 passed (Hallow still uses ActiveEffect).
  - `session105_hallow_energy_vuln` — 41 passed (S105 EV effect regression — S108 hitChance change doesn't touch the effect application).
  - `session106_hallow_ev_dispatch` — 52 passed (was 43; +9).
  - `session68_batch2_spells` — 136 passed.
  - `session68_batch3_spells` — 149 passed (Hallow Daylight regression — Daylight doesn't use pickHallowDamageType; S108 change is isolated to the EV helper).
  - `session69_batch5_outofcombat` — 202 passed.
  - `session69_batch6_outofcombat` — 102 passed.
  - `session69_batch7_outofcombat` — 242 passed.
  - `session75_monster_slotted_spells` — 66 passed.
  - `session103_debuff_vuln_expiry` — 37 passed (S103 vuln pattern regression).
  - `bestiary_integration` — 77 passed (S108 hitChance change doesn't regress bestiary combats — the damage-type pick is unaffected for single-type parties; for mixed-type parties the hitChance shift is small (0.65→0.5576 for hitBonus +5) and doesn't flip any bestiary outcome).
  - `creature_lair_actions` — 12 passed.
  - `creature_defenses` — 92 passed (innate-vuln regression).
  - `bulk_spell_dispatch` — 214 passed.
  - `counterspell` — 35 passed.
  - `shield_reaction` — 66 passed.

- **Full 6-chunk CI suite:** local full-suite run hits sandbox memory limits (parallel ts-node OOM) — same as S105/S106/S107. CI on GitHub is the definitive check. `0a4ef0b` = 9/9 ALL GREEN (6 test chunks + build + deploy + report-build-status).

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-107: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts + 1 in utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts. The S108 changes are a spell-module constant + helper + helper-call refinement + test additions. CI does not run `tsc`.)

## CI STATUS

- **`0a4ef0b` (S108 Hallow v2 per-target hitChance, HEAD):** **9/9 ALL GREEN** — build + deploy + report-build-status + 6 test chunks all SUCCESS. The github-pages and vercel check-SUITES are "queued" (conclusion=None) — this is the **normal non-failure state** for this repo (the verified-green S107 HEAD `5e50309` has the identical queued pages/vercel pattern; those deployment suites don't actually run to completion for this repo's workflow). The github-actions check-SUITES (the actual CI test workflows) are both `conclusion=success`. **No red X.**
- **`5e50309` (S107 HEAD, re-verified this session):** 12/12 check-runs ALL GREEN (confirmed no red X carried over from S107).

(If a flaky CRASH appears on any chunk — the known flake was `summons.test.ts` under parallel load, now supplemented by the S107 flake fixes for session99/session102. The `open_hand_technique` flake was FIXED in S105. Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S107 next-action #9 (option b) is completed this session. The carry-overs from S104/S105/S106/S107 + 1 NEW follow-up from S108:

### 1. Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk)

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). The S105 Phase 8 retrospective confirmed 38+ isSpell cast_spell actions exist across the bestiary, all with spellNames — ready for the unified dispatch. **Unchanged from S104/S105/S106/S107.** Out of scope for an autonomous z session (HIGH risk).

### 2. Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream)

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). Per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S104/S105/S106/S107.**

### 3. Score-weight tuning (S104, unchanged, MEDIUM — needs no action for S107/S108)

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. **S107 framed this as "may need re-tuning to reflect the more-accurate S107 targeting models" (SGQ rangeFt=500 + Yeenoghu radiusFt=0). S108 VERIFIED this needs NO action:** `scoreLairAction` (combat.ts L6744) computes its target set via `selectLairActionTargets` (L6756), which for `centerOnPoint` actions calls `chooseLairActionPoint` (L7844-7846) — so the scorer ALREADY uses the S107 targeting changes (rangeFt=500 reaches the whole battlefield for SGQ; radiusFt=0 hits 1 target for Yeenoghu). The scorer's per-target EV sum adapts automatically; the per-target `LAIR_ACTION_SCORE_WEIGHTS` (damagePerEnemy etc.) need NO re-tuning for the S107 targeting accuracy. General weight-tuning remains MEDIUM risk and out of scope for an autonomous z session (subjective objective metric + bestiary-sweep memory limits + test-regression risk). **Unchanged — no action taken or needed for S107/S108 targeting.**

### 4. Yeenoghu::1 single-target point handler (S106, RESOLVED in S107)

S107 Task 2 added fallback 3 (radiusFt=0 for `centerOnPoint` + "in (the|that) space"). **RESOLVED in S107.** No further action.

### 5. Hallow EV damage-type weighting (S106, RESOLVED in S107)

S107 Task 3 replaced the v1 count heuristic with the v2 weighted model (damage × availability × hitChance). **RESOLVED in S107.** No further action.

### 6. `rangeFt` extraction for "anywhere in their lair" (S106, RESOLVED in S107)

S107 Task 1 added the §8b override (rangeFt=500 for "anywhere in <possessive> lair"). **RESOLVED in S107.** No further action.

### 7. `open_hand_technique` flake (S105, RESOLVED)

The `executeFOUntilHit` hit-detection flake was FIXED in S105 (`07e7e9a`). **RESOLVED in S105.** No further action.

### 8. session99 + session102 CI flakes (S107, RESOLVED in S107)

S107 Task 0 fixed both flakes deterministically. S108 re-verified: session99 60/0, session102 51/0. **RESOLVED in S107.** No further action.

### 9. Hallow v2 hitChance per-target refinement (S107, RESOLVED in S108 — option b)

S108 Task 1 replaced the flat 0.65 attack-roll hitChance with `bestiaryHitChance(hitBonus)` (per-action hitBonus vs bestiary mean AC 14.849). **RESOLVED in S108.** Option (a) (dispatch reorder to use the finalized target's AC — MEDIUM risk, touches combat.ts) remains a possible future refinement but is out of scope for an autonomous z session.

### 10. Hallow v2 encounter-specific AC refinement (NEW from S108, LOW risk)

The S108 `bestiaryHitChance` uses the GLOBAL bestiary mean AC (14.849) — a single constant for all encounters. A more accurate model would use the AVERAGE AC of living enemies on the CURRENT battlefield (the encounter-specific pool from which the Hallow target is drawn), falling back to the bestiary mean when no enemies are present. `pickHallowDamageType(caster, bf)` already receives the battlefield, so the encounter avg AC is computable at pick time. This is LOW risk (helper-only, dispatch unchanged) BUT requires careful verification that `bestiary_integration` (77 assertions, real combats with Hallow casters) doesn't regress: the encounter-avg-AC could shift the damage-type pick in mixed-type parties and flip some combat outcomes. The fallback-to-bestiary-mean when no enemies preserves all existing S108 tests (the §5b-§5g tests have no enemies on the battlefield → they'd use the bestiary mean unchanged). **NEW from S108.** Tracked here if a future session wants to refine further.

### 11. `summons.test.ts` parallel-load flake (S106, unchanged, KNOWN)

The known flake is `summons.test.ts` under parallel load (passes standalone). Re-trigger with an empty commit if it CRASHes. **Unchanged from S106.** Not fixed (parallelism-specific; would need a test-isolation refactor).

## CI FAILURE RECOVERY

If the S108 commit (`0a4ef0b`) shows a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs. `0a4ef0b` is 9/9 ALL GREEN at handover-write time.
2. **`0a4ef0b` (Hallow v2 per-target hitChance):** the changes are the `BESTIARY_MEAN_AC` constant + `bestiaryHitChance` helper + the `actionDamageWeight` attack-roll branch (0.65 → bestiaryHitChance(hitBonus)) + test additions. The dispatch path (case 'hallow' in combat.ts) is unchanged. If `session106_hallow_ev_dispatch` fails, check whether a §5f/§5g assertion has a wrong expected value (the hitChance values are computed by hand in the comments — verify the arithmetic; note §5g uses `approx` with 1e-4 tolerance to avoid float rounding). If `session68_batch3_spells` (Hallow Daylight regression) fails, the hitChance change somehow affected the Daylight path (shouldn't — Daylight doesn't use pickHallowDamageType). If `bestiary_integration` fails, the hitChance shift (0.65→0.5576 for hitBonus +5) flipped a mixed-type-party damage-type pick and changed a combat outcome — re-examine whether the new pick is canon-better (higher expected damage) and update the bestiary assertion tolerance if so.
3. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
4. **Known flake:** `summons.test.ts` under parallel load — passes standalone. Re-trigger with an empty commit if it CRASHes. (session99/session102 flakes were FIXED in S107 Task 0; S108 re-verified both still pass.)

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-108.md` — this file.

### Modified
- `src/spells/hallow.ts`:
  - `BESTIARY_MEAN_AC = 14.849` (NEW constant) — bestiary mean AC, doc with computation method + 5904 monsters (S108 Task 1).
  - `bestiaryHitChance(hitBonus)` (NEW, exported) — P(hit) formula + clamps + worked examples (S108 Task 1).
  - `actionDamageWeight`: attack-roll hitChance `0.65` → `bestiaryHitChance(a.hitBonus)` (S108 Task 1).
  - metadata: `hallowEnergyVulnerabilityV2BestiaryHitChance: true` flag (NEW) (S108 Task 1).
  - doc comments: S108 refinement block + updated v2-example weight arithmetic (S108 Task 1).
- `src/test/session106_hallow_ev_dispatch.test.ts`:
  - Import: added `bestiaryHitChance` (S108 Task 1).
  - `approx(label, a, b)` (NEW helper): float tolerance 1e-4 (S108 Task 1).
  - §1: +1 assertion (S108 flag = true) (S108 Task 1).
  - §5b/5c/5d/5e: weight-comment arithmetic updated (0.65 → 0.5576 for hitBonus +5; winners unchanged) (S108 Task 1).
  - §5f (NEW, 1 assertion): per-target hitChance — high-hitBonus attack outscores low-hitBonus (NOT first-seen) (S108 Task 1).
  - §5g (NEW, 7 assertions): bestiaryHitChance direct values + clamps + monotonicity (S108 Task 1).

### Archived
- `zHANDOVER-SESSION-106.md` → `HandoverOld/zHANDOVER-SESSION-106.md` (per AGENTS.md "latest 2 in root" rule; S107 + S108 now in root).

## ARCHITECTURAL NOTES

### Why the bestiary MEAN AC (not the full distribution)

The hitChance function `P(hit|AC) = clamp((21 - max(2, AC - hitBonus))/20, 0.05, 0.95)` is near-linear in AC over the bestiary range (the clamps only bind at the extremes: AC ≤ hitBonus-1 → 0.95, AC ≥ hitBonus+19 → 0.05; the bulk of the distribution AC 10-18 is in the linear regime). For a near-linear function, `E[f(AC)] ≈ f(E[AC])`. Verified numerically: the mean-AC approximation gives 0.5576 for hitBonus +5, while averaging P(hit|AC_i) over all 5904 monsters gives 0.5573 — a difference of 0.0003, far below any decision-relevant threshold (the smallest weight difference that flips a pick is ~0.01 in practice). So the single-mean-AC constant is both simpler (one number, one formula) and negligibly different from the full-distribution average. If a future session wants the marginal extra accuracy, replace `BESTIARY_MEAN_AC` with a small `BESTIARY_AC_HISTOGRAM` constant (21 entries, AC 5-25) and average P(hit|AC)×count — but the gain is ~0.0003, not worth the complexity.

### Why per-action hitBonus (not the party average)

The handover said "average party hitBonus". Implemented per-action: each action's `hitBonus` IS a party member's to-hit for that action. Using it per-action preserves granularity a single averaged hitBonus would erase — a +8 to-hit fire greatsword correctly outscores a +2 to-hit cold dagger (the +8 lands 0.7076 of the time vs 0.4076, so doubling its damage is more valuable). Averaging the party hitBonus into a single value would give both actions the same hitChance, collapsing the per-action distinction and defeating the purpose of the refinement. The "average enemy AC" (bestiary mean) is the genuine unknown (target not finalized at pick time) — that's the averaged quantity; the hitBonus is known per-action and used per-action.

### Why the S107 tests are preserved (winners unchanged)

The S108 change replaces the flat 0.65 with `bestiaryHitChance(hitBonus)`. For the S107 test actions (all hitBonus +5), the new hitChance is 0.5576 (vs 0.65). This is a uniform scaling of the attack-roll hitChance, so:
- §5b (cold save-based vs fire attack): cold's hitChance (0.75) is unchanged; fire's dropped (0.65→0.5576). Cold's margin WIDENED. Cold still wins.
- §5c (fire cantrip vs cold slotted, both hitBonus +5): both hitChances dropped equally (0.65→0.5576), so the hitChance FACTORS OUT — the winner is still decided by availability (fire cantrip 1.0 > cold slotted 0.5). Fire still wins.
- §5d (fire attack vs cold save, both hitBonus +5 / saveDC): fire's hitChance dropped (0.65→0.5576); cold's unchanged (0.75). Cold's margin WIDENED. Cold still wins.
- §5e (uniform 1d8+3 attack cantrips, all hitBonus +5): all hitChances dropped equally → factors out → v2 ∝ count → fire (2) > cold (1). Fire still wins.

The only way an S107 test would break is if the new hitChance FLIPPED a winner — which requires the two competing types to have different hitBonuses (the S108 §5f case) or one attack + one save where the attack hitChance crosses 0.75 (impossible: bestiaryHitChance(+5)=0.5576 < 0.75; even bestiaryHitChance(+8)=0.7076 < 0.75). So all S107 tests are safe.

### Why option (b) over option (a)

Option (a) (reorder the dispatch to pick the damage type AFTER the target is finalized) would let `bestiaryHitChance` use the TARGET's actual AC instead of the bestiary mean — the most accurate model. But it's MEDIUM risk (touches the S106 dispatch rule in combat.ts: "Priority 1: AI-picked target → effect-selection" — reordering to "effect-selection → target" could break the dispatch tests §6-§14 and the bestiary_integration combats that depend on the current order). Option (b) (helper refinement) achieves most of the value (per-action hitBonus granularity + a representative enemy AC) at LOW risk (dispatch unchanged). The residual inaccuracy (bestiary mean vs the actual target's AC) is the subject of next-action #10 (encounter-specific AC — LOW risk) and #9 option (a) (target-specific AC — MEDIUM risk, future session).

### Coverage summary (updated for Session 108)

| Category | Count | S107 state | S108 delta | Total |
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
| **Total** | **~327** | **100% recognized + scored** | **1 task: Hallow v2 per-target hitChance (spell-AI refinement, no recognition change)** | **~327 (100%) recognized + scored** |

Session 108 does NOT change recognition coverage (still ~327/327 = 100%) and does NOT change lair-action targeting (the S107 rangeFt/radiusFt work is untouched). It improves:
- **Spell AI accuracy** (Task 1 — Hallow EV damage-type selection now uses a per-action, data-driven hitChance derived from the bestiary AC distribution; a higher-hitBonus attack correctly scores higher than a lower-hitBonus attack, so the party picks the damage type that benefits most from being doubled).

## VERIFICATION SNAPSHOT

- `git log --oneline -4` (local, post-push): `0a4ef0b` (S108 Hallow v2 per-target hitChance), `0447bd5` (S107 handover), `5e50309` (S107 Hallow v2 weighting), `ae22303` (S107 Yeenoghu)
- `git status` → clean (1 commit pushed; S106 handover archived to HandoverOld/)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session106_hallow_ev_dispatch.test.ts` → **52 passed, 0 failed** (was 43 in S107; +9)
- `npx ts-node --transpile-only src/test/session105_hallow_energy_vuln.test.ts` → **41 passed, 0 failed** (S105 EV effect regression)
- `npx ts-node --transpile-only src/test/session68_batch3_spells.test.ts` → **149 passed, 0 failed** (Hallow Daylight regression)
- `npx ts-node --transpile-only src/test/session104_vuln_audit.test.ts` → **13 passed, 0 failed** (Hallow still uses ActiveEffect)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed**
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression)
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **128 passed, 0 failed** (S107 targeting regression — unchanged by S108)
- `npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts` → **37 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session75_monster_slotted_spells.test.ts` → **66 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session99_lair_phase7b2.test.ts` → **60 passed, 0 failed** (S107 flake fix holds)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **51 passed, 0 failed** (S107 flake fix holds)
- **CI on GitHub:**
  - `5e50309` (S107 HEAD, re-verified) → **ALL GREEN** (12/12 check-runs success — no red X carried over).
  - `0a4ef0b` (S108 Hallow v2 per-target hitChance, HEAD) → **9/9 ALL GREEN** (build + deploy + report-build-status + test (1-6) all SUCCESS; github-pages/vercel suites "queued" = normal non-failure state, identical to verified-green `5e50309`). **No red X.**
