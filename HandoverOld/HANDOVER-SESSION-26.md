# HANDOVER — Session 26 Start

## Prompt Instructions (carry forward every session)
- Break down large tasks, ask for input when needed
- Commit to GitHub after each meaningful chunk of work
- Stop and flag for Sonnet when a task is architecturally complex
- When fresh chat is optimal: commit, write this handover, stop
- Future handovers must be self-contained and seamless
- PAT: stored in your local git credential store — do not paste in files. User provides it verbally at session start.
- Scope: PHB 2014 / MM 2014 / SAC v2.7. No post-2024 content yet.
- Username: mcabel

## Current State
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `4bd52f0`)
- **Tests:** 1217 passing, 0 failed (21 suites)
- **Branch:** main (detached HEAD workflow — always push `HEAD:main`)

---

## What Was Done in Session 25

### Second Wind (Fighter) ✅ COMPLETE
- `core.ts`: `PlannedAction` gains `healAmount?: number`
- `resources.ts`: `secondWindPlan` sets `healAmount: roll` (HP applied inline by plan function, engine just logs)
- `combat.ts`: `case 'secondWind'` — emits `'action'` + `'heal'` log events
- `healing.test.ts`: 34 new tests

### Lay on Hands (Paladin) ✅ COMPLETE
- `resources.ts`: `layOnHandsPlan` sets `healAmount: amount`
- `combat.ts`: `case 'layOnHands'` — calls `applyHeal(target, plan.healAmount!)` (handles unconscious→conscious transition), emits `'action'` + `'heal'` log events
- If target is downed: also logs `condition_remove` for regained consciousness
- Covered in `healing.test.ts` (34 tests shared with Second Wind)

### Bardic Inspiration (Bard) ✅ COMPLETE
New field on `Combatant`:
```typescript
bardicInspirationDie: number | null;  // die size (e.g. 6 for d6), null = no die held
```
Initialized to `null` in `pc.ts`, `fivetools.ts`, and all 11 test `makeC` factories.

New helpers in `utils.ts`:
- `parseDieSides(die: string): number` — parses `'d6'` → 6, `'d8'` → 8, fallback 6
- `consumeBardicInspiration(c: Combatant): number` — rolls the die, clears field, returns 0 if null

`rollSave` in `utils.ts`: adds `consumeBardicInspiration(combatant)` to the total.

`combat.ts`:
- `resolveAttack`: after `rollAttack`, calls `consumeBardicInspiration(attacker)`, adds to `result.total`, logs `+N` event if > 0
- `case 'bardicInspiration'`: sets `biTarget.bardicInspirationDie = parseDieSides(actor.resources.bardicInspiration.die)`

`bardic_inspiration.test.ts`: 27 new tests

---

## NOT YET DONE — Next Session Priority

All 12 class stubs are now implemented or covered. The remaining `case` stubs are:
```
case 'hide':   — stub, no AI plans to use it yet
case 'ready':  — stub, no AI plans to use it yet
```
These have no AI planner support and aren't planned for Phase 1.

### Highest-priority remaining work:

**1. Wild Shape (Druid) — RECOMMENDED NEXT**
- The Druid class is partially stubbed. Wild Shape is the defining level 2 feature but at level 1 it isn't available (level 2+). For now Druids just cast spells. Check if there's any missing wire-up for Druid spellcasting at level 1.
- Actually the Druid's level 1 features are just spellcasting — check if `resources.spellSlots` is properly wired for Druids.

**2. Warding Bond (ST-5 deferred) — NOW UNBLOCKED**
- The resistance system (added Session 24) is the prerequisite.
- Warding Bond is a reaction-triggered damage share: when bonded creature takes damage, caster takes the same amount; also grants +1 AC and resistances to the bonded creature.
- Requires a buff tracking mechanism: a `wardingBond: { casterId: string } | null` field on the bonded Combatant, and a check in `resolveAttack` damage path.

**3. Phase 8-H: Day simulation / resource chaining**
- Flag for Sonnet — architecturally complex (multi-encounter sessions, short rest vs long rest resource recovery).

**4. Sneak Attack improvements**
- Currently checks `canSneakAttack` for a single ally within 5ft. Consider multiattack interactions.

**5. Multi-level PCs (FUTURE)**
- When user provides lv2–lv5 stat block JSON files.

---

## Key Architecture Notes

### bardicInspirationDie flow:
```
Bard's turn → case 'bardicInspiration'
  → biTarget.bardicInspirationDie = parseDieSides(actor.resources.bardicInspiration.die)

Ally's attack turn → resolveAttack
  → consumeBardicInspiration(attacker)  // returns roll 1-6, clears field
  → result.total += biBonus             // applied to attack roll
  → log 'Bardic Inspiration die (+N)' event

Ally's save → rollSave
  → consumeBardicInspiration(combatant) // same consumption pattern
  → total += biBonus
```

### healAmount flow:
```
PlannedAction.healAmount?: number
  → set by secondWindPlan (HP already applied inline)
  → set by layOnHandsPlan (HP applied by engine via applyHeal)

case 'secondWind': log 'action' + 'heal' (HP already set)
case 'layOnHands': applyHeal(target, plan.healAmount!) → log 'action' + 'heal'
```

### Current stub status (combat.ts > executePlannedAction):
| Case | Status |
|---|---|
| `'rage'` | ✅ Implemented (Session 24) |
| `'secondWind'` | ✅ Implemented (Session 25) |
| `'layOnHands'` | ✅ Implemented (Session 25) |
| `'bardicInspiration'` | ✅ Implemented (Session 25) |
| `'hide'` | ⬜ Stub — no AI planner yet |
| `'ready'` | ⬜ Stub — no AI planner yet |

---

## Test Baseline (1217 total, 0 failed)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| **bardic_inspiration.test.ts** | **27** |
| combat.test.ts | ~46–53 (loop variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| **healing.test.ts** | **34** |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 248 |
| phase4.test.ts | 54 |
| rage.test.ts | 40 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | 32 |
| summons.test.ts | 51 |
| **Total** | **1217** |

Note: `combat.test.ts` count varies (46–53) run-to-run because test 3 iterates over variable-length event arrays. All asserts pass — expected behaviour, not a regression.

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
git add -A
git commit -m "Session 26: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 26
- **All major class stubs are now implemented** for Phase 1 scope (Rage, Second Wind, Lay on Hands, Bardic Inspiration).
- Next meaningful work is either **Warding Bond** (now unblocked — resistance system exists) or a **quality-of-life sweep** (combat test 3 event loop variance cleanup, reviewing scenario tests for any edge cases).
- The `bardicInspirationDie` field needs to be added to any future `makeC` factory in new test files (pattern: `bardicInspirationDie: null`).
- `healAmount` on `PlannedAction` is reusable for any future healing actions (Goodberry, Healing Word, etc.).
