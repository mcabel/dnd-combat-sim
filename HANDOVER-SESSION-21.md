# HANDOVER — Session 21 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `bec8391`)
- **Tests:** 966 passing, 0 failed (15 suites)
- **Branch:** main (detached HEAD workflow — always push `<sha>:main`)

## What Was Done in Session 20 (this session)

### ST-1: Import fix — `livingAlliesOf` added to planner.ts ✅
### ST-2: Familiar Help Action system ✅
- `role`, `bonded`, `helpedThisTurn` added to Combatant type
- planTurn: familiar detects bonded caster adjacent + healthy → uses Help
- combat.ts: Help action sets `helpedThisTurn = true` on target
- Attack resolution: `helpedThisTurn` grants advantage
- 5 new tests in mount.test.ts

### ST-3: Mount mode tests ✅
- 5b: Independent mount combat test (3 larvas, mount-first initiative)
- 5c: Mode toggle test (controlled → independent → controlled)
- Root cause found: Giant Fly has 0 parsed actions (DMG bestiary coverage gap)
- Fix: improvised attack integrated into `selectAction` step 6 (adjacent fallback)

### Defender / Improvised Attack / No-Damage Rules ✅
New fields on Combatant:
- `isDefender: boolean` — only Dash/Dodge/Hide, never attacks
- `cannotAttack: boolean` — statblock-level restriction (Dodge fallback)
- `hasHands: boolean` — allows improvised weapon (1d4+STR, no prof) vs unarmed (1+STR, prof)

Engine rules implemented:
- **Auto-defeat:** team with 0 attack capability → loses at end of round
- **10-round no-damage:** team deals 0 damage for 10 consecutive rounds → auto-defeated
- Per-round damage tracked in `EngineState.damageThisRound` (Map<faction, number>)

Planner:
- `isDefender` → planTurn returns Dodge immediately
- `cannotAttack` → planTurn returns Dodge immediately
- `selectAction` step 6: if adjacent and hasHands → improvised weapon; else → unarmed

Parser:
- `hasHandsForType()` in fivetools.ts: humanoids, fiends, fey, giants, celestials → true
- Aberrations/monstrosities: scan action text for "tentacle"/"claw"/"arm"
- Undead: name-based heuristic (skeleton, zombie, vampire, etc.)

## NOT YET DONE — Next Session Priority

### SH-1: Shove/Grapple Mechanics (FLAGGED — use Sonnet if possible)
PHB p.195: Shove and Grapple as combat actions.
**Shove:** STR(Athletics) vs STR(Athletics)/DEX(Acrobatics) contested roll.
  - Success: target knocked prone OR pushed 5ft
  - Size rule: can't shove creatures more than 1 size larger
**Grapple:** STR(Athletics) vs STR(Athletics)/DEX(Acrobatics).
  - Success: target gains 'grappled' condition (speed = 0)
  - Escape: target uses action, makes same contested roll to break free
  - Size rule: can't grapple creatures more than 1 size larger
  - Drag: grappler can drag grappled creature (half speed)

Files to change:
- `src/types/core.ts`: add `size` field to Combatant (Tiny/Small/Medium/Large/Huge/Gargantuan)
- `src/engine/utils.ts`: `rollGrappleContest` and `rollShoveContest` already exist (check them)
- `src/engine/combat.ts`: handle 'shove'/'grapple' case in executePlannedAction
- `src/ai/actions.ts`: smart AI may choose shove/grapple for prone/control
- Tests: shove/grapple tests in mechanics.test.ts or new file

Note: `shouldGrapple()` and `rollGrappleContest()`/`rollShoveContest()` already exist in utils.ts.
Check if they're actually wired into combat or still stubs.

### SH-2: Comprehensive hasHands Parser
Current hasHands detection is a type-based heuristic (~90% coverage for CR 0–1).
A more robust approach scans all action text for hand/claw/arm/tentacle/appendage keywords
PLUS cross-references with creature size/type combinations.
Deferred — current heuristic is sufficient for now.

### ST-5: Damage Redirect (optional, low priority)
PHB p.198: rider can use reaction to redirect hit from mount to rider.
- `redirectDamageToMount: boolean` on Combatant
- resolveAttack() checks this flag
- Smart AI sets it if mount HP > rider HP
Not blocking anything.

### Phase 8: Web UI (future)
When user signals readiness. React frontend.

### Phase 8.2: Multi-level PCs
When user provides lv2–lv5 stat block JSON files.

## Key Architecture Notes

### Combatant fields added in Session 20:
```typescript
role: 'familiar' | 'mount' | 'companion' | 'regular';
bonded: string | null;
helpedThisTurn: boolean;
isDefender: boolean;
cannotAttack: boolean;
hasHands: boolean;
```

### EngineState fields added:
```typescript
damageThisRound: Map<string, number>;   // faction → damage this round
noDamageRounds: Map<string, number>;    // faction → consecutive 0-damage rounds
```

### Auto-defeat logic location:
`src/engine/combat.ts` — end-of-round block after all combatants have acted.
Two checks: (1) teamHasNoAttackCapability, (2) noDamageRounds >= 10.

### Improvised attack flow:
`selectAction()` (src/ai/actions.ts) step 6:
- adjacent AND hasHands → makeImprovisedWeapon (1d4+STR, no prof)
- adjacent AND !hasHands → makeImprovisedUnarmed (1+STR, +prof)
- not adjacent → Dash (step 7)

### Giant Fly (bestiary-dmg.json) has 0 parsed actions
This is the known bestiary coverage gap. Fly fights via improvised unarmed (no hands).
Warhorse (bestiary-mm-2014.json) has proper Hooves action (2d6+4 melee).
Both work correctly as independent mounts.

## Test Baseline (966 total)
| Suite | Count |
|-------|-------|
| ai.test.ts | 26 |
| combat.test.ts | 50 |
| concentration_ai.test.ts | 33 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| mechanics.test.ts | 44 |
| mount.test.ts | 43 |
| parser.test.ts | 101 |
| pc.test.ts | 248 |
| phase4.test.ts | 54 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| summons.test.ts | 51 |
| **Total** | **966** |

## Key Files
- `SPECIAL_INSTRUCTIONS.md` — design rules, architecture (READ FIRST)
- `task.md` — current phase status
- `src/types/core.ts` — Combatant interface (source of truth for fields)
- `src/engine/combat.ts` — main loop, auto-defeat, Help execution
- `src/engine/utils.ts` — helpers incl. canDealDamage, makeImprovised*, teamHasNoAttackCapability
- `src/ai/planner.ts` — planTurn, defender/cannotAttack gates, familiar Help
- `src/ai/actions.ts` — selectAction step 6 (improvised fallback)
- `src/parser/fivetools.ts` — hasHandsForType, monsterToCombatant
- `src/summons/mount.ts` — grantIndependence, controlMount, isControlledMount

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
git commit -m "Session 21: <description>"
git push origin <sha>:main
```
