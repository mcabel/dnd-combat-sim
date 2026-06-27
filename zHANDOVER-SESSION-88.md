# HANDOVER-SESSION-88

## REPOSITORY

- Branch: main
- Commits this session (oldest → newest):
  - `98bbd15` — Session 88: EB spread damage AI heuristic — deliberate multi-target per beam
- Previous: `70b69b4` (Session 87 handover), `74ef25a` (Session 87 GoI broader RAW reading), `3e8b215` (Session 85 fix flaky scorching_ray), `96ca864` (Session 86 handover), `83cf9ec` (Session 85 EB multi-target per beam)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Part 1: EB spread damage AI heuristic — commit `98bbd15`

**Feature gap (deferred from Session 87 handover action #4):** Eldritch Blast (PHB p.237) multi-beam was implemented in Session 80 (beam count scales by cantrip tier: 1/2/3/4 beams at levels 1/5/11/17). Session 85 implemented retarget-on-kill (focus-fire-then-switch): all beams target the primary, and on kill, remaining beams retarget to the next enemy. A deliberate "spread damage" AI heuristic — firing beams at different living targets from the start — was NOT implemented. The Session 87 handover listed this as action #4 (LOW risk).

**Session 88 fix:** The planner now populates `PlannedAction.secondaryTargetIds` when EB has multiple beams AND there are other living enemies in range that are weak enough to be killed by a single beam (currentHP ≤ max beam damage). The engine then directs beams 2+ at the secondary targets from the start. If a secondary target is dead, the beam falls back to the primary + retarget-on-kill. The default (no secondary targets) remains focus-fire-then-switch (Session 85 behavior).

**Key design decisions:**
- **Planner-side strategy, engine-side execution:** The planner identifies weak enemies and populates `secondaryTargetIds`. The engine consumes the list and directs beams accordingly. This separation keeps the planner focused on target selection and the engine focused on execution.
- **Conservative threshold:** Only spreads to enemies with `currentHP ≤ maxBeamDamage` (1d10 + CHA mod with Agonizing Blast). This avoids spreading to tanky enemies where focus-firing would be more effective. An enemy at exactly the threshold CAN be killed by a max-damage roll.
- **Weakest first:** Secondary targets are sorted by currentHP ascending (weakest first), maximizing the chance of multiple kills.
- **Up to `attackCount - 1` secondaries:** Beam 1 always targets the primary (chosen by `selectTarget`). Beams 2+ target secondaries if available. If there are fewer secondaries than remaining beams, the extra beams fall back to the primary + retarget-on-kill.
- **Dead secondary fallback:** If a secondary target is dead at the start of its beam (killed by a previous beam or was dead before), the beam falls back to `currentTarget` (the primary or a previously-retargeted enemy). The existing retarget-on-kill logic then handles the case where `currentTarget` is also dead.
- **No change to non-EB:** Extra Attack / Thirsting Blade are unaffected (the `secondaryTargetIds` check is guarded by `isEB`).
- **No change to default behavior:** When `secondaryTargetIds` is empty/undefined (no weak enemies, single beam, or non-EB), the engine behaves exactly as before (focus-fire + retarget-on-kill).

**Files modified:**
- `src/types/core.ts`: Added `secondaryTargetIds?: string[]` to `PlannedAction` interface. When populated by the planner, beams 2+ target these IDs. Left undefined/empty: focus-fire behavior (backward compat).
- `src/ai/planner.ts`: After the EB attackCount is set (Session 80 logic), new heuristic scans for weak in-range enemies (currentHP ≤ maxBeamDamage, excluding primary). Populates `secondaryTargetIds` with up to `attackCount - 1` entries (weakest first). Checks Agonizing Blast via `self.eldritchInvocations?.includes('Agonizing Blast')`. Uses EB range from action (120 ft default, 300 ft with Eldritch Spear).
- `src/engine/combat.ts`: Attack loop now checks `secondaryTargetIds` for EB beams i > 0. If `secondaryIds[i-1]` exists and is alive, sets `currentTarget` to that secondary and logs `"directs Eldritch Beam i/N at X (spread damage)"`. If the secondary is dead, `currentTarget` retains its previous value and the existing retarget-on-kill logic handles it. The `"makes Beam X/N"` announcement is suppressed when a spread or retarget log was emitted (those logs cover it).
- `src/spells/eldritch_blast.ts`: New metadata flag `spreadDamageV1Implemented: true`. Updated `multiTargetPerBeamV1Implemented` doc comment to reference Session 88.

**New test file:**
- `src/test/session88_eb_spread_damage.test.ts`: 40 assertions, 10 phases:
  1. Metadata: `spreadDamageV1Implemented: true`, `multiTargetPerBeamV1Implemented` still true, `multiBeamV1Implemented` still true.
  2. Engine: 2 beams, secondaryTargetIds set → beam 1 at primary, beam 2 at secondary (spread log emitted, 2 attack events on different targets). Uses retry loop for 5% nat-1 miss rate.
  3. Engine: 3 beams, 2 secondary targets → 3 beams at 3 different targets (2 spread logs, 3 attack events on different targets).
  4. Engine: secondary dead → no spread log, both beams at primary (fallback to currentTarget). Verifies dead secondary doesn't cause retarget to third enemy.
  5. Engine: no secondaryTargetIds → focus-fire (backward compat, no spread log, both beams at primary).
  6. Planner: populates secondaryTargetIds when weak enemy exists. Warlock level 5, CHA 20, Agonizing Blast. Primary = tanky (1000/1000 HP, closest). Secondary = weak (10/10 HP, ≤ maxBeamDamage=15, NOT bloodied to avoid being picked as primary).
  7. Planner: no secondary when all enemies are tanky (1000 HP >> 15).
  8. Planner: no secondary for level 1 (single beam, attackCount=1).
  9. Planner: out-of-range weak enemy excluded (125 ft > 120 ft range).
  10. Source-presence checks: `secondaryTargetIds` in core.ts, spread heuristic in planner.ts, `plan.secondaryTargetIds` consumption in combat.ts, `directs Eldritch Beam` log, `spreadDamageV1Implemented` metadata.

## ELDRITCH BLAST FEATURE COMPLETENESS — UPDATED

| Feature | Status | Session |
|---------|--------|---------|
| Multi-beam (1/2/3/4 beams by level) | ✅ implemented | 80 |
| noCantripScaling (1d10 per beam, no die scaling) | ✅ implemented | 80 |
| Repelling Blast (push 10 ft, every beam) | ✅ implemented | 38 |
| Agonizing Blast (+CHA mod per beam) | ✅ implemented | 39 |
| Grasp of Hadar (pull 10 ft, once per turn) | ✅ implemented | 39 |
| Lance of Lethargy (−10 ft speed, every beam) | ✅ implemented | 39 |
| Eldritch Spear (range 300 ft) | ✅ implemented | 41 |
| Multi-target per beam (retarget on kill) | ✅ implemented | 85 |
| **Multi-target per beam (deliberate spread)** | **✅ implemented** | **88** |

**EB feature completeness: ALL features implemented.** The EB spell is now fully featured — multi-beam scaling, all 5 invocations, multi-target per beam (both retarget-on-kill and deliberate spread), and Eldritch Spear range extension.

## TEST STATUS

### New test file this session

- `src/test/session88_eb_spread_damage.test.ts`: 40/40 ✅ (10 phases):
  1. Metadata: 3 assertions.
  2. Engine 2-beam spread: 4 assertions (retry loop).
  3. Engine 3-beam spread: 6 assertions (retry loop).
  4. Engine secondary-dead fallback: 4 assertions.
  5. Engine no-secondary backward compat: 3 assertions (retry loop).
  6. Planner populates secondaryTargetIds: 6 assertions.
  7. Planner no secondary when tanky: 2 assertions.
  8. Planner no secondary for single beam: 2 assertions.
  9. Planner out-of-range excluded: 1 assertion.
  10. Source-presence: 8 assertions.

### Test determinism

Phases 2, 3, 5 use retry loops (20 attempts; chance of 20 consecutive nat-1 misses ≈ 0.05²⁰ ≈ 10⁻²⁶ — effectively impossible) to achieve deterministic outcomes. The retry condition checks for the EXPECTED OUTCOME (spread log + attacks on different targets), not just "primary survived." Phase 4 (secondary dead) is fully deterministic (no retry needed — the secondary is pre-killed, and the primary is tanky enough to survive 2 beams). Phase 6 (planner) is deterministic (no dice rolls in planning).

### Regression checks (all green)

- **EB family:** session80 (36), session85 (30), session88 (40), eldritch_blast (53), eldritch_invocations (50), more_eldritch_invocations (56), eldritch_invocations_integration (73), thirsting_blade (24) — all ✅ (362 assertions).
- **Attack loop:** action_surge (28) — ✅.
- **Full CI chunk 1** (70 files): 70/70 passed, 3668 assertions, 0 failed.
- **Full CI chunk 2** (70 files): 70/70 passed, 4028 assertions, 0 failed.
- **Full CI chunk 3** (69 files): 69/69 passed, 3582 assertions, 0 failed.
- **Full CI chunk 4** (69 files, contains the new session88 test): 69/69 passed, 3925 assertions, 0 failed.
- **Full CI chunk 5** (69 files): 69/69 passed, 3690 assertions, 0 failed.
- **Full CI chunk 6** (69 files): 69/69 passed, 4050 assertions, 0 failed.
- **Total:** 416 files, 22943 assertions, 0 failed.
- **Full CI on `98bbd15`:** all 6 test chunks `success` ✅ (see CI STATUS below).

## TSC STATUS

`npx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this session.** (The 5 errors are the same `Record<string, unknown>` conversion errors in combat.ts:2580/2600, utils.ts:601, and the `monsterSpellSlots` possibly-undefined in monster_spellcasting.test.ts:602/609 — all pre-existing, unrelated to this change.)

## CI STATUS

- `98bbd15` (EB spread damage): **6/6 test chunks `success` ✅ — no red X**
  - test (1) through test (6): all success
- The GitHub Pages deployment checks (build/deploy/report-build-status) are a separate workflow that triggers automatically for pages content changes. They did not appear for `98bbd15` at verification time but are not code-quality gates — the 6 test chunks are the CI gate. No failed checks = no red X.
- Verified via GitHub API: all 6 test check-runs `completed/success`.

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged

Recharge (Dragon Breath 5-6): fully implemented (Session 52). Lair Actions: metadata + log stub only (bespoke effects, HIGH-risk, deferred). Legendary Actions: partially implemented (planner + dispatch + action pool). Phase 4 (bespoke dispatch for ~267 spells) completed in commit `819bc0b` (Session 75-76).

### 2. Ready Action full implementation (MEDIUM-HIGH risk) — unchanged

The defensive stub (`81a541d`) prevents the fall-through bug. Full implementation needs an RFC.

### 3. GoI condition-suppression pipeline (LOW risk) — unchanged

The save-fail tracker save roll is now GoI-protected (Session 84), and the caster-inside-barrier spatial case is now handled (Session 87). However, the `poisoned` (Contagion) / `restrained` (Flesh to Stone) ActiveEffects themselves are not suppressed while GoI holds. Full condition suppression would require pipeline-level GoI checks in the condition application/reevaluation pipeline (`src/engine/effect_pipeline.ts`). Low priority because the on-cast `filterGoIProtectedTargets` already prevents the spell from being applied to a GoI-protected creature in the first place, and the RAW interpretation of whether GoI suppresses ONGOING conditions is ambiguous (PHB p.245 says "can't affect" which could be read as blocking new effects only).

### 4. EB spread damage heuristic — ✅ COMPLETED (Session 88)

The EB "spread damage" AI heuristic is now implemented. The planner populates `secondaryTargetIds` when weak enemies exist, and the engine directs beams 2+ at those targets. This closes the last EB feature gap.

## CI FAILURE RECOVERY

If `98bbd15` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API.
2. **Most likely failure mode for `98bbd15` (EB spread):** a combat scenario test where the EB spread heuristic changes the outcome (e.g., a combat that previously had all beams focus-firing one target now spreads to multiple targets, changing the turn count or winner). Check any combat scenario test that involves a Warlock with EB at level 5+ with multiple weak enemies.
3. **The `secondaryTargetIds` field** is optional. If a test constructs a PlannedAction manually without `secondaryTargetIds`, the engine behaves as before (focus-fire). The spread only activates when the planner populates the list.
4. **The planner heuristic** only populates `secondaryTargetIds` when there are enemies with `currentHP ≤ maxBeamDamage`. If a combat scenario has all enemies at high HP, no spreading occurs.
5. **The engine spread logic** is guarded by `isEB && i > 0 && secondaryIds.length >= i`. For non-EB attacks, `secondaryIds` is empty (the `isEB` check on line 3241 filters it). For EB with no secondaries, the condition is false and the loop behaves as before.
6. **The "makes Beam X/N" log suppression** changed from `!(isEB && targetDown)` to `!(isEB && (targetDown || spreadLogEmitted))`. For non-EB, `isEB` is false so this is always `!false` = `true` — the log fires as before. For EB without spread, `spreadLogEmitted` is false, so the condition reduces to the previous `!(isEB && targetDown)`. A test that asserts on the exact "makes Beam" log line for EB after a spread would need updating.
7. **Fix forward** on a new commit.

## KEY FILES THIS SESSION

### Modified

- `src/types/core.ts` — Added `secondaryTargetIds?: string[]` to `PlannedAction` interface with doc comment.
- `src/ai/planner.ts` — After EB attackCount is set, new heuristic scans for weak in-range enemies and populates `secondaryTargetIds`.
- `src/engine/combat.ts` — Attack loop consumes `secondaryTargetIds` for EB beams i > 0; spread log emitted; "makes Beam" log suppression updated.
- `src/spells/eldritch_blast.ts` — New metadata flag `spreadDamageV1Implemented: true`; updated doc comment.

### New

- `src/test/session88_eb_spread_damage.test.ts` — 40 assertions, 10 phases.

## ARCHITECTURAL NOTES

### Why planner-side spread, engine-side retarget

The Session 85 architectural note explained why engine-side retarget-on-kill is simpler than planner-side multi-target: the planner picks one primary, and the engine handles the edge case where the primary dies mid-beam. Session 88 adds a planner-side heuristic ON TOP of this: the planner can now OPTIONALLY populate `secondaryTargetIds` to direct beams at different targets from the start. The engine-side retarget-on-kill still fires as a fallback when a secondary target is dead.

This dual approach gives the best of both worlds:
- **Deliberate spread (planner-side):** when the planner identifies multiple weak enemies, it directs beams at them from the start — maximizing kills per turn.
- **Reactive retarget (engine-side):** when any target (primary or secondary) dies mid-beam, the engine retargets the remaining beams to the next living enemy — preventing wasted beams.

The planner-side spread is conservative: it only spreads to enemies that COULD be killed by one beam (currentHP ≤ maxBeamDamage). This avoids spreading to tanky enemies where focus-firing would be more effective.

### Why `secondaryTargetIds` is a separate field (not `targetId: string[]`)

Changing `targetId` from `string | null` to `string[] | null` would be a breaking change with broad blast radius — every PlannedAction construction, every engine consumption, and every test that reads `plan.targetId` would need updating. Instead, `secondaryTargetIds` is an optional field that supplements `targetId`:
- `targetId` remains the primary target (beam 1).
- `secondaryTargetIds[i-1]` is the target for beam i+1 (i > 0).
- If `secondaryTargetIds` is empty/undefined, all beams target `targetId` (backward compat).

This approach has zero blast radius: existing code that doesn't populate `secondaryTargetIds` behaves exactly as before.

### Why the threshold is `currentHP ≤ maxBeamDamage`

The max non-crit single-beam damage is 1d10 (10) + CHA mod (with Agonizing Blast). A target with currentHP ≤ this CAN be killed by one max-damage beam. The heuristic spreads to these targets because:
- If the beam rolls max damage, the target dies — achieving a kill that focus-firing would not (the primary is typically tankier).
- If the beam doesn't roll max, the target is still damaged — setting up a kill for a future turn.

Using average damage (5.5 + CHA mod) would be more aggressive (spread to more targets) but riskier (many beams wouldn't kill). Using max damage is conservative but ensures that spreading only happens when there's a real chance of a kill.

### Relationship to Session 85 retarget-on-kill

Session 85's retarget-on-kill and Session 88's spread damage are complementary:
- **Spread (Session 88):** beams 2+ target DIFFERENT enemies from the start (proactive).
- **Retarget (Session 85):** when any target dies mid-beam, remaining beams retarget to the next living enemy (reactive).

Both can fire in the same turn: e.g., beam 1 kills the primary, beam 2 was assigned to a secondary (spread) but the secondary was also killed by... wait, that can't happen in a single turn because beams fire sequentially. The sequence is:
1. Beam 1 → primary (if primary dies, beam 2's spread assignment takes over)
2. Beam 2 → secondary (spread). If secondary is dead (from a previous turn), falls back to primary. If primary is also dead, retarget-on-kill fires.
3. Beam 3 → next secondary (spread). If dead, falls back + retarget.

The spread assignment happens at the START of each beam iteration, before the dead-check. So the flow is:
1. Assign beam target (spread or default to primary)
2. Check if assigned target is dead → retarget if EB
3. Fire beam

This ensures every beam has a valid target if possible, whether through spread assignment or retarget-on-kill.

## VERIFICATION SNAPSHOT

- `git log --oneline -5`: `98bbd15`, `70b69b4`, `74ef25a`, `3e8b215`, `96ca864`
- `git status` → clean working tree (after push)
- `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- Key test files: all pass (EB family 362 assertions including session88's 40)
- Full CI: all 6 chunks pass (416 files, 22943 assertions, 0 failed)
- CI on `98bbd15`: all 6 test check-runs `success` ✅
- **NO RED X**
