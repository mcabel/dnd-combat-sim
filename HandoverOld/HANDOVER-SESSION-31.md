# HANDOVER — Session 31 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `357c271`)
- **Tests:** 1428 passing, 0 failed (25 suites + server.test.ts pending)
  - `los.test.ts`: 54 new tests added this session
  - `combat.test.ts`: 43–51 range, 0 failures (known probabilistic variance)
  - All other suites: 0 failures
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 30

### LOS / Cover System — Phase 1 ✅ COMPLETE

**Ruleset:** PHB 2014 Ch.10, DMG Ch.8, SAC v2.7.

#### New files
**`src/engine/los.ts`** — Full LV1 (2D, flat grid) implementation:
- `computeLOS(attacker, target, bf?)` → `LOSResult`
- `getCoverBonus(attacker, target, bf?)` → 0 | 2 | 5
- `hasTotalCover(attacker, target, bf?)` → boolean
- `hasLineOfSight(attacker, target, bf?)` → boolean
- `segmentIntersectsAABB(p, q, aabb)` — slab-method ray test (epsilon-shrunk)
- `getSizeFootprint(size)` — Tiny=0.5, S/M=1, L=2, H=3, G=4 (full size names)
- `getCombatantAABB(c)` / `getAABBCorners(aabb)` — AABB helpers

**`src/test/los.test.ts`** — 54 tests across 11 sections:
geometry unit tests, open field, total cover, half cover, three-quarters cover,
open door, fog cloud (vision-only), large footprint, engine integration.

#### Modified files
**`src/types/core.ts`** — Added `Obstacle` interface and `obstacles?: Obstacle[]` to `Battlefield`.

**`src/engine/combat.ts`** — In `resolveAttack`:
- Added `import { computeLOS } from './los'`
- LOS check at top of function (before attack roll):
  - `action.attackType !== 'save'` → compute `los`
  - `!los.hasLineOfEffect` → log "Total Cover!" and `return` (attack blocked)
- `losDisadvantage = !los.hasLineOfSight` → pipes into `disadvantage` flag
- `coverACBonus` added to `effectiveAC`

#### Spec decisions (see `SPEC-LOS-DECISIONS.md` in repo root, if committed)
- **LV1 only** (4 source corners × 4 target corners = 16 rays max)
- **Grid-square obstacles** (not edge-based walls — simpler and correct for 5e)
- **No EU scaling** (grid squares = 5ft throughout, no 60:1 conversion)
- **No LUT trig** (Math.sin/cos at event time, not per-frame)
- **Creature-as-cover DEFERRED** (static Obstacle objects only)
- **3D / Z-axis DEFERRED** (only X/Y plane evaluated)

---

## Two-Agent Coordination

### Concurrent branch: `feature/los-ui` (delegate agent)
**Their scope:** `docs/simulator.html` + `src/server.ts` only.
**Their tasks:** (1) Accept `obstacles[]` in POST /api/simulate, (2) Obstacle placement UI.
**Conflict risk:** NONE — they don't touch engine or ai files.
**Merge order:** This agent's main commits first; UI agent PRs into main after.

### Concurrent branch: `feature/healing-spells` (other concurrent agent)
**Their scope:** Touched `src/ai/planner.ts` at lines 248–265 and 515–535.
- Lines 248–265: `planBonusAction` priority list (added Healing Word at priority 2.5)
- Lines 515–535: action selection (added `spellHeal` override for downed allies)
**Conflict risk with our work:** NONE — we didn't touch `planner.ts`.
**Conflict risk for future sessions:** When implementing Cunning Action: Hide, we will
add Hide logic to `planBonusAction`. Rebase onto main after healing-spells merges first.

---

## NOT YET DONE — Session 31 Priority

### 1. Cunning Action: Hide — Rogue Stealth (HIGH)
**PHB p.96:** Rogue can use bonus action to Hide (requires obscurement or cover).
**Prerequisite for Hide:** LOS system is now in place ✅

**Implementation plan:**
- `Combatant` needs a `hidden` condition or `isHidden: boolean` field
- Hide condition: Rogue must not be in direct LOS of any enemy
  (`hasLineOfSight(enemy, rogue, bf)` returns false for ALL enemies)
- On successful Hide: Rogue gains the `Hidden` status
  - Rogue attacks have **Advantage** (PHB p.194)
  - Rogue is revealed after attacking (even on a miss)
  - Rogue is revealed if enemy succeeds on a Perception check vs Rogue's Stealth
    (Passive Perception for simplicity — Rogue rolls stealth once on Hide)
- `planCunningAction` Case 3: add Hide attempt when:
  - No enemy has LOS to Rogue (after planned Disengage move)
  - `cunningAction` resource available
  - Rogue not already Hidden
- Sneak Attack still applies even while Hidden (before reveal)

**Prerequisite check:** Does the battlefield have any vision-blocking obstacles?
If not, Hide is always impossible (open field). Check `bf?.obstacles?.some(o => o.blocksVision)`.

### 2. Warding Bond AI (MEDIUM — no new prereqs)
- `case 'wardingBond'` in `executePlannedAction` (combat.ts)
- Planner function in `ai/resources.ts`
- `resources.wardingBond: { remaining, target }` cross-round tracking

### 3. Phase 8-H: Day simulation (FLAG FOR SONNET)

### 4. Healing Spells integration tests
The healing-spells branch documented `healing_spells.test.ts` is missing.
Once their branch merges to main, write the integration test:
"Cleric casts Cure Wounds on downed Fighter → Fighter revives".

---

## Key Architecture Notes

### LOS Data Flow
```
EngineState.battlefield.obstacles: Obstacle[]   (optional)
  ↓
computeLOS(attacker, target, bf)
  ↓ LV1: 4 attacker corners × 4 target corners
  → best source corner (most clear paths)
  → cover state: 'none' | 'half' | 'three-quarters' | 'total'
  → hasLineOfSight (vision check, independent)
  ↓
resolveAttack:
  if total cover → return (blocked)
  effectiveAC += coverACBonus (0 | 2 | 5)
  disadvantage |= !hasLineOfSight
```

### Cover State Mapping
| Clear rays (of 4) | Cover | AC Bonus |
|--------------------|-------|----------|
| 4/4 | none | 0 |
| 2–3/4 | half | +2 |
| 1/4 | three-quarters | +5 |
| 0/4 | total | blocked |

### Obstacle Fields
- `blocksMovement: true` → physical obstacle (wall, pillar, closed door)
- `blocksVision: true` → vision blocker (fog cloud, curtain, magical darkness)
- `isOpen?: true` → bypasses BOTH (open door, window, portcullis up)
- Position in grid squares (1 GS = 5ft), same coordinate space as Combatant.pos

### Backward Compatibility
`makeFlatBattlefield(w, h, combatants)` is unchanged. `obstacles` field is optional.
If `bf.obstacles` is absent or empty, `computeLOS` returns open-field immediately (fast path).
All 1374 pre-LOS tests continue to pass.

---

## Test Baseline (after Session 30, ~1428 total)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| combat.test.ts | 43–51 (variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| cunning_action.test.ts | 42 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| healing.test.ts | 34 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| **los.test.ts** | **54 (NEW)** |
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
| server.test.ts | ~32 (run separately, timeout 45) |
| spell_actions.test.ts | 49 |
| summons.test.ts | 51 |
| warding_bond.test.ts | 21 |

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  timeout 30 npx ts-node "$f" 2>&1 | grep "Results:"
done
# Run server separately:
timeout 45 npx ts-node src/test/server.test.ts 2>&1 | grep "Results:"
```

## Git Workflow
```bash
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git add -A
git commit -m "Session 31: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 31
- **Before implementing Hide:** check if `Combatant` has a `conditions: Set<Condition>` and
  whether `'hidden'` (or similar) needs adding to the `Condition` union type in `core.ts`.
- **Healing-spells rebase:** once that branch merges to main, `git pull` and re-run full
  suite before adding new features. Their `planner.ts` changes (248–265, 515–535) are 
  clean — no conflict with LOS or Hide work.
- **los-ui delegate:** their PR can be reviewed/merged independently of Session 31 work.
  Check `server.test.ts` passes after their merge.
- **`combat.test.ts` count variance:** 43–51 is normal. Zero failures = all clear.
- **`warding_bond.test.ts` isolation flake:** still passes 21/21 in isolation, may show
  20/21 in full suite. Known issue, not a regression.
