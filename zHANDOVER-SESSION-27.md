# zHANDOVER-SESSION-27 (Option C + MEGABATCH COMPLETE)

> Resume of workstream from zHANDOVER-SESSION-26.md.
> Repo: https://github.com/mcabel/dnd-combat-sim
> Branch: `main` (latest commit `e5ee3a9`)
> Follows: zHANDOVER-SESSION-26.md, MEGABATCH-MIGRATION-PLAN.md

---

## TL;DR

- **User chose Option C (both)**: LOW-difficulty canon fixes (Option B) + Batch 3 (Option A), then continue with megabatch.
- **Session 27 delivered 4 commits** (all pushed to `main`):
  1. `a8fc25a` — 6 LOW-difficulty canon fixes (Option B).
  2. `8bacba6` — Batch 3 engine foundation (3 new engine mechanisms).
  3. `8da7619` — Batch 3 COMPLETE (23 concentration buffs).
  4. `e5ee3a9` — Batch 4 COMPLETE (22 persistent zones + healing + temp HP).
- **MEGABATCH COMPLETE**: 124 spells migrated (44 B1 + 35 B2 + 23 B3 + 22 B4). Registry reduced from 299 → 175 spells. All 4 batches of MEGABATCH-MIGRATION-PLAN.md done.
- **Tests**: 51 new test files this session (6 canon-fix + 23 B3 + 22 B4), ~2,289 new assertions, all 0 failures. tsc clean (0 non-TS7006 errors). No regressions in any reference test.
- **Next pickup**: the megabatch plan is exhausted. Remaining work is (a) the HIGH-difficulty canon deviations from zHANDOVER-SESSION-26 § "Other flagged deviations" (command 5-options, bestow_curse 4-options, eyebite, contagion/flesh_to_stone 3-save trackers, dominate_* control-override, reverse_gravity fall, catnap short-rest) — all need new engine subsystems; OR (b) the 131 DEFERRED blocker spells (need new engine subsystems per TEAMGOALS.md); OR (c) a full regression/canon audit pass.

---

## USER INSTRUCTION (this session)

> Resume the workstream from zHANDOVER-SESSION-26.md. User chooses option c (both). If it's possible to do a megabatch after that, continue with that before next zhandover.

Executed: Option C (canon fixes + Batch 3), then continued with Batch 4 (megabatch completion).

---

## COMMIT 1: LOW-DIFFICULTY CANON FIXES (Option B, commit `a8fc25a`)

6 spells fixed per zHANDOVER-SESSION-26 § "Recommendation for the user" (LOW-difficulty subset):

| # | Spell | Canon fix | Files |
|---|-------|-----------|-------|
| 1 | **fear** | Canon concentration (PHB p.239) — was non-conc per plan; now `startConcentration` + conc-sourced frightened | fear.ts, fear.test.ts |
| 2 | **whirlwind** | Canon 7d8 bludgeoning damage (PHB p.298) — was dropped per plan; now rolled + half-on-save (mirrors Sunburst) | whirlwind.ts, whirlwind.test.ts |
| 3 | **pyrotechnics** | 2-mode picker (XGE p.162) — fireworks (CON save or blinded, default) + smoke (no save, all blinded); `executeSmoke()` exposed | pyrotechnics.ts, pyrotechnics.test.ts |
| 4 | **animal_friendship** | TG-004 beast-only + INT<4 enforcement (PHB p.212) — new `creatureType` field on Combatant | animal_friendship.ts, animal_friendship.test.ts, core.ts, fivetools.ts, pc.ts |
| 5 | **charm_person** | TG-004 humanoid-only enforcement (PHB p.221) | charm_person.ts, charm_person.test.ts |
| 6 | **bestow_curse** | Canon Touch range (5 ft) (PHB p.214) — was 60 ft per plan | bestow_curse.ts, bestow_curse.test.ts |

**Engine addition**: `creatureType?: string` field on Combatant (core.ts). Set from bestiary `raw.type` in fivetools.ts (e.g. 'beast', 'humanoid', 'undead'); set to 'humanoid' for PCs in pc.ts. Backward-compatible (optional). Used by animal_friendship (beast-only) + charm_person (humanoid-only). Future: dominate_beast, dominate_person could enforce it too.

**Test growth**: 110 → 156 assertions across the 6 suites. fear 18→23, whirlwind 20→32, pyrotechnics 19→29, animal_friendship 17→26, charm_person 17→25, bestow_curse 19→21.

---

## COMMIT 2: BATCH 3 ENGINE FOUNDATION (commit `8bacba6`)

3 backward-compatible engine extensions to support Batch 3's effect types:

### 2a. `bane_die` effect type (inverse of `bless_die`)
- New `SpellEffectType = 'bane_die'` (core.ts). Payload reuses `dieSides` (e.g. 4 for -1d4).
- `getActiveBaneDie(c)` in spell_effects.ts (mirror getActiveBlessDie).
- Consumption: subtracted from attack rolls (combat.ts, after bless_die) + saving throws (utils.ts rollSave, after bless_die). For Bane (PHB p.219: -1d4 to attacks/saves).

### 2b. `_nextHitRider` scratch field (for the 11 smite spells)
- New optional scratch field on Combatant (core.ts): `{ spellName, dieSides, count, damageType, condition? } | null`.
- Consumption block in combat.ts resolveAttack (after Branding Smite): on the caster's next weapon hit (melee/ranged), rolls `count`d`dieSides` of `damageType` (crit doubles — PHB p.196), adds to damage, applies optional `condition` to the target hit (sourceIsConcentration: true), then clears the rider (one-shot).
- Stale-rider guard: if `caster.concentration.spellName !== rider.spellName`, the rider is cleared without applying (concentration broke).
- Each smite's `cleanup()` clears its own rider if concentration ended.

### 2c. `weapon_enchant` damage-dice payload extension
- New payload fields (core.ts): `damageDie`, `damageDieCount`, `damageDieType` (alongside existing `attackBonus`, `damageBonus`).
- `getActiveWeaponEnchant(c)` extended to return `{ attackBonus, damageBonus, damageDie, damageDieCount, damageDieType }`.
- Consumption in combat.ts resolveAttack damage branch (after the flat damageBonus): rolls `damageDieCount`d`damageDie` of `damageDieType` (crit doubles). For Divine Favor (+1d4 radiant), Holy Weapon (+5d8 radiant), Elemental Weapon (+1d4 fire), Flame Arrows (+1d6 fire), Shadow Blade (+2d8 psychic).

All 3 extensions are backward-compatible (optional fields, default-0 queries, no-op when absent). Reference tests unaffected: bless 37/0, hex 27/0, magic_weapon 53/0, faerie_fire 29/0, barkskin 38/0, enlarge_reduce 60/0, combat (RNG 45-56, 0 fail).

---

## COMMIT 3: BATCH 3 COMPLETE — 23 CONCENTRATION BUFFS (commit `8da7619`)

Migrated all 23 concentration-buff spells from Session 20 forward-compat stubs to bespoke implementations.

| Category | Count | Spells | Effect mechanism |
|----------|-------|--------|------------------|
| BUFF_BLESS_DIE | 2 | bane, motivational_speech | bane_die (new) / bless_die + temp HP |
| BUFF_HEX_RIDER (smites) | 11 | ensnaring_strike, hail_of_thorns, searing_smite, thunderous_smite, wrathful_smite, zephyr_strike, blinding_smite, lightning_arrow, spirit_shroud, staggering_smite, banishing_smite | `_nextHitRider` scratch (one-shot next-hit damage + optional condition) |
| BUFF_WEAPON_ENCHANT | 6 | divine_favor, shadow_blade, elemental_weapon, flame_arrows, holy_weapon, swift_quiver | `weapon_enchant` with new damageDie/damageDieCount/damageDieType |
| BUFF_ADVANTAGE_VS | 4 | beacon_of_hope, intellect_fortress, holy_aura, foresight | `grantSelf` (real advantage on own rolls) + `advantage_vs` sentinel for conc-break cleanup |

**Integration**: core.ts +23 PlannedAction types; combat.ts +23 imports +23 case branches (6 Combatant[] signature + 17 boolean self-buff); planner.ts +23 imports +23 branches (12CP–12DB, priority L9→L1); _generic_registry.ts removed all 23 via `scripts/remove_migrated_spells_s27.py`; bulk_spell_dispatch.test.ts added section 1f (23 S27 spells), lowered floor 220→197.

**Tests**: 23 new test files, 823 assertions, 0 failures. tsc clean.

**Note on advantage_vs spells**: the subagent discovered that `advantage_vs` (via `grantVulnerability`) only grants advantage to ATTACKERS vs the target, NOT the target's own rolls. For ally-self-advantage buffs (Beacon of Hope etc.), the correct mechanism is `grantSelf(target, scope)` (writes to `target.advantages`, read by `querySelf` in rollSave). The `advantage_vs` effect is used as a SENTINEL for concentration-break cleanup (removeBySource purges both advantages + vulnerabilities). Foresight's `'all'` scope required special handling: the sentinel uses narrow scope `'save'` to avoid granting attackers advantage (scopeMatches('all','attack')=true would be wrong).

---

## COMMIT 4: BATCH 4 COMPLETE — 22 PERSISTENT ZONES + HEALING + TEMP HP (commit `e5ee3a9`)

Migrated all 22 persistent-damage-zone, healing, and temp-HP spells.

| Category | Count | Spells | Effect mechanism |
|----------|-------|--------|------------------|
| PERSISTENT_DAMAGE_ZONE | 11 | death_armor, dust_devil, healing_spirit, cacophonic_shield, call_lightning, hunger_of_hadar, spirit_guardians, guardian_of_faith, dawn, insect_plague, storm_of_vengeance | `damage_zone` effect (per-target start-of-turn tick). Dual-damage (hunger_of_hadar, storm_of_vengeance) via TWO damage_zone effects. Guardian of Faith = one-shot 20d6 (no tick). Healing Spirit = one-shot heal (tick can't heal). |
| HEALING | 9 | goodberry, wither_and_bloom, aura_of_vitality, mass_healing_word, mass_cure_wounds, heal, regenerate, mass_heal, power_word_heal | `applyHeal` (capped at maxHP). Wither and Bloom = dual-target (enemy damage + ally heal). Mass Heal = 700 HP round-robin split. Power Word Heal = full HP + 5 condition removals. |
| TEMP_HP | 2 | armor_of_agathys, false_life | `caster.tempHP = Math.max(tempHP, amount)` (PHB p.198: doesn't stack) |

**Integration**: core.ts +22 PlannedAction types; combat.ts +22 imports +22 case branches (16 Combatant[] + 4 Combatant|null + 2 boolean); planner.ts +22 imports +22 branches (12DC+, priority L9→L1); _generic_registry.ts removed all 22 via `scripts/remove_migrated_spells_s28.py`; bulk_spell_dispatch.test.ts added section 1g (22 S28 spells), lowered floor 197→175, swapped sample Spirit Guardians→Gaseous Form (Spirit Guardians now bespoke).

**Tests**: 22 new test files, 1320 assertions, 0 failures. tsc clean.

---

## TEST RESULTS (all green)

| Suite | Result |
|-------|--------|
| `tsc --noEmit` (excl. TS7006) | clean (0 errors) |
| bulk_spell_dispatch | **214 passed, 0 failed** (was 171 at session start; +43 for S27+S28 sections, -sample-swap delta) |
| combat | 45–56 passed, 0 failed (RNG variance — pre-existing) |
| ai | 26/0 |
| concentration_ai | 34/0 |
| spell_actions | 52/0 |
| color_spray | 57/0 |
| moonbeam | 107/0 |
| cloud_of_daggers | 97/0 |
| healing_word | 41/0 |
| prayer_of_healing | 48/0 |
| bless / hex / magic_weapon / faerie_fire / barkskin / enlarge_reduce | 37/27/53/29/38/60 — all 0 fail |
| 6 canon-fix suites (fear, whirlwind, pyrotechnics, animal_friendship, charm_person, bestow_curse) | 23/32/29/26/25/21 — all 0 fail |
| 23 Batch 3 suites | 823 total, all 0 fail |
| 22 Batch 4 suites | 1320 total, all 0 fail |

---

## MEGABATCH STATUS: COMPLETE

| Batch | Session | Spells | Cumulative |
|-------|---------|--------|------------|
| Batch 1 (combat damage) | Cantrip-24 | 44 | 44 |
| Batch 2 (save-or-condition) | Cantrip-25 | 35 | 79 |
| Batch 3 (concentration buffs) | Cantrip-27 | 23 | 102 |
| Batch 4 (zones + healing + temp HP) | Cantrip-27 | 22 | **124** |

**Generic registry**: 299 → 175 spells (124 migrated to bespoke + 7+7 earlier). The `bulk_spell_dispatch.test.ts` tracks all 124 via sections 1b–1g. Floor assertion: `SPELL_COUNT >= 175`.

All 4 batches of MEGABATCH-MIGRATION-PLAN.md are complete. The plan's in-scope non-blocker spells are fully migrated.

---

## NEXT PICKUP OPTIONS

The megabatch plan is exhausted. Remaining work:

### Option A: HIGH-difficulty canon deviations (from zHANDOVER-SESSION-26 § "Other flagged deviations")
These 12 deviations need NEW engine subsystems (rated HIGH difficulty in the prior handover):
- **command** (5 command options — approach/drop/flee/grovel/halt, each different effect)
- **bestow_curse** (4 curse options — disadv-on-attacks-vs-you, disadv-on-ability, save-or-incapacitated, +1d8 necrotic rider)
- **eyebite** (per-turn re-target + choice of Asleep/Panicked/Sickened)
- **contagion** / **flesh_to_stone** (3-fail-save disease/petrification trackers)
- **dominate_beast** / **dominate_person** / **dominate_monster** (telepathic control-override AI hook)
- **mass_suggestion** (suggestion effect type — follow-a-suggestion, not just charmed)
- **reverse_gravity** (fall-upward + fall-back damage — needs vertical-position tracking)
- **catnap** (short-rest subsystem — heal hit dice, recharge short-rest abilities)
- **antagonize** (taunt effect — disadv on attacks vs anyone but caster)
- **watery_sphere** / **sleet_storm** / **grease** (persistent-terrain subsystem)
- **reverse_gravity** (fall mechanics)

These are substantial engine features. Recommend tackling 1–2 per session with user consultation on the desired canon behavior.

### Option B: DEFERRED blocker spells (131 spells)
Per MEGABATCH-MIGRATION-PLAN.md § "DEFERRED SPELLS", 131 spells require new engine subsystems documented in TEAMGOALS.md (e.g. mounted combat, true invisibility, poison/disease tracks, wall terrain, verticality). These are long-term goals.

### Option C: Full regression / canon audit pass
Run the entire test suite (all ~150 test files) to confirm no latent regressions, then do a canon-faithfulness audit of the 124 migrated spells against their PHB/XGE source text. Could surface additional simplifications to fix (like the Color Spray fix in Session 26).

---

## KNOWN ISSUES / NOTES

1. **combat.test.ts RNG variance**: the combat test's assertion count varies between runs (45–56) due to RNG-dependent conditional assertions. 0 failures consistently. Pre-existing — not a regression.

2. **Swift Quiver** (Batch 3): modelled as a weapon_enchant MARKER with all-zero bonuses. The canon bonus-action extra attack is NOT modelled (no bonus-action-attack subsystem). LOW tactical value in v1. Documented via `swiftQuiverBonusActionAttackV1NotModelled: true`.

3. **Healing Spirit / Aura of Vitality** (Batch 4): canon are per-turn bonus-action re-heal auras. v1 models as one-shot heal on cast (the damage_zone tick can't heal, and there's no bonus-action-attack/heal hook). Documented via `healingSpiritPerTurnRehealV1SimplifiedToOneShot` / `auraOfVitalityPerTurnRehealV1Simplified`.

4. **Guardian of Faith** (Batch 4): canon has a 20d6 damage budget (zone disappears once depleted). v1 models as one-shot 20d6 to all enemies in 10 ft (no per-turn tick, no budget tracking). Documented via `guardianOfFaithDamageBudgetV1SimplifiedToOneShot`.

5. **Damage-zone auras** (Death Armor, Dust Devil, Spirit Guardians, Cacophonic Shield): the damage_zone is applied to enemies present at cast time. Enemies who enter the aura LATER are not affected (v1 simplification — no dynamic aura re-evaluation). Documented via per-spell metadata flags.

6. **Concurrent workstream**: The Sheet-33 workstream (artificer class + test fixes) may push commits. Always `git pull --rebase` before pushing.

7. **PAT**: stored in `/home/z/dnd-combat-sim/.git/config` (remote URL) for push auth. The sandbox may reset between sessions — if `/home/z/dnd-combat-sim` is gone, re-clone with the PAT from the original launch message.

8. **Subagent-generated Batch 4 modules**: the Batch 4 spell modules were initially created by parallel subagents (Task IDs 4-a, 4-b). The orchestrator verified all 22 modules against the spec, fixed the `wither_and_bloom` missing flag, and performed the full integration (registry removal, case branches, planner branches, types, bulk test). All tests pass.

---

## TIME ACCOUNTING

- **Session 27 wall-clock**: ~major session.
  - Option B (6 canon fixes): ~40 min.
  - Batch 3 engine foundation + 23 spells + integration: ~50 min (3 subagents in parallel for spell modules).
  - Batch 4 (22 spells) + integration: ~30 min (2 subagents in parallel).
- **Total new tests**: 51 test files, ~2,289 new assertions.
- **Commits**: 4 (a8fc25a, 8bacba6, 8da7619, e5ee3a9), all pushed to `main`.

---

## SUMMARY

Session 27 executed Option C (both): 6 LOW-difficulty canon fixes + Batch 3 (23 concentration buffs), then continued the megabatch with Batch 4 (22 persistent zones + healing + temp HP). The megabatch is now COMPLETE — 124 spells migrated across Batches 1–4, with the generic registry reduced from 299 to 175 spells. Three new backward-compatible engine mechanisms were added (bane_die effect, _nextHitRider scratch field, weapon_enchant damage-dice payload). All 51 new test files pass (2,289 assertions, 0 failures); tsc is clean; no regressions.

The next session can pick up the HIGH-difficulty canon deviations (12 spells needing new engine subsystems), the 131 deferred blocker spells, or a full regression/canon audit pass.
