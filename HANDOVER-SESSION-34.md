# HANDOVER — Session 34 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `4d5cc62`)
- **Tests:** ~1,496 passing, 0 failed (29 suites incl. new faerie_fire.test.ts)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done This Session

### Faerie Fire spell module ✅ COMPLETE (commit `4d5cc62`)

**PHB p.239:** 1st-level evocation, concentration (up to 1 min), range 60 ft, AoE 20-ft cube.
DEX save or outlined (all attacks vs outlined creatures have advantage).

#### Files created
**`src/spells/faerie_fire.ts`** — First spell module. Exports:
- `shouldCast(caster, bf): Combatant[] | null` — returns living enemy targets within 60ft,
  or null when: already concentrating / no Faerie Fire action / no slots / no enemies
- `execute(caster, targets, state)` — consumes slot, starts concentration, rolls DEX save
  per target, calls `applySpellEffect` with `advantage_vs:attack` on fail; logs all events
- `metadata` — spell stats (level, range, school, concentration, saveAbility)
- Local `emit()` helper pushes to `state.log.events` (avoids circular import from combat.ts's
  private `log` function)

**`src/test/faerie_fire.test.ts`** — 30 tests across 3 sections:
- Section 1 (7): shouldCast gates — range, concentration, slots, no spell, skips dead/ally
- Section 2 (8+): execute pipeline — slot consumed, concentration starts, save events,
  activeEffect applied, advantage registered, concentration-break cleanup
- Section 3 (5): planner + engine — planTurn picks faerieFire, no re-cast when concentrating,
  no cast when slots exhausted, runCombat fires Faerie Fire events

#### Files modified
**`src/types/core.ts`** — Added `'faerieFire'` to `PlannedAction` type union.

**`src/ai/planner.ts`** — Added `import { shouldCast as shouldCastFaerieFire }` from
`'../spells/faerie_fire'` and a new planner check before `selectAction`:
- Fires when: not already concentrating AND shouldCastFaerieFire returns targets
- Returns early with `{ type: 'faerieFire', targetId: targets[0].id, ... }`
- Same early-return pattern as the Cure Wounds check

**`src/engine/combat.ts`** — Added `import { shouldCast, execute }` from `'../spells/faerie_fire'`
and a new `case 'faerieFire'` in `executePlannedAction`:
- Re-runs `shouldCastFaerieFire(actor, bf)` to get live targets (handles edge case where a
  target died between planning and execution)
- Calls `executeFaerieFire(actor, targets, state)`

---

## NOT YET DONE — Priorities for Session 34

### 1. Warding Bond AI (MEDIUM)
From sessions 31–33 handovers, still pending. `warding_bond.test.ts` has 21 tests (existing).
Needs:
- `case 'wardingBond'` in `executePlannedAction` (combat.ts)
- Planner function: `shouldCastWardingBond(self, bf): Combatant | null` in `ai/resources.ts`
- `planWardingBond` plan builder in resources.ts  
- Wire in `planBonusAction` or `planTurn` in planner.ts
- `resources.wardingBond: { remaining, target }` cross-round tracking (check if already in
  the `PlayerResources` interface — `warding_bond.test.ts` already tests some of this)

**Before starting:** Read existing `warding_bond.test.ts` and `src/engine/warding_bond.ts`
(if it exists) to understand what's already implemented.

### 2. Phase 8-H: Day simulation (FLAG FOR SONNET)
Architecturally complex — stop and flag, don't implement.

### 3. Bless spell module (EASY-MEDIUM, follows same pattern as Faerie Fire)
PHB p.219: 1st-level, concentration. Up to 3 creatures add 1d4 to attack rolls AND saving
throws. Uses `bless_die` effect type (already defined in `SpellEffectType` + spell_effects.ts).
Would be the second spell module using the `src/spells/<name>.ts` pattern.

---

## Architecture: Spell Module Pattern

All new spells follow `src/spells/<name>.ts`:
```typescript
export const metadata = { name, level, school, rangeFt, concentration, ... };
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null { ... }
export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void { ... }
```
- Local `emit()` helper pushes to `state.log.events` (EngineState is exported from combat.ts)
- No circular imports: spell modules import from engine but combat.ts imports spell modules
- Planner imports `shouldCast` aliased as `shouldCastXxx`; combat.ts imports both
- Re-run `shouldCast` in the `case 'xxx'` handler to pick up live targets

## Faerie Fire: Known Simplifications
- **AoE simplified:** targets ALL living enemies within 60ft range, not just those in a
  specific 20-ft cube. The AI "aims" at the densest cluster by targeting everyone in range.
  True cube targeting can be added later once a positional AoE system exists.
- **AI conservatism:** `shouldCast` returns null if ANY concentration is active. The Druid
  won't switch from Entangle to Faerie Fire mid-fight. Intended behavior.

---

## Test Baseline (Session 34 start, ~1496 total)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| combat.test.ts | 43–51 (variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| cunning_action.test.ts | 53 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| **faerie_fire.test.ts** | **30 (new)** |
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
| spell_actions.test.ts | 50 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| warding_bond.test.ts | 21 |

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
git commit -m "Session 34: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```
