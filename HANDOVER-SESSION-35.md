# HANDOVER — Session 35 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `e7d16fe`)
- **Tests:** ~1,557 passing, 0 failed (30 suites incl. new warding_bond AI sections + bless)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 34

### Warding Bond AI ✅ COMPLETE (commit `e7d16fe`)

**PHB p.287:** 2nd-level abjuration, action, Touch range (5 ft), NO concentration, 1-hour duration.
Effect on bonded ally: +1 AC, +1 saves, resistance to all damage, caster takes redirect damage.

#### Files created
**`src/spells/warding_bond.ts`** — Spell module. Exports:
- `shouldCast(caster, bf): Combatant | null` — returns best adjacent ally or null when:
  no `resources.wardingBond.remaining`, caster already has active bond, no living unbonded
  ally within 5 ft. Prefers most vulnerable ally (lowest HP%), breaks ties by lowest AC.
- `execute(caster, target, state)` — decrements resource, sets `target.wardingBond = { casterId }`,
  logs `action` + `condition_add` events.
- `metadata` — spell stats (level 2, abjuration, range 5 ft, no concentration)
- Local `emit()` helper (same pattern as faerie_fire.ts, avoids circular import)

#### Files modified
**`src/types/core.ts`**:
- Added `'wardingBond'` to `PlannedAction.type` union (alongside `'bless'` from concurrent agent)
- Added `wardingBond?: { remaining: number }` to `PlayerResources`
  - Tracked as dedicated resource (not a spell slot) — avoids level-1 slot constraint
  - `remaining: 1` = can cast; `0` = already active/expended

**`src/ai/planner.ts`**:
- Added `import { shouldCast as shouldCastWardingBond }` from `'../spells/warding_bond'`
- Added wardingBond check in `planTurn` — positioned **after Cure Wounds, before Faerie Fire**
  (protective buff > offensive control; touch range requires planning before closing)
- Gate: `self.resources?.wardingBond?.remaining > 0` — only fires when resource available

**`src/engine/combat.ts`**:
- Added `import { execute as executeWardingBond }` from `'../spells/warding_bond'`
- Added `case 'wardingBond'` in `executePlannedAction`: looks up target by `plan.targetId`,
  validates alive, calls `executeWardingBond(actor, wbTarget, state)`

**`src/test/warding_bond.test.ts`** — 20 new tests (Sections 6–9), total now **41**:
- Section 6 (8 tests): `shouldCast` gates — resource absent, remaining=0, ally out of range,
  ally already bonded, caster already has bond, dead ally, HP-based target preference
- Section 7 (5 tests): `execute` pipeline — bond set, resource decremented, action event,
  condition_add event, resistance activates post-bond
- Section 8 (3 tests): `planTurn` — picks wardingBond with resource+adjacent ally, skips
  when remaining=0, skips when ally out of touch range
- Section 9 (3 tests): `runCombat` integration — condition_add fires, remaining=0 after
  cast, not recast on round 2 (resource gate enforced)

#### Also landed this session (concurrent agent, commit `68c9632`)
**Bless spell module** — PHB p.219: 1st-level, concentration, range 30 ft, up to 3 allies.
+1d4 to attack rolls AND saving throws. Files: `src/spells/bless.ts`,
`src/test/bless.test.ts` (37 tests). Integrated into planner (before `selectTarget`, highest
priority for offensive support) and `case 'bless'` in combat.ts.

---

## NOT YET DONE — Priorities for Session 35

### 1. Phase 8-H: Day simulation (FLAG FOR SONNET)
Architecturally complex — stop and flag, don't implement.
Multiple combats per day, long rest / short rest recovery, spell slot refill, resource tracking
across encounters. Requires new top-level simulation loop above `runCombat`.

### 2. Shield of Faith spell module (EASY — follows Bless/Faerie Fire pattern)
PHB p.275: 1st-level, concentration, bonus action, range 60 ft. Target: 1 willing creature.
Effect: +2 AC bonus for the duration.
- `src/spells/shield_of_faith.ts` — shouldCast targets ally with lowest AC, execute applies
  `advantage_vs:attack` (wrong — Shield of Faith gives +2 AC, not advantage). Needs a new
  `SpellEffectType`: `'ac_bonus'` with `value: 2`, OR wire into the existing `ActiveEffect`
  `ac_bonus` if it already exists in `spell_effects.ts`.
  **Check `spell_effects.ts` and `SpellEffectType` before deciding approach.**

### 3. Hunter's Mark (MEDIUM — Ranger, concentration, bonus action)
PHB p.251: 1st-level, concentration, bonus action to cast, move mark as bonus action on kill.
+1d6 bonus damage vs marked target. Attaches to one target; persists through kills.
Would need: `'marked'` condition on target, `huntersMark` resource tracking, planner wiring.

### 4. Divine Smite (MEDIUM — Paladin reaction/triggered on hit)
PHB p.85: Triggered after a successful hit — spend a spell slot to add radiant damage.
Not a planned action — fires INSIDE `resolveAttack`. Would need: detection of melee hit,
AI decision to smite (based on target HP and available slots).

---

## Architecture Notes

### Spell module pattern (all spells follow this)
```typescript
// src/spells/<name>.ts
export const metadata = { name, level, school, rangeFt, concentration, ... };
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | Combatant | null { ... }
export function execute(caster: Combatant, targets: ..., state: EngineState): void { ... }
```
- Local `emit()` helper pushes to `state.log.events` (avoids circular import from combat.ts)
- Planner: `import { shouldCast as shouldCastXxx }` — aliased to avoid collision
- combat.ts: `import { execute as executeXxx }` + `case 'xxx'` in `executePlannedAction`
- Re-run `shouldCast` in the case handler to pick up stale-target edge cases

### planTurn spell priority order (current)
1. **Bless** — before `selectTarget`, highest priority (buff allies early)
2. **Cure Wounds** — after `selectTarget`, urgent heal gates
3. **Warding Bond** — after Cure Wounds, before Faerie Fire (protective buff, touch range)
4. **Faerie Fire** — before attack selection (AoE advantage)
5. Normal attack / movement

### Warding Bond resource model
- `resources.wardingBond: { remaining: number }` — dedicated resource, NOT a spell slot
- `remaining: 1` at start → `0` after cast; gate prevents re-casting while bond is active
- Bond state lives on bonded creature: `target.wardingBond = { casterId }`
- Bond break still handled in `checkDeath` / `applyWardingBondRedirect` (unchanged from S31)

### wardingBond? in PlayerResources — type note
Added as optional field (`wardingBond?: { remaining: number }`). Existing PC stat blocks
(pc_stat_blocks_lv1.json) do NOT have this field — the Cleric's spellcasting doesn't include
Warding Bond (it's 2nd-level). Test combatants that need it are constructed manually with
`resources: { wardingBond: { remaining: 1 } }`. Adding it to the Cleric stat block (and
giving them 2nd-level slots) is a future PC data update task.

---

## Test Baseline (Session 35 start, ~1557 total)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| **bless.test.ts** | **37 (new from concurrent agent)** |
| combat.test.ts | 43–51 (variance, 0 failures) |
| concentration_ai.test.ts | 34 |
| cunning_action.test.ts | 53 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| faerie_fire.test.ts | 30 |
| healing.test.ts | 34 |
| healing_spells.test.ts | 36 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| los.test.ts | 54 |
| mechanics.test.ts | 57 (56/1 in batch = pre-existing probabilistic variance) |
| mount.test.ts | 43 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 266 |
| phase4.test.ts | 54 |
| rage.test.ts | 40 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | 32 (run separately, timeout 45) |
| sneak_attack.test.ts | 23 |
| spell_actions.test.ts | 52 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| **warding_bond.test.ts** | **41 (was 21)** |

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  timeout 35 npx ts-node "$f" 2>&1 | grep "Results:"
done
# Server separately:
timeout 45 npx ts-node src/test/server.test.ts 2>&1 | grep "Results:"
```

## Git Workflow
```bash
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git add -A
git commit -m "Session 35: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 35
- **`spell_actions.test.ts` now has 52** (was 50 — bless agent added 2 tests there)
- **`concentration_ai.test.ts` now has 34** (was 33 — bless agent added 1 test)
- **`wardingBond` resource NOT in pc_stat_blocks_lv1.json** — test combatants must be
  constructed manually with `resources: { wardingBond: { remaining: 1 } }` for planner tests
- **Merge workflow:** when concurrent agents produce conflicts, use `git stash` / `git stash pop`
  to reapply local work on top of remote, then resolve conflicts manually. The three files
  that commonly conflict are `core.ts` (type union), `combat.ts` (case block + import),
  `planner.ts` (planTurn spell checks + import). Always keep both agents' additions.
- **Phase 8-H** remains flagged for Sonnet — do not implement.
