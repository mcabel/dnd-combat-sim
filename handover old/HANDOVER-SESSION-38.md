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
- **Do NOT use Larva for testing** — too fragile (low HP, easily slept/killed). Use bestiary-mm-2014.json monsters instead.
- **Another agent** is working `SHEET-HANDOVER-*.md` — do not touch sheet routes, leveler.ts, or builder.ts.

## Current State
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `2944f97`)
- **Tests:** 1,809 passing, 0 failed (36 suites; server.test.ts excluded — pre-existing express module issue)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done This Session (Session 37 — combat-sim agent)

### Arms of Hadar ✅ COMPLETE (commit `9627632`)
**PHB p.215:** 1st-level conjuration, NOT concentration, range Self (10-ft radius sphere).
STR save: fail → 2d6 necrotic + lose reaction until start of next turn; success → half damage.

**Key architectural point:** AoE is a **true Euclidean circle**, NOT a Chebyshev square.
- `euclideanDistFt()` added to `movement.ts` — use for any "X-ft radius" spell.
- A cell 2 squares diagonally (≈14.1 ft) is correctly **outside** a 10-ft radius. Chebyshev would wrongly include it.
- Thunderwave is a **cube emitted from the caster's perimeter** (different shape). Arms of Hadar is a **sphere centred on the caster**.

**Pact-slot conflict fix:** The `case 'armsOfHadar'` in combat.ts does NOT re-run `shouldCast` (which re-checks the slot). `hexPlan()` consumes the pact slot during bonus-action planning before the case executes. The case instead collects live targets directly via Euclidean filter.

**Files:** `src/spells/arms_of_hadar.ts`, `src/test/arms_of_hadar.test.ts` (33 tests)
**Modified:** `types/core.ts` (`'armsOfHadar'`), `engine/movement.ts` (`euclideanDistFt`), `engine/combat.ts` (case), `ai/planner.ts` (after Thunderwave)

### Sleep ✅ COMPLETE (commit `4bc8606`)
**PHB p.276:** 1st-level enchantment, NOT concentration, range 90 ft, 20-ft sphere.
No attack roll, no saving throw. Roll 5d8 HP budget; starting from lowest-HP creature, render unconscious until they take damage or someone uses an action to wake them.

**HP bucket mechanic:** Sort enemies ascending HP → deduct HP from budget → sleep if fits.
**Wake-on-damage:** `applyDamage()` in `utils.ts` now clears `sleeping`/`unconscious`/`incapacitated` conditions when `amount > 0` and target has `sleeping` condition. This runs BEFORE zero-HP logic.
**Conditions added:** `'sleeping'` added to the `Condition` type union in `core.ts`.
**Planner priority:** Sleep is the **highest-priority AoE action** (before Entangle) — no save, no concentration, guaranteed effect against low-HP targets.

**Regression fixes required:** Thunderwave test 3e and spell_actions Sorcerer test needed `.filter(a => a.name !== 'Sleep')` to isolate the spell being tested — Sleep outprioritises them by design.

**Files:** `src/spells/sleep.ts`, `src/test/sleep.test.ts` (35 tests)
**Modified:** `types/core.ts` (`'sleep'`, `'sleeping'`), `engine/utils.ts` (wake-on-damage), `data/spells.ts` (Sleep stub), `engine/combat.ts` (case), `ai/planner.ts` (priority)

### Chromatic Orb dedup fix ✅ COMPLETE (commit `2944f97`)
**Bug:** Chromatic Orb appeared in both Sorcerer `weapons[]` AND `spells_1st[]`, creating a duplicate Action — one without `slotLevel` (slot never consumed), one correct.
**Fix in `parser/pc.ts`:** After assembling `weaponActions` and `spellActions` separately, filter out weapon-parsed entries whose name exists in spell-list entries. Spell-list version wins (has correct `slotLevel`, `hitBonus` from `spellAttackBonus`, `attackType: 'spell'`).
**Tests:** 4 dedup assertions added to `pc.test.ts`.

### Mount test larva → MM-2014 monsters ✅ COMPLETE (commit `2944f97`)
**Mount.test.ts sections 5, 5b, 7** replaced larva with:
- **5/5b independent mount:** 3 Orcs (HP 15, CR 0.5) — 45 HP total exceeds 5d8 max (40), guaranteeing ≥1 awake target regardless of Sleep roll.
- **7 multi-encounter day:** Tribal Warriors (HP 11, CR 1/8, pure melee, adjacent start) — Fighter win rate 97%/88%.
- **Bestiary loading:** `mount.test.ts` now merges DMG + `bestiary-mm-2014.json` via `mergeBestiaries()`.

---

## Planner Priority Order (Session 37 final state)

**Before `selectTarget`:**
1. Bless (ally buff, fires even with no enemies)

**After `selectTarget`:**
2. Cure Wounds (urgent — downed ally in 5ft)
3. Warding Bond (ally protection)
4. **Sleep** (no-save opener — 5d8 HP bucket, Sorcerer + Wizard only)
5. Entangle (AoE control at 90ft, concentration)
6. Thunderwave (melee AoE ≥2 enemies within 15ft, NOT concentration)
7. Arms of Hadar (melee AoE ≥2 enemies within 10ft Euclidean, Warlock only, NOT concentration)
8. Faerie Fire (AoE advantage at 60ft, concentration)
9. `selectAction` → normal attack / cantrip

---

## Spell Modules Implemented So Far

| Spell | File | Casters | Notes |
|-------|------|---------|-------|
| Faerie Fire | `src/spells/faerie_fire.ts` | Druid | DEX save, outlined, concentration |
| Bless | `src/spells/bless.ts` | Cleric, Paladin | +1d4 attacks/saves, concentration |
| Entangle | `src/spells/entangle.ts` | Druid | STR save, restrained, concentration |
| Thunderwave | `src/spells/thunderwave.ts` | Druid, Wizard | CON save, 2d8 + push, no concentration; **cube from perimeter** |
| Arms of Hadar | `src/spells/arms_of_hadar.ts` | Warlock | STR save, 2d6 necrotic + lose reaction, no concentration; **Euclidean circle** |
| Sleep | `src/spells/sleep.ts` | Sorcerer, Wizard | 5d8 HP bucket, no save, no concentration; wake on damage |
| Warding Bond | `src/spells/warding_bond.ts` | Cleric | redirect half damage, concentration |
| Shield of Faith | `src/spells/shield_of_faith.ts` | Cleric, Paladin | +2 AC (bonus action, concentration) |

---

## NOT YET DONE — Priorities for Session 38

### 1. Hunter's Mark — DO NOT IMPLEMENT
Ranger gets spell slots at level 2. Level 1 Ranger has no spellcasting. Deferred until a level 2 PC stat block is added.

### 2. Shield of Faith + Divine Smite — OTHER AGENT
Another agent is working these. Do not duplicate.

### 3. Arms of Hadar "lose reaction" integration check
Verify that `reactionUsed = true` correctly blocks opportunity attacks from affected enemies. The OA path in combat.ts should already check `budget.reactionUsed` — confirm with a targeted test if not yet tested.

### 4. Sleep priority edge cases (low priority)
Currently Sleep fires for ANY enemy in 90ft. Consider whether a ≥2-enemy threshold makes sense (Entangle requires enemies exist; Sleep doesn't need multiple targets to be worthwhile since putting 1 enemy to sleep is still strong). Current behaviour is intentional — revisit only if planner tests reveal issues.

### 5. Next spell candidates (when instructed)
- **Hex** (Warlock bonus action, concentration) — pairs with Arms of Hadar
- **Mage Armor** (Wizard utility, no concentration) — pre-combat buff
- **Burning Hands** (Sorcerer/Wizard, 15-ft cone) — AoE damage

---

## Test Baseline (Session 38 start)

| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| **arms_of_hadar.test.ts** | **33 (Session 37)** |
| bardic_inspiration.test.ts | 27 |
| bless.test.ts | 37 |
| character_storage.test.ts | 74 |
| combat.test.ts | 49 |
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
| mount.test.ts | 44 |
| mount_redirect.test.ts | 21 |
| parser.test.ts | 101 |
| pc.test.ts | 270 |
| phase4.test.ts | 54 |
| rage.test.ts | 40 |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | (excluded — pre-existing express error) |
| shield_of_faith.test.ts | 27 |
| **sleep.test.ts** | **35 (Session 37)** |
| sneak_attack.test.ts | 23 |
| spell_actions.test.ts | 52 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| thunderwave.test.ts | 25 |
| warding_bond.test.ts | 41 |

**Total: 1,809 passing, 0 failed**

---

## AoE Shape Reference (for future spell modules)

| PHB Wording | Shape | Distance fn | Example spells |
|-------------|-------|-------------|----------------|
| "X-ft cube" | Square/cube from emitter | `chebyshev3D` / `distanceFt` | Thunderwave (15-ft cube from caster edge) |
| "X-ft radius sphere/circle" | True circle from centre | `euclideanDistFt` | Arms of Hadar (10-ft), Sleep (20-ft), Fireball (20-ft) |
| "X-ft cone" | Wedge from caster | (not yet implemented) | Burning Hands (15-ft) |
| "X-ft line" | Ray | (not yet implemented) | Lightning Bolt (100-ft) |

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
