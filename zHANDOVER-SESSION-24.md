# zHANDOVER-SESSION-24

> Megabatch migration handover — Session 24 (Batch 1, increments 1–2).
> Repo: https://github.com/mcabel/dnd-combat-sim
> Branch: `main` (latest commit `f648675`)
> Follows: MEGABATCH-MIGRATION-PLAN.md (Batch 1 = 44 combat-damage spells L1–L9).

---

## TL;DR

- **Migrated this session: 10 / 44 Batch 1 spells** (8 L1 + 2 L2), each following the full 7-step recipe.
- **2 commits pushed** to `main`: `Cantrip-24 (spells 1-8 of 44)` and `Cantrip-24 (spells 9-10 of 44)`. Rebased cleanly over an intervening `Sheet-32` push (no conflicts).
- **All tests green:** tsc clean, 10 new spell tests (401 assertions total), bulk test 108/0, full regression suite 0 failures.
- **1 new engine pattern introduced:** per-turn concentration-DoT (Witch Bolt) — see "Patterns introduced" below.
- **Next pickup:** Batch 1 L3 (5 spells): `erupting_earth`, `life_transference`, `pulse_wave`, `tidal_wave`, `vampiric_touch`. 34 spells remain in Batch 1.

---

## MIGRATED THIS SESSION (10 spells)

### L1 (8) — commit `Cantrip-24 (spells 1-8 of 44)`

| Spell | File | Pattern | Mirror | Test assertions |
|-------|------|---------|--------|-----------------|
| Chaos Bolt | `chaos_bolt.ts` | ranged spell attack 2d8 + random chaos-type | chromatic_orb (random picker) | 39 |
| Earth Tremor | `earth_tremor.ts` | self-centred 10-ft radius AoE CON save 1d6 + prone, caster excluded | sunburst (AoE+condition) | 48 |
| Frost Fingers | `frost_fingers.ts` | 15-ft cone CON save 2d8 cold | burning_hands cone + shatter loop | 39 |
| Magnify Gravity | `magnify_gravity.ts` | 60 ft, 10-ft radius AoE CON save 2d8 force | shatter | 42 |
| Ray of Sickness | `ray_of_sickness.ts` | ranged spell attack 2d8 poison + poisoned on hit | chromatic_orb + sunburst condition_apply | 41 |
| Spellfire Flare | `spellfire_flare.ts` | 60 ft, AUTO-HIT 2d10+spellcasting mod fire (no save, no attack) | magic_missile (auto-hit) + catapult shape | 37 |
| Wardaway | `wardaway.ts` | 60 ft, single-target CON save 2d4 force | catapult | 34 |
| Witch Bolt | `witch_bolt.ts` | 30 ft, ranged spell attack 1d12 lightning + **per-turn concentration-DoT** | chromatic_orb + NEW DoT pattern | 53 |

### L2 (2) — commit `Cantrip-24 (spells 9-10 of 44)`

| Spell | File | Pattern | Mirror | Test assertions |
|-------|------|---------|--------|-----------------|
| Mind Spike | `mind_spike.ts` | 60 ft, WIS save 3d8 psychic, v1 one-shot (canon concentration simplified) | catapult | 28 |
| Spray of Cards | `spray_of_cards.ts` | 15-ft cone DEX save 2d10 slashing + blinded on fail | frost_fingers cone + sunburst blinded | 38 |

### Patterns introduced (new in v1)

1. **Per-turn concentration-DoT (Witch Bolt).** Witch Bolt's "use your action each turn to deal 1d12 automatically" is the first per-turn ACTION-DoT in v1. Implementation:
   - Added optional `targetId?: string | null` to the `concentration` type in `core.ts` (backward-compatible — existing concentration objects don't set it).
   - `shouldCast` auto-detects DoT mode (`caster.concentration.spellName === 'Witch Bolt'`): returns the linked target if alive & in range, else null.
   - `execute` in DoT mode: NO slot, NO attack roll, 1d12 auto-hit. In fresh-cast mode: slot + attack + set concentration with `targetId`.
   - **"Ends on other action" guard** at the top of `combat.ts` `executePlannedAction`: if the caster is concentrating on Witch Bolt and `plan.type !== 'witchBolt'`, concentration breaks before the new action executes. (Bonus actions/reactions live in `plan.bonusAction`/`plan.reaction`, not `plan.type`, so they don't trigger the guard — correct per PHB p.289.)
   - This pattern is **reusable** for future per-turn-action-DoT concentration spells (e.g., a fuller Call Lightning, Sunbeam repeat-action). Recommend a dedicated concentration-DoT subsystem if more such spells land.

2. **Auto-hit single-target damage (Spellfire Flare).** First auto-hit SINGLE-target spell (Magic Missile is multi-dart auto-hit). `shouldCast → Combatant | null` (finds target, like catapult), `execute` applies damage with no save/attack roll (like magic_missile). `+spellcasting mod` falls back to `abilityMod(caster.cha)` (Sorcerer) — v1 has no generic spellcasting-mod field.

---

## SKIPPED THIS SESSION

**None skipped** — all 10 target spells were migrated with real mechanical effects. Witch Bolt (the hardest, due to the DoT) was implemented fully rather than skipped, using the new concentration-DoT pattern above.

---

## TEST STATUS

| Suite | Result |
|-------|--------|
| `tsc --noEmit` (excl. TS7006) | clean (0 errors) |
| 10 new Session 24 spell tests | **401 passed, 0 failed** (chaos_bolt 39, earth_tremor 48, frost_fingers 39, magnify_gravity 42, ray_of_sickness 41, spellfire_flare 37, wardaway 34, witch_bolt 53, mind_spike 28, spray_of_cards 38) |
| `bulk_spell_dispatch.test.ts` | 108 passed, 0 failed (was 98 at baseline; +8 from S24 "removed from registry" section +2 from L2) |
| 14 reference bespoke spells (fireball, lightning_bolt, cone_of_cold, inflict_wounds, chromatic_orb, catapult, ice_knife, blight, cloudkill, disintegrate, harm, finger_of_death, sunburst, power_word_kill) | all 0 failed |
| Regression (healing_word, bless, burning_hands, magic_missile, sleep, moonbeam, darkvision, combat, shatter, scorching_ray) | all 0 failed |

---

## SPELL-CACHE COUNT — IMPORTANT DISCREPANCY

The plan's POST-BATCH VERIFICATION step 5 expects `implemented` to rise by the batch size (`420 → 464 after Batch 1`). **This does NOT happen**, because `scripts/spell-cache/build.ts`'s `scanImplemented()` counts module-file existence (`fs.readdirSync(SPELLS_DIR)`), and the migrated spells **already had stub module files** (counted in the 420). Migrating stubs to bespoke improves their quality (zero-effect → real mechanics) but does not change the file-existence count.

- Current count: `implemented=420  remaining(in-scope)=124  total=557` (unchanged from baseline).
- The 10 migrated spells ARE marked `implemented=True` in the cache (confirmed) — they were already before migration.
- The migration's value is real mechanical effects (verified by 401 new test assertions), NOT a count increase.
- **Recommendation:** if the plan author wants the count to reflect bespoke-vs-stub, update `scanImplemented()` to distinguish (e.g., a spell is "fully implemented" only if its module lacks `*V1Simplified: true` / `*V1Implemented: false` forward-compat flags, or if it has a `case '<type>':` branch in combat.ts). This is a build-script change, not a spell change.

---

## INTEGRATION SUMMARY (per 7-step recipe)

For each of the 10 spells, all 7 steps were completed:

- **Step 1** — module rewritten at `src/spells/<snake>.ts` (exports `metadata`, `shouldCast`, `execute`, `cleanup`, `rollDamage`).
- **Step 2** — type added to `PlannedAction` union in `src/types/core.ts` (Session 24 section, lines ~1297–1318).
- **Step 3** — `case '<type>':` branch added in `src/engine/combat.ts` `executePlannedAction` (Session 24 block before `case 'genericSpell'`). 10 imports added (Session 24 import block).
- **Step 4** — planner branch added in `src/ai/planner.ts` (L1 = 12O–12V, L2 = 12W–12X). 10 imports added.
- **Step 5** — removed from `src/spells/_generic_registry.ts` via `scripts/remove_migrated_spells_s24.py` (registry 299 → 289). The script is idempotent — edit its `SPELLS` list per increment and re-run.
- **Step 6** — test file written at `src/test/<snake>.test.ts`.
- **Step 7** — `bulk_spell_dispatch.test.ts` updated: `MIGRATED_SPELLS_S24` array + min-registry assertion (280 → 265).

---

## NEXT RUN — PICK UP HERE

### Batch 1 remaining: 34 spells (L3–L9)

Run the startup checklist first (`git pull`, `npm install`, `npm run spell-cache:build`, baseline tests, `tsc`). Then continue with **Batch 1 L3 (5 spells)**:

| Spell | File | Pattern | Mirror | Notes |
|-------|------|---------|--------|-------|
| Erupting Earth | `erupting_earth.ts` | AoE DEX save 3d12 bludgeoning (20-ft cube → 20-ft radius) | sunburst (no condition — difficult terrain simplified) | L3 |
| Life Transference | `life_transference.ts` | single-target CON save 4d8 necrotic + **heal caster 2× damage dealt** | catapult + NEW heal rider | L3. First spell to heal caster based on damage dealt — use `applyHeal(caster, healAmount)` from utils. |
| Pulse Wave | `pulse_wave.ts` | cone CON save 6d6 force + push/pull (simplified) | sunburst cone (inConeFt) | L3. push/pull NOT modelled. |
| Tidal Wave | `tidal_wave.ts` | line STR save 4d8 bludgeoning + prone | sunburst + lightning_bolt line (inLineFt) | L3. "wave" approximated as 30-ft line. |
| Vampiric Touch | `vampiric_touch.ts` | melee spell attack 3d6 necrotic + heal half + concentration | inflict_wounds + heal rider | L3. concentration simplified to one-shot. Heal caster for half the necrotic dealt. |

### Known issues / notes for the next run

1. **Concurrent workstream.** The `Sheet-32` workstream pushed during this session (`SHEET-HANDOVER-32.md` + a multiclass spellcasting-class fix). Always `git pull --rebase` before pushing; expect occasional rebases.
2. **L2 priority ordering.** The L2 planner branches (12W–12X) are appended AFTER the L1 branches (12O–12V) for numbering continuity. This means a caster with BOTH a migrated L1 and L2 spell available prefers the L1 spell — a minor AI suboptimality in a rare dual-spell scenario. **When more L2+ spells exist, reorder: place higher-level branches ABOVE L1** per the plan's L9>L1 priority. (The existing Session 23 branches also aren't strictly L9>L1, so the codebase tolerates this.)
3. **`+spellcasting mod` fallback.** v1 has no generic spellcasting-ability field on `Combatant`. Spellfire Flare (and future spells) fall back to a per-spell-class mod (CHA for Sorcerer, INT for Wizard, WIS for Cleric). Documented per-spell in metadata.
4. **Spray of Cards damage type.** The plan spec says `slashing`; BMT/SPELL_DB lists `force` in some entries. v1 follows the plan (`slashing`). Verify against canon if a correction is desired.
5. **Conditions persist for combat.** `blinded`/`poisoned`/`prone` from Session 24 spells persist for the v1 combat duration (no end-of-turn expiry hook) — same gap as Sunburst/Blindness. Documented per-spell.
6. **Witch Bolt "ends on other action" guard** is at the top of `combat.ts` `executePlannedAction`. It's a no-op for all existing tests (no prior test had a caster concentrating on Witch Bolt). If a future concentration-DoT spell is added, generalize this guard (e.g., a `concentration.spellName` allowlist of "ends on other action" spells).

### Removal script

`scripts/remove_migrated_spells_s24.py` is idempotent. To remove the next batch's spells, append `(canonical, snake, alias)` tuples to its `SPELLS` list and re-run. It reports already-removed spells as warnings (non-fatal).

---

## PAT / SECURITY NOTE

The GitHub PAT provided by the user is stored in `.git/config` (remote URL) for push auth — NOT in any tracked file (verified via `git ls-files | rg github_pat_`). The user should **rotate this PAT** after the megabatch completes, as it was shared in plaintext in the launch message.
