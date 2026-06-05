# HANDOVER — Session 22 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `a6a6bdc`)
- **Tests:** 1021 passing, 0 failed (15 suites)
- **Branch:** main (detached HEAD workflow — always push `<sha>:main`)

## What Was Done in Session 21

### SH-1: Grapple / Shove / Escape Mechanics ✅ COMPLETE
Fully implemented PHB p.195 rules:

**Types & Parser:**
- `CreatureSize` type: Tiny/Small/Medium/Large/Huge/Gargantuan
- Optional `size?: CreatureSize` on Combatant (defaults to Medium in size-check helpers)
- `grappledBy?: string` tracks who grappled the creature
- `'escapeGrapple'` added to PlannedAction union

**Size Enforcement:**
- `parseSizeCode()` in fivetools.ts reads 5etools JSON `["M"]` → 'Medium'
- `sizeRank()` gives numeric rank (Tiny=0 … Gargantuan=5)
- `canGrappleOrShoveTarget(attacker, target)` enforces "no more than 1 size larger" rule
- Size checks in both AI planning (actions.ts) and combat resolution (combat.ts)

**Combat Resolution (combat.ts):**
- `case 'grapple'`: size check → contest roll → add 'grappled' condition + set grappledBy
- `case 'shove'`: size check → contest roll → add 'prone' condition
- `case 'escapeGrapple'`: NEW — grappled creature uses action to attempt escape
  - Contested STR(Athletics) vs STR(Athletics)
  - On success: remove 'grappled' + clear grappledBy
  - If grappler is dead/unconscious: auto-free

**Grapple Auto-Release:**
- When grappler goes down (HP ≤ 0): all grappled creatures released, grappledBy cleared
- All creatures grappled BY that target are released

**AI Planning (planner.ts):**
- Grappled creatures prioritise escapeGrapple after condition gate
- **Smart AI:** always escape
- **Nearest/Weakest AI:** escape only if no melee target in reach (speed=0 from grapple)
- targetId for escapeGrapple = grappledBy ID

**Tests (mechanics.test.ts):**
- Size rank ascending order
- Size enforcement (Medium can grapple Large, not Huge)
- Grapple success odds (STR 30 vs STR 8)
- Grapple condition applied
- Escape planning (smart AI, nearest AI, auto-release when grappler gone)
- Total: 13 new tests, all passing

---

## NOT YET DONE — Next Session Priority

### SH-2: Comprehensive hasHands Parser (OPTIONAL / DEFERRED)
Current heuristic (~90% coverage for CR 0–1) is sufficient. Future: scan all action text for hand/tentacle/claw/arm/appendage keywords + cross-reference creature size/type.
Not blocking.

### ST-5: Damage Redirect (OPTIONAL / LOW PRIORITY)
PHB p.198: Rider can use reaction to redirect hit from mount → rider.
- `redirectDamageToMount: boolean` on Combatant
- resolveAttack() checks this flag
- Smart AI sets it if mount HP > rider HP
Not blocking anything.

### Phase 8: Web UI (FUTURE)
When user signals readiness. React frontend for party configuration, trial simulation, output visualization.

### Phase 8.2: Multi-level PCs (FUTURE)
When user provides lv2–lv5 stat block JSON files.

---

## Key Architecture Notes (Session 21)

### New Combatant fields:
```typescript
size?: CreatureSize;        // PHB p.6 — Tiny/Small/Medium/Large/Huge/Gargantuan
grappledBy?: string;        // ID of creature grappling this one; cleared on condition removal
```

### New ActionType:
```typescript
'escapeGrapple'             // Grappled creature uses action to contest break free
```

### Combat flow (executePlannedAction):
```
case 'grapple':
  → canGrappleOrShoveTarget check
  → rollGrappleContest
  → add 'grappled' + set grappledBy
  
case 'shove':
  → canGrappleOrShoveTarget check
  → rollShoveContest
  → add 'prone'

case 'escapeGrapple':
  → check grappledBy still valid
  → rollGrappleContest (escaper vs grappler)
  → remove 'grappled' + clear grappledBy on success

On target death (HP ≤ 0):
  → release all creatures grappled BY target
  → clear their grappledBy
```

### planner.ts escape gate (after CANNOT ATTACK gate):
```typescript
if (self.conditions.has('grappled') && self.grappledBy) {
  // smart: always escape
  // nearest/weakest: escape if no melee target reachable (speed=0)
  return escapeGrapple plan
}
```

### Parser (fivetools.ts):
- Raw5etoolsMonster now includes `size?: string | string[]`
- monsterToCombatant calls `parseSizeCode(raw.size)` → CreatureSize

---

## Test Baseline (1021 total, 0 failed)
| Suite | Count |
|-------|-------|
| ai.test.ts | 26 |
| combat.test.ts | ~49–52* |
| concentration_ai.test.ts | 33 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 |
| parser.test.ts | 101 |
| pc.test.ts | 248 |
| phase4.test.ts | 54 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| summons.test.ts | 51 |
| **Total** | **~1021** |

*combat.test.ts count varies (48–53) due to pre-existing probabilistic conditional tests (e.g., "kills in ≤ 8 rounds" only asserts if combat outcome matches condition). Always 0 failed.

---

## Key Files
- `SPECIAL_INSTRUCTIONS.md` — design rules, architecture (READ FIRST)
- `task.md` — current phase status
- `src/types/core.ts` — Combatant interface + CreatureSize type
- `src/engine/combat.ts` — grapple/shove/escapeGrapple cases + auto-release on death
- `src/engine/utils.ts` — sizeRank(), canGrappleOrShoveTarget(), rollGrapple/ShoveContest
- `src/ai/planner.ts` — escapeGrapple gate after cannotAttack
- `src/ai/actions.ts` — size checks in grapple/shove planning (sections 1.5, 1.6)
- `src/parser/fivetools.ts` — parseSizeCode(), Raw5etoolsMonster.size field
- `src/test/mechanics.test.ts` — 13 new SH-1 tests

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  npx ts-node "$f" 2>&1 | grep "Results:"
done
```

## Git Workflow
```bash
# After making changes:
git add -A
git commit -m "Session 22: <description>"
git push origin <sha>:main
```

## Notes for Next Session
- **SH-2 and ST-5 are optional.** Current system is complete and tested.
- If focusing on Phase 8 (Web UI), recommend switching to **Claude Sonnet** (full architecture design for React).
- If doing SH-2 or ST-5 (incremental mechanical changes), **Haiku 4.5** is sufficient.
- All 1021 tests passing; system is stable.
