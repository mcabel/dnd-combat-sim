# zHANDOVER — Session 54

**Date:** 2026-06-23
**Agent:** Z.ai (Core Engine workstream — TG-027)
**Focus:** Execute TG-027 — wire `elementalAffinityBonus` into the 3 weapon-rider damage sites in `combat.ts` that were missed by Sessions 47-51 (which wired EA into the main spell paths + ~25 bespoke spell execute() functions). This closes the Core Engine half of TG-015.

---

## Session Summary

Session 54 picked up where Session 53 left off. The uploaded `zHANDOVER-SESSION-53.md` was a mid-session draft — the repo on `main` had already advanced past it (Batches 4f/4g/4h were committed after the handover was written, per the git log). The Creature Megabatch Batches 0-4h are ALL complete; Batch 5 (Lair/Spellcasting/Shapechanger) remains DEFERRED.

Per `TASK.md` Core Engine "Immediate Priority" list (reverse published order, newest pre-2024 first), the next Tier-A LOW-risk task was **TG-027** (XGE/PHB 2017/2014): wire `elementalAffinityBonus` into the 3 weapon-rider damage sites in `combat.ts`.

This session:

1. **Diagnosed the gap.** Sessions 47-51 wired `elementalAffinityBonus(attacker, action.damageType)` into the main spell-attack path (`combat.ts:1796`), the save-spell path, the auto-hit path, and ~25 bespoke spell `execute()` functions. But THREE weapon-rider damage sites — which add bonus spell damage of a type on top of a weapon attack — did NOT call it:
   - **Site 1:** `_nextHitRider` consume (~line 1906) — Searing Smite (fire), Lightning Arrow (lightning), Blinding Smite (radiant), Thunderous Smite (thunder), etc.
   - **Site 2:** `weapon_enchant` damage DICE (~line 2028) — Elemental Weapon (fire), Flame Arrows (fire), Holy Weapon (radiant), Divine Favor (radiant), Shadow Blade (psychic).
   - **Site 3:** Flame Blade rider (~line 2053) — +3d6 fire on melee weapon attacks.

   A Draconic Sorcerer 6 with red ancestry got +CHA to fireball damage but NOT to the fire rider on their Flame Blade / Searing Smite / Elemental Weapon — an inconsistency.

2. **Implemented the fix.** At each of the 3 sites, after the rider's bonus damage is rolled and added to `dmg`, call `elementalAffinityBonus(attacker, <rider damage type>)`. If the result > 0, add it to `dmg` and emit a dedicated log event naming the source (e.g. "adds Elemental Affinity bonus (+3 fire) to Flame Blade rider!"). The bonus is flat — NOT doubled on crit (PHB p.196 only doubles damage dice, not flat modifiers). This mirrors the existing wiring pattern at line 1796-1802.

3. **Wrote 33 test assertions** in a new file `src/test/elemental_affinity_weapon_riders.test.ts` covering all 3 sites × {match, no-match, non-Sorcerer, crit-flatness} + 4 cross-cutting assertions (CHA-mod value, CHA-20 value, no-ancestry, all-3-fire-on-same-hit).

4. **Ran regression sweep.** All 22 directly-affected test files pass (5 elemental_affinity suites + 16 rider/smite/weapon tests). All 6 core engine suites pass (combat, engine, mechanics, phase4, integration, scenario). `tsc --noEmit` clean (0 errors excluding the tolerated TS7006 implicit-any noise).

**Total this session:** ~70 lines of new code in `combat.ts` (3 sites × ~10 lines each, including comments), 1 new test file (33 assertions), 2 doc files updated (TEAMGOALS, TASK), 1 handover, 2 handovers archived.

---

## Architecture

### The 3 weapon-rider damage sites

All 3 sites live inside the `if (action.damage)` block of `resolveAttack()` in `src/engine/combat.ts`, AFTER the main `eaBonus = elementalAffinityBonus(attacker, action.damageType)` call at line ~1796. The main `eaBonus` applies to the weapon's own damage type (e.g. slashing) — which never matches a draconic ancestry, so it returns 0 for weapon attacks. The 3 rider sites add bonus damage of a DIFFERENT type (fire/lightning/radiant/etc.), which CAN match the ancestry — that's why they need their own EA call.

**Why EA applies to weapon riders at all:** Elemental Affinity (PHB p.102) triggers on "When you cast a spell that deals damage of the type associated with your draconic ancestry." The riders are all spell-sourced bonus damage:
- Searing Smite / Lightning Arrow / Blinding Smite etc. are spells (`_nextHitRider` is set by the smite's `execute()`).
- Elemental Weapon / Flame Arrows / Holy Weapon / Divine Favor / Shadow Blade are spells (`weapon_enchant` ActiveEffect applied by the spell's `execute()`).
- Flame Blade is a spell (`_flameBladeActive` set by Flame Blade's `execute()`).

The bonus damage IS spell damage of a type, so EA applies.

### Implementation pattern (identical at all 3 sites)

```ts
// ... existing rider dice roll + dmg += riderBonus + log ...

// ── TG-027: Elemental Affinity (Draconic Sorcerer 6) on <rider source>.
// <source> IS a spell whose bonus damage IS spell damage of a type. +CHA mod
// is flat (NOT doubled on crit per PHB p.196).
const <x>EA = elementalAffinityBonus(attacker, <rider damage type>);
if (<x>EA > 0) {
  dmg += <x>EA;
  log(state, 'action', attacker.id,
    `${attacker.name} adds Elemental Affinity bonus (+${<x>EA} <type>) to <source>!`, target.id, <x>EA);
}
```

The 3 sites use `rider.damageType`, `weaponEnchant.damageDieType`, and the literal `'fire'` respectively as the damage-type argument.

### Crit-flatness

PHB p.196: crit doubles "damage dice", not flat modifiers. The EA bonus is a flat CHA mod, so it must NOT double on crit. The existing main-path wiring (line 1796) already follows this — `eaBonus` is added once regardless of `isCrit`. The 3 new sites follow the same pattern. Test assertions 1d/2d/3d verify: on a forced crit (`isCritOverride=true`), the EA log value is still 3 (CHA 17 mod), not 6.

### No double-counting with the main-path EA

The main-path `eaBonus` at line 1796 uses `action.damageType` (the weapon's type, e.g. slashing). Since draconic ancestries are only acid/cold/fire/lightning/poison, a slashing weapon attack's `eaBonus` is always 0. The 3 rider sites use the RIDER's damage type. So there's no scenario where the same damage gets EA twice. Test 4d confirms all 3 riders can fire EA on the same hit (each site is independent) without interference.

---

## Files Changed (Session 54)

### New files (2)
- `src/test/elemental_affinity_weapon_riders.test.ts` — TG-027 tests (33 assertions)
- `zHANDOVER-SESSION-54.md` — this file

### Modified files (3)
- `src/engine/combat.ts` — `elementalAffinityBonus` wired into 3 weapon-rider damage sites:
  - Site 1 `_nextHitRider` (~line 1917): EA on `rider.damageType` (Searing Smite / Lightning Arrow / smites)
  - Site 2 `weapon_enchant` dice (~line 2035): EA on `weaponEnchant.damageDieType` (Elemental Weapon / Flame Arrows / Holy Weapon / Divine Favor / Shadow Blade)
  - Site 3 Flame Blade (~line 2063): EA on literal `'fire'`
- `TEAMGOALS.md` — TG-027 status `OPEN` → `DONE — Session 54`
- `TASK.md` — Core Engine Active Objective refreshed (Session 53 → Session 54); TG-027 marked DONE; Immediate Priority list re-ordered (TG-024 promoted to #1, TG-027 removed)

### Moved files (2)
- `zHANDOVER-SESSION-50.md` → `HandoverOld/zHANDOVER-SESSION-50.md` (per AGENTS.md "max 2 of each handover type in root" rule)
- `zHANDOVER-SESSION-52.md` → `HandoverOld/zHANDOVER-SESSION-52.md` (same rule — root now has only 53 + 54)

---

## Build Status

| Check | Status |
|-------|--------|
| `tsc --noEmit` (excluding TS7006) | ✅ 0 errors |
| `elemental_affinity_weapon_riders.test.ts` (33) | ✅ All pass — NEW |
| `elemental_affinity.test.ts` (regression) | ✅ All pass |
| `elemental_affinity_bespoke.test.ts` | ✅ All pass |
| `elemental_affinity_more_bespoke.test.ts` | ✅ All pass |
| `elemental_affinity_remaining_bespoke.test.ts` | ✅ All pass |
| `elemental_affinity_phase4.test.ts` | ✅ All pass |
| `flame_blade.test.ts` (43) | ✅ All pass |
| `searing_smite.test.ts` (27) | ✅ All pass |
| `elemental_weapon.test.ts` (53) | ✅ All pass |
| `thunderous_smite.test.ts` (28) | ✅ All pass |
| `thunderous_smite_push.test.ts` (24) | ✅ All pass |
| `magic_weapon.test.ts` (53) | ✅ All pass |
| `divine_favor.test.ts` (52) | ✅ All pass |
| `shadow_blade.test.ts` (53) | ✅ All pass |
| `holy_weapon.test.ts` (53) | ✅ All pass |
| `flame_arrows.test.ts` (52) | ✅ All pass |
| `lightning_arrow.test.ts` (27) | ✅ All pass |
| `blinding_smite.test.ts` (26) | ✅ All pass |
| `banishing_smite.test.ts` (27) | ✅ All pass |
| `staggering_smite.test.ts` (27) | ✅ All pass |
| `wrathful_smite.test.ts` (28) | ✅ All pass |
| `ensnaring_strike.test.ts` (27) | ✅ All pass |
| `hail_of_thorns.test.ts` (27) | ✅ All pass |
| `spirit_shroud.test.ts` (27) | ✅ All pass |
| `zephyr_strike.test.ts` (27) | ✅ All pass |
| `hex.test.ts` (27) | ✅ All pass |
| `sneak_attack.test.ts` | ✅ All pass |
| `rage.test.ts` (44) | ✅ All pass |
| `action_surge.test.ts` | ✅ All pass |
| `green_flame_blade.test.ts` (209) | ✅ All pass |
| `booming_blade.test.ts` (216) | ✅ All pass |
| `combat.test.ts` | ✅ All pass |
| `engine.test.ts` | ✅ All pass |
| `mechanics.test.ts` | ✅ All pass |
| `phase4.test.ts` | ✅ All pass |
| `integration.test.ts` | ✅ All pass |
| `scenario.test.ts` | ✅ All pass |

**New assertions this session: 33.** All existing tests remain green. No regressions in any weapon-rider, smite, elemental-affinity, or core-engine test.

---

## CI Status

Single commit pushed to `main` (this session):
- `Session 54 Core Engine TG-027: Elemental Affinity on weapon-rider damage sites`

CI should pass (all local tests green; the only `combat.ts` paths touched are the 3 weapon-rider damage sites, which are exercised by the 22 test files listed above — all green).

---

## Next Session Priorities

### Core Engine (per TASK.md updated Immediate Priority list)

Tier A (LOW risk, ship next):
1. **TG-024** (PHB 2014): ki + sorcery points transfer to `PlayerResources` — single commit, mirrors the existing `actionSurge` pattern at `builder.ts:226`. Unblocks TG-030 (Quivering Palm) + TG-031 (Open Hand Technique). Requires Sheet coordination on `buildRawResources` (Sheet) + `buildResources` (Core `pc.ts:208-320`).
2. **TG-032** (PHB 2014): Land Druid Nature's Ward — fey/elemental charm/frighten immunity. Core drives unilaterally.
3. **TG-028** (PHB 2014/TCE): Booming/Green-Flame Blade "melee spell attack" label fix — comment-only, can be slotted in any session. Cantrip-z owns.

Tier B (MEDIUM risk, ship after Tier A — both blocked on TG-024):
4. **TG-030** (PHB 2014): Quivering Palm action type — needs new `'quiveringPalm'` case in `executePlannedAction`.
5. **TG-031** (PHB 2014): Open Hand Technique Flurry rider — per-turn rider sequencing.

### Creature Megabatch — Batch 5 (still DEFERRED)

- **5a. Lair actions (41 creatures):** needs initiative-count-20 hook in `runCombat` + lair-actions JSON source.
- **5b. Monster spellcasting (83+ creatures):** needs `SPELL_DB` lookup + monster spell-slot tracking + planner integration.
- **5c. Shapechanger (23+ creatures):** needs transform subsystem.

### Sheet Agent (per TASK.md Sheet section)

- **TG-025** (PHB 2014): Per-class unarmored-AC hook — Sheet drives unilaterally.
- **TG-026** (PHB 2014): Resources panel UI for Ki + Sorcery Points — depends on TG-024.
- **TG-029** (PHB 2014): Champion 10 second Fighting Style — Sheet drives steps 1-4.

---

## Commit Log (Session 54)

```
Session 54 Core Engine TG-027: Elemental Affinity on weapon-rider damage sites
  - Sessions 47-51 wired elementalAffinityBonus into the main spell-attack,
    save-spell, auto-hit paths + ~25 bespoke spell execute() functions.
    THREE weapon-rider damage sites in combat.ts were missed — they add
    bonus spell damage of a type on top of a weapon attack but did NOT
    call elementalAffinityBonus():
      Site 1: _nextHitRider consume (~line 1906) — Searing Smite (fire),
              Lightning Arrow (lightning), Blinding Smite (radiant), etc.
      Site 2: weapon_enchant damage DICE (~line 2028) — Elemental Weapon
              (fire), Flame Arrows (fire), Holy Weapon (radiant), Divine
              Favor (radiant), Shadow Blade (psychic).
      Site 3: Flame Blade rider (~line 2053) — +3d6 fire on melee.
    A Draconic Sorcerer 6 with red ancestry got +CHA to fireball but NOT
    to the fire rider on these sources — inconsistency now fixed.
  - At each site, after the rider's bonus damage is rolled + added to dmg,
    call elementalAffinityBonus(attacker, <rider damage type>). If > 0,
    add to dmg + emit a dedicated log event naming the source. Bonus is
    flat (NOT doubled on crit per PHB p.196) — mirrors the main-path EA
    wiring at combat.ts:1796.
  - New test file src/test/elemental_affinity_weapon_riders.test.ts:
    33 assertions across 3 sites × {match, no-match, non-Sorcerer,
    crit-flatness} + 4 cross-cutting (CHA-mod value, CHA-20 value,
    no-ancestry, all-3-fire-on-same-hit).
  - All 22 directly-affected test files pass (5 elemental_affinity suites
    + 16 rider/smite/weapon tests + 1 new). All 6 core engine suites pass.
    tsc --noEmit clean.
  - TEAMGOALS.md: TG-027 status OPEN → DONE — Session 54.
  - TASK.md: Core Engine Active Objective refreshed (S53 → S54); TG-027
    marked DONE; Immediate Priority list re-ordered (TG-024 promoted to #1).
  - Archived zHANDOVER-SESSION-50 + z-52 to HandoverOld/ (AGENTS.md
    "max 2 of each handover type in root" rule — root now has 53 + 54).
```

---

## Generic Registry Count

- `SPELL_DB`: ~170 entries (unchanged this session — Core Engine workstream).
- `BestiaryMap`: 2401 unique creatures from 98 files (unchanged — no parser changes this session).
- **New mechanical coverage this session:**
  - 3 weapon-rider damage sites now apply Elemental Affinity (was 0):
    - `_nextHitRider` smites: Searing Smite (fire), Lightning Arrow (lightning), Blinding Smite (radiant), Thunderous Smite (thunder), Staggering Smite (psychic), Wrathful Smite (psychic), Banishing Smite (force), Hail of Thorns (piercing), Ensnaring Strike (piercing), Zephyr Strike (force), Spirit Shroud (cold/necrotic/radiant)
    - `weapon_enchant` dice: Elemental Weapon (fire), Flame Arrows (fire), Holy Weapon (radiant), Divine Favor (radiant), Shadow Blade (psychic)
    - Flame Blade (fire)
  - A Draconic Sorcerer 6 with matching ancestry now gets +CHA mod to all of these rider damage types (was 0).
- **Remaining Core Engine Tier-A work:** TG-024 (ki/sorcery points), TG-032 (Land Druid Nature's Ward), TG-028 (label fix). Tier-B TG-030/TG-031 blocked on TG-024.
