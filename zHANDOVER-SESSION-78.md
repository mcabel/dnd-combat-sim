# HANDOVER-SESSION-78

## REPOSITORY

- Branch: main
- Commit: fa62943 (pushed)
- Previous: 11cd55f (Session 77 handover)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Session 78: GoI AoE exclusion for 12 more spells + persistent tick filtering

**Commit:** `fa62943` — `Session 78: GoI AoE exclusion for 12 more spells + persistent tick filtering`

**Context:** Session 77 added GoI AoE exclusion for 5 core instantaneous damage spells (fireball, lightning_bolt, burning_hands, shatter, thunderwave). The Session 77 handover's "IMMEDIATE NEXT ACTIONS" #2 listed 12 more spells that still bypass GoI. This session implements all 12 + adds per-tick GoI filtering for persistent damage_zone effects in combat.ts.

**PHB p.245 reference:** "Any spell of 5th level or lower cast from outside the barrier can't affect creatures or objects within it, even if the spell is cast using a higher spell slot. Such a spell can target creatures and objects within the barrier, but the spell has no effect on them." — This applies to ALL spell effects (damage, conditions, persistent ticks), not just instantaneous damage.

### Spells covered (12 total, in 4 categories)

#### Category 1: Simple multi-target AoE (on-cast filter only)

These spells use `filterGoIProtectedTargets(targets, slotLevel, caster.id)` after `consumeSpellSlot()`, then iterate `effectiveTargets` instead of `targets`. The spell still fires (slot consumed, action used, log emitted); protected targets are simply skipped.

| Spell | Level | Save | File |
|---|---|---|---|
| Arms of Hadar | 1 | STR | `src/spells/arms_of_hadar.ts` |
| Ice Knife (cold AoE) | 1 | DEX | `src/spells/ice_knife.ts` |
| Sunburst | 8 | CON + blinded | `src/spells/sunburst.ts` |
| Tidal Wave | 3 | STR + prone | `src/spells/tidal_wave.ts` |
| Guardian of Faith | 4 | none (one-shot) | `src/spells/guardian_of_faith.ts` |

**Ice Knife note:** The piercing attack-roll on the primary target is a separate mechanic (handled by combat.ts's single-target GoI block). The GoI filter only applies to the cold AoE explosion list (`liveExplosion`).

#### Category 2: Multi-target persistent damage_zone (on-cast filter + sourceSlotLevel)

These spells apply the `damage_zone` EFFECT to ALL targets in range (including GoI-protected ones), but skip the ON-CAST damage for GoI-protected targets. The `sourceSlotLevel` is set on each `damage_zone` effect so the combat.ts tick loop can re-check GoI on each per-turn tick.

**Design rationale:** PHB p.245 says "the spell has no effect on them" — the spell is physically present in the area, just suppressed while GoI is active. When GoI expires (concentration breaks), the persistent effect can start ticking. This is more PHB-accurate than simply not applying the effect.

| Spell | Level | Save | damage_zones | File |
|---|---|---|---|---|
| Hunger of Hadar | 3 | none | 2 (cold + acid) | `src/spells/hunger_of_hadar.ts` |
| Call Lightning | 3 | none | 1 (lightning) | `src/spells/call_lightning.ts` |
| Spirit Guardians | 3 | WIS half | 1 (radiant) | `src/spells/spirit_guardians.ts` |
| Dawn | 5 | CON half | 1 (radiant) | `src/spells/dawn.ts` |

**Pattern used (per-target GoI check inside the loop):**
```typescript
for (const target of targets) {
  if (target.isDead || target.isUnconscious) continue;
  const goiBlocked = target.id !== caster.id && isProtectedByGoI(target, slotLevel);
  if (!goiBlocked) {
    // ... on-cast damage ...
  } else {
    emit(state, 'damage', caster.id, `${target.name} is protected by Globe of Invulnerability — on-cast damage negated (persistent effect still applied, will tick when GoI expires).`, target.id, 0);
  }
  // ALWAYS apply damage_zone effect (with sourceSlotLevel)
  applySpellEffect(target, { ..., sourceSlotLevel: slotLevel, ... });
}
```

#### Category 3: Single-target persistent damage_zone (on-cast filter + sourceSlotLevel)

Same pattern as Category 2, but for single-target spells (`execute(caster, target, state)` instead of `execute(caster, targets[], state)`).

| Spell | Level | Save | File |
|---|---|---|---|
| Cloud of Daggers | 2 | none | `src/spells/cloud_of_daggers.ts` |
| Flaming Sphere | 2 | DEX half | `src/spells/flaming_sphere.ts` |

#### Category 4: Non-damage conditions (filterGoIProtectedTargets for conditions)

PHB p.245 blocks ALL spell effects, not just damage. Stinking Cloud applies poisoned + incapacitated conditions — these are also blocked by GoI.

| Spell | Level | Save | Conditions | File |
|---|---|---|---|---|
| Stinking Cloud | 3 | CON | poisoned + incapacitated | `src/spells/stinking_cloud.ts` |

**Stinking Cloud note:** The `terrain_zone` effect (applied to the caster, not the target) also gets `sourceSlotLevel` set, so the combat.ts terrain tick loop can re-check GoI on each per-turn tick. The `filterGoIProtectedTargets` filter is applied to the condition-application loop (not the terrain_zone placement, which uses the original `targets` list to find the center).

### Persistent tick GoI filtering (combat.ts)

**File:** `src/engine/combat.ts` — damage_zone start-of-turn tick loop (~line 6516)

**Change:** Added a GoI check in the tick loop, right after the sentinel check (`dieCount <= 0`) and before the damage roll:

```typescript
const zoneSlotLevel = zone.sourceSlotLevel ?? 0;
if (zoneSlotLevel > 0 && actor.id !== zone.casterId && isProtectedByGoI(actor, zoneSlotLevel)) {
  log(state, 'damage', zone.casterId,
    `${actor.name} is protected by Globe of Invulnerability — ${zone.spellName} start-of-turn damage negated (L${zoneSlotLevel} ≤ GoI threshold).`,
    actor.id, 0);
  // Do NOT skip ticksRemaining decrement — the zone still "ticks"
  // (time passes), it just does no damage.
} else {
  // ... normal damage roll + save + applyDamageWithTempHP + concentration check + death check ...
} // end else
// ticksRemaining decrement runs for BOTH branches (GoI-blocked and normal)
```

**Key design decisions:**

1. **`zoneSlotLevel > 0` guard:** Legacy zones (pre-Session 78, `sourceSlotLevel` undefined) default to 0. The `> 0` guard ensures they are NOT blocked (backward compat). This also handles cantrip-level zones (level 0, never blocked per PHB p.245).

2. **`actor.id !== zone.casterId` guard:** PHB p.245: "cast from outside the barrier" — the GoI caster is at the center, so their own spell's tick doesn't affect them differently. If the actor IS the zone's caster (e.g. a caster standing in their own Cloud of Daggers), the GoI check is skipped.

3. **ticksRemaining decrement runs for both branches:** Timed zones (Cordon of Arrows = 4 ticks, Melf's Acid Arrow = 1 tick) still expire on schedule even while blocked by GoI. Time passes regardless of whether damage is dealt.

4. **`else` block wraps the damage logic:** The damage roll, save, applyDamageWithTempHP, concentration check, and death check are all inside the `else` block. The ticksRemaining decrement is OUTSIDE the `else` block (runs for both branches).

### Metadata updates

**File:** `src/spells/globe_of_invulnerability.ts`

- `globeOfInvulnerabilityAoEV1Simplified: true` — remains true (17 of ~33 damage AoE spells covered; ~16 still bypass GoI)
- `globeOfInvulnerabilityAoEPartialV1Implemented: true` — updated comment to reflect "17 of ~33 damage AoE spells + persistent tick filtering"

**File:** `src/engine/spell_effects.ts`

- `filterGoIProtectedTargets` docstring updated to reflect broader usage (conditions too, not just damage) and Session 78 extension to 12 more spells.

### Tests

**New file:** `src/test/session78_goi_aoe_extension.test.ts` — **56 assertions, 0 failures**

- Phase 1 (5 tests): Simple multi-target AoE on-cast exclusion — arms_of_hadar, ice_knife, sunburst, tidal_wave, guardian_of_faith
- Phase 2 (4 tests): Multi-target persistent damage_zone — hunger_of_hadar, call_lightning, spirit_guardians, dawn (on-cast damage blocked + damage_zone effect applied with sourceSlotLevel)
- Phase 3 (2 tests): Single-target persistent damage_zone — cloud_of_daggers, flaming_sphere
- Phase 4 (1 test): Non-damage conditions — stinking_cloud (poisoned + incapacitated blocked, terrain_zone sourceSlotLevel set)
- Phase 5 (3 tests): Persistent tick GoI filtering logic — isProtectedByGoI behavior, legacy zone backward compat, caster self-exclusion
- Phase 6 (15 tests): Metadata flags verification
- Phase 7 (2 tests): Caster self-GoI exclusion — Arms of Hadar + Cloud of Daggers

### No regressions

All 19 affected test files pass:

| Test file | Assertions |
|---|---|
| arms_of_hadar | 39/39 ✅ |
| hunger_of_hadar | 110/110 ✅ |
| call_lightning | 75/75 ✅ |
| cloud_of_daggers | 97/97 ✅ |
| flaming_sphere | 104/104 ✅ |
| ice_knife | 57/57 ✅ |
| spirit_guardians | 75/75 ✅ |
| guardian_of_faith | 66/66 ✅ |
| dawn | 74/74 ✅ |
| sunburst | 46/46 ✅ |
| tidal_wave | 53/53 ✅ |
| stinking_cloud | 41/41 ✅ |
| session77_goi_aoe_exclusion | 48/48 ✅ |
| session78_goi_aoe_extension | 56/56 ✅ (NEW) |
| combat | all passed ✅ |
| session72_upcasting_system | 77/77 ✅ |
| upcasting_p1 | all passed ✅ |
| dispel_magic | 47/47 ✅ |
| counterspell | all passed ✅ |

**Total: ~1100+ assertions, 0 failures.**

Also verified: concentration_enforcement, concentration_ai, combining_effects, cordon_of_arrows, create_bonfire, bulk_spell_dispatch — all pass.

## TEST STATUS

- `session78_goi_aoe_extension.test.ts`: 56/56 ✅ (NEW)
- `session77_goi_aoe_exclusion.test.ts`: 48/48 ✅
- `arms_of_hadar.test.ts`: 39/39 ✅
- `hunger_of_hadar.test.ts`: 110/110 ✅
- `call_lightning.test.ts`: 75/75 ✅
- `cloud_of_daggers.test.ts`: 97/97 ✅
- `flaming_sphere.test.ts`: 104/104 ✅
- `ice_knife.test.ts`: 57/57 ✅
- `spirit_guardians.test.ts`: 75/75 ✅
- `guardian_of_faith.test.ts`: 66/66 ✅
- `dawn.test.ts`: 74/74 ✅
- `sunburst.test.ts`: 46/46 ✅
- `tidal_wave.test.ts`: 53/53 ✅
- `stinking_cloud.test.ts`: 41/41 ✅
- `combat.test.ts`: all passed ✅
- `session72_upcasting_system.test.ts`: 77/77 ✅
- `upcasting_p1.test.ts`: all passed ✅
- `dispel_magic.test.ts`: 47/47 ✅
- `counterspell.test.ts`: all passed ✅

## TSC STATUS

`bunx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this commit.**

The 5 pre-existing errors are:
- `src/engine/combat.ts(2579,23)` and `(2599,13)` — `Record<string, unknown>` cast on Combatant (pre-existing, documented in Session 72 handover)
- `src/engine/utils.ts(601,6)` — same pattern
- `src/test/monster_spellcasting.test.ts(602,48)` and `(609,51)` — `lich.monsterSpellSlots` possibly undefined (test file; test runner uses `--transpile-only` so these don't fail tests)

## CI STATUS

- Pushed commit `fa62943` to `origin/main`
- 9 check-runs started (6-chunk CI matrix + build + deploy + report-build-status)
- Status at handover write time: **in progress** (build + report-build-status already green; 6 test chunks + deploy running)
- See "Verify CI green" section below — agent should re-check before considering work complete

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. Verify CI green on `fa62943`

Check https://github.com/mcabel/dnd-combat-sim/commit/fa62943 — all 9 check-runs should reach `conclusion: success`. If any check fails, see "CI failure recovery" below.

### 2. Extend GoI AoE exclusion to remaining ~16 damage AoE spells (LOW risk)

The research subagent identified ~16 additional multi-target damage AoE spells that still bypass GoI (not covered by Session 77 or 78):

- `chain_lightning.ts` (L6) — multi-target (up to 4)
- `circle_of_death.ts` (L6) — 60-ft radius
- `cloudkill.ts` (L5) — 20-ft radius + damage_zone + _movingZone
- `cone_of_cold.ts` (L5) — 60-ft cone (loops `inCone`, not `targets`)
- `dark_star.ts` (L8) — 40-ft radius
- `death_armor.ts` (L2) — 5-ft aura + damage_zone
- `destructive_wave.ts` (L5) — 30-ft self-centered
- `dust_devil.ts` (L2) — 5-ft aura + damage_zone
- `earth_tremor.ts` (L1) — 10-ft self-centered
- `earthquake.ts` (L8) — 50-ft self-centered (auto-hit)
- `erupting_earth.ts` (L3) — 20-ft radius
- `evards_black_tentacles.ts` (L4) — 20-ft radius + terrain_zone
- `fire_storm.ts` (L7) — 40-ft radius
- `flame_strike.ts` (L5) — 10-ft radius (dual damage fire+radiant)
- `frost_fingers.ts` (L1) — 15-ft cone
- `gravity_fissure.ts` (L6) — 100-ft line
- `gravity_sinkhole.ts` (L4) — 20-ft radius
- `incendiary_cloud.ts` (L8) — 20-ft radius
- `insect_plague.ts` (L5) — 20-ft radius + damage_zone
- `maddening_darkness.ts` (L8) — 60-ft radius
- `maelstrom.ts` (L5) — 20-ft radius + terrain_zone
- `magnify_gravity.ts` (L1) — 10-ft radius
- `pulse_wave.ts` (L3) — 30-ft cone
- `ravenous_void.ts` (L9) — 60-ft radius (auto-hit)
- `sickening_radiance.ts` (L4) — 30-ft radius + terrain_zone
- `spray_of_cards.ts` (L2) — 15-ft cone
- `storm_of_vengeance.ts` (L9) — 60-ft radius + TWO damage_zone
- `storm_sphere.ts` (L4) — 20-ft radius
- `sunbeam.ts` (L6) — 60-ft line
- `synaptic_static.ts` (L5) — 20-ft radius
- `weird.ts` (L9) — 30-ft radius
- `whirlwind.ts` (L7) — 50-ft cone

**Pattern to apply (same as Session 77/78):**
1. Add `filterGoIProtectedTargets` to the `../engine/spell_effects` import
2. Change `consumeSpellSlot(caster, N);` → `const slotLevel = consumeSpellSlot(caster, N) ?? N;`
3. After consumeSpellSlot: `const effectiveTargets = filterGoIProtectedTargets(targets, slotLevel, caster.id);`
4. Change `for (const target of targets)` → `for (const target of effectiveTargets)`
5. For `cone_of_cold.ts`: filter `inCone` (already a `targets.filter(...)` derivation)
6. For spells with damage_zone effects: set `sourceSlotLevel: slotLevel` on the applySpellEffect call (same as Session 78 persistent spells)
7. For spells with terrain_zone effects (evards_black_tentacles, maelstrom, sickening_radiance): set `sourceSlotLevel: slotLevel` on the terrain_zone effect

**Single-target damage_zone spells also need coverage:**
- `create_bonfire.ts` (cantrip — filter is a no-op for level 0, skip)
- `moonbeam.ts` (L2) — single-target + damage_zone + _movingZone
- `spike_growth.ts` (L2) — single-target + terrain_zone
- `wall_of_fire.ts` (L4) — single-target + damage_zone
- `wall_of_ice.ts` (L6) — single-target + damage_zone

Once all are covered, flip `globeOfInvulnerabilityAoEV1Simplified: false` and remove `globeOfInvulnerabilityAoEPartialV1Implemented`.

### 3. GoI v1 follow-up #2: 10-ft radius (MEDIUM risk)

Currently GoI only protects the caster. PHB p.245: 10-ft radius around the caster. Requires spatial query (chebyshev3D ≤ 2 cells). Apply the same `isProtectedByGoI()` check but for any ally within 10 ft of the GoI caster. Needs a helper `isProtectedByGoIRadius(target, bf, castLevel)` that scans for nearby GoI casters.

### 4. GoI v1 follow-up #3: Eldritch Blast multi-beam (MEDIUM-HIGH risk)

Eldritch Blast currently scales as single-beam damage dice (via `cantripTier`). Per PHB p.237, it should fire 1/2/3/4 beams at levels 1/5/11/17, each an independent attack roll. Requires multi-attack dispatch in `combat.ts`. Already deferred via `eldritchBlastMultiBeamV1Deferred: true`.

### 5. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged from Session 72

Daily-use abilities: Recharge (Dragon Breath 5-6), Lair Actions (initiative 20), Legendary Actions (partially implemented). Phase 4 (bespoke dispatch for ~267 spells) was completed in commit `819bc0b` (Session 75-76).

### 6. Ready Action implementation (MEDIUM-HIGH risk) — unchanged

Currently a STUB in `combat.ts` — the `case 'ready':` falls through.

### 7. RFC-COMBINING-EFFECTS Phase 2 remaining (MEDIUM risk) — unchanged

Some non-concentration spell modules still need `sourceTurnExpires` populated.

## CI FAILURE RECOVERY

If `fa62943` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API:
   ```
   curl -H "Authorization: token $PAT" \
     "https://api.github.com/repos/mcabel/dnd-combat-sim/commits/fa62943/check-runs" \
     | jq '.check_runs[] | select(.conclusion != "success") | {name, conclusion, html_url}'
   ```
2. **Most likely failure mode:** a test file that wasn't in my regression sweep sets up an AoE spell hitting a GoI-protected target and expects the target to take damage. The fix would be to update that test to reflect the new PHB-correct behavior.
3. **Second likely failure:** a tsc error from one of my 12 edited spell files or combat.ts. Verify with `bunx tsc --noEmit 2>&1 | grep -E '(arms_of_hadar|hunger_of_hadar|call_lightning|cloud_of_daggers|flaming_sphere|ice_knife|spirit_guardians|guardian_of_faith|dawn|sunburst|tidal_wave|stinking_cloud|combat)'` — should be empty (only the 5 pre-existing errors should appear).
4. **Third likely failure:** the combat.ts `else` block I added might have a syntax issue that only shows up under certain test configurations. Verify the tick loop braces are balanced.
5. **Fix forward** on a new commit; do NOT amend `fa62943` (preserves CI history).

## KEY FILES THIS SESSION

### Modified

- `src/engine/combat.ts` — added GoI check in damage_zone tick loop (~25 lines, after sentinel check)
- `src/engine/spell_effects.ts` — updated `filterGoIProtectedTargets` docstring
- `src/spells/arms_of_hadar.ts` — added import + filter + slotLevel capture
- `src/spells/ice_knife.ts` — added import + filter on liveExplosion + slotLevel capture
- `src/spells/sunburst.ts` — added import + filter (slotLevel already captured)
- `src/spells/tidal_wave.ts` — added import + filter + slotLevel capture
- `src/spells/guardian_of_faith.ts` — added import + filter + slotLevel capture
- `src/spells/hunger_of_hadar.ts` — added imports + per-target GoI check + sourceSlotLevel on 2 damage_zone effects
- `src/spells/call_lightning.ts` — added imports + per-target GoI check + sourceSlotLevel on damage_zone
- `src/spells/spirit_guardians.ts` — added imports + per-target GoI check + sourceSlotLevel on damage_zone
- `src/spells/dawn.ts` — added imports + per-target GoI check + sourceSlotLevel on damage_zone
- `src/spells/cloud_of_daggers.ts` — added import + per-target GoI check + sourceSlotLevel on damage_zone
- `src/spells/flaming_sphere.ts` — added import + per-target GoI check + sourceSlotLevel on damage_zone
- `src/spells/stinking_cloud.ts` — added import + filter for conditions + sourceSlotLevel on terrain_zone
- `src/spells/globe_of_invulnerability.ts` — updated metadata comment block

### New

- `src/test/session78_goi_aoe_extension.test.ts` — 56 assertions across 7 phases

## ARCHITECTURAL NOTES

### Two-pattern approach for GoI AoE exclusion

**Pattern A (instantaneous spells):** Filter the entire target list before the loop. GoI-protected targets are completely excluded — no damage, no effect. Used by: fireball, lightning_bolt, burning_hands, shatter, thunderwave (Session 77), arms_of_hadar, ice_knife, sunburst, tidal_wave, guardian_of_faith (Session 78).

**Pattern B (persistent damage_zone spells):** Loop over ALL targets. Per-target GoI check: skip on-cast damage if protected, but ALWAYS apply the damage_zone effect (with sourceSlotLevel). The combat.ts tick loop re-checks GoI on each per-turn tick. Used by: hunger_of_hadar, call_lightning, spirit_guardians, dawn, cloud_of_daggers, flaming_sphere (Session 78).

**Why two patterns?** Instantaneous spells have no persistent effect — filtering the list is sufficient. Persistent spells need the effect to be present (so it can tick later when GoI expires), but the damage must be suppressed while GoI is active. The per-target check inside the loop achieves this.

### sourceSlotLevel on damage_zone effects

The `sourceSlotLevel` field (added to `ActiveEffect` in Session 72) is now set on damage_zone effects by all 6 persistent spell modules (hunger_of_hadar, call_lightning, spirit_guardians, dawn, cloud_of_daggers, flaming_sphere) and on the terrain_zone effect by stinking_cloud. The combat.ts tick loop reads `zone.sourceSlotLevel ?? 0` to determine the spell's effective level for the GoI block check.

Legacy damage_zone effects (created before Session 78, sourceSlotLevel undefined) default to 0 — the `zoneSlotLevel > 0` guard in the tick loop ensures they are NOT blocked (backward compat).

### Caster self-exclusion

Both `filterGoIProtectedTargets` and the combat.ts tick loop check `target.id === casterId` (or `actor.id !== zone.casterId`) to implement PHB p.245's "cast from outside the barrier" rule. The GoI caster is at the center of the barrier, so their own spells (even AoE that catches themselves) are NOT blocked.

## VERIFICATION SNAPSHOT

- `git log --oneline -3`: `fa62943`, `11cd55f`, `5f9cd30`
- `git status` → clean working tree (after push)
- `bunx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- 19 affected test files all pass locally (1100+ assertions, 0 failures)
- CI status on `fa62943` at write time: **in progress** (build + report-build-status green; 6 test chunks + deploy running)
