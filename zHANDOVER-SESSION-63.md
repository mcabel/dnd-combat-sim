# zHANDOVER — Session 63

**Date:** 2026-06-24
**Agent:** Z.ai (autonomous — resumed from Session 62 handover; Core + Sheet offline)
**Focus:** (1) Resolve the 6 RFC-MONSTER-SPELLCASTING doubts autonomously + implement Phase 1 (monster cantrip casting); (2) Implement Darkness spell (L2, 81 monsters); (3) Implement Vision/Audio Phase 2 (vision modes); (4) **Vision/Audio Phase 3 (targeting enforcement)** — continued autonomously while user prepares doubt answers; (5) Extend cantrip templates; (6) Final verification + push.

---

## Session Summary

This session resumed from the Session 62 handover. The previous agent had completed Vision/Audio Phase 1, the Monster Spellcasting RFC (with 6 doubts for the user), and Fog Cloud. I picked up the remaining workstreams and completed **5 workstreams** (3 from the handover + 2 continued autonomously):

### Workstream 1: Monster Spellcasting Phase 1 (commit `e56d660`)
- **New module `src/ai/monster_spellcasting.ts`** (620 lines): full Phase 1 at-will/cantrip dispatch.
  - `CANTRIP_TEMPLATES`: **17 combat cantrips** (Fire Bolt, Ray of Frost, Sacred Flame, Toll the Dead, Acid Splash, Poison Spray, Chill Touch, Shocking Grasp, Eldritch Blast, Vicious Mockery, Mind Sliver, Thorn Whip, Produce Flame + Frostbite, Primal Savagery, Infestation, Lightning Lure) with damage dice, type, range, attack-roll vs save, and tags.
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

### Workstream 4: Vision/Audio Phase 3 — Targeting Enforcement (commit `c5e57a1`)
*Continued autonomously while user prepares doubt answers — Phase 3 is independent of the monster spellcasting doubts.*

Phase 3 enforces "creature you can see" rules via the detection map. Three subsystems now consume `perception.detection` (RFC-VISION-AUDIO §5):

- **Q3 — See Invisibility spell consumption** (`src/engine/perception.ts` + `src/spells/see_invisibility.ts`):
  - `isVisuallyDetected()` now checks `observer._seeInvisibilityActive`. When active + target invisible + within 60 ft + LOS exists → returns true. The spell's `_seeInvisibilityActive` flag (set since Session 48) is now consumed — was previously write-only. Metadata flag flipped to `implemented=true`.
- **Q1 — Planner target filtering** (`src/ai/targeting.ts` + `src/ai/planner.ts`):
  - New `targetableEnemiesOf()` helper in `perception.ts`: returns only enemies with detection state `'visible'` or `'position-known'` (skips `'hidden'`/`'unknown'`). All 4 `selectTarget` profiles (nearest/weakest/smart/rogue) now use it. The planner no longer targets enemies it can't perceive.
  - Fixed the early-return guard in `planTurn`: when enemies exist but none are targetable (all hidden/unknown), the planner falls through to bonus action planning (Cunning Action Hide, etc.) instead of returning empty. Preserves the Rogue-behind-fog Hide tactic.
- **Q2 — Opportunity attack visibility gating** (`src/engine/movement.ts`):
  - `opportunityAttackTriggered()` now accepts optional `bf` parameter. When `watcher.perception.detection` is populated, OA only fires if the mover's detection state is `'visible'`. `'position-known'` (heard, not seen), `'hidden'`, and `'unknown'` all suppress OA. Legacy fallback (no detection map) preserves the old blinded/invisible condition checks.
- **Tests**: 16 new Phase 3 assertions appended to `vision_audio.test.ts` (sections 22–25: See Invisibility consumption, See Invisibility vs truesight precedence, planner target filtering, OA visibility gating). `see_invisibility.test.ts` updated (metadata flag assertion flipped). All 116 vision_audio + 34 see_invisibility tests pass.
- **Phase 3 remaining (DEFERRED)**: Q4 (`attackAdvantageState` consults detection map — signature change, higher risk) and Q5 (per-spell `requiresVisibleTarget` metadata flag for "creature you can see" spell enforcement — invasive, 250+ spell modules).

### Workstream 5: Cantrip Template Expansion (commit `29f9688`)
*Continued autonomously — safe additive win that expands monster cantrip coverage.*

- **Extended `CANTRIP_TEMPLATES`** from 13 to **17 combat cantrips**:
  - **Frostbite** (XGE p.158): 60 ft, CON save, 1d6 cold + disadv on next weapon attack (rider not applied in v1). Tags: `[damage, cc]`.
  - **Primal Savagery** (XGE p.163): 5 ft (touch), melee spell attack, 1d10 acid. Tags: `[damage]`.
  - **Infestation** (XGE p.158): 30 ft, CON save, 1d6 poison + forced movement (rider not applied in v1). Tags: `[damage, cc]`.
  - **Lightning Lure** (SCAG p.143): 15 ft, STR save, 1d8 lightning + pull 10 ft (rider not applied in v1). Tags: `[damage, cc]`.
- **Tests**: 14 new assertions appended to `monster_spellcasting.test.ts` §1. All 108 monster_spellcasting tests pass.

---

## Current State

### Build Status
| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| All 108 monster_spellcasting tests | ✅ All pass |
| All 59 darkness tests | ✅ All pass |
| All 116 vision_audio tests (71 Phase 1 + 25 Phase 2 + 16 Phase 3 + 4 See Inv) | ✅ All pass |
| All 34 see_invisibility tests | ✅ All pass |
| All 43 fog_cloud tests | ✅ All pass |
| combat / ai / scenario / integration / engine | ✅ All pass |
| arms_of_hadar / darkvision (41) / invisible_effect (21) / cunning_action | ✅ All pass |
| resources / Bespoke spells (fireball, bless, entangle, sleep, etc.) | ✅ All pass |

### Commits this session (6 total, all pushed):
1. `e56d660` — Session 63: Implement Monster Spellcasting Phase 1 (RFC-MONSTER-SPELLCASTING)
2. `ef95ed3` — Session 63: Implement Darkness spell (PHB p.230) — magical darkness obscurement
3. `ab7d666` — Session 63: Implement Vision/Audio Phase 2 — vision modes consumed
4. `ca5275e` — Session 63 handover + archive zHANDOVER-SESSION-60 (AGENTS.md max-2 rule)
5. `c5e57a1` — Session 63: Implement Vision/Audio Phase 3 — targeting enforcement
6. `29f9688` — Session 63: Extend CANTRIP_TEMPLATES with 4 more combat cantrips

### Total new code this session:
- `src/ai/monster_spellcasting.ts` — 620 lines (new module)
- `src/spells/darkness.ts` — 295 lines (new spell)
- `src/test/monster_spellcasting.test.ts` — 600+ lines, 108 assertions (new tests)
- `src/test/darkness.test.ts` — 420 lines, 59 assertions (new tests)
- `src/test/vision_audio.test.ts` — +330 lines, +45 assertions (Phase 2 + Phase 3 additions: 116 total)
- Type changes in `core.ts` (monsterSpellSlots, monsterDailyUses, 'darkness' lightLevel, 'darkness' plan type, blocksDarkvision payload)
- Wiring in `perception.ts` (isVisuallyDetected Phase 2 + Phase 3 See Invisibility, targetableEnemiesOf), `planner.ts` (monster spellcasting + Darkness branches + target filtering guard), `combat.ts` (Darkness case branch + OA bf param), `movement.ts` (OA visibility gating), `targeting.ts` (targetableEnemiesOf), `see_invisibility.ts` (metadata flag + log messages)
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

### 3. Vision/Audio Phase 3 (PARTIALLY DONE — Q3+Q1+Q2 complete, Q4+Q5 deferred)
Phase 3 targeting enforcement is partially implemented this session:
- ✅ Q3: See Invisibility spell consumed by `isVisuallyDetected()`.
- ✅ Q1: Planner target filtering — `targetableEnemiesOf()` excludes hidden/unknown enemies.
- ✅ Q2: OA visibility gating — `opportunityAttackTriggered()` checks detection state.
- ❌ Q4 (DEFERRED): `attackAdvantageState()` consults detection map — needs signature change (higher risk, touches every resolveAttack caller). The 4-state model would map: 'visible' = no disadv; 'position-known' = disadv; 'hidden'/'unknown' = disadv.
- ❌ Q5 (DEFERRED): Per-spell `requiresVisibleTarget` metadata flag for "creature you can see" spell enforcement in `executePlannedAction` — invasive (250+ spell modules). v1 simplification: hardcode a Set of well-known "creature you can see" spells (Hold Person, Charm Person, Command, etc.).
- Files: `src/engine/utils.ts` (Q4), `src/engine/combat.ts` (Q5).

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

**User has reviewed the 6 doubts** (see RFC-MONSTER-SPELLCASTING.md §9.1 for refined decisions). Key directives:
- Monsters go ALL OUT (no resource conservation; always rested; fight to death).
- Implement pattern-bias AI (RFC-PATTERN-BIAS-AI.md) + combining-effects pipeline (RFC-COMBINING-EFFECTS.md).
- Unbuilt monster spells get priority in the task queue.

1. **Implement RFC-COMBINING-EFFECTS Phase 1** (same-name effect dedup) — MEDIUM-HIGH risk. Add `effectName` + `sourceId` to ActiveEffect; build the effect-identity registry; implement same-name dedup at turn start. This is the foundation for Darkness/Blindness overlap, two Spirit Guardians, etc.
2. **Implement RFC-PATTERN-BIAS-AI Phase 1** (pattern detectors) — MEDIUM risk. Add the 8 pattern detectors (enemyCluster, finisher, woundedAlly, acVsSave, concentrationPreservation, kiting, defensiveEscape, resourceAllOut) + wire into `computeSpellWeight()`. Priority: enemyCluster > finisher > woundedAlly.
3. **Implement Monster Spellcasting Phase 2** (slot-based spells) — MEDIUM-HIGH risk. Wire `initMonsterSpellSlots()` at combat start; extend `selectMonsterSpell()` to iterate `slots[1-9]` + dispatch via GENERIC_SPELLS. ~600 creatures. Pair with the pattern-bias system for spell selection.
4. **Implement Vision/Audio Phase 3 Q4** (`attackAdvantageState` detection-map consult) — MEDIUM risk. Extend `attackAdvantageState` in `src/engine/utils.ts` to derive disadv from detection state + cancel invisible-disadv when `_seeInvisibilityActive`.
5. **Implement Vision/Audio Phase 3 Q5** ("creature you can see" spell enforcement) — LOW-MEDIUM risk. Add a centralized guard in `executePlannedAction` using a hardcoded Set of well-known sight-required spells.
6. **Track + prioritize unbuilt monster spells** — build a script that scans all 945 monsters' `monsterSpellcasting` + reports which spell names aren't in GENERIC_SPELLS / CANTRIP_TEMPLATES, sorted by frequency. Use this to prioritize the next spell-implementation batch.
7. **Implement Wall of Fire** (L4, 29 monsters) — needs a line/ring zone subsystem (new effectType or extend `damage_zone`).
8. **Implement more spells** per `docs/SPELL-DELEGATION-SPEC.md`.

---

## Key Files for Next Agent to Read

- **`docs/RFC-MONSTER-SPELLCASTING.md`** — full RFC + §9.1 **user-confirmed decisions** (start here for Phase 2)
- **`docs/RFC-COMBINING-EFFECTS.md`** — NEW (Session 63): active-effects pipeline design (DMG p.252 same-name dedup, source tracking, takeover-on-expiry)
- **`docs/RFC-PATTERN-BIAS-AI.md`** — NEW (Session 63): pattern-bias spell-selection AI (8 detectors, composition formula, concentration churn prevention, monster all-out vs PC conservation)
- **`docs/RFC-VISION-AUDIO.md`** — vision/audio subsystem design (Phase 1-3 mostly done, Phase 3 Q4/Q5 + Phase 4 pending)
- **`docs/SPELL-DELEGATION-SPEC.md`** — spell implementation tasks + pattern
- **`src/ai/monster_spellcasting.ts`** — the monster spellcasting module (Phase 1 done with 17 cantrips; extend for Phase 2/3)
- **`src/engine/perception.ts`** — the perception subsystem (Phase 1-2 done, Phase 3 Q3 done; Q4/Q5 + Phase 4 pending)
- **`src/spells/darkness.ts`** — canonical example of a `battlefield_obstacle` spell with `blocksDarkvision` flag
- **`src/spells/fog_cloud.ts`** — canonical example of a `battlefield_obstacle` spell (normal obscurement)
- **`src/test/monster_spellcasting.test.ts`** — test patterns for monster spellcasting (108 assertions)
- **`src/test/vision_audio.test.ts`** — test patterns for perception (sections 1-15 = Phase 1, 16-21 = Phase 2, 22-25 = Phase 3)
- **`src/test/darkness.test.ts`** — test patterns for battlefield_obstacle spells
