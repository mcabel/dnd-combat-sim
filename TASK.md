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

## TG-036 — Wish (Partial Combat Implementation)

### Source

PHB 2014 p.288. 9th-level conjuration, action, self, no concentration.

### Overview

Wish is currently a full out-of-combat stub (`shouldCast` always returns null).
This task implements the two canonical combat-viable modes. All other Wish uses
(create objects, grant immunity, etc.) remain deferred — v1 covers only what
is mechanically resolvable in the combat engine.

### Mode A — Spell Duplication (safe use)

Duplicate any spell of level 1–8 from **any class** without providing
components. Treated as if cast with a level-8 slot (not 9th). No stress.

Implementation:
- `shouldCast` selects Mode A when an eligible level-8 duplicate target exists
  (highest-value available spell from any class's spell list that the combatant
  could benefit from, evaluated by the existing planner heuristics).
- `execute` calls the target spell's `execute()` directly, bypassing slot
  consumption (Wish absorbs the cost via its own 9th-level slot).
- The duplicated spell fires at **slot level 8**; upcasting bonuses apply as
  normal for level 8.
- Mode A **does not** trigger stress. No stress roll, no `wishStress` flag.

### Mode B — Mass Restoration (stress risk)

Up to 20 allies recover full HP **and** receive the effects of Greater
Restoration (one effect per ally).

**HP recovery:** each eligible ally (faction = same as caster, `currentHP` > 0
and < `maxHP`) is healed to `maxHP`.

**Greater Restoration effect priority** (per ally, applied once — pick the
first applicable condition):

1. Ability score reduced to ≤ 3 (any ability) — restore that score.
2. Spellcasting ability score reduced (see Spellcasting Ability Resolution
   below) — restore it.
3. Constitution score reduced — restore it.
4. Primary attack ability score reduced (see Primary Attack Ability below) —
   restore it.
5. Dexterity score reduced — restore it.
6. Any other ability score reduced — restore it (random among remaining).
7. No ability score reduced — still receives full HP (Greater Restoration's
   condition-ending effects are not modelled beyond ability score in v1).

**Important — polymorph exclusion:** if a combatant is under a transformation
effect (`activeEffects` contains a `shapechange` or `polymorph` effect), do
NOT treat the combatant's current ability scores as "reduced" even if they
differ from base. Polymorph replaces the stat block; it is not a score
reduction. The Greater Restoration priority check must read `baseStats` (if
available) or skip score comparison for polymorphed combatants.

**Stress mechanic:** Mode B triggers a stress roll (PHB p.289).

- Roll 1d3 (or use `Math.random() < 1/3`).
- On a 1 (33% chance): the caster gains `wishStress: true` on their
  `Combatant` record. A combatant with `wishStress: true` cannot cast Wish
  again for the remainder of the combat (their `shouldCast` immediately returns
  null on any future call).
- This models the PHB "33% chance of being unable to cast Wish ever again."
  V1 simplification: "ever again" is scoped to the current combat session;
  long-rest permanence is a campaign-level concern outside the engine's scope.

### Spellcasting Ability Resolution

Wish does not have a fixed spellcasting ability on `Combatant`. Derive it:
1. If `combatant.spellcastingAbility` is set (future field) — use it.
2. Otherwise use class-based defaults:
   - Wizard, Artificer → INT
   - Cleric, Druid, Ranger → WIS
   - Bard, Paladin, Sorcerer, Warlock → CHA
   - Unknown / no class → skip step 2 of priority (treat as "not reduced")

### Primary Attack Ability Resolution

Derive from what the combatant would use for their most-used attack:
- Has `str` ≥ `dex` AND primary weapon is not finesse → STR
- Has `dex` > `str` OR primary weapon is finesse OR ranged → DEX
- No weapon actions → skip step 4 (treat as "not reduced")

### Ability Score Reduction Tracking

`Combatant` does not currently have a `baseStats` or score-reduction field.
This task must add:

```typescript
// In Combatant interface (core.ts):
baseStr?: number; baseDex?: number; baseCon?: number;
baseInt?: number; baseWis?: number; baseCha?: number;
wishStress?: boolean;   // true → Wish stress applied; cannot cast Wish again this combat
```

`baseStr` … `baseCha` are set to the initial stat block values at
`monsterToCombatant` / `buildCombatant` time and never mutated during combat.
Score-reducing effects (Ray of Enfeeblement, Bestow Curse with ability penalty,
ability drain) compare current `str`/`dex`/… against `baseStr`/`baseDex`/… to
determine whether a score is "reduced." If `baseStr` is undefined, treat all
scores as not reduced (safe default).

### shouldCast Logic

```
shouldCast(caster, bf):
  if caster.wishStress → return null   // stressed out; never cast again this combat
  if Mode A viable (high-value L8 duplicate target exists) → Mode A (return target)
  if allies need healing or restoration (any ally at <maxHP or has reduced score) → Mode B
  return null
```

Mode A is preferred when both modes are viable, because it avoids stress risk.

### Acceptance Criteria

- `shouldCast` returns null when `wishStress: true`.
- Mode A: dispatches to target spell's `execute()` at level 8; no stress.
- Mode B: heals up to 20 allies to full HP; applies Greater Restoration
  priority per ally; rolls stress (33%); sets `wishStress: true` on failure.
- Polymorph exclusion: transformed combatants not counted as "ability reduced."
- `baseStr`…`baseCha` added to `Combatant` interface; populated in
  `monsterToCombatant` and `buildCombatant`; never mutated by the combat loop.
- `wishStress` added to `Combatant` interface; defaults to `false`/`undefined`.
- `metadata.outOfCombat` removed (Wish is now combat-usable in these modes).
- `PlannedAction.type` union updated with `'wish'`.
- `combat.ts` and `planner.ts` wired per existing spell module pattern.
- RFC posted to `TEAMGOALS.md` before `combat.ts` / `core.ts` edits.
- Unit tests:
  - Mode A fires without stress; target spell executes at level 8.
  - Mode B heals all allies; correct ability priority order applied.
  - Mode B stress roll: mock `Math.random` → stress set correctly.
  - Polymorph exclusion: polymorphed ally not counted as score-reduced.
  - Caster with `wishStress: true` → `shouldCast` returns null.
- All existing tests pass; `tsc --noEmit` clean.

### v1 Deferred / Out of Scope

- Non-duplicate, non-restoration Wish effects (create object, grant advantage,
  grant immunity, etc.) — remain stub.
- The long-rest "permanently lose Wish" PHB rule — campaign scope, not engine.
- Slot regeneration / slot-less stress cast — deferred.
- Altering reality / bending rules narrative uses — deferred.

### Implementation Notes

- Before touching `core.ts` or `combat.ts`, post RFC to `TEAMGOALS.md`.
- Read `src/spells/wish.ts` in full — the existing comments (TG-012) are still
  relevant context; superseded design notes should be updated, not deleted.
- Read `src/spells/greater_restoration.ts` if it exists; otherwise derive
  logic from PHB p.246.
- The Mode A "duplicate any spell" subsystem is the hardest part. V1
  simplification: build a hardcoded priority list of the best Level 1–8
  duplicatable combat spells (e.g. Sunburst L8, Incendiary Cloud L8, Maze L8,
  Dominate Monster L8) and pick the first one the planner would evaluate as
  beneficial. Do not build a general "cast any spell" dynamic dispatch system
  in v1.

---

## Upcasting & Spell-Level Interaction Workstream (RFC-UPCASTING.md)

> Full design, rules reference, gap analysis, and per-file change list in
> `docs/RFC-UPCASTING.md`. Read that document before starting any phase.
> Phases are ordered by architectural dependency — do not skip ahead.

### Active Objective

**TG-033: Implement the upcasting and spell-level interaction system.**  
Six phased sub-tasks. Phases 1–3 are structural groundwork + per-spell fixes.  
Phases 4–5 implement Globe of Invulnerability and AI penetration logic.  
Phase 6 (cantrip scaling) is independent and can run concurrently.

### Phases

**TG-033-P1 — `castSlotLevel` on `PlannedAction` (structural)**

- Add `castSlotLevel?: number` to `PlannedAction` in `src/types/core.ts`
- Add `getLowestAvailableSlot(caster, minLevel): number | null` to `src/ai/resources.ts`
- Update `getSpellInfoFromPlan()` in `src/engine/combat.ts` to read `castSlotLevel ?? action.slotLevel ?? 1` instead of defaulting to 1
- Update every bespoke spell planner branch in `src/ai/planner.ts` to set `castSlotLevel` using `getLowestAvailableSlot`
- Test: Counterspell now sees correct level when Fireball is planned at L5
- Risk: LOW — no behavior change until planner branches set the field

**TG-033-P2 — `sourceSlotLevel` on `ActiveEffect` (structural)**

- Add `sourceSlotLevel?: number` to `ActiveEffect` in `src/types/core.ts`
- Add `sourceSlotLevel` param (default 0) to `applySpellEffect()` in `src/engine/spell_effects.ts`; store it on the created effect
- Update `dispel_magic.ts` to use `effect.sourceSlotLevel` for DC (`10 + sourceSlotLevel`, fallback DC 13); flip `dispelMagicSpellLevelTrackingV1Implemented` to `true`
- Test: effect with `sourceSlotLevel: 5` → Dispel Magic uses DC 15; legacy effect (undefined) → DC 13
- Risk: LOW — backward-compat (`undefined` treated as 0 in all checks)

**TG-033-P3 — Upcast damage scaling for ~18 bespoke damage spells**

Depends on: TG-033-P1 (so `castSlotLevel` is available on plans).  
For each spell: capture the return value of `consumeSpellSlot()` and feed it
into the damage/target/dart formula. Flip `xxxUpcastV1Implemented` to `true`.

Commit as 5 sub-batches (one commit each):

- **P3a:** `fireball`, `lightning_bolt`, `shatter`, `thunderwave`
- **P3b:** `dissonant_whispers`, `inflict_wounds`, `guiding_bolt`, `burning_hands`
- **P3c:** `scorching_ray`, Magic Missile dart count (`combat.ts`), `sleep`, `aid`, `blindness_deafness`
- **P3d:** `cure_wounds`, `healing_word`, `spiritual_weapon`
- **P3e:** `hunger_of_hadar`, `mind_spike`, `sunburst`

Upcast formulas (canonical PHB 2014 "At Higher Levels"):

| Spell (base level) | Formula |
|---|---|
| Fireball (L3) | `diceCount = 8 + max(0, slot − 3)` d6 fire |
| Lightning Bolt (L3) | `diceCount = 8 + max(0, slot − 3)` d6 lightning |
| Shatter (L2) | `diceCount = 3 + max(0, slot − 2)` d8 thunder |
| Thunderwave (L1) | `diceCount = 2 + max(0, slot − 1)` d8 thunder |
| Dissonant Whispers (L1) | `diceCount = 3 + max(0, slot − 1)` d6 psychic |
| Inflict Wounds (L1) | `diceCount = 3 + max(0, slot − 1)` d10 necrotic |
| Guiding Bolt (L1) | `diceCount = 4 + max(0, slot − 1)` d6 radiant |
| Burning Hands (L1) | `diceCount = 3 + max(0, slot − 1)` d6 fire |
| Scorching Ray (L2) | `rayCount = 3 + max(0, slot − 2)` |
| Magic Missile (L1) | `dartCount = 3 + max(0, slot − 1)` |
| Sleep (L1) | `poolDice = 5 + 2 × max(0, slot − 1)` d8 HP budget |
| Aid (L2) | `hpGain = 5 × (1 + max(0, slot − 2))` per target |
| Blindness/Deafness (L2) | `targetCount = 1 + max(0, slot − 2)` |
| Cure Wounds (L1) | `diceCount = 1 + max(0, slot − 1)` d8 + mod |
| Healing Word (L1) | `diceCount = 1 + max(0, slot − 1)` d4 + mod |
| Spiritual Weapon (L2) | `dieCount = 1 + floor(max(0, slot − 2) / 2)` d8 (every 2 levels) |
| Hunger of Hadar (L3) | `dieCount = 2 + max(0, slot − 3)` each for cold and acid |
| Mind Spike (L2, XGE) | `diceCount = 3 + max(0, slot − 2)` d8 psychic |
| Sunburst (L8, XGE) | `diceCount = 12 + 2 × max(0, slot − 8)` d6 radiant |

**TG-033-P4 — Globe of Invulnerability (real implementation)**

Depends on: TG-033-P1 (castSlotLevel), TG-033-P2 (sourceSlotLevel / isProtectedByGoI).

- Replace the forward-compat stub in `src/spells/globe_of_invulnerability.ts`:
  - Consume L6+ slot; compute `blockThreshold = 5 + max(0, slotLevel − 6)`
  - Store threshold accessible to combat.ts (via `ActiveEffect` with `effectType: 'spell_shield'` and `payload.blockThreshold` recommended; or `(caster as any)._globeOfInvulnerabilityThreshold` for a faster v1 path — see RFC §4.1)
  - Start concentration; cleanup removes threshold on concentration break
- Add `isProtectedByGoI(target, castLevel): boolean` to `src/engine/spell_effects.ts`
- Add GoI blocking check in `src/engine/combat.ts` at the pre-dispatch point (after Counterspell trigger, before spell executes): if target is GoI-protected and castLevel ≤ threshold → consume slot, log block, skip execution
- Handle AoE: exclude GoI-protected targets from target list before damage loop (spell still fires; protected targets are skipped)
- v1 scope: GoI protects only the caster (radius check deferred); document via `globeOfInvulnerabilityRadiusV1Simplified: true`
- Cantrips (castLevel = 0) are NEVER blocked — `0 ≤ threshold` would be true but cantrips are level 0 and explicitly excluded per PHB p.245
- Tests: GoI L6 blocks Fireball at L3/L4/L5; does NOT block Fireball at L6; GoI L7 blocks up to L6; slot consumed even when blocked; concentration break clears GoI; cantrip never blocked

**TG-033-P5 — AI penetration-motivated upcasting**

Depends on: TG-033-P1, TG-033-P4.

- Add `selectCastSlot(caster, baseLevel, target): number | null` to `src/ai/planner.ts`:
  reads GoI threshold on target; returns the minimum slot that either (a) meets baseLevel with no obstruction, or (b) penetrates the blocking threshold; returns null if impossible
- Replace `getLowestAvailableSlot(self, baseLevel)` calls in each bespoke damage-spell planner branch with `selectCastSlot(self, baseLevel, primaryTarget)`
- If `selectCastSlot` returns null (target is GoI-protected and no penetrating slot available), the planner branch returns early (falls through to next option — cantrip / weapon attack)
- Tests: AI with GoI-protected target and available L6 slot → plans Fireball at L6; with only L3 → skips Fireball; without GoI → plans Fireball at L3

**TG-033-P6 — Cantrip caster-level damage scaling (independent)**

No dependency on P1–P5. Can run in any session.

- Add `cantripTier(caster): 0 | 1 | 2 | 3` to `src/engine/utils.ts`:
  reads `monsterSpellcasting.spellcasterLevel ?? caster.level ?? 1`; returns 0/1/2/3 at breakpoints 1/5/11/17
- Apply `+ cantripTier(caster)` to die count in each cantrip module:
  `fire_bolt`, `ray_of_frost`, `chill_touch`, `poison_spray`, `toll_the_dead`, `sacred_flame`, `shocking_grasp`, `acid_splash`, `vicious_mockery`, `thunderclap`, `green_flame_blade`, `booming_blade`, `mind_sliver`
- Eldritch Blast: +1 beam per tier (2/3/4 beams at levels 5/11/17). Requires multi-attack loop in combat dispatch — may be its own sub-commit
- Tests: L5 caster → Fire Bolt 2d10; L11 caster → 3d10; L1 monster with `spellcasterLevel: 11` → 3 dice; cantrip is still level 0 for all GoI/Counterspell/Dispel interactions

### Acceptance Criteria (full system)

- `tsc --noEmit` clean throughout
- All existing tests pass after each phase
- Counterspell sees correct spell level for upcast bespoke spells (P1)
- Dispel Magic uses accurate DC from `sourceSlotLevel` (P2)
- Each listed damage spell produces upcast damage at slot+2 (P3)
- GoI blocks correct spell levels; penetration works (P4)
- AI upcasts into GoI when a penetrating slot is available (P5)
- Level-5 caster deals 2× die count with cantrips (P6)

### Notes

- Full design rationale, interaction matrix, and per-file change list: `docs/RFC-UPCASTING.md`
- Cantrips are ALWAYS level 0 for interaction purposes (GoI, Counterspell, Dispel Magic). Caster-level scaling (P6) is a separate mechanism that does NOT change the interaction level.
- Hellish Rebuke, Invisibility, Protection from Energy, all Summon X spells already implement upcast correctly — use them as reference patterns.
- Counterspell is the gold standard for slot-vs-spell-level interaction — read `src/spells/counterspell.ts` before implementing GoI blocking.

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
