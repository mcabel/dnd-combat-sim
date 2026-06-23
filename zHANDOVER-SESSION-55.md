# zHANDOVER — Session 55

**Date:** 2026-06-23
**Agent:** Z.ai (Core Engine workstream — TG-024)
**Focus:** Execute TG-024 — transfer Monk Ki (PHB p.76) + Sorcerer Sorcery Points (PHB p.101) from the `CharacterSheet` (populated by `leveler.ts`) through the `buildCombatant` → `sheetToRawEntry` → `buildRawResources` → `buildResources` pipeline onto the `Combatant`'s `PlayerResources`. This unblocks TG-030 (Quivering Palm), TG-031 (Open Hand Technique), and the 5-SP cost on Draconic Presence.

---

## Session Summary

Session 55 continued the Core Engine workstream after Session 54 (TG-027). Per `TASK.md`'s Immediate Priority list, TG-024 was the #1 Tier-A task. This session:

1. **Diagnosed the gap.** `CharacterResources` (sheet type, `src/characters/types.ts:217,221`) already had `ki?` and `sorceryPoints?`, and `leveler.ts` already populated them:
   - `leveler.ts:923`: Monk 2+ gets `ki = { max: monkLevel, remaining: monkLevel }` (PHB p.76: ki is a level-2 feature; Monk 1 has none).
   - `leveler.ts:928-931`: Sorcerer 2+ gets `sorceryPoints = { max: sorcererLevel, remaining: sorcererLevel }` (PHB p.101).
   - `character_router.ts:1016-1028`: rest-recovery hooks for BOTH already existed (short rest restores ki; long rest restores sorcery points).

   BUT the transfer pipeline (`buildRawResources` in `builder.ts` + `buildResources` in `pc.ts`) SKIPPED both fields — so a Monk or Sorcerer PC had zero ki/sorcery points in combat. `PlayerResources` (combat type, `core.ts`) didn't even have the fields declared.

2. **Implemented the fix** across 4 files (single commit):
   - `src/types/core.ts`: Added `ki?: { max: number; remaining: number }` and `sorceryPoints?: { max: number; remaining: number }` to `PlayerResources`. Used `{ max, remaining }` (NOT the spec draft's `{ max, current }`) to match ALL other `PlayerResources` fields (rage, actionSurge, secondWind, bardicInspiration, etc.) — consistency wins. Also updated the stale Draconic Presence comment ("sorcery points not yet transferred — deferred" → "TG-024 landed the transfer").
   - `src/characters/builder.ts`: In `buildRawResources`, after the `actionSurge` branch, added `if (res.ki) out.ki = { uses: res.ki.max }` and `if (res.sorceryPoints) out.sorceryPoints = { uses: res.sorceryPoints.max }` — mechanical mirror of the `actionSurge` line at L226. Also updated the stale Draconic Presence comment in `builder.ts:437`.
   - `src/parser/pc.ts`: Added `ki?` and `sorceryPoints?` to the `RawResources` interface (L66-67), then in `buildResources` after the `actionSurge` block (L267-285) added `result.ki = { max, remaining: max }` and `result.sorceryPoints = { max, remaining: max }` — mechanical mirror of `actionSurge` at L262-265.
   - `src/test/ki_sorcery_points.test.ts`: New test file, 29 assertions.

3. **Wrote 29 test assertions** covering: Monk 5 ki (max=5, remaining=5), Monk 1 NO ki (PHB p.76 unlocks at L2), Monk 2 ki unlock, Monk 5 Open Hand subclass, Sorcerer 5 sorceryPoints (max=5), Sorcerer 1 NO sorceryPoints (unlocks at L2), Sorcerer 5 Draconic Bloodline subclass, Fighter 5 neither (wrong class), actionSurge + rage regression, sheet-source verification, and Monk/Sorcerer independence.

4. **Ran regression sweep.** `tsc --noEmit` clean. All 14 affected test files pass: resources, character_builder, character_leveler, character_storage, character_improvements, subclass_features, wholeness_of_body, diamond_soul, rage, action_surge, champion_remarkable_athlete_survivor, natures_ward, + all 6 core engine suites (combat, engine, mechanics, phase4, integration, scenario). The `resources.test.ts` line 285 assertion ("Monk 1 has hitDice only, no class resources") still holds — Monk 1 correctly has no ki.

**Total this session:** ~50 lines of new/modified code (4 files), 1 new test file (29 assertions), 2 doc files updated (TEAMGOALS, TASK), 1 handover, 1 handover archived.

---

## Architecture

### The transfer pipeline

```
CharacterSheet.resources (CharacterResources, types.ts)
  ├── ki?: { max, remaining }              ← populated by leveler.ts:923 (Monk 2+)
  └── sorceryPoints?: { max, remaining }   ← populated by leveler.ts:930 (Sorcerer 2+)
        │
        ▼  buildCombatant() → sheetToRawEntry() → buildRawResources()
RawPCEntry.resources (RawResources, pc.ts)
  ├── ki?: RawResource { uses: max }       ← NEW (TG-024)
  └── sorceryPoints?: RawResource { uses: max }  ← NEW (TG-024)
        │
        ▼  pcToCombatant() → buildResources()
Combatant.resources (PlayerResources, core.ts)
  ├── ki?: { max, remaining }              ← NEW (TG-024)
  └── sorceryPoints?: { max, remaining }   ← NEW (TG-024)
```

Both new fields use the existing `actionSurge` pattern: `buildRawResources` passes `max` as `uses`; `buildResources` reads `uses` and constructs `{ max, remaining: max }` (full on combat start).

### Why `{ max, remaining }` not `{ max, current }`

The original TG-024 spec draft (TEAMGOALS.md) suggested `{ max, current }`. But every existing `PlayerResources` field uses `remaining`:
- `rage: { max, remaining, active, roundsRemaining }`
- `secondWind: { max, remaining }`
- `actionSurge: { max, remaining }`
- `bardicInspiration: { max, remaining, die }`
- `layOnHands: { pool, remaining }`
- `channelDivinity: { max, remaining }`
- `wildShape: { max, remaining }`
- `spellMastery: { max, remaining }`
- `wholenessOfBody: { max, remaining }`
- `draconicPresence: { max, remaining }`

Using `remaining` keeps the type consistent. The `character_router.ts` rest hooks (L1016-1028) already read `r.ki.remaining` and `r.sorceryPoints.remaining` on the SHEET side — so the Combatant side matches.

### PHB accuracy: unlock levels

- **Ki (PHB p.76):** "At 2nd level, you gain the ability to use ki." The leveler grants ki during the level 1→2 `applyLevelUp` call (`case 'Monk':` at L921-924). A freshly-created level-1 Monk sheet has NO `ki` field. Test 4a verifies this.
- **Sorcery Points (PHB p.101):** "At 2nd level, you tap into a deep wellspring of magic." The leveler grants sorceryPoints only for `newClassLevel >= 2` (L928). A level-1 Sorcerer has NO `sorceryPoints`. Test 10 verifies this.

### Rest recovery (already existed, unchanged)

`character_router.ts` already had these hooks (operating on `sheet.resources`):
- L1016-1018 (short rest): `if (r.ki && r.ki.remaining < r.ki.max) r.ki.remaining = r.ki.max;`
- L1026-1028 (long rest): `if (r.sorceryPoints && r.sorceryPoints.remaining < r.sorceryPoints.max) r.sorceryPoints.remaining = r.ki.max;`

These were dead code before TG-024 (the sheet had the fields but they never reached the Combatant). Now they're live: a Monk who spends ki in combat, rests, and re-enters combat will have full ki again.

---

## Files Changed (Session 55)

### New files (2)
- `src/test/ki_sorcery_points.test.ts` — TG-024 tests (29 assertions)
- `zHANDOVER-SESSION-55.md` — this file

### Modified files (4)
- `src/types/core.ts` — Added `ki?` + `sorceryPoints?` to `PlayerResources` (both `{ max: number; remaining: number }`); updated stale Draconic Presence comment.
- `src/characters/builder.ts` — `buildRawResources`: added `ki` + `sorceryPoints` transfer (2 lines, mirrors `actionSurge`); updated stale Draconic Presence comment.
- `src/parser/pc.ts` — `RawResources` interface: added `ki?` + `sorceryPoints?`; `buildResources`: added `ki` + `sorceryPoints` construction (mirrors `actionSurge`).
- `TEAMGOALS.md` — TG-024 status `OPEN` → `DONE — Session 55`.
- `TASK.md` — Core Engine Active Objective refreshed (S54 → S55); TG-024 marked DONE; Immediate Priority list re-ordered (TG-032 promoted to #1, TG-030/TG-031 marked UNBLOCKED).

### Moved files (1)
- `zHANDOVER-SESSION-53.md` → `HandoverOld/zHANDOVER-SESSION-53.md` (per AGENTS.md "max 2 of each handover type in root" rule — root now has 54 + 55).

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| `ki_sorcery_points.test.ts` (29) | ✅ All pass — NEW |
| `resources.test.ts` (regression) | ✅ All pass |
| `character_builder.test.ts` (93) | ✅ All pass |
| `character_leveler.test.ts` (256) | ✅ All pass |
| `character_storage.test.ts` (89) | ✅ All pass |
| `character_improvements.test.ts` (108) | ✅ All pass |
| `subclass_features.test.ts` | ✅ All pass |
| `wholeness_of_body.test.ts` | ✅ All pass |
| `diamond_soul.test.ts` | ✅ All pass |
| `rage.test.ts` (44) | ✅ All pass |
| `action_surge.test.ts` | ✅ All pass |
| `champion_remarkable_athlete_survivor.test.ts` | ✅ All pass |
| `natures_ward.test.ts` | ✅ All pass |
| `combat.test.ts` | ✅ All pass |
| `engine.test.ts` | ✅ All pass |
| `mechanics.test.ts` | ✅ All pass |
| `phase4.test.ts` | ✅ All pass |
| `integration.test.ts` | ✅ All pass |
| `scenario.test.ts` | ✅ All pass |

**New assertions this session: 29.** All existing tests remain green. No regressions.

---

## CI Status

Single commit pushed to `main` (this session):
- `Session 55 Core Engine TG-024: Ki + Sorcery Points transfer to Combatant`

CI should pass (all local tests green; the only files touched are `core.ts` type additions, `builder.ts`/`pc.ts` mechanical mirror of existing `actionSurge` pattern, and a new test file — no engine logic changed).

---

## Next Session Priorities

### Core Engine (per TASK.md updated Immediate Priority list)

Tier A (LOW risk, ship next):
1. **TG-032** (PHB 2014): Land Druid Nature's Ward — fey/elemental charm/frighten immunity (PHB p.69). Additive immunity check in the condition-application path. Core drives unilaterally.
2. **TG-028** (PHB 2014/TCE): Booming/Green-Flame Blade "melee spell attack" label fix — comment-only, can be slotted in any session. Cantrip-z owns.

Tier B (MEDIUM risk — NOW UNBLOCKED by TG-024):
3. **TG-030** (PHB 2014): Quivering Palm action type — needs new `'quiveringPalm'` case in `executePlannedAction`. Touch attack + CON save + instakill on failed save / 10d8 necrotic on success. Costs 3 ki (now payable via `resources.ki`).
4. **TG-031** (PHB 2014): Open Hand Technique Flurry rider — per-turn rider sequencing. Costs 1 ki per Flurry (now payable via `resources.ki`).

### Sheet Agent (per TASK.md Sheet section)

- **TG-025** (PHB 2014): Per-class unarmored-AC hook — Sheet drives unilaterally.
- **TG-026** (PHB 2014): Resources panel UI for Ki + Sorcery Points — NOW UNBLOCKED (TG-024 done; Sheet can build Ki/SP rows against the typed `PlayerResources.ki`/`sorceryPoints` fields).
- **TG-029** (PHB 2014): Champion 10 second Fighting Style — Sheet drives steps 1-4.

### Creature Megabatch — Batch 5 (still DEFERRED)

- **5a. Lair actions (41 creatures):** needs initiative-count-20 hook in `runCombat` + lair-actions JSON source.
- **5b. Monster spellcasting (83+ creatures):** needs `SPELL_DB` lookup + monster spell-slot tracking + planner integration.
- **5c. Shapechanger (23+ creatures):** needs transform subsystem.

---

## Commit Log (Session 55)

```
Session 55 Core Engine TG-024: Ki + Sorcery Points transfer to Combatant
  - CharacterResources (sheet type) already had ki? + sorceryPoints?,
    populated by leveler.ts (Monk 2+ ki = monk level; Sorcerer 2+
    sorceryPoints = sorcerer level). character_router.ts already had
    rest-recovery hooks for both. BUT the transfer pipeline
    (buildRawResources in builder.ts + buildResources in pc.ts) SKIPPED
    both fields, and PlayerResources (combat type, core.ts) didn't
    declare them — so a Monk or Sorcerer PC had zero ki/sorcery points
    in combat. This blocked TG-030 (Quivering Palm 3 ki), TG-031 (Open
    Hand Technique Flurry 1 ki), and the 5-SP cost on Draconic Presence.
  - core.ts: added ki? + sorceryPoints? to PlayerResources, both
    { max: number; remaining: number } (NOT { max, current } — `remaining`
    matches ALL other PlayerResources fields: rage, actionSurge, secondWind,
    bardicInspiration, etc. Consistency wins). Updated stale Draconic
    Presence comment.
  - builder.ts buildRawResources: after the actionSurge branch, added
    `if (res.ki) out.ki = { uses: res.ki.max }` + same for sorceryPoints —
    mechanical mirror of actionSurge at L226. Updated stale Draconic
    Presence comment.
  - pc.ts: added ki? + sorceryPoints? to RawResources interface; in
    buildResources after the actionSurge block, added
    `result.ki = { max, remaining: max }` + same for sorceryPoints —
    mechanical mirror of actionSurge.
  - New test src/test/ki_sorcery_points.test.ts: 29 assertions covering
    Monk 5 ki (max=5), Monk 1 NO ki (PHB p.76 unlocks at L2), Monk 2 ki
    unlock, Monk 5 Open Hand subclass, Sorcerer 5 sorceryPoints (max=5),
    Sorcerer 1 NO sorceryPoints (unlocks at L2), Sorcerer 5 Draconic
    Bloodline, Fighter 5 neither, actionSurge + rage regression,
    sheet-source verification, Monk/Sorcerer independence.
  - All 14 affected test files pass + all 6 core engine suites pass.
    tsc --noEmit clean. resources.test.ts "Monk 1 has no class resources"
    still holds (Monk 1 correctly has no ki per PHB).
  - TEAMGOALS.md: TG-024 status OPEN -> DONE — Session 55.
  - TASK.md: Core Engine Active Objective refreshed (S54 -> S55); TG-024
    marked DONE; Immediate Priority re-ordered (TG-032 promoted to #1,
    TG-030/TG-031 marked UNBLOCKED).
  - Archived zHANDOVER-SESSION-53 to HandoverOld/ (AGENTS.md "max 2 in
    root" rule — root now has 54 + 55).
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged — Core Engine workstream).
- `BestiaryMap`: 2401 unique creatures from 98 files (unchanged — no parser changes).
- **New mechanical coverage this session:**
  - Monk Ki now transfers to Combatant (was 0): Monk 2+ has `ki = { max: monkLevel, remaining: monkLevel }`. Unlocks Flurry of Blows / Patient Defense / Step of the Wind (1 ki each), Stunning Strike (1 ki), Deflect Missiles throw-back (1 ki), Diamond Soul save reroll (1 ki), Empty Body (4 ki).
  - Sorcerer Sorcery Points now transfer to Combatant (was 0): Sorcerer 2+ has `sorceryPoints = { max: sorcererLevel, remaining: sorcererLevel }`. Unlocks Flexible Casting (convert slot↔points), Metamagic options, Draconic Presence (5 SP).
- **Remaining Core Engine Tier-A work:** TG-032 (Land Druid Nature's Ward), TG-028 (label fix). Tier-B TG-030/TG-031 now UNBLOCKED.
