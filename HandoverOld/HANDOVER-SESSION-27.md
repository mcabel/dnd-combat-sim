# HANDOVER — Session 28 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `99d3fb2`)
- **Tests:** 1252 passing, 0 failed (22 suites)
- **Branch:** main (detached HEAD workflow — always push `HEAD:main`)

---

## What Was Done in Session 27

### Druid test section added to pc.test.ts ✅
Section 11 — 18 new tests verifying:
- HP=9, AC=16 (Leather+Shield), Speed=35 (Wood Elf Fleet of Foot), WIS=16
- `Quarterstaff (Shillelagh)` action: +5 to hit, 1d8, melee
- `Thorn Whip` action: +5 to hit, 1d6
- `spellSlots[1] = {max:2, remaining:2}` — no 2nd-level slots
- `bardicInspirationDie: null`, `resistances: []`

This closes the "check Druid spellcasting at Level 1" item from Session 26 handover.
Druid's Level 1 features are purely spellcasting — handled by the generic `buildResources` path.
Wild Shape is Level 2+ and not in scope for Phase 1.

### Warding Bond (PHB p.287) ✅ COMPLETE
Implemented as infrastructure for multi-level PCs. Not reachable at Level 1 by any class,
but the machinery is fully in place and tested.

#### New field on `Combatant` (core.ts):
```typescript
wardingBond: { casterId: string } | null;
// null = no bond active
// set by (future) AI planner for Cleric/Paladin who cast Warding Bond
```
Initialized to `null` in `pc.ts`, `fivetools.ts`, and all 12 test factories.

#### `applyDamageWithTempHP` (utils.ts):
```typescript
const hasResistance =
  target.wardingBond !== null ||
  (damageType != null && (target.resistances?.includes(damageType) ?? false));
if (hasResistance) effective = Math.floor(amount / 2);
```
WB grants resistance to ALL damage types (including typeless null). Single halving only —
no double-halving if specific resistance also present.

#### `rollSave` (utils.ts):
```typescript
const wbBonus = combatant.wardingBond ? 1 : 0;
const total = roll + mod + prof + biBonus + wbBonus;
```

#### `resolveAttack` (combat.ts):
```typescript
const effectiveAC = target.ac + (target.wardingBond ? 1 : 0);
const hits = isCritOverride ?? attackHits(result.roll, result.total, effectiveAC);
```
Miss and hit log messages now show `effectiveAC`.

#### `applyWardingBondRedirect` (combat.ts — private helper):
Called after every `applyDamageWithTempHP` on a bonded target (3 call sites: save-based,
auto-hit, standard attack hit). Caster takes `dealt` amount (null type, no WB resistance
on redirect). Bond breaks if caster is dead/unconscious after redirect.

#### `checkDeath` (combat.ts):
Added scan: when any combatant hits 0 HP, clears `wardingBond` on any creature bonded
to them. Prevents stale-bond resistance on subsequent turns after caster death.

#### `warding_bond.test.ts` — 21 new tests:
- Resistance halving: fire, slashing, cold, typeless (null), no-bond control, WB+resistance stacking
- rollSave +1: WIS 10 (mod 0), WIS 10 (no bond control), WIS 14 (mod +2 stacks)
- Redirect integration (runCombat): bonded HP > 90 after 10-dmg hit, caster HP < 100, bonded HP === caster HP
- Bond break: caster dies from redirect → wardingBond null, condition_remove event logged
- PC init: Cleric/Paladin/Wizard all have wardingBond: null on spawn

---

## NOT YET DONE — Next Session Priority

### 1. AI Planner support for Warding Bond (DEFERRED — Level 2+)
The mechanical infrastructure is complete. What's missing:
- A `case 'wardingBond'` in `executePlannedAction` (combat.ts)
- A planner function in `ai/resources.ts` that decides when to cast it
- `resources.wardingBond: { remaining, target }` tracking so the bond persists across rounds
- This is only relevant when multi-level PCs are introduced (Paladin 3+, Cleric 3+)

### 2. Sneak Attack improvements (HIGHEST PRIORITY for immediate Level 1 quality)
Currently: `canSneakAttack` checks for an ally within 5ft but is basic.
Consider:
- Rogue position awareness: AI should try to move adjacent to an ally before attacking
- Currently the AI attacks nearest, regardless of sneak attack positioning
- Files: `src/ai/planner.ts`, `src/ai/targeting.ts`

### 3. Phase 8-H: Day simulation / resource chaining
Flag for Sonnet — architecturally complex (multi-encounter sessions, short rest vs long rest
resource recovery).

### 4. Multi-level PCs (FUTURE)
When user provides lv2–lv5 stat block JSON files.

---

## Key Architecture Notes

### wardingBond flow (future, when AI planner is wired):
```
Cleric/Paladin turn → case 'wardingBond'
  → ally.wardingBond = { casterId: actor.id }
  → ally gains +1 AC (effectiveAC), +1 saves (rollSave wbBonus)
  → ally has resistance to all damage types (applyDamageWithTempHP)

Enemy attacks ally →
  → applyDamageWithTempHP(ally, raw, type) → halved
  → applyWardingBondRedirect(ally, dealt, state)
    → caster = bf.combatants.get(ally.wardingBond.casterId)
    → applyDamageWithTempHP(caster, dealt, null) → log 'damage'
    → checkDeath(caster) → if dead: ally.wardingBond = null
    → log 'condition_remove' if bond broke

Caster drops to 0 HP (via any source) →
  → checkDeath scans all combatants → clears wardingBond where casterId === caster.id
```

### Current stub status (combat.ts > executePlannedAction):
| Case | Status |
|---|---|
| `'rage'` | ✅ Session 24 |
| `'secondWind'` | ✅ Session 25 |
| `'layOnHands'` | ✅ Session 25 |
| `'bardicInspiration'` | ✅ Session 25 |
| `'wardingBond'` | ⬜ Stub needed — AI planner deferred (Level 2+) |
| `'hide'` | ⬜ Stub — no AI planner yet |
| `'ready'` | ⬜ Stub — no AI planner yet |

---

## Test Baseline (1252 total, 0 failed)
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
| server.test.ts | 32 |
| summons.test.ts | 51 |
| **warding_bond.test.ts** | **21** |
| **Total** | **1252** |

Note: `combat.test.ts` count varies run-to-run (42–53) due to variable-length event arrays in test 3. All asserts pass — expected, not a regression.

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
git commit -m "Session 28: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 28
- **Warding Bond machinery is complete** — AI planner wire-up is the only remaining piece,
  and that's deferred until multi-level PCs are supported (Level 3+).
- **The `bardicInspirationDie` + `wardingBond` initialization pattern** is now the standard
  for any new fields added to Combatant: update `pc.ts`, `fivetools.ts`, and all 12 test
  factories (use `sed -i` grep approach from Session 27).
- **Sneak Attack positioning** is the most impactful Level 1 quality improvement remaining.
  Start there next session unless user has a different priority.
- Server test can be slow — run last and with `timeout 45` if needed.
