# HANDOVER-SESSION-89

## REPOSITORY

- Branch: main
- Commits this session (oldest → newest):
  - `a53eaf4` — Session 89: Aura of Vitality per-turn re-heal — start-of-turn pulse (PHB p.216)
- Previous: `96bb6b6` (Session 88 handover), `98bbd15` (Session 88 EB spread damage), `70b69b4` (Session 87 handover), `74ef25a` (Session 87 GoI broader RAW reading), `3e8b215` (Session 85 fix flaky scorching_ray)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Part 1: Aura of Vitality per-turn re-heal — commit `a53eaf4`

**Feature gap (newly identified):** Aura of Vitality (PHB p.216) is a 3rd-level concentration spell that creates a 30-ft healing aura. PHB: "You can use a bonus action to cause one creature in the aura (including you) to regain 2d6 hit points." The spell lasts up to 1 minute (10 rounds, concentration). The v1 simplification (flagged `auraOfVitalityPerTurnRehealV1Simplified: true`) cast the spell as a main action with an initial 3-ally burst (2d6 each), but had NO per-turn re-heal — concentration persisted for combat but had no further mechanical effect after the initial burst.

**Session 89 fix:** The per-turn re-heal is now modelled via start-of-turn auto-processing (mirrors the Eyebite pattern from Session 28). At the start of each of the caster's subsequent turns, the engine auto-heals the most-wounded ally (including self) in the 30-ft aura for 2d6. The initial 3-ally burst on cast is preserved (v1 simplification — canon heals 1/turn from turn 1; v1 heals 3 on cast + 1/turn from turn 2).

**Key design decisions:**
- **Start-of-turn auto-processing (Eyebite pattern):** The heal fires automatically at the START of the caster's turn, before `planTurn`. This doesn't consume a bonus action (v1 simplification — PHB says "bonus action", but the engine has no per-turn bonus-action hook for concentration spells; the Eyebite pattern is the established workaround). The caster still gets their normal turn (action + movement + bonus action).
- **Most-wounded target selection:** `shouldCastPulse` finds the ally (including self) with the lowest HP% within 30 ft. Full-HP allies are excluded (healing them wastes the pulse). Dead allies are excluded. Tie-break by closest (Chebyshev distance).
- **Concentration gating:** The turn-start check gates on `actor._auraOfVitalityActive && actor.concentration?.active && actor.concentration.spellName === 'Aura of Vitality'`. When concentration breaks (damage-induced save failure, incapacitation, or voluntary end), `concentration` is set to `null` and the gate fails — no pulse fires. The `_auraOfVitalityActive` flag remains set but is harmless (overwritten on re-cast).
- **No sentinel effect needed:** Unlike Eyebite (which uses a `damage_zone` sentinel effect with `dieCount=0` on the caster for `undoEffect` to find), Aura of Vitality doesn't create any ActiveEffect — it just calls `startConcentration` and sets the scratch flag. The concentration check is sufficient to gate the pulse; no explicit flag clearing is needed.
- **Initial burst preserved:** The existing `execute()` function still heals up to 3 most-wounded allies on cast (2d6 each). The per-turn pulse is ADDITIONAL — it starts on turn 2 and heals 1 ally/turn. This is a v1 simplification (canon has no initial burst — the spell creates the aura, and each turn you use a bonus action to heal 1 creature).

**Files modified:**
- `src/types/core.ts`: Added `_auraOfVitalityActive?: { healDie: number; healDieCount: number; rangeFt: number }` to Combatant interface. Set in `execute()`; checked at turn-start.
- `src/spells/aura_of_vitality.ts`:
  - New `shouldCastPulse(caster, bf)` helper: finds most-wounded ally in 30-ft range (including self). Full-HP excluded, dead excluded. Tie-break by closest. Returns `Combatant | null`.
  - New `executePulse(caster, target, state)` helper: heals 2d6 (capped at maxHP), handles unconscious revival, logs `"Aura of Vitality pulse: N HP restored to X"`. Does NOT consume a spell slot (slot was consumed on cast).
  - `execute()` now sets `caster._auraOfVitalityActive = { healDie, healDieCount, rangeFt }` after starting concentration.
  - Metadata: `auraOfVitalityPerTurnRehealV1Simplified` flipped to `false`; new `auraOfVitalityPerTurnRehealV1Implemented: true` flag added.
  - Header comment updated to document the Session 89 per-turn re-heal.
- `src/engine/combat.ts`: New start-of-turn processing block (after the Eyebite section, before `planTurn`). Gates on `_auraOfVitalityActive + concentration.active + spellName === 'Aura of Vitality' + caster alive`. Calls `shouldCastPulseAuraOfVitality` + `executePulseAuraOfVitality`. Import updated to include both new helpers.
- `src/test/aura_of_vitality.test.ts`: Updated metadata flag assertions (simplified=false, implemented=true). Now 43/43 pass (was 41/42 with 1 failure on the old flag).

**New test file:**
- `src/test/session89_aura_of_vitality_per_turn.test.ts`: 37 assertions, 6 phases:
  1. Metadata: `auraOfVitalityPerTurnRehealV1Simplified` is false, `auraOfVitalityPerTurnRehealV1Implemented` is true, healDie/healDieCount/rangeFt correct.
  2. `shouldCastPulse` helper: most-wounded selected (lowest HP%), self included when wounded, full-HP excluded, out-of-range excluded, dead excluded, no wounded → null, tie-break by closest.
  3. `executePulse` helper: heals 2d6 (range 2-12), capped at maxHP, heal event logged with "Aura of Vitality pulse", no slot consumed, dead ally not healed.
  4. `execute()` sets `_auraOfVitalityActive` flag: not set before execute, set after execute, flag fields correct (healDie=6, healDieCount=2, rangeFt=30).
  5. Engine integration (runCombat): initial burst heal events exist, per-turn pulse heal events exist (turn 2+), concentration break stops the pulse (no pulse events after break round — retry loop for probabilistic concentration save).
  6. Source-presence checks: `_auraOfVitalityActive` in core.ts, `shouldCastPulse`/`executePulse` exported, flag set in `execute()`, combat.ts imports + processing block + Session 89 comment.

## TEST STATUS

### New test file this session

- `src/test/session89_aura_of_vitality_per_turn.test.ts`: 37/37 ✅ (6 phases).

### Existing test updated

- `src/test/aura_of_vitality.test.ts`: 43/43 ✅ (was 41/42 with 1 failure on the old flag value). Updated metadata flag assertions from `simplified === true` to `simplified === false` + `implemented === true`.

### Regression checks (all green)

- **Aura of Vitality family:** aura_of_vitality (43), session89 (37) — all ✅ (80 assertions).
- **Concentration spell patterns:** eyebite (88), call_lightning (75) — all ✅ (163 assertions). These use the same start-of-turn auto-processing pattern.
- **Full CI chunk 1** (70 files): 70/70 passed, 3730 assertions, 0 failed.
- **Full CI chunk 2** (70 files): 70/70 passed, 3921 assertions, 0 failed.
- **Full CI chunk 3** (70 files): 70/70 passed, 3812 assertions, 0 failed.
- **Full CI chunk 4** (69 files): 69/69 passed, 3903 assertions, 0 failed.
- **Full CI chunk 5** (69 files, contains the new session89 test): 69/69 passed, 3552 assertions, 0 failed.
- **Full CI chunk 6** (69 files): 69/69 passed, 4066 assertions, 0 failed.
- **Total:** 417 files, 22984 assertions, 0 failed.
- **Full CI on `a53eaf4`:** all 9 check-runs `success` ✅ (see CI STATUS below).

## TSC STATUS

`npx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this session.** (The 5 errors are the same `Record<string, unknown>` conversion errors in combat.ts:2580/2600, utils.ts:601, and the `monsterSpellSlots` possibly-undefined in monster_spellcasting.test.ts:602/609 — all pre-existing, unrelated to this change.)

## CI STATUS

- `a53eaf4` (Aura of Vitality per-turn re-heal): **9/9 check-runs `success` ✅ — no red X**
  - build: success
  - deploy: success
  - report-build-status: success
  - test (1) through test (6): all success
- Verified via GitHub API after all 9 check-runs reached `completed/success`.

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged

Recharge (Dragon Breath 5-6): fully implemented (Session 52). Lair Actions: metadata + log stub only (bespoke effects, HIGH-risk, deferred). Legendary Actions: partially implemented (planner + dispatch + action pool). Phase 4 (bespoke dispatch for ~267 spells) completed in commit `819bc0b` (Session 75-76).

### 2. Ready Action full implementation (MEDIUM-HIGH risk) — unchanged

The defensive stub (`81a541d`) prevents the fall-through bug. Full implementation needs an RFC.

### 3. GoI condition-suppression pipeline (LOW risk) — unchanged, RAW-ambiguous

The save-fail tracker save roll is now GoI-protected (Session 84), and the caster-inside-barrier spatial case is now handled (Session 87). However, the `poisoned` (Contagion) / `restrained` (Flesh to Stone) ActiveEffects themselves are not suppressed while GoI holds. Full condition suppression would require pipeline-level GoI checks in the condition application/reevaluation pipeline (`src/engine/effect_pipeline.ts`). LOW priority because: (a) the on-cast `filterGoIProtectedTargets` already prevents the spell from being applied to a GoI-protected creature in the first place; (b) the RAW interpretation is ambiguous — PHB p.245 says "can't affect creatures or objects within it" which could be read as blocking new effects only (not suppressing existing ones); (c) implementing suppression would be a house rule, not RAW, and could break existing tests.

### 4. Additional spell v1 simplifications (LOW risk) — newly identified

Many spells have `V1Simplified: true` metadata flags representing tractable feature gaps. Examples identified this session:
- **Acid Splash** (`maxTargets: 1`): PHB allows targeting 2 creatures within 5 ft of each other. Multi-target support is TODO. Would require planner changes (detect 2 enemies within 5 ft) + engine changes (multi-target save resolution).
- **Call Lightning** (`callLightningStrikeChoiceV1Simplified: true`): strike point fixed at cast time; canon allows re-picking the strike point each turn. Would require storing the strike point on `_movingZone` and allowing the planner to re-pick.
- **Aura of Vitality upcast** (`+1d6 heal per slot level above 3rd`): not modelled. Would require `executePulse` to read the cast slot level and scale the heal die count.
- **Banishing Smite** (`banishingSmiteRidersV1Simplified: true`): banish-if-HP-≤-50 rider simplified. Would require a post-hit HP check.
- **Branding Smite** (`brandingsmiteDurationV1Simplified: true`): 1-min → 1-round duration. Would require `sourceTurnExpires` tracking.

These are all well-defined, LOW-risk features with clear RAW basis. Priority: Acid Splash multi-target (most impactful — cantrip used frequently) > Call Lightning strike re-pick > Aura of Vitality upcast > others.

## CI FAILURE RECOVERY

If `a53eaf4` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API.
2. **Most likely failure mode for `a53eaf4` (Aura of Vitality pulse):** a combat scenario test where the per-turn pulse changes the outcome (e.g., a combat that previously had the cleric's Aura of Vitality do nothing after turn 1 now heals allies on turn 2+, changing the survival rate or turn count). Check any combat scenario test that involves a Cleric with Aura of Vitality.
3. **The `_auraOfVitalityActive` flag** is set in `execute()` and checked at turn-start. If a test calls `execute()` directly (not through `runCombat`), the flag is set but the pulse never fires (no turn-start processing). This is correct — the pulse only fires in full combat.
4. **The `shouldCastPulse` helper** uses the same `chebyshev3D` distance and faction check as `shouldCast`. If a test has allies at unexpected positions or factions, the pulse might target an unexpected ally.
5. **The concentration gate** checks `actor.concentration?.active && actor.concentration.spellName === 'Aura of Vitality'`. If a test breaks concentration in an unexpected way (e.g., casting another concentration spell), the pulse stops. This is correct behavior.
6. **The `executePulse` log message** uses the prefix `"Aura of Vitality pulse:"`. A test that asserts on heal event descriptions might need to account for this new message format. The initial burst uses `"Aura of Vitality:"` (without "pulse").
7. **Fix forward** on a new commit.

## KEY FILES THIS SESSION

### Modified

- `src/types/core.ts` — Added `_auraOfVitalityActive` field to Combatant.
- `src/spells/aura_of_vitality.ts` — New `shouldCastPulse` + `executePulse` helpers; `execute()` sets flag; metadata flags updated.
- `src/engine/combat.ts` — New start-of-turn Aura of Vitality pulse processing block; import updated.
- `src/test/aura_of_vitality.test.ts` — Updated metadata flag assertions.

### New

- `src/test/session89_aura_of_vitality_per_turn.test.ts` — 37 assertions, 6 phases.

## ARCHITECTURAL NOTES

### Why start-of-turn auto-processing (not bonus action)

PHB p.216 says "You can use a bonus action to cause one creature in the aura to regain 2d6 hit points." The canon behavior requires a bonus action each turn. However, the engine has no per-turn bonus-action hook for concentration spells — the planner's `planBonusAction` function doesn't check for active concentration spells with per-turn effects.

The established workaround (Session 28, Eyebite) is start-of-turn auto-processing: the heal fires automatically at the START of the caster's turn, before `planTurn`. This doesn't consume a bonus action (v1 simplification). The caster still gets their normal turn (action + movement + bonus action).

This approach is consistent with the existing codebase and avoids planner changes. A future improvement could add a `planBonusAction` check for active Aura of Vitality (the bonus action would be "heal 1 ally for 2d6"), but this would require:
- A new `PlannedAction.type` (e.g., `'auraOfVitalityPulse'`)
- Planner logic to detect active Aura of Vitality and plan the bonus action
- Engine dispatch for the new type

This is a MEDIUM-complexity change that could be tackled in a future session if RAW accuracy is desired.

### Why the initial 3-ally burst is preserved

The canon Aura of Vitality has NO initial burst — the spell creates the aura, and each turn you use a bonus action to heal 1 creature. The v1 simplification (heal up to 3 allies on cast) was a design choice to make the spell useful in short combats (where 10 rounds of 1-ally/turn healing wouldn't all fire).

Session 89 preserves this initial burst AND adds the per-turn pulse. The result is:
- Turn 1: cast (main action) → initial burst heals up to 3 allies for 2d6 each
- Turn 2+: start-of-turn pulse heals 1 most-wounded ally for 2d6

This is strictly better than the previous v1 (which had no per-turn pulse) and preserves backward compatibility with existing tests.

### Why no sentinel effect (unlike Eyebite)

Eyebite creates a `damage_zone` sentinel effect with `dieCount=0` on the caster. This sentinel is found by `undoEffect` when concentration breaks, allowing explicit cleanup of the `_eyebiteActive` scratch field.

Aura of Vitality doesn't create a sentinel effect — it just calls `startConcentration` and sets `_auraOfVitalityActive`. The concentration gate (`actor.concentration?.active && actor.concentration.spellName === 'Aura of Vitality'`) is sufficient to stop the pulse when concentration breaks. The `_auraOfVitalityActive` flag remains set but is harmless (the gate fails before checking it). When the caster re-casts Aura of Vitality, the flag is overwritten.

This is simpler than the Eyebite pattern and avoids creating an unnecessary ActiveEffect. The trade-off is that the `_auraOfVitalityActive` flag is never explicitly cleared — but since it's only read after the concentration gate passes, this is safe.

### Relationship to other concentration per-turn patterns

The codebase has several concentration spells with per-turn effects:
- **Eyebite** (Session 28): start-of-turn auto-target, `_eyebiteActive` flag + sentinel effect
- **Call Lightning** (Session 60): `_movingZone` auto-moves + damages at start of turn
- **Witch Bolt** (Session 37): action-based per-turn damage (caster must use action to continue)
- **Aura of Vitality** (Session 89): start-of-turn auto-heal, `_auraOfVitalityActive` flag (no sentinel)

The start-of-turn auto-processing pattern (Eyebite, Call Lightning, Aura of Vitality) is the established approach for concentration spells with per-turn effects that don't require an action. Witch Bolt is the exception — it requires an action, so it's handled differently (the caster must choose to continue the spell).

## VERIFICATION SNAPSHOT

- `git log --oneline -5`: `a53eaf4`, `96bb6b6`, `98bbd15`, `70b69b4`, `74ef25a`
- `git status` → clean working tree (after push)
- `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- Key test files: all pass (Aura of Vitality family 80 assertions including session89's 37; concentration patterns 163 assertions)
- Full CI: all 6 chunks pass (417 files, 22984 assertions, 0 failed)
- CI on `a53eaf4`: all 9 check-runs `success` ✅
- **NO RED X**
