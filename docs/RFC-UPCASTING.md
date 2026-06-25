# RFC: Upcasting & Spell-Level Interaction System

**Workstream:** Core Engine  
**Status:** RESEARCH COMPLETE — ready for implementation  
**Priority:** HIGH (structural gap affecting Counterspell accuracy, Globe of Invulnerability, and ~30 spells with unmodelled damage scaling)  
**Canonical Sources:** PHB 2014 pp.201–202 (spell slots), pp.228 (Counterspell), pp.245 (Globe of Invulnerability), pp.233 (Dispel Magic), SAC v2.7

---

## 1. Rules Reference (Pre-2024 Canon Only)

### 1.1 What Upcasting Is

PHB p.201: *"When a spellcaster casts a spell using a slot that is of a higher level than the spell, the spell assumes the higher level for that casting."*

A creature casts a spell at the **slot level used**, not at the spell's base level. The slot is consumed, and the effective cast level is the slot level.

### 1.2 Cantrips Are Always Level 0 — No Exceptions

PHB p.201: *"Cantrips — simple but powerful spells that characters can cast almost by rote — are level 0."*

A cantrip **cannot be upcast with a slot.** It has no slot cost. It is always level 0 for any interaction that checks spell level (Globe of Invulnerability, Counterspell, Dispel Magic). Period. Its damage scaling is driven by **character level / caster CR**, not slot level. This is separate from interaction level — a cantrip at a 17th-level Wizard deals 3d10 fire but is still level 0 for interaction purposes.

### 1.3 How Upcasting Affects Spells

There are exactly three categories of upcast effect:

**Category A — Damage/Healing scaling**  
Each spell's "At Higher Levels" entry specifies a delta per slot level above the base. Examples:

| Spell | Base | Upcast Delta |
|---|---|---|
| Fireball (L3) | 8d6 fire | +1d6 per slot level above 3rd |
| Lightning Bolt (L3) | 8d6 lightning | +1d6 per slot level above 3rd |
| Magic Missile (L1) | 3 darts × 1d4+1 | +1 dart per slot level above 1st |
| Cure Wounds (L1) | 1d8 + mod | +1d8 per slot level above 1st |
| Healing Word (L1) | 1d4 + mod | +1d4 per slot level above 1st |
| Inflict Wounds (L1) | 3d10 necrotic | +1d10 per slot level above 1st |
| Scorching Ray (L2) | 3 rays | +1 ray per slot level above 2nd |
| Shatter (L2) | 3d8 thunder | +1d8 per slot level above 2nd |
| Thunderwave (L1) | 2d8 thunder | +1d8 per slot level above 1st |
| Hunger of Hadar (L3) | 2d6 cold + 2d6 acid | +1d6 each per slot level above 3rd |
| Guiding Bolt (L1) | 4d6 radiant | +1d6 per slot level above 1st |
| Mind Spike (L2, XGE) | 3d8 psychic | +1d8 per slot level above 2nd |
| Sunburst (L8, XGE) | 12d6 radiant | +2d6 per slot level above 8th |
| Sleep (L1) | 5d8 HP pool | +2d8 per slot level above 1st |
| Dissonant Whispers (L1) | 3d6 psychic | +1d6 per slot level above 1st |
| Burning Hands (L1) | 3d6 fire | +1d6 per slot level above 1st |
| Aid (L2) | +5 HP each | +5 HP per slot level above 2nd |
| Spiritual Weapon (L2) | 1d8 + mod | +1d8 per slot level above 2nd |
| Blindness/Deafness (L2) | 1 target | +1 target per slot level above 2nd |

**Category B — Target/summon/duration scaling**  
Already modelled for Invisibility, Protection from Energy, and all Summon X spells. These use `consumeSpellSlot(caster, baseLevel)` and apply the returned slot level to the scaling formula.

**Category C — Interaction effects (spells that check the slot level of an incoming spell)**  
These are the most architecturally significant:

- **Globe of Invulnerability (L6):** Blocks spells **cast at 5th level or lower.** Upcast: GoI blocks spells cast at one higher level per slot above 6th. A creature can upcast Fireball at L6 to penetrate a standard GoI (fireball base L3 → slot L6 > GoI threshold of 5).
- **Counterspell (L3):** Auto-counters spells cast at or below the Counterspell slot level. **Already implemented.** Auto-succeeds if slotLevel ≥ spell level.
- **Dispel Magic (L3):** Auto-dispels effects from spells whose slot level ≤ the Dispel slot level. **Partially implemented** but uses a flat DC-13 approximation because ActiveEffect doesn't store `sourceSlotLevel`.

### 1.4 Cantrip Caster-Level Damage Scaling (Separate Concern)

PHB p.201: *"A cantrip's power grows with the caster's character level."* Standard scaling breakpoints (Spellcasting feature tables):

- Level 1–4: base damage (1 die)
- Level 5–10: +1 die
- Level 11–16: +2 dice
- Level 17–20: +3 dice

For monsters, the equivalent is the spellcasting CR tier (MM p.10: "treats as Nth-level spellcaster"). The breakpoints are identical. The effective caster level for a monster using cantrips is its listed spellcaster level.

**This is architecturally separate from upcasting** and tracked on the caster, not the slot.

---

## 2. Current Engine State

### 2.1 What Already Works

**`consumeSpellSlot(caster, desiredLevel) → number | null`** (`src/ai/resources.ts`)  
The workhorse. Iterates from `desiredLevel` upward and consumes the lowest available slot at or above the requested level. Returns the **actual slot level consumed**. Correctly handles Warlock pact slots. This is already the right foundation — it naturally implements "using a higher slot to cast a lower-level spell."

**`hasSpellSlot(caster, minLevel)`** — already exists, used throughout.

**Counterspell** (`src/spells/counterspell.ts`) — fully models slot-vs-spell-level. `executeReaction` consumes a slot, gets the actual level used, and auto-succeeds iff `slotLevel >= trigger.level`. **Gold standard implementation.**

**Hellish Rebuke** — fully models upcast damage: `diceCount = 2 + Math.max(0, slotLevel - 1)`. The `consumeSpellSlot` return value drives damage directly.

**Invisibility** (L2), **Protection from Energy** (L3) — multi-target upcast fully modelled. The planner selects slot level based on candidate count.

**Summon Fey / Aberration / Celestial / Undead / Elemental / etc.** — stat scaling (HP, AC, attacks) fully modelled against `slotLevel`.

**Dispel Magic** — partially: upcast auto-dispels extra non-concentration effects, but DC for non-concentration effects is a flat 13 (approximate) because `ActiveEffect` doesn't carry a `sourceSlotLevel`.

### 2.2 Structural Gaps

#### GAP-1: `PlannedAction` does not carry `castSlotLevel` for bespoke spell plans

`getSpellInfoFromPlan()` in `src/engine/combat.ts` extracts spell name + level for Counterspell. For bespoke plan types (`'fireball'`, `'magicMissile'`, `'thunderwave'`, etc.), it has no slot level on the plan object and **defaults to level 1.** The code comments acknowledge this:

```typescript
// Bespoke spell case ('fireball', 'cureWounds', etc.):
// these are always spells. The level is unknown on the plan (v1), so default
// to 1 (Counterspell auto-succeeds with a L3 slot for L1-3 spells).
// Future work: add a `slotLevel?` field to PlannedAction for bespoke cases.
const name = plan.action?.name ?? plan.type;
return { name, level: 1 };
```

**Impact:** When a creature upcasts Fireball at L5, Counterspell sees it as a level-1 spell. Globe of Invulnerability (once implemented) would also need this. This gap causes Counterspell to always auto-succeed against bespoke plan spells regardless of actual slot used.

#### GAP-2: `ActiveEffect` has no `sourceSlotLevel`

`ActiveEffect` (`src/types/core.ts:158`) stores `casterId`, `spellName`, `effectType`, `payload`, but never the slot level at which the spell was cast. This means:

- Globe of Invulnerability cannot query "what level was this spell cast at?" for incoming spells mid-encounter
- Dispel Magic cannot use accurate DCs (10 + actual spell level) — must use flat DC-13
- Any future "effect cast at Nth level or higher" interaction is blocked

#### GAP-3: Upcast damage NOT modelled for most combat damage spells

The following spells have `xxxUpcastV1Implemented: false` and always roll base dice:

```
fireball, lightning_bolt, magic_missile, scorching_ray, shatter,
thunderwave, dissonant_whispers, inflict_wounds, sleep, guiding_bolt,
burning_hands, hunger_of_hadar, mind_spike, sunburst, cure_wounds,
healing_word, spiritual_weapon, aid, blindness_deafness (target count)
```

They each call `consumeSpellSlot(caster, baseLevel)`, which may return a higher level, but that return value is **discarded** — the damage calculation ignores it.

#### GAP-4: Globe of Invulnerability is a forward-compat stub

`src/spells/globe_of_invulnerability.ts` sets `_genericSpellActiveSpells.add('Globe of Invulnerability')` and does nothing else. The flag is never read. No incoming spell is ever blocked.

#### GAP-5: AI has no penetration-motivated upcast logic

The planner has no concept of "this spell would normally be blocked by an active effect on the target, but upcasting it past the blocking threshold makes it viable." This is the scenario described in the user's request: a creature might cast Fireball at L6 not for the +3d6 damage, but to bypass Globe of Invulnerability.

#### GAP-6: Cantrip caster-level damage scaling not implemented

All cantrips always use their base (level 1–4) damage expression. Fire Bolt always rolls 1d10. Eldritch Blast always generates 1 beam. This is a separate issue from upcasting, but related to the level-0 interaction question.

---

## 3. Implementation Plan

Ordered by architectural dependency. Each phase is a self-contained commit.

---

### Phase 1 — Add `castSlotLevel` to `PlannedAction` (GAP-1)

**File:** `src/types/core.ts`

Add one optional field to the `PlannedAction` interface:

```typescript
export interface PlannedAction {
  // ... existing fields ...

  /**
   * The spell slot level actually spent for this spell cast.
   * Set by the planner / bespoke spell modules at plan-construction time.
   *
   * Distinct from `action.slotLevel` (the spell's BASE level).
   * - `castSlotLevel` = slot consumed (e.g. 5 for Fireball at L5)
   * - `action.slotLevel` = spell base level (e.g. 3 for Fireball)
   *
   * 0 or undefined = cantrip (no slot consumed, interaction level = 0).
   * Used by:
   *   - getSpellInfoFromPlan() → Counterspell trigger
   *   - Globe of Invulnerability blocking check
   *   - Dispel Magic accurate DC
   *   - Upcast damage scaling in execute() handlers
   */
  castSlotLevel?: number;
}
```

**File:** `src/engine/combat.ts` — update `getSpellInfoFromPlan()`:

```typescript
// Before (bespoke spell default):
const name = plan.action?.name ?? plan.type;
return { name, level: 1 };   // ← always 1 — wrong when upcast

// After:
const name = plan.action?.name ?? plan.type;
const level = plan.castSlotLevel ?? plan.action?.slotLevel ?? 1;
return { name, level };
```

**Who sets `castSlotLevel`?**  
The planner, before returning the plan. For bespoke spells: each planner branch sets `castSlotLevel` based on the slot the spell will consume. Pattern (using Fireball as example):

```typescript
// In planner.ts, Fireball branch:
// Determine which slot will be consumed (use lowest available at/above L3).
const fbSlot = getLowestAvailableSlot(self, 3);  // new helper — see below
if (!fbSlot) { /* skip */ }
plan.action = {
  type: 'fireball',
  castSlotLevel: fbSlot,   // ← new field
  description: `${self.name} casts Fireball (L${fbSlot})!`,
};
```

**New helper in `src/ai/resources.ts`:**

```typescript
/**
 * Return the lowest available slot level at or above `minLevel`, or null.
 * Does NOT consume the slot — for planning purposes only.
 */
export function getLowestAvailableSlot(caster: Combatant, minLevel: number): number | null {
  const r = caster.resources;
  if (!r) return null;
  if (r.pactSlots?.remaining > 0 && r.pactSlots.slotLevel >= minLevel) {
    return r.pactSlots.slotLevel;
  }
  if (r.spellSlots) {
    for (let lvl = minLevel; lvl <= 9; lvl++) {
      if ((r.spellSlots[lvl]?.remaining ?? 0) > 0) return lvl;
    }
  }
  return null;
}
```

**Testing:** Add assertions that `getSpellInfoFromPlan` returns the correct level for a bespoke plan with `castSlotLevel: 5`. Verify Counterspell now sees `level: 5` when Fireball is cast at L5 by a creature (and thus requires an ability check if the Counterspell reactor only has a L3 slot).

---

### Phase 2 — Add `sourceSlotLevel` to `ActiveEffect` (GAP-2)

**File:** `src/types/core.ts` — `ActiveEffect` interface:

```typescript
export interface ActiveEffect {
  id: string;
  casterId: string;
  spellName: string;
  effectType: SpellEffectType;
  /**
   * The spell slot level used when this effect was applied.
   * 0 = applied by a cantrip (e.g. Hex-like cantrip riders).
   * undefined = legacy effects created before this field existed (treat as 0).
   *
   * Used by:
   *   - Globe of Invulnerability: only blocks if sourceSlotLevel ≤ GoI threshold
   *   - Dispel Magic: DC = 10 + sourceSlotLevel (PHB p.233)
   */
  sourceSlotLevel?: number;
  // ... rest of existing fields ...
}
```

**Update `applySpellEffect`** in `src/engine/spell_effects.ts` to accept and forward `sourceSlotLevel`:

```typescript
export function applySpellEffect(
  caster: Combatant,
  target: Combatant,
  effectDef: SpellEffectDef,
  bf: Battlefield,
  sourceSlotLevel = 0,   // ← new param, default 0 (cantrip/unknown)
): ActiveEffect {
  const effect: ActiveEffect = {
    id: nextEffectId(),
    casterId: caster.id,
    spellName: effectDef.spellName,
    effectType: effectDef.effectType,
    sourceSlotLevel,      // ← stored on effect
    sourceIsConcentration: effectDef.sourceIsConcentration ?? false,
    payload: effectDef.payload ?? {},
    // ...
  };
  // ...
}
```

**Update callers** that supply the slot level (e.g. in `execute()` bodies, pass `slotLevel` already returned by `consumeSpellSlot`).

**Update Dispel Magic** to use `sourceSlotLevel` for accurate DC:

```typescript
// In dispel_magic.ts execute(), for non-concentration ability check:
// Before:
const V1_FLAT_DC = 13;

// After:
const effectiveDC = effect.sourceSlotLevel
  ? 10 + effect.sourceSlotLevel   // PHB p.233: DC = 10 + spell's level
  : 13;                            // legacy/unknown: fallback to flat DC-13
```

Update `dispelMagicSpellLevelTrackingV1Implemented: false` → `true` in metadata once this is wired in.

**Testing:** Create an effect with `sourceSlotLevel: 5`, assert Dispel Magic uses DC 15. Create a legacy effect without the field, assert DC remains 13.

---

### Phase 3 — Upcast Damage Scaling for Bespoke Damage Spells (GAP-3)

Each spell's `execute()` already calls `consumeSpellSlot(caster, baseLevel)` and receives the actual slot level. The fix is simply to use that return value in the damage formula instead of discarding it.

**Pattern (Fireball):**

```typescript
// src/spells/fireball.ts — execute()

// Before:
consumeSpellSlot(caster, 3);
// damage always = 8d6

// After:
const slotLevel = consumeSpellSlot(caster, 3) ?? 3;
const diceCount = 8 + Math.max(0, slotLevel - 3);  // PHB p.241: +1d6/level above 3rd
// damage = diceCount × d6
```

**Update metadata flag:**
```typescript
fireballUpcastV1Implemented: true,   // was false
```

Apply the identical pattern to each spell below, using the canonical "At Higher Levels" delta from PHB/XGE:

| Spell file | Base level | Upcast formula | Metadata flag to flip |
|---|---|---|---|
| `fireball.ts` | 3 | `diceCount = 8 + max(0, slot - 3)` d6 fire | `fireballUpcastV1Implemented` |
| `lightning_bolt.ts` | 3 | `diceCount = 8 + max(0, slot - 3)` d6 lightning | `lightningBoltUpcastV1Implemented` |
| `shatter.ts` | 2 | `diceCount = 3 + max(0, slot - 2)` d8 thunder | — (add flag) |
| `thunderwave.ts` | 1 | `diceCount = 2 + max(0, slot - 1)` d8 thunder | — (add flag) |
| `dissonant_whispers.ts` | 1 | `diceCount = 3 + max(0, slot - 1)` d6 psychic | — (add flag) |
| `inflict_wounds.ts` | 1 | `diceCount = 3 + max(0, slot - 1)` d10 necrotic | — (add flag) |
| `guiding_bolt.ts` | 1 | `diceCount = 4 + max(0, slot - 1)` d6 radiant | — (add flag) |
| `burning_hands.ts` | 1 | `diceCount = 3 + max(0, slot - 1)` d6 fire | — (add flag) |
| `hunger_of_hadar.ts` | 3 | `dieCount = 2 + max(0, slot - 3)` each for cold and acid | `hungerOfHadarUpcastV1Implemented` |
| `mind_spike.ts` | 2 | `diceCount = 3 + max(0, slot - 2)` d8 psychic | `mindSpikeUpcastV1Implemented` |
| `sunburst.ts` | 8 | `diceCount = 12 + 2 * max(0, slot - 8)` d6 radiant | `sunburstUpcastV1Implemented` |

**Magic Missile separately** (`src/engine/combat.ts`, `case 'magicMissile':`):

```typescript
// dartCount is currently hardcoded to 3:
dartCount: 3,  // MM default (L1); upcast +1 dart/level not modelled

// Fix: consume the slot inside the trigger pre-check, pass dart count to execute:
const mmSlot = getLowestAvailableSlot(actor, 1) ?? 1;
const dartCount = 3 + Math.max(0, mmSlot - 1);   // PHB p.257: +1 dart/level above 1st

// Pass dartCount to executeMagicMissile + update the Shield trigger:
triggerReactions(state, mmTarget, {
  kind: 'targeted_by_magic_missile',
  caster: actor,
  target: mmTarget,
  dartCount,   // now accurate
});
```

**Scorching Ray** — already loops over rays; just increment count:
```typescript
// In scorching_ray execute():
const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
const rayCount = 3 + Math.max(0, slotLevel - 2);   // PHB p.273: +1 ray/level above 2nd
```

**Healing spells** (`cure_wounds.ts`, `healing_word.ts`):
```typescript
// cure_wounds.ts execute():
const slotLevel = consumeSpellSlot(caster, 1) ?? 1;
const diceCount = 1 + Math.max(0, slotLevel - 1);   // PHB p.230: +1d8/level above 1st
const heal = rollDice(diceCount, 8) + abilityMod(caster.wis);

// healing_word.ts execute():
const slotLevel = consumeSpellSlot(caster, 1) ?? 1;
const diceCount = 1 + Math.max(0, slotLevel - 1);   // PHB p.250: +1d4/level above 1st
const heal = rollDice(diceCount, 4) + abilityMod(caster.wis);
```

**Sleep** — HP pool scales:
```typescript
// sleep.ts execute():
const slotLevel = consumeSpellSlot(caster, 1) ?? 1;
const poolDice = 5 + 2 * Math.max(0, slotLevel - 1);   // PHB p.276: +2d8/level above 1st
// roll poolDice × d8 total HP budget
```

**Aid** — HP bonus scales:
```typescript
// aid.ts execute():
const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
const hpGain = 5 * (1 + Math.max(0, slotLevel - 2));   // PHB p.211: +5 HP/level above 2nd
```

**Blindness/Deafness** — target count scales:
```typescript
// blindness_deafness.ts execute():
const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
const targetCount = 1 + Math.max(0, slotLevel - 2);   // PHB p.219: +1 target/level above 2nd
// apply to first `targetCount` enemies within range
```

**Spiritual Weapon** — damage dice scales:
```typescript
// spiritual_weapon.ts execute():
const slotLevel = consumeSpellSlot(caster, 2) ?? 2;
const dieCount = 1 + Math.floor(Math.max(0, slotLevel - 2) / 2);
// PHB p.278: +1d8 per TWO slot levels above 2nd (L2→1d8, L4→2d8, L6→3d8, L8→4d8)
```

**Testing per spell:** For each spell, write two test cases: (a) cast at base level → base damage; (b) cast at base+2 levels → expected upcast damage. Use deterministic `rollDie` mocking or seed the RNG where possible. Test that the metadata flag is `true`.

---

### Phase 4 — Globe of Invulnerability (GAP-4)

**Canonical rule (PHB p.245):**  
*"Any spell of 5th level or lower cast from outside the barrier can't affect creatures or objects within it, even if the spell is cast using a higher spell slot. Such a spell can target creatures and objects within the barrier, but the spell has no effect on them. Similarly, the area within the barrier is excluded from the areas affected by such spells."*

Upcast (PHB p.245): *"When you cast this spell using a spell slot of 7th level or higher, the barrier blocks spells of one level higher for each slot level above 6th."*  
→ L6 slot: blocks ≤ L5. L7: blocks ≤ L6. L8: blocks ≤ L7. L9: blocks ≤ L8.

**The penetration mechanic (user's use-case):** A creature inside a L6 GoI can upcast Fireball at L6 (from outside), and it will still be blocked. To penetrate, the outside caster must use a L6 slot on a spell whose CAST LEVEL is 6 — but wait: GoI blocks "spells of 5th level or lower" for a L6 cast, meaning a L6 spell is NOT blocked. So a L6 Fireball (base L3, cast at L6) has cast level 6 > GoI threshold 5, and penetrates. That is the exact scenario described.

**Implementation requires:**

**Step 4a — Implement GoI as a real concentration buff with a cast-level threshold.**

`src/spells/globe_of_invulnerability.ts` — replace the forward-compat stub:

```typescript
// In execute():
const slotLevel = consumeSpellSlot(caster, 6) ?? 6;
const blockThreshold = 5 + Math.max(0, slotLevel - 6);   // L6→blocks≤5, L7→≤6, L8→≤7, L9→≤8

// Store threshold on caster for combat.ts to query:
if (!caster._genericSpellActiveSpells) {
  caster._genericSpellActiveSpells = new Set();
}
caster._genericSpellActiveSpells.add('Globe of Invulnerability');

// Store the threshold where combat.ts can read it:
(caster as any)._globeOfInvulnerabilityThreshold = blockThreshold;
(caster as any)._globeOfInvulnerabilityCasterId = caster.id;

startConcentration(caster, 'Globe of Invulnerability');
```

> **Architecture note:** `_globeOfInvulnerabilityThreshold` is a temporary solution. The cleaner long-term solution is to store this in an `ActiveEffect` with `effectType: 'spell_shield'` and a `payload.blockThreshold` field. Either approach is acceptable for v1 — the temporary property approach is faster to ship. Use the `ActiveEffect` approach if touching `spell_effects.ts` anyway for Phase 2.

**Step 4b — Block incoming spells at the combat dispatch layer.**

In `src/engine/combat.ts`, before executing any bespoke or generic spell plan (after the Counterspell check), add a GoI blocking check:

```typescript
// ── Globe of Invulnerability check ──────────────────────────────────────
// PHB p.245: spells cast at 5th level or lower (or threshold for upcast GoI)
// have no effect on targets protected by Globe of Invulnerability.
// Check BEFORE the spell executes; the slot is still consumed.
if (plan.type !== 'attack' && plan.type !== 'cast') {  // spell plans only
  const spellInfo = getSpellInfoFromPlan(plan, bf);
  if (spellInfo && spellInfo.level > 0) {               // not a cantrip
    const target = plan.targetId ? bf.combatants.get(plan.targetId) : null;
    if (target && isProtectedByGoI(target, spellInfo.level)) {
      consumeSpellSlot(actor, spellInfo.level);  // slot consumed — PHB p.245
      log(state, 'action', actor.id,
        `${actor.name}'s ${spellInfo.name} (L${spellInfo.level}) is blocked by Globe of Invulnerability on ${target.name}!`,
        target.id);
      actor.budget.actionUsed = true;
      break;  // spell has no effect
    }
  }
}
```

**`isProtectedByGoI` helper** (add to `spell_effects.ts` or `utils.ts`):

```typescript
/**
 * Returns true if `target` is inside a Globe of Invulnerability that blocks
 * spells cast at `castLevel`. The GoI must be active on the target's ally
 * or the target itself (v1: check the target directly — GoI is centered on
 * the caster so allies within 10 ft are also protected; v1 simplification:
 * treat it as a buff on the GoI caster only).
 */
export function isProtectedByGoI(target: Combatant, castLevel: number): boolean {
  const threshold = (target as any)._globeOfInvulnerabilityThreshold;
  if (threshold === undefined) return false;
  return castLevel <= threshold;
}
```

> **v1 scope limitation:** The GoI protection radius is 10 ft (PHB p.245: "10-foot radius"). Fully modelling the radius requires spatial queries. For v1, apply GoI protection only to the caster of GoI (the creature that the flag lives on). Document this via a metadata flag: `globeOfInvulnerabilityRadiusV1Simplified: true`.

**AoE handling:** When an AoE spell hits multiple targets, it should not affect targets inside a GoI but can still affect others outside it. For v1 (spells like Fireball, Thunderwave): since these resolve against a target list, exclude GoI-protected targets from the target list before the damage loop. The slot is still consumed because the spell was cast.

**Step 4c — GoI cleanup on concentration break.**

In the concentration-break path (`removeEffectsFromCaster` / `checkDeath` concentration handler), add:
```typescript
delete (caster as any)._globeOfInvulnerabilityThreshold;
delete (caster as any)._globeOfInvulnerabilityCasterId;
```

**Testing:** 
- GoI at L6 blocks Fireball cast at L3 (blocked) and L5 (blocked); does NOT block Fireball at L6 (penetrates).
- GoI at L7 (upcast) blocks up to L6; Fireball at L6 is blocked, Fireball at L7 penetrates.
- GoI slot is consumed even when spell is blocked.
- GoI flag clears when concentration breaks.
- Cantrip (level 0) is never blocked by GoI.

---

### Phase 5 — AI Penetration-Motivated Upcasting (GAP-5)

**This phase depends on Phase 1 and Phase 4.**

The AI planner needs one new heuristic: if a spell would normally be cast at its base level but the primary target is protected by GoI (or a similar level-gating effect), consider whether a higher slot is available that would penetrate.

**Add to `src/ai/planner.ts`:**

```typescript
/**
 * Determine the effective cast slot for a spell, considering whether the
 * target is protected by an effect that blocks spells below a level threshold.
 *
 * Returns:
 *   - The base slot level if no threshold applies (or no penetration is needed).
 *   - The minimum slot that penetrates the threshold, if one is available.
 *   - null if the spell cannot be cast (no slot at or above base, or threshold
 *     too high to overcome with available slots).
 *
 * Currently checks Globe of Invulnerability only (threshold from
 * `_globeOfInvulnerabilityThreshold` on the target).
 */
function selectCastSlot(
  caster: Combatant,
  baseLevel: number,
  target: Combatant | null,
): number | null {
  // Determine the minimum slot that penetrates any blocking effect on the target.
  let minPenetrationSlot = baseLevel;

  if (target) {
    const goiThreshold = (target as any)._globeOfInvulnerabilityThreshold as number | undefined;
    if (goiThreshold !== undefined) {
      // To penetrate, castLevel must be > goiThreshold.
      // Minimum penetration level = goiThreshold + 1.
      const needed = goiThreshold + 1;
      if (needed > 9) return null;                    // impossible to penetrate
      if (needed > minPenetrationSlot) minPenetrationSlot = needed;
    }
  }

  return getLowestAvailableSlot(caster, minPenetrationSlot);
}
```

**Usage in Fireball branch (example):**

```typescript
// Planner Fireball branch:
const fbTargets = shouldCastFireball(self, battlefield);
if (fbTargets) {
  const primaryTarget = fbTargets[0];   // highest-threat enemy is the sphere center
  const fbSlot = selectCastSlot(self, 3, primaryTarget);
  if (fbSlot !== null) {
    plan.action = {
      type: 'fireball',
      castSlotLevel: fbSlot,
      description: fbSlot > 3
        ? `${self.name} upcasts Fireball (L${fbSlot}) — penetrating defenses!`
        : `${self.name} casts Fireball!`,
    };
    // ...
  }
}
```

Apply the same `selectCastSlot` pattern to all other bespoke damage spell planner branches that might face GoI (effectively all AoE and single-target leveled spells).

**Tactical decision weight:** When the only reason to upcast is penetration (not extra damage), the AI should still prefer the upcast because the spell would be wasted at base level. `selectCastSlot` already handles this: if the target is GoI-protected and the needed penetration slot is available, that slot is returned. If no penetration slot is available, `null` is returned, and the planner should skip the spell and try something else (cantrip, weapon attack, reposition).

**Testing:**
- AI with GoI-protected target and L6 slot should upcast Fireball at L6 (not base L3).
- AI with GoI-protected target and only L3 slot should NOT cast Fireball (skip it).
- AI with no GoI on target should use base slot (L3 for Fireball).

---

### Phase 6 — Cantrip Caster-Level Damage Scaling (GAP-6)

**Architecturally separate from upcasting. Level 0 interaction is already correct.**

**PHB breakpoints:**
- Tier 1 (character level 1–4): base damage
- Tier 2 (level 5–10): +1 die
- Tier 3 (level 11–16): +2 dice
- Tier 4 (level 17–20): +3 dice

**Approach — add a `cantripTier(caster)` helper to `src/engine/utils.ts`:**

```typescript
/**
 * PHB p.201: Cantrip damage increases at character levels 5, 11, and 17.
 * For monsters, `spellcasterLevel` from `monsterSpellcasting` maps to the
 * same tier breakpoints (MM p.10: "treats as Nth-level spellcaster").
 *
 * Returns 0 (base), 1 (+1 die), 2 (+2 dice), or 3 (+3 dice).
 */
export function cantripTier(caster: Combatant): number {
  // For PC-style casters: use the sum of class levels (already in caster.level
  // or derivable from classLevels if present).
  // For monsters: use monsterSpellcasting.spellcasterLevel.
  const effectiveLevel =
    caster.monsterSpellcasting?.spellcasterLevel ??
    caster.level ??
    1;

  if (effectiveLevel >= 17) return 3;
  if (effectiveLevel >= 11) return 2;
  if (effectiveLevel >= 5)  return 1;
  return 0;
}
```

**Apply to cantrip modules:**

Cantrips with die-scaling (apply `+ cantripTier(caster)` to base die count):

| Cantrip | Base dice | At tier 2+ |
|---|---|---|
| Fire Bolt | 1d10 | +1d10 per tier |
| Eldritch Blast | 1 beam | +1 beam per tier (each beam is an independent attack) |
| Ray of Frost | 1d8 | +1d8 per tier |
| Chill Touch | 1d8 | +1d8 per tier |
| Poison Spray | 1d12 | +1d12 per tier |
| Toll the Dead | 1d8/1d12 | +1d8 or +1d12 per tier |
| Sacred Flame | 1d8 | +1d8 per tier |
| Shocking Grasp | 1d8 | +1d8 per tier |
| Acid Splash | 1d6 | +1d6 per tier |
| Vicious Mockery | 1d4 | +1d4 per tier |
| Thunderclap | 1d6 | +1d6 per tier |
| Green-Flame Blade | 1d8 | +1d8 per tier |
| Booming Blade | 1d8 (movement trigger) | +1d8 per tier |
| Mind Sliver | 1d6 | +1d6 per tier |

**Eldritch Blast special case:** +1 beam per tier (each an independent attack roll). The planner branch should fire 1, 2, 3, or 4 beam attacks based on `cantripTier`. This needs special handling in combat dispatch (currently fires a single attack).

**Testing:** Create a level-5 caster, assert Fire Bolt deals 2d10 (not 1d10). Create a level-1 monster with `spellcasterLevel: 11`, assert cantrip deals 3 dice.

---

## 4. Interaction Matrix: Level 0 Guarantee

This table documents the correct behavior for every "spell level check" interaction:

| Mechanic | Cantrip (L0) | Leveled at base slot | Leveled upcast |
|---|---|---|---|
| Counterspell | Never triggered (v1 skips) / technically counterable per Sage Advice — maintain v1 skip | Auto-countered if CS slot ≥ base level | Auto-countered if CS slot ≥ cast slot level |
| Globe of Invulnerability | Never blocked (L0 ≤ threshold is always false when threshold ≥ 1; but per PHB p.245, GoI does NOT block cantrips because they have no slot) | Blocked if base level ≤ GoI threshold | Blocked if cast slot level ≤ GoI threshold; penetrates if cast slot > threshold |
| Dispel Magic DC | N/A (no concentration slot effect) | DC = 10 + base level | DC = 10 + cast slot level |
| Dispel Magic auto-dispel | N/A | Auto-dispeled if DM slot ≥ source slot level | Auto-dispeled if DM slot ≥ source slot level |
| Counterspell upcast auto-success | Cantrip: level 0 → always auto-success if any slot is available (Sage Advice); v1: skip | Slot ≥ spell level → auto-success | Slot ≥ cast slot level → auto-success |
| Cantrip interaction level | Always 0 | base spell level | cast slot level (which is ≥ base) |

**Key invariant to enforce in code:**  
`castSlotLevel` for a cantrip is always `0` or `undefined`. The cantrip damage is driven by `cantripTier(caster)`, never by a slot.

---

## 5. What to Defer

- **`sourceSlotLevel` on pre-existing `ActiveEffect` instances** — Legacy effects created before Phase 2 will have `sourceSlotLevel: undefined`. Treat `undefined` as 0 (cantrip / unknown) in all checks. This is backward-compatible.
- **Per-dart Shield blocking for multi-target Magic Missile** — v1 continues to block all darts or none. Multi-target MM + per-dart Shield is a future enhancement.
- **GoI radius (10 ft) spatial check** — v1 applies GoI only to the caster. Full radius requires spatial queries; document via `globeOfInvulnerabilityRadiusV1Simplified: true`.
- **Cantrip Counterspell** — SAC v2.7 says DMs can allow Counterspell vs cantrips, but the RAW PHB spell description describes spells with slots. v1 continues to skip cantrips.
- **Eldritch Blast multi-beam full dispatch** — Implementing multi-beam is more complex (multiple independent attack rolls in one action) and belongs to a dedicated Eldritch Blast enhancement session.

---

## 6. File Change Summary

| File | Change |
|---|---|
| `src/types/core.ts` | Add `castSlotLevel?: number` to `PlannedAction`; add `sourceSlotLevel?: number` to `ActiveEffect` |
| `src/ai/resources.ts` | Add `getLowestAvailableSlot(caster, minLevel)` helper |
| `src/engine/combat.ts` | Update `getSpellInfoFromPlan` to use `castSlotLevel`; add GoI blocking check pre-dispatch; update Magic Missile dart count; pass `castSlotLevel` to each bespoke spell plan |
| `src/engine/spell_effects.ts` | Add `sourceSlotLevel` param to `applySpellEffect`; add `isProtectedByGoI` helper |
| `src/engine/utils.ts` | Add `cantripTier(caster)` helper |
| `src/ai/planner.ts` | Add `selectCastSlot` helper; update each bespoke spell planner branch to set `castSlotLevel` and use `selectCastSlot` for GoI penetration |
| `src/spells/globe_of_invulnerability.ts` | Replace forward-compat stub with real implementation: slot consumption, threshold calculation, concentration start, cleanup |
| `src/spells/fireball.ts` | Use returned slot level for damage scaling |
| `src/spells/lightning_bolt.ts` | Same |
| `src/spells/shatter.ts` | Same |
| `src/spells/thunderwave.ts` | Same |
| `src/spells/dissonant_whispers.ts` | Same |
| `src/spells/inflict_wounds.ts` | Same |
| `src/spells/guiding_bolt.ts` | Same |
| `src/spells/burning_hands.ts` | Same |
| `src/spells/hunger_of_hadar.ts` | Same |
| `src/spells/mind_spike.ts` | Same |
| `src/spells/sunburst.ts` | Same |
| `src/spells/scorching_ray.ts` | Same |
| `src/spells/cure_wounds.ts` | Same |
| `src/spells/healing_word.ts` | Same |
| `src/spells/sleep.ts` | Same |
| `src/spells/aid.ts` | Same |
| `src/spells/blindness_deafness.ts` | Same (target count) |
| `src/spells/spiritual_weapon.ts` | Same |
| `src/spells/dispel_magic.ts` | Use `sourceSlotLevel` for accurate DC; flip metadata flag |
| Cantrip modules (Phase 6) | Apply `cantripTier(caster)` to die count |
| `src/test/upcasting_system.test.ts` | New test file covering Phases 1–5 |
| `src/test/cantrip_scaling.test.ts` | New test file covering Phase 6 |

---

## 7. Commit Order (Recommended)

1. `Phase 1: Add castSlotLevel to PlannedAction + getSpellInfoFromPlan fix` — structural, no behavior change until planner branches are updated; safe
2. `Phase 2: Add sourceSlotLevel to ActiveEffect + update applySpellEffect` — structural, backward-compat (undefined = 0)
3. `Phase 3a: Upcast damage scaling — fireball, lightning_bolt, shatter, thunderwave` — 4 spells, single commit
4. `Phase 3b: Upcast damage scaling — dissonant_whispers, inflict_wounds, guiding_bolt, burning_hands` — 4 spells
5. `Phase 3c: Upcast damage scaling — scorching_ray, magic_missile dart count, sleep, aid, blindness_deafness` — 5 spells
6. `Phase 3d: Upcast healing — cure_wounds, healing_word, spiritual_weapon` — 3 spells
7. `Phase 3e: Upcast remaining — hunger_of_hadar, mind_spike, sunburst` — 3 spells
8. `Phase 4: Globe of Invulnerability real implementation` — depends on Phase 2
9. `Phase 5: AI penetration-motivated upcasting (selectCastSlot)` — depends on Phase 1 + Phase 4
10. `Phase 6: Cantrip caster-level damage scaling` — independent, can run in parallel

Each commit must pass `tsc --noEmit` clean and all existing tests before pushing.

---

## 8. Open Questions for the Implementing Agent

1. **GoI `_globeOfInvulnerabilityThreshold` storage:** Use the temporary `(caster as any)._globeOfInvulnerabilityThreshold` property (fast), or go straight to an `ActiveEffect` with `effectType: 'spell_shield'` and `payload.blockThreshold` (cleaner)? The `ActiveEffect` path is recommended if Phase 2 is implemented first (since Phase 2 adds `sourceSlotLevel`, touching `spell_effects.ts` anyway). Add a `'spell_shield'` entry to `SpellEffectType` in that case.

2. **Eldritch Blast multi-beam:** Should Phase 6 implement the full multi-beam dispatch (2/3/4 beams at levels 5/11/17), or defer and just scale the single beam's damage die count for now? Full multi-beam is more correct but requires changes to combat dispatch.

3. **Cure Wounds upcast planner:** The planner currently uses a fixed L1 slot for Cure Wounds. Should the planner upcast Cure Wounds when the caster has no L1 slots remaining, or always prefer the lowest slot? Recommend: use `getLowestAvailableSlot(caster, 1)` (always uses lowest available = no wasted upcasting for healing).
