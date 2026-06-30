# HANDOVER-SESSION-103

## REPOSITORY

- Branch: main
- Commits this session:
  - `e351c29` — Session 103: fix test-file tsc narrowing artifacts (0 new tsc errors)
  - `084de9f` — Session 103: chooseLairActionPoint — true point-selection AoE targeting (⭐ starred next-action from S102)
  - `44c5a33` — Session 103: damageVulnerabilities per-source expiry for debuff_enemy (ActiveEffect)
  - `cc23a29` — Session 103: promote 4 lair_def_auto_* deferred actions to stable lair_def_010-013 IDs
- Previous: `989266f` (S102 handover update), `d2b623f` (S102 CI re-trigger), `d91a1e0` (S102 handover snapshot), `9677c68` (S102 Phase 8 batch 3), `f90d3dd` (cleanup), `b06f921` (S101 handover), `4c3b9b5` (S101 Phase 8 batch 2)
- State: clean (4 commits ready to push; local pre-push verification green — see TEST STATUS)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Three of the seven "IMMEDIATE NEXT ACTIONS" from the Session 102 handover were completed this session, each as a separate commit with a dedicated test file. The remaining four are deferred (see IMMEDIATE NEXT ACTIONS below).

### Task #7 — Promote `lair_def_auto_*` deferred actions to stable `lair_def_NNN` IDs (commit `cc23a29`)

**Handover directive (S102):** "Promote the 7 `lair_def_auto_*` heuristic-caught deferred actions to stable `lair_def_NNN` IDs." LOW risk.

**Re-verification finding:** the S102 handover's "7" count was stale (from Session 91). A full bestiary scan (`mergeBestiaries` + `spawnMonster` over all 7307 creatures) found only **4 unique sourceCreature base names** still caught by the `magical-darkness` heuristic safety-net — Demogorgon/Morkoth darkness actions had since been promoted to `cast_spell` (they carry `@spell darkness` tags → `isSpell` takes precedence over the heuristic). The 4 cover 10 bestiary entries (with `|mm`/`|pota`/`|egw` source variants):

| Stable ID | sourceCreature | `match` phrase | Covers (bestiary entries) |
|---|---|---|---|
| `lair_def_010` | `White Dragon` | `/freezing fog fills/i` | adult + ancient white dragon (+ `\|mm`) — 4 entries |
| `lair_def_011` | `Sea Fury` | `/foggy or murky/i` | sea fury (+ `\|egw`) — 2 entries |
| `lair_def_012` | `Imix` | `/black smoke and burning embers/i` | imix (+ `\|pota`) — 2 entries |
| `lair_def_013` | `Olhydra` | `/freezing fog fills/i` | olhydra::2 (+ `\|pota`) — 2 entries (Olhydra::1 stays `lair_def_003`) |

Each `match` phrase was verified to match ONLY the intended deferred action and none of the creature's other lair actions (e.g., White Dragon's `damage_no_save` ice-shards and `debuff_enemy` ice-wall actions do not contain "freezing fog fills").

**Design note:** 3 of the 4 promoted actions (White Dragon, Imix, Olhydra::2) also deal damage (3d6 cold / 3d6 fire / 3d6 cold; White Dragon has DC 10 CON). They remain `deferred` (the damage portion can be wired in a future phase as a `save_damage`/`damage_no_save` rider once the vision/light subsystem lands). This commit is **ID-promotion only** — no runtime behavior change (the actions were already logged-and-skipped as `deferred`; they now log a stable ID instead of an `auto_*` ID).

**Post-promotion verification:** full bestiary scan confirms **0 `lair_def_auto_*` IDs remain** (the heuristic safety-net no longer fires for any bestiary action). Stable `lair_def_*` count: 13 unique IDs (001–004, 006–013; 005 reserved as a duplicate alias of 004, unused in `LAIR_REGISTRY`).

**Files:**
- `src/parser/fivetools.ts` — added 4 entries to `LAIR_REGISTRY` (after Juiblex `lair_def_009`), each with a distinctive `match` regex + `deferredTag: 'magical-darkness'` + a comment block explaining the stale-count correction.
- `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md` — added 4 rows to the Deferred table (header updated to "12 entries"); added a "Phase 1 Update (Session 103)" section; struck through the resolved "7 lair_def_auto_*" review item with a RESOLVED note.
- `docs/LAIR-ACTIONS-TAGGING-TABLE.md` — regenerated via `scripts/gen_lair_tagging_table.ts` (isSpell=42 reflecting S102's Githzerai Anarch promotions; deferred=16 unchanged — the 4 were already counted as deferred, just with auto IDs).
- `src/test/session103_deferred_promotion.test.ts` — 88 assertions, 9 sections (parser promotion for all 4 creatures + variants; Olhydra::1 keeps lair_def_003; full bestiary scan 0 auto remain; direct parser synthetic text; regression for lair_def_001/009/006/008; no false-positive on in-scope actions; stable ID numbering).

### Task #2 — `damageVulnerabilities` per-source expiry for `debuff_enemy` (commit `44c5a33`)

**Handover directive (S102):** "`damageVulnerabilities` per-source expiry for `debuff_enemy`. v1 is permanent for combat; Phase 7 tracks as an ActiveEffect with `sourceTurnExpires`. MEDIUM risk (ActiveEffect infrastructure)."

Replaces the permanent combat-long mutation in `handleLairDebuffEnemy`'s vulnerability branch with an `ActiveEffect` that auto-expires via the `effect_pipeline.reevaluateEffects` machinery (the same `sourceTurnExpires` pattern used by `handleLairVisibility` since Session 97).

**Changes:**
- `src/types/core.ts`:
  - Added `'damage_vulnerability'` to `SpellEffectType` (with doc comment).
  - Added `addedVulnerability?: boolean` payload field — mirrors the Session 36 Protection-from-Energy `addedResistance` fix (protects innate vuln like Skeleton bludgeoning from being wrongly spliced on effect expiry).
- `src/engine/spell_effects.ts`:
  - `applySpellEffect`: new `'damage_vulnerability'` case mirrors the vuln type into `target.damageVulnerabilities` (idempotent) so `applyDamageWithTempHP` doubles incoming damage of that type (PHB p.197).
  - `undoEffect`: new `'damage_vulnerability'` case splices the type back out, but ONLY when `addedVulnerability === true` (this effect actually pushed it).
- `src/engine/combat.ts` `handleLairDebuffEnemy`: the vulnerability branch now builds an `ActiveEffect { effectType:'damage_vulnerability', payload:{ damageType, addedVulnerability: !alreadyPresent }, sourceTurnExpires: round + durationRounds - 1 }` and calls `applySpellEffect`, instead of pushing directly to `damageVulnerabilities`. Added a `VALID_DAMAGE_TYPES` guard so the parser's `(\w+)` capture can't push garbage (e.g. skill names) into `damageVulnerabilities`. Per-target log now mentions the auto-expiry round.

**Expiry semantics** (mirrors `handleLairVisibility`): `appliedTurn = round N`, `sourceTurnExpires = N + durationRounds - 1`, so a 1-round vuln ("until next initiative count 20") expires at the start of round N+1 via `reevaluateEffects`. Default `durationRounds = 1` (the lair-action text default). Also removed on caster death via `removeEffectsFromCaster`.

**Known limitation** (same as `addedResistance`/Protection-from-Energy): if two effects grant the same vuln type with staggered durations and the "adder" expires before the "non-adder", the vuln is removed prematurely. Rare for lair actions (shared 1-round duration → simultaneous expiry → correct, verified by the two-source simultaneous-expiry test).

**Files:**
- `src/types/core.ts`, `src/engine/spell_effects.ts`, `src/engine/combat.ts` (see above).
- `src/test/session103_debuff_vuln_expiry.test.ts` — 37 assertions, 12 sections (apply mirrors vuln; undo splices; undo protects innate Skeleton bludgeoning; damage doubling via `applyDamageWithTempHP`; `reevaluateEffects` expiry at round > sourceTurnExpires; no-expiry-before; `removeEffectsFromCaster` on caster death; Kraken::1 integration [effect recorded + sourceTurnExpires + auto-expires log]; invalid vuln type skipped; disadvantage branches unaffected; two-source simultaneous expiry; bestiary regression).

### Task #1 — `chooseLairActionPoint` for true point-selection AoE targeting (commit `084de9f`) ⭐

**Handover directive (S102):** "⭐ `chooseLairActionPoint` for true point-selection AoE targeting. Phase 3a/3b v1 used the lair creature's position as the AoE center — over-approximates for 'centered on a point the dragon chooses within 120 ft'. MEDIUM-HIGH risk (changes targeting model, could break existing tests)."

Implements a `chooseLairActionPoint` helper that picks the AoE centre within `rangeFt` of the lair creature maximising targets hit within `radiusFt`, replacing the v1 over-approximation (which centred the AoE on the lair creature itself and hit every enemy in `rangeFt`) for actions whose text explicitly says "centered on a point the [creature] chooses/can see within N feet of it".

**Risk mitigation — opt-in via `centerOnPoint` parser flag.** Rather than applying point-selection to every action with `radiusFt` (77 actions, 62 executed — would break many spread-enemy tests), the wiring is opt-in via a new `LairAction.centerOnPoint` parser flag set when `rawText` matches `/centered on a point/i`. This limits the behavioural change to the **30 bestiary actions that EXPLICITLY describe point-selection** (26 `save_condition` + 4 `save_damage`; 7 `deferred` are unaffected), leaving all other lair actions on the v1 model. **Zero existing tests break** (verified: full 6-chunk suite 431/431 files, 0 failed, with the wiring in place).

**Changes:**
- `src/types/core.ts`: added `centerOnPoint?: boolean` field to `LairAction` (with full doc comment explaining the opt-in semantics).
- `src/parser/fivetools.ts`: extract `centerOnPoint` from `/centered on a point/i` (§9b, after `radiusFt`). Verified: 40 bestiary actions match (29 `save_condition` + 4 `save_damage` + 7 `deferred`); the regex does NOT match "within N feet of the [creature]" (centered-on-self) or "at a point" phrasing.
- `src/engine/combat.ts`:
  - `chooseLairActionPoint` (NEW, exported): picks the candidate position maximising targets within `radiusFt` (Chebyshev). Mirrors `findBestAoECluster` in `src/ai/actions.ts`. Tie-breaks: (1) closest to lair creature, (2) lowest (x,y,z) lexicographically — both deterministic. **v1 limitation** (matches `findBestAoECluster`): candidate centres are real creature positions only; a midpoint between two spread enemies that would catch both is NOT considered (deferred to a future grid-sweep enhancement).
  - `selectLairActionTargets`: when `action.centerOnPoint && radiusFt` set, calls `chooseLairActionPoint` and returns only the targets within `radiusFt` of the chosen centre. Otherwise falls through to v1 (all candidates in `rangeFt`, `radiusFt` ignored). Updated the doc comment (was "Phase 4 will add..." — now implemented).

**Files:**
- `src/types/core.ts`, `src/parser/fivetools.ts`, `src/engine/combat.ts` (see above).
- `src/test/session103_choose_lair_point.test.ts` — 41 assertions, 11 sections (parser `centerOnPoint` on real bestiary [Blue/Black/Red Dragon]; parser `centerOnPoint` false for centered-on-self; direct `chooseLairActionPoint` [single/clustered/spread/empty/lex-tiebreak/large-radius]; integration Blue Dragon::1 [clustered→both blinded, spread→only cluster blinded]; regression Red Dragon::0 v1 [spread→both damaged]; direct parser synthetic-text specificity).

### Task (housekeeping) — test-file tsc narrowing fixes (commit `e351c29`)

Fixed 14 new `tsc --noEmit` errors introduced by the two test files above (CI uses `ts-node --transpile-only` so these didn't affect CI, but the S91–S102 standard is "0 new tsc errors"):
- `session103_debuff_vuln_expiry`: removed redundant `damageVulnerabilities = undefined` assignments (Goblin has no innate vuln — field is already undefined). The explicit `= undefined` caused TS control-flow narrowing to `never`, making `?.includes`/`?.length` type-error.
- `session103_deferred_promotion`: `eq` takes 3 args (no detail param) — the 4-arg call was a type error. Switched to `eq(label, a, e)` + a conditional `console.log`.

`tsc --noEmit`: **5 pre-existing errors, 0 new** (matches Sessions 91–102 baseline).

## TEST STATUS

- **New tests (3 files, 166 assertions total):**
  - `src/test/session103_deferred_promotion.test.ts` — **88 passed, 0 failed** (9 sections).
  - `src/test/session103_debuff_vuln_expiry.test.ts` — **37 passed, 0 failed** (12 sections).
  - `src/test/session103_choose_lair_point.test.ts` — **41 passed, 0 failed** (11 sections).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed.
  - `session92_lair_action_dispatch` — 58–59 passed (count variance is pre-existing round-loop flakiness in §7d/7e/7f conditional asserts — NOT caused by S103 changes).
  - `session93_lair_save_damage` — 52 passed.
  - `session94_lair_phase3b` — 53 passed (§10c Kraken 1-round vuln check still passes: effect applied at init-20 of round 1, `maxRounds:1` ends before the round-2 expiry check).
  - `session95_lair_phase4` — 39 passed.
  - `session96_lair_phase5` — 53 passed.
  - `session97_lair_phase6` — 35 passed.
  - `session98_lair_phase7` — 36 passed.
  - `session99_lair_phase7b2` — 60 passed.
  - `session100_lair_phase8b1` — 71 passed.
  - `session101_lair_phase8b2` — 51 passed.
  - `session102_lair_phase8b3` — 51 passed.
  - `creature_lair_actions` — 12 passed.
  - `bestiary_integration` — 77 passed.
  - `creature_defenses` — 92 passed (innate-vuln protection for Skeleton bludgeoning).
  - `power_word_stun` — 26 passed (a spell test, unrelated to lair actions — confirmed passing after a flaky CRASH under parallel load).

- **Full 6-chunk CI suite (local pre-push, with Task #1 wiring + 2 new test files, 431 files total):**

| Chunk | Files | Assertions | Failed |
|---|---|---|---|
| 1 | 72/72 | 3797 | 0 |
| 2 | 72/72 | 4007 | 0 |
| 3 | 72/72 | 4064 | 0 |
| 4 | 72/72 | 4141 | 0 |
| 5 | 72/72 | 3880 | 0 (after 1 flaky `power_word_stun` CRASH re-run — confirmed flake; passes standalone) |
| 6 | 71/71 | 3933 | 0 |
| **Total** | **431/431** | **23822** | **0** |

(Baseline was 429/429 files / 23696 assertions from Session 102. +2 test files (`session103_deferred_promotion` 88 + `session103_debuff_vuln_expiry` 37 = 125 assertions) = 431 files / 23821 expected; actual 23822 — exact match within run-to-run variance.)

- **After adding the 3rd test file (`session103_choose_lair_point`, 41 assertions, sorts into chunk 1):** chunk 1 re-confirmed green at 72/72 (3681 assertions — redistribution shifted counts). The 3rd file's insertion shifts all subsequent files' `i % 6` chunk assignment, so chunks 2–6 have a redistributed composition. **Code correctness is verified** (the tests themselves are unchanged — only their chunk assignment shifted; a test that passed before passes in its new chunk). Chunks 2–6 were not re-run to completion post-redistribution due to sandbox load (chunk runs timing out under parallel load); **CI on GitHub (ubuntu-latest, parallel 3, timeout 90) will run the definitive 432-file check.** Total expected: 432 files / ~23863 assertions / 0 failed.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91–102: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts + 1 in utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts. The S103 changes are all optional fields (`?:`) or new union members, so they don't introduce type errors. The 14 transient test-file narrowing errors from the initial Task #1/#2 commits were fixed in commit `e351c29`. CI does not run `tsc`.)

## CI STATUS

**Not yet pushed at handover-write time** — the 4 commits are local, ready to push. CI will run on push. Local pre-push verification is green (see TEST STATUS). Expected: all 6 test chunks `success`, `build` `success`, `deploy` `success`, `report-build-status` `success` — no red X.

(If a flaky CRASH appears on any chunk — the known flake is `power_word_stun` under parallel load, which passes standalone — re-trigger with an empty commit, mirroring the S100/S102 flake-re-trigger pattern.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The 4 remaining S102 next-actions not completed this session:

### 1. Unified cast dispatch for `cast_spell`

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). Note: Phase 8 batch 3's promotion of Githzerai Anarch::2 to `cast_spell` feeds into this — the `lightning bolt` spell needs to be in the dispatch registry (currently logs "not in registry"). The `creation` spell IS in the registry and executes (forward-compat flag). **Unchanged from S102.**

### 2. Character-builder `isInLair` toggle UI (RFC [DD-1])

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only). **Note:** per `AGENTS.md` stream isolation, this is the SHEET stream's territory (`src/characters/*`, `docs/characters.html`) — the z stream (this handover's stream) must NOT touch those files. A separate SHEET-HANDOVER agent should pick this up. **Unchanged from S102.**

### 3. Score-weight tuning

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. Note: S102 added `lairIllusoryDuplicate` scored as `visibilitySelf` (8); S103's `debuff_enemy` vulnerability now uses the ActiveEffect expiry (the scorer's `buffVulnerability` weight 20 is unchanged, but the effective value is now time-limited — may need tuning). Also: S103's `chooseLairActionPoint` changes the target COUNT the scorer sees for `centerOnPoint` actions (fewer targets → lower score) — the scorer now more accurately reflects realistic outcomes, but the relative ranking of `centerOnPoint` vs non-`centerOnPoint` actions may shift. **Updated for S103.**

### 4. Phase 8 retrospective — bespoke category COMPLETE

Phase 8 (batches 1-3) is complete (S102). All 31 bespoke actions recognized (100%). A retrospective could audit:
- The 7 `lair_def_auto_*` heuristic-caught deferred actions → **RESOLVED in S103** (0 remain; 4 promoted to `lair_def_010`–`lair_def_013`).
- The 40 `isSpell: true` actions in `docs/LAIR-ACTIONS-TAGGING-TABLE.md` (now 42 after S102's GA promotions) — spot-audit before the unified cast dispatch (next-action #1 above).
- Whether any of the log-only bespoke flags warrant mechanical handlers in Phase 9+.

LOW risk (documentation/audit only). **Updated for S103 (the deferred-promotion sub-item is done).**

### 5. `chooseLairActionPoint` grid-sweep enhancement (NEW from S103)

The S103 `chooseLairActionPoint` v1 uses only real creature positions as candidate centres (matches `findBestAoECluster`). A midpoint between two spread enemies that would catch both is NOT considered. A grid-sweep enhancement (enumerate all grid cells within `rangeFt` of the lair creature as candidate centres) would catch between-enemy clusters. LOW-MEDIUM risk (pure helper change; the wiring + tests already exist). Also: the remaining 47 `radiusFt` actions that use "within N feet of the [creature]" / "at a point" phrasing stay on v1 — a follow-up could audit their text for point-selection semantics and extend `centerOnPoint` extraction if warranted.

### 6. `damage_vulnerability` effectType — broader adoption (NEW from S103)

The S103 `damage_vulnerability` ActiveEffect is currently used only by `handleLairDebuffEnemy`. Other sources of granted damage-vulnerability (if any exist in spell modules) could adopt the same pattern for per-source expiry. Audit `src/spells/*` for direct `damageVulnerabilities.push(...)` calls. LOW risk.

## CI FAILURE RECOVERY

If any S103 commit has a red X on CI:

1. **Identify the failing chunk(s)** via the check-run logs.
2. **Task #7 (`cc23a29`) is parser/doc-only** — the only runtime change is 4 actions now log `lair_def_010`–`lair_def_013` instead of `lair_def_auto_*`. No test asserts on the auto IDs (verified by grep). If a test fails, it's likely a deferred-action log-string assertion — check `src/test/session92_lair_action_dispatch.test.ts` §7 (the only test that asserts deferred log content).
3. **Task #2 (`44c5a33`) changes `handleLairDebuffEnemy`** — the vulnerability branch now applies an ActiveEffect instead of a permanent push. The most likely failure: a test that runs a MULTI-ROUND combat with a debuff_enemy vuln action and asserts the vuln PERSISTS across rounds (now it expires after `durationRounds`, default 1). Verified: session94 §10c (Kraken, 1-round) passes; no multi-round vuln-persistence test exists. The `damage_vulnerability` effectType is new — if `reevaluateEffects` or `removeEffectsFromCaster` mis-handles it, a combat with a vuln-granting lair creature could break. Verified: session93/94/95 + bestiary_integration all pass.
4. **Task #1 (`084de9f`) changes targeting for `centerOnPoint` actions** — 30 bestiary actions now use point-selection. The most likely failure: a test that places enemies SPREAD beyond `radiusFt` and asserts ALL get hit/save/damaged. Verified: session93 (Red Dragon::0 magma — NOT centerOnPoint, unaffected), session93 §6 (Blue Dragon::1 — IS centerOnPoint, but only 1 in-range enemy so point-selection hits it), session94/95/96 all pass. The full 6-chunk suite passed locally with the wiring in place. If a flaky CRASH appears (known: `power_word_stun` under parallel load), re-trigger.
5. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners; the S103 sandbox showed chunk-run timeouts under `--parallel 3` load — a sandbox-resource issue, not a code issue, since all tests pass standalone).

## KEY FILES THIS SESSION

### New
- `src/test/session103_deferred_promotion.test.ts` — Task #7 test (88 assertions, 9 sections).
- `src/test/session103_debuff_vuln_expiry.test.ts` — Task #2 test (37 assertions, 12 sections).
- `src/test/session103_choose_lair_point.test.ts` — Task #1 test (41 assertions, 11 sections).
- `zHANDOVER-SESSION-103.md` — this file.

### Modified
- `src/types/core.ts`:
  - `SpellEffectType`: added `'damage_vulnerability'` (Task #2).
  - `ActiveEffect.payload`: added `addedVulnerability?: boolean` (Task #2, mirrors `addedResistance`).
  - `LairAction`: added `centerOnPoint?: boolean` (Task #1, with full doc comment).
- `src/parser/fivetools.ts`:
  - `LAIR_REGISTRY`: added 4 entries `lair_def_010`–`lair_def_013` (Task #7).
  - `extractLairAction`: added `centerOnPoint` extraction (§9b, Task #1) + added `centerOnPoint` to the return object.
- `src/engine/combat.ts`:
  - `chooseLairActionPoint` (NEW, exported): point-selection helper (Task #1).
  - `selectLairActionTargets`: wired `chooseLairActionPoint` for `centerOnPoint && radiusFt` actions; updated doc comment (Task #1).
  - `handleLairDebuffEnemy`: vulnerability branch now uses `applySpellEffect` + `ActiveEffect` with `sourceTurnExpires`; added `VALID_DAMAGE_TYPES` guard; per-target log mentions auto-expiry round (Task #2).
- `src/engine/spell_effects.ts`:
  - `applySpellEffect`: new `'damage_vulnerability'` case (Task #2).
  - `undoEffect`: new `'damage_vulnerability'` case (Task #2).
- `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md`: 4 new Deferred-table rows + Session 103 update section + resolved review item (Task #7).
- `docs/LAIR-ACTIONS-TAGGING-TABLE.md`: regenerated (Task #7).

## ARCHITECTURAL NOTES

### Why `chooseLairActionPoint` is opt-in via `centerOnPoint` (not applied to all `radiusFt` actions)

77 lair actions have `radiusFt` set (62 executed). Applying point-selection to all of them would change combat outcomes for any test that places enemies SPREAD beyond `radiusFt` and asserts all get hit — e.g., session93 §1 places goblins at 25ft and 50ft from a Red Dragon (radiusFt=20); v1 hits both, point-selection hits 1. The `centerOnPoint` flag limits the change to the 30 actions whose text EXPLICITLY says "centered on a point" (the rules-signal for point-selection). Verified: 0 existing tests break with this opt-in. The remaining 47 `radiusFt` actions (which use "within N feet of the [creature]" / "at a point" phrasing) stay on v1 until a follow-up audits their text.

### Why `damage_vulnerability` uses `addedVulnerability` (not a reference count)

The `addedVulnerability` boolean (mirroring `addedResistance`) records whether THIS effect pushed the vuln type. On undo, splice only if `addedVulnerability === true`. This protects innate vuln (Skeleton bludgeoning) from being wrongly spliced. Known limitation: two effects granting the same type with STAGGERED durations — if the adder expires first, the vuln is removed prematurely while the non-adder is still active. For lair actions (shared 1-round duration → simultaneous expiry via `reevaluateEffects`, which filters all expired effects BEFORE calling `undoEffect`), this is correct: the adder splices, the non-adder no-ops, vuln removed. Verified by the two-source simultaneous-expiry test. A reference-count approach would be more robust but adds scratch-field complexity; the boolean matches the established Protection-from-Energy pattern.

### Why `chooseLairActionPoint` uses creature positions only (not a grid sweep)

Candidate centres = each candidate target's position. This matches `findBestAoECluster` in `src/ai/actions.ts` (the established AoE-centre-selection pattern). A grid sweep (enumerate all cells within `rangeFt`) would catch a midpoint between two spread enemies that no single enemy position captures — but adds O(grid) cost and complexity. For v1, creature-position centres are sufficient (the optimal centre for maximising enemy hits, when allies are excluded, is always at or near an enemy position). The midpoint limitation is documented and deferred (next-action #5).

### Coverage summary (updated for Session 103)

| Category | Count | S102 state | S103 delta | Total |
|---|---|---|---|---|
| `save_damage` | 99 | ✅ | — | 99 |
| `save_condition` | 55 | ✅ | 26 now use point-selection targeting (Task #1) | 55 |
| `save_only` | 42 | ✅ 42/42 | — | 42/42 (100%) |
| `cast_spell` | 42 | ✅ | — | 42 |
| `bespoke` | 29 | ✅ 29/29 recognized | — | 29/29 (100%) recognized |
| `summon` | 23 | ✅ | — | 23 |
| `buff_ally` | 7 | ✅ | — | 7 |
| `debuff_enemy` | 7 | ✅ | vulnerability branch now per-source-expiry (Task #2) | 7 |
| `movement` | 7 | ✅ | — | 7 |
| `damage_no_save` | 5 | ✅ | — | 5 |
| `spell_slot_regen` | 2 | ✅ | — | 2 |
| `visibility` | ~3 | ✅ | — | ~3 |
| `deferred` | 16 | logged (8 stable + 8 auto) | **4 auto → stable** (Task #7): now 12 stable + 4 auto = 16, **0 auto remain** | 0 (logged) |
| `flavor` | 6 | logged | — | 0 (logged) |
| **Total** | **~327** | **100% recognized + scored** | **3 tasks: targeting + expiry + ID-promotion** | **~327 (100%) recognized + scored** |

Session 103 does NOT change recognition coverage (still ~327/327 = 100%). It improves:
- **Targeting accuracy** for 30 `centerOnPoint` actions (Task #1).
- **Expiry correctness** for `debuff_enemy` vulnerability (Task #2).
- **ID stability** for 4 deferred actions (Task #7 — 0 auto IDs remain).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (local, pre-push): `e351c29` (tsc fixes), `084de9f` (chooseLairActionPoint), `44c5a33` (debuff vuln expiry), `cc23a29` (deferred promotion), `989266f` (S102 handover)
- `git status` → clean (4 commits ready to push)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session103_deferred_promotion.test.ts` → **88 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_debuff_vuln_expiry.test.ts` → **37 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session103_choose_lair_point.test.ts` → **41 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **51 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **155 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/creature_defenses.test.ts` → **92 passed, 0 failed** (innate-vuln regression)
- Full 6-chunk CI suite (local, 431 files with Task #1 wiring + 2 new test files) → **431/431 files, 23822 assertions, 0 failed**
- Chunk 1 re-run (with 3rd test file, redistributed) → **72/72 files, 3681 assertions, 0 failed**
- **CI on GitHub: pending push** — expected all green (no red X) based on local pre-push verification.
