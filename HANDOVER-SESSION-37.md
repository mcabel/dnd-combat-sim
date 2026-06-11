# HANDOVER — Session 37 Start

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
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `b9fff05`)
- **Tests:** ~1,670 passing, 0 failed (33 suites)
- **Branch:** main (detached HEAD workflow — push as `HEAD:main`)

---

## What Was Done This Session (Session 36)

### Entangle spell module ✅ COMPLETE (commit `577e7c7`)
**PHB p.238:** 1st-level conjuration, concentration (up to 1 min), range 90 ft, 20-ft square.
STR save or restrained. Already-wired `condition_apply` + `restrained` path used.

**Files:** `src/spells/entangle.ts`, `src/test/entangle.test.ts` (30 tests)
**Modified:** `types/core.ts` (`'entangle'` to PlannedAction), `engine/combat.ts` (case + import),
`ai/planner.ts` (before Faerie Fire in priority)

**Simplifications:** AoE targets all enemies in 90ft (not a specific square). Break-free mechanic
not implemented (enemies don't use action to attempt STR check to escape).

### Thunderwave spell module ✅ COMPLETE (commit `b9fff05`)
**PHB p.282:** 1st-level evocation, NOT concentration, range Self (15-ft cube).
CON save: fail → 2d8 thunder + pushed 10ft; success → half damage, no push.

**Files:** `src/spells/thunderwave.ts`, `src/test/thunderwave.test.ts` (25 tests)
**Modified:** `types/core.ts` (`'thunderwave'`), `engine/combat.ts` (case + import),
`ai/planner.ts` (after Entangle, ≥2-enemy threshold)

**Push mechanic:** `pushAway(caster, target, 2)` mutates `target.pos` by 2 grid cells along the
displacement vector. Obstacles/grid bounds not checked (deferred to physics pass).

**Known test behavior:**
- Druid picks **Entangle** over Thunderwave when not concentrating (correct — Entangle is stronger).
- Thunderwave fires when the caster is **already concentrating** and ≥2 enemies in 15ft.

### Faerie Fire test 3a updated
Previously tested "Druid picks FF". Updated: Entangle now has higher priority; test verifies
no FF when concentrating on Entangle. See `faerie_fire.test.ts` test 3a.

---

## Planner Priority Order (Session 36 final state)

**Before `selectTarget`:**
1. Bless (ally buff, fires even with no enemies)

**After `selectTarget`:**
2. Cure Wounds (urgent — downed ally in 5ft)
3. Warding Bond (ally protection)
4. Entangle (AoE control at 90ft, concentration)
5. Thunderwave (melee AoE ≥2 enemies, NOT concentration — fires while concentrating on Entangle)
6. Faerie Fire (AoE advantage at 60ft, concentration)
7. `selectAction` → normal attack / cantrip

---

## Spell Modules Implemented So Far

| Spell | File | Casters | Notes |
|-------|------|---------|-------|
| Faerie Fire | `src/spells/faerie_fire.ts` | Druid | DEX save, outlined, concentration |
| Bless | `src/spells/bless.ts` | Cleric, Paladin | +1d4 attacks/saves, concentration |
| Entangle | `src/spells/entangle.ts` | Druid | STR save, restrained, concentration |
| Thunderwave | `src/spells/thunderwave.ts` | Druid, Wizard | CON save, 2d8 + push, **no concentration** |

---

## NOT YET DONE — Priorities for Session 37

### 1. Sleep (Sorcerer + Wizard) — MEDIUM
**PHB p.276:** 1st-level enchantment, NOT concentration, range 90ft, 20-ft sphere.
Roll 5d8 HP total. Starting from lowest-HP creature, render unconscious until they take damage
or a creature uses an action to wake them. Unique mechanic — no attack roll, no saving throw.

- `shouldCast` — returns sorted enemies by ascending HP; fires when enemies exist in range
- `execute` — roll 5d8 total; iterate sorted enemies ascending HP; mark unconscious until
  budget exhausted; `isUnconscious = true` (already in Combatant)
- **Key AI note:** Sleeping creatures are subject to auto-coup-de-grace from attacks within 5ft
  (critical hits from adjacent attackers are already wired via `attackHits` in utils.ts).
  Check if `isUnconscious` already grants advantage on attacks — if not, wire it.
- Both Sorcerer and Wizard have it in their prepared spell lists.

### 2. Chromatic Orb (Sorcerer) — EASY
**PHB p.221:** 1st-level evocation, NOT concentration, spell attack roll, 3d8 damage.
Damage type chosen by caster (acid/cold/fire/lightning/poison/thunder).
- Straightforward spell attack — follows existing attack-roll pattern
- AI: pick element enemy is vulnerable to (or default to fire/lightning)

### 3. Arms of Hadar (Warlock) — EASY-MEDIUM
**PHB p.215:** 1st-level conjuration, NOT concentration, range Self (10-ft radius).
STR save: 2d6 necrotic + lose reaction on fail; half on success.
- Very similar to Thunderwave (self-centered AoE, CON→STR save, but necrotic)
- Warlock already has it in prepared spells
- "Lose reaction" effect — new mechanic (reaction flag on Combatant)

### 4. Hunter's Mark — DO NOT IMPLEMENT
Ranger gets spell slots at level 2. Level 1 Ranger has no spellcasting. Deferred until a
level 2 PC stat block is added.

### 5. Shield of Faith + Divine Smite — OTHER AGENT
Another agent is working these. Do not duplicate.

---

## Spell Arch: What `selectAction` Does vs Spell Modules

`selectAction` in `planner.ts` handles spells that are simple spell attacks (hit roll or save
that produces damage). The spell module pattern handles spells with complex AI gating, AoE
targeting, or effects beyond simple damage. Guide:

- **Use spell module** for: AoE, concentration + complex AI, ally-targeting, unique mechanics
- **Use selectAction** for: single-target damage spells already in SPELL_DB with standard
  attack or save (Scorching Ray, Magic Missile, Chromatic Orb, etc.)

For Chromatic Orb specifically: it MAY fit in `selectAction` if the Sorcerer's stat block
already has it parsed and `selectAction` picks it correctly. Check before building a module.

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
- Planner imports `shouldCast` aliased as `shouldCastXxx`; combat.ts imports both
- Re-run `shouldCast` in the `case 'xxx'` handler to pick up live targets
- Add spell name to `SPELL_DB` in `src/data/spells.ts` so the parser creates an `Action` object

---

## Test Baseline (Session 37 start)
| Suite | Count |
|-------|-------|
| adv_system.test.ts | 48 |
| ai.test.ts | 26 |
| bardic_inspiration.test.ts | 27 |
| bless.test.ts | 37 |
| combat.test.ts | 54 |
| concentration_ai.test.ts | 34 |
| cunning_action.test.ts | 53 |
| day.test.ts | 54 |
| death_saves.test.ts | 57 |
| engine.test.ts | 71 |
| **entangle.test.ts** | **30 (Session 36)** |
| faerie_fire.test.ts | 29 |
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
| rage.test.ts | 40 (1 probabilistic variance) |
| resources.test.ts | 72 |
| scenario.test.ts | 94 |
| server.test.ts | 32 |
| sneak_attack.test.ts | 23 |
| spell_actions.test.ts | 52 |
| spell_effects.test.ts | 23 |
| summons.test.ts | 51 |
| **thunderwave.test.ts** | **25 (Session 36)** |
| warding_bond.test.ts | 41 |

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
git commit -m "Session 37: <description>"
git push https://mcabel:<PAT>@github.com/mcabel/dnd-combat-sim.git HEAD:main
```
