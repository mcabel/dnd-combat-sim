# Lair Actions — Out-of-Scope & Deferred Registry

**Phase 0 deliverable for RFC-LAIRACTIONS.**
**Generated:** Session 90 (autonomous)
**Source:** `bestiaryData/legendarygroups.json` — 115 legendary groups, 309 lair action options.

This registry lists lair actions that the engine will **NOT execute mechanically** at runtime, for two reasons:

- **Out-of-scope (`lair_oos_NNN`):** the action has no combat-mechanical effect (pure flavor, social, narrative, or long-duration out-of-combat reshaping). The engine logs these with their ID but does not execute them.
- **Deferred (`lair_def_XXX`):** the action IS mechanical, but depends on a subsystem the engine doesn't yet have (vision/light, gravity, DMG hazards, initiative mutation). The engine logs these with their deferral tag; they become executable when the subsystem lands.

The identification heuristic is defined in `docs/RFC-LAIRACTIONS.md` §4. This registry is a **starter** — the Phase 1 implementing agent should re-run the categorization pass against the full 309 actions and verify/extend this list. Entries marked `[VERIFY]` are borderline and need human review.

---

## Out-of-Scope (flavor / social / narrative) — 6 entries

These have no combat-mechanical effect. Logged at runtime with the ID; never executed.

| ID | Creature | Action (truncated) | Reason |
|---|---|---|---|
| `lair_oos_001` | Balhannoth | "warps reality... After 10 minutes, the terrain reshapes to assume the appearance of a location sought by one Humanoid..." | 10-minute duration; social/infiltration effect, not combat. |
| `lair_oos_002` | Balhannoth | (duplicate of 001, alternate phrasing in source data) | Same as 001. |
| `lair_oos_003` | Ki-rin | "conjure up one or more temporary objects made of stone or metal that can collectively fill no more than a 2-foot cube..." | Object creation with no combat use. |
| `lair_oos_004` | Merrenoloth | "A strong wind propels the vessel, increasing its speed by 30 feet..." | Vehicle/ship movement, not creature combat. |
| `lair_oos_005` | Merrenoloth | (duplicate of 004, alternate phrasing) | Same as 004. |
| `lair_oos_006` | Sphinx | "The flow of time within the lair is altered such that everything within moves up to 10 years forward or backward..." | Narrative time manipulation; out of combat scope. `[VERIFY]` — could be reclassified `deferred: 'meta-time'` if time-travel mechanics are ever modeled. |

---

## Deferred (mechanical, awaiting subsystem) — 7 entries

These ARE mechanical. The engine logs them with the deferral tag and skips execution until the named subsystem is built.

| ID | Creature | Action (truncated) | Deferred subsystem |
|---|---|---|---|
| `lair_def_001` | Black Dragon | "Magical darkness spreads... 15-foot-radius sphere... A creature with darkvision can't see through this darkness, and nonmagical light can't illuminate it." | `magical-darkness` (needs vision/light subsystem) |
| `lair_def_002` | Nafas | "creates a 20-foot-radius sphere of multiversal dust... heavily obscured..." | `visibility` (needs vision/light subsystem) |
| `lair_def_003` | Olhydra | "Water within 120 feet becomes murky and opaque... A creature with darkvision can't see through the water, and light can't illuminate it." | `visibility` (needs vision/light subsystem) |
| `lair_def_004` | Storm Giant Quintessent | "creates a 20-foot-radius sphere of fog... heavily obscured..." | `visibility` (needs vision/light subsystem) |
| `lair_def_005` | Storm Giant Quintessent | (duplicate of 004, alternate phrasing) | `visibility` |
| `lair_def_006` | Sphinx | "every creature in the lair must reroll initiative. The sphinx can choose not to reroll." | `meta-initiative` (needs initiative-order mutation) |
| `lair_def_007` | Baphomet | "Reverse Gravity... gravity is reversed within that room... creatures fall in the direction of the new pull of gravity..." | `gravity` (needs gravity-flip subsystem) |

---

## Borderline / needs review — 2 entries

These were flagged by the heuristic but on inspection appear **mechanical and in-scope**. The Phase 1 agent should classify them as `summon` or `bespoke` and implement normally.

| Candidate | Creature | Action (truncated) | Recommended classification |
|---|---|---|---|
| `[VERIFY-1]` | Lichen Lich | "creating a shambling mound. The shambling mound appears in an unoccupied space within 30 feet... obeys the lich's commands. The shambling mound dies after 1 hour..." | **`summon`** (in-scope). The 1-hour duration >> combat; treat as a normal summon with `durationRounds: Infinity`. |
| `[VERIFY-2]` | Juiblex | "A green slime appears on a spot on the ceiling... disintegrates after 1 hour." | **`deferred: 'dmg-hazard'`**. Green slime is a DMG hazard (DMG p.105) with a real combat effect (AC damage, ongoing). Needs a hazard-statblock lookup. |

---

## Summary

| Classification | Count | Runtime behavior |
|---|---|---|
| Out-of-scope (`lair_oos_*`) | 6 | Logged with ID, never executed |
| Deferred (`lair_def_*`) | 7 | Logged with deferral tag, executed when subsystem lands |
| Borderline (verify) | 2 | Phase 1 agent classifies as `summon` or `deferred` |
| **Total non-executable** | **15** | of 309 total lair actions (~5%) |

The remaining **~294 actions** (~95%) are in-scope and will be mechanically resolved across Phases 1–5 of RFC-LAIRACTIONS.

---

## Maintenance

- **Adding entries:** when a new legendary group is added to `bestiaryData/legendarygroups.json`, the Phase 1 parser pass should categorize its lair actions. Any new out-of-scope/deferred entries get the next sequential ID.
- **Reclassifying:** when a deferred subsystem is implemented (e.g., `visibility` lands), all `lair_def_*` entries with that tag move to in-scope and become executable. Update this doc to mark them resolved.
- **Search:** the stable IDs (`lair_oos_NNN`, `lair_def_NNN`) appear in runtime logs and in the `LairAction.id` field, so a `grep lair_oos_003` finds both the registry entry and any log lines where that action fired.
