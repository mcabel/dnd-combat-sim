# branchHandover — Spell Actions (Session 29, branch B)

## What This Branch Did
Implemented spell action support for Level 1 spellcasting PCs.
Commit: `3b549f8` — rebased onto Session 29 concurrent branch (Cunning Action Dash, `a0f8f20`).

---

## Combined State After Rebase
- **GitHub:** https://github.com/mcabel/dnd-combat-sim (commit `3b549f8`)
- **Tests:** 1325 (CA Dash branch) + 49 (spell actions) = **1374 passing, 0 failed** (25 suites)
  - `cunning_action.test.ts`: 42 (concurrent branch added 19 Dash tests)
  - `spell_actions.test.ts`: 49 (this branch, new file)

---

## Changes Made

### New file: `src/data/spells.ts`
Compact spell database for Level 1 PC combat spells.
`SpellTemplate` interface + `SPELL_DB` map + `lookupSpell(name)` export.

**Spells included:**
| Spell | Class | attackType | Dmg | Notes |
|---|---|---|---|---|
| Dissonant Whispers | Bard | save (WIS) | 3d6 psychic | slotLevel 1 |
| Chromatic Orb | Sorcerer | spell attack | 3d8 thunder | slotLevel 1 |
| Magic Missile | Wizard | null (auto-hit) | 3d4+3 force | slotLevel 1 |
| Thunderwave | Wizard/Druid | save (CON) AoE | 2d8 thunder | slotLevel 1, 15ft |
| Entangle | Druid | save (STR) AoE ctrl | — | slotLevel 1, conc |
| Faerie Fire | Druid | save (DEX) AoE ctrl | — | slotLevel 1, conc |
| Arms of Hadar | Warlock | save (STR) AoE | 2d6 necrotic | slotLevel 1, 10ft self |

**Not included (deferred):** Bless, Shield of Faith, Cure Wounds, Healing Word (buff/heal,
need ally-targeting logic), Mage Armor, Shield (reaction/self-buff), Sleep (HP-bucket
mechanic), Charm Person, Detect Magic, Find Familiar (utility/non-combat).

### `src/types/core.ts`
Added `slotLevel?: number` to `Action` interface:
- `undefined` or `0` = cantrip/non-spell (free)
- `1+` = leveled spell, consumes a slot of that level

### `src/parser/pc.ts`
Three changes:

1. **Single-range parsing fix** (`"60ft"`, `"120ft"` formats):
   - Old: only `"N/Mft"` (dual-range bows) was matched
   - New: also matches single `"/d+ft/"` → `rangeObj = {normal:r, long:r}`
   - Fix: Sacred Flame (`"60ft"`), Eldritch Blast (`"120ft"`) now correctly get rangeObj

2. **Reaction cost parsing:**
   - `w.cost === 'reaction'` → `costType: 'reaction'` (was defaulting to `'action'`)
   - Fix: Hellish Rebuke (reaction spell) now correctly excluded from action selection

3. **Spell actions from preparedSpells / spells_1st / spellbook:**
   - After weapon actions are built, iterate all known/prepared spells
   - Each spell name → `lookupSpell(name)` → builds `Action` object if found
   - `hitBonus ← sp.spellAttackBonus` (spell attack spells)
   - `saveDC ← sp.saveDC` (save-based spells)
   - Unknown/utility spells (null from `lookupSpell`) → skipped

### `src/ai/actions.ts`
Three changes:

1. **`bestAttackAction` — slot gate:**
   Added `!(a.slotLevel && a.slotLevel > 0 && !hasSpellSlot(self))` to candidate filter.
   Without this: a leveled spell (e.g. Dissonant Whispers, avg 10.5 dmg) always outscores
   a weapon (Rapier, avg 7.5) even after slots are exhausted.

2. **Step 4 — `'cast'` type for spell/save actions:**
   When `bestAttackAction` returns a `attackType === 'spell'` or `'save'` action,
   return `type: 'cast'` (not `'attack'`). This routes execution through the `cast` case
   in `executePlannedAction`, which consumes the spell slot.

3. **Step 5 — save-based ranged actions + slot gate + costType filter:**
   - `hasRangedReach` now includes `attackType === 'save'` (Sacred Flame was invisible before)
   - Step 5 candidate filter: `a.costType === 'action'` (excludes reactions), plus slot gate
   - Picks highest-expected-damage ranged/spell/save action (raw average for null hitBonus)

### `src/engine/combat.ts`
Added slot consumption in `case 'cast'`:
```typescript
if (plan.action.slotLevel && plan.action.slotLevel >= 1) {
  consumeSpellSlot(actor, plan.action.slotLevel);
}
```
Called before `resolveAttack`. `consumeSpellSlot` returns null silently if no slot
available (engine continues without crash — the AI gate prevents this in practice).

---

## Bugs Fixed
| Bug | Root Cause | Fix |
|---|---|---|
| Sacred Flame never selected | `attackType:'save'` not in `hasRangedReach` check | Added `'save'` to `hasRangedReach` and step 5 filter |
| Hellish Rebuke selected as action | `cost:'reaction'` parsed as `costType:'action'` | Added reaction case to `weaponToAction` |
| Dissonant Whispers used after 0 slots | `bestAttackAction` had no slot gate | Added `hasSpellSlot` check to filter |
| Leveled spell returned as `type:'attack'` | Step 4 always returned `type:'attack'` | Returns `type:'cast'` for spell/save attackType |
| No slot consumed on `type:'attack'` | `executePlannedAction.cast` never reached | Fixed by type correction above |

---

## Classes Still Missing Combat Spells (for future sessions)
| Class | Reason |
|---|---|
| Cleric | All prepared spells are buff/heal (Bless, Cure Wounds, Shield of Faith, Detect Magic, Healing Word) — none in DB |
| Paladin | Same — Bless, Cure Wounds, Protection from Evil and Good, Shield of Faith |
| Bard | Charm Person (charm), Cure Wounds (heal) excluded; **Dissonant Whispers ✅** |
| Druid | Healing Word excluded; **Thunderwave, Entangle, Faerie Fire ✅** |
| Sorcerer | Shield (reaction), Sleep (complex); **Chromatic Orb ✅** |
| Wizard | Mage Armor (self-buff), Shield (reaction), Sleep (complex), Detect Magic, Find Familiar; **Magic Missile, Thunderwave ✅** |
| Warlock | Hex (already handled separately); **Arms of Hadar ✅** |

## Deferred Spell Features
- **Healing spells** (Cure Wounds, Healing Word) — need ally-targeting logic in `selectAction`
- **Buff spells** (Bless, Shield of Faith) — need effect application to attack rolls / AC
- **Faerie Fire / Entangle effects** — advantage tracking / restrained condition needs engine support (framework exists, but AI doesn't leverage it yet)
- **Sleep** — HP-bucket incapacitation mechanic
- **Magic Missile splitting** — currently modelled as single roll (3d4+3); should be 3 separate 1d4+1 darts

---

## Test Suite: `src/test/spell_actions.test.ts` (49 tests)
| Section | Tests | What's verified |
|---|---|---|
| 1. Spell database | 14 | lookupSpell case-insensitive, fields, null for utility/heal |
| 2. Parser | 12 | All classes get correct spell actions; excluded spells absent |
| 3. Single-range fix | 6 | Sacred Flame range.normal=60, EB range.normal=120 |
| 4. Reaction fix | 4 | Hellish Rebuke costType=reaction, not selected as action |
| 5. Save cantrip selection | 3 | Cleric picks Sacred Flame at range; no slot consumed |
| 6. Leveled spell preference | 3 | Bard/Sorcerer prefer spells over weapons |
| 7. Slot gate | 5 | Fallback to weapon/cantrip at 0 slots (Bard→Rapier, Wizard→Fire Bolt) |
| 8. Integration | 2 | Slots actually consumed by runCombat |
