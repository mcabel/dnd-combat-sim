# zHANDOVER — Session 72

**Date:** 2026-06-25
**Agent:** Z.ai (autonomous — continued from Session 71)
**Focus:** Implement the complete RFC-UPCASTING (6 phases), fixing structural gaps in spell slot level tracking, upcast damage scaling, Globe of Invulnerability, AI penetration-motivated upcasting, and cantrip caster-level damage scaling.

---

## Session Summary

This session implemented **all 6 phases of RFC-UPCASTING**, the highest-priority structural RFC in the backlog. The RFC addressed 6 gaps (GAP-1 through GAP-6) that collectively meant: Counterspell always saw bespoke spells as level 1, Dispel Magic used a flat DC-13 approximation, Globe of Invulnerability was a no-op stub, 19 bespoke damage/healing spells ignored upcast scaling, the AI had no concept of penetration-motivated upcasting, and cantrips always used base-level damage regardless of caster level.

**All 6 gaps are now closed.** The complete RFC-UPCASTING implementation includes:

- **Phase 1:** `castSlotLevel?: number` added to `PlannedAction`; `getSpellInfoFromPlan()` now uses `plan.castSlotLevel ?? plan.action?.slotLevel ?? 1`; `getLowestAvailableSlot()` helper added to `resources.ts`
- **Phase 2:** `sourceSlotLevel?: number` added to `ActiveEffect`; Dispel Magic now uses `10 + sourceSlotLevel` for accurate DC (PHB p.233) instead of flat DC-13
- **Phase 3:** Upcast damage/healing scaling for **19 bespoke spells** (fireball, lightning_bolt, shatter, thunderwave, dissonant_whispers, inflict_wounds, guiding_bolt, burning_hands, scorching_ray, magic_missile, sleep, aid, blindness_deafness, cure_wounds, healing_word, spiritual_weapon, hunger_of_hadar, mind_spike, sunburst)
- **Phase 4:** Globe of Invulnerability real implementation — `spell_shield` effect type, `isProtectedByGoI()` helper, GoI blocking check in combat.ts pre-dispatch
- **Phase 5:** AI penetration-motivated upcasting — `selectCastSlot()` helper in planner.ts, 15 spell planner branches updated to use penetration-aware slot selection
- **Phase 6:** Cantrip caster-level damage scaling — `cantripTier()` helper in utils.ts, resolveAttack() scales cantrip dice at PHB breakpoints (5/11/17), module-specific scaling for 6 AoE cantrips

**Test delta:** 77 new tests in 1 new test suite (`session72_upcasting_system.test.ts`), 0 failures. All 12 critical existing test suites pass.

**tsc error delta:** 3 → 3 (unchanged — the 3 pre-existing `Record<string,unknown>` casts are unrelated to upcasting work).

---

## What was done

### Phase 1 (commit `dd46b16`) — Structural: castSlotLevel + getSpellInfoFromPlan + getLowestAvailableSlot

1. **Added `castSlotLevel?: number` to `PlannedAction`** (`src/types/core.ts`):
   - Stores the actual spell slot level spent for this spell cast
   - 0 or undefined = cantrip (no slot consumed, interaction level = 0)
   - Set by planner branches at plan-construction time
   - Used by getSpellInfoFromPlan(), GoI blocking check, and future interactions

2. **Fixed `getSpellInfoFromPlan()`** (`src/engine/combat.ts`):
   - Changed from `return { name, level: 1 }` (always defaulting to level 1) to `return { name, level: plan.castSlotLevel ?? plan.action?.slotLevel ?? 1 }`
   - This fixes Counterspell seeing bespoke spells as level 1 regardless of actual slot used

3. **Added `getLowestAvailableSlot(caster, minLevel)`** (`src/ai/resources.ts`):
   - Non-consuming slot query for planning purposes
   - Returns the lowest available slot level at or above `minLevel`, or null
   - Handles both standard slots and Warlock pact slots

### Phase 2 (commit `dd46b16` + `38de89d`) — Structural: sourceSlotLevel + Dispel Magic accurate DC

1. **Added `sourceSlotLevel?: number` to `ActiveEffect`** (`src/types/core.ts`):
   - 0 = cantrip; undefined = legacy (treat as 0)
   - Used by Dispel Magic (DC = 10 + sourceSlotLevel) and Globe of Invulnerability

2. **Updated Dispel Magic** (`src/spells/dispel_magic.ts`):
   - **Auto-dispel:** If `dispelSlotLevel >= effect.sourceSlotLevel`, auto-dispel (PHB p.233)
   - **Ability check DC:** `10 + sourceSlotLevel` when sourceSlotLevel is known, legacy flat DC-13 when undefined
   - Flipped `dispelMagicSpellLevelTrackingV1Implemented: false → true`

### Phase 3 (commit `59a819b`) — Upcast Damage/Healing Scaling for 19 Bespoke Spells

Each spell's `execute()` now captures the `consumeSpellSlot()` return value and uses it for damage scaling. Each spell's planner branch now sets `castSlotLevel` on the returned `PlannedAction`.

| Spell | Base Level | Upcast Formula | Metadata Flag |
|-------|-----------|----------------|---------------|
| Fireball | 3 | `8 + max(0, slot-3)` d6 fire | `fireballUpcastV1Implemented: true` |
| Lightning Bolt | 3 | `8 + max(0, slot-3)` d6 lightning | `lightningBoltUpcastV1Implemented: true` |
| Shatter | 2 | `3 + max(0, slot-2)` d8 thunder | `shatterUpcastV1Implemented: true` |
| Thunderwave | 1 | `2 + max(0, slot-1)` d8 thunder | `thunderwaveUpcastV1Implemented: true` |
| Dissonant Whispers | 1 | `3 + max(0, slot-1)` d6 psychic | `dissonantWhispersUpcastV1Implemented: true` |
| Inflict Wounds | 1 | `3 + max(0, slot-1)` d10 necrotic | `inflictWoundsUpcastV1Implemented: true` |
| Guiding Bolt | 1 | `4 + max(0, slot-1)` d6 radiant | `guidingBoltUpcastV1Implemented: true` |
| Burning Hands | 1 | `3 + max(0, slot-1)` d6 fire | `burningHandsUpcastV1Implemented: true` |
| Scorching Ray | 2 | `3 + max(0, slot-2)` rays | `scorchingRayUpcastV1Implemented: true` |
| Magic Missile | 1 | `3 + max(0, slot-1)` darts | `magicMissileUpcastV1Implemented: true` |
| Sleep | 1 | `5 + 2*max(0, slot-1)` d8 pool | `sleepUpcastV1Implemented: true` |
| Aid | 2 | `5 * (1 + max(0, slot-2))` HP | `aidUpcastV1Implemented: true` |
| Blindness/Deafness | 2 | `1 + max(0, slot-2)` targets | `blindnessDeafnessUpcastV1Implemented: true` |
| Cure Wounds | 1 | `1 + max(0, slot-1)` d8 heal | `cureWoundsUpcastV1Implemented: true` |
| Healing Word | 1 | `1 + max(0, slot-1)` d4 heal | `healingWordUpcastV1Implemented: true` |
| Spiritual Weapon | 2 | `1 + floor(max(0, slot-2)/2)` d8 | `spiritualWeaponUpcastV1Implemented: true` |
| Hunger of Hadar | 3 | `2 + max(0, slot-3)` d6 each | `hungerOfHadarUpcastV1Implemented: true` |
| Mind Spike | 2 | `3 + max(0, slot-2)` d8 psychic | `mindSpikeUpcastV1Implemented: true` |
| Sunburst | 8 | `12 + 2*max(0, slot-8)` d6 radiant | `sunburstUpcastV1Implemented: true` |

Also updated `spellHealPlan()` in `resources.ts` for upcast healing dice.

### Phase 4 (commit `09c712d`) — Globe of Invulnerability Real Implementation

1. **Added `spell_shield` to `SpellEffectType`** and `blockThreshold` to `ActiveEffect.payload`
2. **Replaced GoI forward-compat stub** with real implementation:
   - `blockThreshold = 5 + max(0, slotLevel - 6)` (L6→5, L7→6, L8→7, L9→8)
   - Applies as ActiveEffect with `effectType: 'spell_shield'`
   - `shouldCast()` checks for existing `spell_shield` effect (dedup)
3. **Added `isProtectedByGoI(target, castLevel)`** helper in `spell_effects.ts`
4. **Added GoI blocking check** in `combat.ts` before spell execution:
   - Blocks leveled spells (level > 0) targeting GoI-protected creatures
   - Cantrips (level 0) never blocked
   - Self-cast spells exempted
   - Slot consumed, action marked used on block (PHB p.245)
   - v1: single-target blocking only; AoE exclusion deferred (`globeOfInvulnerabilityAoEV1Simplified: true`)

### Phase 5 (commit `09c712d`) — AI Penetration-Motivated Upcasting

1. **Added `selectCastSlot(caster, baseLevel, target)`** in `planner.ts`:
   - Inspects target's `spell_shield` effects for minimum penetration slot
   - Returns `null` if penetration impossible (blockThreshold ≥ 9)
   - Returns `getLowestAvailableSlot(caster, minSlot)` otherwise
2. **Updated 15 spell planner branches** to use `selectCastSlot` instead of `getLowestAvailableSlot`:
   - fireball, lightning_bolt, thunderwave, burning_hands, dissonant_whispers, guiding_bolt, magic_missile, blindness_deafness, scorching_ray, shatter, inflict_wounds, sunburst, mind_spike, hunger_of_hadar, fireball surge

### Phase 6 (commit `09c712d`) — Cantrip Caster-Level Damage Scaling

1. **Added `cantripTier(caster)` helper** in `utils.ts`:
   - PHB breakpoints: level 5→tier 1, 11→tier 2, 17→tier 3
   - Uses `caster.casterLevel ?? caster.level ?? 1` for PCs
   - Uses `caster.monsterSpellcasting?.spellcasterLevel` for monsters
2. **resolveAttack() integration** (`combat.ts`):
   - All three damage-rolling paths (save-based, auto-hit, attack-roll) now check `action.slotLevel === 0` and override `damage.count` to `1 + cantripTier(attacker)`
   - Covers 19+ cantrips that ride the resolveAttack pipeline
3. **Module-specific scaling** for AoE cantrips:
   - Thunderclap, Sword Burst, Word of Radiance: `1 + cantripTier(caster)`
   - Create Bonfire: both on-cast and persistent damage scale
   - Booming Blade: movement-triggered rider dice scale dynamically
   - Green-Flame Blade: splash damage scales with `cantripTier()`
4. **Monster cantrip integration**: `cantripDiceCount()` in `monster_spellcasting.ts` now delegates to `cantripTier()`

### Test file (commit `7dbd87a`) — session72_upcasting_system.test.ts

**77 tests, 0 failures** covering:
- Phase 1: castSlotLevel resolution chain (5 tests) + getLowestAvailableSlot (11 tests)
- Phase 3: Upcast damage scaling (19 tests) — fireball, cure_wounds, magic_missile
- Phase 4: Globe of Invulnerability (18 tests) — blocking, penetration, cantrip exemption, upcast
- Phase 5: selectCastSlot (6 tests) — base level, penetration, impossible cases
- Phase 6: cantripTier (14 tests) — tiers 0-3, boundaries, monster scenarios

---

## Commits this session (5, all pushed)

1. `dd46b16` — RFC-UPCASTING Phase 1+2: add castSlotLevel to PlannedAction, sourceSlotLevel to ActiveEffect, getLowestAvailableSlot helper, fix getSpellInfoFromPlan
2. `59a819b` — RFC-UPCASTING Phase 3: upcast damage/healing scaling for 19 bespoke spells + planner castSlotLevel
3. `09c712d` — RFC-UPCASTING Phase 4+5+6: Globe of Invulnerability, selectCastSlot, cantrip scaling
4. `7dbd87a` — RFC-UPCASTING: session72 upcasting system test (77 tests, 0 failures)
5. `38de89d` — RFC-UPCASTING Phase 2 follow-up: Dispel Magic accurate DC using sourceSlotLevel

**Latest commit `38de89d`.**

---

## Current State of Major RFCs

### RFC-UPCASTING — ALL 6 PHASES DONE ✅ (this session)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: castSlotLevel on PlannedAction | ✅ DONE | Structural enabler for Counterspell accuracy |
| Phase 2: sourceSlotLevel on ActiveEffect | ✅ DONE | Dispel Magic accurate DC (10 + sourceSlotLevel) |
| Phase 3: Upcast damage scaling (19 spells) | ✅ DONE | All PHB/XGE "At Higher Levels" entries modelled |
| Phase 4: Globe of Invulnerability | ✅ DONE | Real implementation with spell_shield effect |
| Phase 5: AI penetration upcasting | ✅ DONE | selectCastSlot in planner, 15 branches updated |
| Phase 6: Cantrip caster-level scaling | ✅ DONE | cantripTier() helper, resolveAttack integration |

### RFC-COMBINING-EFFECTS — Phase 1-4 ALL DONE ✅ (unchanged)

### RFC-VISION-AUDIO — Phase 1-3 ALL DONE ✅, Phase 4 PARTIALLY DONE (unchanged)

### RFC-PATTERN-BIAS-AI — Phase 1 DONE ✅, Phase 2 NOT STARTED (unchanged)

### RFC-MONSTER-SPELLCASTING — Phase 1 DONE, Phase 2 ✅ COMPLETE, Phase 3 NOT STARTED (unchanged)

---

## Build Status

| Check | Status |
|-------|--------|
| `session72_upcasting_system.test.ts` (77 tests) | ✅ All pass |
| `combat.test.ts` (49 tests) | ✅ All pass |
| `monster_spellcasting.test.ts` (113 tests) | ✅ All pass |
| `bulk_spell_dispatch.test.ts` (214 tests) | ✅ All pass |
| `session71_deferred_stubs.test.ts` (142 tests) | ✅ All pass |
| `dispel_magic.test.ts` (47 tests) | ✅ All pass |
| `ai.test.ts` (26 tests) | ✅ All pass |
| `cantrip_pipeline.test.ts` (67 tests) | ✅ All pass |
| `cantrip_planner.test.ts` (46 tests) | ✅ All pass |
| `spell_actions.test.ts` (54 tests) | ✅ All pass |
| `out_of_combat_spells.test.ts` (66 tests) | ✅ All pass |
| `mechanics.test.ts` (57 tests) | ✅ All pass |
| `tsc --noEmit` | ✅ 3 errors (pre-existing `Record<string,unknown>` casts — unchanged) |

---

## Key Architectural Decisions This Session

### castSlotLevel vs action.slotLevel on PlannedAction

`castSlotLevel` is the slot level **consumed** (may be higher than base for upcast). `action.slotLevel` is the spell's **base** level. The two are distinct:
- `castSlotLevel = 5` + `action.slotLevel = 3` → Fireball cast at L5 (upcast from L3)
- `castSlotLevel = undefined` → cantrip or legacy plan (treat as level 0/1)

### sourceSlotLevel on ActiveEffect

`sourceSlotLevel` tracks the slot level at which the spell that created this effect was cast. This is distinct from the spell's base level:
- Bless cast at L1 → `sourceSlotLevel: 1`, DC for Dispel = 11
- Bless cast at L3 → `sourceSlotLevel: 3`, DC for Dispel = 13
- Legacy effects (pre-Session 72) have `sourceSlotLevel: undefined` → treat as DC 13 (backward compat)

### Globe of Invulnerability v1 scope

- **Single-target blocking only:** When a leveled spell targets a GoI-protected creature, it's blocked entirely
- **AoE exclusion deferred:** For AoE spells like Fireball, the v1 implementation does NOT exclude individual GoI-protected targets from the damage list. This is documented via `globeOfInvulnerabilityAoEV1Simplified: true`
- **Radius deferred:** GoI's 10-ft radius protection for allies is not modelled in v1. Only the GoI caster is protected. Documented via the radius simplification flag.

### Cantrip scaling via resolveAttack

Rather than modifying each of the 19+ cantrip modules individually, cantrip scaling is implemented at the `resolveAttack()` level in `combat.ts`. When `action.slotLevel === 0` (cantrip), `damage.count` is overridden to `1 + cantripTier(attacker)`. This covers all cantrips that ride the resolveAttack pipeline in one change.

### Eldritch Blast v1 simplification

Eldritch Blast multi-beam (2/3/4 beams at levels 5/11/17, each an independent attack roll) is deferred. v1 treats it as scaled damage dice like other cantrips. Documented via `eldritchBlastMultiBeamV1Deferred: true`.

---

## Remaining Work (Priority Order)

### 1. RFC-MONSTER-SPELLCASTING Phase 3: Daily-use abilities (Recharge, Lair Actions) — MEDIUM-HIGH risk

Phase 2 is 100% complete. The next phase is Phase 3: daily-use abilities. Many high-CR monsters have:
- **Recharge abilities** (e.g. Dragon Breath: "Recharge 5-6")
- **Lair Actions** (e.g. Adult Red Dragon: "On initiative count 20")
- **Legendary Actions** (partially implemented via `legendaryActions` field)

### 2. Ready Action Implementation (MEDIUM-HIGH risk) — unchanged

Currently a STUB in `combat.ts` — the `case 'ready':` falls through.

### 3. RFC-COMBINING-EFFECTS Phase 2 Remaining (MEDIUM risk) — unchanged

Some non-concentration spell modules still need `sourceTurnExpires` populated.

### 4. RFC-VISION-AUDIO Phase 4 (DEFERRED — HIGH risk) — unchanged

Per-cell light sources, fog cloud / Darkness spell as mobile obscurement zones.

### 5. Creature Megabatch Batches 4d/4e (Creature workstream) — unchanged

### 6. Real implementations for the 7 deferred combat stubs (MEDIUM-HIGH risk) — unchanged from Session 71

| Spell | Subsystem needed | Risk |
|-------|------------------|------|
| Protection from Evil and Good (27 creatures) | advantage-vs-creature-type | MEDIUM |
| Dispel Evil and Good (15 creatures) | advantage-vs-creature-type + enchantment-removal | MEDIUM |
| Wind Wall (3 creatures) | wall/zone + ranged-weapon-miss | MEDIUM |
| Wall of Thorns (2 creatures) | wall/zone + damage-on-enter | MEDIUM |
| Prismatic Wall (2 creatures) | 7-layer wall | HIGH |
| Thunder Step (1 creature) | teleport + AoE-damage | LOW-MEDIUM |
| Shapechange SPELL (1 creature) | full stat replacement | HIGH |

### 7. GoI v1 follow-ups (LOW risk) — NEW this session

- **AoE exclusion:** When Fireball hits multiple targets, GoI-protected targets should be excluded from damage but others still take damage
- **10-ft radius:** Allies within 10 ft of the GoI caster should also be protected
- **Eldritch Blast multi-beam:** Full independent attack roll per beam

---

## Key Files for Next Agent

### New this session

**Structural changes:**
- `src/types/core.ts` — `castSlotLevel?: number` on `PlannedAction`; `sourceSlotLevel?: number` on `ActiveEffect`; `'spell_shield'` on `SpellEffectType`; `blockThreshold?: number` on `ActiveEffect.payload`
- `src/ai/resources.ts` — `getLowestAvailableSlot(caster, minLevel)` helper
- `src/engine/combat.ts` — `getSpellInfoFromPlan()` uses `castSlotLevel`; GoI blocking check pre-dispatch; cantrip scaling in `resolveAttack()`
- `src/engine/spell_effects.ts` — `isProtectedByGoI(target, castLevel)` helper; `spell_shield` effect type handling
- `src/engine/utils.ts` — `cantripTier(caster)` helper

**Modified spell modules (19 upcast + 6 cantrip + 1 GoI + 1 Dispel):**
- `src/spells/fireball.ts`, `lightning_bolt.ts`, `shatter.ts`, `thunderwave.ts`
- `src/spells/dissonant_whispers.ts`, `inflict_wounds.ts`, `guiding_bolt.ts`, `burning_hands.ts`
- `src/spells/scorching_ray.ts`, `magic_missile.ts`, `sleep.ts`, `aid.ts`, `blindness_deafness.ts`
- `src/spells/cure_wounds.ts`, `healing_word.ts`, `spiritual_weapon.ts`
- `src/spells/hunger_of_hadar.ts`, `mind_spike.ts`, `sunburst.ts`
- `src/spells/globe_of_invulnerability.ts` (full replacement)
- `src/spells/dispel_magic.ts` (accurate DC)
- `src/spells/booming_blade.ts`, `create_bonfire.ts`, `green_flame_blade.ts`, `sword_burst.ts`, `thunderclap.ts`, `word_of_radiance.ts`

**Planner changes:**
- `src/ai/planner.ts` — `selectCastSlot()` helper; 15 spell branches updated; `getLowestAvailableSlot` import

**Monster spellcasting:**
- `src/ai/monster_spellcasting.ts` — `cantripDiceCount()` delegates to `cantripTier()`

**Test files:**
- `src/test/session72_upcasting_system.test.ts` — 77 tests
- `src/test/dispel_magic.test.ts` — 47 tests (1 assertion updated)
- Various spell test files updated for metadata flag changes

### RFCs (updated)
- `docs/RFC-UPCASTING.md` — **ALL 6 PHASES IMPLEMENTED** (status should be updated to COMPLETE)

---

## Uncommitted Changes

None — all substantive work is committed and pushed. The working tree is clean.

---

## Verification Snapshot

- `git log --oneline -5` shows: `38de89d`, `7dbd87a`, `09c712d`, `59a819b`, `dd46b16`
- `git status` → clean working tree
- `tsc --noEmit 2>&1 | grep "error TS" | wc -l` → **3** (pre-existing, unchanged)
- All 12 critical test files pass locally with 0 failures
- **zHANDOVER-SESSION-72.md** committed and uploaded to `/home/z/my-project/upload/zHANDOVER-SESSION-72.md`

---

## Coverage Achievement Summary

This session completed the **entire RFC-UPCASTING** implementation (6 phases), addressing 6 structural gaps that affected Counterspell accuracy, Dispel Magic DCs, Globe of Invulnerability functionality, 19 spell damage scaling formulas, AI penetration logic, and cantrip damage scaling. The RFC is now **COMPLETE** — all gaps closed, all tests passing.

The monster-spell coverage workstream (RFC-MONSTER-SPELLCASTING) remains at **100.0% coverage** (363/363 unique spells, from Session 71). The next major workstream is Phase 3 (daily-use abilities: Recharge, Lair Actions).
