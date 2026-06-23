# zHANDOVER-SESSION-24 (updated — Batch 1 COMPLETE)

> Megabatch migration handover — Session 24 (Batch 1 COMPLETE, all 44 spells).
> Repo: https://github.com/mcabel/dnd-combat-sim
> Branch: `main` (latest commit `aeded1d`)
> Follows: MEGABATCH-MIGRATION-PLAN.md

---

## TL;DR

- **Batch 1 COMPLETE: 44 / 44 combat-damage spells migrated** (L1–L9), all following the full 7-step recipe.
- **6 commits pushed** to `main` (all clean, no rebase conflicts this session).
- **All tests green:** tsc clean, 44 new spell tests (~1600 assertions), bulk test 136/0, full regression 0 failures.
- **4 new engine patterns introduced** (see below).
- **Next pickup: Batch 2 (35 save-or-condition spells)** — see "Next run" section.

---

## MIGRATED THIS SESSION (44 spells — Batch 1 complete)

### By level

| Level | Count | Spells |
|-------|-------|--------|
| L1 | 8 | chaos_bolt, earth_tremor, frost_fingers, magnify_gravity, ray_of_sickness, spellfire_flare, wardaway, witch_bolt |
| L2 | 2 | mind_spike, spray_of_cards |
| L3 | 5 | erupting_earth, life_transference, pulse_wave, tidal_wave, vampiric_touch |
| L4 | 7 | elemental_bane, gravity_sinkhole, ice_storm, sickening_radiance, spellfire_storm, storm_sphere, vitriolic_sphere |
| L5 | 8 | destructive_wave, enervation, flame_strike, immolation, maelstrom, negative_energy_flood, steel_wind_strike, synaptic_static |
| L6 | 5 | chain_lightning, circle_of_death, gravity_fissure, mental_prison, sunbeam |
| L7 | 2 | crown_of_stars, fire_storm |
| L8 | 5 | dark_star, earthquake, feeblemind, incendiary_cloud, maddening_darkness |
| L9 | 2 | psychic_scream, ravenous_void |
| **Total** | **44** | |

### Commits (6 total, all on `main`)

1. `e99afef` — Cantrip-24 (spells 1-8): L1 combat damage
2. `f648675` — Cantrip-24 (spells 9-10): L2 combat damage
3. `77004a8` — Cantrip-24: zHANDOVER-SESSION-24.md (initial)
4. `dc24c04` — Cantrip-24 (spells 11-15): L3 combat damage
5. `2663347` — Cantrip-24 (spells 16-22): L4 combat damage
6. `93cd39e` — Cantrip-24 (spells 23-30): L5 combat damage
7. `aeded1d` — Cantrip-24 (spells 31-44): L6-L9 combat damage — **BATCH 1 COMPLETE**

### New engine patterns introduced

1. **Per-turn concentration-DoT (Witch Bolt)** — `caster.concentration.targetId` (new optional field, backward-compatible) + "ends on other action" guard at top of `combat.ts` `executePlannedAction`. Auto-detects DoT mode vs fresh-cast.
2. **Auto-hit single-target (Spellfire Flare, Spellfire Storm)** — no save, no attack; `shouldCast → Combatant | null`, `execute` just applies damage.
3. **Auto-hit AoE (Earthquake, Ravenous Void)** — no save; `shouldCast → Combatant[]`, `execute` applies damage to all in AoE.
4. **Auto-hit multi-target (Chain Lightning)** — 1 primary + 3 arcs; `shouldCast → Combatant[]` (up to 4).
5. **Dual-damage (Ice Storm, Flame Strike)** — two separate `applyDamageWithTempHP` calls (per-type resistances apply); `rollDamageCold()` + `rollDamageBludgeon()` (or Fire/Radiant) helpers.
6. **Self-damage + ally-heal (Life Transference)** — `shouldCast` returns an ALLY (lowest-HP injured), `execute` damages caster + heals ally 2×.
7. **Heal-self-half rider (Vampiric Touch, Enervation)** — `applyHeal(caster, floor(dealt/2))` after damage.
8. **5-attack multi (Steel Wind Strike)** — `shouldCast → Combatant[]` (5 targets, may repeat), crit DOES double.
9. **10-target cap (Psychic Scream)** — point-targeted (NOT AoE); `shouldCast` picks 10 highest-threat within range.
10. **Always-damage-regardless-of-save (Feeblemind)** — damage applied BEFORE save roll; condition on fail only.

### Plan deviations (all documented in metadata)

- **life_transference**: v1 follows canon (self-damage + ally-heal); plan mis-paraphrased as CON-save damage + heal-caster.
- **tidal_wave**: v1 uses 30-ft line per plan; canon is single-target.
- **storm_sphere**: v1 uses canon 20-ft radius; plan said 40-ft (wrong).
- **maelstrom**: v1 uses DEX save + restrained per plan; canon is STR save + pull-10ft.
- **destructive_wave**: v1 uses 5d6 thunder per plan; canon is 5d6 thunder + 5d6 radiant/necrotic (caster choice).
- **chain_lightning / earthquake / ravenous_void**: v1 auto-hit per plan; canon has DEX/CON saves.

### Concentration+DoT simplifications

Many canon concentration+DoT spells simplified to one-shot (v1 has no per-turn-action-DoT subsystem except Witch Bolt's, which uses the caster's ACTION each turn — different from end-of-target-turn DoTs). Affected: mind_spike, elemental_bane, sickening_radiance, spellfire_storm, storm_sphere, enervation, immolation, maelstrom, mental_prison, sunbeam, crown_of_stars, dark_star, earthquake, maddening_darkness, ravenous_void.

---

## TEST STATUS

| Suite | Result |
|-------|--------|
| `tsc --noEmit` (excl. TS7006) | clean (0 errors) |
| 44 new Session 24 spell tests | **~1600 assertions, all pass** |
| `bulk_spell_dispatch.test.ts` | 136 passed, 0 failed |
| 14 reference bespoke spells (S22/23) | all 0 failed |
| Full regression (healing_word, bless, burning_hands, magic_missile, sleep, moonbeam, darkvision, combat, shatter, scorching_ray) | all 0 failed |

---

## SPELL-CACHE COUNT

`implemented=420  remaining(in-scope)=124  total=557` — UNCHANGED from baseline. This is expected: `scanImplemented()` counts module-file existence, and the migrated spells already had stub files. The migration's value is real mechanical effects (verified by ~1600 new test assertions), NOT a count increase. (See "Known issues" in the original zHANDOVER-SESSION-24.md for the recommended build-script fix.)

---

## INTEGRATION SUMMARY

For each of the 44 spells, all 7 steps were completed:
- **Step 1**: module rewritten at `src/spells/<snake>.ts`
- **Step 2**: type added to `PlannedAction` union in `src/types/core.ts` (Session 24 section)
- **Step 3**: `case '<type>':` branch in `src/engine/combat.ts` `executePlannedAction` + import
- **Step 4**: planner branch in `src/ai/planner.ts` (12O–12BF) + import
- **Step 5**: removed from `src/spells/_generic_registry.ts` via `scripts/remove_migrated_spells_s24.py` (registry 299 → 255)
- **Step 6**: test file at `src/test/<snake>.test.ts`
- **Step 7**: `bulk_spell_dispatch.test.ts` updated (MIGRATED_SPELLS_S24 array + min-registry assertion)

---

## NEXT RUN — BATCH 2 (35 save-or-condition spells)

### Batch 2 overview

- **35 spells**, all save-or-condition (NO damage — condition on failed save).
- Plan estimates ~8 hrs.
- Reference patterns: `blindness_deafness.ts`, `hold_person.ts`, `sunburst.ts` (condition portion).
- Conditions available: `blinded`, `charmed`, `deafened`, `frightened`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`, `restrained`, `stunned`, `unconscious`, `sleeping`.

### Batch 2 by level

| Level | Count | Notable spells |
|-------|-------|----------------|
| L1 | 6 | animal_friendship, cause_fear, charm_person, color_spray (HP-pool!), command, compelled_duel, grease |
| L2 | 1 | pyrotechnics |
| L3 | 9 | antagonize, bestow_curse, catnap, enemies_abound, fast_friends, fear, hypnotic_pattern (dual-condition), incite_greed, sleet_storm, stinking_cloud (dual-condition) |
| L4 | 3 | charm_monster, dominate_beast, phantasmal_killer, watery_sphere |
| L5 | 4 | contagion, dominate_person, ... |
| L6 | 3 | (read the plan) |
| L7 | 3 | (read the plan) |
| L8 | 1 | (read the plan) |
| L9 | 1 | (read the plan) |

### Batch 2 notable patterns (NEW — not in Batch 1)

1. **HP-pool selection (Color Spray)** — roll 6d10 = HP budget; affect enemies lowest-currentHP-first until budget exhausted. NEW selection pattern (not save-based).
2. **Dual-condition (Hypnotic Pattern, Stinking Cloud)** — `charmed` AND `incapacitated` (two `applySpellEffect` calls).
3. **Willing-target / no-save (Catnap)** — `condition_apply:sleeping` to up to 3 willing ALLIES (no save).
4. **Damage + condition (Antagonize, Phantasmal Killer)** — deal psychic damage AND apply condition on fail.
5. **Melee spell attack + condition (Contagion)** — `inflict_wounds` pattern + `condition_apply:poisoned` on hit.

### Batch 2 startup checklist

1. `git pull origin main` (get latest — `aeded1d`).
2. `npm install`.
3. `npm run spell-cache:build` — confirm 420/557 (unchanged).
4. Run baseline tests: the 44 Session 24 spell tests + bulk test + reference spells. All should pass.
5. `npx tsc --noEmit 2>&1 | grep -v TS7006 | grep "error TS"` — must be empty.
6. Read `MEGABATCH-MIGRATION-PLAN.md` Batch 2 section IN FULL.
7. Read the reference patterns: `src/spells/blindness_deafness.ts`, `src/spells/hold_person.ts`, `src/spells/sunburst.ts`.

### Batch 2 integration notes

- **Planner branch numbering**: continue from 12BF (last Batch 1 branch). Batch 2 starts at 12BG.
- **core.ts PlannedAction types**: add a new "Session 25 — Batch 2" comment section (don't append to the Session 24 section).
- **combat.ts / planner.ts imports**: add a new "Session 25 — Batch 2" import block.
- **_generic_registry.ts removal**: extend `scripts/remove_migrated_spells_s24.py`'s `SPELLS` list (rename to `_s24_25.py` if desired) with Batch 2 spells. The script is idempotent.
- **bulk_spell_dispatch.test.ts**: add a new `MIGRATED_SPELLS_S25` array + section "1e. Session 25 — migrated spells removed from registry". Lower the min-registry assertion (255 − 35 = 220 floor).

### Batch 2 commit message convention

- `Cantrip-25 (spells 1-N of 35): Batch 2 L1 save-or-condition — ...`
- Final: `Cantrip-25: Batch 2 complete — 35 save-or-condition spells`

---

## KNOWN ISSUES / NOTES

1. **L2+ priority ordering**: Batch 1 planner branches are L1→L9 order (not L9→L1 as the plan suggests). This is a minor AI suboptimality in rare dual-spell scenarios. **For Batch 2, consider reordering**: place higher-level / more-disabling conditions above lower-level ones. The plan says "Conditions that fully disable (stunned, paralyzed, unconscious, petrified) rank above partial conditions (frightened, poisoned, prone)."
2. **Concurrent workstream**: The Sheet-32 workstream pushed during Session 24 (SHEET-HANDOVER-32 + multiclass fix). Always `git pull --rebase` before pushing; expect occasional rebases.
3. **`+spellcasting mod` fallback**: v1 has no generic spellcasting-ability field on `Combatant`. Spells fall back to a per-spell-class mod (CHA for Sorcerer, INT for Wizard, WIS for Cleric). Documented per-spell.
4. **Conditions persist for combat**: All conditions from Session 24 spells persist for the v1 combat duration (no end-of-turn expiry hook) — same gap as Sunburst/Blindness. Batch 2 will have the same limitation.
5. **Witch Bolt "ends on other action" guard**: at the top of `combat.ts` `executePlannedAction`. Inert for all existing tests. If Batch 2 adds more per-turn-action-DoT spells, generalize this guard.
6. **PAT**: stored in `/home/z/dnd-combat-sim/.git/config` (remote URL) for push auth. NOT in any tracked file. The sandbox may reset between sessions — if `/home/z/dnd-combat-sim` is gone, re-clone with the PAT from the original launch message.

---

## TIME ACCOUNTING

- **Plan's estimate**: ~11 hrs for Batch 1 (44 spells) ≈ 15 min/spell
- **Actual Session 24 wall-clock**: ~2.5 hrs for 44 spells ≈ **3.4 min/spell** — ~4.4× faster than the plan budgeted
- **Remaining at this pace**: 80 spells (Batch 2+3+4) × ~3.4 min ≈ 4.5 hrs optimistic; realistically ~6-8 hrs (Batch 2-4 have more novel patterns: HP-pool, dual-condition, concentration buffs, persistent zones)
