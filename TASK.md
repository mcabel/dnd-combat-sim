# TASK.md

> Per AGENTS.md: when an agent has an uploaded handover, that handover supersedes
> this file for that agent. TASK.md is the default for agents without a handover
> AND the cross-workstream priority list. Each workstream section below lists
> that workstream's own next priorities.

---

## Core Engine Workstream (HANDOVER-SESSION-XX)

### Active Objective (Session 58 refresh)

**TG-028: Booming/Green-Flame Blade "melee spell attack" label fix** (PHB
2014/TCE — comment-only fix). Now the LAST remaining Core Engine task. Both
modules label their primary hit as "melee spell attack (attackType='spell')"
when TCE clarifies it's a "melee weapon attack". Risk of misleading future
implementers. Cantrip-z owns both files.

### Current Phase

**TG-031 DONE (Session 58).** Prerequisite groundwork complete:
- Concentration enforcement (TG-002) ✅
- Parser fields incl. `isUndead`/`isConstruct`/`hasMetalArmor` (TG-004) ✅
- Cantrip planner branches 13A-13N (TG-003) ✅
- Reaction registry / TG-008 partial ✅
- `elementalAffinityBonus` helper (Sessions 47-51) ✅
- **TG-027** Elemental Affinity on weapon-rider damage sites ✅
- **TG-024** Monk Ki + Sorcerer Sorcery Points transfer ✅
- **TG-032** Land Druid Nature's Ward fey/elemental charm/frighten immunity ✅
- **TG-030** Quivering Palm (Open Hand Monk 17) — touch + CON save +
  instakill/10d10 necrotic, 3 ki ✅
- **TG-031** Flurry of Blows (Monk 2) + Open Hand Technique (Open Hand 3) —
  1 ki bonus action, 2 unarmed strikes, rider (prone/push/disabler) ✅

### Acceptance Criteria (TG-028)

- `src/spells/booming_blade.ts` line 31: change "melee spell attack
  (attackType='spell')" → "melee weapon attack"
- `src/spells/green_flame_blade.ts` line 36: same change
- `src/spells/green_flame_blade.ts` line 263: update "after the melee spell"
  → "after the melee weapon attack"
- All existing tests still pass; `tsc --noEmit` clean
- Risk: ZERO — comment-only

### Immediate Priority

1. **TG-028** (PHB 2014/TCE): Booming/Green-Flame Blade label fix —
   comment-only, the LAST remaining Core Engine task. Cantrip-z owns.

### Notes

- TG-031 DONE (Session 58): Flurry of Blows + Open Hand Technique implemented.
  This also implemented Flurry of Blows itself (was NOT implemented before —
  the spec assumed it existed). The `case 'flurryOfBlows':` handles both the
  Flurry (1 ki, 2 unarmed strikes) + the Open Hand Technique rider (prone/
  push/disabler on hit). v1: rider fires once per Flurry (after the second
  hit), not per hit.
- TG-030 DONE (Session 57): Quivering Palm — single-action v1 simplification.
- TG-032 DONE (Session 56): Nature's Ward fey/elemental charm/frighten immunity.
- TG-024 DONE (Session 55): `ki` + `sorceryPoints` transfer to Combatant.
- Cantrip-z's summon Phase 1 is live; Phase 4 spells still need bespoke
  subsystems (deferred under TG-006 Phase 4).
- TG-001 (persistent-buff subsystem): **DONE** (Session 48 RFC-001).
- **All Tier-A + Tier-B Core Engine tasks are DONE except TG-028 (comment-only).**
  The Open Hand Monk's full progression is now mechanically functional:
  Open Hand Technique (TG-031), Wholeness of Body (Session 47), Diamond Soul
  (Session 48), Quivering Palm (TG-030).

---

## Sheet Agent Workstream (SHEET-HANDOVER-XX)

### Active Objective (Session 53 — newly added)

**TG-025: Per-class unarmored-AC hook** (SHEET-HANDOVER-41 Discovery). The
`computeArmorAC` function in `character_router.ts:123-165` uses
`const unarmoredBase = 10 + dexMod;` unconditionally. A Barbarian or Monk with
a shield toggled on gets the wrong AC.

### Current Phase

Not started. SHEET-HANDOVER-41 (commit `2ea3659`) closed 3 audit gaps and
flagged this Discovery. No Sheet work in Sessions 42-52 (~10 sessions idle).

### Acceptance Criteria

- `computeArmorAC` detects `Unarmored Defense` (Barbarian 1 or Monk 1) from
  `sheet.classLevels`
- Barbarian: `unarmoredBase = 10 + dexMod + conMod`
- Monk: `unarmoredBase = 10 + dexMod + wisMod`
- New test in `src/test/character_router.test.ts` or
  `src/test/unarmored_defense.test.ts`: Barbarian 1 DEX 14 CON 16 + shield →
  AC 17; Monk 1 DEX 14 WIS 16 + shield → AC 17
- All existing tests still pass; `tsc --noEmit` clean

### Immediate Priority (reverse published order, newest pre-2024 first)

1. **TG-025** (PHB 2014): unarmored-AC hook — Sheet drives unilaterally
2. **TG-026** (PHB 2014): Resources panel UI for Ki Points + Sorcery Points —
   depends on TG-024 landing first
3. **TG-029** (PHB 2014): Champion 10 second Fighting Style — Sheet drives
   steps 1-4, Core reviews step 5
4. **TG-024 step 1 (co-owned)**: `buildRawResources` adds `ki` + `sorceryPoints`
   branches — coordinate with Core Engine

### Notes

- Sheet section was missing from TASK.md before Session 53 — Sheet relied
  entirely on TEAMGOALS Sheet-tagged items. This new section gives Sheet a
  documented next-task queue.
- Sheet agent's own latest handover is `SHEET-HANDOVER-41.md` (Session 41).
  The next Sheet session should write `SHEET-HANDOVER-42.md`.
- Resources panel pattern: search `docs/characters.html` for `actionSurge` to
  find the HTML + JS template to mirror for `ki` and `sorceryPoints` rows.

---

## Creature Workstream (zHANDOVER-SESSION-XX) — formerly "Cantrip-z"

### Active Objective (Session 52 continuation → Session 53)

**Creature Megabatch Batch 4d: Death Burst (8 creatures)** + **Batch 4e
remaining traits**. Batches 0/1/2/3/4a/4b/4c/partial-4e are DONE on `main`
(Session 52, 6 commits). Batch 4d needs an on-death hook in `combat.ts`;
Batch 4e-remaining is ~60 creatures across Charge/Pounce/Incorporeal
Movement/Avoidance/Superior Invisibility/Rejuvenation/Sunlight
Sensitivity/False Appearance + low-frequency flavor traits.

### Current Phase

Not started. Prerequisite groundwork is complete:
- Reprint-safe loader (Batch 0) ✅
- Defenses parser (Batch 1) ✅
- Saves/senses/passive (Batch 2) ✅
- Recharge + Legendary Resistance (Batch 3) ✅
- Magic Resistance + Regeneration (Batch 4a/4b) ✅
- Magic Weapons flag + Blood Frenzy + Swarm + Siege Monster (Batch 4c/4e-partial) ✅

### Acceptance Criteria (per sub-batch, one commit each)

- New `Combatant.deathBurst?: { damageDice, damageType, saveDC, saveAbility, radius }` (Batch 4d)
- On-death hook in `combat.ts` applies death-burst AoE to creatures in radius
- Each Batch 4e sub-trait has its own parser helper + engine hook + test file
- All existing tests still pass; `tsc --noEmit` clean

### Immediate Priority (reverse published order, newest pre-2024 first)

> All creatures in `bestiaryData/` are from MM 2014 (450) + DMG 2014 (3), so
> reverse-published-order is automatically satisfied for any creature batch.
> Pre-2024 sourcebook data (VGM 2016, MTF 2018, etc.) is DMCA'd and cannot be
> auto-fetched; the loader is forward-compatible when the user manually drops
> more `bestiary-<source>.json` files in.

1. **Batch 4d** (MM 2014, 8 creatures): Death Burst — needs on-death hook in
   `combat.ts`. Mirror: Mud Mephit, Flameskull.
2. **Batch 4e-1** (MM 2014, 18+22 creatures): Sunlight Sensitivity (engine
   hook) + False Appearance (metadata-only) + low-frequency flavor traits
   (Keen Senses, Hold Breath, Water Breathing, Web Walker — metadata).
3. **Batch 4e-2** (MM 2014, 2 creatures): Avoidance — needs
   `halfDamageOnSuccess` flag plumbed through save→damage flow.
4. **Batch 4e-3** (MM 2014, 14+6 creatures): Charge + Pounce — needs
   movement-tracking ("did creature move ≥N ft straight toward target this
   turn?").
5. **Batch 4e-4** (MM 2014, 8+7 creatures): Incorporeal Movement (movement.ts
   change) + Superior Invisibility (AI planner self-cast hook).
6. **Batch 4e-5** (MM 2014, 6 creatures): Rejuvenation — needs death-state-
   with-respawn mechanic. Most complex 4e sub-batch; may defer.
7. **Batch 5a/5b/5c** (DMCA'd data + complex subsystems): DEFERRED until user
   manually provides more bestiary sourcebooks.

### Notes

- See `CREATURE-MEGABATCH-MIGRATION-PLAN.md` for full 6-step recipe + batch
  acceptance criteria + live Batch Status table.
- See `zHANDOVER-SESSION-52.md` for Session 52 commit log + key architectural
  decisions.
- Analysis data: `CREATURE-MEGABATCH-ANALYSIS.json` (453 creatures, 43-pattern
  taxonomy, per-creature `patterns`/`blocked_reasons`/`priority`).
- Coordination: any engine hook in `combat.ts` should be flagged in TEAMGOALS.md
  in case Core Engine is also touching the same code path.

---

## hadPrepTime — Precast System (New Feature)

### Overview

An optional per-combatant toggle `hadPrepTime: boolean`. When `true`, the
combatant enters combat already under the effects of pre-cast buffs, simulating
a character who had preparation time before the encounter (e.g. a Lich, a
prepared PC, a dungeon boss). A secondary `simplifiedPrecast: boolean` toggle
activates a small curated hardcoded list of safe spells instead of the full
resolution algorithm.

### Design Decisions (locked — do not revisit without explicit directive)

- **Tier limits**: 4× tier-8h spells, 3× tier-1h, 2× tier-10m, 1× tier-1m;
  no 1-round precasts.
- **Casting order**: highest-duration tier first; duration deduction is
  validated before committing each spell.
- **Concentration**: max 1 concentration spell total across all precast tiers.
- **Slot rules (precast only)**:
  - Permanent / until-dispelled / until-destroyed → **no slot consumed**.
  - Instantaneous spells with permanent lasting result (Find Familiar,
    Goodberry) → **no slot consumed** (permanent benefit, rested).
  - All other durations (8h+, 1h, 10m, 1m) → **consume slot normally**.
- **Slot rules (mid-combat)**: ALL spells cost slots normally regardless of
  duration. The "permanent = free" rule is precast-only.
- **Slot regeneration** (Arcane Recovery, Natural Recovery, etc.): deferred to
  Phase 2. Config must include `consumesSlot` boolean as the hook.
- **Config location**: `src/ai/precastConfig.ts` — separate from spell modules.
  Covers stubs and unimplemented spells; spell modules unchanged.
- **Conflict avoidance**: engine will not precast a spell whose remaining
  duration at combat start (after all subsequent casting-time deductions) would
  be ≤ 0.

### Tasks

**TG-033** *(Core Engine — research, no implementation)*

Precast candidate audit. Produce `docs/PRECAST-RESEARCH.md`.

Full instructions: **`researchSpec1.md`** (repo root).

Deliverable: structured candidate table + TypeScript schema proposal for
`PRECAST_CONFIG`. No code changes. No `combat.ts`/`planner.ts` edits.

Acceptance criteria:
- `docs/PRECAST-RESEARCH.md` exists and follows the format in `researchSpec1.md`
- All PHB implemented spells with duration ≥ 1 minute are classified
- Simplified precast list (6-10 entries) confirmed with rationale
- `PRECAST_CONFIG` TypeScript interface proposed
- Edge cases documented (ally-targeting, creature-type-dependent, v1 no-ops)

---

**TG-034** *(Core Engine — blocked on TG-033)*

Create `src/ai/precastConfig.ts` from the TG-033 research output.

Acceptance criteria:
- `PRECAST_CONFIG` map populated for all precastable spells
- `DurationTier`, `CastingTimeTier`, `PrecastEntry` types exported
- `tsc --noEmit` clean; all existing tests pass
- No changes to `combat.ts`, `planner.ts`, or spell modules

---

**TG-035** *(Core Engine — blocked on TG-034)*

Implement `hadPrepTime` precast engine.

Acceptance criteria:
- `Combatant` gains optional `hadPrepTime?: boolean` and
  `simplifiedPrecast?: boolean` fields in `src/types/core.ts`
- New `src/engine/precast.ts`: `applyPrecastEffects(combatant, state)` —
  reads `PRECAST_CONFIG`, selects eligible spells, validates duration,
  applies `ActiveEffect` entries, deducts slots
- Called from `combat.ts` at combat initialization, before round 1
- RFC posted to `TEAMGOALS.md` before `combat.ts` modification
- Simplified precast path hardcoded, bypasses resolution algorithm
- Unit tests: at minimum a Wizard-with-hadPrepTime gains Mage Armor effect
  at round start; a caster with simplifiedPrecast gets expected effect list
- All existing tests pass; `tsc --noEmit` clean

---

### Immediate Priority

**TG-033** — research only. Read `researchSpec1.md` before starting.

---

## Cross-Workstream Coordination Notes

- **Session 53 red-X fix (commit `7a68d30`)**: Session 52 Batch 0 deleted the
  byte-identical `bestiary-mm.json` (kept `bestiary-mm-2014.json`), but two
  test files (`faerie_fire.test.ts`, `healing_spells.test.ts`) still
  hard-coded the deleted path → CI failures. Fixed by using the same
  `fs.existsSync()` fallback pattern already used in `src/scenarios/presets.ts`.
- **Session 53 audit**: cleaned up stale TG-013 (DONE), TG-006 (Phase 1/2/3
  DONE), TG-009 (Dispel Magic DONE), PENDING REVIEW log (stale TG-006 ACK
  removed). Added Session 53 Priorities section with TG-024..TG-032 to give
  Sheet + Core agents a fresh, ranked task queue.
- **Handover file hygiene**: `AGENTS.md` says max 2 of each handover type in
  repo root. Currently `zHANDOVER-SESSION-49.md` + `zHANDOVER-SESSION-50.md` +
  `zHANDOVER-SESSION-52.md` are all in root (3 z-handovers). Session 53 should
  archive `z-49` to `HandoverOld/`.
