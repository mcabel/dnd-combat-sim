# TASK.md

> Per AGENTS.md: when an agent has an uploaded handover, that handover supersedes
> this file for that agent. TASK.md is the default for agents without a handover
> AND the cross-workstream priority list. Each workstream section below lists
> that workstream's own next priorities.

---

## Core Engine Workstream (HANDOVER-SESSION-XX)

### Active Objective (Session 53 refresh)

**TG-024: Sorcery Points + Ki transfer to Combatant** (combines old TG-016 +
TG-017 step 1-2 into a single commit). `CharacterResources` already has `ki?`
and `sorceryPoints?` (populated by `leveler.ts`), but both `buildRawResources`
(Sheet) and `buildResources` (Core, `pc.ts:208-320`) SKIP these fields — a Monk
or Sorcerer PC has zero ki/sorcery points in combat. This blocks TG-017
Quivering Palm (now TG-030), TG-015 Draconic Presence 5-SP cost, and any
ki-based subclass feature. Fix is structurally identical to the existing
`actionSurge` pattern at `builder.ts:226` — kinematic mirror for both
resources in one commit.

### Current Phase

Not started. Prerequisite groundwork is complete:
- Concentration enforcement (TG-002) ✅
- Parser fields incl. `isUndead`/`isConstruct`/`hasMetalArmor` (TG-004) ✅
- Cantrip planner branches 13A-13N (TG-003) ✅
- Reaction registry / TG-008 partial (Shield, Hellish Rebuke, Absorb Elements,
  Feather Fall, Silvery Barbs, Counterspell, Dispel Magic, Prot. from Energy) ✅
- `elementalAffinityBonus` helper (Sessions 47-51) ✅

### Acceptance Criteria

- `PlayerResources` has typed `ki?: { max, current }` and
  `sorceryPoints?: { max, current }` (both already optional in `core.ts`)
- `buildRawResources` (Sheet `builder.ts`) writes both fields when present
- `buildResources` (Core `pc.ts`) reads both fields back into `PlayerResources`
- New tests in `resources.test.ts`: Monk 5 has `ki.current === 5`; Sorcerer 5
  has `sorceryPoints.current === 5`
- All existing tests still pass; `tsc --noEmit` clean

### Immediate Priority (reverse published order, newest pre-2024 first)

1. **TG-027** (Core Engine side of TG-015, XGE/PHB 2017/2014): wire
   `elementalAffinityBonus` into the 3 weapon-rider damage sites in `combat.ts`
2. **TG-024** (PHB 2014): ki + sorcery points transfer (single commit)
3. **TG-032** (PHB 2014): Land Druid Nature's Ward fey/elemental immunity
4. **TG-030** (PHB 2014): Quivering Palm action type — blocked on TG-024
5. **TG-031** (PHB 2014): Open Hand Technique Flurry rider — blocked on TG-024

### Notes

- Sheet agent owns `leveler.ts` / `builder.ts` — coordinate TG-024 step 1 with
  Sheet reviewer (Sheet makes the `buildRawResources` change, Core makes the
  `pc.ts` mirror change, both in one PR).
- Cantrip-z's summon Phase 1 is live; Phase 4 spells still need bespoke
  subsystems (deferred under TG-006 Phase 4).
- TG-001 (persistent-buff subsystem): **DONE** (Session 48 RFC-001) —
  `_boomingBladePendingDamageDice` scratch fields replaced by typed
  `movement_rider` ActiveEffect. RFC-001 in TEAMGOALS.md. See HANDOVER-SESSION-48.md.

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
