# HANDOVER-SESSION-93

## REPOSITORY

- Branch: main
- Commits this session:
  - `7849de8` — Session 93: RFC-LAIRACTIONS Phase 3a — damage/save family handlers
  - `<this commit>` — Session 93: handover verification-snapshot update (CI-green confirmed)
- Previous: `ea0d6ed` (Session 92 handover verification), `bc22067` (Session 92 Phase 2), `209f983` (Session 91 handover verification), `be6d727` (Session 91 Phase 1)
- State: clean (pushed; CI green)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### RFC-LAIRACTIONS Phase 3a — damage/save family handlers

**User direction:** "Continue" (resume the workstream from Session 92 handover). Phase 3 was the next priority action.

Phase 3a is the first batch of Phase 3 effect handlers per RFC-LAIRACTIONS §8. It wires real mechanical handlers for the damage/save family: `save_damage`, `save_condition`, `damage_no_save`, `spell_slot_regen`. These four handlers cover **140 of the 324 lair actions (43% of the total corpus)**. The remaining categories (`save_only`, `summon`, `cast_spell`, `buff_ally`/`debuff_enemy`, `visibility`, `movement`, `bespoke`) still log "not yet implemented (Phase 3b+)" — to be wired in Phase 3b.

**Deliverables:**

1. **`executeLairAction` dispatcher** (`src/engine/combat.ts:6582`): replaced the Phase 2 stub with a real category dispatcher. The header log line is now `<name> takes a lair action (initiative count <N>) [<category>]: <rawText…>` — no longer says "Phase 2 stub". Routes by `action.category` to per-category handlers. Unimplemented categories log `→ [<category>] handler not yet implemented (Phase 3b+) — no mechanical effect`.

2. **`handleLairSaveDamage`** (`src/engine/combat.ts:6682`): roll save per target, full damage on fail, half damage on success (PHB default for "half on a successful save"). Reuses:
   - `rollSave` (utils.ts:147) — handles advantage/disadvantage, Bardic Inspiration, Bless/Bane, Warding Bond, Diamond Soul, Legendary Resistance, Magic Resistance, condition penalties (poisoned, exhaustion 3+), and listed-save-bonus override.
   - `applyDamageWithTempHP` (utils.ts:1316) — handles immunity, vulnerability, resistance, temp HP absorption, regeneration suppression.
   - Emits `save_success`/`save_fail` + `damage` events per target. Death check: if target drops to 0 HP, emits `death`/`unconscious`.

3. **`handleLairSaveCondition`** (`src/engine/combat.ts:6747`): roll save per target; on FAILURE apply all of `action.conditions` via `addCondition` (utils.ts:551 — handles condition immunity, Nature's Ward, cascade [paralyzed/stunned/petrified → incapacitated], auto-break concentration). On success: no effect. Emits `save_success`/`save_fail` + `condition_add` events.

4. **`handleLairDamageNoSave`** (`src/engine/combat.ts:6802`): full damage to each target (no save). Immunity/resistance/vulnerability still apply via `applyDamageWithTempHP`. Emits `damage` events per target.

5. **`handleLairSpellSlotRegen`** (`src/engine/combat.ts:6876`): the Lich's lair action — "rolls a d8 and regains a spell slot of that level or lower. If it has no spent spell slots of that level or lower, nothing happens." Implementation:
   - Lazily calls `initMonsterSpellSlots(creature)` (idempotent — no-op if already populated) to ensure the runtime slot tracker exists.
   - Rolls d8 → `rolledLevel`.
   - Walks levels from `rolledLevel` DOWN to 1; the first level where `monsterSpellSlots[lvl].remaining < max` (a spent slot) gets `remaining += 1`.
   - If no level has a spent slot, logs "no spent spell slots of level ≤ N — nothing happens".
   - Emits `heal` event with "regains a level-N spell slot (now X/Y)".

6. **`selectLairActionTargets` helper** (`src/engine/combat.ts:6950`): filters targets by:
   - Faction: `targetsEnemies` → `livingEnemiesOf(creature, bf)`; else → `[...livingAlliesOf(creature, bf), creature]` (ally-affecting actions include self, but handlers skip self for damage).
   - `rangeFt`: Chebyshev distance in feet (1 square = 5 ft) from the lair creature.
   - `targetFilter`: pipe-separated creature-type substring match (e.g., `'undead'`, `'gnoll|hyena'`).
   - **`radiusFt` is intentionally NOT used for targeting** — it represents the AoE size at the CHOSEN point (e.g., the magma geyser is a 5-ft-radius cylinder), which would require point-selection AI to place correctly. v1 simplification: hit everyone in `rangeFt`. Phase 4 will add `chooseLairActionPoint(action, candidates, bf)` that picks the point maximizing targets hit, at which point `radiusFt` becomes the targeting constraint.

7. **`rollLairDamage` helper** (`src/engine/combat.ts:6989`): rolls `count`d`sides` and sums. LairAction damage is always flat NdN + type (no flat bonuses in parsed 5eTools data).

8. **Import additions** (`src/engine/combat.ts`):
   - `LairAction, DamageType` from `../types/core`.
   - `initMonsterSpellSlots` from `../ai/monster_spellcasting` (for the spell_slot_regen handler).

9. **`session93_lair_save_damage.test.ts`** (new, **52 assertions, 0 failures**): 13 test sections covering:
   - §1 `save_damage`: Adult Red Dragon magma (DC 15 DEX, 6d6 fire) — header + save events + damage events fire.
   - §2 `save_damage`: half damage on successful save (30-iteration deterministic loop with high-DEX target — verifies EVERY successful save shows "half of N" in the log).
   - §3 `save_damage`: immunity → 0 dmg; resistance → halved (≤18 from max 6d6=36); vulnerability → doubled (≥12 from min 6d6=6).
   - §4 `save_condition`: Brass Dragon prone (DC 15 STR) — condition applied on failed save.
   - §5 `save_condition`: successful save (high-STR target) → no condition.
   - §6 `save_condition`: Blue Dragon blinded (DC 15 CON) — range gating (in-range hit, out-range not).
   - §7 `damage_no_save`: White Dragon ice shards (3d6 piercing) — no lair-action save events.
   - §8 `damage_no_save`: range gating (in-range hit, out-range not).
   - §9 `spell_slot_regen`: Lich d8 — regains spent slot (deterministic with spent slots at every level 1-8); "nothing happens" when no spent slots.
   - §10 Lair creature never damages itself (self excluded from targets even when `targetsEnemies=false`).
   - §11 Dead/unconscious targets skipped.
   - §12 Log ordering: header fires BEFORE per-target mechanical events.
   - §13 Aboleth `save_damage` (psychic) — non-fire damage type.

   **Test helpers:**
   - `noLegendary(c)`: sets `legendaryActionPoolMax = 0` to prevent the dragon's Wing Attack (legendary action) from polluting the event log with extra save_fail/damage events that would confuse lair-action assertions.
   - `forceLairAction(creature, actionId)`: truncates `lairActions.actions` to a single action and clears `_lairActionHistory`, so the test deterministically fires a specific action.
   - `saveProficiencies = { ability: -100 }`: guarantees save failure even on nat 20 (avoids flaky 5% success rate when using low ability scores like `str=1`).

10. **`session92_lair_action_dispatch.test.ts` regression update**: test 4 ("Phase 2 stub handler logs 'not yet implemented'") was updated to "Phase 3 dispatcher: header log format" — the Red Dragon's first action (`Red Dragon::0`) is `save_damage`, which is now implemented in Phase 3a, so the header no longer says "Phase 2 stub". The test now verifies the header includes `[<category>]` tag + "initiative count 20" + does NOT mention "Phase 2 stub" (for implemented categories). 59 passed, 0 failed (was 60 assertions; merged 4b/4c into 4b/4c/4d).

**Test results (local pre-push):**
| Chunk | Files | Assertions | Failed |
|---|---|---|---|
| 1 (contains session92) | 70/70 | 3604 | 0 |
| 2 (contains session93) | 70/70 | 3873 | 0 |
| 3 | 70/70 | 3783 | 0 |
| 4 | 70/70 | 4088 | 0 |
| 5 (combat + scenario) | 70/70 | 3649 | 0 |
| 6 (session91 + creature_lair + bestiary) | 70/70 | 4252 | 0 |
| **Total** | **420/420** | **23249** | **0** |

## TEST STATUS

- **New test:** `src/test/session93_lair_save_damage.test.ts` — **52 passed, 0 failed.** (Verified non-flaky: 10 consecutive runs all pass.)
- **Regression:** `src/test/session92_lair_action_dispatch.test.ts` — 59 passed, 0 failed (test 4 updated for Phase 3a).
- **Regression:** `src/test/creature_lair_actions.test.ts` — 12 passed, 0 failed.
- **Regression:** `src/test/session91_lair_action_parser.test.ts` — 157 passed, 0 failed.
- **Regression:** `src/test/combat.test.ts` — 52 passed, 0 failed.
- **Regression:** `src/test/bestiary_integration.test.ts` — 77 passed, 0 failed.
- **All 6 CI chunks run locally:** 420/420 files, 23249 assertions, 0 failed.

## TSC STATUS

`./node_modules/.bin/tsc --noEmit` baseline: **5 pre-existing errors, 0 new errors.** (Same 5 as Sessions 91/92: 2 `Combatant`→`Record<string,unknown>` cast errors in combat.ts/utils.ts + 2 `monsterSpellSlots` undefined-guard errors in monster_spellcasting.test.ts + 1 more `Combatant` cast. Unchanged by this session.) CI does not run `tsc` (only the 6 test chunks), so tsc errors do not cause a red X.

## CI STATUS

**VERIFIED GREEN on CI** (commit `7849de8`, pushed to `main`). All 9 check-runs completed with `success`:
- `test (1)` → success ← contains `session92_lair_action_dispatch.test.ts` (59 pass, test 4 updated for Phase 3a)
- `test (2)` → success ← contains `session93_lair_save_damage.test.ts` (52 pass)
- `test (3)` → success
- `test (4)` → success
- `test (5)` → success ← contains `combat.test.ts` (52 pass) + `scenario.test.ts` (94 pass)
- `test (6)` → success ← contains `session91_lair_action_parser.test.ts` (157 pass) + `creature_lair_actions.test.ts` (12 pass) + `bestiary_integration.test.ts` (77 pass)
- `build` → success
- `deploy` → success
- `report-build-status` → success

**No red X.** The new test file `session93_lair_save_damage.test.ts` sorts into chunk 2, which passed 70/70 files locally and on CI.

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. ⭐ Lair Actions Phase 3b — remaining effect handlers (RFC §8 Phase 3)

Phase 3a (damage/save family) is complete and green. Phase 3b wires the remaining handlers:

1. **`summon`** (22 actions, 7%) — spawn creature(s) via the `summonSpell` dispatch pattern (`combat.ts:6130`). Reuses `summonSpell` + `getSummonEntry` from `src/summons/registry.ts`. The lair creature's `summons` field has `{ creature, count }`. Example: Lichen Lich "shambling mound" (deferred [VERIFY-1] in Phase 1 — now resolved as `summon` per Session 91).
2. **`cast_spell`** (40 actions, 12%) — look up spell in `genericSpellRegistry`, call `execute()`. Also fires `triggerReactions(state, target, 'incoming_spell')` for Counterspell, and checks `isProtectedByGoI(target, castLevel, bf, lairCreature.id)` per target per [DD-4]. Example: Aboleth "phantasmal force", Demilich "antimagic field", Zariel "fireball".
3. **`buff_ally` / `debuff_enemy`** (14 actions, 4%) — `applySpellEffect` with `advantage_vs` / vulnerability payload. Example: Mummy Lord "undead advantage vs turn undead", Kraken "lightning vulnerability".
4. **`visibility`** (in-scope non-deferred) — `terrain_zone` effect with obscurement payload (`spell_effects.ts:717`).
5. **`movement`** (7 actions, 2%) — push/pull via `pushAway` from `src/engine/movement.ts`.
6. **`save_only`** (37 actions, 11%) — bespoke per-action handler (push/fall/banish). Example: Kraken "DC 23 STR or pushed 60 ft", Gold Dragon "DC 15 CHA or banished to dream plane".
7. **`bespoke`** (65 actions, 20%) — hand-written handler per `action.id`. These are the most complex; each needs individual implementation.

Each handler gets its own test file (`session94_lair_summon.test.ts`, etc.).

**Estimated risk:** MEDIUM per handler — `cast_spell` has the most surface area (GoI + Counterspell interactions per [DD-4]); `summon` reuses existing infrastructure cleanly; `buff_ally`/`debuff_enemy` + `visibility` + `movement` are straightforward `applySpellEffect` calls.

### 2. Phase 4 — AI scoring + selection (RFC §8 Phase 4)

Replace the deterministic lowest-ID selector (`selectLairAction`) with `scoreLairAction(action, lairCreature, bf)` — expected-value estimator per RFC §7. Weights live in `LAIR_ACTION_SCORE_WEIGHTS`. Selector picks max-score, tie-break lowest ID.

**Estimated risk:** LOW — scoring is a pure function; selection logic is isolated in `selectLairAction()` for easy replacement.

### 3. Phase 5 — integration + edge cases (RFC §8 Phase 5)

- Full-combat integration tests with lair creatures (Adult Red Dragon, Lich, Kraken) — now with REAL mechanical effects from Phase 3a.
- GoI interaction tests ([DD-4] — `cast_spell` actions blocked by GoI when `castLevel ≤ threshold` and lair creature is outside the barrier).
- Multi-lair-creature tests ([DD-3]).
- Bestiary integration test sweep.
- Character-builder `isInLair` toggle UI (RFC [DD-1] "all 3 surfaces" — parser + scenario JSON already done; char builder is the remaining surface).

### 4. Phase 1 review items (deferred from Session 91 — LOW risk)

Before Phase 3b dispatch wires the GoI/Counterspell interaction:
- Spot-audit the 40 `isSpell: true` actions in `docs/LAIR-ACTIONS-TAGGING-TABLE.md` (the remedy-reference exclusion handles the known Sphinx cases, but other edge cases may exist — e.g., Pazuzu `wish`).
- Promote the 7 `lair_def_auto_*` heuristic-caught deferred actions to stable `lair_def_NNN` IDs in `docs/LAIR-ACTIONS-OUT-OF-SCOPE.md` after review.
- Refine the flattening to filter the ~15 intro-text artifacts ("At your discretion, a legendary…") so they don't pollute the action pool. (Phase 3a did NOT do this — the flattening is unchanged from Session 91 to keep `creature_lair_actions.test.ts` assertion 3 green. Filter in Phase 3b when handler wiring makes it safe.)

### 5. RFC-MONSTER-SPELLCASTING / Ready Action / GoI / spell v1 simplifications — unchanged

See Session 90 handover §"IMMEDIATE NEXT ACTIONS" items 2–5.

## CI FAILURE RECOVERY

If the Phase 3a commit has a red X on CI:
1. Identify the failing chunk(s) via the check-run logs.
2. Most likely cause: a flaky test (e.g., the `dissonant_whispers` "≥15 fails out of 40" coin-flip assertion). Re-run the failed chunk.
3. If a real failure in chunk 2: it would be the new `session93_lair_save_damage.test.ts`. All 52 assertions passed locally across 10 consecutive runs (verified non-flaky). Reproduce locally with `npx ts-node --transpile-only scripts/run_tests.ts --chunk 2 --total 6`.
4. If a real failure in chunk 1: it would be a regression in `session92_lair_action_dispatch.test.ts` (test 4 was updated for Phase 3a — the Red Dragon's `save_damage` action no longer says "Phase 2 stub"). 59 passed locally. Reproduce locally with the same chunked runner.
5. If a real failure in chunk 5 or 6: it would be a regression in `combat.test.ts` / `scenario.test.ts` / `creature_lair_actions.test.ts` / `session91_lair_action_parser.test.ts` / `bestiary_integration.test.ts`. All five passed locally (52 / 94 / 12 / 157 / 77 assertions). The most likely culprit: a combat test that has a lair creature whose lair action now deals real damage (Phase 3a) where before it was a no-op stub — this could change combat outcomes (HP totals, winner, round count). Investigate the specific assertion failure and either update the test expectation or refine the handler.

## KEY FILES THIS SESSION

### New
- `src/test/session93_lair_save_damage.test.ts` — Phase 3a test (52 assertions).
- `zHANDOVER-SESSION-93.md` — this file.

### Modified
- `src/engine/combat.ts` — replaced Phase 2 `executeLairAction` stub with real category dispatcher; added `handleLairSaveDamage`, `handleLairSaveCondition`, `handleLairDamageNoSave`, `handleLairSpellSlotRegen` handlers; added `selectLairActionTargets` + `rollLairDamage` helpers; added `LairAction`/`DamageType`/`initMonsterSpellSlots` imports.
- `src/test/session92_lair_action_dispatch.test.ts` — updated test 4 for Phase 3a (Red Dragon's `save_damage` no longer says "Phase 2 stub").

## ARCHITECTURAL NOTES

### Why `radiusFt` is NOT used for targeting (v1 simplification)

The RFC §6.2 targeting model has `rangeFt` (distance from lair creature to valid target) and `radiusFt` (AoE size at the chosen point). The challenge: many lair actions say "centered on a point the dragon chooses within 120 feet of it" — the dragon picks WHERE to center the AoE. Modeling this correctly requires point-selection AI: given a set of candidate target positions, find the point within `rangeFt` of the lair creature that maximizes targets hit within `radiusFt` of that point.

For Phase 3a, I chose the simpler v1 model: **hit everyone within `rangeFt` of the lair creature** (ignore `radiusFt`). This over-approximates the AoE (a real dragon would center the effect on the densest cluster, not on itself), but it's correct for the common case (single target in range) and avoids the complexity of point-selection AI.

Phase 4 will add `chooseLairActionPoint(action, candidates, bf)` that picks the optimal center point, at which point `radiusFt` becomes the targeting constraint and `rangeFt` becomes the point-placement constraint.

### Why half damage on successful save is the default (v1 simplification)

PHB p.205: "A spell's description specifies whether it targets creatures and what happens to a target that succeeds. ... Half damage is the default for damaging spells, but check the spell." Most lair actions follow this convention (the raw text usually says "or half as much damage"). A small number say "no damage on a successful save" — Phase 5 will add a per-action `halfOnSave: boolean` field to disambiguate. For now, the half-damage default is the safer choice (it's the PHB default and matches ~95% of lair actions).

### Why `initMonsterSpellSlots` is called lazily in the spell_slot_regen handler

The Lich's `monsterSpellSlots` tracker is normally initialized lazily by `selectMonsterSlottedSpell()` on the first spellcast (RFC §5.3 — "Called LAZILY from selectMonsterSlottedSpell() on the first invocation for each monster"). But the lair action can fire on round 1 BEFORE the Lich has cast any spell, so the tracker might not exist yet. The handler calls `initMonsterSpellSlots(creature)` first (idempotent — no-op if already populated) to ensure the tracker exists. This is safe because `initMonsterSpellSlots` checks `if (monster.monsterSpellSlots) return;` before populating.

### Why the test uses `saveProficiencies = { ability: -100 }` to guarantee save failure

With `str=1` (ability mod -5), a target needs a nat 20 to succeed on DC 15 (20-5=15 ≥ 15). Nat 20 is NOT an auto-success for saves (only for attack rolls, PHB p.194). So the target succeeds ~5% of the time (1/20), making the test flaky. Setting `saveProficiencies = { str: -100 }` makes the total `roll + (-100) = roll - 100`, which is always < DC 15 even on nat 20 (20-100 = -80 < 15). This is deterministic.

`rollSave` uses `listedSaveBonus` (from `saveProficiencies[ability]`) INSTEAD of the derived `mod + prof` when present (utils.ts:271-274), so the -100 override is honored.

### Why the test disables legendary actions (`noLegendary`)

The Adult Red Dragon has legendary actions (Wing Attack, Tail Attack, etc.) that fire in the window AFTER each OTHER actor's turn. Wing Attack forces a DEX save and deals bludgeoning damage — producing `save_fail`/`save_success` + `damage` events with `actorId=dragon`. These would pollute the lair-action test assertions (which count save/damage events from the dragon). Setting `legendaryActionPoolMax = 0` disables legendary actions entirely, so the lair action is the ONLY source of save/damage events from the dragon in the test round.

### Relationship to RFC §8 phase boundaries

Phase 3a is the **first batch of Phase 3 effect handlers** — the damage/save family. It does NOT wire `summon`, `cast_spell`, `buff_ally`/`debuff_enemy`, `visibility`, `movement`, `save_only`, or `bespoke` handlers (Phase 3b). It does NOT add AI scoring (Phase 4) or integration tests (Phase 5). This keeps Phase 3a MEDIUM-risk and independently shippable — the engine now applies real mechanical effects for 140 of 324 lair actions, and logs "not yet implemented" for the rest.

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (after push): `7849de8` (Session 93 Phase 3a), `ea0d6ed` (Session 92 handover), `bc22067` (Session 92 Phase 2), `209f983` (Session 91 handover), `be6d727` (Session 91 Phase 1)
- `git status` → clean (after push)
- `./node_modules/.bin/tsc --noEmit 2>&1 | grep -c "error TS"` → **5** (pre-existing, unchanged)
- `npx ts-node --transpile-only src/test/session93_lair_save_damage.test.ts` → **52 passed, 0 failed** (10 consecutive runs)
- `npx ts-node --transpile-only src/test/session92_lair_action_dispatch.test.ts` → **59 passed, 0 failed** (regression, test 4 updated)
- `npx ts-node --transpile-only src/test/creature_lair_actions.test.ts` → **12 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/session91_lair_action_parser.test.ts` → **157 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/combat.test.ts` → **52 passed, 0 failed** (regression)
- `npx ts-node --transpile-only src/test/bestiary_integration.test.ts` → **77 passed, 0 failed** (regression)
- CI chunk 1 local run → **70/70 files, 3604 assertions, 0 failed** (contains session92)
- CI chunk 2 local run → **70/70 files, 3873 assertions, 0 failed** (contains session93)
- CI chunk 3 local run → **70/70 files, 3783 assertions, 0 failed**
- CI chunk 4 local run → **70/70 files, 4088 assertions, 0 failed**
- CI chunk 5 local run → **70/70 files, 3649 assertions, 0 failed** (combat + scenario)
- CI chunk 6 local run → **70/70 files, 4252 assertions, 0 failed** (session91 + creature_lair + bestiary)
- **CI VERIFIED GREEN** (commit `7849de8`): all 9 check-runs `success` — **no red X** ✅
