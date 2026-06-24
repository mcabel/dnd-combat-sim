# RFC: Shapechanger Subsystem (Batch 5c)

**Date:** Session 60
**Author:** Z.ai
**Status:** PROPOSED (user directed "A — proceed with RFC")
**Risk:** HIGH — touches Combatant state management mid-combat

---

## 1. Problem Statement

53 pre-2024 creatures have a "Shapechanger" trait, and Druid PCs (level 2+) have Wild Shape. Additionally, 3 spells (Polymorph L4, Shapechange L9, True Polymorph L9) transform creatures. None of these are mechanically implemented — the flags exist but do nothing.

The challenge: **transforming a Combatant mid-combat** requires swapping its stats (HP, AC, STR/DEX/CON, actions, speed) while preserving its identity (id, faction, position, conditions, concentration). This is a fundamental engine capability that doesn't exist in v1.

---

## 2. The 5 Transform Types (All Different Rules)

### Type A: Monster Shapechanger Trait (53 creatures)
**Examples**: Strahd (bat/wolf/mist), Mimic (object/true form), Werebear (humanoid/hybrid/bear)

**Rules** (from bestiary data):
- **Action** to transform (some are bonus action — Lazav)
- Transforms into a **specific form** listed in the trait text (not any creature)
- **"Its statistics, other than its size, are the same in each form"** — most shapechangers keep their stats; only size/speed/AC changes
- Exception: Strahd/vampires get **different speeds** in different forms (bat: fly 30, wolf: speed 50)
- Exception: Werebear gets **different AC** in hybrid form
- Can transform back as an action
- **No save** — it's a self-buff

**Complexity**: LOW-MEDIUM. Most keep stats; only a few fields change. The forms are hardcoded in the trait text (not data-driven).

### Type B: Druid Wild Shape (PC, level 2+)
**Rules** (PHB p.66):
- **Action** to transform into a beast of CR ≤ (druid level / 3, rounded down)
- Level 2: CR 1/4 max, no fly/swim
- Level 4: CR 1/2 max, swim allowed
- Level 8: CR 1 max, fly allowed
- **2 uses** per short rest (already tracked in `resources.wildShape`)
- Duration: hours (not relevant for single-combat v1)
- **Game statistics ARE replaced** by the beast's stats (HP, AC, STR/DEX/CON, actions, speed)
- **Retains**: alignment, INT/WIS/CHA, personality, class features (but can't cast spells while transformed unless Beast Spells at level 18)
- **HP**: takes the beast's max HP + current HP. When beast HP hits 0, reverts to druid form with original HP. Excess damage carries over.
- **Equipment**: merges into form; can't use weapons/armor while transformed

**Complexity**: HIGH. Full stat replacement + revert-on-0-HP + HP carryover.

### Type C: Polymorph Spell (L4, cast ON OTHERS)
**Rules** (PHB p.266):
- **Range 60 ft**, target makes WIS save (if unwilling)
- Transforms target into a **beast of CR ≤ target's CR (or level)**
- **Game statistics ARE replaced** by the beast's stats
- **Target retains**: alignment, personality, INT/WIS/CHA (but can't speak/cast spells)
- Duration: 1 hour concentration (or until target drops to 0 HP)
- **No effect on shapechangers** (they're immune)
- **No effect on creatures at 0 HP**
- Target gets beast's HP; on 0 HP or death, reverts to original form

**Complexity**: HIGH. Same as Wild Shape but cast on others + concentration + shapechanger immunity.

### Type D: Shapechange Spell (L9, self only)
**Rules** (PHB p.274):
- **Self only**, concentration 1 hour
- Transform into **any creature** of CR ≤ your level (not just beasts — any type except construct/undead)
- **Statistics replaced** but you **retain**: INT/WIS/CHA, alignment, personality, class features, **and can cast spells** (unlike Polymorph)
- You get the creature's actions + legendary actions (if any), but NOT lair actions
- Can use a bonus action to transform into a different form during the duration
- On 0 HP or death, reverts to original form

**Complexity**: VERY HIGH. Full stat replacement + spellcasting retention + legendary actions + mid-duration form swapping.

### Type E: True Polymorph (L9, cast on others)
**Rules** (PHB p.283):
- **Range 60 ft**, target makes WIS save (if unwilling)
- Transform creature into a **different creature** (any type, CR ≤ target's CR)
- OR transform a nonmagical object into a creature
- Duration: 1 hour concentration — **if you concentrate for the full hour, it becomes permanent**
- Same stat-replacement rules as Polymorph
- On 0 HP, reverts to original form

**Complexity**: VERY HIGH. Same as Polymorph + permanent transformation + object-to-creature.

---

## 3. Proposed v1 Implementation (Minimal Viable)

Given the complexity range, I propose a **phased approach**:

### Phase 1: Monster Shapechanger Trait (Type A) — LOW-MEDIUM risk
- Add `shapechangerForms?: ShapechangerForm[]` to Combatant, parsed from the trait text
- Each form specifies: `{ name, sizeChange?, speedChange?, acChange?, actionsOverride? }`
- Most forms only change size/speed/AC (not full stat replacement)
- New action type `'shapechange'` in `executePlannedAction` — swaps the listed fields
- Planner: transform on turn 1 if beneficial (e.g., Strahd transforms into wolf for speed)
- **53 creatures covered**

### Phase 2: Druid Wild Shape (Type B) — MEDIUM-HIGH risk
- Requires the full stat-replacement subsystem
- Add `_originalForm?: Combatant` scratch field to store pre-transform state
- On transform: deep-copy current state to `_originalForm`, then swap stats to beast form
- On revert (0 HP or duration end): restore from `_originalForm` with HP carryover
- Planner: Druid transforms into highest-CR beast available when melee combat is beneficial
- **Covers Druid level 2+ PCs**

### Phase 3: Polymorph Spell (Type C) — HIGH risk
- Requires Phase 2 subsystem + targeting (cast on others)
- Add shapechanger immunity check
- Concentration tracking (revert when concentration breaks)
- **Covers the L4 spell**

### Phase 4 (DEFERRED): Shapechange + True Polymorph (Types D + E) — VERY HIGH risk
- Requires legendary action swapping (Type D) + object-to-creature (Type E)
- **Defer until Phase 1-3 are stable**

---

## 4. Key Design Decisions

### 4.1 Stat Replacement Strategy
For Phase 2+ (full stat replacement), the approach:
```
transform(target, beastCombatant):
  target._originalForm = deepCopy(target)  // save full state
  // Replace stats
  target.maxHP = beastCombatant.maxHP
  target.currentHP = beastCombatant.currentHP
  target.ac = beastCombatant.ac
  target.str = beastCombatant.str
  target.dex = beastCombatant.dex
  target.con = beastCombatant.con
  target.actions = beastCombatant.actions
  target.speed = beastCombatant.speed
  // Retain
  // (id, faction, pos, alignment, int, wis, cha, classFeatures stay)
  target._isTransformed = true
  target._transformSource = 'wildShape' | 'polymorph' | ...
```

### 4.2 Revert Strategy
```
revertTransform(target):
  if (!target._originalForm) return
  const original = target._originalForm
  const carryOverDamage = target.maxHP - target.currentHP  // excess damage
  target.maxHP = original.maxHP
  target.currentHP = Math.max(0, original.currentHP - Math.max(0, carryOverDamage))
  target.ac = original.ac
  target.str = original.str
  // ... restore all fields
  target._isTransformed = false
  delete target._originalForm
```

### 4.3 HP Carryover (the tricky part)
PHB p.66: "When you revert to your normal form, you return to the number of hit points you had before you transformed. If you revert as a result of dropping to 0 hit points, any excess damage carries over to your normal form."

Example: Druid (20 HP) transforms into Wolf (11 HP). Wolf takes 15 damage → 0 HP (4 excess). Druid reverts at 20 - 4 = 16 HP.

### 4.4 Concentation Tracking
- Wild Shape: NOT concentration (lasts hours, but v1 is single-combat so no tracking needed)
- Polymorph: IS concentration — revert when caster's concentration breaks
- Shapechange: IS concentration — same

---

## 5. Risk Assessment

| Phase | Risk | Why |
|-------|------|-----|
| Phase 1 (monster trait) | LOW-MEDIUM | Most forms only change size/speed/AC — no full stat swap. 53 creatures. |
| Phase 2 (Wild Shape) | MEDIUM-HIGH | Full stat replacement + HP carryover. Deep-copy of Combatant could have edge cases. |
| Phase 3 (Polymorph) | HIGH | Cast on others + concentration revert + shapechanger immunity. |
| Phase 4 (Shapechange/True Poly) | VERY HIGH | Legendary action swapping + object-to-creature. Defer. |

---

## 6. Recommendation

**Start with Phase 1 only** (monster shapechanger trait). It's the lowest-risk + covers 53 creatures. The "statistics are the same in each form" rule means most transforms are just field swaps (size, speed, AC) — no full stat replacement needed.

Phase 2-3 (Wild Shape + Polymorph) require the full stat-replacement subsystem, which is higher risk. I'd recommend implementing Phase 1 first, verifying it's stable, then deciding on Phase 2-3 based on whether Druid PCs are a priority.

Phase 4 (Shapechange + True Polymorph) should be deferred indefinitely — they're 9th-level spells (level 17+ casters only) and the legendary-action-swapping + object-to-creature mechanics add significant complexity for rare use cases.

---

## 7. Files to Touch (Phase 1 only)

- `src/types/core.ts` — `shapechangerForms?: ShapechangerForm[]` + `_isTransformed?` scratch field
- `src/parser/fivetools.ts` — `parseShapechanger()` function (parse trait text for form names + field changes)
- `src/engine/combat.ts` — `case 'shapechange':` in `executePlannedAction` (swap fields)
- `src/ai/planner.ts` — branch to plan shapechange on turn 1
- `src/test/creature_shapechanger.test.ts` — tests

**No overlap with Sheet or Core files.**
