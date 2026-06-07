# HANDOVER — Session 25 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `cefdf55`)
- **Tests:** 1157 passing, 0 failed (19 suites)
- **Branch:** main (detached HEAD workflow — always push `HEAD:main`)

---

## What Was Done in Session 24

### Flaky Test Fix ✅
- `combat.test.ts` test 2 ("Defender faction wins going first") was failing ~15% of the time due to RNG.
- Fixed by giving def2 a guaranteed-hit, guaranteed-kill weapon (hitBonus +20, min damage 11 vs 7 HP target).

### Resistance System ✅ COMPLETE
New field on `Combatant` (core.ts):
```typescript
resistances: DamageType[];  // halved incoming damage of listed types (PHB p.197)
```
Initialized to `[]` in `pc.ts` and `fivetools.ts` spawners, and all 9 test `makeC` factories.

New helpers in `utils.ts`:
- `addResistance(c, type)` — idempotent (no duplicates)
- `removeResistance(c, type)` — no-op if absent

`applyDamageWithTempHP(target, amount, damageType?)` updated:
- If `damageType` is in `target.resistances`: `effective = Math.floor(amount / 2)` before temp HP processing
- All 3 call sites in `combat.ts` now pass `action.damageType`

### Barbarian Rage ✅ COMPLETE
**`case 'rage'` in `combat.ts > executePlannedAction`:**
- Calls `addResistance(actor, 'bludgeoning' | 'piercing' | 'slashing')` — three calls
- Logs the rage activation

**+2 rage damage (PHB p.48):**
- In `resolveAttack`, after Sneak Attack block: if `attacker.resources?.rage?.active && action.attackType === 'melee'` → `dmg += 2`, logs "Rage bonus (+2 damage)"
- Does NOT apply to ranged, save-based, or auto-hit actions

**`tickRage` wiring:**
- `EngineState` gains `rageDamagedSinceLastTurn: Set<string>` — populated whenever `dealt > 0` at all 3 damage paths
- At START of each actor's turn: capture `damageTakenSinceLastTurn = state.rageDamagedSinceLastTurn.has(actor.id)`, then `delete` from set
- After `executeTurnPlan`: if `actor.resources?.rage?.active`, call `tickRage(actor, attackedThisTurn, damageTakenSinceLastTurn)`
- `attackedThisTurn = plan.action?.type === 'attack' || plan.bonusAction?.type === 'attack'`
- If rage was active and is now inactive: strip B/P/S resistances + log "Rage ends"

**New test suite: `src/test/rage.test.ts` — 40 tests:**
- addResistance/removeResistance helpers (8 tests)
- applyDamageWithTempHP halving (11 tests: floor, null, no-type, temp HP interaction)
- tickRage mechanics (5 tests: persists on attack, on damage, ends on neither, ends at round 0, no-op when inactive)
- Engine integration — party wins, rage used, rage in log (4 tests)
- Resistance integration — pre-activated barb takes half slashing (1 test)
- Rage +2 NOT on ranged attacks (1 test)
- Resistance stripped on rage end (4 tests)
- Non-B/P/S not halved (2 tests)

---

## NOT YET DONE — Next Session Priority

### Second Wind (Fighter) — RECOMMENDED NEXT
Stub at `case 'secondWind'` in `combat.ts`. The AI side (`shouldSecondWind`, `secondWindPlan`) is already written in `ai/resources.ts` — `secondWindPlan` heals `1d10 + level` HP directly on the combatant. The engine just needs to:
1. Log the heal event (the HP change happens inside `secondWindPlan`)
2. Possibly emit a `heal` event for the log (currently logged only as 'action')

This is small — maybe 5 lines + a few tests.

### Bardic Inspiration (Bard) — STUB NEXT
`case 'bardicInspiration'` — gives a d6 bonus die to an ally's next attack/save/ability check. Needs a buff system (or a lightweight `bonusNextRoll: number | null` field on Combatant). Could be deferred until buff system exists.

### ST-5 (remaining deferred):
- Warding Bond (spell) — needs resistances system (now done!) + buff tracking
- Warding Maneuver (Cavalier lvl 3) — mid-attack AC re-check
- Divine Allegiance / Aura of Guardian (Paladin lvl 7)

### Phase 8 Web UI:
- 8-H: Day simulation / resource chaining — flag for Sonnet (larger design change)

### Multi-level PCs (FUTURE):
- When user provides lv2–lv5 stat block JSON files

---

## Key Architecture Notes

### Resistance system integration points:
| Location | What it does |
|---|---|
| `core.ts > Combatant.resistances` | `DamageType[]` — source of truth |
| `utils.ts > applyDamageWithTempHP` | Checks `target.resistances`, halves before temp HP |
| `utils.ts > addResistance` | Idempotent push to array |
| `utils.ts > removeResistance` | Filter from array |
| `combat.ts > case 'rage'` | Calls addResistance × 3 |
| `combat.ts > tickRage hook` | Calls removeResistance × 3 on rage end |

### Rage damage flow:
```
resolveAttack (combat.ts ~line 245)
  └─ after Sneak Attack block
     └─ if rage.active && attackType === 'melee'
        └─ dmg += 2, log
```

### tickRage data flow:
```
START of actor's turn:
  damageTakenSinceLastTurn = state.rageDamagedSinceLastTurn.has(actor.id)
  state.rageDamagedSinceLastTurn.delete(actor.id)

DURING any resolveAttack (all 3 damage paths):
  if (dealt > 0) state.rageDamagedSinceLastTurn.add(target.id)

END of actor's turn (after executeTurnPlan):
  attackedThisTurn = plan.action?.type === 'attack' || plan.bonusAction?.type === 'attack'
  tickRage(actor, attackedThisTurn, damageTakenSinceLastTurn)
  if (rage just ended) → removeResistance(actor, 'bludgeoning'|'piercing'|'slashing')
```

---

## Test Baseline (1157 total, 0 failed)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| combat.test.ts | ~47–53 (loop variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 248 |
| phase4.test.ts | 54 |
| **rage.test.ts** | **40** |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | 32 |
| summons.test.ts | 51 |
| **Total** | **1157** |

Note: `combat.test.ts` count varies (43–53) run-to-run because test 3 iterates over variable-length event arrays. All asserts pass — this is expected, not a regression.

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
git commit -m "Session 25: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 25
- **Most impactful next step:** Second Wind (Fighter) — the AI (`secondWindPlan`) already applies the HP heal. Engine just needs to emit a `heal` log event and break the action out of the stub group.
- After Second Wind: consider Lay on Hands (Paladin) — similar pattern.
- Bardic Inspiration needs a lightweight buff system first (defer until buff discussion).
- Warding Bond (ST-5 deferred) now has its prerequisite done: the resistance system exists. It needs a buff tracking mechanism (a source-tagged resistance that can be removed when the spell ends).
