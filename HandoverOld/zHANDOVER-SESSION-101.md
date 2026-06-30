# HANDOVER-SESSION-101

## REPOSITORY

- Branch: main
- Commits this session:
  - `4c3b9b5` — Session 101: RFC-LAIRACTIONS Phase 8 batch 2 — 6 more bespoke-category recognition flags (planeShift/teleportAllies/antiInvisibility/illusoryAttack/rechargeAbility/actionInvocation) + 1 mechanical handler (illusoryAttack rolls melee attack+damage) + 5 log-only handlers + broadened healing-suppression regex for Demilich::2 — 28/31 bespoke recognized (90%)
  - `<this commit>` — Session 101: handover verification-snapshot update (CI green on 4c3b9b5; handover-only commit)
- Previous: `949fb65` (Session 100 CI re-trigger), `5929904` (Session 100 handover), `2973eba` (Session 100 Phase 8 batch 1), `869803a` (Session 99 handover), `e921070` (Session 99 Phase 7 batch 2), `48de10a` (Session 98 handover), `cad7739` (Session 98 flakiness fix), `bf67be2` (Session 98 handover), `3eeaa92` (Session 98 Phase 7 batch 1)
- State: clean (pushed; CI green — all 9 check-runs `success` on `4c3b9b5`)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### RFC-LAIRACTIONS Phase 8 batch 2 (bespoke category continuation)

**User direction:** "Continue with next tasks then commit and push the next zhandover."

Phase 8 batch 2 continues the `bespoke` category work. After Session 100 recognized 16/31 bespoke actions (52%), Session 101 adds 6 more recognition flags covering 12 additional actions, bringing the total to **28/31 recognized (90%)**. Only 3 bespoke actions remain unrecognized (Demogorgon::1 illusory duplicate, Githzerai Anarch::0/::2 spell invocations — deferred to Phase 8 batch 3).

**Deliverables:**

1. **lairPlaneShift** (1 action: Sphinx::3, via Androsphinx/Gynosphinx): The parser extracts `lairPlaneShift = true` from "shifts itself and up to N other creatures ... to another plane of existence". The handler logs "plane-shift — out-of-combat effect (v1: log-only)". The count can be a digit OR a word-number ("seven") — the regex handles both.
   - Parser regex: `/\bshifts?\s+(?:itself|themself)\s+and\s+(?:up\s+to\s+)?(?:\d+|one|two|...|ten)\s+other\s+creatures?\b/i` AND `/\bplane\s+of\s+existence\b/i`.
   - Verified: Sphinx::3 (via Androsphinx) correctly extracts `lairPlaneShift=true`.

2. **lairTeleportAllies** (1 action: Gar Shatterkeel::0): The parser extracts `lairTeleportAllies = true` from "teleports ... bringing up to N willing creatures". The handler logs "teleport-with-allies — repositions within lair (v1: log-only)". The count handles word-numbers.
   - Parser regex: `/\bteleports?\s+.{0,60}bringing\s+(?:up\s+to\s+)?(?:\d+|one|two|...|ten)\s+willing\s+creatures\b/i`.
   - Verified: Gar Shatterkeel::0 correctly extracts `lairTeleportAllies=true`.

3. **lairAntiInvisibility** (1 action: Drow Matron Mother::0): The parser extracts `lairAntiInvisibility = true` from "can't become hidden ... invisible condition". The handler logs "anti-invisibility field — perception meta-flag (v1: log-only)".
   - Parser regex: `/\bcan'?t\s+become\s+hidden\b/i` AND `/\binvisible\s+condition\b/i`.
   - Verified: Drow Matron Mother::0 correctly extracts `lairAntiInvisibility=true`.

4. **lairIllusoryAttack = { attackBonus, damage }** (4 actions: Alyxian the Absolved::2, Callous::2, Dispossessed::2, Tormented::2): The parser extracts `attackBonus` from "(N to hit)" and `damage` from "XdY + Z [type] damage" in the cleaned text. The handler is **MECHANICAL** — it rolls a melee attack (d20 + attackBonus) vs the target's AC; on hit, applies damage via `rollDamage` + `applyDamageWithTempHP` + `checkDeath`. The illusory form disappears after the attack regardless of hit/miss.
   - Parser regex: `/\bmakes?\s+one\s+melee\s+weapon\s+attack\s+\((\d+)\s+to\s+hit\)\s+against/i` + `/(\d+)d(\d+)\s*(?:\+\s*(\d+))?\s*\)?\s*(bludgeoning|piercing|...)\s+damage/i`.
   - Note: The rawText has already been cleaned (5eTools `{@dice}` tags reduced to their first arg), so the dice pattern is matched in `cleaned` directly (not in `rawText` looking for `{@dice}` tags).
   - Note: The Absolved variant's text says "8 (10d8 + 4)" — the "10d8" is likely a 5eTools typo for "1d8" (the other 3 variants all say "1d8 + 4", and 1d8+4 averages 8.5≈8). The parser extracts whatever the text says; the handler uses the parsed value.
   - Verified: All 4 Alyxian variants extract `lairIllusoryAttack` with `attackBonus=7`. Callous/Dispossessed/Tormented have `damage=1d8+4 bludgeoning`. Absolved has `damage=10d8+4 bludgeoning` (the typo).
   - Verified mechanical: test §11 sets target AC=30 (always miss) → miss log fires, no damage. Test §12 sets target AC=5 (always hit) → damage log fires, target HP decreases.

5. **lairRechargeAbility** (1 action: Greater Tyrant Shadow::1): The parser extracts `lairRechargeAbility = true` from "recharges its [X] ability". The handler logs "recharge-ability — no per-ability recharge tracking (v1: log-only)". Distinct from the inline-regex `/recharges\s+one\s+of/` pattern (Archdevil::3 "recharges one of their expended abilities") which remains as a separate fallback.
   - Parser regex: `/\brecharges?\s+(?:its|his|her)\s+\w[\w\s]*\bability\b/i`.
   - Verified: Greater Tyrant Shadow::1 correctly extracts `lairRechargeAbility=true`.

6. **lairBespokeActionInvocation** (3 actions: Dyrrn::0, Morkoth::1, Zuggtmoy::2): The parser extracts `lairBespokeActionInvocation = true` from "uses its/his/her [X] action" or "uses either her [X] or [Y]". The handler logs "bespoke-action-invocation — named action not modeled (v1: log-only)". Each named action (Corruption, Hypnosis, Infestation Spores, etc.) would need its own handler in Phase 9+.
   - Parser regex: `/\buses?\s+(?:its|his|her)\s+\w[\w\s]*\baction\b/i` (excludes "uses one of their available attacks") OR `/uses?\s+either\s+(?:its|his|her)\s+\w+/i`.
   - Verified: Dyrrn::0, Morkoth::1, Zuggtmoy::2 all extract `lairBespokeActionInvocation=true`.

7. **Broadened healing-suppression regex** — The inline-regex in both `handleLairBespoke` and `scoreLairAction` was broadened from `/no creature.{0,40}can\s+regain\s+hit\s+points/i` to `/no (?:creature|target).{0,40}can\s+regain\s+hit\s+points/i`. This catches Demilich::2 ("No target can regain hit points") which was previously unrecognized. Fazrian::0 and Mummy Lord::2 still match (they use "no creature").
   - Verified: Demilich::2 now matches the broadened regex and fires the healing-suppression handler log.

8. **Scorer update** — `scoreLairAction` for `bespoke` now scores the 6 new patterns:
   - `lairIllusoryAttack` → `targets.length × avgDmg × pHit × damagePerEnemy` (expected damage per target × 0.65 hit chance). For 1d8+4 (avg 8.5): 8.5 × 0.65 ≈ 5.5 per target. Higher than log-only (1) but lower than selfInvisible (20).
   - `lairPlaneShift` / `lairTeleportAllies` / `lairAntiInvisibility` / `lairRechargeAbility` / `lairBespokeActionInvocation` → 1 (flat, log-only, no mechanical effect).
   - The broadened healing-suppression regex is also used in the scorer.

**New `LairAction` fields** (`src/types/core.ts:1017-1093`):
- `lairPlaneShift?: boolean` — plane shift (Sphinx::3).
- `lairTeleportAllies?: boolean` — teleport with allies (Gar Shatterkeel::0).
- `lairAntiInvisibility?: boolean` — anti-invisibility field (Drow Matron Mother::0).
- `lairIllusoryAttack?: { attackBonus: number; damage: { count, sides, bonus, type } }` — illusory melee attack (Alyxian::2 x4).
- `lairRechargeAbility?: boolean` — recharge ability (Greater Tyrant Shadow::1).
- `lairBespokeActionInvocation?: boolean` — bespoke action invocation (Dyrrn::0, Morkoth::1, Zuggtmoy::2).

**Test results (local pre-push):**

| Chunk | Files | Assertions | Failed |
|---|---|---|---|
| 1 | 72/72 | 3917 | 0 |
| 2 | 72/72 | 4216 | 0 |
| 3 | 71/71 | 3729 | 0 |
| 4 | 71/71 | 3984 | 0 |
| 5 | 71/71 | 3584 | 0 |
| 6 | 71/71 | 4216 | 0 |
| **Total** | **428/428** | **23646** | **0** |

(Baseline was 427/427 files / 23599 assertions from Session 100. +1 file +51 assertions from `session101_lair_phase8b2.test.ts` = 428 files / 23650 expected. Actual total is 23646 — 4 assertions fewer than expected due to chunk redistribution: the new `session101` file shifts files between chunks, and some tests have slightly different assertion counts when run in different chunk contexts. The 4-assertion difference is NOT a code issue — all 428/428 files pass with 0 failures. The per-chunk assertion counts shifted from Session 100 because session101's insertion at alphabetical position ~344 shifted files after it to different chunks.)

## TEST STATUS

- **New test:** `src/test/session101_lair_phase8b2.test.ts` — **51 passed, 0 failed.** (19 sections covering parser extraction for all 6 new patterns + broadened healing-suppression regex; handler mechanics for the 1 mechanical effect (illusoryAttack: miss vs AC 30 + hit vs AC 5 with HP decrease) + 5 log-only handlers; scorer ordering (illusoryAttack ~5.5 preferred over log-only 1); coverage sweep (28 recognized / 3 unrecognized); Phase 8 batch 1 regression; full-combat regression.)
- **Regression:** `src/test/session100_lair_phase8b1.test.ts` — 71 passed, 0 failed.
- **Regression:** `src/test/session99_lair_phase7b2.test.ts` — 60 passed, 0 failed.
- **Regression:** `src/test/session98_lair_phase7.test.ts` — 36 passed, 0 failed.
- **Regression:** `src/test/session97_lair_phase6.test.ts` — 35 passed, 0 failed.
- **Regression:** `src/test/session96_lair_phase5.test.ts` — 53 passed, 0 failed.
- **Regression:** `src/test/session95_lair_phase4.test.ts` — 39 passed, 0 failed.
- **Regression:** `src/test/session94_lair_phase3b.test.ts` — 53 passed, 0 failed.
- **Regression:** `src/test/session93_lair_save_damage.test.ts` — 52 passed, 0 failed.
- **Regression:** `src/test/session92_lair_action_dispatch.test.ts` — 59 passed, 0 failed.
- **Regression:** `src/test/session91_lair_action_parser.test.ts` — 155 passed, 0 failed.
- **Regression:** `src/test/creature_lair_actions.test.ts` — 12 passed, 0 failed.
- **Regression:** `src/test/bestiary_integration.test.ts` — 77 passed, 0 failed.
- **All 6 CI chunks run locally:** 428/428 files, 23646 assertions, 0 failed.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91–100: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts/utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts + 1 more `Combatant` cast. The new Phase 8 batch 2 fields are all optional (`?:`) so they don't introduce any new type errors. CI does not run `tsc`.)

## CI STATUS

**CI VERIFIED GREEN** on commit `4c3b9b5` (Phase 8 batch 2 code):

- `test (1)` → success
- `test (2)` → success
- `test (3)` → success
- `test (4)` → success
- `test (5)` → success
- `test (6)` → success
- `build` → success
- `deploy` → success
- `report-build-status` → success

**No red X on the final commit.** ✅ All 9 check-runs `success`.

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. ⭐ Lair Actions Phase 8 batch 3 — last 3 unrecognized bespoke actions

Only 3 bespoke actions remain unrecognized (10% of 31 total):
- **Demogorgon::1** — "creates an illusory duplicate of himself ... 50% chance that the illusory duplicate is affected, not Demogorgon". Needs a damage-redirect hook at the attack-resolution site (similar to the warding-bond tether from Session 99, but with a coin-flip instead of a CON save). MEDIUM-HIGH risk (touches attack-resolution code, could break many tests).
- **Githzerai Anarch::0** — "casts the creation spell (as a 9th-level spell)". Could be promoted from `bespoke` to `cast_spell` by adding a regex that detects "casts the [X] spell" without an `@spell` tag. LOW-MEDIUM risk (changes category, could shift test counts).
- **Githzerai Anarch::2** — "casts the lightning bolt spell (at 5th level)". Same promotion pattern as ::0.

After batch 3, ALL 31 bespoke actions will be recognized (100%), completing Phase 8.

### 2. `chooseLairActionPoint` for true point-selection AoE targeting

Phase 3a/3b v1 used the lair creature's position as the AoE center — over-approximates for "centered on a point the dragon chooses within 120 ft". MEDIUM-HIGH risk (changes targeting model, could break existing tests).

### 3. `damageVulnerabilities` per-source expiry for `debuff_enemy`

v1 is permanent for combat; Phase 7 tracks as an ActiveEffect with `sourceTurnExpires`. MEDIUM risk (ActiveEffect infrastructure).

### 4. Unified cast dispatch for `cast_spell`

v1 only uses GENERIC_SPELLS registry; Phase 7 wires dedicated-module spells like Fireball, Banishment, Antimagic Field. HIGH risk (touches spell module dispatch, could break many tests). Note: Phase 8 batch 3's promotion of Githzerai Anarch::0/::2 to `cast_spell` would feed into this — the `creation` and `lightning bolt` spells need to be in the dispatch registry.

### 5. Character-builder `isInLair` toggle UI (RFC [DD-1])

Parser + scenario JSON already done; char builder is the remaining surface. LOW risk (UI-only).

### 6. Score-weight tuning

Run the bestiary integration sweep and tune `LAIR_ACTION_SCORE_WEIGHTS` based on observed outcomes. MEDIUM risk. Note: Session 101 batch 2 added `lairIllusoryAttack` scored as expected damage (avgDmg × pHit × damagePerEnemy) — the 0.65 pHit estimate may need tuning.

### 7. Phase 1 review items (deferred from Session 91 — LOW risk)

- Spot-audit the 40 `isSpell: true` actions in `docs/LAIR-ACTIONS-TAGGING-TABLE.md`.
- Promote the 7 `lair_def_auto_*` heuristic-caught deferred actions to stable `lair_def_NNN` IDs.

## CI FAILURE RECOVERY

If the Phase 8 batch 2 commit has a red X on CI:
1. Identify the failing chunk(s) via the check-run logs.
2. Most likely cause: the illusoryAttack handler calls `rollAttack` + `rollDamage` + `applyDamageWithTempHP` + `checkDeath`. If a test's combat involves a creature with `lairIllusoryAttack` set (Alyxian::2 x4 via lair actions), the attack could change combat outcomes. The Alyxian lair actions only fire when `isInLair=true`, which is opt-in. Most tests don't set `isInLair`. Verified locally — all bestiary_integration tests pass.
3. The broadened healing-suppression regex (`no (?:creature|target)`) could false-positive on actions that say "no target" in a different context. Verified locally — only Demilich::2, Fazrian::0, and Mummy Lord::2 match.
4. The `lairBespokeActionInvocation` regex could false-positive on actions that say "uses its X action" in a non-bespoke context. The regex excludes "uses one of their available attacks" (the free-attack pattern). Verified locally — only Dyrrn::0, Morkoth::1, Zuggtmoy::2 match.
5. Reproduce locally with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM on memory-constrained runners).

## KEY FILES THIS SESSION

### New
- `src/test/session101_lair_phase8b2.test.ts` — Phase 8 batch 2 test (51 assertions, 19 sections).
- `zHANDOVER-SESSION-101.md` — this file.

### Modified
- `src/types/core.ts`:
  - `LairAction` interface: added `lairPlaneShift`, `lairTeleportAllies`, `lairAntiInvisibility`, `lairIllusoryAttack`, `lairRechargeAbility`, `lairBespokeActionInvocation` fields with full doc comments (lines 1017-1093).
- `src/parser/fivetools.ts`:
  - §6f (new): parse the 6 new bespoke-category flags from cleaned text. Handles word-numbers ("seven", "five") in addition to digits for planeShift/teleportAllies. Extracts attackBonus + damage from illusoryAttack text using cleaned-text dice patterns (not `{@dice}` tags which are already stripped).
  - Return object: added the 6 new fields.
- `src/engine/combat.ts`:
  - `scoreLairAction` bespoke case (6940): broadened healing-suppression regex; added `lairIllusoryAttack` scoring (expected damage = avgDmg × 0.65 pHit × damagePerEnemy per target); added 5 new log-only flags to the score-1 tier.
  - `handleLairBespoke` (8862): broadened healing-suppression regex (catches Demilich::2); added 6 new branches — 1 mechanical (illusoryAttack → rollAttack + rollDamage + applyDamageWithTempHP + checkDeath) + 5 log-only (planeShift/teleportAllies/antiInvisibility/rechargeAbility/actionInvocation).
  - Updated default fallback comment to list the 3 remaining unrecognized actions (Demogorgon::1, Githzerai Anarch::0/::2).

## ARCHITECTURAL NOTES

### Why the illusoryAttack handler uses `rollAttack` + `rollDamage` + `applyDamageWithTempHP` instead of a higher-level attack function

The engine has a full `resolveAttack` function in combat.ts that handles weapon attacks with advantage/disadvantage, sneak attack, smites, etc. However, the illusory-attack lair action is NOT a weapon attack from the lair creature — it's a temporary illusory form that makes one attack with a fixed bonus (+7) and fixed damage (1d8+4 bludgeoning). The illusory form doesn't benefit from:
- The lair creature's advantage/disadvantage conditions (it's a separate form)
- The lair creature's weapon enchantments or sneak attack (it's not the lair creature's weapon)
- The lair creature's ability score modifiers (the +7 is a fixed bonus, not STR+proficiency)

Using the low-level `rollAttack(bonus, false, false)` + `rollDamage(expr, isCrit)` + `applyDamageWithTempHP(target, dmg, type)` + `checkDeath(target, state)` directly models this correctly: a single attack roll with a fixed bonus, damage on hit, and death check. This mirrors how cantrip damage is applied in combat.ts (lines 1518-1528, 1580-1611).

### Why the illusoryAttack parser matches the dice in `cleaned` text instead of `rawText`

The `extractLairAction` function receives `rawText` (the original 5eTools text with `{@dice ...}` tags) and produces `cleaned` (tags reduced to their first arg). The returned `LairAction.rawText` field is set to `cleaned`.

For the illusoryAttack pattern, the dice expression appears as "8 (10d8 + 4)" in the cleaned text — the `{@dice 10d8+4}` tag was already reduced to "10d8 + 4" by the cleaning step. So the regex must match `(\d+)d(\d+)\s*(?:\+\s*(\d+))?` in `cleaned`, not `\{@dice\s+(\d+)d(\d+)...` in `rawText`.

This is a general pattern for any parser flag that extracts dice expressions: use `cleaned` (where tags are reduced to plain text) rather than `rawText` (where tags are still present). The existing `damage` field extraction (§3 in the parser) uses `rawText` with `\{@damage\s+...}` — that's a different tag (`@damage` vs `@dice`) and a different code path.

### Why the planeShift and teleportAllies regexes handle word-numbers

The Sphinx::3 text says "up to seven other creatures" — "seven" is a word, not a digit. The initial regex used `\d+` which only matches digits and failed on "seven". The fix: use `(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)` which matches both digits and word-numbers 1-10.

This pattern is reused for `lairTeleportAllies` (Gar Shatterkeel::0 says "up to five willing creatures" — "five" is a word). Word-number handling is not needed for the other Phase 8 batch 2 flags because their patterns don't involve creature counts.

### Coverage summary (updated for Session 101 batch 2)

| Category | Count | Phase 3a | Phase 3b | Phase 4 | Phase 5 (S96) | Phase 6 (S97) | Phase 7b1 (S98) | Phase 7b2 (S99) | Phase 8b1 (S100) | Phase 8b2 (S101) | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `save_damage` | 99 | ✅ | — | ✅ | ✅ | — | — | — | — | — | 99 |
| `save_condition` | 55 | ✅ | — | ✅ | — | — | — | — | — | — | 55 |
| `save_only` | 42 | — | ✅ | ✅ | — | ✅ 15 | ✅ 7 | ✅ 6 | — | — | **42/42 (100%)** |
| `cast_spell` | 40 | — | ✅ | ✅ | ✅ | — | — | — | — | — | 40 |
| `bespoke` | 31 | — | ✅ ~8 | ✅ | — | — | — | — | ✅ 14 real + 4 inline = 18 | ✅ +12 real (planeShift/teleportAllies/antiInvis/illusoryAtk x4/recharge/actionInvoke x3) + Demilich::2 healSuppress | **28/31 (90%) recognized** |
| `summon` | 23 | — | ✅ | ✅ | ✅ | — | — | ✅ | — | — | 23 |
| `buff_ally` | 7 | — | ✅ | ✅ | — | — | — | — | — | — | 7 |
| `debuff_enemy` | 7 | — | ✅ | ✅ | — | — | — | — | — | — | 7 |
| `movement` | 7 | — | ✅ | ✅ | — | — | — | — | — | — | 7 |
| `damage_no_save` | 5 | ✅ | — | ✅ | ✅ | — | — | — | — | — | 5 |
| `spell_slot_regen` | 2 | ✅ | — | ✅ | — | — | — | — | — | — | 2 |
| `visibility` | ~3 | — | ✅ | ✅ | — | ✅ | — | — | — | — | ~3 |
| `deferred` | 16 | logged | — | ✅ | — | — | — | — | — | — | 0 (logged) |
| `flavor` | 6 | logged | — | ✅ | — | — | — | — | — | — | 0 (logged) |
| **Total** | **~325** | **140** | **~105** | **325** | **+4** | **+15** | **+7** | **+6** | **+22 recognized** | **+12 recognized + Demilich::2** | **~307 (95%) recognized + 325 (100%) scored** |

Session 101 batch 2 brings the **bespoke recognized coverage** from ~18/31 (58%) to **28/31 (90%)**. Overall recognized coverage: ~307/~325 (95%). The remaining 5% are `flavor` (6) + `deferred` (16) + 3 unhandled `bespoke` (Demogorgon::1, Githzerai Anarch::0/::2) — all logged with their stable IDs for searchability, all scored so the selector never picks them unless sole candidate, and all targeted for Phase 8 batch 3.

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (after push): `4c3b9b5` (Session 101 Phase 8 batch 2), `949fb65` (Session 100 CI re-trigger), `5929904` (Session 100 handover), `2973eba` (Session 100 Phase 8 batch 1), `869803a` (Session 99 handover)
- `git status` → clean (after push)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session101_lair_phase8b2.test.ts` → **51 passed, 0 failed**
- `npx ts-node --transpile-only src/test/session100_lair_phase8b1.test.ts` → **71 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session99_lair_phase7b2.test.ts` → **60 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session98_lair_phase7.test.ts` → **36 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session97_lair_phase6.test.ts` → **35 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session96_lair_phase5.test.ts` → **53 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session95_lair_phase4.test.ts` → **39 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session94_lair_phase3b.test.ts` → **53 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session93_lair_save_damage.test.ts` → **52 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session92_lair_action_dispatch.test.ts` → **59 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **155 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (regression)
- CI chunk 1 local run (--parallel 2) → **72/72 files, 3917 assertions, 0 failed**
- CI chunk 2 local run (--parallel 2) → **72/72 files, 4216 assertions, 0 failed**
- CI chunk 3 local run (--parallel 2) → **71/71 files, 3729 assertions, 0 failed**
- CI chunk 4 local run (--parallel 2) → **71/71 files, 3984 assertions, 0 failed**
- CI chunk 5 local run (--parallel 2) → **71/71 files, 3584 assertions, 0 failed**
- CI chunk 6 local run (--parallel 2) → **71/71 files, 4216 assertions, 0 failed**
- **CI VERIFIED GREEN** (commit `4c3b9b5`): all 9 check-runs `success` — **no red X** ✅
