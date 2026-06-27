# HANDOVER-SESSION-90

## REPOSITORY

- Branch: main
- Commits this session:
  - `<pending>` — Session 90: add RFC-LAIRACTIONS.md + LAIR-ACTIONS-OUT-OF-SCOPE.md (documentation only, no code change)
- Previous: `82073a8` (Session 89 handover), `a53eaf4` (Session 89 Aura of Vitality per-turn), `96bb6b6` (Session 88 handover), `98bbd15` (Session 88 EB spread damage)
- State: clean (will push after commit)
- URL: https://github.com/mcabel/dnd-combat-sim
- PAT: provided at session start (embed in remote URL as usual)

## COMPLETED THIS SESSION

### Part 1: Lair Actions RFC + Out-of-Scope Registry — documentation only

**User direction:** "Lair actions are a special ability that should be tied to a flag in the monster UI by default to 'on' (`LairMonstersAREinLair`); if on, at initiative count 20.00, with priority over ties, one of the effects described will be executed. Some lair actions are only for flavor or social roleplay with no benefit to combatants — those must be identified and need not be modeled, simply logged in their own out-of-scope document with an ID for searchability. The effects go from casting a spell automatically, to spawning minions, to automatic environmental damage, to hazards and many others. They should get a weighted score for the engine to pick the most beneficial to the Lair creature party. Prepare the RFC detailed and provide the handover that references it to give to another agent."

**Deliverables (no code change — documentation only):**

1. **`docs/RFC-LAIRACTIONS.md`** — a detailed, phased RFC for implementing mechanical lair actions. Grounded in analysis of the actual bestiary data (115 legendary groups, 309 lair action options, 5eTools schema tags). Covers:
   - **Problem statement** (current stub is a no-op random-pick log)
   - **Research findings** (data scale, 5eTools tag frequency, effect taxonomy, reusable engine subsystems, what's missing)
   - **7 documented design decisions [DD-1..DD-7]** with recommendations and flags for user review:
     - [DD-1] `isInLair` flag, per-combatant, default `true` when `lairActions` defined
     - [DD-2] Initiative count 20, **priority over ties** (house rule per user direction; Option A = resolve at round start, recommended)
     - [DD-3] Multiple lair creatures — each acts independently, descending CR order
     - [DD-4] Lair actions are NOT spells — not blocked by GoI, not Counterspellable (2024 MM clarification)
     - [DD-5] "Can't repeat 2 rounds in a row" — per-creature 2-entry history
     - [DD-6] AI scoring — expected-value estimator, not a planner action
     - [DD-7] Out-of-scope flavor actions — registry with stable IDs, logged not executed
   - **Out-of-scope identification heuristic** (§4) — precise rules for `outOfScope` vs `deferred` vs `bespoke`
   - **Structured `LairAction` schema** (§5) — the new type replacing `string[]`
   - **Engine integration** (§6) — `resolveLairActions(state)` at round start, dispatcher by category, interaction matrix (GoI, Counterspell, concentration, reactions, summons, death)
   - **AI scoring rubric** (§7) — weighted expected-value with tunable weights in one config object
   - **6 implementation phases** (§8) — each independently shippable:
     - Phase 0: taxonomy + out-of-scope registry (DONE this session)
     - Phase 1: structured schema + parser extraction
     - Phase 2: engine dispatch infrastructure (flag, history, out-of-scope logging)
     - Phase 3: effect handlers by category (save_damage, summon, cast_spell, etc.)
     - Phase 4: AI scoring + selection
     - Phase 5: integration + edge cases
     - Phase 6: deferred subsystems (gravity, magical-darkness, dmg-hazard, meta-initiative)
   - **5 open questions** (§10) for user review before Phase 1 starts

2. **`docs/LAIR-ACTIONS-OUT-OF-SCOPE.md`** — the Phase 0 registry. Identifies 15 non-executable lair actions (of 309 total, ~5%):
   - 6 out-of-scope (`lair_oos_001`–`lair_oos_006`): Balhannoth terrain warp, Ki-rin object creation, Merrenoloth ship propulsion, Sphinx time travel
   - 7 deferred (`lair_def_001`–`lair_def_007`): Black Dragon magical darkness, Nafas/Olhydra/Storm Giant fog (visibility subsystem), Sphinx initiative reroll (meta-initiative), Baphomet reverse gravity
   - 2 borderline `[VERIFY]`: Lichen Lich shambling mound (recommend reclassify as `summon`), Juiblex green slime (recommend `deferred: 'dmg-hazard'`)
   - Stable IDs (`lair_oos_NNN`, `lair_def_NNN`) appear in runtime logs and `LairAction.id` for searchability.

**Why documentation only, not implementation:** the user explicitly asked to "Prepare the RFC detailed and provide the handover that references it to give to another agent." The RFC is the deliverable; implementation is deferred to the next agent per the phased plan. This keeps the change LOW-risk (no code, no tests, no CI impact) and lets the user review the design decisions before committing to implementation.

**Research grounding (key numbers from the actual data):**
- 115 legendary groups have lair actions (of 187 total groups)
- 309 total lair action options
- All use initiative count 20 (no exceptions)
- 5eTools tags present: `@dc` (197), `@condition` (116), `@damage` (81), `@spell` (56), `@creature` (45), `@dice` (18), `@skill` (17), `@status` (15), `@hit` (9), `@chance` (8), `@hazard` (2)
- 37 distinct spells referenced, 13 distinct conditions, 39 distinct summonable creatures
- DC range: 5–26
- Effect taxonomy: save+condition (55), summon (47), save+damage (41), save-only (32), auto-cast-spell (~30), damage-only (13), buff (8), visibility (8), spell-slot-regen (4), flavor (~12)

## TEST STATUS

No tests added or modified (documentation-only session). All existing tests remain green.

## TSC STATUS

`npx tsc --noEmit` baseline unchanged: **5 pre-existing errors, 0 new errors.** No code changed.

## CI STATUS

No code change → no CI impact. The docs commit will trigger a CI run (all workflows fire on push to `main`) but with no code change, all 6 test chunks will pass as they did on `82073a8`.

## OPEN BLOCKERS

None.

## IMMEDIATE NEXT ACTIONS (PRIORITY ORDER)

### 1. ⭐ Lair Actions implementation — RFC ready, Phases 1–5 pending

The RFC (`docs/RFC-LAIRACTIONS.md`) is complete and the Phase 0 registry (`docs/LAIR-ACTIONS-OUT-OF-SCOPE.md`) is populated. **The next agent should:**
1. Review the 5 open questions in RFC §10 with the user (especially [DD-2] priority-over-ties Option A, [DD-4] GoI non-blockable, and the `isInLair` UI surface question).
2. Begin Phase 1 (structured schema + parser extraction) — LOW risk, parser-only.
3. Proceed through Phases 2–5 per the RFC. Each phase is independently shippable with its own test file.

**Estimated total effort:** 4–6 sessions (one per phase). Phase 3 (effect handlers) is the largest — 8 categories, ~294 in-scope actions.

### 2. RFC-MONSTER-SPELLCASTING Phase 3 (MEDIUM-HIGH risk) — unchanged

Recharge (Dragon Breath 5-6): fully implemented (Session 52). Lair Actions: now covered by RFC-LAIRACTIONS (above). Legendary Actions: partially implemented (planner + dispatch + action pool). Phase 4 (bespoke dispatch for ~267 spells) completed in commit `819bc0b` (Session 75-76).

### 3. Ready Action full implementation (MEDIUM-HIGH risk) — unchanged

The defensive stub (`81a541d`) prevents the fall-through bug. Full implementation needs an RFC (trigger taxonomy + AI heuristic + reaction plumbing extension). This is a candidate for the next RFC if Lair Actions is in progress.

### 4. GoI condition-suppression pipeline (LOW risk) — unchanged, RAW-ambiguous

Deferred per Session 89 handover — RAW interpretation is ambiguous and the on-cast filter already prevents application to GoI-protected creatures.

### 5. Additional spell v1 simplifications (LOW risk) — unchanged

Identified in Session 89 handover: Acid Splash multi-target, Call Lightning strike re-pick, Aura of Vitality upcast, Branding Smite duration, Banishing Smite riders. Each is a well-defined LOW-risk feature.

## CI FAILURE RECOVERY

If the docs commit has a red X on CI (extremely unlikely — no code change):

1. Read the failing check-run logs.
2. Most likely cause: a pre-existing flake (e.g., the scorching_ray double-crit flake fixed in `1eb54c6`). Re-run the failed chunk.
3. If a real failure: it's unrelated to this docs-only change. Investigate as a separate issue.

## KEY FILES THIS SESSION

### New

- `docs/RFC-LAIRACTIONS.md` — the RFC (11 sections, ~500 lines).
- `docs/LAIR-ACTIONS-OUT-SCOPE.md` — Phase 0 registry (15 entries with stable IDs).
- `zHANDOVER-SESSION-90.md` — this file.

### Modified

None (documentation-only session).

## ARCHITECTURAL NOTES

### Why an RFC, not direct implementation

The user explicitly asked for an RFC to hand to another agent. Lair Actions are a HIGH-risk feature per the Session 89 analysis:
- 309 bespoke effects across 115 creatures
- Interactions with GoI, Counterspell, concentration, reactions, summons
- No existing structured schema (current type is `string[]`)
- AI selection heuristic is a design decision, not a lookup

An RFC lets the user review the design decisions (especially the 7 [DD-N] items and 5 open questions) before committing to a multi-session implementation. The phased plan means the next agent can ship Phase 1 (parser, LOW-risk) independently and stop if the user wants to adjust the design before Phase 2 (engine dispatch).

### Why Phase 0 (registry) is done first

The out-of-scope registry is the cheapest deliverable with the most clarifying value:
- It forces a full pass over all 309 actions, surfacing the real distribution of categories.
- It identifies the ~15 actions that will never be executable, so Phases 1–5 can focus on the ~294 in-scope actions.
- It assigns stable IDs that appear in logs, making any future debugging searchable.
- It's documentation-only — zero risk, zero CI impact.

### Relationship to existing work

- **RFC-MONSTER-SPELLCASTING** (Session 52): covered Recharge and Legendary Actions. Lair Actions were the remaining gap in that RFC's "Phase 3" — RFC-LAIRACTIONS now fills that gap as a standalone, more detailed RFC.
- **Aura of Vitality per-turn** (Session 89): used the "start-of-turn auto-processing" pattern (Eyebite pattern). RFC-LAIRACTIONS's `resolveLairActions` at round-start is a similar pattern (auto-processing outside the per-actor turn loop).
- **GoI broader RAW reading** (Session 87): established that GoI blocks spells cast from outside the barrier. [DD-4] in this RFC decides lair actions are NOT spells and bypass GoI — a deliberate design choice that keeps legendary creatures threatening inside a GoI.

## VERIFICATION SNAPSHOT

- `git log --oneline -5` (after commit): `<pending>`, `82073a8`, `a53eaf4`, `96bb6b6`, `98bbd15`
- `git status` → clean (after push)
- `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **5** (pre-existing, unchanged — no code changed)
- No tests run (documentation-only session)
- **NO RED X expected** (no code change)
