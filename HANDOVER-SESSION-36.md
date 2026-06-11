# HANDOVER — Session 36 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `13b2354`)
- **Tests:** ~1,611 passing, 0 failed (31 suites — new `day.test.ts` adds 54)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done in Session 35

### Phase 8-H: Day Simulation ✅ COMPLETE (commit `13b2354`)

Implemented a full adventuring day loop that orchestrates multiple combat encounters
with short rests in between, tracking resource attrition across fights.

#### Files created
**`src/scenarios/day.ts`** — Main day simulation module. Exports:
- `runDay(spec: DaySpec): DayResult` — run an ordered series of encounter waves.
  Party members are mutated in-place (HP/slots persist across fights). Enemies reset fresh.
  Short rest AI: triggers when avg party HP < `shortRestThreshold` (default 60%) OR a
  short-rest resource (pact slots, second wind) was depleted. Caps at `maxShortRests`.
  Unconscious-but-stable PCs regain 1 HP and wake on a short rest (PHB p.197).
- `applyLongRest(party: Combatant[]): void` — apply long rest to all members; also
  clears isDead/isUnconscious/deathSaves for PCs (resurrection via rest, not combat).
- Helper types: `DaySpec`, `EncounterWave`, `DayResult`, `EncounterOutcome`, `PartyMemberSnapshot`.
- Local `resetBetweenEncounters(c)` — clears conditions, concentration, active effects,
  rage-resistances, temp HP, advantages/vulnerabilities, and ActionBudget between fights.
  Preserves currentHP, spell slots, class resources (the attrition data).
- Local `shouldTakeShortRest(...)` — rest decision AI used after each party victory.

**`src/test/day.test.ts`** — 54 new tests (15 sections):
- Section 1 (10 tests): Parser assigns correct `hitDice.dieSides` per class
- Section 2 (8 tests): `spendHitDiceOnRest` mechanics (spending, full HP, empty pool, dead)
- Section 3 (3 tests): `longRest` hit dice recovery (PHB p.186: ceil(max/2))
- Section 4 (2 tests): `resetCombatant` restores hit dice to max
- Sections 5–15 (31 tests): `runDay` integration — single wave, resource attrition,
  rest trigger, rest cap, no-rest mode, stable revival, multi-wave completion,
  applyLongRest, error handling, snapshot accuracy, Warlock pact slot recovery

#### Files modified
**`src/types/core.ts`** — Added to `PlayerResources`:
```typescript
hitDice?: { max: number; remaining: number; dieSides: number };
// max = character level; dieSides = class hit die (d12/d10/d8/d6).
// Optional — absent for monsters and legacy test combatants (backward-compatible).
```

**`src/engine/utils.ts`** — Added `spendHitDiceOnRest()`, updated `shortRest()` docstring
(spending is caller's decision, not automatic), updated `longRest()` to recover
`ceil(max/2)` hit dice (PHB p.186):
```typescript
export function spendHitDiceOnRest(c: Combatant, targetFraction = 0.75): number
// Spends hit dice until currentHP >= targetFraction*maxHP or pool empty.
// Returns number of hit dice spent.
```

**`src/parser/pc.ts`** — `buildResources()` now always sets `hitDice` from class:
```
Barbarian→d12, Fighter/Paladin/Ranger→d10, Sorcerer/Wizard→d6, all others→d8
```

**`src/scenarios/encounter.ts`** — `resetResources()` includes hit dice:
```typescript
if (r.hitDice) out.hitDice = { ...r.hitDice, remaining: r.hitDice.max };
```

**`src/test/resources.test.ts`** — Updated Monk assertion: Monk now correctly has
`hitDice` (but no class-specific resources). Test updated from "null resources" to
"hitDice only, no class resources".

#### Architecture decisions
- **`hitDice` optional field** → all existing test factories work unchanged (no
  `sed` bulk update required). Only PC-spawned combatants get hit dice.
- **Party mutated in-place** → attrition is genuine. `resetCombatant()` is only
  used on enemies (fresh each wave), never on the party between encounters.
- **`resetBetweenEncounters()`** vs `resetCombatant()` distinction is crucial:
  the former clears transient combat state without touching resources/HP.
- **Rage deactivation**: if rage was still active when combat ended (possible if
  all enemies died before the Barbarian's next turn), `resetBetweenEncounters`
  deactivates it and strips B/P/S resistances explicitly.
- **Short rest / hit dice separation**: `shortRest()` recovers class resources
  (pact slots, second wind). Hit dice spending is separate (`spendHitDiceOnRest()`)
  because it's an AI/caller decision how many to spend. The day loop calls both.

---

## NOT YET DONE — Priorities for Session 36

### 1. Shield of Faith spell module (EASY — follow Bless/Faerie Fire pattern)
PHB p.275: 1st-level, concentration, bonus action, range 60 ft.
Effect: +2 AC bonus to target for duration.
- `src/spells/shield_of_faith.ts` — `shouldCast` targets lowest-AC ally in range;
  `execute` applies `SpellEffectType: 'ac_bonus'` via `applySpellEffect()`.
- `ac_bonus` already exists in `SpellEffectType` in `core.ts` (see `ActiveEffect.payload.acBonus`).
  Check `getActiveAcBonus()` in `spell_effects.ts` — it already reads `ac_bonus` effects.
- Planner: bonus action, goes after Bless in priority.
- `case 'shieldOfFaith'` in `combat.ts`.
- New `PlannedAction.type` union entry: `'shieldOfFaith'`.

### 2. Hunter's Mark (MEDIUM — Ranger, concentration, bonus action)
PHB p.251: 1st-level, concentration, bonus action to cast, move mark as bonus action on kill.
+1d6 bonus damage vs marked target. Attaches to one target; persists through kills.
Would need: `'marked'` condition (or an activeEffect), `huntersMark` resource tracking,
planner wiring, damage bonus in `resolveAttack`.

### 3. Divine Smite (MEDIUM — Paladin, triggered on hit)
PHB p.85: After a successful hit — spend a spell slot to add 2d8 (+1d8/slot above 1st)
radiant damage. Triggered inside `resolveAttack`. AI already decides in `resources.ts`
(`shouldSmite` / `applyDivineSmite` are implemented). Just needs wiring into `resolveAttack`
in `combat.ts` (already partially stubbed? — check).

### 4. Phase 8-H extensions (FUTURE)
- Multi-day simulation (`runMultipleDays()`)
- Random encounter table for waves (instead of fixed wave list)
- Day attrition analysis / reporting (slot depletion over waves, HP trend)
- Web API endpoint for day simulation (`/api/day` POST route)

---

## Architecture Notes

### Day simulation patterns
- `runDay(spec)` is the canonical entry point. Enemies always get `resetCombatant()`.
  Party members NEVER get `resetCombatant()` during the day — they keep attrition.
- After each wave: `resetBetweenEncounters(c)` on party, then fight, then optional rest.
- To simulate N days: call `runDay()` once per day, `applyLongRest(party)` between days.
- `shortRestThreshold` and `hitDiceTargetFraction` are tunable; defaults are 60% / 75%.
- `reviveStableOnRest()` runs after every rest — unconscious-not-dead PCs regain 1 HP.

### Spell module pattern (all spells follow this)
```typescript
// src/spells/<name>.ts
export const metadata = { name, level, school, rangeFt, concentration, ... };
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | Combatant | null;
export function execute(caster: Combatant, targets: ..., state: EngineState): void;
```
- Local `emit()` helper pushes to `state.log.events` (avoids circular import from combat.ts)
- Planner: `import { shouldCast as shouldCastXxx }` — aliased to avoid collision
- combat.ts: `import { execute as executeXxx }` + `case 'xxx'` in `executePlannedAction`

### planTurn spell priority order (current)
1. **Bless** — before `selectTarget`, highest priority (buff allies early)
2. **Cure Wounds** — after `selectTarget`, urgent heal gates
3. **Warding Bond** — after Cure Wounds, before Faerie Fire (touch range)
4. **Faerie Fire** — before attack selection (AoE advantage)
5. Normal attack / movement
→ Shield of Faith (bonus action) slots after Bless: it's a bonus-action buff

### `ac_bonus` already wired (no new SpellEffectType needed)
`spell_effects.ts` exports `getActiveAcBonus(c: Combatant): number` which sums all
`ActiveEffect` entries with `effectType === 'ac_bonus'`. This is already called in
`resolveAttack` (utils.ts) when computing effective AC. So Shield of Faith just needs to
apply an `ActiveEffect` with `effectType: 'ac_bonus', payload: { acBonus: 2 }`.

---

## Test Baseline (Session 36 start, ~1,611 total)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| bless.test.ts | 37 |
| combat.test.ts | 43–51 (variance, 0 failures) |
| concentration_ai.test.ts | 34 |
| cunning_action.test.ts | 53 |
| **day.test.ts** | **54 (new this session)** |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| faerie_fire.test.ts | 30 |
| healing.test.ts | 34 |
| healing_spells.test.ts | 36 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| los.test.ts | 54 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 266 |
| phase4.test.ts | 54 |
| rage.test.ts | 40 |
| resources.test.ts | 72 (was 71 — Monk test updated) |
| scenario.test.ts | 94 |
| server.test.ts | 32 (run separately, timeout 45) |
| sneak_attack.test.ts | 23 |
| spell_actions.test.ts | 52 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| warding_bond.test.ts | 41 |

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
git commit -m "Session 36: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```

## Notes for Session 36
- **`hitDice` is optional** — monsters and legacy test factory combatants don't have it.
  Only `spawnPC()` / `pcToCombatant()` sets it. Test factories remain unchanged.
- **`spendHitDiceOnRest` is exported** from `utils.ts` — available for tests and day.ts.
- **Monk test** in resources.test.ts was updated: now checks "hitDice only, no class
  resources" instead of "null resources". If new classes are added, verify they pass.
- **`server.test.ts` needs `npm install`** in fresh containers (express dependency).
- **Phase 8-H extensions** (multi-day, API endpoint, reporting) are future scope.
  The core `runDay()` / `applyLongRest()` loop is the foundation for all of them.
- **Shield of Faith is the easiest next task** — `ac_bonus` SpellEffectType already
  exists and is wired in `spell_effects.ts`. Just needs the spell module + planner wiring.
