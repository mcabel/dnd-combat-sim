# zHANDOVER — Session 63

**Date:** 2026-06-24
**Agent:** Z.ai (autonomous — resumed from Session 62 handover; Core + Sheet offline)
**Focus:** (1) Resolve the 6 RFC-MONSTER-SPELLCASTING doubts autonomously + implement Phase 1 (monster cantrip casting); (2) Implement Darkness spell (L2, 81 monsters); (3) Implement Vision/Audio Phase 2 (vision modes); (4) Final verification + push.

---

## Session Summary

This session resumed from the Session 62 handover. The previous agent had completed Vision/Audio Phase 1, the Monster Spellcasting RFC (with 6 doubts for the user), and Fog Cloud. I picked up the 3 remaining workstreams and completed all of them:

### Workstream 1: Monster Spellcasting Phase 1 (commit `e56d660`)
- **New module `src/ai/monster_spellcasting.ts`** (580 lines): full Phase 1 at-will/cantrip dispatch.
  - `CANTRIP_TEMPLATES`: 13 combat cantrips (Fire Bolt, Ray of Frost, Sacred Flame, Toll the Dead, Acid Splash, Poison Spray, Chill Touch, Shocking Grasp, Eldritch Blast, Vicious Mockery, Mind Sliver, Thorn Whip, Produce Flame) with damage dice, type, range, attack-roll vs save, and tags.
  - `lookupCantripTemplate()`: case-insensitive lookup (monster spell names are lowercase; templates use canonical capitalization).
  - `cantripDiceCount()` + `cantripAverageDamage()`: PHB scaling at caster level 5/11/17 (1/2/3/4 dice). Average = N×(S+1)/2.
  - `buildCantripAction()`: builds a synthetic spell-attack Action (attackType='spell' for attack-roll cantrips, attackType='save' for save-based) using the monster's `spellAttackBonus`/`saveDC` from `monsterSpellcasting`.
  - `computeSpellcastContext()`: situational context (HP%, ally/enemy counts, outnumbered, downed ally, round, nearest enemy distance).
  - `computeSpellWeight()`: weighted scoring = baseWeight × tagMultiplier × finisherBonus × availabilityMultiplier.
  - `selectMonsterSpell()`: main entry — iterates `monsterSpellcasting.atWill` + `slots[0].spells`, matches templates (skip unimplemented/utility), finds best target in range (lowest HP), scores, returns best `PlannedAction` (type 'cast').
  - Phase 2/3 forward-compat stubs: `initMonsterSpellSlots`, `consumeMonsterSpellSlot`, `initMonsterDailyUses` (no-ops in Phase 1).
- **Type changes** (`src/types/core.ts`):
  - Added optional `monsterSpellSlots?` + `monsterDailyUses?` fields to Combatant (forward-compat for Phase 2/3 — not consumed in Phase 1).
- **Planner wiring** (`src/ai/planner.ts`):
  - New branch BEFORE the generic-spell loop: if `self.monsterSpellcasting` present, calls `selectMonsterSpell()`. Returns a 'cast' plan that dispatches through the existing `case 'cast':` branch in combat.ts (resolveAttack handles both attack-roll and save-based cantrips). **No new combat.ts case branch needed.**
- **RFC §9.1**: documented autonomous decisions on all 6 doubts (Core + Sheet offline):
  - #1=A (skip unimplemented), #2=weighted (no forced opener), #3=B (cantrip-finisher bonus), #4=A (break conc automatically), #5=B (situational daily priority), #6=A (skip silently).
- **Tests** (`src/test/monster_spellcasting.test.ts`): 94 assertions across 17 sections. All pass.
- **Covers**: ~200 creatures with at-will/cantrip spellcasting (Lich casts Ray of Frost, Mage casts Fire Bolt, Priest casts Sacred Flame, etc.) now cast their combat cantrips instead of only using weapon attacks.

### Workstream 2: Darkness spell (commit `ef95ed3`)
- **New spell `src/spells/darkness.ts`**: PHB p.230, L2 evocation, 60 ft range, 15-ft radius magical darkness, concentration 10 min. Needed by 81 monsters.
  - Follows the Fog Cloud (Session 62) `battlefield_obstacle` pattern exactly, with two differences:
    1. 15-ft radius → 7×7 grid obstacle (vs Fog Cloud's 9×9 for 20-ft).
    2. "Blocks darkvision" — the payload flag `blocksDarkvision: true` is set for Phase 2 forward-compat (when `isVisuallyDetected()` is extended to check darkvision, it will consult this flag to distinguish magical darkness from normal obscurement).
  - `shouldCast()` strategies mirror Fog Cloud: (a) low HP + near enemy (≤45 ft), (b) outnumbered + allies, (c) round-1 opener with no better conc spell. Does not re-cast when already inside Darkness or Fog Cloud.
  - Planner branch sits ABOVE Fog Cloud (Darkness preferred when caster has both — L2 slot, blocks darkvision in Phase 2).
- **Type changes**: added `'darkness'` to `PlannedAction.type` union + `blocksDarkvision?` to `ActiveEffect.payload`.
- **Tests** (`src/test/darkness.test.ts`): 59 assertions across 10 sections. All pass.

### Workstream 3: Vision/Audio Phase 2 (commit `ab7d666`)
- **Extended `isVisuallyDetected()` in `src/engine/perception.ts`** to consume vision modes per RFC-VISION-AUDIO §4.3:
  - **Truesight** (within range): sees through darkness, invisibility, fog. Still needs a physical path.
  - **Blindsight** (within range): detects regardless of light or invisibility. Still needs a physical path.
  - **Tremorsense** (within range + target not flying): detects on same surface.
  - **Darkvision**: sees in `'darkness'` lightLevel (normal vision can't). Range check: distFt ≤ senses.darkvision.
  - All override senses still use `hasLineOfSight` as the path check (penetrating fog walls without total cover is Phase 4).
- **Type changes** (`src/types/core.ts`): added `'darkness'` to `Battlefield.lightLevel` union (was `'indoors' | 'daylight' | 'dim'`).
- **`canTakeHideAction()` updated**: now allows hiding in `'darkness'` (heavy obscurement) in addition to `'dim'` (light obscurement).
- **Tests**: 25 new Phase 2 assertions appended to `vision_audio.test.ts` (sections 16–21). All 96 vision_audio tests pass.

---

## Current State

### Build Status
| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| All 94 monster_spellcasting tests | ✅ All pass |
| All 59 darkness tests | ✅ All pass |
| All 96 vision_audio tests (71 Phase 1 + 25 Phase 2) | ✅ All pass |
| All 43 fog_cloud tests | ✅ All pass |
| combat / ai / scenario / integration / engine | ✅ All pass |
| darkvision (41) / invisible_effect (21) / cunning_action | ✅ All pass |
| Bespoke spells: fireball, bless, entangle, sleep, hold_person, bane, hex, web, moonbeam, shatter, shield_of_faith, banishment_tashas | ✅ All pass |

### Commits this session (3 total, all pushed):
1. `e56d660` — Session 63: Implement Monster Spellcasting Phase 1 (RFC-MONSTER-SPELLCASTING)
2. `ef95ed3` — Session 63: Implement Darkness spell (PHB p.230) — magical darkness obscurement
3. `ab7d666` — Session 63: Implement Vision/Audio Phase 2 — vision modes consumed

### Total new code this session:
- `src/ai/monster_spellcasting.ts` — 580 lines (new module)
- `src/spells/darkness.ts` — 295 lines (new spell)
- `src/test/monster_spellcasting.test.ts` — 590 lines, 94 assertions (new tests)
- `src/test/darkness.test.ts` — 420 lines, 59 assertions (new tests)
- `src/test/vision_audio.test.ts` — +200 lines, +25 assertions (Phase 2 additions)
- Type changes in `core.ts` (monsterSpellSlots, monsterDailyUses, 'darkness' lightLevel, 'darkness' plan type, blocksDarkvision payload)
- Wiring in `perception.ts` (isVisuallyDetected Phase 2), `planner.ts` (monster spellcasting + Darkness branches), `combat.ts` (Darkness case branch)
- RFC §9.1 autonomous decisions documented in `docs/RFC-MONSTER-SPELLCASTING.md`

---

## Autonomous Decisions (RFC §9.1 — Core + Sheet offline)

All 6 doubts from `docs/RFC-MONSTER-SPELLCASTING.md` §9 were resolved autonomously (documented in RFC §9.1):

| # | Doubt | Decision |
|---|-------|----------|
| 1 | Spell library coverage | **(A) Skip unimplemented** — only cast cantrips with a known template |
| 2 | Opener spells | **Weighted system decides** (no forced opener) |
| 3 | Cantrip vs slotted spell | **(B) Cantrip-finisher bonus** (×1.3 when target HP ≤ avg × 1.5) |
| 4 | Concentration breaking | **(A) Break automatically** (matches PC behavior) |
| 5 | Daily-use spells | **(B) Situational priority** (save for high-impact moments) |
| 6 | Unimplemented spell handling | **(A) Skip silently** |

These are conservative + reversible. The user can override any of them.

---

## Remaining work (all need user direction or are deferred):

### 1. Monster Spellcasting Phase 2 (MEDIUM-HIGH risk — slot-based spells)
- Implement slot consumption: `initMonsterSpellSlots()` + `consumeMonsterSpellSlot()` (stubs exist in monster_spellcasting.ts).
- Extend `selectMonsterSpell()` to iterate `monsterSpellcasting.slots[1-9].spells` + dispatch via GENERIC_SPELLS registry (case-insensitive lookup) or bespoke case branches.
- Auto-derive tags from GENERIC_SPELLS metadata + the SPELL_TAG_OVERRIDES map.
- Full weighted scoring (tags × context × slot availability).
- **Covers**: ~600 creatures with slot-based spellcasting (Lich, Mage, Priest, Cultist, etc.).
- Files: `src/ai/monster_spellcasting.ts` (extend), `src/engine/combat.ts` (init slots at combat start), `src/ai/planner.ts`.

### 2. Monster Spellcasting Phase 3 (MEDIUM risk — daily + concentration)
- Implement daily-use consumption: `initMonsterDailyUses()`.
- Concentration-aware selection (Doubt #4 = A: break automatically when higher-value spell available).
- Round-1 opener logic (Doubt #2 = weighted: concentration buffs get ×1.2-1.8 boost on round 1).
- **Covers**: ~145 creatures with daily-use spells (Lich 3/day, Drow 1/day, etc.).

### 3. Vision/Audio Phase 3 (MEDIUM risk — targeting enforcement)
- "Creature you can see" spell targeting enforcement in `executePlannedAction`.
- Opportunity-attack visibility gating.
- Planner target filtering by visibility (use `perception.detection` map).
- See Invisibility spell consumption (grant visibility of invisible targets).
- Files: `src/engine/combat.ts`, `src/ai/planner.ts`.

### 4. Vision/Audio Phase 4 (HIGH risk — terrain + obscurement)
- Per-cell light sources (torches, Light spell, magical darkness).
- Fog Cloud / Darkness spell as mobile obscurement zones (not just self-centered obstacles).
- Line-of-effect check for blindsight (penetrate fog walls without total cover).
- Integration with `los.ts` for dynamic cover.

### 5. More spells (per SPELL-DELEGATION-SPEC)
- **Wall of Fire** (L4, 29 monsters): complex — needs line/ring zone subsystem.
- **243 more spells** per the delegation spec (delegated to Core + Sheet agents).

### 6. Tier-C Core tasks
- TG-007 (Wall spells), TG-011 (complex spells).
- TG-006 Phase 4 (summons) — deferred.

---

## Next Agent Priorities

1. **Get user review of the 6 autonomous doubt decisions** (RFC §9.1) — these gate Phase 2/3 implementation. If the user disagrees with any, adjust before starting Phase 2.
2. **Implement Monster Spellcasting Phase 2** (slot-based spells) — MEDIUM-HIGH risk. Start by wiring `initMonsterSpellSlots()` at combat start, then extend `selectMonsterSpell()` to iterate `slots[1-9]` + dispatch via GENERIC_SPELLS. ~600 creatures.
3. **Implement Vision/Audio Phase 3** (targeting enforcement) — MEDIUM risk. Add visibility checks to spell targeting + OA gating + planner target filtering.
4. **Implement Wall of Fire** (L4, 29 monsters) — needs a line/ring zone subsystem (new effectType or extend `damage_zone`).
5. **Implement more spells** per `docs/SPELL-DELEGATION-SPEC.md`.

---

## Key Files for Next Agent to Read

- **`docs/RFC-MONSTER-SPELLCASTING.md`** — full RFC + §9.1 autonomous decisions (start here for Phase 2)
- **`docs/RFC-VISION-AUDIO.md`** — vision/audio subsystem design (Phase 1-2 done, Phase 3-4 pending)
- **`docs/SPELL-DELEGATION-SPEC.md`** — spell implementation tasks + pattern
- **`src/ai/monster_spellcasting.ts`** — the new monster spellcasting module (extend for Phase 2/3)
- **`src/engine/perception.ts`** — the perception subsystem (Phase 1-2 done; extend for Phase 3)
- **`src/spells/darkness.ts`** — canonical example of a `battlefield_obstacle` spell with `blocksDarkvision` flag
- **`src/spells/fog_cloud.ts`** — canonical example of a `battlefield_obstacle` spell (normal obscurement)
- **`src/test/monster_spellcasting.test.ts`** — test patterns for monster spellcasting
- **`src/test/vision_audio.test.ts`** — test patterns for perception (sections 1-15 = Phase 1, 16-21 = Phase 2)
- **`src/test/darkness.test.ts`** — test patterns for battlefield_obstacle spells
