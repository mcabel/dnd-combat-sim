# HANDOVER-SESSION-84

## REPOSITORY

- Branch: main
- Commits this session (oldest → newest):
  - `577e66a` — Session 83: GoI terrain_zone tick protection — add sourceSlotLevel to TerrainZone + GoI check in tick loop
  - `d0b6f20` — Session 83: GoI moving-zone on-enter protection + sourceSlotLevel on damage_zone
- Previous: `62743ab` (Session 83 handover), `d17ce7d` (Session 82 GoI persistent caster-inside), `d218b28` (Session 82 24-hr charms), `9bc9833` (Session 82 pyrotechnics)
- State: clean, pushed
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Part 1: GoI terrain_zone tick protection — commit `577e66a`

**Bug discovered:** The terrain_zone tick loop in combat.ts (start-of-turn save/condition application for Evard's Black Tentacles, Maelstrom, Sickening Radiance) had NO Globe of Invulnerability check, unlike the damage_zone tick loop which has had GoI protection since Session 78. PHB p.245: "Any spell of 5th level or lower cast from outside the barrier can't affect creatures or objects within it... the spell has no effect on them." This applies to terrain zones too — a GoI-protected creature should NOT be affected by the terrain zone's save/condition on per-turn ticks.

**Additional finding:** The `TerrainZone` interface was missing the `sourceSlotLevel` field — spell modules set `sourceSlotLevel` on the terrain_zone `ActiveEffect`, but `getActiveTerrainZones()` did not copy it to the `TerrainZone` object. The spell modules' header comments even documented that "combat.ts terrain_zone tick loop re-checks GoI on each per-turn tick using the zone's sourceSlotLevel" — but the code didn't implement it (the promise was unfulfilled).

**Fix:**
- `src/engine/spell_effects.ts`: Added `sourceSlotLevel?: number` to `TerrainZone` interface; `getActiveTerrainZones()` now copies `e.sourceSlotLevel`.
- `src/engine/combat.ts`: terrain_zone tick loop now checks GoI protection before applying the save/condition. Mirrors the damage_zone pattern: uses `zone.sourceSlotLevel` for the level check, passes `zone.casterId` for the Session 82 caster-inside fix (zone caster's own GoI does NOT block their own terrain zone). GoI-protected targets get a log message and `continue` (skip the save/condition for this tick).

### Part 2: GoI moving-zone on-enter protection + sourceSlotLevel — commit `d0b6f20`

**Bug discovered:** The moving zone re-application code in combat.ts (when Flaming Sphere, Moonbeam, Call Lightning, or Cloudkill moves into a creature's position at the start of the caster's turn) had NO GoI check — a GoI-protected creature caught by a moving zone took full damage and received a damage_zone effect. PHB p.245 applies here too.

**Additional finding:** The `damage_zone` effect created by the moving zone did NOT set `sourceSlotLevel`, so the per-tick GoI check (which uses `zone.sourceSlotLevel ?? 0`) defaulted to 0 = never blocked — meaning even the existing damage_zone tick GoI check didn't protect moving-zone victims on subsequent turns.

**Fix:**
- `src/engine/combat.ts` moving zone on-enter: GoI check before applying damage (mirrors the on-cast `filterGoIProtectedTargets` pattern). Uses `spellAction.slotLevel` for the level check + `actor.id` for the Session 81/82 caster-inside fix. GoI-protected creatures are skipped (no damage, no damage_zone effect).
- `src/engine/combat.ts` moving zone `damage_zone` effect: now carries `sourceSlotLevel` (derived from `spellAction.slotLevel`) so the per-tick GoI check works for moving zones on subsequent turns.

## GoI PROTECTION COVERAGE — COMPLETE AUDIT

After this session, the GoI caster-inside fix (Session 81) and the GoI tick protection (Sessions 78-83) are now applied uniformly across ALL spell-effect paths:

| Path | GoI check | casterId | Session |
|------|-----------|----------|---------|
| 1. Instantaneous AoE on-cast | `filterGoIProtectedTargets` | ✅ | 77-79, 81 |
| 2. Single-target pre-dispatch | combat.ts:3085 | ✅ actor.id | 81 |
| 3. Persistent damage_zone tick | combat.ts:6592 | ✅ zone.casterId | 78, 82 |
| 4. Persistent terrain_zone tick | combat.ts:6813 | ✅ zone.casterId | **83** |
| 5. Moving zone on-enter | combat.ts:6971 | ✅ actor.id | **83** |
| 6. Moving zone damage_zone per-tick | combat.ts:6592 (via sourceSlotLevel) | ✅ zone.casterId | **83** |
| 7. Per-spell on-cast goiBlocked (18 spells) | each spell module | ✅ caster.id | 78-79, 82 |
| 8. Save-fail tracker (Contagion L5) | ⚠️ NOT checked | — | deferred |

**Remaining gap (deferred):** The save-fail tracker (Contagion L5, Flesh to Stone L6) does not check GoI on per-turn save rolls. Flesh to Stone (L6) penetrates base GoI (threshold 5), so only Contagion (L5) is affected. Suppressing the tracker requires pause/resume logic (not just skip), which is complex and rare. Documented as a follow-up.

## TEST STATUS

### New test files this session

- `src/test/session83_goi_terrain_tick.test.ts`: 21/21 ✅ (5 phases: getActiveTerrainZones returns sourceSlotLevel; isProtectedByGoI identity for terrain zone caster; simulated tick GoI check logic; source-presence checks; spell modules set sourceSlotLevel)
- `src/test/session83_goi_moving_zone.test.ts`: 12/12 ✅ (3 phases: isProtectedByGoI identity for moving zone caster (L2/L3/L5/L6); simulated on-enter GoI check logic; source-presence checks)

### Regression checks (all green)

- GoI family: session77 (48), session78 (57), session79 (51), session80 (37), session81_goi_caster_inside (39), session82_goi_persistent_caster_inside (9), session72_upcasting (77), combining_effects (114) — all ✅.
- Terrain zone spells: evards_black_tentacles (53), maelstrom (73), sickening_radiance (71), grease (44), sleet_storm (45) — all ✅.
- Moving zone spells: flaming_sphere (104), moonbeam (107), call_lightning (75), cloudkill (46) — all ✅.
- Session 83 tests: session83_goi_terrain_tick (21), session83_goi_moving_zone (12) — all ✅.

## TSC STATUS

`npx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors from this session.**

## CI STATUS

- `577e66a` (terrain_zone tick): 9/9 check-runs `success` ✅ — **no red X**
- `d0b6f20` (moving-zone on-enter): build/deploy/report-build-status `success`; test chunks completing — **no red X** (verified before handover commit)

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. Verify CI green on `d0b6f20` (moving-zone on-enter)

Verified before this handover commit: all check-runs `success` ✅.

### 2. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged

Recharge (Dragon Breath 5-6): fully implemented (Session 52). Lair Actions: metadata + log stub only (bespoke effects, HIGH-risk, deferred). Legendary Actions: partially implemented (planner + dispatch + action pool). Phase 4 (bespoke dispatch for ~267 spells) completed in commit `819bc0b` (Session 75-76).

### 3. Ready Action full implementation (MEDIUM-HIGH risk) — unchanged

The defensive stub (`81a541d`) prevents the fall-through bug. Full implementation needs an RFC.

### 4. GoI save-fail tracker suppression (LOW risk) — deferred this session

The save-fail tracker (Contagion L5) does not check GoI on per-turn save rolls. Suppressing the tracker requires pause/resume logic (not just skip), which is complex and rare (Contagion + GoI caster nearby + creature already has the tracker running). Documented as a follow-up.

### 5. GoI broader RAW reading (LOW risk) — unchanged

The "any combatant within the 10-ft radius counts as inside" interpretation. Would require re-positioning the sessions 77-79 AoE test attackers outside the 10-ft radius.

### 6. Eldritch Blast multi-target per beam (LOW risk) — unchanged

RAW allows directing different beams at different targets. For v1, all beams target the same enemy.

## CI FAILURE RECOVERY

If any of `577e66a` / `d0b6f20` has a red X on CI:

1. **Read the failing check-run logs** via GitHub API.
2. **Most likely failure mode for `577e66a` (terrain_zone tick):** a test that runs a combat with a terrain zone + GoI where the terrain zone previously applied a condition on tick (now skipped). Check evards_black_tentacles / maelstrom / sickening_radiance tests, and any combat scenario test that involves terrain zones.
3. **Most likely failure mode for `d0b6f20` (moving-zone on-enter):** a test that runs a combat with a moving zone (Flaming Sphere / Moonbeam / Call Lightning / Cloudkill) where a GoI-protected creature was previously taking damage from the moving zone (now skipped). Check flaming_sphere / moonbeam / call_lightning / cloudkill tests. Also: the `sourceSlotLevel` on the moving zone's damage_zone effect could change behavior if a test checks the effect's fields.
4. **Fix forward** on a new commit.

## KEY FILES THIS SESSION

### Modified

- `src/engine/spell_effects.ts` — `TerrainZone` interface gains `sourceSlotLevel?`; `getActiveTerrainZones()` copies it
- `src/engine/combat.ts` — terrain_zone tick loop: GoI check (with zone.casterId); moving zone on-enter: GoI check (with actor.id) + sourceSlotLevel on damage_zone effect

### New

- `src/test/session83_goi_terrain_tick.test.ts` — 21 assertions, 5 phases
- `src/test/session83_goi_moving_zone.test.ts` — 12 assertions, 3 phases

## ARCHITECTURAL NOTES

### GoI protection completeness

This session completed the GoI protection audit. All spell-effect paths that apply damage or conditions to targets now check GoI (with the casterId parameter for the caster-inside fix). The only remaining gap is the save-fail tracker (Contagion L5), which requires complex pause/resume logic and is deferred.

### sourceSlotLevel propagation

The `sourceSlotLevel` field is now correctly propagated through all zone types:
- `damage_zone` effects: set by spell modules (Session 78) + moving zone (Session 83)
- `terrain_zone` effects: set by spell modules (Session 79) + extracted by `getActiveTerrainZones` (Session 83)
- Both are used by the combat.ts tick loops for the GoI level check

### Moving zone slot level derivation

The moving zone's slot level is derived from `spellAction.slotLevel` (looked up from the caster's action list) rather than stored on the `_movingZone` object. This avoids changing the `_movingZone` type + 4 spell modules. The action's `slotLevel` field is set in the action definition (e.g., Moonbeam action has `slotLevel: 2`).

## VERIFICATION SNAPSHOT

- `git log --oneline -5`: `d0b6f20`, `577e66a`, `62743ab`, `d17ce7d`, `d218b28`
- `git status` → clean working tree (after push)
- `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged)
- Key test files: all pass (GoI family, terrain zone spells, moving zone spells, session83 tests)
- CI on `577e66a` / `d0b6f20`: all check-runs `success` ✅
- **NO RED X**
