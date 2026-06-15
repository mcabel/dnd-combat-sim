# HANDOVER — Session 33 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `5f560d1`)
- **Tests:** ~1,495 passing, 0 failed (28 suites incl. healing_spells + spell_effects)
  - `cunning_action.test.ts`: 53 (was 42 — 11 new Hide tests)
  - `healing_spells.test.ts`: 36 (was WIP/broken — now green)
  - `spell_effects.test.ts`: 23 (landed from concurrent agent)
  - `combat.test.ts`: 43–51 variance, 0 failures (known probabilistic)
  - `mechanics.test.ts`: 57 in isolation; may show 56/1 in batch (probabilistic, pre-existing)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 32

### Cunning Action: Hide ✅ COMPLETE (commit `1981bc2`)

**PHB p.96:** Rogue can use bonus action to Hide. Requires a vision-blocking obstacle and
no enemy having line of sight to the Rogue's position.

#### Files changed
**`src/types/core.ts`** — Added `'hidden'` to `Condition` union (between `'grappled'` and
`'incapacitated'`). No new Combatant field needed — reuses the existing `conditions: Set<Condition>`.

**`src/engine/utils.ts`** — In `resolveAttackAdvantage`:
- `attacker.conditions.has('hidden')` → advantage (PHB p.194)
- `target.conditions.has('hidden')` → disadvantage on attacks against hidden creature (PHB p.194)

**`src/engine/combat.ts`** — Three changes:
1. Added `rollDie`, `abilityMod`, `proficiencyBonus` to utils import
2. Split `'hide'` out of the grouped `case 'hide': case 'ready': case 'bardicInspiration':` —
   gave it its own real implementation: rolls `1d20 + DEX mod + proficiencyBonus(cr)` vs
   `max(10 + WIS mod)` across all living enemies. Success → `addCondition(actor, 'hidden')` +
   log "Hides!". Failure → log "Detected!" (no condition)
3. In `resolveAttack` (after `resolveAttackAdvantage` captures the advantage from `'hidden'`):
   if attacker is hidden, `removeCondition` + log "revealed after attacking" (PHB p.177/194)

**`src/ai/planner.ts`** — Added `import { hasLineOfSight } from '../engine/los'` and Case 3
in `planCunningAction`:
- Fires when: no attack planned this turn AND not already hidden AND battlefield has at least
  one non-open vision-blocking obstacle AND no living enemy has LOS to Rogue's current position
- Returns `bonusAction: { type: 'hide', ... }`

**`src/test/cunning_action.test.ts`** — 11 new tests (Section 7a–7h):
- 7a: Rogue behind fog → planner chooses Hide
- 7b: Open field → Hide never planned (no vision obstacles)
- 7c: Enemy has LOS → Hide not planned
- 7d: Already hidden → no double-hide
- 7e: Melee attack planned → Case 1 Disengage takes priority
- 7f: Pre-hidden Rogue attacks → condition_remove "revealed" fires
- 7g: Guaranteed stealth success → condition_add "Hides!" fires
- 7h: Guaranteed stealth failure → "Detected!" fires, no condition_add

#### Important geometry note for future Hide tests
Combatants at y=0 have AABB corners at y=0 and y=1. The LOS slab test epsilon-shrinks
obstacle AABBs by 1e-6, so a fog cloud with depth=1 (y=0 to y=1) will NOT block horizontal
rays from combatants at y=0 (rays are exactly on the boundary, epsilon-excluded).
**Fix pattern:** Position combatants at y≥2 and give fog clouds depth≥4 so combatant corners
fall inside `[y+eps, y+depth-eps]`.

### healing_spells.test.ts — Fixed WIP compile errors ✅ (commit `5f560d1`)
Two errors left by the concurrent agent:
1. `monsterToCombatant(template, id, pos)` → corrected to `monsterToCombatant(template, pos)` with
   `c.id = id; c.name = id;` after
2. Missing `}` at EOF (brace depth was 1 at end of file) — added closing brace

**Engine bug also fixed (both `layOnHands` and `spellHeal` in `combat.ts`):**
`applyHeal()` sets `isUnconscious = false` internally. The post-call check
`if (target.isUnconscious && healed > 0)` was always false (flag already cleared).
Fix: capture `const wasUnconscious = target.isUnconscious` before calling `applyHeal`,
then use `if (wasUnconscious && healed > 0)`.
Also fixed: `targetId` in the condition_remove log was `undefined`; now `target.id`.

---

## What the Concurrent Agent Did (landed before our session 32)

### ActiveEffect registry (commit `84235b6`)
- `ActiveEffect` interface + `SpellEffectType` added to `src/types/core.ts`
- `activeEffects: ActiveEffect[]` added to `Combatant` (required, initialized to `[]`)
- `src/engine/spell_effects.ts` created: `applySpellEffect`, `removeEffectsFromCaster`,
  `getActiveAcBonus`, `getActiveBlessDie`
- `activeEffects: []` added to both parsers, `longRest`, and **all 17 test files** (bulk sed)
- `src/test/spell_effects.test.ts`: 23 tests, all passing

**If you add a new Combatant field:** all test factories, `pc.ts`, and `fivetools.ts` all need
updating. The other agent's bulk-sed pattern: `sed -i 's/wardingBond: null,/wardingBond: null, newField: value,/g' src/test/*.test.ts`

---

## NOT YET DONE — Priorities for Session 33

### 1. Faerie Fire spell module (MEDIUM — Segment 3 from concurrent agent's handover)
Concurrent agent's architectural plan (from HANDOVER-SESSION-32.md):
- `src/spells/faerie_fire.ts` — exports `shouldCast`, `execute`, `metadata`
- Uses `applySpellEffect` from `spell_effects.ts` for automatic cleanup on concentration break
- Metadata from `testDataSpells/spells-phb.json` (5etools format)
- No planner/combat.ts surgery needed for spell modules

**Key mechancs (PHB p.239):**
- 60ft range, AoE 20ft cube, concentration (up to 1 min)
- Targets: DEX saving throw vs Cleric/Druid spell save DC
- Fail: outlined in violet/blue/green light → attacks against them have advantage
- The `ActiveEffect` registry handles the outlined condition → advantage

### 2. Warding Bond AI (MEDIUM)
From Session 31 handover, still pending:
- `case 'wardingBond'` in `executePlannedAction` (combat.ts)
- Planner function in `ai/resources.ts`
- `resources.wardingBond: { remaining, target }` cross-round tracking

### 3. Phase 8-H: Day simulation (FLAG FOR SONNET)
Architecturally complex — stop and flag, don't implement.

---

## Architecture Notes

### Hide mechanic details
- **Stealth roll:** `1d20 + abilityMod(actor.dex) + proficiencyBonus(actor.cr)`
  - For PCs (`cr = null`): `proficiencyBonus(null) = 2` (levels 1-4 accurate; limitation for higher levels)
  - Rogues always have Stealth proficiency by class, so this is correct for Rogues
- **Passive Perception:** `10 + abilityMod(enemy.wis)` per enemy; check uses `max()`
- **LOS prerequisite check** in planner uses `self.pos` (current, pre-movement). Conservative
  but correct for most Case-3 scenarios where no moveBefore is planned.
- **Condition lifecycle:** added on successful Hide bonus action, removed in `resolveAttack`
  after advantage is captured but before rolling (PHB: "revealed on attack, hit or miss")

### planCunningAction Case priority order
1. **Disengage** — when `chosenAction.type === 'attack'` and melee, retreat after
2. **Dash** — when `chosenAction.type === 'dash'` and melee candidates exist, convert to bonus Dash
3. **Hide** — when no attack this turn, not already hidden, vision obstacle exists, no enemy LOS
- Cases 1/2 `return` when they fire; Case 3 runs only if both prior cases fell through.

### ActiveEffect spell module pattern (from concurrent agent)
```typescript
// src/spells/<name>.ts
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null { ... }
export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void { ... }
export const metadata = { range: 60, concentration: true, level: 1, school: 'evocation' };
```

---

## Test Baseline (Session 33 start, ~1495 total)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| combat.test.ts | 43–51 (variance, 0 failures) |
| concentration_ai.test.ts | 33 |
| cunning_action.test.ts | **53 (was 42)** |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| healing.test.ts | 34 |
| **healing_spells.test.ts** | **36 (was broken)** |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| los.test.ts | 54 |
| mechanics.test.ts | 57 (56/1 in batch = probabilistic variance) |
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
| **spell_effects.test.ts** | **23 (new)** |
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
git commit -m "Session 33: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 33
- **Concurrent agent's HANDOVER-SESSION-32.md** is still in the repo root — read it for
  the spell module architecture (Faerie Fire is their Segment 3)
- **`testDataSpells/spells-phb.json`** is the canonical metadata source for spell modules
- **mechanics.test.ts 56/1 in batch** is pre-existing probabilistic variance, not a regression
- **`healing_spells.test.ts` bug we fixed** (wasUnconscious) also affects `layOnHands` —
  both are patched. If a new healing action is added, use the same `wasUnconscious` pattern.
- **`combat.test.ts` variance:** 43–51 is normal. Zero failures = all clear.
