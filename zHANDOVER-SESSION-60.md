# zHANDOVER — Session 60 (Final)

**Date:** 2026-06-24
**Agent:** Z.ai (autonomous — Core + Sheet offline; took over non-clashing work + RFCs)
**Focus:** (1) Verify Sheet/Core done; (2) Wire Ambusher + False Appearance; (3) Parse monster spellcasting metadata; (4) Find + implement lair actions; (5) Write RFCs for shapechanger + vision/audio; (6) Implement 3 new spells; (7) Prepare delegation spec for Core/Sheet.

---

## Session Summary

This was a long autonomous session with multiple workstreams:

### Workstream 1: Creature Trait Wiring (commits `056efd4`, `c1e8014`)
- **Ambusher** (9 creatures): wired into `resolveAttack` — advantage in round 1 vs targets that haven't taken a turn. New `_hasTakenTurn` scratch field.
- **False Appearance** (27 of 83 creatures with init-advantage variant): wired into `rollInitiative` — advantage on initiative roll. New `falseAppearanceInitAdv` field.
- **Monster Spellcasting** (945 creatures): metadata parser for `monsterSpellcasting` field. Extracts saveDC, spellAttackBonus, ability, atWill, daily, slots. NOT consumed by engine yet.

### Workstream 2: Lair Actions (commit `baf9ece`)
- **Found the data**: `5etools-mirror-3/5etools-src` repo has `data/bestiary/legendarygroups.json` (187 legendary groups, 137 with lairActions). Downloaded to `bestiaryData/legendarygroups.json`.
- **Parser**: `parseLairActions()` — matches via `legendaryGroup` field, extracts action options + initiative count.
- **Engine hook**: fires lair action log at start of each round (initiative count 20). v1: logs only — no mechanical effects yet.

### Workstream 3: RFCs (commits `a84800f`, `e363e7c`)
- **Shapechanger RFC** (`docs/RFC-SHAPECHANGER.md`): 4-phase proposal. Phase 1 (monster trait, 53 creatures) recommended as starting point.
- **Vision + Audio RFC** (`docs/RFC-VISION-AUDIO.md`): 4-phase proposal. 6 doubts flagged for user. User answered all 6:
  1. Sound formula: pp × 5ft ✅
  2. Hide requires obscurement ✅
  3. Hidden persists until noisy activity (cast/attack) ✅
  4. 4-state detection model ✅
  5. lightLevel field ✅
  6. Active perception after passive fails ✅

### Workstream 4: Spell Implementation (commit `847a9c2`)
- **Banishment** (L4, 60 monsters): CHA save, concentration. Fey/elemental/etc removed permanently; others incapacitated.
- **Tasha's Hideous Laughter** (L1, 18 monsters): WIS save, concentration. Prone + incapacitated.
- **Blindness/Deafness** (L2, 13 monsters): Upgraded from stub to bespoke. CON save or blinded.
- 20 new test assertions. All tests pass.

### Workstream 5: Delegation Spec (commit pending)
- **`docs/SPELL-DELEGATION-SPEC.md`**: Full spec for Core + Sheet to implement more spells. Includes the spell module pattern, 3 integration points, delegated spell lists, and compatibility notes.

---

## User's Vision/Audio Answers (for next agent to implement)

1. **Sound formula**: `passivePerception × 5ft` (Chebyshev distance)
2. **Hide requirements**: Need obscurement (smoke, fog, invisibility, darkness, obstacles)
3. **Hidden persistence**: Until noisy activity (cast, attack). Whispering to allies (5ft) doesn't break stealth; voice warning / illusion does (requires new check + action economy). Spells with no verbal component (or Subtle Spell metamagic) don't break stealth.
4. **Detection states**: 4-state model (visible / hidden / position-known / unknown)
5. **Light level**: Use the existing `lightLevel` field
6. **Active perception**: Can use active if passive fails (spends action)

---

## Current State

### All Tier-A + Tier-B tasks DONE across all 3 workstreams:
- **Core Engine**: TG-027, TG-024, TG-032, TG-030, TG-031 (Z.ai) + TG-028 (Core) ✅
- **Sheet**: TG-025, TG-026, TG-029 (Sheet) ✅
- **Creature**: Batches 0-4h + Session 59 Death Burst fixes + Session 60 Ambusher/False Appearance/spellcasting/lair actions ✅

### New creature coverage this session:
- 9 Ambusher creatures wired (was metadata-only)
- 27 False Appearance init-advantage creatures wired (was metadata-only)
- 945 spellcasting creatures parsed (metadata-only, not engine-consumed)
- 137 lair action creatures parsed + engine hook (logs only)
- 3 new spells implemented (Banishment, Tasha's Hideous Laughter, Blindness/Deafness upgrade)

### Remaining work (all need user direction):
1. **Vision/Audio subsystem** — RFC written + user answered all 6 doubts. **Ready to implement Phase 1.** Files: `src/engine/perception.ts` (new), `src/engine/combat.ts`, `src/engine/utils.ts`, `src/ai/planner.ts`.
2. **Shapechanger** — RFC written. Phase 1 (monster trait, 53 creatures) ready to implement.
3. **Monster spellcasting engine integration** (Batch 5b step 2) — metadata parsed. Needs: slot tracking on monsters + AI spell selection (weighted, not random — per user feedback). User wants a weighted action system with tags (damage/CC/healing/defending).
4. **243 more spells to implement** — delegation spec written for Core + Sheet.
5. **Tier-C Core** (TG-007 Wall, TG-010 Vision, TG-011 complex spells, TG-006 Phase 4 summons) — some covered by RFCs above.

### Files to give Core + Sheet:
- **`docs/SPELL-DELEGATION-SPEC.md`** — spell implementation tasks + pattern
- **`docs/RFC-VISION-AUDIO.md`** — vision/audio subsystem design
- **`docs/RFC-SHAPECHANGER.md`** — shapechanger design

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| All creature tests | ✅ All pass |
| combat / engine / ai / scenario | ✅ All pass |
| New spell tests (20 assertions) | ✅ All pass |

---

## Next Agent Priorities

1. **Implement Vision/Audio Phase 1** — user answered all 6 doubts. Start with `src/engine/perception.ts` (new file). Wire sound detection (pp × 5ft) + generalized Hide action + 4-state detection model. Touches `combat.ts` + `utils.ts` + `planner.ts` (Core files — Core is offline, safe to touch).
2. **Implement Shapechanger Phase 1** — monster trait only (53 creatures, LOW-MEDIUM risk). Parser + `case 'shapechange'` + planner branch.
3. **Implement more spells** — follow `docs/SPELL-DELEGATION-SPEC.md`. Start with Dimension Door (simplest — just movement).
4. **Monster spellcasting engine integration** — per user: weighted action system (not random). Tags: damage/CC/healing/defending. Needs RFC first.
