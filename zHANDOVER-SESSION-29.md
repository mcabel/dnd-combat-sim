# zHANDOVER — Session 29

**Date:** 2026-06-21  
**Agent:** Core Engine (Z.ai)  
**Focus:** TG-006 Summon/Conjure subsystem + 5 high-impact gap fixes  

---

## Session Summary

This was a **two-part** session:

**Part 1:** Completed 5 remaining high-impact gap increments from the Session 28 plan that were described but never committed.

**Part 2:** Deep research + full implementation of TG-006 Summon/Conjure subsystem Phases 1-3, unlocking 16 previously-blocked summon spells.

---

## Part 1: High-Impact Gap Fixes (5 increments)

| # | Increment | Commit | Key Changes |
|---|-----------|--------|-------------|
| 1 | `isConstruct` field + Spare the Dying type exclusion | `e83fa3a` | `isConstruct?: boolean` on Combatant; Spare the Dying now fizzles on undead/constructs (PHB p.277); Ray of Sickness construct immunity |
| 2 | Difficult terrain (4 spells) | `5b726b9` | Spike Growth, Web, Entangle get `terrain_zone` + `terrainDifficulty: true`; Plant Growth fully upgraded from forward-compat flag to real terrain (100ft radius, non-concentration) |
| 3 | Cantrip planner entries (9 cantrips) | `97d9cde` | Booming Blade, Frostbite, Mind Sliver, Poison Spray, Shocking Grasp, Sword Burst, Thunderclap, True Strike, Toll the Dead — AI planner branches |
| 4 | Dispel Magic bespoke | `4338289` | Full bespoke spell module; auto-dispels concentration effects, ability check for non-concentration, upcast support, exhaustion excluded per PHB |
| 5 | Moving AoE zones | `1ae0de1` | `_movingZone` scratch field; start-of-turn zone movement for Flaming Sphere (30ft), Moonbeam (60ft), Call Lightning (60ft), Cloudkill (10ft) |

---

## Part 2: TG-006 Summon/Conjure Subsystem

### Phase 1a: Type System + Despawn Hook (`cc1ec10`)
- Added `isSummon?: boolean`, `summonerId?: string`, `summonSpellName?: string` to `Combatant`
- Added `pendingInitiativeInserts` to `Battlefield`
- Added `'summonSpell'` to `PlannedAction.type` union
- Fixed `spawnSummon()` to use typed fields (no more `as any`)
- Added despawn hook in `removeEffectsFromCaster()` — concentration break removes all summons
- Added `case 'summonSpell':` in combat.ts

### Phase 1b: Summon Beast — Vertical Slice (`c4bcf43`)
- First TCE summon spell, establishes full pipeline
- Manually-built Combatant (not from bestiary — TCE stat blocks are inline)
- HP: 20 + 5×(slotLevel-2), AC: 11 + slotLevel, 1→2 attacks at L5+
- Initiative insertion via `pendingInitiativeInserts`
- Concentration-break despawn verified
- 78 test assertions

### Phase 1c: L3 TCE Spells (`3b6301a`)
- **Summon Fey**: Fey Spirit, Shortsword +5, 1d6+2 piercing + 1d6 psychic
- **Summon Undead**: Undead Spirit (Putrid default), Rotting Claw +5, 1d6+2 slashing + 1d6 poison
- **Summon Shadowspawn**: Shadow Spirit, Bite +5, 1d6+2 piercing + 1d4 cold
- 238 test assertions across 3 test files

### Phase 1d: L3-L4 TCE Spells (`c5ca439`)
- **Summon Lesser Demons**: 2 Dretches (multi-spawn pattern), Bite+Claws multiattack
- **Summon Aberration**: Aberrant Spirit (Slaad), Claw +5, 1d8+3 slashing + 1d6 acid
- **Summon Construct**: Construct Spirit, Slam +6, 1d8+4 bludgeoning
- **Summon Elemental**: Elemental Spirit (Fire), Fire Strike +5, 1d8+3 fire
- **Summon Greater Demon**: Barlgura, Bite+Claws multiattack, AC 15, HP 52+
- 364 test assertions

### Phase 1e: L5+ TCE Spells (`1e101b9`)
- **Summon Celestial** (L5): Celestial Spirit (Defender), Radiant Greatsword 3d8+3
- **Summon Draconic Spirit** (L5): Draconic Spirit (Red), Bite 1d10+3 + 2d6 fire breath
- **Summon Fiend** (L6): Fiendish Spirit (Devil), Fiendish Blade 1d8+2 + 1d6 fire
- 242 test assertions

### Phase 2: Conjure Animals (`e508c75`)
- **Conjure Animals** (PHB p.225): v1 spawns 2 Wolves (CR 1/4 × 2)
- Created `src/summons/cr_picker.ts` — `pickCreaturesByCR()` + `parseCR()` for future bestiary integration
- Wolf stat block: AC 13, HP 11, Bite +4 2d6+2, Pack Tactics
- 135 test assertions

### Phase 3: Find Familiar/Steed/Greater Steed (`99ee63e`)
- **Find Familiar** (L1): Owl familiar, Tiny, `cannotAttack: true`, role: 'familiar', Flyby
- **Find Steed** (L2): Warhorse mount, Large, combat_mount, mounts caster via `mountCreature()`
- **Find Greater Steed** (L4): Griffon mount, Large, combat_mount, fly 80ft, Beak+Claws multiattack
- NOT concentration (instantaneous) — persists until killed or dismissed
- 197 test assertions

---

## Full Spell Inventory (16 new summon spells)

| Spell | Level | Type | Source | v1 Default |
|-------|-------|------|--------|------------|
| Find Familiar | L1 | Instant | PHB p.240 | Owl (Tiny, Help action) |
| Summon Beast | L2 | Conc 1hr | TCE p.111 | Land (Bestial Spirit) |
| Find Steed | L2 | Instant | PHB p.240 | Warhorse (combat_mount) |
| Summon Fey | L3 | Conc 1hr | TCE p.112 | Fey Spirit |
| Summon Undead | L3 | Conc 1hr | TCE p.113 | Putrid (Undead Spirit) |
| Summon Shadowspawn | L3 | Conc 1hr | TCE p.113 | Shadow Spirit |
| Summon Lesser Demons | L3 | Conc 1min | XGE p.167 | 2 Dretches |
| Conjure Animals | L3 | Conc 1hr | PHB p.225 | 2 Wolves |
| Summon Aberration | L4 | Conc 1hr | TCE p.110 | Slaad (Aberrant Spirit) |
| Summon Construct | L4 | Conc 1hr | TCE p.111 | Construct Spirit |
| Summon Elemental | L4 | Conc 1hr | TCE p.112 | Fire (Elemental Spirit) |
| Summon Greater Demon | L4 | Conc 1min | XGE p.166 | Barlgura |
| Find Greater Steed | L4 | Instant | XGE p.156 | Griffon (combat_mount) |
| Summon Celestial | L5 | Conc 1hr | TCE p.111 | Defender (Celestial Spirit) |
| Summon Draconic Spirit | L5 | Conc 1hr | FTD p.21 | Red dragon |
| Summon Fiend | L6 | Conc 1hr | TCE p.112 | Devil (Fiendish Spirit) |

---

## Architecture Decisions

### 1. TCE spells: Manual Combatant construction (NOT bestiary lookup)
TCE summon stat blocks are inline in the spell description and scale with slot level. They're NOT in the bestiary JSON. Each spell module builds the Combatant manually via a `create[MonsterName](caster, slotLevel)` helper function.

### 2. PHB Conjure spells: Hardcoded common picks + CR picker infrastructure
Conjure Animals v1 hardcodes "2 Wolves" for reliability. The `cr_picker.ts` module provides `pickCreaturesByCR()` for future bestiary-integrated picks.

### 3. Non-concentration summons (Find Familiar/Steed/Greater Steed)
These are Instantaneous — no concentration break despawn. They persist until killed or dismissed. The `isSummon` / `summonerId` tags are still set for tracking, but `removeEffectsFromCaster` won't despawn them.

### 4. Initiative insertion: TCE-style (after caster)
All summons use `pendingInitiativeInserts` with `insertAfterId = caster.id`. This matches TCE's "shares your initiative, acts immediately after yours." PHB Conjure canonically rolls group initiative, but v1 uses the same TCE-style insertion for simplicity.

### 5. Multi-spawn: Summon Lesser Demons pattern
Summon Lesser Demons creates 2 Combatant objects, both added to `bf.combatants` and `pendingInitiativeInserts`. Both share `summonerId` so concentration break despawns them together.

### 6. Mount integration: Find Steed/Greater Steed
After spawning, `mountCreature(caster, steed)` is called from `src/summons/mount.ts`, setting up the rider↔mount link. This means the caster is immediately mounted on their new steed.

---

## Remaining TG-006 Work (Phase 4 — Deferred)

### More PHB Conjure spells (6 spells, MEDIUM complexity)
- Conjure Woodland Beings (L4): 8 fey creatures of CR 1/4 or lower
- Conjure Minor Elementals (L4): 8 elementals of CR 1/4 or lower
- Conjure Elemental (L5): 1 elemental of CR 5 or lower
- Conjure Fey (L6): 1 fey of CR 6 or lower
- Conjure Celestial (L7): 1 celestial of CR 4 or lower
- Conjure Volley/Barrage: re-categorize as damage spells (not summons)

### High-complexity summon spells (19 spells — defer to future sessions)
- Animate Dead (L3): Creates undead from corpses — needs corpse tracking
- Create Undead (L6): Same as Animate Dead but higher level
- Magic Jar (L6): Body possession — bespoke subsystem
- Simulacrum (L7): Creates a copy of a creature — needs stat copying
- Planar Ally (L6): Negotiation subsystem
- Planar Binding (L5): Duration binding without concentration
- Gate (L9): Portal to another plane
- True Polymorph (L9): Full creature transformation
- Shapechange (L9): Self-transformation
- And others (Glyph of Warding, Symbol, Clone, Demiplane, etc.)

---

## Test Coverage

| Category | New Test Files | Total Assertions |
|----------|---------------|------------------|
| Gap fixes (Part 1) | 4 files | ~154 assertions |
| Summon spells (Part 2) | 16 files | ~1,324 assertions |
| **Total** | **20 new files** | **~1,478 assertions** |

All tests pass with 0 failures. TypeScript source compiles clean.

---

## Generic Registry Count
- Before session: 130 spells in `_generic_registry.ts`
- After session: 129 (Dispel Magic removed) + Conjure Animals may still be in registry (check)
- 16 new bespoke summon spell modules created

---

## Commit Log (Session 29)

```
99ee63e Phase 3: Find Familiar + Find Steed + Find Greater Steed (TG-006)
e508c75 Phase 2: Conjure Animals (PHB) + CR-based picker helper (TG-006)
1e101b9 Phase 1e: Summon Celestial + Summon Draconic Spirit + Summon Fiend (L5-L6 TCE, TG-006)
c5ca439 Phase 1d: Summon Lesser Demons + Summon Aberration + Summon Construct + Summon Elemental + Summon Greater Demon (L3-L4 TCE, TG-006)
3b6301a Phase 1c: Summon Fey + Summon Undead + Summon Shadowspawn (L3 TCE, TG-006)
c4bcf43 Phase 1b: Summon Beast bespoke spell — first TCE summon (TG-006)
cc1ec10 Phase 1a: Add summon type fields to Combatant + Battlefield + despawn hook (TG-006)
1ae0de1 feat: implement moving AoE zones for Flaming Sphere, Moonbeam, Call Lightning, and Cloudkill
97d9cde feat: add 9 offensive cantrip planner branches + cantrip_planner.test.ts
4338289 feat: implement Dispel Magic bespoke spell (PHB p.233)
5b726b9 feat: add difficult terrain to Spike Growth, Web, Entangle, and Plant Growth
e83fa3a feat: add isConstruct field, fix Spare the Dying type exclusion, add construct immunity checks
```

---

## Next Session Priorities

1. **More PHB Conjure spells** — Conjure Woodland Beings, Conjure Minor Elementals, Conjure Elemental (using bestiary data)
2. **Forced movement subsystem** — Thunderwave push, Eldritch Blast push, Thunderous Smite
3. **True Invisibility** — Invisibility spell, Greater Invisibility
4. **Reaction spell subsystem** (TG-008) — Shield, Counterspell, Absorb Elements
5. **TG-013/TG-014 housekeeping** — Move `rollDiceString` to utils, fix BB/GFB labels
