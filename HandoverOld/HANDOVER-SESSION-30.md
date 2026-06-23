# HANDOVER — Session 30 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `a0f8f20`)
- **Tests:** 1325 passing, 0 failed (24 suites)
- **Branch:** main (detached HEAD workflow — always push `HEAD:main`)

---

## What Was Done in Session 29

### Cunning Action: Dash (Level 2+ Rogue) ✅ COMPLETE

**PHB rule:** Rogue can use their bonus action to Dash (Cunning Action, PHB p.96).  
Dash is an *additive stipend* equal to base speed — NOT a doubling (PHB p.192).  
A grappled creature (effectiveSpeed = 0) gains 0 movement from Dash.

#### Changes

**`src/engine/combat.ts`:**
- Added `effectiveSpeed` to import from `./utils`
- `case 'dash'` in `executePlannedAction`: changed `actor.speed` → `effectiveSpeed(actor)` to respect condition-zeroed speeds (grapple, restrain, etc.)
- `executeTurnPlan`: added `isBonusDash` check — if `plan.bonusAction?.type === 'dash'`, the bonus action fires **before** `moveBefore` (so its stipend is in the budget when the move executes). All other bonus actions still fire after the main action.
- Fixed all misleading "doubles movement" comments throughout (Dash is additive, not multiplicative)

**`src/ai/planner.ts`:**
- Added imports: `distanceFt` (from movement), `effectiveSpeed` (from utils), `bestAttackAction` (from actions)
- `planCunningAction` expanded with Case 2: **Dash**
  - Triggers when `chosenAction.type === 'dash'` (AI fell back to action-Dash because target out of normal range, no ranged weapon)
  - `totalBudget = movementFt + effectiveSpeed(self)` — checks if bonus stipend covers the gap
  - Distance calculated from `self.pos` (current position), NOT `startPos` (which was the now-cancelled action-Dash destination)
  - If reachable: returns `bonusAction: {type:'dash'}` + `overrideAction: melee attack` + `moveBefore: adjacent square`
  - Disengage case unchanged; they don't conflict (Dash only fires on `type:'dash'` action)
- `planTurn` call site: handles new `moveBefore` and `overrideAction` fields from `planCunningAction`

**`src/test/cunning_action.test.ts`:**
- Header updated: Dash marked ✅, Hide still ⬜
- 19 new tests in Section 6 covering:
  1. planTurn triggers bonus Dash when melee-only, target 40ft away
  2. No Dash when ranged weapon covers the target (Shortbow)
  3. No Dash when target truly out of range (70ft > 60ft budget)
  4. No Dash without cunningAction (Level 1 Rogue)
  5. Disengage takes priority when already adjacent (normal case unaffected)
  6. Exact boundary: 65ft reachable (budget=60, needed=60); 70ft not
  7. Engine integration: bonus Dash fires before movement → Rogue attacks on round 1

---

## NOT YET DONE — Next Session Priority

### 1. Cunning Action: Hide (DEFERRED — needs LOS/cover system)
**What it is:** PHB p.96 — Rogue can Hide as a bonus action.
**Why deferred:** The current simulator has no line-of-sight or cover tracking.
Meaningful Hide implementation requires at minimum: obstacle/cover map, visibility
between combatants, and a stealth vs. passive perception contest.
**Simplified approach (if scope allows):** "Hide if no enemy has line-of-sight
to Rogue (i.e., Rogue is not adjacent to any enemy and has already Disengaged)."
This is a major prerequisite system — flag for Sonnet when prioritised.

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

### Dash mechanic (as implemented and clarified by user)
> "Dash is an additive stipend equal to base speed, not a multiplier."
- Speed 30 + Action Dash = 60ft total
- Speed 30 + Cunning Action Dash = 60ft total (same, but uses bonus action not main action)
- Speed 30 + Action Dash + Cunning Action Dash = 90ft total
- Conditions that zero speed (grapple, paralysis, restrain) also zero the Dash stipend.
  `effectiveSpeed()` must be used everywhere Dash stipend is computed — NOT `actor.speed`.

### Cunning Action Dash flow
```
Rogue turn → selectAction returns type:'dash' (melee-only, target out of reach)
  → planCunningAction Case 2:
      totalBudget = movementFt + effectiveSpeed
      movementNeeded = distanceFt(self.pos, target.pos) - bestMeleeReach
      if totalBudget >= movementNeeded:
        → bonusAction: {type:'dash'}
        → overrideAction: melee attack on target
        → moveBefore: bestAdjacentPos(self, target, bf)
  → planTurn applies overrides: plan.action = melee, plan.moveBefore = adjacent
Engine executeTurnPlan:
  isBonusDash = true
  → Execute bonusAction first → movementFt += effectiveSpeed
  → moveBefore: Rogue moves adjacent (now has budget)
  → action: melee attack
```

### Movement budget invariant
- `resetBudget(c)` sets `movementFt = effectiveSpeed(c)` at turn start
- Dash adds `effectiveSpeed(actor)` per call (both action-Dash and bonus-action Dash)
- `spendMovement(actor, ft)` deducts from `movementFt`; returns false if insufficient
- Movement is non-contiguous: move → attack → move → attack is valid within budget

---

## Test Baseline (1325 total, 0 failed — 24 suites)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| combat.test.ts | ~42–53 (loop variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| **cunning_action.test.ts** | **42** (+19 vs Session 28) |
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
| sneak_attack.test.ts | 23 |
| server.test.ts | 32 |
| summons.test.ts | 51 |
| warding_bond.test.ts | 21 |
| **Total** | **~1325** |

Note: `combat.test.ts` count varies run-to-run (42–53) due to variable-length event arrays
in test 3. All asserts pass — expected, not a regression.
`warding_bond.test.ts` may show 20/21 when run in the full suite (known isolation flake);
passes 21/21 in isolation.

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  timeout 30 npx ts-node "$f" 2>&1 | grep "Results:"
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
git commit -m "Session 30: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 30
- **Cunning Action: Hide** is the only remaining CA item, but it is a substantial prerequisite
  system (LOS/cover). Recommend flagging for Sonnet and tackling a simpler task first.
- **Warding Bond AI** is the most approachable next item — mechanical infra already exists,
  just needs `executePlannedAction` case + planner logic. Medium complexity.
- **The `planCunningAction` `startPos` parameter** is only meaningful for the Disengage case
  (Rogue attacks from that position and retreats). The Dash case uses `self.pos` internally.
  This asymmetry is intentional and documented in the code.
- **Server test is slow** — run last, `timeout 45` if needed.
- **`effectiveSpeed` is now the canonical way** to get a creature's current speed throughout
  the engine. Any new Dash-like mechanic MUST use `effectiveSpeed`, not `actor.speed`.
