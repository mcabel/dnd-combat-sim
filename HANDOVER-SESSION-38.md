# HANDOVER — Session 38 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `07b91e3`)
- **Tests:** ~1,767 passing, 0 failed (36 suites; server.test.ts excluded — pre-existing express module issue)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done This Session (Session 37)

### Correction applied (user note)
**Thunderwave** is a cube emanating from the *caster's perimeter* (like a breath weapon).
**Arms of Hadar** is an aura originating at the *caster's center* — circle/sphere AoE rules.
All spells described as "X-ft radius" must use Euclidean distance (true circle), not Chebyshev (which produces a square approximation).

### `euclideanDistFt` helper added to `movement.ts` ✅ (commit `9627632`)
Euclidean 3-D distance in feet for circle/sphere AoE spells. Key difference:
- A cell 2 squares diagonally away = **~14.1 ft** (Euclidean) — correctly outside a 10-ft radius.
- Chebyshev would measure it as 10 ft (max(2,2)=2 squares × 5 ft) — wrong for circles.
Used by Arms of Hadar and Sleep (and any future radius-based spell).

### Arms of Hadar spell module ✅ (commit `9627632`)
**PHB p.215:** 1st-level conjuration, NOT concentration, Self (10-ft radius sphere, Euclidean).
STR save vs DC 13: fail → 2d6 necrotic + `reactionUsed = true`; success → half damage.

**Files:** `src/spells/arms_of_hadar.ts`, `src/test/arms_of_hadar.test.ts` (33 tests)
**Modified:** `types/core.ts` (`'armsOfHadar'`), `engine/combat.ts` (case + import + `euclideanDistFt` in movement import), `ai/planner.ts` (after Thunderwave block)

**Pact-slot conflict fix:** The `case 'armsOfHadar'` in `combat.ts` does NOT re-run `shouldCast`
(unlike all other spell cases). Reason: Warlock's `hexPlan()` in bonus-action planning
consumes the pact slot during `planTurn`, so `shouldCastArmsOfHadar` (which re-checks slots)
would find 0 slots at execution time. The case instead collects live in-range targets directly
via Euclidean filter. Comment in code explains this.

**Reaction denial verified:** `reactionUsed = true` (set on failed save) correctly gates
`shouldTakeOpportunityAttack` in `planner.ts` (line 842). No additional wiring needed.

### Sleep spell module ✅ (commit `4bc8606`)
**PHB p.276:** 1st-level enchantment, NOT concentration, range 90 ft, 20-ft sphere.
No attack roll, no saving throw. HP-bucket mechanic: roll 5d8, put enemies to sleep starting
from lowest current HP until budget exhausted.

**Files:** `src/spells/sleep.ts`, `src/test/sleep.test.ts` (35 tests)
**Modified:** `types/core.ts` (`'sleep'` PlannedAction, `'sleeping'` Condition), `data/spells.ts`
(Sleep SPELL_DB entry, `attackType: null` so selectAction skips it), `engine/utils.ts`
(wake-on-damage in `applyDamage`), `engine/combat.ts` (case + import), `ai/planner.ts`
(before Entangle block — Sleep is highest-priority opener for Sorcerer/Wizard)

**Wake mechanic:** Any `applyDamage(target, amount > 0)` call on a creature with `conditions.has('sleeping')` clears `sleeping` / `unconscious` / `incapacitated` and sets `isUnconscious = false` BEFORE HP is reduced. Subsequent 0-HP handling (checkDeath) works normally.

**Sleeping state:**
- `isUnconscious = true`
- `conditions.add('sleeping')` — distinguishes magic sleep from downed-PC
- `conditions.add('unconscious')`
- `conditions.add('incapacitated')`
- `deathSaves` NOT set (creature is not dying)

**Known simplification:** Undead / charm-immune creatures are not excluded (creature type not yet tracked).

**Priority regressions fixed:** Sleep's new higher priority broke `thunderwave.test.ts` test 3e
and `spell_actions.test.ts` Sorcerer test. Both updated: the specific test scenario now calls
`actions.filter(a => a.name !== 'Sleep')` to isolate Thunderwave/Chromatic Orb behaviour.
Added comment explaining why (Sleep fires first for fresh Sorcerer/Wizard).

### Chromatic Orb dedup fix ✅ (commit `07b91e3`)
Chromatic Orb appeared in Sorcerer's `weapons[]` AND `spells_1st[]` — produced two `Action`
entries: one with `slotLevel: undefined` (never consumed a slot) and one with `slotLevel: 1`.
`selectAction` could pick either unpredictably.

**Fix in `parser/pc.ts`:** After building `weaponActions` and `spellActions` separately, merge:
`weaponActions.filter(a => !spellNames.has(a.name))` (weapon-parsed version dropped when spell-list
version exists) + `spellActions`. Spell-list version always wins — it has accurate `slotLevel`,
`hitBonus` (from `spellAttackBonus`), `attackType`, and AoE flags.
**4 new assertions in `pc.test.ts`** verify count=1, slotLevel=1, hitBonus=5, attackType='spell'.

---

## Planner Priority Order (Session 37 final state)

**Before `selectTarget`:**
1. Bless (ally buff, fires even with no enemies)

**After `selectTarget`:**
2. Cure Wounds (urgent — downed ally in 5ft)
3. Warding Bond (ally protection)
4. **Sleep** (5d8 HP bucket, no save, ≥1 enemy in 90ft — Sorcerer / Wizard opener)
5. Entangle (AoE control at 90ft, concentration — Druid)
6. Thunderwave (melee AoE ≥2 enemies in 15ft, no concentration — Druid / Wizard)
7. **Arms of Hadar** (circle AoE ≥2 enemies in 10ft, no concentration — Warlock)
8. Faerie Fire (AoE advantage at 60ft, concentration — Druid)
9. `selectAction` → normal attack / cantrip

---

## Spell Modules Implemented So Far

| Spell | File | Casters | Notes |
|-------|------|---------|-------|
| Faerie Fire | `src/spells/faerie_fire.ts` | Druid | DEX save, outlined, concentration |
| Bless | `src/spells/bless.ts` | Cleric, Paladin | +1d4 attacks/saves, concentration |
| Entangle | `src/spells/entangle.ts` | Druid | STR save, restrained, concentration |
| Thunderwave | `src/spells/thunderwave.ts` | Druid, Wizard | CON save, 2d8 + push, no concentration, **cube** AoE |
| Arms of Hadar | `src/spells/arms_of_hadar.ts` | Warlock | STR save, 2d6 necrotic + lose reaction, no concentration, **circle** AoE (Euclidean) |
| Sleep | `src/spells/sleep.ts` | Sorcerer, Wizard | 5d8 HP bucket, no save, no concentration, wake-on-damage |
| Warding Bond | `src/spells/warding_bond.ts` | Cleric | Ally protection, no concentration |
| Shield of Faith | `src/spells/shield_of_faith.ts` | Cleric, Paladin | +2 AC, bonus action, concentration |

---

## NOT YET DONE — Priorities for Session 38

### 1. Hunter's Mark — DO NOT IMPLEMENT
Ranger gets spell slots at level 2. Level 1 Ranger has no spellcasting. Deferred.

### 2. Shield of Faith + Divine Smite — OTHER AGENT
Another agent is working these. Do not duplicate.

### 3. Next spell candidate (pick one per session)
**Hex (Warlock)** — already wired as a bonus action through `planBonusAction`/`hexPlan`.
Check if it's actually consuming a slot correctly in the full pipeline (separate from Arms of Hadar).
Could also verify Hex damage bonus applies on attacks.

**Color Spray / Burning Hands (Sorcerer)** — not yet in SPELL_DB. Sorcerer has neither atm;
their current spell options are Chromatic Orb (ranged attack) and Sleep (opener).

**Hold Person (Wizard)** — concentration, 2nd-level. Deferred until level 2 stat blocks.

**Fireball** — 3rd level. Deferred.

### 4. Sleep ≥2-enemy threshold consideration
Currently Sleep fires when ≥1 enemy is in range. Could add ≥2 threshold (matching Thunderwave/AoH
logic) to avoid wasting a slot on a single healthy enemy. Counter-argument: Sleep is the Sorcerer's
primary CC and a single unconscious enemy is still a massive advantage (free crits from adjacent
attackers). Leave as-is for now but revisit if AI feels too aggressive with slot usage.

### 5. Coup de grâce verification for sleeping targets
Sleeping creatures grant advantage to adjacent attackers (via `conditions.has('unconscious')` →
advantage in `attackHits`). Attacks against unconscious creatures within 5ft are auto-crits in
5e (PHB p.198). Verify this path works correctly for sleeping (not just downed-PC) creatures.
The condition is set on Sleep targets, so it should work — but add a targeted test.

---

## Known Intermittent Tests
- `rage.test.ts`: 1 probabilistic variance (documented in prior sessions)
- `mount.test.ts`: occasionally shows 42/43 — pre-existing intermittency (independent mount turn
  timing vs. combat RNG). NOT related to Session 37 changes.

---

## Architecture: Spell Module Pattern

All spell modules live at `src/spells/<name>.ts`:
```typescript
export const metadata = { name, level, school, rangeFt, concentration, ... };
export function shouldCast(caster: Combatant, bf: Battlefield): Combatant[] | null { ... }
export function execute(caster: Combatant, targets: Combatant[], state: EngineState): void { ... }
```
- Local `emit()` helper pushes to `state.log.events`
- No circular imports: spell modules import from engine; combat.ts imports spell modules
- Planner imports `shouldCast` aliased as `shouldCastXxx`; combat.ts imports `execute` aliased as `executeXxx`
- **AoE distance:** use `euclideanDistFt` for radius/sphere spells; `distanceFt` (Chebyshev) for cubes/range checks
- Re-run `shouldCast` in the `case 'xxx'` handler to get fresh live targets — **EXCEPT** for `armsOfHadar` (pact-slot conflict with hexPlan; see code comment)
- Add spell name to `SPELL_DB` in `src/data/spells.ts` so the parser creates an `Action` object
- Spells with `attackType: null` and `damage: null` in SPELL_DB are invisible to `selectAction` (good for HP-bucket / complex mechanic spells like Sleep)

---

## Test Baseline (Session 38 start)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| **arms_of_hadar.test.ts** | **33 (Session 37)** |
| bardic_inspiration.test.ts | 27 |
| bless.test.ts | 37 |
| combat.test.ts | 53 |
| concentration_ai.test.ts | 34 |
| cunning_action.test.ts | 53 |
| day.test.ts | 54 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| entangle.test.ts | 30 |
| faerie_fire.test.ts | 29 |
| healing.test.ts | 34 |
| healing_spells.test.ts | 36 |
| html_report.test.ts | 36 |
| integration.test.ts | 26 |
| los.test.ts | 54 |
| mechanics.test.ts | 57 |
| mount.test.ts | 43 (intermittent) |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 270 |
| phase4.test.ts | 54 |
| rage.test.ts | 40 (1 probabilistic variance) |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | (pre-existing express issue — skip) |
| shield_of_faith.test.ts | 27 |
| **sleep.test.ts** | **35 (Session 37)** |
| sneak_attack.test.ts | 23 |
| spell_actions.test.ts | 52 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| thunderwave.test.ts | 25 |
| warding_bond.test.ts | 41 |

**Total: ~1,767 passing across 36 suites**

---

## Run Tests
```bash
export TS_NODE_COMPILER_OPTIONS='{"lib":["ES2020","DOM"],"types":["node"]}'
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  timeout 35 npx ts-node "$f" 2>&1 | grep "Results:"
done
```

## Git Workflow
```bash
git config user.email "mcabel@users.noreply.github.com"
git config user.name "mcabel"
git add -A
git commit -m "Session 38: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```
