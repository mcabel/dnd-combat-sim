# RFC: Monster Spellcasting Engine Integration (Batch 5b Step 2)

**Date:** Session 62
**Author:** Z.ai
**Status:** PROPOSED (user directed: "weighted action system, not random — tags: damage/CC/healing/defending")
**Risk:** HIGH — touches monster AI, resource tracking, and the planner's action-selection flow
**Depends on:** Session 60 metadata parser (`monsterSpellcasting` field on 945 creatures)

---

## 1. Goal

Wire the 945 spellcasting monsters into the engine so they actually CAST spells from their spell lists. Currently, the `monsterSpellcasting` field is metadata-only — monsters with spellcasting (Lich, Mage, Drow, Priest, etc.) only use their `actions` array (weapon attacks + innate spell-like abilities) and never cast prepared spells. This makes spellcaster monsters dramatically weaker than their CR implies.

The user's directive: implement a **weighted action selection system** (not random). Each spell gets **tags** (`damage` / `cc` / `healing` / `defending`), and the AI scores them by situation, picking the highest-scoring spell each turn.

---

## 2. Current State (What's Already There)

### 2.1 Parsed Metadata (Session 60)
`Combatant.monsterSpellcasting` is populated for 945 creatures:
```typescript
monsterSpellcasting?: {
  saveDC?: number;           // e.g. 16 for a Lich
  spellAttackBonus?: number; // e.g. +8
  ability?: 'int' | 'wis' | 'cha';  // spellcasting ability
  atWill?: string[];         // spell names castable at-will (cantrips + 1st-level)
  daily?: { [spellName: string]: number };  // spell name → uses/day (1e/2e/3e)
  slots?: { [level: number]: { max: number; spells: string[] } };  // L1-9 slot spells
}
```

### 2.2 Spell Library
- **`src/spells/_generic_registry.ts`**: 262+ generic spells keyed by canonical name. Each has `shouldCast()` + `execute()` + `level`.
- **Bespoke spell modules** (`src/spells/fireball.ts`, `src/spells/banishment.ts`, etc.): ~100 spells with their own case branches in combat.ts + planner.ts.
- **`spell-cache/level-{0-9}.json`**: 557 spells total, 420 implemented. The `SPELL-CACHE.md` file tracks implementation status.
- **Total available**: ~420 spell modules that can be dispatched by name.

### 2.3 Existing Generic-Spell Planner Loop (planner.ts line ~5154)
The planner already has a loop that iterates `GENERIC_SPELL_LIST` and calls `shouldCast()` for each spell the caster has in `self.actions`. **But monsters with `monsterSpellcasting` don't have spells in `self.actions`** — their spells are in `monsterSpellcasting.atWill/daily/slots`. So the loop skips them entirely.

### 2.4 Resource Tracking
- **PCs** use `resources.spellSlots: { [level]: { max, remaining } }` — already tracked + consumed by `consumeSpellSlot()`.
- **Monsters** have no slot tracking. The `monsterSpellcasting.slots` field has `max` per level but no `remaining`. Daily uses (`1e/2e/3e`) have no remaining counter.

---

## 3. 5e Rules Research

### 3.1 Monster Spellcasting (MM p.10)
- A monster with the Spellcasting feature has a list of spells prepared + spell slots.
- **Cantrips**: cast at-will (no slot).
- **Leveled spells**: consume a slot of the appropriate level. Slots refresh on a long rest.
- **At-will spells** (MM p.10 "At Will"): some monsters have specific spells they can cast at-will (e.g. Lich: "At will: mage hand, prestidigitation, ray of frost").
- **1/day, 2/day, 3/day**: some spells have a per-day limit independent of slots (e.g. Lich: "3/day each: blight, dimension door").
- **Spell save DC** + **spell attack bonus** + **spellcasting ability** are in the stat block.

### 3.2 What Monsters Cast (AI Heuristics)
5e monsters don't have strict "spell selection AI" — the DM chooses. For the sim, we need heuristics:
- **Round 1 (opener)**: concentration buffs/debuffs (Bless, Bane, Hold Person), area control (Web, Entangle), high-damage AoE (Fireball, Cone of Cold).
- **Round 2+**: sustained damage (cantrips if at-will, or slotted spells if slots remain), reactive defense (Shield reaction — already implemented), healing (if allies wounded).
- **Low HP**: defensive spells (Blink, Misty Step to escape), healing self.
- **Outnumbered**: AoE + control to even the odds.
- **Single tough target**: single-target damage + debuffs (Hold Person, Bestow Curse).

---

## 4. Proposed Design: Weighted Action Selection

### 4.1 Spell Tags

Each spell in the library gets zero or more tags:

```typescript
type SpellTag = 'damage' | 'cc' | 'healing' | 'defending' | 'buff' | 'utility';
```

- **damage**: deals HP damage (Fireball, Magic Missile, Inflict Wounds).
- **cc**: crowd control — conditions/restraints (Hold Person, Entangle, Web, Banishment).
- **healing**: restores HP (Cure Wounds, Healing Word, Aid).
- **defending**: self-preservation (Shield reaction, Blink, Misty Step escape, Blur).
- **buff**: enhances allies (Bless, Haste, Mage Armor) — subset of "defending" but targets allies.
- **utility**: non-combat or situational (Detect Magic, Light, Message) — v1: never cast in combat.

**Tag source**: derived from the spell's existing metadata. A spell is `damage` if it has `damage` in its Action, `cc` if it applies a condition, `healing` if it heals, etc. This can be auto-computed from the GENERIC_SPELLS registry + bespoke spell metadata. A manual override map handles edge cases (e.g. Shield is `defending` not `damage` despite being a reaction).

### 4.2 Situational Scoring

Each turn, the planner computes a **context score** for the monster:

```typescript
interface SpellcastContext {
  selfHPct: number;          // 0.0–1.0
  allyCount: number;         // living allies (excluding self)
  enemyCount: number;        // living enemies
  nearestEnemyDistFt: number;
  hasDownedAlly: boolean;    // unconscious + not dead
  isOutnumbered: boolean;    // enemyCount > allyCount + 1
  round: number;             // 1 = opener
  slotsRemaining: { [level: number]: number };
}
```

Each spell gets a **weight** based on its tags + the context:

| Situation | damage | cc | healing | defending | buff |
|-----------|--------|-----|---------|-----------|------|
| Round 1, 3+ enemies | 1.5 | 1.8 | 0.5 | 0.3 | 1.2 |
| Round 1, 1 enemy | 1.3 | 1.2 | 0.3 | 0.3 | 0.8 |
| Low HP (<30%) | 0.8 | 0.6 | 2.0 | 1.8 | 0.5 |
| Downed ally | 0.5 | 0.5 | 2.5 | 0.5 | 0.5 |
| Outnumbered | 1.4 | 2.0 | 1.0 | 0.8 | 1.0 |
| Normal (default) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |

The final spell score = `baseWeight × tagMultiplier × availabilityMultiplier`:
- `baseWeight`: spell's intrinsic power (higher-level spells have higher base — e.g. Fireball L3 = 1.5, Magic Missile L1 = 1.0).
- `tagMultiplier`: from the table above (the spell's primary tag).
- `availabilityMultiplier`: 1.0 if slots available, 0.0 if not. At-will spells always 1.0.

### 4.3 Selection Algorithm

```
1. Build the list of castable spells from monsterSpellcasting (atWill + daily + slots).
2. For each spell:
   a. Look up the spell module (GENERIC_SPELLS or bespoke case branch).
   b. If not found in the library → skip (unimplemented spell).
   c. Check availability (slots remaining, daily uses remaining).
   d. Call shouldCast() — if false, skip (spell-specific gates: target in range, etc.)
   e. Compute the weight (tags × context).
3. Pick the highest-weight spell. Ties → highest level, then alphabetical.
4. If no spell qualifies → fall back to weapon attacks (existing behavior).
```

### 4.4 Slot + Daily Use Tracking

Extend the monster's resource model:

```typescript
// On Combatant (new field, or extend existing resources):
monsterSpellSlots?: { [level: number]: { max: number; remaining: number } };
monsterDailyUses?: { [spellName: string]: { max: number; remaining: number } };
```

- **Initialized** at combat start from `monsterSpellcasting.slots` (max per level) and `monsterSpellcasting.daily` (max per spell).
- **Consumed** when the monster casts a slotted/daily spell (mirror `consumeSpellSlot()`).
- **At-will spells**: no tracking (infinite).
- **Cantrips** (level 0): always at-will, no slot.

---

## 5. Engine Integration Points

### 5.1 Planner (src/ai/planner.ts)

Add a new branch BEFORE the existing generic-spell loop (line ~5154):

```typescript
// === MONSTER SPELLCASTING (RFC Batch 5b Step 2) ===
if (self.monsterSpellcasting && !plan.action) {
  const spellPlan = selectMonsterSpell(self, battlefield);
  if (spellPlan) {
    plan.action = spellPlan;
    plan.bonusAction = planBonusAction(self, target, battlefield);
    return plan;
  }
}
```

`selectMonsterSpell()` lives in a new module `src/ai/monster_spellcasting.ts` and implements the algorithm in §4.3.

### 5.2 Combat Execution (src/engine/combat.ts)

The existing `case 'genericSpell':` branch already dispatches via `lookupGenericSpell(plan.spellName)`. Monster spells route through the same path — no new case branch needed.

For bespoke spells (fireball, banishment, etc.), the existing case branches handle them. The planner just needs to set `plan.type = 'fireball'` (or the appropriate bespoke type) instead of `'genericSpell'`.

**Slot consumption**: `selectMonsterSpell()` calls `consumeMonsterSpellSlot()` before returning the plan. The combat.ts execution doesn't need to re-consume (same pattern as PC spells — `shouldCast` checks availability, `execute` consumes).

### 5.3 Resource Initialization

At combat start (in `runCombat()` or `monsterToCombatant()`), initialize:
- `monsterSpellSlots` from `monsterSpellcasting.slots` (max per level, remaining = max).
- `monsterDailyUses` from `monsterSpellcasting.daily` (max per spell, remaining = max).

---

## 6. Spell Tag Derivation

### 6.1 Auto-Derivation from Metadata

For generic spells (GENERIC_SPELLS registry), derive tags from the spell's Action:

```typescript
function deriveSpellTags(spellName: string): SpellTag[] {
  const desc = lookupGenericSpell(spellName);
  if (!desc) return [];
  // Check the spell's metadata for damage/heal/condition fields
  // (requires extending GenericSpellDescriptor with a `tags?` field)
  const tags: SpellTag[] = [];
  if (desc.hasDamage) tags.push('damage');
  if (desc.appliesCondition) tags.push('cc');
  if (desc.heals) tags.push('healing');
  // ...
  return tags;
}
```

### 6.2 Manual Override Map

For spells where auto-derivation is wrong (e.g. Shield is a reaction, not a damage spell):

```typescript
const SPELL_TAG_OVERRIDES: Record<string, SpellTag[]> = {
  'Shield': ['defending'],
  'Misty Step': ['defending'],
  'Blink': ['defending'],
  'Blur': ['defending'],
  'Mage Armor': ['defending'],
  'Bless': ['buff'],
  'Haste': ['buff'],
  'Cure Wounds': ['healing'],
  'Healing Word': ['healing'],
  'Aid': ['healing'],
  // ... (~50 overrides for common spells)
};
```

### 6.3 Bespoke Spell Tags

Bespoke spell modules already have `metadata` objects. Extend them with an optional `tags?: SpellTag[]` field. This is additive (backward-compatible).

---

## 7. Implementation Plan (Phased)

### Phase 1: At-Will + Cantrips (LOW-MEDIUM risk)
- Implement `selectMonsterSpell()` for at-will spells only (cantrips + at-will leveled spells).
- No slot tracking needed (at-will = infinite).
- Tag derivation: manual override map for the 20 most common at-will spells (Ray of Frost, Fire Bolt, Mage Hand, etc.).
- Scoring: simple — prefer damage cantrips on full HP, defending spells on low HP.
- **Covers**: ~200 creatures with at-will spellcasting (Drow, Mage, Lich cantrips, etc.).

### Phase 2: Slot-Based Spells (MEDIUM-HIGH risk)
- Add `monsterSpellSlots` tracking + `consumeMonsterSpellSlot()`.
- Full weighted scoring (tags × context).
- Auto-derive tags from GENERIC_SPELLS metadata.
- Planner branch fires when at-will spells don't apply or slots are available for higher-impact spells.
- **Covers**: ~600 creatures with slot-based spellcasting (Lich, Mage, Priest, Cultist, etc.).

### Phase 3: Daily Uses + Concentration Management (MEDIUM risk)
- Add `monsterDailyUses` tracking.
- Concentration-aware selection: don't cast a concentration spell if already concentrating (unless the new spell is higher-value — break concentration).
- Round-1 opener logic: prefer concentration buffs/debuffs on round 1.
- **Covers**: ~145 creatures with daily-use spells (Lich 3/day, Drow 1/day, etc.).

### Phase 4 (DEFERRED): Spell Upcast + Multi-Target (HIGH risk)
- Upcast spells using higher-level slots (e.g. Fireball at L4 for +1d6 damage).
- Multi-target selection for AoE spells (pick the position that hits the most enemies).
- Reaction spell integration (Shield, Counterspell, Hellish Rebuke — already implemented for PCs; extend to monsters).
- **Defer until Phase 1-3 stable.**

---

## 8. Files to Touch (Phase 1-3)

| File | Change | Phase |
|------|--------|-------|
| `src/types/core.ts` | Add `monsterSpellSlots?`, `monsterDailyUses?` to Combatant | 2 |
| `src/engine/combat.ts` | Initialize slots/daily at combat start (in `runCombat` or `monsterToCombatant`) | 2 |
| `src/ai/monster_spellcasting.ts` (NEW) | `selectMonsterSpell()`, `deriveSpellTags()`, `computeSpellWeight()`, `consumeMonsterSpellSlot()` | 1-3 |
| `src/ai/planner.ts` | Add monster-spellcasting branch before generic-spell loop | 1 |
| `src/spells/_generic_registry.ts` | Extend `GenericSpellDescriptor` with `tags?` field (auto-derived) | 2 |
| `src/spells/<bespoke>.ts` | Add `tags?` to metadata objects (additive) | 2-3 |
| `src/test/monster_spellcasting.test.ts` (NEW) | Tests for tag derivation, scoring, slot consumption | 1-3 |

---

## 9. Doubts for User Clarification

1. **Spell library coverage**: 420 of 557 spells are implemented. Monsters have ~1200 unique spell names across all 945 creatures. Some spells (e.g. "Mage Hand", "Prestidigitation") are utility cantrips with no combat effect. Should v1:
   - (A) Only cast spells that exist in the library (skip unimplemented — safe, ~70% coverage), or
   - (B) Implement stubs for the top 50 missing combat spells first (more coverage, more work)?

2. **Opener spells**: Should the planner force-cast a concentration buff/debuff on round 1 (e.g. Lich always opens with Hold Person or Blight), or let the weighted system decide? 5e Liches typically open with a big spell, but the weighted system might pick a cantrip if the context weights favor it.

3. **Cantrip vs slotted spell tradeoff**: A Lich has infinite Ray of Frost (2d8 cold) but finite slots for Fireball (8d6 fire). Should the planner:
   - (A) Always prefer slotted spells when slots remain (higher damage), or
   - (B) Use cantrips when the target is low HP (finish with cantrip, save the slot)?

4. **Concentration breaking**: If a monster is concentrating on Bless and a higher-value spell (Hold Person) becomes available, should the planner:
   - (A) Break concentration automatically (cast the new spell), or
   - (B) Never break concentration (preserve the existing buff)?

5. **Daily-use spells**: Some monsters have "3/day each: Blight, Dimension Door" (Lich). Should v1:
   - (A) Treat daily-use spells as highest-priority (use them early — they're powerful), or
   - (B) Save daily-use spells for when they're most impactful (low HP escape, clutch CC)?

6. **Unimplemented spell handling**: When `selectMonsterSpell()` encounters a spell name not in the library, should it:
   - (A) Skip silently (log at debug level), or
   - (B) Fall back to a generic "spell attack" using the monster's spellAttackBonus + a default damage die (e.g. 2d8)?

---

## 10. Backward Compatibility

- **No changes to existing PC spellcasting**: PCs use `resources.spellSlots` + the existing generic-spell loop. Monster spellcasting is a separate code path.
- **No changes to existing monster AI**: Monsters without `monsterSpellcasting` use their `actions` array as before. The new branch only fires for the 945 creatures with the metadata.
- **No changes to existing tests**: The planner branch is additive (only fires when `monsterSpellcasting` is present). The generic-spell loop still runs for PCs.
- **Optional fields**: `monsterSpellSlots` and `monsterDailyUses` are optional — legacy combatants without them skip the new logic.

---

## 11. Test Plan

### Phase 1 Tests
- `selectMonsterSpell()` returns a damage cantrip for a full-HP monster with an enemy in range.
- `selectMonsterSpell()` returns null when no enemies are visible.
- At-will spell doesn't consume slots (infinite).
- Tag derivation: Ray of Frost → `['damage']`, Shield → `['defending']`.

### Phase 2 Tests
- `monsterSpellSlots` initialized correctly from `monsterSpellcasting.slots`.
- `consumeMonsterSpellSlot(level)` decrements the right level.
- Planner picks a slotted spell over a cantrip when slots remain + context favors it.
- Planner falls back to cantrip when slots are exhausted.
- Weighted scoring: outnumbered → prefers cc; low HP → prefers defending/healing.

### Phase 3 Tests
- `monsterDailyUses` initialized from `monsterSpellcasting.daily`.
- Daily-use spell consumed on cast (remaining decremented).
- Daily-use spell skipped when remaining = 0.
- Concentration-aware: don't cast a 2nd concentration spell when one is active (Phase 3 A) or break it (Phase 3 B — depends on user answer #4).
