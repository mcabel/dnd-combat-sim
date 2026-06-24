# Delegation Spec: Spell Implementation for Core + Sheet Agents

**Date:** Session 60
**From:** Z.ai (creature workstream)
**To:** Core Engine + Sheet agents
**Purpose:** Delegate unimplemented spells so monsters can cast them

---

## Context

246 unimplemented spells are needed by the 945 spellcasting monsters. I've implemented 3 this session (Banishment, Tasha's Hideous Laughter, Blindness/Deafness upgrade). The remaining 243 need implementation. This spec delegates specific spells to Core + Sheet.

## The Spell Module Pattern (Follow Exactly)

Every bespoke spell module in this repo follows this pattern (see `src/spells/cause_fear.ts` for the canonical example):

### File: `src/spells/<snake_case_name>.ts`

```typescript
import { Combatant, Battlefield, Condition } from '../types/core';
import { rollSaveReactable, CombatEvent, EngineState } from '../engine/combat';
import { applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { chebyshev3D } from '../engine/movement';
import { consumeSpellSlot, hasSpellSlot } from '../ai/resources';

export const metadata = {
  name: 'Spell Name', level: N, school: 'school', rangeFt: R,
  concentration: true/false, saveAbility: 'wis' as const, castingTime: 'action',
  // v1 simplification flags:
  spellNameUpcastV1Implemented: false,
} as const;

function emit(state, type, actorId, desc, targetId?, value?) { ... }

export function shouldCast(caster: Combatant, bf: Battlefield): Combatant | null {
  // Gates: has action, has slot, not already concentrating (if conc spell)
  // Find best target (highest HP, closest)
  // Return null if no valid target
}

export function execute(caster: Combatant, target: Combatant, state: EngineState): void {
  // 1. consumeSpellSlot(caster, level)
  // 2. If concentration: startConcentration(caster, 'Spell Name')
  // 3. Roll save: rollSaveReactable(state, caster, target, ability, saveDC)
  // 4. On fail: applySpellEffect(target, { casterId, spellName, effectType, payload, sourceIsConcentration })
  // 5. Log everything
}

export function cleanup(c: Combatant): void {
  // For concentration spells: no-op (removeEffectsFromCaster handles cleanup)
  // For non-concentration: no-op
}
```

### 3 Integration Points (ALL REQUIRED)

1. **`src/types/core.ts`**: Add `| 'spellName'` to the `PlannedAction.type` union (around line 2280)

2. **`src/engine/combat.ts`**:
   - Add import: `import { shouldCast as shouldCastSpellName, execute as executeSpellName } from '../spells/snake_name';`
   - Add case branch (after `case 'causeFear':` around line 5130):
     ```typescript
     case 'spellName': {
       const target = plan.targetId ? bf.combatants.get(plan.targetId) ?? null : null;
       const live = target && !target.isDead && !target.isUnconscious ? target : shouldCastSpellName(actor, bf);
       if (live) executeSpellName(actor, live, state);
       break;
     }
     ```

3. **`src/ai/planner.ts`**:
   - Add import: `import { shouldCast as shouldCastSpellName } from '../spells/snake_name';`
   - Add planner branch (after Cause Fear branch, around line 4385):
     ```typescript
     if (!plan.action && self.actions.some(a => a.name === 'Spell Name')) {
       const target = shouldCastSpellName(self, battlefield);
       if (target) {
         plan.action = { type: 'spellName', action: null, targetId: target.id, description: `${self.name} casts Spell Name at ${target.name}` };
         plan.targetId = target.id;
         plan.bonusAction = planBonusAction(self, target, battlefield);
         return plan;
       }
     }
     ```

### Test File: `src/test/<spell_name>.test.ts`

Follow the pattern in `src/test/banishment_tashas.test.ts` — test metadata, shouldCast gates, execute effects (save fail + save success), concentration tracking.

### After Implementation

Run: `npx tsc --noEmit` (exclude TS7006 errors) + `npx ts-node --transpile-only src/test/<spell_name>.test.ts`

---

## Delegated Spells

### For Core Engine Agent (combat/damage spells)

| Spell | Level | Monsters | Source File to Read | Mechanics |
|-------|-------|----------|---------------------|-----------|
| **Wall of Fire** | 4 | 29 | `testDataSpells/spells-phb.json` | DEX save, 5d8 fire, concentration. Creates a wall (60ft line or 20ft ring). Creatures in wall take 5d8 fire. One side deals 1d8 fire to creatures within 10ft. **Complex: needs wall/zone subsystem.** |
| **Dimension Door** | 4 | 56 | `testDataSpells/spells-phb.json` | Self + 1 ally teleport up to 500ft. NO save, NO attack. **Simple: just move the caster.** |
| ** Fog Cloud** | 1 | 46 | `testDataSpells/spells-phb.json` | Creates 20ft sphere of heavy obscurement (concentration). **Needs obscurement subsystem — coordinate with vision RFC.** |
| **Darkness** | 2 | 81 | `testDataSpells/spells-phb.json` | Creates 15ft magical darkness (concentration). Blocks darkvision. **Needs vision subsystem — coordinate with vision RFC.** |
| **Scrying** | 5 | 49 | `testDataSpells/spells-phb.json` | See/hear target at any distance (WIS save). **Out of combat for creatures — tag as non-combat.** |

**Priority for Core**: Dimension Door (simplest — just movement), then Wall of Fire (needs zone subsystem).

### For Sheet Agent (utility/ritual spells — tag as out-of-combat)

These spells have **no combat effect** for creatures. They should be tagged with `outOfCombat: true` in metadata so the AI never selects them. Sheet owns `src/data/spells.ts` (SPELL_DB) + can add the tag.

| Spell | Level | Monsters | Why out-of-combat |
|-------|-------|----------|-------------------|
| **Detect Magic** | 1 | 215 | Senses magic within 30ft. No combat effect. |
| **Sending** | 3 | 42 | Send a message to anyone. No combat effect. |
| **Comprehend Languages** | 1 | 24 | Understand languages. No combat effect. |
| **Identify** | 1 | 15 | Identify magic items. No combat effect. |
| **Divination** | 4 | 17 | Get a omen. No combat effect. |
| **Tongues** | 3 | 33 | Understand all languages. No combat effect. |
| **Water Breathing** | 3 | 18 | Breathe underwater. No combat effect (no drowning in v1). |
| **Locate Object** | 2 | 15 | Sense direction to object. No combat effect. |
| **Locate Creature** | 4 | 13 | Sense direction to creature. No combat effect. |
| **Clairvoyance** | 3 | 21 | See through invisible sensor. No combat effect. |

**Sheet's task**: Add `outOfCombat?: boolean` to the spell metadata type in `src/data/spells.ts`. Tag the above 10 spells. The AI planner already skips spells with no `shouldCast` function — this tag is a safety net for the monster spellcasting integration (Batch 5b step 2).

---

## Compatibility Notes

- **Z.ai is working on**: creature workstream (parser, types, tests). No overlap with spell module files.
- **Core owns**: `src/engine/combat.ts`, `src/ai/planner.ts`, `src/types/core.ts` (the PlannedAction type union). If Core implements a spell, they'll touch these files. **Coordinate via TEAMGOALS.md.**
- **Sheet owns**: `src/data/spells.ts` (SPELL_DB), `docs/characters.html`. The `outOfCombat` tag is Sheet's responsibility.
- **File to give them**: This file — `docs/SPELL-DELEGATION-SPEC.md`. Also point them to `src/spells/cause_fear.ts` (canonical example) + `src/test/banishment_tashas.test.ts` (test pattern).

## Workflow

1. Pick a spell from the table above.
2. Read the 5etools data: `node -e "const s = require('./testDataSpells/spells-phb.json').spell.find(x => x.name === 'Spell Name'); console.log(JSON.stringify(s, null, 2))"`
3. Follow the spell module pattern (section above).
4. Add the 3 integration points (type + combat.ts case + planner branch).
5. Write a test file.
6. Run `tsc --noEmit` + the test.
7. Commit + push.
8. Mark done in this file (add a ✅ next to the spell name).
