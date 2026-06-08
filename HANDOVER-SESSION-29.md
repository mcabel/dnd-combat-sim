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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `8ad10ac`)
- **Tests:** 1298 passing, 0 failed (24 suites)
- **Branch:** main (detached HEAD workflow — always push `HEAD:main`)

---

## What Was Done in Session 28

### Sneak Attack AI positioning (fc3b16c) ✅
- `allyAdjacentToEnemy(attacker, enemy, bf)` — exported helper, excludes dead/unconscious
- `selectRogueTarget(self, bf)` — smart score + SA_BONUS=50 for SA-eligible enemies
- `selectTarget` dispatch — routes Rogues to SA-aware selection when SA not yet used
- `sneak_attack.test.ts` — 23 tests

### Cunning Action: Disengage (8ad10ac) ✅ COMPLETE
PHB p.96 — Rogue Level 2+ can Dash/Disengage/Hide as a bonus action.
**Scope implemented:** Disengage only (Dash + Hide deferred, see below).

#### Changes:
**`src/types/core.ts`**
```typescript
// PlayerResources — Rogue section:
sneakAttackDice?:    string;       // e.g. "1d6"
cunningAction?:      boolean;      // Level 2+: Dash/Disengage/Hide as bonus action
```

**`src/parser/pc.ts`**
- `RawResources` interface: added `cunningAction?: boolean`
- `buildResources`: parses `r.cunningAction` → `result.cunningAction = true`

**`src/engine/combat.ts`** — bug fix
```typescript
// Was: isDisengage only checked main action
const isDisengage = plan.action?.type === 'disengage'
                 || plan.bonusAction?.type === 'disengage'; // ← ADDED
```
Without this fix, bonus-action Disengage (Cunning Action) did NOT prevent OAs.

**`src/ai/planner.ts`** — two new private functions + planTurn wiring
- `cunningRetreatPos(startPos, target, bf)`: computes 1-square retreat destination
  away from target; tries primary axis then secondary when primary is off-map.
- `planCunningAction(self, chosenAction, target, startPos, bf)`: triggers when main
  action is a melee attack → returns `{ bonusAction: disengage, moveAfter: retreat }`.
- In `planTurn`, after `planBonusAction`: if no other bonus action claimed the slot
  AND `self.resources?.cunningAction`, call `planCunningAction` and apply result.
- `Vec3` added to core imports; `posKey` added to movement imports.

**`src/test/cunning_action.test.ts`** — 23 new tests (5 sections):
1. `cunningAction` resource gate (Lv2 gets Disengage, Lv1 doesn't, non-Rogue doesn't)
2. Disengage conditions (melee=yes, ranged=no, rage-priority beats Cunning Action)
3. Retreat position (away from enemy, z=0, cornered → Disengage still fires, no moveAfter)
4. OA prevention: `runCombat` integration — Rogue disengages, zero OAs on retreat
5. Full integration: SA targeting selects SA-eligible enemy + Disengage bonus planned

#### Architectural note — why planner only attacks if already adjacent:
`selectAction` uses `canReach(self, target, action)` against CURRENT position.
If target is > reach away, it returns `{ type: 'dash' }`. `planMovement` then handles
movement. This is a known simplification: the planner never "move-then-attack" in one
turn; it Dashes this turn and attacks next. This is why test layouts must put the Rogue
adjacent to its target when testing attack + bonus action combinations.

---

## NOT YET DONE — Next Session Priority

### 1. Cunning Action: Dash (deferred from Session 28)
**What's needed:**
The planner currently only plans a melee attack if the target is already in reach
(≤5 ft). Cunning Action Dash should allow: move (normal speed) + bonus Dash → reach
farther target + attack in same turn.

**The ordering problem:**
`executeTurnPlan` runs: moveBefore → action → bonusAction → moveAfter.
A bonus-action Dash added AFTER the attack doesn't help reach the target.
To fix this, the engine needs a "pre-action bonus" slot, OR the planner needs to
detect "target reachable with doubled movement" and restructure the plan:
- `plan.action = attack` (not dash)
- `plan.bonusAction = { type: 'dash' }` — executed BEFORE movement
- `plan.moveBefore = adjacent to target` (using speed*2 budget)

This requires either an engine ordering change (flag for Sonnet — complexity) or a
planner-only hack where `selectAction` checks doubled movement range.

**Planner-only approach (simpler, no engine change):**
In `planTurn`, after `selectAction` returns 'dash': check if `cunningAction` is set
AND `distanceFt(self.pos, target.pos) - reach ≤ self.speed * 2`. If yes:
override `chosenAction` with the best melee attack, set `bonusAction = { type:'dash' }`,
and rely on `planMovement` to move the Rogue adjacent (using speed*2 budget that the
bonus-action Dash would theoretically provide). The engine already handles doubled
movement when `plan.action.type === 'dash'` executes — for bonus-action Dash, the
movement budget needs explicit doubling in `planTurn` before `planMovement` runs.

**Flag for Sonnet**: assess whether engine ordering change is cleaner than planner hack.

### 2. Cunning Action: Hide (deferred from Session 28)
Requires LOS / cover detection to resolve stealth check meaningfully.
Current perception system tracks `targets` but no visibility or cover state.
Deferred until a LOS system is designed (flag for Sonnet — architecturally complex).

### 3. AI Planner support for Warding Bond (DEFERRED — Level 2+)
Infrastructure complete. Missing:
- `case 'wardingBond'` in `executePlannedAction` (combat.ts)
- Planner in `ai/resources.ts` deciding when to cast
- `resources.wardingBond: { remaining, target }` cross-round tracking

### 4. Phase 8-H: Day simulation / resource chaining
Flag for Sonnet — multi-encounter sessions, short/long rest recovery.

### 5. Multi-level PCs (FUTURE)
When user provides lv2–lv5 stat block JSON files. The `cunningAction` field is
already parsed from JSON — a Level 2 Rogue PC just needs `"cunningAction": true`
in its resources block and it will get full hit-and-run Disengage behaviour.

---

## Test Baseline (1298 total, 0 failed)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| combat.test.ts | ~42–53 (loop variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| **cunning_action.test.ts** | **23** |
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
| summons.test.ts | 51 |
| warding_bond.test.ts | 21 |
| server.test.ts | 32 |
| **Total** | **1298** |

Note: `combat.test.ts` varies 42–53 run-to-run (variable-length event arrays, all asserts pass).

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
- **Cunning Action Dash** is the natural next step but has an ordering problem —
  flag for Sonnet before writing engine code.
- **A Level 2 Rogue PC JSON** just needs `"cunningAction": true` in its resources
  block — all infrastructure is in place.
- **`cunningRetreatPos` tries two directions** (primary axis, then fallback) to avoid
  the cornered-at-map-edge case producing a null moveAfter when a y-retreat is possible.
- **`selectAction` only plans a melee attack if the target is ≤5 ft away** — test
  layouts that combine attack + bonus action must put the attacker adjacent to the target.
- Server test can be slow — run last with `timeout 45` if needed.
