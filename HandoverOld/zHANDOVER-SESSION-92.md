# HANDOVER-SESSION-92

## REPOSITORY

- Branch: main
- Commits this session:
  - `bc22067` — Session 92: RFC-LAIRACTIONS Phase 2 — engine dispatch infrastructure
  - `<this commit>` — Session 92: handover verification-snapshot update (CI-green confirmed)
- Previous: `209f983` (Session 91 handover verification), `be6d727` (Session 91 Phase 1), `805090a` (Session 90 RFC decisions), `42c9e26` (Session 90 RFC + registry), `82073a8` (Session 89 handover)
- State: clean (pushed; CI green)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### RFC-LAIRACTIONS Phase 2 — engine dispatch infrastructure

**User direction:** "Resume the workstream: Read attached zHANDOVER-SESSION-91.md and execute it. Work autonomously to finish all possible tasks; commit after successfully testing and move to the next one. After you finish and upload the next zhandover, verify that there is no red X after the new work is complete; if there is, fix if possible and notify user if all green and new zhandover committed or updated."

Phase 2 is the engine-layer deliverable from RFC-LAIRACTIONS §8. It wires the dispatcher infrastructure: numeric initiative scores, the init-count-20 boundary checkpoint, the `isInLair` flag, per-creature 2-entry history, and OOS/deferred logging. **All handlers are still stubs** — they log the chosen action + category + "not yet implemented" but apply no mechanical effect. Phase 3 wires real per-category handlers.

**Deliverables:**

1. **`Combatant` field additions** (`src/types/core.ts`):
   - `isInLair?: boolean` — [DD-1] default `true` when `lairActions` defined (set by the parser). `false` skips the creature entirely (a dragon ambushed in a field takes no lair action). Exposed via 3 surfaces per the RFC: parser default, scenario JSON override, character-builder toggle (Phase 5 wires the builder UI; the field is already on the type).
   - `initiativeScore?: number` — [DD-2] numeric initiative (1–30+). Populated by `rollInitiative` (and accepted as a manual override in scenarios). The round loop uses it to find the boundary between creatures with initiative ≥ 20 (act BEFORE lair actions) and those with < 20 (act AFTER).
   - `_lairActionHistory?: string[]` — [DD-5] rolling window of the last 2 chosen action IDs. The selector excludes any action in the history. If all available actions are in history (only possible with ≤2 options), the creature SKIPS its lair action that round. Scratch field — cleared implicitly at combat start.

2. **Parser default** (`src/parser/fivetools.ts`): `monsterToCombatant` now sets `isInLair: lairActions ? true : undefined` so freshly-spawned lair creatures are always in-lair unless overridden. (One-line addition; no behavior change for non-lair creatures.)

3. **`rollInitiative` stores numeric score** (`src/engine/utils.ts`): `c.initiativeScore = roll` inside the existing roll loop, in addition to returning the ordered ID array. Previously computed but discarded (RFC §2.5). One-line addition; the return value is unchanged so all existing callers behave identically.

4. **Round-loop restructure with init-20 boundary checkpoint** (`src/engine/combat.ts:6607`):
   - Removed the Session 60 round-start stub (which iterated all combatants, picked a random action, and logged `rawText`).
   - Added `let lairActionsFiredThisRound = false;` at round start.
   - Inside the per-actor turn loop, **before** the dead-check: `if (!lairActionsFiredThisRound && actor && (actor.initiativeScore ?? 0) < 20) { resolveLairActions(state); lairActionsFiredThisRound = true; }` — fires at the boundary between ≥-20 and <-20 creatures (PHB "losing initiative ties" per [DD-2]).
   - Post-loop fallback: `if (!lairActionsFiredThisRound) { resolveLairActions(state); }` — handles the edge case where ALL actors had initiative ≥ 20 (or the initiative list was empty). PHB: lair actions still resolve at count 20, so they fire at the END of the round.
   - **Legacy compat**: undefined `initiativeScore` is treated as 0 via `(actor.initiativeScore ?? 0) < 20` → the first actor triggers the checkpoint → lair actions fire at round start (the original Session 60 stub behavior). This preserves backward compat for scenarios that pass only `initiative: string[]` without scores.

5. **`resolveLairActions(state)`** (new, `src/engine/combat.ts:6474`):
   - Collects all `isInLair === true` creatures with non-empty `lairActions`, alive & conscious.
   - Sorts by **descending CR** (tie-break: alphabetical name) — [DD-3] multi-creature ordering.
   - For each actor: filters candidates by 2-entry history; prefers in-scope (non-OOS, non-deferred); falls back to OOS/deferred only if those are the sole remaining options.
   - Selects via `selectLairAction(candidates)` — Phase 2 deterministic lowest-ID; Phase 4 will replace with `scoreLairAction` (RFC §7).
   - **OOS actions** logged with `outOfScopeId` + "out of scope — logged, not executed".
   - **Deferred actions** logged with `deferredId` + `deferred` tag + "deferred: <tag> — logged, not executed".
   - **In-scope actions** dispatched to `executeLairAction` (stub).
   - Updates `_lairActionHistory` (truncated to length 2).
   - If all actions are in history (≤2 options): logs "no available lair actions this round (all in 2-round history — skipping per PHB 'can't use the same effect two rounds in a row')" and skips.

6. **`executeLairAction(creature, action, state)` stub** (new, `src/engine/combat.ts:6570`):
   - Logs: `<name> takes a lair action (initiative count <N>) [<category>, spell: <name> (lvl <L>)]: <rawText…> (Phase 2 stub — not yet implemented)`.
   - The spell tag (`spell: <name> (lvl <L>)`) only appears when `action.isSpell` is true, supporting GoI/Counterspell traceability in logs (Phase 5 will wire the actual interactions).
   - NO mechanical effect. Phase 3 wires real handlers per `action.category`:
     - `save_damage` → roll save per target, `applyDamage`
     - `save_condition` → roll save, `applySpellEffect({effectType:'condition_apply'})`
     - `save_only` → roll save, bespoke per-action handler (push/fall)
     - `damage_no_save` → `applyDamage` per target
     - `summon` → `summonSpell` dispatch pattern
     - `cast_spell` → registry lookup + `execute()` + fires `incoming_spell` reaction trigger for Counterspell + checks `isProtectedByGoI` ([DD-4])
     - `buff_ally` / `debuff_enemy` → `applySpellEffect` with advantage/vulnerability
     - `visibility` → `terrain_zone` effect with obscurement payload
     - `spell_slot_regen` → restore slot on the lair creature
     - `movement` → push/pull via position mutation
     - `bespoke` → hand-written handler per `action.id`

7. **`session92_lair_action_dispatch.test.ts`** (new, **60 assertions, 0 failures**): validates
   - §1 Parser default `isInLair=true` when lairActions defined (Adult Red Dragon, Aboleth); `undefined` for non-lair (Goblin).
   - §2 `isInLair=false` suppresses lair actions (dragon ambushed in a field).
   - §3 `isInLair=true` fires lair actions (control).
   - §4 Phase 2 stub log format: "Phase 2 stub", "not yet implemented", `[<category>]` tag, "initiative count 20".
   - §5 History: Adult Red Dragon (4 actions), 3 rounds — never repeats 2 in a row. Verifies deterministic lowest-ID selection: round 1 → `Red Dragon::0`, round 2 → `Red Dragon::1`, round 3 → `Red Dragon::2`. Verifies `_lairActionHistory` is `[::1, ::2]` after 3 rounds.
   - §6 History edge case: 2-action creature skips on round 3 (logs "no available lair actions").
   - §7 Deferred action logging: Androsphinx has 2 deferred actions (`lair_def_006` meta-initiative, `lair_def_008` meta-time); round 3 falls back to deferred, log mentions `deferred:` + `logged, not executed` + `lair_def_*` ID.
   - §8 Out-of-scope action logging: synthetic OOS action (`lair_oos_test_001`) — log mentions "out of scope" + "logged, not executed" + ID, and does NOT mention "Phase 2 stub".
   - §9 Multi-creature CR ordering: Adult Red Dragon (CR 17) + Aboleth (CR 10) — dragon's lair action log appears BEFORE aboleth's in the event list.
   - §10 Init-20 boundary: PC@25 → lair action → dragon@15. Verifies PC's turn fires first, lair action second, dragon's turn third.
   - §11 Init-20 boundary: dragon@22 (≥ 20) → lair action fires AFTER dragon's own turn, BEFORE the PC@15's turn. Verifies the boundary correctly handles a lair creature whose own initiative is ≥ 20.
   - §12 Legacy compat: no `initiativeScore` set → lair action fires at round start (before any actor's turn).
   - §13 Dead creature does NOT fire lair actions.
   - §14 Unconscious creature does NOT fire lair actions.
   - §15 `rollInitiative` stores `initiativeScore` on combatants (number, 1–30 range, descending-order matches return value).

   Test event-type filter note: the dragon's legendary-action window (fires after each OTHER actor's turn) produces `attack_*`/`damage`/`save_*` events with `actorId=dragon`. To distinguish the dragon's actual turn from these legendary-action aftereffects, the init-20 boundary tests restrict the "dragonTurnIdx" search to `TURN_START_TYPES = {action, dash, disengage, dodge, move}` — types that only a creature's own turn produces.

**Test results (local pre-push):**
| Chunk | Files | Assertions | Failed |
|---|---|---|---|
| 1 (contains session92) | 70/70 | 3628 | 0 |
| 2 | 70/70 | 3999 | 0 |
| 3 | 70/70 | 3767 | 0 |
| 4 | 70/70 | 4026 | 0 |
| 5 (combat + scenario) | 70/70 | 3760 | 0 |
| 6 (session91 + creature_lair + bestiary_integration) | 69/69 | 4022 | 0 |
| **Total** | **419/419** | **23202** | **0** |

## TEST STATUS

- **New test:** `src/test/session92_lair_action_dispatch.test.ts` — **60 passed, 0 failed.**
- **Regression:** `src/test/creature_lair_actions.test.ts` — 12 passed, 0 failed (format-agnostic assertions still pass with the new log format).
- **Regression:** `src/test/session91_lair_action_parser.test.ts` — 157 passed, 0 failed (parser unchanged this session).
- **Regression:** `src/test/combat.test.ts` — 47 passed, 0 failed.
- **Regression:** `src/test/bestiary_integration.test.ts` — 77 passed, 0 failed.
- **All 6 CI chunks run locally:** 419/419 files, 23202 assertions, 0 failed.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Session 91: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts/utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts + 1 more `Combatant` cast. Unchanged by this session.) CI does not run `tsc` (only the 6 test chunks), so tsc errors do not cause a red X.

## CI STATUS

**VERIFIED GREEN on CI** (commit `bc22067`, pushed to `main`). All 9 check-runs completed with `success`:
- `test (1)` → success ← contains `session92_lair_action_dispatch.test.ts` (60 pass)
- `test (2)` → success
- `test (3)` → success
- `test (4)` → success
- `test (5)` → success ← contains `combat.test.ts` (47 pass) + `scenario.test.ts` (94 pass)
- `test (6)` → success ← contains `session91_lair_action_parser.test.ts` (157 pass) + `creature_lair_actions.test.ts` (12 pass) + `bestiary_integration.test.ts` (77 pass)
- `build` → success
- `deploy` → success
- `report-build-status` → success

**No red X.** The new test file `session92_lair_action_dispatch.test.ts` sorts into chunk 1 (adjacent to `session91_*` which sorts into chunk 6), which passed 70/70 files locally and on CI.

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. ⭐ Lair Actions Phase 3 — effect handlers by category (RFC §8 Phase 3)

Phase 2 (engine dispatch infrastructure) is complete and green. Phase 3 wires real mechanical handlers in priority order (most common first):

1. **`save_damage` + `save_condition`** (110 actions, 34% of total) — roll save per target, `applyDamage` / `applySpellEffect({effectType:'condition_apply'})`. Reuses existing `rollSave`, `applyDamageWithTempHP`, `applySpellEffect`.
2. **`summon`** (22 actions, 7%) — spawn creature(s) via the `summonSpell` dispatch pattern (`combat.ts:6130`). Reuses `summonSpell` + `getSummonEntry` from `src/summons/registry.ts`.
3. **`cast_spell`** (40 actions, 12%) — look up spell in `genericSpellRegistry`, call `execute()`. Also fires `triggerReactions(state, target, 'incoming_spell')` for Counterspell, and checks `isProtectedByGoI(target, castLevel, bf, lairCreature.id)` per target per [DD-4].
4. **`damage_no_save`** (5 actions, 2%) — `applyDamage` to each target.
5. **`buff_ally` / `debuff_enemy`** (14 actions, 4%) — `applySpellEffect` with `advantage_vs` / vulnerability payload.
6. **`visibility`** (in-scope non-deferred) — `terrain_zone` effect with obscurement payload (`spell_effects.ts:717`).
7. **`spell_slot_regen`** (2 actions, <1%) — direct resource mutation on the lair creature.
8. **`movement`** (7 actions, 2%) — push/pull via `pushAway` from `src/engine/movement.ts`.

Each handler gets its own test file (`session93_lair_save_damage.test.ts`, etc.).

**Estimated risk:** MEDIUM per handler — each reuses existing subsystems; the risk is in the bespoke edge cases (e.g., Adult Red Dragon magma uses a 5-foot-radius point the dragon chooses, which requires targeting AI).

### 2. Phase 4 — AI scoring + selection (RFC §8 Phase 4)

Replace the deterministic lowest-ID selector (`selectLairAction`) with `scoreLairAction(action, lairCreature, bf)` — expected-value estimator per RFC §7. Weights live in `LAIR_ACTION_SCORE_WEIGHTS`. Selector picks max-score, tie-break lowest ID.

**Estimated risk:** LOW — scoring is a pure function; selection logic is isolated in `selectLairAction()` for easy replacement.

### 3. Phase 5 — integration + edge cases (RFC §8 Phase 5)

- Full-combat integration tests with lair creatures (Adult Red Dragon, Lich, Kraken).
- GoI interaction tests ([DD-4] — `cast_spell` actions blocked by GoI when `castLevel ≤ threshold` and lair creature is outside the barrier).
- Multi-lair-creature tests ([DD-3]).
- "Can't repeat 2 rounds" edge case (creature with 2 options, 3-round combat — already covered in session92 §6, but revisit with real handlers).
- Bestiary integration test sweep.
- Character-builder `isInLair` toggle UI (RFC [DD-1] "all 3 surfaces" — parser + scenario JSON already done; char builder is the remaining surface).

### 4. Phase 1 review items (deferred from Session 91 — LOW risk)

Before Phase 3 dispatch wires the GoI/Counterspell interaction:
- Spot-audit the 40 `isSpell: true` actions in `docs/LAIR-ACTIONS-TAGGING-TABLE.md` (the remedy-reference exclusion handles the known Sphinx cases, but other edge cases may exist — e.g., Pazuzu `wish`).
- Promote the 7 `lair_def_auto_*` heuristic-caught deferred actions to stable `lair_def_NNN` IDs in `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md` after review.
- Refine the flattening in Phase 2 to filter the ~15 intro-text artifacts ("At your discretion, a legendary…") so they don't pollute the action pool. (Phase 2 did NOT do this — the flattening is unchanged from Session 91 to keep `creature_lair_actions.test.ts` assertion 3 green. Filter in Phase 3 when handler wiring makes it safe.)

### 5. RFC-MONSTER-SPELLCASTING / Ready Action / GoI / spell v1 simplifications — unchanged

See Session 90 handover §"IMMEDIATE NEXT ACTIONS" items 2–5.

## CI FAILURE RECOVERY

If the Phase 2 commit has a red X on CI:
1. Identify the failing chunk(s) via the check-run logs.
2. Most likely cause: a flaky test (e.g., the scorching_ray double-crit flake fixed in `1eb54c6`). Re-run the failed chunk.
3. If a real failure in chunk 1: it would be the new `session92_lair_action_dispatch.test.ts`. All 60 assertions passed locally. Reproduce locally with `npx ts-node --transpile-only scripts/run_tests.ts --chunk 1 --total 6`.
4. If a real failure in chunk 5 or 6: it would be a regression in `combat.test.ts` / `scenario.test.ts` / `creature_lair_actions.test.ts` / `session91_lair_action_parser.test.ts` / `bestiary_integration.test.ts`. All five passed locally (47 / 94 / 12 / 157 / 77 assertions). The most likely culprit is a test that asserts on the OLD lair-action log format — but the only such test is `creature_lair_actions.test.ts`, and its assertions are format-agnostic (substring checks for "lair action" + dragon name + length > 60). Reproduce locally with the same chunked runner.
5. If a real failure in chunks 2/3/4: it's unrelated to this change (no file outside `combat.ts`/`utils.ts`/`fivetools.ts`/`core.ts`/the new test references `lairActions`, `isInLair`, `initiativeScore`, or `_lairActionHistory`). The `rollInitiative` change is additive (one extra assignment per combatant; the return value is unchanged). The round-loop change is a no-op for non-lair combats (`resolveLairActions` filters return an empty list). Investigate as a separate issue.

## KEY FILES THIS SESSION

### New
- `src/test/session92_lair_action_dispatch.test.ts` — Phase 2 test (60 assertions).
- `zHANDOVER-SESSION-92.md` — this file.

### Modified
- `src/types/core.ts` — added `isInLair`, `initiativeScore`, `_lairActionHistory` fields to `Combatant` (with full doc comments referencing RFC [DD-1]/[DD-2]/[DD-5]).
- `src/parser/fivetools.ts` — `monsterToCombatant` sets `isInLair: lairActions ? true : undefined` (parser default per [DD-1]).
- `src/engine/utils.ts` — `rollInitiative` stores `c.initiativeScore = roll` (one-line addition per [DD-2]).
- `src/engine/combat.ts` — replaced Session 60 stub with `resolveLairActions(state)` + `selectLairAction()` + `executeLairAction()` stub; restructured round loop with init-20 boundary checkpoint + post-loop fallback.

## ARCHITECTURAL NOTES

### Why the init-20 boundary checkpoint fires BEFORE the dead-check

The lair-action checkpoint is placed before `if (!actor || actor.isDead) continue;` so that:
1. The checkpoint fires exactly once per round, at the correct point in the initiative order — even if the first <-20 actor is dead.
2. If the lair creature itself is the first <-20 actor and is dead, `resolveLairActions` still runs (and correctly filters out the dead lair creature via its own `!c.isDead && !c.isUnconscious` check). No lair action fires, but the checkpoint is marked as fired so it doesn't re-fire later in the round.

### Why `selectLairAction` is a separate function (not inlined)

Phase 4 will replace the deterministic lowest-ID selection with `scoreLairAction(action, lairCreature, bf)` (RFC §7). Isolating the selector in a single function means Phase 4 is a one-function swap — no changes to `resolveLairActions`'s control flow.

### Why the parser sets `isInLair: true` explicitly (rather than relying on `undefined → true`)

The RFC [DD-1] says "default `true` when `lairActions` is defined." Two ways to implement this:
- (a) Treat `undefined` as `true` in the engine filter: `c.isInLair !== false`.
- (b) Set `isInLair = true` explicitly in the parser; treat `undefined` as `false` in the engine filter: `c.isInLair === true`.

I chose (b) for two reasons:
1. **Explicit > implicit.** A test that constructs a synthetic Combatant without setting `isInLair` should NOT accidentally trigger lair actions — the field is a deliberate opt-in.
2. **Forward-compat with the character builder.** When the builder's monster-import path lands (Phase 5), it will preserve `isInLair` from the bestiary (which is `true` for lair creatures) or default to `false` for non-lair monsters. Treating `undefined` as `false` makes this natural.

The parser sets `isInLair: lairActions ? true : undefined` — `true` for lair creatures, `undefined` (not `false`) for non-lair creatures, so the field's presence on a Combatant object signals "this is a lair creature."

### Why the legacy-compat fallback treats `undefined` initiativeScore as 0

The RFC [DD-2] specifies: "if `initiativeScore` is undefined on all combatants (legacy scenarios passing only `initiative: string[]`), the `actor.initiativeScore ?? 0 < 20` check is true for the first creature, so lair actions fire at round start." This preserves the original Session 60 stub behavior for tests like `creature_lair_actions.test.ts` that pass only an ID array.

This is graceful degradation — NOT PHB-accurate (the lair action should fire at count 20 within the turn order, not at round start). But it preserves backward compat: the 12 existing `creature_lair_actions.test.ts` assertions still pass without modification.

For scenarios that want PHB-accurate behavior, callers should either:
- Call `rollInitiative(bf)` (which now sets `initiativeScore` on every combatant), or
- Set `initiativeScore` manually on each combatant before calling `runCombat`.

### Why `executeLairAction` is a stub (not a real handler)

Phase 2 is strictly the **engine dispatch infrastructure** — the round-loop restructure, the init-20 boundary, the flag gating, the history rule, the OOS/deferred logging. The RFC §8 Phase 2 explicitly says: "Handlers are stubs that log 'not yet implemented' for in-scope categories — no mechanical effect yet."

This keeps Phase 2 MEDIUM-risk (touches the round loop, but no mechanical changes). Phase 3 wires real handlers per category, each independently shippable with its own test file. The stub logs `<category>` + `spell: <name> (lvl <L>)` so the chosen action + tag is visible in logs — supporting GoI/Counterspell traceability once Phase 3+ wires the interactions.

### Why the test event-type filter uses `TURN_START_TYPES`

The dragon's legendary-action window (fires after each OTHER actor's turn, per `combat.ts:7377-7391`) produces events with `actorId=dragon` — including `legendary_action` itself (excluded by type) AND the aftereffect events (`attack_hit`, `damage`, `save_fail`) that the legendary action triggers (NOT excluded by type alone, because the dragon's own turn also produces these types).

To distinguish the dragon's actual turn from legendary-action aftereffects, the init-20 boundary tests restrict the "dragonTurnIdx" search to `TURN_START_TYPES = {action, dash, disengage, dodge, move}` — types that a legendary action never emits (a legendary action's log line is type `legendary_action`, and its aftereffects come AFTER that log line in the event stream, BEFORE the next actor's turn).

This is a test-only concern; the engine itself does not use `TURN_START_TYPES`.

### Relationship to RFC §8 phase boundaries

Phase 2 is strictly the **engine dispatch infrastructure**: fields + round-loop restructure + dispatcher + history + OOS/deferred logging + stub handlers. It does NOT wire real effect handlers (Phase 3), AI scoring (Phase 4), or integration tests with real bestiary data + mechanical effects (Phase 5). This keeps Phase 2 MEDIUM-risk and independently shippable — the engine behaves identically to before for non-lair combats, and for lair combats it logs structured lair-action events but applies no mechanical effect (Phase 3 will wire the actual damage / conditions / summons).

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (after push): `bc22067` (Session 92 Phase 2), `209f983` (Session 91 handover), `be6d727` (Session 91 Phase 1), `805090a`, `42c9e26`
- `git status` → clean (after push)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session92_lair_action_dispatch.test.ts` → **60 passed, 0 failed**
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **157 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/combat.test.ts` → **47 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (regression)
- CI chunk 1 local run → **70/70 files, 3628 assertions, 0 failed** (contains session92)
- CI chunk 5 local run → **70/70 files, 3760 assertions, 0 failed** (combat + scenario)
- CI chunk 6 local run → **69/69 files, 4022 assertions, 0 failed** (session91 + creature_lair + bestiary_integration)
- CI chunks 2/3/4 local run → **210/210 files, 11792 assertions, 0 failed**
- **CI VERIFIED GREEN** (commit `bc22067`): all 9 check-runs `success` — **no red X** ✅
