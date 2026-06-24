# zHANDOVER — Session 60

**Date:** 2026-06-24
**Agent:** Z.ai (autonomous — Core + Sheet agents offline; took over non-clashing creature workstream work)
**Focus:** (1) Verify Sheet's TG-026 claim + mark DONE; (2) Wire Ambusher + False Appearance creature trait flags into the engine; (3) Parse monster spellcasting as metadata (Batch 5b step 1). Continued autonomously until all remaining work was blocked or HIGH-risk.

---

## Session Summary

Session 60 was an autonomous session (Core + Sheet agents offline for the day). The user directive: "coordinate taking over their tasks without clashing with them on the future... continue with the rest of the plan autonomously until all work is blocked or need user input to proceed."

### What Sheet + Core Did (Verified)

- **Core** landed TG-028 (commit `7766253`) — the last Core Engine task (comment-only BB/GFB label fix).
- **Sheet** landed 3 commits: Sheet-42a (5 API endpoints), TG-025 (unarmored-AC hook), TG-029 (Champion 10 second Fighting Style).
- **Sheet claimed TG-026 was already done** — verified: `docs/characters.html:2186,2190` has Ki + Sorcery Points rows binding against the typed `PlayerResources.ki`/`sorceryPoints` fields I added in Session 55 (TG-024). Marked TG-026 DONE in TEAMGOALS.md.

### What I Did (3 commits)

1. **Wired Ambusher + False Appearance into the engine** (commit `056efd4`):
   - **Ambusher** (9 creatures, MM p.11): "In the first round of combat, advantage on attack rolls against any creature that hasn't taken a turn yet." Added `_hasTakenTurn` scratch field on Combatant, set in `runCombat` after `executeTurnPlan`. `resolveAttack` grants advantage when `attacker.ambusher && round === 1 && !target._hasTakenTurn`.
   - **False Appearance** (27 of 83 creatures with init-advantage variant): "advantage on its initiative roll." Parser now distinguishes the init-advantage variant (checks trait text for "initiative" keyword) via new `falseAppearanceInitAdv?: boolean` field. `rollInitiative` uses `rollWithAdvantage(20)` when the flag is true.
   - 14 test assertions in `creature_ambusher_false_appearance.test.ts`.

2. **Monster spellcasting metadata parser** (commit `c1e8014`, Batch 5b step 1):
   - 945 pre-2024 creatures have spellcasting data. Parsed into typed `monsterSpellcasting?` field on Combatant.
   - Three formats: at-will (`will` array), daily (`daily` object with 1e/2e/3e keys), slot-based (`spells` object with level → { slots, spells[] }).
   - Extracts: saveDC (from `{@dc N}` tag), spellAttackBonus (from `{@hit N}` tag), ability (int/wis/cha), atWill spell names, daily spell names + uses/day, slot-based spell levels + slot counts + spell names.
   - Verified on Lich (DC=20, +12, INT, L0-L9), Drow (DC=11, CHA, at-will + daily), Mage (DC=14, +6, INT, L0-L5), Factol Skall (DC=19, INT, at-will + daily).
   - 16 test assertions in `creature_spellcasting_metadata.test.ts`.
   - v1: metadata-only — NOT consumed by the engine. Future Batch 5b step 2 (planner + engine integration) is HIGH-risk, deferred.

3. **Handover hygiene** (commit `f78f127`): Archived HANDOVER-SESSION-46 + 47 to HandoverOld/ (Core's new HANDOVER-SESSION-49 had pushed root to 4 HANDOVER-SESSION files, violating AGENTS.md max-2 rule).

---

## What's Blocked / Needs User Input

### Batch 5a: Lair Actions — BLOCKED on data
- 41 creatures have `legendaryGroup` references, but the actual lair action text is in separate 5etools files NOT present in the bestiary dataset.
- **What's needed**: The user must provide 5etools lair action JSON files (e.g. `lair.json` or similar from the 5etools data repository).
- **Engine work** (when data is available): initiative-count-20 hook in `runCombat` + lair-action parsing + per-action mechanical effects.

### Batch 5b step 2: Monster Spellcasting Engine Integration — HIGH-risk
- Step 1 (metadata parser) is DONE (this session). Step 2 needs:
  - SPELL_DB lookup for each spell name (only ~170 of ~500+ spells are in SPELL_DB)
  - Spell-slot/daily-use tracking on Combatant
  - AI spell selection (which spell to cast, at which target, when)
  - Planner integration (new action types for each spell)
- **Risk**: HIGH — needs an RFC before starting.

### Batch 5c: Shapechanger — HIGH-risk
- 23+ creatures can transform into different forms (change stats, AC, HP, actions mid-combat).
- Needs a transform subsystem that doesn't exist.
- **Risk**: HIGH — needs an RFC.

### Tier-C Core Engine Tasks — HIGH-risk (need user directive)
- TG-007 (Wall spells), TG-010/TG-021 (vision), TG-011 (28 complex spells), TG-006 Phase 4 (19 summon spells).
- All need RFCs before starting. No action without explicit user directive.

### Remaining Metadata-Only Creature Flags (can't wire without subsystems)
- Siege Monster (71): needs object HP subsystem (v1 has none).
- Water Breathing (33): needs drowning subsystem (v1 has none).
- Hold Breath (57): needs drowning subsystem (v1 has none).
- Brute (14): 5etools action damage entries already include the extra die — no engine work needed (already handled).

---

## Files Changed (Session 60)

### New files (3)
- `src/test/creature_ambusher_false_appearance.test.ts` — 14 assertions
- `src/test/creature_spellcasting_metadata.test.ts` — 16 assertions
- `zHANDOVER-SESSION-60.md` — this file

### Modified files (6)
- `src/types/core.ts` — `_hasTakenTurn` scratch field, `falseAppearanceInitAdv` field, `monsterSpellcasting` field (with `slots` sub-field), updated doc comments
- `src/parser/fivetools.ts` — `parseMonsterSpellcasting()` function, `falseAppearanceInitAdv` parser refinement, `monsterSpellcasting` call in `monsterToCombatant`
- `src/engine/utils.ts` — `rollInitiative` grants advantage for `falseAppearanceInitAdv`
- `src/engine/combat.ts` — `resolveAttack` Ambusher advantage check, `runCombat` `_hasTakenTurn` tracking
- `TEAMGOALS.md` — TG-026 marked DONE (verified Sheet-41 + TG-024)
- `CREATURE-MEGABATCH-MIGRATION-PLAN.md` — Batch 5b step 1 row added

### Moved files (2)
- `HANDOVER-SESSION-46.md` → `HandoverOld/` (hygiene)
- `HANDOVER-SESSION-47.md` → `HandoverOld/` (hygiene)
- `zHANDOVER-SESSION-57.md` → `HandoverOld/` (hygiene — root now has 58 + 60)

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| `creature_ambusher_false_appearance.test.ts` (14) | ✅ All pass — NEW |
| `creature_spellcasting_metadata.test.ts` (16) | ✅ All pass — NEW |
| `creature_death_burst.test.ts` (149) | ✅ All pass |
| `combat.test.ts` | ✅ All pass |
| `engine.test.ts` | ✅ All pass |
| `scenario.test.ts` | ✅ All pass |
| `ai.test.ts` | ✅ All pass |
| `booming_blade.test.ts` (216) | ✅ All pass (Core's TG-028) |
| `green_flame_blade.test.ts` (209) | ✅ All pass (Core's TG-028) |
| `subclass_features.test.ts` (40) | ✅ All pass (Sheet's TG-029) |
| `server.test.ts` (263) | ✅ All pass (Sheet's Sheet-42a/b/c) |

**New assertions this session: 30** (14 + 16). All existing tests remain green.

---

## CI Status

3 commits pushed to `main`:
- `f78f127` — docs: archive HANDOVER-SESSION-46 + 47 (hygiene)
- `056efd4` — Session 60 Creature: Wire Ambusher + False Appearance into engine
- `c1e8014` — Session 60 Creature: Monster spellcasting metadata parser (Batch 5b step 1)

---

## Complete Task Status Summary

### Core Engine Workstream — ALL Tier-A + Tier-B DONE
- ✅ TG-027 (Session 54, Z.ai) — Elemental Affinity weapon riders
- ✅ TG-024 (Session 55, Z.ai) — Ki + Sorcery Points transfer
- ✅ TG-032 (Session 56, Z.ai) — Nature's Ward fey/elemental immunity
- ✅ TG-030 (Session 57, Z.ai) — Quivering Palm
- ✅ TG-031 (Session 58, Z.ai) — Flurry of Blows + Open Hand Technique
- ✅ TG-028 (Session 49, Core) — BB/GFB label fix

### Sheet Workstream — ALL TASKS DONE
- ✅ TG-025 (Sheet-42b) — Per-class unarmored-AC hook
- ✅ TG-026 (Sheet-41, verified Session 60) — Resources panel UI Ki/SP rows
- ✅ TG-029 (Sheet-42c) — Champion 10 second Fighting Style

### Creature Workstream — Batches 0-4h DONE + Session 59-60 enhancements
- ✅ Batches 0/1/2/3/4a/4b/4c (Session 52)
- ✅ Batch 4d (Session 53 + Session 59 parse-quality fixes)
- ✅ Batch 4e-remaining (Session 53)
- ✅ Batch 4f (Session 53)
- ✅ Batch 4g (Session 53)
- ✅ Batch 4h (Session 53)
- ✅ Session 59: Death Burst parse-quality fixes (damageType optional + condition-removal context)
- ✅ Session 60: Ambusher + False Appearance wired into engine
- ✅ Session 60: Monster spellcasting metadata parser (Batch 5b step 1)
- 🔒 Batch 5a: BLOCKED on data (no lair action JSON in bestiary)
- 🔒 Batch 5b step 2: HIGH-risk (engine integration — needs RFC)
- 🔒 Batch 5c: HIGH-risk (shapechanger — needs RFC)

### Remaining Work (all need user directive or data)
1. **Batch 5a Lair actions** — BLOCKED on data (user must provide 5etools lair JSON files)
2. **Batch 5b step 2 Monster spellcasting engine integration** — HIGH-risk, needs RFC
3. **Batch 5c Shapechanger** — HIGH-risk, needs RFC
4. **Tier-C Core Engine** (TG-007/TG-010/TG-011/TG-006-Phase-4) — HIGH-risk, needs RFCs + user directive

**The codebase is in a clean, fully-tested state. All low/medium-risk work is complete. The remaining work is either blocked on data or HIGH-risk requiring user direction.**
