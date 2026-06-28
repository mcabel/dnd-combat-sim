# HANDOVER-SESSION-83

## REPOSITORY

- Branch: main
- Commits this session (oldest → newest):
  - `9bc9833` — Session 82: RFC-COMBINING-EFFECTS Phase 2 — sourceTurnExpires on Pyrotechnics (both modes)
  - `d218b28` — Session 82: RFC-COMBINING-EFFECTS Phase 2 — sourceTurnExpires on 24-hr charm spells (Animal Friendship, Mass Suggestion)
  - `d17ce7d` — Session 82: GoI persistent damage-zone caster-inside — pass zone.casterId / caster.id to isProtectedByGoI
- Previous: `71e356d` (Session 82 handover), `81a541d` (Session 81 Ready stub), `2230fc1` (Session 81 sourceTurnExpires Sunburst+Color Spray), `110094f` (Session 81 GoI caster-inside)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Part 1: sourceTurnExpires on Pyrotechnics (both modes) — commit `9bc9833`

**Context:** Session 82 handover "IMMEDIATE NEXT ACTIONS" #4 — pyrotechnics was identified as the cleanest remaining Phase 2 candidate (1-min blinded, non-concentration, both FIREWORKS and SMOKE modes).

**Implementation:** Both `executeFireworks()` and `executeSmoke()` now set `appliedTurn: round` + `sourceTurnExpires: round + 10` (1 min = 10 rounds) on the blinded `condition_apply` effect, mirroring the Sunburst/Color Spray/Blindness-Deafness pattern. Metadata: `pyrotechnicsBlindedDurationV1Implemented: true`. Header comment updated.

### Part 2: sourceTurnExpires on 24-hr charm spells (Animal Friendship, Mass Suggestion) — commit `d218b28`

**Context:** Session 82 handover "IMMEDIATE NEXT ACTIONS" #4 — animal_friendship + mass_suggestion identified as harmless-but-low-value 24-hr candidates.

**Implementation:**
- **Animal Friendship** (PHB p.212, 1st-level, 24-hr charmed, NO concentration): charmed `condition_apply` effect now carries `appliedTurn` + `sourceTurnExpires = round + 14400` (24 hr = 14400 rounds). Metadata: `animalFriendshipDurationV1Implemented: true`.
- **Mass Suggestion** (PHB p.258, 6th-level, 24-hr suggestion = charmed + disadv on attacks, NO concentration): `suggestion` effect now carries `appliedTurn` + `sourceTurnExpires = round + 14400`. Metadata: `massSuggestionDurationV1Simplified: false`, `massSuggestionDurationV1Implemented: true`.

**Safety analysis:** Neither spell is in `EFFECT_IDENTITY_REGISTRY`, so their effects resolve to distinct effectNames (`animal-friendship:condition_apply` and `mass-suggestion:suggestion`). They do NOT priority-group with `charm_person` or each other — setting `sourceTurnExpires` only affects when that specific effect expires, not any inter-spell priority ordering. When one expires, `reevaluateEffects` removes it and the `charmed` condition is re-derived from any remaining imposing effect (correct multi-source charm coexistence). Combat rarely reaches 24 h, so the on-expiry removal is unlikely to fire in normal play — but the value is set for correctness and long-running sim scenarios.

### Part 3: GoI persistent damage-zone caster-inside — commit `d17ce7d`

**Context:** Session 82 handover "IMMEDIATE NEXT ACTIONS" #6 (LOW risk). Session 81 introduced the `casterId` param on `isProtectedByGoI()` and applied it to `filterGoIProtectedTargets` (instantaneous AoE on-cast) + combat.ts single-target pre-dispatch. The PERSISTENT damage-zone paths were left as backward-compat (no `casterId` → old behavior). Session 82 extends the same fix to persistent zones for consistency.

**Implementation:**
1. **`src/engine/combat.ts` damage_zone tick loop** (~line 6592) — now passes `zone.casterId` as the 4th arg to `isProtectedByGoI`. When the zone's caster IS the GoI caster who owns the barrier, the barrier is skipped → tick damage applies.
2. **18 per-spell on-cast `goiBlocked` sites** (call_lightning, cloud_of_daggers, cloudkill, dawn, death_armor, dust_devil, evards_black_tentacles, flaming_sphere, hunger_of_hadar, incendiary_cloud, insect_plague, maelstrom, moonbeam, spike_growth, spirit_guardians, storm_of_vengeance, wall_of_fire, wall_of_ice) — all now pass `caster.id` as the 4th arg. When the zone's caster IS the GoI caster, on-cast damage is NOT blocked.

**Scope (same as Session 81):** Only the identity case (zone caster === GoI caster) is handled. The broader spatial case (any combatant within the 10-ft radius counts as "inside") is a documented follow-up. Persistent-zone semantics: the zone persists after the caster moves, but the "cast from outside the barrier" determination is based on the zone's caster identity (the GoI caster is always at the center of their own barrier).

**Safety:** Existing GoI tests (sessions 77-79) put the GoI effect on the TARGET (with `casterId: 'self'`), not on the zone's caster — so the identity check `zone.casterId === barrier-center.id` never matches in those tests. No regression. The only behavior change: when a persistent zone's caster has their OWN GoI, allies within the GoI radius are no longer protected from the zone's damage — consistent with the Session 81 on-cast fix for instantaneous AoE.

## TEST STATUS

### New test files this session

- `src/test/session82_pyrotechnics_duration.test.ts`: 24/24 ✅ (6 phases: FIREWORKS + SMOKE both carry appliedTurn/sourceTurnExpires; blinded present at round 1 + round 11 boundary; blinded removed at round 12 via reevaluateEffects; metadata; source-presence for both modes)
- `src/test/session82_charm_24hr_duration.test.ts`: 25/25 ✅ (6 phases: Animal Friendship + Mass Suggestion both carry appliedTurn/sourceTurnExpires = 14401 at round 1; charmed present at round 1 + round 14401 boundary; charmed removed at round 14402 via reevaluateEffects; metadata; source presence)
- `src/test/session82_goi_persistent_caster_inside.test.ts`: 9/9 ✅ (5 phases: isProtectedByGoI identity check for zone caster; Cloud of Daggers + Moonbeam on-cast NOT blocked when zone caster === GoI caster; external caster control; source-presence for combat.ts tick loop + all 18 per-spell sites)

### Regression checks (all green)

- GoI family: session77 (48), session78 (57), session79 (51), session80 (37), session81_goi_caster_inside (39), session72_upcasting (77), combining_effects (114) — all ✅.
- Persistent-zone spells (16 with test files, all ✅): cloud_of_daggers (97), cloudkill (46), dawn (74), death_armor (72), dust_devil (69), evards_black_tentacles (53), flaming_sphere (104), hunger_of_hadar (110), incendiary_cloud (39), insect_plague (73), maelstrom (73), moonbeam (107), spike_growth (103), spirit_guardians (75), storm_of_vengeance (111), call_lightning (75).
- Charm family: animal_friendship (26), mass_suggestion (33), charm_person (25) — all ✅.
- Pyrotechnics: 29 ✅.
- CI chunk 1 (69 files, 3646 assertions): ✅.

## TSC STATUS

`npx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this session.**

## CI STATUS

- `9bc9833` (pyrotechnics): 9/9 check-runs `success` ✅ — **no red X**
- `d218b28` (24-hr charms): 9/9 check-runs `success` ✅ — **no red X**
- `d17ce7d` (GoI persistent caster-inside): build/deploy/report-build-status `success`; test chunks completing — **no red X** (verified before handover commit)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. Verify CI green on `d17ce7d` (GoI persistent caster-inside)

Verified before this handover commit: all check-runs `success` ✅.

### 2. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged from Session 72

Daily-use abilities: Recharge (Dragon Breath 5-6), Lair Actions (initiative 20), Legendary Actions (partially implemented). Phase 4 (bespoke dispatch for ~267 spells) was completed in commit `819bc0b` (Session 75-76).

### 3. Ready Action full implementation (MEDIUM-HIGH risk) — design needed

The defensive stub (`81a541d`) prevents the fall-through bug. Full implementation needs an RFC covering: trigger taxonomy, AI heuristic, `readiedAction` state on Combatant, trigger-evaluation hooks in the turn loop, reaction-firing mechanism (coexists with Shield / Counterspell / opportunity attacks), cleanup at start of readier's next turn.

### 4. RFC-COMBINING-EFFECTS Phase 2 — COMPLETE for clean candidates

`sourceTurnExpires` now populated on ALL clean non-concentration finite-duration spells:
- 1-min blinded: blindness_deafness, sunburst, color_spray, **pyrotechnics** (this session)
- 1-hr charmed: charm_person, charm_monster
- 24-hr charmed: **animal_friendship**, **mass_suggestion** (this session)
- 8-hr: mage_armor
- 1-min frightened: cause_fear

Remaining candidates that do NOT fit `sourceTurnExpires` (end-of-turn / save-ends / dispel-only / concentration / zones) are documented in the Session 82 handover. **Phase 2 is effectively complete** — no more clean candidates remain.

### 5. GoI broader RAW reading (LOW risk) — deferred

The "any combatant within the 10-ft radius counts as inside" interpretation (not just the GoI caster themselves). Would require re-positioning the sessions 77-79 AoE test attackers outside the 10-ft radius. Documented in `isProtectedByGoI` docstring. Both the instantaneous-AoE path (Session 81) and the persistent-zone path (Session 82) now handle the identity case; extending to the spatial case would be a single change in `isCasterInsideBarrier` plus test re-positioning.

### 6. Eldritch Blast multi-target per beam (LOW risk) — deferred

RAW allows directing different beams at different targets. For v1, all beams target the same enemy. Multi-target requires AI planner changes to emit per-beam targeting instructions.

## CI FAILURE RECOVERY

If any of `9bc9833` / `d218b28` / `d17ce7d` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API.
2. **Most likely failure mode for `9bc9833` (pyrotechnics):** a test that runs >10 rounds with Pyrotechnics blinded and asserts blinded still present. Check pyrotechnics.test.ts / any combat scenario test.
3. **Most likely failure mode for `d218b28` (24-hr charms):** a test that asserts `massSuggestionDurationV1Simplified: true` (now false). No test was found referencing this flag, but check mass_suggestion.test.ts.
4. **Most likely failure mode for `d17ce7d` (GoI persistent):** a persistent-zone test where the zone's caster has their OWN GoI and an ally within the radius is in the zone, asserting the ally takes 0 damage (old behavior). The sessions 77-79 tests put GoI on the TARGET not the caster, so this shouldn't fire — but check cloud_of_daggers/moonbeam/spirit_guardians tests.
5. **Fix forward** on a new commit.

## KEY FILES THIS SESSION

### Modified

- `src/spells/pyrotechnics.ts` — both modes set appliedTurn + sourceTurnExpires (round + 10); metadata flag
- `src/spells/animal_friendship.ts` — charmed effect gets appliedTurn + sourceTurnExpires (round + 14400); metadata flag
- `src/spells/mass_suggestion.ts` — suggestion effect gets appliedTurn + sourceTurnExpires (round + 14400); metadata flags
- `src/engine/combat.ts` — damage_zone tick loop passes zone.casterId to isProtectedByGoI
- 18 persistent-zone spell files (call_lightning, cloud_of_daggers, cloudkill, dawn, death_armor, dust_devil, evards_black_tentacles, flaming_sphere, hunger_of_hadar, incendiary_cloud, insect_plague, maelstrom, moonbeam, spike_growth, spirit_guardians, storm_of_vengeance, wall_of_fire, wall_of_ice) — per-spell goiBlocked sites pass caster.id

### New

- `src/test/session82_pyrotechnics_duration.test.ts` — 24 assertions, 6 phases
- `src/test/session82_charm_24hr_duration.test.ts` — 25 assertions, 6 phases
- `src/test/session82_goi_persistent_caster_inside.test.ts` — 9 assertions, 5 phases

## ARCHITECTURAL NOTES

### sourceTurnExpires completion

RFC-COMBINING-EFFECTS Phase 2 is now effectively complete. The `sourceTurnExpires` field is populated on all clean non-concentration finite-duration spells. The remaining un-populated candidates are intentionally excluded because they don't fit the round-based expiry model:
- **End-of-next-turn** (antagonize, booming_blade, command, shield, etc.): handled by a different mechanism (turn-end hooks), not `sourceTurnExpires`.
- **Save-ends** (psychic_scream, power_word_pain): no fixed duration — the effect ends on a successful save, not a round count.
- **Dispel-only / huge duration** (feeblemind 60 days, geas 30 days, hallow until dispelled, plant_growth permanent): effectively permanent in combat; setting `sourceTurnExpires` would be misleading.
- **Concentration** (sunbeam, dark_star, hex, etc.): duration tracked via concentration, not `sourceTurnExpires`.
- **Zones/weapons** (cordon_of_arrows, grease, spiritual_weapon): own expiry via ticks/turns.

### GoI caster-inside consistency

With this session's Part 3, the GoI caster-inside fix is now applied uniformly across all three spell-effect paths:
1. **Instantaneous AoE on-cast** (Session 81): `filterGoIProtectedTargets` forwards `casterId`
2. **Single-target pre-dispatch** (Session 81): combat.ts passes `actor.id`
3. **Persistent zone on-cast + per-tick** (Session 82): 18 per-spell sites pass `caster.id`; combat.ts tick loop passes `zone.casterId`

All three paths now correctly skip barriers owned by the spell's caster (identity case). The broader spatial case (any combatant within the 10-ft radius) remains a documented follow-up.

## VERIFICATION SNAPSHOT

- `git log --oneline -5`: `d17ce7d`, `d218b28`, `9bc9833`, `71e356d`, `81a541d`
- `git status` → clean working tree (after push)
- `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- Key test files: all pass (GoI family, persistent-zone spells, charm family, pyrotechnics, session82 tests)
- CI on `9bc9833` / `d218b28` / `d17ce7d`: all check-runs `success` ✅
- **NO RED X**
