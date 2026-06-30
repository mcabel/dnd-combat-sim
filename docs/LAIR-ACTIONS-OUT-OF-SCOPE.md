# Lair Actions — Out-of-Scope & Deferred Registry

**Phase 0 deliverable for RFC-LAIRACTIONS.**
**Generated:** Session 90 (autonomous), **updated** Session 90 (user decisions applied)
**Source:** `bestiaryData/legendarygroups.json` — 115 legendary groups, 309 lair action options.

**Update (Session 90):** per user direction, narrative-bespoke actions that *could* be modeled someday are reclassified as **`deferred`** (not `out-of-scope`). Only permanently-excluded flavor/social/narrative actions remain `out-of-scope`. The Sphinx "time moves 10 years" action moved from `lair_oos_006` to `lair_def_008` (`deferred: 'meta-time'`).

This registry lists lair actions that the engine will **NOT execute mechanically** at runtime, for two reasons:

- **Out-of-scope (`lair_oos_NNN`):** the action has no combat-mechanical effect and no plausible mechanical implementation even with a future subsystem (pure flavor, social, narrative, or out-of-combat-only). The engine logs these with their ID but does not execute them. **Permanent exclusion.**
- **Deferred (`lair_def_XXX`):** the action IS mechanical (or could become mechanical), but depends on a subsystem the engine doesn't yet have (vision/light, gravity, DMG hazards, initiative mutation, time manipulation). The engine logs these with their deferral tag; they become executable when the subsystem lands. **Reversible.**

The identification heuristic is defined in `docs/RFC-LAIRACTIONS.md` §4. This registry is a **starter** — the Phase 1 implementing agent should re-run the categorization pass against the full 309 actions and verify/extend this list. Entries marked `[VERIFY]` are borderline and need human review.

---

## Out-of-Scope (flavor / social / narrative — permanently excluded) — 5 entries

These have no combat-mechanical effect and no plausible mechanical implementation. Logged at runtime with the ID; never executed.

| ID | Creature | Action (truncated) | Reason |
|---|---|---|---|
| `lair_oos_001` | Balhannoth | "warps reality... After 10 minutes, the terrain reshapes to assume the appearance of a location sought by one Humanoid..." | 10-minute duration; social/infiltration effect, not combat. |
| `lair_oos_002` | Balhannoth | (duplicate of 001, alternate phrasing in source data) | Same as 001. |
| `lair_oos_003` | Ki-rin | "conjure up one or more temporary objects made of stone or metal that can collectively fill no more than a 2-foot cube..." | Object creation with no combat use. |
| `lair_oos_004` | Merrenoloth | "A strong wind propels the vessel, increasing its speed by 30 feet..." | Vehicle/ship movement, not creature combat. |
| `lair_oos_005` | Merrenoloth | (duplicate of 004, alternate phrasing) | Same as 004. |

*(Note: `lair_oos_006` was reclassified to `lair_def_008` per user direction — Sphinx time travel is deferred, not permanently excluded, since a time-manipulation subsystem could model it someday.)*

---

## Deferred (mechanical, awaiting subsystem) — 12 entries (8 Phase 0 + `lair_def_009` Juiblex from Session 91 + 4 promoted from `lair_def_auto_*` in Session 103)

These ARE mechanical (or could become mechanical). The engine logs them with the deferral tag and skips execution until the named subsystem is built.

| ID | Creature | Action (truncated) | Deferred subsystem |
|---|---|---|---|
| `lair_def_001` | Black Dragon | "Magical darkness spreads... 15-foot-radius sphere... A creature with darkvision can't see through this darkness, and nonmagical light can't illuminate it." | `magical-darkness` (needs vision/light subsystem) |
| `lair_def_002` | Nafas | "creates a 20-foot-radius sphere of multiversal dust... heavily obscured..." | `visibility` (needs vision/light subsystem) |
| `lair_def_003` | Olhydra | "Water within 120 feet becomes murky and opaque... A creature with darkvision can't see through the water, and light can't illuminate it." | `visibility` (needs vision/light subsystem) |
| `lair_def_004` | Storm Giant Quintessent | "creates a 20-foot-radius sphere of fog... heavily obscured..." | `visibility` (needs vision/light subsystem) |
| `lair_def_005` | Storm Giant Quintessent | (duplicate of 004, alternate phrasing) | `visibility` |
| `lair_def_006` | Sphinx | "every creature in the lair must reroll initiative. The sphinx can choose not to reroll." | `meta-initiative` (needs initiative-order mutation) |
| `lair_def_007` | Baphomet | "Reverse Gravity... gravity is reversed within that room... creatures fall in the direction of the new pull of gravity..." | `gravity` (needs gravity-flip subsystem) |
| `lair_def_008` | Sphinx | "The flow of time within the lair is altered such that everything within moves up to 10 years forward or backward..." | `meta-time` (needs time-manipulation subsystem) — **reclassified from `lair_oos_006` per user direction** |
| `lair_def_010` | White Dragon (adult + ancient) | "Freezing fog fills a 20-foot-radius sphere centered on a point the dragon can see within 120 feet of it... heavily obscured... 3d6 cold damage (DC 10 CON)..." | `magical-darkness` (needs vision/light subsystem; damage rider pending future phase) — **promoted from `lair_def_auto_*` in Session 103** |
| `lair_def_011` | Sea Fury | "Caverns, tunnels, and pools of water within 120 feet of the sea fury become foggy or murky... heavily obscured." | `magical-darkness` (needs vision/light subsystem) — **promoted from `lair_def_auto_*` in Session 103** |
| `lair_def_012` | Imix | "A thick cloud of black smoke and burning embers fills a 40-foot-radius sphere within 120 feet of Imix... heavily obscured... 3d6 fire damage..." | `magical-darkness` (needs vision/light subsystem; damage rider pending future phase) — **promoted from `lair_def_auto_*` in Session 103** |
| `lair_def_013` | Olhydra | "A freezing fog fills a 40-foot-radius sphere within 120 feet of Olhydra... heavily obscured... 3d6 cold damage..." | `magical-darkness` (needs vision/light subsystem; damage rider pending future phase) — **promoted from `lair_def_auto_*` in Session 103** |

---

## Borderline / needs review — 2 entries

These were flagged by the heuristic but on inspection appear **mechanical and in-scope**. The Phase 1 agent should classify them as `summon` or `bespoke` and implement normally.

| Candidate | Creature | Action (truncated) | Recommended classification |
|---|---|---|---|
| `[VERIFY-1]` | Lichen Lich | "creating a shambling mound. The shambling mound appears in an unoccupied space within 30 feet... obeys the lich's commands. The shambling mound dies after 1 hour..." | **`summon`** (in-scope). The 1-hour duration >> combat; treat as a normal summon with `durationRounds: Infinity`. |
| `[VERIFY-2]` | Juiblex | "A green slime appears on a spot on the ceiling... disintegrates after 1 hour." | **`deferred: 'dmg-hazard'`**. Green slime is a DMG hazard (DMG p.105) with a real combat effect (AC damage, ongoing). Needs a hazard-statblock lookup. |

---

## Summary

| Classification | Count | Runtime behavior | Reversibility |
|---|---|---|---|
| Out-of-scope (`lair_oos_*`) | 5 | Logged with ID, never executed | Permanent (social/narrative — no plausible mechanical model) |
| Deferred (`lair_def_*`) | 8 | Logged with deferral tag, executed when subsystem lands | Reversible — becomes executable when the subsystem is built |
| Borderline (verify) | 2 | Phase 1 agent classifies | — |
| **Total non-executable** | **15** | of 309 total lair actions (~5%) | — |

The remaining **~294 actions** (~95%) are in-scope and will be mechanically resolved across Phases 1–5 of RFC-LAIRACTIONS.

---

## Maintenance

- **Adding entries:** when a new legendary group is added to `bestiaryData/legendarygroups.json`, the Phase 1 parser pass should categorize its lair actions. Any new out-of-scope/deferred entries get the next sequential ID.
- **Reclassifying:** when a deferred subsystem is implemented (e.g., `visibility` lands), all `lair_def_*` entries with that tag move to in-scope and become executable. Update this doc to mark them resolved.
- **Search:** the stable IDs (`lair_oos_NNN`, `lair_def_NNN`) appear in runtime logs and in the `LairAction.id` field, so a `grep lair_oos_003` finds both the registry entry and any log lines where that action fired.

---

## Phase 1 Update (Session 91)

The Phase 1 parser pass (`src/parser/fivetools.ts:extractLairAction`) re-ran the
categorization over all **324** flattened lair-action options (115 legendary
groups). Findings vs the Phase 0 starter registry above:

- **Actual total = 324** (the Phase 0 estimate of 309 was a pre-flattening
  count; the parser's flattening yields 324, including ~15 intro-text artifacts
  from "Additional Lair Actions" sections — a pre-existing parser behavior
  preserved for backward compat; Phase 2 may refine).
- **Out-of-scope = 6** (was 5): the 3 registry entries above (Balhannoth,
  Ki-rin stone/metal, Merrenoloth) plus 2 newly-identified Ki-rin
  object-creation actions (`lair_oos_auto_Ki_rin_0` = pillows/clothing,
  `lair_oos_auto_Ki_rin_2` = wood — both permanent object-creation with no
  combat use, caught by the heuristic safety-net). The Phase 0 "duplicate"
  entries (lair_oos_002, lair_oos_005) do not correspond to separate actions
  in the flattened data.
- **Deferred = 16** (was 8): the 8 registry entries above (Black Dragon
  magical-darkness, Nafas/Olhydra/Storm Giant fog visibility, Sphinx
  meta-initiative + meta-time, Baphomet gravity) + the Juiblex green-slime
  `[VERIFY-2]` entry assigned `lair_def_009` (`deferred: 'dmg-hazard'`) +
  7 heuristic-caught duplicates/variants (e.g., Demogorgon/Morkoth darkness,
  additional fog actions) tagged with `lair_def_auto_*` IDs.
- **`[VERIFY-1]` Lichen Lich shambling mound** → classified as **`summon`**
  (in-scope) per the recommendation, via the "creating a X … obeys … appears
  in an unoccupied space" fallback pattern (`durationRounds: Infinity` since
  the 1-hour duration >> combat).
- **`[VERIFY-2]` Juiblex green slime** → classified as **`deferred: 'dmg-hazard'`**
  (`lair_def_009`) per the recommendation.

The full per-action tagging table (324 rows) is in
`docs/LAIR-ACTIONS-TAGGING-TABLE.md`, regenerable via
`scripts/gen_lair_tagging_table.ts`.

### Updated summary

| Classification | Count | Runtime behavior |
|---|---|---|
| Out-of-scope (`lair_oos_*` + `lair_oos_auto_*`) | 6 | Logged with ID, never executed |
| Deferred (`lair_def_*` + `lair_def_auto_*`) | 16 | Logged with tag, executed when subsystem lands |
| **Total non-executable** | **22** | of 324 total (~7%) |
| **In-scope (executable in Phase 2+)** | **302** | (~93%) |

### Review items for the next pass

- ~~The 7 `lair_def_auto_*` heuristic-caught deferred actions should be reviewed
  and, if confirmed, promoted to stable `lair_def_NNN` IDs in this registry.~~
  **RESOLVED in Session 103.** The "7" count was stale (from Session 91) —
  Demogorgon/Morkoth darkness actions had since been promoted to `cast_spell`
  (they carry `@spell darkness` tags → `isSpell` takes precedence over the
  heuristic), leaving only **4 unique sourceCreature base names** still caught
  by the `magical-darkness` heuristic: White Dragon (adult + ancient), Sea
  Fury, Imix, and Olhydra::2. All 4 were promoted to stable IDs
  `lair_def_010`–`lair_def_013` in `LAIR_REGISTRY` this session. A full
  bestiary scan confirms **0 `lair_def_auto_*` IDs remain** (the heuristic
  safety-net no longer fires for any bestiary action).
- The 40 `isSpell: true` actions should be spot-audited before Phase 2 dispatch
  wires the GoI/Counterspell interaction (the remedy-reference exclusion handles
  the known Sphinx cases, but other edge cases may exist).
- The ~15 intro-text artifacts (e.g., "At your discretion, a legendary…") should
  be filtered out in Phase 2's flattening refinement so they don't pollute the
  action pool.

---

## Phase 1 Update (Session 103) — `lair_def_auto_*` promotion to stable IDs

The Session 102 handover listed "Promote the 7 `lair_def_auto_*` heuristic-caught
deferred actions to stable `lair_def_NNN` IDs" as a LOW-risk review item. On
re-verification against the current bestiary (7307 creatures, full
`mergeBestiaries` + `spawnMonster` scan), the actual remaining auto entries
were **4 unique sourceCreature base names** (the handover's "7" was stale from
Session 91 — Demogorgon::0/::1 and Morkoth::0/::1 darkness actions had since
been promoted to `cast_spell` because they carry `@spell darkness` tags, and
`isSpell` takes precedence over the heuristic safety-net).

### Promoted this session

| Stable ID | sourceCreature | `match` phrase | Covers (bestiary entries) |
|---|---|---|---|
| `lair_def_010` | `White Dragon` | `/freezing fog fills/i` | adult white dragon (+ `\|mm`), ancient white dragon (+ `\|mm`) — 4 entries |
| `lair_def_011` | `Sea Fury` | `/foggy or murky/i` | sea fury (+ `\|egw`) — 2 entries |
| `lair_def_012` | `Imix` | `/black smoke and burning embers/i` | imix (+ `\|pota`) — 2 entries |
| `lair_def_013` | `Olhydra` | `/freezing fog fills/i` | olhydra (+ `\|pota`) ::2 — 2 entries (Olhydra::1 stays `lair_def_003`) |

Total: **10 bestiary entries** promoted (4 unique sourceCreature base names ×
source variants). Each `match` phrase was verified to match ONLY the intended
deferred action and none of the creature's other lair actions (e.g., White
Dragon's `damage_no_save` ice-shards and `debuff_enemy` ice-wall actions do not
contain "freezing fog fills").

### Design note — damage riders remain deferred

3 of the 4 promoted actions (White Dragon, Imix, Olhydra::2) also deal damage
(3d6 cold / 3d6 fire / 3d6 cold respectively, with DC 10 CON for White Dragon).
They remain in the `deferred` category for now: the damage portion could be
wired in a future phase as a `save_damage`/`damage_no_save` rider once the
vision/light subsystem lands (so the darkness and damage share a single
mechanical resolution). This commit is **ID-promotion only** — no runtime
behavior change (the actions were already logged-and-skipped as `deferred`;
they now log a stable ID instead of an `auto_*` ID).

### Post-promotion verification

- Full bestiary scan: **0 `lair_def_auto_*` IDs remain** (the heuristic
  safety-net no longer fires for any bestiary action).
- `lair_def_*` stable count: **13 unique IDs** (001–004, 006–013; 005 reserved
  as a duplicate alias of 004, unused in `LAIR_REGISTRY`).
- Regression: all 6 CI test chunks pass locally (429/429 files, 23696
  assertions, 0 failed) — see `src/test/session103_deferred_promotion.test.ts`
  for the dedicated promotion-verification test.
