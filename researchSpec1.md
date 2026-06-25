# researchSpec1.md — hadPrepTime Precast System Research

## Purpose

This document gives a new agent full context to research and produce the
`precastConfig.ts` schema and candidate spell list for the `hadPrepTime`
feature. No implementation is expected from this task — only a structured
research output document (see Deliverables).

---

## What is hadPrepTime?

An optional per-combatant toggle. When `true`, the combatant enters combat
already under the effects of one or more self-cast buffs, as if they had time
to prepare before the encounter began.

The system must:
- Determine which spells a combatant would have cast before combat
- Apply their effects as pre-existing `ActiveEffect` entries at combat start
- Deduct duration for the time spent casting (higher-duration spells first)
- Respect a max-1-concentration constraint
- Limit precast count per duration tier (see Tier Rules below)
- Consume spell slots for eligible spells (see Slot Rules below)

---

## Design Decisions (final — do not re-litigate)

### Slot consumption rules

| Spell type | Precast phase | Mid-combat |
|---|---|---|
| Permanent / until-dispelled / until-destroyed | **Free — no slot consumed** | Costs slot normally |
| All other durations (8h+, 1h, 10m, 1m) | **Costs slot normally** | Costs slot normally |
| Instantaneous with lasting benefit (e.g. Find Familiar, Goodberry) | Free (permanent result) | Costs slot normally |

The "permanent = free" rule applies **only** during precast. Mid-combat, every
spell costs slots normally regardless of duration. This is the key clarification:
long-duration ≠ free. Only truly permanent (until-dispelled/destroyed) effects
are slot-free during precast.

### Tier limits

Tiers are based on the spell's *effect duration*, not casting time.
Casting time determines which tier an instantaneous-but-lasting spell falls in.

| Tier | Duration | Max precasts | Slot consumed? |
|---|---|---|---|
| `tier-8h` | ≥ 8 hours | 4 | Yes |
| `tier-1h` | 1 hour | 3 | Yes |
| `tier-10m` | 10 minutes | 2 | Yes |
| `tier-1m` | 1 minute | 1 | Yes |
| `permanent` | Until dispelled/destroyed | Counts against tier-8h pool | No |
| `instantaneous-lasting` | Instantaneous but produces permanent result | By casting time | No |

No precast of 1-round duration spells. They would expire immediately.

### Casting order

Higher-tier (longer-duration) spells are cast first. This minimises the
duration deducted from long-lasting spells by shorter-casting-time spells cast
after them. The engine validates after each spell that its remaining duration
at combat start is still > 0 and prunes the list if not.

### Concentration

Max 1 concentration spell in the entire precast list. The engine picks the
concentration spell with the highest combat value if multiple candidates exist.

### Slot regeneration (Phase 2 — not in scope for this research task)

Some creatures/classes can recover spell slots (Arcane Recovery, Natural
Recovery, etc.). The config must include a `consumesSlot` boolean so the hook
exists, but the regeneration logic is deferred to a separate task.

### Simplified precast toggle

A secondary boolean `simplifiedPrecast`. When `true`, bypass the full
resolution algorithm entirely and apply a small hardcoded curated list of
safe, non-conflicting spells filtered by what the combatant can actually cast.
The curated list must be non-overlapping (no two spells conflict with each
other). Suggested candidates (research should confirm): Mage Armor, Find
Familiar, Goodberry, Longstrider, False Life, Aid.

---

## Config Architecture Decision

Precast metadata lives in a **separate `src/ai/precastConfig.ts`**, not in
individual spell modules. Reasons:
- Covers the full spell list including stubs and unimplemented spells.
- Single auditable location.
- Spell modules don't need modification.
- The engine reads config first; falls back to module metadata if a
  `precastable` flag is ever added to modules later.

---

## Key Files to Read Before Starting

| File | Why |
|---|---|
| `src/data/spells.ts` | `SpellTemplate` interface + `SPELL_DB` — all combat spells, `outOfCombat` flag, `requiresConcentration`, `slotLevel` |
| `src/spells/*.ts` | All implemented spell modules — check `metadata.castingTime`, `metadata.concentration`, and module behavior |
| `testDataSpells/spells-phb.json` | Canonical PHB spell data: `time` (casting time) and `duration` objects in 5e.tools format |
| `src/types/core.ts` | `Combatant`, `ActiveEffect`, `SpellSlots` — understand what state is available at combat start |
| `src/ai/resources.ts` | `consumeSpellSlot`, `hasSpellSlot` — how slot consumption works currently |
| `src/engine/spell_effects.ts` | `applySpellEffect` — how effects are applied |
| `src/test/out_of_combat_spells.test.ts` | Reference for existing out-of-combat test pattern |

---

## 5e.tools Duration Format (for testDataSpells lookups)

```json
// Permanent / until dispelled
{ "type": "permanent" }
{ "type": "special" }

// Timed
{ "type": "timed", "duration": { "type": "hour", "amount": 8 } }
{ "type": "timed", "duration": { "type": "minute", "amount": 10 } }
{ "type": "timed", "duration": { "type": "minute", "amount": 1 }, "concentration": true }

// Instantaneous
{ "type": "instant" }
```

Casting time format:
```json
{ "time": [{ "number": 1, "unit": "action" }] }
{ "time": [{ "number": 1, "unit": "hour" }] }
{ "time": [{ "number": 10, "unit": "minute" }] }
```

---

## Current outOfCombat Flag — What It Means

`SpellTemplate.outOfCombat: true` in `src/data/spells.ts` marks a spell as
**never selectable by the combat AI**. There are ~56 spell modules in
`src/spells/` with `metadata.outOfCombat = true` and ~10 more in `SPELL_DB`.

**This flag is not the same as "precastable."** Most `outOfCombat` spells are
either:
- Divination/communication with zero combat benefit (Sending, Tongues, Comprehend Languages)
- Too-slow casting time for even precast (Simulacrum: 12 hours, Clone: 1 hour)
- No lasting mechanical benefit (Revivify, Gentle Repose)

The research task must audit each `outOfCombat` spell and determine if it is
also precastable (some are, most are not).

---

## Audit Procedure

### Step 1 — Enumerate candidates

From `src/spells/*.ts`, collect all spells where:
- The spell has a duration ≥ 1 minute, OR
- The spell is instantaneous but produces a lasting result (Find Familiar,
  Goodberry, Animate Dead, etc.)

Cross-reference with `testDataSpells/spells-phb.json` (and other JSON files
in `testDataSpells/`) for canonical duration and casting time.

### Step 2 — Classify each candidate

For each candidate produce a record with these fields:

| Field | Values | Notes |
|---|---|---|
| `spellKey` | string | Lowercase key matching `SPELL_DB` or module name |
| `precastable` | boolean | True if useful as a precast buff |
| `durationTier` | `'permanent' \| 'tier-8h' \| 'tier-1h' \| 'tier-10m' \| 'tier-1m' \| 'instantaneous-lasting'` | |
| `castingTimeTier` | `'action' \| 'bonus' \| '1m' \| '10m' \| '1h' \| '8h+'` | For instantaneous-lasting spells, this determines which slot they count against |
| `consumesSlot` | boolean | False only for permanent / instantaneous-lasting permanent spells |
| `requiresConcentration` | boolean | From PHB |
| `simplifiedPrecast` | boolean | True only for the small safe curated list |
| `rejectReason` | string \| null | If `precastable: false`, why (e.g. "no combat benefit", "divination only", "requires target combatant") |

### Step 3 — Flag edge cases

Document any spell that is:
- Concentration AND long duration (e.g. Heroism 1m conc — allowed but uses the 1 concentration slot)
- Self-targeting vs ally-targeting (ally buffs need a target resolution strategy — flag as "requires-target-v2")
- Creature-type dependent (Protection from Evil and Good — depends on enemy type)
- Already implemented with known v1 limitations (Longstrider: `outOfCombat: true` because no speed system yet — precast of this spell would apply an effect the engine can't act on)

### Step 4 — Simplified precast list

Confirm the simplified precast list. Requirements:
- Non-conflicting (no two spells on the list can interfere with each other)
- Self-targeting only in v1 (no ally-targeting complexity)
- Clear mechanical benefit in v1 engine (Mage Armor gives AC, Find Familiar gives Help advantage, Goodberry gives HP reserve, etc.)
- Max 6-10 entries
- Must include at most 1 concentration spell

---

## Deliverable Format

Produce a file: `docs/PRECAST-RESEARCH.md`

Structure:

```markdown
# Precast Research — hadPrepTime Candidate Spells

## Summary
- Total candidates: N
- Precastable: N
- Not precastable: N
- Simplified list: N spells

## Simplified Precast List
| Spell | Tier | Conc? | Slot? | Notes |
...

## Full Candidate Table
| spellKey | precastable | durationTier | castingTimeTier | consumesSlot | requiresConcentration | simplifiedPrecast | rejectReason |
...

## Edge Cases
...

## Proposed precastConfig.ts Schema
(TypeScript interface only — no implementation)
```

The schema section must define the TypeScript interface for a config entry and
the config map type. Example shape (researcher may revise):

```typescript
export type DurationTier =
  | 'permanent'
  | 'tier-8h'
  | 'tier-1h'
  | 'tier-10m'
  | 'tier-1m'
  | 'instantaneous-lasting';

export type CastingTimeTier =
  | 'action' | 'bonus' | '1m' | '10m' | '1h' | '8h+';

export interface PrecastEntry {
  precastable: boolean;
  durationTier: DurationTier;
  castingTimeTier: CastingTimeTier;
  consumesSlot: boolean;
  requiresConcentration: boolean;
  simplifiedPrecast: boolean;
  rejectReason?: string;
}

export const PRECAST_CONFIG: Record<string, PrecastEntry> = { ... };
```

---

## Out of Scope for This Task

- Implementation of the precast engine (`hadPrepTime` toggle in `Combatant`,
  precast loop at combat init, duration deduction)
- Slot regeneration features (Arcane Recovery, etc.) — Phase 2
- Ally-targeting buff precast — Phase 2
- Any changes to `combat.ts`, `planner.ts`, `core.ts`

Those are blocked on this research output.

---

## Known Relevant Spells (Starting Point — Not Exhaustive)

These are confirmed candidates based on the design conversation. The audit may
add or remove entries.

| Spell | Duration | Notes |
|---|---|---|
| Mage Armor | 8h | No concentration. Slot-cost. Simplified list. |
| Find Familiar | Instantaneous (permanent familiar) | 1h casting time. No slot cost in precast. Simplified list. |
| Goodberry | Instantaneous (berries last 24h) | Action casting time. No slot cost (permanent-result). Simplified list. |
| Longstrider | 1h | No concentration. Slot-cost. Simplified list candidate — BUT v1 has no speed system; flag as "no v1 effect". |
| False Life | 1h | No concentration. Slot-cost. Simplified list. |
| Aid | 8h | No concentration. Slot-cost. Simplified list candidate. |
| Heroism | 1m | Concentration. Slot-cost. Simplified list candidate (uses the 1 conc slot). |
| Foresight | 8h | No concentration. Slot-cost. High value — not simplified list. |
| Stoneskin | 1h | Concentration. Slot-cost. Uses the 1 conc slot. |
| Freedom of Movement | 1h | No concentration. Slot-cost. |
| Death Ward | 8h | No concentration. Slot-cost. |
| Shield of Faith | 10m | Concentration. Slot-cost. |
| Protection from Evil and Good | 10m | Concentration. Creature-type dependent — flag. |
| Bless | 1m | Concentration. Slot-cost. |
| Barkskin | 1h | Concentration. Slot-cost. |
| Mind Blank | 24h | No concentration. Slot-cost. |
| Heroes' Feast | Instantaneous (24h benefit) | 10m casting time. No slot cost. Out-of-combat only in v1. |
| Animate Dead | Instantaneous (permanent undead) | 1m casting time. Slot-cost? Requires target — flag for v2. |

Scrying, Detect Magic, and similar divination spells are `outOfCombat: true`
and have no combat benefit — they are not precastable.
