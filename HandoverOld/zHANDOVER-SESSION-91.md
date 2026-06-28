# HANDOVER-SESSION-91

## REPOSITORY

- Branch: main
- Commits this session:
  - `be6d727` — Session 91: RFC-LAIRACTIONS Phase 1 — structured LairAction schema + parser extraction + per-action isMagical/isSpell tagging
  - `<pending>` — Session 91: handover verification-snapshot update (CI-green confirmation)
- Previous: `805090a` (Session 90 RFC decisions), `42c9e26` (Session 90 RFC + registry), `82073a8` (Session 89 handover), `a53eaf4` (Session 89 Aura of Vitality)
- State: clean (pushed; CI green)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### RFC-LAIRACTIONS Phase 1 — structured schema + parser extraction + per-action isMagical/isSpell tagging

**User direction:** "Resume the workstream: read zHANDOVER-SESSION-90.md in the repo and execute it. All 5 design questions in RFC-LAIRACTIONS are already resolved — proceed directly to Phase 1 (structured schema + parser extraction + per-action isMagical/isSpell tagging). Commit after each phase tests green; verify no red X on CI; update the handover when done."

Phase 1 is the data-layer deliverable from RFC-LAIRACTIONS §8. It is **LOW-risk, parser-only** — the engine stub still fires at round start and logs `rawText` (no mechanical effect); Phase 2 wires `resolveLairActions` + category dispatch. All 5 RFC design questions were pre-resolved by the user (Session 90); no further user input was required.

**Deliverables:**

1. **`LairAction` structured type** (`src/types/core.ts`) — replaces the v1 `lairActions.actions: string[]` (Session 60 stub) with `LairAction[]`. Each of the 324 parsed lair-action options (115 legendary groups) is now a structured object with:
   - extracted mechanical fields (`saveDC`, `saveAbility`, `damage`, `conditions`, `summons`, `rangeFt`, `radiusFt`, `durationRounds`, `targetsEnemies`, `targetFilter`) pulled from 5eTools inline tags (`@dc`, `@damage`, `@condition`, `@spell`, `@creature`, …);
   - per-action `isMagical` / `isSpell` / `spellName` / `castLevel` tagging per **[DD-4]** (no blanket rule — each action read individually);
   - `outOfScope` / `deferred` registry tags with stable IDs (`lair_oos_NNN` / `lair_def_NNN`);
   - a `category` (`save_damage` | `save_condition` | `save_only` | `damage_no_save` | `summon` | `cast_spell` | `buff_ally` | `debuff_enemy` | `visibility` | `spell_slot_regen` | `movement` | `deferred` | `bespoke` | `flavor`) for the Phase 2+ dispatcher to route on;
   - a stable `id` = `${sourceCreature}::${index}`.
   - `LairActionCategory` type union + the full `LairAction` interface, both exported.

2. **`parseLairActions()` rewrite + `extractLairAction()` pure function** (`src/parser/fivetools.ts`):
   - The existing flattening logic is **unchanged** (preserves the exact action count for backward compat — e.g., Adult Red Dragon = 4 options).
   - New exported `extractLairAction(rawText, sourceCreature, index): LairAction` — a pure, directly-testable function that does all the tag extraction + tagging. `parseLairActions()` calls it once per flattened action.
   - **[DD-4] per-action tagging:** `isSpell: true` when an `@spell` tag is in a casting context. Crucially, **remedy-references are excluded** — e.g., the Sphinx "A {@spell greater restoration} spell can restore a creature's age to normal" names greater restoration as a *counter*, not a spell the lair action casts → `isSpell: false`. Detection scans every `@spell` tag's ±context for remedy signals (`ends this effect`, `cast on the target ends`, `spell can <verb>`, `dispelled by`, …). `isMagical: true` by default for ALL 324 actions (MM: "magical effects").
   - **Out-of-scope / deferred registry** encoded as a static `LAIR_REGISTRY` array (11 entries matched by `sourceCreature` + distinctive-phrase regex), with a **heuristic safety-net** that catches unregistered out-of-scope/deferred actions and tags them with `lair_oos_auto_*` / `lair_def_auto_*` IDs for review.
   - **31-spell level lookup** (`LAIR_SPELL_LEVELS`) for `castLevel` — static map (decoupled from the GENERIC_SPELLS registry to keep the parser load-order-independent).
   - Summon fallback: `@creature` tag → count from "up to N"; else "creating a X … obeys … appears in an unoccupied space" → summon (handles Lichen Lich `[VERIFY-1]`).

3. **Combat stub backward-compat** (`src/engine/combat.ts`): the round-start lair-action stub now reads `pick.rawText` instead of `pick` (since `actions` is now `LairAction[]`, not `string[]`). Log format unchanged ("takes a lair action (initiative count 20): <text>"). No mechanical effect — Phase 2 replaces this stub.

4. **`creature_lair_actions.test.ts` regression**: one-line update (`actions[0].substring` → `actions[0].rawText.substring`) for the schema change. All 12 assertions still pass.

5. **`session91_lair_action_parser.test.ts`** (new, 157 assertions): validates extraction for 10 representative MM creatures (Adult Red Dragon, Aboleth, Lich, Kraken, Adult Black Dragon, Androsphinx, Demilich, Mummy Lord, Beholder, Death Tyrant) covering every category + the [DD-4] tagging (incl. Sphinx remedy-ref exclusion) + the out-of-scope/deferred registry (Black Dragon `lair_def_001`, Sphinx `lair_def_006`/`lair_def_008`) + `extractLairAction` direct unit tests on synthetic strings (Lichen Lich summon fallback, Baphomet cast_spell/gravity-deferred, rawText cleaning) + a full-corpus sanity sweep (324 actions, 40 isSpell, 324 isMagical, 6 out-of-scope, 16 deferred).

6. **`docs/LAIR-ACTIONS-TAGGING-TABLE.md`** (new) — the per-action tagging table required by RFC §5.3/§8 Phase 1 (the "309-row tagging table" deliverable). 324 rows across 93 creatures, grouped alphabetically, with columns: id, isMagical, isSpell, spellName, castLevel, category, saveDC, saveAbility, damage, conditions, outOfScopeId, deferred, deferredId. Regenerable via `scripts/gen_lair_tagging_table.ts`.

7. **`docs/LAIR-ACTIONS-OUT-OF-SCOPE.md`** updated with a "Phase 1 Update (Session 91)" section: actual total = 324 (not 309), out-of-scope = 6 (was 5), deferred = 16 (was 8), both `[VERIFY]` cases resolved (Lichen Lich → summon; Juiblex → `lair_def_009` dmg-hazard), plus review items for the next pass.

**Corpus tagging summary (324 actions):**
| Metric | Value |
|---|---|
| Total actions | 324 |
| `isSpell: true` (casts a named spell) | 40 |
| `isMagical: true` (all — MM default) | 324 |
| Out-of-scope (`lair_oos_*` + auto) | 6 |
| Deferred (`lair_def_*` + auto) | 16 |
| In-scope (executable in Phase 2+) | 302 |

Category distribution: `bespoke` 68, `save_condition` 55, `save_damage` 55, `cast_spell` 40, `save_only` 37, `summon` 22, `deferred` 16, `debuff_enemy` 7, `buff_ally` 7, `movement` 7, `damage_no_save` 5, `flavor` 6... (see tagging table for exact figures).

## TEST STATUS

- **New test:** `src/test/session91_lair_action_parser.test.ts` — **157 passed, 0 failed.**
- **Regression:** `src/test/creature_lair_actions.test.ts` — 12 passed, 0 failed (one-line `.rawText` update).
- **CI chunk 6** (contains both lair tests + bestiary_integration + 66 others): **69/69 files passed, 4045 assertions, 0 failed.**
- **CI chunk 5** (combat.test.ts + scenario.test.ts + 67 others): **69/69 files passed, 3529 assertions, 0 failed.**
- **Key engine/integration tests run directly:** engine (71), integration (26), bestiary_integration (77), parser (101) — all 0 failed.
- Chunks 1–4 (spell-specific tests that don't touch `lairActions` or the combat lair-stub) were not fully swept due to sandbox time limits, but the risk is negligible: the only files referencing `lairActions.actions` are `combat.ts` (fixed) and the two lair tests (one fixed, one new), confirmed by `grep -rn "\.lairActions" src/`.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (The 5 pre-existing are the same `Combatant`→`Record<string,unknown>` cast errors in combat.ts/utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts — unchanged by this session.) CI does not run `tsc` (only the 6 test chunks), so tsc errors do not cause a red X.

## CI STATUS

**VERIFIED GREEN on CI** (commit `be6d727`, pushed to `main`). All 9 check-runs completed with `success`:
- `test (1)` → success
- `test (2)` → success
- `test (3)` → success
- `test (4)` → success
- `test (5)` → success
- `test (6)` → success ← contains both `session91_lair_action_parser.test.ts` (157 pass) and `creature_lair_actions.test.ts` (12 pass) + `bestiary_integration.test.ts` (77 pass)
- `build` → success
- `deploy` → success
- `report-build-status` → success

**No red X.** The new test file `session91_lair_action_parser.test.ts` sorts into chunk 6 (same chunk as the existing lair test), which passed 69/69 files locally and on CI.

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. ⭐ Lair Actions Phase 2 — engine dispatch infrastructure (RFC §8 Phase 2)

Phase 1 (data layer) is complete and green. Phase 2 wires the engine:
1. Add `isInLair?: boolean` (default `true` when `lairActions` defined — [DD-1]), `initiativeScore?: number` ([DD-2]), and `_lairActionHistory?: string[]` ([DD-5]) to `Combatant`.
2. Add `resolveLairActions(state)` — replaces the round-start stub in `combat.ts:6458`. Per [DD-2], restructure the round loop to fire lair actions at the **initiative-count-20 boundary** (after creatures with init ≥ 20, before < 20), using `initiativeScore`. Backward compat: legacy scenarios without scores fall back to round-start.
3. Implement the per-creature 2-entry history ("can't repeat same effect 2 rounds in a row" — [DD-5]).
4. Implement out-of-scope / deferred **logging** (log-and-skip; no execution).
5. Handlers are **stubs** that log "not yet implemented" for in-scope categories — no mechanical effect yet (Phase 3 wires real handlers).
6. **Tests:** `src/test/session92_lair_action_dispatch.test.ts` — flag gating, history, out-of-scope logging, multi-creature CR ordering, init-20 boundary.
7. **Regression:** grep-and-update any test asserting on the old `"takes a lair action (initiative count 20): <text>"` log format (only `creature_lair_actions.test.ts` currently does; its assertions are format-agnostic so likely no change needed, but verify after the stub is replaced).

**Estimated risk:** MEDIUM — touches the round loop. The old stub is replaced.

### 2. Phase 1 review items (deferred from this session — LOW risk)

Before Phase 2 dispatch wires the GoI/Counterspell interaction:
- Spot-audit the 40 `isSpell: true` actions in `docs/LAIR-ACTIONS-TAGGING-TABLE.md` (the remedy-reference exclusion handles the known Sphinx cases, but other edge cases may exist — e.g., Pazuzu `wish`).
- Promote the 7 `lair_def_auto_*` heuristic-caught deferred actions to stable `lair_def_NNN` IDs in `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md` after review.
- Refine the flattening in Phase 2 to filter the ~15 intro-text artifacts ("At your discretion, a legendary…") so they don't pollute the action pool.

### 3. RFC-LAIRACTIONS Phases 3–5 — unchanged from Session 90 handover

Phase 3 (effect handlers by category), Phase 4 (AI scoring + selection), Phase 5 (integration + edge cases). Each is independently shippable.

### 4. RFC-MONSTER-SPELLCASTING / Ready Action / GoI / spell v1 simplifications — unchanged

See Session 90 handover §"IMMEDIATE NEXT ACTIONS" items 2–5.

## CI FAILURE RECOVERY

If the Phase 1 commit has a red X on CI:
1. Identify the failing chunk(s) via the check-run logs.
2. Most likely cause: a flaky test (e.g., the scorching_ray double-crit flake fixed in `1eb54c6`). Re-run the failed chunk.
3. If a real failure in chunk 6: it would be the new `session91_lair_action_parser.test.ts` or a regression in `creature_lair_actions.test.ts` / `bestiary_integration.test.ts`. All three passed locally (157 / 12 / 77 assertions). Reproduce locally with `npx ts-node --transpile-only scripts/run_tests.ts --chunk 6 --total 6`.
4. If a real failure in another chunk: it's unrelated to this change (no file outside `combat.ts`/`fivetools.ts`/`core.ts`/the two lair tests references `lairActions`). Investigate as a separate issue.

## KEY FILES THIS SESSION

### New
- `src/test/session91_lair_action_parser.test.ts` — Phase 1 test (157 assertions).
- `docs/LAIR-ACTIONS-TAGGING-TABLE.md` — the 324-row per-action tagging table (RFC §5.3 deliverable).
- `scripts/gen_lair_tagging_table.ts` — one-shot generator for the tagging table (re-run after parser changes).
- `zHANDOVER-SESSION-91.md` — this file.

### Modified
- `src/types/core.ts` — added `LairAction` + `LairActionCategory` types; changed `Combatant.lairActions.actions` from `string[]` to `LairAction[]`.
- `src/parser/fivetools.ts` — rewrote `parseLairActions()`; added exported `extractLairAction()` pure function + `LAIR_SPELL_LEVELS` / `LAIR_VALID_CONDITIONS` / `LAIR_REGISTRY` static tables + heuristic classifier.
- `src/engine/combat.ts` — stub reads `pick.rawText` (backward compat for the `string[]` → `LairAction[]` schema change).
- `src/test/creature_lair_actions.test.ts` — one-line `.rawText` regression fix.
- `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md` — appended "Phase 1 Update (Session 91)" section with corrected counts + review items.

## ARCHITECTURAL NOTES

### Why `extractLairAction` is a separate exported pure function

The RFC §5.3 specifies a 10-step extraction pipeline per action. Encapsulating it as a pure function (`extractLairAction(rawText, sourceCreature, index): LairAction`) makes it:
1. **Directly unit-testable** — the Phase 1 test exercises it on synthetic strings (Lichen Lich summon fallback, Baphomet cast_spell/gravity-deferred, rawText cleaning) without needing a full bestiary load.
2. **Deterministic** — no I/O, no module state; same input → same `LairAction`.
3. **Reusable** — Phase 4's AI scoring can call it to re-derive fields; the tagging-table generator calls it directly.

### Why remedy-reference exclusion for `isSpell` (a refinement beyond the RFC's literal "@spell → isSpell" rule)

The RFC §5.3 [DD-4] says "isSpell: true when the action text contains @spell X." Taken literally, this over-counts: some `@spell` tags name a spell as a *counter* to the lair action's effect (e.g., Sphinx "A greater restoration spell can restore a creature's age to normal"), not a spell the lair action casts. Per [DD-4]'s guiding principle — "no blanket rule; read each action individually" — the implementing agent excluded remedy-references via context signals (`ends this effect`, `cast on the target ends`, `spell can <verb>`, `dispelled by`, `only a <spell> spell`). This dropped 3 false positives (Sphinx greater restoration, Sphinx wish, and one more) from the 43 `@spell`-tagged actions → 40 confirmed `isSpell: true`. All actual casts (Aboleth phantasmal force, Demilich antimagic field, Zariel fireball, Orcus power word kill, Fraz-Urb'luu simulacrum, etc.) retain `isSpell: true`. The 40-row list in `docs/LAIR-ACTIONS-TAGGING-TABLE.md` is the review surface for Phase 2.

### Why a static `LAIR_SPELL_LEVELS` map (not the GENERIC_SPELLS registry)

The parser runs at bestiary-load time. Importing `GENERIC_SPELLS` (from `src/spells/_generic_registry.ts`) would couple the parser to the spell-registry module's load order and pull in ~100 spell descriptors at parse time. A static 31-entry map (the distinct spells referenced by lair-action `@spell` tags) is self-contained, fast, and sufficient for `castLevel` (used only for the GoI threshold check in Phase 5). If a lair action references a spell not in the map, `castLevel` is left `undefined` — the Phase 2 dispatcher can fall back to a registry lookup then.

### Backward compat: why the flattening is unchanged

The RFC §5.3 step 1 says "keep the existing string-flattening (for rawText)." Preserving the exact flattening logic means the action COUNT is unchanged (324 total; Adult Red Dragon = 4). This keeps `creature_lair_actions.test.ts` assertion 3 ("has 4 action options") green without modification. The ~15 intro-text artifacts ("At your discretion, a legendary…") are a pre-existing parser behavior; filtering them is deferred to Phase 2's flattening refinement (noted as a review item).

### Relationship to RFC §8 phase boundaries

Phase 1 is strictly the **data layer**: schema + parser + tagging. It does NOT add `isInLair` / `initiativeScore` / `_lairActionHistory` (those are Phase 2 per RFC §8), and it does NOT wire `resolveLairActions` or category handlers (Phase 2–3). This keeps Phase 1 LOW-risk and independently shippable — the engine behaves identically to before (round-start stub fires, logs `rawText`), only the data representation is richer.

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (after push): `be6d727` (Session 91 Phase 1), `805090a`, `42c9e26`, `82073a8`, `a53eaf4`
- `git status` → clean (after push)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **157 passed, 0 failed**
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed** (regression)
- CI chunk 6 local run → **69/69 files, 4045 assertions, 0 failed**
- CI chunk 5 local run → **69/69 files, 3529 assertions, 0 failed**
- **CI VERIFIED GREEN** (commit `be6d727`): all 9 check-runs `success` — **no red X** ✅
