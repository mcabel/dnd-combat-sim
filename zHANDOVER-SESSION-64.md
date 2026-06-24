# zHANDOVER — Session 64

**Date:** 2026-06-24
**Agent:** Z.ai (autonomous — continued from Session 63)
**Focus:** Implement RFC-COMBINING-EFFECTS Phase 1 — priority-activation pipeline (DMG p.252 "Combining Game Effects").

---

## Session Summary

This session implemented the **RFC-COMBINING-EFFECTS Phase 1** — the priority-activation active-effects pipeline. This was the #1 next-agent priority from the Session 63 handover, based on the user's detailed directive on combining game effects (DMG p.252 + PHB Ch.10 + XGE priority rules).

### Workstream: RFC-COMBINING-EFFECTS Phase 1 (commit `deb5462`)

**Core concept**: When 2+ active effects share an `effectName`, only the most potent applies (power > total duration > most recently activated). Per the user's clarification, this is **priority activation, not dedup** — both effects COEXIST in `activeEffects` with timers running; the loser gets `suppressed: true` (dormant, not deleted). When the active effect is removed, the suppressed one promotes to active.

**New modules:**
- **`src/engine/effect_identity.ts`** (110 lines): `EFFECT_IDENTITY_REGISTRY` maps spellName → canonical effectName (e.g. Blindness/Deafness + Darkness both → 'blinded'; Bless → 'bless'; Spirit Guardians → 'spirit-guardians'). `resolveEffectName()` fallback: obstacles use `obstacle:${id}`, damage zones include center coords, default is `${spellName}:${effectType}`. `resolveEffectNameFromDef()` convenience helper.
- **`src/engine/effect_pipeline.ts`** (175 lines): `reevaluateEffects(c, bf)` — groups by effectName, sorts by priority (power > total duration > most recently activated), marks top as `suppressed: false`, rest as `suppressed: true`. NO removal (only toggles suppressed). `compareByPriority()` + `comparePotency()` (per-effect-type: bless_die=dieSides, ac_bonus=acBonus, damage_zone=dieCount×dieSides, condition_apply=saveDC, weapon_enchant=bonus sum). `isActive()` helper.

**Type changes** (`src/types/core.ts`): added 5 optional fields to `ActiveEffect`:
- `effectName?` — canonical identity key for priority activation.
- `sourceId?` — originating source instance ID (for source-end removal).
- `sourceTurnExpires?` — turn number when the source expires (Phase 2).
- `appliedTurn?` — turn applied (XGE recency tiebreaker).
- `suppressed?` — true = dormant (a higher-priority same-name effect is active).

**Wiring:**
- `applySpellEffect()` (`src/engine/spell_effects.ts`): auto-populates `effectName` via `resolveEffectNameFromDef()` when absent + `appliedTurn` defaults to 0. Spell modules don't need updating in lock-step.
- All 6 read helpers (`getActiveBlessDie`, `getActiveBaneDie`, `getActiveAcBonus`, `getActiveAcFloor`, `getActiveDamageZones`, `getActiveWeaponEnchant`) now filter `isActive(e)` — suppressed effects don't apply.
- `removeEffectsFromCaster()` calls `reevaluateEffects(combatant, bf)` after removing effects — **immediate promotion** on concentration break (no 1-round gap).
- `runCombat` turn-start calls `reevaluateEffects(actor, battlefield)` right after `updateDetectionStates` — periodic refresh.

**Tests** (`src/test/combining_effects.test.ts`): 63 assertions across 14 sections. All pass. Covers: effect identity registry, auto-population, two Bless coexist + only active applies, takeover on concentration break, priority order (power > duration > recency), different-name stack (Bless + Bane), Magic Weapon ×2, Spirit Guardians ×2 (potency by damage dice), duration tiebreak, recency tiebreak, isActive + compareByPriority helpers, end-to-end combat, backward-compat single-caster, three same-name effects with cascading takeover.

---

## Current State

### Build Status
| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| All 63 combining_effects tests | ✅ All pass |
| All 122 vision_audio tests | ✅ All pass |
| All 108 monster_spellcasting tests | ✅ All pass |
| All 59 darkness tests | ✅ All pass |
| combat / ai / scenario / integration / engine / spell_effects | ✅ All pass |
| bless / bane / magic_weapon / spirit_guardians / cloud_of_daggers / moonbeam / hex | ✅ All pass |
| see_invisibility / more_eldritch_invocations / concentration_enforcement | ✅ All pass |

### Commits this session (1, pushed):
1. `deb5462` — Session 64: Implement RFC-COMBINING-EFFECTS Phase 1 — priority activation

---

## Remaining work (RFC-COMBINING-EFFECTS):

### Phase 2 — Non-Concentration Source Tracking (MEDIUM risk)
- Spell modules that apply non-concentration effects with finite duration (Blindness/Deafness 1 min, Hex 1 hr, etc.) set `sourceTurnExpires` on the effect.
- `reevaluateEffects` needs an expiry step (filter out effects where `round > sourceTurnExpires` + call `_undoEffect` for structural cleanup).
- **Covers**: Blindness/Deafness expires after 10 rounds; Hex expires after 600 rounds.

### Phase 3 — Takeover-on-Expiry Tests (LOW risk)
- Already implemented in Phase 1's `reevaluateEffects` (re-sort promotes the next effect). Phase 3 adds explicit tests: cast Blindness/Deafness (round 1, expires round 10), cast a 2nd Blindness/Deafness (round 5, expires round 14); when the first expires, the second takes over.
- Depends on Phase 2 (sourceTurnExpires population).

### Phase 4 — Conditions Derived from Pipeline (HIGH risk — biggest blast radius)
- `applySpellEffect` for `condition_apply` no longer calls `target.conditions.add(...)` directly. The Set is rebuilt each turn by `_rederiveConditions`.
- Fixes the pre-existing bug: two `blinded` from different sources → Darkness ends → `blinded` wrongly removed even though Blindness/Deafness is still active.
- Spell modules stop calling `addCondition()` for spell-sourced conditions.
- Non-spell sources (monster traits, class features) keep calling `addCondition()` directly.

---

## Other remaining work (from Session 63 handover):

### RFC-PATTERN-BIAS-AI Phase 1 (MEDIUM risk)
- Add the 8 pattern detectors (enemyCluster, finisher, woundedAlly, acVsSave, concentrationPreservation, kiting, defensiveEscape, resourceAllOut) + wire into `computeSpellWeight()`.
- Priority: enemyCluster > finisher > woundedAlly.

### Monster Spellcasting Phase 2 (MEDIUM-HIGH risk)
- Wire `initMonsterSpellSlots()` at combat start; extend `selectMonsterSpell()` to iterate `slots[1-9]` + dispatch via GENERIC_SPELLS. ~600 creatures.

### Vision/Audio Phase 3 Q4/Q5 (MEDIUM / LOW-MEDIUM risk)
- Q4: `attackAdvantageState` consults detection map.
- Q5: "creature you can see" spell enforcement via hardcoded Set.

### Track + prioritize unbuilt monster spells
- Build a script that scans all 945 monsters' `monsterSpellcasting` + reports unbuilt spell names sorted by frequency.

### More spells (Wall of Fire, etc.)
- Per `docs/SPELL-DELEGATION-SPEC.md`.

---

## Next Agent Priorities

1. **RFC-COMBINING-EFFECTS Phase 2** (sourceTurnExpires expiry) — MEDIUM risk. Add the expiry step to `reevaluateEffects` + populate `sourceTurnExpires` on non-concentration spell modules (Blindness/Deafness, Hex, etc.).
2. **RFC-PATTERN-BIAS-AI Phase 1** (pattern detectors) — MEDIUM risk. Add the 8 pattern detectors + wire into `computeSpellWeight()`.
3. **Monster Spellcasting Phase 2** (slot-based spells) — MEDIUM-HIGH risk. Pair with the pattern-bias system.
4. **Vision/Audio Phase 3 Q4/Q5** — MEDIUM / LOW-MEDIUM risk.
5. **Track + prioritize unbuilt monster spells** — LOW risk, high value.
6. **Wall of Fire + more spells** — per SPELL-DELEGATION-SPEC.

---

## Key Files for Next Agent to Read

- **`docs/RFC-COMBINING-EFFECTS.md`** — full RFC (Phase 1 done, Phase 2-4 pending). Start here.
- **`docs/RFC-PATTERN-BIAS-AI.md`** — pattern-bias AI design (8 detectors, composition formula).
- **`docs/RFC-MONSTER-SPELLCASTING.md`** — monster spellcasting RFC + §9.1 user-confirmed decisions.
- **`docs/RFC-VISION-AUDIO.md`** — vision/audio subsystem (Phase 1-3 mostly done, Q4/Q5 + Phase 4 pending).
- **`src/engine/effect_identity.ts`** — effect identity registry (extend as spell modules are wired).
- **`src/engine/effect_pipeline.ts`** — priority-activation pipeline (extend for Phase 2 expiry).
- **`src/engine/spell_effects.ts`** — applySpellEffect + read helpers (all filter `isActive` now).
- **`src/test/combining_effects.test.ts`** — test patterns for priority activation.
- **`src/ai/monster_spellcasting.ts`** — monster spellcasting module (Phase 1 done with 17 cantrips; extend for Phase 2).
- **`src/engine/perception.ts`** — perception subsystem (Phase 1-3 Q3 done; Q4/Q5 + Phase 4 pending).
