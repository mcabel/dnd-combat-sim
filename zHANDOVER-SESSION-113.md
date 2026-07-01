# HANDOVER-SESSION-113

## REPOSITORY

- Branch: main
- Commits this session:
  - `8e2df69` — Session 113: CI re-trigger — chunk 3 flaky failure on regenerate.test.ts (RNG edge case, unrelated to S113 pilot)
  - `f25dca3` — Session 113: lair-action cast_spell bespoke dispatch pilot (Fireball + Banishment + Fog Cloud)
  - `63fc4aa` — Session 113: RFC for lair-action cast_spell bespoke dispatch (pilot: Fireball + Banishment + Fog Cloud)
- Previous: `91f1438` (S112 handover — booming_blade.ts:127 stale comment fix), `fedb514` (S112 booming_blade.ts:127 comment fix), `4381534` (S111 handover)
- State: clean (1 RFC commit + 1 pilot commit + 1 re-trigger commit pushed; handover commit pending — this file). CI on `8e2df69` (HEAD) = **6/6 test chunks ALL GREEN** + github-actions check-suite success (github-pages/vercel check-suites queued = normal non-failure state per S111 handover). The pilot commit `f25dca3` had a chunk-3 flake on `regenerate.test.ts` (RNG edge case, unrelated to the pilot — confirmed by re-trigger `8e2df69` all green).
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Three commits: (1) RFC document, (2) pilot implementation, (3) CI re-trigger for an unrelated flake. Session started by verifying the S112 HEAD (`91f1438`) CI was ALL GREEN (confirmed via the S112 handover's 9/9 status). The user then directed execution of the S104-S112 carry-over #1 ("unified cast dispatch for cast_spell") at MEDIUM risk (re-assessed from HIGH), with explicit authorizations B1-B5 + Q1-Q5 + Q-ack-1 through Q-ack-5. The session followed a 3-phase protocol: (a) research + audit + RFC, (b) user ack on design questions, (c) pilot implementation + verification.

### Pre-Task Research (RFC commit `63fc4aa`)

Before writing any code, the session:
1. **Read the foundational RFC** (`docs/RFC-MONSTER-SPELLCASTING.md`) — the monster-spellcasting RFC that created the `monster_bespoke_registry.ts` bridge (System 3).
2. **Audited all 21 unique `cast_spell` lair-action spells** against `GENERIC_SPELLS` (System 1) and `monster_bespoke_registry` (System 3): 5 already work via generic, 15 need bespoke routing, 1 (antimagic field) has no module, 0 in both registries.
3. **Verified accurate concentration data** from raw spell JSON (`testDataSpells/spells-phb.json`) — correction: Cloud of Daggers IS concentration (user pointed out my error). 13 of 21 spells are concentration.
4. **Extracted raw lair-action text** from `legendarygroups.json` for all 21 spells, applied the user Q1 concentration categorization (4 sub-categories: A-normal, A-explicit-exception, A-duration-replacement, B-hazard-like).
5. **Discovered a parser mis-tag**: Fazrian's "lesser restoration" lair action is actually a blinding gaze that MENTIONS Lesser Restoration as the cure — not a cast. Filed as a separate parser-bug task (out of scope for pilot).
6. **Delegated a deep search** for the origin of "Phase 7" — found it's a misnomer that drifted from "Phase 5" (code comments, S94) → "Phase 6" (S96 handover) → "Phase 7" (S97+ handovers). None of the 3 RFCs define Phase 7 for this work; it's really "the unfinished part of RFC-LAIRACTIONS §8 Phase 5."

### Task 1 — RFC document (commit `63fc4aa`) — PROPOSED → APPROVED (user acked Q-ack-1..5)

**Handover directive (S112 #1, carry-over from S104):** "Unified cast dispatch for `cast_spell` (S104, unchanged, HIGH risk). v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk. Out of scope for an autonomous z session."

**Implementation:** wrote `docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md` (748 lines, 11 sections) + crosslink in `TEAMGOALS.md`. The RFC covers: TL;DR with all user authorizations, background (3 spell-dispatch systems), full audit (21 spells, module coverage, accurate concentration data, Q1 categorization, pilot batch selection), risk re-assessment (HIGH → MEDIUM with justification), proposed design (`dispatchBespokeLairSpell` helper, `LAIR_BESPOKE_SPELL_META` table, modified `handleLairCastSpell` flow, synthetic-state attachment, concentration-suppression approach, signature adapter, metadata flag), test plan (2 flipping tests rewritten with sketches, regression list, new pilot test outline, local verification commands), files to touch, open questions for user ack, rollback plan, success criteria, references, status.

**Files:**
- `docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md` — NEW, 748 lines, 11 sections.
- `TEAMGOALS.md` — crosslink to the RFC added (per user B5 directive).

**Verified:** documentation-only commit. CI on `63fc4aa`: **9/9 ALL GREEN** (build + deploy + report-build-status + 6 test chunks all success).

### Task 2 — Pilot implementation (commit `f25dca3`) — S104-S112 #1 RESOLVED (pilot, 3 of 15 spells)

**Handover directive (user Q-ack-1..5, this session):**
- Q-ack-1: pilot = Fireball + Banishment + Fog Cloud (all 3 signature shapes + both concentration categories)
- Q-ack-2: concentration-suppression = `suppressConcentration` flag on Combatant (best choice regardless of risk)
- Q-ack-3: call `shouldCast` (canon-accurate target selection; lair creatures sense via hearing per Q1, but full senses out of scope for pilot)
- Q-ack-4: test file = `src/test/session113_lair_bespoke_dispatch.test.ts`
- Q-ack-5: metadata flag in new file `src/engine/lair_action_metadata.ts` (with cross-refs for future agents)

**Implementation:** per RFC §4. See the commit message for the full design. Key points:
- New `src/engine/lair_action_metadata.ts` — feature flag `lairActionBespokeDispatchV1Implemented: true` + `LAIR_BESPOKE_SPELL_META` map (3 pilot spells) + `LairBespokeSpellMeta` interface. Documented with cross-refs to combat.ts, the RFC, the test, and this handover (per Q-ack-5).
- `Combatant.suppressConcentration?: boolean` added to `src/types/core.ts` — when true, `startConcentration()` becomes a no-op.
- `startConcentration()` in `src/engine/utils.ts` checks the flag (1-line guard at the top).
- `dispatchBespokeLairSpell()` + `callExecuteByPlanType()` in `src/engine/combat.ts` — the new dispatcher. Attaches synthetic state (action + resources), calls `shouldCast` (canon-accurate per Q-ack-3), sets `suppressConcentration` for Category B/duration-replacement spells, calls `execute` with the right signature, post-processes effects (flip `sourceIsConcentration` + set `sourceTurnExpires` for suppress mode), cleans up synthetic state in `finally`.
- `handleLairCastSpell()` modified — tries GENERIC_SPELLS first, then `dispatchBespokeLairSpell`, then logs the updated skip message (removed stale "Phase 5 will wire" wording per Q2).
- `session94_lair_phase3b.test.ts` §2 rewritten — was: assert Fireball skip log + "Phase 5"; now: assert Fireball executes, goblin takes fire damage, old skip log + "Phase 5" gone. 50/1 → 54/0.
- `session102_lair_phase8b3.test.ts` §11 rewritten — was: assert Lightning Bolt skip log + "Phase 5"; now: assert skip log with S113 wording "no bespoke lair-dispatch module" + "Phase 5" gone. 51/0 → 53/0 (+2 assertions 11d + 11e).
- New `session113_lair_bespoke_dispatch.test.ts` — 37 assertions, 7 sections: metadata flag, Fireball dispatch, Banishment dispatch, Fog Cloud dispatch (hazard + suppress conc), Lightning Bolt skip, antimagic field skip, Aboleth phantasmal force regression.

**Pilot spell verification (from the new test):**
- **Fireball (Zariel MPMM Zariel::0)**: Category A normal, AoE signature, not conc. ✅ "casts Fireball" log fires, fire damage dealt, goblin HP dropped, no concentration started, old skip log gone.
- **Banishment (Geryon Geryon::2)**: Category A normal, single-target, conc. ✅ "casts Banishment" log fires, CHA save fires, Geryon starts concentration on Banishment, old skip log gone.
- **Fog Cloud (Adult Bronze Dragon Bronze Dragon::0)**: Category B hazard, self-cast, suppress conc + 1-round lair duration. ✅ "casts Fog Cloud" log fires, obstacle created (blocksVision), NO concentration on dragon, effect `sourceIsConcentration=false`, `sourceTurnExpires=1`, `suppressConcentration` flag cleared after execute, old skip log gone.
- **Lightning Bolt (Githzerai Anarch)**: NOT in pilot batch → skips with S113-updated log wording. ✅
- **Antimagic field (Demilich)**: no module → skips with S113-updated log wording (Q2 directive). ✅
- **Phantasmal force (Aboleth)**: bespoke-only, NOT in pilot → skips with S113-updated log wording. ✅ (When S114 adds phantasmal force to the meta, this test will flip to assert execution.)

**Files:**
- `src/engine/lair_action_metadata.ts` — NEW (174 lines). Feature flag + `LAIR_BESPOKE_SPELL_META` (3 pilot spells) + `LairBespokeSpellMeta` interface + cross-refs to combat.ts/RFC/test/handover + "HOW TO ADD A NEW SPELL" guide for S114+ expansion.
- `src/types/core.ts` — `suppressConcentration?: boolean` added to Combatant (with S113 doc comment).
- `src/engine/utils.ts` — `startConcentration()` checks `suppressConcentration` flag (1-line guard).
- `src/engine/combat.ts` — import from `lair_action_metadata`; add `callExecuteByPlanType` + `dispatchBespokeLairSpell` (~230 lines); modify `handleLairCastSpell` to call the new helper; update skip log message.
- `src/test/session94_lair_phase3b.test.ts` — rewrite §2 (lines 176-215 → 176-233).
- `src/test/session102_lair_phase8b3.test.ts` — rewrite §11 (lines 425-455 → 425-468).
- `src/test/session113_lair_bespoke_dispatch.test.ts` — NEW (442 lines, 37 assertions, 7 sections).

**Verified:**
- tsc --noEmit: 5 pre-existing errors, 0 new (unchanged baseline).
- `session113_lair_bespoke_dispatch`: 37 passed, 0 failed (new test).
- `session94_lair_phase3b`: 54 passed, 0 failed (was 50/1 in S112; §2 rewritten).
- `session102_lair_phase8b3`: 53 passed, 0 failed (was 51/0 in S112; §11 rewritten +2 asserts).
- `session91/92/93/96/97/98/99/100/103_choose/103_deferred/105_retrospective`: all pass (lair-action regression).
- `bestiary_integration`: all pass.
- Chunk 2 local (73 files, 3869 assertions): 0 failed.
- Chunk 3 local (73 files, 4168 assertions): 0 failed.
- CI on `f25dca3`: 5/6 test chunks success + chunk 3 FAILED on `regenerate.test.ts` (RNG flake, unrelated to pilot — see Task 3).

### Task 3 — CI re-trigger for `regenerate.test.ts` RNG flake (commit `8e2df69`)

**The red X:** `f25dca3` CI chunk 3 failed: `regenerate.test.ts` §4b "Ally HP capped at maxHP: got 99, want 100".

**Root cause analysis (pre-existing test bug, NOT caused by the S113 pilot):**
- The test sets `ally.currentHP=90, ally.maxHP=100`, then casts Regenerate (heals 4d8+3 = 7..35).
- The assertion `eq('Ally HP capped at maxHP', ally.currentHP, 100)` expects `currentHP === 100`.
- But if the heal roll is 7, 8, or 9 (4d8+3 in range 7..9), `ally.currentHP = 97, 98, or 99` — NOT capped at 100.
- The test is mathematically unable to guarantee HP=100 for heal rolls < 10.
- P(4d8+3 < 10) = P(4d8 ≤ 6) = number of ways to sum 4d8 to ≤6 / 8^4 = (1+4+10+20+35+56) / 4096 = 126/4096 ≈ 3.1%. So the flake triggers ~3% of the time.
- Local verification: `regenerate.test.ts` passes 10/10 standalone (RNG didn't hit the edge case in 10 runs).
- The S113 pilot does NOT touch Regenerate, `applyHeal`, or `effectiveMaxHP` — the failure is unrelated to the lair-action bespoke dispatch change.

**Fix (re-trigger):** per the S111 handover's CI FAILURE RECOVERY guidance ("Re-trigger with an empty commit if any NEW flake CRASHes"), pushed an empty commit `8e2df69` to re-trigger CI. This is an assertion failure (not a CRASH), but the same logic applies — the flake is unrelated to the code change.

**Verified:** CI on `8e2df69`: **6/6 test chunks ALL GREEN** + github-actions check-suite success. The flake is confirmed (didn't trigger on re-run). The pilot code on `f25dca3` is sound — the chunk-3 failure was a pre-existing RNG edge case in `regenerate.test.ts` that happened to trigger on the pilot's CI run.

**Note for future agents:** the `regenerate.test.ts` §4b flake is a pre-existing test bug (mathematically unable to guarantee HP=100 for heal rolls < 10). A future session should fix it by either (a) setting `ally.currentHP` low enough that any heal caps (e.g. currentHP=70, so heal ≥ 30 always caps — but 4d8+3 max is 35, so currentHP=65 guarantees cap), or (b) asserting `ally.currentHP >= 97` (the minimum after a heal of 7), or (c) mocking the heal roll to a known value. Out of scope for S113 (the pilot doesn't touch Regenerate). Filed as a follow-up in the next-actions list (#16).

## TEST STATUS

- **New/updated tests (3 files):**
  - `session113_lair_bespoke_dispatch` — 37 passed, 0 failed (NEW — pilot test, 7 sections).
  - `session94_lair_phase3b` — 54 passed, 0 failed (was 50/1 in S112; §2 rewritten: Fireball now executes instead of skipping).
  - `session102_lair_phase8b3` — 53 passed, 0 failed (was 51/0 in S112; §11 rewritten +2 assertions: S113 skip log wording + "Phase 5" gone).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed.
  - `session92_lair_action_dispatch` — 59 passed.
  - `session93_lair_save_damage` — 52 passed.
  - `session96_lair_phase5` — 53 passed.
  - `session97_lair_phase6` — 35 passed.
  - `session98_lair_phase7` — 36 passed.
  - `session99_lair_phase7b2` — 60 passed.
  - `session100_lair_phase8b1` — 71 passed.
  - `session103_choose_lair_point` — 128 passed.
  - `session103_deferred_promotion` — 88 passed.
  - `session105_phase8_retrospective` — 25 passed.
  - `bestiary_integration` — 77 passed.
- **Full 6-chunk CI suite:** local full-suite run hits sandbox memory limits (parallel ts-node OOM) — same as S105-S112. CI on GitHub is the definitive check. `8e2df69` CI = **6/6 test chunks ALL GREEN** + github-actions check-suite success.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-112: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts L2618+L2638 + 1 in utils.ts L601 + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts L602+L609. The S113 changes add `suppressConcentration?: boolean` to Combatant + a 1-line guard in `startConcentration` + the new `dispatchBespokeLairSpell`/`callExecuteByPlanType` functions + test additions. None touch the 5 pre-existing error sites. CI does not run `tsc`.)

## CI STATUS

- **`91f1438` (S112 handover, re-verified this session):** **9/9 ALL GREEN** — no red X carried over from S112.
- **`63fc4aa` (S113 RFC document):** **9/9 ALL GREEN** — documentation-only commit (RFC + TEAMGOALS crosslink).
- **`f25dca3` (S113 pilot implementation):** **5/6 test chunks success + chunk 3 FAILED** on `regenerate.test.ts` §4b (RNG flake, pre-existing test bug, unrelated to the pilot — see Task 3 above). The other 5 chunks (including chunks 2 + 3 which contain all lair-action tests) passed.
- **`8e2df69` (S113 CI re-trigger, HEAD):** **6/6 test chunks ALL GREEN** + github-actions check-suite success. github-pages/vercel check-suites queued (normal non-failure state per S111 handover). **No red X.** The flake is confirmed (didn't trigger on re-run); the pilot code is sound.

(If a flaky CRASH appears on any chunk — the known flake is `summons.test.ts` under parallel load (S106, not reproduced locally). The `regenerate.test.ts` §4b RNG flake (S113, ~3% trigger rate) is a pre-existing test bug — see next-action #16. The `open_hand_technique` flake was FIXED in S105; session99/session102 flakes were FIXED in S107; the quivering_palm §18 flake was FIXED in S110. Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S104-S112 next-action #1 (unified cast dispatch) is RESOLVED this session (pilot, 3 of 15 spells). The remaining 12 spells are mechanical repetition (each fits one of the 3 signature × concentration combinations the pilot proved). The carry-overs from S104-S112 + NEW follow-ups from S113:

### 1. Unified cast dispatch — FULL COVERAGE (S113 pilot RESOLVED; S114+ expansion NEW)

The S113 pilot proved the pattern (Fireball + Banishment + Fog Cloud cover all 3 signature shapes + both concentration categories). The remaining 12 spells are mechanical repetition: add entries to `LAIR_BESPOKE_SPELL_META` + add cases to `callExecuteByPlanType` + add tests. Estimated LOW-MEDIUM risk (the pattern is proven; each new spell is a small additive change). The 12 spells, grouped by signature × concentration:

**Category A normal (creature casts, concentration applies) — single-target:**
- cloud of daggers (Kyrilla) — conc, single-target
- moonbeam (Kyrilla) — conc, single-target
- phantasmal force (Aboleth) — conc, single-target
- power word kill (Orcus) — not conc, single-target

**Category A normal — self/special:**
- wall of force (Elder Brain) — conc, special (wall, v1: treat as self)
- command (Graz'zt) — not conc, single-target (multi-target per lair text but v1 single)

**Category A explicit exception / duration-replacement — suppress conc:**
- darkness (Demogorgon) — explicit exception, self, suppress, 1 round
- giant insect (Arasta) — duration-replacement, special (summon), suppress

**Category B hazard-like — suppress conc:**
- sleet storm (Yan-C-Bin) — hazard, AoE, suppress, 1 round
- spike growth (Copper Dragon) — hazard, AoE, suppress, until dragon uses lair again/dies
- simulacrum (Fraz-Urb'luu) — hazard, special (summon), suppress, 1 round

**Not in pilot batch (already in GENERIC_SPELLS — no change needed):**
- confusion, creation, giant insect (wait — giant insect IS in GENERIC_SPELLS per the audit; recheck), major image, mirage arcane

**Recommended S114 batching:** 3-4 spells per commit (group by signature shape to reuse the adapter). Start with the 4 single-target Category A spells (cloud of daggers, moonbeam, phantasmal force, power word kill) — all use the `single` signature adapter already proven by Banishment.

### 2. Unified cast dispatch — `antimagic_field.ts` module (S113 Q2 deferred, NEW)

Q2 directive: keep the skip for `antimagic field` (no module exists). A future session should implement `src/spells/antimagic_field.ts` properly (Antimagic Field is a complex spell — suppresses magic in a 10-ft radius, affects spells/magic items/summons/etc.). Once implemented, add it to `LAIR_BESPOKE_SPELL_META` with `concentrationMode: 'suppress'` (Category B hazard per Q1 — "an antimagic field fills the space of the target"). HIGH risk (complex spell, touches many engine subsystems). Out of scope for an autonomous session without a dedicated RFC.

### 3. `lesser restoration` parser mis-tag fix (S113 discovery, NEW)

Fazrian's lair action `Fazrian::2` is tagged `isSpell: true, spellName: 'lesser restoration'`, but the raw lair-action text is: "...the creature is {@condition blinded}. The blindness lasts until the creature receives a {@spell lesser restoration} spell or similar magic." The spell is mentioned as a CURE, not cast as a lair action. This is a parser bug (the `{@spell lesser restoration}` reference was mis-detected as a cast). The lair action is actually a `save_condition` (blinding gaze). LOW-MEDIUM risk (parser fix). File: `src/parser/fivetools.ts` or `src/parser/index.ts` (wherever lair-action spell detection lives).

### 4. `regenerate.test.ts` §4b RNG flake fix (S113 discovery, NEW)

Pre-existing test bug: the assertion `eq('Ally HP capped at maxHP', ally.currentHP, 100)` is mathematically unable to guarantee HP=100 for heal rolls < 10 (4d8+3 in range 7..9 → HP 97..99). Triggers ~3% of CI runs. Fix options: (a) set `ally.currentHP=65` so heal ≥ 35 always caps (but 4d8+3 max is 35, so currentHP=65 guarantees cap), (b) assert `ally.currentHP >= 97` (minimum after heal of 7), (c) mock the heal roll. LOW risk (test-only fix). File: `src/test/regenerate.test.ts` §4b (line 267).

### 5. Unified cast dispatch — `lairActionSpellMode` parser flag (S113 future refactor, NEW)

The S113 pilot uses a hardcoded `LAIR_BESPOKE_SPELL_META` table to distinguish Category A (creature casts) from Category B (hazard-like). A cleaner future approach: add a `lairActionSpellMode?: 'cast' | 'hazard'` field to the `LairAction` interface, populated by the parser based on the raw lair-action text ("casts the spell" → 'cast'; "as though it had cast" / "identical to the spell" / "fills the space" → 'hazard'). This would make the dispatcher read the mode from the action instead of a hardcoded table. MEDIUM risk (touches the parser + LairAction interface). Defer until the S114 expansion adds enough spells to justify the refactor.

### 6-19. (Carry-overs from S112, unchanged)

- #6: Unified cast dispatch for `cast_spell` — **RESOLVED in S113** (pilot). Full coverage = #1 above.
- #7: Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream — but per user B1 directive this session, z agent now owns SHEET+CORE files; still, a SHEET-stream handover may be cleaner for UI work).
- #8: Score-weight tuning (S104, unchanged, MEDIUM).
- #9-15: (RESOLVED in S107/S108/S109/S110/S111/S112 — see S112 handover for details).
- #16: `regenerate.test.ts` §4b RNG flake fix (S113, NEW — see #4 above).
- #17: `lesser restoration` parser mis-tag fix (S113, NEW — see #3 above).

## CI FAILURE RECOVERY

If `f25dca3` or `8e2df69` shows a red X on CI:

1. **`63fc4aa` (RFC document):** documentation-only — no behavioural surface. If ANY chunk fails, it's a flake. Re-trigger.
2. **`f25dca3` (pilot implementation):** the change adds `dispatchBespokeLairSpell` + `callExecuteByPlanType` + the `LAIR_BESPOKE_SPELL_META` table + `suppressConcentration` flag + `startConcentration` guard + test rewrites. The dispatch path (handleLairCastSpell) is the only modified hot path. If `session94_lair_phase3b` §2 fails, check whether Fireball actually executes (the new assertions expect "casts Fireball" + goblin damage). If `session102_lair_phase8b3` §11 fails, check the skip log wording (must include "no bespoke lair-dispatch module" and NOT include "Phase 5"). If `session113_lair_bespoke_dispatch` fails, check the pilot spell dispatch (Fireball/Banishment/Fog Cloud) — the shouldCast gating may need adjustment if the test setup doesn't meet the shouldCast conditions (e.g. Fog Cloud needs low HP + near enemy). If `regenerate.test.ts` §4b fails — it's the RNG flake (see #4 above), re-trigger.
3. **`8e2df69` (CI re-trigger):** empty commit — no behavioural surface. If ANY chunk fails, it's a flake. Re-trigger.
4. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).
5. **Known flakes:** `regenerate.test.ts` §4b (S113, ~3% RNG, see #4), `summons.test.ts` under parallel load (S106, not reproduced locally). The `open_hand_technique` flake was FIXED in S105; session99/session102 flakes were FIXED in S107; the quivering_palm §18 flake was FIXED in S110.

## KEY FILES THIS SESSION

### New
- `docs/RFC-LAIR-ACTION-BESPOKE-DISPATCH.md` — the RFC (748 lines, 11 sections).
- `src/engine/lair_action_metadata.ts` — feature flag + `LAIR_BESPOKE_SPELL_META` (3 pilot spells) + `LairBespokeSpellMeta` interface + cross-refs + "HOW TO ADD A NEW SPELL" guide (174 lines).
- `src/test/session113_lair_bespoke_dispatch.test.ts` — pilot test (37 assertions, 7 sections, 442 lines).
- `zHANDOVER-SESSION-113.md` — this file.

### Modified
- `src/types/core.ts` — `suppressConcentration?: boolean` added to Combatant (with S113 doc comment).
- `src/engine/utils.ts` — `startConcentration()` checks `suppressConcentration` flag (1-line guard).
- `src/engine/combat.ts` — import from `lair_action_metadata`; add `callExecuteByPlanType` + `dispatchBespokeLairSpell` (~230 lines); modify `handleLairCastSpell` to call the new helper; update skip log message (remove "Phase 5 will wire").
- `src/test/session94_lair_phase3b.test.ts` — rewrite §2 (Fireball now executes, 50/1 → 54/0).
- `src/test/session102_lair_phase8b3.test.ts` — rewrite §11 (S113 skip log wording, 51/0 → 53/0).
- `TEAMGOALS.md` — crosslink to the RFC.

### Archived
- `zHANDOVER-SESSION-111.md` → `HandoverOld/zHANDOVER-SESSION-111.md` (per AGENTS.md "latest 2 in root" rule; S112 + S113 now in root).

## ARCHITECTURAL NOTES

### Why the `suppressConcentration` flag (not post-execute cleanup)

Per user Q-ack-2 ("pick the best choice regardless of risk"), the S113 pilot uses a `suppressConcentration?: boolean` flag on `Combatant` that `startConcentration()` checks at the top. This is architecturally cleaner than post-execute cleanup because:
1. Concentration is never started, so no cleanup needed.
2. More maintainable — future bespoke modules added to the lair-dispatch automatically get concentration suppression.
3. More correct — `startConcentration` is the canonical entry point; gating it at the source is better than undoing its effects.
4. Follows the existing pattern — `startConcentration` already checks `caster.concentration?.active`; adding a `suppressConcentration` flag is a natural extension.

The flag is set transiently (true before `execute()`, cleared in the `finally` block after `execute()` returns). The post-processing of effects (flipping `sourceIsConcentration` to false + setting `sourceTurnExpires`) is still needed because the bespoke module's `execute()` creates effects with `sourceIsConcentration: true` hardcoded — the flag only suppresses the concentration start, not the effect metadata.

### Why call `shouldCast` (not bypass it)

Per user Q-ack-3 ("canon is good"), the S113 pilot calls the bespoke `shouldCast` for target selection. This is canon-accurate: a lair creature wouldn't waste a spell on an invalid target. The trade-off (per the user's note): lair creatures sense via hearing/etc. (not just sight), so `shouldCast`'s LoS checks may conservatively skip some valid casts. Implementing full "senses other than sight" is out of scope for the pilot — it would require a per-creature senses model (blindsight, tremorsense, truesight, etc.) and a "hidden vs not-hidden" detection system. The pilot accepts that `shouldCast` may skip some valid casts; a future session can relax the LoS checks for lair creatures if needed.

### Why the `LAIR_BESPOKE_SPELL_META` table (not a parser flag)

The S113 pilot uses a hardcoded per-spell table in `src/engine/lair_action_metadata.ts` to distinguish Category A (creature casts, concentration applies) from Category B (hazard-like, suppress concentration). This is simpler than a parser-level `lairActionSpellMode?: 'cast' | 'hazard'` flag because:
1. No parser change needed (the pilot is engine-only).
2. The categorization is per-spell, not per-lair-action (the same spell can be cast by different creatures with different lair-action wordings — e.g. Darkness is Category A normal for Morkoth but Category A explicit-exception for Demogorgon). The table can handle this by keying on (spellName, creature) if needed; a parser flag would need to be per-lair-action.
3. The table is easy to extend (add a row per new spell) and easy to audit (all categorizations in one file).

The trade-off: the table doesn't scale well beyond ~30 spells. Once the S114 expansion adds the remaining 12 spells, a future session should refactor to a parser-level flag (see next-action #5).

### Why the post-execute effect processing (for suppress mode)

For Category B / duration-replacement spells (Fog Cloud pilot), the bespoke `execute()` creates effects with `sourceIsConcentration: true` hardcoded (the module's default). Since we suppressed concentration start via the flag, those effects would never be cleaned up via concentration break. The fix: after `execute()` returns, scan the caster's `activeEffects` for effects with `spellName === meta.canonicalName` and `appliedTurn === bf.round` (i.e. just created), and flip `sourceIsConcentration` to false + set `sourceTurnExpires = bf.round + lairDurationRounds - 1`. This ensures:
1. The effect is NOT tied to the caster's concentration (so it won't be cleaned up by an unrelated concentration break).
2. The effect auto-expires via `reevaluateEffects` at the lair-specific duration (typically 1 round for "until initiative count 20 next round").

This is slightly fragile (relies on the effect's `spellName` matching the canonical name), but it works for the pilot. A cleaner future approach: add a `lairDurationRoundsOverride?` field to `Combatant` that the bespoke `execute()` reads when creating effects — but that requires modifying each bespoke module (out of scope for the pilot).

### Coverage summary (unchanged for Session 113)

Session 113 does NOT change recognition coverage (still ~327/327 = 100%) and does NOT change lair-action targeting. It improves:
- **Lair-action spell execution** (Task 2 — 3 of 15 bespoke-only spells now actually execute when their lair action fires, instead of silently no-op'ing. The remaining 12 are mechanical repetition for S114+).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (local, post-push): `8e2df69` (S113 CI re-trigger), `f25dca3` (S113 pilot), `63fc4aa` (S113 RFC), `91f1438` (S112 handover), `fedb514` (S112 booming_blade comment fix)
- `git status` → clean (3 commits pushed — RFC + pilot + re-trigger; S111 handover archived to HandoverOld/; S113 handover commit pending — this file)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session113_lair_bespoke_dispatch.test.ts` → **37 passed, 0 failed** (NEW pilot test)
- `npx ts-node --transpile-only src/test/session94_lair_phase3b.test.ts` → **54 passed, 0 failed** (was 50/1 in S112; §2 rewritten)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **53 passed, 0 failed** (was 51/0 in S112; §11 rewritten +2 asserts)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **155 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session105_phase8_retrospective.test.ts` → **25 passed, 0 failed**
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed**
- `npx ts-node --transpile-only scripts/run_tests.ts --chunk 2 --total 6 --parallel 2 --timeout 120 --quiet` → **73/73 files passed, 3869 assertions, 0 failed**
- `npx ts-node --transpile-only scripts/run_tests.ts --chunk 3 --total 6 --parallel 2 --timeout 90 --quiet` → **73/73 files passed, 4168 assertions, 0 failed**
- **CI on GitHub:**
  - `91f1438` (S112 handover, re-verified) → **9/9 ALL GREEN** (no red X carried over from S112).
  - `63fc4aa` (S113 RFC document) → **9/9 ALL GREEN** (documentation-only).
  - `f25dca3` (S113 pilot implementation) → **5/6 test chunks success + chunk 3 FAILED** on `regenerate.test.ts` §4b (RNG flake, pre-existing test bug, unrelated to pilot — confirmed by re-trigger).
  - `8e2df69` (S113 CI re-trigger, HEAD) → **6/6 test chunks ALL GREEN** + github-actions check-suite success (github-pages/vercel queued = normal non-failure state). **No red X.**
