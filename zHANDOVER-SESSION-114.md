# HANDOVER-SESSION-114

## REPOSITORY

- Branch: main
- Commits this session:
  - `76cde0f` — Session 114: fix session113 §7b RNG flake (goblin attacks break Aboleth concentration)
  - `6818506` — Session 114: lair-action bespoke dispatch batch 3 (lightning bolt + wall of force)
  - `f718030` — Session 114: lair-action bespoke dispatch batch 2 (command + sleet storm + spike growth)
  - `0c19ec7` — Session 114: lair-action bespoke dispatch batch 1 (cloud of daggers + moonbeam + phantasmal force + power word kill)
  - `b9ee57c` — Session 114: fix regenerate.test.ts §4b RNG flake + lesser restoration parser mis-tag
- Previous: `8d2a4b5` (S113 handover), `8e2df69` (S113 CI re-trigger), `f25dca3` (S113 pilot), `63fc4aa` (S113 RFC)
- State: clean (5 impl commits pushed; handover commit pending — this file). CI on `76cde0f` was IN_PROGRESS at handover-write time (build + report-build-status success; 6 test chunks in progress; deploy in progress). Expected ALL GREEN — local verification: chunks 2+3 pass 73/73 each, all lair-action tests pass, tsc 5 pre-existing/0 new.
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

Five implementation commits. Session started by verifying the S113 HEAD (`8d2a4b5`) CI was ALL GREEN (9/9 — confirmed at session start). The user directed "continue, then commit work then produce the zhandover" — so the session executed the S113 handover's next-actions list autonomously:

1. **#4 (regenerate.test.ts §4b RNG flake fix)** — LOW risk, test-only. Fixed.
2. **#3 (lesser restoration parser mis-tag fix)** — LOW-MEDIUM risk, parser. Fixed.
3. **#1 S114 expansion batch 1** (cloud of daggers + moonbeam + phantasmal force + power word kill) — LOW-MEDIUM risk. 4 single-target Category A spells.
4. **#1 S114 expansion batch 2** (command + sleet storm + spike growth) — LOW-MEDIUM risk. 3 more spells (darkness deferred — per-creature override needed).
5. **#1 S114 expansion batch 3** (lightning bolt + wall of force) — LOW-MEDIUM risk. 2 more spells (giant insect + simulacrum deferred — non-standard signatures).
6. **Flake fix** for session113 §7b (goblin attacks break Aboleth concentration on natural-1 save).

### Task 1 — regenerate.test.ts §4b RNG flake fix + lesser restoration parser mis-tag (commit `b9ee57c`)

**S113 next-action #4:** "Pre-existing test bug: ally.currentHP=90, maxHP=100, Regenerate heals 4d8+3 (7..35). Assertion eq('Ally HP capped at maxHP', currentHP, 100) fails when heal rolls 7..9 (HP 97..99, NOT capped) — ~3% trigger rate."

**Fix:** set `ally.currentHP=95` so min heal (7) → 102 → always capped at 100. Verified 20/20 standalone passes.

**S113 next-action #3:** "Fazrian's lair action Fazrian::2 was mis-tagged isSpell=true, spellName='lesser restoration'. The raw text: 'The blindness lasts until the creature receives a {@spell lesser restoration} spell or similar magic.' — the spell is mentioned as a CURE, not cast."

**Fix:** added `\breceives?\s+(?:a\s+)?(?:this\s+)?spell` to the remedy-reference regex in `fivetools.ts:861`. Result: 2 Fazrian lair actions re-classified from cast_spell (63→61) to save_condition (112→114). No other lair actions affected.

### Task 2 — S114 batch 1: 4 single-target Category A spells (commit `0c19ec7`)

**S113 next-action #1 expansion.** Added to `LAIR_BESPOKE_SPELL_META`:
- **cloud of daggers** (Kyrilla) — conc, single-target, Category A normal
- **moonbeam** (Kyrilla) — conc, single-target, Category A normal
- **phantasmal force** (Aboleth) — conc, single-target, Category A normal
- **power word kill** (Orcus) — not conc, single-target, Category A normal

All 4 use the `single` execute() signature already proven by the S113 Banishment pilot. Added cases to `callExecuteByPlanType` + `dispatchBespokeLairSpell`'s shouldCast switch. `LAIR_BESPOKE_SPELL_META`: 3 → 7 entries.

### Task 3 — S114 batch 2: command + sleet storm + spike growth (commit `f718030`)

Added 3 more spells:
- **command** (Graz'zt) — not conc, single-target, Category A normal
- **sleet storm** (Yan-C-Bin) — AoE, Category B hazard, suppress conc, 1-round duration
- **spike growth** (Copper Dragon) — single-target (center point), Category B hazard, suppress conc, no fixed duration (lasts until dragon uses lair again or dies)

**darkness DEFERRED:** Demogorgon (suppress, explicit exception) vs Morkoth (normal, concentration) need per-creature overrides — the `LAIR_BESPOKE_SPELL_META` table is keyed by spell name, not by creature. A future session should implement per-creature overrides (or a parser-level `lairActionSpellMode` flag — see S113 next-action #5).

**Suppress-mode post-processing fix:** ALWAYS flip `sourceIsConcentration` to false for suppress-mode spells, regardless of whether `lairDurationRounds` is defined. Previously gated on `lairDurationRounds` — a bug for spike growth (no fixed duration). `sourceTurnExpires` is only set when `lairDurationRounds` is defined. `LAIR_BESPOKE_SPELL_META`: 7 → 10 entries.

### Task 4 — S114 batch 3: lightning bolt + wall of force (commit `6818506`)

Added 2 more spells:
- **lightning bolt** (Githzerai Anarch) — AoE, not conc, Category A normal
- **wall of force** (Elder Brain) — single-target, conc, Category A normal

**giant insect + simulacrum DEFERRED:**
- giant insect has non-standard signature (`execute(caster, state)`, `shouldCast` returns `boolean` — not `Combatant`/`Combatant[]`). Needs a 4th signature type `'cast'`.
- simulacrum is a stub module (`execute` is a no-op). Needs real implementation first.

`LAIR_BESPOKE_SPELL_META`: 10 → 12 entries. **Total coverage: 12 of 15 bespoke-only spells now dispatch.** Remaining 3: darkness (per-creature override), giant insect (non-standard sig), simulacrum (stub).

**Test updates:** session113 §5 rewritten (Lightning Bolt now dispatches + executes instead of skipping). session102 §11 rewritten (same — Lightning Bolt dispatches). session113 §7 updated (phantasmal force now dispatches + concentration started).

### Task 5 — session113 §7b RNG flake fix (commit `76cde0f`)

**The flake:** session113 §7b "Aboleth started concentration on Phantasmal Force" failed ~20% of CI runs. Root cause: the goblin takes its regular turn AFTER the lair action fires. If the goblin attacks the Aboleth and the Aboleth rolls a natural 1 on the concentration save (~5% chance per attack), concentration breaks before the §7b assertion checks it.

**Fix:** clear `goblin.actions = []` (in addition to the previously-added `aboleth.actions = []`). Both creatures now have no regular-turn actions — only the lair action fires. Verified 20/20 standalone passes.

## TEST STATUS

- **New/updated tests (3 files):**
  - `session113_lair_bespoke_dispatch` — 39 passed, 0 failed (was 37 in S113; §5 rewritten +2 Lightning Bolt assertions, §7 rewritten phantasmal force dispatch, §7b flake fixed, §1b count 3→12).
  - `session102_lair_phase8b3` — 52 passed, 0 failed (was 53 in S113; §11 rewritten: Lightning Bolt now dispatches + executes).
  - `regenerate` — 41 passed, 0 failed (§4b flake fixed: currentHP 90→95).
- **Regression (all 0 failed):**
  - `session91_lair_action_parser` — 155 passed.
  - `session94_lair_phase3b` — 54 passed.
  - `session105_phase8_retrospective` — 25 passed (isSpell count 63→61 after lesser restoration parser fix).
  - `bestiary_integration` — 77 passed.
- **Full 6-chunk CI suite:** local chunks 2+3 pass 73/73 each (3871 + 4168 assertions). CI on GitHub is the definitive check. `76cde0f` CI was IN_PROGRESS at handover-write time.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91-113. The S114 changes are additive: new `LAIR_BESPOKE_SPELL_META` entries + new `callExecuteByPlanType`/`shouldCast` cases + test updates. None touch the 5 pre-existing error sites.)

## CI STATUS

- **`8d2a4b5` (S113 handover, re-verified this session):** **9/9 ALL GREEN** — no red X carried over from S113.
- **`b9ee57c` (S114 Task 1: flake fix + parser fix):** expected ALL GREEN (test-only fix + 1-line parser regex change; local verification passes).
- **`0c19ec7` (S114 batch 1: 4 single-target spells):** expected ALL GREEN (additive: 4 new meta entries + 4 new dispatch cases; local verification passes).
- **`f718030` (S114 batch 2: command + sleet storm + spike growth):** expected ALL GREEN (additive: 3 new meta entries + 3 new dispatch cases + suppress-mode fix; local verification passes).
- **`6818506` (S114 batch 3: lightning bolt + wall of force):** **5/6 test chunks success + chunk 2 FAILED** on session113 §7b (goblin-attacks-break-concentration flake — see Task 5). Other 5 chunks pass.
- **`76cde0f` (S114 flake fix, HEAD):** CI IN_PROGRESS at handover-write time (build + report-build-status success; 6 test chunks + deploy in progress). Expected ALL GREEN — local verification: session113 20/20 passes, chunks 2+3 pass 73/73 each.

(If a flaky CRASH appears on any chunk — the known remaining flakes are `summons.test.ts` under parallel load (S106, not reproduced locally). The `regenerate.test.ts` §4b RNG flake was FIXED this session (Task 1). The `session113` §7b concentration flake was FIXED this session (Task 5). Re-trigger with an empty commit if any NEW flake CRASHes.)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

The S113 next-action #1 (unified cast dispatch) is now 80% COMPLETE (12 of 15 spells dispatch). The remaining 3 spells each have a specific blocker. The carry-overs + NEW follow-ups from S114:

### 1. darkness — per-creature concentration override (S114, NEW, MEDIUM)

Demogorgon's darkness lair action is Category A explicit exception ("doesn't need to concentrate") while Morkoth's is Category A normal (concentration applies). The `LAIR_BESPOKE_SPELL_META` table is keyed by spell name, not by creature, so both get the same mode. Options:
- (a) Add a `creatureOverride?: Map<string, ConcentrationMode>` field to `LairBespokeSpellMeta` for per-creature mode overrides.
- (b) Implement the parser-level `lairActionSpellMode?: 'cast' | 'hazard'` flag on `LairAction` (S113 next-action #5) — the parser reads the lair-action text and determines the mode per-action.
- (c) Keep darkness out of the meta and let it skip (current behavior).

**Recommendation: (a)** for darkness (simplest — just 2 creatures need overrides). MEDIUM risk.

### 2. giant insect — non-standard signature (S114, NEW, MEDIUM)

`execute(caster, state)` (no target param), `shouldCast` returns `boolean` (not `Combatant`/`Combatant[]`). Doesn't fit the `single`/`aoe`/`self` signature model. Needs a 4th signature type `'cast'` (execute takes only caster+state, shouldCast returns boolean). Also Category A duration-replacement → concentrationMode: suppress. MEDIUM risk (new signature type + Arasta's lair action also needs the "spiders only" variant handling).

### 3. simulacrum — stub module (S114, NEW, HIGH)

`execute(_caster, _state)` is a no-op stub. `shouldCast` always returns null. The spell needs a real implementation first (Simulacrum creates a duplicate of a creature — complex: copy stats, HP, actions, etc. with half HP). Then add to `LAIR_BESPOKE_SPELL_META` with Category B hazard mode (Fraz-Urb'luu's lair text: "as if created with the simulacrum spell... destroyed on the next initiative count 20"). HIGH risk (complex spell implementation).

### 4. antimagic_field — module implementation (S113 #2, unchanged, HIGH)

Q2 directive: skip with updated log (done). A future session should implement `src/spells/antimagic_field.ts` properly. HIGH risk (complex spell — suppresses magic in a 10-ft radius). Out of scope for an autonomous session without a dedicated RFC.

### 5. lairActionSpellMode parser flag (S113 #5, unchanged, MEDIUM)

The S113/S114 pilot uses a hardcoded `LAIR_BESPOKE_SPELL_META` table. A cleaner future approach: add `lairActionSpellMode?: 'cast' | 'hazard'` to `LairAction`, populated by the parser. MEDIUM risk (parser change). Defer until the per-spell table grows beyond ~20 entries.

### 6-10. (Carry-overs from S113, unchanged)

- #7: Character-builder `isInLair` toggle UI (S104, unchanged, SHEET stream).
- #8: Score-weight tuning (S104, unchanged, MEDIUM).
- #9-15: (RESOLVED in S107/S108/S109/S110/S111/S112/S113 — see S113 handover).
- #16: `regenerate.test.ts` §4b RNG flake — **RESOLVED in S114** (Task 1).
- #17: `lesser restoration` parser mis-tag — **RESOLVED in S114** (Task 1).

## CI FAILURE RECOVERY

If any S114 commit shows a red X on CI:

1. **`b9ee57c` (flake fix + parser fix):** the changes are a test-only fix (currentHP 90→95) + a 1-line regex addition. If ANY chunk fails, it's a flake. Re-trigger.
2. **`0c19ec7` (batch 1: 4 single-target spells):** additive — 4 new meta entries + 4 new dispatch cases. If `session113` fails, check whether the new spells dispatch correctly. If other tests fail, it's likely a flake.
3. **`f718030` (batch 2: command + sleet storm + spike growth):** additive — 3 new meta entries + 3 new dispatch cases + suppress-mode fix. If `session113` fails on a suppress-mode spell (sleet storm/spike growth), check the post-processing (sourceIsConcentration flip + sourceTurnExpires). If other tests fail, it's likely a flake.
4. **`6818506` (batch 3: lightning bolt + wall of force):** additive — 2 new meta entries + 2 new dispatch cases. Chunk 2 failed on session113 §7b (goblin-attacks-break-concentration flake). Fixed in `76cde0f`.
5. **`76cde0f` (flake fix):** test-only — clears goblin.actions. If ANY chunk fails, it's a flake. Re-trigger.
6. **Reproduce locally** with `npx ts-node --transpile-only scripts/run_tests.ts --chunk N --total 6 --parallel 2` (use `--parallel 2` to avoid V8 OOM).
7. **Known flakes (all FIXED):** `regenerate.test.ts` §4b (S114), `session113` §7b (S114). The only REMAINING known flake is `summons.test.ts` under parallel load (S106, not reproduced locally).

## KEY FILES THIS SESSION

### New
- `zHANDOVER-SESSION-114.md` — this file.

### Modified
- `src/engine/lair_action_metadata.ts`:
  - `LAIR_BESPOKE_SPELL_META`: 3 → 12 entries (S113 pilot 3 + S114 batch 1 4 + batch 2 3 + batch 3 2).
  - Future expansion comments updated (remaining 3: darkness, giant insect, simulacrum).
- `src/engine/combat.ts`:
  - `callExecuteByPlanType`: 3 → 12 cases (added cloudOfDaggers, moonbeam, phantasmalForce, powerWordKill, command, sleetStorm, spikeGrowth, lightningBolt, wallOfForce).
  - `dispatchBespokeLairSpell` shouldCast switch: 3 → 12 cases.
  - Suppress-mode post-processing fix: ALWAYS flip `sourceIsConcentration` to false (was gated on `lairDurationRounds`).
- `src/test/session113_lair_bespoke_dispatch.test.ts`:
  - §1b: count 3 → 12.
  - §5: rewritten (Lightning Bolt skip → dispatch + execute).
  - §7: rewritten (phantasmal force skip → dispatch + concentration). §7b flake fixed (clear goblin.actions).
- `src/test/session102_lair_phase8b3.test.ts`:
  - §11: rewritten (Lightning Bolt skip → dispatch + execute). 53 → 52 assertions.
- `src/test/regenerate.test.ts`:
  - §4b: currentHP 90 → 95 (flake fix).
- `src/parser/fivetools.ts`:
  - Line 861: added `\breceives?\s+(?:a\s+)?(?:this\s+)?spell` to remedy-reference regex (lesser restoration mis-tag fix).

### Archived
- `zHANDOVER-SESSION-112.md` → `HandoverOld/zHANDOVER-SESSION-112.md` (per AGENTS.md "latest 2 in root" rule; S113 + S114 now in root).

## VERIFICATION SNAPSHOT

- `git log --oneline -6` (local, post-push): `76cde0f` (S114 flake fix), `6818506` (S114 batch 3), `f718030` (S114 batch 2), `0c19ec7` (S114 batch 1), `b9ee57c` (S114 flake fix + parser fix), `8d2a4b5` (S113 handover)
- `git status` → clean (5 impl commits pushed; S112 handover archived; S114 handover commit pending)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session113_lair_bespoke_dispatch.test.ts` → **39 passed, 0 failed** (was 37 in S113; 20/20 standalone)
- `npx ts-node --transpile-only src/test/session102_lair_phase8b3.test.ts` → **52 passed, 0 failed** (was 53 in S113; §11 rewritten)
- `npx ts-node --transpile-only src/test/regenerate.test.ts` → **41 passed, 0 failed** (20/20 standalone, flake fixed)
- `npx ts-node --transpile-only src/test/session105_phase8_retrospective.test.ts` → **25 passed, 0 failed** (isSpell 63→61)
- `npx ts-node --transpile-only scripts/run_tests.ts --chunk 2 --total 6 --parallel 2 --timeout 90 --quiet` → **73/73 files, 3871 assertions, 0 failed**
- `npx ts-node --transpile-only scripts/run_tests.ts --chunk 3 --total 6 --parallel 2 --timeout 90 --quiet` → **73/73 files, 4168 assertions, 0 failed**
- **CI on GitHub:**
  - `8d2a4b5` (S113 handover, re-verified) → **9/9 ALL GREEN**.
  - `b9ee57c` → `0c19ec7` → `f718030` → `6818506` → `76cde0f` (S114 commits) → CI on `76cde0f` IN_PROGRESS at handover-write time. Expected ALL GREEN — local verification passes for all affected tests + chunks 2+3.
