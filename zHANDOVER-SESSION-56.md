# zHANDOVER — Session 56

**Date:** 2026-06-23
**Agent:** Z.ai (Core Engine workstream — TG-032)
**Focus:** Execute TG-032 — wire Land Druid Nature's Ward fey/elemental charm/frighten immunity (PHB p.69) into the engine. This was the last Tier-A Core Engine task; completing it promotes the Tier-B tasks (TG-030 Quivering Palm, TG-031 Open Hand Technique) to the top of the queue.

---

## Session Summary

Session 56 continued the Core Engine workstream after Session 55 (TG-024). Per `TASK.md`'s Immediate Priority list, TG-032 was the #1 Tier-A task. This session:

1. **Diagnosed the gap.** Nature's Ward (Land Druid 10, PHB p.69) has two effects:
   - **Blanket poison immunity** (condition + disease) — ALREADY wired in Session 47 (`addCondition` + `applySpellEffect` both block `poisoned` when target has Nature's Ward).
   - **Fey/elemental charm/frighten immunity** — NOT wired. The existing test (`natures_ward.test.ts` section 8) explicitly documented this as a v1 simplification: "fey/elemental frighten immunity is NOT wired (requires source-creature-type tracking)."

   The root cause: `addCondition(target, condition)` in `utils.ts` only takes the target + condition name — it has no source context. The `applySpellEffect` `condition_apply` path has access to the `effect` object (with `casterId`), but `ActiveEffect` had no field to carry the source creature type.

2. **Implemented the fix** across 4 files (single commit):
   - `src/types/core.ts`: Added `sourceCreatureType?: string` to `ActiveEffect` (optional, backward-compatible). Documented that when absent, the Nature's Ward fey/elemental check is a no-op.
   - `src/engine/spell_effects.ts`: In `applySpellEffect`'s `condition_apply` path, added a guard after the existing poisoned-block: if target has Nature's Ward AND condition is `charmed`/`frightened` AND `effect.sourceCreatureType` is `fey`/`elemental` → skip application.
   - `src/spells/charm_person.ts` + `src/spells/cause_fear.ts`: Updated the `applySpellEffect` call to set `sourceCreatureType: caster.creatureType` (so fey/elemental casters trigger the immunity).
   - `src/test/natures_ward.test.ts`: Added 13 new assertions (sections 14-23).

3. **Wrote 13 new test assertions** covering: fey source × charmed (immune), elemental source × frightened (immune), fey source × frightened (immune), elemental source × charmed (immune), humanoid source × charmed (not immune), humanoid source × frightened (not immune), legacy no-sourceCreatureType × charmed (backward-compat — applied), vanilla druid × fey source (no NW — applied), and 2 end-to-end tests using the actual `charm_person.ts` execute() with fey vs humanoid casters.

4. **Ran regression sweep.** `tsc --noEmit` clean. All 15 charm/frighten spell tests pass (charm_person, cause_fear, fear, charm_monster, suggestion, hypnotic_pattern, crown_of_madness, wrathful_smite, fast_friends, animal_friendship, compelled_duel, enemies_abound, incite_greed + natures_ward). All 6 core engine suites pass (spell_effects, combat, engine, mechanics, phase4, integration, scenario). Zero regressions.

**Total this session:** ~45 lines of new/modified code (4 files), 13 new test assertions in an existing test file, 2 doc files updated (TEAMGOALS, TASK), 1 handover, 1 handover archived.

---

## Architecture

### Why the check lives in `applySpellEffect`, not `addCondition`

The original TG-032 spec suggested adding the check to `addCondition`. But `addCondition(target, condition)` has a 2-arg signature — it has no source context. Threading source-creature-type through every `addCondition` caller would be a broad refactor touching dozens of call sites.

The `applySpellEffect` `condition_apply` path is the right place because:
1. It already has the `effect` object (with `casterId`, `spellName`, and now `sourceCreatureType`).
2. It already has the existing Nature's Ward poisoned-block (Session 47) — the fey/elemental check is a natural sibling.
3. Spell modules that apply charmed/frightened conditions (Charm Person, Cause Fear, Fear, Charm Monster, etc.) all go through `applySpellEffect` — so the guard catches them all (once they set `sourceCreatureType`).

`addCondition` remains the low-level primitive (used for direct condition application by engine internals like `paralyzed` → `incapacitated` cascades). Those internal calls don't have a spell source, so the fey/elemental check doesn't apply to them anyway.

### Backward compatibility

The `sourceCreatureType` field is **optional** on `ActiveEffect`. The guard in `applySpellEffect` only fires when ALL THREE conditions are true:
1. `target.classFeatures` includes `"Nature's Ward"`
2. `effect.payload.condition` is `'charmed'` or `'frightened'`
3. `effect.sourceCreatureType` is `'fey'` or `'elemental'`

If `sourceCreatureType` is absent (legacy spell modules), condition 3 is false → the guard is a no-op → the condition applies as before. This means:
- All 13 other charm/frighten spell modules (fear, charm_monster, suggestion, hypnotic_pattern, crown_of_madness, wrathful_smite, fast_friends, animal_friendship, compelled_duel, enemies_abound, incite_greed, geas, weird, phantasmal_killer) work exactly as before.
- They'll gain the Nature's Ward immunity check automatically if/when updated to set `sourceCreatureType: caster.creatureType` — a one-line change per spell.

### Monster vs PC casters

- **Monster casters:** `fivetools.ts:1236` populates `creatureType` from the 5etools `type` field (e.g. a Dryad is `fey`, a Fire Elemental is `elemental`). So when a monster casts Charm Person, `caster.creatureType` is `'fey'` → the immunity fires against a Nature's Ward druid.
- **PC casters:** `creatureType` is typically `undefined` for PCs (the builder doesn't set it — PCs are humanoids by default but the field isn't populated). So `sourceCreatureType: caster.creatureType` is `undefined` → the guard is a no-op → PC charm/frighten works normally against a Nature's Ward druid. This is PHB-accurate: a humanoid PC caster CAN charm a Land Druid 10 (the immunity is fey/elemental only).

---

## Files Changed (Session 56)

### New files (1)
- `zHANDOVER-SESSION-56.md` — this file

### Modified files (5)
- `src/types/core.ts` — Added `sourceCreatureType?: string` to `ActiveEffect` (with doc comment).
- `src/engine/spell_effects.ts` — `applySpellEffect` `condition_apply` path: added Nature's Ward fey/elemental charm/frighten guard (after the existing poisoned-block).
- `src/spells/charm_person.ts` — `applySpellEffect` call now sets `sourceCreatureType: caster.creatureType`.
- `src/spells/cause_fear.ts` — Same: `sourceCreatureType: caster.creatureType`.
- `src/test/natures_ward.test.ts` — Added 13 new assertions (sections 14-23); updated section 8 comment + header doc block.
- `TEAMGOALS.md` — TG-032 status `OPEN` → `DONE — Session 56`.
- `TASK.md` — Core Engine Active Objective refreshed (S55 → S56, now TG-030 Quivering Palm); TG-032 marked DONE; Immediate Priority re-ordered (TG-030 promoted to #1).

### Moved files (1)
- `zHANDOVER-SESSION-54.md` → `HandoverOld/zHANDOVER-SESSION-54.md` (per AGENTS.md "max 2 of each handover type in root" rule — root now has 55 + 56).

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| `natures_ward.test.ts` (26 = 13 orig + 13 new) | ✅ All pass |
| `charm_person.test.ts` (25) | ✅ All pass |
| `cause_fear.test.ts` (18) | ✅ All pass |
| `fear.test.ts` (23) | ✅ All pass |
| `charm_monster.test.ts` (18) | ✅ All pass |
| `suggestion.test.ts` (59) | ✅ All pass |
| `hypnotic_pattern.test.ts` | ✅ All pass |
| `crown_of_madness.test.ts` (46) | ✅ All pass |
| `wrathful_smite.test.ts` (28) | ✅ All pass |
| `fast_friends.test.ts` (20) | ✅ All pass |
| `animal_friendship.test.ts` (26) | ✅ All pass |
| `compelled_duel.test.ts` (19) | ✅ All pass |
| `enemies_abound.test.ts` (18) | ✅ All pass |
| `incite_greed.test.ts` | ✅ All pass |
| `spell_effects.test.ts` | ✅ All pass |
| `combat.test.ts` | ✅ All pass |
| `engine.test.ts` | ✅ All pass |
| `mechanics.test.ts` | ✅ All pass |
| `phase4.test.ts` | ✅ All pass |
| `integration.test.ts` | ✅ All pass |
| `scenario.test.ts` | ✅ All pass |

**New assertions this session: 13.** All existing tests remain green. No regressions.

---

## CI Status

Single commit pushed to `main` (this session):
- `Session 56 Core Engine TG-032: Nature's Ward fey/elemental charm/frighten immunity`

CI should pass (all local tests green; the change is purely additive — a new optional field + a guard that only fires when 3 conditions are ALL true).

---

## Next Session Priorities

### Core Engine (per TASK.md updated Immediate Priority list)

Tier B (MEDIUM risk — NOW the top priorities, both UNBLOCKED by TG-024):
1. **TG-030** (PHB 2014): Quivering Palm (Open Hand Monk 17) — touch attack + CON save + instakill on failed save / 10d8 necrotic on success. Costs 3 ki (payable via `resources.ki`). Needs new `'quiveringPalm'` case in `executePlannedAction`, mirroring the `'draconicPresence'` pattern from Session 49.
2. **TG-031** (PHB 2014): Open Hand Technique (Monk 3) Flurry rider — choose to push 15 ft / knock prone / disable reaction. Costs 1 ki per Flurry (payable via `resources.ki`).

Tier A (LOW risk — still open):
3. **TG-028** (PHB 2014/TCE): Booming/Green-Flame Blade "melee spell attack" label fix — comment-only, can be slotted in any session. Cantrip-z owns.

### Sheet Agent (per TASK.md Sheet section)

- **TG-025** (PHB 2014): Per-class unarmored-AC hook — Sheet drives unilaterally.
- **TG-026** (PHB 2014): Resources panel UI for Ki + Sorcery Points — UNBLOCKED (TG-024 done).
- **TG-029** (PHB 2014): Champion 10 second Fighting Style — Sheet drives steps 1-4.

### Creature Megabatch — Batch 5 (still DEFERRED)

- **5a. Lair actions (41 creatures):** needs initiative-count-20 hook in `runCombat` + lair-actions JSON source.
- **5b. Monster spellcasting (83+ creatures):** needs `SPELL_DB` lookup + monster spell-slot tracking + planner integration.
- **5c. Shapechanger (23+ creatures):** needs transform subsystem.

---

## Commit Log (Session 56)

```
Session 56 Core Engine TG-032: Nature's Ward fey/elemental charm/frighten immunity
  - Nature's Ward (Land Druid 10, PHB p.69) has two effects: blanket poison
    immunity (wired Session 47) AND fey/elemental charm/frighten immunity
    (NOT wired — required source-creature-type tracking). The existing
    natures_ward.test.ts section 8 explicitly documented this as a v1
    simplification.
  - Root cause: addCondition(target, condition) has no source context.
    applySpellEffect's condition_apply path has the effect object but
    ActiveEffect had no field to carry the source creature type.
  - core.ts: added sourceCreatureType?: string to ActiveEffect (optional,
    backward-compatible). When absent, the Nature's Ward fey/elemental
    check is a no-op.
  - spell_effects.ts applySpellEffect condition_apply: added guard after
    the existing poisoned-block — if target has Nature's Ward AND condition
    is charmed/frightened AND effect.sourceCreatureType is fey/elemental,
    skip application. Backward-compatible: if sourceCreatureType absent,
    the check is a no-op.
  - charm_person.ts + cause_fear.ts: updated applySpellEffect call to set
    sourceCreatureType: caster.creatureType. Monster casters (fey/elemental)
    now trigger the immunity; PC casters (creatureType undefined) do not —
    PHB-accurate (humanoid PCs CAN charm a Land Druid 10).
  - natures_ward.test.ts: added 13 new assertions (sections 14-23) covering
    fey/elemental source × charmed/frightened (immune), humanoid source
    (not immune), legacy no-sourceCreatureType (backward-compat), vanilla
    druid (no NW), and 2 end-to-end tests using charm_person.ts execute()
    with fey vs humanoid casters. Updated section 8 comment.
  - All 15 charm/frighten spell tests + 6 core engine suites pass.
    tsc --noEmit clean. Zero regressions.
  - TEAMGOALS.md: TG-032 status OPEN -> DONE — Session 56.
  - TASK.md: Core Engine Active Objective refreshed (S55 -> S56, now
    TG-030 Quivering Palm); TG-032 marked DONE; Immediate Priority
    re-ordered (TG-030 promoted to #1).
  - Archived zHANDOVER-SESSION-54 to HandoverOld/ (AGENTS.md "max 2 in
    root" rule — root now has 55 + 56).
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged — Core Engine workstream).
- `BestiaryMap`: 2401 unique creatures from 98 files (unchanged — no parser changes).
- **New mechanical coverage this session:**
  - Land Druid 10 Nature's Ward now grants fey/elemental charm/frighten immunity (was only poison immunity). A fey caster's Charm Person or an elemental's Cause Fear on a Land Druid 10 is now rejected (condition not applied). Humanoid casters are unaffected.
  - 2 spell modules (`charm_person`, `cause_fear`) now set `sourceCreatureType` — enabling the immunity. 13 other charm/frighten spells remain backward-compatible (will gain the check if/when updated).
- **Remaining Core Engine work:** TG-030 (Quivering Palm), TG-031 (Open Hand Technique) — both UNBLOCKED. TG-028 (label fix). All Tier-A Core Engine tasks (TG-027, TG-024, TG-032) are now DONE.
