# HANDOVER — Session 29 Start

## Prompt Instructions (carry forward every session)
- Break down large tasks, ask for input when needed
- Commit to GitHub after each meaningful chunk of work
- Stop and flag for Sonnet when a task is architecturally complex
- When fresh chat is optimal: commit, write this handover, stop
- Future handovers must be self-contained and seamless
- PAT: provided verbally at session start — do not paste in files
- Scope: PHB 2014 / MM 2014 / SAC v2.7. No post-2024 content yet.
- Username: mcabel

## Current State
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `fc3b16c`)
- **Tests:** 1275 passing, 0 failed (23 suites)
- **Branch:** main (detached HEAD workflow — always push `HEAD:main`)

---

## What Was Done in Session 28

### Sneak Attack AI Positioning ✅ COMPLETE

#### Problem
The Rogue's AI used generic `selectTarget` (smart profile) which didn't account for
Sneak Attack eligibility. This meant the Rogue often attacked the nearest enemy
regardless of whether an ally was adjacent to it — missing guaranteed SA damage.

#### Solution
Two additions to `src/ai/targeting.ts`:

**`allyAdjacentToEnemy(attacker, enemy, bf)`** (exported helper):
- Returns true if any living, non-incapacitated ally of `attacker` is within
  Chebyshev distance ≤ 1 of `enemy` (i.e. within 5 ft)
- Dead and unconscious allies do NOT count
- Diagonal adjacency counts (Chebyshev grid)

**`selectRogueTarget(self, battlefield)`** (exported):
- Augments `smartScore` with `SA_BONUS = 50` when ally is adjacent to candidate enemy
- Falls back to pure smart scoring when no ally adjacency exists
- Bonus (50) sits below bloodied bonus (60) — finishing off a bloodied enemy still wins

**`selectTarget` (updated dispatch)**:
```typescript
if (self.resources?.sneakAttackDice && !self.usedSneakAttackThisTurn) {
  return selectRogueTarget(self, battlefield);
}
// then existing switch(aiProfile) ...
```
- Only triggers when SA hasn't been used this turn
- Non-Rogues are entirely unaffected

**`sneak_attack.test.ts`** — 23 new tests (5 sections):
1. `allyAdjacentToEnemy` unit tests (adj, not-adj, self-excluded, dead ally, diagonal)
2. `selectRogueTarget` scoring bias (prefers SA-eligible, falls back to smart score,
   both SA-eligible → bloodied wins, no-ally fallback)
3. `selectTarget` dispatch (Rogue routes to SA path, non-Rogue bypasses)
4. `planTurn` integration (full plan targets SA-eligible enemy, solo Rogue plan)
5. Edge cases (single enemy, all dead, incapacitated ally, Chebyshev boundary)

---

## NOT YET DONE — Next Session Priority

### 1. Rogue Cunning Action: Disengage/Dash/Hide as bonus action (NEXT PRIORITY)
**What it is:** PHB p.96 — Rogue can Disengage, Dash, or Hide as a bonus action.
**Current state:** No bonus action is planned for the Rogue; `planBonusAction` in
`planner.ts` doesn't have a Rogue branch.
**What's needed:**
- Add `rogueLevel` or a `cunningAction` flag to resources (or detect via class)
- Add Cunning Action logic in `planBonusAction`:
  - Hide: if Rogue has cover and hasn't been seen this turn → hide bonus action
  - Disengage: if Rogue is in melee and wants to reposition
  - Dash: if Rogue can't reach the SA-eligible target with normal move

Files: `src/ai/planner.ts` (planBonusAction), `src/parser/pc.ts` (resources),
`src/types/core.ts` (PlayerResources.cunningAction?), `src/engine/combat.ts`
(executePlannedAction needs 'hide' case handling).

### 2. AI Planner support for Warding Bond (DEFERRED — Level 2+)
The mechanical infrastructure is complete. Only missing:
- `case 'wardingBond'` in `executePlannedAction` (combat.ts)
- Planner function in `ai/resources.ts`
- `resources.wardingBond: { remaining, target }` cross-round tracking
- Relevant only when multi-level PCs are introduced (Paladin 3+, Cleric 3+)

### 3. Phase 8-H: Day simulation / resource chaining
Flag for Sonnet — architecturally complex (multi-encounter sessions, short/long rest
resource recovery).

### 4. Multi-level PCs (FUTURE)
When user provides lv2–lv5 stat block JSON files.

---

## Key Architecture Notes

### SA targeting flow (as implemented):
```
Rogue turn → selectTarget(rogue, bf)
  → resources.sneakAttackDice defined AND !usedSneakAttackThisTurn
  → selectRogueTarget(rogue, bf)
    → for each enemy: smartScore + (allyAdjacentToEnemy ? 50 : 0)
    → picks highest scoring enemy
  → planMovement moves Rogue adjacent to chosen target
  → combat engine: canSneakAttack checks ally-adj → applies SA damage
```

### SA bonus magnitude rationale:
| Bonus source         | Score |
|---------------------|-------|
| Bloodied enemy       | +60   |
| **SA adjacency**     | **+50** |
| Isolation (no allies)| +25   |
| Healer priority      | +80   |

SA bonus (50) tips the scale when two enemies are roughly equal — enough to prefer
an SA-eligible target over a slightly-closer non-eligible one. Not enough to override
a bloodied enemy (which the Rogue should still prioritize).

---

## Test Baseline (1275 total, 0 failed)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| combat.test.ts | ~42–53 (loop variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| healing.test.ts | 34 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 266 |
| phase4.test.ts | 54 |
| rage.test.ts | 40 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| **sneak_attack.test.ts** | **23** |
| server.test.ts | 32 |
| summons.test.ts | 51 |
| warding_bond.test.ts | 21 |
| **Total** | **1275** |

Note: `combat.test.ts` count varies run-to-run (42–53) due to variable-length event arrays
in test 3. All asserts pass — expected, not a regression.

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  npx ts-node "$f" 2>&1 | grep "Results:"
done
```

## Start Server
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
npx ts-node src/server.ts
# Open: http://localhost:3000/simulator.html
```

## Git Workflow
```bash
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git add -A
git commit -m "Session 29: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 29
- **Cunning Action is the natural next step** — pairs with the SA targeting work done
  this session and completes Level 1 Rogue AI behaviour.
- **Cunning Action's Hide bonus action** requires thinking about the perception/LOS model.
  The current system has `perception.targets` but no visibility/cover tracking. Cunning
  Action Hide may need to be simplified to "hide if not in enemy melee reach" initially.
- **`selectRogueTarget` is exported** from `targeting.ts` — future tests can import it
  directly for unit testing.
- **`allyAdjacentToEnemy` is exported** — reusable wherever SA eligibility is needed
  (e.g. future Cunning Action positioning logic).
- Server test can be slow — run last and with `timeout 45` if needed.
